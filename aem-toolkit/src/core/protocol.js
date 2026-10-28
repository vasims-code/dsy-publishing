/**
 * The contract between the side panel and the content script.
 *
 * Panel  --(MSG.COMMAND)-->  content script          one request, one response
 * Panel  <--(MSG.REPORT)--   content script          many, while the command runs
 *
 * Progress cannot ride on the command's response, because the response only
 * arrives once the command is finished - and these commands are exactly the
 * kind you want to watch. So progress goes back as separate runtime messages
 * tagged with the run id the panel handed out.
 */

export const MSG = {
  /** panel -> content: run a feature action. */
  COMMAND: 'aemt:command',
  /** content -> panel: one line of progress for a run. */
  REPORT: 'aemt:report',
  /** panel -> content: are you there? */
  PING: 'aemt:ping',
  /** panel -> content: who is signed in to this instance? */
  SESSION: 'aemt:session'
};

/** Report severities. The panel styles each one differently. */
export const LEVEL = {
  INFO: 'info',
  OK: 'ok',
  SKIP: 'skip',
  WARN: 'warn',
  FAIL: 'fail',
  /** Carries a structured payload rather than a string - e.g. an analysis. */
  DATA: 'data'
};

/**
 * The review's "remove them anyway" box was ticked for at least as many
 * components as this run would remove. The panel sends the count it showed as
 * `removalsAck`, so a page that changed between the review and the click -
 * more to remove than was confirmed - is refused rather than trusted.
 */
export function removalsConfirmed(summary, params) {
  return (Number(params?.removalsAck?.nodes) || 0) >= (summary?.counts?.nodesDeleted || 0);
}

/**
 * The review's "update them" box was ticked for every page property this run
 * would change on a page that already exists. The panel sends the names it
 * showed as `metadataAck`, so a property that was not on that list - the page
 * changed between the review and the click - is refused rather than written.
 */
export function metadataConfirmed(summary, params) {
  const got = new Set(Array.isArray(params?.metadataAck?.props) ? params.metadataAck.props : []);
  return (summary?.metadata?.props || []).every((p) => got.has(p));
}

/** Why a run with unconfirmed page property changes is refused - the same words from every feature. */
export function metadataRefusal(summary) {
  const { props } = summary.metadata;
  return (
    `Refusing to write. ${props.length} page propert${props.length === 1 ? 'y' : 'ies'} of ${summary.dest}, ` +
    `which already exists, would change (${props.join(', ')}) and that was not confirmed. ` +
    'Analyze again and tick the box to go ahead.'
  );
}

/** Default settings. Overridden per-install from chrome.storage.sync. */
export const DEFAULT_SETTINGS = {
  origins: [],
  marketingTemplate: '/conf/consumer/settings/wcm/templates/page-marketing',
  rootDepth: 3,
  verifyShallow: true,
  checkTemplateAvailability: true,

  /* Features that are hidden until turned on in settings. */
  featureVersions: false,
  /* page-versions: a restore saves the current content as a version first - off unless ticked. */
  versionsSaveBeforeRestore: false,

  /* page-copy. Inserted under the site root to form the backup path:
   * /content/samsung/levant/x -> /content/samsung/levant/india/backup/x */
  backupFolder: 'india/backup',

  /* page-upsert. Removals are NOT here: they are a per-run tick box, because
   * "remove what the source no longer has" should be a decision someone makes
   * while looking at that page, not a preference set once and forgotten. */
  upsertHosts: '',
  upsertCopyAssets: true,
  upsertOverwriteAssets: false,
  upsertReorder: true,
  /* Off: a sync writes only the differences, and saving a version first is a
   * choice made in settings rather than something every run does. */
  upsertVersionFirst: false,
  upsertStripReplication: true,
  upsertRewriteShop: false,
  upsertKeepAtDest: 'hreflangGroup',
  /* Source sites whose images and links other sites may keep pointing at. A
   * page copied from one of them offers, on the review, to keep its image
   * paths and its links as they are instead of copying and re-pointing them. */
  upsertSharedSites: 'global',

  /* page-transfer. Page metadata is preserved by default and does not need
   * listing here; this is for anything else this locale owns. */
  transferCopyAssets: true,
  transferOverwriteAssets: false,
  transferPreserve: '',

  /* Which of the one-time updates below have been applied to stored settings. */
  settingsVersion: 2
};

/**
 * One-time updates to settings already stored. A changed default only reaches
 * people who never saved settings; anyone who did has the old value stored,
 * and it would win for ever. Each step runs once, then the version moves on.
 */
const MIGRATIONS = {
  // 2: Sync page no longer versions by default - turned off once for everyone.
  2: (s) => ({ ...s, upsertVersionFirst: false })
};

export const STORAGE_KEY = 'aemt.settings';

export async function loadSettings() {
  const stored = (await chrome.storage.sync.get(STORAGE_KEY))[STORAGE_KEY];
  if (!stored) return { ...DEFAULT_SETTINGS };

  let s = { ...stored };
  const from = s.settingsVersion || 1;
  for (let v = from + 1; v <= DEFAULT_SETTINGS.settingsVersion; v++) {
    if (MIGRATIONS[v]) s = MIGRATIONS[v](s);
  }
  if (from < DEFAULT_SETTINGS.settingsVersion) {
    s.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
    await chrome.storage.sync.set({ [STORAGE_KEY]: s });
  }
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}
