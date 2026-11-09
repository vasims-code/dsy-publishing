/**
 * The panel's side of the conversation with a tab.
 *
 * One command goes out, one result comes back, and the progress lines that
 * arrive while it runs come back separately - they cannot ride on the result,
 * because the result only exists once the work is done. See core/protocol.js.
 *
 * A run holds the tab until it lets go, so two panels cannot write to the
 * same page at once. Letting go is in a finally: a run that throws still
 * frees the tab.
 */

import { SESSION } from '../core/instances.js';
import { MSG } from '../core/protocol.js';
import { RELEASE } from '../content/run-lock.js';

/** runId -> the screen waiting on it. */
const watching = new Map();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === MSG.REPORT) watching.get(msg.runId)?.(msg);
});

async function ensureContentScript(tabId) {
  const res = await chrome.runtime.sendMessage({ type: 'aemt:ensure-content-script', tabId });
  if (!res?.ok) throw new Error(res?.error || 'Could not reach that AEM page.');
}

async function letGo(runId, tabId) {
  watching.delete(runId);
  await chrome.tabs.sendMessage(tabId, { type: RELEASE, runId }).catch(() => {});
}

/* ------------------------------------------------------- runs under way */

/* Every run still waiting on a tab. The shell asks, so that nothing it does -
   going back to the tools, mostly - can drop a tool's state while a run is
   still going to report into it: the run would carry on writing, and its
   result would land on state nobody draws any more. */
const live = new Set();
let onBusy = null;

/** `fn(busy)` is called whenever a run starts or the last one ends. */
export function watchRuns(fn) {
  onBusy = fn;
}

export const running = () => live.size > 0;

function begin(runId) {
  const was = live.size;
  live.add(runId);
  if (!was) onBusy?.(true);
}

function end(runId) {
  if (!live.delete(runId)) return;
  if (!live.size) onBusy?.(false);
}

/* ------------------------------------------------- the tab a tool works in */

/*
 * Once a tool has run anything in a tab, it stays with that tab and that
 * server until it is left. The tab in front can change under an open tool -
 * another tab clicked, another window - and a screen that read one page and
 * then sent its write to "the tab in front" would write to a page, even a
 * server, nobody reviewed. The shell arms this when a tool opens and drops it
 * when the tool is left; screens need do nothing.
 */
const pin = { originNow: null, current: null, onChange: null };

/** A tool has opened. `originNow()` says which server the tab in front is on. */
export function armPin(originNow, onChange) {
  pin.originNow = originNow;
  pin.current = null;
  pin.onChange = onChange || null;
}

/** The tool has been left: the next one starts on whatever tab is in front. */
export function dropPin() {
  const had = pin.current;
  pin.originNow = null;
  pin.current = null;
  if (had) pin.onChange?.();
  pin.onChange = null;
}

/** { tabId, origin } once the open tool has run in a tab, else null. */
export const pinned = () => pin.current;

/**
 * The server a run must find itself on, or a refusal. `origin` is what the
 * screen says it read; the pin is what the shell held it to.
 */
function expectedOrigin(tabId, origin) {
  if (!pin.originNow) return origin || null;
  if (!pin.current) {
    pin.current = { tabId, origin: origin || pin.originNow() || null };
    pin.onChange?.();
  } else if (tabId !== pin.current.tabId) {
    throw new Error(
      `This tool is working on the tab it first read, on ${hostOf(pin.current.origin)}. Nothing was sent. ` +
        'Go back to the tools to start again on the tab in front.'
    );
  }
  if (origin && pin.current.origin && origin !== pin.current.origin) {
    throw new Error(
      `This was read on ${hostOf(origin)}, but the tool is working on ${hostOf(pin.current.origin)}. Nothing was sent.`
    );
  }
  return origin || pin.current.origin;
}

/**
 * Run one of a feature's actions in the tab, streaming its progress to
 * `onReport`. Resolves with the action's result, or throws with a reason in
 * the words the panel can show.
 */
export async function runAction({ featureId, action, params, settings, tabId, origin, onReport }) {
  if (tabId == null) throw new Error('No AEM tab to run in. Open one, then try again.');
  /* The content script refuses a command meant for another server, so a tab
     that has gone somewhere else since it was read cannot be written to. */
  const expect = expectedOrigin(tabId, origin);

  const runId = crypto.randomUUID();
  begin(runId);
  try {
    await ensureContentScript(tabId);
    if (onReport) watching.set(runId, onReport);
    const res = await chrome.tabs.sendMessage(tabId, {
      type: MSG.COMMAND,
      runId,
      feature: featureId,
      action,
      params,
      settings,
      origin: expect
    });
    if (!res) throw new Error('That AEM page did not answer.');
    if (!res.ok) throw new Error(explain(res.error) || 'The run failed.');
    return res.result;
  } catch (e) {
    /* The tab went away mid-request: reloaded, closed, or off to another
     * page. Said in those words, not as "the message port closed". */
    if (/message port closed|Receiving end does not exist/i.test(e.message)) {
      throw new Error(
        'The AEM tab stopped answering - it was reloaded, closed or went to another page. ' +
          'Check that page before running again.'
      );
    }
    throw new Error(explain(e.message));
  } finally {
    await letGo(runId, tabId);
    end(runId);
  }
}

