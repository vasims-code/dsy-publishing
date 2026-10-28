/**
 * Side panel shell.
 *
 * Owns no AEM knowledge. It renders whatever the feature registry describes,
 * ships the command to the content script, and draws what comes back.
 *
 * Screens, in order:
 *
 *   home     what is open in this tab, and one card per feature
 *   input    the feature's form
 *   review   the paths that were analysed and what the analysis found
 *   running  the same plan, ticking through, with a step count
 *   done     the outcome, and where to go next
 *
 * The flow is deliberately two-step: analyze, read what it found, then commit.
 * While an analysis is on screen the form is put away, so the paths that get
 * written cannot drift from the paths that were approved.
 */

import { SESSION, looksLikeAem, pickable, readSession, sessionNote } from '../core/instances.js';
import { MSG, STORAGE_KEY, loadSettings, saveSettings } from '../core/protocol.js';
import { loadAllMeta, loadPanel } from '../features/registry.js';
import { icon, shieldArt } from './icons.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const PHASE = { INPUT: 'input', REVIEW: 'review', DONE: 'done' };

const state = {
  settings: null,
  metas: [],
  /** null while on the home screen. */
  activeId: null,
  tab: null,
  origin: null,
  allowed: false,
  /** The AEM page open in this tab, if the URL names one. */
  page: null,
  phase: PHASE.INPUT,
  busy: false,
  /** Busy with the write rather than the analysis - drives the progress header. */
  committing: false,
  runId: null,
  /** Commit wording for the analysis on screen - a feature's variant can replace it. */
  commit: null,
  /** What the analysis on screen returned, so the footer can read its removals and blockers. */
  analysis: null,
  /** The operator ticked "I understand content will be removed". */
  ack: false,
  /** The operator ticked "I have checked the page properties - update them". */
  ackMeta: false,
  /** A run stopped part-way, so the analysis on screen no longer says what a run would do. */
  stale: false,
  /** The result of the finished run, for the done screen. */
  outcome: null,
  /** Sign-in state per enabled instance, from the last check - see checkSessions. */
  sessions: new Map()
};

const activeMeta = () => state.metas.find((m) => m.id === state.activeId);
/** Features on show: a feature with `enabledBy` appears only once that setting is on. */
const visibleMetas = () => state.metas.filter((m) => !m.enabledBy || state.settings?.[m.enabledBy] === true);
const gated = (meta) => meta?.requiresCurrentTab !== false && !state.allowed;
const hostOf = (origin) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin || '';
  }
};

/* ------------------------------------------------------------------ host */

/**
 * The page a tab is showing, read off its URL. Covers the page editor, the
 * page itself, its properties dialog and the Sites console. Anything else is
 * not a page, and the panel says nothing rather than guessing.
 */
function pageFromUrl(url) {
  const pathOnly = (p) => {
    const segs = decodeURI(p).split('/').filter(Boolean);
    if (segs[0] !== 'content' || segs.length < 2) return null;
    // The last segment carries selectors and the extension: "microwaves.html".
    segs[segs.length - 1] = segs[segs.length - 1].split('.')[0];
    return '/' + segs.join('/');
  };

  const p = url.pathname;
  if (p.startsWith('/editor.html/')) return pathOnly(p.slice('/editor.html'.length));
  if (p.startsWith('/sites.html/')) return pathOnly(p.slice('/sites.html'.length));
  if (p.startsWith('/content/') && !p.startsWith('/content/dam/')) return pathOnly(p);
  const item = url.searchParams.get('item');
  if (item && p.includes('/properties.html')) return pathOnly(item);
  return null;
}

async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  state.tab = tab || null;
  state.origin = null;
  state.allowed = false;
  state.page = null;

  if (!tab?.url) return;
  let url;
  try {
    url = new URL(tab.url);
  } catch {
    return;
  }
  if (!/^https?:$/.test(url.protocol)) return;

  /* A tab that is not an AEM instance is treated as no AEM tab at all, so the
   * panel never offers to enable Jira. An instance already in the list counts
   * whatever its URL says, because someone decided it was one. */
  const enabled = state.settings.origins.includes(url.origin);
  if (!enabled && !looksLikeAem(url)) return;

  state.origin = url.origin;
  state.allowed = enabled && (await chrome.permissions.contains({ origins: [`${url.origin}/*`] }));

  const path = pageFromUrl(url);
  if (path) {
    // AEM tab titles carry a product suffix; the page's own title comes first.
    const title = String(tab.title || '').split(/\s+[|–-]\s+/)[0].trim();
    state.page = { path, title: title && !title.startsWith('/') ? title : path.split('/').pop() };
  }
}

async function allowThisSite() {
  if (!(await chrome.permissions.request({ origins: [`${state.origin}/*`] }))) return;
  state.settings = await saveSettings({
    origins: [...new Set([...state.settings.origins, state.origin])]
  });
  await refresh();
}

/** The footer line on every screen: which server a run would talk to. */
function renderStatus() {
  const s = $('status');
  s.textContent = '';
  const dot = el('span', 'status-dot');

  if (!state.origin) {
    s.dataset.tone = 'idle';
    s.append(dot, el('span', null, 'No AEM tab'));
  } else if (state.allowed) {
    // Allowed is not signed in: the last session check decides the colour.
    const session = state.sessions.get(state.origin)?.state;
    if (session === SESSION.OUT) {
      s.dataset.tone = 'warn';
      s.append(dot, el('span', null, 'Failed to connect, log in again: '), el('b', null, hostOf(state.origin)));
    } else if (session === SESSION.UNREACHABLE || session === SESSION.NOT_AEM) {
      s.dataset.tone = 'warn';
      s.append(dot, el('span', null, 'Failed to connect, check the VPN: '), el('b', null, hostOf(state.origin)));
    } else {
      s.dataset.tone = 'ok';
      s.append(dot, el('span', null, 'Connected: '), el('b', null, hostOf(state.origin)));
    }
  } else {
    s.dataset.tone = 'warn';
    s.append(dot, el('span', null, `${hostOf(state.origin)} is not enabled`));
  }
}

/**
 * Why nothing can run here, and the one thing to do about it. Full size on the
 * home screen; compact above a form that cannot be used yet.
 */
