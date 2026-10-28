/**
 * copy-deck, panel side.
 *
 * Shows what the page holds, group by group, and lets the operator choose which
 * groups go on the sheet - ticking a group changes the sheet at once, without
 * reading the page again. The commit button is the Excel download: the shell
 * asks `commitState()` what it should say, and is told to ask again with an
 * `aemt:flow-changed` event whenever the choice changes. A CSV and the
 * clipboard are the other ways out.
 *
 * Fields that read like words but are not on the sheet are listed first, to
 * add or ignore. The choice is saved in settings, and the sheet is built again
 * at once from the page the worker read - no second read of the page.
 *
 * A product page (PD) is read as rendered, since its copy comes from PIM (see
 * pd.js). It has groups of its own - gallery, features, specs - a switch
 * between a representative SKU (everything) and a sibling SKU (gallery and
 * specs only), each text once on the sheet, and no fields to add.
 */

import { renderTable } from '../../panel/table.js';
import { CATEGORIES, buildSheet, countByCategory, extractCopyDeck, fileName, mergeRows, selectRows, toCsv, toHtmlTable, toTsv } from './core.js';
import { chooseField, loadFields, onFieldsChanged } from './fields.js';
import { NEW_FIELDS_TITLE, renderNewFields } from './new-fields.js';
import { PD_CATEGORIES, SKU_PRESETS, countPdByCategory, selectPdRows } from './pd.js';
import { toXlsx } from './xlsx.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const PREFS_KEY = 'aemt.copyDeck.include';

let data = null;
let refs = null;
let choice = loadChoice();
/** A product page's groups. Not remembered: every page read starts as a representative SKU (see renderResult). */
let pdChoice = { categories: new Set(SKU_PRESETS.rep) };
/** Where the result is drawn, and with what, so a choice made here or in settings can draw it again. */
let host = null;
let drawWith = null;
/** The shell's log, where a CSV or a copy that is refused says why - as the Excel download does. */
let shellLog = null;
/**
 * What was drawn. The shell reuses one result area for every feature and only
 * empties it, so the area itself is always on the page: whether this copy deck
 * is still what it shows is told by this, and nothing is redrawn once it is not.
 */
let drawn = null;
/** The preview's sections the operator opened, by title, and what it is searched for - for the read in `openedFor` only. */
const opened = new Set();
let query = '';
let openedFor = null;
/** The added and ignored fields, as stored - once read from storage. */
let fields = { add: [], ignore: [] };
let fieldsKnown = false;

const changed = () => document.dispatchEvent(new CustomEvent('aemt:flow-changed'));

/** The worker reads the page with the fields added so far, so the first result is already right. */
export async function analyze(ctx) {
  try {
    fields = await loadFields();
    fieldsKnown = true;
  } catch {
    // Storage unreadable: the rules alone, this time.
  }
  return ctx.send('read', { ...ctx.params, fields: JSON.stringify(fields) });
}

/** The rows from the page already read, with the fields as they are now. */
const withFields = (d) => ({ ...d, fields, ...extractCopyDeck(d.tree, { pagePath: d.page, fields, dialogs: d.dialogs }) });

/** The rows again, then drawn again, in place. */
function rebuild(next) {
  fieldsKnown = true;
  // The settings change this panel just saved comes back as an event too: once is enough.
  if (JSON.stringify(next) === JSON.stringify(fields)) return;
  fields = next;
  if (!data?.tree || !drawn?.isConnected) return;
  data = withFields(data);
  const y = window.scrollY;
  host.textContent = '';
  draw(drawWith);
  window.scrollTo({ top: y });
}

// Taken back in settings, or chosen in another window: the sheet follows.
try {
  onFieldsChanged(rebuild);
} catch {
  // Not in the extension (a test page): nothing to follow.
}

async function choose(kind, field) {
  rebuild(await chooseField(kind, field));
}

