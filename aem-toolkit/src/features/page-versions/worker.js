/**
 * page-versions: list a page's versions, restore one, or create one with a
 * message of your own.
 *
 * The versions are read from the repository itself - the page's version
 * history under /jcr:system/jcr:versionStorage - not from the Timeline or any
 * other UI. A customised author UI can hide versions that exist; the version
 * store cannot.
 *
 * How the history is found. A page's versions belong to its jcr:content, which
 * is mix:versionable and so carries a jcr:uuid. Oak files the history under a
 * path made from that uuid:
 *
 *   jcr:uuid  1a2b3c4d-...          history  /jcr:system/jcr:versionStorage/1a/2b/3c/1a2b3c4d-...
 *
 * If it is not there, QueryBuilder is asked for the nt:versionHistory whose
 * jcr:versionableUuid is that uuid - so a repository that files histories
 * differently is still found, rather than reported as having no versions.
 *
 * Restoring writes, so it is checked like every other write here: the version
 * picked is re-read from the history first, the current content is saved as a
 * version before it is replaced (unless the operator unticked that), and the
 * page is read back afterwards to confirm it now holds the version's content.
 */

import { abort } from '../../core/aem-client.js';
import { norm } from '../../core/paths.js';
import { SYSTEM_PROPS } from '../../core/rewrite.js';

const STORAGE = '/jcr:system/jcr:versionStorage';

/** Where a version comment may be kept on the frozen node, first match wins. */
const COMMENT_PROPS = ['cq:versionComment', 'jcr:versionComment', 'comment'];

/* --------------------------------------------------------------- reading */

async function readPage(client, path) {
  const page = norm(path);
  if (!/^\/content\//.test(page)) throw abort(`The page must be under /content: ${page}`);

  const info = await client.inspect(page);
  client.assertReadable(info, 'page');
  if (!info.exists) throw abort(`Page does not exist: ${page}`);
  if (!info.isPage) throw abort(`Not a cq:Page (it is ${info.primaryType}): ${page}`);

  const content = await client.readProps(`${page}/jcr:content`);
  if (!content) throw abort(`The page has no jcr:content: ${page}`);
  return { page, title: info.title, content };
}

/**
 * Restore and create change a page, so they run only on a backup page - one
 * under the backup folder (india/backup by default). Listing reads only and
 * works on any page.
 */
function assertBackupPage(page, settings) {
  const folder = String(settings?.backupFolder || 'india/backup').replace(/^\/+|\/+$/g, '');
  if (!norm(page).includes(`/${folder}/`)) {
    throw abort(`Versions can only be restored or created on a backup page - one under /${folder}/. ${norm(page)} is not. Nothing has been changed.`);
  }
}

/** The version history node of a jcr:content, or null if it has none. */
async function findHistory(client, uuid) {
  const direct = `${STORAGE}/${uuid.slice(0, 2)}/${uuid.slice(2, 4)}/${uuid.slice(4, 6)}/${uuid}`;
  const { status, json } = await client.readJson(direct, 2);
  if (status === 403) {
    throw abort(
      'Cannot read the version storage (403). Your account may not read /jcr:system - ' +
        'ask an administrator for read access to the page versions.'
    );
  }
  if (status === 200) return { path: direct, node: json };

  // Not where Oak usually files it: ask the repository instead of assuming none.
  const q = new URLSearchParams({
    path: STORAGE,
    type: 'nt:versionHistory',
    property: 'jcr:versionableUuid',
    'property.value': uuid,
    'p.limit': '1',
    'p.hits': 'selective',
    'p.properties': 'jcr:path'
  });
  const found = await client.getJson(`/bin/querybuilder.json?${q}`, 'the version history (QueryBuilder)');
  const path = found?.hits?.[0]?.['jcr:path'];
  if (!path) return null;

  const again = await client.readJson(path, 2);
  if (again.status === 403) throw abort(`Cannot read the version history at ${path} (403).`);
  return again.status === 200 ? { path, node: again.json } : null;
}

/** How a version is named in messages: the plain number, and the real name. */
const ref = (v) => `version ${v.number} (AEM ${v.name})`;

const isVersion = (v) => v && typeof v === 'object' && v['jcr:primaryType'] === 'nt:version';
const when = (s) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
};

