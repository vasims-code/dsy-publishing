/**
 * Copy deck, as the design draws it.
 *
 * One tool over two features: the export reads a page's text onto a sheet,
 * the import writes a translated sheet back. Which one you want is the first
 * question, so it is the first screen.
 *
 * The export is read-only from start to finish - the sheet is built here, in
 * the panel, from what the worker read. Nothing is written to AEM by it at
 * all, which is why its last step hands you a file rather than a result.
 */

import {
  CATEGORIES,
  buildSheet,
  fileName,
  mergeRows,
  selectRows,
  toCsv,
  toHtmlTable,
  toTsv
} from '../../features/copy-deck/core.js';
import { toXlsx } from '../../features/copy-deck/xlsx.js';
import { PD_CATEGORIES, SKU_PRESETS, selectPdRows } from '../../features/copy-deck/pd.js';
import { chooseField, loadFields } from '../../features/copy-deck/fields.js';
import { renderNewFields } from '../../features/copy-deck/new-fields.js';
import { icon } from '../icons.js';
import {
  button,
  busyButton,
  connPill,
  counts,
  el,
  footerBar,
  kv,
  label,
  list,
  notice,
  stepBar,
  titled,
  toTop,
  cardOf,
  skeleton
} from '../parts.js';
import { logBox, makeLog } from '../log.js';
import { runAction } from '../run.js';
import * as imp from './copy-deck-import.js';

const STEPS = ['Pick', 'Review', 'Download'];
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

/** How many places each group covers - a static row can be several at once. */
const places = (rows) => rows.reduce((n, r) => n + (r.count || 1), 0);

