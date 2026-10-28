/**
 * page-transfer, panel side.
 *
 * Two jobs. It drives the flow, because this is the one feature that has to
 * talk to two tabs in turn - reading on the source instance, writing on this
 * one, and carrying the page and each image between them. And it renders the
 * analysis, where the part that matters most is the component pairing: on two
 * pages authored separately, which component here corresponds to which
 * component there is an inference, and it is shown so it can be rejected.
 */

import { metadataConfirmed, metadataRefusal, removalsConfirmed } from '../../core/protocol.js';
import { renderBackupBox } from '../../panel/backup-box.js';
import { renderSiteValues, renderSiteDone } from '../../panel/site-values.js';
import { renderTable } from '../../panel/table.js';
import { byHandBox } from '../../panel/by-hand.js';

/* ===================================================================== */
/*  Flow                                                                 */
/* ===================================================================== */

/**
 * Both instances are named explicitly.
 *
 * The destination defaults to the tab the panel is attached to, but it is a
 * field rather than an assumption. While it was implicit, running the panel
 * from the source server produced "the destination parent does not exist here"
 * \u2014 true, and useless, because nothing on screen said where "here" was.
 */
async function endpoints(ctx) {
  const from = ctx.params.sourceOrigin;
  const to = ctx.params.destOrigin;

  if (!from) throw new Error('Pick the source instance.');
  if (!to) throw new Error('Pick the destination instance.');
  if (from === to) {
    throw new Error(
      `Source and destination are both ${from}. For a transfer within one server, use "Sync page".`
    );
  }
  return { from, to, srcTab: await ctx.tabFor(from), dstTab: await ctx.tabFor(to) };
}

/**
 * The review's "site values" box, unticked: per run - back to ticked when the
 * instances or paths change - and sent with the review AND the transfer, so
 * the run writes what was reviewed.
 */
let keep = { key: '', site: false, backup: true, focus: false };
const keyOf = (p) => [p.sourceOrigin, p.source, p.destOrigin, p.dest].join('\n');

function withChoice(params) {
  if (keep.key !== keyOf(params)) keep = { key: keyOf(params), site: false, backup: true, focus: false };
  return { ...params, keepSiteValues: keep.site, backupFirst: keep.backup };
}

/** The box changed: what is written changes with it, so review again - back at the box. */
function chooseSite(ticked) {
  keep.site = !ticked;
  keep.focus = true;
  document.dispatchEvent(new CustomEvent('aemt:reanalyze'));
}

/** What the source tab reads: the page, and its site's home page for the site values. */
const readParams = (params) => ({ source: params.source, srcSite: params.srcSite });

/** Read the source page, then hand it to the destination to plan against. */
export async function analyze(ctx) {
  const { from, to, srcTab, dstTab } = await endpoints(ctx);
  const params = withChoice(ctx.params);

  ctx.log('info', `Reading ${params.source} from ${from}\u2026`);
  const read = await ctx.send('readPage', readParams(params), srcTab);
  if (!read?.ok) return read;

  ctx.log('info', `Planning against ${to}\u2026`);
  return ctx.send('analyze', { ...params, sourcePage: read.result }, dstTab);
}

/**
 * The transfer. The source page is read again rather than reusing what the
 * analysis held: between reviewing and confirming, someone on the other
 * instance may have changed it.
 */
