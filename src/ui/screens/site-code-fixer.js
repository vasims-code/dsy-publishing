/**
 * Site Code Link Fixer: links into another site's tree, re-pointed at the
 * page's own site.
 *
 * Five steps, as the Relative Link Fixer has them: pick the page, review what
 * the scan found, confirm what will be written, watch it run, read the result.
 * The scan reads only; nothing is written until the amber button on Confirm.
 *
 * What is ticked for you is what can be fixed without a second look: a link
 * whose page this site has, on a component that is not inherited. Everything
 * else is listed, flagged and left unticked.
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
  toTop,
  whatHappens
} from '../parts.js';
import { logBox, makeLog } from '../log.js';
import { runAction } from '../run.js';

const STEPS = ['Pick', 'Review', 'Confirm', 'Run', 'Result'];
const SHOW_FIRST = 6;
const FEATURE = 'site-code-fixer';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const hostOf = (origin) => String(origin || '').replace(/^https?:\/\//, '');

/** Every link the scan found, flattened to one row each. */
function rowsFrom(scan) {
  const rows = [];
  for (const c of scan?.components || []) {
    for (const link of c.links) {
      rows.push({
        key: `${c.node}|${link.prop}|${link.index}|${link.start}`,
        node: c.node,
        where: `${c.title || c.type || c.node} · ${link.prop}`,
        liveCopy: !!c.liveCopy,
        placeholder: !!link.placeholder,
        inScript: !!link.inScript,
        missing: link.exists === 'no',
        unchecked: link.exists !== 'yes' && link.exists !== 'no',
        link
      });
    }
  }
  return rows;
}

/** A row that is never ticked for you and is called out on the review. */
const flagged = (r) => r.liveCopy || r.placeholder || r.missing || r.unchecked;

/* A link inside a script is ticked like any other - only the site code
   changes - but the author is warned on every step to check the component. */
function scriptWarning(n, site, when) {
  const it = n === 1 ? 'it' : 'they';
  return notice(
    'warn',
    `${plural(n, 'link')} ${n === 1 ? 'is' : 'are'} inside a script`,
    when === 'done'
      ? `Only the site code changed, but this tool cannot run the script. Open the page and check the component still works - its links, search and filters.`
      : `${n === 1 ? 'It is' : 'They are'} marked "In a script" below and will be pointed at /${site} with the rest. Only the site code changes, but this tool cannot run the script, so after the fix open the page and check the component still works. Untick ${n === 1 ? 'it' : 'them'} if ${it} should stay as ${n === 1 ? 'it is' : 'they are'}.`,
    'warn'
  );
}

/** The ticked rows, grouped back into the per-property shape `fix` wants. */
function picksFrom(rows, ticked) {
  const byProp = new Map();
  for (const r of rows) {
    if (!ticked.has(r.key)) continue;
    const id = `${r.node}|${r.link.prop}`;
    if (!byProp.has(id)) byProp.set(id, { node: r.node, prop: r.link.prop, expect: r.link.value, links: [] });
    byProp.get(id).links.push({ index: r.link.index, start: r.link.start, from: r.link.from, to: r.link.to });
  }
  return [...byProp.values()];
}