/** What was ticked last time. Every group, and nothing hidden, until then. */
function loadChoice() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (saved && Array.isArray(saved.categories)) {
      return { categories: new Set(saved.categories), includeInactive: !!saved.includeInactive };
    }
  } catch {
    // Nothing stored, or storage unavailable: the defaults below.
  }
  return { categories: new Set(CATEGORIES.map((c) => c.id)), includeInactive: false };
}

function saveChoice() {
  if (isPd()) return;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ categories: [...choice.categories], includeInactive: choice.includeInactive }));
  } catch {
    // Not remembered next time; this run is unaffected.
  }
}

/** A product page, read as rendered because its copy comes from PIM. */
const isPd = () => data?.mode === 'pd';

const selected = () => {
  if (!data) return [];
  return isPd() ? selectPdRows(data.rows, pdChoice) : selectRows(data.rows, choice);
};

/** Every place of a product page's text in the groups ticked, in page order - the sheet has each text once. */
const pdPlaces = () => data.rows.filter((r) => !pdChoice.categories || pdChoice.categories.has(r.category));

/** The sheet's rows: each text once, with every place it goes to (see mergeRows). */
const sheetRows = () => mergeRows(selected());

function stamp(now) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function sheetFor(rows, now = new Date()) {
  return buildSheet(rows, { pagePath: data.page, exportedAt: stamp(now), pd: isPd() });
}

