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
import { metadataConfirmed, metadataRefusal, removalsConfirmed } from '../../core/protocol.js';
import { nameOf, norm, parentOf, segs } from '../../core/paths.js';
import { byDepth, diff, isAssetRef, metadataFor, relLabel } from '../../core/diff.js';
import {
  assetMatcher,
  assetsIn,
  buildRules,
  isDate,
  otherSiteLinks,
  resolveSites,
  rewriteTokens,
  rewriteValue,
  SYSTEM_PROPS,
  typeHint
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

/** A sync that would remove more than this share of the destination runs only once the operator confirms it. */
const MAX_DELETE_RATIO = 0.25;

/** Below this many nodes, a delete count is never large enough to be alarming. */
const DELETE_FLOOR = 5;

const DAM_FOLDER_TYPE = 'sling:OrderedFolder';
const PROBE_CONCURRENCY = 6;

/** Host forms a canonical can take. Settings can extend, not replace. */
const DEFAULT_HOSTS = ['www.samsung.com'];
const DEFAULT_SHOP_HOSTS = ['shop.samsung.com'];

/* ------------------------------------------------------------- utilities */

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

/**
 * Flatten a jcr:content subtree into rel -> properties, keeping each node's
 * child sequence. '' is jcr:content itself, '/root/container' is below it.
 *
 * The order matters as much as the properties: in AEM a container's child node
 * sequence IS the order its components render in, and a diff that only compares
 * properties will happily report two visibly different pages as identical.
 */
function flatten(node, rel, tree, order) {
  const props = {};
  const kids = [];
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      kids.push(k);
      flatten(v, `${rel}/${k}`, tree, order);
    } else {
      props[k] = v;
    }
  }
  tree[rel] = props;
  order[rel] = kids;
  return tree;
}

/* -------------------------------------------------------------- planning */

async function readPageTree(client, page) {
  const json = await client.readTree(`${page}/jcr:content`);
  if (!json) return null;
  const tree = {};
  const order = {};
  flatten(json, '', tree, order);
  return { tree, order };
}

