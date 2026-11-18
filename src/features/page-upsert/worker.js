/**
 * page-upsert: make the destination page match the source.
 *
 * If the destination is not there, it is created with a shallow copyPage and
 * then rewritten. If it is there, only the differences are written. Both routes
 * run through the same diff, so "create" is just "sync against a page that does
 * not exist yet" - which also means the analysis shown before a create is the
 * real diff, not a different code path's guess at one.
 *
 * Scope is one page: <source>/jcr:content and the nodes under it. Child pages
 * are cq:Page nodes, which never appear in that subtree, so nothing below the
 * page can be read, copied or deleted.
 *
 * Deliberately NOT here: any attempt to decide that a 403 means "absent".
 * Several of the checks below are the difference between a link left pointing
 * at the wrong site and content being removed, and every one of them depends on
 * telling "not there" apart from "cannot tell".
 */

import { abort } from '../../core/aem-client.js';
import { backupState, takeBackup } from '../page-copy/worker.js';
import { findOnDelivery, missingReason } from '../../core/dynamic-media.js';
import {
  LOCALE_OWNED,
  contentHash,
  metadataConfirmed,
  metadataRefusal,
  removalsConfirmed,
  removalsFingerprint
} from '../../core/protocol.js';
import { insideBackupFolder, nameOf, norm, parentOf, segs } from '../../core/paths.js';
import { binariesByHand, diff, isAssetRef, largeRemovalOf, metadataFor, relLabel } from '../../core/diff.js';
import {
  assertWrite, executeDiff, lockBlocker, lockOwnerOf, partialRefusal, pool, readPageTree, unconfirmedWarning
} from '../../core/execute.js';
import {
  assetMatcher,
  assetsIn,
  buildRules,
  otherSiteLinks,
  resolveSites,
  rewriteTokens,
  rewriteValue,
  SYSTEM_PROPS
} from '../../core/rewrite.js';
import {
  announceSite, homeOf, markFailed, readHome, reportSiteSet, siteSummary, siteValues, touchesSite
} from '../../core/site-values.js';

/* ---------------------------------------------------------- safety rails */

/**
 * AEM's json.maximumresults defaults to 1000. At or above this, assume the
 * source tree may be short and refuse to delete anything on the strength of it.
 */
const TRUNCATION_GUARD = 900;

const DAM_FOLDER_TYPE = 'sling:OrderedFolder';
const PROBE_CONCURRENCY = 6;

/** Host forms a canonical can take. Settings can extend, not replace. */
const DEFAULT_HOSTS = ['www.samsung.com'];
const DEFAULT_SHOP_HOSTS = ['shop.samsung.com'];

/* -------------------------------------------------------------- planning */

/**
 * `roots` are the DAM folders whose images go across: the source site's own,
 * and any other folder the review ticked (see otherDamIn). Each lands under
 * the destination's DAM folder at the same relative path - where the rewrite
 * rules send the reference that names it.
 */
async function planAssets(client, srcTree, sites, copyAssets, overwrite, roots = [sites.srcDam]) {
  const re = assetMatcher(sites.srcDam);
  const found = new Map();
  for (const root of roots) {
    const m = assetMatcher(root);
    for (const rel of Object.keys(srcTree)) {
      for (const p of Object.keys(srcTree[rel])) {
        for (const a of assetsIn(srcTree[rel][p], m)) if (!found.has(a)) found.set(a, root);
      }
    }
  }

  const assets = await pool([...found.keys()].sort(), PROBE_CONCURRENCY, async (src) => {
    const dest = sites.destDam + src.slice(found.get(src).length);
    const at = await client.probe(src);

    if (at === 'forbidden' || at === 'error') {
      return { src, dest, state: at, action: at === 'forbidden' ? 'unreadable (403)' : 'unreadable' };
    }
    /* Gone from the DAM is not always gone from the page: Dynamic Media can
     * still be serving its copy. That copy is uploaded instead, read from the
     * delivery host - the same upload, so AEM processes it like any other. */
    let via = null;
    let delivery = null;
    if (at === 'no') {
      delivery = await findOnDelivery(src);
      via = delivery.found[0]?.url || null;
      if (!via) return { src, dest, state: 'missing', action: 'missing at source', delivery };
    }
    const from = via ? { via, source: 'Dynamic Media', delivery } : {};
    if (!copyAssets) return { src, dest, state: 'ok', action: 'copying disabled', ...from };

    const there = await client.probe(dest);
    if (there === 'forbidden' || there === 'error') {
      return { src, dest, state: there, action: 'destination unreadable', ...from };
    }
    return {
      src,
      dest,
      state: 'ok',
      action: there === 'yes' ? (overwrite ? 'overwrite' : 'already there') : 'upload',
      ...from
    };
  });

  /* Nothing is held back for naming an image missing at the source: the
   * reference is written, re-pointed like any other. Holding it back kept
   * whatever the destination had - its OLD image beside the new text and
   * links. It is listed under the plan instead, to add by hand. */
  const missing = new Set();
  const unreadable = assets.filter((a) => a.state === 'forbidden' || a.state === 'error');

  // Only folders for assets actually being written.
  const folderSet = new Set();
  for (const a of assets) {
    if (a.action !== 'upload' && a.action !== 'overwrite') continue;
    const parts = a.dest.split('/');
    parts.pop();
    let cur = '';
    for (const s of parts) {
      if (!s) continue;
      cur += `/${s}`;
      if (cur.length >= sites.destDam.length && cur.startsWith(sites.destDam)) folderSet.add(cur);
    }
  }
  const folders = await pool([...folderSet].sort(), PROBE_CONCURRENCY, async (path) => ({
    path,
    exists: (await client.probe(path)) === 'yes'
  }));

  return { assets, folders, missing, unreadable, re };
}

