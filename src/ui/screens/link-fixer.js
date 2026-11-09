/**
 * Relative Link Fixer, as the design draws it.
 *
 * Five steps: pick the page, review what the scan found, confirm what will be
 * written, watch it run, read the result. The scan reads only; nothing is
 * written until the amber button on Confirm.
 *
 * The scan's own data decides every number on screen - none of it is kept
 * from one step to the next except the scan result and which links are
 * ticked, so what gets written cannot drift from what was approved.
 */

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
  more,
  notice,
  runStep,
  startingStep,
  stepBar,
  toTop
} from '../parts.js';
import { logBox, makeLog } from '../log.js';
import { runAction } from '../run.js';

const STEPS = ['Pick', 'Review', 'Confirm', 'Run', 'Result'];
const SHOW_FIRST = 4;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

/**
 * The locale a path is in. `rootDepth` is how many segments make the site
 * root - 3 means /content/<brand>/<locale>, so the locale is the third
 * segment. A relative link carries only the locale and what follows it.
 */
const localeOf = (path, depth) => {
  const segs = String(path || '').split('/').filter(Boolean);
  const seg = segs[0] === 'content' ? segs[depth - 1] : segs[0];
  // /UK/ and /uk/ are one country: AEM's paths are lower case, people's typing is not.
  return seg ? seg.toLowerCase() : null;
};

/* Settings hold a number the person typed, or one a team file carried. Anything
   that is not a whole number of at least 1 reads as the default. */
const depthFrom = (settings) => {
  const n = Number(settings?.rootDepth);
  return Number.isInteger(n) && n >= 1 ? n : 3;
};

/* A link into another country's tree is a deliberate choice often enough
   that it is listed but never ticked for you. */
const otherCountry = (link, pageLocale, depth) => {
  const to = localeOf(link.to, depth);
  return !!to && to !== pageLocale;
};

/** Every link the scan found, flattened to one row each. */
function rowsFrom(scan, depth = 3) {
  /* A site root deeper than the page has no locale to read. Then no link can
     be said to be in this country, so none is ticked for you - reading every
     one as "same country" ticked links into every other country. */
  const pageLocale = localeOf(scan.page, depth);
  const rows = [];
  for (const c of scan.components) {
    for (const link of c.links) {
      rows.push({
        key: `${c.node}|${link.prop}|${link.index}|${link.start}`,
        node: c.node,
        where: `${c.title || c.type || c.node} · ${link.prop}`,
        liveCopy: c.liveCopy,
        unknown: !pageLocale,
        other: !!pageLocale && otherCountry(link, pageLocale, depth),
        link
      });
    }
  }
  return rows;
}

/** A row that is never ticked for you and is called out on the review. */
const flagged = (r) => r.other || r.liveCopy || r.unknown;

/** The ticked rows, grouped back into the per-property shape `fix` wants. */
function picksFrom(rows, ticked, scan) {
  const byProp = new Map();
  for (const r of rows) {
    if (!ticked.has(r.key)) continue;
    const id = `${r.node}|${r.link.prop}`;
    if (!byProp.has(id)) {
      byProp.set(id, { node: r.node, prop: r.link.prop, expect: r.link.value, links: [] });
    }
    byProp.get(id).links.push({
      index: r.link.index,
      start: r.link.start,
      from: r.link.from,
      to: r.link.to
    });
  }
  return [...byProp.values()];
}

/**
 * The unticked links, said without counting any of them twice: the ones
 * flagged for a look are a subset of the ones being left alone.
 */
function untouchedNote(untouched, needLook) {
  if (!untouched) return 'Nothing - every link is ticked';
  if (needLook >= untouched) return `${plural(untouched, 'link')}, all flagged for a look`;
  if (!needLook) return `${plural(untouched, 'link')} left as ${untouched === 1 ? 'it is' : 'they are'}`;
  return `${plural(untouched, 'link')}, ${needLook} flagged for a look`;
}

