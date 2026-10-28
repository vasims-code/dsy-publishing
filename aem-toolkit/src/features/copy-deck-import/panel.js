/**
 * copy-deck-import, panel side.
 *
 * Two jobs. On the form, the paste area: Excel's clipboard (or a file, where
 * the company DRM does not encrypt it) becomes rows of cells, which go to the
 * worker in the field's hidden input. On review, the dry run, one section of
 * the sheet per fold in page order - like the copy deck's own screen: each
 * text as it is on the page now and as it would be, and why anything is not
 * written. A tick per section says what the Write writes; ticking changes
 * only the counts and the button here, nothing is asked of the page. Then the
 * steps of the write, which double as its progress view.
 */

const STEPS = (writes) => [
  ['recheck', 'Check the page again', 'The writes must still be exactly the ones ticked above, or nothing happens.'],
  ['lock', 'Check the page lock', 'A lock held by someone else stops the run.'],
  ['write', `Write ${writesSaid(writes)}`, 'The texts in one request, each Static Content field in its own. Nothing is deleted.'],
  ['verify', 'Read the page back', 'Every property is compared with what was sent.']
];

import { icon } from '../../panel/icons.js';
import { renderTable } from '../../panel/table.js';
import { IMPORT_STATUS, gridFromText, isDrmProtected, readSheet, writesFingerprint, writesSaid } from '../copy-deck/core.js';
import { readXlsx } from '../copy-deck/xlsx.js';
import { renderPasteByHand } from './paste-by-hand.js';

/* ------------------------------------------------------------ the field */

/**
 * One box for the sheet. Empty, it is the paste area with "Choose a file
 * instead" in it; once a sheet is in, the same box says what was read - with
 * a tick, or a warning - and holds Choose another file and Clear. A paste into
 * the box at any time replaces the sheet.
 */
export function renderField(host, _field, { el, input, changed }) {
  const box = el('div', 'sheet-box');
  box.dataset.state = 'empty';
  box.tabIndex = -1;

  const zone = el('textarea', 'sheet-paste');
  zone.rows = 3;
  zone.spellcheck = false;
  zone.placeholder = 'Click here and press Ctrl+V - after Ctrl+A, Ctrl+C on the translated sheet in Excel.';

  // What was read: a mark, a line saying where the sheet came from, and its counts.
  const loaded = el('div', 'sheet-loaded');
  loaded.hidden = true;
  const mark = el('span', 'sheet-mark');
  const said = el('div', 'sheet-said');
  const title = el('div', 'sheet-title');
  const status = el('div', 'sheet-status');
  said.append(title, status);
  loaded.append(mark, said);

  const actions = el('div', 'sheet-actions');
  const pick = el('button', 'link-btn', 'Choose a file instead');
  pick.type = 'button';
  const clear = el('button', 'link-btn', 'Clear');
  clear.type = 'button';
  clear.hidden = true;
  const file = el('input');
  file.type = 'file';
  file.accept = '.xlsx,.csv,.tsv,.txt';
  file.hidden = true;
  actions.append(pick, clear, file);
  box.append(zone, loaded, actions);

  // What was pasted, row by row - to read it through before anything is checked against the page.
  const preview = el('details', 'detail sheet-preview');
  preview.hidden = true;

  const show = (tone, head, text) => {
    box.dataset.state = tone;
    zone.hidden = true;
    loaded.hidden = false;
    mark.textContent = '';
    mark.append(icon(tone === 'ok' ? 'check' : 'alert', 16));
    title.textContent = head;
    status.textContent = text;
    pick.textContent = 'Choose another file';
    clear.hidden = false;
  };

  const take = (grid, from) => {
    const sheet = readSheet(grid);
    if (!sheet.ok) {
      input.value = '';
      show('warn', `This is not the translated sheet (${from})`, sheet.problem);
      preview.hidden = true;
    } else {
      fillPreview(el, preview, sheet.rows);
      input.value = JSON.stringify(grid);
      const translated = sheet.rows.filter((r) => r.translation.trim()).length;
      const parts = [`${sheet.rows.length} rows`, `${translated} with a translation`];
      parts.push(sheet.meta?.pagePath ? `exported from ${sheet.meta.pagePath}` : 'no #END row - it may be incomplete');
      show(sheet.meta ? 'ok' : 'warn', `Sheet ${from}`, parts.join(' · '));
    }
    changed();
  };

  box.addEventListener('paste', (e) => {
    e.preventDefault();
    take(gridFromText(e.clipboardData.getData('text/plain')), 'pasted');
  });
  // Dropped text arrives as input; typing is not a way in, so the box stays empty.
  zone.addEventListener('input', () => {
    const text = zone.value;
    zone.value = '';
    if (text.includes('\t')) take(gridFromText(text), 'dropped');
  });

  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      take(await gridFromFile(f), `from ${f.name}`);
    } catch (e) {
      input.value = '';
      show('warn', `${f.name} could not be read`, e.message);
      preview.hidden = true;
      changed();
    }
  });
  clear.addEventListener('click', () => {
    input.value = '';
    box.dataset.state = 'empty';
    zone.hidden = false;
    loaded.hidden = true;
    preview.hidden = true;
    pick.textContent = 'Choose a file instead';
    clear.hidden = true;
    changed();
    zone.focus?.();
  });

  host.append(box, preview);
}

