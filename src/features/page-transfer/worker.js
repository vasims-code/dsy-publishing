/**
 * page-transfer: bring a page across from another AEM author instance.
 *
 * This module runs in BOTH tabs. The panel decides which action goes where:
 *
 *   on the source instance   readPage, readAsset
 *   on this instance         analyze, prepare, writeAsset, apply
 *
 * Each half is same-origin with its own session and its own CSRF token, so
 * nothing here makes a cross-origin request, and neither server needs a CORS
 * policy or a relaxed login cookie. The page tree and the image bytes travel
 * between the two through the panel.
 *
 * WHY COMPONENTS ARE NOT MATCHED BY NODE NAME
 *
 * A page copied within one server keeps its node names. A page authored
 * separately on another server does not - the same component is
 * pd_g_feature_benefit_2084490669 on one and pd_g_feature_benefit_552501717 on
 * the other. Worse, a name CAN coincide while the components differ: on a real
 * pair, uk's `cm_g_static_content` is a spacer div and lb's is the page's FAQ
 * schema. Pairing those by name silently replaces live structured data.
 *
 * So the pairing is inferred by core/align.js, from component order and type,
 * and shown for confirmation before anything is written. See its header.
 */

import { abort, fromBase64, toBase64 } from '../../core/aem-client.js';
import { alignTrees, destResolver, relabel } from '../../core/align.js';
import { binariesByHand, diff, largeRemovalOf, metadataFor, relLabel } from '../../core/diff.js';
import {
  assertWrite, executeDiff, partialRefusal, pool, readPageTree, unconfirmedWarning
} from '../../core/execute.js';
import { humanize, insideBackupFolder, nameOf, norm, parentOf, segs } from '../../core/paths.js';
import {
  LOCALE_OWNED,
  metadataConfirmed,
  metadataRefusal,
  removalsConfirmed,
  removalsFingerprint
} from '../../core/protocol.js';
import { announceBackup, backupFirst, backupOrWhy } from '../page-upsert/worker.js';
import {
  assetMatcher, assetsIn, buildRules, leftovers, resolveSites, rewriteValue
} from '../../core/rewrite.js';
import {
  announceSite, homeOf, homeProps, markFailed, readHome, reportSiteSet, siteSummary, siteValues, touchesSite
} from '../../core/site-values.js';
import { findOnDelivery, missingReason } from '../../core/dynamic-media.js';

/* ---------------------------------------------------------- safety rails */

const TRUNCATION_GUARD = 900;
const PROBE_CONCURRENCY = 6;
const DAM_FOLDER_TYPE = 'sling:OrderedFolder';

/* An image crosses the panel in pieces of this size, one message each - well
 * under Chrome's 64MB message limit once base64 has added its third. */
const PIECE_BYTES = 8 * 1024 * 1024;

/**
 * The biggest image this will carry, from settings.
 *
 * Holding a very large asset in two tabs at once is the wrong tool - a
 * content package is - and an upload AEM will not take costs the whole stall
 * allowance before it is given up on. So the limit is low, and it is a
 * setting: it is the kind of number that is right for one team's instances
 * and wrong for another's.
 *
 * Over it is not a blocker. The reference is still re-pointed at where the
 * image belongs, the page goes across, and the image is listed to do by hand.
 */
const MAX_ASSET_BYTES = 256 * 1024 * 1024;

function maxAssetBytes(settings) {
  const mb = Number(settings?.transferMaxImageMb);
  if (!Number.isFinite(mb) || mb <= 0) return MAX_ASSET_BYTES;
  return Math.min(mb * 1024 * 1024, MAX_ASSET_BYTES);
}

const mb = (n) =>
  n == null
    ? ''
    : n >= 1024 * 1024
      ? `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`
      : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Which instance this half is running on, for messages that say "here". */
const hereIs = () => (typeof location !== 'undefined' ? location.origin : 'this instance');

const DEFAULT_HOSTS = ['www.samsung.com'];
const DEFAULT_SHOP_HOSTS = ['shop.samsung.com'];

/**
 * Page metadata that cannot be derived from the source.
 *
 * "| Samsung UK" and "@SamsungUK" have no mechanical translation into their
 * Lebanese equivalents, so an existing value here is never overwritten. A page
 * being created has nothing to preserve and gets the source's values, which is
 * a starting point to edit rather than a blank field.
 *
 * The handles stop being kept once this site's home page names its own: then
 * they are worked out (core/site-values.js), and an old @SamsungUK left here is
 * fixed rather than kept. See DERIVED below.
 */
export const PAGE_METADATA = [
  'ogTitle', 'ogDescription', 'ogType', 'ogImageReference',
  'twitterTitle', 'twitterDescription', 'twitterCard', 'twitterSite',
  'twitterCreator', 'twitterImageReference',
  'description', 'keywords', 'jcr:title', 'titleOption'
];

