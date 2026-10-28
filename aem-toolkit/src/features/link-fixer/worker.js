/**
 * link-fixer: find links in a page's content written as full URLs to our own
 * site, and rewrite the ones ticked as relative paths.
 *
 * Only the page's content is read - the components under jcr:content. The page
 * properties (jcr:content's own properties, its thumbnail) are left alone.
 *
 * The fix writes, so it is checked like every other write here: each property
 * is read again first and must still hold exactly what the scan found, the page
 * is written, and every property is read back afterwards. No version is saved.
 */

import { abort } from '../../core/aem-client.js';
import { norm } from '../../core/paths.js';
import { typeHint, sameValue } from '../../core/rewrite.js';
import { hostList, scanContent, applyFixes } from './links.js';

/** Form bodies stay under this, well inside the authors' form-size limit (200 KB by default). */
const FORM_LIMIT = 150000;

/**
 * Our hosts: www.samsung.com and samsung.com, this author instance, the other
 * author instances in settings, and the extra site hosts listed there.
 */
function hostsFrom(settings) {
  const origins = (settings?.origins || []).map((o) => {
    try {
      return new URL(o).hostname;
    } catch {
      return null;
    }
  });
  const extra = String(settings?.upsertHosts || '').split(',');
  return hostList([location.hostname, ...origins, ...extra]);
}