/**
 * What an HTTP number means, for the person reading it.
 *
 * The engine reports the status it got, which is the truth but not an
 * answer: "Unexpected HTTP 502" says nothing about whose fault it is or what
 * to do next. Nothing is hidden - the original sentence is kept and a line
 * is added to it.
 */
/* Matched against "HTTP <n>" only, so a number that happens to be in a
   path is never mistaken for a status. */
const HTTP_SAID = [
  [/HTTP 50[234]/i, 'The server did not answer properly. It may be restarting, or a gateway in front of it timed out. Nothing was written - wait a moment and try again.'],
  [/HTTP 40[13]/i, 'Your session may have expired, or your account may not have access to that path. Open the AEM tab, sign in again, and try again.'],
  [/HTTP 404/i, 'Nothing is at that path on this instance. Check the path, and that you are on the instance you mean to be.'],
  [/HTTP 409/i, 'Something else is holding that page - it may be locked or being edited. Check the page in AEM, then try again.'],
  [/HTTP 413/i, 'What was being sent is too big for this instance to accept in one request.']
];

function explain(message) {
  const said = String(message || '');
  const hit = HTTP_SAID.find(([re]) => re.test(said));
  return hit ? `${said.replace(/\s*$/, '').replace(/\.$/, '')}. ${hit[1]}` : said;
}

/* ----------------------------------------------------- a second instance */

/**
 * A tab on that instance, opened if there is not one already.
 *
 * Bringing a page from another server needs two tabs: the source is read
 * inside its own origin, where the session cookie is, and the destination is
 * written inside its own. Neither can be reached from the other, which is why
 * a transfer is driven from here one request at a time rather than handed to
 * a worker whole.
 */
export async function tabFor(origin, settings) {
  if (!settings?.origins?.includes(origin)) {
    throw new Error(`${hostOf(origin)} is not one of your instances. Add it in Settings.`);
  }
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) {
    throw new Error(`${hostOf(origin)} has not been allowed. Open Settings and grant it.`);
  }

  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  const existing = tabs.find((t) => !t.discarded) || tabs[0];
  const tabId = existing ? existing.id : await openTabOn(origin);

  /* Signed out, every request there comes back as the login page. Said now,
     by name, rather than as "did not return JSON" from the first read. */
  const session = await askTab(tabId).catch(() => null);
  if (session?.state === SESSION.OUT) {
    throw new Error(`You are not signed in to ${hostOf(origin)}. Sign in there, then try again.`);
  }
  return tabId;
}

const hostOf = (o) => String(o || '').replace(/^https?:\/\//, '');

async function openTabOn(origin) {
  const created = await chrome.tabs.create({ url: `${origin}/`, active: false });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdate);
      reject(new Error(`Timed out opening a tab on ${hostOf(origin)}.`));
    }, 30000);
    function onUpdate(id, info) {
      if (id !== created.id || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdate);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdate);
  });
  return created.id;
}

async function askTab(tabId) {
  await ensureContentScript(tabId);
  const answer = await chrome.tabs.sendMessage(tabId, { type: MSG.SESSION });
  return answer?.state ? answer : null;
}

/**
 * One request in a run that spans several - a transfer's read, prepare,
 * image piece or write. The run id is the caller's, so every request of it
 * holds the same tabs and reports under the same run; `letGo` is the
 * caller's job once the whole sequence is over.
 */
export async function sendOne({ featureId, action, params, settings, tabId, runId, onReport }) {
  if (tabId == null) throw new Error('No tab to run in.');
  // Under way until `finish`, which the caller always reaches in a finally.
  begin(runId);
  await ensureContentScript(tabId);
  if (onReport) watching.set(runId, onReport);
  const res = await chrome.tabs.sendMessage(tabId, {
    type: MSG.COMMAND,
    runId,
    feature: featureId,
    action,
    params,
    settings
  });
  if (!res) throw new Error('That AEM page did not answer.');
  if (res.ok === false && res.error) return { ...res, error: explain(res.error) };
  return res;
}

/** The run is over: every tab it held is free again. */
export async function finish(runId, tabIds) {
  watching.delete(runId);
  end(runId);
  for (const id of new Set(tabIds.filter((x) => x != null))) {
    await chrome.tabs.sendMessage(id, { type: RELEASE, runId }).catch(() => {});
  }
}

export const newRunId = () => crypto.randomUUID();