/** Every version of the page, newest first, with its labels and what it holds. */
export async function listVersions(client, path) {
  const { page, title, content } = await readPage(client, path);

  const uuid = content['jcr:uuid'];
  const mixins = [].concat(content['jcr:mixinTypes'] || []);
  if (!uuid || !mixins.includes('mix:versionable')) {
    return { page, title, versions: [], current: null, historyPath: null, neverVersioned: true };
  }

  const history = await findHistory(client, uuid);
  if (!history) {
    return { page, title, versions: [], current: null, historyPath: null, neverVersioned: true };
  }

  // Labels are a node of reference properties: label name -> version uuid.
  const labelsById = new Map();
  const labelNode = history.node['jcr:versionLabels'] || {};
  for (const [label, id] of Object.entries(labelNode)) {
    if (label.startsWith('jcr:')) continue;
    if (!labelsById.has(id)) labelsById.set(id, []);
    labelsById.get(id).push(label);
  }

  const base = content['jcr:baseVersion'] || null;
  const versions = [];
  for (const [name, v] of Object.entries(history.node)) {
    // The root version is the empty starting point every history has.
    if (name === 'jcr:rootVersion' || !isVersion(v)) continue;
    const frozen = v['jcr:frozenNode'] || {};
    versions.push({
      name,
      id: v['jcr:uuid'],
      created: v['jcr:created'] || null,
      labels: labelsById.get(v['jcr:uuid']) || [],
      title: frozen['jcr:title'] || null,
      comment: COMMENT_PROPS.map((p) => frozen[p]).find(Boolean) || null,
      lastModified: frozen['cq:lastModified'] || null,
      lastModifiedBy: frozen['cq:lastModifiedBy'] || null,
      current: !!base && v['jcr:uuid'] === base
    });
  }
  versions.sort((a, b) => when(b.created) - when(a.created) || b.name.localeCompare(a.name, 'en', { numeric: true }));

  /* The repository's own names branch after every restore - 1.0.1.0, 1.0.0.0.0 -
   * and cannot be renamed. So each version also gets a plain number by age:
   * 1 is the oldest, the highest is the newest. The real name stays alongside,
   * and is what every request uses. */
  versions.forEach((v, i) => {
    v.number = versions.length - i;
  });

  return {
    page,
    title,
    versions,
    current: versions.find((v) => v.current)?.name || null,
    currentNumber: versions.find((v) => v.current)?.number || null,
    historyPath: history.path,
    neverVersioned: false
  };
}

/* ------------------------------------------------------------- restoring */

function assertWrite(r, what) {
  if (!r.success) {
    throw abort(`${what} failed [HTTP ${r.http} / status ${r.effective}]: ${r.message || '(no message returned)'}`);
  }
  return r;
}

/**
 * Properties that say nothing about the content itself: what the repository
 * and AEM maintain on their own, plus what a frozen copy carries about its
 * original. A restore is an edit, so AEM moves cq:lastModified to "now" -
 * comparing it would call every real restore a failure.
 */
const NOT_CONTENT = new Set([
  ...SYSTEM_PROPS,
  'jcr:frozenMixinTypes',
  'jcr:frozenPrimaryType',
  'jcr:frozenUuid',
  'cq:lastRolledout',
  'cq:lastRolledoutBy',
  /* Where the page lived when the version was saved. AEM writes these into the
   * version only, so a deleted page can be put back in its place - the live
   * page never has them. */
  'cq:siblingOrder',
  'cq:parentPath',
  'cq:name',
  'cq:childrenOrder'
]);

/* The two jcr: properties that ARE content. Every other jcr: property is kept
 * by the repository itself, and so are AEM's version and "last done" records -
 * cq:versionComment is the comment of whichever version was saved last, and
 * cq:lastModified, cq:lastPublished and the like move on their own. */