/** Hand the file to the browser's downloads. */
function save(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const CSV_LABEL = 'Download CSV';
let csvTimer = null;

function downloadCsv(button, label) {
  const rows = selected();
  if (!rows.length) return;
  const now = new Date();
  clearTimeout(csvTimer);
  let csv;
  try {
    csv = toCsv(sheetFor(rows, now));
  } catch (e) {
    /* A cell longer than Excel allows: refused like the Excel download, and
     * nothing saved. Said on the button too, as a copy says it - for a host
     * that gives no log. */
    label.textContent = 'Could not save';
    button.title = e.message;
    csvTimer = setTimeout(() => {
      label.textContent = CSV_LABEL;
    }, 1800);
    shellLog?.('fail', e.message);
    return;
  }
  button.title = '';
  save(csv, fileName(data.page, now, 'csv'), 'text/csv;charset=utf-8');
}

/* ---------------------------------------------------------------- render */

export function renderResult(root, result, { el, log }) {
  if (!result || !('rows' in result)) return;
  shellLog = log || null;
  // A field added or taken back while the page was being read: build the rows again, here.
  const moved = fieldsKnown && result.tree && JSON.stringify(result.fields) !== JSON.stringify(fields);
  data = moved ? withFields(result) : result;
  // Another page, or the same page read again: every section starts closed, and nothing is searched for.
  if (openedFor !== result) {
    opened.clear();
    query = '';
    openedFor = result;
  }
  /* A product page read starts as a representative SKU, every time: a sibling's
   * choice carried over to the next page would quietly leave its features off. */
  if (isPd()) pdChoice = { categories: new Set(SKU_PRESETS.rep) };
  host = root;
  drawWith = el;
  draw(el);
}

function draw(el) {
  const wrap = el('div', 'analysis copy-deck');

  const summary = el('div', 'summary');
  const counts = el('div', 'summary-counts');
  summary.append(counts);
  wrap.append(summary);

  /* ---- text no rule puts on the sheet: decided first, it changes the sheet */
  renderNewFields(wrap, data.newFields, { el, onChoose: choose });

  /* ---- a product page: where its copy comes from, and which SKU this is -- */
  const pd = isPd();
  const groups = pd ? pdChoice : choice;
  let sku = null;
  if (pd) {
    const note = el(
      'p',
      'notice',
      'This is a product page (PD). Its text comes from PIM, so it was read from the page as visitors see it, not from ' +
        'AEM. The translations go back into PIM: this sheet cannot be imported into AEM. Prices, options, reviews and ' +
        'support are left off.'
    );
    note.dataset.tone = 'info';
    wrap.append(note);
    sku = drawSku(el, wrap);
  }

  /* ---- which groups go on the sheet ------------------------------------- */
  const box = el('fieldset', 'deck-groups');
  box.append(el('legend', null, 'On the sheet'));
  const all = pd ? countPdByCategory(data.rows) : countByCategory(data.rows, { includeInactive: true });
  const shown = pd ? all : countByCategory(data.rows);
  const boxes = [];
  for (const c of pd ? PD_CATEGORIES : CATEGORIES) {
    const label = el('label', 'check deck-group');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = groups.categories.has(c.id);
    input.disabled = !all[c.id];
    input.dataset.category = c.id;
    input.addEventListener('change', () => {
      if (input.checked) groups.categories.add(c.id);
      else groups.categories.delete(c.id);
      saveChoice();
      paint(el);
    });
    label.append(input, el('span', null, c.label), el('span', 'deck-count', String(shown[c.id] || 0)));
    if (!all[c.id]) label.dataset.empty = 'true';
    box.append(label);
    boxes.push(input);
  }

  const hiddenCount = pd ? 0 : data.rows.filter((r) => r.inactive).length;
  const hidden = el('label', 'check deck-group deck-hidden');
  const hiddenInput = el('input');
  hiddenInput.type = 'checkbox';
  hiddenInput.checked = choice.includeInactive;
  hiddenInput.disabled = !hiddenCount;
  hiddenInput.addEventListener('change', () => {
    choice.includeInactive = hiddenInput.checked;
    saveChoice();
    paint(el);
  });
  hidden.append(
    hiddenInput,
    el('span', null, 'Also include text not shown on the page'),
    el('span', 'deck-count', String(hiddenCount))
  );
  hidden.title = 'Video captions on blocks that show an image, switched-off items, an unused common disclaimer.';
  if (!pd) box.append(hidden);
  wrap.append(box);

  /* ---- other ways out: the clipboard, a plain CSV ------------------------ */
  const actions = el('div', 'deck-actions');
  const buttons = el('div', 'deck-actions-row');
  const copy = el('button', 'btn', null);
  copy.type = 'button';
  copy.dataset.tone = 'secondary';
  const copyLabel = el('span', null, COPY_LABEL);
  copy.append(copyLabel);
  copy.addEventListener('click', () => copyForExcel(copy, copyLabel));
  const csv = el('button', 'btn', null);
  csv.type = 'button';
  csv.dataset.tone = 'secondary';
  const csvLabel = el('span', null, CSV_LABEL);
  csv.append(csvLabel);
  csv.addEventListener('click', () => downloadCsv(csv, csvLabel));
  buttons.append(copy, csv);
  actions.append(
    buttons,
    el(
      'span',
      'deck-actions-hint',
      'The Excel file below is what to send translators: sized, wrapped, text-only cells, with a How to translate tab. ' +
        'A CSV has no formatting and opens in one column where Windows lists with ";".'
    )
  );
  wrap.append(actions);

  /* ---- what the sheet will hold ------------------------------------------ */
  const preview = el('div', 'deck-preview');
  wrap.append(preview);

  /* ---- what is not on it -------------------------------------------------- */
  const extra = el('div', 'detail-groups');
  renderTable(
    extra,
    pd
      ? {
          title: 'Left off - not the product’s copy',
          note: 'These parts of the page do not come from the product in PIM.',
          rows: data.leftOff.map((l) => ({ part: l.part, why: l.why, texts: l.texts })),
          cols: ['part', 'why', 'texts'],
          tone: 'info'
        }
      : {
          title: 'Content kept elsewhere - not on this sheet',
          note: 'Fragments are shared between pages. Export them from their own page.',
          rows: data.references.map((r) => ({ property: r.key, path: r.value })),
          cols: ['property', 'path'],
          tone: 'info'
        },
    el
  );
  wrap.append(extra);

  host.append(wrap);
  drawn = wrap;
  refs = { counts, boxes, preview, sku };
  paint(el);
}

/**
 * Representative or sibling SKU: two presets for the groups. The ticks stay
 * the operator's to change; the switch shows the preset they match, if any.
 */
function drawSku(el, wrap) {
  const box = el('div', 'deck-sku');
  const row = el('div', 'deck-sku-row');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Which SKU this page is');
  const buttons = {};
  for (const [id, text] of [
    ['rep', 'Representative SKU'],
    ['sibling', 'Sibling SKU']
  ]) {
    const b = el('button', 'deck-sku-btn', text);
    b.type = 'button';
    b.dataset.sku = id;
    b.addEventListener('click', () => {
      pdChoice.categories = new Set(SKU_PRESETS[id]);
      for (const input of refs.boxes) input.checked = pdChoice.categories.has(input.dataset.category);
      saveChoice();
      paint(el);
    });
    buttons[id] = b;
    row.append(b);
  }
  box.append(
    row,
    el(
      'p',
      'deck-actions-hint',
      'A sibling SKU - the same model in another size or colour - shares its features with the representative SKU, ' +
        'so only its gallery and specs go on its sheet.'
    )
  );
  wrap.append(box);
  return buttons;
}

/** Which preset the ticked groups are, if any. */
function skuOf(categories) {
  const same = (ids) => ids.length === categories.size && ids.every((id) => categories.has(id));
  return Object.keys(SKU_PRESETS).find((k) => same(SKU_PRESETS[k])) || null;
}

/** Bring the counts, the preview and the commit button into line with the choice. */
function paint(el) {
  if (!refs || !data) return;
  const rows = selected();
  const entries = mergeRows(rows);
  // A product page's sheet has each text once; the page shows every place it is, each in its section.
  const shown = isPd() ? pdPlaces() : rows;

  refs.counts.textContent = '';
  const stat = (n, label, kind) => {
    const s = el('span', 'stat');
    s.dataset.kind = kind;
    s.append(el('b', null, String(n)), el('span', null, ` ${label}`));
    refs.counts.append(s);
  };
  stat(entries.length, entries.length === 1 ? 'row on the sheet' : 'rows on the sheet', entries.length ? 'copy' : 'skip');
  stat(new Set(rows.map((r) => r.sectionNo)).size, 'sections', 'skip');
  // A row of static content can be several places of its block: each counts.
  const places = (list) => list.reduce((n, r) => n + (r.count || 1), 0);
  const repeats = places(shown) - entries.length;
  if (repeats) stat(repeats, `repeat${repeats === 1 ? '' : 's'} merged - one translation for every place`, 'skip');
  const manual = places(rows.filter((r) => r.format === 'manual'));
  if (manual) stat(manual, 'applied by hand', 'create');
  const undecided = data.newFields?.length || 0;
  if (undecided) stat(undecided, undecided === 1 ? 'field not on the sheet' : 'fields not on the sheet', 'create');
  if (data.language) stat(data.language, 'page language', 'skip');
  if (isPd()) stat('PD', 'product page - text from PIM', 'create');

  if (refs.sku) {
    const on = skuOf(pdChoice.categories);
    for (const [id, b] of Object.entries(refs.sku)) b.setAttribute('aria-pressed', String(id === on));
  }

  /* The page as it is: every place under its own section, in page order - a
   * heading the same as the page title still shows in its component. The
   * number is the Excel row the place lands on, so places that share a row,
   * and so a translation, share a number. Each section folds: closed to start
   * with, so the page reads as a list of its sections; one opened stays open
   * while groups are ticked or fields added, until another page is read.
   * A search above them keeps only the places with the text searched for, and
   * says where else on the page it is when it is not on the sheet. */
  refs.preview.textContent = '';
  if (!entries.length) {
    refs.preview.append(el('p', 'plan-empty', 'Nothing selected. Tick at least one group above.'));
  } else {
    const rowOf = new Map();
    entries.forEach((e, i) => e.places.forEach((p) => rowOf.set(p, { entry: e, excel: i + 2 })));
    if (isPd()) {
      // The sheet's row for a text is where it is first seen; its other places share that row.
      const bySource = new Map(entries.map((e, i) => [e.source, { entry: { ...e, places: [] }, excel: i + 2 }]));
      for (const p of shown) {
        const at = bySource.get(p.source);
        at.entry.places.push(p);
        rowOf.set(p, at);
      }
    }
    const where = (p) => p.place || (isPd() ? p.section : null);
    const name = (p, from) => (p.sectionNo === from.sectionNo || !where(p) ? p.field : `${where(p)} › ${p.field}`);

    const tools = el('div', 'deck-preview-tools');
    const search = el('input', 'deck-search');
    search.type = 'search';
    search.placeholder = 'Search the text on the sheet';
    search.setAttribute('aria-label', 'Search the text on the sheet');
    search.value = query;
    const all = el('button', 'link-btn', 'Expand all');
    all.type = 'button';
    tools.append(search, all);
    const found = el('div', 'deck-search-status');
    found.hidden = true;
    found.setAttribute('aria-live', 'polite');
    refs.preview.append(tools, found);
    const blocks = [];
    const sync = () => {
      all.textContent = blocks.every((b) => b.block.open) ? 'Collapse all' : 'Expand all';
    };
    all.addEventListener('click', () => {
      const open = !blocks.every((b) => b.block.open);
      for (const b of blocks) {
        b.block.open = open;
        if (open) opened.add(b.title);
        else opened.delete(b.title);
      }
      sync();
    });

    let section = null;
    let list = null;
    for (const r of shown) {
      const { entry, excel } = rowOf.get(r);
      if (r.section !== section) {
        section = r.section;
        const title = section;
        const block = el('details', 'detail deck-section');
        block.open = opened.has(title);
        const count = el('span', 'detail-count', '0');
        const summary = el('summary');
        summary.append(el('span', 'detail-title', title), count);
        list = el('ol', 'deck-rows');
        block.append(summary, list);
        block.addEventListener('toggle', () => {
          // Opened by a search, not by hand: what was open before comes back when it is cleared.
          if (fold(query)) return;
          if (block.open) opened.add(title);
          else opened.delete(title);
          sync();
        });
        blocks.push({ block, title, count, places: 0, items: [] });
        refs.preview.append(block);
      }
      const b = blocks.at(-1);
      b.places += r.count || 1;
      b.count.textContent = String(b.places);
      b.count.title = `${b.places} place${b.places === 1 ? '' : 's'} with text in this section`;
      const li = el('li', 'deck-row');
      li.dataset.category = r.category;
      const head = el('div', 'deck-row-head');
      head.append(el('span', 'deck-rownum', String(excel)), el('span', 'deck-field', r.field));
      const [first, ...others] = entry.places;
      if (r === first && others.length) {
        head.append(
          tag(
            el,
            `also in ${others.length} more place${others.length === 1 ? '' : 's'}`,
            `Same text, one row in Excel, one translation - also:\n${others.map((p) => name(p, r)).join('\n')}`
          )
        );
      } else if (r !== first) {
        const sameRow = tag(el, `same Excel row as ${first.field}`, `Translated once, on Excel row ${excel}, with:\n${name(first, r)}`);
        sameRow.dataset.kind = 'same-row';
        head.append(sameRow);
      }
      if (r.inactive) head.append(tag(el, 'not shown', r.inactive));
      if (r.format === 'manual') head.append(tag(el, 'by hand', 'Static HTML - applied by hand, not by the import'));
      if (r.added) head.append(tag(el, 'added', 'A field you added - in Settings, under Copy deck fields'));
      if (r.pim) head.append(tag(el, `PIM ${r.pim}`, 'The PIM feature this text belongs to'));
      if (r.limit) head.append(tag(el, 'length', r.limit));
      const text = el('div', 'deck-text', r.source);
      li.append(head, text);
      li.title = r.key;
      list.append(li);
      b.items.push({ li, text, source: r.source, hay: haystack(r), marked: '', places: r.count || 1 });
    }

    /** The words searched for, marked in the text - any case, either kind of quote, any spacing. */
    const mark = (it, typed) => {
      if (it.marked === typed) return;
      it.marked = typed;
      it.text.textContent = '';
      const re = typed && loosely(typed);
      if (!re) {
        it.text.textContent = it.source;
        return;
      }
      let at = 0;
      for (const m of it.source.matchAll(re)) {
        if (!m[0]) continue;
        if (m.index > at) it.text.append(it.source.slice(at, m.index));
        it.text.append(el('mark', 'deck-hit', m[0]));
        at = m.index + m[0].length;
      }
      if (at < it.source.length) it.text.append(it.source.slice(at));
    };

    const find = () => {
      const q = fold(query);
      const typed = query.trim().toLowerCase();
      let hits = 0;
      for (const b of blocks) {
        let shown = 0;
        for (const it of b.items) {
          const hit = !q || it.hay.includes(q);
          it.li.hidden = !hit;
          mark(it, hit && q ? typed : '');
          if (hit) shown += it.places;
        }
        b.block.hidden = Boolean(q) && !shown;
        b.block.open = q ? shown > 0 : opened.has(b.title);
        b.count.textContent = q ? `${shown} of ${b.places}` : String(b.places);
        hits += shown;
      }
      all.hidden = Boolean(q);
      found.textContent = '';
      found.hidden = !q;
      if (!q) {
        sync();
        return;
      }
      found.dataset.tone = hits ? 'ok' : 'warn';
      const say = (t) => found.append(el('div', 'deck-search-line', t));
      const what = `“${query.trim()}”`;
      say(hits ? `${hits} place${hits === 1 ? '' : 's'} on the sheet ${hits === 1 ? 'has' : 'have'} ${what}.` : `Nothing on the sheet has ${what}.`);
      for (const line of elsewhere(shown, q)) say(line);
    };
    search.addEventListener('input', () => {
      query = search.value;
      find();
    });
    find();
  }
  changed();
}

/**
 * Where else the page has the text searched for, when it is not on the sheet:
 * in a group not ticked, in text not shown on the page, or in a field listed
 * under "Fields not on the sheet". Nothing anywhere: where it may be instead.
 */
function elsewhere(rows, q) {
  const lines = [];
  const keys = new Set(rows.map((r) => r.key));
  const texts = new Set(rows.map((r) => r.source));
  const groups = isPd() ? PD_CATEGORIES : CATEGORIES;
  const why = new Map();
  for (const r of data.rows) {
    if (keys.has(r.key) || texts.has(r.source) || !haystack(r).includes(q)) continue;
    const reason =
      r.inactive && !isPd() && !choice.includeInactive
        ? 'not shown on the page - tick “Also include text not shown on the page” to put it on'
        : `in “${groups.find((g) => g.id === r.category)?.label || r.category}”, which is not ticked`;
    why.set(reason, (why.get(reason) || 0) + 1);
  }
  for (const [reason, n] of why) lines.push(`Left off the sheet: ${n} place${n === 1 ? '' : 's'} ${reason}.`);
  const fields = (data.newFields || []).filter((f) => fold(visible(f.text)).includes(q) || fold(f.text).includes(q));
  for (const f of fields) lines.push(`In “${NEW_FIELDS_TITLE}”: ${f.componentLabel} · ${f.prop} - Add it to put it on the sheet.`);
  if (!lines.length && !rows.some((r) => haystack(r).includes(q))) {
    lines.push(
      'Not in this page’s content at all. Text on the live page can come from elsewhere: a content or experience fragment, ' +
        'the header and footer, PIM, or a script - none of it is on this page’s sheet.'
    );
  }
  return lines;
}

/** Block tags end a word; inline ones (<b>, <sup>, <a>) do not. */
const BLOCK_TAG = /^(br|p|div|li|ul|ol|h[1-6]|tr|td|th|table|section|article|blockquote|hr)$/i;
const CODES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', trade: '™', reg: '®', copy: '©' };

/** A text as a visitor reads it: tags out, codes decoded. */
function visible(s) {
  return String(s)
    .replace(/<\/?([a-zA-Z][\w:-]*)(?:[^>"']|"[^"]*"|'[^']*')*>/g, (m, tagName) => (BLOCK_TAG.test(tagName) ? ' ' : ''))
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== '#') return CODES[e.toLowerCase()] ?? m;
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    });
}

/** Made comparable: one case, one kind of quote, one space - "We’ve" finds "We've". */
const fold = (s) =>
  String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** A search as a pattern to mark it by: any case, any kind of quote, any run of spaces or line breaks. */
function loosely(typed) {
  const source = typed
    .trim()
    .split(/\s+/)
    .map((word) =>
      word
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/['‘’‚‛′`´]/g, "['‘’‚‛′`´]")
        .replace(/["“”„‟″]/g, '["“”„‟″]')
    )
    .join('\\s+');
  return source ? new RegExp(source, 'giu') : null;
}

/** What a place is searched in: its text as read, and as stored - so a link's address is found too. */
const haystack = (r) => `${fold(visible(r.source))}\n${fold(r.source)}`;

function tag(el, text, title) {
  const t = el('span', 'deck-tag', text);
  t.title = title;
  return t;
}

const COPY_LABEL = 'Copy for Excel';
let copyTimer = null;

async function copyForExcel(button, label) {
  const rows = selected();
  if (!rows.length) return;
  const sheet = sheetFor(rows);
  clearTimeout(copyTimer);
  let made = false;
  try {
    // Both forms before the clipboard: a cell longer than Excel allows stops the copy, and nothing is put there.
    const html = toHtmlTable(sheet);
    const text = toTsv(sheet);
    made = true;
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })
    ]);
    const n = mergeRows(rows).length;
    label.textContent = `Copied ${n} row${n === 1 ? '' : 's'}`;
    button.title = '';
  } catch (e) {
    label.textContent = 'Could not copy';
    button.title = e.message;
    // The sheet refused, not the clipboard: said in the log too, as the Excel download says it.
    if (!made) shellLog?.('fail', e.message);
  }
  // Always back to the resting label: a second click mid-way must not keep "Copied".
  copyTimer = setTimeout(() => {
    label.textContent = COPY_LABEL;
  }, 1800);
}

/* ------------------------------------------------------------------ flow */

export function commitState() {
  const rows = sheetRows();
  if (!rows.length) {
    return { ready: false, label: 'Nothing selected to export', question: 'Tick at least one group above.' };
  }
  const undecided = data.newFields?.length || 0;
  return {
    ready: true,
    label: `Download Excel · ${rows.length} row${rows.length === 1 ? '' : 's'}`,
    busy: 'Preparing…',
    question: `Download ${rows.length} row${rows.length === 1 ? '' : 's'} for translation?`,
    caption: isPd()
      ? `${fileName(data.page)} - translators fill in the yellow Translation column. The translations are entered in PIM; this sheet cannot be imported.`
      : `${fileName(data.page)} - translators fill in the yellow Translation column and leave the Key and Check columns as they are.` +
        (undecided ? ` Not on it: ${undecided} field${undecided === 1 ? '' : 's'} listed under "${NEW_FIELDS_TITLE}".` : '')
  };
}

/** The download happens here, in the panel: nothing needs to go back to the page. */
export async function commit(ctx) {
  const rows = selected();
  if (!rows.length) return { ok: false, error: 'Nothing selected to export.' };

  const now = new Date();
  const name = fileName(data.page, now);
  const sheet = sheetFor(rows, now);
  save(toXlsx(sheet, { pagePath: data.page, exportedAt: stamp(now), modified: now, pd: isPd() }), name, XLSX_TYPE);

  const n = sheet.records.length - 1;
  ctx.log('ok', `Downloaded ${name}: ${n} row${n === 1 ? '' : 's'} from ${data.page}.`);
  return { ok: true, result: { done: true, title: 'Copy deck downloaded', dest: name } };
}