/** Each row of the sheet as pasted: its Excel row, section, source text and translation. */
function fillPreview(el, preview, rows) {
  preview.textContent = '';
  preview.hidden = !rows.length;
  preview.open = true;
  const missing = rows.filter((r) => !r.translation.trim()).length;
  const sum = el('summary');
  sum.append(el('span', 'detail-title', 'Source and translation'), el('span', 'detail-count', String(rows.length)));
  if (missing) sum.append(el('span', 'sheet-preview-missing', `${missing} without a translation`));
  const list = el('ol', 'import-rows sheet-preview-rows');
  for (const r of rows) {
    const li = el('li', 'import-row');
    li.title = r.keys.join('\n');
    const head = el('div', 'import-row-head');
    head.append(el('span', 'deck-rownum', String(r.sheetRow)), el('span', 'deck-field', r.section));
    li.append(head);
    const lines = [
      ['Source', r.source],
      r.translation.trim() ? ['Translation', r.translation, 'new'] : ['Translation', 'Not translated', 'reason']
    ];
    for (const [label, text, kind] of lines) {
      const line = el('div', 'import-line');
      if (kind) line.dataset.kind = kind;
      line.append(el('span', 'import-label', label), el('span', 'import-text', text));
      li.append(line);
    }
    list.append(li);
  }
  preview.append(sum, list);
}

async function gridFromFile(f) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (isDrmProtected(bytes)) {
    throw new Error(
      'This file is encrypted by the company DRM, so it cannot be read here. Open it in Excel, press Ctrl+A then Ctrl+C, and paste it above instead.'
    );
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  // Excel's "Unicode Text" is UTF-16; everything else is read as UTF-8.
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
  return gridFromText(new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(bytes));
}

/* ----------------------------------------------------------- the review */

let plan = null;
/**
 * The sections ticked on the review, by id. Drawn ticked as the check chose -
 * every section but Static Content - and changed only by a tick here: the
 * write sends them, with the fingerprint of the writes they make.
 */
let ticked = new Set();
/** Texts "Find English still on the page" may leave in English, marked here; for this panel only. */
const keptOnPurpose = new Set();

/** The offered writes in the ticked sections: what the Write writes. */
const chosen = () => (plan?.offered ?? []).filter((w) => ticked.has(w.section));
/** The ticked sections' ids in page order, as the worker lists them. */
const chosenIds = () => (plan?.sections ?? []).filter((s) => ticked.has(s.id)).map((s) => s.id);

/** The node a Key names: "root/responsivegrid/cm_g_static_content__1495926445@bodyHtml#hb11688fa" is cm_g_static_content__1495926445. */
const nodeOf = (key) => String(key).split('@')[0].split('/').pop().replace(/^\.$/, '') || '(page)';