export async function render(ctx) {
  const { view, footer, state, goHome } = ctx;

  /* Everything this tool remembers while it is open. */
  const own = ctx.own;
  /* Every line a run reports, kept so a failure leaves an account of itself
     (see ui/log.js). It lives on the tool's state, so leaving the tool drops
     it with everything else. */
  if (!own.log) own.log = makeLog(() => {
    if (own.phase === 'running') redraw();
  });

  if (!own.phase) {
    Object.assign(own, {
      phase: 'pick',
      page: null,
      scan: null,
      ticked: new Set(),
      showAll: false,
      result: null,
      problem: null,
      steps: [],
      busy: null
    });
  }

  // A fresh open starts on the page this tab is showing.
  if (own.page == null) own.page = state.page?.path || '';

  const redraw = () => ctx.render();
  /* A change of step starts at the top; a redraw leaves the scroll alone. */
  const goStep = (phase) => {
    own.phase = phase;
    toTop();
    redraw();
  };
  const phaseIndex =
    own.phase === 'running'
      ? own.busy === 'fix'
        ? 3
        : 0
      : { pick: 0, review: 1, confirm: 2, result: 4 }[own.phase];

  /* ---------------------------------------------------------- the chrome */

  view.append(
    connPill({
      host: String(state.origin || '').replace(/^https?:\/\//, ''),
      signedIn: !state.session || state.session.state === 'in' || state.session.state === 'unknown'
    }),
    stepBar(STEPS, phaseIndex)
  );

  if (own.problem) {
    view.append(notice('err', 'That did not work', own.problem, 'warn'));
    view.append(logBox(own.log.lines, { open: true, title: 'What happened' }));
  }

  const depth = depthFrom(state.settings);
  const rows = own.scan ? rowsFrom(own.scan, depth) : [];

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
    input.placeholder = '/content/samsung/uk/offers/spring-sale';
    input.addEventListener('input', () => {
      own.page = input.value.trim();
      scanBtn.disabled = !own.page.startsWith('/content/');
    });
    field.append(input);
    field.append(
      el('div', 'field-hint', 'Filled in from the page open in AEM. Change it to scan another page.')
    );
    view.append(field);

    const scanBtn = button('Scan this page', 'primary', doScan, {
      disabled: !own.page.startsWith('/content/')
    });
    footer.append(
      ...footerBar({
        tag: { kind: 'read', text: 'Preview only' },
        note: 'No changes yet',
        buttons: [scanBtn]
      })
    );
    return;
  }

  /* --------------------------------------------------------- 2. review */

  if (own.phase === 'review') {
    const needLook = rows.filter(flagged);
    const tickedCount = own.ticked.size;
    /* Three piles that add up to every row: ticked, flagged and not ticked,
       neither. Taking the flagged away from all the unticked went below zero
       once a flagged row was ticked by hand or by Select all. */
    const lookUnticked = needLook.filter((r) => !own.ticked.has(r.key)).length;
    const nothingFound = !rows.length;

    view.append(
      nothingFound
        ? notice(
            'ok',
            'Nothing to fix',
            `Every link on this page is already relative. ${own.scan.nodes} nodes were read and nothing was written.`,
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
          ? `${own.scan.nodes} nodes read`
          : `${plural(rows.length, 'link')} ${rows.length === 1 ? 'needs' : 'need'} attention on this page`
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
        { n: rows.length - tickedCount - lookUnticked, label: 'left alone' }
      ])
    );

    if (needLook.length) {
      const otherN = needLook.filter((r) => r.other).length;
      const unknownN = needLook.filter((r) => r.unknown && !r.liveCopy).length;
      const liveN = needLook.filter((r) => !r.other && r.liveCopy).length;
      const warn = el('div', 'notice-stack');
      const line = (iconName, strong, rest) => {
        const row = el('div', 'notice-line');
        row.append(icon(iconName, 18, 2));
        const span = el('span');
        span.append(el('b', null, strong), document.createTextNode(' ' + rest));
        row.append(span);
        warn.append(row);
      };
      if (otherN) {
        line(
          'warn',
          `${plural(otherN, 'link')} ${otherN === 1 ? 'goes' : 'go'} to another country.`,
          otherN === 1 ? 'It is unticked.' : 'They are unticked.'
        );
      }
      if (unknownN) {
        line(
          'warn',
          `${plural(unknownN, 'link')} could not be checked for country.`,
          `The site root depth in Settings (${depth}) is deeper than this page, so its country cannot be read. ` +
            (unknownN === 1 ? 'It is unticked.' : 'They are unticked.')
        );
      }
      if (liveN) {
        line(
          'history',
          `${plural(liveN, 'link')} ${liveN === 1 ? 'is' : 'are'} on an inherited component.`,
          'Fixing breaks inheritance for that property, so they are unticked.'
        );
      }
      view.append(warn);
    }

    view.append(
      label('Links on this page', {
        text: own.ticked.size === rows.length ? 'Select none' : 'Select all',
        onClick: () => {
          if (own.ticked.size === rows.length) own.ticked.clear();
          else for (const r of rows) own.ticked.add(r.key);
          redraw();
        }
      })
    );

    const shown = own.showAll ? rows : rows.slice(0, SHOW_FIRST);
    const items = shown.map((r) => linkRow(r, own.ticked, redraw));
    if (!own.showAll && rows.length > SHOW_FIRST) {
      items.push(
        more(`Show ${rows.length - SHOW_FIRST} more`, () => {
          own.showAll = true;
          redraw();
        })
      );
    }
    view.append(list(items));

    footer.append(
      ...footerBar({
        tag: { kind: 'read', text: 'Preview only' },
        note: `${tickedCount} of ${rows.length} selected`,
        buttons: [
          button(
            /* Says what pressing it does - carry these forward - so it cannot
               be read as the write. The amber button two lines below is the
               only one in the tool that changes anything. */
            tickedCount ? `Continue with ${plural(tickedCount, 'link')}` : 'Tick a link to continue',
            'primary',
            () => {
              goStep('confirm');
            },
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
    // Only the flagged ones being left alone: a flagged link ticked by hand is being changed.
    const needLook = rows.filter((r) => flagged(r) && !own.ticked.has(r.key)).length;
    const scanned = hostOf(own.scanned?.origin || state.origin);
    const front = hostOf(state.origin);

    view.append(
      notice(
        'write',
        'This will change content in AEM',
        'Changes go straight to the server below.',
        'pen'
      )
    );
    /* The write goes where the page was scanned, whatever tab is in front now -
       said, so nobody confirms thinking of the other one. */
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
        kv('Will change', `${plural(tickedCount, 'link')} on this page`),
        kv('Will not change', untouchedNote(rows.length - tickedCount, needLook))
      ])
    );

    footer.append(
      ...footerBar({
        tag: { kind: 'write', text: 'Writes to AEM' },
        note: `${plural(tickedCount, 'link')} · 1 page`,
        buttons: [
          button(`Change ${plural(tickedCount, 'link')} in AEM`, 'write', doFix, { iconName: 'pen' }),
          button('Back to preview', 'ghost', () => {
            goStep('review');
          })
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
    view.append(
      list(
        own.steps.length ? own.steps.map(runStep) : [startingStep()]
      )
    );
    view.append(logBox(own.log.lines));
    footer.append(...footerBar({ buttons: [busyButton(writing ? 'Writing…' : 'Reading…')] }));
    return;
  }

  /* --------------------------------------------------------- 5. result */

  const r = own.result || {};
  const fixed = r.fixed || 0;
  /* Only what was ticked and is still a full URL makes a run partly done.
     The links left unticked were left on purpose. */
  const left = r.left || 0;
  const skipped = rows.length - own.ticked.size;
  // Full URLs on the page now that the scan never listed: added since.
  const added = Math.max(0, (r.remaining || 0) - skipped - left);

  view.append(
    left
      ? notice('warn', 'Partly done', `${plural(fixed, 'link')} changed in AEM. ${left} of the ticked links are still full URLs.`, 'warn')
      : notice('ok', 'Done', `${plural(fixed, 'link')} made relative on this page.`, 'check')
  );
  if (added) {
    view.append(
      notice(
        'warn',
        `${plural(added, 'more full-URL link')} on the page`,
        `${added === 1 ? 'It was' : 'They were'} not there when the page was scanned. Scan it again to see ${added === 1 ? 'it' : 'them'}.`,
        'warn'
      )
    );
  }

  view.append(
    counts([
      { n: fixed, label: 'changed', tone: 'ok' },
      ...(left ? [{ n: left, label: 'still full URLs', tone: 'warn' }] : []),
      { n: skipped, label: 'skipped on purpose' }
    ])
  );

  const donePage = own.result?.page || own.scan?.page || own.page;
  view.append(
    label('Page'),
    list([
      kv('Page', donePage, true),
      kv('Server', hostOf(own.scanned?.origin || state.origin), true)
    ])
  );

  /* The account of the run, under its result. */
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
    /* The tab and server this scan reads are the ones the fix writes to,
       whatever is in front by the time it is confirmed. */
    const scanned = { tabId: state.tab?.id, origin: state.origin || null };
    own.log?.clear();
    own.problem = null;
    own.busy = 'scan';
    own.steps = [{ name: 'Reading the page', state: 'running' }];
    goStep('running');
    try {
      const scan = await runAction({
        featureId: 'link-fixer',
        action: 'scan',
        params: { page: own.page },
        settings: state.settings,
        tabId: scanned.tabId,
        origin: scanned.origin,
        onReport: (msg) => own.log.onReport(msg)
      });
      own.scan = scan;
      own.scanned = scanned;
      own.showAll = false;
      own.ticked = new Set(
        rowsFrom(scan, depthFrom(state.settings))
          .filter((row) => !flagged(row))
          .map((row) => row.key)
      );
      /* Nothing found is a finding, not a result. Sending it to the Done
         screen lit every step of the bar and read as though a write had
         just happened, when the page had only been read. */
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
      { name: 'Writing the links', state: 'todo' },
      { name: 'Reading the page back', state: 'todo' }
    ];
    const byId = { 'check-first': 0, write: 1, check: 2 };
    redraw();

    try {
      own.result = await runAction({
        featureId: 'link-fixer',
        action: 'fix',
        params: { page: own.page, picks: picksFrom(rows, own.ticked, own.scan) },
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

/** One link: where it is, and what it becomes with the host struck out. */
function linkRow(row, ticked, redraw) {
  const wrap = el('label', 'link-row');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = ticked.has(row.key);
  box.setAttribute('aria-label', `Fix link to ${row.link.to}`);
  box.addEventListener('change', () => {
    if (box.checked) ticked.add(row.key);
    else ticked.delete(row.key);
    redraw();
  });

  const text = el('div', 'link-text');
  const where = el('div', 'link-where');
  where.append(el('span', null, row.where));
  if (row.other) where.append(el('span', 'link-tag', 'Other country'));
  else if (row.liveCopy) where.append(el('span', 'link-tag', 'Inherited'));
  else if (row.unknown) where.append(el('span', 'link-tag', 'Country unknown'));

  const url = el('div', 'link-url');
  url.append(el('span', 'link-cut', cutOf(row.link)), el('span', null, row.link.to));

  text.append(where, url);
  wrap.append(box, text);
  return wrap;
}

const hostOf = (origin) => String(origin || '').replace(/^https?:\/\//, '');

/**
 * The part of the link that goes: everything before the relative path it
 * ends in. Replacing `to` inside `from` struck out the wrong slash when the
 * link became "/" - https://www.samsung.com/ read as "https:/www.samsung.com/".
 * When the path is not the link's own ending (a bare host made "/", an editor
 * link), the whole of the old link is struck.
 */
function cutOf(link) {
  const { from, to } = link;
  return from.endsWith(to) ? from.slice(0, from.length - to.length) : from;
}

function reset(own) {
  own.phase = 'pick';
  own.scan = null;
  own.ticked = new Set();
  own.showAll = false;
  own.result = null;
  own.problem = null;
  own.steps = [];
  own.busy = null;
  own.scanned = null;
}