export async function render(ctx) {
  const { view, footer, state, goHome } = ctx;

  const own = ctx.own;
  if (!own.phase) {
    Object.assign(own, {
      side: null,
      phase: 'pick',
      page: null,
      deck: null,
      groups: new Set(CATEGORIES.map((c) => c.id)),
      includeInactive: false,
      skipped: new Set(),
      search: '',
      opened: new Set(),
      problem: null,
      said: null,
      busy: null
    });
  }

  if (!own.opened) own.opened = new Set();
  if (own.page == null) own.page = state.page?.path || '';

  const redraw = () => ctx.render();
  /* Every line the read reports, kept so a failure leaves an account of
     itself (see ui/log.js). */
  if (!own.log) own.log = makeLog(() => {
    if (own.phase === 'running') redraw();
  });

  const goStep = (phase) => {
    own.phase = phase;
    toTop();
    redraw();
  };

  view.append(
    connPill({
      host: String(state.origin || '').replace(/^https?:\/\//, ''),
      signedIn: !state.session || state.session.state === 'in' || state.session.state === 'unknown'
    })
  );

  /* ---------------------------------------------------- which half of it */

  if (!own.side) {
    view.append(label('What do you want to do?'));
    view.append(
      choice(
        'export',
        'Export',
        'Export the text of the open page to a .xlsx for translators.',
        { tone: 'read', icon: 'eye', text: 'Read-only · nothing is written' },
        () => {
          own.side = 'export';
          goStep('pick');
        }
      ),
      choice(
        'import',
        'Import translations',
        'Paste or upload the translated rows. Check every change, then write them to the open page.',
        { tone: 'write', icon: 'pen', text: 'Changes AEM after you confirm' },
        () => {
          own.side = 'import';
          goStep('pick');
        }
      )
    );
    view.append(
      label('How it works'),
      list(
        [
          'Export the English page here. Nothing is written.',
          'Send the .xlsx to translators. They fill one Translation column.',
          'Use Copy a page to copy the English page to the target page.',
          'Open the target page and import the translations here.'
        ].map((text, i) => {
          const row = el('div', 'how-row');
          row.append(el('span', 'how-n', String(i + 1)), el('span', 'how-text', text));
          return row;
        })
      )
    );
    return;
  }

  /* The import keeps its own state under this tool's, so switching halves
     and coming back does not carry a half-filled form across. */
  if (own.side === 'import') {
    if (!own.import) own.import = imp.initialState(state);
    imp.render(
      {
        ...ctx,
        back: () => {
          own.side = null;
          own.import = null;
          goStep('pick');
        }
      },
      own.import
    );
    return;
  }

  /* ----------------------------------------------------------- the export */

  const phaseIndex = own.phase === 'running' ? 0 : { pick: 0, review: 1, sheet: 2 }[own.phase];
  view.append(stepBar(STEPS, phaseIndex));

  if (own.problem) {
    view.append(notice('err', 'That did not work', own.problem, 'warn'));
    view.append(logBox(own.log.lines, { open: true, title: 'What happened' }));
  }

  if (own.phase === 'pick') {

    if (state.page) {
      const card = el('div', 'page-card');
      card.dataset.selected = String(state.page.path === own.page);
      const ic = el('div', 'tool-icon');
      ic.append(icon('deck', 20));
      const text = el('div', 'tool-text');
      text.append(
        el('div', 'page-card-eyebrow', 'Page open in AEM'),
        el('div', 'page-card-title', state.page.title),
        el('div', 'page-card-path', state.page.path)
      );
      card.append(ic, text);
      if (state.page.path === own.page) {
        const tag = el('span', 'page-card-tag');
        tag.append(icon('check', 12, 3), el('span', null, 'Selected'));
        card.append(tag);
      }
      view.append(card);
    }

    const field = el('div', 'field');
    field.append(el('div', 'field-label', 'Page path'));
    const input = el('input');
    input.type = 'text';
    input.value = own.page;
    input.spellcheck = false;
    input.placeholder = '/content/samsung/uk/offers/spring-sale';
    input.setAttribute('aria-label', 'Page path');
    input.addEventListener('input', () => {
      own.page = input.value.trim();
      go.disabled = !own.page.startsWith('/content/');
    });
    field.append(input, el('div', 'field-hint', 'Filled in from the page open in this tab.'));
    view.append(field);
    view.append(notice('read', 'Read-only', 'Nothing is written to AEM.'));

    const go = button('Review', 'primary', doRead, { disabled: !own.page.startsWith('/content/') });
    footer.append(...footerBar({ buttons: [go] }));
    return;
  }

  if (own.phase === 'running') {
    view.append(notice('read', 'Reading the page…', 'Finding the text fields. Nothing is written.', 'eye'));
    const card = el('div', 'load-card');
    card.append(el('div', 'load-title', 'Reading the page'));
    const bar = el('div', 'load-bar');
    bar.append(el('div', 'load-bar-fill'));
    card.append(bar, el('div', 'load-path', own.page));
    view.append(card, skeleton(4));
    footer.append(...footerBar({ buttons: [busyButton('Working…')] }));
    return;
  }

  /* ------------------------------------------------------------ 2. review */

  const d = own.deck;
  /* A product page (PD) is read as rendered and has groups of its own -
     product name, gallery, features, specs. Its rows are picked by those
     groups, each text once; every other page by the authored groups. */
  const pd = d.mode === 'pd';
  const GROUPS = pd ? PD_CATEGORIES : CATEGORIES;
  const chosen = pd
    ? selectPdRows(d.rows, { categories: own.groups })
    : selectRows(d.rows, { categories: own.groups, includeInactive: own.includeInactive });
  const kept = chosen.filter((r) => !own.skipped.has(r.section));
  const sheetEntries = mergeRows(kept);
  const hiddenCount = pd ? 0 : places(d.rows.filter((r) => r.inactive));

  if (own.phase === 'review') {
    view.append(
      notice('read', 'Preview only · nothing is written', 'The sheet is built here, from what was read.')
    );

    const page = el('div', 'card page-summary');
    const text = el('div', 'tool-text');
    text.append(
      el('div', 'page-card-eyebrow', 'Page'),
      el('div', 'page-card-title', d.title || d.page.split('/').pop()),
      el('div', 'page-card-path', d.page),
      el('div', 'page-card-note', `${plural(places(d.rows), 'place')} with text`)
    );
    const change = el('button', 'label-action', 'Change');
    change.type = 'button';
    change.addEventListener('click', () => {
      own.deck = null;
      goStep('pick');
    });
    page.append(text, change);
    view.append(page);

    /* Text no rule puts on the sheet - a field of a component the copy deck
       does not know yet. Added, it goes on the sheet; ignored, it stops being
       asked about. Either is saved in Settings and the page is read again. */
    renderNewFields(view, d.newFields, {
      el,
      onChoose: async (kind, field) => {
        await chooseField(kind, field);
        doRead();
      }
    });

    /* Each component, and whether it goes. Searching narrows the list. */
    const bySection = new Map();
    for (const r of chosen) {
      if (!bySection.has(r.section)) bySection.set(r.section, []);
      bySection.get(r.section).push(r);
    }

    const needle = own.search.trim().toLowerCase();
    const rowHit = (r) =>
      String(r.value).toLowerCase().includes(needle) || String(r.field || r.prop || '').toLowerCase().includes(needle);
    /* Searching keeps only the rows that have the words. A component is
       kept when one of its rows does, or its own name does - then with only
       its matching rows, never the rest. */
    const sections = [...bySection.entries()]
      .map(([section, rows]) => [section, needle ? rows.filter(rowHit) : rows, rows])
      .filter(([section, shown]) => !needle || shown.length || section.toLowerCase().includes(needle));
    const hitPlaces = sections.reduce((n, [, shown]) => n + places(shown), 0);

    /* The search first, as the design draws it: a pill that says how many
       of the components it leaves. */
    const pill = el('div', 'search-pill');
    pill.dataset.on = String(!!needle);
    const search = el('input', 'deck-search');
    search.type = 'text';
    search.value = own.search;
    search.placeholder = 'Search component, label, property or text';
    search.setAttribute('aria-label', 'Search the text on this page');
    search.addEventListener('input', () => {
      own.search = search.value;
      Promise.resolve(redraw()).then(() => {
        const again = view.querySelector('.deck-search');
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      });
    });
    pill.append(icon('search', 18, 2), search);
    if (needle) {
      pill.append(el('span', 'search-count', plural(hitPlaces, 'place')));
      const clear = el('button', 'search-clear');
      clear.type = 'button';
      clear.setAttribute('aria-label', 'Clear search');
      clear.append(icon('close', 18, 2.2));
      clear.addEventListener('click', () => {
        own.search = '';
        redraw();
      });
      pill.append(clear);
    }

    /* Places the sheet fills, the rows it has, and how many places share one. */
    view.append(
      counts([
        { n: places(kept), label: 'places' },
        { n: sheetEntries.length, label: 'Excel rows' },
        { n: Math.max(0, places(kept) - sheetEntries.length), label: 'share a row' }
      ])
    );

    /* The kinds of text, each with how much of the page it is. */
    const groupRows = GROUPS.map((c) => {
      const n = pd
        ? selectPdRows(d.rows, { categories: [c.id] }).length
        : places(d.rows.filter((r) => r.category === c.id && (own.includeInactive || !r.inactive)));
      return tick(c.label, own.groups.has(c.id), n, n === 0, (on) => {
        if (on) own.groups.add(c.id);
        else own.groups.delete(c.id);
        redraw();
      });
    });
    if (hiddenCount) {
      groupRows.push(
        tick('Also include text not shown on the page', own.includeInactive, hiddenCount, false, (on) => {
          own.includeInactive = on;
          redraw();
        })
      );
    }
    if (pd) {
      /* A sibling SKU - the same model in another size or colour - shares its
         features with the representative SKU; only its gallery and specs are its own. */
      view.append(
        barRow('Product page · which SKU', [
          { text: 'Representative', onClick: () => { own.groups = new Set(SKU_PRESETS.rep); redraw(); } },
          { text: 'Sibling', onClick: () => { own.groups = new Set(SKU_PRESETS.sibling); redraw(); } }
        ])
      );
    }
    view.append(cardOf(titled('What goes on the sheet', groupRows)));

    const included = [...bySection.keys()].filter((k) => !own.skipped.has(k)).length;
    const openCount = [...bySection.keys()].filter((k) => own.opened.has(k)).length;
    view.append(
      barRow(`Components · ${included} of ${bySection.size} included`, [
        { text: 'Include all', onClick: () => { own.skipped.clear(); redraw(); } },
        {
          text: 'Exclude all',
          onClick: () => {
            for (const k of bySection.keys()) own.skipped.add(k);
            redraw();
          }
        }
      ]),
      barRow(`${openCount} of ${bySection.size} open`, [
        { text: 'Expand all', onClick: () => { own.opened = new Set(bySection.keys()); redraw(); } },
        { text: 'Collapse all', onClick: () => { own.opened = new Set(); redraw(); } }
      ])
    );

    /* The search sits right above what it filters, as the old extension had it. */
    view.append(pill);
    if (needle) {
      const said = el('div', 'deck-search-status');
      said.dataset.tone = hitPlaces ? 'ok' : 'warn';
      said.textContent = hitPlaces
        ? `${plural(hitPlaces, 'place')} on the sheet ${hitPlaces === 1 ? 'has' : 'have'} “${own.search.trim()}”.`
        : `Nothing on the sheet has “${own.search.trim()}”.`;
      view.append(said);
    }
    if (sections.length) {
      view.append(
        cardOf(list(sections.map(([section, shown, all]) => sectionBox(section, shown, own, needle, redraw, all))))
      );
    }

    footer.append(
      ...footerBar({
        tag: { kind: 'read', text: 'Preview only' },
        note: 'Nothing is written to AEM',
        buttons: [
          button('Build the sheet', 'primary', () => goStep('sheet'), { disabled: !sheetEntries.length }),
          button('Read the page again', 'ghost', doRead)
        ]
      })
    );
    return;
  }

  /* ------------------------------------------------------------- 3. sheet */

  /* Built once here too, for what it leaves off: a text longer than one Excel
     cell holds is kept off the sheet rather than the whole file refused. */
  const tooLong = buildSheet(kept, { pagePath: d.page, pd }).tooLong;
  const entryCount = sheetEntries.length - tooLong.length;
  const ready = el('div', 'ready-card');
  const head = el('div', 'ready-head');
  head.append(icon('check', 18, 2.4), el('span', null, 'Your sheet is ready'));
  const file = el('div', 'ready-file');
  const fileIc = el('div', 'ready-file-icon');
  fileIc.append(icon('deck', 22, 1.9));
  const fileText = el('div', 'ready-file-text');
  fileText.append(
    el('div', 'ready-file-name', fileName(d.page, new Date(), 'xlsx')),
    el('div', 'ready-file-sub', `${plural(entryCount, 'row')} · ${plural(places(kept), 'place')}`)
  );
  file.append(fileIc, fileText);
  ready.append(head, file);
  view.append(ready);

  if (own.said) view.append(notice(own.said.tone, own.said.title, own.said.body, own.said.icon));

  /* What the sheet leaves out: components taken off it. */
  const leftOff = [];
  for (const section of own.skipped) {
    const n = places(chosen.filter((r) => r.section === section));
    if (n) leftOff.push(kv(section, plural(n, 'place')));
  }
  for (const t of tooLong) {
    leftOff.push(kv(`${t.section} › ${String(t.field).split('\n')[0]}`, `${t.length.toLocaleString('en')} characters`));
  }
  if (tooLong.length) {
    view.append(
      notice(
        'warn',
        `${plural(tooLong.length, 'text')} too long for Excel`,
        `${tooLong.map((t) => `${t.section} › ${String(t.field).split('\n')[0]}`).join('; ')} - longer than the 32,767 characters one Excel cell holds, so left off the sheet. Translate ${tooLong.length === 1 ? 'it' : 'them'} in AEM by hand; the rest of the sheet is complete.`,
        'warn'
      )
    );
  }
  view.append(
    label("What's on it"),
    cardOf(
      list([
        kv('Page', d.page, true),
        kv('Texts', String(entryCount)),
        kv('Places', String(places(kept))),
        kv('Language', d.language || 'not set'),
        kv('Groups', [...own.groups].length === GROUPS.length ? 'All' : `${own.groups.size} of ${GROUPS.length}`)
      ])
    )
  );
  if (leftOff.length) view.append(label('Left off the sheet'), cardOf(list(leftOff)));

  footer.append(
    ...footerBar({
      tag: { kind: 'read', text: 'Reads only' },
      note: 'Nothing is written to AEM',
      buttons: [
        button('Download Excel', 'primary', () => save('xlsx')),
        button('Copy for Excel', 'ghost', copyForExcel),
        button('Download CSV', 'ghost', () => save('csv')),
        button('Change what goes on it', 'link', () => goStep('review'))
      ]
    })
  );

  /* ----------------------------------------------------------- the work */

  async function doRead() {
    own.problem = null;
    own.said = null;
    own.busy = 'read';
    goStep('running');
    try {
      own.deck = await runAction({
        featureId: 'copy-deck',
        action: 'read',
        params: { page: own.page, fields: JSON.stringify(await loadFields().catch(() => ({ add: [], ignore: [] }))) },
        settings: state.settings,
        tabId: state.tab?.id,
        onReport: (msg) => own.log.onReport(msg)
      });
      own.page = own.deck.page || own.page;
      const samePage = own.readFor === `${own.page}|${own.deck.mode}`;
      own.readFor = `${own.page}|${own.deck.mode}`;
      if (!samePage) own.groups = new Set(own.deck.mode === 'pd' ? SKU_PRESETS.rep : CATEGORIES.map((c) => c.id));
      if (!samePage) own.skipped = new Set();
      own.search = '';
      own.phase = 'review';
    } catch (e) {
      own.log?.add('fail', e.message);
      own.problem = e.message;
      own.phase = 'pick';
    }
    own.busy = null;
    toTop();
    redraw();
  }

  /** When the sheet was made, as the #END row and the "How to translate" tab both say it. */
  function stamp(dt) {
    const p = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
  }

  function sheetNow(now) {
    return buildSheet(kept, { pagePath: d.page, exportedAt: stamp(now), pd });
  }

  /** Hand the file to the browser's downloads. */
  function give(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function save(ext) {
    const now = new Date();
    try {
      const sheet = sheetNow(now);
      if (ext === 'csv') {
        give(toCsv(sheet), fileName(d.page, now, 'csv'), 'text/csv;charset=utf-8');
      } else {
        give(toXlsx(sheet, { pagePath: d.page, exportedAt: stamp(now), modified: now, pd }), fileName(d.page, now, 'xlsx'), XLSX_TYPE);
      }
      own.said = { tone: 'ok', title: 'Saved', body: fileName(d.page, now, ext), icon: 'check' };
    } catch (e) {
      /* A cell longer than Excel allows: nothing is saved, and the reason is
         said here rather than left to a silent failure. */
      own.said = { tone: 'err', title: 'Could not save', body: e.message, icon: 'warn' };
    }
    redraw();
  }

  async function copyForExcel() {
    const now = new Date();
    try {
      const sheet = sheetNow(now);
      const text = toTsv(sheet);
      const html = toHtmlTable(sheet);
      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' })
          })
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      own.said = { tone: 'ok', title: 'Copied', body: 'Paste into Excel with Ctrl+V.', icon: 'check' };
    } catch (e) {
      own.said = { tone: 'err', title: 'Could not copy', body: e.message, icon: 'warn' };
    }
    redraw();
  }
}