function untouchedNote(untouched, needLook) {
  if (!untouched) return 'Nothing - every link is ticked';
  if (needLook >= untouched) return `${plural(untouched, 'link')}, all flagged for a look`;
  if (!needLook) return `${plural(untouched, 'link')} left as ${untouched === 1 ? 'it is' : 'they are'}`;
  return `${plural(untouched, 'link')}, ${needLook} flagged for a look`;
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
      showAll: false,
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

  const rows = rowsFrom(own.scan);
  const site = own.scan?.site || '';

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
    input.placeholder = '/content/samsung/sa/mobile-phone-buying-guide/is-a-foldable-phone-worth-it';
    input.addEventListener('input', () => {
      own.page = input.value.trim();
      scanBtn.disabled = !own.page.startsWith('/content/');
    });
    field.append(input);
    field.append(
      el(
        'div',
        'field-hint',
        'Its site code is read off the path - the "sa" in /content/samsung/sa/… . Every link should point into that site.'
      )
    );
    view.append(field);

    view.append(
      ...whatHappens([
        ['search', 'Reads every component and lists links that point into another site, such as /ae_ar/… on an /sa page.'],
        ['link', 'Looks in link fields, rich text and Static Content HTML.'],
        ['pen', 'Fixes only the links you tick. Only the site code in the link changes.'],
        ['check', 'Every changed property is read back to check. No version of the page is saved first.']
      ])
    );

    const scanBtn = button('Scan this page', 'primary', doScan, { disabled: !own.page.startsWith('/content/') });
    footer.append(...footerBar({ tag: { kind: 'read', text: 'Preview only' }, note: 'No changes yet', buttons: [scanBtn] }));
    return;
  }

  /* --------------------------------------------------------- 2. review */

  if (own.phase === 'review') {
    const scripted = rows.filter((r) => r.inScript);
    const needLook = rows.filter(flagged);
    const tickedCount = own.ticked.size;
    const lookUnticked = needLook.filter((r) => !own.ticked.has(r.key)).length;
    const nothingFound = !rows.length;

    view.append(
      nothingFound
        ? notice(
            'ok',
            'Nothing to fix',
            `Every link on this page points at /${site}. ${own.scan.nodes} nodes were read and nothing was written.`,
            'check'
          )
        : notice('read', 'Preview only · nothing is written', 'You confirm before anything changes.')
    );

    const page = el('div', 'card page-summary');
    const text = el('div', 'tool-text');
    text.append(
      el('div', 'page-card-eyebrow', `Page · site /${site}`),
      el('div', 'page-card-title', own.scan.title || own.page.split('/').pop()),
      el('div', 'page-card-path', own.scan.page || own.page),
      el(
        'div',
        'page-card-note',
        nothingFound
          ? `${own.scan.nodes} nodes read`
          : `${plural(rows.length, 'link')} ${rows.length === 1 ? 'points' : 'point'} into another site`
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

    /* Which sites the page points into, so a pattern - every link to /ae_ar,
       one stray /levant - is seen before the list is read. */
    view.append(
      list([
        kv('This page is on', `/${site}`, true),
        kv('Links found to', (own.scan.otherSites || []).map((o) => `/${o.code} (${o.links})`).join(' · '), true)
      ])
    );

    if (scripted.length) view.append(scriptWarning(scripted.length, site, 'review'));

    if (needLook.length) {
      const missingN = needLook.filter((r) => r.missing).length;
      const uncheckedN = needLook.filter((r) => r.unchecked && !r.missing).length;
      const placeholderN = needLook.filter((r) => r.placeholder && !r.missing && !r.unchecked).length;
      const liveN = needLook.filter((r) => r.liveCopy && !r.placeholder && !r.missing && !r.unchecked).length;
      const warn = el('div', 'notice-stack');
      const line = (iconName, strong, rest) => {
        const row = el('div', 'notice-line');
        row.append(icon(iconName, 18, 2));
        const span = el('span');
        span.append(el('b', null, strong), document.createTextNode(' ' + rest));
        row.append(span);
        warn.append(row);
      };
      const they = (n) => (n === 1 ? 'It is unticked.' : 'They are unticked.');
      if (missingN) {
        line(
          'warn',
          `${plural(missingN, 'link')} would point at a page /${site} does not have.`,
          `Fixing ${missingN === 1 ? 'it' : 'them'} would make a broken link. ${they(missingN)}`
        );
      }
      if (uncheckedN) {
        line('warn', `${plural(uncheckedN, 'link')} could not be checked on /${site}.`, they(uncheckedN));
      }
      if (placeholderN) {
        line(
          'warn',
          `${plural(placeholderN, 'link')} ${placeholderN === 1 ? 'has a placeholder' : 'have placeholders'} such as {site_code} where the site code goes.`,
          `The component may fill ${placeholderN === 1 ? 'it' : 'them'} in when the page is published. Tick one only if it should always point at /${site}. ${they(placeholderN)}`
        );
      }
      if (liveN) {
        line('history', `${plural(liveN, 'link')} ${liveN === 1 ? 'is' : 'are'} on an inherited component.`, 'Fixing breaks inheritance for that property, so they are unticked.');
      }
      view.append(warn);
    }

    view.append(
      label('Links into other sites', {
        text: own.ticked.size === rows.length ? 'Select none' : 'Select all',
        onClick: () => {
          if (own.ticked.size === rows.length) own.ticked.clear();
          else for (const r of rows) own.ticked.add(r.key);
          redraw();
        }
      })
    );

    const shown = own.showAll ? rows : rows.slice(0, SHOW_FIRST);
    const items = shown.map((r) => linkRow(r, site, own.ticked, redraw));
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
          button(tickedCount ? `Continue with ${plural(tickedCount, 'link')}` : 'Tick a link to continue', 'primary', () => goStep('confirm'), {
            disabled: !tickedCount
          }),
          button('Scan again', 'ghost', doScan)
        ]
      })
    );
    return;
  }

  /* -------------------------------------------------------- 3. confirm */

  if (own.phase === 'confirm') {
    const tickedCount = own.ticked.size;
    const needLook = rows.filter((r) => flagged(r) && !own.ticked.has(r.key)).length;
    const scanned = hostOf(own.scanned?.origin || state.origin);
    const front = hostOf(state.origin);

    view.append(notice('write', 'This will change content in AEM', 'Changes go straight to the server below.', 'pen'));
    if (front && scanned && front !== scanned) {
      view.append(notice('warn', `The tab in front is on ${front}`, `This writes to ${scanned}, where the page was scanned.`, 'warn'));
    }
    const scriptedTicked = rows.filter((r) => r.inScript && own.ticked.has(r.key)).length;
    if (scriptedTicked) view.append(scriptWarning(scriptedTicked, site, 'confirm'));
    view.append(
      label('Check before you confirm'),
      list([
        kv('Server', scanned, true),
        kv('Page', own.scan.page || own.page, true),
        kv('Will change', `${plural(tickedCount, 'link')}, pointed at /${site}`),
        kv('Will not change', untouchedNote(rows.length - tickedCount, needLook))
      ])
    );
    footer.append(
      ...footerBar({
        tag: { kind: 'write', text: 'Writes to AEM' },
        note: `${plural(tickedCount, 'link')} · 1 page`,
        buttons: [
          button(`Change ${plural(tickedCount, 'link')} in AEM`, 'write', doFix, { iconName: 'pen' }),
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
  const skipped = rows.length - own.ticked.size;
  // Links into other sites on the page now that the scan never listed: added since.
  const added = Math.max(0, (r.remaining || 0) - skipped);

  view.append(notice('ok', 'Done', `${plural(fixed, 'link')} now ${fixed === 1 ? 'points' : 'point'} at /${r.site || site}.`, 'check'));
  if (r.scripted) view.append(scriptWarning(r.scripted, r.site || site, 'done'));
  if (added) {
    view.append(
      notice(
        'warn',
        `${plural(added, 'more link')} to other sites on the page`,
        `${added === 1 ? 'It was' : 'They were'} not there when the page was scanned. Scan it again to see ${added === 1 ? 'it' : 'them'}.`,
        'warn'
      )
    );
  }
  view.append(
    counts([
      { n: fixed, label: 'changed', tone: 'ok' },
      { n: skipped, label: 'skipped on purpose' }
    ])
  );
  view.append(
    label('Page'),
    list([kv('Page', r.page || own.scan?.page || own.page, true), kv('Server', hostOf(own.scanned?.origin || state.origin), true)])
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
    own.steps = [{ name: 'Reading the page and checking each site', state: 'running' }];
    goStep('running');
    try {
      const scan = await runAction({
        featureId: FEATURE,
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
      own.ticked = new Set(rowsFrom(scan).filter((row) => !flagged(row)).map((row) => row.key));
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
        featureId: FEATURE,
        action: 'fix',
        params: { page: own.scan?.page || own.page, picks: picksFrom(rows, own.ticked) },
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

/** One link: where it is, and the site code in it struck out with this site's beside it. */
function linkRow(row, site, ticked, redraw) {
  const { link } = row;
  const wrap = el('label', 'link-row');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = ticked.has(row.key);
  box.setAttribute('aria-label', `Point ${link.from} at /${site}${row.inScript ? ' (inside a script)' : ''}`);
  box.addEventListener('change', () => {
    if (box.checked) ticked.add(row.key);
    else ticked.delete(row.key);
    redraw();
  });

  const text = el('div', 'link-text');
  const where = el('div', 'link-where');
  where.append(el('span', null, link.text ? `${row.where} · “${link.text}”` : row.where));
  if (row.inScript) where.append(el('span', 'link-tag', 'In a script'));
  if (row.missing) where.append(el('span', 'link-tag', `Not on /${site}`));
  else if (row.unchecked) where.append(el('span', 'link-tag', 'Not checked'));
  else if (row.placeholder) where.append(el('span', 'link-tag', 'Placeholder'));
  else if (row.liveCopy) where.append(el('span', 'link-tag', 'Inherited'));

  const url = el('div', 'link-url');
  url.title = `${link.from} → ${link.to}`;
  url.append(
    el('span', null, link.from.slice(0, link.at)),
    el('span', 'link-cut', link.from.slice(link.at, link.at + link.code.length)),
    el('span', 'link-new', site),
    el('span', null, link.from.slice(link.at + link.code.length))
  );
  text.append(where, url);
  wrap.append(box, text);
  return wrap;
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
