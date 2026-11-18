/**
 * Arabic flipping fixer, drawn the way the Relative Link Fixer is.
 *
 * Five steps: pick the page, review the fields the scan found, confirm what
 * will be written, watch it run, read the result. The scan reads only;
 * nothing is written until the amber button on Confirm.
 *
 * The scan's own data decides every number on screen - none of it is kept
 * from one step to the next except the scan result and which fields are
 * ticked, so what gets written cannot drift from what was approved.
 *
 * Beside the scan there is the Flipping Converter itself, for text pasted by
 * hand: Static (text or HTML, with its options) and PDP (specifications).
 * It never touches AEM - the fixed text is copied and pasted back by hand.
 */

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
  startingStep,
  stepBar,
  toTop,
  whatHappens
} from '../parts.js';
import { logBox, makeLog } from '../log.js';
import { runAction } from '../run.js';
import { loadFields } from '../../features/copy-deck/fields.js';
import {
  COMMA_CONTEXT,
  LRM,
  RLM,
  commasToDots,
  convert,
  convertPdp,
  decimalCommas,
  flipRuns,
  removeMarks,
  rulesFor,
  runsAsIs,
  scriptTexts,
  stripMarks
} from '../../features/arabic-fixer/bidi.js';

const STEPS = ['Pick', 'Review', 'Confirm', 'Run', 'Result'];
const SHOW_RUNS = 4;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

/** A field that is never ticked for you and is called out on the review. */
const flagged = (i) => i.liveCopy || i.script;

/** The ticked fields, in the shape `fix` wants. */
const picksFrom = (issues, ticked) =>
  issues.filter((i) => ticked.has(i.key)).map((i) => ({ node: i.node, prop: i.prop, expect: i.from, to: i.to }));

/** The fields the copy deck adds or ignores, so the scan reads the page the way the sheet does. */
const fieldsParam = async () => JSON.stringify(await loadFields().catch(() => ({ add: [], ignore: [] })));

function untouchedNote(untouched, needLook) {
  if (!untouched) return 'Nothing - every field is ticked';
  if (needLook >= untouched) return `${plural(untouched, 'field')}, all flagged for a look`;
  if (!needLook) return `${plural(untouched, 'field')} left as ${untouched === 1 ? 'it is' : 'they are'}`;
  return `${plural(untouched, 'field')}, ${needLook} flagged for a look`;
}

