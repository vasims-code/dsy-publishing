/**
 * Broken Link Finder, as the design draws it.
 *
 * Three steps: pick the page, watch it scan, read the result. The scan reads
 * only - the page's content as JSON, then one read per distinct target on
 * this author instance - and nothing is ever written.
 *
 * The result is laid out the way the copy deck lays out a page: a card per
 * component, named as the editor names it ("03 · FT02_Feature Benefit ·
 * Galaxy S25"), and inside it one row per link, under the field it was typed
 * into ("CTA link") - so an author reads straight off it where to go. The
 * scan's own data decides every number on screen: the result is drawn from
 * the targets the worker handed back and nothing else, so what is listed is
 * exactly what was checked.
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
  more,
  notice,
  openInAem,
  runStep,
  startingStep,
  stepBar,
  titled,
  toTop
} from '../parts.js';
import { logBox, makeLog } from '../log.js';
import { runAction } from '../run.js';
import { loadFields } from '../../features/copy-deck/fields.js';

const STEPS = ['Pick', 'Scan', 'Result'];
/** Rows shown in a component's card before "and N more", as the copy deck shows them. */
const ROWS_FIRST = 12;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const hostOf = (origin) => String(origin || '').replace(/^https?:\/\//, '');
/* The copy deck's added and ignored fields, so the components are named exactly as its sheet names them. */
const fieldsParam = async () => JSON.stringify(await loadFields().catch(() => ({ add: [], ignore: [] })));

/* ------------------------------------------------------- what each one is */

/** The tag on a row, and its tone, from the target's state and kind. */
function tagOf(t) {
  switch (t.state) {
    case 'missing':
      return [t.kind === 'anchor' ? 'No such id' : t.kind === 'badhost' ? 'No .com' : '404', 'err'];
    case 'case':
      return ['Case', 'warn'];
    case 'notpage':
      return [t.kind === 'asset' ? 'Not a file' : 'Not a page', 'warn'];
    case 'forbidden':
      return ['No access', 'warn'];
    case 'error':
      return ['No answer', 'warn'];
    case 'placeholder':
      return ['Placeholder', 'warn'];
    case 'query':
      return ['Check by hand', 'warn'];
    case 'ok':
      return [t.redirect ? 'Redirects' : 'OK', t.redirect ? 'info' : 'ok'];
    default:
      return [t.kind === 'external' ? 'External' : t.kind === 'anchor' ? 'Anchor' : t.kind === 'asset' ? 'Image' : 'Not checked', null];
  }
}

/** The three piles, and what is set aside. */
const isBroken = (t) => t.state === 'missing';
const needsLook = (t) => ['case', 'notpage', 'forbidden', 'error', 'placeholder', 'query'].includes(t.state);
const isOk = (t) => t.state === 'ok';
const isUnchecked = (t) => !isBroken(t) && !needsLook(t) && !isOk(t);

/** Where a link sits, in the copy deck's words: "03 · FT02_Feature Benefit · Galaxy S25 › CTA link". */
const whereOf = (u) => `${u.section || u.component} › ${u.field || u.prop}${u.index >= 0 ? ` [${u.index + 1}]` : ''}`;

/** Broken first, then by how many CTAs point there, then by path. */
function sortTargets(targets) {
  const rank = (t) => (isBroken(t) ? 0 : needsLook(t) ? 1 : isOk(t) ? 3 : 2);
  return [...targets].sort((a, b) => rank(a) - rank(b) || b.uses.length - a.uses.length || String(a.path || a.raw).localeCompare(String(b.path || b.raw)));
}

/**
 * The links of these targets, one per place on the page, under the component
 * each sits in - in page order, as the copy deck lists its sections. Each
 * item is { section, uses: [{ target, use }] }.
 */
function bySection(targets) {
  const map = new Map();
  for (const t of targets) {
    for (const u of t.uses) {
      const key = u.section || u.component || '';
      if (!map.has(key)) map.set(key, { section: key, pos: u.pos ?? 0, uses: [] });
      const s = map.get(key);
      s.pos = Math.min(s.pos, u.pos ?? 0);
      s.uses.push({ target: t, use: u });
    }
  }
  return [...map.values()].sort((a, b) => a.pos - b.pos || a.section.localeCompare(b.section));
}

/* ------------------------------------------------------------ the report */

/** The result as text, for the clipboard - the thing that goes back to the author. */
export function reportText(scan) {
  const when = new Date(scan.at || Date.now());
  const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const lines = [
    `Broken Link Finder · ${scan.page}`,
    `${scan.host} · ${stamp}`,
    `${plural(scan.links, 'link')} in ${plural(scan.components, 'component')} · ${plural(scan.checked, 'distinct target')} checked on author · ${scan.broken} broken · ${scan.look} need a look · ${scan.ok} OK`,
    ''
  ];
  const section = (title, items) => {
    if (!items.length) return;
    lines.push(`${title} (${items.length})`);
    for (const t of items) {
      const [tag] = tagOf(t);
      lines.push(`  [${tag}] ${t.raw}`);
      if (t.path && t.path !== t.raw) lines.push(`      author: ${t.path}`);
      if (t.note) lines.push(`      ${t.note}`);
      if (t.redirect) lines.push(`      redirects to ${t.redirect}`);
      for (const u of t.uses) lines.push(`      in: ${whereOf(u)}${u.text ? ` — “${u.text}”` : ''}`);
    }
    lines.push('');
  };
  const sorted = sortTargets(scan.targets || []);
  section('BROKEN - not on author, or no such id on the page', sorted.filter(isBroken));
  section('NEED A LOOK', sorted.filter(needsLook));
  section('NOT CHECKED', sorted.filter(isUnchecked));
  section('OK - exist on author, or on the page', sorted.filter(isOk));
  return lines.join('\n').trimEnd() + '\n';
}

/* --------------------------------------------------------------- screen */

export async function render(ctx) {
  const { view, footer, state } = ctx;

  /* Everything this tool remembers while it is open. */
  const own = ctx.own;
  if (!own.log) {
    own.log = makeLog(() => {
      if (own.phase === 'running') redraw();
    });
  }

  if (!own.phase) {
    Object.assign(own, {
      phase: 'pick',
      page: null,
      scan: null,
      scanned: null,
      problem: null,
      steps: [],
      /* Which component cards are open, and which have all their rows out: by group and section. */
      open: {},
      showAll: {}
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
  const phaseIndex = { pick: 0, running: 1, result: 2 }[own.phase];

  /* ---------------------------------------------------------- the chrome */

  view.append(
    connPill({
      host: hostOf(own.scanned?.origin || state.origin),
      signedIn: !state.session || state.session.state === 'in' || state.session.state === 'unknown'
    }),
    stepBar(STEPS, phaseIndex)
  );

  if (own.problem) {
    view.append(notice('err', 'That did not work', own.problem, 'warn'));
    view.append(logBox(own.log.lines, { open: true, title: 'What happened' }));
  }

  /* ------------------------------------------------------------ 1. pick */

  if (own.phase === 'pick') {
    view.append(
      notice('read', 'Reads only', 'The page is read on this author instance. Nothing is written, and the live site is never asked.'),
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
    input.placeholder = '/content/samsung/sa_en/mobile-phone-buying-guide';
    input.addEventListener('input', () => {
      own.page = input.value.trim();
      scanBtn.disabled = !own.page.startsWith('/content/');
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !scanBtn.disabled) doScan();
    });
    field.append(input);
    field.append(el('div', 'field-hint', 'Filled in from the page open in AEM. Change it to scan another page on this instance.'));
    view.append(field);

    const how = titled('What gets checked', [
      howRow('link', 'Every button and link on the page, and the page’s canonical and redirect settings.'),
      howRow('globe', 'Links to other websites, like YouTube, are listed but not checked. Only pages and files on this AEM site are checked.'),
      howRow('deck', 'Each problem is listed with the component it is in and the field name, so you know exactly where to go to fix it.')
    ]);
    view.append(how);

    const scanBtn = button('Scan this page', 'primary', doScan, {
      disabled: !own.page.startsWith('/content/'),
      iconName: 'search'
    });
    footer.append(
      ...footerBar({
        tag: { kind: 'read', text: 'Reads only' },
        note: 'Nothing is written',
        buttons: [scanBtn]
      })
    );
    return;
  }

  /* ---------------------------------------------------------- 2. running */

  if (own.phase === 'running') {
    view.append(notice('read', 'Reading the page', 'Every link is looked up on this author instance. Nothing is written.', 'eye'));
    view.append(label('What is happening'));
    view.append(list(own.steps.length ? own.steps.map(runStep) : [startingStep()]));
    const check = own.steps.find((s) => s.id === 'check');
    const m = /^(\d+) of (\d+)$/.exec(check?.note || '');
    if (m && Number(m[2]) > 0) {
      const bar = el('div', 'big-bar');
      const fill = el('div', 'big-bar-fill');
      fill.style.width = `${Math.round((Number(m[1]) / Number(m[2])) * 100)}%`;
      bar.append(fill);
      view.append(bar);
    }
    view.append(logBox(own.log.lines));
    footer.append(...footerBar({ buttons: [busyButton('Scanning…')] }));
    return;
  }

  /* ----------------------------------------------------------- 3. result */

  const scan = own.scan;
  const sorted = sortTargets(scan.targets || []);
  const broken = sorted.filter(isBroken);
  const look = sorted.filter(needsLook);
  const unchecked = sorted.filter(isUnchecked);
  const ok = sorted.filter(isOk);
  const host = scan.host || hostOf(own.scanned?.origin || state.origin);

  view.append(
    broken.length
      ? notice(
          'err',
          plural(broken.length, 'broken link'),
          `${broken.length === 1 ? 'It points' : 'They point'} at ${broken.length === 1 ? 'a page that is' : 'pages that are'} not on ${host}. ${
            look.length ? `${plural(look.length, 'more link')} need${look.length === 1 ? 's' : ''} a look.` : ''
          }`.trim(),
          'warn'
        )
      : look.length
        ? notice('warn', 'No broken links, but some need a look', `${plural(scan.checked, 'target')} checked on ${host}; ${look.length} could not be called fine.`, 'warn')
        : notice('ok', 'No broken links', `${plural(scan.checked, 'distinct target')} checked on ${host}. Every one exists on author.`, 'check')
  );

  const page = el('div', 'card page-summary');
  const text = el('div', 'tool-text');
  text.append(
    el('div', 'page-card-eyebrow', 'Page'),
    el('div', 'page-card-title', scan.title || scan.page.split('/').pop()),
    el('div', 'page-card-path', scan.page),
    el('div', 'page-card-note', `${plural(scan.links, 'link')} in ${plural(scan.components, 'component')} · ${plural(scan.nodes, 'node')} read`)
  );
  const change = el('button', 'label-action', 'Change');
  change.type = 'button';
  change.addEventListener('click', () => {
    reset(own);
    own.page = scan.page;
    goStep('pick');
  });
  page.append(text, change);
  view.append(page);

  view.append(
    counts([
      { n: broken.length, label: 'broken', tone: broken.length ? 'err' : null },
      { n: look.length, label: 'need a look', tone: look.length ? 'warn' : null },
      { n: ok.length, label: 'exist on author', tone: 'ok' }
    ])
  );

  if (scan.site) {
    view.append(el('div', 'run-note', `Site-relative links (/${scan.site}/…) were looked up under ${scan.contentRoot}.`));
  }

  /* The four piles. The two an author has to act on are open, component by
     component as the copy deck lists a page; the two there for completeness
     are folded, the same cards inside. */
  const groups = [
    ['broken', 'Broken · not on author', broken, true],
    ['look', 'Need a look', look, true],
    ['unchecked', 'Not checked', unchecked, false],
    ['ok', 'Exist on author', ok, false]
  ];
  for (const [id, title, items, open] of groups) {
    if (!items.length) continue;
    const sections = bySection(items);
    const n = sections.reduce((sum, s) => sum + s.uses.length, 0);
    const cards = sections.map((s) => sectionCard(id, s, open));
    if (open) {
      const allOpen = sections.every((s) => isOpen(id, s.section, open));
      view.append(
        label(`${title} · ${plural(n, 'link')}`, {
          text: allOpen ? 'Collapse all' : 'Expand all',
          onClick: () => {
            for (const s of sections) own.open[`${id}|${s.section}`] = !allOpen;
            redraw();
          }
        }),
        cardOf(list(cards))
      );
    } else {
      const box = el('details', 'detail bl-group');
      box.open = !!own.open[`${id}|`];
      box.addEventListener('toggle', () => (own.open[`${id}|`] = box.open));
      const sum = el('summary');
      sum.append(el('span', 'detail-title', title), el('span', 'detail-count', String(n)));
      box.append(sum, ...cards);
      if (id === 'unchecked') {
        box.append(el('div', 'list-foot', 'Other sites are never asked, and a link to a place on the same page has nothing to look up.'));
      }
      view.append(box);
    }
  }

  view.append(
    label('Where it was read'),
    list([kv('Page', scan.page, true), kv('Server', host, true)])
  );

  /* The account of the run, under its result. */
  view.append(logBox(own.log.lines));

  const copy = button('Copy the report', 'ghost', async (e) => {
    const b = e.currentTarget;
    const was = b.querySelector('span:last-child');
    const said = was.textContent;
    try {
      await navigator.clipboard.writeText(reportText(scan));
      was.textContent = 'Copied';
    } catch {
      was.textContent = 'Could not copy';
    }
    setTimeout(() => {
      was.textContent = said;
    }, 1500);
  }, { iconName: 'copy' });

  footer.append(
    ...footerBar({
      tag: { kind: 'read', text: 'Reads only' },
      note: `${plural(scan.checked, 'target')} checked · nothing written`,
      /* Two buttons, as the design has it. Another page is "Change" on the
         page card above; the tools are behind the arrow at the top. */
      buttons: [copy, button('Scan again', 'primary', doScan, { iconName: 'search' })]
    })
  );

  /* ------------------------------------------------------ one component */

  /** Whether a component's card is open: as last set, else as its group starts. */
  function isOpen(groupId, section, start) {
    const was = own.open[`${groupId}|${section}`];
    return was == null ? start : was;
  }

  /** A component's card, as the copy deck draws one: its name, how many links, and a row a link. */
  function sectionCard(groupId, s, start) {
    const key = `${groupId}|${s.section}`;
    const box = el('details', 'detail');
    box.open = isOpen(groupId, s.section, start);
    box.addEventListener('toggle', () => (own.open[key] = box.open));
    const sum = el('summary');
    sum.append(el('span', 'detail-title', s.section), el('span', 'detail-count', plural(s.uses.length, 'link')));
    box.append(sum);

    const shown = own.showAll[key] ? s.uses : s.uses.slice(0, ROWS_FIRST);
    for (const { target, use } of shown) box.append(row(target, use));
    if (!own.showAll[key] && s.uses.length > ROWS_FIRST) {
      box.append(
        more(`and ${s.uses.length - ROWS_FIRST} more`, () => {
          own.showAll[key] = true;
          redraw();
        })
      );
    }
    return box;
  }

  /* ----------------------------------------------------------- one link */

  /** One link where it sits: the field it was typed into, then where it goes and what was found there. */
  function row(t, u) {
    const wrap = el('div', 'deck-row bl-row');
    wrap.dataset.state = t.state || t.kind;

    /* The field, as the copy deck labels it - and the words on the CTA, so
       two links in one component are told apart. */
    const field = el('div', 'deck-row-field bl-field');
    field.append(el('span', null, u.field || u.prop));
    if (u.text) field.append(el('span', 'bl-use-text', u.text));
    wrap.append(field);

    const head = el('div', 'deck-row-text bl-head');
    const [tagText, tone] = tagOf(t);
    const tag = el('span', 'bl-tag', tagText);
    if (tone) tag.dataset.tone = tone;
    head.append(tag, el('span', 'bl-raw', t.raw));
    wrap.append(head);

    /* Where on author it was looked for - said when it is not how the link
       was written, which is every site-relative link. */
    if (t.path && t.path !== t.raw) {
      const p = el('div', 'bl-path');
      p.append(document.createTextNode('→ '), el('b', null, t.path));
      wrap.append(p);
    }
    if (t.site && scan.site && t.site !== scan.site && t.kind === 'page') {
      wrap.append(el('div', 'bl-note', `Goes to another site: /${t.site}/…`));
    }
    if (t.redirect) wrap.append(el('div', 'bl-note', `The page redirects to ${t.redirect}`));
    if (t.note && t.state !== 'ok') wrap.append(el('div', 'bl-note', capital(t.note)));

    /* A page with a query on it is there too - opening it is how it gets checked. */
    if (t.kind === 'page' && (t.state === 'ok' || t.state === 'query')) {
      const open = el('button', 'bl-open', 'Open on author');
      open.type = 'button';
      open.addEventListener('click', () => openInAem(own.scanned?.origin || state.origin, `/editor.html${t.path}.html`));
      wrap.append(open);
    }
    return wrap;
  }

  /* ---------------------------------------------------------- the work */

  async function doScan() {
    /* The tab and server this scan reads are the ones it reports about,
       whatever is in front by the time it finishes. */
    const scanned = own.scanned || { tabId: state.tab?.id, origin: state.origin || null };
    own.log?.clear();
    own.problem = null;
    own.steps = [
      { id: 'read', name: 'Reading the page', state: 'running' },
      { id: 'find', name: 'Finding the links', state: 'todo' },
      { id: 'check', name: 'Looking each one up on author', state: 'todo' }
    ];
    const byId = { read: 0, find: 1, check: 2 };
    goStep('running');
    try {
      const scan = await runAction({
        featureId: 'broken-links',
        action: 'scan',
        params: { page: own.page, fields: await fieldsParam() },
        settings: state.settings,
        tabId: scanned.tabId,
        origin: scanned.origin,
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
      own.scan = scan;
      own.scanned = scanned;
      own.open = {};
      own.showAll = {};
      own.phase = 'result';
    } catch (e) {
      own.log?.add('fail', e.message);
      own.problem = e.message;
      own.phase = own.scan ? 'result' : 'pick';
    }
    toTop();
    redraw();
  }
}

function howRow(iconName, text) {
  const row = el('div', 'page-summary');
  const ic = icon(iconName, 18, 2);
  ic.style.color = 'var(--act)';
  ic.style.marginTop = '2px';
  row.append(ic, el('div', 'tool-sub', text));
  return row;
}

const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function reset(own) {
  own.phase = 'pick';
  own.scan = null;
  own.scanned = null;
  own.problem = null;
  own.steps = [];
  own.open = {};
  own.showAll = {};
}
