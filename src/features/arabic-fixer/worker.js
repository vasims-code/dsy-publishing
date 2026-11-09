/**
 * arabic-fixer: find every field on a page whose Arabic text flips - an
 * English or numeric run laid out on the wrong side - and fix the ones ticked
 * with invisible LRM/RLM marks (see bidi.js). A decimal comma - 1,5 - is
 * turned to a dot on the way.
 *
 * What is copy on the page, and where each text lives, is decided exactly as
 * the copy deck decides it (readPageCopy): the same rules, the same dialogs,
 * the same fields added or ignored. Every row names its node and property, so
 * a fix goes back to exactly where its text came from. A PD page's copy comes
 * from PIM, not AEM, so there is nothing here to write it back to.
 *
 * The fix writes, so it is checked like every other write here: the page is
 * read again first and every property must still hold exactly what the scan
 * found and still fix to exactly what was approved, the page is written, and
 * every property is read back afterwards. No version is saved.
 */

import { abort } from '../../core/aem-client.js';
import { norm } from '../../core/paths.js';
import { typeHint, sameValue } from '../../core/rewrite.js';
import { readPageCopy } from '../copy-deck/worker.js';
import { fixValue, hasArabic, rulesFor } from './bidi.js';

/** Form bodies stay under this, well inside the authors' form-size limit (200 KB by default). */
const FORM_LIMIT = 150000;

/** A Static Content block's code fields: only the strings inside them get marks. */
const SCRIPT_PROPS = new Set(['footerInclude', 'headerInclude']);
const STATIC_CONTENT = 'cm-g-static-content';

const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);
const mixinsOf = (node) => [].concat(node?.['jcr:mixinTypes'] || []);

/** The node at a path relative to jcr:content; '' is jcr:content itself. */
function nodeAt(tree, path) {
  let node = tree;
  for (const seg of path ? path.split('/') : []) {
    node = node?.[seg];
    if (!isNode(node)) return null;
  }
  return node;
}

/**
 * Does this property still inherit from a blueprint? Writing it would break
 * that inheritance - unless it was already cancelled, for the node or for
 * this property alone.
 */
function inherits(tree, path, prop) {
  let live = mixinsOf(tree).includes('cq:LiveRelationship');
  let node = tree;
  for (const seg of path ? path.split('/') : []) {
    node = node?.[seg];
    if (!isNode(node)) return false;
    const m = mixinsOf(node);
    live = m.includes('cq:LiveSyncCancelled') ? false : live || m.includes('cq:LiveRelationship');
  }
  return live && ![].concat(node['cq:propertyInheritanceCancelled'] || []).includes(prop);
}

/** The field as the review names it: the copy deck's own label for it. */
function fieldName(row, script) {
  if (script) return row.prop === 'headerInclude' ? 'Style sheet (Header)' : 'Script (Footer)';
  if (row.category === 'static') return 'Static HTML';
  return row.field || row.prop;
}

/**
 * Every property the copy deck lists whose value the fixer would change, in
 * the copy deck's order: { key, node, prop, section, field, hidden, liveCopy, script,
 * from, to, runs, marks, removed, skipped }. A property with several rows -
 * a static block's texts, a multi-value field's values - is fixed whole, once.
 *
 * The copy deck lists only the strings of a Static Content block's script it
 * can tell are shown on the page. Its scripts are checked whole here, so a
 * string in script data or a variable is not missed.
 *
 * `rules` are the fixer's rules built from Settings (see rulesFor).
 */
