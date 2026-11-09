/**
 * Copy deck, the import half.
 *
 * A translated sheet comes back and is written onto the page. Four steps:
 * hand over the sheet, read what it would do, confirm, watch it run.
 *
 * The check is read-only and the whole point: a translation is only written
 * where the page still holds the English the sheet was made from. Everything
 * else is reported rather than forced - a row the page has moved on from, a
 * text that was never translated, a Static Content block that a person
 * applies by hand.
 */

import {
  IMPORT_STATUS,
  gridFromText,
  readSheet,
  sheetFile
} from '../../features/copy-deck/core.js';
import { readXlsx } from '../../features/copy-deck/xlsx.js';
import { icon } from '../icons.js';
import {
  button,
  busyButton,
  cardOf,
  connPill,
  counts,
  el,
  footerBar,
  kv,
  label,
  list,
  notice,
  runStep,
  skeleton,
  spinner,
  startingStep,
  stepBar,
  toTop,
  openInAem
} from '../parts.js';
import { logBox, makeLog } from '../log.js';
import { runAction } from '../run.js';

/* Four, as the design draws them: pasting and checking are what you do
   before anything is written, writing is the write with its confirmation, and
   done is done. */
const STEPS = ['Paste', 'Check', 'Write', 'Done'];
/* How long the ticking has to stop before the plan is checked again. */
const RECHECK_WAIT = 450;

/** The banner that replaces "preview only" while a tick is being answered. */
function recheckNotice() {
  const box = notice('read', 'Checking the page again', 'The counts below are the previous answer until it comes back.');
  box.replaceChild(spinner(), box.firstChild);
  return box;
}

