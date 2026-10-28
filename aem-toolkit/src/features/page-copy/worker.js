/**
 * page-copy: copy one page, creating the missing pages on the way to it.
 *
 * Runs inside the content script. Every AEM call goes through the AemClient it
 * is handed; every line of output goes through `report`, so the same code backs
 * the side panel and would back a CLI or a test harness unchanged.
 *
 * The destination is not typed: it is the source path with the configured
 * backup folder inserted under the site root. The one exception is a global
 * page, which has no backup folder of its own - its destination is built from
 * the target site typed (or typed in full under Edit path), and must sit
 * inside that site's backup folder. If the backup page is already
 * there, the run becomes an update - the Sync page diff is applied to it, so
 * only what changed at the source is written. A backup is not versioned: it is
 * itself the copy, and a version of it would only be a copy of a copy.
 *
 * Deliberately NOT here: any attempt to predict AEM's template policy. If a
 * template is not allowed at a path, createPage says so and we report that.
 * Reimplementing cq:allowedTemplates in JS only adds a second opinion that can
 * be wrong.
 */

import { abort } from '../../core/aem-client.js';
import { removalsConfirmed } from '../../core/protocol.js';
import {
  align,
  backupPathFor,
  globalBackupPathFor,
  humanize,
  isGlobalPage,
  nameOf,
  norm,
  parentOf,
  segs,
  typedBackupPath
} from '../../core/paths.js';
import {
  buildPlan as buildSyncPlan,
  execute as executeSync,
  summarise as summariseSync
} from '../page-upsert/worker.js';

/* -------------------------------------------------------------- planning */

/** Anything to write? No step in the sync plan means the backup already matches. */
const hasChanges = (syncSummary) => syncSummary.sections.some((x) => x.id !== 'version');

/**
 * The one place the destination comes from. Whatever the panel sent is ignored -
 * except for a global page, which has no backup folder of its own: there it is
 * built from the target site typed, or, with Edit path ticked, the destination
 * typed in full is used once it passes the same checks a derived one would.
 */
export function destinationFor(source, settings, params = {}) {
  const { rootDepth, backupFolder } = settings;
  try {
    if (!isGlobalPage(source, rootDepth)) return backupPathFor(norm(source), rootDepth, backupFolder);
    return params.editDest === true || params.editDest === 'true'
      ? typedBackupPath(norm(source), params.dest, rootDepth, backupFolder)
      : globalBackupPathFor(norm(source), params.targetSite, rootDepth, backupFolder);
  } catch (e) {
    throw abort(e.message);
  }
}

async function buildPlan(client, settings, params) {
  const source = norm(params.source);
  // Derived or checked, so it is under /content, below the site root, never the
  // source itself, and ends in the source's own page name - copyPage cannot rename.
  const dest = destinationFor(source, settings, params);

  const srcInfo = await client.inspect(source);
  client.assertReadable(srcInfo, 'source page');
  if (!srcInfo.exists) throw abort(`Source page does not exist: ${source}`);
  if (!srcInfo.isPage) throw abort(`Source is not a cq:Page (it is ${srcInfo.primaryType}): ${source}`);

  const destInfo = await client.inspect(dest);
  client.assertReadable(destInfo, 'destination page');
  if (destInfo.exists && !destInfo.isPage) {
    throw abort(
      `Something that is not a page is already at the destination: ${dest} (${destInfo.primaryType}). ` +
        'Nothing has been written.'
    );
  }

  /* An existing backup is brought up to date rather than refused. Its ancestors
   * necessarily exist, so the whole plan is the sync of the one page - planned
   * by the same code the Sync page tab uses, blockers and all. Nothing is
   * re-pointed, even from a global page into another site's backup folder:
   * the destination is given the source's own site token, so it is a pure
   * content sync.
   *
   * Never versioned, whatever the Sync page setting says - see the header.
   * Images are not checked: the backup shares the source's DAM, so every one
   * is already there. */
  const sync = destInfo.exists
    ? await buildSyncPlan(
        client,
        { ...settings, upsertVersionFirst: false },
        { source, dest, destSite: segs(source)[settings.rootDepth - 1], allowDeletes: true, skipAssets: true }
      )
    : null;

  const { commonSuffix, steps } = align(source, dest, settings.rootDepth);
  const actions = [];

  for (const st of steps) {
    if (st.isLeaf && sync) {
      actions.push({
        kind: 'update',
        destPath: st.destPath,
        sourcePath: source,
        template: destInfo.template,
        title: destInfo.title || humanize(st.name),
        note: 'only what changed at the source'
      });
      continue;
    }

    if (st.isLeaf) {
      actions.push({
        kind: 'copy',
        destPath: st.destPath,
        sourcePath: source,
        template: srcInfo.template,
        title: srcInfo.title || humanize(st.name),
        note: 'full content, no child pages'
      });
      continue;
    }

    const info = await client.inspect(st.destPath);
    client.assertReadable(info, 'destination ancestor');

    if (info.exists) {
      // Site-root segments are expected to exist and are often folders
      // (/content itself is usually sling:OrderedFolder). Not worth reporting.
      if (st.withinRoot) {
        actions.push({ kind: 'skip-root', destPath: st.destPath });
      } else if (info.isPage) {
        actions.push({ kind: 'skip', destPath: st.destPath, template: info.template, note: 'already exists' });
      } else {
        actions.push({
          kind: 'skip-nonpage',
          destPath: st.destPath,
          primaryType: info.primaryType,
          note: `exists as ${info.primaryType}`
        });
      }
      continue;
    }

    if (st.withinRoot) {
      throw abort(
        `Site root segment does not exist: ${st.destPath}. Refusing to create pages above ` +
          `depth ${settings.rootDepth}. Check the destination path.`
      );
    }

    // Name alignment nominates the counterpart; the repository confirms it.
    let counterpart = null;
    if (st.sourceCandidate) {
      const ci = await client.inspect(st.sourceCandidate);
      if (ci.exists && ci.isPage && ci.template) counterpart = ci;
    }

    actions.push({
      kind: 'create',
      destPath: st.destPath,
      template: counterpart ? counterpart.template : settings.marketingTemplate,
      title: counterpart ? counterpart.title || humanize(st.name) : humanize(st.name),
      from: counterpart ? counterpart.path : null,
      note: counterpart ? `template from ${counterpart.path}` : 'not in source, marketing template'
    });
  }

  return { source, dest, mode: sync ? 'update' : 'create', commonSuffix, actions, sync };
}

