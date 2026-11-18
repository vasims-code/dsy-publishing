/**
 * Versions, as the design draws it.
 *
 * Pick a page, read its history straight from the repository, then restore a
 * version or save the current content as a new one. Listing works on any
 * page; restoring and creating only on a backup page, because that is the
 * rule the worker enforces - so the list says so plainly rather than letting
 * you pick something that will be refused.
 *
 * The confirmation is a dialog over the list, not a step of its own: what it
 * asks about is the row you just picked, and that row should stay in view.
 */

import { icon } from '../icons.js';
import {
  button,
  busyButton,
  connPill,
  el,
  footerBar,
  kv,
  label,
  list,
  notice,
  runStep,
  startingStep,
  stepBar,
  toTop,
  openInAem,
  whatHappens
} from '../parts.js';
import { logBox, makeLog } from '../log.js';
import { runAction } from '../run.js';
import { insideBackupFolder } from '../../core/paths.js';

const STEPS = ['Pick', 'Versions', 'Run', 'Done'];

/**
 * Whether this page is one the worker will write a version on - asked with
 * the worker's own rule, so the screen never offers what it will refuse.
 */
const isBackupPage = (page, settings) => {
  try {
    return insideBackupFolder(page, settings?.backupFolder || 'india/backup', settings?.rootDepth ?? 3);
  } catch {
    return false;
  }
};