/**
 * A row as its section shows it: written - when its section is ticked - or
 * not, and why. A text of a Static Content block is written with the block's
 * prepared Body (HTML) or Footer (JavaScript), when DSY could make one.
 */
function outcome(r, block) {
  if (block && r.status === 'manual') {
    const footer = String(r.key).includes('@footerInclude');
    const value = footer ? block.preparedFooter : block.prepared;
    if (value !== null) return { written: true };
    return { written: false, say: `Not written: ${(footer ? block.footerReason : block.reason) || 'DSY could not prepare this field.'}` };
  }
  const group = IMPORT_STATUS[r.status].group;
  if (group === 'write') return r.newValue !== undefined ? { written: true } : { written: false, say: 'Same as on the page already' };
  if (group === 'manual') return { written: false, say: 'Apply by hand - static HTML is not written' };
  if (r.status === 'missing') return { written: false, say: 'Not on this page' };
  if (r.status === 'untranslated') return { written: false, say: r.message ? `Not translated - ${r.message}` : 'Not translated' };
  if (r.status === 'same') return { written: false, say: 'Same as English' };
  if (r.status === 'already') return { written: false, say: 'Already translated on the page' };
  return { written: false, say: `Needs attention: ${r.message || IMPORT_STATUS[r.status].label}` };
}

