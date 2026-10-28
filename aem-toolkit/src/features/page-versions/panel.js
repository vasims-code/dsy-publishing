/**
 * page-versions, panel side.
 *
 * Draws the page's versions as a list, newest first, with a choice of what to
 * do above it: restore a version, or create a new one with your own message. It holds that choice and the version picked; the shell asks
 * `commitState()` what the button should say and whether it can be pressed,
 * and is told to ask again with an `aemt:flow-changed` event whenever either
 * changes - so the button always names exactly what it will do.
 */

const MODES = [
  { id: 'restore', label: 'Restore' },
  { id: 'create', label: 'Create' }
];

const STEPS = {
  restore: (v) => [
    ['save', 'Save the current content', 'As a new version, so this restore can be undone - unless you unticked it.'],
    ['restore', `Restore version ${v?.number ?? ''}`, 'Only this page\u2019s content. Child pages are not changed.'],
    ['check', 'Check the page', 'Read it back to confirm it now holds this version.']
  ],
  create: () => [
    ['create', 'Save the current content as a new version', 'With your message as its comment.'],
    ['check', 'Check the history', 'Read it back to confirm the new version is there.']
  ]
};

let state = { mode: 'restore', picked: null, message: '' };
let refs = null;

const changed = () => document.dispatchEvent(new CustomEvent('aemt:flow-changed'));

/** "27 Sep 2026, 10:12" in the viewer's own locale; the raw value if unparseable. */
function formatDate(s) {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s || '';
  return new Date(t).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function renderResult(root, data, { el }) {
  if (!data || !('versions' in data)) return;
  state = { mode: data.versions.length ? 'restore' : 'create', picked: null, message: '' };

  const wrap = el('div', 'analysis versions');

  /* ---- counts ----------------------------------------------------------- */
  const bar = el('div', 'summary');
  const counts = el('div', 'summary-counts');
  const n = data.versions.length;
  const count = el('span', 'stat');
  count.dataset.kind = n ? 'copy' : 'skip';
  count.append(el('b', null, String(n)), el('span', null, n === 1 ? ' version' : ' versions'));
  counts.append(count);
  if (data.currentNumber) {
    const cur = el('span', 'stat');
    cur.dataset.kind = 'skip';
    cur.append(el('span', null, 'current: version '), el('b', null, String(data.currentNumber)));
    counts.append(cur);
  }
  bar.append(counts);
  wrap.append(bar);

  /* ---- what to do -------------------------------------------------------- */
  const modes = el('div', 'version-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'What do you want to do?');
  const modeButtons = MODES.map((m) => {
    const b = el('button', 'version-mode', m.label);
    b.type = 'button';
    b.dataset.mode = m.id;
    // Nothing to restore on a page with no versions.
    if (!n && m.id !== 'create') b.disabled = true;
    b.addEventListener('click', () => setMode(el, m.id));
    modes.append(b);
    return b;
  });
  wrap.append(modes);

  /* ---- the message, for a new version ------------------------------------ */
  const create = el('div', 'version-create');
  const label = el('label', null, 'Message for the new version');
  label.htmlFor = 'version-message';
  const message = el('textarea');
  message.id = 'version-message';
  message.rows = 3;
  message.maxLength = 500;
  message.placeholder = 'For example: Before the October campaign changes';
  message.addEventListener('input', () => {
    state.message = message.value;
    changed();
  });
  create.append(label, message, el('p', 'versions-hint', 'Saved as the version\u2019s comment. Up to 500 characters.'));
  wrap.append(create);

  /* ---- the list ------------------------------------------------------------ */
  const hint = el('p', 'versions-hint');
  wrap.append(hint);

  const list = el('ul', 'version-list');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Versions of this page');

  if (!n) {
    wrap.append(
      el(
        'p',
        'versions-empty',
        'This page has no saved versions yet. Write a message above and create the first one.'
      )
    );
  }

  for (const v of data.versions) {
    const li = el('li', 'version');
    li.setAttribute('role', 'radio');
    li.setAttribute('aria-checked', 'false');
    li.tabIndex = 0;
    li.dataset.id = v.id;
    li.dataset.current = String(v.current);

    const head = el('div', 'version-head');
    head.append(el('span', 'version-dot'));
    head.append(el('span', 'version-name', `Version ${v.number}`));
    if (v.current) head.append(el('span', 'version-tag', 'current'));
    else if (v.number === data.versions.length) head.append(el('span', 'version-tag version-tag-new', 'newest'));
    const date = el('span', 'version-date', formatDate(v.created));
    date.title = v.created || '';
    head.append(date);
    li.append(head);

    const body = el('div', 'version-body');
    if (v.title) body.append(el('div', 'version-title', v.title));
    if (v.comment) body.append(el('div', 'version-comment', v.comment));
    if (v.labels.length) {
      const labels = el('div', 'version-labels');
      for (const l of v.labels) {
        const chip = el('span', 'version-label', l);
        chip.title = l;
        labels.append(chip);
      }
      body.append(labels);
    }
    if (v.lastModifiedBy || v.lastModified) {
      const parts = [];
      if (v.lastModified) parts.push(`content last edited ${formatDate(v.lastModified)}`);
      if (v.lastModifiedBy) parts.push(`by ${v.lastModifiedBy}`);
      body.append(el('div', 'version-meta', parts.join(' ')));
    }
    // The repository's real name, to match against CRXDE or the Timeline.
    const aem = el('div', 'version-aem', `AEM version ${v.name}`);
    aem.title = `jcr:uuid ${v.id}`;
    body.append(aem);
    li.append(body);

    const choose = () => {
      if (li.getAttribute('aria-disabled') === 'true') return;
      for (const x of list.querySelectorAll('[aria-checked="true"]')) x.setAttribute('aria-checked', 'false');
      li.setAttribute('aria-checked', 'true');
      state.picked = v;
      paint(el);
    };
    li.addEventListener('click', choose);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        (e.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling)?.focus();
      }
    });
    list.append(li);
  }
  wrap.append(list);

  // Filled in for the action chosen; doubles as the progress view.
  const plan = el('ol', 'plan version-plan');
  wrap.append(plan);

  root.append(wrap);
  refs = { modeButtons, create, message, hint, list, plan };
  paint(el);
}

