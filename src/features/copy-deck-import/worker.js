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
 *   3. the properties go in Sling POSTs, each of which AEM saves whole or not
 *      at all: the texts together, in one request unless they pass ~150 KB
 *      (then one per ~150 KB), and each Static Content field in a request of
 *      its own. So a run can stop part-way - a request refused after others
 *      were saved. Then what was saved is put back at once: the previous
 *      values (each write's `from`) are posted again, the page is read back,
 *      and the run says either that the page is as it was, or exactly which
 *      fields are still translated;
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
import { componentName, componentTypes, planImport, readSheet, writesFingerprint, writesSaid } from '../copy-deck/core.js';
import { readDialogs } from '../copy-deck/dialog.js';
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
async function readAndPlan(client, params, settings) {
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
  if (isPdPage(info, settings?.pdTemplates)) {
    throw abort(`${page} is a product page (PD). Its text comes from PIM, so translations are entered in PIM, not written to AEM.`);
  }

  const tree = await client.readTreeWhole(`${page}/jcr:content`);
  if (!tree) throw abort(`The page has no jcr:content: ${page}`);

  /* The components' own names from /apps, so the review calls a component
     what AEM's editor calls it - the same names the export writes on the
     sheet. A name that cannot be read is no reason to stop. */
  let titles = {};
  try {
    ({ titles } = await readDialogs(client, componentTypes(tree)));
  } catch {
    // Without them the resource type gives a readable name anyway.
  }

  /* How this site's titles end, off its home page - /content/samsung/levant_ar -
   * for the check on a country named wrongly. Reads only; unreadable, no check. */
  const home = page.split('/').slice(0, 4).join('/');
  const siteEnding = home !== page ? titleEnding((await readHome(client, home)).props) : null;

  return {
    page,
    info,
    tree,
    sheet,
    plan: planImport(tree, sheet, { pagePath: page, sections: Array.isArray(params.sections) ? params.sections.map(String) : null, siteEnding, titles })
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
    // Half a character is stored as U+FFFD: the plan refuses one (see unwritable), and this keeps a bug from writing it.
    if (values.some((v) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(String(v)))) {
      throw abort(`Refusing to write half a character to ${name}.`);
    }
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

/** A write's name in the Sling POST, relative to jcr:content: "./root/x/text", "./jcr:title". */
const postName = (w) => `./${w.path ? `${w.path}/` : ''}${w.prop}`;
/** A write as the operator finds it on the page: "root/x / text", "(page) / jcr:title". */
const fieldSaid = (w) => `${w.path || '(page)'} / ${w.prop}`;

/**
 * Can a write's previous value be posted back? Not a value that was not
 * there, nor an empty one: Sling would remove the property, and a write
 * here never deletes. The plan never writes over either; this is the guard.
 */
const canPutBack = (w) =>
  w.from !== undefined && w.from !== null && (Array.isArray(w.from) ? w.from.length > 0 : String(w.from).trim() !== '');

/**
 * A run stopped part-way: the requests before `failed` were saved, that one
 * and those after it were not. Their writes are put back - each property's
 * value from before the run (`from`), posted the same way, the texts
 * together and each Static Content field alone - and the page is read back
 * to see what it holds now. A request of the put-back that fails does not
 * stop the others: as much as can be is put back.
 *
 * Returns { left, confirmed, stamped }: `left` the writes whose property is
 * not as it was before the run - read off the page; or, when the page could
 * not be read back (`confirmed` false), every saved write not put back by a
 * request that succeeded. `stamped` is whether the page's last-modified date
 * or user differ from `tree`, the page as it was read before the write.
 */
async function putBack(client, { target, page, tree, writes, requests, failed, report }) {
  const saved = new Set(requests.slice(0, failed).flatMap((part) => part.map(([name]) => name.replace(/@TypeHint$/, ''))));
  const landed = writes.filter((w) => saved.has(postName(w)));
  const back = landed.filter(canPutBack).map((w) => ({ ...w, to: w.from }));
  const restored = new Set(); // the names put back by a request AEM saved
  const backRequests = back.length ? splitPairs(pairsFor(back), back) : [];
  report('info', `Putting back the previous values of ${landed.length} propert${landed.length === 1 ? 'y' : 'ies'} the saved request${failed === 1 ? '' : 's'} may have changed.`);
  for (const part of backRequests) {
    const names = new Set(part.map(([name]) => name.replace(/@TypeHint$/, '')));
    try {
      const answer = assertWrite(await client.writeNode(target, part), 'Putting back the previous values');
      if (answer.effective === 201 || (answer.resultPath && decodeURI(answer.resultPath) !== target)) {
        throw abort(`AEM answered status ${answer.effective} for ${answer.resultPath || '(no path)'}, not ${target}`);
      }
      for (const name of names) restored.add(name);
    } catch (e) {
      report('warn', `${e.message.replace(/\.$/, '')}.`);
    }
  }

  // What the page holds now is the answer - not what the requests said.
  let after = null;
  try {
    after = await client.readTreeWhole(`${page}/jcr:content`);
  } catch (e) {
    report('warn', `Could not read the page back after putting the values back: ${e.message}`);
  }
  if (!after) return { left: landed.filter((w) => !restored.has(postName(w))), confirmed: false, stamped: null };
  /* Every write is looked at, not only the saved ones: a request that failed
   * with no answer - the connection lost - may have been saved all the same.
   * A property that was not there (from null) and is not there now is as it was. */
  const left = writes.filter((w) => JSON.stringify(nodeAt(after, w.path)?.[w.prop] ?? null) !== JSON.stringify(w.from ?? null));
  // The last request stamps the page (see apply): one that may have been saved can leave the stamp moved on.
  const stamped = ['cq:lastModified', 'cq:lastModifiedBy'].some((k) => (after[k] ?? null) !== (tree?.[k] ?? null));
  return { left, confirmed: true, stamped };
}

/** Node names only - no "..", no selector, no extension: a node under the page's jcr:content and nowhere else. */
const NODE_PATH = /^[\w:-]+(\/[\w:-]+)*$/;
const text = (v) => (typeof v === 'string' ? v : null);

export const actions = {
  /** Reads only: the dry run. */
  async check({ client, settings, report, params }) {
    client.resetCaches();
    const { page, info, sheet, plan } = await readAndPlan(client, params, settings);
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
  async checkAll({ client, settings, params }) {
    client.resetCaches();
    const { page, plan } = await readAndPlan(client, params, settings);
    return { origin: here(), page, left: englishLeft(plan) };
  },

  /** Writes. Everything the dry run showed, and nothing else. */
  async apply({ client, settings, report, params }) {
    client.resetCaches();
    const step = (id, state, note) => report('data', 'step', { id, state, note });

    /* ---- 1. the same writes as reviewed, against the page as it is now ---- */
    step('recheck', 'running');
    let fresh;
    try {
      fresh = await readAndPlan(client, params, settings);
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
    /* Form-encoded, the way DSY's other writes go: on the Samsung authors a
     * multipart request was answered 200 OK with nothing changed. */
    const target = `${page}/jcr:content`;
    const requests = splitPairs(pairs, plan.writes);
    /* The page shows as modified, so it is picked up for publishing - stamped
     * by the last request, so a run that stops part-way has not stamped it:
     * the put-back cannot take a stamp off again (it never deletes, and the
     * page may have had none), so a stamp sent first said "modified" of a
     * page put back as it was. */
    requests[requests.length - 1].push(['./cq:lastModified@TypeHint', 'Date'], ['./cq:lastModified', new Date().toISOString()]);
    if (me) requests[requests.length - 1].push(['./cq:lastModifiedBy', me]);
    let sent = 0;
    // A request that got no answer - the connection lost, a page that is not Sling's - may have been saved all the same.
    let unanswered = false;
    try {
      for (const part of requests) {
        let reply;
        try {
          reply = await client.writeNode(target, part);
        } catch (e) {
          unanswered = true;
          throw e;
        }
        const answer = assertWrite(reply, 'Writing the translations');
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
      const why = `${e.message.replace(/\.$/, '')}.`;
      /* The requests that may have been saved: those AEM answered for, and
       * the one it never answered - saved or not, nobody can say, so its
       * writes are put back too. Putting back a value that never changed
       * changes nothing. */
      const maybeSaved = unanswered ? sent + 1 : sent;
      if (!maybeSaved) throw abort(`${why} Nothing was saved - check the page before trying again.`);

      /* Stopped part-way: the requests before this one were saved. Put back
       * what they wrote, so the page is not left half translated - and say
       * what it holds now, read off the page. */
      const { left, confirmed, stamped } = await putBack(client, { target, page, tree, writes: plan.writes, requests, failed: maybeSaved, report });
      const stopped = unanswered
        ? `${why} AEM gave no answer to request ${sent + 1} of ${requests.length}, so it may have been saved${sent ? `, and ${sent} before it had been` : ''}.`
        : `${why} ${sent} of ${requests.length} requests had been saved before it.`;
      if (confirmed && !left.length) {
        report('ok', 'put back: every property holds its value from before the write');
        throw abort(
          stamped
            ? `${stopped} DSY put back the previous values and read the page back: every text is as it was, but the page's last-modified date and user now show this attempt. Check again before trying again.`
            : `${stopped} DSY put back the previous values and read the page back: nothing is changed, the page is as it was. Check again before trying again.`
        );
      }
      if (!left.length) {
        throw abort(`${stopped} DSY put back the previous values, but could not read the page back to be sure they are there - check the page before trying again.`);
      }
      for (const w of left) report('warn', `still translated  ${fieldSaid(w)}`);
      const listed = left.slice(0, 10).map(fieldSaid).join('; ');
      const more = left.length > 10 ? `; and ${left.length - 10} more - the full list is under Activity` : '';
      throw abort(
        `${stopped} DSY tried to put back the previous values, but ${left.length} field${left.length === 1 ? '' : 's'} ` +
          `${confirmed ? `${left.length === 1 ? 'is' : 'are'} still translated on the page` : 'may still be translated - the page could not be read back to be sure'}: ` +
          `${listed}${more}. Put ${left.length === 1 ? 'it' : 'them'} back by hand - the review above shows each text’s Old value, and a Static Content block has Copy old Body(HTML) and Copy old Footer(Javascript) - or check again and write again.`
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
