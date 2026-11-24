/**
 * site-code-fixer: find links in a page's content that point into another
 * site's tree - /ae_ar/... on an /sa page - and re-point the ticked ones at the
 * page's own site.
 *
 * The scan reads only. A candidate code counts as a site only when AEM has a
 * page at /content/<brand>/<code>: that is what keeps /semiconductor/ or any
 * other path www.samsung.com serves beside its sites from being taken for one.
 * Each corrected link's page is looked up on this site too, so a link that
 * would point at a page /sa does not have is flagged rather than ticked.
 *
 * The fix writes, and is checked the way the Relative Link Fixer's is: every
 * pick must be one the scanner finds in the page as it is now, every property
 * must still hold what the scan read, and every property is read back after
 * the write. No version is saved.
 */

import { abort } from '../../core/aem-client.js';
import { norm } from '../../core/paths.js';
import { typeHint, sameValue } from '../../core/rewrite.js';
import { applyFixes, hostList, keepSites, scanContent, siteOfPage } from './links.js';

/** Form bodies stay under this, well inside the authors' form-size limit (200 KB by default). */
const FORM_LIMIT = 150000;
const PROBE_CONCURRENCY = 6;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Our hosts: www.samsung.com and samsung.com, this author instance and the others in settings. */
function hostsFrom(settings) {
  const origins = (settings?.origins || []).map((o) => {
    try {
      return new URL(o).hostname;
    } catch {
      return null;
    }
  });
  return hostList([globalThis.location?.hostname, ...origins]);
}

export function depthOf(settings) {
  const n = Number(settings?.rootDepth);
  return Number.isInteger(n) && n >= 1 ? n : 3;
}

/** The page's own site, or a refusal saying why it cannot be told. */
export function siteFor(page, settings) {
  const depth = depthOf(settings);
  const s = siteOfPage(page, depth);
  if (!s) {
    throw abort(
      `Cannot tell which site ${page} belongs to: the site root depth in Settings is ${depth}, ` +
        `so the site code would be segment ${depth} of the path.`
    );
  }
  return s;
}

