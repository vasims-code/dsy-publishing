/**
 * Small JSON files in the app's user-data folder: settings, recent pages and
 * the tabs to reopen. Written whole on every change; they stay tiny.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SETTINGS = {
  theme: "dark",
  homeServerId: null,
  // Where "Sign in" goes: the author servers only let you in after a WDS single sign-on.
  signInUrl: "https://wds.samsung.com/",
  servers: [
    { id: "eu", name: "EU Author", host: "p6-eu-author.samsung.com", region: "eu" },
    { id: "asia", name: "Asia Author", host: "p6-ap-author.samsung.com", region: "asia" },
  ],
  // Versions, Copy deck and Import translation are off until someone turns them on in Settings → Tools.
  tools: { backup: true, sync: true, fromserver: true, versions: false, copydeck: false, import: false },
  // The toolkit's own settings, in the shape the settings screens edit.
  backup: { folder: "india/backup", template: "/conf/consumer/settings/wcm/templates/page-marketing", rootDepth: 3 },
  sync: { extraHosts: [], neverOverwrite: ["hreflangGroup"], keepSites: ["global"] },
  fromserver: { keepAsIs: [] },
  copydeck: { added: [], ignored: [] },
  // Which of the one-time updates below have been applied to stored settings.
  settingsVersion: 2,
};

/**
 * One-time updates to settings already stored. A changed default only reaches people who never
 * saved settings; anyone who did has the old value stored, and it would win for ever. Each step
 * runs once, then the version moves on - so a tool turned back on afterwards stays on.
 */
const MIGRATIONS = {
  // 2: Versions, Copy deck and Import translation became off by default - turned off once for everyone.
  2: (s) => ({ ...s, tools: { ...s.tools, versions: false, copydeck: false, import: false } }),
};

function file(name) {
  return path.join(app.getPath("userData"), name);
}

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8"));
  } catch {
    return fallback;
  }
}

function write(name, value) {
  try {
    fs.mkdirSync(path.dirname(file(name)), { recursive: true });
    fs.writeFileSync(file(name), JSON.stringify(value, null, 2));
  } catch (e) {
    console.error("Could not save", name, e);
  }
}

export function loadSettings() {
  const stored = read("settings.json", null);
  if (!stored) return structuredClone(DEFAULT_SETTINGS);
  let s = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...stored,
    tools: { ...DEFAULT_SETTINGS.tools, ...stored.tools },
  };
  const from = stored.settingsVersion || 1;
  for (let v = from + 1; v <= DEFAULT_SETTINGS.settingsVersion; v++) if (MIGRATIONS[v]) s = MIGRATIONS[v](s);
  if (from < DEFAULT_SETTINGS.settingsVersion) {
    s.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
    saveSettings(s);
  }
  return s;
}

export const saveSettings = (s) => write("settings.json", s);

export const loadRecent = () => read("recent.json", []);
export const saveRecent = (r) => write("recent.json", r);

export const loadSession = () => read("session.json", null);
export const saveSession = (s) => write("session.json", s);

/** The toolkit's own chrome.storage.sync keys (its settings, the copy deck's fields). */
export const loadStorage = () => read("storage.json", {});
export const saveStorage = (s) => write("storage.json", s);