export async function render(ctx) {
  const { view, footer, state, goHome } = ctx;

  const own = ctx.own;
  if (!own.log) own.log = makeLog(() => {
    if (own.phase === 'running') redraw();
  });

  if (!own.phase) {
    Object.assign(own, {
      phase: 'pick',
      page: null,
      scan: null,
      ticked: new Set(),
      opened: new Set(),
      result: null,
      problem: null,
      steps: [],
      busy: null
    });
  }

  if (own.page == null) own.page = state.page?.path || '';

  const redraw = () => ctx.render();
  const goStep = (phase) => {
    own.phase = phase;
    toTop();
    redraw();
  };
  // The units and names in Settings, the same lists the worker fixes with.
  const rules = rulesFor(state.settings);

  /* ---------------------------------------------------------- by hand */

  if (own.phase === 'manual') {
    manualScreen({ view, footer, own, rules, redraw, back: () => goStep('pick') });
    return;
  }

  const phaseIndex =
    own.phase === 'running' ? (own.busy === 'fix' ? 3 : 0) : { pick: 0, review: 1, confirm: 2, result: 4 }[own.phase];

  view.append(
    connPill({
      host: hostOf(state.origin),
      signedIn: !state.session || state.session.state === 'in' || state.session.state === 'unknown'
    }),
    stepBar(STEPS, phaseIndex)
  );

  if (own.problem) {
    view.append(notice('err', 'That did not work', own.problem, 'warn'));
    view.append(logBox(own.log.lines, { open: true, title: 'What happened' }));
  }

  const issues = own.scan?.issues || [];

  /* ------------------------------------------------------------ 1. pick */

  if (own.phase === 'pick') {
    view.append(
      notice('read', 'Preview only', 'Scanning only reads the page. Nothing is written.'),
      label('Which page?')
    );

    if (state.page) {
      const card = el('div', 'page-card');
      card.dataset.selected = String(state.page.path === own.page);
      const ic = el('div', 'tool-icon');
      ic.append(icon('bidi', 20));
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
      } else {
        const use = el('button', 'label-action', 'Use this');
        use.type = 'button';
        use.addEventListener('click', () => {
          own.page = state.page.path;
          redraw();
        });
        card.append(use);
      }
      view.append(card);
    }

    const field = el('div', 'field');
    field.append(el('div', 'field-label', 'Page path'));
    const input = el('input');
    input.type = 'text';
    input.value = own.page;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Page path');
    input.placeholder = '/content/samsung/sa/smartphones/galaxy-s25-ultra';
    input.addEventListener('input', () => {
      own.page = input.value.trim();
      scanBtn.disabled = !own.page.startsWith('/content/');
    });
    field.append(input);
    field.append(
      el('div', 'field-hint', 'Filled in from the page open in AEM. Its copy is read the way Copy deck reads it.')
    );
    view.append(field);

    view.append(
      ...whatHappens([
        ['deck', 'Reads the page’s copy the same way Copy deck does.'],
        ['bidi', 'Finds English and numbers that show in the wrong order inside Arabic text. Before: 12 MP F2.2 shows as MP F2.2 12.'],
        ['check', 'For the fields you tick, it adds an invisible mark so the text shows correctly. After: it shows as 12 MP F2.2 again. The words do not change, and the page is read back to check.'],
        ['globe', 'Only Arabic pages are changed. The words stay as they are; a decimal comma becomes a dot (1,5 becomes 1.5).'],
        ['eye', 'Nothing is written until you review and confirm.']
      ])
    );

    const scanBtn = button('Scan this page', 'primary', doScan, {
      disabled: !own.page.startsWith('/content/')
    });
    /* The other way in: text pasted by hand, Static or PDP, as the Flipping
       Converter takes it - for a PD page, a dialog not on the copy deck, or
       a sheet. Nothing is written; the fixed text is copied back by hand. */
    const byHand = button('Fix pasted text instead · Static or PDP', 'ghost', () => goStep('manual'));
    footer.append(
      ...footerBar({
        tag: { kind: 'read', text: 'Preview only' },
        note: 'No changes yet',
        buttons: [scanBtn, byHand]
      })
    );
    return;
  }

  /* --------------------------------------------------------- 2. review */

  if (own.phase === 'review') {
    const needLook = issues.filter(flagged);
    const tickedCount = own.ticked.size;
    const lookUnticked = needLook.filter((i) => !own.ticked.has(i.key)).length;
    const nothingFound = !issues.length;

    view.append(
      nothingFound
        ? notice(
            'ok',
            'Nothing flips',
            own.scan.arabic
              ? `All ${plural(own.scan.arabic, 'field')} on this Arabic page are already fixed. Nothing was written.`
              : `No Arabic text in the ${plural(own.scan.fields, 'copy field')} on this page. Nothing was written.`,
            'check'
          )
        : notice('read', 'Preview only · nothing is written', 'You confirm before anything changes.')
    );

    const page = el('div', 'card page-summary');
    const text = el('div', 'tool-text');
    text.append(
      el('div', 'page-card-eyebrow', 'Page'),
      el('div', 'page-card-title', own.scan.title || own.page.split('/').pop()),
      el('div', 'page-card-path', own.scan.page || own.page),
      el(
        'div',
        'page-card-note',
        nothingFound
          ? `${plural(own.scan.arabic, 'field')} read`
          : `${plural(issues.length, 'field')} of ${own.scan.arabic} ${issues.length === 1 ? 'flips' : 'flip'}`
      )
    );
    const change = el('button', 'label-action', 'Change');
    change.type = 'button';
    change.addEventListener('click', () => {
      own.phase = 'pick';
      own.scan = null;
      own.ticked.clear();
      redraw();
    });
    page.append(text, change);
    view.append(page);

    if (nothingFound) {
      footer.append(
        ...footerBar({
          tag: { kind: 'read', text: 'Preview only' },
          note: 'Nothing was written',
          buttons: [
            button('Scan another page', 'primary', () => {
              own.scan = null;
              own.ticked.clear();
              goStep('pick');
            }),
            button('Scan this page again', 'ghost', doScan),
            button('Back to tools', 'link', () => {
              reset(own);
              goHome();
            })
          ]
        })
      );
      return;
    }

    view.append(
      counts([
        { n: tickedCount, label: 'to fix' },
        { n: lookUnticked, label: 'need a look', tone: lookUnticked ? 'warn' : null },
        { n: issues.length - tickedCount - lookUnticked, label: 'left alone' }
      ])
    );

    if (needLook.length) {
      const scriptN = needLook.filter((i) => i.script).length;
      const liveN = needLook.filter((i) => !i.script && i.liveCopy).length;
      const warn = el('div', 'notice-stack');
      const line = (iconName, strong, rest) => {
        const row = el('div', 'notice-line');
        row.append(icon(iconName, 18, 2));
        const span = el('span');
        span.append(el('b', null, strong), document.createTextNode(' ' + rest));
        row.append(span);
        warn.append(row);
      };
      if (scriptN) {
        line(
          'warn',
          `${plural(scriptN, 'field')} ${scriptN === 1 ? 'is' : 'are'} a Static Content script.`,
          'Marks go only inside its strings, but a script that compares or splits that text can break. ' +
            (scriptN === 1 ? 'It is unticked.' : 'They are unticked.')
        );
      }
      if (liveN) {
        line(
          'history',
          `${plural(liveN, 'field')} ${liveN === 1 ? 'is' : 'are'} on an inherited component.`,
          'Fixing breaks inheritance for that property, so they are unticked.'
        );
      }
      view.append(warn);
    }

    /* One accordion a component, as the copy deck lists them, each field's
       text in full inside it. */
    const bySection = new Map();
    for (const i of issues) bySection.set(i.section, [...(bySection.get(i.section) || []), i]);
    const openCount = [...bySection.keys()].filter((k) => own.opened.has(k)).length;
    view.append(
      barRow(`Fields · ${tickedCount} of ${issues.length} ticked`, [
        { text: 'Select all', onClick: () => { for (const i of issues) own.ticked.add(i.key); redraw(); } },
        { text: 'Select none', onClick: () => { own.ticked.clear(); redraw(); } }
      ]),
      barRow(`${openCount} of ${bySection.size} open`, [
        { text: 'Expand all', onClick: () => { own.opened = new Set(bySection.keys()); redraw(); } },
        { text: 'Collapse all', onClick: () => { own.opened = new Set(); redraw(); } }
      ]),
      legend(),
      cardOf(list([...bySection].map(([section, items]) => sectionBox(section, items, own, redraw, rules))))
    );

    footer.append(
      ...footerBar({
        tag: { kind: 'read', text: 'Preview only' },
        note: `${tickedCount} of ${issues.length} selected`,
        buttons: [
          button(
            tickedCount ? `Continue with ${plural(tickedCount, 'field')}` : 'Tick a field to continue',
            'primary',
            () => goStep('confirm'),
            { disabled: !tickedCount }
          ),
          button('Scan again', 'ghost', doScan)
        ]
      })
    );
    return;
  }

  /* -------------------------------------------------------- 3. confirm */

  if (own.phase === 'confirm') {
    const tickedCount = own.ticked.size;
    const needLook = issues.filter((i) => flagged(i) && !own.ticked.has(i.key)).length;
    const scanned = hostOf(own.scanned?.origin || state.origin);
    const front = hostOf(state.origin);
    // Marks the page does not have yet - one already in place is not added again.
    const marks = issues.filter((i) => own.ticked.has(i.key)).reduce((n, i) => n + Math.max(0, netMarks(i.to) - netMarks(i.from)), 0);
    const commas = issues.filter((i) => own.ticked.has(i.key)).reduce((n, i) => n + (i.commas || 0), 0);

    view.append(notice('write', 'This will change content in AEM', 'Changes go straight to the server below.', 'pen'));
    if (front && scanned && front !== scanned) {
      view.append(
        notice('warn', `The tab in front is on ${front}`, `This writes to ${scanned}, where the page was scanned.`, 'warn')
      );
    }
    view.append(
      label('Check before you confirm'),
      list([
        kv('Server', scanned, true),
        kv('Page', own.scan.page || own.page, true),
        kv('Will change', `${plural(tickedCount, 'field')} on this page`),
        ...(marks ? [kv('Adds', `${plural(marks, 'invisible mark')} - no visible text changes`)] : []),
        ...(commas ? [kv('Replaces', `${plural(commas, 'decimal comma')} with ${commas === 1 ? 'a dot' : 'dots'} - 1,5 becomes 1.5`)] : []),
        kv('Will not change', untouchedNote(issues.length - tickedCount, needLook))
      ])
    );

    footer.append(
      ...footerBar({
        tag: { kind: 'write', text: 'Writes to AEM' },
        note: `${plural(tickedCount, 'field')} · 1 page`,
        buttons: [
          button(`Change ${plural(tickedCount, 'field')} in AEM`, 'write', doFix, { iconName: 'pen' }),
          button('Back to preview', 'ghost', () => goStep('review'))
        ]
      })
    );
    return;
  }

  /* ------------------------------------------------------------ 4. run */

  if (own.phase === 'running') {
    const writing = own.busy === 'fix';
    view.append(
      writing
        ? notice('write', 'Writing to AEM', 'Leave this tab open until it finishes.', 'pen')
        : notice('read', 'Reading the page', 'Nothing is written while it reads.', 'eye')
    );
    view.append(label('What is happening'));
    view.append(list(own.steps.length ? own.steps.map(runStep) : [startingStep()]));
    view.append(logBox(own.log.lines));
    footer.append(...footerBar({ buttons: [busyButton(writing ? 'Writing…' : 'Reading…')] }));
    return;
  }

  /* --------------------------------------------------------- 5. result */

  const r = own.result || {};
  const fixed = r.fixed || 0;
  const skipped = issues.length - own.ticked.size;
  // Fields that flip now that the scan never listed: changed since.
  const added = Math.max(0, (r.remaining || 0) - skipped);

  view.append(notice('ok', 'Done', `${plural(fixed, 'field')} fixed on this page.`, 'check'));
  if (added) {
    view.append(
      notice(
        'warn',
        `${plural(added, 'more field')} on the page ${added === 1 ? 'flips' : 'flip'}`,
        `${added === 1 ? 'It was' : 'They were'} not there when the page was scanned. Scan it again to see ${added === 1 ? 'it' : 'them'}.`,
        'warn'
      )
    );
  }

  view.append(
    counts([
      { n: fixed, label: 'fixed', tone: 'ok' },
      { n: skipped, label: 'skipped on purpose' }
    ])
  );

  view.append(
    label('Page'),
    list([
      kv('Page', r.page || own.scan?.page || own.page, true),
      kv('Server', hostOf(own.scanned?.origin || state.origin), true)
    ])
  );

  view.append(logBox(own.log.lines));

  footer.append(
    ...footerBar({
      buttons: [
        button('Back to tools', 'primary', () => {
          reset(own);
          goHome();
        }),
        button('Fix another page', 'link', () => {
          reset(own);
          own.page = state.page?.path || '';
          redraw();
        })
      ]
    })
  );

  /* ---------------------------------------------------------- the work */

  async function doScan() {
    const scanned = { tabId: state.tab?.id, origin: state.origin || null };
    own.log?.clear();
    own.problem = null;
    own.busy = 'scan';
    own.steps = [{ name: 'Reading the page’s copy', state: 'running' }];
    goStep('running');
    try {
      const fields = await fieldsParam();
      const scan = await runAction({
        featureId: 'arabic-fixer',
        action: 'scan',
        params: { page: own.page, fields },
        settings: state.settings,
        tabId: scanned.tabId,
        origin: scanned.origin,
        onReport: (msg) => own.log.onReport(msg)
      });
      own.scan = scan;
      own.scanned = { ...scanned, fields };
      // The first component opens, so the review starts on a text rather than a list of names.
      own.opened = new Set(scan.issues.slice(0, 1).map((i) => i.section));
      own.ticked = new Set(scan.issues.filter((i) => !flagged(i)).map((i) => i.key));
      own.phase = 'review';
      own.result = null;
    } catch (e) {
      own.log?.add('fail', e.message);
      own.problem = e.message;
      own.phase = 'pick';
    }
    own.busy = null;
    toTop();
    redraw();
  }

  async function doFix() {
    own.log?.clear();
    own.problem = null;
    own.busy = 'fix';
    own.phase = 'running';
    own.steps = [
      { name: 'Checking nothing changed', state: 'running' },
      { name: 'Writing the fixes', state: 'todo' },
      { name: 'Reading the page back', state: 'todo' }
    ];
    const byId = { 'check-first': 0, write: 1, check: 2 };
    redraw();

    try {
      own.result = await runAction({
        featureId: 'arabic-fixer',
        action: 'fix',
        // The same added and ignored fields as the scan, so the check reads the page the same way.
        params: { page: own.page, fields: own.scanned?.fields, picks: picksFrom(issues, own.ticked) },
        settings: state.settings,
        tabId: own.scanned?.tabId ?? state.tab?.id,
        origin: own.scanned?.origin || state.origin || null,
        onReport: (msg) => {
          own.log.onReport(msg);
          if (msg.level !== 'data' || msg.message !== 'step') return;
          const i = byId[msg.data.id];
          if (i == null) return;
          own.steps[i].state = msg.data.state;
          own.steps[i].note = msg.data.note;
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

/* ------------------------------------------------------------ the rows */

/** A small line over a card: what it is on the left, what can be done to all of it on the right - the copy deck's. */
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

/** What the highlights and marks in the texts below mean. */
function legend() {
  const box = el('div', 'af-legend');
  box.append(
    el('span', 'af-flip', 'abc'),
    el('span', null, 'Flips now'),
    el('span', 'af-run', 'abc'),
    el('span', null, 'Fixed'),
    markEl(LRM),
    el('span', null, 'LRM added'),
    markEl(RLM),
    el('span', null, 'RLM added')
  );
  const dot = el('span', 'af-dot', '.');
  dot.dataset.kind = 'to';
  box.append(dot, el('span', null, 'Comma to dot'));
  return box;
}

/** One component, as a copy deck accordion: its tick, its name, and every field of it that flips. */
function sectionBox(section, items, own, redraw, rules) {
  const box = el('details', 'detail');
  box.open = own.opened.has(section);
  box.addEventListener('toggle', () => {
    if (box.open) own.opened.add(section);
    else own.opened.delete(section);
  });

  const ticked = items.filter((i) => own.ticked.has(i.key)).length;
  const sum = el('summary');
  const tickBox = el('input');
  tickBox.type = 'checkbox';
  tickBox.checked = ticked === items.length;
  tickBox.indeterminate = ticked > 0 && ticked < items.length;
  tickBox.setAttribute('aria-label', `Fix every field in ${section}`);
  tickBox.addEventListener('click', (e) => e.stopPropagation());
  tickBox.addEventListener('change', () => {
    for (const i of items) {
      if (tickBox.checked) own.ticked.add(i.key);
      else own.ticked.delete(i.key);
    }
    redraw();
  });
  sum.append(
    tickBox,
    el('span', 'detail-title', section),
    el('span', 'detail-count', `${ticked} of ${plural(items.length, 'field')}`)
  );
  box.append(sum);
  for (const i of items) box.append(fieldRow(i, own, redraw, rules));
  return box;
}

/** One field: its tick and name, the runs it protects, and its whole text as it shows now and fixed. */
function fieldRow(issue, own, redraw, rules) {
  const row = el('div', 'deck-row af-field');
  const head = el('label', 'af-field-head');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = own.ticked.has(issue.key);
  box.setAttribute('aria-label', `Fix ${issue.section} › ${issue.field}`);
  box.addEventListener('change', () => {
    if (box.checked) own.ticked.add(issue.key);
    else own.ticked.delete(issue.key);
    redraw();
  });
  head.append(box, el('span', 'deck-row-field', issue.field));
  if (issue.script) head.append(el('span', 'link-tag', 'Script'));
  else if (issue.liveCopy) head.append(el('span', 'link-tag', 'Inherited'));
  if (issue.hidden) head.append(el('span', 'link-tag', 'Hidden'));
  row.append(head);

  /* One chip a change the page will show: each run that flips now - not one
     its marks already hold - each decimal comma, any junk marks. */
  const runs = el('div', 'chips af-runs');
  for (const t of issue.runs.slice(0, SHOW_RUNS)) runs.append(el('span', 'chip', t));
  if (issue.runs.length > SHOW_RUNS) runs.append(el('span', 'chip', `+${issue.runs.length - SHOW_RUNS} more`));
  if (issue.commas) runs.append(el('span', 'chip', `${plural(issue.commas, 'comma')} to ${issue.commas === 1 ? 'a dot' : 'dots'}`));
  if (issue.junk) runs.append(el('span', 'chip', `${plural(issue.junk, 'broken mark')} cleaned`));
  row.append(runs);
  const lines = compare(issue, rules);

  const notes = [];
  if (issue.skipped) notes.push(`${plural(issue.skipped, 'string')} left alone: a mark would land in an escape`);
  if (notes.length) row.append(el('div', 'af-note', notes.join(' · ')));

  row.append(lines);
  return row;
}

/** How many marks a value holds - real, escaped or broken. */
const netMarks = (value) => [].concat(value).reduce((n, s) => n + (typeof s === 'string' ? stripMarks(s).removed : 0), 0);

const SPLIT_TAGS = /(<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|<![^>]*>)/g;
/* Tags that start a paragraph of their own on the page - and so a bidi paragraph of their own. */
const BLOCK_TAG = /^(?:p|div|li|ul|ol|h[1-6]|br|tr|td|th|table|dt|dd|dl|blockquote|section|article|header|footer)$/;
/* Tags kept as they are, because they change how the text reads: ¹ is not 1. */
const KEEP_TAG = /^(?:sup|sub|b|strong|i|em|u|s)$/;
/* Tags kept as plain spans: they hold text but draw nothing of their own here. */
const SPAN_TAG = /^(?:a|span|small|font|mark|abbr|label)$/;

const ENTITIES = { nbsp: '\u00A0', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", lrm: '\u200E', rlm: '\u200F' };
const decode = (s) =>
  s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/**
 * A field's HTML drawn the way the page draws it: a paragraph per block,
 * superscripts and bold kept, scripts and styles left out. The fixer works
 * on the text between tags, a piece at a time, and so do the highlights here:
 * "Snapdragon<sup>1</sup> 8 Elite" is three pieces, not "Snapdragon 1 8 Elite".
 */
function rich(value, fixed, rules, commas, flips) {
  const out = [];
  let block = null;
  let stack = [];
  const newBlock = () => {
    block = el('div', 'af-block');
    out.push(block);
    stack = [block];
  };
  for (const html of [].concat(value)) {
    newBlock();
    let raw = null;
    String(html ?? '')
      .split(SPLIT_TAGS)
      .forEach((part, idx) => {
        if (idx % 2) {
          const m = part.match(/^<(\/?)([a-z][a-z0-9]*)/i);
          if (!m) return;
          const close = !!m[1];
          const name = m[2].toLowerCase();
          if (raw) {
            if (close && name === raw) raw = null;
            return;
          }
          if (!close && (name === 'script' || name === 'style')) raw = name;
          else if (BLOCK_TAG.test(name)) {
            if (block.textContent.trim()) newBlock();
          } else if (KEEP_TAG.test(name) || SPAN_TAG.test(name)) {
            if (close) {
              if (stack.length > 1) stack.pop();
            } else if (!/\/\s*>$/.test(part)) {
              const node = document.createElement(KEEP_TAG.test(name) ? name : 'span');
              stack[stack.length - 1].append(node);
              stack.push(node);
            }
          }
          return;
        }
        if (raw || !part) return;
        /* Now is the page as it is, the marks already in it kept. A run they
           hold shows right, so neither line marks it: only what changes is
           highlighted. Fixed is the text as the fixer writes it. */
        const asIs = decode(part);
        let text = fixed ? removeMarks(asIs) : asIs;
        let dots = null;
        if (commas) {
          const c = decimalCommas(text);
          dots = new Set(c.at);
          if (fixed) text = c.text;
        }
        stack[stack.length - 1].append(
          ...(fixed ? pieces(text, flipRuns(text, rules), true, dots, flips) : nowPieces(text, runsAsIs(text, rules), dots, flips))
        );
      });
  }
  return out.filter((b) => b.textContent.trim());
}

/* A run as the scan names it, whatever its marks and decimal commas: the key `flips` holds. */
const runKey = (s) => decimalCommas(removeMarks(s).replace(/\u00A0/g, ' ')).text;

/**
 * The text as the page has it. Its marks stay in it, unseen, as on the page;
 * only the runs that flip now - those in `flips` - are highlighted, and the
 * commas that change.
 */
function nowPieces(text, runs, dots, flips) {
  const out = [];
  let i = 0;
  const upTo = (to, into) => {
    let k = i;
    const flush = (j) => j > k && into.push(document.createTextNode(text.slice(k, j)));
    for (let j = i; j < to; j++) {
      if (!dots?.has(j)) continue;
      flush(j);
      const d = el('span', 'af-dot', text[j]);
      d.dataset.kind = 'from';
      into.push(d);
      k = j + 1;
    }
    flush(to);
    i = to;
  };
  for (const r of runs) {
    upTo(r.start, out);
    if (!flips.has(runKey(text.slice(r.start, r.end)))) {
      upTo(r.end, out);
      continue;
    }
    const span = el('span', 'af-flip');
    const inner = [];
    upTo(r.end, inner);
    span.append(...inner);
    out.push(span);
  }
  upTo(text.length, out);
  return out;
}

/**
 * The field's whole text, as it shows now and as it will show fixed. Each run
 * that flips is highlighted where it stands - red now, green held in place -
 * so the reviewer sees exactly what goes wrong. Highlights and marks are plain
 * spans holding the real characters, so both lines are laid out exactly as
 * the page lays them out. A script's strings are shown one after another.
 */
function compare(issue, rules) {
  const plain = issue.script ? [].concat(issue.from).flatMap(scriptTexts).join(' · ') : null;
  const flips = new Set(issue.runs.map(runKey));
  const draw = (fixed) => {
    if (plain === null) return rich(issue.from, fixed, rules, issue.commas > 0, flips);
    if (!fixed) return nowPieces(plain, runsAsIs(plain, rules), null, flips);
    const text = removeMarks(plain);
    return pieces(text, flipRuns(text, rules), true, null, flips);
  };

  const box = el('div', 'af-compare');
  const line = (name, content) => {
    const l = el('div', 'af-line');
    const t = el('div', 'af-text');
    t.dir = 'rtl';
    t.append(...content);
    l.append(el('div', 'af-line-label', name), t);
    box.append(l);
  };
  line('Now', draw(false));
  line('Fixed', draw(true));
  return box;
}

/**
 * The text, its runs highlighted - with their marks, when `fixed`. `dots` is
 * where a decimal comma is turned to a dot: shown as the comma now, the dot
 * fixed. With `flips`, a run not in it already shows right on the page: its
 * marks go in unseen and it is not highlighted, as nothing about it changes.
 */
function pieces(text, runs, fixed, dots = null, flips = null) {
  const out = [];
  const bits = (from, to, into) => {
    let i = from;
    for (let k = from; k < to; k++) {
      if (!dots?.has(k)) continue;
      if (k > i) into.push(document.createTextNode(text.slice(i, k)));
      const d = el('span', 'af-dot', text[k]);
      d.dataset.kind = fixed ? 'to' : 'from';
      into.push(d);
      i = k + 1;
    }
    if (to > i) into.push(document.createTextNode(text.slice(i, to)));
  };
  let i = 0;
  for (const r of runs) {
    bits(i, r.start, out);
    const quiet = flips ? !flips.has(runKey(text.slice(r.start, r.end))) : false;
    const mark = (ch) => out.push(quiet ? document.createTextNode(ch) : markEl(ch));
    if (fixed && r.lead) mark(LRM);
    if (quiet) bits(r.start, r.end, out);
    else {
      const run = el('span', fixed ? 'af-run' : 'af-flip');
      const inner = [];
      bits(r.start, r.end, inner);
      run.append(...inner);
      out.push(run);
    }
    i = r.end;
    if (fixed && r.trail) {
      mark(LRM);
      if (r.period) {
        bits(i, i + 1, out);
        i++;
        mark(RLM);
      }
    }
  }
  bits(i, text.length, out);
  return out;
}

function markEl(ch) {
  const m = el('span', 'af-mark', ch);
  m.dataset.kind = ch === LRM ? 'lrm' : 'rlm';
  m.title = ch === LRM ? 'LRM' : 'RLM';
  return m;
}

/* --------------------------------------------------------- by hand */

const MODES = [
  ['static', 'Static'],
  ['pdp', 'PDP']
];
const SHOW_MANUAL_RUNS = 12;

/**
 * What the paste mode remembers while the tool is open: each converter's
 * text and options, as the Flipping Converter keeps them. The defaults are
 * the converter's - only "Fewest marks" on.
 */
function manualState(own) {
  if (!own.manual) {
    own.manual = {
      mode: 'static',
      text: '',
      minimal: true,
      rlmLineStart: false,
      rlmCloser: false,
      format: 'chars',
      commas: false,
      keep: new Set(),
      search: '',
      pdpText: '',
      pdpCommas: false,
      pdpKeep: new Set(),
      options: false
    };
  }
  return own.manual;
}

/* A comma is known by its position and its context, so editing the text
   elsewhere does not silently move a "keep" onto a different comma. */
const commaKey = (c) => `${c.index}|${c.left},${c.right}`;

/**
 * The Flipping Converter, Static or PDP, for text pasted by hand. The text is
 * fixed as it is typed, and the result redrawn in place - never the whole
 * screen, which would replace the box being typed into.
 */
function manualScreen({ view, footer, own, rules, redraw, back }) {
  const m = manualState(own);
  const pdp = m.mode === 'pdp';
  let last = null;

  view.append(
    notice(
      'read',
      'Nothing is written to AEM',
      pdp
        ? 'Paste the specifications, copy them back fixed, and paste that into the source yourself.'
        : 'Paste the text, copy it back fixed, and paste that into AEM yourself.'
    )
  );

  /* Static or PDP: two converters, one shown at a time. */
  const seg = el('div', 'segmented');
  for (const [id, text] of MODES) {
    const b = el('button', 'segment', text);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(m.mode === id));
    b.addEventListener('click', () => {
      if (m.mode === id) return;
      m.mode = id;
      redraw();
    });
    seg.append(b);
  }
  view.append(seg);

  /* ---- source ------------------------------------------------------- */

  view.append(label(pdp ? 'Specifications' : 'Source'));
  const srcField = el('div', 'field');
  const area = el('textarea', 'paste-area af-source');
  area.dir = 'rtl';
  area.spellcheck = false;
  area.placeholder = pdp ? 'الصق المواصفات هنا... مثال: 1080 x 2340 (FHD+)' : 'الصق النص العربي أو HTML هنا...';
  area.setAttribute('aria-label', pdp ? 'Specifications' : 'Source');
  area.value = pdp ? m.pdpText : m.text;
  area.addEventListener('input', () => {
    if (pdp) m.pdpText = area.value;
    else m.text = area.value;
    update();
  });
  area.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      copyFixed();
    }
  });
  srcField.append(
    area,
    el(
      'div',
      'field-hint',
      pdp
        ? 'Every value with a number is wrapped as &lrm;value&lrm;, for the HTML source of the specifications.'
        : 'Plain text or HTML, as copied from the dialog or its source view. Tags are left as they are.'
    )
  );
  view.append(srcField);

  const srcActions = [];
  if (!pdp) {
    srcActions.push({
      text: 'Remove marks',
      onClick: () => {
        area.value = m.text = removeMarks(area.value);
        update();
      }
    });
  }
  srcActions.push({
    text: 'Clear',
    onClick: () => {
      area.value = '';
      if (pdp) {
        m.pdpText = '';
        m.pdpKeep.clear();
      } else {
        m.text = '';
        m.keep.clear();
        m.search = '';
        if (searchInput) searchInput.value = '';
      }
      update();
      area.focus();
    }
  });
  const srcBar = barRow('', srcActions);
  view.append(srcBar);

  /* ---- commas: one card - the switch, and under it each comma, as the
          Flipping Converter lists them, to change or keep ---------------- */

  const commaCard = el('div', 'list af-commas');
  const commaHead = el('div', 'af-comma-head');
  const commaCount = el('span', 'af-comma-count');
  const commaActs = el('div', 'bar-actions');
  for (const [text, change] of [
    ['Change all', true],
    ['Keep all', false]
  ]) {
    const b = el('button', 'bar-action', text);
    b.type = 'button';
    b.addEventListener('click', () => setCommas(change));
    commaActs.append(b);
  }
  commaHead.append(commaCount, commaActs);
  const commaList = el('div', 'af-comma-list');
  commaCard.append(
    checkRow(
      'Replace commas with dots',
      'Every comma in the text becomes a full stop - 1,5 becomes 1.5. Tags are not touched, and any comma can be kept below.',
      pdp ? m.pdpCommas : m.commas,
      (v) => {
        if (pdp) m.pdpCommas = v;
        else m.commas = v;
        update();
      }
    ),
    commaHead,
    commaList
  );
  view.append(commaCard);

  /* ---- options ------------------------------------------------------ */

  const options = el('details', 'advanced af-options');
  options.open = m.options;
  options.addEventListener('toggle', () => (m.options = options.open));
  const sum = el('summary');
  const sumNote = el('span', 'advanced-note');
  sum.append(el('span', null, 'Options'), sumNote);
  options.append(sum);
  if (!pdp) {
    options.append(
      checkRow(
        'Fewest marks',
        'Only the side of a run that would flip gets a mark. Fewer invisible characters, so an exact search in Excel breaks less often.',
        m.minimal,
        (v) => {
          m.minimal = v;
          update();
        }
      ),
      checkRow('RLM at line start', 'An RLM at the start of every line, for lines that begin with English.', m.rlmLineStart, (v) => {
        m.rlmLineStart = v;
        update();
      }),
      checkRow('RLM closer', 'An RLM after the last run, for text that ends in English.', m.rlmCloser, (v) => {
        m.rlmCloser = v;
        update();
      })
    );
  }
  let formatField = null;
  let formatHint = null;
  const formatSegs = [];
  if (!pdp) {
    formatField = el('div', 'field');
    formatField.append(el('div', 'field-label', 'Marks as'));
    const fseg = el('div', 'segmented');
    for (const [id, text] of [
      ['chars', 'Invisible characters'],
      ['entities', '&lrm; entities']
    ]) {
      const b = el('button', 'segment', text);
      b.type = 'button';
      b.dataset.format = id;
      b.addEventListener('click', () => {
        m.format = id;
        update();
      });
      fseg.append(b);
      formatSegs.push(b);
    }
    formatHint = el(
      'div',
      'field-hint',
      'Entities only work when you paste into the HTML source view. For the rich-text editor, use invisible characters.'
    );
    formatField.append(fseg, formatHint);
    options.append(formatField);
  }
  // PDP has no options of its own: its one switch, commas, is above.
  if (!pdp) view.append(options);

  /* ---- result ------------------------------------------------------- */

  const resultLabel = label('Result');
  const result = el('div', 'list');
  const statusRow = el('div', 'af-row');
  const status = el('div', 'af-status');
  const verdict = el('div', 'af-verdict');
  statusRow.append(status, verdict);
  const compareRow = el('div', 'af-row');
  const compareBox = el('div', 'af-compare');
  compareRow.append(compareBox);
  const chipsRow = el('div', 'af-row');
  const chips = el('div', 'chips');
  chipsRow.append(chips);
  result.append(statusRow, compareRow, chipsRow);
  view.append(resultLabel, result);

  const outLabel = label(pdp ? 'Fixed specs' : 'Fixed text', pdp ? null : { text: 'Copy without marks', onClick: copyClean });
  const cleanBtn = outLabel.querySelector('.label-action');
  const outField = el('div', 'field');
  const out = el('textarea', pdp ? 'paste-area af-code' : 'paste-area af-source');
  out.readOnly = true;
  out.dir = pdp ? 'ltr' : 'rtl';
  out.spellcheck = false;
  out.placeholder = pdp ? 'The fixed specs appear here as you type.' : 'The fixed text appears here as you type.';
  out.setAttribute('aria-label', pdp ? 'Fixed specs' : 'Fixed text');
  outField.append(out);
  view.append(outLabel, outField);

  /* ---- Ctrl+F check -------------------------------------------------- */

  let searchInput = null;
  let badgeChrome = null;
  let badgeExact = null;
  let exactHint = null;
  if (!pdp) {
    view.append(label('Ctrl+F check'));
    const sf = el('div', 'field');
    searchInput = el('input');
    searchInput.type = 'text';
    searchInput.dir = 'rtl';
    searchInput.spellcheck = false;
    searchInput.placeholder = 'Paste the text a reviewer will search for';
    searchInput.setAttribute('aria-label', 'Text a reviewer will search for');
    searchInput.value = m.search;
    searchInput.addEventListener('input', () => {
      m.search = searchInput.value;
      renderSearch();
    });
    const badges = el('div', 'af-badges');
    badgeChrome = el('span', 'af-badge');
    badgeExact = el('span', 'af-badge');
    badges.append(badgeChrome, badgeExact);
    exactHint = el(
      'div',
      'field-hint af-note',
      'This search crosses a mark, so Excel will not find it. In Excel, search the cleaned text instead - ' +
        '=SUBSTITUTE(A1,UNICHAR(8206),"") - or use "Copy without marks" for comparison sheets.'
    );
    sf.append(
      searchInput,
      badges,
      el(
        'div',
        'field-hint',
        'Chrome’s find bar on the AEM page ignores invisible LRM/RLM marks. Excel, Word and Notepad do not: they only match when the search does not cross a mark.'
      ),
      exactHint
    );
    view.append(sf);
  }

  /* ---- footer ------------------------------------------------------- */

  const copyBtn = button(pdp ? 'Copy fixed specs' : 'Copy fixed text', 'primary', copyFixed);
  footer.append(
    ...footerBar({
      tag: { kind: 'read', text: 'Nothing written' },
      note: '',
      buttons: [copyBtn, button('Back to page scan', 'ghost', back)]
    })
  );
  const footNote = footer.querySelector('.footer-note');

  update();
  if (!area.value) area.focus();

  /* ---- the work ------------------------------------------------------ */

  /** The source with its commas turned to dots, when that is on, except the ones kept. */
  function prepare(raw) {
    if (!(pdp ? m.pdpCommas : m.commas)) return { text: raw, count: 0, found: [] };
    const keep = pdp ? m.pdpKeep : m.keep;
    const { found } = commasToDots(raw);
    const kept = new Set(found.filter((c) => keep.has(commaKey(c))).map((c) => c.index));
    return commasToDots(raw, kept);
  }

  function setCommas(change) {
    const keep = pdp ? m.pdpKeep : m.keep;
    for (const c of commasToDots(pdp ? m.pdpText : m.text).found) {
      if (change) keep.delete(commaKey(c));
      else keep.add(commaKey(c));
    }
    update();
  }

  function convertNow(src, format) {
    return pdp
      ? convertPdp(src)
      : convert(src, { rules, minimal: m.minimal, rlmLineStart: m.rlmLineStart, rlmCloser: m.rlmCloser, format });
  }

  function update() {
    const raw = pdp ? m.pdpText : m.text;
    const prep = prepare(raw);
    const src = prep.text;
    const r = convertNow(src, m.format);
    const has = !!src.trim();
    last = { r, src };
    const uniq = [...new Set(r.runs)];

    srcBar.querySelector('.bar-text').textContent = src
      ? `${r.isHtml ? 'HTML detected' : 'Plain text'} · ${removeMarks(src).length.toLocaleString()} chars`
      : 'Nothing pasted yet';

    const on = [];
    if (!pdp) {
      if (m.minimal) on.push('Fewest marks');
      if (m.rlmLineStart) on.push('RLM at line start');
      if (m.rlmCloser) on.push('RLM closer');
      if (r.format === 'entities') on.push('&lrm; entities');
    }
    sumNote.textContent = on.length ? on.join(' · ') : 'None';

    if (formatField) {
      /* Entities are only for an HTML source view; plain text always gets characters. */
      formatField.hidden = !r.isHtml;
      for (const b of formatSegs) b.setAttribute('aria-pressed', String(b.dataset.format === r.format));
      formatHint.hidden = r.format !== 'entities';
    }

    drawCommas(raw, prep);

    out.value = has ? r.output : '';
    resultLabel.hidden = result.hidden = !has;
    drawStatus(r, src, prep.count, has);

    compareBox.replaceChildren();
    if (has) {
      compareLine(compareBox, 'Now', drawParts(r.parts, false, r.isHtml));
      compareLine(compareBox, 'Fixed', drawParts(r.parts, true, r.isHtml));
    }
    compareRow.hidden = !has;

    chips.replaceChildren(...uniq.slice(0, SHOW_MANUAL_RUNS).map((t) => el('span', 'chip', t)));
    if (uniq.length > SHOW_MANUAL_RUNS) chips.append(el('span', 'chip', `+${uniq.length - SHOW_MANUAL_RUNS} more`));
    chipsRow.hidden = !uniq.length;

    copyBtn.disabled = !has;
    if (cleanBtn) cleanBtn.disabled = !has;
    footNote.textContent = !has
      ? pdp
        ? 'Paste the specs above'
        : 'Paste text above'
      : pdp
        ? `${plural(uniq.length, 'value')} wrapped`
        : r.marks
          ? `${plural(uniq.length, 'run')} · ${plural(r.marks, 'mark')}`
          : 'Nothing flips';
    if (has && prep.count) footNote.textContent += ` · ${plural(prep.count, 'comma')}`;

    renderSearch();
  }

  function drawCommas(raw, prep) {
    const on = pdp ? m.pdpCommas : m.commas;
    commaHead.hidden = commaList.hidden = !on || !raw.trim();
    if (commaHead.hidden) return;
    const found = prep.found;
    commaCount.textContent = found.length ? `Changing ${prep.count} of ${found.length}` : 'No commas in the text';
    commaActs.hidden = found.length < 2;
    commaList.hidden = !found.length;
    const keep = pdp ? m.pdpKeep : m.keep;
    commaList.replaceChildren(
      ...found.map((c) => {
        const key = commaKey(c);
        const row = el('label', 'af-comma');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !keep.has(key);
        cb.setAttribute('aria-label', `Change comma ${c.index + 1} to a dot`);
        cb.addEventListener('change', () => {
          if (cb.checked) keep.delete(key);
          else keep.add(key);
          update();
        });
        row.dataset.kept = String(!cb.checked);
        row.append(cb, snippet(c, cb.checked));
        return row;
      })
    );
  }

  /** What was done, in the converter's words, and whether the words themselves are untouched. */
  function drawStatus(r, src, commas, has) {
    status.replaceChildren();
    verdict.replaceChildren();
    statusRow.hidden = !has;
    if (!has) return;

    const say = (text, tone) => {
      const s = el(tone ? 'b' : 'span', null, text);
      if (tone) s.dataset.tone = tone;
      status.append(s);
    };
    if (pdp) {
      say(
        r.runs.length ? `${plural(r.marks / 2, 'value')} wrapped with &lrm;` : 'No values with numbers found. No changes needed',
        'ok'
      );
    } else if (r.runs.length) {
      say(`${plural(new Set(r.runs).size, 'LTR run')} protected`, 'ok');
      say(` · ${plural(r.marks, 'mark')} added`);
    } else if (r.marks) {
      say(`${plural(r.marks, 'RLM mark')} added`, 'ok');
    } else {
      say('Nothing flips. No changes needed', 'ok');
    }
    if (r.removed) say(` · ${plural(r.removed, 'old or broken mark')} removed`, 'warn');
    if (commas) say(` · ${plural(commas, 'comma')} replaced with ${commas === 1 ? 'a dot' : 'dots'}`, 'warn');

    /* Strict, character by character: the output minus the marks must be the source. */
    const intact = removeMarks(r.output) === removeMarks(src);
    const what = pdp ? '&lrm;' : 'invisible marks';
    verdict.dataset.tone = intact ? 'ok' : 'bad';
    verdict.append(
      icon(intact ? 'check' : 'warn', 14, 2.6),
      el(
        'span',
        null,
        !intact
          ? 'Content differs from the source. Please report this input'
          : commas
            ? `Content identical to the source, except ${plural(commas, 'comma')} to dot and ${what}`
            : r.marks
              ? `Content identical to the source. Only ${what} ${pdp ? 'was' : 'were'} added`
              : 'Output is identical to the source'
      )
    );
  }

  /** Whether a reviewer's search finds the fixed text: Chrome skips marks, Excel does not. */
  function renderSearch() {
    if (!searchInput) return;
    const q = m.search.trim();
    if (!q || !last?.src.trim()) {
      badgeChrome.hidden = badgeExact.hidden = exactHint.hidden = true;
      return;
    }
    const raw = last.r.output;
    const chars = last.r.format === 'entities' ? convertNow(last.src, 'chars').output : raw;
    // Searching with tags means the reviewer is looking at the HTML source.
    const hay = /<[a-z!\/]/i.test(q) ? raw : last.r.isHtml ? htmlToText(chars) : chars;
    const n = countMatches(normalize(hay), normalize(q));
    setBadge(badgeChrome, n > 0, `Chrome / AEM page${n > 1 ? ` · ${n}` : ''}`);
    // Excel, Word and Notepad treat LRM/RLM as real characters.
    const e = countMatches(raw.toLowerCase(), removeMarks(q).toLowerCase());
    setBadge(badgeExact, e > 0, 'Excel / exact');
    exactHint.hidden = e > 0 || n === 0;
  }

  async function copyFixed() {
    if (!last?.src.trim()) return;
    await copyText(last.r.output);
    said(copyBtn, 'Copied');
  }

  async function copyClean() {
    if (!last?.src.trim()) return;
    await copyText(removeMarks(last.src));
    said(cleanBtn, 'Copied');
  }

  /** The button says it was done, for a moment, then goes back to what it offers. */
  function said(btn, text) {
    const span = btn.matches('.btn') ? btn.querySelector('span:last-child') : btn;
    const was = span.textContent;
    span.textContent = text;
    btn.disabled = true;
    setTimeout(() => {
      span.textContent = was;
      btn.disabled = !last?.src.trim();
    }, 1400);
  }
}

/** A tick box with its own explanation, as the settings page draws one. */
function checkRow(title, hint, checked, onChange) {
  const wrap = el('label', 'check-row');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = !!checked;
  box.setAttribute('aria-label', title);
  box.addEventListener('change', () => onChange(box.checked));
  const text = el('div', 'check-text');
  text.append(el('div', 'check-title', title));
  if (hint) text.append(el('div', 'check-hint', hint));
  wrap.append(box, text);
  return wrap;
}

/** A comma with a little of what is around it, the comma itself coloured by what happens to it. */
function snippet(c, change) {
  const s = el('span', 'af-snippet');
  s.dir = 'auto'; // Arabic copy reads right to left, a Latin spec value left to right
  const b = el('b', 'af-dot', change ? '.' : ',');
  b.dataset.kind = change ? 'to' : 'keep';
  s.append((c.left.length >= COMMA_CONTEXT ? '…' : '') + c.left, b, c.right + (c.right.length >= COMMA_CONTEXT ? '…' : ''));
  return s;
}

function compareLine(box, name, content) {
  const l = el('div', 'af-line');
  const t = el('div', 'af-text');
  t.dir = 'rtl';
  t.append(...content);
  l.append(el('div', 'af-line-label', name), t);
  box.append(l);
}

/**
 * The converter's own account of a text, drawn: each part as it was worked
 * on, its runs highlighted where they stand and - when `fixed` - its marks
 * drawn as bars exactly where the output holds them. Tags are handled as the
 * review's `rich` handles them, so a superscript stays a superscript.
 */
function drawParts(parts, fixed, isHtml) {
  const out = [];
  let block = null;
  let stack = [];
  const newBlock = () => {
    block = el('div', `af-block${isHtml ? '' : ' af-pre'}`);
    out.push(block);
    stack = [block];
  };
  newBlock();
  for (const p of parts) {
    if (p.tag) {
      const mt = p.text.match(/^<(\/?)([a-z][a-z0-9]*)/i);
      if (!mt) continue;
      const close = !!mt[1];
      const name = mt[2].toLowerCase();
      if (BLOCK_TAG.test(name)) {
        if (block.textContent.trim()) newBlock();
      } else if (KEEP_TAG.test(name) || SPAN_TAG.test(name)) {
        if (close) {
          if (stack.length > 1) stack.pop();
        } else if (!/\/\s*>$/.test(p.text)) {
          const node = document.createElement(KEEP_TAG.test(name) ? name : 'span');
          stack[stack.length - 1].append(node);
          stack.push(node);
        }
      }
      continue;
    }
    if (p.raw || !p.text) continue;
    stack[stack.length - 1].append(...drawText(p, fixed, isHtml));
  }
  return out.filter((b) => b.textContent.trim());
}

/** One text part: its runs as highlights, its marks as bars where the output puts them. */
function drawText(p, fixed, isHtml) {
  const at = new Map(fixed ? p.ins : []);
  const cuts = new Set([0, p.text.length, ...at.keys()]);
  for (const [s, e] of p.runs) cuts.add(s).add(e);
  const idx = [...cuts].sort((a, b) => a - b);
  const out = [];
  const marks = (i) => {
    for (const ch of at.get(i) || '') out.push(markEl(ch));
  };
  for (let k = 0; k < idx.length - 1; k++) {
    const a = idx[k];
    const b = idx[k + 1];
    marks(a);
    const raw = p.text.slice(a, b);
    const chunk = isHtml ? decode(raw) : raw;
    const inRun = p.runs.some(([s, e]) => s <= a && b <= e);
    out.push(inRun ? el('span', fixed ? 'af-run' : 'af-flip', chunk) : document.createTextNode(chunk));
  }
  marks(idx[idx.length - 1]);
  return out;
}

/** Visible text of an HTML fragment, roughly as the page would show it. */
function htmlToText(html) {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|h[1-6]|tr|blockquote|dd|dt)>/gi, '$&\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  doc.querySelectorAll('script, style').forEach((n) => n.remove());
  return doc.body.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

const normalize = (s) => removeMarks(s).replace(/\s+/g, ' ').trim().toLowerCase();

function countMatches(haystack, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}

function setBadge(badge, ok, text) {
  badge.dataset.tone = ok ? 'ok' : 'bad';
  badge.replaceChildren(icon(ok ? 'check' : 'close', 12, 3), el('span', null, text));
  badge.hidden = false;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // No clipboard permission here: the old way still works on a click.
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

const hostOf = (origin) => String(origin || '').replace(/^https?:\/\//, '');

function reset(own) {
  own.phase = 'pick';
  own.scan = null;
  own.ticked = new Set();
  own.opened = new Set();
  own.result = null;
  own.problem = null;
  own.steps = [];
  own.busy = null;
  own.scanned = null;
}