/* -------------------------------------------------------------- pieces */

/** One half of the tool, as a card of its own: what it is, and what it does to AEM. */
function choice(iconName, title, sub, tag, onClick) {
  const card = el('button', 'choice');
  card.type = 'button';
  const head = el('div', 'choice-head');
  const ic = el('div', 'choice-icon');
  ic.append(icon(iconName, 22, 1.9));
  const chev = el('span', 'choice-chev');
  chev.append(icon('next', 18, 2));
  head.append(ic, el('div', 'choice-title', title), chev);
  const chip = el('span', 'choice-chip');
  chip.dataset.tone = tag.tone;
  chip.append(icon(tag.icon, 13, 2.4), el('span', null, tag.text));
  const chipRow = el('div');
  chipRow.append(chip);
  card.append(head, el('div', 'choice-sub', sub), chipRow);
  card.addEventListener('click', onClick);
  return card;
}

/** A small line over a card: what it is on the left, what can be done to all of it on the right. */
function barRow(text, actions) {
  const row = el('div', 'bar-row');
  row.append(el('span', 'bar-text', text));
  const acts = el('span', 'bar-actions');
  for (const a of actions) {
    const b = el('button', 'bar-action', a.text);
    b.type = 'button';
    b.addEventListener('click', a.onClick);
    acts.append(b);
  }
  row.append(acts);
  return row;
}