/**
 * The analysis the operator reads before deciding. Grouped by what actually
 * happens to each page, and explicit about content: the whole point of the
 * feature is that intermediates are empty and only the requested page carries
 * content, so the summary says so per row rather than leaving it implied.
 */
function summarise(plan) {
  const create = [];
  const skip = [];
  let copy = null;
  let update = null;

  // A backup is meant to match its source exactly, page properties and all: nothing to confirm there.
  const sync = plan.sync ? { ...summariseSync(plan.sync), metadata: null } : null;
  // An existing backup with nothing to change: the run would write nothing.
  const upToDate = plan.mode === 'update' && !hasChanges(sync);

  for (const a of plan.actions) {
    if (a.kind === 'skip-root') continue;

    if (a.kind === 'create') {
      create.push({
        path: a.destPath,
        title: a.title,
        template: a.template,
        templateFrom: a.from,
        content: 'empty',
        why: a.from
          ? `exists in the source at ${a.from}, so it reuses that page's template`
          : 'no counterpart in the source, so it uses the marketing template'
      });
    } else if (a.kind === 'copy') {
      copy = {
        path: a.destPath,
        sourcePath: a.sourcePath,
        title: a.title,
        template: a.template,
        content: 'full',
        why: 'the requested page - copied with all of its content, without its child pages'
      };
    } else if (a.kind === 'update') {
      update = {
        path: a.destPath,
        sourcePath: a.sourcePath,
        title: a.title,
        template: a.template,
        content: upToDate ? 'current' : 'updated',
        why: upToDate
          ? 'the backup already matches the source - nothing to write'
          : 'the backup already exists - only what differs from the source is written'
      };
    } else {
      skip.push({
        path: a.destPath,
        template: a.template || null,
        primaryType: a.primaryType || 'cq:Page',
        content: 'untouched',
        why: a.kind === 'skip-nonpage'
          ? `already exists as ${a.primaryType} - left exactly as it is`
          : 'already exists - left exactly as it is'
      });
    }
  }

  return {
    mode: plan.mode,
    // Picks the commit wording in meta.flow.variants.
    variant: upToDate ? 'current' : plan.mode === 'update' ? 'update' : null,
    upToDate,
    source: plan.source,
    dest: plan.dest,
    create,
    skip,
    copy,
    update,
    sync,
    counts: {
      create: create.length,
      skip: skip.length,
      root: plan.actions.filter((a) => a.kind === 'skip-root').length
    }
  };
}

/* ------------------------------------------------------------- execution */

