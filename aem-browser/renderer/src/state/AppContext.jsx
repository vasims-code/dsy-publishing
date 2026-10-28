import React, { createContext, useContext, useCallback, useMemo, useState, useEffect } from "react";
import { looksLikeAem } from "@toolkit/core/instances.js";

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

const browser = window.browser;

const now = () => {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const normalizeHost = (h) =>
  String(h || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();

const originOfServer = (s) => {
  const h = String(s.host || "").trim();
  try {
    return /^https?:\/\//i.test(h) ? new URL(h).origin : `https://${normalizeHost(h)}`;
  } catch {
    return "";
  }
};

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** The repository path of the page a tab has open (same rules as the browser side). */
function pagePathFrom(u) {
  if (!u) return null;
  const item = u.searchParams.get("item");
  if (item && item.startsWith("/content/")) return item.replace(/\.html$/, "");
  const p = decodeURIComponent(u.pathname);
  const m =
    p.match(/^\/editor\.html(\/content\/.+?)(?:\.[a-z0-9-]+)*\.html$/i) ||
    p.match(/^\/(?:sites|assets)\.html(\/content\/.+?)\/?$/i) ||
    p.match(/^(\/content\/.+?)(?:\.[a-z0-9-]+)*\.html$/i);
  return m ? m[1] : null;
}

function withStatus(server, sessions) {
  const origin = originOfServer(server);
  const s = sessions[origin];
  const state = s?.state || "checking";
  return {
    ...server,
    origin,
    state,
    user: s?.user || null,
    signedIn: state === "in",
    reachable: state !== "unreachable",
    checking: state === "checking",
  };
}

export function AppProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [rawTabs, setRawTabs] = useState({ tabs: [], activeId: null });
  const [settings, setSettingsState] = useState(null);
  const [sessions, setSessions] = useState({});
  const [recent, setRecent] = useState([]);
  const [panel, setPanel] = useState(() => {
    try {
      return { open: true, width: 420, ...JSON.parse(localStorage.getItem("aemb.panel") || "{}") };
    } catch {
      return { open: true, width: 420 };
    }
  });
  const [activity, setActivity] = useState([{ time: now(), text: "Digital Samsung Yard ready." }]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let off = [];
    browser.getState().then((s) => {
      setRawTabs(s.tabs);
      setSettingsState(s.settings);
      setSessions(s.sessions);
      setRecent(s.recent);
      setReady(true);
    });
    off.push(browser.onTabs(setRawTabs));
    off.push(browser.onSettings(setSettingsState));
    off.push(browser.onSessions(setSessions));
    off.push(browser.onRecent(setRecent));
    return () => off.forEach((f) => f());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("aemb.panel", JSON.stringify(panel));
    } catch {}
  }, [panel]);

  // "Match Windows" follows the system setting, live.
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const change = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);
  const themeSetting = settings?.theme || "dark";
  const theme = themeSetting === "system" ? (systemDark ? "dark" : "light") : themeSetting === "light" ? "light" : "dark";
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const setSettings = useCallback((next) => browser.saveSettings(next).then(setSettingsState), []);
  const setTheme = useCallback((t) => settings && setSettings({ ...settings, theme: t }), [settings, setSettings]);
  const toggleTheme = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);

  // servers -------------------------------------------------------------
  const servers = useMemo(
    () => (settings?.servers || []).map((s) => withStatus(s, sessions)),
    [settings, sessions]
  );

  const serverOf = useCallback(
    (id) => {
      if (!id) return null;
      if (id.startsWith("host:")) {
        const host = id.slice(5);
        return withStatus({ id, name: host, host, region: "unknown" }, sessions);
      }
      return servers.find((s) => s.id === id) || null;
    },
    [servers, sessions]
  );

  // tabs ----------------------------------------------------------------
  const tabs = useMemo(
    () =>
      rawTabs.tabs.map((t) => {
        if (t.kind !== "page") {
          return { ...t, serverId: null, isAEM: false, path: null, icon: t.kind === "settings" ? "Settings" : "Plus" };
        }
        const u = parseUrl(t.url);
        const host = u?.hostname?.toLowerCase() || "";
        const server = servers.find((s) => normalizeHost(s.host) === host);
        const isAEM = !!server || (u ? looksLikeAem(u) : false);
        return {
          ...t,
          title: t.title || host || "Loading…",
          serverId: server ? server.id : isAEM ? "host:" + host : null,
          isAEM,
          path: isAEM ? pagePathFrom(u) : null,
          icon: "Globe",
        };
      }),
    [rawTabs, servers]
  );
  const activeTabId = rawTabs.activeId;
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) || null, [tabs, activeTabId]);

  const addActivity = useCallback((text, level = "info") => {
    setActivity((a) => [...a.slice(-499), { time: now(), text, level }]);
  }, []);
  const clearActivity = useCallback(() => setActivity([]), []);

  const setActiveTab = useCallback((id) => browser.activateTab(id), []);
  const addTab = useCallback((opts = {}) => browser.newTab(opts.url ? { url: opts.url } : {}), []);
  const closeTab = useCallback((id) => browser.closeTab(id), []);
  const navigate = useCallback((input, tabId) => browser.navigate(tabId || null, input), []);
  const openSettingsTab = useCallback(() => browser.openSettings(), []);

  // panel ---------------------------------------------------------------
  const togglePanel = useCallback(() => setPanel((p) => ({ ...p, open: !p.open })), []);
  const setPanelOpen = useCallback((open) => setPanel((p) => ({ ...p, open })), []);
  const setPanelWidth = useCallback(
    (width) => setPanel((p) => ({ ...p, width: Math.min(Math.max(640, window.innerWidth - 480), Math.max(360, width)) })),
    []
  );

  const value = {
    ready,
    browser,
    theme, themeSetting, toggleTheme, setTheme,
    tabs, activeTab, activeTabId, serverOf, servers, sessions, recent,
    setActiveTab, addTab, closeTab, navigate, openSettingsTab,
    panel, togglePanel, setPanelOpen, setPanelWidth,
    activity, addActivity, clearActivity, drawerOpen, setDrawerOpen,
    settings, setSettings,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
