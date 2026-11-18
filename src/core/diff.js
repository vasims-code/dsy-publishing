/**
 * The diff: what has to change at the destination for it to match the source.
 *
 * Pure - no network, no DOM. Both the same-server sync and the cross-server
 * transfer run through this, so the rails built into it (a property naming an
 * asset that is not at the source is left alone, an empty multi-value is not
 * pretended to be writable, a removal is only ever proposed from a tree that
 * was read whole) hold for both without being written twice.
 *
 * It is path-keyed. Two pages that were authored separately do not share paths,
 * so the caller relabels the destination tree into source coordinates first -
 * see core/align.js. That keeps the inference in one place and leaves this
 * function knowing nothing about it.
 *
 * `destTree` null means the destination will be a byte-identical copy of the
 * source, so the only differences are the ones rewriting introduces - which is
 * exactly what a create needs to show before it runs.
 */

import {
  SYSTEM_PROPS,
  assetsIn,
  isEmptyArray,
  leftovers,
  rewriteTokens,
  rewriteValue,
  sameMoment,
  sameValue,
  typeHint
} from './rewrite.js';
import { LOCALE_OWNED, contentHash } from './protocol.js';

export const byDepth = (a, b) => a.split('/').length - b.split('/').length;
export const relLabel = (rel) => rel || '(page properties)';

/* ----------------------------------------------------- what a change is */

const ASSET_FILE = /\.(jpe?g|png|gif|svg|webp|avif|bmp|tiff?|ico|mp4|webm|mov|m4v|glb|usdz|pdf)$/i;

