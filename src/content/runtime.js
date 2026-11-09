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
import { RELEASE, createRunLock } from './run-lock.js';

/** This tab's one run at a time - see run-lock.js. */
const lock = createRunLock();

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
  const { runId, feature, action, params, settings, origin } = msg;
  const report = makeReporter(runId);

  /* The panel names the server it read this page on. A tab that has gone to
     another server since - same tab, new address - answers here, and a write
     meant for the page that was reviewed must not land on this one. */
  if (origin && origin !== location.origin) {
    return {
      ok: false,
      error: `This tab is now on ${location.host}, not ${String(origin).replace(/^https?:\/\//, '')} where the page was read. Nothing was done - check the tab and start again.`
    };
  }

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

  // Another run - from another window's panel - has this tab: refuse, before anything is read or written.
  const turn = lock.claim(runId, feature, action);
  if (!turn.ok) return { ok: false, error: turn.error, busy: true };

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
  } finally {
    turn.done();
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

    // The panel's run is over, finished or stopped: the tab is free for the next one.
    if (msg?.type === RELEASE) {
      lock.release(msg.runId);
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
}
