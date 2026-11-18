/**
 * Writing a diff to a page: the one place Sync page and From another server
 * turn "what has to change" (core/diff.js) into requests to AEM.
 *
 * WHY ONE REQUEST
 *
 * Each change used to be its own POST: one per component added, one per
 * node's properties, one per removal. A failure part-way stopped the run with
 * everything before it saved - a page half old, half new - and a property
 * write that failed was only logged, so the run still ended "Done.".
 *
 * Now every change to the page's jcr:content - components added, properties
 * written and removed, components removed - goes in ONE Sling POST
 * (AemClient.writeTree), which AEM saves once: all of it lands, or none of it.
 * The one exception is a page with more changes than AEM takes in one request
 * (LIMITS.maxParams): those go in a few requests, in order, and the run says
 * so before it starts and, if one fails, how far it got.
 *
 * WHAT CANNOT GO IN IT: ORDER
 *
 * Sling's `:order` moves the node a request is aimed at, and only that node -
 * a request aimed at jcr:content cannot also say where `root/hero` goes. So
 * putting components in order stays one small request per component, after
 * the content is saved. If one of those fails, the content is all there but
 * not all in order: the run says so as an error - `partial` - never "Done.",
 * and running it again puts the order right.
 *
 * Before the content write (not here): the version, the page itself, DAM
 * folders and image uploads. Those are separate steps, each checked.
 */

import { abort } from './aem-client.js';
import { byDepth, relLabel } from './diff.js';
import { sameMoment, typeHint } from './rewrite.js';

/* ------------------------------------------------------------- utilities */

