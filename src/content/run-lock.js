/**
 * One run at a time in a tab.
 *
 * Two side panels - one per window - can both point a run at the same tab.
 * Left alone, their requests interleave: two writes to one page at once, and
 * Bring a page from another server keeps the image it is carrying in this
 * tab between requests, which a second run would trample. So a tab belongs to
 * one run, by its run id, until that run lets go.
 *
 * A run is often several requests in a row - read the page, plan, prepare,
 * one per image piece, write - and the tab cannot see where it ends. So a run
 * keeps the tab between its requests, and lets go when its panel says it has
 * finished. A panel closed mid-run never says so: then the tab lets go by
 * itself once that run has sent nothing for IDLE_MS. Reloading the tab lets
 * go at once, because the lock lives in the page.
 *
 * Kept free of Chrome and the page, so it can be run in a test with a clock.
 */

/** How long a run that has gone quiet keeps the tab. */
export const IDLE_MS = 2 * 60 * 1000;

/** The message a panel sends a tab when its run is over: the tab is free again. */
export const RELEASE = 'aemt:release';

const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
};

export function createRunLock({ idleMs = IDLE_MS, now = () => Date.now() } = {}) {
  /** { runId, feature, action, startedAt, lastAt, running, released } - or null when the tab is free. */
  let holder = null;

  const quiet = () => holder && holder.running === 0 && now() - holder.lastAt > idleMs;

  return {
    /**
     * A request is about to run. `{ ok: true, done }` - call done() when it
     * has finished, whatever happened - or `{ ok: false, busy: true, error }`
     * when another run has the tab. A request with no run id never keeps the
     * tab, and only runs while nobody else has it.
     */
    claim(runId, feature, action) {
      if (quiet()) holder = null;
      if (holder && holder.runId !== runId) {
        return {
          ok: false,
          busy: true,
          error:
            `Busy: another run is in progress on this tab (${holder.feature}, started ${ago(now() - holder.startedAt)} ago). ` +
            'Nothing was done. Wait for it to finish, then try again - if nothing is running any more, reload this tab.'
        };
      }
      if (!runId) return { ok: true, done() {} };

      holder ||= { runId, feature, startedAt: now(), lastAt: now(), running: 0, released: false };
      const mine = holder;
      mine.running++;
      mine.action = action;
      let finished = false;
      return {
        ok: true,
        done() {
          if (finished) return;
          finished = true;
          mine.running--;
          mine.lastAt = now();
          if (mine.released && mine.running === 0 && holder === mine) holder = null;
        }
      };
    },

    /** The run is over: the tab is free - once any request of it still going has finished. */
    release(runId) {
      if (!holder || holder.runId !== runId) return;
      if (holder.running === 0) holder = null;
      else holder.released = true;
    },

    /** Who has the tab now, for a test or a log line. */
    get holder() {
      return holder && !quiet() ? { ...holder } : null;
    }
  };
}