/** Redraw without moving the page under whoever is reading it. */
function keepPlace(redraw) {
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  const back = () => window.scrollTo(0, y);
  return Promise.resolve(redraw()).then(() => {
    back();
    requestAnimationFrame(back);
  }, back);
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

/**
 * Why a sheet cannot be checked, read the way the worker will read it - or
 * null. Said as soon as it is pasted or chosen, rather than after a round
 * trip to the page.
 */
function sheetProblem(grid) {
  const sheet = readSheet(grid);
  if (!sheet.ok) return sheet.problem;
  if (!sheet.rows.length) return 'The sheet has a header but no rows.';
  return null;
}

/* The four things that can become of a row, in the order they matter. */
const GROUP_ORDER = ['blocked', 'manual', 'write', 'skip'];

export function initialState(state) {
  return {
    phase: 'sheet',
    page: state.page?.path || '',
    grid: null,
    sheetName: null,
    sheetProblem: null,
    plan: null,
    sections: null,
    /* What the search box holds, and which components are folded away. Both
       belong to this visit to the tool, not to the plan. */
    find: '',
    closed: [],
    result: null,
    problem: null,
    busy: null,
    steps: []
  };
}

export function render(ctx, own) {
  const { view, footer, state, back } = ctx;

  const redraw = () => ctx.render();
  /* Every line a run reports, kept so a failure leaves an account of itself
     (see ui/log.js). It lives on the tool's state, so leaving the tool drops
     it with everything else. */
  if (!own.log) own.log = makeLog(() => {
    if (own.phase === 'running') redraw();
  });

  const goStep = (phase) => {
    own.phase = phase;
    toTop();
    redraw();
  };

  const phaseIndex =
    own.phase === 'running'
      ? own.busy === 'apply'
        ? 2
        : 1
      : { sheet: 0, review: 1, confirm: 2, result: 3 }[own.phase];

  view.append(stepBar(STEPS, phaseIndex));
  if (own.problem) {
    view.append(notice('err', 'That did not work', own.problem, 'warn'));
    view.append(logBox(own.log.lines, { open: true, title: 'What happened' }));
  }

  /* ----------------------------------------------------------- 1. sheet */

  if (own.phase === 'sheet') {
    const mode = own.mode || 'paste';
    view.append(
      notice('read', 'Read-only until you confirm', 'Checking the sheet changes nothing on the page.')
    );

    /* Paste or a file: the same sheet by two routes, one shown at a time. */
    const seg = el('div', 'segmented');
    for (const [id, text] of [['paste', 'Paste from Excel'], ['file', 'Upload file']]) {
      const b = el('button', 'segment', text);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(mode === id));
      b.addEventListener('click', () => {
        if (mode === id) return;
        own.mode = id;
        redraw();
      });
      seg.append(b);
    }
    view.append(seg, label('Page'));

    const pageField = el('div', 'field');
    pageField.append(el('div', 'field-label', 'Page'));
    const pageInput = el('input');
    pageInput.type = 'text';
    pageInput.value = own.page;
    pageInput.spellcheck = false;
    pageInput.placeholder = '/content/samsung/levant_ar/offers/spring-sale';
    pageInput.setAttribute('aria-label', 'Page');
    pageInput.addEventListener('input', () => {
      own.page = pageInput.value.trim();
      sync();
    });
    pageField.append(
      pageInput,
      el('div', 'field-hint', 'Filled in from the page open in this tab · the page the translations are written to.')
    );
    view.append(pageField);

    if (mode === 'paste') {
      view.append(label('Translated sheet', { text: 'Choose a file instead', onClick: () => { own.mode = 'file'; redraw(); } }));

      const paste = el('div', 'field');
      const area = el('textarea', 'paste-area');
      area.placeholder = 'Paste the rows you copied from Excel';
      area.wrap = 'off';
      area.setAttribute('aria-label', 'Paste the translated sheet');
      area.addEventListener('input', () => {
        const text = area.value;
        if (!text.trim()) {
          own.grid = null;
          own.sheetName = null;
          own.sheetProblem = null;
        } else {
          own.grid = gridFromText(text);
          own.sheetName = `pasted · ${plural(own.grid.length - 1, 'row')}`;
          own.sheetProblem = sheetProblem(own.grid);
        }
        /* Redrawn only when what the status card says changes: a redraw
           replaces the box being typed into. */
        const said = `${own.sheetName}|${own.sheetProblem}`;
        if (said !== own.saidFor) {
          own.saidFor = said;
          drawStatus();
        }
        sync();
      });
      paste.append(area);
      view.append(paste);
    } else {
      /* A file is the same sheet by another route - and the one case where
         the corporate DRM can hand over bytes that are not a sheet at all. */
      view.append(label('Translated sheet'));
      const drop = el('label', 'drop-zone');
      const file = el('input');
      file.type = 'file';
      file.accept = '.xlsx,.csv,.tsv,.txt';
      file.addEventListener('change', () => readFile(file.files?.[0]));
      const dropIc = el('div', 'drop-icon');
      dropIc.append(icon('import', 26, 1.9));
      drop.append(
        dropIc,
        el('div', 'drop-title', 'Drop the translated .xlsx here'),
        el('div', 'drop-or', 'or'),
        el('span', 'drop-btn', 'Choose a file'),
        file
      );
      drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.dataset.over = 'true';
      });
      drop.addEventListener('dragleave', () => {
        drop.dataset.over = 'false';
      });
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.dataset.over = 'false';
        readFile(e.dataTransfer?.files?.[0]);
      });
      view.append(drop);
    }

    /* What was read, in a slot of its own so a paste can say it without
       redrawing the box it was pasted into. A sheet that cannot be read gets
       the reason, never a tick. */
    const status = el('div');
    view.append(status);
    drawStatus();
    function drawStatus() {
      status.replaceChildren();
      if (!own.sheetName) return;
      const line = (text, warn) => {
        const row = el('div', 'status-line');
        if (warn) row.dataset.tone = 'err';
        row.append(icon(warn ? 'warn' : 'check', 18, 2.2), el('span', null, text));
        return row;
      };
      if (own.sheetProblem) {
        status.append(cardOf(list([line(own.sheetName), line(own.sheetProblem, true)])));
        return;
      }
      const rows = Math.max(0, (own.grid?.length || 1) - 1);
      status.append(cardOf(list([line(own.sheetName), line(`${plural(rows, 'row')} read`)])));
    }

    if (mode === 'paste') {
      view.append(
        notice(
          'read',
          'Pasting, not a file',
          'In Excel press Ctrl+A then Ctrl+C on the translated sheet and paste it here. This works where the company DRM encrypts saved files.'
        )
      );
    }

    const go = button('Check the translation', 'primary', () => doCheck(), { disabled: !ready() });
    footer.append(
      ...footerBar({
        tag: { kind: 'read', text: 'Reads only' },
        note: ready() ? '1 page' : 'A page and a sheet are needed',
        buttons: [go, button('Back to the choice', 'ghost', back)]
      })
    );

    function ready() {
      return own.page.startsWith('/content/') && !!own.grid?.length && !own.sheetProblem;
    }
    function sync() {
      go.disabled = !ready();
      const note = footer.querySelector('.footer-note');
      if (note) note.textContent = ready() ? '1 page' : 'A page and a sheet are needed';
    }
    async function readFile(f) {
      if (!f) return;
      own.problem = null;
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        // What the bytes are, before they are read as anything: DRM, an old .xls, UTF-16 text, nothing at all.
        const kind = sheetFile(bytes, f.name);
        if (kind.problem) throw new Error(kind.problem);
        own.grid = kind.xlsx ? await readXlsx(bytes) : gridFromText(kind.text);
        own.sheetName = `${f.name} · ${plural(Math.max(0, own.grid.length - 1), 'row')}`;
        own.sheetProblem = sheetProblem(own.grid);
      } catch (e) {
        own.problem = e.message;
        own.grid = null;
        own.sheetName = null;
        own.sheetProblem = null;
      }
      redraw();
    }
    return;
  }

  /* ----------------------------------------------------------- running */

  if (own.phase === 'running') {
    const writing = own.busy === 'apply';
    if (!writing) {
      view.append(notice('read', 'Reading the rows…', 'Comparing each translation with the page. Nothing is written.', 'eye'));
      const card = el('div', 'load-card');
      card.append(el('div', 'load-title', 'Comparing rows'));
      const bar = el('div', 'load-bar');
      bar.append(el('div', 'load-bar-fill'));
      card.append(bar, el('div', 'load-path', own.page));
      view.append(card, skeleton(4));
    } else {
      view.append(notice('write', 'Writing the translations', 'Keep this panel open until it finishes.', 'pen'));
      view.append(label('Steps'));
      /* The run goes in order, so when no step says it is running, the first
         one not done is the one under way - never finished work above and
         nothing moving below. */
      const shown = own.steps.map((x) => ({ ...x }));
      if (!shown.some((x) => x.state === 'running')) {
        const next = shown.find((x) => x.state === 'todo' || !x.state);
        if (next) next.state = 'running';
        else if (shown.length) shown.push({ name: 'Finishing up', state: 'running' });
      }
      view.append(cardOf(list(shown.length ? shown.map(runStep) : [startingStep()])));
    }
    footer.append(
      ...footerBar({
        tag: writing ? { kind: 'write', text: 'Writing to AEM' } : { kind: 'read', text: 'Read-only' },
        note: writing ? 'Keep this panel open' : 'Nothing is written',
        buttons: [busyButton(writing ? 'Writing…' : 'Working…')]
      })
    );
    return;
  }

  /* ---------------------------------------------------------- 2. review */

  const plan = own.plan;
  const byGroup = new Map(GROUP_ORDER.map((g) => [g, []]));
  for (const r of plan?.rows || []) {
    const group = IMPORT_STATUS[r.status]?.group || 'blocked';
    byGroup.get(group).push(r);
  }
  const willWrite = (plan?.writes || []).length;

  if (own.phase === 'review') {
    /* Checked again because a component was ticked. The counts below are the
       previous answer until it comes back, which the banner says. */
    const stale = own.rechecking || own.recheckWanted;
    view.append(
      stale
        ? recheckNotice()
        : notice(
            'read',
            'Preview only · nothing is written yet',
            'Each row is checked against what the page holds now.'
          )
    );

    const page = el('div', 'card page-summary');
    const text = el('div', 'tool-text');
    text.append(
      el('div', 'page-card-eyebrow', 'Page'),
      el('div', 'page-card-title', plan.title || plan.pagePath.split('/').pop()),
      el('div', 'page-card-path', plan.pagePath)
    );
    const from = plan.exportedFrom && plan.exportedFrom !== plan.pagePath ? plan.exportedFrom : null;
    text.append(
      el(
        'div',
        'page-card-note',
        `${from ? `Sheet from ${from} · ` : ''}${plural((plan.rows || []).length, 'row')} read`
      )
    );
    const change = el('button', 'label-action', 'Change');
    change.type = 'button';
    change.addEventListener('click', () => {
      own.plan = null;
      goStep('sheet');
    });
    page.append(text, change);
    view.append(page);

    if (from) {
      view.append(
        notice(
          'warn',
          'The sheet came from another page',
          `It was exported from ${from}. Only rows whose English is still on this page are written.`,
          'warn'
        )
      );
    }

    for (const w of plan.warnings || []) view.append(notice('warn', 'Worth a look', w, 'warn'));

    /* The rows under the component they belong to, each component with its own
       tick box - which is what the tick box is about, so it belongs on the
       component rather than in a list of its own further down. The rows that
       need a person gather at the end, under one heading, because they are the
       only ones that stop anything. */
    const chosen = new Set(own.sections ?? plan.selected ?? []);
    const sections = plan.sections || [];
    const bySection = new Map(sections.map((x) => [x.id, []]));
    const attention = [];
    for (const r of plan.rows || []) {
      if ((IMPORT_STATUS[r.status]?.group || 'blocked') === 'blocked') {
        attention.push(r);
        continue;
      }
      if (!bySection.has(r.section)) bySection.set(r.section, []);
      bySection.get(r.section).push(r);
    }

    /* Looking for one text on a page of 145 means scrolling past 144 of them,
       so the list can be narrowed instead. The search is over what is on
       screen - component, field and either text - and never over the keys,
       which nobody reads. */
    const find = (own.find || '').trim().toLowerCase();
    const matches = (r) =>
      !find ||
      [r.section, r.field, r.current, r.sheetSource, r.translation, `#${r.sheetRowNo ?? ''}`]
        .some((v) => String(v ?? '').toLowerCase().includes(find));

    if (sections.length) {
      view.append(
        label('Sections', {
          text: chosen.size === sections.length ? 'Select none' : 'Select all',
          onClick: () => {
            own.sections = chosen.size === sections.length ? [] : sections.map((x) => x.id);
            scheduleRecheck();
          }
        })
      );
      const search = el('div', 'imp-search');
      const box = el('input');
      box.type = 'search';
      box.placeholder = 'Search component, field or text';
      box.value = own.find || '';
      box.setAttribute('aria-label', 'Search the rows');
      box.addEventListener('input', () => {
        own.find = box.value;
        /* Redrawn where it is, so the box keeps the cursor and the page does
           not jump to the top on every letter. */
        keepPlace(redraw).then(() => {
          const again = view.querySelector('.imp-search input');
          if (again) {
            again.focus();
            again.setSelectionRange(again.value.length, again.value.length);
          }
        });
      });
      search.append(box);
      view.append(search);
    }

    const card = el('div', 'sec-stack');
    let shown = 0;
    const group = (sec, rows, ticked, onChange, tone) => {
      const hits = rows.filter(matches);
      if (find && !hits.length && !String(sec.id || '').toLowerCase().includes(find)) return;
      shown += hits.length;
      const open = find ? true : (own.opened || []).includes(sec.id);
      const box = el('div', 'list sec cd-card');
      box.append(sectionHead(sec, hits.length, ticked, onChange, tone, open, () => {
        const opened = new Set(own.opened || []);
        if (opened.has(sec.id)) opened.delete(sec.id);
        else opened.add(sec.id);
        own.opened = [...opened];
        keepPlace(redraw);
      }));
      if (open) {
        for (const r of hits.slice(0, ROWS_PER_SECTION)) box.append(rowLine(r));
        if (hits.length > ROWS_PER_SECTION) {
          box.append(el('div', 'deck-row-more', `and ${hits.length - ROWS_PER_SECTION} more here`));
        }
      }
      card.append(box);
    };

    for (const sec of sections) {
      group(sec, bySection.get(sec.id) || [], chosen.has(sec.id), (on) => {
        const next = new Set(chosen);
        if (on) next.add(sec.id);
        else next.delete(sec.id);
        own.sections = [...next];
        scheduleRecheck();
      });
    }
    /* A row whose section the sheet does not name - it is still a row. */
    for (const [id, rows] of bySection) {
      if (sections.some((x) => x.id === id) || !rows.length) continue;
      group({ id }, rows, null, null);
    }
    if (attention.length) group({ id: 'Needs attention' }, attention, null, null, 'warn');

    if (find && !shown) {
      view.append(notice('read', 'Nothing matches', `No row holds “${own.find.trim()}”.`));
    } else if (card.childElementCount) {
      view.append(card);
    }

    if (sections.some((x) => x.static)) {
      view.append(
        notice(
          'read',
          'Only ticked sections are written',
          'A Static Content block starts unticked. Ticked, DSY writes its Body (HTML); unticked, paste the Body ' +
            'by hand from the done screen.'
        )
      );
    }

    footer.append(
      ...footerBar({
        tag: { kind: 'write', text: 'Changes AEM' },
        note: sections.length ? `${chosen.size} of ${sections.length} sections ticked` : '',
        buttons: [
          button(
            stale
              ? 'Checking the page again…'
              : willWrite
                ? `Write ${plural(willWrite, 'translation')}`
                : 'Nothing to write',
            'primary',
            () => goStep('confirm'),
            { disabled: !willWrite || stale }
          ),
          button('Check the page again', 'ghost', () => doCheck())
        ]
      })
    );
    return;
  }

  /* --------------------------------------------------------- 3. confirm */

  if (own.phase === 'confirm') {
    /* Counted for the sections that will be written, not the whole sheet. A
       ticked Static Content block has its Body written by DSY, so its rows are
       not left to do by hand; an unticked one is pasted by hand from the done
       screen, so its rows are. Rows that cannot be written count only where
       their section is ticked. */
    const chosenNow = new Set(own.sections ?? plan.selected ?? []);
    const staticIds = new Set((plan.sections || []).filter((x) => x.static).map((x) => x.id));
    const byHandRows = byGroup.get('manual').filter((r) => staticIds.has(r.section) && !chosenNow.has(r.section));
    const leftAloneRows = byGroup.get('blocked').filter((r) => chosenNow.has(r.section));
    view.append(
      notice('write', 'This will change content in AEM', 'The translations go straight onto the page.', 'pen'),
      label('Check before you confirm'),
      cardOf(list(
        [
          kv('Server', String(state.origin || '').replace(/^https?:\/\//, ''), true),
          kv('Page', plan.pagePath, true),
          kv('Will write', plural(willWrite, 'value')),
          byHandRows.length ? kv('By hand afterwards', plural(byHandRows.length, 'row')) : null,
          leftAloneRows.length ? kv('Left alone', plural(leftAloneRows.length, 'row')) : null,
          kv('Child pages', 'Never touched')
        ].filter(Boolean)
      )),
      notice(
        'warn',
        'No version is saved first',
        'The page keeps whatever it had only if you saved a version yourself.',
        'warn'
      )
    );

    footer.append(
      ...footerBar({
        tag: { kind: 'write', text: 'Writes to AEM' },
        note: `${plural(willWrite, 'value')} · 1 page`,
        buttons: [
          button(`Write ${plural(willWrite, 'translation')}`, 'write', doApply, { iconName: 'pen' }),
          button('Back to preview', 'ghost', () => goStep('review'))
        ]
      })
    );
    return;
  }

  /* ---------------------------------------------------------- 4. result */

  const r = own.result || {};
  const wrote = r.written ?? willWrite;
  /* The same rule as the confirm screen: only the sections that were written.
     A ticked Static Content block had its Body written, so it is not by hand. */
  const chosenAtRun = new Set(own.sections ?? plan?.selected ?? []);
  const staticAtRun = new Set((plan?.sections || []).filter((x) => x.static).map((x) => x.id));
  const leftByHand = byGroup.get('manual').filter((x) => staticAtRun.has(x.section) && !chosenAtRun.has(x.section)).length;

  view.append(
    r.confirmed === false
      ? notice('warn', 'Written, but not confirmed', 'The write was accepted but reading the page back did not confirm it. Open the page and check.', 'warn')
      : notice('ok', 'Translations written', `${plural(wrote, 'value')} written to the page.`, 'check')
  );

  const attention = byGroup.get('blocked').filter((x) => chosenAtRun.has(x.section)).length;
  view.append(
    counts([
      { n: wrote, label: 'written', tone: 'ok' },
      ...(attention ? [{ n: attention, label: 'needs attention', tone: 'warn' }] : []),
      ...(leftByHand ? [{ n: leftByHand, label: 'by hand', tone: 'warn' }] : [])
    ])
  );

  view.append(
    label('What happened'),
    cardOf(list(
      [
        kv('Page', plan?.pagePath || own.page, true),
        kv('Written', String(wrote)),
        attention ? kv('Needs attention', String(attention)) : null,
        leftByHand ? kv('To apply by hand', String(leftByHand)) : null,
        kv('Server', String(state.origin || '').replace(/^https?:\/\//, ''), true)
      ].filter(Boolean)
    ))
  );

  if (leftByHand) {
    view.append(
      notice(
        'warn',
        'Static Content blocks are applied by hand',
        'Their Body is prepared for you - open the block in AEM and paste it in.',
        'warn'
      )
    );
  }

  /* The account of the run, under its result. */
  view.append(logBox(own.log.lines));

  footer.append(
    ...footerBar({
      buttons: [
        button('Open the page in AEM', 'primary', () => {
          openInAem(state.origin, `/editor.html${plan?.pagePath || own.page}.html`);
        }),
        button('Check the page again', 'ghost', () => doCheck()),
        button('Back to the choice', 'link', back)
      ]
    })
  );

  /* ---------------------------------------------------------- the work */

  function params() {
    return {
      page: own.page,
      sheet: JSON.stringify(own.grid || []),
      sections: own.sections
    };
  }

  /* Ticking a component changes which writes the plan holds, so it is checked
     again - but the review stays up while that happens, boxes and all. The
     old panel did not throw the screen away for a tick and neither does this
     one; several ticks in a row cost one check. */
  function scheduleRecheck() {
    own.recheckWanted = true;
    clearTimeout(own.recheckTimer);
    own.recheckTimer = setTimeout(runRecheck, RECHECK_WAIT);
    keepPlace(redraw);
  }

  async function runRecheck() {
    if (own.rechecking || own.phase !== 'review') return;
    own.recheckWanted = false;
    await doCheck({ inPlace: true });
    if (own.recheckWanted && own.phase === 'review') runRecheck();
  }

  async function doCheck({ inPlace = false } = {}) {
    own.log?.clear();
    own.problem = null;
    own.busy = 'check';
    own.steps = [{ name: 'Reading the page and the sheet', state: 'running' }];
    if (inPlace) {
      own.rechecking = true;
      keepPlace(redraw);
    } else {
      clearTimeout(own.recheckTimer);
      own.recheckWanted = false;
      goStep('running');
    }
    try {
      own.plan = await runAction({
        featureId: 'copy-deck-import',
        action: 'check',
        params: params(),
        settings: state.settings,
        tabId: state.tab?.id,
        onReport: (msg) => own.log.onReport(msg)
      });
      own.sections = own.plan.selected || null;
      own.phase = 'review';
    } catch (e) {
      own.log?.add('fail', e.message);
      own.problem = e.message;
      /* A failure is worth seeing from the top, wherever it came from. */
      own.phase = 'sheet';
      inPlace = false;
    }
    own.busy = null;
    own.rechecking = false;
    if (inPlace) {
      keepPlace(redraw);
      return;
    }
    toTop();
    redraw();
  }

  async function doApply() {
    own.log?.clear();
    own.problem = null;
    own.busy = 'apply';
    /* The worker's own step ids (copy-deck-import/worker.js apply): a step
       it reports that is not listed here is never shown moving. */
    own.steps = [
      { id: 'recheck', name: 'Checking the page has not moved on', state: 'running' },
      { id: 'lock', name: 'Checking nobody else has the page locked', state: 'todo' },
      { id: 'write', name: 'Writing the translations', state: 'todo' },
      { id: 'verify', name: 'Reading the page back', state: 'todo' }
    ];
    goStep('running');
    try {
      own.result = await runAction({
        featureId: 'copy-deck-import',
        action: 'apply',
        params: { ...params(), approved: own.plan.approved },
        settings: state.settings,
        tabId: state.tab?.id,
        onReport: (msg) => {
          own.log.onReport(msg);
          if (msg.level !== 'data' || msg.message !== 'step' || !msg.data?.id) return;
          const s = own.steps.find((x) => x.id === msg.data.id);
          if (!s) return;
          s.state = msg.data.state;
          // The worker counts the values as a bare number; on screen it needs its word.
          const note = msg.data.note;
          s.note = /^\d+$/.test(String(note ?? '')) ? plural(Number(note), 'value') : note;
          if (own.phase === 'running') redraw();
        }
      });
      own.phase = 'result';
    } catch (e) {
      own.log?.add('fail', e.message);
      own.problem = e.message;
      own.phase = 'review';
    }
    own.busy = null;
    toTop();
    redraw();
  }
}

/** One row of the sheet, and what becomes of it. */
/* How many of a section's rows are listed before the rest are counted. */
const ROWS_PER_SECTION = 12;

/**
 * A component's heading inside the list: its tick box, its name and how many
 * rows it holds.
 *
 * The tick belongs here rather than in a list of components of its own: what
 * it decides is whether THESE rows are written, and that is only obvious with
 * them underneath it.
 */
function sectionHead(sec, count, ticked, onChange, tone, open, onToggle) {
  const row = el('div', 'sec-head');
  if (tone) row.dataset.tone = tone;

  /* The tick and the fold are two different decisions, so they are two
     different controls: a label wrapping both would fold the section every
     time someone meant to tick it. */
  if (onChange) {
    const tick = el('label', 'sec-tick');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !!ticked;
    box.setAttribute('aria-label', `Write ${sec.id}`);
    box.addEventListener('change', () => onChange(box.checked));
    tick.append(box);
    row.append(tick);
  } else {
    row.append(el('span', 'sec-nobox'));
  }

  const name = el(onToggle ? 'button' : 'div', 'sec-open');
  if (onToggle) {
    name.type = 'button';
    name.setAttribute('aria-expanded', String(!!open));
    name.addEventListener('click', onToggle);
  }
  name.append(el('span', 'sec-name', sec.id || 'Page'));
  if (sec.static) name.append(el('span', 'link-tag', 'Static block'));
  name.append(el('span', 'sec-count', String(count)));
  if (onToggle) {
    const mark = el('span', 'sec-caret');
    mark.dataset.open = String(!!open);
    mark.setAttribute('aria-hidden', 'true');
    name.append(mark);
  }
  row.append(name);
  return row;
}

/** One text of the row, under its own small label. */
function impText(tag, value, cls) {
  const box = el('div', `imp-line${cls ? ` ${cls}` : ''}`);
  if (tag) box.append(el('span', 'imp-tag', tag));
  box.append(el('span', 'imp-text', shorten(value)));
  return box;
}

const MAX_SHOWN = 300;
const shorten = (v) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_SHOWN ? `${t.slice(0, MAX_SHOWN - 1)}…` : t;
};

/**
 * One row of the review: where it is, what becomes of it, and the texts it is
 * about.
 *
 * A row is a decision, and a decision cannot be made from a status alone -
 * "the page changed since the export" is only useful next to the two texts
 * that differ. So a blocked row shows the sheet's English and the page's, and
 * a row about to be written shows what is there now and what would replace it.
 */
function rowLine(r) {
  const group = IMPORT_STATUS[r.status]?.group || 'blocked';
  const line = el('div', 'imp-row');
  line.dataset.group = group;

  const head = el('div', 'imp-head');
  /* The sheet row, so a row can be found in the Excel file in front of
     whoever is reading this. */
  if (r.sheetRowNo) head.append(el('span', 'imp-no', `#${r.sheetRowNo}`));
  head.append(el('span', 'imp-where', r.field || r.section || 'Page'));
  line.append(head);

  const now = r.current ?? '';
  const sheet = r.sheetSource ?? '';
  const to = r.translation ?? '';

  /* The page moved on: two Englishes, which need naming to be told apart.
     Every other row is the English and its translation, one under the other,
     and needs no labels to be read that way. */
  if (r.status === 'changed' && sheet && now && sheet !== now) {
    line.append(impText('Sheet', sheet, 'imp-was'), impText('Page now', now));
  } else if (now) {
    line.append(impText('', now, 'imp-was'));
  }
  if (to && to !== now) line.append(impText('', to, 'imp-to'));
  if (r.message) line.append(el('div', 'imp-why', r.message));
  const pill = el('div', 'imp-pill-row');
  pill.append(el('span', 'imp-status', IMPORT_STATUS[r.status]?.label || r.status));
  line.append(pill);
  return line;
}