/** A kind of text, with how many places of the page it covers. */
function tick(title, on, count, empty, onChange) {
  const wrap = el('label', 'deck-tick');
  if (empty) wrap.dataset.empty = 'true';
  const box = el('input');
  box.type = 'checkbox';
  box.checked = on;
  box.disabled = empty;
  box.setAttribute('aria-label', title);
  box.addEventListener('change', () => onChange(box.checked));
  wrap.append(box, el('span', 'deck-tick-title', title), el('span', 'deck-tick-count', String(count)));
  return wrap;
}

/** One component: its texts, and whether it goes on the sheet at all. */
/** The text with every place the words appear wrapped in a mark. */
function marked(text, needle) {
  const out = el('span');
  const value = String(text ?? '');
  if (!needle) {
    out.textContent = value;
    return out;
  }
  const low = value.toLowerCase();
  let at = 0;
  for (let i = low.indexOf(needle); i !== -1; i = low.indexOf(needle, at)) {
    if (i > at) out.append(value.slice(at, i));
    out.append(el('mark', 'deck-hit', value.slice(i, i + needle.length)));
    at = i + needle.length;
  }
  if (at < value.length) out.append(value.slice(at));
  return out;
}

function sectionBox(section, rows, own, needle, redraw, all = rows) {
  const excluded = own.skipped.has(section);
  const box = el('details', 'detail');
  box.open = own.opened.has(section) || !!needle;
  box.addEventListener('toggle', () => {
    if (needle) return;
    if (box.open) own.opened.add(section);
    else own.opened.delete(section);
  });

  const sum = el('summary');
  const tickBox = el('input');
  tickBox.type = 'checkbox';
  tickBox.checked = !excluded;
  tickBox.setAttribute('aria-label', `Include ${section}`);
  tickBox.addEventListener('click', (e) => e.stopPropagation());
  tickBox.addEventListener('change', () => {
    if (tickBox.checked) own.skipped.delete(section);
    else own.skipped.add(section);
    redraw();
  });
  const title = el('span', 'detail-title');
  title.append(marked(section, needle));
  sum.append(
    tickBox,
    title,
    el('span', 'detail-count', needle ? `${places(rows)} of ${places(all)}` : plural(places(rows), 'place'))
  );
  box.append(sum);

  for (const r of rows.slice(0, 20)) {
    const line = el('div', 'deck-row');
    const field = el('div', 'deck-row-field');
    field.append(marked(r.field || r.prop, needle));
    const text = el('div', 'deck-row-text');
    text.append(marked(r.value, needle));
    line.append(field, text);
    box.append(line);
  }
  if (rows.length > 20) box.append(el('div', 'deck-row-more', `and ${rows.length - 20} more`));
  return box;
}
