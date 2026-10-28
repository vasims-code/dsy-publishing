/**
 * Renders the page-upsert analysis.
 *
 * Unlike a copy, what is being decided here is not a shape - it is a list of
 * edits to an existing page. So the top level is the plan in the order it will
 * actually run, and the evidence for each line sits folded underneath it.
 *
 * That same list is the progress view: each section picks up a state and a
 * running count from the step events the worker emits, so you watch the plan
 * tick through rather than reading a log beside it.
 */

import { renderSiteValues, renderSiteDone } from '../../panel/site-values.js';
import { renderTable } from '../../panel/table.js';
import { byHandBox } from '../../panel/by-hand.js';
import { renderBackupBox } from '../../panel/backup-box.js';

const SECTION_HINT = {
  version: 'A restore point, taken before anything is written.',
  page: 'AEM copyPage, shallow - child pages are not copied.',
  folders: 'Created under the destination DAM so the assets have somewhere to land.',
  assets: 'Uploaded as a person would upload them, so AEM processes each one - Dynamic Media included.',
  nodes: 'Components that exist at the source but not at the destination.',
  props: 'One request per node.',
  deletes: 'Each one is re-checked against the live source before it goes.',
  order: 'Child node order is component order.',
  strip: 'A fresh copy inherits the source page’s published state, which is misleading.'
};

/* ---------------------------------------------------------------- choices */

/**
 * The review's two tick boxes, for a page from a shared site (/global): create
 * new images or keep pointing at the source's, update links or keep them. Per
 * run - back to both ticked when the paths change - and sent with the review
 * AND the write, so the run writes what was reviewed: the worker plans again
 * with the same choice before it writes anything.
 */
let keep = { key: '', images: false, links: false, sites: [], site: false, backup: true, focus: null };
const keyOf = (p) => `${p.source}\n${p.dest}`;

/* `sites`: other sites - /uk on a /global page - unticked, so their links are left as they are.
 * Every other site the page links to is re-pointed at the destination. */
function withChoice(params) {
  if (keep.key !== keyOf(params)) keep = { key: keyOf(params), images: false, links: false, sites: [], site: false, backup: true, focus: null };
  return { ...params, keepImages: keep.images, keepLinks: keep.links, keepSites: [...keep.sites], keepSiteValues: keep.site, backupFirst: keep.backup };
}

export function analyze(ctx) {
  return ctx.send(ctx.meta.flow.analyze.action, withChoice(ctx.params));
}

export function commit(ctx) {
  return ctx.send(ctx.meta.flow.commit.action, withChoice(ctx.params));
}

/** A box changed: the plan changes with it - which images are uploaded, what is written - so review again. */
function choose(kind, value) {
  keep[kind] = value;
  keep.focus = kind;
  document.dispatchEvent(new CustomEvent('aemt:reanalyze'));
}

function chooseSite(site, repoint) {
  keep.sites = repoint ? keep.sites.filter((s) => s !== site) : [...new Set([...keep.sites, site])];
  keep.focus = `site:${site}`;
  document.dispatchEvent(new CustomEvent('aemt:reanalyze'));
}

export function renderResult(root, data, { el }) {
  if (!data?.sections) return;

  const wrap = el('div', 'analysis');
  wrap.append(header(el, data));

  if (data.blockers?.length) wrap.append(blockers(el, data));
  // Not a blocker: the run waits for the tick box beside the button.
  if (data.largeRemoval) {
    wrap.append(
      notice(el, 'warn', `${data.largeRemoval} Check "Components removed" below - it runs only once you confirm the removal.`)
    );
  }
  if (data.truncationRisk) {
    wrap.append(
      notice(el, 'warn', 'The source page may have been truncated by AEM, so removals are off for this run.')
    );
  }

  // Its own box, above the plan: the backup is the first thing the run does.
  renderBackupBox(wrap, data, { el, checked: keep.backup, onChange: (ticked) => (keep.backup = ticked) });
  wrap.append(plan(el, data));
  if (data.imagesByHand?.length) wrap.append(missingBox(el, data.imagesByHand, false));
  wrap.append(details(el, data));
  root.append(wrap);

  // Reviewed again after a box changed: back to that box, not the top of the page.
  const at = keep.focus && wrap.querySelector(`[data-choice="${keep.focus}"]`);
  keep.focus = null;
  if (at) requestAnimationFrame(() => at.scrollIntoView({ block: 'center' }));
}

/* ---------------------------------------------------------------- header */

