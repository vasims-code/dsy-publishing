/**
 * Side panel shell.
 *
 * Owns no AEM knowledge. It works out which instance this tab is on and
 * whether that instance is signed in, draws the home screen, and hands over
 * to a tool. Everything a tool does lives under screens/.
 *
 * The engine underneath - core/ and every feature's worker - is the one that
 * has been in use all along; only what you see is new.
 */

import { logBox } from './log.js';
import { SESSION, looksLikeAem, readSession, sessionNote } from '../core/instances.js';
import { STORAGE_KEY, loadSettings } from '../core/protocol.js';
import { watchTheme } from './theme.js';
import { FEATURE_IDS, loadAllMeta } from '../features/registry.js';
import { icon } from './icons.js';
import { DOES_LABEL, visibleTools } from './tools.js';
import { armPin, dropPin, pinned, running, watchRuns } from './run.js';
import { toTop } from './parts.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = {
  settings: null,
  metas: [],
  tab: null,
  origin: null,
  allowed: false,
  page: null,
  session: null,
  /** null on the home screen, else the tool's id. */
  toolId: null,
  /** The tab in front, when an open tool is held to another one (see run.js). */
  elsewhere: null
};

/** The window this panel belongs to, so another window's tabs never steer it. */
let windowId = null;

const hostOf = (origin) => String(origin || '').replace(/^https?:\/\//, '');

/* ------------------------------------------------------------------ tab */

/**
 * The page a tab is showing, read off its URL. Covers the page editor, the
 * page itself, its properties dialog and the Sites console. Anything else is
 * not a page, and the panel says nothing rather than guessing.
 */
function pageFromUrl(url) {
  const pathOnly = (p) => {
    /* A stray "%" in an address - a page called 100%.html - makes decodeURI
       throw, and a throw here left the panel blank at boot. Such an address
       is said as no page rather than guessed at. */
    let decoded;
    try {
      decoded = decodeURI(p);
    } catch {
      return null;
    }
    const segs = decoded.split('/').filter(Boolean);
    if (segs[0] !== 'content' || segs.length < 2) return null;
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

/** The tab in front in this panel's own window. */
async function frontTab() {
  const [tab] = await chrome.tabs.query(windowId != null ? { active: true, windowId } : { active: true, lastFocusedWindow: true });
  return tab || null;
}

async function readActiveTab() {
  const front = await frontTab();
  /* A tool that has run in a tab stays on it (run.js). The panel then shows
     that tab, not the one in front - otherwise the page and server on screen
     would be one place and the write would go to another. */
  const held = state.toolId ? pinned() : null;
  let tab = front;
  if (held) {
    tab = held.tabId === front?.id ? front : await chrome.tabs.get(held.tabId).catch(() => null);
  }
  state.elsewhere = held && front?.id !== held.tabId ? front : null;
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

  /* A tab that is not an AEM instance is treated as no AEM tab at all. An
   * instance already in the list counts whatever its URL says, because
   * someone decided it was one. */
  const enabled = state.settings.origins.includes(url.origin);
  if (!enabled && !looksLikeAem(url)) return;

  state.origin = url.origin;
  state.allowed = enabled && (await chrome.permissions.contains({ origins: [`${url.origin}/*`] }));

  const path = pageFromUrl(url);
  if (path) {
    const title = String(tab.title || '').split(/\s+[|–-]\s+/)[0].trim();
    state.page = { path, title: title && !title.startsWith('/') ? title : path.split('/').pop() };
  }
}

/** Whether that instance is signed in, asked once per paint and never guessed. */
async function checkSession() {
  if (!state.origin || !state.allowed) {
    state.session = null;
    return;
  }
  const was = state.session;
  state.session = await readSession(state.origin).catch(() => null);
  if (state.session !== was) render();
}

/* --------------------------------------------------------------- the top */

function renderTop() {
  $('back').hidden = !state.toolId;
  setBackBusy(running());
  $('brand').hidden = !!state.toolId;
  $('title').textContent = state.toolId ? toolById(state.toolId).title : 'DSY';
  $('subtitle').textContent = state.toolId
    ? toolById(state.toolId).summary
    : 'Digital Samsung Yard For Publishing';
}

/* ---------------------------------------------------------------- home */

/** Which instance a run would talk to, said before anything is chosen. */
function connectionCard() {
  const card = el('div', 'conn');

  if (!state.origin) {
    card.dataset.tone = 'idle';
    const line = el('div', 'conn-state');
    line.append(icon('plug', 16, 2.2), el('span', null, 'No AEM tab'));
    card.append(line, el('div', 'conn-host', 'Open an AEM author tab'));
    return card;
  }

  if (!state.allowed) {
    card.dataset.tone = 'warn';
    const line = el('div', 'conn-state');
    line.append(icon('warn', 16, 2.2), el('span', null, 'Not enabled'));
    card.append(line, el('div', 'conn-host', hostOf(state.origin)));
    const foot = el('div', 'conn-foot');
    const allow = el('button', null, 'Allow this site');
    allow.type = 'button';
    allow.addEventListener('click', allowThisSite);
    foot.append(el('span', null, 'Chrome has not allowed it yet'), allow);
    card.append(foot);
    return card;
  }

  /* Not asked yet reads as connected: the check is a courtesy, and a run
     reports the truth either way. */
  const st = state.session?.state;
  const signedIn = !st || st === SESSION.IN || st === SESSION.UNKNOWN;
  card.dataset.tone = signedIn ? 'ok' : 'warn';
  const line = el('div', 'conn-state');
  line.append(
    icon(signedIn ? 'check' : 'warn', 16, 2.2),
    el('span', null, signedIn ? 'Connected' : 'Cannot connect')
  );
  card.append(line, el('div', 'conn-host', hostOf(state.origin)));

  const foot = el('div', 'conn-foot');
  const sw = el('button', null, 'Switch');
  sw.type = 'button';
  sw.addEventListener('click', () => chrome.runtime.openOptionsPage());
  foot.append(
    el('span', null, signedIn ? 'Signed in' : sessionNote(state.session)),
    sw
  );
  card.append(foot);
  return card;
}

/** One row per tool, in one card, as the design has it. */
function toolList() {
  const on = state.metas.map((m) => m.id);
  const list = el('div', 'list');
  const runnable = !!state.origin && state.allowed;

  for (const tool of visibleTools(on)) {
    const row = el('button', 'tool');
    row.type = 'button';
    row.disabled = !runnable;

    const ic = el('div', 'tool-icon');
    ic.append(icon(tool.icon, 20));

    const text = el('div', 'tool-text');
    text.append(el('div', 'tool-title', tool.title), el('div', 'tool-sub', tool.summary));

    const pill = el('div', 'tool-pill');
    pill.dataset.does = tool.does;
    pill.append(icon(tool.does === 'read' ? 'eye' : 'pen', 11, 2.4), el('span', null, DOES_LABEL[tool.does]));

    row.append(ic, text, pill);
    row.addEventListener('click', () => openTool(tool.id));
    list.append(row);
  }
  return list;
}

/** What the two marks on a tool mean. */
function keyCard() {
  const card = el('div', 'card key');
  const row = (kind, tag, note) => {
    const r = el('div', 'key-row');
    const t = el('span', 'key-tag');
    t.dataset.kind = kind;
    t.append(icon(kind === 'read' ? 'eye' : 'pen', 12, 2.4), el('span', null, tag));
    r.append(t, el('span', 'key-note', note));
    return r;
  };
  card.append(
    row('read', 'Preview only', 'Nothing is written to AEM.'),
    row('write', 'Changes AEM', 'Asks you to confirm first.')
  );
  return card;
}

function renderHome() {
  const view = $('view');
  view.append(connectionCard());

  const label = el('div', 'label');
  label.append(el('div', null, 'Tools · one page at a time'));
  view.append(label);

  view.append(toolList());

  const settings = el('button', 'tool row-card');
  settings.type = 'button';
  const sic = el('div', 'tool-icon quiet');
  sic.append(icon('gear', 20));
  const stext = el('div', 'tool-text');
  stext.append(el('div', 'tool-title', 'Settings & sign-in'));
  settings.append(sic, stext);
  settings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  view.append(settings);

  view.append(keyCard());
}

/* ---------------------------------------------------------------- tools */

let TOOLS_CACHE = null;
const toolById = (id) => (TOOLS_CACHE ||= visibleTools(FEATURE_IDS)).find((t) => t.id === id);

/**
 * A tool's screens live in screens/<id>.js and are loaded the first time the
 * tool is opened. The module is then kept, because every redraw after that -
 * and a run redraws on every line of progress - has to be able to clear and
 * redraw in one go. Clearing first and loading afterwards leaves the panel
 * blank in between, which at the speed a run reports is most of the time.
 */
const screens = new Map();

/**
 * What each tool remembers while it is open - the shell's, not the screen
 * module's, because a module is loaded once and lives as long as the panel.
 * Left on the module, a tool reopened later came back on the step it was
 * last on, showing what it had read before: after a restore, a list of
 * versions and differences from before that restore.
 */
const toolState = new Map();

async function loadScreen(id) {
  if (screens.has(id)) return screens.get(id);
  let mod = null;
  try {
    mod = await import(`./screens/${id}.js`);
    if (typeof mod?.render !== 'function') mod = null;
  } catch (e) {
    console.error('[DSY] could not load the screen for', id, e);
    mod = null;
  }
  screens.set(id, mod);
  return mod;
}

/** Draws the tool into a view that has just been cleared. */
function drawTool(id, mod) {
  const view = $('view');
  if (!mod) {
    const empty = el('div', 'empty');
    const art = icon('warn', 40, 1.6);
    art.className = 'icon empty-icon';
    empty.append(
      art,
      el('h2', null, `${toolById(id).title} is not built yet`),
      el('p', null, 'This tool is being rebuilt to the new design. The one in the old extension still works.')
    );
    view.append(empty);
    return;
  }

  /* A screen that throws says so here rather than leaving the panel blank.
     A screen's render is an async function, so a throw inside it arrives as a
     rejected promise, not as a throw here - both are caught. */
  const failed = (e) => {
    console.error('[DSY]', e);
    const box = el('div', 'notice');
    box.dataset.tone = 'err';
    const text = el('div', 'notice-text');
    text.append(
      el('div', 'notice-title', 'This screen could not be drawn'),
      el('div', 'notice-body', e.message)
    );
    box.append(icon('warn', 20, 2), text);
    view.append(box);
  };

  const own = ownState(id);
  /* Wherever a screen does not place the log itself, it goes at the bottom.
     A line a worker reported should never be unreachable just because the
     screen the run ended on had nowhere obvious to put it. */
  const withLog = () => {
    if (!own.log?.lines.length || view.querySelector('.log-box')) return;
    view.append(logBox(own.log.lines));
  };

  try {
    Promise.resolve(mod.render({ view, footer: $('footer'), state, own, el, icon, render, goHome, openTool }))
      .then(withLog, failed);
  } catch (e) {
    failed(e);
  }
}

/* A tool held to a tab that is no longer in front says nothing about it: the
   note it used to show ("Still working on …") confused more than it helped.
   The hold itself is unchanged - every action still goes to the tab the tool
   first read. */

/* While a run is under way, going back would drop the tool's state with the
   run still writing into it, and its result would be lost. So Back waits. */
function setBackBusy(busy) {
  const back = $('back');
  back.disabled = busy;
  back.title = busy ? 'Wait for the run to finish' : '';
}

/** A tool's own state, made the first time it is opened. */
function ownState(id) {
  if (!toolState.has(id)) toolState.set(id, {});
  return toolState.get(id);
}

/** Leaving a tool forgets what it was doing - the next open starts fresh. */
function leaveTool() {
  if (state.toolId) toolState.delete(state.toolId);
  dropPin();
  state.elsewhere = null;
}

function openTool(id) {
  if (state.toolId !== id) {
    leaveTool();
    armPin(() => state.origin);
  }
  state.toolId = id;
  /* A tool is opened by pressing a row that may be far down the home screen,
     and the panel keeps the scroll it had - so the tool arrived already
     scrolled past its first step. Every tool, since the shell opens them all. */
  toTop();
  render();
}

function goHome() {
  // Never while a run is going: its result would land on state just dropped.
  if (running()) return;
  const was = state.toolId;
  leaveTool();
  state.toolId = null;
  // A tool held to another tab hands back to the one in front.
  if (was) refresh();
  else render();
}

/**
 * The Back button. A tool with a level of its own - Links, whose three tools
 * sit behind a chooser - goes up that level first, by setting `own.onBack`
 * to a function that returns true when it went somewhere. Only from the top
 * of a tool does Back go home.
 */
function goBack() {
  if (running()) return;
  const own = state.toolId ? toolState.get(state.toolId) : null;
  if (typeof own?.onBack === 'function' && own.onBack()) {
    toTop();
    return;
  }
  goHome();
}

/* --------------------------------------------------------------- render */

/** Each draw gets a number; a draw that is no longer the latest stops. */
let renderToken = 0;

const clear = () => {
  $('view').textContent = '';
  $('footer').textContent = '';
};

function render() {
  const token = ++renderToken;
  renderTop();

  if (!state.toolId) {
    clear();
    renderHome();
    return;
  }

  // Already loaded: clear and draw in the same turn, so nothing flashes.
  if (screens.has(state.toolId)) {
    clear();
    drawTool(state.toolId, screens.get(state.toolId));
    return;
  }

  // First open: the old screen stays up until the new one is ready to draw.
  const id = state.toolId;
  loadScreen(id).then((mod) => {
    if (token !== renderToken) return;
    clear();
    drawTool(id, mod);
  });
}

/* ---------------------------------------------------------------- setup */

async function allowThisSite() {
  if (!(await chrome.permissions.request({ origins: [`${state.origin}/*`] }))) return;
  const { saveSettings } = await import('../core/protocol.js');
  state.settings = await saveSettings({
    origins: [...new Set([...state.settings.origins, state.origin])]
  });
  await refresh();
}

async function refresh() {
  state.settings = await loadSettings();
  await readActiveTab();
  render();
  checkSession();
}

async function boot() {
  $('back').append(icon('back', 20));
  $('brand').append(icon('yard', 20, 2));
  $('settings').append(icon('gear', 19));
  $('back').addEventListener('click', goBack);
  watchRuns(setBackBusy);
  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

  watchTheme();
  windowId = (await Promise.resolve(chrome.windows?.getCurrent?.()).catch(() => null))?.id ?? null;
  state.settings = await loadSettings();
  state.metas = await loadAllMeta();
  await readActiveTab();
  render();
  checkSession();

  chrome.tabs.onActivated.addListener((info) => {
    // Another window's tab coming to the front is nothing to this panel.
    if (windowId == null || info?.windowId == null || info.windowId === windowId) refresh();
  });
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId === state.tab?.id && info.status === 'complete') refresh();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[STORAGE_KEY]) refresh();
  });
}

boot();