function enableState(compact) {
  const box = el('div', compact ? 'gate' : 'empty-state');

  if (!state.origin) {
    if (!compact) box.append(icon('tab', 40, 'empty-icon'));
    box.append(el(compact ? 'p' : 'h2', compact ? 'gate-title' : null, 'Open an AEM author tab'));
    box.append(
      el(
        'p',
        compact ? 'gate-text' : 'empty-text',
        'Switch to a tab on your author instance to back up or sync its pages. ' +
          'Bringing a page from another server works from any tab.'
      )
    );
    // Only AEM-looking tabs are offered "Allow this site"; an instance at an
    // address that does not look like one is added by hand.
    if (!compact) {
      const add = el('button', 'link-btn', 'Add an instance in settings');
      add.type = 'button';
      add.addEventListener('click', () => chrome.runtime.openOptionsPage());
      box.append(add);
    }
    return box;
  }

  if (!compact) box.append(shieldArt());
  box.append(el(compact ? 'p' : 'h2', compact ? 'gate-title' : null, 'This site isn’t enabled yet'));
  box.append(
    el(
      'p',
      compact ? 'gate-text' : 'empty-text',
      `DSY runs inside your author tab, using your existing sign-in session. ` +
        `Enable ${hostOf(state.origin)} to let it read and update pages here.`
    )
  );
  if (!compact) {
    const safe = el('p', 'empty-safe');
    safe.append(icon('lock', 14), el('span', null, 'Everything stays same-origin. Nothing leaves your session.'));
    box.append(safe);
  }
  const btn = el('button', 'btn', 'Allow this site');
  btn.type = 'button';
  btn.dataset.tone = 'primary';
  btn.addEventListener('click', allowThisSite);
  box.append(btn);
  return box;
}

/* ------------------------------------------------------------------ home */

function renderHome() {
  const root = $('home');
  root.textContent = '';

  if (!state.allowed) {
    root.append(enableState(false));
  } else if (state.page) {
    const card = el('div', 'page-card');
    card.append(icon('page', 22, 'page-card-icon'));
    const text = el('div', 'page-card-text');
    text.append(el('span', 'eyebrow', 'Current page'));
    text.append(el('span', 'page-card-title', state.page.title));
    const path = el('span', 'page-card-path', state.page.path);
    path.title = state.page.path;
    text.append(path);
    card.append(text);
    root.append(card);
  }

  root.append(el('p', 'home-q', 'What do you want to do?'));

  const list = el('div', 'cards');
  for (const meta of visibleMetas()) {
    const card = el('button', 'card');
    card.type = 'button';
    const off = gated(meta);
    card.disabled = off;

    card.append(icon(meta.icon || 'page', 26, 'card-icon'));
    const text = el('span', 'card-text');
    text.append(el('span', 'card-title', meta.title));
    text.append(el('span', 'card-summary', meta.summary));
    if (off) text.append(el('span', 'card-note', state.origin ? 'Needs this site enabled' : 'Needs an AEM author tab'));
    card.append(text);

    card.addEventListener('click', () => openFeature(meta.id));
    list.append(card);
  }
  root.append(list);
}

function goHome() {
  if (state.busy) return;
  state.activeId = null;
  state.phase = PHASE.INPUT;
  clearOutput();
  render();
}

function openFeature(id) {
  if (state.busy) return;
  state.activeId = id;
  state.phase = PHASE.INPUT;
  clearOutput();
  renderFeature();
  render();
  if (wantsSessions()) checkSessions();
}

/* --------------------------------------------------------------- features */

/**
 * Fields of type `derived` are worked out from the others rather than typed.
 * Recomputed on every edit, and on settings changes, so the field always shows
 * what the worker will derive for itself.
 *
 * A field with `editableIf` is typed instead while that holds - the Backup
 * destination of a global page, say - starting from what was derived, and its
 * `check` runs on what is typed. A derived field's `hint` may be a function too.
 *
 * Any field with `showIf` is hidden while that does not hold, and the Advanced
 * section with it when nothing in it is left to show.
 */
function updateDerived() {
  const meta = activeMeta();
  if (!meta) return;
  const params = collect();

  for (const f of meta.fields) {
    if (!f.showIf) continue;
    const wrap = $(`w-${f.name}`);
    if (wrap) wrap.hidden = !f.showIf(params, state.settings);
  }
  const advanced = document.querySelector('#feature-form details.advanced');
  if (advanced) advanced.hidden = ![...advanced.querySelectorAll(':scope > .field')].some((w) => !w.hidden);

  for (const f of meta.fields) {
    if (f.type !== 'derived') continue;
    const input = $(`f-${f.name}`);
    const shown = $(`f-${f.name}-shown`);
    const problem = $(`f-${f.name}-problem`);
    const typed = $(`f-${f.name}-typed`);
    const hint = $(`f-${f.name}-hint`);
    if (!input) continue;

    if (hint && typeof f.hint === 'function') hint.textContent = f.hint(params, state.settings) || '';

    /* The pencil is offered while `editableIf` holds. Three states: the path
     * worked out for you; the typed box open (tick to finish); and the typed
     * path, locked again like a worked-out one, with the pencil to reopen it. */
    const flag = f.editFlag ? $(`f-${f.editFlag}`) : null;
    const allowed = !!(typed && flag && f.editableIf?.(params, state.settings));
    if (flag && !allowed) flag.value = '';
    const editable = allowed && flag.value === 'true';
    const open = editable && typed.parentElement.dataset.open === 'true';
    if (typed) {
      typed.parentElement.hidden = !open;
      if (shown) shown.parentElement.hidden = open;
      const pencil = $(`f-${f.name}-edit`);
      if (pencil) pencil.hidden = !allowed;
      const undo = $(`f-${f.name}-undo`);
      if (undo) undo.hidden = !editable || open;
      shown?.parentElement.classList.toggle('has-two-actions', editable && !open);
    }

    const show = (v) => {
      input.value = v;
      if (!shown) return;
      shown.textContent = v || f.placeholder || '';
      shown.dataset.empty = String(!v);
    };
    const fail = (e) => {
      if (!problem) return;
      problem.textContent = e.message;
      problem.hidden = false;
    };
    if (problem) problem.hidden = true;

    if (editable) {
      show(typed.value.trim());
      // Nothing typed yet is not a problem to shout about - the run says so if it comes to that.
      if (input.value && f.check) {
        try {
          f.check({ ...params, [f.name]: input.value }, state.settings);
        } catch (e) {
          fail(e);
        }
      }
      continue;
    }

    try {
      show(f.derive(params, state.settings) || '');
    } catch (e) {
      show('');
      fail(e);
    }
  }
}

/** The info box: what the run does, one line each, and the full story folded underneath. */
function callout(meta) {
  const box = el('div', 'callout');
  const c = meta.callout;

  if (c) {
    box.append(el('p', 'callout-title', c.title));
    const list = el('ul', 'callout-list');
    for (const [name, text] of c.items || []) {
      const li = el('li');
      li.append(icon(name, 17), el('span', null, text));
      list.append(li);
    }
    box.append(list);
    if (c.note) box.append(el('p', 'callout-note', c.note));
  }

  const more = el('details', 'callout-more');
  more.append(el('summary', null, 'More about this'));
  more.append(el('p', null, meta.description));
  box.append(more);
  return box;
}