async function createShell(client, report, a) {
  const r = await client.createPage({
    parentPath: parentOf(a.destPath),
    label: nameOf(a.destPath),
    title: a.title,
    template: a.template
  });

  if (!r.success) {
    throw abort(
      `createPage failed for ${a.destPath} [HTTP ${r.http} / status ${r.effective}]: ` +
        `${r.message || '(no message returned)'}. Template: ${a.template}`
    );
  }

  // AEM sanitises and uniquifies node names, and if it did either then every
  // deeper path in the plan is now wrong. But the reported Path is not a
  // dependable witness (see copyLeaf), so a mismatch only prompts a question -
  // the repository answers it.
  if (r.resultPath && norm(r.resultPath) !== norm(a.destPath)) {
    const check = await client.inspect(a.destPath);
    client.assertReadable(check, 'created page');
    if (!check.exists || !check.isPage) {
      throw abort(
        `AEM reported the page at ${r.resultPath} and nothing exists at ${a.destPath}. Aborting so ` +
          'the remaining steps do not target the wrong path.'
      );
    }
  }

  report('ok', `created  ${a.destPath}  [${a.template}]`);
  return r;
}

async function copyLeaf(client, report, a) {
  const r = await client.copyPage({ srcPath: a.sourcePath, destPath: a.destPath });

  if (!r.success) {
    throw abort(
      `copyPage failed: ${a.sourcePath} -> ${a.destPath} [HTTP ${r.http} / status ${r.effective}]: ` +
        `${r.message || '(no message returned)'}`
    );
  }

  // The Path in the response is NOT reliably the destination: on 6.5 the copy
  // command reports the resource it acted on - the source - so a plain
  // "expected != reported" test fires on every successful copy.
  //
  // It is only meaningful in one shape: a SIBLING of the intended destination,
  // which is what AEM produces when it renames around a collision
  // (.../learn -> .../learn1). Anything else is just AEM naming the source, and
  // the destination read in verifyResult is what actually proves the copy
  // landed.
  if (
    r.resultPath &&
    norm(r.resultPath) !== norm(a.destPath) &&
    parentOf(norm(r.resultPath)) === parentOf(norm(a.destPath))
  ) {
    throw abort(
      `The copy was renamed to ${r.resultPath} instead of ${a.destPath}, which means something ` +
        'already exists at the destination. That stray page is still there - remove it before retrying.'
    );
  }

  report('ok', `copied  ${a.sourcePath}  ->  ${a.destPath}`);
  return r;
}

async function verifyResult(client, settings, report, a) {
  const info = await client.inspect(a.destPath);
  client.assertReadable(info, 'copied page');

  if (!info.exists) {
    throw abort(`Post-copy check: ${a.destPath} does not exist. The copy reported success but wrote nothing.`);
  }
  if (!info.isPage) {
    throw abort(`Post-copy check: ${a.destPath} is ${info.primaryType}, not a cq:Page.`);
  }

  if (settings.verifyShallow && info.childPages.length) {
    report('warn', `shallow=true did not hold - ${info.childPages.length} child page(s) came across too:`);
    for (const c of info.childPages) report('warn', `    ${a.destPath}/${c}`);
  }

  return info;
}

async function execute(client, settings, report, plan) {
  const created = [];
  // The panel draws these against the tree it is already showing, so progress
  // lands on the node it belongs to instead of scrolling past in a log.
  const step = (path, state) => report('data', 'step', { path, state });

  let current = null;
  try {
    for (const a of plan.actions) {
      if (a.kind === 'skip-root') continue;
      current = a.destPath;
      step(a.destPath, 'running');

      if (a.kind === 'skip') {
        report('skip', `exists  ${a.destPath}`);
      } else if (a.kind === 'skip-nonpage') {
        report('warn', `exists as ${a.primaryType}, left alone: ${a.destPath}`);
      } else if (a.kind === 'create') {
        await createShell(client, report, a);
        created.push(a.destPath);
      } else if (a.kind === 'copy') {
        await copyLeaf(client, report, a);
        await verifyResult(client, settings, report, a);
      } else if (a.kind === 'update') {
        if (hasChanges(summariseSync(plan.sync))) {
          // Emits its own per-section steps, drawn on the sync plan below the tree.
          await executeSync(client, report, plan.sync);
          report('ok', `updated  ${a.destPath}`);
        } else {
          report('skip', `already up to date  ${a.destPath}`);
        }
      }

      step(a.destPath, 'done');
    }
    current = null;
  } catch (e) {
    if (current) step(current, 'failed');
    if (created.length) {
      report('warn', 'These intermediate pages were created before the failure and are still in place:');
      for (const c of created) report('warn', `    ${c}`);
      report('warn', 'This extension never deletes. Remove them from the Sites console if unwanted.');
    }
    throw e;
  }
  return { created, dest: plan.dest };
}

/* ------------------------------------- a backup before another tool writes */