function header(el, data) {
  const bar = el('div', 'summary');

  const counts = el('div', 'summary-counts');
  const mode = el('span', 'stat');
  mode.dataset.kind = data.mode === 'create' ? 'copy' : 'create';
  mode.append(el('b', null, data.mode === 'create' ? 'Create' : 'Update'));
  mode.append(el('span', null, data.mode === 'create' ? ' — not there yet' : ' — already there'));
  counts.append(mode);

  if (data.rewrite.enabled) {
    counts.append(stat(el, `/${data.rewrite.srcSite} → /${data.rewrite.destSite}`, 'rewrite', 'copy'));
  } else {
    counts.append(stat(el, 'same site', 'no rewrite', 'skip'));
  }
  if (data.counts.properties) counts.append(stat(el, data.counts.properties, 'properties', 'create'));
  if (data.counts.assetsToCopy) counts.append(stat(el, data.counts.assetsToCopy, 'assets', 'create'));
  if (data.counts.nodesDeleted) counts.append(stat(el, data.counts.nodesDeleted, 'removed', 'warn'));
  bar.append(counts);

  const from = el('div', 'summary-from');
  from.append(el('span', 'summary-label', 'from'));
  from.append(el('span', 'summary-path', data.source));
  bar.append(from);

  return bar;
}

function stat(el, n, label, kind) {
  const s = el('span', 'stat');
  s.dataset.kind = kind;
  s.append(el('b', null, String(n)));
  s.append(el('span', null, ' ' + label));
  return s;
}

function notice(el, tone, text) {
  const n = el('p', 'notice', text);
  n.dataset.tone = tone;
  return n;
}

function blockers(el, data) {
  const box = el('div', 'blockers');
  box.append(el('p', 'blockers-title', 'This cannot run:'));
  const list = el('ul', 'blockers-list');
  for (const b of data.blockers) list.append(el('li', null, b));
  box.append(list);
  return box;
}

/* ------------------------------------------------------------------ plan */

function plan(el, data) {
  const list = el('ol', 'plan');

  if (!data.sections.length) {
    list.append(el('li', 'plan-empty', 'Nothing to do — the destination already matches the source.'));
    return list;
  }

  for (const s of data.sections) {
    const li = el('li', 'plan-step');
    li.dataset.step = s.id;
    li.dataset.state = 'pending';

    const main = el('div', 'plan-main');
    main.append(el('span', 'plan-count', String(s.count)));
    main.append(el('span', 'plan-title', s.title));
    if (s.detail) main.append(el('span', 'plan-detail', s.detail));
    main.append(el('span', 'plan-state'));
    li.append(main);

    if (SECTION_HINT[s.id]) li.append(el('div', 'plan-hint', SECTION_HINT[s.id]));
    list.append(li);
  }
  return list;
}

/* --------------------------------------------------------------- details */

function details(el, data) {
  const box = el('div', 'detail-groups');

  /* The image paths and links a run re-points are many and alike; the text and
   * settings between them are what someone reads for sense. Each gets its own table. */
  const updated = (kind) => data.props.updated.filter((c) => (c.kind || 'other') === kind);
  const cols = ['node', 'prop', 'from', 'to'];
  /* The handle, title ending and language: their own box, at the top, with its tick box. */
  renderSiteValues(box, data, { el, onChange: (ticked) => choose('site', !ticked) });
  const imagesNote = 'Properties that point at an image or another DAM asset. Each asset’s copy is listed under Assets.';
  const linksNote = 'Properties that are a link, and text whose only change is where its links point.';
  table(el, box, 'Properties updated', updated('other'), cols);
  /* From a shared site (/global), each gets a tick box - when the page has any. */
  const c = data.choice || {};
  const src = `/${data.rewrite.srcSite}`;
  const dest = `/${data.rewrite.destSite}`;
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  if (c.offered && c.images) {
    choiceTable(el, box, {
      title: 'Image paths updated',
      rows: updated('image'),
      cols,
      note: imagesNote,
      kind: 'images',
      label: `Create new images in ${dest} and point these paths at them`,
      on: !c.keepImages,
      kept: `Kept as they are: ${n(c.images, 'image path still points', 'image paths still point')} at the images in ${src}. No images are uploaded.`
    });
  } else {
    table(el, box, 'Image paths updated', updated('image'), cols, imagesNote);
  }
  if (c.offered && c.links) {
    choiceTable(el, box, {
      title: 'Links updated',
      rows: updated('link'),
      cols,
      note: linksNote,
      kind: 'links',
      label: `Update links to point at ${dest}`,
      on: !c.keepLinks,
      kept: `Kept as they are: ${n(c.links, 'link still points', 'links still point')} at ${src}.`
    });
  } else {
    table(el, box, 'Links updated', updated('link'), cols, linksNote);
  }
  /* Links to a third site - /uk on a /global page - found on the page, one table and one box per site. */
  for (const o of data.otherSites || []) {
    const count = n(o.properties, 'property links', 'properties link');
    choiceTable(el, box, {
      title: `Links to /${o.site}`,
      rows: o.links,
      cols: ['link', 'uses'],
      note: o.repointed
        ? `${count} to /${o.site}, neither the source nor the destination site. They will point at ${dest}; any that change are listed under Links updated. Untick to leave them as they are.`
        : `Left as they are: ${count} to /${o.site}.`,
      kind: `site:${o.site}`,
      label: `Update these links to point at ${dest}`,
      on: o.repointed,
      onChange: (checked) => chooseSite(o.site, checked)
    });
  }
  table(el, box, 'Properties added', data.props.added.filter((c) => c.kind !== 'site'), ['node', 'prop', 'to']);
  table(el, box, 'Properties removed', data.props.deleted, ['node', 'prop', 'was', 'reason']);
  table(el, box, 'Components added', data.nodes.added, ['node', 'props']);
  table(el, box, 'Components removed', data.nodes.deleted, ['node']);
  table(el, box, 'Components reordered', data.reorders, ['node', 'index']);
  // Where each image lands, beside where it comes from. An image that is not
  // going anywhere - missing or unreadable at the source - says so in "to", so
  // it cannot be read as a copy that will happen. One deleted from the source
  // DAM but still served by Dynamic Media is uploaded from there: its origin says so.
  table(
    el,
    box,
    'Assets',
    (data.assets || []).map((a) => ({
      action: a.action,
      origin: a.source || (a.state === 'missing' ? '—' : 'DAM'),
      from: a.src,
      to: a.state === 'ok' ? a.dest : a.state === 'missing' ? `${a.dest} — not uploaded` : '— not uploaded'
    })),
    ['action', 'origin', 'from', 'to']
  );
  table(el, box, 'DAM folders', data.folders.filter((f) => !f.exists), ['path']);

  table(
    el,
    box,
    `Still pointing at /${data.rewrite.srcSite}`,
    data.leftovers,
    ['link', 'count'],
    'Not a failure by itself — these are prefixes the rules leave alone on purpose, ' +
      'plus any host that is not configured. Worth a look before publishing.'
  );
  table(
    el,
    box,
    'Component type differs',
    data.typeWarnings,
    ['node', 'source', 'destination'],
    'Not changed. A component whose type differs is a different component.'
  );
  table(el, box, 'Order not checked', data.reorderSkips, ['node', 'reason']);

  return box;
}