/** `origin()` says which server the panel is on now: a block's read goes only to the server that was checked. */
export function renderResult(root, data, { el, origin }) {
  if (!data || !('writes' in data)) return;
  plan = data;
  const offered = data.offered ?? data.writes;
  const sections = data.sections ?? [];
  const canWrite = (id) => offered.some((w) => w.section === id);
  ticked = new Set((data.selected ?? []).filter(canWrite));
  const c = data.counts;
  const wrap = el('div', 'analysis import');

  /* ---- counts ----------------------------------------------------------- */
  const bar = el('div', 'summary');
  const counts = el('div', 'summary-counts');
  const stat = (n, label, kind) => {
    const s = el('span', 'stat');
    s.dataset.kind = kind;
    s.append(el('b', null, String(n)), el('span', null, ` ${label}`));
    counts.append(s);
  };
  const blocked = c.changed + c.missing + c.notFound + c.invalid + c.duplicate;
  stat(offered.length, offered.length === 1 ? 'change to write' : 'changes to write', offered.length ? 'copy' : 'skip');
  if (blocked) stat(blocked, 'need attention', 'warn');
  if (c.untranslated) stat(c.untranslated, 'not translated', 'skip');
  if (c.already + c.same) stat(c.already + c.same, 'unchanged', 'skip');
  bar.append(counts);
  if (data.exportedFrom) {
    const from = el('div', 'import-from');
    from.append(el('span', 'summary-label', 'exported from'), el('span', 'summary-path', data.exportedFrom));
    bar.append(from);
  }
  wrap.append(bar);

  for (const w of data.warnings) {
    const n = el('p', 'notice', w);
    n.dataset.tone = 'warn';
    wrap.append(n);
  }

  /* Static Content: unticked to start with, and said so once. Pasting a block
   * by hand stays possible - its buttons are in its section. */
  if (sections.some((s) => s.static)) {
    const n = el('p', 'notice', 'Static Content blocks hold page code. Tick them to let DSY update them, then check those blocks on the page.');
    n.dataset.tone = 'warn';
    const steps = el('details', 'paste-hand import-paste-steps');
    steps.append(
      el('summary', null, 'To paste a block by hand instead'),
      el(
        'p',
        'paste-hand-note',
        'In its section: click Copy new Body(HTML). Open the block in AEM (Configure). The dialog opens on Header(CSS) - click the Body(HTML) tab. Press Ctrl+A, then Ctrl+V, then click Done. Then click Check again.'
      )
    );
    wrap.append(n, steps);
  }

  /* ---- the tools: Select all, and the read-only sweep -------------------- */
  const tools = el('div', 'import-tools');
  const allBox = el('label', 'check import-all');
  const all = el('input');
  all.type = 'checkbox';
  allBox.append(all, el('span', null, 'Select all'));
  const sweep = el('button', 'paste-btn', 'Find English still on the page');
  sweep.type = 'button';
  tools.append(allBox, sweep);
  const sweepSay = el('div', 'paste-status import-sweep');
  sweepSay.hidden = true;
  const sweepList = el('ul', 'check-all');
  wrap.append(tools, sweepSay, sweepList);

  /* ---- one fold per section, in page order ------------------------------- */
  const cards = data.staticBlocks?.length ? renderPasteByHand(data, { el, ask: (action, params) => askChecked(action, params, origin?.()) }) : null;
  const boxes = new Map();
  const folds = new Map();
  const list = el('div', 'import-sections');
  for (const s of sections) {
    const block = s.static ? data.staticBlocks.find((b) => b.label === s.id) : null;
    const rows = data.rows.filter((r) => r.section === s.id);
    const shown = rows.map((r) => ({ r, ...outcome(r, block) }));
    const n = shown.filter((x) => x.written).length;

    const d = el('details', 'detail import-section deck-section');
    d.dataset.section = s.id;
    if (s.static) d.dataset.static = 'true';
    const sum = el('summary');
    const tick = el('input', 'import-tick');
    tick.type = 'checkbox';
    tick.disabled = !canWrite(s.id);
    tick.checked = ticked.has(s.id);
    tick.title = tick.disabled ? 'Nothing in this section can be written' : 'Write this section';
    tick.addEventListener('change', () => {
      if (tick.checked) ticked.add(s.id);
      else ticked.delete(s.id);
      refresh();
    });
    boxes.set(s.id, tick);
    folds.set(s.id, d);
    const count = el('span', 'detail-count', String(n));
    count.title = `${n} change${n === 1 ? '' : 's'} to write when ticked`;
    sum.append(tick, el('span', 'detail-title', s.id || 'Other rows'), count);
    d.append(sum);

    const card = cards?.cardOf(s.id);
    if (card) d.append(card);
    const items = el('ol', 'import-rows');
    for (const x of shown) items.append(item(el, x, block));
    if (shown.length) d.append(items);
    list.append(d);
  }
  wrap.append(list);

  /* ---- the rest, folded -------------------------------------------------- */
  const extra = el('div', 'detail-groups');
  renderTable(
    extra,
    {
      title: 'On the page, but not in the sheet',
      note: 'Text added to the page after the export, or a group left out of it. It stays as it is.',
      rows: data.notInSheet.map((r) => ({ row: '', field: `${r.section} › ${r.field}`, text: r.source })),
      cols: ['row', 'field', 'text'],
      tone: 'info'
    },
    el
  );
  wrap.append(extra);

  /* ---- what writing does, step by step - also the progress view ---------- */
  let writeTitle = null;
  if (offered.length) {
    wrap.append(el('p', 'import-steps-title', 'When you write'));
    const steps = el('ol', 'plan import-plan');
    for (const [id, title, hint] of STEPS(chosen())) {
      const li = el('li', 'plan-step');
      li.dataset.step = id;
      li.dataset.state = 'pending';
      const main = el('div', 'plan-main');
      const t = el('span', 'plan-title', title);
      if (id === 'write') writeTitle = t;
      main.append(t, el('span', 'plan-state'));
      li.append(main, el('div', 'plan-hint', hint));
      steps.append(li);
    }
    wrap.append(steps);
  }

  /* A tick changes what the Write writes, and nothing else: the counts, the
   * button and each block's line are drawn again here - the page is not
   * checked again, and every fold stays as it is. */
  const enabled = [...boxes].filter(([, b]) => !b.disabled);
  function refresh() {
    const on = enabled.filter(([id]) => ticked.has(id)).length;
    all.checked = enabled.length > 0 && on === enabled.length;
    all.indeterminate = on > 0 && on < enabled.length;
    all.disabled = !enabled.length;
    for (const [id, b] of boxes) {
      b.checked = ticked.has(id);
      folds.get(id).dataset.ticked = String(b.checked);
    }
    for (const s of sections) if (s.static) cards?.tick(s.id, ticked.has(s.id));
    if (writeTitle) writeTitle.textContent = `Write ${writesSaid(chosen())}`;
    document.dispatchEvent(new CustomEvent('aemt:flow-changed'));
  }
  all.addEventListener('change', () => {
    for (const [id] of enabled) {
      if (all.checked) ticked.add(id);
      else ticked.delete(id);
    }
    refresh();
  });

  /* "Find English still on the page": the page planned again with the same
   * sheet, read only - every text whose English is still on it. A text can be
   * marked kept on purpose. */
  let left = null;
  sweep.addEventListener('click', async () => {
    sweep.disabled = true;
    sweepSay.hidden = false;
    sweepSay.textContent = 'Checking every block and row - reading only…';
    sweepList.textContent = '';
    try {
      left = (await askChecked('checkAll', { page: data.page }, origin?.())).left;
    } catch (e) {
      left = null;
      sweepSay.textContent = `Could not check: ${e.message}`;
    }
    sweep.disabled = false;
    paintLeft();
  });
  function paintLeft() {
    if (!left) return;
    const still = left.filter((x) => !keptOnPurpose.has(x.text)).length;
    sweepSay.textContent = !left.length
      ? 'No English left on the page.'
      : !still
        ? `No English left but what is kept on purpose (${left.length}).`
        : `${still} text${still === 1 ? '' : 's'} still in English${still < left.length ? ` · ${left.length - still} kept on purpose` : ''}`;
    sweepList.textContent = '';
    for (const x of left) {
      const li = el('li', 'check-all-item');
      li.dataset.kept = String(keptOnPurpose.has(x.text));
      const mark = el('input');
      mark.type = 'checkbox';
      mark.checked = keptOnPurpose.has(x.text);
      mark.addEventListener('change', () => {
        if (mark.checked) keptOnPurpose.add(x.text);
        else keptOnPurpose.delete(x.text);
        paintLeft();
      });
      const label = el('label', 'check-all-mark');
      label.append(mark, el('span', null, 'kept on purpose'));
      li.append(el('div', 'check-all-text', x.text), el('div', 'paste-meta', `${x.where} - ${x.why}`), label);
      sweepList.append(li);
    }
  }

  root.append(wrap);
  refresh();
}