export async function readPage(client, path) {
  const page = norm(path);
  if (!/^\/content\//.test(page) || page.startsWith('/content/dam/')) throw abort(`The page must be under /content: ${page}`);
  const info = await client.inspect(page);
  client.assertReadable(info, 'page');
  if (!info.exists) throw abort(`Page does not exist: ${page}`);
  if (!info.isPage) throw abort(`Not a cq:Page (it is ${info.primaryType}): ${page}`);
  const content = await client.readTreeWhole(`${page}/jcr:content`);
  if (!content) throw abort(`The page has no jcr:content: ${page}`);
  return { page, title: info.title, content };
}

export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/** The candidate codes AEM has a site page for. Unreadable counts as no: nothing is re-pointed on a guess. */
async function realSites(client, contentRoot, codes) {
  const found = new Set();
  await pool([...codes], PROBE_CONCURRENCY, async (code) => {
    const props = await client.readProps(`${contentRoot}/${code}`).catch(() => null);
    if (props?.['jcr:primaryType'] === 'cq:Page') found.add(code);
  });
  return found;
}

/** Candidates found by the scanner, kept to the codes that are sites. */
async function siteLinks(client, content, ctx) {
  const { components, nodes } = scanContent(content, ctx);
  // A placeholder is not a site to ask AEM about; keepSites lets it through for review.
  const codes = new Set(components.flatMap((c) => c.links.filter((l) => !l.placeholder).map((l) => l.code)));
  const sites = codes.size ? await realSites(client, ctx.contentRoot, codes) : new Set();
  return { components: keepSites(components, sites), nodes, sites, notSites: [...codes].filter((c) => !sites.has(c)).sort() };
}

/** Each component's name as the editor shows it - the jcr:title of its definition. */
export async function componentTitles(client, types) {
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

export function assertWrite(r, what) {
  if (!r.success) throw abort(`${what} failed [HTTP ${r.http} / status ${r.effective}]: ${r.message || '(no message returned)'}`);
  return r;
}

/** Each property with its TypeHint, so a multi-value property stays one. */
export function pairsFor(writes) {
  return writes.map((w) => {
    const name = `./${w.node}/${w.prop}`;
    const values = Array.isArray(w.to) ? w.to : [w.to];
    if (!Array.isArray(w.to) && !String(w.to).trim()) throw abort(`Refusing to write an empty value to ${name}.`);
    return [[`${name}@TypeHint`, typeHint(w.to)], ...values.map((v) => [name, String(v)])];
  });
}

const formSize = (ps) => new URLSearchParams(ps).toString().length;

/* A lone CR or LF. A multipart body turns each into CRLF on the way out, so a
   value holding one would not read back as written. */
const LONE_NEWLINE = /\r(?!\n)|(?<!\r)\n/;

/**
 * One request's write. Form encoding is the usual; one property that alone is
 * past the form limit - a Static Content script in Arabic, percent-encoded,
 * easily is - goes multipart, which has no such limit, as long as its
 * newlines survive that unchanged. Either way the read-back is the judge.
 */
export function writePart(client, target, part) {
  const big = formSize(part) > FORM_LIMIT;
  if (big && !part.some(([, v]) => LONE_NEWLINE.test(String(v)))) return client.writeTree(target, part);
  return client.writeNode(target, part);
}

/** The properties packed into requests under the form limit, a property never split from its TypeHint. */
export function pack(units) {
  const size = formSize;
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

export const actions = {
  /** Reads only. Lists every link in the page's content that points into another site. */
  async scan({ client, report, params, settings }) {
    client.resetCaches();
    const { page, title, content } = await readPage(client, params.page);
    const { site, contentRoot } = siteFor(page, settings);
    const ctx = { site, contentRoot, hosts: hostsFrom(settings) };
    const { components, nodes, notSites } = await siteLinks(client, content, ctx);

    /* The page each corrected link names, on this site. A link re-pointed at
       a page /sa does not have is a broken link, not a fix. */
    const targets = [...new Set(components.flatMap((c) => c.links.map((l) => l.target)))];
    const state = new Map();
    await pool(targets, PROBE_CONCURRENCY, async (t) => {
      const at = await client.probe(t).catch(() => 'error');
      state.set(t, at === 'yes' ? 'yes' : at === 'no' ? 'no' : 'unknown');
    });
    for (const c of components) for (const l of c.links) l.exists = state.get(l.target) || 'unknown';

    const titles = await componentTitles(client, new Set(components.map((c) => c.resourceType)));
    for (const c of components) c.title = titles.get(c.resourceType) || null;

    const count = components.reduce((n, c) => n + c.links.length, 0);
    const bySite = new Map();
    for (const c of components) for (const l of c.links) bySite.set(l.code, (bySite.get(l.code) || 0) + 1);
    const otherSites = [...bySite].map(([code, links]) => ({ code, links })).sort((a, b) => b.links - a.links || a.code.localeCompare(b.code));

    const r = { page, title, site, contentRoot, components, nodes, count, otherSites };
    report('data', 'analysis', r);
    if (notSites.length) report('info', `Not sites, so left alone: /${notSites.join(', /')}.`);
    const scripted = components.reduce((n, c) => n + c.links.filter((l) => l.inScript).length, 0);
    if (scripted) report('warn', `${plural(scripted, 'link')} inside a script. Check the component still works after fixing.`);
    report(
      'info',
      count
        ? `${plural(count, 'link')} to other sites found (${otherSites.map((o) => `/${o.code} ${o.links}`).join(', ')}) in ` +
            `${plural(components.length, 'component')}. This page is on /${site}. Nothing has been written.`
        : `Every link in ${nodes} nodes points at /${site}. Nothing to fix.`
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
    const { site, contentRoot } = siteFor(page, settings);
    const ctx = { site, contentRoot, hosts: hostsFrom(settings) };

    /* ---- 1. every pick is one the scan finds now, every property as scanned */
    step('check-first', 'running');
    /* What the panel sends is not taken on trust: every pick has to be a link
       the scanner itself finds in the page as it is now, into a site AEM has -
       same component, property, place, link and corrected link. */
    const now = await siteLinks(client, (await client.readTreeWhole(target)) || {}, ctx);
    const scanned = new Map();
    for (const c of now.components) for (const l of c.links) scanned.set(`${c.node}|${l.prop}|${l.index}|${l.start}`, l);

    const writes = [];
    for (const p of picks) {
      const links = Array.isArray(p?.links) ? p.links : [];
      const stranger = !links.length
        ? '(no links)'
        : links.find((l) => {
            const s = scanned.get(`${p.node}|${p.prop}|${l?.index}|${l?.start}`);
            return !s || s.from !== l.from || s.to !== l.to;
          });
      if (stranger) {
        step('check-first', 'failed');
        throw abort(
          `${p?.node} › ${p?.prop}: "${stranger?.from ?? stranger}" is not a link the scan finds there now. ` +
            'Nothing has been written - scan the page again.'
        );
      }
      const live = await client.readProps(`${target}/${p.node}`);
      if (!live || !sameValue(live[p.prop], p.expect)) {
        step('check-first', 'failed');
        throw abort(`${p.node} › ${p.prop} has changed since the scan. Nothing has been written - scan the page again.`);
      }
      let to;
      try {
        to = applyFixes(live[p.prop], p.links);
      } catch (e) {
        step('check-first', 'failed');
        throw abort(`${p.node} › ${p.prop}: ${e.message}. Nothing has been written - scan the page again.`);
      }
      const scripted = p.links.filter((l) => scanned.get(`${p.node}|${p.prop}|${l.index}|${l.start}`)?.inScript).length;
      writes.push({ node: p.node, prop: p.prop, to, links: p.links, scripted });
    }
    const lockOwner = (await client.readProps(target))?.['jcr:lockOwner'] || null;
    const me = await client.currentUser().catch(() => null);
    if (lockOwner && lockOwner !== me) {
      step('check-first', 'failed');
      throw abort(`The page is locked by ${lockOwner}. Ask them to unlock it, then fix again. Nothing has been written.`);
    }
    step('check-first', 'done');

    /* ---- 2. the write ------------------------------------------------------ */
    step('write', 'running');
    const units = pairsFor(writes);
    // The page shows as modified, so it is picked up for publishing.
    units.push([['./cq:lastModified@TypeHint', 'Date'], ['./cq:lastModified', new Date().toISOString()]]);
    if (me) units[units.length - 1].push(['./cq:lastModifiedBy', me]);
    const requests = pack(units);
    let sent = 0;
    try {
      for (const part of requests) {
        const answer = assertWrite(await writePart(client, target, part), 'Writing the links');
        if (answer.effective === 201 || (answer.resultPath && decodeURI(answer.resultPath) !== target)) {
          throw abort(`AEM saved the request, but not into this page (status ${answer.effective} for ${answer.resultPath || '(no path)'})`);
        }
        sent++;
      }
    } catch (e) {
      step('write', 'failed');
      throw abort(
        `${e.message.replace(/\.$/, '')}. ` +
          (sent ? `${sent} of ${requests.length} requests were saved before this one - scan the page again to see where it stands.` : 'Nothing was saved.')
      );
    }
    const fixed = writes.reduce((n, w) => n + w.links.length, 0);
    for (const w of writes) for (const l of w.links) report('ok', `${w.node} › ${w.prop}: ${l.from} → ${l.to}`);
    step('write', 'done', plural(fixed, 'link'));

    /* ---- 3. read back -------------------------------------------------------- */
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
    // Every link into another site still on the page: the unticked ones, and any added since the scan.
    const after = await client.readTreeWhole(target);
    const remaining = after ? (await siteLinks(client, after, ctx)).components.reduce((n, c) => n + c.links.length, 0) : 0;
    step('check', 'done', remaining ? `ticked links on /${site}, ${remaining} left as they were` : `every link on /${site}`);
    report('ok', `Done. ${plural(fixed, 'link')} pointed at /${site} on ${page}`);
    // Links changed inside a script, and where: the author is asked to check those components still work.
    const scriptedIn = writes.filter((w) => w.scripted).map((w) => `${w.node} › ${w.prop}`);
    const scripted = writes.reduce((n, w) => n + w.scripted, 0);
    if (scripted) report('warn', `${plural(scripted, 'link')} changed inside a script (${scriptedIn.join(', ')}). Open the page and check it still works.`);

    return {
      done: true,
      page,
      dest: page,
      site,
      fixed,
      left: 0,
      remaining,
      scripted,
      scriptedIn,
      title: `${plural(fixed, 'link')} pointed at /${site}`,
      editorUrl: `/editor.html${page}.html`
    };
  }
};