async function readPage(client, path) {
  const page = norm(path);
  if (!/^\/content\//.test(page)) throw abort(`The page must be under /content: ${page}`);

  const info = await client.inspect(page);
  client.assertReadable(info, 'page');
  if (!info.exists) throw abort(`Page does not exist: ${page}`);
  if (!info.isPage) throw abort(`Not a cq:Page (it is ${info.primaryType}): ${page}`);

  const content = await client.readTreeWhole(`${page}/jcr:content`);
  if (!content) throw abort(`The page has no jcr:content: ${page}`);
  return { page, title: info.title, content };
}

function assertWrite(r, what) {
  if (!r.success) {
    throw abort(`${what} failed [HTTP ${r.http} / status ${r.effective}]: ${r.message || '(no message returned)'}`);
  }
  return r;
}

/** Each property with its TypeHint, so a multi-value property stays one. */
function pairsFor(writes) {
  return writes.map((w) => {
    const name = `./${w.node}/${w.prop}`;
    const values = Array.isArray(w.to) ? w.to : [w.to];
    // Sling removes a property posted with an empty value; a fix never makes one.
    if (!Array.isArray(w.to) && !String(w.to).trim()) throw abort(`Refusing to write an empty value to ${name}.`);
    return [[`${name}@TypeHint`, typeHint(w.to)], ...values.map((v) => [name, String(v)])];
  });
}

/** The properties packed into requests under the form limit, a property never split from its TypeHint. */
function pack(units) {
  const size = (ps) => new URLSearchParams(ps).toString().length;
  const requests = [];
  let cur = [];
  for (const unit of units) {
    if (cur.length && size([...cur, ...unit]) > FORM_LIMIT) {
      requests.push(cur);
      cur = [];
    }
    cur.push(...unit);
  }
  if (cur.length) requests.push(cur);
  return requests;
}

/**
 * Each component's name as the editor shows it - the jcr:title of its
 * definition, "Text Block" rather than cm-g-text-block. /apps first, then
 * /libs. A component whose definition cannot be read keeps its node type.
 */
async function componentTitles(client, types) {
  const titles = new Map();
  for (const rt of types) {
    if (!rt || rt.startsWith('/')) continue;
    for (const root of ['/apps', '/libs']) {
      const props = await client.readProps(`${root}/${rt}`).catch(() => null);
      if (props?.['jcr:title']) {
        titles.set(rt, String(props['jcr:title']));
        break;
      }
    }
  }
  return titles;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const actions = {
  /** Reads only. Lists every full-URL link to our hosts in the page's content. */
  async scan({ client, report, params, settings }) {
    client.resetCaches();
    const hosts = hostsFrom(settings);
    const { page, title, content } = await readPage(client, params.page);
    const { components, nodes } = scanContent(content, hosts);
    const titles = await componentTitles(client, new Set(components.map((c) => c.resourceType)));
    for (const c of components) c.title = titles.get(c.resourceType) || null;
    const count = components.reduce((n, c) => n + c.links.length, 0);

    const r = { page, title, hosts, components, nodes, count };
    report('data', 'analysis', r);
    report(
      'info',
      count
        ? `${plural(count, 'full-URL link')} found in ${plural(components.length, 'component')} (${nodes} nodes read). Nothing has been written.`
        : `No full-URL links to ${hosts.join(', ')} in ${nodes} nodes. Nothing to fix.`
    );
    return r;
  },

  /**
   * Writes. `picks` is [{ node, prop, expect, links: [{ index, start, from, to }] }],
   * one entry per property, `expect` the value the scan read.
   */
  async fix({ client, report, params, settings }) {
    client.resetCaches();
    const step = (id, state, note) => report('data', 'step', { id, state, note });
    const picks = Array.isArray(params.picks) ? params.picks : [];
    if (!picks.length) throw abort('Tick at least one link to fix.');

    const page = norm(params.page);
    const target = `${page}/jcr:content`;
    const hosts = hostsFrom(settings);

    /* ---- 1. every property still as scanned ------------------------------ */
    step('check-first', 'running');
    const writes = [];
    for (const p of picks) {
      const live = await client.readProps(`${target}/${p.node}`);
      if (!live || !sameValue(live[p.prop], p.expect)) {
        step('check-first', 'failed');
        throw abort(
          `${p.node} › ${p.prop} has changed since the scan. Nothing has been written - scan the page again.`
        );
      }
      let to;
      try {
        to = applyFixes(live[p.prop], p.links);
      } catch (e) {
        step('check-first', 'failed');
        throw abort(`${p.node} › ${p.prop}: ${e.message}. Nothing has been written - scan the page again.`);
      }
      writes.push({ node: p.node, prop: p.prop, to, links: p.links });
    }
    const lockOwner = (await client.readProps(target))?.['jcr:lockOwner'] || null;
    const me = await client.currentUser().catch(() => null);
    if (lockOwner && lockOwner !== me) {
      step('check-first', 'failed');
      throw abort(`The page is locked by ${lockOwner}. Ask them to unlock it, then fix again. Nothing has been written.`);
    }
    step('check-first', 'done');

    /* ---- 2. the write -------------------------------------------------------- */
    step('write', 'running');
    const units = pairsFor(writes);
    // The page shows as modified, so it is picked up for publishing.
    units.push([['./cq:lastModified@TypeHint', 'Date'], ['./cq:lastModified', new Date().toISOString()]]);
    if (me) units[units.length - 1].push(['./cq:lastModifiedBy', me]);
    const requests = pack(units);
    let sent = 0;
    try {
      for (const part of requests) {
        const answer = assertWrite(await client.writeNode(target, part), 'Writing the links');
        if (answer.effective === 201 || (answer.resultPath && decodeURI(answer.resultPath) !== target)) {
          throw abort(`AEM saved the request, but not into this page (status ${answer.effective} for ${answer.resultPath || '(no path)'})`);
        }
        sent++;
      }
    } catch (e) {
      step('write', 'failed');
      throw abort(
        `${e.message.replace(/\.$/, '')}. ` +
          (sent
            ? `${sent} of ${requests.length} requests were saved before this one - scan the page again to see where it stands.`
            : 'Nothing was saved.')
      );
    }
    const fixed = writes.reduce((n, w) => n + w.links.length, 0);
    for (const w of writes) {
      for (const l of w.links) report('ok', `${w.node} › ${w.prop}: ${l.from} → ${l.to}`);
    }
    step('write', 'done', plural(fixed, 'link'));

    /* ---- 3. read back --------------------------------------------------------- */
    step('check', 'running');
    const off = [];
    for (const w of writes) {
      const live = await client.readProps(`${target}/${w.node}`);
      if (!live || !sameValue(live[w.prop], w.to)) off.push(`${w.node} › ${w.prop}`);
    }
    if (off.length) {
      step('check', 'failed');
      for (const o of off) report('warn', `does not hold the fixed value: ${o}`);
      throw abort(`${plural(off.length, 'property', 'properties')} did not read back as written - check the page.`);
    }
    // What is left: links unticked, or added since the scan.
    const after = await client.readTreeWhole(target);
    const left = after ? findLeft(after, hosts) : 0;
    step('check', 'done', left ? `${left} left` : 'all relative');
    report('ok', `Done. ${plural(fixed, 'link')} made relative on ${page}`);

    return {
      done: true,
      page,
      dest: page,
      fixed,
      left,
      title: `${plural(fixed, 'link')} made relative`,
      editorUrl: `/editor.html${page}.html`
    };
  }
};

function findLeft(content, hosts) {
  return scanContent(content, hosts).components.reduce((n, c) => n + c.links.length, 0);
}
