/**
 * Service worker. Two jobs, both plumbing:
 *   - make the toolbar button open the side panel
 *   - inject the content script on demand
 *
 * Injection is on demand rather than declared in the manifest because the set
 * of AEM hosts is configured by the user at runtime. Declared content_scripts
 * would mean either hardcoding hosts or asking for every site up front.
 */

import { MSG } from '../core/protocol.js';
import { applyTeamDefaults } from '../core/team-defaults.js';

// On install and on update: fill in any team default the person does not have yet.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  applyTeamDefaults().catch(() => {});
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

/** Is the content script already listening in this tab? */
async function isReady(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: MSG.PING });
    return !!res?.ok;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId) {
  if (await isReady(tabId)) return { ok: true, injected: false };

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/content.js']
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }

  // executeScript resolves once the classic entry has run, but that entry only
  // kicks off a dynamic import - the listener is not attached yet. Poll briefly
  // rather than race the first command.
  for (let i = 0; i < 25; i++) {
    if (await isReady(tabId)) return { ok: true, injected: true };
    await new Promise((r) => setTimeout(r, 40));
  }
  return { ok: false, error: 'Content script did not become ready in time.' };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'aemt:ensure-content-script') {
    ensureContentScript(msg.tabId).then(sendResponse);
    return true;
  }
  return false;
});