/** "29 Oct 2026, 14:02" - the repository's own stamp, read the way a person would. */
function when(iso) {
  if (!iso) return 'date unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'date unknown';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Whether the page's content differs from the version it is sitting on.
 *
 * The worker compares the content itself, because the timestamps cannot
 * answer it: AEM writes a fresh cq:lastModified when it restores, so a page
 * put back to version 1 looks "edited since" the moment the restore finishes.
 * When the comparison could not be made the answer is null, and nothing is
 * claimed either way.
 */
function editedSince(r) {
  if (!r.drift?.changed) return null;
  const base = r.versions?.find((v) => v.current);
  if (!base) return null;
  return { base, at: r.live?.lastModified || null, by: r.live?.lastModifiedBy || null };
}

/**
 * The page sits on a version, but whether it still holds that version's
 * content could not be checked - a page too big to read whole, say. Not
 * knowing is not "unchanged": the screen has to say so, and still let the
 * version be restored or the current content saved.
 */
function notCompared(r) {
  const base = r.versions?.find((v) => v.current);
  if (!base || r.drift?.changed === true || r.drift?.changed === false) return null;
  return { base, why: r.drift?.why || null };
}

export async function render(ctx) {
  const { view, footer, state, goHome, openTool } = ctx;

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
      page: null,
      listing: null,
      picked: null,
      asking: null,
      message: '',
      result: null,
      problem: null,
      busy: null,
      steps: []
    });
  }

  if (own.page == null) own.page = state.page?.path || '';

  const redraw = () => ctx.render();
  const goStep = (phase) => {
    own.phase = phase;
    toTop();
    redraw();
  };

  const phaseIndex =
    own.phase === 'running'
      ? own.busy === 'list'
        ? 0
        : 2
      : { pick: 0, versions: 1, done: 3 }[own.phase];

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
      notice('read', 'Preview only', 'Reading the history writes nothing.'),
      label('Which page?')
    );

    if (state.page) {
      const card = el('div', 'page-card');
      card.dataset.selected = String(state.page.path === own.page);
      const ic = el('div', 'tool-icon');
      ic.append(icon('deck', 20));
      const text = el('div', 'tool-text');
      text.append(
        el('div', 'page-card-eyebrow', 'Page open in AEM'),
        el('div', 'page-card-title', state.page.title),
        el('div', 'page-card-path', state.page.path)
      );
      card.append(ic, text);
      if (state.page.path === own.page) {
        const tag = el('span', 'page-card-tag');
        tag.append(icon('check', 12, 3), el('span', null, 'Selected'));
        card.append(tag);
      }
      view.append(card);
    }

    const field = el('div', 'field');
    field.append(el('div', 'field-label', 'Page'));
    const input = el('input');
    input.type = 'text';
    input.value = own.page;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Page');
    input.placeholder = '/content/samsung/lb/india/backup/air-conditioners/wall-mount';
    input.addEventListener('input', () => {
      own.page = input.value.trim();
      go.disabled = !own.page.startsWith('/content/');
    });
    field.append(input);
    field.append(
      el('div', 'field-hint', 'Filled in from the page open in this tab. Change it to look at another page.')
    );
    view.append(field);

    view.append(
      ...whatHappens([
        ['history', 'Lists every version saved for the page, including ones the Timeline does not show.'],
        ['back', 'Restore: the page goes back to the version you pick. Child pages are never changed.'],
        ['copy', 'Create: saves the current content as a new version, with your message.'],
        ['folder', 'Restore and Create only work on backup pages (under /india/backup/). Any page can be listed.']
      ])
    );

    const go = button('Show versions', 'primary', doList, {
      disabled: !own.page.startsWith('/content/')
    });
    footer.append(
      ...footerBar({
        tag: { kind: 'read', text: 'Preview only' },
        note: 'No changes yet',
        buttons: [go]
      })
    );
    return;
  }

  /* -------------------------------------------------------- 2. versions */

  if (own.phase === 'versions') {
    /* No list to draw - nothing should reach here without one, but a blank
       screen would be the worst way to find out. */
    if (!own.listing) {
      own.phase = 'pick';
      queueMicrotask(redraw);
      return;
    }
    const r = own.listing;
    const canWrite = isBackupPage(r.page, state.settings);
    const picked = r.versions.find((v) => v.id === own.picked) || null;

    if (r.neverVersioned || !r.versions.length) {
      view.append(
        notice('warn', 'No saved versions', 'Nothing has ever been versioned on this page.', 'warn')
      );
    } else if (canWrite) {
      view.append(
        notice('read', 'Preview only · nothing is written yet', 'You confirm before anything is restored.')
      );
    } else {
      view.append(
        notice(
          'warn',
          'Listing only',
          'This is not a backup page, so nothing here can be restored or saved. Back the page up first, then open Versions on the backup.',
          'warn'
        )
      );
    }

    const page = el('div', 'card page-summary');
    const text = el('div', 'tool-text');
    text.append(
      el('div', 'page-card-eyebrow', 'Page'),
      el('div', 'page-card-title', r.title || r.page.split('/').pop()),
      el('div', 'page-card-path', r.page)
    );
    const drift = editedSince(r);
    const unknown = notCompared(r);
    if (r.versions.length) {
      text.append(
        el(
          'div',
          'page-card-note',
          `${r.versions.length} saved ${r.versions.length === 1 ? 'version' : 'versions'}` +
            (r.currentNumber ? ` · on version ${r.currentNumber}` : '') +
            (drift ? ', changed since' : unknown ? ', not compared' : '')
        )
      );
    }
    const change = el('button', 'label-action', 'Change');
    change.type = 'button';
    change.addEventListener('click', () => {
      own.listing = null;
      own.picked = null;
      goStep('pick');
    });
    page.append(text, change);
    view.append(page);

    if (drift) {
      const box = notice(
        'warn',
        `The page no longer matches version ${drift.base.number}`,
        `Its content has been changed since that version was saved${
          drift.at ? `, last on ${when(drift.at)}${drift.by ? ` by ${drift.by}` : ''}` : ''
        }. Those changes are in no version. Save the current content as a version before restoring, or they are gone.`,
        'warn'
      );
      view.append(box);
    }

    if (unknown) {
      view.append(
        notice(
          'warn',
          `Could not compare the page with version ${unknown.base.number}`,
          `So it is not known whether the page has been changed since that version was saved${
            unknown.why ? ` (${unknown.why})` : ''
          }. If it has, those changes are in no version - save the current content as a version before restoring to keep them.`,
          'warn'
        )
      );
    }

    if (r.versions.length) {
      view.append(label('Saved versions'));
      view.append(
        list(
          r.versions.map((v) => versionRow(v, own, canWrite, redraw, drift ? 'changed' : unknown ? 'unknown' : null))
        )
      );
    }

    /* What restoring the picked version would actually do. The page is
       already on one of these: picking that one is either nothing at all, or
       - when the page has been edited since - undoing those edits. Saying
       "Restore" for all three hides the difference. */
    const onThisOne = !!picked && picked.id === r.versions.find((v) => v.current)?.id;
    // Only a comparison that ran can say there is nothing to do.
    const nothingToDo = onThisOne && !drift && !unknown;
    const restoreLabel = !picked
      ? 'Pick a version to restore'
      : nothingToDo
        ? `Already on version ${picked.number}`
        : onThisOne && drift
          ? `Undo the changes since version ${picked.number}`
          : onThisOne
            ? `Restore version ${picked.number} again`
            : `Restore version ${picked.number}`;

    footer.append(
      ...footerBar({
        tag: canWrite && !nothingToDo ? { kind: 'write', text: 'Changes AEM' } : { kind: 'read', text: canWrite ? 'Nothing to write' : 'Read-only' },
        note: canWrite
          ? picked
            ? nothingToDo
              ? 'The page already holds it'
              : onThisOne && unknown
                ? 'Not compared with the page'
                : `Version ${picked.number} selected`
            : 'Pick a version'
          : 'Listing only',
        buttons: canWrite
          ? [
              button(restoreLabel, 'write', () => {
                own.asking = 'restore';
                redraw();
              }, { disabled: !picked || nothingToDo, iconName: 'history' }),
              button('Save current content as a version', 'link', () => {
                own.asking = 'create';
                own.message = '';
                redraw();
              })
            ]
          : [
              button('Restore selected version', 'write', null, { disabled: true }),
              /* The design sends you where this can be done, not back to
                 the start: a page with no backup needs one first. */
              button('Back this page up first', 'ghost', () => {
                reset(own);
                openTool('backup');
              })
            ]
      })
    );

    if (own.asking === 'restore' && picked) view.append(restoreDialog(picked, r, own, state, doRestore, redraw, onThisOne && !!drift));
    if (own.asking === 'create') view.append(createDialog(r, own, doCreate, redraw));
    return;
  }

  /* ------------------------------------------------------------- 3. run */

  if (own.phase === 'running') {
    const writing = own.busy !== 'list';
    view.append(
      writing
        ? notice('write', 'Writing to AEM', 'Keep this panel open until it finishes.', 'pen')
        : notice('read', 'Reading the history', 'Nothing is written while it reads.', 'eye')
    );
    view.append(label('What is happening'));
    view.append(
      list(
        own.steps.length ? own.steps.map(runStep) : [startingStep()]
      )
    );
    footer.append(
      ...footerBar({ buttons: [busyButton(writing ? 'Working…' : 'Reading versions…')] })
    );
    return;
  }

  /* ------------------------------------------------------------ 4. done */

  const d = own.result || {};
  /* A restore AEM accepted but that could not be read back is not a success
     to headline: it ran, so this is the Done step, but the top of it says
     what is not known rather than a green "back to version N". */
  const unconfirmed = !!d.restored && d.confirmed === false;
  view.append(
    unconfirmed
      ? notice(
          'warn',
          'Restore not confirmed',
          `AEM accepted the restore of version ${d.restoredNumber ?? d.restored}, but the page could not be read back to check it now holds that version${
            d.why ? ` (${d.why})` : ''
          }. Open the page and check it before editing.`,
          'warn'
        )
      : notice(
          'ok',
          d.title || 'Done',
          d.restored
            ? `The page is back to version ${d.restoredNumber ?? d.restored}.`
            : 'The current content is saved as a new version.',
          'check'
        )
  );

  view.append(
    label('What changed'),
    list(
      [
        kv('Page', d.page || own.page, true),
        d.restored ? kv(unconfirmed ? 'Asked to restore' : 'Restored', `Version ${d.restoredNumber ?? ''} · ${d.restored}`) : null,
        d.created ? kv('New version', String(d.created)) : null,
        kv('Child pages', 'Never changed'),
        kv('Server', String(state.origin || '').replace(/^https?:\/\//, ''), true)
      ].filter(Boolean)
    )
  );

  /* The account of the run, under its result. */
  view.append(logBox(own.log.lines));

  footer.append(
    ...footerBar({
      buttons: [
        button('Show versions again', 'primary', doList),
        button('Open page in AEM', 'ghost', () => {
          openInAem(state.origin, d.editorUrl || (own.page && `/editor.html${own.page}.html`));
        }),
        button('Back to tools', 'link', () => {
          reset(own);
          goHome();
        })
      ]
    })
  );

  /* ---------------------------------------------------------- the work */

  /**
   * Read the history. `carried` is the failure of a write just before: the
   * list is read again under it, so what is drawn is the page as it is now.
   * (As a click handler it is handed an event, which is not a message.)
   */
  async function doList(carried) {
    const before = typeof carried === 'string' ? carried : null;
    const keepPicked = before ? own.picked : null;
    own.problem = null;
    own.asking = null;
    own.busy = 'list';
    own.steps = [{ name: 'Reading the version history', state: 'running' }];
    goStep('running');
    try {
      own.listing = await runAction({
        featureId: 'page-versions',
        action: 'list',
        params: { page: own.page },
        settings: state.settings,
        tabId: state.tab?.id,
        onReport: (msg) => own.log.onReport(msg)
      });
      own.page = own.listing.page || own.page;
      const versions = own.listing.versions || [];
      own.picked = versions.find((v) => v.id === keepPicked)?.id || versions[0]?.id || null;
      own.problem = before;
      own.phase = 'versions';
    } catch (e) {
      own.log?.add('fail', e.message);
      own.problem = before ? `${before} Reading the versions again also failed: ${e.message}` : e.message;
      own.listing = null;
      own.phase = 'pick';
    }
    own.busy = null;
    toTop();
    redraw();
  }

  function stepsFrom(ids) {
    return ids.map(([id, name]) => ({ id, name, state: 'todo' }));
  }

  async function runWrite(action, params, steps) {
    own.problem = null;
    own.asking = null;
    own.busy = action;
    own.steps = steps;
    goStep('running');
    try {
      own.result = await runAction({
        featureId: 'page-versions',
        action,
        params: { page: own.page, ...params },
        settings: state.settings,
        tabId: state.tab?.id,
        onReport: (msg) => {
          own.log.onReport(msg);
          if (msg.level !== 'data' || msg.message !== 'step') return;
          const s = own.steps.find((x) => x.id === msg.data.id);
          if (!s) return;
          s.state = msg.data.state;
          s.note = msg.data.note;
          if (own.phase === 'running') redraw();
        }
      });
      /* The list was read before this write. Drop it, so nothing can draw
         versions - or differences - from before the page changed. */
      own.listing = null;
      own.picked = null;
      own.phase = 'done';
    } catch (e) {
      own.log?.add('fail', e.message);
      /* A failed write may still have changed the page - a restore that
         landed and then failed its check, say - so the list read before it
         is dropped and read again, rather than drawn as if nothing moved. */
      own.listing = null;
      own.busy = null;
      await doList(e.message);
      return;
    }
    own.busy = null;
    toTop();
    redraw();
  }

  function doRestore() {
    runWrite(
      'restore',
      { versionId: own.picked },
      stepsFrom([
        // The worker's own step ids - a different name here and the step never moves.
        ['save', 'Saving the current content first'],
        ['restore', 'Restoring the version'],
        ['check', 'Reading the page back']
      ])
    );
  }

  function doCreate() {
    runWrite('create', { message: own.message }, stepsFrom([
      ['create', 'Saving the current content as a version'],
      ['check', 'Reading it back']
    ]));
  }
}

/* -------------------------------------------------------------- pieces */

/** One saved version: its number, when and who, and the message it carries. */
function versionRow(v, own, canWrite, redraw, drift) {
  const wrap = el('label', 'ver-row');
  if (v.current) wrap.dataset.current = 'true';

  const radio = el('input');
  radio.type = 'radio';
  radio.name = 'dsy-version';
  radio.disabled = !canWrite;
  radio.checked = own.picked === v.id;
  radio.setAttribute('aria-label', `Version ${v.number}`);
  radio.addEventListener('change', () => {
    own.picked = v.id;
    redraw();
  });

  const text = el('div', 'ver-text');
  const head = el('div', 'ver-head');
  head.append(el('span', 'ver-name', `Version ${v.number}`));
  if (v.current) {
    head.append(
      el(
        'span',
        'link-tag',
        drift === 'changed' ? 'On the page, with changes' : drift === 'unknown' ? 'On the page, not compared' : 'On the page now'
      )
    );
  }
  for (const l of v.labels || []) head.append(el('span', 'link-tag', l));

  text.append(
    head,
    el('div', 'ver-when', `${when(v.created)} · ${v.lastModifiedBy || 'unknown'}`),
    el('div', 'ver-msg', v.comment ? `“${v.comment}”` : 'No message')
  );
  if (!v.comment) text.querySelector('.ver-msg').dataset.empty = 'true';

  wrap.append(radio, text);
  return wrap;
}

/** The question asked over the list, about the row that is picked. */
function dialog(titleText, blocks, actions) {
  const back = el('div', 'dlg-back');
  const box = el('dialog', 'dlg');
  box.open = true;
  box.setAttribute('aria-label', titleText);
  box.append(...blocks);
  const bar = el('div', 'dlg-actions');
  bar.append(...actions);
  box.append(bar);
  back.append(box);
  return back;
}

function restoreDialog(picked, r, own, state, onYes, redraw, onThisOne) {
  const savesFirst = state.settings?.versionsSaveBeforeRestore === true;
  const head = el('div', 'dlg-head');
  const tag = el('span', 'key-tag');
  tag.dataset.kind = 'write';
  tag.append(icon('pen', 13, 2.4), el('span', null, 'Changes AEM'));
  head.append(icon('history', 22, 2), tag);

  return dialog(
    onThisOne ? `Undo the changes since version ${picked.number}?` : `Restore version ${picked.number}?`,
    [
      head,
      el(
        'div',
        'dlg-title',
        onThisOne ? `Undo the changes since version ${picked.number}?` : `Restore version ${picked.number}?`
      ),
      el(
        'div',
        'dlg-body',
        onThisOne
          ? 'The page goes back to the content of the version it is already on. Everything changed since is dropped.'
          : 'The content on the page now is replaced.'
      ),
      list([
        kv('Page', r.page, true),
        kv('Restores', `Version ${picked.number} · ${when(picked.created)}`),
        kv('Replaces', 'Everything on the page now'),
        kv(
          'What is there now',
          savesFirst ? 'Saved as a new version first' : 'Not kept - it is gone'
        ),
        kv('Child pages', 'Never changed')
      ])
    ],
    [
      button(onThisOne ? 'Undo those changes' : 'Restore this version', 'write', onYes, { iconName: 'history' }),
      button('Cancel', 'ghost', () => {
        own.asking = null;
        redraw();
      })
    ]
  );
}

function createDialog(r, own, onYes, redraw) {
  const head = el('div', 'dlg-head');
  const tag = el('span', 'key-tag');
  tag.dataset.kind = 'write';
  tag.append(icon('pen', 13, 2.4), el('span', null, 'Changes AEM'));
  head.append(icon('pen', 22, 2), tag);

  const field = el('div', 'field');
  field.append(el('div', 'field-label', 'Message'));
  const input = el('input');
  input.type = 'text';
  input.value = own.message;
  input.maxLength = 500;
  input.setAttribute('aria-label', 'Version message');
  input.placeholder = 'Why this version is being saved';
  input.addEventListener('input', () => {
    own.message = input.value;
    save.disabled = !own.message.trim();
  });
  field.append(input, el('div', 'field-hint', 'Shown next to the version in the list. Up to 500 characters.'));

  const save = button('Save this version', 'write', onYes, {
    disabled: !own.message.trim(),
    iconName: 'pen'
  });

  return dialog(
    'Save the current content as a version?',
    [
      head,
      el('div', 'dlg-title', 'Save the current content as a version?'),
      el('div', 'dlg-body', 'Nothing on the page changes. A new version is added to the list above.'),
      list([kv('Page', r.page, true)]),
      field
    ],
    [
      save,
      button('Cancel', 'ghost', () => {
        own.asking = null;
        redraw();
      })
    ]
  );
}

function reset(own) {
  own.phase = 'pick';
  own.listing = null;
  own.picked = null;
  own.asking = null;
  own.message = '';
  own.result = null;
  own.problem = null;
  own.busy = null;
  own.steps = [];
}
