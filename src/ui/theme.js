/**
 * Light, dark, or whatever the computer is set to.
 *
 * The colours are in tokens.css: the dark ones apply when Windows is in dark
 * mode, unless the page says light, and always when the page says dark. This
 * only says which - `data-theme` on <html>, from the Appearance setting.
 */

import { STORAGE_KEY, loadSettings } from '../core/protocol.js';

export const THEMES = [
  ['system', 'Match Windows'],
  ['light', 'Light'],
  ['dark', 'Dark']
];

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

/** Apply the saved choice now, and again whenever it changes in any window. */
export async function watchTheme() {
  try {
    applyTheme((await loadSettings()).theme);
  } catch {
    // Settings unreadable: the computer's own choice.
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[STORAGE_KEY]) applyTheme(changes[STORAGE_KEY].newValue?.theme);
  });
}