function renderFeature() {
  const root = $('feature');
  root.textContent = '';

  const meta = activeMeta();
  if (!meta) return;

  const gate = el('div');
  gate.id = 'gate';
  root.append(gate);

  const form = el('form');
  form.id = 'feature-form';
  form.addEventListener('submit', (e) => e.preventDefault());

  /* Fields nobody fills in on an ordinary run are folded away. Left inline they
   * read as something that has to be decided, which is how an escape hatch
   * turns into a question. */
  const advanced = el('details', 'advanced');
  advanced.append(el('summary', null, 'Advanced'));
  let hasAdvanced = false;

  // Changing any input invalidates an analysis that is already on screen -
  // including a checkbox, which changes what the run is allowed to do.
  const invalidate = () => {
    updateDerived();
    if (state.phase !== PHASE.INPUT) {
      state.phase = PHASE.INPUT;
      clearOutput();
      render();
    }
  };

  for (const f of meta.fields) {
    const wrap = el('div', 'field');
    wrap.id = `w-${f.name}`; // for `showIf`
    const target = f.advanced ? ((hasAdvanced = true), advanced) : form;

    const input = el('input');
    input.id = `f-${f.name}`;
    input.name = f.name;
    input.dataset.kind = f.type === 'checkbox' ? 'checkbox' : 'text';

    // Between the two halves of a form that goes from one place to another.
    if (meta.swap && f.name === meta.swap[0][1]) form.append(swapControl(meta, invalidate));

    if (f.type === 'origin') {
      // Only instances already enabled and granted, so a feature can never
      // reach an origin the user has not deliberately allowed. What each
      // option says, and whether it can be picked, is paintPickers' job.
      const label = el('label', null, f.label);
      label.htmlFor = `f-${f.name}`;

      const select = document.createElement('select');
      select.id = `f-${f.name}`;
      select.name = f.name;
      select.dataset.kind = 'origin';
      select.addEventListener('change', invalidate);
      fillPicker(select, f);
      if (f.default === 'current' && pickerOrigins(f).includes(state.origin)) select.value = state.origin;

      const shell = el('div', 'select');
      shell.append(select);
      wrap.append(label, shell);
      if (f.hint) wrap.append(el('div', 'hint', f.hint));
      target.append(wrap);
      continue;
    }

    if (f.type === 'custom') {
      /* A control the feature draws itself - a paste area, say. Its value sits
       * in a hidden input like any other field's, so collecting it, requiring
       * it and clearing an analysis when it changes need no special case. */
      input.type = 'hidden';
      input.dataset.kind = 'custom';
      const label = el('label', null, f.label);
      const host = el('div', 'custom-field');
      wrap.append(label, input, host);
      if (f.hint) wrap.append(el('div', 'hint', f.hint));
      target.append(wrap);
      featurePanel(meta.id).then((mod) => mod?.renderField?.(host, f, { el, icon, input, changed: invalidate }));
      continue;
    }

    if (f.type === 'checkbox') {
      input.type = 'checkbox';
      input.checked = f.default === true;
      input.addEventListener('change', invalidate);

      const label = el('label', 'check');
      label.append(input, el('span', null, f.label));
      wrap.append(label);
    } else if (f.type === 'derived') {
      // Shown as text rather than a read-only input, so a long path wraps
      // instead of being cut off - the hidden input is what gets collected.
      const label = el('label', null, f.label);
      label.htmlFor = `f-${f.name}-shown`;

      input.type = 'hidden';
      input.dataset.kind = 'derived';

      const shown = el('div', 'derived');
      shown.id = `f-${f.name}-shown`;
      shown.setAttribute('role', 'textbox');
      shown.setAttribute('aria-readonly', 'true');

      const shell = el('div', 'input-shell');
      shell.append(icon('lock', 15, 'input-icon'), shown, input);

      const problem = el('div', 'hint derived-problem');
      problem.id = `f-${f.name}-problem`;
      problem.hidden = true;

      wrap.append(label, shell);

      /* While `editableIf` holds, a pencil in the field opens it for typing,
       * starting from the value shown; a tick in the same place (or Enter)
       * locks what was typed back into the field, and an undo button next to
       * the pencil goes back to the path worked out for you. Which of the two
       * the run uses travels as the hidden `editFlag` field. The typed box has
       * no name, so it is not collected itself: updateDerived copies it into
       * the hidden input. */
      if (f.editableIf && f.editFlag) {
        const flag = el('input');
        flag.type = 'hidden';
        flag.id = `f-${f.editFlag}`;
        flag.name = f.editFlag;

        const typed = el('input');
        typed.id = `f-${f.name}-typed`;
        typed.type = 'text';
        typed.placeholder = f.editablePlaceholder || '';
        typed.spellcheck = false;
        typed.autocomplete = 'off';
        typed.addEventListener('input', invalidate);

        const action = (name, title, onClick) => {
          const b = el('button', 'field-action');
          b.type = 'button';
          b.title = title;
          b.setAttribute('aria-label', title);
          b.append(icon(name, 15));
          b.addEventListener('click', onClick);
          return b;
        };

        const typedShell = el('div', 'input-shell has-action');
        typedShell.hidden = true;

        const pencil = action('edit', 'Edit the destination path', () => {
          typed.value = input.value;
          flag.value = 'true';
          typedShell.dataset.open = 'true';
          invalidate();
          typed.focus();
        });
        pencil.id = `f-${f.name}-edit`;
        pencil.hidden = true;

        const undo = action('undo', 'Go back to the path worked out for you', () => {
          typed.value = '';
          flag.value = '';
          invalidate();
        });
        undo.id = `f-${f.name}-undo`;
        undo.classList.add('second');
        undo.hidden = true;

        // Finished typing: lock it in. Emptied, it is the worked-out path again.
        const done = () => {
          typedShell.dataset.open = '';
          if (!typed.value.trim()) flag.value = '';
          invalidate();
        };
        typed.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            done();
          }
        });

        shell.classList.add('has-action');
        shell.append(undo, pencil, flag);
        typedShell.append(typed, action('check', 'Done - use this path', done));
        wrap.append(typedShell);
      }

      wrap.append(problem);
      if (f.hint) {
        // A function is filled in by updateDerived, which knows the other fields.
        const hint = el('div', 'hint', typeof f.hint === 'function' ? '' : f.hint);
        hint.id = `f-${f.name}-hint`;
        wrap.append(hint);
      }
      target.append(wrap);
      continue;
    } else {
      const label = el('label', null, f.label);
      label.htmlFor = `f-${f.name}`;

      input.type = 'text';
      input.placeholder = f.placeholder || '';
      input.spellcheck = false;
      input.autocomplete = 'off';
      if (f.required) input.required = true;
      input.value = prefillFor(f);
      input.addEventListener('input', invalidate);

      wrap.append(label, input);
    }

    if (f.hint) wrap.append(el('div', 'hint', f.hint));
    target.append(wrap);
  }

  form.append(callout(meta));
  if (hasAdvanced) form.append(advanced);
  root.append(form);
  updateDerived();

  /* Two instance pickers that both open on the same origin would only ever
   * produce "source and destination are the same". Nudge the one that has no
   * claim on this tab, so a field defaulting to "current" keeps it. */
  const pickers = [...form.querySelectorAll('select[data-kind="origin"]')];
  if (pickers.length === 2 && pickers[0].value === pickers[1].value) {
    const wantsCurrent = (s) => meta.fields.find((f) => f.name === s.name)?.default === 'current';
    const move = wantsCurrent(pickers[1]) && !wantsCurrent(pickers[0]) ? pickers[0] : pickers[1];
    const keep = move === pickers[0] ? pickers[1] : pickers[0];
    const other = [...move.options].find((o) => o.value && o.value !== keep.value);
    if (other) move.value = other.value;
  }
  if (pickers.length) wirePickers(pickers);
  paintPickers();
}