const JCR_CONTENT = new Set(['jcr:title', 'jcr:description']);
const bookkeeping = (k) =>
  NOT_CONTENT.has(k) ||
  (k.startsWith('jcr:') && !JCR_CONTENT.has(k)) ||
  k.startsWith('cq:version') ||
  k.startsWith('cq:last');

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** rel -> { prop: value } for a content subtree; '' is jcr:content itself. */
function flatten(node, rel = '', out = {}) {
  const props = {};
  for (const [k, v] of Object.entries(node)) {
    if (isObj(v)) flatten(v, `${rel}/${k}`, out);
    else if (!bookkeeping(k)) props[k] = JSON.stringify(v);
  }
  out[rel] = props;
  return out;
}

/**
 * Every place the page differs from the version, split in two.
 *
 * `diffs` is content: any component, and the page's title and description. A
 * difference there means the restore did not land. `notes` is every other
 * property on the page itself - where AEM and customisations keep their own
 * records, which a restore does not have to bring back. Those are reported,
 * never failed on.
 */
function differences(frozen, now) {
  const a = flatten(frozen);
  const b = flatten(now);
  const label = (rel) => rel || '(page properties)';
  const diffs = [];
  const notes = [];
  for (const rel of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(rel in b)) diffs.push({ at: `${label(rel)} - in the version, missing from the page` });
    else if (!(rel in a)) diffs.push({ at: `${label(rel)} - on the page, not in the version` });
    else {
      for (const p of new Set([...Object.keys(a[rel]), ...Object.keys(b[rel])])) {
        if (a[rel][p] === b[rel][p]) continue;
        const d = { at: `${label(rel)} / ${p}`, version: a[rel][p], page: b[rel][p] };
        (rel === '' && !JCR_CONTENT.has(p) ? notes : diffs).push(d);
      }
    }
  }
  return { diffs, notes };
}

/**
 * Does the page now hold the version's content? Its whole jcr:content is
 * compared with the version's frozen copy, component by component and
 * property by property. Anything too big to read whole is reported as
 * unconfirmed rather than guessed at.
 */
async function confirmRestored(client, page, history, v) {
  let frozen;
  let now;
  try {
    frozen = await client.readTree(`${history}/${v.name}/jcr:frozenNode`);
    now = await client.readTree(`${page}/jcr:content`);
  } catch (e) {
    return { state: 'unknown', why: e.message, diffs: [], notes: [] };
  }
  if (!frozen || !now) {
    return { state: 'unknown', why: 'the version or the page could not be read', diffs: [], notes: [] };
  }
  const { diffs, notes } = differences(frozen, now);
  return { state: diffs.length ? 'mismatch' : 'confirmed', diffs, notes };
}

/* --------------------------------------------------------------- actions */

