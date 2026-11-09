/**
 * Team defaults: the settings a team shares by shipping default-settings.json
 * inside the extension folder.
 *
 * The file is applied once per version, and only fills gaps: a setting the
 * person already has is never overwritten, lists (author instances, copy deck
 * fields) are merged, and whatever they add later stays. A new zip with a
 * higher `version` in the file brings in settings added since, nothing more.
 * "Reset to team defaults" is the one way to overwrite - and only on a click.
 *
 * File shape: { version, settings: {...}, copyDeckAdded: [{component, prop, group}],
 *               copyDeckIgnored: [{component, prop}] }
 */

import { DEFAULT_SETTINGS, STORAGE_KEY } from './protocol.js';
import { cleanFields, fieldId } from '../features/copy-deck/core.js';
import { FIELD_KEYS } from '../features/copy-deck/fields.js';

const SEEN_KEY = 'aemt.teamDefaultsVersion';
const FILE = 'default-settings.json';

const pack = (f) => (f.group ? { c: f.component, p: f.prop, g: f.group } : { c: f.component, p: f.prop });
const unpack = (s) => ({ component: s?.c, prop: s?.p, group: s?.g });

export async function readTeamDefaults() {
  try {
    const res = await fetch(chrome.runtime.getURL(FILE));
    if (!res.ok) return null;
    const file = await res.json();
    return file && typeof file === 'object' ? file : null;
  } catch {
    return null;
  }
}

const union = (a, b, key) => {
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((x) => !seen.has(key(x)))];
};

/**
 * An author instance as Settings stores one typed into it: scheme, host and
 * port, lower case, no path or slash. A bare host is taken as https, as the
 * Settings box takes it. Anything else is null.
 *
 * Stored as written, "https://P6-EU-Author.samsung.com/" never matched the tab
 * it named, sat beside its own lower-case twin, and a bare host made a
 * permission pattern Chrome refuses.
 */
export function cleanOrigin(raw) {
  let v = String(raw ?? '').trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try {
    const u = new URL(v);
    return /^https?:$/.test(u.protocol) && u.hostname ? u.origin : null;
  } catch {
    return null;
  }
}

/* Each number's own range, as Settings holds it when typed. Out of range is
   not clamped: a value nobody meant is dropped, and the person's own (or the
   default) stays. A 0 or an empty limit read later as "no limit" - 256 MB. */
const NUMBERS = {
  rootDepth: { min: 1, max: 20 },
  transferMaxImageMb: { min: 1, max: 256 }
};

/**
 * The team file's settings, each checked the way Settings checks a value
 * typed into it. Returns { settings, dropped }: what can be stored, and a
 * line for each value left out and why.
 */
export function cleanTeamSettings(raw) {
  const settings = {};
  const dropped = [];
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (k === 'settingsVersion') continue;
    if (k === 'origins') {
      const list = Array.isArray(v) ? v : [];
      if (!Array.isArray(v)) dropped.push('origins: not a list');
      const out = [];
      for (const o of list) {
        const clean = cleanOrigin(o);
        if (!clean) dropped.push(`origins: "${o}" is not an address`);
        else if (!out.includes(clean)) out.push(clean);
      }
      settings.origins = out;
      continue;
    }
    if (k in NUMBERS) {
      const n = typeof v === 'number' ? v : /^\s*\d+\s*$/.test(String(v ?? '')) ? Number(v) : NaN;
      const { min, max } = NUMBERS[k];
      if (Number.isInteger(n) && n >= min && n <= max) settings[k] = n;
      else dropped.push(`${k}: ${JSON.stringify(v)} is not a whole number from ${min} to ${max}`);
      continue;
    }
    // Everything else has to be the same kind of value as its default.
    const want = DEFAULT_SETTINGS[k];
    if (want !== undefined) {
      const same = Array.isArray(want) ? Array.isArray(v) : v !== null && typeof v === typeof want && !Array.isArray(v);
      if (!same) {
        dropped.push(`${k}: ${JSON.stringify(v)} is not a ${Array.isArray(want) ? 'list' : typeof want}`);
        continue;
      }
    }
    // Settings trims what is typed into a box; a team file is held to the same.
    settings[k] = typeof v === 'string' ? v.trim() : v;
  }
  return { settings, dropped };
}

/** Stored origins, cleaned the same way, so the merge cannot keep a twin. */
const cleanOrigins = (list) => cleanTeamSettings({ origins: Array.isArray(list) ? list : [] }).settings.origins;

/**
 * Apply the file. `reset` overwrites the settings the file names and replaces
 * the two field lists; without it nothing existing is changed.
 * Returns false when nothing was applied, else { dropped }: the file's values
 * that were left out, each with why.
 */
export async function applyTeamDefaults({ reset = false } = {}) {
  const file = await readTeamDefaults();
  if (!file) return false;
  const version = Number(file.version) || 1;

  if (!reset) {
    const seen = (await chrome.storage.local.get(SEEN_KEY))[SEEN_KEY] || 0;
    if (seen >= version) return false;
  }

  const got = await chrome.storage.sync.get([STORAGE_KEY, FIELD_KEYS.add, FIELD_KEYS.ignore]);
  const stored = got[STORAGE_KEY] || null;
  const { settings: shared, dropped } = cleanTeamSettings(file.settings);
  if (dropped.length) console.warn('[DSY] team defaults left out:', dropped);

  let next;
  if (reset) {
    next = { ...(stored || { settingsVersion: DEFAULT_SETTINGS.settingsVersion }), ...shared };
    next.origins = union(shared.origins || [], cleanOrigins(stored?.origins), (o) => o);
  } else {
    // Gaps only. A first install has no stored settings, so everything is a gap;
    // settingsVersion is set so the one-time migrations do not run over it.
    next = stored ? { ...stored } : { settingsVersion: DEFAULT_SETTINGS.settingsVersion };
    for (const [k, v] of Object.entries(shared)) {
      if (k === 'settingsVersion' || k === 'origins') continue;
      if (!(k in next)) next[k] = v;
    }
    next.origins = union(cleanOrigins(next.origins), shared.origins || [], (o) => o);
  }
  if (!next.settingsVersion) next.settingsVersion = DEFAULT_SETTINGS.settingsVersion;

  const mine = {
    add: (got[FIELD_KEYS.add] || []).map(unpack),
    ignore: (got[FIELD_KEYS.ignore] || []).map(unpack)
  };
  const theirs = { add: file.copyDeckAdded || [], ignore: file.copyDeckIgnored || [] };
  const fields = cleanFields(
    reset
      ? theirs
      : { add: union(mine.add, theirs.add, fieldId), ignore: union(mine.ignore, theirs.ignore, fieldId) }
  );

  await chrome.storage.sync.set({
    [STORAGE_KEY]: next,
    [FIELD_KEYS.add]: fields.add.map(pack),
    [FIELD_KEYS.ignore]: fields.ignore.map(pack)
  });
  await chrome.storage.local.set({ [SEEN_KEY]: version });
  return { dropped };
}

/** The current settings and field lists, in the file's shape, ready to save as default-settings.json. */
export async function exportTeamDefaults() {
  const got = await chrome.storage.sync.get([STORAGE_KEY, FIELD_KEYS.add, FIELD_KEYS.ignore]);
  const { settingsVersion, ...settings } = got[STORAGE_KEY] || {};
  const d = new Date();
  const version = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return {
    version,
    settings,
    copyDeckAdded: (got[FIELD_KEYS.add] || []).map(unpack),
    copyDeckIgnored: (got[FIELD_KEYS.ignore] || []).map(unpack)
  };
}