/** Run `fn` over `items`, at most `limit` at a time; results in input order. */
export async function pool(items, limit, fn) {
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
 *
 * A binary comes through as Sling's JSON gives it - ":jcr:data": <length> - and
 * is kept, so the diff can see it; the diff never writes it (isBinaryKey).
 */
export function flatten(node, rel, tree, order) {
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

/** A page's jcr:content as { tree, order }, or null when it has none. */
export async function readPageTree(client, page) {
  const json = await client.readTree(`${page}/jcr:content`);
  if (!json) return null;
  const tree = {};
  const order = {};
  flatten(json, '', tree, order);
  return { tree, order };
}

/** A Sling answer that is not a success stops the run, with what AEM said. */
export function assertWrite(r, what) {
  if (!r.success) {
    throw abort(`${what} failed [HTTP ${r.http} / status ${r.effective}]: ${r.message || '(no message returned)'}`);
  }
  return r;
}

/** One property change as Sling POST parameters: a removal, or a value with its type. */
export function pairsForChange(c) {
  if (c.reason) return [[`${c.prop}@Delete`, 'true']];
  const pairs = [[`${c.prop}@TypeHint`, typeHint(c.to)]];
  for (const x of Array.isArray(c.to) ? c.to : [c.to]) pairs.push([c.prop, String(x)]);
  return pairs;
}

/* ------------------------------------------------------------- the write */

/**
 * Sling reads at most 10,000 parameters from one request ("Maximum POST
 * Parameters" in the Sling Main Servlet settings) and will not take more. A
 * whole large page added at once - every component, every property and its
 * type - can pass that. Kept well under it, with room for _charset_ and for
 * an instance set lower than the default. An object so a test can shorten it.
 */
export const LIMITS = { maxParams: 4000 };

/**
 * The groups (one node's parameters each) packed, in order, into as few
 * requests as stay under LIMITS.maxParams. Nearly always one. A node is never
 * split; a single node bigger than the limit goes alone and AEM decides.
 */
export function batchGroups(groups) {
  const batches = [];
  let cur = [];
  for (const g of groups) {
    if (cur.length && cur.length + g.length > LIMITS.maxParams) {
      batches.push(cur);
      cur = [];
    }
    cur.push(...g);
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/** "./root/hero/" for a node's parameters in a request aimed at jcr:content; "./" for jcr:content itself. */
const under = (destRel) => `.${destRel}/`;

/** Sling drops a property posted empty, so "" has landed when the property is not there. */
const holds = (value, want) => sameMoment(value, want) || (want === '' && (value === undefined || value === ''));

/**
 * Read the page back and see whether every change the write made is actually
 * on it. Null when there was nothing to check.
 *
 * "Saved" used to mean "AEM answered 200 with a Sling status in the 200s".
 * That is a statement about the request, not about the page: a write can be
 * accepted and quietly do nothing - a locked page, a protected property, a
 * workflow that reverts it - and the run would still end "Done." with
 * everything exactly as it was. So the page is looked at. Reads only.
 *
 * Everything is looked at, not only the properties written to nodes that
 * were already there. The fault of 1 November left components created and
 * empty, and a check that skipped the properties a new component brings -
 * and skipped any node it could not find - passed exactly that page. A
 * removal is looked at too: a removal-only write that AEM accepted and acted
 * on none of used to end "Done." with everything still there.
 *
 * Never throws: a verification that fails to run must not be reported as a
 * verification that failed.
 */
async function confirmWritten(client, page, d, toDest, removals) {
  const wanted = [...d.propAdds, ...d.propUpdates].map((c) => ({ at: toDest(c.rel), prop: c.prop, to: c.to }));
  for (const n of d.nodeAdds) {
    for (const [prop, to] of Object.entries(n.values || {})) wanted.push({ at: toDest(n.rel), prop, to });
  }
  const props = removals.propDeletes.map((c) => ({ at: toDest(c.rel), prop: c.prop }));
  /* A component removed and added again under the same name (see the order
     of groups in executeDiff) is meant to be there afterwards. */
  const addedAt = new Set(d.nodeAdds.map((n) => toDest(n.rel)));
  const nodes = removals.nodeDeletes.map((n) => n.rel).filter((rel) => !addedAt.has(rel));
  if (!wanted.length && !props.length && !nodes.length) return null;

  let tree;
  try {
    client.resetCaches?.();
    tree = await readPageTree(client, page);
  } catch {
    return null;
  }
  if (!tree) return null;

  const missing = [];
  for (const c of wanted) {
    // A node that is not there holds nothing: it counts against, never past.
    const node = tree.tree[c.at];
    if (!node || !holds(node[c.prop], c.to)) missing.push({ rel: c.at, prop: c.prop, what: node ? 'not written' : 'node missing' });
  }
  for (const c of props) {
    if (tree.tree[c.at] && c.prop in tree.tree[c.at]) missing.push({ rel: c.at, prop: c.prop, what: 'still there' });
  }
  for (const rel of nodes) {
    if (tree.tree[rel]) missing.push({ rel, prop: null, what: 'still there' });
  }
  const checked = wanted.length + props.length + nodes.length;
  return { checked, holding: checked - missing.length, missing };
}

/** One change that did not hold, in a few words. */
const notHolding = (m) => `${relLabel(m.rel)}${m.prop ? ` ${m.prop}` : ''} (${m.what})`;

/**
 * What is actually on the page after a write that failed, in a sentence.
 *
 * Never throws: this runs inside the handling of another error, and a second
 * failure here must not replace the first one anybody needs to read.
 */
async function describeAfterFailure(client, page) {
  try {
    client.resetCaches?.();
    const tree = await readPageTree(client, page);
    if (!tree) return `${page} has no jcr:content at all - open it in AEM before doing anything else.`;

    // Rels start with a slash: 'root' never matched, so the root container was counted as a component.
    const components = Object.keys(tree.tree).filter((rel) => rel && rel !== '/root');
    const withContent = components.filter(
      (rel) => Object.keys(tree.tree[rel]).some((p) => p !== 'jcr:primaryType' && p !== 'sling:resourceType')
    ).length;

    if (!components.length) return `${page} has no components on it.`;
    if (!withContent) {
      return (
        `${page} now has ${components.length} components with no content in any of them - it will render ` +
        'empty. Put it back from the backup or version taken before the run.'
      );
    }
    return `Looking at ${page} now: ${withContent} of its ${components.length} components hold content.`;
  } catch (e) {
    return `${page} could not be read afterwards (${String(e.message).replace(/\.$/, '')}), so check it in AEM.`;
  }
}

/**
 * A plan that would strip the page and put nothing back is refused here,
 * whatever produced it.
 *
 * On 2026-11-01 a transfer between two author instances left every component
 * of the destination standing with nothing in it but its jcr:primaryType -
 * no text, no images, not even its sling:resourceType - and the page rendered
 * empty. What reached AEM was a request of removals with no values in it at
 * all. Why the plan came out that way is not yet known; this is the floor
 * under it, so that whatever the cause, the write cannot land.
 *
 * A run that only removes is perfectly ordinary - a component deleted at the
 * source, a property cleared. What is never ordinary is emptying several
 * components at once while writing nothing anywhere on the page: a real
 * change to a real page always puts something back. THRESHOLD is the number
 * of nodes that have to be emptied before this is sure enough to refuse.
 *
 * Writing one property elsewhere used to excuse the lot: a source read short
 * with one changed value left in it emptied 19 of 20 components and ended
 * "Done.". So emptying THRESHOLD or more components - every property of their
 * own gone, nothing written to them - is refused whatever else the plan
 * writes, unless the review's removals box was ticked for it (`acked`).
 */
export const STRIP_GUARD = { threshold: 3 };

export function assertNotStripping(d, propDeletes, page, { acked = false } = {}) {
  const writes = d.propAdds.length + d.propUpdates.length + d.nodeAdds.length;
  const nodes = new Set(propDeletes.map((c) => c.rel));
  if (!writes && nodes.size >= STRIP_GUARD.threshold) {
    throw abort(
      `Refusing to write. The plan would remove ${propDeletes.length} properties from ${nodes.size} ` +
        `components of ${page} and write nothing anywhere on the page - which would leave it rendering ` +
        'empty. A real copy always puts something back, so this plan is wrong rather than drastic. ' +
        'Nothing has been written. Analyse again, and check that the source page is the one you mean ' +
        'and that it was read whole.'
    );
  }

  // Only the components still being emptied after the live re-check.
  const emptied = (d.removal?.emptied || []).filter((rel) => nodes.has(rel));
  if (acked || emptied.length < STRIP_GUARD.threshold) return;
  throw abort(
    `Refusing to write. The plan would leave ${emptied.length} components of ${page} standing with ` +
      `nothing in them (${emptied.slice(0, 3).map(relLabel).join(', ')}${emptied.length > 3 ? ', …' : ''}), ` +
      'and that was not confirmed. Nothing has been written. Analyse again, check that the source page ' +
      'was read whole, and confirm the removal if it is meant.'
  );
}

/**
 * A page someone else has locked refuses the write and still answers 200,
 * saying nothing about why. Read back, that came out as "AEM accepted the
 * write and answered 200, but not one of the changes checked is on the page",
 * which names the lock last among three guesses - so the author went looking
 * for the wrong thing. The lock is a fact that can be read first, so it is.
 *
 * A lock of your own is not in the way: AEM lets you write through it. A
 * destination that does not exist yet has no properties to read, and a read
 * that fails is left to the write to run into - this is a better message, not
 * another way for a run to stop.
 *
 * Reads `jcr:lockOwner` of the page's jcr:content, which is where the Relative
 * Link Fixer and the Arabic fixer already read it.
 */
export async function lockOwnerOf(client, page) {
  let props = null;
  try {
    props = await client.readProps(`${page}/jcr:content`);
  } catch {
    // Left to the write to run into: this is a better message, not a new refusal.
    return null;
  }
  const lockOwner = props?.['jcr:lockOwner'] || null;
  if (!lockOwner) return null;
  /* Who is signed in, where the instance says. Where it does not, the lock
     still stands - naming the owner beats writing into a page that will keep
     its old content and answer 200. */
  let me = null;
  try {
    me = await client.currentUser?.();
  } catch {
    me = null;
  }
  return me && lockOwner === me ? null : lockOwner;
}

/** The same lock, said at the write - the last check before anything is sent. */
export async function assertNotLocked(client, page) {
  const lockOwner = await lockOwnerOf(client, page);
  if (!lockOwner) return;
  throw abort(
    `Destination page is locked. ${page} is locked by ${lockOwner}, so it cannot be edited. ` +
      'Ask them to unlock it in AEM, then run this again. Nothing has been written.'
  );
}

/** The same lock, said on the review - so nobody reaches the write to find out. */
export const lockBlocker = (page, lockOwner) =>
  `Destination page is locked. ${page} is locked by ${lockOwner}, so it cannot be edited. ` +
  'Ask them to unlock it in AEM, then analyse again.';

/**
 * Write a diff to the page at `page`.
 *
 *   toDest   source rel -> destination rel, for a page whose components were
 *            paired under other names (core/align.js). Removals are already
 *            destination rels and do not go through it.
 *   recheck  optional, async (d) -> { propDeletes, nodeDeletes }: the
 *            removals still to make, after checking them against the live
 *            source. Reads only; runs before anything is written.
 *   step     the panel's progress steps: nodes, props, deletes, order.
 *   removalsAcked  the review's removals box was ticked for exactly this
 *            plan (see assertNotStripping).
 *
 * Throws, with nothing on the page changed, when the content write fails.
 * Otherwise returns what it did, with `partial: true` when the content is
 * saved but some components could not be put in order - which the caller
 * must report as an error, not as done - and `unconfirmed` when the page,
 * read back, holds only some of what was written: the caller must say so
 * rather than claim the destination matches.
 */
export async function executeDiff(
  client,
  d,
  { page, toDest = (rel) => rel, recheck = null, report = () => {}, step = () => {}, removalsAcked = false }
) {
  const root = `${page}/jcr:content`;

  /* Before anything is read back or written: a locked destination takes the
     whole write, answers 200 and keeps its old content. */
  await assertNotLocked(client, page);

  /* Said before the re-check, not after it. `recheck` reads every component
     this plan would remove, live, one at a time - on a big page that is a
     long stretch during which the screen would otherwise show four steps
     waiting and nothing happening. */
  const planned = [
    ['nodes', d.nodeAdds.length],
    ['props', d.propAdds.length + d.propUpdates.length + d.propDeletes.length],
    ['deletes', d.nodeDeletes.length]
  ]
    .filter(([, n]) => n)
    .map(([id]) => id);
  for (const id of planned) step(id, 'running');

  const { propDeletes, nodeDeletes } = recheck
    ? await recheck(d)
    : { propDeletes: d.propDeletes, nodeDeletes: d.nodeDeletes };

  const orders = [...d.reorders];
  const ordered = new Set(orders.map((r) => r.rel));

  /* Each node's parameters are kept together as a group, so that if the page
   * is too big for one request (see writeContent) a node is never split
   * across two. */

  /* Components added: their type and properties, shallowest first so a
   * parent's own type is named before anything is hung under it. */
  const adds = [...d.nodeAdds].sort((a, b) => byDepth(a.rel, b.rel));
  const addGroups = [];
  for (const node of adds) {
    const at = under(toDest(node.rel));
    const group = [];
    for (const [k, v] of node.pairs) {
      // Where it goes among its siblings is a request of its own (see the header).
      if (k === ':order') {
        if (!ordered.has(node.rel)) orders.push({ rel: node.rel, index: Number(v) });
        continue;
      }
      group.push([at + k, v]);
    }
    addGroups.push(group);
  }

  /* Properties, grouped by node so the request reads node by node. */
  const work = new Map();
  for (const c of [...d.propAdds, ...d.propUpdates, ...propDeletes]) {
    if (!work.has(c.rel)) work.set(c.rel, []);
    work.get(c.rel).push(c);
  }
  const propGroups = [];
  for (const [rel, changes] of work) {
    const at = under(toDest(rel));
    const group = [];
    for (const c of changes) for (const [k, v] of pairsForChange(c)) group.push([at + k, v]);
    propGroups.push(group);
  }

  /* Components removed. `name@Delete` removes a child node as readily as a
   * property, and Sling does its removals before its writes. */
  const deleteGroups = nodeDeletes.map((node) => [[`.${node.rel}@Delete`, 'true']]);

  // Removals first: in one request Sling does them first anyway, and split
  // into several, a component removed and added again under the same name
  // must be removed before it is added.
  const groups = [...deleteGroups, ...addGroups, ...propGroups].filter((g) => g.length);
  const pairs = groups.flat();

  assertNotStripping(d, propDeletes, page, { acked: removalsAcked });

  const did = { nodes: adds.length, props: [...work.values()].reduce((n, c) => n + c.length, 0), nodeDeletes: nodeDeletes.length };
  const sections = [
    ['nodes', did.nodes],
    ['props', work.size],
    ['deletes', did.nodeDeletes]
  ].filter(([, n]) => n);

  /* The re-check can empty a section - every component it meant to remove is
     already gone. Said as done rather than left turning for ever. */
  const live = new Set(sections.map(([id]) => id));
  for (const id of planned) if (!live.has(id)) step(id, 'done', 'nothing to do');

  const batches = batchGroups(groups);
  const written = [];
  let unconfirmed = null;
  if (pairs.length) {
    for (const [id] of sections) step(id, 'running');
    if (batches.length > 1) {
      report(
        'warn',
        `The changes to ${page} are too many for one request (${pairs.length} parameters; AEM takes ` +
          `${LIMITS.maxParams} at most), so they go in ${batches.length}, in order. Each is saved whole; ` +
          'if one fails, the ones before it stay saved.'
      );
    }
    for (let i = 0; i < batches.length; i++) {
      try {
        written.push(assertWrite(await client.writeTree(root, batches[i]), 'Saving the page content'));
      } catch (e) {
        for (const [id] of sections) step(id, 'failed');
        const said = String(e.message).replace(/\.$/, '');
        /* "Nothing has changed" used to be asserted from the shape of the
           request. It is now looked at: a page was once left emptied by a run
           that had said its write was all-or-nothing, and nobody knew until
           they opened it. Whatever the answer, it is reported rather than
           assumed - and if the page cannot be read at all, that is said too. */
        const state = await describeAfterFailure(client, page);
        throw abort(
          i === 0
            ? `${said}. ${batches.length === 1 ? 'It was one request, saved whole or not at all' : 'It was the first request'}. ${state}`
            : `${said}. This was request ${i + 1} of ${batches.length}: the ${i} before it are saved, so ${page} ` +
                `is part-way changed. ${state} Put it back from the backup or version taken before the run, or ` +
                'analyse again and run it again.'
        );
      }
    }
    for (const node of adds) report('ok', `component  ${toDest(node.rel)}`);
    for (const node of nodeDeletes) report('ok', `removed  ${node.rel}`);
    if (work.size) report('ok', `wrote properties on ${work.size} node${work.size === 1 ? '' : 's'}`);
    report(
      'ok',
      batches.length === 1
        ? `saved the page content in one request (${pairs.length} parameters)`
        : `saved the page content in ${batches.length} requests (${pairs.length} parameters)`
    );

    /* Sling's own account of what it changed, where the answer carries one.
     * A 200 with an empty ChangeLog is a write that was accepted and did
     * nothing, which reads exactly like a write that worked. */
    const changed = written.reduce((n, r) => (r.changes ? n + r.changes.length : n), 0);
    const counted = written.some((r) => r.changes);
    if (counted) report('info', `AEM reports ${changed} change${changed === 1 ? '' : 's'} made.`);

    /* Multipart went through and did nothing, and the same pairs form-encoded
       did the work. Worth saying: it is a fact about this instance, not about
       this page, and it will be true of the next run too. */
    if (written.some((r) => r.multipartWasEmpty)) {
      report(
        'warn',
        'This instance accepted the write as multipart and acted on none of it, so it was sent again ' +
          'form-encoded. That is what landed. A very large page may meet the server form size limit ' +
          'this way - if one does, it will say so rather than go quiet.'
      );
    }

    const check = await confirmWritten(client, page, d, toDest, { propDeletes, nodeDeletes });
    if (check) {
      report(
        check.holding === check.checked ? 'ok' : 'fail',
        `read back ${page}: ${check.holding} of ${check.checked} changes are on the page` +
          (check.holding === check.checked
            ? '.'
            : `. Not holding: ${check.missing.slice(0, 5).map(notHolding).join(', ')}` +
              `${check.missing.length > 5 ? `, and ${check.missing.length - 5} more` : ''}.`)
      );
      if (!check.holding && check.checked) {
        for (const [id] of sections) step(id, 'failed');
        throw abort(
          `AEM accepted the write and ${counted ? `reported ${changed} changes, but` : 'answered 200, but'} ` +
            `not one of the ${check.checked} changes checked is on ${page}. ` +
            'Nothing has changed on the page. Check that your account may write there, and that the ' +
            'page is not locked or checked in.'
        );
      }
      if (check.holding < check.checked) {
        unconfirmed = {
          checked: check.checked,
          holding: check.holding,
          missing: check.missing.slice(0, 20).map(notHolding),
          more: Math.max(0, check.missing.length - 20)
        };
      }
    }

    for (const [id, n] of sections) step(id, 'done', String(n));
  }

  /* ---- order: one request per component, after the content is in -------- */
  const orderFailed = [];
  if (orders.length) {
    step('order', 'running');
    let n = 0;
    for (const r of orders) {
      try {
        assertWrite(await client.orderNode(`${root}${toDest(r.rel)}`, r.index), `order ${relLabel(r.rel)}`);
        n++;
      } catch (e) {
        orderFailed.push(toDest(r.rel));
        report('fail', `could not put ${toDest(r.rel)} in order: ${e.message}`);
      }
      step('order', 'running', `${n}/${orders.length}`);
    }
    report('ok', `reordered ${n} component${n === 1 ? '' : 's'}`);
    step('order', orderFailed.length ? 'failed' : 'done', String(n));
  }

  return {
    requests: batches.length + orders.length,
    ...did,
    ordered: orders.length - orderFailed.length,
    orderFailed,
    partial: orderFailed.length > 0,
    unconfirmed
  };
}

/**
 * The words for a write that ran but did not all land, the same from both
 * features: how much holds, and the first few that do not.
 */
export function unconfirmedWarning(page, u) {
  return (
    `Written, but only ${u.holding} of the ${u.checked} changes are on ${page} when it is read back. ` +
    `Not there: ${u.missing.slice(0, 5).join(', ')}${u.missing.length + u.more > 5 ? `, and ${u.missing.length + u.more - 5} more` : ''}. ` +
    'Open the page and check it before anyone publishes it.'
  );
}

/** Why a run whose content landed but whose order did not is an error: the same words from both features. */
export function partialRefusal(page, result) {
  const n = result.orderFailed.length;
  return (
    `Not finished. The page content was saved in one go, but ${n} component${n === 1 ? '' : 's'} could not ` +
    `be put in order (${result.orderFailed.slice(0, 5).join(', ')}${n > 5 ? ', …' : ''}). Everything is on ` +
    `${page}; run it again to put the order right.`
  );
}