/** A text of the section: its field, Old and New - and, not written, why. */
function item(el, { r, written, say }, block) {
  const li = el('li', 'import-row');
  li.dataset.status = written ? 'ready' : r.status;
  li.title = r.key;
  const head = el('div', 'import-row-head');
  head.append(el('span', 'deck-rownum', String(r.sheetRow)), el('span', 'deck-field', r.field || nodeOf(r.key)));
  head.append(el('span', 'deck-tag', written ? (block ? 'Written when ticked' : 'Ready to write') : IMPORT_STATUS[r.status].label));
  li.append(head);
  const lines = [
    ['Old', r.current],
    r.translation ? ['New', r.translation, 'new'] : null,
    r.reusedFrom ? ['', `Translation taken from row ${r.reusedFrom}`, 'note'] : null,
    written ? null : ['', say, 'reason'],
    ...(r.warnings || []).map((w) => ['Check', w, 'reason'])
  ];
  for (const line of lines.filter((x) => x && x[1])) {
    const [label, text, kind] = line;
    const row = el('div', 'import-line');
    if (kind) row.dataset.kind = kind;
    if (label) row.append(el('span', 'import-label', label));
    row.append(el('span', 'import-text', text));
    li.append(row);
  }
  return li;
}

/* ------------------------------------------------------------------ flow */

/**
 * The tab the check ran in. The side panel follows whichever tab is active, so
 * without this a check on one author instance could be written, a tab switch
 * later, to another. The write goes back to this tab, and only if it is still
 * on the same server.
 */
let checkedIn = null;

const hostOf = (origin) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin || 'this server';
  }
};

