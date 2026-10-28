/**
 * The browser's tabs. A web tab is a WebContentsView laid over the page area
 * of the interface; the interface reports where that area is. The new tab
 * page and Settings are drawn by the interface itself and have no view.
 */
import { WebContentsView, dialog } from "electron";
import { EventEmitter } from "node:events";

const SEARCH = "https://www.google.com/search?q=";
export const INTERNAL = { settings: "dsy://settings", newtab: "dsy://newtab" };
// The addresses these pages had before the browser was DSY still open them.
const OLD_INTERNAL = { "aem-toolkit://settings": "settings", "aem-toolkit://newtab": "newtab" };

let seq = 0;

export class Tabs extends EventEmitter {
  constructor({ win, session, onKey, onContextMenu }) {
    super();
    this.win = win;
    this.session = session;
    this.onKey = onKey;
    this.onContextMenu = onContextMenu;
    this.list = [];
    this.activeId = null;
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.closed = [];
    this.pending = false;
  }

  get active() {
    return this.get(this.activeId);
  }

  get(id) {
    return this.list.find((t) => t.id === id) || null;
  }

  /** Tell the interface something changed, once per tick however many things did. */
  changed() {
    if (this.pending) return;
    this.pending = true;
    setImmediate(() => {
      this.pending = false;
      this.emit("change");
    });
  }

  state() {
    return {
      activeId: this.activeId,
      tabs: this.list.map((t) => ({
        id: t.id,
        kind: t.kind,
        url: t.kind === "page" ? t.url : INTERNAL[t.kind],
        title: t.title,
        favicon: t.favicon,
        loading: t.loading,
        error: t.error,
        canGoBack: t.canGoBack,
        canGoForward: t.canGoForward,
        zoom: t.zoom,
      })),
    };
  }

  /**
   * `opened` is Chromium's own new web contents, when a page opens a tab (a link with
   * target=_blank, a form posted to a new tab, window.open). Using it instead of loading
   * the URL afresh keeps what came with it: the posted form data and window.opener, which
   * single sign-on hand-overs depend on.
   */
  create({ url = null, kind = url ? "page" : "newtab", active = true, after = null, opened = null } = {}) {
    const tab = {
      id: "t" + ++seq,
      kind,
      view: null,
      url: "",
      title: kind === "settings" ? "Settings" : "New tab",
      favicon: null,
      loading: false,
      error: null,
      canGoBack: false,
      canGoForward: false,
      zoom: 0,
    };
    const at = after ? this.list.findIndex((t) => t.id === after) + 1 : this.list.length;
    this.list.splice(at > 0 ? at : this.list.length, 0, tab);
    if (opened) {
      this.createView(tab, opened);
      tab.url = url || "";
      tab.title = "";
    } else if (kind === "page" && url) this.load(tab, url);
    if (active || !this.activeId) this.activate(tab.id);
    this.changed();
    return tab;
  }

  openInternal(kind) {
    const existing = kind === "settings" && this.list.find((t) => t.kind === "settings");
    if (existing) return this.activate(existing.id);
    return this.create({ kind });
  }

  close(id) {
    const i = this.list.findIndex((t) => t.id === id);
    if (i < 0) return;
    const tab = this.list[i];
    if (tab.kind === "page" && tab.url) this.closed.push(tab.url);
    this.destroyView(tab);
    this.list.splice(i, 1);
    if (this.activeId === id) {
      const next = this.list[i] || this.list[i - 1];
      this.activeId = null;
      if (next) this.activate(next.id);
    }
    if (!this.list.length) this.create();
    this.changed();
  }

  /** Move a tab to another place in the strip; `index` is where it ends up. */
  move(id, index) {
    const from = this.list.findIndex((t) => t.id === id);
    if (from < 0) return;
    const [tab] = this.list.splice(from, 1);
    this.list.splice(Math.max(0, Math.min(index, this.list.length)), 0, tab);
    this.changed();
  }

  reopenClosed() {
    const url = this.closed.pop();
    if (url) this.create({ url });
  }

  activate(id) {
    const tab = this.get(id);
    if (!tab) return;
    this.activeId = id;
    this.layout();
    if (tab.view && !tab.error) tab.view.webContents.focus();
    this.changed();
    this.emit("activated", tab);
  }

  cycle(step) {
    const i = this.list.findIndex((t) => t.id === this.activeId);
    const n = this.list.length;
    if (n) this.activate(this.list[(i + step + n) % n].id);
  }

  /** Only the active web tab is shown, at the bounds the interface reported. */
  layout() {
    for (const t of this.list) {
      if (!t.view) continue;
      const show = t.id === this.activeId && !t.error && this.bounds.width > 0;
      if (show) t.view.setBounds(this.bounds);
      t.view.setVisible(show);
    }
  }

  setBounds(b) {
    this.bounds = {
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.max(0, Math.round(b.width)),
      height: Math.max(0, Math.round(b.height)),
    };
    this.layout();
  }

  /** Address bar input: a URL, a host, an AEM path on the current server, or a search. */
  navigate(id, input) {
    const tab = this.get(id);
    const text = String(input || "").trim();
    if (!tab || !text) return;

    const internal = text === INTERNAL.settings ? "settings" : text === INTERNAL.newtab ? "newtab" : OLD_INTERNAL[text];
    if (internal === "settings") return this.openInternal("settings");
    if (internal === "newtab") return this.showNewTab(id);

    const url = this.resolve(text, tab);
    if (tab.kind !== "page") tab.kind = "page";
    this.load(tab, url);
    this.activate(tab.id);
  }