/** A whole value that names an image or another DAM asset: a DAM path, a Dynamic Media URL, a media file. */
export const isAssetRef = (s) =>
  /^\/content\/dam\//.test(s) ||
  /^(https?:)?\/\/[^/\s]+\/is\/(image|content)\//i.test(s) ||
  (!/\s/.test(s) && ASSET_FILE.test(s.split(/[?#]/)[0]));

/** A whole value that is a link: a path, a URL, an anchor - but not a colour like #ffffff. */
const isLinkRef = (s) =>
  !/\s/.test(s) && !/^#[\da-f]{3,8}$/i.test(s) && (/^\//.test(s) || /^(https?:)?\/\//i.test(s) || /^(www\.|mailto:|tel:|#)/i.test(s));

/**
 * What a property change is, for the review: 'image', 'link' or 'other'. The
 * image paths and links a run re-points are many and alike; the text and
 * settings in between are what someone reads for sense, so they are kept apart.
 *
 * An image or a link is a value that IS one, before and after - or a value
 * whose only change is the site rewrite of the references inside it, like a
 * rich text whose links now point at the other site. A text that changed
 * otherwise is text, whatever links it holds.
 */
export function changeKind(from, to, ctx) {
  const strings = (v) => (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
  const all = [...strings(from), ...strings(to)];
  if (all.length && all.every(isAssetRef)) return 'image';
  if (all.length && all.every((s) => isAssetRef(s) || isLinkRef(s))) return 'link';
  if (ctx?.rules?.length && !sameValue(from, to) && sameValue(rewriteValue(from, ctx), to)) {
    // Only images re-pointed is an image change; any link - to this site or another one - makes it a link change.
    // 'dam:<folder>' is another DAM folder ticked on the review - images too.
    const imagesOnly = { ...ctx, rules: ctx.rules.filter((r) => r.id === 'dam' || r.id.startsWith('dam:')) };
    return imagesOnly.rules.length && sameValue(rewriteValue(from, imagesOnly), to) ? 'image' : 'link';
  }
  return 'other';
}

/**
 * The page's own properties a diff would change - add, update or remove - as
 * sorted names. On a page that already exists these are what someone may have
 * put right by hand, so the review asks before they are written.
 */
export const pagePropsChanged = (d) =>
  [...new Set([...d.propAdds, ...d.propUpdates, ...d.propDeletes].filter((c) => c.rel === '').map((c) => c.prop))].sort();

/**
 * The review's page-properties choice, or null: only for a page that is
 * already there.
 *
 * `rows` carries both values - what the destination has now and what the
 * source would put there - because "canonical would be overwritten" is not
 * something anyone can decide on. Seeing the two addresses is. `preview`
 * shortens a long value the same way the rest of the review does.
 */
export const metadataFor = (mode, d, preview = (v) => v) => {
  if (mode !== 'sync') return null;
  /* What would change, plus what the box is holding back. Without the second
     half, unticking the box would empty this list and take the box with it. */
  const held = (d.preserved || []).filter((x) => x.rel === '' && x.why === 'box');
  const props = [...new Set([...pagePropsChanged(d), ...held.map((x) => x.prop)])].sort();
  if (!props.length) return null;

  const now = new Map();
  const would = new Map();
  for (const x of held) {
    now.set(x.prop, x.kept);
    would.set(x.prop, x.wouldHaveBeen);
  }
  for (const c of [...d.propAdds, ...d.propUpdates]) {
    if (c.rel !== '') continue;
    if (!now.has(c.prop)) now.set(c.prop, c.from);
    would.set(c.prop, c.to);
  }
  /* A removal has no new value: the source does not have the property at all. */
  for (const c of d.propDeletes || []) {
    if (c.rel !== '' || would.has(c.prop)) continue;
    // A removal carries what is there now as `was`; it has no `from`.
    now.set(c.prop, c.was);
    would.set(c.prop, undefined);
  }

  /* Undefined stays undefined: run through `preview` it became '', and the
     row said "(empty)" for a value the run would clear. */
  const shown = (m, prop) => (m.get(prop) === undefined ? undefined : preview(m.get(prop)));
  const rows = props.map((prop) => ({ prop, now: shown(now, prop), would: shown(would, prop) }));
  return { count: props.length, props, rows };
};

const kb = (n) => (Number.isFinite(n) ? (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : 'size unknown');

/**
 * The files kept inside the page that a run leaves alone (see `binaries` in
 * diff), as rows for the review's list of things to do by hand - with the
 * images, because that is what they almost always are. `srcAbs` and `destAbs`
 * turn a node's rel into its full path on each side.
 */
export function binariesByHand(binaries, srcAbs, destAbs) {
  return (binaries || []).map((b) => ({
    kind: 'upload',
    binary: true,
    from: srcAbs(b.file),
    to: destAbs(b.rel),
    reason:
      b.state === 'new'
        ? `a file kept inside the page, not in the DAM (${kb(b.size)}). File data cannot be written from here, ` +
          'so this part of the component is left out - add the file to the component by hand in the page editor.'
        : `the file kept inside the page differs here (${kb(b.size)} at the source, ${kb(b.destSize)} here). ` +
          'File data cannot be written from here, so the one here is left as it is - replace it by hand in the page editor.'
  }));
}

/** JS object key order is not child order when a name is all digits. */
const hasNumericChild = (names) => names.some((n) => /^\d+$/.test(n));

/**
 * A binary, as Sling's JSON gives it: ":jcr:data": 48213 - the name with a
 * colon in front, and its length instead of its bytes. Never something to
 * write: Sling ignores a parameter that starts with a colon, so a new file
 * node arrived without the data it must have and the request failed half-way,
 * and a changed file counted as written while nothing changed.
 */
export const isBinaryKey = (p) => p.startsWith(':');

/**
 * Nodes that belong to the destination page itself, whatever the source has:
 * never added, changed or removed - them and everything under them.
 *
 *   cq:LiveSyncConfig  what makes a live copy a live copy. Removing it cuts the
 *                      page off from its blueprint; copying the source's would
 *                      tie it to the wrong one.
 *   cq:annotations     the review notes authors leave on a page.
 *
 * `keepAtDest` does the same for properties; settings can add node names here
 * (`opts.keepNodesAtDest`), never take these away.
 */
export const KEEP_NODES = ['cq:LiveSyncConfig', 'cq:annotations'];

/** Below this many components taken away or emptied, a plan is not held for a confirmation - unless it is all of them. */
export const REMOVAL_ACK = { components: 3 };

/** A value Sling cannot hold: it removes a property posted empty rather than keep "". */
const unwritable = (v) => isEmptyArray(v) || v === '';

export function diff({ srcTree, srcOrder, destTree, destOrder, ctx, opts, missingAssets, assetRe }) {
  /* The locale-owned properties are never the source page's to give, whatever
     a caller's settings say: on a destination that lacks them, "preserved"
     still wrote the source's publish date and localContent flag. */
  const never = new Set([...SYSTEM_PROPS, ...LOCALE_OWNED, ...opts.keepAtDest]);
  const keepNodes = new Set([...KEEP_NODES, ...(opts.keepNodesAtDest || [])]);
  // A name the transfer's alignment moved aside ("name|here", core/align.js) is still that name.
  const keptNode = (rel) => rel.split('/').some((n) => keepNodes.has(n.split('|')[0]));

  /* Preserved, as distinct from never touched: an existing value at the
   * destination is left exactly as it is, but a destination that has no value
   * still gets the source's. On a page being created that means the source's
   * metadata arrives as a starting point to edit; on a page that already has
   * its own, nothing is overwritten. Blocking the write outright would leave a
   * new page with empty SEO fields, which is worse than a wrong one.
   *
   * PAGE PROPERTIES ONLY. The list is names like `description`, `jcr:title`
   * and `keywords` - which are also perfectly ordinary component property
   * names. Applied everywhere, "preserve the page description" would quietly
   * freeze the body copy of every text component on the page. */
  const preserve = new Set(opts.preserveAtDest || []);
  /* `keepPageProps` is the review's page-properties box, unticked: every page
     property the destination already has is left exactly as it is, not only
     the ones that cannot be derived. A property the destination does NOT have
     still gets the source's, because an empty field is not something anyone
     chose to keep. */
  const preserved_ = (rel, p) => rel === '' && (opts.keepPageProps || preserve.has(p));
  const simulated = !destTree;

  /* Site values - the handle, the title ending, the language - read off the two
   * sites' home pages (core/site-values.js), page properties only. Ticked, they
   * are what is written. Unticked (`keepSiteValues`), a value already on the
   * page is left exactly as it is and a page without one gets the source's, as
   * a preserved field would. Listed in `siteChanges` either way, so the review
   * shows what the box is about whichever way it is set. */
  const siteValues = opts.siteValues || {};
  const siteChanges = [];
  const dTree = destTree || srcTree;
  const dOrder = destOrder || srcOrder;
  const destRels = new Set(Object.keys(dTree));

  const propAdds = [];
  const propUpdates = [];
  const propDeletes = [];
  const nodeAdds = [];
  const nodeDeletes = [];
  const reorders = [];
  const reorderSkips = [];
  /* The destination's own nodes (KEEP_NODES) the source does not have - left
   * where they are, and listed so the review can say so. */
  const keptNodes = [];
  const ignored = [];
  const preserved = [];
  /* Each reference the run re-points, grouped by what it was. Recorded only for
   * properties actually being written - a link on a property the destination
   * already has right is not a change anyone needs to review. DAM paths are
   * left out because they have their own table, with the upload beside them. */
  const linkChanges = new Map();
  const typeWarnings = [];
  const leftoverCounts = {};

  /* Files kept inside the page - an image uploaded straight into a component
   * rather than picked from the DAM: an nt:file whose jcr:content holds the
   * bytes. They cannot be written from here (see isBinaryKey), so they are
   * listed to do by hand instead of half-made:
   *
   *   new      not at the destination. The node is left out, and with it the
   *            nt:file around it when that is new too - an nt:file cannot exist
   *            without its content - and everything below.
   *   changed  at both, with a different length. Left as it is. (The same
   *            length cannot be told apart from the same file.)
   *
   * `opts.rebuilt`: a page being created is built node by node from the source
   * (another server's page), not copied with its files - so on the review of a
   * create, every file is a new one.
   */
  const binaries = [];
  const binaryRoots = [];
  const destHas = (rel) => (simulated && opts.rebuilt ? rel === '' : !!dTree[rel]);
  for (const rel of Object.keys(srcTree).sort(byDepth)) {
    if (keptNode(rel)) continue;
    const keys = Object.keys(srcTree[rel]).filter(isBinaryKey);
    if (!keys.length) continue;
    const props = keys.map((k) => k.slice(1));
    const size = srcTree[rel][keys[0]];
    if (destHas(rel)) {
      const differs = keys.filter((k) => dTree[rel][k] !== srcTree[rel][k]);
      if (differs.length) binaries.push({ rel, file: rel, props, state: 'changed', size, destSize: dTree[rel][differs[0]] });
      continue;
    }
    if (!opts.addMissingNodes) continue;
    const parent = rel.slice(0, rel.lastIndexOf('/'));
    const root = !destHas(parent) && srcTree[parent]?.['jcr:primaryType'] === 'nt:file' ? parent : rel;
    if (binaryRoots.some((r) => root === r || root.startsWith(`${r}/`))) continue;
    binaryRoots.push(root);
    binaries.push({ rel: root, file: rel, props, state: 'new', size });
  }
  const leftOut = (rel) => binaryRoots.some((r) => rel === r || rel.startsWith(`${r}/`));

  const noteLeftovers = (v) => {
    for (const l of leftovers(v, ctx)) {
      // Kept pointing at the source on purpose - the operator chose to - is not something left over.
      if (ctx.kept?.(l)) continue;
      leftoverCounts[l] = (leftoverCounts[l] || 0) + 1;
    }
  };

  const damRoot = ctx.sites?.srcDam;
  const noteLinks = (rel, prop, original) => {
    for (const t of rewriteTokens(original, ctx)) {
      if (damRoot && t.from.startsWith(damRoot)) continue;
      const key = `${t.from}\u0000${t.to}`;
      const seen = linkChanges.get(key);
      if (seen) {
        seen.uses++;
        if (seen.nodes.length < 6 && !seen.nodes.includes(relLabel(rel))) seen.nodes.push(relLabel(rel));
      } else {
        linkChanges.set(key, { from: t.from, to: t.to, uses: 1, nodes: [relLabel(rel)] });
      }
    }
  };

  /** A property naming an asset that is not in the source DAM is left alone. */
  const missingAssetIn = (v) => {
    if (!missingAssets.size) return null;
    for (const a of assetsIn(v, assetRe)) if (missingAssets.has(a)) return a;
    return null;
  };

  for (const rel of Object.keys(srcTree).sort(byDepth)) {
    // The destination's own - its live copy configuration, its annotations - whatever the source has.
    if (keptNode(rel)) continue;
    const sProps = srcTree[rel];
    const dProps = dTree[rel];

    if (!dProps) {
      if (!opts.addMissingNodes || leftOut(rel)) continue;

      const parent = rel.slice(0, rel.lastIndexOf('/'));
      const name = rel.split('/').pop();
      const index = (srcOrder[parent] || []).filter((n) => !leftOut(`${parent}/${n}`) && !keptNode(`${parent}/${n}`)).indexOf(name);

      const pairs = [];
      if (sProps['jcr:primaryType']) pairs.push(['jcr:primaryType', sProps['jcr:primaryType']]);
      if (opts.reorder && index > -1) pairs.push([':order', String(index)]);

      let count = 0;
      // What each property should read back as, for the check after the write.
      const values = {};
      for (const p of Object.keys(sProps)) {
        // Dates are written too: typeHint says Date, so they arrive as dates.
        if (never.has(p) || isBinaryKey(p)) continue;
        const miss = missingAssetIn(sProps[p]);
        if (miss) {
          ignored.push({ node: relLabel(rel), prop: p, asset: miss });
          continue;
        }
        const v = rewriteValue(sProps[p], ctx);
        // Sling cannot write a zero-length multi-value or an empty string, and
        // for every AEM component an absent property and an empty one mean the same thing.
        if (unwritable(v)) continue;
        pairs.push([`${p}@TypeHint`, typeHint(v)]);
        for (const x of Array.isArray(v) ? v : [v]) pairs.push([p, String(x)]);
        values[p] = v;
        noteLeftovers(v);
        count++;
      }

      nodeAdds.push({ rel, props: count, pairs, values });
      continue;
    }

    if (
      sProps['jcr:primaryType'] &&
      dProps['jcr:primaryType'] &&
      sProps['jcr:primaryType'] !== dProps['jcr:primaryType']
    ) {
      typeWarnings.push({
        node: relLabel(rel),
        source: sProps['jcr:primaryType'],
        destination: dProps['jcr:primaryType']
      });
    }

    for (const p of Object.keys(sProps)) {
      if (never.has(p) || isBinaryKey(p)) continue;
      const miss = missingAssetIn(sProps[p]);
      if (miss) {
        ignored.push({ node: relLabel(rel), prop: p, asset: miss });
        continue;
      }

      let want = rewriteValue(sProps[p], ctx);
      let site = false;
      const have = dProps[p];

      if (rel === '' && Object.hasOwn(siteValues, p)) {
        // A field this destination keeps as its own stays its own: no site value either.
        const kept = preserved_(rel, p) && !simulated && have !== undefined;
        // What unticking leaves: the value already on the page - on a page being created, the source's.
        const leave = have !== undefined && !simulated;
        if (!kept) {
          if (!sameValue(siteValues[p], have)) {
            siteChanges.push({ rel, prop: p, from: have, to: siteValues[p], keeps: leave ? have : want });
          }
          if (opts.keepSiteValues && leave) continue;
        }
        if (!opts.keepSiteValues) {
          want = siteValues[p];
          site = true;
        }
      }
      noteLeftovers(want);

      if (have === undefined) {
        /* An empty string included: Sling drops it, so it never arrives, and
           planning it again on every run is a change that never happens. */
        if (unwritable(want)) continue;
        propAdds.push({ rel, prop: p, to: want, ...(site ? { kind: 'site' } : {}) });
      } else if (!sameMoment(want, have)) {
        /* Nothing to preserve on a page that does not exist yet: `simulated`
         * stands the source in for the destination, and treating the source's
         * own value as something to protect would report a field as kept when
         * the run is about to write it. */
        if (preserved_(rel, p) && !simulated) {
          /* `why` separates the two reasons a page property is kept: the
             review's box, which can be turned off, and the ones that are
             never derivable and are always kept. Only the first belongs in
             what the box offers. */
          const why = !preserve.has(p) && opts.keepPageProps ? 'box' : 'always';
          preserved.push({ rel, prop: p, kept: have, wouldHaveBeen: want, why });
          continue;
        }
        if (isEmptyArray(want)) {
          // The closest reachable state is "not set".
          if (opts.deleteExtras) {
            propDeletes.push({ rel, prop: p, was: have, reason: 'emptied at source' });
          }
          continue;
        }
        if (!site) noteLinks(rel, p, sProps[p]);
        propUpdates.push({ rel, prop: p, from: have, to: want, kind: site ? 'site' : changeKind(have, want, ctx) });
      }
    }

    if (opts.deleteExtras && !simulated) {
      for (const p of Object.keys(dProps)) {
        if (never.has(p) || isBinaryKey(p) || p in sProps) continue;
        if (preserved_(rel, p)) {
          /* Held back by the box is listed with the box. Left out, the review
             (box unticked) never named this removal, the run (box ticked)
             planned it, and every ticked run was refused for a property
             nobody had been shown. */
          if (!preserve.has(p) && opts.keepPageProps) {
            preserved.push({ rel, prop: p, kept: dProps[p], wouldHaveBeen: undefined, why: 'box' });
          }
          continue;
        }
        propDeletes.push({ rel, prop: p, was: dProps[p], reason: 'absent at source' });
      }
    }
  }

  if (opts.deleteExtras && !simulated) {
    const srcSet = new Set(Object.keys(srcTree));
    // Shallowest first, so a node already covered by a queued ancestor can be
    // recognised as covered; reversed afterwards because a child must go first.
    const kept = [];
    for (const rel of [...destRels].filter((r) => r && !srcSet.has(r)).sort(byDepth)) {
      if (keptNode(rel)) {
        if (!keptNodes.some((k) => rel.startsWith(`${k.rel}/`))) keptNodes.push({ rel });
        continue;
      }
      if (kept.some((n) => rel.startsWith(`${n.rel}/`))) continue;
      kept.push({ rel });
    }
    nodeDeletes.push(...kept.reverse());
  }

  if (opts.reorder && !simulated) {
    for (const rel of Object.keys(srcTree)) {
      if (leftOut(rel) || keptNode(rel)) continue;
      // A node left out is not there to put in order; the rest close up around it.
      const want = (srcOrder[rel] || []).filter((n) => !leftOut(`${rel}/${n}`) && !keptNode(`${rel}/${n}`));
      const have = dOrder[rel] || [];
      if (!want.length) continue;

      if (hasNumericChild(want) || hasNumericChild(have)) {
        reorderSkips.push({ node: relLabel(rel), reason: 'numeric child name - order cannot be read reliably' });
        continue;
      }

      const common = want.filter((k) => have.includes(k));
      const haveCommon = have.filter((k) => want.includes(k));
      const added = want.filter((k) => !have.includes(k));
      if (sameValue(common, haveCommon) && !added.length) continue;

      want.forEach((name, index) => reorders.push({ rel: `${rel}/${name}`, index }));
    }
  }

  /* What the plan takes away, in components: those removed outright, with
     everything under them, and those left standing with every property of
     their own gone. The second is what 1 November looked like, and a plan
     that also writes one property somewhere else is no less of it. */
  const isComponent = (rel) => !!rel && rel !== '/root' && !keptNode(rel);
  /* A layout container is not counted as a component of its own: the grid
     stays when everything in it goes, and "5 of the 6" read as if something
     was left. */
  const isContainer = (rel) => /(^|\/)(responsivegrid|container|parsys)$/.test(String(dTree[rel]?.['sling:resourceType'] || ''));
  const counted = (rel) => isComponent(rel) && !isContainer(rel);
  const under = (rel, top) => rel === top || rel.startsWith(`${top}/`);
  const total = [...destRels].filter(counted).length;
  const removed = simulated
    ? 0
    : [...destRels].filter((r) => counted(r) && nodeDeletes.some((n) => under(r, n.rel))).length;
  const writtenTo = new Set([...propAdds, ...propUpdates].map((c) => c.rel));
  const deletedFrom = new Map();
  for (const c of propDeletes) {
    if (!deletedFrom.has(c.rel)) deletedFrom.set(c.rel, new Set());
    deletedFrom.get(c.rel).add(c.prop);
  }
  const emptied = [];
  for (const [rel, gone] of deletedFrom) {
    if (!isComponent(rel) || writtenTo.has(rel)) continue;
    const own = Object.keys(dTree[rel] || {}).filter(
      (p) => !never.has(p) && !isBinaryKey(p) && p !== 'jcr:primaryType' && p !== 'sling:resourceType'
    );
    if (own.length && own.every((p) => gone.has(p))) emptied.push(rel);
  }

  /* What each removal takes away, as it is now. The review's confirmation is
     for these contents, not only these names: a colleague's edit to a
     component between the review and the click gives another fingerprint. */
  const byName = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
  const contentOf = (top) =>
    contentHash(
      JSON.stringify(
        [...destRels].filter((r) => under(r, top)).sort().map((r) => [r, Object.entries(dTree[r]).sort(byName)])
      )
    );
  for (const n of nodeDeletes) n.content = contentOf(n.rel);
  for (const c of propDeletes) c.content = contentHash(JSON.stringify(c.was));

  return {
    propAdds,
    propUpdates,
    propDeletes,
    nodeAdds,
    nodeDeletes,
    removal: { total, removed, emptied },
    reorders,
    reorderSkips,
    ignored,
    preserved,
    siteChanges,
    linkChanges: [...linkChanges.values()].sort((a, b) => a.from.localeCompare(b.from)),
    typeWarnings,
    binaries,
    keptNodes,
    leftoverCounts,
    destCount: destRels.size
  };
}

/**
 * Whether a plan takes away enough that the run waits for the operator to
 * confirm it, as the sentence the review shows - or null.
 *
 * It used to count only components removed outright, and only past a quarter
 * of the page. A source read short with one property left in it emptied 19 of
 * 20 components with no confirmation at all, and an empty source grid took
 * all five of a small page's. So now: every component on the page, or three
 * or more of them, removed or emptied - whatever else the plan writes.
 *
 * `here` names the destination ("here", "at the destination"); `tail` is the
 * feature's own advice on what to check.
 */
export function largeRemovalOf(d, { here = 'here', tail = '' } = {}) {
  const { total, removed, emptied } = d.removal || { total: 0, removed: 0, emptied: [] };
  const gone = removed + emptied.length;
  if (!gone) return null;
  if (gone < REMOVAL_ACK.components && gone < total) return null;
  const parts = [];
  if (removed) parts.push(`remove ${removed} of the ${total} components ${here}`);
  if (emptied.length) {
    parts.push(
      (removed ? `leave ${emptied.length} more` : `leave ${emptied.length} of the ${total} components ${here}`) +
        ' standing with nothing in them'
    );
  }
  const all = gone >= total ? ' - every component on the page' : '';
  return `This would ${parts.join(' and ')}${all}.${tail ? ` ${tail}` : ''}`;
}