/* ------------------------------------------------------ instance pickers */

/** The instances a picker offers: every enabled one, less this tab's if the field says so. */
const pickerOrigins = (f) =>
  state.settings.origins.filter((o) => (f?.exclude === 'current' ? o !== state.origin : true));

/**
 * Bring a picker's options in line with the enabled instances - one added in
 * settings while the form is open appears without reopening it - and keep its
 * choice where it is still offered.
 */
function fillPicker(select, f) {
  const list = pickerOrigins(f);
  const want = list.length ? list : [''];
  const have = [...select.options].map((o) => o.value);
  if (have.length === want.length && have.every((v, i) => v === want[i])) return;

  const keep = select.value;
  select.textContent = '';
  for (const o of want) {
    const opt = document.createElement('option');
    opt.value = o;
    if (!o) opt.textContent = 'No instance enabled — add one in settings';
    select.append(opt);
  }
  if (list.includes(keep)) select.value = keep;
}

/**
 * Draw the pickers on the open form from what is known: which instance this
 * tab is on, and whether you are signed in to each. One you are not signed in
 * to is listed but cannot be picked - a run pointed at it would only get the
 * login page back.
 */
function paintPickers() {
  const meta = activeMeta();
  const pickers = [...document.querySelectorAll('#feature-form select[data-kind="origin"]')];
  if (!meta || !pickers.length) return;
  // Choices move only while the form is what is on screen. Once analysed, the
  // instances that were reviewed are the ones the run uses, whatever a later
  // check or a settings change says.
  const editable = state.phase === PHASE.INPUT && !state.busy;

  for (const select of pickers) {
    if (editable) fillPicker(select, meta.fields.find((f) => f.name === select.name));
    for (const opt of select.options) {
      if (!opt.value) continue;
      const s = state.sessions.get(opt.value) || { state: SESSION.CHECKING };
      const note = sessionNote(s);
      // Saying which one the panel is attached to is the whole point: with
      // it unlabelled, "here" in an error message means nothing.
      opt.textContent =
        hostOf(opt.value) + (opt.value === state.origin ? '  (this tab)' : '') + (note ? `  — ${note}` : '');
      opt.title = s.user ? `${opt.value}, signed in as ${s.user}` : opt.value;
      opt.disabled = !pickable(s);
    }
  }
  if (editable) settlePickers(pickers);
  notePickers(pickers);
}

/**
 * No picker rests on an instance it cannot use, and two never name the same
 * server - a transfer from a server to itself can only fail. A picker that
 * breaks either rule moves to the first instance that keeps both, if there is
 * one; the note under the pickers says when there is not.
 */
function settlePickers(pickers) {
  for (const p of pickers) {
    const taken = pickers.filter((q) => q !== p).map((q) => q.value);
    const fits = (v) => !!v && pickable(state.sessions.get(v)) && !taken.includes(v);
    if (fits(p.value)) continue;
    const next = [...p.options].find((o) => fits(o.value));
    if (next) p.value = next.value;
  }
  for (const p of pickers) p.dataset.prev = p.value;
}

/**
 * Picking, in one list, the server the other list has swaps the two. Nothing
 * is greyed out for being picked on the other side, so reversing a transfer
 * is one pick - not a detour through a third instance, or impossible with two.
 */
function wirePickers(pickers) {
  for (const p of pickers) {
    p.addEventListener('change', () => {
      for (const q of pickers) {
        if (q !== p && q.value === p.value && p.dataset.prev) q.value = p.dataset.prev;
      }
      settlePickers(pickers);
      notePickers(pickers);
    });
  }
}

const joinHosts = (hosts) =>
  hosts.length < 2 ? hosts.join('') : `${hosts.slice(0, -1).join(', ')} and ${hosts[hosts.length - 1]}`;

/** Why an instance is greyed out, and what to do about it. */
const WHY = {
  [SESSION.OUT]: (h) => `Not signed in to ${h}. Sign in there, then come back to this panel — the list is checked again.`,
  [SESSION.UNREACHABLE]: (h) => `Can’t reach ${h}. Check the VPN, or that the instance is up.`,
  [SESSION.NOT_AEM]: (h) => `${h} does not answer like an AEM author instance. Remove it in settings.`,
  [SESSION.UNGRANTED]: (h) => `${h} has not been granted. Grant it in settings.`
};

/** The line under the pickers: why an instance is greyed out, or why no run can start. */
function notePickers(pickers) {
  const last = pickers[pickers.length - 1];
  const field = last.closest('.field');
  let note = field.querySelector('.picker-note');
  if (!note) {
    note = el('div', 'hint picker-note');
    field.append(note);
  }

  const listed = [...last.options].map((o) => o.value).filter(Boolean);
  const lines = [];
  if (pickers.length === 2 && listed.length === 1) {
    lines.push(
      'Only one instance is enabled, and a page cannot be brought from a server to itself. ' +
        'Add the other instance in settings.'
    );
  }
  for (const [kind, why] of Object.entries(WHY)) {
    const hosts = listed.filter((o) => state.sessions.get(o)?.state === kind).map(hostOf);
    if (hosts.length) lines.push(why(joinHosts(hosts)));
  }

  // A warning only when it stops the run; otherwise it just explains a grey row.
  const usable = new Set(pickers.map((p) => p.value).filter((v) => v && pickable(state.sessions.get(v))));
  note.dataset.tone = usable.size < pickers.length ? 'warn' : 'info';
  note.textContent = lines.join(' ');
  note.hidden = !lines.length;
}

/**
 * Reverses a run that goes from one place to another: each pair of fields the
 * feature names trades values - instances, pages, locale folders - so running
 * a transfer back the other way is one click rather than four edits.
 */
function swapControl(meta, changed) {
  const row = el('div', 'swap-row');
  const b = el('button', 'link-btn swap-btn');
  b.type = 'button';
  b.append(icon('swap', 15), el('span', null, 'Swap source and destination'));
  b.addEventListener('click', () => {
    for (const [x, y] of meta.swap) {
      const a = $(`f-${x}`);
      const c = $(`f-${y}`);
      if (!a || !c) continue;
      const [va, vc] = [a.value, c.value];
      a.value = vc;
      c.value = va;
      // A select takes only a value it offers; put both back rather than lose one.
      if (a.value !== vc || c.value !== va) [a.value, c.value] = [va, vc];
    }
    for (const p of document.querySelectorAll('#feature-form select[data-kind="origin"]')) p.dataset.prev = p.value;
    paintPickers();
    changed();
  });
  row.append(b);
  return row;
}

