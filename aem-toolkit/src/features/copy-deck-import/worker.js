/**
 * copy-deck-import: check a translated copy deck against a page, then write it.
 *
 * `check` reads only. The page's jcr:content is read whole, as it is now, and
 * every row of the sheet is matched against it by key; the plan says what a
 * write would do and why anything is left out. Nothing is trusted from the
 * sheet except which property a row is for and what the translator typed.
 *
 * `apply` writes, and is checked like every other write here:
 *   1. the page is read and planned again, and the writes must be exactly the
 *      ones the operator reviewed - the panel sends their fingerprint;
 *   2. a lock held by someone else stops it;
 *   3. every property goes in ONE Sling POST, which AEM saves whole or not at
 *      all - a failure cannot leave the page half translated;
 *   4. the page is read back and every property compared with what was sent.
 * Nothing is deleted, no empty value is ever sent, no version is saved, and
 * nothing is published.
 *
 * A product page (PD) is refused, and so is a sheet exported from one: its
 * copy comes from PIM, and its translations are entered there.
 *
 * The review groups the writes by the sheet's sections, each ticked or not;
 * the ids ticked come with the write (`sections`), and only writes in those
 * sections are made - the fingerprint covers the choice too. A Static Content
 * block's section is unticked unless chosen: ticked, its prepared Body (HTML)
 * and Footer (JavaScript) are writes of their own, planned, fingerprinted and
 * read back like the rest. Its Header (CSS) never is.
 *
 * `staticStatus` reads only, for a block's Check again and Copy buttons: its
 * three fields as they are now. `checkAll` reads only too: "Find English
 * still on the page".
 */

import { abort } from '../../core/aem-client.js';
import { readHome, titleEnding } from '../../core/site-values.js';
import { norm } from '../../core/paths.js';
import { typeHint } from '../../core/rewrite.js';
import { componentName, planImport, readSheet, writesFingerprint, writesSaid } from '../copy-deck/core.js';
import { isPdKey, isPdPage } from '../copy-deck/pd.js';
import { englishLeft } from './hand-offs.js';

/** The page a request is for: under /content, never an asset. */
function pageOf(params) {
  // A pasted preview path carries selectors and an extension: tvs.html -> tvs.
  const page = norm(params.page || '').replace(/\/([^/.]+)\.[^/]*$/, '/$1');
  if (!/^\/content\//.test(page) || page.startsWith('/content/dam/')) {
    throw abort(`Give a page under /content, not ${page || 'nothing'}.`);
  }
  return page;
}

/** The page, the sheet and the plan - read fresh on every call. */
async function readAndPlan(client, params) {
  const page = pageOf(params);

  let grid;
  try {
    grid = JSON.parse(params.sheet || '');
  } catch {
    throw abort('Paste the translated sheet first.');
  }
  const sheet = readSheet(Array.isArray(grid) ? grid : []);
  if (!sheet.ok) throw abort(sheet.problem);
  if (!sheet.rows.length) throw abort('The sheet has a header but no rows.');
  if (sheet.rows.some((r) => (r.keys ?? [r.key]).some(isPdKey))) {
    throw abort(
      `This copy deck is from a product page (PD)${sheet.meta?.pagePath ? `, ${sheet.meta.pagePath}` : ''}. Its text comes ` +
        'from PIM, so the translations are entered in PIM - they cannot be written to AEM from here.'
    );
  }

  const info = await client.inspect(page);
  client.assertReadable(info, 'page');
  if (!info.exists) throw abort(`Page does not exist: ${page}`);
  if (!info.isPage) throw abort(`Not a cq:Page (it is ${info.primaryType}): ${page}`);
  // Its copy is PIM's: anything written here would not be what the page shows, and PIM would write over it.
  if (isPdPage(info)) {
    throw abort(`${page} is a product page (PD). Its text comes from PIM, so translations are entered in PIM, not written to AEM.`);
  }

  const tree = await client.readTreeWhole(`${page}/jcr:content`);
  if (!tree) throw abort(`The page has no jcr:content: ${page}`);

  /* How this site's titles end, off its home page - /content/samsung/levant_ar -
   * for the check on a country named wrongly. Reads only; unreadable, no check. */
  const home = page.split('/').slice(0, 4).join('/');
  const siteEnding = home !== page ? titleEnding((await readHome(client, home)).props) : null;

  return {
    page,
    info,
    tree,
    sheet,
    plan: planImport(tree, sheet, { pagePath: page, sections: Array.isArray(params.sections) ? params.sections.map(String) : null, siteEnding })
  };
}