export async function commit(ctx) {
  const { srcTab, dstTab } = await endpoints(ctx);
  const params = withChoice(ctx.params);

  const read = await ctx.send('readPage', readParams(params), srcTab);
  if (!read?.ok) return read;
  const sourcePage = read.result;

  // Re-plan against what is actually here now, and honour any blocker.
  const planned = await ctx.send('analyze', { ...params, sourcePage }, dstTab);
  if (!planned?.ok) return planned;
  const plan = planned.result;
  if (plan.blockers?.length) {
    return { ok: false, error: `Refusing to write. ${plan.blockers[0]}`, aborted: true };
  }
  // Checked here, before any folder or image is written, not only by the page write at the end.
  if (plan.largeRemoval && !removalsConfirmed(plan, ctx.params)) {
    return { ok: false, error: `Refusing to write. ${plan.largeRemoval} Analyze again and confirm the removal to go ahead.` };
  }
  // The same for an existing page's own properties: checked before anything at all is written.
  if (!metadataConfirmed(plan, params)) return { ok: false, error: metadataRefusal(plan) };

  const prepared = await ctx.send(
    'prepare',
    { ...ctx.params, sourcePage, folders: plan.folders, backupFirst: keep.backup },
    dstTab
  );
  if (!prepared?.ok) return prepared;

  /* Images, one at a time, and each one piece by piece. Whatever goes wrong
   * with one - unreadable, too large, an upload that fails or never answers -
   * it is skipped and the run moves on; the page still goes across, pointing
   * where each image belongs, and the done screen lists what to do by hand. */
  const uploads = plan.uploads || [];
  const byHand = [...(plan.imagesByHand || [])];
  let carried = 0;
  for (let i = 0; i < uploads.length; i++) {
    const u = uploads[i];
    const why = await carry(ctx, u, i + 1, uploads.length, srcTab, dstTab);
    if (why) {
      // One meant to come from Dynamic Media keeps its links: they are where to get it by hand.
      byHand.push(u.via
        ? { kind: 'delivered', from: u.from, to: u.to, reason: why, urls: u.urls || [] }
        : { kind: 'upload', from: u.from, to: u.to, reason: why });
      ctx.log('warn', `Skipped ${u.from} — ${why}`);
    } else {
      carried++;
    }
  }
  if (uploads.length) {
    const skipped = uploads.length - carried;
    ctx.step?.('assets', 'done', skipped ? `${carried}/${uploads.length} · ${skipped} skipped` : String(carried));
  }

  const res = await ctx.send('apply', { ...params, sourcePage, pageCreated: prepared.result?.created === true }, dstTab);
  if (res?.ok) res.result = { ...res.result, imagesByHand: byHand };
  return res;
}

/**
 * One image across, piece by piece: each piece is read on the source and
 * handed over before the next is fetched, so no message carries more than a
 * piece and an image of any size goes the same way. Null once it is uploaded;
 * otherwise why it was not.
 */
async function carry(ctx, u, index, total, srcTab, dstTab) {
  try {
    for (let offset = 0, done = false; !done; ) {
      const piece = await ctx.send('readAsset', { path: u.from, url: u.via || null, offset }, srcTab);
      if (!piece?.ok) return piece?.error || 'the source tab did not answer';
      const r = piece.result;
      if (r.skipped) return r.skipped;

      const wrote = await ctx.send(
        'writeAsset',
        { to: u.to, base64: r.base64, mime: r.mime, offset, done: r.done, size: r.size, index, total },
        dstTab
      );
      if (!wrote?.ok) return wrote?.error || 'this tab did not answer';
      if (wrote.result?.skipped) return wrote.result.skipped;
      offset += r.length;
      done = r.done;
    }
    return null;
  } catch (e) {
    // A tab closed or reloaded mid-image. The next image, or the page write,
    // will say whether it is gone for good.
    return e.message;
  }
}

/* ===================================================================== */
/*  Rendering                                                            */
/* ===================================================================== */

const SECTION_HINT = {
  version: 'A restore point on this instance, before anything is written.',
  page: 'createPage from the source template — copyPage cannot reach another server.',
  folders: 'Created here so the uploaded images have somewhere to land.',
  assets: 'Read on the source instance, uploaded here. Renditions regenerate afterwards.',
  nodes: 'Components the source has and this page does not.',
  props: 'One request per node.',
  deletes: 'Components with no counterpart at the source.',
  order: 'Child node order is component order.'
};

export function renderResult(root, data, { el }) {
  if (!data?.sections) return;

  const wrap = el('div', 'analysis');
  wrap.append(header(el, data));
  if (data.blockers?.length) wrap.append(blockers(el, data));
  // Not a blocker: the run waits for the tick box beside the button.
  if (data.largeRemoval) {
    const n = el('p', 'notice', `${data.largeRemoval} The transfer runs only once you confirm the removal.`);
    n.dataset.tone = 'warn';
    wrap.append(n);
  }

  // Above the plan on purpose: if the pairing is wrong, nothing below it means
  // anything, so it is not something to find by scrolling.
  if (data.pairing?.renamed) wrap.append(pairing(el, data));

  wrap.append(plan(el, data));
  if (data.imagesByHand?.length) wrap.append(byHandBox(el, data.imagesByHand, { done: false, tail: TAIL }));
  wrap.append(details(el, data));
  root.append(wrap);

  // Reviewed again after the box changed: back to the box, not the top of the page.
  const at = keep.focus && wrap.querySelector('[data-choice="site"]');
  keep.focus = false;
  if (at) requestAnimationFrame(() => at.scrollIntoView({ block: 'center' }));
}