/** Kept as this page has them only while nothing can work them out. */
const DERIVED = ['twitterSite', 'twitterCreator'];

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function settingsFor(settings, params) {
  return {
    copyAssets: settings.transferCopyAssets !== false,
    overwriteAssets: settings.transferOverwriteAssets === true,
    addMissingNodes: true,
    // A page created here is built from its template, node by node - nothing comes with it.
    rebuilt: true,
    deleteExtras: params.allowDeletes !== false && params.allowDeletes !== 'false',
    reorder: settings.upsertReorder !== false,
    /* The review asks for a backup destination, where a version is the only
       restore point there can be (a backup of a backup has nowhere to go).
       Anywhere else there is no box, and the setting decides. */
    versionFirst:
      params.versionFirst === undefined
        ? settings.upsertVersionFirst === true
        : params.versionFirst === true || params.versionFirst === 'true',
    /* The locale-owned ones are never written, not merely preserved: a
       preserved property the destination lacks still got the source's, so a
       page without its own publish date took the source locale's. */
    keepAtDest: [...new Set([...LOCALE_OWNED, ...list(settings.upsertKeepAtDest)])],
    // More node names to keep, on top of cq:LiveSyncConfig and cq:annotations (KEEP_NODES in core/diff.js).
    keepNodesAtDest: list(settings.upsertKeepNodes),
    preserveAtDest: [...new Set([...PAGE_METADATA, ...list(settings.transferPreserve)])],
    hosts: [...new Set([...DEFAULT_HOSTS, ...list(settings.upsertHosts)])],
    shopHosts: DEFAULT_SHOP_HOSTS,
    rewriteShop: settings.upsertRewriteShop === true,
    /* The review's "site values" box, unticked: the handle, title ending and
     * language are not set to this site's. Ticked to start with. */
    keepSiteValues: params.keepSiteValues === true || params.keepSiteValues === 'true',
    /* The review's page-properties box, unticked. Ticking it is how an
       existing page's own canonical, redirect and the rest get overwritten;
       leaving it alone keeps them and copies everything else. */
    keepPageProps: !params.metadataAck
  };
}

/**
 * The site values for this page, read off this site's home page and the source
 * home page the source tab sent along. Sets them on `opts` for the diff, and
 * takes a handle off the keep-as-it-is list once it can be worked out - unless
 * settings name it there themselves. Null between pages on the same site.
 */
async function siteFor(client, settings, src, sites, opts) {
  opts.siteValues = {};
  if (!sites.enabled || !touchesSite(src.tree[''])) return null;
  const site = siteValues({
    page: src.tree[''],
    src: src.home || { path: homeOf(sites, sites.srcSite), state: 'missing', props: null },
    dest: await readHome(client, homeOf(sites, sites.destSite))
  });
  opts.siteValues = site.values;
  const named = new Set(list(settings.transferPreserve));
  opts.preserveAtDest = opts.preserveAtDest.filter((p) => named.has(p) || !(DERIVED.includes(p) && p in site.values));
  return site;
}

/**
 * A destination node with no counterpart is removed where it really is. One
 * whose own path a paired node took has been moved aside in the relabelled
 * tree (see relabel in core/align.js); its real path goes back on the delete,
 * so the review lists - and the run removes - the node that is actually there.
 */
function atRealPaths(d, relabelled) {
  if (!relabelled) return;
  d.nodeDeletes = d.nodeDeletes.map((n) => ({ ...n, rel: relabelled.atDest(n.rel) }));
  d.keptNodes = d.keptNodes.map((n) => ({ ...n, rel: relabelled.atDest(n.rel) }));
}

/* ====================================================================== */
/*  Actions that run on the SOURCE instance                               */
/* ====================================================================== */

/**
 * A source page whose components are there but hold nothing is not a source.
 *
 * On 2026-11-01 a transfer wrote a destination whose every component was left
 * standing with nothing in it but its jcr:primaryType. The plan that did it
 * is one that removes everything and writes nothing, which is what a tree
 * like this produces - so the same shape is refused here too, at the read,
 * before the other instance is told anything at all. core/execute.js holds
 * the same floor under the write itself.
 *
 * A page really can have empty container nodes - a disclaimerList, a
 * categoryList - and a page really can be nearly bare. What cannot happen is
 * a page of many components where not one of them holds a property of its
 * own.
 */
function assertHasContent(tree, rels, source) {
  // Rels start with a slash: 'root' never matched, so the root container counted as a component.
  const components = rels.filter((rel) => rel && rel !== '/root');
  if (components.length < 4) return;

  const own = (rel) => Object.keys(tree[rel]).filter((p) => p !== 'jcr:primaryType' && p !== 'sling:resourceType');
  if (components.some((rel) => own(rel).length)) return;

  throw abort(
    `${source} read back as ${components.length} components with no content in any of them - not a ` +
      'property between them. That is not a page anyone authored, so it is almost certainly a bad ' +
      'read rather than the real page. Nothing has been sent to the other instance. Open the page ' +
      'on this server and check it, then try again.'
  );
}

/**
 * Everything about the source page that the destination needs, in one read.
 * Nothing is written, and nothing on this instance is touched at any point.
 */