export function findIssues(tree, rows, rules) {
  const first = new Map();
  for (const r of rows) {
    if (r.attr) continue;
    const key = `${r.path}|${r.prop}`;
    if (!first.has(key)) first.set(key, r);
  }
  const sectionOf = new Map(rows.map((r) => [r.path, r.section]));
  const walk = (node, rel) => {
    if (String(node['sling:resourceType'] || '').split('/').pop() === STATIC_CONTENT) {
      for (const prop of SCRIPT_PROPS) {
        const key = `${rel}|${prop}`;
        if (typeof node[prop] === 'string' && !first.has(key)) {
          first.set(key, { path: rel, prop, section: sectionOf.get(rel) || 'Static content' });
        }
      }
    }
    for (const [name, child] of Object.entries(node)) if (isNode(child)) walk(child, rel ? `${rel}/${name}` : name);
  };
  walk(tree, '');
  /* An Arabic page is laid out right to left, so a field there flips even
     with no Arabic letters of its own - "12 MP F2.2" shows as "MP F2.2 12".
     On such a page every field is checked; on any other, only those with
     Arabic letters. */
  const values = [...first.values()].map((row) => nodeAt(tree, row.path)?.[row.prop]).filter((v) => v != null && !isNode(v));
  const rtl = /^ar\b/i.test(String(tree['jcr:language'] || '')) || values.some((v) => [].concat(v).some(hasArabic));
  const issues = [];
  let arabic = 0;
  for (const [key, row] of first) {
    const raw = nodeAt(tree, row.path)?.[row.prop];
    if (raw == null || isNode(raw)) continue;
    if (!rtl || ![].concat(raw).some((v) => typeof v === 'string' && v.trim())) continue;
    arabic++;
    const script = SCRIPT_PROPS.has(row.prop);
    const fix = fixValue(raw, { script, rules, all: !script, commas: true });
    /* Only what the page shows wrong is listed: a run that flips now, a
       decimal comma, marks broken into junk. A field whose marks already
       hold every run shows right, and is left as it is - even if the fixer
       would place its marks a little differently. */
    if (!fix.changed || !(fix.flips.length || fix.commas || fix.junk)) continue;
    issues.push({
      key,
      node: row.path,
      prop: row.prop,
      section: row.section || 'Page properties',
      field: fieldName(row, script),
      hidden: !!row.inactive,
      liveCopy: inherits(tree, row.path, row.prop),
      script,
      from: raw,
      to: fix.value,
      runs: fix.flips,
      junk: fix.junk,
      marks: fix.marks,
      removed: fix.removed,
      skipped: fix.skipped,
      commas: fix.commas
    });
  }
  return { issues, arabic, fields: first.size };
}

async function readIssues({ client, settings, params }) {
  const copy = await readPageCopy({ client, settings, params });
  if (copy.pd) {
    throw abort(
      `${copy.page} is a product page (PD): its copy comes from PIM as the page renders, not from AEM, so there is nothing here to fix. ` +
        'Fix the Arabic in PIM - or paste its specifications into "Fix pasted text" › PDP and copy them back fixed.'
    );
  }
  return { copy, ...findIssues(copy.tree, copy.deck.rows, rulesFor(settings)) };
}

function assertWrite(r, what) {
  if (!r.success) {
    throw abort(`${what} failed [HTTP ${r.http} / status ${r.effective}]: ${r.message || '(no message returned)'}`);
  }
  return r;
}

const propName = (node, prop) => (node ? `./${node}/${prop}` : `./${prop}`);

