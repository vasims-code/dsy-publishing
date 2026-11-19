/**
 * Bringing a page from another author instance.
 *
 * This is the one job the panel has to drive itself. Every other tool hands
 * a worker one request and waits; a transfer needs two tabs - the source is
 * read inside its own origin, where its session cookie is, and the
 * destination is written inside its own - and neither can reach the other.
 * So the page, and then each image, is carried between them from here.
 *
 * Nothing here knows how the screens look. It returns what the worker
 * returned, and reports progress the same way a single request would.
 */

import { metadataConfirmed, metadataRefusal, removalsConfirmed } from '../core/protocol.js';
import { finish, newRunId, sendOne, tabFor } from './run.js';

const FEATURE = 'page-transfer';
const hostOf = (o) => String(o || '').replace(/^https?:\/\//, '');

/** Both instances, named rather than assumed, and a tab on each. */
async function endpoints({ sourceOrigin, destOrigin, settings }) {
  if (!sourceOrigin) throw new Error('Pick the source instance.');
  if (!destOrigin) throw new Error('Pick the destination instance.');
  if (sourceOrigin === destOrigin) {
    throw new Error(
      `Source and destination are both ${hostOf(sourceOrigin)}. For a copy within one server, choose "This server".`
    );
  }
  return {
    srcTab: await tabFor(sourceOrigin, settings),
    dstTab: await tabFor(destOrigin, settings)
  };
}

/** What the source tab reads: the page, and its site's home page - or, for a component copy, the component alone. */
const readParams = (p) => ({ source: p.source, srcSite: p.srcSite, ...(p.component ? { component: p.component } : {}) });

const ok = (res, what) => {
  if (!res?.ok) throw new Error(res?.error || `${what} did not answer.`);
  return res.result;
};

/**
 * Copy a component from another server: each page's components for the two
 * pickers, each read by the tab on its own server. Reads only.
 */
export async function components({ params, settings, onReport }) {
  const { srcTab, dstTab } = await endpoints({ ...params, settings });
  const runId = newRunId();
  try {
    const source = ok(
      await sendOne({ featureId: FEATURE, action: 'components', params: { page: params.source }, settings, tabId: srcTab, runId, onReport }),
      'The source tab'
    );
    const dest = ok(
      await sendOne({ featureId: FEATURE, action: 'components', params: { page: params.dest, what: 'destination' }, settings, tabId: dstTab, runId, onReport }),
      'The destination tab'
    );
    return { source, dest };
  } finally {
    await finish(runId, [srcTab, dstTab]);
  }
}

/**
 * Read the source page on its own instance, then plan against the
 * destination. Reads only - nothing is written by either side.
 */
export async function analyze({ params, settings, onReport, log }) {
  const { srcTab, dstTab } = await endpoints({ ...params, settings });
  const runId = newRunId();
  try {
    log?.(`Reading ${params.source} from ${hostOf(params.sourceOrigin)}…`);
    const sourcePage = ok(
      await sendOne({ featureId: FEATURE, action: 'readPage', params: readParams(params), settings, tabId: srcTab, runId, onReport }),
      'The source tab'
    );

    log?.(`Planning against ${hostOf(params.destOrigin)}…`);
    return ok(
      await sendOne({ featureId: FEATURE, action: 'analyze', params: { ...params, sourcePage }, settings, tabId: dstTab, runId, onReport }),
      'This tab'
    );
  } finally {
    await finish(runId, [srcTab, dstTab]);
  }
}

/**
 * The transfer.
 *
 * The source page is read again rather than reusing what the review held:
 * between reviewing and confirming, someone on the other instance may have
 * changed it. The plan is made again against that, and the review's two
 * confirmations are checked against the new plan before anything at all is
 * written - not only by the page write at the end.
 */
export async function commit({ params, settings, onReport, log, step }) {
  const { srcTab, dstTab } = await endpoints({ ...params, settings });
  const runId = newRunId();
  /* Filled as images are carried, and attached to whatever goes wrong after
     that: a run that stops at the page write still knows which images it had
     already given up on, and that list is the only record of them. */
  const byHand = [];
  try {
    const sourcePage = ok(
      await sendOne({ featureId: FEATURE, action: 'readPage', params: readParams(params), settings, tabId: srcTab, runId, onReport }),
      'The source tab'
    );

    const plan = ok(
      await sendOne({ featureId: FEATURE, action: 'analyze', params: { ...params, sourcePage }, settings, tabId: dstTab, runId, onReport }),
      'This tab'
    );

    if (plan.blockers?.length) throw new Error(`Refusing to write. ${plan.blockers[0]}`);
    if (plan.largeRemoval && !removalsConfirmed(plan, params)) {
      /* largeRemoval is the worker's own sentence about what would go; a
         truthy value that is not one still means the same thing. */
      const why = typeof plan.largeRemoval === 'string' ? `${plan.largeRemoval} ` : '';
      throw new Error(
        `Refusing to write. ${why}What would be removed is not what the review showed - analyze again and confirm the removal.`
      );
    }
    /* Only when the box was ticked: unticked means the destination keeps its
       own page properties, which is a choice, not something to refuse. */
    if (params.metadataAck && !metadataConfirmed(plan, params)) throw new Error(metadataRefusal(plan));

    const prepared = ok(
      await sendOne({
        featureId: FEATURE,
        action: 'prepare',
        params: { ...params, sourcePage, folders: plan.folders },
        settings,
        tabId: dstTab,
        runId,
        onReport
      }),
      'This tab'
    );

    /* Images, one at a time, each in pieces. Whatever goes wrong with one -
       unreadable, too large, an upload that fails or never answers - it is
       skipped and the run moves on; the page still goes across pointing
       where each image belongs, and the result lists what to do by hand. */
    const uploads = plan.uploads || [];
    byHand.push(...(plan.imagesByHand || []));
    let carried = 0;

    for (let i = 0; i < uploads.length; i++) {
      const u = uploads[i];
      const why = await carry({ u, index: i + 1, total: uploads.length, srcTab, dstTab, settings, runId, onReport });
      if (why) {
        byHand.push(
          u.via
            ? { kind: 'delivered', from: u.from, to: u.to, reason: why, urls: u.urls || [] }
            : { kind: 'upload', from: u.from, to: u.to, reason: why }
        );
        log?.(`Skipped ${u.from} — ${why}`, 'warn');
      } else {
        carried++;
      }
    }
    if (uploads.length) {
      const skipped = uploads.length - carried;
      step?.('assets', 'done', skipped ? `${carried}/${uploads.length} · ${skipped} skipped` : String(carried));
    }

    const result = ok(
      await sendOne({
        featureId: FEATURE,
        action: 'apply',
        params: { ...params, sourcePage, pageCreated: prepared?.created === true },
        settings,
        tabId: dstTab,
        runId,
        onReport
      }),
      'This tab'
    );
    return { ...result, imagesByHand: byHand };
  } catch (e) {
    if (byHand.length) e.imagesByHand = byHand;
    throw e;
  } finally {
    await finish(runId, [srcTab, dstTab]);
  }
}

/**
 * One image across, piece by piece: each piece is read on the source and
 * handed over before the next is fetched, so no message carries more than a
 * piece and an image of any size goes the same way. Null once it is
 * uploaded; otherwise why it was not.
 */
async function carry({ u, index, total, srcTab, dstTab, settings, runId, onReport }) {
  try {
    for (let offset = 0, done = false; !done; ) {
      const piece = await sendOne({
        featureId: FEATURE,
        action: 'readAsset',
        params: { path: u.from, url: u.via || null, offset },
        settings,
        tabId: srcTab,
        runId,
        onReport
      });
      if (!piece?.ok) return piece?.error || 'the source tab did not answer';
      const r = piece.result;
      if (r.signedOut) throw signedOut(r.skipped);
      if (r.skipped) return r.skipped;

      const wrote = await sendOne({
        featureId: FEATURE,
        action: 'writeAsset',
        params: { to: u.to, base64: r.base64, mime: r.mime, offset, done: r.done, size: r.size, index, total },
        settings,
        tabId: dstTab,
        runId,
        onReport
      });
      if (!wrote?.ok) return wrote?.error || 'this tab did not answer';
      if (wrote.result?.signedOut) throw signedOut(wrote.result.skipped);
      if (wrote.result?.skipped) return wrote.result.skipped;

      offset += r.length;
      done = r.done;
    }
    return null;
  } catch (e) {
    /* A session that has ended is not one image's problem: every image after
       it and then the page would fail the same way, so the run stops here. */
    if (e.signedOut) throw e;
    /* A tab closed or reloaded mid-image. The next image, or the page write,
       will say whether it is gone for good. */
    return e.message;
  }
}

/** A worker's "signed out" reason, as an error the run stops on. */
const signedOut = (why) => Object.assign(new Error(why), { signedOut: true });
