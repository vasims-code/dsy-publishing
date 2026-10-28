/**
 * DSY - Digital Samsung Yard: the window, the interface view, the tabs, and the
 * messages between them.
 */
import { app, BaseWindow, WebContentsView, ipcMain, Menu, session, dialog, clipboard, nativeTheme } from "electron";
import path from "node:path";
import fs from "node:fs";
import { Tabs } from "./tabs.mjs";
import { Engine } from "./engine.mjs";
import { saveSessionCookies, restoreSessionCookies } from "./cookies.mjs";
import * as store from "./store.mjs";
import { serverFor, looksLikeAem, pagePathFrom, originOf, readSession, serverOrigin, hostOf, SESSION } from "./aem.mjs";

// dist/ holds everything loaded at run time: the project folder in development, app.asar once installed.
const dist = (...p) => path.join(app.getAppPath(), "dist", ...p);
const TAB_STRIP_HEIGHT = 40;

// Sites see an ordinary Chrome: some refuse sign-in to anything that names Electron.
const chromeMajor = process.versions.chrome.split(".")[0];
app.userAgentFallback =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${chromeMajor}.0.0.0 Safari/537.36`;

/**
 * Before 0.3.0 the browser was "AEM Toolkit Browser", and its data folder (sign-ins, settings,
 * open tabs, recent pages) is named after the app. Copied once into DSY's folder so the rename
 * loses nothing - into a temporary folder first, so a copy that fails part-way leaves nothing
 * half-done. Caches stay behind; they refill on their own.
 */
function carryOverOldData() {
  const now = app.getPath("userData");
  const old = path.join(app.getPath("appData"), "AEM Toolkit Browser");
  // Electron has created the new folder by the time this runs, so a marker says whether it was done.
  const marker = path.join(now, "carried-over.txt");
  if (fs.existsSync(marker) || !fs.existsSync(old)) return;
  const skip = new Set(["Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "GrShaderCache", "ShaderCache", "GPUPersistentCache", "Crashpad", "blob_storage", "SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile", "DevToolsActivePort"]);
  try {
    // Nothing has opened the profile yet: the copy can go straight over what Electron created.
    fs.cpSync(old, now, { recursive: true, force: true, filter: (src) => !skip.has(path.basename(src)) });
    fs.writeFileSync(marker, `Copied from ${old} on ${new Date().toISOString()}\n`);
  } catch (e) {
    console.error("Could not carry over the old data folder", e);
  }
}
carryOverOldData();

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let ui = null;
let tabs = null;
let engine = null;
let settings = null;
let storage = {};
let recent = [];
const sessions = {}; // origin -> { state, user, at }
const inflight = new Map();

/* ---------- theme ---------- */

function hslHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return "#" + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// The tab strip's colour (--toolbar) and text colour, so the window buttons sit on it seamlessly.
const CHROME_COLORS = {
  dark: { color: hslHex(210, 12, 12), symbolColor: hslHex(210, 16, 90), background: hslHex(210, 12, 8) },
  light: { color: hslHex(210, 20, 97), symbolColor: hslHex(215, 25, 15), background: hslHex(0, 0, 100) },
};
/** "light", "dark", or "system" - which follows Windows' own setting. */
const effectiveTheme = () =>
  settings?.theme === "system" ? (nativeTheme.shouldUseDarkColors ? "dark" : "light") : settings?.theme === "light" ? "light" : "dark";
const colors = () => CHROME_COLORS[effectiveTheme()];

/** The window buttons and background follow the theme; the interface switches itself. */
function paintWindow() {
  if (!win) return;
  const c = colors();
  win.setTitleBarOverlay({ color: c.color, symbolColor: c.symbolColor, height: TAB_STRIP_HEIGHT });
  win.setBackgroundColor(c.background);
  ui?.setBackgroundColor(c.background);
}

/* ---------- messages to the interface ---------- */

function send(channel, payload) {
  if (ui && !ui.webContents.isDestroyed()) ui.webContents.send(channel, payload);
}

const sessionState = () =>
  Object.fromEntries(Object.entries(sessions).map(([o, s]) => [o, { state: s.state, user: s.user || null, error: s.error || null, status: s.status || null }]));

/* ---------- sign-in checks ---------- */

async function checkSession(origin, force = false) {
  if (!origin) return;
  const prev = sessions[origin];
  if (!force && prev && prev.state !== SESSION.CHECKING && Date.now() - prev.at < 20000) return;
  if (inflight.has(origin)) return inflight.get(origin);
  if (!prev) {
    sessions[origin] = { state: SESSION.CHECKING, at: 0 };
    send("sessions", sessionState());
  }
  const p = readSession(session.defaultSession, origin)
    .then((s) => {
      sessions[origin] = { ...s, at: Date.now() };
      send("sessions", sessionState());
    })
    .finally(() => inflight.delete(origin));
  inflight.set(origin, p);
  return p;
}

function checkAll(force = false) {
  const origins = new Set(settings.servers.filter((s) => s.host).map(serverOrigin));
  for (const t of tabs?.list || []) {
    if (t.kind === "page" && t.url && (serverFor(t.url, settings.servers) || looksLikeAem(t.url))) origins.add(originOf(t.url));
  }
  return Promise.all([...origins].filter(Boolean).map((o) => checkSession(o, force)));
}

/* ---------- recent pages ---------- */

let recentTimer = null;
function remember(tab) {
  const path = pagePathFrom(tab.url);
  if (!path || !(serverFor(tab.url, settings.servers) || looksLikeAem(tab.url))) return;
  const host = hostOf(tab.url);
  const title = tab.title && tab.title !== "New tab" ? tab.title : path.split("/").pop();
  recent = [{ path, host, title, url: tab.url, at: Date.now() }, ...recent.filter((r) => !(r.host === host && r.path === path))].slice(0, 30);
  send("recent", recent);
  clearTimeout(recentTimer);
  recentTimer = setTimeout(() => store.saveRecent(recent), 1000);
}

/* ---------- open tabs, kept for next time ---------- */

let sessionTimer = null;
function saveOpenTabs() {
  if (!tabs) return;
  store.saveSession({
    active: tabs.list.findIndex((t) => t.id === tabs.activeId),
    tabs: tabs.list.map((t) => ({ kind: t.kind, url: t.kind === "page" ? t.url : null })),
  });
}

/* ---------- keyboard ---------- */

function focusAddress() {
  ui.webContents.focus();
  send("command", "focus-address");
}

function openFind() {
  if (!tabs.active?.view) return;
  ui.webContents.focus();
  send("command", "find");
}

function devtools(wc) {
  if (wc) wc.openDevTools({ mode: "detach" });
}

function onKey(e, input) {
  if (input.type !== "keyDown") return;
  const ctrl = input.control || input.meta;
  const { shift, alt } = input;
  const key = (input.key || "").toLowerCase();
  const id = tabs.activeId;
  let act = null;

  if (ctrl && !alt) {
    if (key === "t") act = shift ? () => tabs.reopenClosed() : () => newTab();
    else if (key === "w" || key === "f4") act = () => tabs.close(id);
    else if (key === "l") act = focusAddress;
    else if (key === "r") act = () => tabs.reload(id, shift);
    else if (key === "f") act = openFind;
    else if (key === "tab") act = () => tabs.cycle(shift ? -1 : 1);
    else if (key === "pagedown") act = () => tabs.cycle(1);
    else if (key === "pageup") act = () => tabs.cycle(-1);
    else if (key === "=" || key === "+") act = () => tabs.zoom(id, 0.5);
    else if (key === "-" || key === "_") act = () => tabs.zoom(id, -0.5);
    else if (key === "0") act = () => tabs.zoom(id, null);
    else if (key === "p") act = () => tabs.webContents(id)?.print();
    else if (key === ",") act = () => tabs.openInternal("settings");
    else if (key === "i" && shift) act = () => devtools(tabs.webContents(id));
    else if (/^[1-8]$/.test(key)) act = () => tabs.list[+key - 1] && tabs.activate(tabs.list[+key - 1].id);
    else if (key === "9") act = () => tabs.list.length && tabs.activate(tabs.list[tabs.list.length - 1].id);
  } else if (ctrl && alt && shift && key === "i") {
    act = () => devtools(ui.webContents);
  } else if (alt && !ctrl && !shift) {
    if (key === "arrowleft") act = () => tabs.back(id);
    else if (key === "arrowright") act = () => tabs.forward(id);
    else if (key === "d") act = focusAddress;
    else if (key === "home") act = () => tabs.showNewTab(id);
  }
  if (!act) {
    if (key === "f5") act = () => tabs.reload(id, ctrl);
    else if (key === "f6") act = focusAddress;
    else if (key === "f11") act = () => win.setFullScreen(!win.isFullScreen());
    else if (key === "f12") act = () => devtools(tabs.webContents(id));
    else if (key === "browserback") act = () => tabs.back(id);
    else if (key === "browserforward") act = () => tabs.forward(id);
  }
  if (act) {
    e.preventDefault();
    act();
  }
}

function newTab() {
  tabs.create();
  focusAddress();
}

/* ---------- menus ---------- */

function pageContextMenu(tab, p) {
  const wc = tab.view.webContents;
  const items = [];
  const sep = () => items.length && items[items.length - 1].type !== "separator" && items.push({ type: "separator" });

  if (p.misspelledWord) {
    for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    if (!p.dictionarySuggestions.length) items.push({ label: "No spelling suggestions", enabled: false });
    items.push({ label: "Add to dictionary", click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    sep();
  }
  if (p.linkURL) {
    items.push({ label: "Open link in new tab", click: () => tabs.create({ url: p.linkURL, active: false, after: tab.id }) });
    items.push({ label: "Copy link address", click: () => clipboard.writeText(p.linkURL) });
    sep();
  }
  if (p.mediaType === "image" && p.srcURL) {
    items.push({ label: "Open image in new tab", click: () => tabs.create({ url: p.srcURL, active: false, after: tab.id }) });
    items.push({ label: "Copy image address", click: () => clipboard.writeText(p.srcURL) });
    sep();
  }
  if (p.isEditable) {
    items.push({ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "pasteAndMatchStyle", label: "Paste as plain text" }, { role: "selectAll" });
    sep();
  } else if (p.selectionText) {
    const text = p.selectionText.trim();
    items.push({ role: "copy" });
    items.push({
      label: `Search Google for “${text.length > 30 ? text.slice(0, 30) + "…" : text}”`,
      click: () => tabs.create({ url: "https://www.google.com/search?q=" + encodeURIComponent(text), after: tab.id }),
    });
    sep();
  }
  if (!p.linkURL && !p.isEditable && !p.selectionText) {
    items.push({ label: "Back", enabled: tab.canGoBack, click: () => tabs.back(tab.id) });
    items.push({ label: "Forward", enabled: tab.canGoForward, click: () => tabs.forward(tab.id) });
    items.push({ label: "Reload", click: () => tabs.reload(tab.id) });
    sep();
  }
  items.push({ label: "Inspect", click: () => wc.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(items).popup({ window: win });
}

function appMenu(pos) {
  const t = tabs.active;
  const page = !!t?.view;
  const zoom = Math.round(Math.pow(1.2, t?.zoom || 0) * 100);
  const setTheme = (theme) => applySettings({ ...settings, theme });
  const accel = (a) => ({ accelerator: a, registerAccelerator: false });
  Menu.buildFromTemplate([
    { label: "New tab", ...accel("Ctrl+T"), click: newTab },
    { label: "Reopen closed tab", ...accel("Ctrl+Shift+T"), enabled: tabs.closed.length > 0, click: () => tabs.reopenClosed() },
    { type: "separator" },
    { label: "Find on page…", ...accel("Ctrl+F"), enabled: page, click: openFind },
    {
      label: `Zoom (${zoom}%)`,
      enabled: page,
      submenu: [
        { label: "Zoom in", ...accel("Ctrl+="), click: () => tabs.zoom(t.id, 0.5) },
        { label: "Zoom out", ...accel("Ctrl+-"), click: () => tabs.zoom(t.id, -0.5) },
        { label: "Actual size", ...accel("Ctrl+0"), click: () => tabs.zoom(t.id, null) },
      ],
    },
    { label: "Print…", ...accel("Ctrl+P"), enabled: page, click: () => t.view.webContents.print() },
    { type: "separator" },
    {
      label: "Appearance",
      submenu: [
        { label: "Light", type: "radio", checked: settings.theme === "light", click: () => setTheme("light") },
        { label: "Dark", type: "radio", checked: (settings.theme || "dark") === "dark", click: () => setTheme("dark") },
        { label: "Match Windows", type: "radio", checked: settings.theme === "system", click: () => setTheme("system") },
      ],
    },
    { label: "Settings", ...accel("Ctrl+,"), click: () => tabs.openInternal("settings") },
    { type: "separator" },
    { label: "Developer tools for this page", ...accel("F12"), enabled: page, click: () => devtools(t.view.webContents) },
    { label: "About DSY", click: about },
  ]).popup({ window: win, x: Math.round(pos?.x ?? 0), y: Math.round(pos?.y ?? 0) });
}

function tabMenu(id) {
  const t = tabs.get(id);
  if (!t) return;
  const i = tabs.list.indexOf(t);
  Menu.buildFromTemplate([
    { label: "New tab", click: newTab },
    { label: "Reload", enabled: !!t.view, click: () => tabs.reload(id) },
    { label: "Duplicate", enabled: t.kind === "page" && !!t.url, click: () => tabs.create({ url: t.url, after: id }) },
    { type: "separator" },
    { label: "Close tab", click: () => tabs.close(id) },
    { label: "Close other tabs", enabled: tabs.list.length > 1, click: () => tabs.list.filter((x) => x.id !== id).forEach((x) => tabs.close(x.id)) },
    { label: "Close tabs to the right", enabled: i < tabs.list.length - 1, click: () => tabs.list.slice(i + 1).forEach((x) => tabs.close(x.id)) },
    { type: "separator" },
    { label: "Reopen closed tab", enabled: tabs.closed.length > 0, click: () => tabs.reopenClosed() },
  ]).popup({ window: win });
}

function about() {
  dialog.showMessageBox(win, {
    type: "info",
    title: "About",
    message: `DSY ${app.getVersion()}`,
    detail: `Digital Samsung Yard\n\nChromium ${process.versions.chrome}\nElectron ${process.versions.electron}`,
  });
}

/* ---------- settings ---------- */

function applySettings(next) {
  const themeChanged = next.theme !== settings.theme;
  settings = next;
  store.saveSettings(settings);
  send("settings", settings);
  if (themeChanged) paintWindow();
  checkAll();
}

/* ---------- window ---------- */

function createWindow() {
  const c = colors();
  win = new BaseWindow({
    width: 1440,
    height: 900,
    minWidth: 820,
    minHeight: 520,
    show: false,
    title: "DSY",
    backgroundColor: c.background,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: c.color, symbolColor: c.symbolColor, height: TAB_STRIP_HEIGHT },
    icon: dist("icon.png"),
  });

  ui = new WebContentsView({
    webPreferences: {
      preload: dist("preload-ui.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  ui.setBackgroundColor(c.background);
  win.contentView.addChildView(ui);

  const fit = () => {
    const [width, height] = win.getContentSize();
    ui.setBounds({ x: 0, y: 0, width, height });
  };
  fit();
  win.on("resize", fit);
  win.on("focus", () => checkAll());
  win.on("close", saveOpenTabs);
  win.on("closed", () => {
    tabs?.destroyAll();
    win = null;
  });

  const uiwc = ui.webContents;
  uiwc.on("before-input-event", onKey);
  // The interface never leaves its own page; reloading it is allowed.
  uiwc.on("will-navigate", (e, url) => {
    if ((e.url ?? url) !== uiwc.getURL()) e.preventDefault();
  });
  uiwc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) tabs.create({ url });
    return { action: "deny" };
  });
  uiwc.on("render-process-gone", () => uiwc.reload());
  uiwc.once("did-finish-load", () => win.show());

  tabs = new Tabs({ win, session: session.defaultSession, onKey, onContextMenu: pageContextMenu });
  tabs.on("change", () => {
    send("tabs", tabs.state());
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(saveOpenTabs, 1000);
  });
  tabs.on("navigated", (tab) => {
    remember(tab);
    if (serverFor(tab.url, settings.servers) || looksLikeAem(tab.url)) {
      const origin = originOf(tab.url);
      checkSession(origin, sessions[origin]?.state !== SESSION.IN);
    }
  });
  tabs.on("titled", remember);
  tabs.on("found", (tab, r) => send("found", { tabId: tab.id, matches: r.matches, active: r.activeMatchOrdinal }));

  engine = new Engine({
    tabs,
    session: session.defaultSession,
    report: (m) => send("engine:report", m),
    onSession: (origin, s) => {
      sessions[origin] = { ...s, at: Date.now() };
      send("sessions", sessionState());
    },
  });

  // Reopen what was open last time.
  const saved = store.loadSession();
  for (const t of saved?.tabs || []) {
    if (t.kind === "page" && t.url) tabs.create({ url: t.url, active: false });
    else if (t.kind === "newtab") tabs.create({ active: false });
  }
  if (!tabs.list.length) tabs.create();
  const restore = tabs.list[saved?.active] || tabs.list[0];
  tabs.activate(restore.id);

  uiwc.loadFile(dist("renderer", "index.html"));
}

/* ---------- IPC ---------- */

function registerIpc() {
  const tabArg = (id) => id || tabs.activeId;

  ipcMain.handle("state:get", () => ({
    tabs: tabs.state(),
    settings,
    sessions: sessionState(),
    recent,
  }));
  ipcMain.handle("tabs:new", (_e, opts) => tabs.create(opts || {}).id);
  ipcMain.handle("tabs:close", (_e, id) => tabs.close(tabArg(id)));
  ipcMain.handle("tabs:activate", (_e, id) => tabs.activate(id));
  ipcMain.handle("tabs:move", (_e, id, index) => tabs.move(id, index));
  ipcMain.handle("tabs:navigate", (_e, id, input) => tabs.navigate(tabArg(id), input));
  ipcMain.handle("tabs:back", (_e, id) => tabs.back(tabArg(id)));
  ipcMain.handle("tabs:forward", (_e, id) => tabs.forward(tabArg(id)));
  ipcMain.handle("tabs:reload", (_e, id, hard) => tabs.reload(tabArg(id), !!hard));
  ipcMain.handle("tabs:stop", (_e, id) => tabs.stop(tabArg(id)));
  ipcMain.handle("tabs:home", (_e, id) => tabs.showNewTab(tabArg(id)));
  ipcMain.handle("tabs:settings", () => tabs.openInternal("settings"));
  ipcMain.handle("tabs:find", (_e, text, opts) => tabs.find(tabs.activeId, text, opts));
  ipcMain.handle("tabs:stopFind", () => tabs.stopFind(tabs.activeId));
  ipcMain.handle("tabs:focusPage", () => tabs.webContents()?.focus());
  ipcMain.on("tabs:bounds", (_e, rect) => tabs.setBounds(rect));

  ipcMain.handle("settings:save", (_e, next) => {
    if (!next || !Array.isArray(next.servers)) return settings;
    applySettings({ ...settings, ...next });
    return settings;
  });
  ipcMain.handle("sessions:check", (_e, force) => checkAll(!!force).then(sessionState));

  ipcMain.handle("storage:getAll", () => storage);
  ipcMain.handle("storage:set", (_e, items) => {
    storage = { ...storage, ...items };
    store.saveStorage(storage);
  });
  ipcMain.handle("storage:remove", (_e, keys) => {
    for (const k of [].concat(keys)) delete storage[k];
    store.saveStorage(storage);
  });

  // Errors come back as values: a rejected invoke loses its message on the way.
  ipcMain.handle("engine:command", (_e, tabId, cmd) =>
    engine.command(tabId, cmd).catch((e) => ({ ok: false, error: e.message }))
  );
  ipcMain.handle("engine:tabFor", (_e, origin) =>
    engine.tabFor(origin).then((tabId) => ({ ok: true, tabId }), (e) => ({ ok: false, error: e.message }))
  );

  ipcMain.handle("menu:app", (_e, pos) => appMenu(pos));
  ipcMain.handle("menu:tab", (_e, id) => tabMenu(id));
}

/* ---------- app ---------- */

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  settings = store.loadSettings();
  recent = store.loadRecent();
  storage = store.loadStorage();

  const ses = session.defaultSession;
  const allowed = new Set(["clipboard-read", "clipboard-sanitized-write", "fullscreen", "pointerLock"]);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // Signed in last time? Then still signed in now - before any tab loads.
  await restoreSessionCookies(ses);
  setInterval(() => saveSessionCookies(ses), 60000);

  registerIpc();
  createWindow();
  // Windows switched between light and dark: follow it when set to "Match Windows".
  nativeTheme.on("updated", () => settings.theme === "system" && paintWindow());
  checkAll(true);
});

// Session cookies are saved on the way out; quitting waits for that, once.
let quitting = false;
app.on("before-quit", (e) => {
  saveOpenTabs();
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  saveSessionCookies(session.defaultSession).finally(() => app.quit());
});
app.on("window-all-closed", () => app.quit());