/* Colour for the heading of each table, by what its rows do to the page. */
const TONE = {
  'Properties updated': 'change',
  'Image paths updated': 'change',
  'Links updated': 'change',
  'Properties added': 'add',
  'Properties removed': 'remove',
  'Components added': 'add',
  'Components removed': 'remove',
  'Components reordered': 'change',
  'Links re-pointed': 'change',
  'Component type differs': 'remove'
};

function table(el, parent, title, rows, cols, note) {
  // Widths, drag-to-resize and the sideways scroll live in the shared renderer,
  // so every analysis table behaves the same way.
  renderTable(parent, { title, rows, cols, note, tone: TONE[title] }, el);
}

/**
 * A table with its tick box. Drawn even when the table is empty - unticked, its
 * rows are gone, and the box is the way back - and open, since the choice is
 * made here.
 */
function choiceTable(el, parent, { title, rows, cols, note, kind, label, on, kept, onChange }) {
  const holder = el('div');
  renderTable(holder, { title, rows, cols, note, tone: TONE[title] }, el);
  let d = holder.firstChild;
  if (!d) {
    d = el('details', 'detail');
    d.dataset.tone = 'info';
    const sum = el('summary');
    sum.append(el('span', 'detail-mark', '•'), el('span', 'detail-title', title), el('span', 'detail-count', '0'));
    d.append(sum);
  }
  d.open = true;
  d.dataset.choice = kind;

  const box = el('label', 'check detail-choice');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = on;
  input.addEventListener('change', () => {
    input.disabled = true; // until the page is reviewed again with it
    if (onChange) onChange(input.checked);
    else choose(kind, !input.checked);
  });
  box.append(input, el('span', null, label));
  d.querySelector('summary').after(box);
  if (!on && kept) box.after(el('p', 'detail-note detail-kept', kept));
  parent.append(d);
}

/* ------------------------------------------------------------------ done */

/** The site values that went in - or that were left - under the outcome, and the images missing at the source. */
export function renderDone(root, outcome, { el }) {
  renderSiteDone(root, outcome, { el });
  if (outcome?.imagesByHand?.length) root.append(missingBox(el, outcome.imagesByHand, true));
}

/* Nothing is carried for these, so the heading says what they are rather than "to do by hand". */
function missingBox(el, list, done) {
  const n = list.length;
  return byHandBox(el, list, { done, title: `${n} image${n === 1 ? '' : 's'} not in the source DAM` });
}

/* --------------------------------------------------------------- progress */

/** Called for each step event while the run is in progress. */
export function updateStep(root, { id, state, note }) {
  const li = root.querySelector(`.plan-step[data-step="${cssEscape(id)}"]`);
  if (!li) return;
  li.dataset.state = state;

  const cell = li.querySelector('.plan-state');
  if (cell) {
    cell.textContent =
      state === 'done' ? (note ? `\u2713 ${note}` : '\u2713') : state === 'failed' ? '\u2717' : note || '';
  }
  if (state === 'running') li.scrollIntoView({ block: 'nearest' });
}

function cssEscape(v) {
  return window.CSS?.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
}