/** The server this runs on - the content script's own origin. */
const here = () => globalThis.location?.origin || '';

function assertWrite(r, what) {
  if (!r.success) {
    throw abort(`${what} failed [HTTP ${r.http} / status ${r.effective}]: ${r.message || '(no message returned)'}`);
  }
  return r;
}

const nodeAt = (content, path) =>
  path ? path.split('/').reduce((n, s) => (n && typeof n === 'object' ? n[s] : undefined), content) : content;

/**
 * The Sling POST for the writes, every name relative to jcr:content. Each value
 * carries its type, so a multi-value property stays one - a single value posted
 * to it would otherwise turn it into a single-value property.
 */
function pairsFor(writes) {
  const pairs = [];
  for (const w of writes) {
    const name = `./${w.path ? `${w.path}/` : ''}${w.prop}`;
    const values = Array.isArray(w.to) ? w.to : [w.to];
    // Sling removes a property posted with an empty value. The plan never
    // produces one; this makes sure a bug could not turn into a deletion.
    if (!Array.isArray(w.to) && !String(w.to).trim()) throw abort(`Refusing to write an empty value to ${name}.`);
    pairs.push([`${name}@TypeHint`, typeHint(w.to)]);
    for (const v of values) pairs.push([name, String(v)]);
  }
  return pairs;
}

/** Form bodies stay under this, well inside the authors' form-size limit (200 KB by default). */
const FORM_LIMIT = 150000;

/**
 * The pairs as requests: the texts packed together up to the form-size limit,
 * each Static Content block's Body(HTML) in a request of its own - a value
 * always in the same request as its TypeHint.
 */
function splitPairs(pairs, writes) {
  const size = (ps) => new URLSearchParams(ps).toString().length;
  const blocks = new Set(writes.filter((w) => w.static).map((w) => `./${w.path ? `${w.path}/` : ''}${w.prop}`));
  const requests = [];
  let texts = [];
  for (let i = 0; i < pairs.length; i++) {
    const name = pairs[i][0].replace(/@TypeHint$/, '');
    const unit = [pairs[i]];
    while (i + 1 < pairs.length && pairs[i + 1][0] === name) unit.push(pairs[++i]);
    if (blocks.has(name)) {
      requests.push(unit);
      continue;
    }
    if (texts.length && size([...texts, ...unit]) > FORM_LIMIT) {
      requests.unshift(texts);
      texts = [];
    }
    texts.push(...unit);
  }
  if (texts.length) requests.unshift(texts);
  return requests;
}

/** Node names only - no "..", no selector, no extension: a node under the page's jcr:content and nowhere else. */
const NODE_PATH = /^[\w:-]+(\/[\w:-]+)*$/;
const text = (v) => (typeof v === 'string' ? v : null);

