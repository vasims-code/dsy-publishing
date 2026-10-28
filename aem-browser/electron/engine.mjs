/**
 * Runs the toolkit's engine inside author tabs.
 *
 * The engine (dist/engine.js) is injected into an isolated world of the tab: same
 * origin and cookies as the page, so every request carries the author session, but
 * no access to the page's own scripts or theirs to it. A command is one call into
 * that world; its progress reports wait in a queue there, drained a few times a
 * second and passed to the interface as they come.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { originOf, hostOf, readSession, SESSION } from "./aem.mjs";

const WORLD = 1987;
const DRAIN_MS = 150;

let bundle = null;
const engineCode = () => (bundle ??= fs.readFileSync(path.join(app.getAppPath(), "dist", "engine.js"), "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inWorld = (wc, code) => wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]);

/** Resolves once the tab has finished loading, or rejects after `timeout`. */
function loaded(wc, timeout = 30000) {
  if (!wc.isLoading()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      wc.off("did-stop-loading", done);
      reject(new Error("The page took too long to load."));
    }, timeout);
    function done() {
      clearTimeout(timer);
      resolve();
    }
    wc.once("did-stop-loading", done);
  });
}

/** Rejects if the tab leaves the page or closes while a command is running there. */
function leaving(wc) {
  let off;
  const p = new Promise((_, reject) => {
    const nav = (details) => {
      if (details.isMainFrame && !details.isSameDocument) reject(new Error("The tab went to another page while this was running."));
    };
    const gone = () => reject(new Error("The tab was closed while this was running."));
    wc.on("did-start-navigation", nav);
    wc.once("destroyed", gone);
    off = () => {
      wc.off("did-start-navigation", nav);
      wc.off("destroyed", gone);
    };
  });
  p.catch(() => {});
  return { p, off: () => off() };
}

export class Engine {
  constructor({ tabs, session, report, onSession }) {
    this.tabs = tabs;
    this.session = session;
    this.report = report;
    this.onSession = onSession;
  }

  webContentsOf(tabId) {
    const wc = this.tabs.get(tabId)?.view?.webContents;
    if (!wc || wc.isDestroyed()) throw new Error("That tab is closed. Open the page again and analyze again.");
    return wc;
  }

  async ensure(wc) {
    await loaded(wc);
    const ready = await inWorld(wc, "typeof globalThis.__AEMT__ === 'object'");
    if (!ready) await inWorld(wc, engineCode());
  }

  /** One command to the engine in a tab: { runId, feature, action, params, settings }. */
  async command(tabId, cmd) {
    const wc = this.webContentsOf(tabId);
    await this.ensure(wc);

    let running = true;
    const drain = async () => {
      const q = await inWorld(wc, "globalThis.__AEMT__ ? globalThis.__AEMT__.drain() : []").catch(() => []);
      for (const m of q || []) this.report(m);
    };
    (async () => {
      while (running) {
        await sleep(DRAIN_MS);
        if (running) await drain();
      }
    })();

    const away = leaving(wc);
    try {
      const msg = JSON.stringify({ type: "aemt:command", ...cmd });
      return await Promise.race([inWorld(wc, `globalThis.__AEMT__.command(${msg})`), away.p]);
    } finally {
      running = false;
      away.off();
      if (!wc.isDestroyed()) await drain();
    }
  }

  /**
   * A tab on another author server, for a feature that works across two. An open tab
   * there is used; otherwise one is opened in the background. Refused when not signed in
   * there - every request would only get the login page back.
   */
  async tabFor(origin) {
    const on = this.tabs.list.filter((t) => t.view && !t.view.webContents.isDestroyed() && originOf(t.url) === origin);
    let tab = on.find((t) => !t.error && !t.view.webContents.isLoading()) || on.find((t) => !t.error) || null;
    if (!tab) {
      tab = this.tabs.create({ url: `${origin}/`, active: false });
      await loaded(tab.view.webContents);
    }
    const s = await readSession(this.session, origin);
    this.onSession(origin, s);
    if (s.state === SESSION.OUT) throw new Error(`You are not signed in to ${hostOf(origin)}. Sign in there, then try again.`);
    if (s.state === SESSION.UNREACHABLE) throw new Error(`Can't reach ${hostOf(origin)}. Check the VPN, or that the server is up.`);
    return tab.id;
  }
}
