/**
 * The toolkit's engine as it runs inside an AEM author tab - the extension's own
 * content runtime and feature workers, unchanged.
 *
 * The browser injects this bundle into an isolated world of the tab: it shares the
 * page's origin and cookies (so every request carries the author session, exactly
 * as the extension's content script does) but none of the page's scripts.
 *
 * The runtime talks through chrome.runtime. Here that is a small stand-in: messages
 * the runtime sends (progress reports) wait in a queue the browser drains, and a
 * command is handed to the runtime's own message listener.
 */

const listeners = [];
const queue = [];

globalThis.chrome = {
  runtime: {
    sendMessage: async (msg) => {
      queue.push(msg);
    },
    onMessage: { addListener: (fn) => listeners.push(fn) },
    getURL: (p) => p,
  },
};

import { init } from "../../aem-toolkit/src/content/runtime.js";

init();

/** One message to the runtime, answered through its sendResponse. */
function dispatch(msg) {
  return new Promise((resolve) => {
    let answered = false;
    const respond = (res) => {
      answered = true;
      resolve(res);
    };
    for (const fn of listeners) {
      const async = fn(msg, {}, respond);
      if (async === true || answered) return;
    }
    resolve(undefined);
  });
}

globalThis.__AEMT__ = {
  command: dispatch,
  drain: () => queue.splice(0),
};