/**
 * The backup of a page another tool is about to write - Sync page, From
 * another server - as { page, backup, state, differences, reason }. Reads only.
 *
 *   missing      no backup at the page's backup path
 *   differs      there is one, and it is not identical to the page: the same
 *                comparison an update by this tool makes, so the system
 *                properties every copy changes (cq:lastModified, jcr:uuid, the
 *                replication dates) never count
 *   same         identical - nothing to do
 *   unavailable  no backup can be taken: a global page, a page that is itself
 *                inside the backup folder; `reason` says which
 *
 * `differences` counts what an update would change: properties and components.
 */
export async function backupState(client, settings, page) {
  let backup;
  try {
    if (isGlobalPage(page, settings.rootDepth)) throw new Error('A global page has no backup folder of its own.');
    backup = backupPathFor(norm(page), settings.rootDepth, settings.backupFolder);
  } catch (e) {
    return { page, backup: null, state: 'unavailable', differences: null, reason: e.message };
  }
  const plan = await buildPlan(client, settings, { source: page });
  if (plan.mode === 'create') return { page, backup, state: 'missing', differences: null, reason: null };
  const s = summariseSync(plan.sync);
  const differences = { properties: s.counts.properties, components: s.counts.nodesAdded + s.counts.nodesDeleted };
  return { page, backup, state: hasChanges(s) ? 'differs' : 'same', differences, reason: s.blockers[0] ?? null };
}

/**
 * Take or update that backup, exactly as this tool's own run does - planned
 * again, never trusted from the review. Anything that would stop this tool
 * stops this too, with the reason: the caller then writes nothing. Removals
 * from the backup are what makes it match the page, and asking for the backup
 * is the confirmation.
 */
export async function takeBackup(client, settings, report, page) {
  const plan = await buildPlan(client, settings, { source: page });
  const s = plan.sync ? summariseSync(plan.sync) : null;
  if (s?.blockers.length) throw abort(`The backup cannot be updated: ${s.blockers[0]}`);
  if (s && !hasChanges(s)) {
    report('skip', `backup already matches  ${plan.dest}`);
    return { dest: plan.dest, created: [] };
  }
  // Its progress steps name the caller's sections too ("props", "nodes"): kept off the caller's plan.
  const quiet = (level, ...rest) => (level === 'data' ? undefined : report(level, ...rest));
  const result = await execute(client, settings, quiet, plan);
  report('ok', `${plan.mode === 'create' ? 'backup taken' : 'backup updated'}  ${plan.dest}`);
  return result;
}

/* --------------------------------------------------------------- actions */

export const actions = {
  /** Reads only. Produces the breakdown the operator approves or rejects. */
  async analyze({ client, settings, report, params }) {
    client.resetCaches();
    const s = summarise(await buildPlan(client, settings, params));
    report('data', 'analysis', s);

    if (s.mode === 'update') {
      report('info', `The backup already exists at ${s.dest}.`);
      if (s.sync.truncationRisk) {
        report('warn', 'The source page may have been truncated by AEM. Removals are disabled for this run.');
      }
      if (s.sync.blockers.length) {
        for (const b of s.sync.blockers) report('fail', b);
        report('info', 'Nothing has been written, and this update cannot proceed.');
      } else if (s.sync.largeRemoval) {
        report('warn', `${s.sync.largeRemoval} It runs only once you confirm the removal.`);
      } else if (!hasChanges(s.sync)) {
        report('info', 'It already matches the source - there is nothing to update.');
        if (s.sync.truncationRisk) {
          report('warn', 'The source is at AEM\'s JSON limit, so components it has dropped could not be checked.');
        }
      } else {
        report('info', 'Only the differences will be written. Nothing has been written yet.');
      }
    } else {
      report('info', `${s.counts.create} page(s) to create, 1 to copy. Nothing has been written.`);
    }
    return s;
  },

  /**
   * Writes. Deliberately re-runs the full analysis first rather than trusting
   * what the panel is holding: between the analysis and the click, someone else
   * may have created the destination.
   */
  async run({ client, settings, report, params }) {
    client.resetCaches();
    const plan = await buildPlan(client, settings, params);
    const s = summarise(plan);

    if (s.sync?.blockers.length) throw abort(`Refusing to write. ${s.sync.blockers[0]}`);
    if (s.sync?.largeRemoval && !removalsConfirmed(s.sync, params)) {
      throw abort(`Refusing to write. ${s.sync.largeRemoval} Analyze again and confirm the removal to go ahead.`);
    }

    const result = await execute(client, settings, report, plan);
    report('ok', `Done. ${result.dest}`);
    return { ...s, done: true, editorUrl: `/editor.html${result.dest}.html` };
  }
};