/* ---------------------------------------------------------------- sign-in */

/** A tab on this origin that can answer now - loaded, not discarded - or null. */
async function loadedTabOn(origin) {
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  return tabs.find((t) => !t.discarded && t.status === 'complete') || null;
}

/** Ask the content script in a tab who is signed in there. Null when it cannot answer. */
async function askTab(tabId) {
  const ensure = await chrome.runtime.sendMessage({ type: 'aemt:ensure-content-script', tabId });
  if (!ensure?.ok) return null;
  const answer = await chrome.tabs.sendMessage(tabId, { type: MSG.SESSION });
  return answer?.state ? answer : null;
}

/**
 * Whether you are signed in to an instance. A tab already open there is asked
 * first: it answers from inside the instance, with its own session - the
 * position every run is in. With no tab open the panel asks itself: one GET,
 * nothing written, and Chrome sends the instance's cookie with it because the
 * origin is granted.
 */
async function checkSession(origin) {
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) return { state: SESSION.UNGRANTED };
  const tab = await loadedTabOn(origin);
  const inTab = tab ? await askTab(tab.id).catch(() => null) : null;
  return inTab || readSession(origin, { credentials: 'include' });
}

/** Only a form with instance pickers needs to know. */
const wantsSessions = () => !!activeMeta()?.fields.some((f) => f.type === 'origin');

let checking = null;
let checkAgain = false;
let lastCheck = 0;

/**
 * Check every enabled instance, then repaint the pickers. A call while a check
 * is running folds into one more pass after it, so a burst of tab events costs
 * one extra round, not one each.
 */
function checkSessions() {
  if (checking) {
    checkAgain = true;
    return checking;
  }
  checking = (async () => {
    do {
      checkAgain = false;
      lastCheck = Date.now();
      const origins = [...state.settings.origins];
      const found = await Promise.all(
        origins.map((o) => checkSession(o).catch(() => ({ state: SESSION.UNKNOWN })))
      );
      origins.forEach((o, i) => state.sessions.set(o, found[i]));
      paintPickers();
      renderStatus();
    } while (checkAgain);
  })().finally(() => {
    checking = null;
  });
  return checking;
}

/**
 * The footer's own check: just this tab's instance, read-only. On every screen,
 * not only forms with pickers, so "Connected" means signed in, not just allowed.
 */
let statusCheck = null;
function checkStatusSession() {
  const origin = state.origin;
  if (!origin || !state.allowed || statusCheck) return statusCheck;
  statusCheck = checkSession(origin)
    .catch(() => ({ state: SESSION.UNKNOWN }))
    .then((s) => {
      state.sessions.set(origin, s);
      lastCheck = Date.now();
      renderStatus();
      if (wantsSessions()) paintPickers();
    })
    .finally(() => {
      statusCheck = null;
    });
  return statusCheck;
}

/** The compact "enable this site" notice above a form that needs it. */
function renderGate() {
  const gate = $('gate');
  if (!gate) return;
  gate.textContent = '';
  if (gated(activeMeta())) gate.append(enableState(true));
}

/**
 * Once analysed, the form is put away and the paths it was analysed with are
 * shown instead - what is on screen is what will be written.
 */
function renderBanner() {
  const root = $('banner');
  root.textContent = '';
  if (state.phase === PHASE.INPUT) return;

  const p = collect();
  const side = (label, path, origin) => {
    const s = el('div', 'banner-side');
    s.append(el('span', 'eyebrow', label));
    if (origin) s.append(el('span', 'banner-host', hostOf(origin)));
    const v = el('span', 'banner-path', path || '—');
    v.title = path || '';
    s.append(v);
    return s;
  };

  const b = el('div', 'banner');
  const meta = activeMeta();
  if (meta?.banner) {
    // A feature that is not a move from one place to another says what to show.
    meta.banner(p).forEach(({ label, path, origin }) => b.append(side(label, path, origin)));
  } else {
    b.append(side('Source', p.source, p.sourceOrigin));
    b.append(icon('arrow', 18, 'banner-arrow'));
    b.append(side('Destination', p.dest, p.destOrigin));
  }
  root.append(b);
}

/* ---------------------------------------------------------------- screens */

function renderHeader() {
  const meta = activeMeta();
  const back = $('back');
  const sub = $('subtitle');

  back.hidden = !meta;
  back.disabled = state.busy;

  // Home: the name, spelled out underneath. A feature's screens put their own words there.
  let title = 'DSY';
  let subtitle = meta ? '' : 'Digital Samsung Yard';
  if (meta) {
    if (state.committing) {
      title = (state.commit || meta.flow.commit).busy || 'Working…';
      subtitle = meta.title;
    } else if (state.phase === PHASE.REVIEW) {
      title = state.stale ? 'Stopped part-way' : 'Review before you run';
      subtitle = meta.title;
    } else if (state.phase === PHASE.DONE) {
      title = state.outcome?.title || meta.flow.done?.title || 'Done';
      subtitle = meta.title;
    } else {
      title = meta.title;
    }
  }
  $('title').textContent = title;
  sub.textContent = subtitle;
  sub.hidden = !subtitle;
  updateProgress();
}

function render() {
  const meta = activeMeta();
  $('home').hidden = !!meta;
  $('feature-view').hidden = !meta;
  document.body.dataset.screen = meta ? state.phase : 'home';

  renderHeader();
  renderStatus();

  if (!meta) {
    renderHome();
  } else {
    renderGate();
    const form = $('feature-form');
    if (form) form.hidden = state.phase !== PHASE.INPUT;
    renderBanner();
    setFormEnabled(state.phase === PHASE.INPUT && !state.busy);
  }
  renderFlow();
}

/* ------------------------------------------------------------------ flow */

/**
 * What the analysis on screen would remove, and whether it can run at all.
 * The Backup tab carries its sync plan one level down.
 */
function reviewFacts(result) {
  const r = result?.sync || result || {};
  return {
    nodes: r.counts?.nodesDeleted || 0,
    props: r.props?.deleted?.length || 0,
    blocked: (r.blockers?.length || 0) > 0,
    /* Enough removed to look like the wrong page rather than drift. Not a
     * blocker - the tick box below is the confirmation, and the run checks it. */
    large: r.largeRemoval || null,
    /* Page properties that would change on a page that already exists. */
    metadata: r.metadata?.props?.length ? r.metadata : null
  };
}