function optionsFrom(settings, params) {
  return {
    copyAssets: settings.upsertCopyAssets !== false,
    overwriteAssets: settings.upsertOverwriteAssets === true,
    addMissingNodes: true,
    /* On unless the operator unticked it: a sync that only ever adds is not a
     * sync, and a destination that keeps components the source has dropped
     * drifts further apart with every run.
     *
     * What protects this is not caution about the intent but the checks on the
     * evidence - the truncation guard, the live re-read before each delete, and
     * the confirmation asked for above MAX_DELETE_RATIO. Those stop a removal that is an
     * artefact of a bad read; they do not second-guess a real one. */
    deleteExtras: params.allowDeletes !== false && params.allowDeletes !== 'false',
    reorder: settings.upsertReorder !== false,
    /* The review asks for a backup destination, where a version is the only
       restore point there can be (a backup of a backup has nowhere to go).
       Anywhere else there is no box, and the setting decides. */
    versionFirst:
      params.versionFirst === undefined
        ? settings.upsertVersionFirst === true
        : params.versionFirst === true || params.versionFirst === 'true',
    stripReplication: settings.upsertStripReplication !== false,
    /* The locale-owned ones hold here too: copying between two locales on
       one server carries the same wrong publish date as copying between two
       servers does. */
    keepAtDest: [
      ...new Set([
        ...LOCALE_OWNED,
        ...String(settings.upsertKeepAtDest || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      ])
    ],
    // More node names to keep, on top of cq:LiveSyncConfig and cq:annotations (KEEP_NODES in core/diff.js).
    keepNodesAtDest: String(settings.upsertKeepNodes || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    hosts: [
      ...new Set([
        ...DEFAULT_HOSTS,
        ...String(settings.upsertHosts || '').split(',').map((s) => s.trim()).filter(Boolean)
      ])
    ],
    shopHosts: DEFAULT_SHOP_HOSTS,
    rewriteShop: settings.upsertRewriteShop === true,
    /* Per run, from the review's tick boxes, and only for a source site on the
     * shared list: keep the source's image paths (nothing copied), keep its links. */
    sharedSites: String(settings.upsertSharedSites ?? 'global')
      .split(',')
      .map((s) => s.trim().replace(/^\/+|\/+$/g, ''))
      .filter(Boolean),
    keepImages: params.keepImages === true || params.keepImages === 'true',
    keepLinks: params.keepLinks === true || params.keepLinks === 'true',
    /* The review's "site values" box, unticked: the handle, title ending and
     * language are not set to the destination site's. Ticked to start with. */
    keepSiteValues: params.keepSiteValues === true || params.keepSiteValues === 'true',
    /* The review's page-properties box, unticked: an existing destination
       keeps every page property it already has, and the rest of the page is
       copied as usual. Ticking it is how they get overwritten. */
    keepPageProps: !params.metadataAck,
    /* Links to other sites are re-pointed at the destination too, ticked to start
     * with; these are the sites unticked on the review, whose links are left as they are. */
    keepSites: (Array.isArray(params.keepSites) ? params.keepSites : String(params.keepSites || '').split(','))
      .map((s) => String(s).trim())
      .filter(Boolean),
    /* Other DAM folders ticked on the review: their images are uploaded to the
     * destination's DAM folder and re-pointed there. Unticked to start with -
     * a folder outside the source site may be shared on purpose. */
    copyDam: (Array.isArray(params.copyDam) ? params.copyDam : String(params.copyDam || '').split(','))
      .map((s) => String(s).trim().replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
  };
}

/**
 * DAM folders, other than the source's and the destination's, that the page
 * takes images from - each with its images and how often each is named.
 *
 * The common case is a site whose page folder and DAM folder are named
 * differently: /content/samsung/ae_ar keeps its images under
 * /content/dam/samsung/ae. Read off the page, one folder per first segment
 * under the brand's DAM root.
 */
function otherDamIn(tree, sites, skip = () => false) {
  const re = assetMatcher(sites.damRoot);
  const inside = (a, root) => a === root || a.startsWith(`${root}/`);
  const found = new Map();
  for (const props of Object.values(tree)) {
    for (const [prop, v] of Object.entries(props)) {
      if (skip(prop, v)) continue;
      for (const a of assetsIn(v, re)) {
        if (inside(a, sites.srcDam) || inside(a, sites.destDam)) continue;
        const folder = a.slice(sites.damRoot.length + 1).split('/')[0];
        /* A path that is the folder itself, or a source or destination written
         * as two segments (in/en) under it: re-pointing /in would rewrite them too. */
        const under = `${sites.damRoot}/${folder}/`;
        if (!folder || a === `${sites.damRoot}/${folder}` || sites.srcDam.startsWith(under) || sites.destDam.startsWith(under)) continue;
        if (!found.has(folder)) found.set(folder, new Map());
        const images = found.get(folder);
        images.set(a, (images.get(a) || 0) + 1);
      }
    }
  }
  return found;
}

/**
 * The sites, other than the source and the destination, this page links to -
 * each with how many properties hold such a link, and the links themselves,
 * most used first. Read off the page: nothing here knows which sites exist.
 */
function otherSitesIn(tree, sites, skip = () => false) {
  const found = new Map();
  for (const props of Object.values(tree)) {
    for (const [prop, v] of Object.entries(props)) {
      if (skip(prop, v)) continue;
      const seen = new Set();
      for (const { site, link } of otherSiteLinks(v, sites)) {
        if (!found.has(site)) found.set(site, { site, properties: 0, links: new Map() });
        const f = found.get(site);
        f.links.set(link, (f.links.get(link) || 0) + 1);
        if (!seen.has(site)) {
          seen.add(site);
          f.properties++;
        }
      }
    }
  }
  return found;
}

/** Is this a site AEM has - a page at /content/<brand>/<site>? Unreadable counts as no: nothing is re-pointed on a guess. */
async function isSiteRoot(client, path) {
  const props = await client.readProps(path).catch(() => null);
  return props?.['jcr:primaryType'] === 'cq:Page';
}

/**
 * How many properties the review's two choices are about: those naming an
 * image under the source site's DAM, and those holding a link to the site.
 * Counted with every rule on, so the number is the same ticked or not.
 */
function choiceCounts(tree, full) {
  let images = 0;
  let links = 0;
  for (const props of Object.values(tree)) {
    for (const v of Object.values(props)) {
      const refs = rewriteTokens(v, full);
      if (refs.some((r) => r.from.startsWith(full.sites.srcDam))) images++;
      if (refs.some((r) => !r.from.startsWith(full.sites.srcDam))) links++;
    }
  }
  return { images, links };
}

export async function buildPlan(client, settings, params) {
  const source = norm(params.source);
  const dest = norm(params.dest);
  const opts = optionsFrom(settings, params);
  /* A version is only worth taking where it can be restored. The Versions
     tool refuses to restore anything outside the backup folder, so a
     pre-write version on an ordinary page is a restore point nothing here
     can use. */
  opts.versionFirst = opts.versionFirst && insideBackupFolder(dest, settings.backupFolder, settings.rootDepth);

  if (!/^\/content\//.test(source)) throw abort(`Source must be under /content: ${source}`);
  if (!/^\/content\//.test(dest)) throw abort(`Destination must be under /content: ${dest}`);
  if (source === dest) throw abort('Source and destination are the same path.');
  if (segs(dest).length <= settings.rootDepth) {
    throw abort(`Destination is at or above the site root (depth ${settings.rootDepth}). Refusing.`);
  }

  const srcInfo = await client.inspect(source);
  client.assertReadable(srcInfo, 'source page');
  if (!srcInfo.exists) throw abort(`Source page does not exist: ${source}`);
  if (!srcInfo.isPage) throw abort(`Source is not a cq:Page (it is ${srcInfo.primaryType}): ${source}`);

  const destState = await client.probe(dest);
  if (destState === 'forbidden') {
    throw abort(
      `Cannot read the destination at ${dest} (403). Something exists there that your account may ` +
        'not read, so there is no safe way to tell whether it needs creating.'
    );
  }
  if (destState === 'error') throw abort(`Could not reach the destination at ${dest}.`);

  const mode = destState === 'yes' ? 'sync' : 'create';

  if (mode === 'create') {
    if (nameOf(source) !== nameOf(dest)) {
      throw abort(
        `Destination page name "${nameOf(dest)}" differs from source page name "${nameOf(source)}". ` +
          'Creating the page uses AEM copy, which cannot rename in place - use the same leaf name.'
      );
    }
    const parent = await client.inspect(parentOf(dest));
    client.assertReadable(parent, 'destination parent');
    if (!parent.exists) {
      throw abort(
        `Destination parent does not exist: ${parentOf(dest)}. Create the path first - the Copy ` +
          'page feature does exactly that.'
      );
    }
  }

  const src = await readPageTree(client, source);
  if (!src) throw abort(`Source page has no jcr:content: ${source}`);
  const srcRels = Object.keys(src.tree);

  // A short source tree makes every node missing from it look deleted.
  const truncationRisk = srcRels.length >= TRUNCATION_GUARD;
  if (truncationRisk) opts.deleteExtras = false;

  const sites = resolveSites({
    source,
    dest,
    rootDepth: settings.rootDepth,
    srcSite: params.srcSite,
    destSite: params.destSite,
    hosts: opts.hosts,
    shopHosts: opts.shopHosts,
    rewriteShop: opts.rewriteShop
  });
  if (sites.overlapping) {
    throw abort(
      `Site tokens overlap ("${sites.srcSite}" and "${sites.destSite}"). One contains the other, ` +
        'so a rewrite rule could match what another rule just produced. Set both tokens explicitly.'
    );
  }
  /* A shared source site - /global - can be pointed at as it is: its images
   * kept rather than copied, its links kept rather than re-pointed. Offered
   * only for a site on the list, and only when there is something to re-point. */
  const offered = sites.enabled && opts.sharedSites.includes(sites.srcSite);
  const keep = { images: offered && opts.keepImages, links: offered && opts.keepLinks };
  const full = buildRules(sites);
  const choice = offered ? { offered, keepImages: keep.images, keepLinks: keep.links, ...choiceCounts(src.tree, full) } : { offered };

  /* A caller whose source and destination share one DAM - a backup on the same
   * site - has no image to copy and no reason to probe each one. Skipping the
   * check also means no property is held back for naming an image that is
   * missing: the value is copied exactly as the source has it. The same goes
   * for images kept at the shared source site: nothing is copied, so nothing is probed. */
  /* Images from other DAM folders - /content/dam/samsung/ae on an /ae_ar page.
   * Offered, never assumed: each folder is a box on the review, unticked, and
   * only a ticked one is uploaded and re-pointed. Not offered where nothing is
   * re-pointed at all, or where the source's images are being kept. */
  const never = new Set([...SYSTEM_PROPS, ...opts.keepAtDest]);
  const damFound = sites.enabled && !params.skipAssets && !keep.images
    ? otherDamIn(src.tree, sites, (prop) => never.has(prop))
    : new Map();
  const copyDam = [...damFound.keys()].filter((f) => opts.copyDam.includes(f));

  const { assets, folders, missing, unreadable, re } = params.skipAssets || keep.images
    ? { assets: [], folders: [], missing: new Set(), unreadable: [], re: assetMatcher(sites.srcDam) }
    : await planAssets(client, src.tree, sites, opts.copyAssets, opts.overwriteAssets, [
        sites.srcDam,
        ...copyDam.map((f) => `${sites.damRoot}/${f}`)
      ]);

  const byPath = new Map(assets.map((a) => [a.src, a]));
  const otherDam = [...damFound]
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .map(([folder, images]) => ({
      folder,
      root: `${sites.damRoot}/${folder}`,
      to: sites.destDam,
      copied: copyDam.includes(folder),
      images: [...images]
        .map(([path, uses]) => ({ path, uses, action: byPath.get(path)?.action || null }))
        .sort((a, b) => a.path.localeCompare(b.path))
    }));

  /* Links to other sites - /uk from a /global page - re-pointed at the destination
   * unless unticked. Only a site the page links to AND that AEM has: its
   * /content/<brand>/<site> must be a page. That is what keeps /semiconductor or
   * any other path www.samsung.com serves beside its sites from being taken for
   * one - asked of the repository, not looked up in a list. A property the run
   * never writes is not counted: a system or kept-at-destination property, or
   * one held back for naming an image missing at the source. */
  const heldBack = (v) => missing.size > 0 && assetsIn(v, re).some((a) => missing.has(a));
  const others = new Map();
  for (const [site, o] of otherSitesIn(src.tree, sites, (prop, v) => never.has(prop) || heldBack(v))) {
    if (await isSiteRoot(client, `${sites.contentRoot}/${site}`)) others.set(site, o);
  }
  const also = [...others.keys()].filter((s) => !opts.keepSites.includes(s));
  const ctx =
    keep.images || keep.links || also.length || copyDam.length
      ? buildRules(sites, { images: !keep.images, links: !keep.links, alsoSites: also, alsoDam: copyDam })
      : full;
  const otherSites = [...others.values()]
    .sort((a, b) => b.properties - a.properties || a.site.localeCompare(b.site))
    .map((o) => ({
      site: o.site,
      properties: o.properties,
      repointed: also.includes(o.site),
      links: [...o.links].map(([link, uses]) => ({ link, uses })).sort((a, b) => b.uses - a.uses || a.link.localeCompare(b.link))
    }));
  // What is kept on purpose is not "still pointing at the source" - it is meant to.
  // An image elsewhere - a Dynamic Media URL for the share image, say - is kept with the images.
  ctx.kept = (ref) =>
    ref.startsWith(sites.srcDam) || isAssetRef(ref) ? keep.images : keep.links && rewriteValue(ref, full) !== ref;

  const destTree = mode === 'sync' ? await readPageTree(client, dest) : null;
  if (mode === 'sync' && !destTree) {
    throw abort(`Destination exists but has no jcr:content: ${dest}. Nothing to sync into.`);
  }

  /* The handle, title ending and language the destination site uses, read off
   * its home page - and the source's, which says what ending to swap. Only
   * between two sites, and only for a page that has any of them. */
  const site =
    sites.enabled && touchesSite(src.tree[''])
      ? siteValues({
          page: src.tree[''],
          src: await readHome(client, homeOf(sites, sites.srcSite)),
          dest: await readHome(client, homeOf(sites, sites.destSite))
        })
      : null;
  opts.siteValues = site?.values || {};

  const d = diff({
    srcTree: src.tree,
    srcOrder: src.order,
    destTree: destTree?.tree || null,
    destOrder: destTree?.order || null,
    ctx,
    opts,
    missingAssets: missing,
    assetRe: re
  });

  /* A page created here is a copy of the source, and copyPage brings the
     source locale's own publish date and localContent flag with it. Taken
     off again in the same write as everything else, and listed with the
     removals so the review says so. */
  if (mode === 'create') {
    for (const prop of LOCALE_OWNED) {
      const was = src.tree['']?.[prop];
      if (was === undefined) continue;
      d.propDeletes.push({ rel: '', prop, was, reason: 'belongs to the source locale', content: contentHash(JSON.stringify(was)) });
    }
  }

  /* Reasons to refuse, gathered rather than thrown, so the analysis can show
   * all of them at once instead of one per attempt. */
  const blockers = [];
  /* A locked destination takes the write, answers 200 and keeps its old
     content, so it has to be found here - at the write it is already too late
     to tell anyone before they press the button. A page about to be created
     has nothing to read, and a lock of your own is not in the way. */
  const lockedBy = await lockOwnerOf(client, dest);
  if (lockedBy) blockers.push(lockBlocker(dest, lockedBy));
  if (unreadable.length) {
    blockers.push(
      `${unreadable.length} asset(s) could not be read (403). A permissions error is not the same ` +
        'as a missing asset, and guessing either way risks leaving links pointing at the source.'
    );
  }

  /* Not a blocker: a page that really has been reworked at the source is a
   * fair thing to sync. But it is also what a wrong pairing or a short read
   * looks like, so the run waits for the operator to confirm it - see
   * `removalsConfirmed` and `largeRemovalOf`. */
  const largeRemoval =
    mode === 'sync'
      ? largeRemovalOf(d, { here: 'at the destination', tail: 'That is more like a different page than a drift.' })
      : null;

  return {
    source, dest, mode, sites, ctx, opts, assets, folders, ...d,
    blockers, largeRemoval, truncationRisk, choice, otherSites, otherDam, site
  };
}

/* -------------------------------------------------------------- analysis */

const previewValue = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s == null ? '' : s.length > 160 ? `${s.slice(0, 159)}…` : s;
};

export function summarise(plan) {
  const assetsToCopy = plan.assets.filter((a) => a.action === 'upload' || a.action === 'overwrite');
  const foldersToCreate = plan.folders.filter((f) => !f.exists);

  const sections = [];
  if (plan.mode === 'create') {
    sections.push({ id: 'page', title: 'Create the page', count: 1, detail: `copy of ${plan.source}` });
  } else if (plan.opts.versionFirst) {
    sections.push({ id: 'version', title: 'Version the destination first', count: 1, detail: 'restore point' });
  }
  if (foldersToCreate.length) {
    sections.push({ id: 'folders', title: 'Create DAM folders', count: foldersToCreate.length });
  }
  if (assetsToCopy.length) {
    sections.push({ id: 'assets', title: 'Upload assets', count: assetsToCopy.length });
  }
  if (plan.nodeAdds.length) {
    sections.push({ id: 'nodes', title: 'Add components', count: plan.nodeAdds.length });
  }
  const propCount = plan.propAdds.length + plan.propUpdates.length + plan.propDeletes.length;
  if (propCount) {
    const nodes = new Set(
      [...plan.propAdds, ...plan.propUpdates, ...plan.propDeletes].map((c) => c.rel)
    ).size;
    sections.push({
      id: 'props',
      title: 'Write properties',
      count: propCount,
      detail: `across ${nodes} node${nodes === 1 ? '' : 's'}`
    });
  }
  if (plan.nodeDeletes.length) {
    sections.push({ id: 'deletes', title: 'Remove components', count: plan.nodeDeletes.length });
  }
  if (plan.reorders.length) {
    sections.push({ id: 'order', title: 'Reorder components', count: plan.reorders.length });
  }
  if (plan.mode === 'create' && plan.opts.stripReplication) {
    sections.push({ id: 'strip', title: 'Clear inherited replication state', count: 1 });
  }

  const s = {
    mode: plan.mode,
    source: plan.source,
    dest: plan.dest,
    rewrite: {
      enabled: plan.sites.enabled,
      srcSite: plan.sites.srcSite,
      destSite: plan.sites.destSite
    },
    sections,
    // The review's two tick boxes: whether they are offered, how they are set, and how much each is about.
    choice: plan.choice || { offered: false },
    // Links to sites that are neither source nor destination, each with its own tick box.
    otherSites: plan.otherSites || [],
    // Images in DAM folders other than the source site's, each folder with its own tick box.
    otherDam: plan.otherDam || [],
    site: siteSummary(plan.site, plan.siteChanges, { applied: !plan.opts.keepSiteValues, preview: previewValue }),
    // An existing page's own properties that would change: the review asks before they are written.
    metadata: metadataFor(plan.mode, plan, previewValue),
    props: {
      added: plan.propAdds.map((c) => ({ node: relLabel(c.rel), prop: c.prop, to: previewValue(c.to), kind: c.kind })),
      updated: plan.propUpdates.map((c) => ({
        node: relLabel(c.rel),
        prop: c.prop,
        from: previewValue(c.from),
        to: previewValue(c.to),
        kind: c.kind
      })),
      deleted: plan.propDeletes.map((c) => ({
        node: relLabel(c.rel),
        prop: c.prop,
        was: previewValue(c.was),
        reason: c.reason,
        content: c.content,
        // The page-properties box answers for this one, not the removals box (see removalsFingerprint).
        ...(plan.mode === 'sync' && c.rel === '' ? { metadata: true } : {})
      }))
    },
    nodes: {
      added: plan.nodeAdds.map((n) => ({ node: n.rel, props: n.props })),
      deleted: plan.nodeDeletes.map((n) => ({ node: n.rel, content: n.content })),
      // Left standing with every property of their own gone: listed apart, because they are still on the page.
      emptied: (plan.removal?.emptied || []).map((rel) => ({ node: relLabel(rel) })),
      // The destination's own - live copy configuration, annotations - left where they are.
      kept: plan.keptNodes.map((n) => ({ node: n.rel }))
    },
    links: plan.linkChanges.map((l) => ({
      from: l.from, to: l.to, uses: l.uses, on: l.nodes.join(', ')
    })),
    reorders: plan.reorders.map((r) => ({ node: r.rel, index: r.index })),
    reorderSkips: plan.reorderSkips,
    assets: plan.assets,
    // Images missing at the source and from Dynamic Media - the list under the plan.
    // One Dynamic Media still serves is uploaded from there, so it is not on it.
    // Files kept inside the page itself are on it too: they cannot be written from here.
    imagesByHand: [
      ...plan.assets
        .filter((a) => a.state === 'missing')
        .map((a) => ({
          kind: 'missing', from: a.src, to: a.dest,
          reason: missingReason(a.delivery, { copied: 'pointed at the path shown' })
        })),
      ...binariesByHand(plan.binaries, (rel) => `${plan.source}/jcr:content${rel}`, (rel) => `${plan.dest}/jcr:content${rel}`)
    ],
    binaries: plan.binaries.map((b) => ({ node: relLabel(b.rel), file: b.file, state: b.state, size: b.size })),
    folders: plan.folders,
    leftovers: Object.entries(plan.leftoverCounts)
      .map(([link, count]) => ({ link, count }))
      .sort((a, b) => a.link.localeCompare(b.link)),
    ignored: plan.ignored,
    typeWarnings: plan.typeWarnings,
    blockers: plan.blockers,
    largeRemoval: plan.largeRemoval,
    truncationRisk: plan.truncationRisk,
    deletesEnabled: plan.opts.deleteExtras,
    counts: {
      links: plan.linkChanges.length,
      assets: plan.assets.length,
      assetsToCopy: assetsToCopy.length,
      assetsMissing: plan.assets.filter((a) => a.state === 'missing').length,
      fromDelivery: assetsToCopy.filter((a) => a.via).length,
      properties: propCount,
      nodesAdded: plan.nodeAdds.length,
      nodesDeleted: plan.nodeDeletes.length,
      binaries: plan.binaries.length,
      leftovers: Object.keys(plan.leftoverCounts).length
    }
  };
  // Exactly what the review lists for removal; the run is refused if its own list differs.
  s.removalsFingerprint = removalsFingerprint(s);
  return s;
}

/* ------------------------------------------------------------- execution */

/** An upload through the browser is held in memory whole; beyond this it is refused rather than tried. */
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const mb = (n) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;

/**
 * An asset put at the destination the way a person uploading it would: its
 * file read from the source and handed to DAM's own upload, so AEM processes
 * it as a new asset - renditions, and on a Dynamic Media instance the push to
 * Scene7. A repository copy does neither: the copy carries the source's Scene7
 * metadata and never reaches Scene7, so the published page - which shows the
 * image from Scene7 - shows nothing. The file itself arrives unchanged; its
 * metadata (title, description, tags) does not ride along.
 */
async function uploadAsset(client, a, progress) {
  progress('reading');
  let read;
  try {
    read = await client.readBytes(a.src, { max: MAX_UPLOAD_BYTES, url: a.via || null });
  } catch (e) {
    const from = a.via ? ` (reading the Dynamic Media copy at ${a.via})` : '';
    throw abort(`${e.message.replace(/\.$/, '')}${from}. The page has not been re-pointed yet.`);
  }
  if (read.tooLarge) {
    throw abort(
      `${a.src} is ${mb(read.size)}, over the ${mb(MAX_UPLOAD_BYTES)} an upload from the browser carries. ` +
        'Upload it to the destination folder by hand, then run this again. The page has not been re-pointed yet.'
    );
  }
  let unanswered = null;
  try {
    await client.createAsset({
      folder: parentOf(a.dest),
      fileName: nameOf(a.dest),
      parts: [read.bytes],
      mime: read.mime,
      onProgress: (sent, all) => progress(`uploading ${all ? Math.floor((sent / all) * 100) : 0}%`)
    });
  } catch (e) {
    // Sent in full but never confirmed: it may be there anyway. Look.
    if (!e.unanswered) throw abort(`Uploading ${a.dest} failed: ${e.message} The page has not been re-pointed yet.`);
    unanswered = e;
  }
  client.forgetProbe(a.dest);
  if ((await client.probe(a.dest, { timeout: 30_000 })) !== 'yes') {
    throw abort(
      `${unanswered ? unanswered.message : 'The upload reported no error'}, but nothing is at ${a.dest}. ` +
        'Run this again: images already uploaded are not uploaded twice. The page has not been re-pointed yet.'
    );
  }
}

export async function execute(client, report, plan) {
  const step = (id, state, note) => report('data', 'step', { id, state, note });
  const srcAbs = (rel) => `${plan.source}/jcr:content${rel}`;

  /* ---- an existing page gets a restore point before anything touches it -- */
  if (plan.mode === 'sync' && plan.opts.versionFirst) {
    step('version', 'running');
    try {
      // Checked, not assumed: a restore point that does not exist must stop
      // the run here, before a single property is written.
      assertWrite(
        await client.versionPage({
          path: plan.dest,
          label: `pre-sync ${new Date().toISOString()}`,
          comment: `before sync from ${plan.source}`
        }),
        'Saving a version'
      );
    } catch (e) {
      step('version', 'failed');
      throw abort(`${e.message.replace(/\.$/, '')}. Nothing has been written to the page.`);
    }
    report('ok', `versioned  ${plan.dest}`);
    step('version', 'done');
  }

  /* ---- create the page, then re-plan against what actually landed -------- */
  if (plan.mode === 'create') {
    step('page', 'running');
    const r = assertWrite(await client.copyPage({ srcPath: plan.source, destPath: plan.dest }), 'copyPage');

    /* AEM renames around a collision and still answers 200, so success has to
     * be established from the response rather than assumed.
     *
     * The reported Path is NOT reliably the destination - on 6.5 copyPage
     * reports the resource it acted on, the source - so "reported != expected"
     * fires on every healthy copy. It means something in exactly one shape: a
     * SIBLING of the intended destination, which is what a rename produces.
     * Probing the destination cannot stand in for this check, because after a
     * rename something IS at the destination: the node that caused it. */
    if (
      r.resultPath &&
      norm(r.resultPath) !== norm(plan.dest) &&
      parentOf(norm(r.resultPath)) === parentOf(norm(plan.dest))
    ) {
      step('page', 'failed');
      throw abort(
        `The copy was renamed to ${r.resultPath} instead of ${plan.dest}, which means something ` +
          'appeared at the destination between the analysis and now. That stray page is still ' +
          'there - remove it before retrying. Nothing further has been written.'
      );
    }

    client.forgetProbe(plan.dest);
    if ((await client.probe(plan.dest)) !== 'yes') {
      step('page', 'failed');
      throw abort(
        `copyPage reported success but nothing is at ${plan.dest}. Nothing further has been written.`
      );
    }
    report('ok', `created  ${plan.dest}`);
    step('page', 'done');
  }

  /* ---- DAM folders, then assets ------------------------------------------ */
  const foldersToCreate = plan.folders.filter((f) => !f.exists);
  if (foldersToCreate.length) {
    step('folders', 'running');
    let n = 0;
    for (const f of foldersToCreate) {
      assertWrite(await client.createFolder(f.path, DAM_FOLDER_TYPE), `create folder ${f.path}`);
      report('ok', `folder  ${f.path}`);
      step('folders', 'running', `${++n}/${foldersToCreate.length}`);
    }
    step('folders', 'done', `${n}`);
  }

  const assetsToCopy = plan.assets.filter((a) => a.action === 'upload' || a.action === 'overwrite');
  if (assetsToCopy.length) {
    step('assets', 'running');
    let n = 0;
    for (const a of assetsToCopy) {
      const of = `${n + 1}/${assetsToCopy.length}`;
      await uploadAsset(client, a, (note) => step('assets', 'running', `${of} · ${note}`));
      report('ok', `uploaded  ${a.dest}`);
      step('assets', 'running', `${++n}/${assetsToCopy.length}`);
    }
    report('ok', `uploaded ${n} asset${n === 1 ? '' : 's'}`);
    step('assets', 'done', `${n}`);
  }

  /* ---- the page content: one request, saved whole or not at all ---------- */
  /* Everything the diff changes in jcr:content - components added, properties,
   * components removed - goes to AEM as ONE request (core/execute.js), so a
   * failure leaves the page exactly as it was rather than half synced. Only
   * putting components in order follows, a request each.
   *
   * Removals planned from the scanned tree are checked against the live source
   * first: a property or component that is actually still there means the tree
   * was short, and that "removed at source" is an artefact - not a reason to
   * delete. Reads only; nothing has been written to the page yet. */
  const recheck = async (d) => {
    const liveSource = new Map();
    const propDeletes = [];
    let skipped = 0;
    for (const c of d.propDeletes) {
      if (c.reason === 'absent at source') {
        if (!liveSource.has(c.rel)) liveSource.set(c.rel, await client.readProps(srcAbs(c.rel)));
        const live = liveSource.get(c.rel);
        if (!live || c.prop in live) {
          skipped++;
          report('warn', `kept  ${relLabel(c.rel)} / ${c.prop} - still present at the source`);
          continue;
        }
      }
      propDeletes.push(c);
    }
    if (skipped) report('warn', `${skipped} deletion(s) skipped - the source still has them`);

    const nodeDeletes = [];
    for (const node of d.nodeDeletes) {
      client.forgetProbe(srcAbs(node.rel));
      const at = await client.probe(srcAbs(node.rel));
      if (at !== 'no') {
        report('warn', `kept  ${node.rel} - it still resolves at the source (${at})`);
        continue;
      }
      nodeDeletes.push(node);
    }
    return { propDeletes, nodeDeletes };
  };

  const written = await executeDiff(client, plan, {
    page: plan.dest,
    recheck,
    report,
    step,
    removalsAcked: plan.removalsAcked === true
  });
  // All or nothing: no single property can have failed on its own.
  const siteFailed = plan.site ? reportSiteSet(report, plan.site, [...plan.propAdds, ...plan.propUpdates]) : [];

  /* ---- a fresh copy inherits the source's replication state -------------- */
  if (plan.mode === 'create' && plan.opts.stripReplication) {
    step('strip', 'running');
    try {
      assertWrite(
        await client.writeNode(`${plan.dest}/jcr:content`, [
          ['cq:lastReplicated@Delete', 'true'],
          ['cq:lastReplicatedBy@Delete', 'true'],
          ['cq:lastReplicationAction@Delete', 'true']
        ]),
        'clear replication state'
      );
      step('strip', 'done');
    } catch (e) {
      // Cosmetic only - the page is not actually published either way.
      report('warn', `could not clear replication state: ${e.message}`);
      step('strip', 'failed');
    }
  }

  // The content is in, but not all of it in order: an error, never "Done.".
  if (written.partial) throw abort(partialRefusal(plan.dest, written));
  return { siteFailed, written, unconfirmed: written.unconfirmed || null };
}

/* --------------------------------------------------------------- actions */

function announce(report, s) {
  if (s.truncationRisk) {
    report(
      'warn',
      'The source page is large enough that AEM may have truncated the JSON it returned. ' +
        'Removals are disabled for this run.'
    );
  }
  if (s.rewrite.enabled) {
    report('info', `Rewriting /${s.rewrite.srcSite} references to /${s.rewrite.destSite}.`);
    if (s.choice.keepImages) {
      report('info', `Image paths are kept pointing at /${s.rewrite.srcSite}: no images are uploaded (${s.choice.images}).`);
    }
    if (s.choice.keepLinks) report('info', `Links are kept pointing at /${s.rewrite.srcSite} (${s.choice.links}).`);
    for (const o of s.otherSites) {
      report(
        'info',
        o.repointed
          ? `Links to /${o.site} are re-pointed at /${s.rewrite.destSite} too (${o.properties} propert${o.properties === 1 ? 'y' : 'ies'}) - untick under "Links to /${o.site}" to leave them.`
          : `Links to /${o.site} are left as they are (${o.properties} propert${o.properties === 1 ? 'y' : 'ies'}).`
      );
    }
    for (const f of s.otherDam) {
      report(
        'info',
        f.copied
          ? `${f.images.length} image(s) from ${f.root} are copied into ${f.to} and re-pointed there.`
          : `${f.images.length} image(s) from ${f.root} are left as they are - tick "Copy images from ${f.root}" to copy them into ${f.to}.`
      );
    }
  } else {
    report('info', 'Source and destination are on the same site - no link rewriting needed.');
  }
  if (s.site) announceSite(report, s.site);
  if (s.counts.fromDelivery) {
    report('info', `${s.counts.fromDelivery} asset(s) deleted from the source DAM will be uploaded from Dynamic Media.`);
  }
  if (s.counts.assetsMissing) {
    report(
      'warn',
      `${s.counts.assetsMissing} referenced asset(s) are not in the source DAM, nor on Dynamic Media - ` +
        'the page will point where each belongs; add them by hand.'
    );
  }
  if (s.rewrite.enabled) {
    // Other sites' links being re-pointed count too - they are found apart from this site's.
    const others = s.otherSites.filter((o) => o.repointed).reduce((n, o) => n + o.links.length, 0);
    report('info', `${s.counts.links + others} distinct link(s) will be re-pointed.`);
  }
  if (s.counts.leftovers) {
    report('warn', `${s.counts.leftovers} reference(s) will still point at /${s.rewrite.srcSite}.`);
  }
  if (s.counts.binaries) {
    report(
      'warn',
      `${s.counts.binaries} file(s) kept inside the page cannot be written from here and are left as they are - ` +
        `listed to do by hand: ${s.binaries.map((b) => b.node).join(', ')}`
    );
  }
}

/* ------------------------------------------------- the destination's backup */

/** The review's line on the destination's backup, in the log too. */
export function announceBackup(report, b) {
  if (!b) return;
  if (b.state === 'missing') report('warn', `The destination has no backup at ${b.backup}.`);
  else if (b.state === 'differs') {
    report('warn', `The backup at ${b.backup} is not the same as the destination (${b.differences.properties} propert${b.differences.properties === 1 ? 'y' : 'ies'}, ${b.differences.components} component${b.differences.components === 1 ? '' : 's'} differ).`);
  } else if (b.state === 'same') report('info', `The backup at ${b.backup} matches the destination.`);
  else report('info', `No backup is taken: ${b.reason}`);
}

/**
 * The destination's backup, as `backupState` says - or, when it throws,
 * unavailable with the reason. The analysis of the copy used to fail whole
 * because the backup beside it could not be read.
 */
export async function backupOrWhy(client, settings, page) {
  try {
    return await backupState(client, settings, page);
  } catch (e) {
    if (e?.signedOut) throw e;
    return {
      page, backup: null, state: 'unavailable', differences: null,
      reason: `its backup could not be checked (${String(e?.message || e).replace(/\.$/, '')}).`
    };
  }
}

/**
 * Before the first write to a page that is already there: its backup, checked
 * again now and taken or updated when it is missing or not the same - unless
 * the review's box was unticked (backupFirst false). A backup that fails stops
 * the run, with nothing written to the page.
 */
export async function backupFirst(client, settings, report, page, params) {
  if (params.backupFirst === false || params.backupFirst === 'false') {
    report('info', 'No backup taken first - unticked on the review.');
    return;
  }
  let b;
  try {
    b = await backupState(client, settings, page);
  } catch (e) {
    throw abort(`The backup could not be checked, so nothing has been written: ${String(e.message).replace(/\.$/, '')}. ${page} is as it was.`);
  }
  /* No backup can be taken for this page - it is itself inside the backup
     folder, or it is a global page. That used to pass in silence, so a run
     that was asked for a backup first wrote without one and nobody knew
     until they wanted it back. Said plainly instead; the run goes on,
     because refusing would make these pages unwritable. */
  if (b.state === 'unavailable') {
    report('warn', `No backup was taken of ${page}: ${b.reason} Nothing here can be put back from a backup.`);
    return;
  }
  if (b.state !== 'missing' && b.state !== 'differs') return;

  /* Updating a backup replaces the only copy there is. Run twice on a page
     that went wrong in between, the second run made the damage the backup,
     and the last good copy was gone. So the backup as it stands is kept as a
     version first - the Versions tool can put it back - and if that cannot be
     saved, nothing is touched. */
  if (b.state === 'differs') {
    try {
      assertWrite(
        await client.versionPage({
          path: b.backup,
          label: `pre-update ${new Date().toISOString()}`,
          comment: `before the backup was updated from ${page}`
        }),
        'Saving a version of the backup'
      );
    } catch (e) {
      throw abort(
        `A version of the backup at ${b.backup} could not be saved, so it has not been updated and nothing ` +
          `has been written: ${String(e.message).replace(/\.$/, '')}. ${page} is as it was.`
      );
    }
    report('ok', `saved a version of the backup ${b.backup} before updating it - the Versions tool can put it back`);
  }

  try {
    await takeBackup(client, settings, report, page, { versioned: b.state === 'differs' });
  } catch (e) {
    throw abort(`The backup failed, so nothing has been written: ${String(e.message).replace(/\.$/, '')}. ${page} is as it was.`);
  }
}

export const actions = {
  /** Reads only. Produces the breakdown the operator approves or rejects. */
  async analyze({ client, settings, report, params }) {
    client.resetCaches();
    const plan = await buildPlan(client, settings, params);
    const s = summarise(plan);

    /* A page that is already there is backed up first, if the operator says
       so (see backupFirst). A backup that cannot be looked at is said, not a
       reason the copy cannot be planned. */
    if (s.mode === 'sync') s.backup = await backupOrWhy(client, settings, plan.dest);

    report('data', 'analysis', s);
    announce(report, s);
    announceBackup(report, s.backup);

    if (s.blockers.length) {
      for (const b of s.blockers) report('fail', b);
      report('info', 'Nothing has been written, and this run cannot proceed.');
    } else {
      if (s.largeRemoval) report('warn', `${s.largeRemoval} It runs only once you confirm the removal.`);
      report(
        'info',
        `${s.mode === 'create' ? 'Will create' : 'Will update'} ${plan.dest}. Nothing has been written.`
      );
    }
    return s;
  },

  /**
   * Writes. Re-runs the full analysis first rather than trusting what the panel
   * is holding: between the analysis and the click, someone else may have
   * created, edited or published the destination.
   */
  async run({ client, settings, report, params }) {
    client.resetCaches();
    const plan = await buildPlan(client, settings, params);
    const s = summarise(plan);

    if (s.blockers.length) {
      throw abort(`Refusing to write. ${s.blockers[0]}`);
    }
    if (s.largeRemoval && !removalsConfirmed(s, params)) {
      throw abort(`Refusing to write. ${s.largeRemoval} Analyze again and confirm the removal to go ahead.`);
    }
    /* Only when the box was ticked, and then it must cover exactly what this
       plan would change - a page whose properties moved between the review
       and the click is refused rather than trusted. Unticked is a choice, not
       something to refuse: `keepPageProps` has already left them out. */
    if (params.metadataAck && !metadataConfirmed(s, params)) throw abort(metadataRefusal(s));
    if (s.mode === 'sync') await backupFirst(client, settings, report, plan.dest, params);

    // Confirmed for exactly this plan: the write may empty what the review listed.
    plan.removalsAcked = !!s.largeRemoval && removalsConfirmed(s, params);
    const { siteFailed, unconfirmed } = await execute(client, report, plan);
    // What the run could not work out is still to be done by hand: on record in the log as well as on the done screen.
    for (const n of s.site?.notes || []) report('warn', n);

    const out = { ...s, site: markFailed(s.site, siteFailed), done: true, editorUrl: `/editor.html${plan.dest}.html` };
    /* The write ran, so this is the end of the run - but not a match. Said as
       a warning naming what did not hold, never as "Done.". */
    if (unconfirmed) {
      report('warn', unconfirmedWarning(plan.dest, unconfirmed));
      return { ...out, unconfirmed };
    }
    report('ok', `Done. ${plan.dest}`);
    return out;
  }
};
