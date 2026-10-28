/**
 * The content-script side of the extension: receives commands from the panel,
 * runs the requested feature action against AEM, and streams progress back.
 *
 * Everything here executes in the AEM page's origin, so fetches are same-origin
 * and carry the author session - the same position the devtools console is in.
 */

import { AemClient } from '../core/aem-client.js';
import { readSession } from '../core/instances.js';
import { LEVEL, MSG } from '../core/protocol.js';
import { loadWorker } from '../features/registry.js';

/** Progress cannot ride on the command response, so it goes back separately. */
function makeReporter(runId) {
  return (level, message, data) => {
    chrome.runtime
      .sendMessage({
        type: MSG.REPORT,
        runId,
        level,
        message,
        data,
        at: Date.now()
      })
      .catch(() => {
        // The panel may have been closed mid-run. Losing progress lines is
        // fine; the command itself carries on and still returns its result.
      });
  };
}

async function handleCommand(msg) {
  const { runId, feature, action, params, settings } = msg;
  const report = makeReporter(runId);

  let actions;
  try {
    actions = await loadWorker(feature);
  } catch (e) {
    return { ok: false, error: `Unknown feature "${feature}": ${e.message}` };
  }

  const fn = actions[action];
  if (typeof fn !== 'function') {
    return { ok: false, error: `Feature "${feature}" has no action "${action}".` };
  }

  const client = new AemClient({ report: (level, message) => report(level, message) });

  try {
    const result = await fn({ client, settings, report, params });
    return { ok: true, result };
  } catch (e) {
    // An AemAbort is an expected, explained stop - report it as a clean failure
    // rather than a crash, so the panel can show the reason without a stack.
    report(LEVEL.FAIL, e.isAbort ? e.message : `Unexpected error: ${e.message}`);
    if (!e.isAbort) console.error('[DSY]', e);
    return { ok: false, error: e.message, aborted: !!e.isAbort };
  }
}

export function init() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === MSG.PING) {
      sendResponse({ ok: true, href: location.href, origin: location.origin });
      return false;
    }

    if (msg?.type === MSG.COMMAND) {
      handleCommand(msg).then(sendResponse);
      return true; // keep the channel open for the async reply
    }

    if (msg?.type === MSG.SESSION) {
      readSession().then(sendResponse);
      return true;
    }

    return false;
  });
}