async function planAssets(client, srcTree, sites, copyAssets, overwrite) {
  const re = assetMatcher(sites.srcDam);
  const found = new Set();
  for (const rel of Object.keys(srcTree)) {
    for (const p of Object.keys(srcTree[rel])) {
      for (const a of assetsIn(srcTree[rel][p], re)) found.add(a);
    }
  }

  const assets = await pool([...found].sort(), PROBE_CONCURRENCY, async (src) => {
    const dest = sites.destDam + src.slice(sites.srcDam.length);
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
    versionFirst: settings.upsertVersionFirst === true,
    stripReplication: settings.upsertStripReplication !== false,
    keepAtDest: String(settings.upsertKeepAtDest || '')
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
    /* Links to other sites are re-pointed at the destination too, ticked to start
     * with; these are the sites unticked on the review, whose links are left as they are. */
    keepSites: (Array.isArray(params.keepSites) ? params.keepSites : String(params.keepSites || '').split(','))
      .map((s) => String(s).trim())
      .filter(Boolean)
  };
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
  const { assets, folders, missing, unreadable, re } = params.skipAssets || keep.images
    ? { assets: [], folders: [], missing: new Set(), unreadable: [], re: assetMatcher(sites.srcDam) }
    : await planAssets(client, src.tree, sites, opts.copyAssets, opts.overwriteAssets);

  /* Links to other sites - /uk from a /global page - re-pointed at the destination
   * unless unticked. Only a site the page links to AND that AEM has: its
   * /content/<brand>/<site> must be a page. That is what keeps /semiconductor or
   * any other path www.samsung.com serves beside its sites from being taken for
   * one - asked of the repository, not looked up in a list. A property the run
   * never writes is not counted: a system or kept-at-destination property, a
   * date, one held back for naming an image missing at the source. */
  const never = new Set([...SYSTEM_PROPS, ...opts.keepAtDest]);
  const heldBack = (v) => missing.size > 0 && assetsIn(v, re).some((a) => missing.has(a));
  const others = new Map();
  for (const [site, o] of otherSitesIn(src.tree, sites, (prop, v) => never.has(prop) || isDate(v) || heldBack(v))) {
    if (await isSiteRoot(client, `${sites.contentRoot}/${site}`)) others.set(site, o);
  }
  const also = [...others.keys()].filter((s) => !opts.keepSites.includes(s));
  const ctx =
    keep.images || keep.links || also.length
      ? buildRules(sites, { images: !keep.images, links: !keep.links, alsoSites: also })
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

  /* Reasons to refuse, gathered rather than thrown, so the analysis can show
   * all of them at once instead of one per attempt. */
  const blockers = [];
  if (unreadable.length) {
    blockers.push(
      `${unreadable.length} asset(s) could not be read (403). A permissions error is not the same ` +
        'as a missing asset, and guessing either way risks leaving links pointing at the source.'
    );
  }

  /* Not a blocker: a page that really has been reworked at the source is a
   * fair thing to sync. But it is also what a wrong pairing looks like, so the
   * run waits for the operator to confirm it - see `removalsConfirmed`. */
  const largeRemoval =
    mode === 'sync' && d.nodeDeletes.length > Math.max(DELETE_FLOOR, d.destCount * MAX_DELETE_RATIO)
      ? `This would remove ${d.nodeDeletes.length} of ${d.destCount} components at the destination ` +
        `(over ${Math.round(MAX_DELETE_RATIO * 100)}%). That is more like a different page than a drift.`
      : null;

  return {
    source, dest, mode, sites, ctx, opts, assets, folders, ...d,
    blockers, largeRemoval, truncationRisk, choice, otherSites, site
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

  return {
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
    site: siteSummary(plan.site, plan.siteChanges, { applied: !plan.opts.keepSiteValues, preview: previewValue }),
    // An existing page's own properties that would change: the review asks before they are written.
    metadata: metadataFor(plan.mode, plan),
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
        reason: c.reason
      }))
    },
    nodes: {
      added: plan.nodeAdds.map((n) => ({ node: n.rel, props: n.props })),
      deleted: plan.nodeDeletes.map((n) => ({ node: n.rel }))
    },
    links: plan.linkChanges.map((l) => ({
      from: l.from, to: l.to, uses: l.uses, on: l.nodes.join(', ')
    })),
    reorders: plan.reorders.map((r) => ({ node: r.rel, index: r.index })),
    reorderSkips: plan.reorderSkips,
    assets: plan.assets,
    // Images missing at the source and from Dynamic Media - the list under the plan.
    // One Dynamic Media still serves is uploaded from there, so it is not on it.
    imagesByHand: plan.assets
      .filter((a) => a.state === 'missing')
      .map((a) => ({
        kind: 'missing', from: a.src, to: a.dest,
        reason: missingReason(a.delivery, { copied: 'pointed at the path shown' })
      })),
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
      leftovers: Object.keys(plan.leftoverCounts).length
    }
  };
}

/* ------------------------------------------------------------- execution */

function pairsForChange(c) {
  if (c.reason) return [[`${c.prop}@Delete`, 'true']];
  const pairs = [[`${c.prop}@TypeHint`, typeHint(c.to)]];
  for (const x of Array.isArray(c.to) ? c.to : [c.to]) pairs.push([c.prop, String(x)]);
  return pairs;
}