export const actions = {
  /** Reads only: the dry run. */
  async check({ client, report, params }) {
    client.resetCaches();
    const { page, info, sheet, plan } = await readAndPlan(client, params);
    const origin = here();
    const result = { page, origin, title: info.title, approved: writesFingerprint(plan.writes, { origin, page, sections: plan.selected }), ...plan };
    report('data', 'analysis', result);

    const c = plan.counts;
    // A row of a text used in several places checks each place on its own.
    const places = plan.rows.length;
    report(
      'info',
      `${sheet.rows.length} rows checked against ${page}${places !== sheet.rows.length ? ` - ${places} places` : ''}${plan.exportedFrom ? `, exported from ${plan.exportedFrom}` : ''}.`
    );
    report(
      c.ready + c.reuse ? 'ok' : 'info',
      `${writesSaid(plan.writes)} would change (${c.ready + c.reuse} places).`
    );
    const blocked = c.changed + c.missing + c.notFound + c.invalid + c.duplicate;
    if (blocked) report('warn', `${blocked} place(s) would not be written - listed under "Needs attention".`);
    for (const w of plan.warnings) report('warn', w);
    report('info', 'Nothing has been written.');
    return result;
  },

  /**
   * Reads only: one Static Content block's three fields as they are now, for
   * Check again and Copy new Body(HTML) in its section. One GET of the node.
   */
  async staticStatus({ client, params }) {
    client.resetCaches();
    const page = pageOf(params);
    const node = String(params.node ?? '');
    if (node && !NODE_PATH.test(node)) throw abort(`Not a block of the page: ${node}`);
    const path = `${page}/jcr:content${node ? `/${node}` : ''}`;
    const { status, json } = await client.readJson(path, 0);
    if (status === 403) throw abort(`Cannot read the block at ${path} (403).`);
    if (status === 404 || !json) throw abort(`The block is not there any more: ${path}. Check the page again.`);
    if (componentName(json['sling:resourceType']) !== 'cm-g-static-content') {
      throw abort(`Not a Static Content block (it is ${json['sling:resourceType'] || 'no component'}): ${path}`);
    }
    return {
      origin: here(),
      page,
      node,
      headerInclude: text(json.headerInclude),
      bodyHtml: text(json.bodyHtml),
      footerInclude: text(json.footerInclude),
      modifiedBy: text(json['jcr:lastModifiedBy'])
    };
  },

  /**
   * Reads only: "Find English still on the page". The page is read
   * and planned again with the same sheet, and every text whose English is
   * still on it is listed (see englishLeft). The review is not drawn again:
   * the panel keeps the one it has.
   */
  async checkAll({ client, params }) {
    client.resetCaches();
    const { page, plan } = await readAndPlan(client, params);
    return { origin: here(), page, left: englishLeft(plan) };
  },

  /** Writes. Everything the dry run showed, and nothing else. */
  async apply({ client, report, params }) {
    client.resetCaches();
    const step = (id, state, note) => report('data', 'step', { id, state, note });

    /* ---- 1. the same writes as reviewed, against the page as it is now ---- */
    step('recheck', 'running');
    let fresh;
    try {
      fresh = await readAndPlan(client, params);
    } catch (e) {
      step('recheck', 'failed');
      throw e;
    }
    const { page, tree, plan } = fresh;
    if (!plan.writes.length) {
      step('recheck', 'failed');
      throw abort('Nothing on the sheet can be written to this page any more. Check again.');
    }
    if (writesFingerprint(plan.writes, { origin: here(), page, sections: plan.selected }) !== params.approved) {
      step('recheck', 'failed');
      throw abort(
        'What would be written is no longer what you reviewed - the page changed since you checked it, or this is ' +
          'another server or page. Check again, read the result, then write. Nothing has been written.'
      );
    }
    // Last guard: a block's Header (CSS) is never written, whatever is ticked.
    if (plan.writes.some((w) => w.prop === 'headerInclude')) {
      step('recheck', 'failed');
      throw abort('Refusing to write a Static Content block’s Header (CSS). Nothing has been written.');
    }
    const n = plan.writes.length;
    const said = writesSaid(plan.writes);
    step('recheck', 'done', `${n}`);

    /* ---- 2. a lock held by someone else is theirs to lift ----------------- */
    step('lock', 'running');
    const owner = tree['jcr:lockOwner'] || null;
    const me = await client.currentUser().catch(() => null);
    if (owner && owner !== me) {
      step('lock', 'failed');
      throw abort(`The page is locked by ${owner}. Ask them to unlock it, then write again. Nothing has been written.`);
    }
    step('lock', 'done', owner ? 'locked by you' : 'not locked');

    /* ---- 3. the write: the texts together, each Static Content block alone -- */
    step('write', 'running');
    const pairs = pairsFor(plan.writes);
    // The page shows as modified, so it is picked up for publishing.
    pairs.push(['./cq:lastModified@TypeHint', 'Date'], ['./cq:lastModified', new Date().toISOString()]);
    if (me) pairs.push(['./cq:lastModifiedBy', me]);
    /* Form-encoded, the way DSY's other writes go: on the Samsung authors a
     * multipart request was answered 200 OK with nothing changed. */
    const target = `${page}/jcr:content`;
    const requests = splitPairs(pairs, plan.writes);
    let sent = 0;
    try {
      for (const part of requests) {
        const answer = assertWrite(await client.writeNode(target, part), 'Writing the translations');
        // AEM's own answer, word for word, so a write that lands somewhere else, or nowhere, can be traced.
        const changed = answer.changes ? ` - ${answer.changes.length} change${answer.changes.length === 1 ? '' : 's'}` : '';
        report('info', `AEM answered HTTP ${answer.http} / status ${answer.effective} for ${answer.resultPath || '(no path)'}${answer.message ? `: ${answer.message}` : ''}${changed}`);
        /* An update of the page's jcr:content answers 200 with that path. 201 means
         * AEM made a new node, another path that it saved somewhere else. */
        if (answer.effective === 201 || (answer.resultPath && decodeURI(answer.resultPath) !== target)) {
          throw abort(
            `AEM saved the request, but not into this page: it answered status ${answer.effective} for ` +
              `${answer.resultPath || '(no path)'}, not ${target}. Send this message to the DSY developer`
          );
        }
        if (answer.changes && !answer.changes.length) {
          throw abort('AEM answered OK but changed nothing on the page. Send this message to the DSY developer');
        }
        sent++;
      }
    } catch (e) {
      step('write', 'failed');
      throw abort(
        `${e.message.replace(/\.$/, '')}. ` +
          (sent
            ? `${sent} of ${requests.length} requests were saved before this one - check the page before trying again.`
            : 'Nothing was saved - check the page before trying again.')
      );
    }
    report('ok', `wrote ${said} in ${requests.length} request${requests.length === 1 ? '' : 's'}`);
    step('write', 'done', `${n}`);

    /* ---- 4. and proof that it landed -------------------------------------- */
    step('verify', 'running');
    const after = await client.readTreeWhole(`${page}/jcr:content`);
    const wrong = plan.writes.filter((w) => JSON.stringify(nodeAt(after, w.path)?.[w.prop]) !== JSON.stringify(w.to));
    if (wrong.length) {
      step('verify', 'failed');
      const short = (v) => (v === undefined ? '(nothing)' : JSON.stringify(v).slice(0, 80));
      for (const w of wrong.slice(0, 50)) {
        report('warn', `differs  ${w.path || '(page)'} / ${w.prop}: page has ${short(nodeAt(after, w.path)?.[w.prop])}, sent ${short(w.to)}`);
      }
      throw abort(
        `AEM said the translations were saved, but ${wrong.length} propert${wrong.length === 1 ? 'y does' : 'ies do'} not hold ` +
          `them, starting with ${wrong[0].path || '(page)'} / ${wrong[0].prop}. The list is under Activity. ` +
          'Check the page.'
      );
    }
    report('ok', `checked: all ${n} properties now hold the translation`);
    step('verify', 'done');

    report('info', 'Nothing was published. Review the page, then publish it as usual.');
    if (plan.writes.some((w) => w.static)) {
      report('info', 'To undo a Static Content block, use Copy old Body(HTML) or Copy old Footer(Javascript) in its section, and paste it into the block.');
    }
    return {
      done: true,
      page,
      dest: page,
      written: n,
      title: `${n} translation${n === 1 ? '' : 's'} written`,
      editorUrl: `/editor.html${page}.html`
    };
  }
};