  resolve(text, tab) {
    let origin = "";
    try {
      origin = tab.url ? new URL(tab.url).origin : "";
    } catch {}
    if (text.startsWith("/") && /^https?:/.test(origin)) {
      // A repository path typed while on an author server opens in the editor there.
      if (/^\/content\/[^?#]+$/.test(text) && !/\.\w+$/.test(text)) return `${origin}/editor.html${text}.html`;
      return origin + text;
    }
    if (/^(https?|about|data|chrome):/i.test(text)) return text;
    if (/^localhost(:\d+)?(\/|$)/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text)) return "http://" + text;
    if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text)) return "https://" + text;
    return SEARCH + encodeURIComponent(text);
  }

  showNewTab(id) {
    const tab = this.get(id);
    if (!tab) return;
    this.destroyView(tab);
    Object.assign(tab, { kind: "newtab", url: "", title: "New tab", favicon: null, error: null, loading: false });
    this.layout();
    this.changed();
  }

  load(tab, url) {
    if (!tab.view) this.createView(tab);
    tab.error = null;
    tab.url = url;
    tab.view.webContents.loadURL(url).catch(() => {
      /* reported through did-fail-load */
    });
    this.changed();
  }

  createView(tab, opened = null) {
    const view = new WebContentsView(
      opened
        ? { webContents: opened }
        : {
            webPreferences: {
              session: this.session,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              spellcheck: true,
            },
          }
    );
    view.setBackgroundColor("#ffffff");
    view.setVisible(false);
    this.win.contentView.addChildView(view);
    tab.view = view;

    const wc = view.webContents;
    const nav = () => {
      tab.canGoBack = wc.navigationHistory.canGoBack();
      tab.canGoForward = wc.navigationHistory.canGoForward();
    };

    wc.on("did-start-loading", () => {
      tab.loading = true;
      this.changed();
    });
    wc.on("did-stop-loading", () => {
      tab.loading = false;
      nav();
      this.changed();
    });
    wc.on("did-start-navigation", (_e, url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        tab.error = null;
        this.layout();
      }
    });
    wc.on("did-navigate", (_e, url) => {
      tab.url = url;
      tab.favicon = null;
      tab.title = ""; // a page without a <title> (a JSON answer, say) shows its address instead
      nav();
      this.changed();
      this.emit("navigated", tab);
    });
    wc.on("did-navigate-in-page", (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      tab.url = url;
      nav();
      this.changed();
      this.emit("navigated", tab);
    });
    wc.on("page-title-updated", (_e, title) => {
      tab.title = title;
      this.changed();
      this.emit("titled", tab);
    });
    wc.on("page-favicon-updated", (_e, icons) => {
      tab.favicon = icons?.[0] || null;
      this.changed();
    });
    wc.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
      // -3 is an aborted load: another navigation replaced it, not a failure.
      if (!isMainFrame || code === -3) return;
      tab.error = { code, description, url };
      tab.loading = false;
      this.layout();
      this.changed();
    });
    wc.on("render-process-gone", (_e, details) => {
      if (details.reason === "clean-exit") return;
      tab.error = { code: "crashed", description: details.reason, url: tab.url };
      this.layout();
      this.changed();
    });
    wc.on("zoom-changed", (_e, dir) => this.zoom(tab.id, dir === "in" ? 0.5 : -0.5));
    wc.on("found-in-page", (_e, result) => this.emit("found", tab, result));
    wc.on("context-menu", (_e, params) => this.onContextMenu(tab, params));
    wc.on("before-input-event", (e, input) => this.onKey(e, input));

    // The AEM editor warns about unsaved changes this way.
    wc.on("will-prevent-unload", (e) => {
      const choice = dialog.showMessageBoxSync(this.win, {
        type: "question",
        buttons: ["Leave", "Stay"],
        defaultId: 1,
        cancelId: 1,
        title: "Leave this page?",
        message: "Changes you made may not be saved.",
      });
      if (choice === 0) e.preventDefault();
    });

    wc.setWindowOpenHandler(({ url, disposition }) => {
      // A window with its own size is usually a sign-in or a dialog: let it be a window.
      if (disposition === "new-window") {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: { session: this.session, sandbox: true, contextIsolation: true },
          },
        };
      }
      return {
        action: "allow",
        createWindow: (options) =>
          this.create({ url, active: disposition !== "background-tab", after: tab.id, opened: options.webContents }).view
            .webContents,
      };
    });
  }

  destroyView(tab) {
    if (!tab.view) return;
    try {
      this.win.contentView.removeChildView(tab.view);
    } catch {}
    try {
      tab.view.webContents.close();
    } catch {}
    tab.view = null;
  }

  webContents(id = this.activeId) {
    return this.get(id)?.view?.webContents || null;
  }

  back(id) {
    const wc = this.webContents(id);
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  forward(id) {
    const wc = this.webContents(id);
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(id, hard = false) {
    const tab = this.get(id);
    if (!tab?.view) return;
    tab.error = null;
    this.layout();
    if (hard) tab.view.webContents.reloadIgnoringCache();
    else tab.view.webContents.reload();
  }

  stop(id) {
    this.webContents(id)?.stop();
  }

  zoom(id, delta) {
    const tab = this.get(id);
    if (!tab?.view) return;
    tab.zoom = delta === null ? 0 : Math.max(-5, Math.min(5, tab.zoom + delta));
    tab.view.webContents.setZoomLevel(tab.zoom);
    this.changed();
  }

  find(id, text, opts = {}) {
    const wc = this.webContents(id);
    if (!wc) return;
    if (!text) return wc.stopFindInPage("clearSelection");
    wc.findInPage(text, { forward: opts.forward !== false, findNext: !!opts.findNext });
  }

  stopFind(id) {
    this.webContents(id)?.stopFindInPage("clearSelection");
  }

  destroyAll() {
    for (const t of this.list) this.destroyView(t);
  }
}
