/**
 * Content-script entry point. Deliberately a classic script with no imports,
 * because that is what chrome.scripting.executeScript can inject directly.
 *
 * It does one thing: pull in the real runtime as an ES module. Content scripts
 * may dynamically import extension-packaged modules as long as those modules
 * are listed in web_accessible_resources, which keeps the rest of the codebase
 * on normal module syntax instead of a pile of globals.
 */
(() => {
  if (window.__AEMT_CONTENT_READY__) return;
  window.__AEMT_CONTENT_READY__ = true;

  import(chrome.runtime.getURL('src/content/runtime.js'))
    .then((m) => m.init())
    .catch((e) => console.error('[DSY] failed to start:', e));
})();
