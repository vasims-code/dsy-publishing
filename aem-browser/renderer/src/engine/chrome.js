/**
 * The toolkit's panel code keeps its settings and the copy deck's field lists in
 * chrome.storage.sync. In the browser there is no extension API, so this stands in:
 * the same calls, kept in a file in the app's user-data folder.
 */
const browser = window.browser;
const listeners = new Set();
let cache = null;

const load = async () => (cache ??= await browser.storageGetAll());
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function emit(changes) {
  for (const fn of listeners) {
    try {
      fn(changes, "sync");
    } catch (e) {
      console.error(e);
    }
  }
}

const sync = {
  async get(keys) {
    const all = await load();
    if (keys == null) return clone(all);
    const defaults = keys && typeof keys === "object" && !Array.isArray(keys) ? keys : {};
    const names = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const out = {};
    for (const k of names) {
      if (k in all) out[k] = clone(all[k]);
      else if (k in defaults) out[k] = defaults[k];
    }
    return out;
  },
  async set(items) {
    const all = await load();
    const changes = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = { oldValue: all[k], newValue: clone(v) };
      all[k] = clone(v);
    }
    await browser.storageSet(items);
    emit(changes);
  },
  async remove(keys) {
    const all = await load();
    const changes = {};
    for (const k of [].concat(keys)) {
      changes[k] = { oldValue: all[k] };
      delete all[k];
    }
    await browser.storageRemove(keys);
    emit(changes);
  },
};

window.chrome = {
  storage: {
    sync,
    onChanged: {
      addListener: (fn) => listeners.add(fn),
      removeListener: (fn) => listeners.delete(fn),
    },
  },
};