function header(el, data) {
  const bar = el('div', 'summary');
  const counts = el('div', 'summary-counts');

  const mode = el('span', 'stat');
  mode.dataset.kind = data.mode === 'create' ? 'copy' : 'create';
  mode.append(el('b', null, data.mode === 'create' ? 'Create' : 'Update'));
  mode.append(el('span', null, data.mode === 'create' ? ' — not here yet' : ' — already here'));
  counts.append(mode);

  if (data.rewrite.enabled) {
    counts.append(stat(el, `/${data.rewrite.srcSite} → /${data.rewrite.destSite}`, 'rewrite', 'copy'));
  }
  if (data.counts.properties) counts.append(stat(el, data.counts.properties, 'properties', 'create'));
  // Shown even at zero: on a cross-site transfer, no links to re-point and no
  // images to move are both things you want to notice, not things to infer
  // from an absent row.
  if (data.rewrite.enabled) {
    counts.append(stat(el, data.counts.siteRefs, `→ /${data.rewrite.destSite}`,
      data.counts.siteRefs ? 'copy' : 'warn'));
  }
  counts.append(stat(el, data.counts.uploads, 'images', data.counts.uploads ? 'create' : 'skip'));
  if (data.counts.shared) {
    counts.append(stat(el, data.counts.shared, 'outside this site', 'skip'));
  }
  if (data.counts.byHand) counts.append(stat(el, data.counts.byHand, 'images to do by hand', 'warn'));
  if (data.counts.nodesDeleted) counts.append(stat(el, data.counts.nodesDeleted, 'removed', 'warn'));
  if (data.counts.preserved) counts.append(stat(el, data.counts.preserved, 'kept', 'skip'));
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

function blockers(el, data) {
  const box = el('div', 'blockers');
  box.append(el('p', 'blockers-title', 'This cannot run:'));
  const list = el('ul', 'blockers-list');
  for (const b of data.blockers) list.append(el('li', null, b));
  box.append(list);
  return box;
}

/**
 * The component pairing, shown whenever any of it was inferred rather than
 * read off matching node names.
 */
function pairing(el, data) {
  const box = el('div', 'pairing');
  box.append(el('p', 'pairing-title', 'Component pairing — please check'));
  box.append(
    el(
      'p',
      'pairing-note',
      `${data.pairing.renamed} of ${data.pairing.pairs.length} components here have a different node ` +
        'name from their counterpart at the source, so they were matched by position and type. ' +
        'Each row below will be overwritten by the source component named on its left. Rows ' +
        'marked ‼ share a type with another component, so only their order separates them — ' +
        'if this page was re-ordered here, check those especially.'
    )
  );

  const t = el('table', 'detail-table');
  const head = el('tr');
  for (const c of ['component', 'source node', 'this page']) head.append(el('th', null, c));
  t.append(head);

  for (const p of data.pairing.pairs) {
    const tr = el('tr');
    if (p.renamed) tr.dataset.renamed = 'true';
    if (p.ambiguous) tr.dataset.ambiguous = 'true';
    const kind = el('td', null, (p.ambiguous ? '‼ ' : '') + (p.kind || ''));
    kind.title = p.kind || '';
    const src = el('td', null, p.source);
    src.title = p.source;
    const dst = el('td', null, p.destination);
    dst.title = p.destination;
    tr.append(kind, src, dst);
    t.append(tr);
  }
  const scroll = el('div', 'detail-scroll');
  scroll.append(t);
  box.append(scroll);

  if (data.pairing.addedAtSource?.length) {
    box.append(
      el(
        'p',
        'pairing-note',
        `${data.pairing.addedAtSource.length} component(s) at the source have no counterpart here ` +
          'and will be added.'
      )
    );
  }
  if (data.pairing.missingAtSource?.length) {
    box.append(
      el(
        'p',
        'pairing-note',
        `${data.pairing.missingAtSource.length} component(s) here have no counterpart at the source.`
      )
    );
  }
  return box;
}

function plan(el, data) {
  const list = el('ol', 'plan');
  if (!data.sections.length) {
    list.append(el('li', 'plan-empty', 'Nothing to do — this page already matches the source.'));
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

function details(el, data) {
  const box = el('div', 'detail-groups');

  // The backup of the page here comes first: it is the first thing the transfer does.
  renderBackupBox(box, data, { el, checked: keep.backup, onChange: (ticked) => (keep.backup = ticked) });
  /* The handle, title ending and language: their own box, at the top, with its tick box. */
  renderSiteValues(box, data, { el, onChange: chooseSite });

  table(el, box, 'Metadata kept as it is', data.preserved, ['node', 'prop', 'kept', 'sourceHas'],
    'Not derivable from the source — a locale has its own titles and descriptions. An existing value ' +
    'here is never overwritten; a page being created gets the source value as a starting point. ' +
    'The Twitter handles are kept only when this site’s home page does not name its own.');

  /* The image paths and links a run re-points are many and alike; the text and
   * settings between them are what someone reads for sense. Each gets its own table. */
  const updated = (kind) => data.props.updated.filter((c) => (c.kind || 'other') === kind);
  const cols = ['node', 'prop', 'from', 'to'];
  table(el, box, 'Properties updated', updated('other'), cols);
  table(el, box, 'Image paths updated', updated('image'), cols,
    'Properties that point at an image or another DAM asset. Each image’s upload is listed under Images.');
  table(el, box, 'Links updated', updated('link'), cols,
    'Properties that are a link, and text whose only change is where its links point.');
  table(el, box, 'Properties added', data.props.added.filter((c) => c.kind !== 'site'), ['node', 'prop', 'to']);
  table(el, box, 'Properties removed', data.props.deleted, ['node', 'prop', 'was', 'reason']);
  table(el, box, 'Components added', data.nodes.added, ['node', 'props']);
  table(el, box, 'Components removed', data.nodes.deleted, ['node']);
  table(el, box, 'Components reordered', data.reorders, ['node', 'index']);
  table(el, box, 'Links re-pointed', data.links, ['from', 'to', 'uses', 'on'],
    'Each distinct reference the run will change, and the components it appears on. ' +
    'Image paths are not here — they are in the table below, next to the upload.');

  table(el, box, 'Images', data.assets.map((a) => ({ ...a, origin: a.source || 'DAM' })),
    ['action', 'origin', 'size', 'scope', 'uses', 'from', 'to'],
    'Every image the page references, wherever it lives. One under this site’s own DAM ' +
    'folder moves with the site token; one outside it keeps its path, because the reference ' +
    'to it is not rewritten either. The other instance is a different repository, so both ' +
    'kinds have to be carried across. One marked “too large” is not carried, but the page ' +
    'still points at the path on the right — move it there with a content package. One with ' +
    'Dynamic Media as its origin was deleted from the source DAM, and is carried from the copy ' +
    'Dynamic Media still serves.');
  table(el, box, 'DAM folders to create', data.folders.filter((f) => !f.exists), ['path']);

  table(el, box, `Still pointing at /${data.rewrite.srcSite}`, data.leftovers, ['link', 'count'],
    'Prefixes the rules leave alone on purpose, plus any host that is not configured.');
  table(el, box, 'Component type differs', data.typeWarnings, ['node', 'source', 'destination'],
    'Not changed. A component whose type differs is a different component.');
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

/* ------------------------------------------------------------------ done */

/* Before the run, under the list. */
const TAIL = 'Any image that fails during the run is added to this list when it finishes.';

/** The images the run did not carry, under the outcome - with any it gave up on during the run. */
export function renderDone(root, outcome, { el }) {
  renderSiteDone(root, outcome, { el });
  const list = outcome?.imagesByHand || [];
  if (list.length) root.append(byHandBox(el, list, { done: true }));
}

/* --------------------------------------------------------------- progress */

export function updateStep(root, { id, state, note }) {
  const li = root.querySelector(`.plan-step[data-step="${cssEscape(id)}"]`);
  if (!li) return;
  li.dataset.state = state;

  const cell = li.querySelector('.plan-state');
  if (cell) {
    cell.textContent =
      state === 'done' ? (note ? `\u2713 ${note}` : '\u2713')
        : state === 'failed' ? '\u2717'
          : note || '';
  }
  if (state === 'running') li.scrollIntoView({ block: 'nearest' });
}

function cssEscape(v) {
  return window.CSS?.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
}