export const actions = {
  /** Reads only: every version of the page. */
  async list({ client, report, params }) {
    client.resetCaches();
    const r = await listVersions(client, params.page);
    report('data', 'analysis', r);

    if (r.neverVersioned) {
      report('info', `${r.page} has no saved versions.`);
    } else {
      report('info', `${r.versions.length} version(s) found in ${r.historyPath}. Nothing has been written.`);
    }
    return r;
  },

  /**
   * Writes. The version is looked up again rather than trusted from the
   * panel: it must belong to this page, and must still exist.
   */
  async restore({ client, report, params, settings }) {
    assertBackupPage(params.page, settings);
    client.resetCaches();
    const step = (id, state, note) => report('data', 'step', { id, state, note });

    const r = await listVersions(client, params.page);
    const v = r.versions.find((x) => x.id === params.versionId);
    if (!v) {
      throw abort(
        'That version is not in this page’s history any more. Show the versions again and pick one.'
      );
    }

    /* ---- the content about to be replaced is kept first ------------------- */
    // From settings (off by default); a saveCurrent param, when given, wins.
    const saveCurrent =
      params.saveCurrent === undefined ? settings?.versionsSaveBeforeRestore === true : params.saveCurrent === true || params.saveCurrent === 'true';
    step('save', 'running');
    if (saveCurrent) {
      try {
        assertWrite(
          await client.versionPage({
            path: r.page,
            label: `pre-restore ${new Date().toISOString()}`,
            comment: `before restoring AEM version ${v.name}`
          }),
          'Saving the current content as a version'
        );
      } catch (e) {
        step('save', 'failed');
        throw abort(`${e.message.replace(/\.$/, '')}. Nothing has been restored.`);
      }
      report('ok', `saved the current content as a version`);
      step('save', 'done');
    } else {
      report('skip', 'current content not saved first - turned off in settings');
      step('save', 'done', 'skipped');
    }

    /* ---- the restore ------------------------------------------------------ */
    step('restore', 'running');
    try {
      assertWrite(await client.restoreVersion({ path: r.page, id: v.id }), `Restoring ${ref(v)}`);
    } catch (e) {
      step('restore', 'failed');
      throw e;
    }
    report('ok', `restored ${ref(v)}`);
    step('restore', 'done');

    /* ---- and proof that it landed ----------------------------------------- */
    step('check', 'running');
    const check = await confirmRestored(client, r.page, r.historyPath, v);

    // With both values, so a difference can be judged, not just counted.
    const show = (x) => (x === undefined ? '(not set)' : x.length > 120 ? `${x.slice(0, 119)}\u2026` : x);
    const line = (tag, d) =>
      d.version === undefined && d.page === undefined
        ? `${tag}  ${d.at}`
        : `${tag}  ${d.at}\n    version: ${show(d.version)}\n    page:    ${show(d.page)}`;

    // Page properties AEM keeps for itself: shown, never a failure.
    for (const d of check.notes.slice(0, 50)) report('info', line('note', d));
    if (check.notes.length) {
      report('info', `${check.notes.length} page propert${check.notes.length === 1 ? 'y differs' : 'ies differ'} ` +
        'from the version. These are AEM\u2019s own records, not the page content.');
    }

    if (check.state === 'mismatch') {
      step('check', 'failed');
      // Every difference goes to the activity log; the message names the first.
      for (const d of check.diffs.slice(0, 50)) report('warn', line('differs', d));
      if (check.diffs.length > 50) report('warn', `...and ${check.diffs.length - 50} more`);
      throw abort(
        `AEM said ${ref(v)} was restored, but the page does not hold that version\u2019s ` +
          `content: ${check.diffs.length} difference${check.diffs.length === 1 ? '' : 's'}, ` +
          `starting with ${check.diffs[0].at}. The full list is under Activity. Check the page ` +
          'before editing it.'
      );
    }
    if (check.state === 'unknown') {
      report('warn', `Could not compare the page with ${ref(v)} (${check.why}) - check ${r.page}.`);
      step('check', 'done', 'unconfirmed');
    } else {
      report('ok', `checked: the page content now matches ${ref(v)}`);
      step('check', 'done');
    }
    const outcome = check.state;

    report('ok', `Done. ${r.page}`);
    return {
      done: true,
      page: r.page,
      dest: r.page,
      restored: v.name,
      restoredNumber: v.number,
      confirmed: outcome === 'confirmed',
      title: 'Version restored',
      editorUrl: `/editor.html${r.page}.html`
    };
  },

  /**
   * Writes. Saves the page's current content as a new version, with the
   * operator's own message as its comment - checked like every version the
   * extension makes, by the page's jcr:baseVersion moving to it.
   */
  async create({ client, report, params, settings }) {
    assertBackupPage(params.page, settings);
    client.resetCaches();
    const step = (id, state, note) => report('data', 'step', { id, state, note });

    const message = String(params.message || '').trim();
    if (!message) throw abort('Write a message for the new version first.');
    if (message.length > 500) throw abort('The message is longer than 500 characters. Shorten it.');

    const { page } = await readPage(client, params.page);

    step('create', 'running');
    let saved;
    try {
      saved = assertWrite(
        await client.versionPage({ path: page, label: null, comment: message }),
        'Creating the version'
      );
    } catch (e) {
      step('create', 'failed');
      throw e;
    }
    step('create', 'done');

    // Read it back from the history, so the version reported is the one stored.
    step('check', 'running');
    const after = await listVersions(client, page);
    const made = after.versions.find((v) => v.id === saved.version);
    if (!made) {
      step('check', 'failed');
      throw abort('AEM moved the page to a new version, but it is not in the page\u2019s version history.');
    }
    report('ok', `created ${ref(made)}: "${message}"`);
    step('check', 'done', `version ${made.number}`);

    return {
      done: true,
      page,
      dest: page,
      created: made.name,
      createdNumber: made.number,
      title: `Version ${made.number} created`,
      editorUrl: `/editor.html${page}.html`
    };
  }
};
