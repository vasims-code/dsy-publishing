/**
 * Backup, as the design draws it.
 *
 * Four steps: pick the page, review the destination in the repository, watch
 * it run, read the result. The analysis reads only; nothing is written until
 * the amber button on Review.
 *
 * There is no separate confirm step here, unlike the Link Fixer: the review
 * IS the confirmation, because the tree already shows every path that will be
 * touched and what will happen to it.
 */

import { icon } from '../icons.js';
import {
  button,
  busyButton,
  connPill,
  counts,
  el,
  footerBar,
  kv,
  label,
  list,
  notice,
  stepBar,
  toTop,
  openInAem
} from '../parts.js';
import { logBox, makeLog } from '../log.js';
import { runAction } from '../run.js';
import { pathRows, tree } from '../tree.js';
import { backupPathFor, globalBackupPathFor, isGlobalPage } from '../../core/paths.js';

const STEPS = ['Pick', 'Review', 'Run', 'Done'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

/**
 * Where the backup goes, worked out the way the worker does (destinationFor
 * in page-copy): a global page goes into the backup folder of the site typed,
 * every other page into its own site's. Throws the worker's own reason, so
 * "Goes to" never shows a path the run would refuse.
 */
function destinationFor(source, targetSite, settings) {
  const depth = settings?.rootDepth ?? 3;
  return isGlobalPage(source, depth)
    ? globalBackupPathFor(source, targetSite, depth, settings?.backupFolder)
    : backupPathFor(source, depth, settings?.backupFolder);
}

/** The pages a run writes: those it creates, and the one it copies or updates. */
function writtenPaths(summary) {
  const paths = (summary?.create || []).map((c) => c.path);
  if (summary?.copy) paths.push(summary.copy.path);
  if (summary?.update) paths.push(summary.update.path);
  return new Set(paths);
}

/** What each path in the destination will have done to it. */
function marksFrom(summary) {
  const marks = {};
  for (const c of summary.create || []) marks[c.path] = 'create';
  for (const s of summary.skip || []) marks[s.path] = 'skip';
  if (summary.copy) marks[summary.copy.path] = 'copy';
  if (summary.update) marks[summary.update.path] = summary.upToDate ? 'current' : 'update';
  return marks;
}

export async function render(ctx) {
  const { view, footer, state, goHome } = ctx;

  const own = ctx.own;
  /* Every line a run reports, kept so a failure leaves an account of itself
     (see ui/log.js). It lives on the tool's state, so leaving the tool drops
     it with everything else. */
  if (!own.log) own.log = makeLog(() => {
    if (own.phase === 'running') redraw();
  });

  if (!own.phase) {
    Object.assign(own, {
      phase: 'pick',
      source: null,
      targetSite: '',
      summary: null,
      result: null,
      problem: null,
      busy: null,
      ackRemovals: false,
      steps: {}
    });
  }

  if (own.source == null) own.source = state.page?.path || '';

  const redraw = () => ctx.render();
  /* A change of step starts at the top; a redraw leaves the scroll alone. */
  const goStep = (phase) => {
    own.phase = phase;
    toTop();
    redraw();
  };
  const phaseIndex =
    own.phase === 'running'
      ? own.busy === 'run'
        ? 2
        : 0
      : { pick: 0, review: 1, done: 3 }[own.phase];

  view.append(
    connPill({
      host: String(state.origin || '').replace(/^https?:\/\//, ''),
      signedIn: !state.session || state.session.state === 'in' || state.session.state === 'unknown'
    }),
    stepBar(STEPS, phaseIndex)
  );

  if (own.problem) {
    view.append(notice('err', 'That did not work', own.problem, 'warn'));
    view.append(logBox(own.log.lines, { open: true, title: 'What happened' }));
  }

  /* ------------------------------------------------------------ 1. pick */

  if (own.phase === 'pick') {
    view.append(
      notice('read', 'Read-only until you confirm', 'Analyze works out the paths. Nothing is written yet.'),
      label('Page to back up')
    );

    const field = el('div', 'field');
    field.append(el('div', 'field-label', 'Page'));
    const input = el('input');
    input.type = 'text';
    input.value = own.source;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Page to back up');
    input.placeholder = '/content/samsung/levant/home-appliances/buying-guide/microwaves';
    input.addEventListener('input', () => {
      own.source = input.value.trim();
      showTarget();
    });
    field.append(input);
    field.append(
      el('div', 'field-hint', 'Filled in from the page open in this tab. Change it to back up a different page.')
    );
    view.append(field);

    /* A global page has no backup folder of its own, so it needs the site it
       is backed up into. Drawn always and hidden otherwise, so typing the
       path never redraws the screen under the cursor. */
    const siteField = el('div', 'field');
    siteField.append(el('div', 'field-label', 'Target site'));
    const siteInput = el('input');
    siteInput.type = 'text';
    siteInput.value = own.targetSite;
    siteInput.spellcheck = false;
    siteInput.setAttribute('aria-label', 'Target site');
    siteInput.placeholder = 'levant';
    siteInput.addEventListener('input', () => {
      own.targetSite = siteInput.value.trim();
      showTarget();
    });
    siteField.append(
      siteInput,
      el('div', 'field-hint', 'A global page is backed up into another site\'s backup folder. Type just the site name, e.g. levant.')
    );
    view.append(siteField);

    /* Where the backup will go, worked out from the path as it is typed. */
    view.append(label('Goes to'));
    const targetBox = el('div', 'dash-box');
    let targetOk = false;
    let go = null;
    const showTarget = () => {
      let global = false;
      try {
        global = isGlobalPage(own.source, state.settings?.rootDepth ?? 3);
      } catch {
        // A path paths.js refuses: the box below says why.
      }
      siteField.hidden = !global;
      try {
        targetBox.textContent = destinationFor(own.source, own.targetSite, state.settings);
        targetBox.dataset.state = 'ok';
        targetOk = true;
      } catch (e) {
        targetBox.textContent = own.source ? e.message : 'Enter a page above';
        targetBox.dataset.state = 'none';
        targetOk = false;
      }
      // The run would refuse what has no destination, so Analyze waits for one.
      if (go) go.disabled = !own.source.startsWith('/content/') || !targetOk;
    };
    const targetField = el('div', 'field');
    targetField.append(
      el('div', 'field-label', 'Backup page'),
      targetBox,
      el('div', 'field-hint', 'The source path with the backup folder inserted under the site root. Change the folder in Settings.')
    );
    view.append(targetField);
    showTarget();

    view.append(label('What happens'));
    const what = (iconName, text) => {
      const r = el('div', 'what-row');
      r.append(icon(iconName, 18, 1.9), el('div', null, text));
      return r;
    };
    view.append(
      list([
        what('folder', 'Goes into the backup folder. Missing pages on the way are created empty.'),
        what('deck', 'Only this page is copied — child pages are not.'),
        what('link', 'Internal links stay exactly as they are.'),
        what('history', 'If a backup already exists, only the differences are written.')
      ])
    );

    go = button('Analyze paths', 'primary', doAnalyze, {
      disabled: !own.source.startsWith('/content/') || !targetOk
    });
    footer.append(
      ...footerBar({
        tag: { kind: 'read', text: 'Read-only' },
        note: '1 page',
        buttons: [go]
      })
    );
    return;
  }

  /* ---------------------------------------------------------- 2. review */

  if (own.phase === 'review') {
    const s = own.summary;
    const exists = s.mode === 'update';

    view.append(
      s.upToDate
        ? notice('ok', 'Already up to date', 'The backup matches the source. Nothing will be written.', 'check')
        : notice(
            'read',
            'Preview only · nothing is written yet',
            exists
              ? 'The backup is already there. Only what differs from the source is written.'
              : 'The backup is not there. It will be created.'
          )
    );

    view.append(
      counts([
        { n: s.counts.create, label: 'to create' },
        { n: s.counts.skip, label: 'already there' },
        {
          n: s.copy ? 1 : s.update ? 1 : 0,
          label: s.copy ? 'copied in full' : s.upToDate ? 'up to date' : 'updated',
          tone: s.upToDate ? null : 'ok'
        }
      ])
    );

    const from = el('div', 'fromto');
    from.append(el('span', 'fromto-label', 'from'), el('span', 'mono', s.source));
    view.append(from);

    view.append(tree('Destination in the repository', pathRows(s.dest, marksFrom(s))));

    if (!s.upToDate) {
      view.append(
        notice(
          'read',
          'Links are left alone',
          'Internal links inside the page stay exactly as they are, so the backup points where the live page does.',
          'link'
        ),
        notice(
          'warn',
          'The backup page is not versioned',
          'If a backup is already there, its content is replaced by whatever is written.',
          'warn'
        )
      );
    }

    /* Updating a backup can remove what the source no longer has. A lot of
       removals can mean the wrong pages were picked, so the run refuses
       unless the review's box was ticked for exactly this list. */
    const sync = s.sync;
    const bigRemoval = !!sync?.largeRemoval;
    if (bigRemoval) {
      view.append(
        notice(
          'warn',
          'That is a lot to remove',
          `${sync.largeRemoval} Check these are the right pages.`,
          'warn'
        )
      );
      const wrap = el('label', 'check-row');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = own.ackRemovals;
      box.setAttribute('aria-label', 'These are the right pages - remove them anyway');
      box.addEventListener('change', () => {
        own.ackRemovals = box.checked;
        redraw();
      });
      const text = el('div', 'check-text');
      text.append(el('div', 'check-title', 'These are the right pages — remove them anyway'));
      wrap.append(box, text);
      view.append(list([wrap]));
    }
    const heldBack = bigRemoval && !own.ackRemovals;

    const pages = s.counts.create + (s.copy || s.update ? 1 : 0);
    footer.append(
      ...footerBar({
        tag: s.upToDate ? { kind: 'read', text: 'Preview only' } : { kind: 'write', text: 'Changes AEM' },
        note: s.upToDate ? 'Nothing to write' : plural(pages, 'page'),
        buttons: [
          s.upToDate
            ? button('Nothing to update', 'write', null, { disabled: true })
            : button(
                heldBack ? 'Tick the removals box to continue' : exists ? 'Update the backup' : 'Create the backup',
                'write',
                doRun,
                { iconName: 'pen', disabled: heldBack }
              ),
          button('Change the page', 'ghost', () => {
            own.summary = null;
            goStep('pick');
          })
        ]
      })
    );
    return;
  }

  /* ------------------------------------------------------------- 3. run */

  if (own.phase === 'running') {
    const writing = own.busy === 'run';
    view.append(
      writing
        ? notice('write', 'Creating the backup', 'Keep this panel open until it finishes.', 'pen')
        : notice('read', 'Reading the repository', 'Nothing is written while it reads.', 'eye')
    );

    if (own.summary && writing) {
      /* The worker also reports the pages already there as it passes them;
         counting those made "6 of 1 pages written". Only pages it writes count. */
      const writes = writtenPaths(own.summary);
      const total = writes.size;
      const done = Object.entries(own.steps).filter(([path, v]) => v === 'done' && writes.has(path)).length;
      const now = Object.entries(own.steps).find(([, v]) => v === 'running');
      const big = el('div', 'big-card');
      const num = el('div', 'big-num');
      num.append(el('span', 'big-n', String(done)), el('span', 'big-of', `of ${total} pages written`));
      const bar = el('div', 'big-bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(total));
      bar.setAttribute('aria-valuenow', String(done));
      const fill = el('div', 'big-bar-fill');
      fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
      bar.append(fill);
      big.append(num, bar);
      view.append(big);
      if (now) {
        const line = el('div', 'field-hint');
        line.append('Now writing ', el('b', null, now[0].split('/').pop()));
        view.append(line);
      }
    }
    if (own.summary) {
      view.append(
        tree(writing ? 'Progress' : 'Destination in the repository', pathRows(own.summary.dest, marksFrom(own.summary)), own.steps)
      );
      view.append(
        el('div', 'field-hint', 'The same tree, filling in as it runs. A row that fails stops the run.')
      );
    }

    view.append(logBox(own.log.lines));
    footer.append(
      ...footerBar({
        tag: writing ? { kind: 'write', text: 'Writing to AEM' } : { kind: 'read', text: 'Read-only' },
        note: writing ? 'Keep this panel open' : 'Nothing is written',
        buttons: [busyButton(writing ? 'Copying…' : 'Working…')]
      })
    );
    return;
  }

  /* ------------------------------------------------------------ 4. done */

  const r = own.result || {};
  const dest = r.dest || own.summary?.dest || '';

  view.append(notice('ok', 'Backup ready', 'The page was copied into the backup folder.', 'check'));

  const made = own.summary?.counts?.create || 0;
  view.append(
    counts([
      { n: 1, label: own.summary?.mode === 'update' ? 'page updated' : 'page copied', tone: 'ok' },
      { n: made, label: made === 1 ? 'page created' : 'pages created' },
      { n: 0, label: 'problems' }
    ])
  );

  /* The backup's own path is the one thing worth carrying away from here. */
  view.append(label('Where it went'));
  const from = el('div', 'fromto');
  from.append(el('span', 'fromto-label', 'from'), el('span', 'mono', own.summary?.source || own.source));
  const to = el('div', 'fromto');
  to.append(el('span', 'fromto-label', 'to'), el('span', 'mono', dest));
  view.append(from, to);

  if (own.summary) {
    const written = {};
    for (const path of writtenPaths(own.summary)) written[path] = 'done';
    view.append(tree('What was written', pathRows(own.summary.dest, marksFrom(own.summary)), written));
    /* What the worker actually checks, and no more: a copy is read back as a
       page with its content and the source's template; an update reads each
       write back from the page; pages made on the way are only created. */
    view.append(
      el(
        'div',
        'field-hint',
        own.summary.mode === 'update'
          ? 'Each change was read back from the backup afterwards to check it landed.'
          : 'The copied page was read back afterwards: it is there as a page, with its content and the source\'s template. Pages created on the way are empty.'
      )
    );
  }

  view.append(
    list([
      kv('Links', 'Left as they are'),
      kv('Child pages', 'Not copied'),
      kv('Server', String(state.origin || '').replace(/^https?:\/\//, ''))
    ])
  );

  view.append(
    notice(
      'read',
      'Want to go back to it later?',
      'Open Versions on the backup page to see every saved version and restore one.',
      'history'
    )
  );

  /* The account of the run, under its result. */
  view.append(logBox(own.log.lines));

  footer.append(
    ...footerBar({
      buttons: [
        button('Open backup in AEM', 'primary', () => {
          openInAem(state.origin, r.editorUrl || (dest && `/editor.html${dest}.html`));
        }),
        button('Back up another page', 'link', () => {
          reset(own);
          own.source = state.page?.path || '';
          redraw();
        }),
        button('Back to tools', 'ghost', () => {
          reset(own);
          goHome();
        })
      ]
    })
  );

  /* ---------------------------------------------------------- the work */

  /** The paths, plus the confirmation the run refuses to write without. */
  function runParams() {
    const p = { source: own.source, targetSite: own.targetSite };
    const sync = own.summary?.sync;
    if (sync?.largeRemoval && own.ackRemovals) {
      p.removalsAck = {
        nodes: sync.counts?.nodesDeleted || 0,
        props: sync.props?.deleted?.length || 0,
        fingerprint: sync.removalsFingerprint
      };
    }
    return p;
  }

  async function doAnalyze() {
    own.log?.clear();
    own.problem = null;
    own.busy = 'analyze';
    goStep('running');
    try {
      own.summary = await runAction({
        featureId: 'page-copy',
        action: 'analyze',
        params: { source: own.source, targetSite: own.targetSite },
        settings: state.settings,
        tabId: state.tab?.id,
        onReport: (msg) => own.log.onReport(msg)
      });
      own.ackRemovals = false;
      own.phase = 'review';
    } catch (e) {
      own.log?.add('fail', e.message);
      own.problem = e.message;
      own.phase = 'pick';
    }
    own.busy = null;
    toTop();
    redraw();
  }

  async function doRun() {
    own.log?.clear();
    own.problem = null;
    own.busy = 'run';
    own.steps = {};
    goStep('running');
    try {
      own.result = await runAction({
        featureId: 'page-copy',
        action: 'run',
        params: runParams(),
        settings: state.settings,
        tabId: state.tab?.id,
        onReport: (msg) => {
          own.log.onReport(msg);
          /* The worker names the path it is on, so progress lands on the row
             it belongs to instead of scrolling past in a log. */
          if (msg.level !== 'data' || msg.message !== 'step' || !msg.data?.path) return;
          own.steps[msg.data.path] = msg.data.state;
          if (own.phase === 'running') redraw();
        }
      });
      own.phase = 'done';
    } catch (e) {
      own.log?.add('fail', e.message);
      own.problem = e.message;
      own.phase = 'review';
    }
    own.busy = null;
    toTop();
    redraw();
  }
}

function reset(own) {
  own.phase = 'pick';
  own.summary = null;
  own.result = null;
  own.problem = null;
  own.busy = null;
  own.steps = {};
}
