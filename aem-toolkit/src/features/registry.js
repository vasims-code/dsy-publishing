/**
 * The feature registry.
 *
 * To add a feature, create src/features/<id>/ with three files and add one
 * entry here. Nothing else in the extension needs to know about it.
 *
 *   meta.js    id, title, description, and the form fields the panel renders.
 *              Imported by BOTH sides, so it must stay free of DOM and network.
 *   worker.js  exports `actions`, an object of async functions that run inside
 *              the content script with an AemClient. This is where AEM calls go.
 *   panel.js   optional. Exports `renderResult(container, data)` when the
 *              feature returns something richer than log lines.
 *
 * Keeping the list explicit rather than globbing means a half-finished feature
 * folder cannot accidentally ship.
 */

export const FEATURE_IDS = ['page-copy', 'page-upsert', 'page-transfer', 'page-versions', 'copy-deck', 'copy-deck-import', 'link-fixer'];

/** Panel side: metadata only, cheap to load. */
export async function loadMeta(id) {
  const mod = await import(`./${id}/meta.js`);
  return mod.default;
}

export async function loadAllMeta() {
  return Promise.all(FEATURE_IDS.map(loadMeta));
}

/** Panel side: optional custom renderer. */
export async function loadPanel(id) {
  try {
    return await import(`./${id}/panel.js`);
  } catch {
    return null;
  }
}

/** Content-script side: the actions that actually touch AEM. */
export async function loadWorker(id) {
  const mod = await import(`./${id}/worker.js`);
  return mod.actions;
}