/** Each property with its TypeHint, so a multi-value property stays one. */
function pairsFor(writes) {
  return writes.map((w) => {
    const name = propName(w.node, w.prop);
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

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const where = (w) => `${w.node || 'jcr:content'} › ${w.prop}`;

export const actions = {
  /** Reads only. Lists every copy field whose Arabic text the fixer would change. */
  async scan({ client, report, params, settings }) {
    client.resetCaches();
    const { copy, issues, arabic, fields } = await readIssues({ client, settings, params });
    const r = {
      page: copy.page,
      title: copy.info.title,
      language: copy.tree['jcr:language'] || null,
      issues,
      arabic,
      fields
    };
    report('data', 'analysis', r);
    report(
      'info',
      !arabic
        ? `No Arabic in the ${plural(fields, 'copy field')} on ${copy.page}. Nothing to fix.`
        : issues.length
          ? `${plural(issues.length, 'field')} of ${arabic} on this Arabic page would flip or ${issues.length === 1 ? 'has' : 'have'} a decimal comma. Nothing has been written.`
          : `All ${plural(arabic, 'field')} on this Arabic page are already fixed. Nothing to do.`
    );
    if (copy.deck.newFields.length) {
      report(
        'warn',
        `${plural(copy.deck.newFields.length, 'field')} look like text but are not on the copy deck, so they were not checked. Add them in Copy deck to include them.`
      );
    }
    return r;
  },

  /**
   * Writes. `picks` is [{ node, prop, expect, to }], one entry per property:
   * `expect` the value the scan read, `to` the fixed value approved.
   */
  async fix({ client, report, params, settings }) {
    client.resetCaches();
    const step = (id, state, note) => report('data', 'step', { id, state, note });
    const picks = Array.isArray(params.picks) ? params.picks : [];
    if (!picks.length) throw abort('Tick at least one field to fix.');

    const page = norm(params.page);
    const target = `${page}/jcr:content`;

    /* ---- 1. every property still as scanned ------------------------------ */
    step('check-first', 'running');
    /* What the panel sends is not taken on trust: every pick has to be one the
       scan itself finds on the page as it is now - same field, same value
       read, same fix. Without this the write would put any `to` it was handed
       anywhere it was told. */
    let now;
    try {
      now = await readIssues({ client, settings, params });
    } catch (e) {
      step('check-first', 'failed');
      throw e;
    }
    const found = new Map(now.issues.map((i) => [i.key, i]));
    const writes = [];
    for (const p of picks) {
      const issue = found.get(`${p?.node}|${p?.prop}`);
      if (!issue || !sameValue(issue.from, p.expect) || !sameValue(issue.to, p.to)) {
        step('check-first', 'failed');
        throw abort(
          `${where(p)} has changed since the scan - on the page, or in the units and names in Settings. ` +
            'Nothing has been written - scan the page again.'
        );
      }
      writes.push(issue);
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
        const answer = assertWrite(await client.writeNode(target, part), 'Writing the fixes');
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
    for (const w of writes) {
      const what = [];
      if (w.runs.length) what.push(w.runs.join(' · '));
      if (w.junk) what.push(plural(w.junk, 'broken mark') + ' cleaned');
      if (w.commas) what.push(`${plural(w.commas, 'comma')} to dots`);
      report('ok', `${w.section} › ${w.field}: ${what.join(' · ')}`);
    }
    step('write', 'done', plural(writes.length, 'field'));

    /* ---- 3. read back --------------------------------------------------------- */
    step('check', 'running');
    const off = [];
    for (const w of writes) {
      const live = await client.readProps(w.node ? `${target}/${w.node}` : target);
      if (!live || !sameValue(live[w.prop], w.to)) off.push(where(w));
    }
    if (off.length) {
      step('check', 'failed');
      for (const o of off) report('warn', `does not hold the fixed value: ${o}`);
      throw abort(`${plural(off.length, 'property', 'properties')} did not read back as written - check the page.`);
    }
    /* Every field written has just read back exactly as written. `remaining`
       is every field that would still flip: the ones left unticked, and any
       changed since the scan. */
    const after = await client.readTreeWhole(target);
    const remaining = after ? findIssues(after, now.copy.deck.rows, rulesFor(settings)).issues.length : 0;
    step('check', 'done', remaining ? `all ticked fields fixed, ${remaining} left as they were` : 'nothing flips');
    report('ok', `Done. ${plural(writes.length, 'field')} fixed on ${page}`);

    return {
      done: true,
      page,
      dest: page,
      fixed: writes.length,
      remaining,
      title: `${plural(writes.length, 'field')} fixed`,
      editorUrl: `/editor.html${page}.html`
    };
  }
};
