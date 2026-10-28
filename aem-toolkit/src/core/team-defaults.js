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
 * Apply the file. `reset` overwrites the settings the file names and replaces
 * the two field lists; without it nothing existing is changed.
 * Returns true when anything was applied.
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
  const shared = file.settings && typeof file.settings === 'object' ? file.settings : {};

  let next;
  if (reset) {
    next = { ...(stored || { settingsVersion: DEFAULT_SETTINGS.settingsVersion }), ...shared };
    next.origins = union(shared.origins || [], stored?.origins || [], (o) => o);
  } else {
    // Gaps only. A first install has no stored settings, so everything is a gap;
    // settingsVersion is set so the one-time migrations do not run over it.
    next = stored ? { ...stored } : { settingsVersion: DEFAULT_SETTINGS.settingsVersion };
    for (const [k, v] of Object.entries(shared)) {
      if (k === 'settingsVersion' || k === 'origins') continue;
      if (!(k in next)) next[k] = v;
    }
    next.origins = union(next.origins || [], shared.origins || [], (o) => o);
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
  return true;
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
