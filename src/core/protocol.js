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

/** A 53-bit string hash (cyrb53), as hex. Not for secrets - for "is this the same list". */
function hash53(str, seed) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** A short hash of any text, for a fingerprint that has to cover content without carrying it. */
export const contentHash = (str) => hash53(String(str), 3);

/**
 * Exactly which removals a review showed: every component path it would
 * remove and every property, sorted, as one short string. The same list
 * gives the same string, whatever order it was found in; one more, one fewer
 * or a different one gives another. Read off the summary - `nodes.deleted`
 * and `props.deleted`, which are what the review lists - so the panel and the
 * run work it out from the same thing.
 *
 * Names alone said yes to a colleague's edit made between the review and the
 * click: the same component, now holding the launch copy, still had the same
 * name. So an entry that carries `content` - a hash of what is in it now -
 * is fingerprinted with it, and an edit in between gives another string.
 *
 * An entry marked `metadata` is a page property the page-properties box
 * answers for (`metadataAck` names it). Left out here, because ticking that
 * box is what puts it in the plan at all: counted, the review (box unticked)
 * and the run (box ticked) never agreed, and both boxes ticked was refused.
 */
export function removalsFingerprint(summary) {
  const withContent = (x) => (x.content ? ` ${x.content}` : '');
  const nodes = (summary?.nodes?.deleted || []).map((n) => `node ${n.node}${withContent(n)}`);
  const props = (summary?.props?.deleted || [])
    .filter((p) => !p.metadata)
    .map((p) => `prop ${p.node} ${p.prop}${withContent(p)}`);
  const all = [...nodes, ...props].sort().join('\n');
  return `${nodes.length}.${props.length}.${hash53(all, 1)}${hash53(all, 2)}`;
}

/**
 * The review's "remove them anyway" box was ticked for exactly the removals
 * this run would make. The panel sends the fingerprint of what it showed as
 * `removalsAck.fingerprint` (the summary carries it as `removalsFingerprint`),
 * so a page that changed between the review and the click - a different
 * component to remove, even with the count the same - is refused rather than
 * trusted. A count alone said yes to that.
 */
export function removalsConfirmed(summary, params) {
  const ack = params?.removalsAck;
  return !!ack && typeof ack.fingerprint === 'string' && ack.fingerprint === removalsFingerprint(summary);
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
/**
 * Properties that describe the page's place in its own locale, not the page.
 *
 * `localContent` says this page is that country's own rather than rolled out
 * from a master; `publishedDateByWorkflow` is when THAT page went live,
 * stamped by the publish workflow. Carrying either across would tell the
 * destination it was published on the source's date, or that it is a copy of
 * something it was never rolled out from. Kept as the destination has them,
 * like the rest of the page metadata, and shown in Settings so the list is
 * not a secret the code keeps.
 */
export const LOCALE_OWNED = ['localContent', 'publishedDateByWorkflow'];

export const DEFAULT_SETTINGS = {
  origins: [],
  /* Appearance: 'system' follows Windows; 'light' or 'dark' always. */
  theme: 'system',
  marketingTemplate: '/conf/consumer/settings/wcm/templates/page-marketing',
  /* copy-deck. Templates whose pages take their text from PIM, read as rendered. */
  pdTemplates: ['/conf/consumer/settings/wcm/templates/page-standard-pd'],
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

  /* page-transfer. Page metadata and the locale-owned properties above are
   * preserved already and do not need listing here; this is for anything
   * else this locale owns. */
  transferCopyAssets: true,
  transferOverwriteAssets: false,
  transferPreserve: '',
  /* The biggest image this will carry between two servers, in megabytes.
   * A bigger one is left where it is: the page still goes across pointing at
   * where it belongs, and the image is listed to do by hand. Low by default,
   * because an upload AEM will not take costs the whole wait before it is
   * given up on - and because a content package is the right tool for a very
   * large asset. */
  transferMaxImageMb: 25,

  /* arabic-fixer. Comma-separated lists of the units (GB, mAh...) and the
   * English feature names it keeps from flipping. Empty is the built-in list
   * in features/arabic-fixer/bidi.js, so it follows any change made there. */
  arabicUnits: '',
  arabicNames: '',

  /* broken-links. The hosts, comma separated, that are this site besides
   * www.samsung.com and the author instances above - a full URL to one of
   * them is a link into this content tree and is checked on author. Images
   * and files are never checked. */
  linkSiteHosts: '',

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