function btn(label, tone, onClick, { disabled = false, busy = false } = {}) {
  const b = el('button', 'btn');
  b.type = 'button';
  b.dataset.tone = tone;
  b.disabled = disabled;
  if (busy) b.append(el('span', 'spinner'));
  b.append(el('span', null, label));
  b.addEventListener('click', onClick);
  return b;
}

function renderFlow() {
  const bar = $('flow');
  bar.textContent = '';
  const ask = $('confirm');
  ask.textContent = '';

  const meta = activeMeta();
  if (!meta) return;

  /* A feature that names its own instances does not care which tab the panel
   * happens to be attached to, so it is not gated on one. Features that act on
   * "this tab" still are. */
  const ready = !gated(meta) && !state.busy;

  if (state.phase === PHASE.INPUT) {
    const a = meta.flow.analyze;
    bar.append(
      btn(state.busy ? a.busy || a.label : a.label, 'primary', () => doAnalyze(meta), {
        disabled: !ready,
        busy: state.busy
      })
    );
    bar.append(btn('Cancel', 'secondary', goHome, { disabled: state.busy }));
    return;
  }

  if (state.phase === PHASE.REVIEW && state.busy && !state.committing) {
    /* Reviewed again after a choice made on the result - a tick box ticked or
     * unticked. Nothing is being written, so the button says it is analyzing,
     * never "Applying", and nothing can be pressed until the new review is in. */
    bar.append(btn('Analyzing…', 'primary', () => {}, { disabled: true, busy: true }));
    bar.append(btn((state.commit || meta.flow.commit).back || 'Change paths', 'secondary', backToInput, { disabled: true }));
    return;
  }

  if (state.phase === PHASE.REVIEW && state.stale) {
    /* Part of it may have been written. The plan above was made before that,
     * so running it again as it stands would be approving something nobody
     * has looked at. A fresh analysis says where the page is now. */
    const q = el('div', 'confirm');
    q.append(el('p', 'confirm-q', 'The run stopped before it finished.'));
    q.append(
      el(
        'p',
        'confirm-caption',
        'Part of it may already be written, so the plan above is out of date. ' +
          'Analyze again to see where things stand now.'
      )
    );
    ask.append(q);
    bar.append(btn('Analyze again', 'primary', () => doAnalyze(meta), { disabled: !ready }));
    bar.append(btn(meta.flow.commit.back || 'Change paths', 'secondary', backToInput, { disabled: state.busy }));
    return;
  }

  if (state.phase === PHASE.REVIEW) {
    /* A feature that needs a choice made on its result - which version to
     * restore - says whether the commit can run yet, and what it will do. */
    const live = panelModules.get(meta.id)?.commitState?.();
    const base = state.commit || meta.flow.commit;
    const commit = live ? { ...base, ...live, disabled: base.disabled || !live.ready } : base;
    const facts = reviewFacts(state.analysis);

    // A commit that cannot run asks nothing; the feature's own result says why.
    const q = el('div', 'confirm');
    q.append(el('p', 'confirm-q', commit.question || 'Shall I proceed?'));
    if (commit.caption) q.append(el('p', 'confirm-caption', commit.caption));
    if (!commit.disabled || live) ask.append(q);

    /* Removing content is the one outcome worth a second, deliberate step. The
     * tables above list exactly what goes; the tick box says they were read. */
    const removing = facts.nodes + facts.props;
    if (removing && !facts.blocked && !state.committing) {
      const parts = [];
      if (facts.nodes) parts.push(`${facts.nodes} component${facts.nodes === 1 ? '' : 's'}`);
      if (facts.props) parts.push(`${facts.props} propert${facts.props === 1 ? 'y' : 'ies'}`);

      const warn = el('div', 'danger');
      warn.append(icon('alert', 18));
      warn.append(
        el(
          'p',
          null,
          facts.large
            ? `${facts.large} Check the tables above, and that these are the right two pages, before you run it.`
            : `This removes ${parts.join(' and ')} from the destination page. Check the tables above before you run it.`
        )
      );
      q.append(warn);

      const ack = el('label', 'check ack');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = state.ack;
      box.addEventListener('change', () => {
        state.ack = box.checked;
        renderFlow();
      });
      ack.append(
        box,
        el(
          'span',
          null,
          facts.large
            ? `These are the right pages — remove ${facts.nodes} component${facts.nodes === 1 ? '' : 's'} anyway`
            : 'I understand content will be removed'
        )
      );
      bar.append(ack);
    }

    /* A page that is already there often had its page properties - titles,
     * descriptions, handles - put right by hand after an earlier run. Changing
     * them is a deliberate step too: the box names them, and the run refuses
     * any that were not on it. */
    const changing = facts.metadata;
    if (changing && !facts.blocked && !state.committing) {
      const n = changing.props.length;
      const names = n > 8 ? `${changing.props.slice(0, 8).join(', ')} and ${n - 8} more` : changing.props.join(', ');
      const warn = el('div', 'danger');
      warn.append(icon('alert', 18));
      warn.append(
        el(
          'p',
          null,
          `This page already exists. ${n} of its page properties will change: ${names}. ` +
            'Check them in the tables above, under (page properties), before you run it.'
        )
      );
      q.append(warn);

      const ack = el('label', 'check ack');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = state.ackMeta;
      box.addEventListener('change', () => {
        state.ackMeta = box.checked;
        renderFlow();
      });
      ack.append(box, el('span', null, `I have checked the ${n} page propert${n === 1 ? 'y' : 'ies'} — update them`));
      bar.append(ack);
    }

    const blockedReason = facts.blocked ? 'This cannot run — see above' : null;
    bar.append(
      btn(
        blockedReason || (state.busy ? commit.busy || commit.label : commit.label),
        commit.tone || 'primary',
        () => doCommit(meta),
        {
          disabled:
            !ready || commit.disabled || facts.blocked || (removing > 0 && !state.ack) || (!!changing && !state.ackMeta),
          busy: state.busy
        }
      )
    );
    bar.append(
      btn(commit.back || 'Change paths', 'secondary', backToInput, { disabled: state.busy })
    );
    return;
  }

  // PHASE.DONE
  const url = state.outcome?.editorUrl;
  if (url && state.origin) {
    const a = el('a', 'btn');
    a.dataset.tone = 'primary';
    a.href = /^https?:\/\//.test(url) ? url : state.origin + url;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.append(el('span', null, 'Open in the editor'), icon('external', 15));
    bar.append(a);
  }
  bar.append(btn(meta.flow.done?.again || 'Start another', url ? 'secondary' : 'primary', startAgain));
  bar.append(btn('Done', 'ghost', goHome));
}

function backToInput() {
  if (state.busy) return;
  state.phase = PHASE.INPUT;
  clearOutput();
  render();
}

/**
 * The page in this tab, if the field takes it and it is a sensible value for
 * it. After a backup, the tab is often showing the backup itself - opened from
 * the done screen - and that is never something to back up again.
 */