async function readPage({ client, settings, report, params }) {
  const source = norm(params.source);
  if (!/^\/content\//.test(source)) throw abort(`Source must be under /content: ${source}`);

  const info = await client.inspect(source);
  client.assertReadable(info, 'source page');
  if (!info.exists) throw abort(`Source page does not exist on that instance: ${source}`);
  if (!info.isPage) throw abort(`Source is not a cq:Page (it is ${info.primaryType}): ${source}`);

  const tree = await readPageTree(client, source);
  if (!tree) throw abort(`Source page has no jcr:content: ${source}`);

  const rels = Object.keys(tree.tree);
  const truncationRisk = rels.length >= TRUNCATION_GUARD;
  assertHasContent(tree.tree, rels, source);

  // The DAM root is derived here, where the source's own site token is known.
  const srcSites = resolveSites({
    source,
    dest: source,
    rootDepth: settings.rootDepth,
    srcSite: params.srcSite,
    hosts: [],
    shopHosts: []
  });

  /* The source site's home page, for the ending its titles use - only what the
   * other end needs, and only when the page has any of the site values. */
  const home = touchesSite(tree.tree[''])
    ? await readHome(client, homeOf(srcSites, srcSites.srcSite))
    : null;

  /* Every DAM reference on the page, not only the ones under this site's own
   * DAM folder. A page that points at /content/dam/samsung/global/... has
   * images; scanning only /content/dam/samsung/uk/... would report none, and
   * "no images" and "images this tool will not move" are very different
   * answers to give someone. */
  const anyDam = assetMatcher('/content/dam');
  const counts = new Map();
  for (const rel of rels) {
    for (const p of Object.keys(tree.tree[rel])) {
      for (const a of assetsIn(tree.tree[rel][p], anyDam)) {
        counts.set(a, (counts.get(a) || 0) + 1);
      }
    }
  }

  /* All of them are candidates. The other instance is a different repository:
   * an asset outside this site's folder is no more likely to be there than one
   * inside it, so "shared" is a statement about the path, not about whether it
   * needs carrying across. Where each one lands is decided at the other end,
   * by the same rewrite that moves the reference pointing at it. */
  const under = (path) => path === srcSites.srcDam || path.startsWith(`${srcSites.srcDam}/`);

  const assets = await pool([...counts.keys()].sort(), PROBE_CONCURRENCY, async (path) => {
    const at = await client.probe(path);
    return {
      path,
      uses: counts.get(path),
      scope: under(path) ? 'site' : 'shared',
      state: at === 'yes' ? 'ok' : at === 'no' ? 'missing' : 'unreadable',
      // Known before anything is written, so an image too big to carry is on
      // the review screen rather than a surprise half-way through the run.
      size: at === 'yes' ? await client.assetSize(path) : null,
      // Gone from the DAM is not always gone from the page: Dynamic Media can
      // still be serving its copy. Asked here, on the source, where it is known.
      delivery: at === 'no' ? await findOnDelivery(path) : null
    };
  });

  const shared = assets.filter((a) => a.scope === 'shared').length;
  report(
    'ok',
    `read ${rels.length} nodes from ${source} — ${assets.length} image(s)` +
      (shared ? `, ${shared} of them outside ${srcSites.srcDam}` : '')
  );
  if (!assets.length) report('info', 'This page references no DAM assets at all.');
  const gone = assets.filter((a) => a.state === 'missing');
  if (gone.length) {
    const served = gone.filter((a) => a.delivery?.found.length).length;
    report(
      'warn',
      `${gone.length} image(s) not in the source DAM` +
        (served ? ` — ${served} of them still served by Dynamic Media, carried from there` : '')
    );
  }

  return {
    source,
    srcDam: srcSites.srcDam,
    srcSite: srcSites.srcSite,
    title: info.title,
    template: info.template,
    tree: tree.tree,
    order: tree.order,
    home: home && { ...home, props: homeProps(home.props) },
    assets,
    nodes: rels.length,
    truncationRisk
  };
}

/* The asset being carried, held between the calls that hand it over piece by
 * piece. Only ever one: reading the next replaces it. */
let held = null;

/**
 * One piece of an asset's bytes, from `offset`. The call at offset 0 reads
 * the asset; each call after it hands over the next piece, until `done`. No
 * message carries more than a piece, so an image of any size goes the same way.
 *
 * Nothing about one image stops the transfer. One that cannot be read, or is
 * too large to carry, comes back `skipped` with the reason, and the panel
 * moves on to the next and lists it at the end.
 */
async function readAsset({ client, settings, params }) {
  const path = params.path;
  const offset = params.offset || 0;

  if (offset === 0 || held?.path !== path) {
    held = null;
    let read;
    try {
      read = await client.readBytes(path, { max: maxAssetBytes(settings), url: params.url || null });
    } catch (e) {
      return {
        path,
        skipped: params.url
          ? `could not be read from Dynamic Media (${params.url}): ${e.message}`
          : `could not be read on the source: ${e.message}`,
        ...(e.signedOut ? { signedOut: true } : {})
      };
    }
    if (read.tooLarge) {
      return {
        path,
        size: read.size,
        skipped: `${mb(read.size)}, over the ${mb(maxAssetBytes(settings))} this transfer carries (Settings)`
      };
    }
    held = { path, ...read };
  }

  const piece = held.bytes.subarray(offset, offset + PIECE_BYTES);
  const size = held.bytes.length;
  const done = offset + piece.length >= size;
  const out = { path, base64: toBase64(piece), mime: held.mime, size, offset, length: piece.length, done };
  if (done) held = null;
  return out;
}

/* ====================================================================== */
/*  Actions that run on THIS instance                                     */
/* ====================================================================== */

function planFrom({ settings, params }) {
  const source = norm(params.source);
  const dest = norm(params.dest);
  const opts = settingsFor(settings, params);
  /* Only where it can be restored: the Versions tool refuses anything
     outside the backup folder, so a pre-write version on an ordinary page is
     a restore point nothing here can use. */
  opts.versionFirst = opts.versionFirst && insideBackupFolder(dest, settings.backupFolder, settings.rootDepth);

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

  return { source, dest, opts, sites, ctx: buildRules(sites) };
}

/**
 * The analysis. Takes the source tree the panel carried over; reads this
 * instance itself.
 */
async function analyze({ client, settings, report, params }) {
  client.resetCaches();

  const src = params.sourcePage;
  if (!src?.tree) throw abort('No source page was supplied. Run the analysis from the panel.');

  const { source, dest, opts, sites, ctx } = planFrom({ settings, params });

  if (!/^\/content\//.test(dest)) throw abort(`Destination must be under /content: ${dest}`);
  if (sites.overlapping) {
    throw abort(
      `Site tokens overlap ("${sites.srcSite}" and "${sites.destSite}"). One contains the other, ` +
        'so a rewrite rule could match what another rule just produced. Set both tokens explicitly.'
    );
  }
  if (segs(dest).length <= settings.rootDepth) {
    throw abort(`Destination is at or above the site root (depth ${settings.rootDepth}). Refusing.`);
  }

  if (src.truncationRisk) {
    opts.deleteExtras = false;
    report('warn',
      `The source page is ${src.nodes} nodes, at or above AEM's json.maximumresults limit. ` +
      'It may have been truncated, so removals are off for this run.');
  }

  const destState = await client.probe(dest);
  if (destState === 'forbidden') {
    throw abort(`Cannot read ${dest} (403). Something is there that your account may not read.`);
  }
  if (destState === 'error') throw abort(`Could not reach ${dest} on this instance.`);
  const mode = destState === 'yes' ? 'sync' : 'create';

  if (mode === 'create') {
    const parent = await client.inspect(parentOf(dest));
    client.assertReadable(parent, 'destination parent');
    if (!parent.exists) {
      throw abort(
        `${parentOf(dest)} does not exist on ${hereIs()} (the destination instance). ` +
          'If that path only exists on the other server, the two instances are the wrong way ' +
          'round — check the Destination instance field. Otherwise create the path first; the ' +
          'Copy page feature does exactly that.'
      );
    }
    if (!src.template) {
      throw abort(`The source page reports no cq:template, so there is nothing to create ${dest} from.`);
    }
  }

  /* Same codebase on both instances is the premise, so a template or component
   * that is not here means something is genuinely wrong - not a difference to
   * work around. It is reported as a blocker rather than silently producing a
   * page that renders empty. */
  const types = new Set();
  if (src.template) types.add(src.template);
  const resourceTypes = new Set();
  for (const rel of Object.keys(src.tree)) {
    const rt = src.tree[rel]['sling:resourceType'];
    if (rt) resourceTypes.add(rt);
  }

  const missingTemplates = (
    await pool([...types], PROBE_CONCURRENCY, async (t) => ({ path: t, at: await client.probe(t) }))
  ).filter((r) => r.at === 'no');

  const missingComponents = (
    await pool([...resourceTypes], PROBE_CONCURRENCY, async (rt) => {
      const at = await client.probe(`/apps/${rt}`);
      if (at === 'yes') return null;
      const libs = await client.probe(`/libs/${rt}`);
      return libs === 'yes' ? null : { path: rt, at };
    })
  ).filter(Boolean);

  /* ---- pair the two trees, then diff them in source coordinates -------- */
  const destTree = mode === 'sync' ? await readPageTree(client, dest) : null;
  const alignment = destTree
    ? alignTrees(src.tree, src.order, destTree.tree, destTree.order)
    : { destToSrc: new Map([['', '']]), decisions: [], addedAtSource: [], missingAtSource: [] };

  const relabelled = destTree ? relabel(destTree.tree, destTree.order, alignment.destToSrc, Object.keys(src.tree)) : null;

  /* ---- which assets have to come across -------------------------------- */
  /* Where an image lands is whatever the reference pointing at it becomes.
   * Running it through the same rewrite is what guarantees the two agree: an
   * asset under the source site moves with the site token, one outside it
   * keeps its path, and neither can drift from the property that names it. */
  const assetRows = await pool(src.assets, PROBE_CONCURRENCY, async (a) => {
    const to = rewriteValue(a.path, ctx);
    const row = {
      from: a.path, to, scope: a.scope, uses: a.uses, size: mb(a.size), bytes: a.size ?? null, delivery: a.delivery || null
    };

    /* Deleted from the source DAM but still served by Dynamic Media: that copy
     * is carried instead, read from the delivery host by the source tab. */
    const via = a.state === 'missing' ? a.delivery?.found?.[0]?.url || null : null;
    if (a.state !== 'ok' && !via) {
      return { ...row, action: a.state === 'missing' ? 'missing at source' : 'unreadable at source' };
    }
    if (via) Object.assign(row, { via, source: 'Dynamic Media' });
    if (!opts.copyAssets) return { ...row, action: 'copying disabled' };

    const here = await client.probe(to);
    if (here === 'forbidden' || here === 'error') return { ...row, action: 'unreadable here' };
    if (here === 'yes' && !opts.overwriteAssets) return { ...row, action: 'already here' };
    /* Not a blocker: the reference to it is still re-pointed, at the path a
     * content package will put it, and the rest of the page goes across. */
    if (a.size > maxAssetBytes(settings)) return { ...row, action: 'too large' };
    return { ...row, action: here === 'yes' ? 'overwrite' : 'upload' };
  });

  /* A reference to an image missing at the source is still written, rewritten
   * like any other. Leaving the property out kept whatever the destination had
   * before - on a page being synced, the OLD image beside the new text and links,
   * which looks right until someone reads it. Pointing at where the image belongs
   * mirrors the source page, broken reference and all, and is listed to do by hand. */
  const missingAssets = new Set();

  /* How much there is to re-point. Counted on the SOURCE values, before
   * anything is rewritten, so it answers "does this page reference /uk at all"
   * rather than "did anything go wrong". Zero here on a cross-site transfer is
   * itself worth seeing. */
  let siteRefs = 0;
  for (const rel of Object.keys(src.tree)) {
    for (const p of Object.keys(src.tree[rel])) {
      siteRefs += leftovers(src.tree[rel][p], ctx).length;
    }
  }

  const site = await siteFor(client, settings, src, sites, opts);


  const d = diff({
    srcTree: src.tree,
    srcOrder: src.order,
    destTree: relabelled?.tree || null,
    destOrder: relabelled?.order || null,
    ctx,
    opts,
    missingAssets,
    assetRe: assetMatcher(src.srcDam)
  });
  atRealPaths(d, relabelled);

  /* ---- folders for the assets being uploaded --------------------------- */
  /* Every ancestor below /content/dam, because an image can now land anywhere
   * in the DAM - not only under this site's folder. Ones that already exist
   * are filtered out by the probe below. */
  const DAM = '/content/dam';
  const folderSet = new Set();
  for (const a of assetRows) {
    if (a.action !== 'upload' && a.action !== 'overwrite') continue;
    const parts = a.to.split('/');
    parts.pop();
    let cur = '';
    for (const seg of parts) {
      if (!seg) continue;
      cur += `/${seg}`;
      if (cur.length > DAM.length && cur.startsWith(`${DAM}/`)) folderSet.add(cur);
    }
  }
  const folders = await pool([...folderSet].sort(), PROBE_CONCURRENCY, async (path) => ({
    path,
    exists: (await client.probe(path)) === 'yes'
  }));

  /* ---- refusals -------------------------------------------------------- */
  const blockers = [];
  if (missingTemplates.length) {
    blockers.push(
      `The source page's template is not on this instance: ${missingTemplates.map((t) => t.path).join(', ')}. ` +
        'The page would be created but would not render.'
    );
  }
  if (missingComponents.length) {
    blockers.push(
      `${missingComponents.length} component type(s) used by the source are not deployed here, ` +
        `starting with ${missingComponents[0].path}. Those components would be empty boxes.`
    );
  }
  /* Not a blocker: a page reworked at the source is a fair thing to transfer.
   * But a wrong pairing - or a source read short - looks just like it, so
   * the run waits for the operator to confirm it: see removalsConfirmed and
   * largeRemovalOf.
   *
   * Not on a page this run has just created. What is on it then came from
   * its template a moment ago, not from anyone's hand, and asking about it
   * after the page was made and the images carried left an empty page
   * behind and nothing written. */
  const largeRemoval =
    mode === 'sync' && !params.pageCreated
      ? largeRemovalOf(d, { here: 'here', tail: 'Check the component pairing below before proceeding.' })
      : null;

  /* Where each node lands here, for the files kept inside the page: a renamed
   * component's file is inside the component it was paired with. */
  const toDest = destResolver(alignment.srcToDest || new Map([['', '']]));
  const binaryRows = binariesByHand(d.binaries, (rel) => `${source}/jcr:content${rel}`, (rel) => `${dest}/jcr:content${toDest(rel)}`);

  const s = summarise({
    mode, source, dest, src, sites, opts, alignment, assetRows, folders, d, blockers, largeRemoval, siteRefs, site,
    binaryRows, maxImageBytes: maxAssetBytes(settings)
  });
  /* The page here is backed up first, if the operator says so (see
     backupFirst in page-upsert) - but not one this run has just made. A
     backup that cannot be looked at is said, not a reason the copy cannot be
     planned. */
  if (mode === 'sync' && !params.pageCreated) s.backup = await backupOrWhy(client, settings, dest);
  report('data', 'analysis', s);
  announceBackup(report, s.backup);

  report('info', `${s.rewrite.srcSite} → ${s.rewrite.destSite}, reading from ${params.sourceOrigin}.`);
  report(
    s.counts.siteRefs ? 'ok' : 'warn',
    `${s.counts.siteRefs} reference(s) to /${s.rewrite.srcSite} found, ` +
      `${s.counts.links} distinct link(s) will be re-pointed` +
      (s.counts.siteRefs ? '.' : ' — unusual for a cross-site transfer, worth a look.')
  );
  report(
    'info',
    `images: ${s.counts.assets} referenced, ${s.counts.uploads} to upload, ` +
      `${s.counts.assets - s.counts.uploads} already there or unusable` +
      (s.counts.shared
        ? ` — ${s.counts.shared} of them outside /${s.rewrite.srcSite}'s folder, ` +
          `${s.counts.sharedToUpload} of those need uploading.`
        : '.')
  );
  if (s.counts.tooLarge) {
    report(
      'warn',
      `${s.counts.tooLarge} image(s) are over the ${mb(s.maxImageBytes)} this transfer carries, so they are ` +
        'left where they are and listed to do by hand. Raise the limit in Settings to carry them.'
    );
  }
  if (s.pairing.renamed) {
    report('warn',
      `${s.pairing.renamed} component(s) here were matched to the source by position and type, ` +
      'not by name. Check the pairing before proceeding.');
  }
  if (s.pairing.ambiguous) {
    report('warn',
      `${s.pairing.ambiguous} of those share a component type with another on the page, so only ` +
      'their order tells them apart. If this page was re-ordered here, the pairing may be wrong.');
  }
  if (s.preserved.length) {
    report('info', `${s.preserved.length} metadata field(s) left as they are, for you to edit.`);
  }
  if (s.site) announceSite(report, s.site);
  if (s.imagesByHand.length) {
    report(
      'warn',
      `${s.imagesByHand.length} image(s) will not be carried, and are listed at the end to do by hand: ` +
        s.imagesByHand.map((a) => `${a.from} (${a.reason})`).join('; ')
    );
  }
  for (const b of blockers) report('fail', b);
  if (!blockers.length) {
    if (largeRemoval) report('warn', `${largeRemoval} It runs only once you confirm the removal.`);
    report('info', `${mode === 'create' ? 'Will create' : 'Will update'} ${dest}. Nothing has been written.`);
  }

  return s;
}

/* -------------------------------------------------------------- summary */

const preview = (v) => {
  const t = typeof v === 'string' ? v : JSON.stringify(v);
  return t == null ? '' : t.length > 160 ? `${t.slice(0, 159)}…` : t;
};

function summarise({
  mode, source, dest, src, sites, opts, alignment, assetRows, folders, d, blockers, largeRemoval, siteRefs, site,
  binaryRows = [], maxImageBytes = MAX_ASSET_BYTES
}) {
  const uploads = assetRows.filter((a) => a.action === 'upload' || a.action === 'overwrite');
  const newFolders = folders.filter((f) => !f.exists);

  const pairs = [];
  for (const dec of alignment.decisions) {
    for (const p of dec.pairs) {
      pairs.push({
        parent: dec.parent,
        source: p.src,
        destination: p.dest,
        kind: (p.kind || '').split('/').pop(),
        renamed: p.renamed,
        ambiguous: p.ambiguous
      });
    }
  }

  const sections = [];
  if (mode === 'create') {
    sections.push({ id: 'page', title: 'Create the page here', count: 1, detail: src.template?.split('/').pop() });
  } else if (opts.versionFirst) {
    sections.push({ id: 'version', title: 'Version this page first', count: 1, detail: 'restore point' });
  }
  if (newFolders.length) sections.push({ id: 'folders', title: 'Create DAM folders', count: newFolders.length });
  if (uploads.length) {
    const known = uploads.filter((a) => a.bytes != null);
    const total = known.reduce((n, a) => n + a.bytes, 0);
    sections.push({
      id: 'assets',
      title: 'Upload images',
      count: uploads.length,
      detail: known.length ? `${known.length < uploads.length ? 'at least ' : ''}${mb(total)}` : undefined
    });
  }
  if (d.nodeAdds.length) sections.push({ id: 'nodes', title: 'Add components', count: d.nodeAdds.length });

  const propCount = d.propAdds.length + d.propUpdates.length + d.propDeletes.length;
  if (propCount) {
    const nodes = new Set([...d.propAdds, ...d.propUpdates, ...d.propDeletes].map((c) => c.rel)).size;
    sections.push({
      id: 'props',
      title: 'Write properties',
      count: propCount,
      detail: `across ${nodes} node${nodes === 1 ? '' : 's'}`
    });
  }
  if (d.nodeDeletes.length) sections.push({ id: 'deletes', title: 'Remove components', count: d.nodeDeletes.length });
  if (d.reorders.length) sections.push({ id: 'order', title: 'Reorder components', count: d.reorders.length });

  /* Images the run will not carry. Not a reason to stop: the page still goes
   * across, and these are listed at the end for someone to do by hand. A 403
   * is kept apart from "missing" all the same - it says something different
   * about the image, and the reference to it is still re-pointed. */
  const BY_HAND = {
    'too large': (a) => `${a.size}, over the ${mb(maxImageBytes)} this transfer carries (Settings)`,
    'unreadable at source': () => 'cannot be read on the source (403)',
    'unreadable here': () => 'cannot be checked here (403)',
    'missing at source': (a) => missingReason(a.delivery, { copied: 'pointed at the path shown' })
  };
  /* Two different jobs: `upload` is an image that exists and belongs at `to`;
   * `missing` is gone from the source DAM and from Dynamic Media - the page
   * points at `to` all the same, and nothing can be carried there. One that
   * Dynamic Media still serves is an upload like any other, not on this list
   * unless carrying it fails. */
  const imagesByHand = assetRows
    .filter((a) => BY_HAND[a.action])
    .map((a) => {
      const reason = BY_HAND[a.action](a);
      if (a.action !== 'missing at source') return { kind: 'upload', from: a.from, to: a.to, reason };
      return { kind: 'missing', from: a.from, to: a.to, reason };
    })
    // Files kept inside the page itself: never written from here, so put in place by hand too.
    .concat(binaryRows);

  const s = {
    mode,
    source,
    dest,
    sourceNodes: src.nodes,
    imagesByHand,
    rewrite: { enabled: sites.enabled, srcSite: sites.srcSite, destSite: sites.destSite },
    pairing: {
      method: alignment.decisions.length ? 'sequence' : 'name',
      pairs,
      renamed: pairs.filter((p) => p.renamed).length,
      ambiguous: pairs.filter((p) => p.ambiguous).length,
      addedAtSource: alignment.addedAtSource,
      missingAtSource: alignment.missingAtSource
    },
    sections,
    // The site values and their tick box.
    site: siteSummary(site, d.siteChanges, { applied: !opts.keepSiteValues, preview }),
    // An existing page's own properties that would change: the review asks before they are written.
    metadata: metadataFor(mode, d, preview),
    props: {
      added: d.propAdds.map((c) => ({ node: relLabel(c.rel), prop: c.prop, to: preview(c.to), kind: c.kind })),
      updated: d.propUpdates.map((c) => ({
        node: relLabel(c.rel), prop: c.prop, from: preview(c.from), to: preview(c.to), kind: c.kind
      })),
      deleted: d.propDeletes.map((c) => ({
        node: relLabel(c.rel), prop: c.prop, was: preview(c.was), reason: c.reason, content: c.content,
        // The page-properties box answers for this one, not the removals box (see removalsFingerprint).
        ...(mode === 'sync' && c.rel === '' ? { metadata: true } : {})
      }))
    },
    preserved: d.preserved.map((c) => ({
      node: relLabel(c.rel), prop: c.prop, kept: preview(c.kept), sourceHas: preview(c.wouldHaveBeen)
    })),
    nodes: {
      added: d.nodeAdds.map((n) => ({ node: n.rel, props: n.props })),
      deleted: d.nodeDeletes.map((n) => ({ node: n.rel, content: n.content })),
      // Left standing with every property of their own gone: listed apart, because they are still on the page.
      emptied: (d.removal?.emptied || []).map((rel) => ({ node: relLabel(rel) })),
      // This page's own - live copy configuration, annotations - left where they are.
      kept: d.keptNodes.map((n) => ({ node: n.rel }))
    },
    links: d.linkChanges.map((l) => ({
      from: l.from, to: l.to, uses: l.uses, on: l.nodes.join(', ')
    })),
    reorders: d.reorders.map((r) => ({ node: r.rel, index: r.index })),
    reorderSkips: d.reorderSkips,
    assets: assetRows,
    folders,
    uploads: uploads.map((a) => ({
      from: a.from, to: a.to, scope: a.scope, bytes: a.bytes, via: a.via || null, urls: a.delivery?.found || null
    })),
    maxImageBytes,
    leftovers: Object.entries(d.leftoverCounts).map(([link, count]) => ({ link, count })),
    ignored: d.ignored,
    typeWarnings: d.typeWarnings,
    binaries: d.binaries.map((b) => ({ node: relLabel(b.rel), file: b.file, state: b.state, size: b.size })),
    blockers,
    largeRemoval,
    counts: {
      properties: propCount,
      uploads: uploads.length,
      siteRefs,
      links: d.linkChanges.length,
      assets: assetRows.length,
      shared: assetRows.filter((a) => a.scope === 'shared').length,
      sharedToUpload: uploads.filter((a) => a.scope === 'shared').length,
      fromDelivery: uploads.filter((a) => a.via).length,
      assetsMissing: assetRows.filter((a) => a.action === 'missing at source').length,
      tooLarge: assetRows.filter((a) => a.action === 'too large').length,
      byHand: imagesByHand.length,
      binaries: d.binaries.length,
      nodesAdded: d.nodeAdds.length,
      nodesDeleted: d.nodeDeletes.length,
      preserved: d.preserved.length,
      leftovers: Object.keys(d.leftoverCounts).length
    }
  };
  // Exactly what the review lists for removal; the run is refused if its own list differs.
  s.removalsFingerprint = removalsFingerprint(s);
  return s;
}

/* ------------------------------------------------------------ execution */

/** Step 1: version or create the page, and make the DAM folders. */
async function prepare({ client, settings, report, params }) {
  client.resetCaches();
  const src = params.sourcePage;
  const { dest, opts } = planFrom({ settings, params });
  const step = (id, state, note) => report('data', 'step', { id, state, note });

  const exists = (await client.probe(dest)) === 'yes';

  // Before the first write: the page's backup here, taken or updated - a backup that fails stops the run.
  if (exists) await backupFirst(client, settings, report, dest, params);

  if (exists && opts.versionFirst) {
    step('version', 'running');
    try {
      // Checked, not assumed - see AemClient.versionPage.
      assertWrite(
        await client.versionPage({
          path: dest,
          label: `pre-transfer ${new Date().toISOString()}`,
          comment: `before transfer from ${params.sourceOrigin}${params.source}`
        }),
        'Saving a version'
      );
    } catch (e) {
      step('version', 'failed');
      throw abort(`${e.message.replace(/\.$/, '')}. Nothing has been written to the page.`);
    }
    report('ok', `versioned  ${dest}`);
    step('version', 'done');
  }

  if (!exists) {
    step('page', 'running');
    /* copyPage cannot reach another server, so the page is created from its
     * template and every node is written afterwards from the source tree. */
    assertWrite(
      await client.createPage({
        parentPath: parentOf(dest),
        label: nameOf(dest),
        title: src.title || humanize(nameOf(dest)),
        template: src.template
      }),
      'createPage'
    );
    client.forgetProbe(dest);
    if ((await client.probe(dest)) !== 'yes') {
      step('page', 'failed');
      throw abort(`createPage reported success but nothing is at ${dest}. Nothing further written.`);
    }
    report('ok', `created  ${dest}`);
    step('page', 'done');
  }

  const newFolders = (params.folders || []).filter((f) => !f.exists);
  if (newFolders.length) {
    step('folders', 'running');
    let n = 0;
    for (const f of newFolders) {
      assertWrite(await client.createFolder(f.path, DAM_FOLDER_TYPE), `create folder ${f.path}`);
      step('folders', 'running', `${++n}/${newFolders.length}`);
    }
    report('ok', `created ${n} DAM folder${n === 1 ? '' : 's'}`);
    step('folders', 'done', String(n));
  }

  return { created: !exists };
}

/* Pieces of the asset arriving from the source tab, until the last one. */
let arriving = null;

/**
 * Step 2, once per piece of each asset: the bytes arrive from the source tab.
 * The pieces are gathered here and the asset is uploaded once, whole, when
 * the last one arrives - DAM never sees part of an image.
 */
async function writeAsset({ client, report, params }) {
  const { to, base64, mime, index, total, offset = 0, done = true, size } = params;
  const step = (note) => report('data', 'step', { id: 'assets', state: 'running', note });
  const of = total ? `${index}/${total} · ` : '';
  if (index === 1 && offset === 0) step();
  const folder = parentOf(to);
  const fileName = nameOf(to);

  try {
    if (offset === 0) arriving = { to, parts: [], received: 0 };
    else if (arriving?.to !== to || arriving.received !== offset) {
      throw abort('a piece of it arrived out of order');
    }
    const bytes = fromBase64(base64);
    arriving.parts.push(bytes);
    arriving.received += bytes.length;

    if (!done) {
      step(`${of}carrying ${mb(arriving.received)} of ${mb(size)}`);
      return { to, received: arriving.received };
    }

    const { parts, received } = arriving;
    arriving = null;

    /* The upload is its own phase, and says so - with its own progress - so a
     * slow one is not mistaken for a stuck one. */
    step(`${of}uploading ${mb(received)}`);
    let shown = -1;
    let unanswered = null;
    try {
      await client.createAsset({
        folder,
        fileName,
        parts,
        mime,
        onProgress: (sent, all) => {
          const pct = all ? Math.floor((sent / all) * 100) : 0;
          if (pct === shown) return;
          shown = pct;
          step(`${of}uploading ${mb(received)} — ${pct}%`);
        }
      });
    } catch (e) {
      // Sent in full but never confirmed: it may be there anyway. Look.
      if (!e.unanswered) throw e;
      unanswered = e;
    }

    /* Looked at, never assumed. A probe that met the sign-in page used to
       answer "yes", so an upload that never arrived was reported as done. */

    client.forgetProbe(to);
    if ((await client.probe(to, { timeout: 30_000 })) !== 'yes') {
      throw unanswered || abort('the upload reported no error, but nothing is there');
    }
    report('ok', `uploaded  ${to}${received > PIECE_BYTES ? ` (${mb(received)})` : ''}`);
    if (total) step(`${index}/${total}`);
    return { to };
  } catch (e) {
    arriving = null;
    /* A session that has ended fails every image after this one and then
       the page: said once, as that, and the panel stops. */
    return { to, skipped: `could not be uploaded here: ${e.message}`, ...(e.signedOut ? { signedOut: true } : {}) };
  }
}

/** Step 3: the content itself. Re-plans first, as the other features do. */
async function apply({ client, settings, report, params }) {
  client.resetCaches();

  const s = await analyze({ client, settings, report: () => {}, params });
  if (s.blockers.length) throw abort(`Refusing to write. ${s.blockers[0]}`);
  const removalsAcked = !!s.largeRemoval && removalsConfirmed(s, params);
  if (s.largeRemoval && !removalsAcked) {
    throw abort(`Refusing to write. ${s.largeRemoval} Analyze again and confirm the removal to go ahead.`);
  }
  /* Ticked, the box must still cover exactly what this plan would change: a
   * page whose properties moved between the review and the click is refused
   * rather than trusted. Unticked is not a refusal - it means leave them as
   * they are, and `keepPageProps` has already taken them out of the plan. */
  if (!params.pageCreated && params.metadataAck && !metadataConfirmed(s, params)) {
    throw abort(metadataRefusal(s));
  }

  const src = params.sourcePage;
  const { dest, opts, ctx, sites } = planFrom({ settings, params });
  const step = (id, state, note) => report('data', 'step', { id, state, note });
  const site = await siteFor(client, settings, src, sites, opts);

  const destTree = await readPageTree(client, dest);
  const alignment = destTree
    ? alignTrees(src.tree, src.order, destTree.tree, destTree.order)
    : { destToSrc: new Map([['', '']]), srcToDest: new Map([['', '']]) };
  const toDest = destResolver(alignment.srcToDest || new Map([['', '']]));

  const relabelled = destTree ? relabel(destTree.tree, destTree.order, alignment.destToSrc, Object.keys(src.tree)) : null;
  const d = diff({
    srcTree: src.tree,
    srcOrder: src.order,
    destTree: relabelled?.tree || null,
    destOrder: relabelled?.order || null,
    ctx,
    opts,
    // As in the analysis: references to missing images are written too.
    missingAssets: new Set(),
    assetRe: assetMatcher(src.srcDam)
  });
  atRealPaths(d, relabelled);

  /* What the template put on a page this run created and the source does
     not have. Removed so the page matches the source - and named, because
     nothing else would say they were ever there. */
  if (params.pageCreated && d.nodeDeletes.length) {
    report(
      'info',
      `The template put ${d.nodeDeletes.length} node${d.nodeDeletes.length === 1 ? '' : 's'} on the new page ` +
        `that the source does not have, so ${d.nodeDeletes.length === 1 ? 'it is' : 'they are'} removed: ` +
        `${d.nodeDeletes.slice(0, 10).map((n) => n.rel).join(', ')}${d.nodeDeletes.length > 10 ? ', …' : ''}.`
    );
  }

  /* ---- the page content: one request, saved whole or not at all -------- */
  /* Components added, properties and components removed all go to AEM as ONE
   * request (core/execute.js): a failure leaves the page here exactly as it
   * was. Only putting components in order follows, a request each.
   *
   * Removals are not re-read from the source: it is on the other server, out
   * of reach from this tab. The guard is that each had no counterpart in a
   * source tree that was read whole - which the truncation check establishes -
   * and that the review's list of them was confirmed (removalsConfirmed). */
  const written = await executeDiff(client, d, {
    page: dest,
    toDest,
    report,
    step,
    // Everything on a page this run just made is the run's own.
    removalsAcked: removalsAcked || params.pageCreated === true
  });
  // All or nothing: no single property can have failed on its own.
  const siteFailed = site ? reportSiteSet(report, site, [...d.propAdds, ...d.propUpdates]) : [];

  // The content is in, but not all of it in order: an error, never "Done.".
  if (written.partial) throw abort(partialRefusal(dest, written));

  const origin = typeof location !== 'undefined' ? location.origin : '';
  const out = { ...s, site: markFailed(s.site, siteFailed), done: true, editorUrl: `${origin}/editor.html${dest}.html` };
  /* The write ran, so this is the end of the run - but not a match. Said as
     a warning naming what did not hold, never as "Done.". */
  if (written.unconfirmed) {
    report('warn', unconfirmedWarning(dest, written.unconfirmed));
    return { ...out, unconfirmed: written.unconfirmed };
  }
  report('ok', `Done. ${dest}`);
  return out;
}

export const actions = { readPage, readAsset, analyze, prepare, writeAsset, apply };