export async function analyze(ctx) {
  checkedIn = { tabId: ctx.tabId, origin: ctx.origin, send: ctx.send, params: ctx.params };
  return ctx.send('check', ctx.params, ctx.tabId);
}

/**
 * A read-only action of the worker for the review - a block's Check again and
 * Copy, and "Find English still on the page" - sent to the tab that was
 * checked, and only while the panel, and that tab, are still on the same
 * server. `now` is the server the panel is on. checkAll plans the page again,
 * so it takes the sheet that was checked along.
 */
async function askChecked(action, params, now) {
  const elsewhere = (there, host) =>
    new Error(`This was checked on ${hostOf(checkedIn?.origin)}, but ${there} is now on ${hostOf(host)}. Go back to that tab, or check again here.`);
  if (!checkedIn || checkedIn.origin !== now) throw elsewhere('the panel', now);
  const res = await checkedIn.send(action, action === 'checkAll' ? { ...checkedIn.params, ...params } : params, checkedIn.tabId);
  if (!res?.ok) throw new Error(res?.error || 'The page gave no answer.');
  if (res.result?.origin !== checkedIn.origin) throw elsewhere('the tab that was checked', res.result?.origin);
  return res.result;
}

/** What the button says: exactly how much the ticked sections write, where, and that nothing else happens. */
export function commitState() {
  const writes = chosen();
  if (!writes.length) {
    return {
      ready: false,
      label: 'Nothing to write',
      question: plan?.offered?.length ? 'Nothing is ticked - tick the sections to write.' : 'Nothing on the sheet can be written to this page - see above.'
    };
  }
  const c = plan.counts;
  const blocked = c.changed + c.missing + c.notFound + c.invalid + c.duplicate;
  const unticked = (plan.sections ?? []).filter((s) => !ticked.has(s.id) && plan.offered.some((w) => w.section === s.id)).length;
  const left = [];
  if (blocked) left.push(`${blocked} row${blocked === 1 ? '' : 's'} needing attention`);
  if (unticked) left.push(`${unticked} section${unticked === 1 ? '' : 's'} not ticked`);
  return {
    ready: true,
    label: `Write ${writesSaid(writes)}`,
    busy: 'Writing…',
    question: `Write ${writesSaid(writes)} to ${plan.page} on ${hostOf(plan.origin || checkedIn?.origin)}?`,
    caption:
      (left.length ? `Not written: ${left.join(' and ')}. ` : '') +
      (writes.some((w) => w.static) ? 'To undo a Static Content block, use Copy old Body(HTML) or Copy old Footer(Javascript) in its section. ' : '') +
      'Nothing is published.'
  };
}

/**
 * The write, to the tab that was checked: the sections ticked, and the
 * fingerprint of the writes they make. The worker re-plans, keeps those
 * sections only, and refuses unless the writes are these ones.
 */
export async function commit(ctx) {
  const writes = chosen();
  if (!writes.length) return { ok: false, error: 'Nothing to write.' };
  if (!checkedIn || checkedIn.origin !== ctx.origin) {
    return {
      ok: false,
      error:
        `This was checked on ${hostOf(checkedIn?.origin)}, but the panel is now on ${hostOf(ctx.origin)}. ` +
        'Go back to that tab, or check again here. Nothing has been written.'
    };
  }
  const sections = chosenIds();
  const approved = writesFingerprint(writes, { origin: plan.origin, page: plan.page, sections });
  return ctx.send('apply', { ...ctx.params, sections, approved }, checkedIn.tabId);
}

/* --------------------------------------------------------------- progress */

export function updateStep(root, { id, state: s, note }) {
  const li = root.querySelector(`.import-plan .plan-step[data-step="${id}"]`);
  if (!li) return;
  li.dataset.state = s;
  const cell = li.querySelector('.plan-state');
  if (cell) cell.textContent = s === 'done' ? (note ? `✓ ${note}` : '✓') : s === 'failed' ? '✗' : note || '';
  if (s === 'running') li.scrollIntoView({ block: 'nearest' });
}