function prefillFor(f) {
  if (f?.prefill !== 'currentPage' || !state.page) return '';
  const path = state.page.path;
  return !f.prefillIf || f.prefillIf(path, state.settings) ? path : '';
}

function startAgain() {
  const meta = activeMeta();
  const last = collect();
  state.phase = PHASE.INPUT;
  clearOutput();

  // Same inputs, fresh look - for a feature whose run changes what it reads.
  if (meta.flow.done?.keepValues) {
    render();
    doAnalyze(meta);
    return;
  }

  // Back to the feature's own defaults, not to blank - a checkbox that
  // defaults to on must come back on, or the next run quietly does less.
  // "Another page" means another page: the one just run is not offered again.
  const defaults = new Map(meta.fields.map((f) => [f.name, f]));
  document.querySelectorAll('#feature-form input').forEach((i) => {
    const f = defaults.get(i.name);
    if (i.type === 'checkbox') i.checked = f?.default === true;
    else {
      const v = prefillFor(f);
      i.value = v && v !== last[i.name] ? v : '';
    }
  });
  updateDerived();
  render();
}

function setFormEnabled(on) {
  const meta = activeMeta();
  const off = !on || gated(meta);
  document.querySelectorAll('#feature-form input, #feature-form select, #feature-form textarea, #feature-form button').forEach((i) => {
    i.disabled = off;
  });
}

/* --------------------------------------------------------------- progress */

/**
 * "4 of 7 steps", read off the plan the feature drew. Every renderer marks its
 * steps with data-state, so the count needs no knowledge of any one feature.
 */
function updateProgress() {
  const bar = $('progress');
  const count = $('step-count');
  const steps = [...$('result').querySelectorAll('.plan-step[data-state], .node[data-state]')];

  if (!state.committing || !steps.length) {
    bar.hidden = true;
    count.hidden = true;
    return;
  }
  const done = steps.filter((s) => s.dataset.state === 'done').length;
  bar.hidden = false;
  count.hidden = false;
  count.textContent = `${done} of ${steps.length} steps`;
  $('progress-bar').style.width = `${Math.round((done / steps.length) * 100)}%`;
}

/* --------------------------------------------------------------- running */

function collect() {
  const params = {};
  for (const input of document.querySelectorAll('#feature-form input')) {
    if (!input.name) continue; // a derived field's typed box: its value is copied into the field itself
    params[input.name] =input.type === 'checkbox' ? input.checked : input.value.trim();
  }
  for (const select of document.querySelectorAll('#feature-form select')) {
    params[select.name] = select.value;
  }
  return params;
}

async function send(meta, actionName, params, tabId = state.tab.id) {
  const ensure = await chrome.runtime.sendMessage({
    type: 'aemt:ensure-content-script',
    tabId
  });
  if (!ensure?.ok) throw new Error(ensure?.error || 'Could not reach that AEM page.');

  return chrome.tabs.sendMessage(tabId, {
    type: MSG.COMMAND,
    runId: state.runId,
    feature: meta.id,
    action: actionName,
    params,
    settings: state.settings
  });
}

/**
 * A tab on another author instance, so a feature can run there under that
 * instance's own session. An existing tab is reused; otherwise one is opened in
 * the background. Requires the origin to be enabled and granted, which is what
 * makes the source list in the form the boundary on where this can reach, and
 * you to be signed in there.
 */
async function tabFor(origin) {
  if (!state.settings.origins.includes(origin)) {
    throw new Error(`${origin} is not one of your enabled instances.`);
  }
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) {
    throw new Error(`${origin} has not been granted. Open settings and grant it.`);
  }

  const tabId = await openTabOn(origin);

  /* Signed out, every request there gets the login page back. Said now, by
   * name, rather than as "did not return JSON" from the first read. */
  const s = await askTab(tabId).catch(() => null);
  if (s) {
    state.sessions.set(origin, s);
    paintPickers();
  }
  if (s?.state === SESSION.OUT) {
    throw new Error(`You are not signed in to ${hostOf(origin)}. Sign in there, then try again.`);
  }
  return tabId;
}

/** A tab on the origin: a loaded one if there is one, else any, else a new one in the background. */
async function openTabOn(origin) {
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  const existing = tabs.find((t) => !t.discarded) || tabs[0];
  if (existing) return existing.id;

  const created = await chrome.tabs.create({ url: `${origin}/`, active: false });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdate);
      reject(new Error(`Timed out opening a tab on ${origin}.`));
    }, 30000);
    function onUpdate(id, info) {
      if (id !== created.id || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdate);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdate);
  });
  return created.id;
}

/**
 * What a feature gets when it drives its own flow. Handed out only to features
 * that export `analyze` or `commit` from their panel module - everything else
 * goes through the shell's single request, unchanged.
 */
function featureContext(meta, params) {
  return {
    params,
    settings: state.settings,
    meta,
    origin: state.origin,
    tabId: state.tab.id,
    send: (action, p, tabId) => send(meta, action, p, tabId),
    tabFor,
    log,
    // For a step the panel itself finishes, rather than a tab.
    step: (id, st, note) => applyStep(meta.id, { id, state: st, note })
  };
}

/** `again`: asked for by the feature's own result - a choice made on it - so the page stays where it was. */
async function doAnalyze(meta, { again = false } = {}) {
  const params = collect();
  const missing = meta.fields.filter((f) => f.required && !params[f.name]);
  if (missing.length) {
    clearOutput();
    log('fail', `Fill in: ${missing.map((f) => f.label).join(', ')}`);
    return;
  }

  clearOutput();
  state.busy = true;
  state.runId = crypto.randomUUID();
  state.commit = null;
  state.analysis = null;
  state.ack = false;
  state.ackMeta = false;
  render();

  try {
    const mod = await featurePanel(meta.id);
    const res = mod?.analyze
      ? await mod.analyze(featureContext(meta, params))
      : await send(meta, meta.flow.analyze.action, params);
    if (res?.ok) {
      state.phase = PHASE.REVIEW;
      state.analysis = res.result || null;
      // The analysis can say the commit will do something other than the
      // default - an update rather than a create - and the button must say so.
      const variant = meta.flow.variants?.[res.result?.variant];
      state.commit = variant ? { ...meta.flow.commit, ...variant } : null;
    } else {
      state.phase = PHASE.INPUT;
      if (!res?.aborted) log('fail', res?.error || 'The analysis returned nothing.');
    }
  } catch (e) {
    state.phase = PHASE.INPUT;
    log('fail', e.message);
  } finally {
    state.busy = false;
    state.runId = null;
    render();
    if (!again) window.scrollTo({ top: 0 });
    // A failed run is the likeliest moment to have been signed out: the footer finds out now.
    if (state.phase === PHASE.INPUT) checkStatusSession();
  }
}