function assertWrite(r, what) {
  if (!r.success) {
    throw abort(
      `${what} failed [HTTP ${r.http} / status ${r.effective}]: ${r.message || '(no message returned)'}`
    );
  }
  return r;
}

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
  const destAbs = (rel) => `${plan.dest}/jcr:content${rel}`;
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

  /* ---- components added at the source ------------------------------------ */
  if (plan.nodeAdds.length) {
    step('nodes', 'running');
    let n = 0;
    // Depth order, so a parent exists before its children are written.
    for (const node of plan.nodeAdds) {
      assertWrite(await client.writeNode(destAbs(node.rel), node.pairs), `create node ${node.rel}`);
      report('ok', `component  ${node.rel}`);
      step('nodes', 'running', `${++n}/${plan.nodeAdds.length}`);
    }
    step('nodes', 'done', `${n}`);
  }

  /* ---- property writes, one request per node ----------------------------- */
  const work = new Map();
  for (const c of [...plan.propAdds, ...plan.propUpdates, ...plan.propDeletes]) {
    if (!work.has(c.rel)) work.set(c.rel, []);
    work.get(c.rel).push(c);
  }

  const failedProps = new Set();
  if (work.size) {
    step('props', 'running');
    let n = 0;
    let skipped = 0;
    const liveSource = new Map();

    for (const [rel, changes] of work) {
      const apply = [];
      for (const c of changes) {
        // A delete planned from the scanned tree is re-checked against the live
        // source. If the property is actually there, the tree was short and
        // this "removed at source" is an artefact - not a reason to delete.
        if (c.reason === 'absent at source') {
          if (!liveSource.has(rel)) liveSource.set(rel, await client.readProps(srcAbs(rel)));
          const live = liveSource.get(rel);
          if (!live || c.prop in live) {
            skipped++;
            report('warn', `kept  ${relLabel(rel)} / ${c.prop} - still present at the source`);
            continue;
          }
        }
        apply.push(c);
      }
      if (!apply.length) continue;

      const pairs = apply.flatMap(pairsForChange);
      try {
        assertWrite(await client.writeNode(destAbs(rel), pairs), `write ${relLabel(rel)}`);
      } catch (e) {
        // One rejected value takes the whole request with it, so the rest are
        // retried individually rather than lost alongside it.
        report('warn', `${relLabel(rel)}: batched write failed, retrying property by property`);
        for (const c of apply) {
          try {
            assertWrite(await client.writeNode(destAbs(rel), pairsForChange(c)), `write ${c.prop}`);
          } catch (inner) {
            failedProps.add(c);
            report('fail', `${relLabel(rel)} / ${c.prop}: ${inner.message}`);
          }
        }
      }
      step('props', 'running', `${++n}/${work.size}`);
    }
    report('ok', `wrote properties on ${n} node${n === 1 ? '' : 's'}`);
    if (skipped) report('warn', `${skipped} deletion(s) skipped - the source still has them`);
    step('props', 'done', `${n}`);
  }
  const siteFailed = plan.site ? reportSiteSet(report, plan.site, [...plan.propAdds, ...plan.propUpdates], failedProps) : [];

  /* ---- components removed at the source, deepest first ------------------- */
  if (plan.nodeDeletes.length) {
    step('deletes', 'running');
    let n = 0;
    for (const node of plan.nodeDeletes) {
      client.forgetProbe(srcAbs(node.rel));
      const at = await client.probe(srcAbs(node.rel));
      if (at !== 'no') {
        report('warn', `kept  ${node.rel} - it still resolves at the source (${at})`);
        continue;
      }
      assertWrite(await client.deleteNode(destAbs(node.rel)), `delete ${node.rel}`);
      report('ok', `removed  ${node.rel}`);
      step('deletes', 'running', `${++n}/${plan.nodeDeletes.length}`);
    }
    step('deletes', 'done', `${n}`);
  }

  /* ---- component order --------------------------------------------------- */
  if (plan.reorders.length) {
    step('order', 'running');
    let n = 0;
    for (const r of plan.reorders) {
      try {
        assertWrite(await client.orderNode(destAbs(r.rel), r.index), `order ${r.rel}`);
        n++;
      } catch (e) {
        report('warn', `could not reorder ${r.rel}: ${e.message}`);
      }
    }
    report('ok', `reordered ${n} component${n === 1 ? '' : 's'}`);
    step('order', 'done', `${n}`);
  }

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

  return { siteFailed };
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
  const b = await backupState(client, settings, page);
  if (b.state !== 'missing' && b.state !== 'differs') return;
  try {
    await takeBackup(client, settings, report, page);
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

    // A page that is already there is backed up first, if the operator says so (see backupFirst).
    if (s.mode === 'sync') s.backup = await backupState(client, settings, plan.dest);

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
    if (!metadataConfirmed(s, params)) throw abort(metadataRefusal(s));
    if (s.mode === 'sync') await backupFirst(client, settings, report, plan.dest, params);

    const { siteFailed } = await execute(client, report, plan);
    // What the run could not work out is still to be done by hand: on record in the log as well as on the done screen.
    for (const n of s.site?.notes || []) report('warn', n);

    report('ok', `Done. ${plan.dest}`);
    return { ...s, site: markFailed(s.site, siteFailed), done: true, editorUrl: `/editor.html${plan.dest}.html` };
  }
};