function setMode(el, mode) {
  state.mode = mode;
  paint(el);
}

/** Bring everything on screen into line with the mode and the pick. */
function paint(el) {
  if (!refs) return;
  const { mode, picked } = state;

  for (const b of refs.modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  refs.create.hidden = mode !== 'create';
  refs.list.dataset.mode = mode;

  refs.hint.textContent = mode === 'restore' ? 'Pick the version to restore.' : 'These are the versions already saved.';

  for (const li of refs.list.children) {
    const off = mode === 'create';
    li.setAttribute('aria-disabled', String(off));
    li.tabIndex = off ? -1 : 0;
    const on = !off && picked && li.dataset.id === picked.id;
    li.setAttribute('aria-checked', String(!!on));
  }

  refs.plan.textContent = '';
  const showPlan = mode === 'create' || picked;
  refs.plan.hidden = !showPlan;
  if (showPlan) {
    for (const [id, title, hint] of STEPS[mode](picked)) {
      const li = el('li', 'plan-step');
      li.dataset.step = id;
      li.dataset.state = 'pending';
      const main = el('div', 'plan-main');
      main.append(el('span', 'plan-title', title), el('span', 'plan-state'));
      li.append(main, el('div', 'plan-hint', hint));
      refs.plan.append(li);
    }
  }
  if (mode === 'create') refs.message.focus({ preventScroll: true });
  changed();
}

/* ------------------------------------------------------------------ flow */

/** What the commit button says, and whether it can be pressed. */
export function commitState() {
  const { mode, picked, message } = state;

  if (mode === 'create') {
    const m = message.trim();
    return m
      ? {
          ready: true,
          label: 'Create version',
          busy: 'Creating\u2026',
          question: 'Create a new version of this page?',
          caption: `The current content is saved, with the message \u201c${m}\u201d.`
        }
      : { ready: false, label: 'Write a message to create a version', question: 'Write a message above.' };
  }

  if (!picked) {
    return { ready: false, label: 'Pick a version to restore', question: 'Pick a version above to restore it.' };
  }

  return {
    ready: true,
    label: `Restore version ${picked.number}`,
    busy: 'Restoring\u2026',
    question: `Restore version ${picked.number}?`,
    caption:
      `The page content goes back to how it was on ${formatDate(picked.created)}. ` +
      'Child pages are not changed.'
  };
}

/** Runs the action chosen here - the form alone does not know it. */
export async function commit(ctx) {
  const { mode, picked, message } = state;
  if (mode === 'create') return ctx.send('create', { ...ctx.params, message });
  if (!picked) return { ok: false, error: 'Pick a version first.' };
  return ctx.send('restore', { ...ctx.params, versionId: picked.id });
}

/* --------------------------------------------------------------- progress */

export function updateStep(root, { id, state: s, note }) {
  const li = root.querySelector(`.version-plan .plan-step[data-step="${cssEscape(id)}"]`);
  if (!li) return;
  li.dataset.state = s;
  const cell = li.querySelector('.plan-state');
  if (cell) {
    cell.textContent = s === 'done' ? (note ? `\u2713 ${note}` : '\u2713') : s === 'failed' ? '\u2717' : note || '';
  }
  if (s === 'running') li.scrollIntoView({ block: 'nearest' });
}

function cssEscape(v) {
  return window.CSS?.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
}