async function doCommit(meta) {
  const params = collect();
  // What the tick boxes confirmed, so the run can refuse to remove or change more than that.
  const facts = reviewFacts(state.analysis);
  if (state.ack) params.removalsAck = { nodes: facts.nodes, props: facts.props };
  if (state.ackMeta && facts.metadata) params.metadataAck = { props: [...facts.metadata.props] };

  state.busy = true;
  state.committing = true;
  state.runId = crypto.randomUUID();
  $('alerts').textContent = '';
  render();

  try {
    const mod = await featurePanel(meta.id);
    const res = mod?.commit
      ? await mod.commit(featureContext(meta, params))
      : await send(meta, meta.flow.commit.action, params);
    if (res?.ok) {
      state.phase = PHASE.DONE;
      state.outcome = res.result || null;
      renderDone(meta);
    } else {
      // The run reports its own reason through the log. Stay in review, with
      // what it got through on screen, but offer a fresh analysis rather than
      // the same run again.
      state.phase = PHASE.REVIEW;
      state.stale = true;
      await markStopped(meta);
      if (!res?.aborted) log('fail', res?.error || 'The run returned nothing.');
    }
  } catch (e) {
    state.phase = PHASE.REVIEW;
    state.stale = true;
    await markStopped(meta);
    log('fail', e.message);
  } finally {
    state.busy = false;
    state.committing = false;
    state.runId = null;
    render();
    if (state.stale) checkStatusSession();
  }
}

/** The step a stopped run was on shows as failed, not as still going. */
async function markStopped(meta) {
  const mod = await featurePanel(meta.id);
  for (const li of $('result').querySelectorAll('.plan-step[data-state="running"]')) {
    if (mod?.updateStep) mod.updateStep($('result'), { id: li.dataset.step, state: 'failed' });
    else li.dataset.state = 'failed';
  }
}

/** The outcome, above the plan that just ticked through. */
function renderDone(meta) {
  const root = $('done');
  root.textContent = '';
  const box = el('div', 'success');
  box.append(icon('check', 22, 'success-icon'));
  const text = el('div');
  text.append(el('p', 'success-title', state.outcome?.title || meta.flow.done?.title || 'Done'));
  const dest = state.outcome?.dest || collect().dest;
  if (dest) {
    const p = el('p', 'success-path', dest);
    p.title = dest;
    text.append(p);
  }
  box.append(text);
  root.append(box);
  // Anything the feature has to add to the outcome - what it left undone, say.
  featurePanel(meta.id).then((mod) => mod?.renderDone?.(root, state.outcome, { el, icon }));
}

/* ---------------------------------------------------------------- output */

function clearOutput() {
  $('log').textContent = '';
  $('result').textContent = '';
  $('alerts').textContent = '';
  $('done').textContent = '';
  $('banner').textContent = '';
  $('output').hidden = true;
  $('output').open = false;
  $('log-count').textContent = '';
  state.analysis = null;
  state.outcome = null;
  state.commit = null;
  state.ack = false;
  state.ackMeta = false;
  state.stale = false;
}

/**
 * Every line goes to the activity log. A failure also goes to the top, because
 * it is the reason nothing happened and should not need finding.
 */
function log(level, message) {
  const li = el('li', null, message);
  li.dataset.level = level;
  $('log').append(li);
  $('output').hidden = false;
  $('log-count').textContent = String($('log').children.length);

  // The same failure again - a button clicked twice - is one alert at the top, not a pile of them.
  if (level === 'fail' && ![...$('alerts').children].some((a) => a.dataset.message === message)) {
    const a = el('div', 'alert');
    a.dataset.message = message;
    a.append(icon('alert', 18), el('p', null, message));
    $('alerts').append(a);
    a.scrollIntoView({ block: 'nearest' });
  }
}

// Cached so a burst of step events does not await a dynamic import each time.
const panelModules = new Map();

async function featurePanel(featureId) {
  if (!panelModules.has(featureId)) panelModules.set(featureId, await loadPanel(featureId));
  return panelModules.get(featureId);
}

async function renderResult(featureId, data) {
  const mod = await featurePanel(featureId);
  if (mod?.renderResult) {
    const target = $('result');
    target.textContent = '';
    mod.renderResult(target, data, { el, log, origin: () => state.origin });
  }
}

async function applyStep(featureId, data) {
  const mod = await featurePanel(featureId);
  mod?.updateStep?.($('result'), data);
  updateProgress();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== MSG.REPORT) return;
  if (state.runId && msg.runId !== state.runId) return;

  if (msg.level === 'data') {
    if (msg.message === 'step') applyStep(state.activeId, msg.data);
    else renderResult(state.activeId, msg.data);
  } else {
    log(msg.level, msg.message);
  }
});

/* ------------------------------------------------------------------ boot */

async function refresh() {
  state.settings = await loadSettings();
  // A feature turned off in settings while open closes, unless it is mid-run.
  if (state.activeId && !state.busy && !visibleMetas().some((m) => m.id === state.activeId)) {
    state.activeId = null;
    state.phase = PHASE.INPUT;
    clearOutput();
  }
  await readActiveTab();
  // Settings may have changed the backup folder or the site root depth.
  if (state.phase === PHASE.INPUT) updateDerived();
  render();
  // Which tab is "this tab", the instance list, or a sign-in may have changed.
  if (wantsSessions()) {
    paintPickers();
    checkSessions();
  } else {
    checkStatusSession();
  }
}

async function boot() {
  $('back').append(icon('back', 20));
  $('settings').append(icon('gear', 19));

  state.settings = await loadSettings();
  state.metas = await loadAllMeta();

  await readActiveTab();
  render();

  $('back').addEventListener('click', () => {
    if (state.phase === PHASE.REVIEW) backToInput();
    else goHome();
  });
  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  // A feature's own result changed what the footer should offer.
  document.addEventListener('aemt:flow-changed', () => {
    if (state.phase === PHASE.REVIEW && !state.busy) renderFlow();
  });
  // A choice made on a feature's result changes what the run would do: analyse again with it.
  document.addEventListener('aemt:reanalyze', () => {
    const meta = activeMeta();
    if (meta && state.phase === PHASE.REVIEW && !state.busy) doAnalyze(meta, { again: true });
  });
  $('clear').addEventListener('click', (e) => {
    e.preventDefault();
    $('log').textContent = '';
    $('log-count').textContent = '';
    $('output').hidden = true;
  });

  chrome.tabs.onActivated.addListener(refresh);
  // Settings saved in the options page show up here straight away.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[STORAGE_KEY]) refresh();
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId === state.tab?.id && info.status === 'complete') refresh();
  });
  // Coming back to the panel after signing in somewhere else.
  window.addEventListener('focus', () => {
    if (Date.now() - lastCheck <= 2000) return;
    if (wantsSessions()) checkSessions();
    else checkStatusSession();
  });
  // A session can run out while the panel sits open: look again every minute it is on screen.
  setInterval(() => {
    if (document.visibilityState === 'visible' && !state.busy) checkStatusSession();
  }, 60_000);
  checkStatusSession();
}

boot();
