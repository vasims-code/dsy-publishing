/**
 * Copy a page, as the design draws it.
 *
 * One tool over two features. Copying within this server is page-upsert;
 * bringing a page from another author instance is page-transfer. They ask for
 * almost the same thing - a source, a destination, and whether to remove what
 * the source no longer has - so the difference is one toggle at the top
 * rather than two tools on the home screen.
 *
 * Five steps: pick, review what the analysis found, confirm, watch it run,
 * read the result. The analysis reads both pages and writes nothing.
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
  pathParts,
  runStep,
  spinner,
  startingStep,
  stepBar,
  titled,
  toTop,
  openInAem
} from '../parts.js';
import { uploadWait } from '../../core/aem-client.js';
import { insideBackupFolder } from '../../core/paths.js';
import { logBox, makeLog } from '../log.js';
import { runAction } from '../run.js';
import * as transfer from '../transfer.js';

const STEPS = ['Pick', 'Review', 'Confirm', 'Run', 'Result'];
/* Where an upload stops being routine. Below the default limit, so an image
   between the two is carried but said to be slow. */
const BIG_IMAGE = 15 * 1024 * 1024;
/* How long the ticking has to stop before the plan is worked out again.
   Long enough that three boxes answered in a row cost one re-read of both
   pages, short enough that one box answered on its own is not a wait. */
const RECHECK_WAIT = 450;
const mb = (n) => `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const host = (origin) => String(origin || '').replace(/^https?:\/\//, '');
/* Images to upload. The two features count them under different names -
   page-upsert `assetsToCopy`, page-transfer `uploads` - and reading only the
   first said 0 images on every copy between servers. */
const imagesOf = (c) => c?.assetsToCopy ?? c?.uploads ?? 0;

export async function render(ctx) {
  const { view, footer, state, goHome } = ctx;

  const own = ctx.own;
  /* One log per visit to this tool. Kept on `own`, so the shell drops it when
     you leave, like the rest of the tool's state. */
  if (!own.log) own.log = makeLog(() => {
    if (own.phase === 'running') redraw();
  });
  if (!own.phase) {
    Object.assign(own, {
      phase: 'pick',
      where: 'this',
      source: null,
      dest: '',
      sourceOrigin: '',
      destOrigin: '',
      allowDeletes: true,
      srcSite: '',
      destSite: '',
      advanced: false,
      summary: null,
      backupFirst: false,
      versionFirst: false,
      siteValues: true,
      keepImages: false,
      keepLinks: false,
      keepSites: [],
      ackRemovals: false,
      ackMetadata: false,
      result: null,
      problem: null,
      busy: null,
      rechecking: false,
      recheckWanted: false,
      recheckTimer: null,
      steps: []
    });
  }

  if (own.source == null) own.source = state.page?.path || '';

  const redraw = () => ctx.render();
  const goStep = (phase) => {
    own.phase = phase;
    toTop();
    redraw();
  };

  const another = own.where === 'another';
  const phaseIndex =
    own.phase === 'running'
      ? own.busy === 'run'
        ? 3
        : 0
      : { pick: 0, review: 1, confirm: 2, done: 4 }[own.phase];

  view.append(
    connPill({
      host: host(state.origin),
      signedIn: !state.session || state.session.state === 'in' || state.session.state === 'unknown'
    }),
    stepBar(STEPS, phaseIndex)
  );

  if (own.problem) {
    view.append(notice('err', 'That did not work', own.problem, 'warn'));
    /* Open, because a run that stopped is exactly when the account of what
       happened before it is wanted - including images it had already given
       up on. */
    for (const img of own.failedWithByHand || []) view.append(byHandRow(img));
    view.append(logBox(own.log.lines, { open: true, title: 'What happened' }));
  }

  /* ------------------------------------------------------------ 1. pick */

  if (own.phase === 'pick') {
    view.append(
      notice('read', 'Read-only until you confirm', 'Analyze reads both pages. Nothing is written yet.')
    );

    /* Where the source lives. The whole difference between the two features. */
    const seg = el('div', 'segmented');
    for (const [id, text] of [['this', 'This server'], ['another', 'Another server']]) {
      const b = el('button', 'segment', text);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(own.where === id));
      b.addEventListener('click', () => {
        if (own.where === id) return;
        own.where = id;
        own.summary = null;

        /* The page open in this tab is the one being copied, so this tab's
           instance is the source. Where it goes is the question only you can
           answer, so the destination is left unchosen. */
        if (id === 'another' && !own.sourceOrigin) own.sourceOrigin = state.origin || '';
        redraw();
      });
      seg.append(b);
    }
    view.append(seg);

    const origins = state.settings?.origins || [];

    /* Both paths have to be there before anything can be analyzed. Checked as
       they are typed, by touching the button rather than redrawing - a redraw
       mid-word would take the focus out of the box. */
    let analyzeBtn = null;
    let footerNote = null;
    const isReady = () => own.source.startsWith('/content/') && own.dest.startsWith('/content/');
    const syncReady = () => {
      const ok = isReady();
      if (analyzeBtn) analyzeBtn.disabled = !ok;
      if (footerNote) footerNote.textContent = ok ? '1 page' : 'Both paths are needed';
    };

    view.append(label('From'));
    const sourceField = pathField('Source page', own.source, '/content/samsung/uk/offers/spring-sale', (v) => {
      own.source = v;
      syncReady();
    }, another
      ? 'Only this page is read. Child pages are never touched.'
      : 'Filled in from the page open in this tab. Child pages are never read.');

    const fromCard = el('div', 'field-card');
    if (another) {
      fromCard.append(
        originField('Source server', own.sourceOrigin, origins, (v) => {
          own.sourceOrigin = v;
          redraw();
        }, 'Where the page is read from. Add servers in Settings.')
      );
    }
    fromCard.append(sourceField);
    view.append(fromCard);

    const swap = el('button', 'swap');
    swap.type = 'button';
    swap.setAttribute('aria-label', 'Swap source and destination');
    swap.append(icon('transfer', 18, 2), el('span', null, 'Swap source and destination'));
    swap.addEventListener('click', () => {
      [own.source, own.dest] = [own.dest, own.source];
      [own.sourceOrigin, own.destOrigin] = [own.destOrigin, own.sourceOrigin];
      [own.srcSite, own.destSite] = [own.destSite, own.srcSite];
      own.summary = null;
      redraw();
    });
    view.append(swap);

    view.append(label('To'));
    const destField = pathField('Destination page', own.dest, '/content/samsung/lb/offers/spring-sale', (v) => {
      own.dest = v;
      syncReady();
    }, another
      ? 'Created if it is not there yet.'
      : 'Created if it is not there yet. Its parent must already exist.');

    /* The same page usually sits at the same path on both servers, so offer
       that rather than leave a long path to be typed out. */
    if (another && !own.dest && own.source) {
      const same = el('button', 'field-action-link');
      same.type = 'button';
      same.textContent = 'Use the same path as the source';
      same.addEventListener('click', () => {
        own.dest = own.source;
        redraw();
      });
      destField.append(same);
    }
    const toCard = el('div', 'field-card');
    if (another) {
      toCard.append(
        originField('Destination server', own.destOrigin, origins, (v) => {
          own.destOrigin = v;
          redraw();
        }, 'Where the page is written. Both servers need a tab open, or one is opened for you.')
      );
    }
    toCard.append(destField);
    view.append(toCard);

    view.append(
      list([
        check(
          'Remove components that no longer exist at the source',
          own.allowDeletes,
          (on) => {
            own.allowDeletes = on;
          },
          another
            ? 'Untick to add and update only.'
            : 'A copy means the destination ends up matching the source, so this is on. Untick to add and update only.'
        )
      ])
    );

    /* Worked out from the paths; only wanted where a locale is two segments. */
    const adv = el('details', 'advanced');
    adv.open = own.advanced;
    adv.addEventListener('toggle', () => {
      own.advanced = adv.open;
    });
    const sum = el('summary');
    const noteEl = el('span', 'advanced-note', localeNote(own));
    sum.append(el('span', null, 'Advanced · locale folders'), noteEl);
    const syncLocale = () => {
      noteEl.textContent = localeNote(own);
    };
    adv.append(sum);
    adv.append(
      pathField('Source locale folder', own.srcSite, 'worked out from the path', (v) => {
        own.srcSite = v;
        syncLocale();
      }, 'The segment that names the locale — the "uk" in /content/samsung/uk/… . Fill this in only when a locale is written as more than one segment, like "in/en".'),
      pathField('Destination locale folder', own.destSite, 'worked out from the path', (v) => {
        own.destSite = v;
        syncLocale();
      })
    );
    view.append(adv);

    analyzeBtn = button('Analyze', 'primary', doAnalyze, { disabled: !isReady() });
    footer.append(
      ...footerBar({
        tag: { kind: 'read', text: 'Read-only' },
        note: isReady() ? '1 page' : 'Both paths are needed',
        buttons: [analyzeBtn]
      })
    );
    footerNote = footer.querySelector('.footer-note');
    return;
  }

  /* ---------------------------------------------------------- 2. review */

  if (own.phase === 'review') {
    const s = own.summary;
    const c = s.counts || {};
    const creating = s.mode === 'create';

    /* A tick box changed the plan, so it is being worked out again. The
       review stays where it is while that happens, and so do its boxes: the
       counts below are the old ones for a moment, which the banner says
       rather than hides. */
    const stale = own.rechecking || own.recheckWanted;
    view.append(
      stale
        ? recheckNotice()
        : notice(
            'read',
            'Preview only · nothing is written yet',
            creating
              ? 'The destination is not there. It will be created from the source.'
              : 'Check what will happen, then continue.'
          )
    );

    view.append(
      counts([
        { n: c.links || 0, label: 'links re-pointed' },
        { n: c.properties || 0, label: 'properties' },
        { n: imagesOf(c), label: 'images', tone: imagesOf(c) ? 'ok' : null }
      ])
    );

    view.append(
      list([
        kv(another ? `From · ${host(own.sourceOrigin)}` : 'From · this server', s.source, true),
        kv(another ? `To · ${host(own.destOrigin)}` : 'To · this server', s.dest, true)
      ])
    );

    /* Images the limit leaves behind, named before the run rather than
       discovered during it. Not a problem to solve here - the page still goes
       across pointing at where each one belongs - but the number is a setting,
       and this is where someone would want to know it is biting. */
    const overLimit = (s.imagesByHand || []).filter((b) => /over the .* this transfer carries/.test(b.reason || ''));
    if (overLimit.length) {
      view.append(
        notice(
          'warn',
          `${plural(overLimit.length, 'image')} over the ${mb(s.maxImageBytes)} limit`,
          `${overLimit.map((b) => b.from.split('/').pop()).join(', ')} will not be carried. The page still goes ` +
            'across pointing at where each one belongs, and they are listed to do by hand. ' +
            'Change the limit in Settings.'
        )
      );
    }

    /* Under the limit but still big enough to sit quiet for a long stretch. */
    const slow = (s.uploads || []).filter((u) => (u.bytes || 0) >= BIG_IMAGE);
    if (slow.length) {
      const longest = Math.max(...slow.map((u) => uploadWait(u.bytes)));
      view.append(
        notice(
          'warn',
          `${plural(slow.length, 'image')} will take a while`,
          `${slow.map((u) => `${u.from.split('/').pop()} (${mb(u.bytes)})`).join(', ')}. ` +
            `An upload this size is given up to ${Math.round(longest / 60000)} minutes of quiet before it ` +
            'counts as stuck. If it never moves, the copy carries on and lists it to do by hand.'
        )
      );
    }

    if (s.rewrite?.enabled && s.rewrite.srcSite && s.rewrite.destSite) {
      view.append(
        el(
          'div',
          'field-hint',
          `Links, canonical addresses and image references are re-pointed from /${s.rewrite.srcSite} to /${s.rewrite.destSite}.`
        )
      );
    }

    /* What the run will do, in the order it will do it. */
    if (s.sections?.length) {
      view.append(
        titled(
          'What will happen, in this order',
          s.sections.map((sec) => {
            const row = el('div', 'plan-row');
            row.append(el('span', 'plan-n', String(sec.count)));
            const text = el('div', 'tool-text');
            text.append(el('div', 'plan-title', sec.title));
            if (sec.detail) text.append(el('div', 'plan-detail', sec.detail));
            row.append(text);
            return row;
          })
        )
      );
    }

    /* No banner for "no version is saved first". It fired on every ordinary
       copy, where it is the setting doing what it is set to, so it was a
       warning about nothing - and a banner that is always there is one
       nobody reads. The setting itself is still in Settings, and a version
       that IS being taken still appears in "What will happen". */

    /* The page's own properties, set to the destination site's values. */
    if (s.site?.rows?.length) {
      const rows = [
        check(
          `Replace these page properties with the ${s.site.to} site's values`,
          own.siteValues,
          (on) => {
            own.siteValues = on;
          }
        ),
        ...s.site.rows.map((r) => {
          const row = el('div', 'kv');
          row.append(el('div', 'kv-key', r.prop));
          const v = el('div', 'kv-value');
          v.append(el('span', 'was', r.from || '(none)'), el('span', null, ' → '), el('b', null, r.to));
          row.append(v);
          return row;
        })
      ];
      rows.push(el('div', 'list-foot', `Read from ${s.site.to}. Untick to leave them as they are.`));
      view.append(titled('Site values', rows));
    }

    /* Images the run cannot carry. Said here, not after the fact. */
    const byHand = s.imagesByHand || [];
    if (byHand.length) {
      view.append(titled(`${plural(byHand.length, 'image')} to do by hand`, byHand.map(byHandRow)));
    }

    /* Copied from a shared site like /global: its images and links can be
       kept as they are instead of uploaded and re-pointed. */
    const ch = s.choice || {};
    if (ch.offered && (ch.images || ch.links)) {
      const rows = [];
      if (ch.images) {
        rows.push(
          check(
            `Create new images in /${s.rewrite.destSite} and point these paths at them`,
            !own.keepImages,
            (on) => {
              own.keepImages = !on;
              scheduleRecheck();
            },
            own.keepImages
              ? `Kept as they are: ${plural(ch.images, 'image path')} still point at /${s.rewrite.srcSite}. No images are uploaded.`
              : undefined
          )
        );
      }
      if (ch.links) {
        rows.push(
          check(
            `Update links to point at /${s.rewrite.destSite}`,
            !own.keepLinks,
            (on) => {
              own.keepLinks = !on;
              scheduleRecheck();
            },
            own.keepLinks ? `Kept as they are: ${plural(ch.links, 'link')} still point at /${s.rewrite.srcSite}.` : undefined
          )
        );
      }
      view.append(titled(`From the shared site /${s.rewrite.srcSite}`, rows));
    }

    /* Links to a third site - /uk on a /global page - one box per site. */
    if (s.otherSites?.length) {
      view.append(
        titled(
          'Links to other sites',
          s.otherSites.flatMap((o) => {
            const repoint = !own.keepSites.includes(o.site);
            return [
              check(
                `Update links to /${o.site} to point at /${s.rewrite.destSite}`,
                repoint,
                (on) => {
                  own.keepSites = on
                    ? own.keepSites.filter((x) => x !== o.site)
                    : [...own.keepSites, o.site];
                  scheduleRecheck();
                },
                `${plural(o.properties, 'property')} link to /${o.site}, neither the source nor the destination site.`
              ),
              /* The links themselves. A count cannot be decided on - whether
                 /uk should follow the page depends on where it points, and
                 that is on the page, not in the number. */
              ...linkRows(o.links, o.site, s.rewrite.destSite, repoint)
            ];
          })
        )
      );
    }

    /* The destination's own backup under india/backup, taken or brought up to
       date before anything is written. Only offered when there is something
       to do: a destination already inside the backup folder has no backup
       location of its own, so `backupState` comes back unavailable and
       nothing is shown. */
    const bk = s.backup;
    if (bk && (bk.state === 'missing' || bk.state === 'differs')) {
      view.append(
        titled('Backup of the destination', [
          check(
            bk.state === 'missing' ? 'Take a backup first' : 'Update the backup first',
            own.backupFirst,
            (on) => {
              own.backupFirst = on;
              redraw();
            },
            bk.state === 'missing'
              ? `There is no backup at ${bk.backup}. Taken before anything is written; if it fails, nothing is copied.`
              : `The backup at ${bk.backup} is not the same as this page. Taken before anything is written; if it fails, nothing is copied.`
          )
        ])
      );
    }

    /* A backup page that already exists is about to be overwritten, and it
       is the only copy there is - a backup of a backup has nowhere to go, so
       a version of it is the one restore point available. Asked here rather
       than left to a setting, because this is the page where it matters. */
    const backupPage = s.mode !== 'create' && insideBackupFolder(s.dest, state.settings?.backupFolder, state.settings?.rootDepth ?? 3);
    if (backupPage) {
      view.append(
        titled('Before overwriting this backup page', [
          check(
            'Create a version of it first',
            own.versionFirst,
            (on) => {
              own.versionFirst = on;
              redraw();
            },
            own.versionFirst
              ? 'A restore point you can come back to from the Versions tool. If it fails, nothing is written.'
              : 'No restore point. What is there now is replaced and cannot be brought back from here.'
          )
        ])
      );
    }

    /* Removing content is the one outcome worth a second, deliberate step.
       The run checks the tick was for exactly this list, not just a yes. */
    const removing = (s.counts?.nodesDeleted || 0) + (s.props?.deleted?.length || 0);

    /* What would go, by name. The removals box is confirmed by a fingerprint
       of exactly this list, so the list has to be on the screen - before,
       only its counts were. Page properties are left to their own box below. */
    const removals = removalRows(s);
    if (removals.length) view.append(titled('What will be removed', removals));

    if (removing && s.largeRemoval) {
      view.append(
        notice(
          'warn',
          'That is a lot to remove',
          `${plural(s.counts?.nodesDeleted || 0, 'component')} and ${plural(s.props?.deleted?.length || 0, 'property', 'properties')} would go. That can mean the wrong pages were picked.`,
          'warn'
        )
      );
      view.append(
        list([
          check(
            'These are the right pages — remove them anyway',
            own.ackRemovals,
            (on) => {
              own.ackRemovals = on;
              redraw();
            }
          )
        ])
      );
    }

    /* Page properties on a destination that already exists.
       A choice, not a gate: unticked, the destination keeps the ones it has
       and the rest of the page is copied as usual. It used to refuse the
       whole run, which made a locale's own canonical and redirect into a
       reason not to copy the page at all. */
    const meta = s.metadata?.props?.length ? s.metadata : null;
    if (meta) {
      const metaRows = meta.rows || meta.props.map((prop) => ({ prop }));
      view.append(
        titled('Page properties this page already has', [
          check(
            'Overwrite these with the source page\u2019s',
            own.ackMetadata,
            (on) => {
              own.ackMetadata = on;
              redraw();
            },
            own.ackMetadata
              ? 'Ticked: each value below is replaced by the source page\u2019s.'
              : 'Optional, and left alone. The rest of the page is copied either way \u2014 nothing is ' +
                'held back by this box.'
          ),
          ...metaRows.map((r) => metaRow(r, own.ackMetadata))
        ])
      );
    }

    if (s.blockers?.length) {
      view.append(
        notice('err', 'This cannot run', s.blockers.join(' '), 'warn')
      );
    }

    /* Everything the run will refuse without. Removals still hold it: losing
       components is not something to decide by leaving a box alone. */
    const needsRemovalsAck = !!(removing && s.largeRemoval) && !own.ackRemovals;
    /* The one thing a stale plan does hold back is going on to write it. */
    const held = stale
      ? 'Working out the plan again…'
      : needsRemovalsAck
        ? 'Tick the removals box to continue'
        : null;

    footer.append(
      ...footerBar({
        tag: { kind: 'read', text: 'Preview only' },
        note: 'Nothing is written yet',
        buttons: [
          button(held || 'Continue to copy', 'primary', () => goStep('confirm'), {
            disabled: !!s.blockers?.length || !!held
          }),
          button('Change the paths', 'ghost', () => {
            own.summary = null;
            goStep('pick');
          })
        ]
      })
    );
    return;
  }

  /* --------------------------------------------------------- 3. confirm */

  if (own.phase === 'confirm') {
    const s = own.summary;
    const c = s.counts || {};

    const carried = imagesOf(c);
    const byHandN = (s.imagesByHand || []).length;
    const bk = s.backup;
    const backupPage = s.mode !== 'create' && insideBackupFolder(s.dest, state.settings?.backupFolder, state.settings?.rootDepth ?? 3);
    const row = (key, value, mono) => {
      const r = kv(key, value);
      if (mono) r.querySelector('.kv-value').classList.add('mono');
      return r;
    };
    const rows = [
      row('Reads', s.source, true),
      row('Writes to', s.dest, true),
      bk && (bk.state === 'missing' || bk.state === 'differs')
        ? row('Backup', own.backupFirst ? 'Taken first. If it fails, nothing is copied.' : 'Not taken first')
        : null,
      carried + byHandN
        ? row('Images', `${carried} carried${byHandN ? ` · ${byHandN} by hand` : ''}`)
        : null,
      c.nodesDeleted ? row('Removes', plural(c.nodesDeleted, 'component')) : null,
      backupPage
        ? row('Version', own.versionFirst ? 'Saved first' : 'Not saved first — turn that on in Settings')
        : null,
      s.site?.rows?.length
        ? row('Site values', own.siteValues ? `Set from the ${s.site.to} home page` : 'Left as they are')
        : null,
      row('Child pages', 'Never touched')
    ].filter(Boolean);


    const sheet = el('div', 'sheet');
    const head = el('div', 'sheet-head');
    const dot = el('div', 'sheet-dot');
    dot.append(icon('pen', 22, 2.2));
    const tag = el('span', 'key-tag');
    tag.dataset.kind = 'write';
    tag.append(icon('pen', 13, 2.4), el('span', null, 'Changes AEM'));
    head.append(dot, tag);
    sheet.append(
      head,
      el('div', 'sheet-title', `Copy this page to ${host(another ? own.destOrigin : state.origin)}?`),
      el('div', 'sheet-text', 'The page is read again from the source first, in case it changed since you reviewed it.'),
      list(rows),
      button('Copy page', 'write', doRun, { iconName: 'pen' }),
      button('Cancel', 'ghost', () => goStep('review'))
    );
    view.append(sheet);
    return;
  }

  /* ------------------------------------------------------------- 4. run */

  if (own.phase === 'running') {
    const writing = own.busy === 'run';
    view.append(
      writing
        ? notice('write', 'Copying the page', 'Keep this panel open until it finishes.', 'pen')
        : notice('read', 'Reading both pages…', 'Nothing is written.', 'eye')
    );
    if (!writing) {
      /* Reading: a card of what has been read and what is being worked on now. */
      const card = el('div', 'load-card');
      card.append(el('div', 'load-title', 'Analyzing'));
      const bar = el('div', 'load-bar');
      bar.append(el('div', 'load-bar-fill'));
      card.append(bar);
      for (const st of own.steps.length ? own.steps : [{ name: 'Starting…', state: 'running' }]) {
        const line = el('div', 'load-line');
        line.dataset.state = st.state || 'todo';
        line.append(
          st.state === 'running' ? spinner() : icon(st.state === 'done' ? 'check' : 'history', 16, 2.2),
          el('span', null, st.name)
        );
        card.append(line);
      }
      view.append(card);
      view.append(el('div', 'run-note', 'The source page is read again when you confirm, in case someone changed it meanwhile.'));
    } else {
      view.append(label('What is happening'));
      /* A step that has not reported yet is not a step that is stopped: the
         run goes in order, so the first one not done is the one under way,
         and when every listed step is done the run is finishing up. Without
         this the list shows finished work above and nothing moving below. */
      const shown = own.steps.map((x) => ({ ...x }));
      if (!shown.some((x) => x.state === 'running')) {
        const next = shown.find((x) => x.state === 'todo' || !x.state);
        if (next) {
          next.state = 'running';
          if (!next.note && own.note) next.note = own.note;
        } else {
          shown.push({ name: 'Finishing up', state: 'running', note: own.note || '' });
        }
      }
      view.append(list(shown.length ? shown.map(runStep) : [startingStep()]));
    }
    if (writing) {
      view.append(
        el('div', 'run-note', 'An image that fails is skipped and the run moves on. The page still goes across, and the last screen lists what to do by hand.')
      );
    }
    view.append(logBox(own.log.lines));
    footer.append(
      ...footerBar({
        tag: writing ? { kind: 'write', text: 'Writing to AEM' } : { kind: 'read', text: 'Read-only' },
        note: writing ? 'Keep this panel open' : 'Nothing is written',
        buttons: [busyButton(writing ? 'Writing…' : 'Working…')]
      })
    );
    return;
  }

  /* ---------------------------------------------------------- 5. result */

  const r = own.result || {};
  const rc = r.counts || {};
  const left = (r.imagesByHand || []).length;
  /* Read back after the write, and not all of it there. The write ran, so
     this is the result - but it never says the destination matches. */
  const u = r.unconfirmed;

  view.append(
    u
      ? notice(
          'warn',
          'Copied, but not all of it is on the page',
          `Read back afterwards, ${u.holding} of the ${u.checked} changes are on the page. Open it and check ` +
            'it before anyone publishes it - the ones that did not hold are listed below.',
          'warn'
        )
      : left
        ? notice('warn', `Page copied. ${plural(left, 'image')} ${left === 1 ? 'needs' : 'need'} you.`, `The page was updated in AEM. The ${left === 1 ? 'image' : 'images'} below ${left === 1 ? 'was' : 'were'} not carried.`, 'warn')
        : notice('ok', r.title || 'Page copied', 'The destination now matches the source.', 'check')
  );
  if (u) {
    const rows = (u.missing || []).map((m) => {
      const row = el('div', 'kv');
      row.append(el('div', 'kv-value mono', m));
      return row;
    });
    if (u.more) rows.push(el('div', 'list-foot', `and ${u.more} more - the activity log has the first of them`));
    view.append(titled('Not on the page after the write', rows));
  }

  const carried = imagesOf(rc);
  view.append(
    counts([
      { n: 1, label: 'page updated', tone: 'ok' },
      ...(carried + left ? [{ n: `${carried} of ${carried + left}`, label: 'images carried' }] : []),
      ...(left ? [{ n: left, label: left === 1 ? 'image by hand' : 'images by hand', tone: 'warn' }] : [])
    ]),
    titled(
      'What happened',
      [
        kv('Page', r.dest || own.dest, true),
        kv('From', r.source || own.source, true),
        rc.properties ? kv('Properties written', String(rc.properties)) : null,
        rc.nodesAdded ? kv('Components added', String(rc.nodesAdded)) : null,
        rc.nodesDeleted ? kv('Components removed', String(rc.nodesDeleted)) : null,
        carried ? kv('Images uploaded', String(carried)) : null,
        kv('Child pages', 'Never touched')
      ].filter(Boolean)
    )
  );

  if (left) {
    view.append(titled(`${plural(left, 'image')} to do by hand`, (r.imagesByHand || []).map(byHandRow)));
  }

  /* Open when anything was skipped: the reason each image was left is in
     there, and it is the first thing anyone asks. */
  view.append(logBox(own.log.lines, { open: left > 0 }));

  footer.append(
    ...footerBar({
      buttons: [
        button('Open page in AEM', 'primary', () => {
          openInAem(
            another ? own.destOrigin : state.origin,
            r.editorUrl || (r.dest && `/editor.html${r.dest}.html`)
          );
        }),
        button('Copy another page', 'link', () => {
          reset(own);
          own.source = state.page?.path || '';
          redraw();
        }),
        button('Back to tools', 'link', () => {
          reset(own);
          goHome();
        })
      ]
    })
  );

  /* ---------------------------------------------------------- the work */

  /** What both actions need: the paths, and the choices made on the form. */
  function params() {
    const p = {
      source: own.source,
      dest: own.dest,
      allowDeletes: own.allowDeletes,
      srcSite: own.srcSite || undefined,
      destSite: own.destSite || undefined,
      keepImages: own.keepImages,
      keepLinks: own.keepLinks,
      keepSites: [...own.keepSites]
    };
    if (another) {
      p.sourceOrigin = own.sourceOrigin;
      p.destOrigin = own.destOrigin;
    }
    return p;
  }

  /**
   * What the write needs on top of that.
   *
   * The two acknowledgements are not a yes - each carries what the review
   * showed, and the worker refuses if that no longer matches the page. The
   * fingerprint names exactly which removals were on screen; the metadata
   * list names exactly which page properties were. A page that changed
   * between the review and the click is refused rather than trusted.
   */
  function writeParams() {
    const s = own.summary;
    const p = {
      ...params(),
      keepSiteValues: !own.siteValues,
      backupFirst: own.backupFirst
    };

    /* Sent only where the review asked. Anywhere else the setting decides,
       and the worker drops it for a page outside the backup folder either
       way - a version there cannot be restored from here. */
    if (insideBackupFolder(s.dest, state.settings?.backupFolder, state.settings?.rootDepth ?? 3)) p.versionFirst = own.versionFirst;

    const removing = (s.counts?.nodesDeleted || 0) + (s.props?.deleted?.length || 0);
    if (removing && own.ackRemovals) {
      p.removalsAck = {
        nodes: s.counts?.nodesDeleted || 0,
        props: s.props?.deleted?.length || 0,
        fingerprint: s.removalsFingerprint
      };
    }
    if (s.metadata?.props?.length && own.ackMetadata) {
      p.metadataAck = { props: [...s.metadata.props] };
    }
    return p;
  }

  /**
   * A tick box changed the plan, so the plan has to be worked out again.
   *
   * Not at once, and not by taking the boxes away. Working it out means
   * re-reading both pages and asking AEM about each site the page links to -
   * seconds, not milliseconds - and answering three boxes in a row is one
   * decision, not three. So a tick is recorded immediately, the boxes stay
   * answerable, and the re-check happens once the ticking stops. One more
   * arriving while a re-check is in flight queues a single further one.
   */
  function scheduleRecheck() {
    own.recheckWanted = true;
    clearTimeout(own.recheckTimer);
    own.recheckTimer = setTimeout(runRecheck, RECHECK_WAIT);
    keepPlace(redraw);
  }

  async function runRecheck() {
    /* One in flight already: it will pick this up when it lands. */
    if (own.rechecking || own.phase !== 'review') return;
    own.recheckWanted = false;
    await doAnalyze({ inPlace: true });
    if (own.recheckWanted && own.phase === 'review') runRecheck();
  }

  /**
   * Read both pages and build the plan.
   *
   * `inPlace` is for a tick box on the review that changes the plan rather
   * than the run: throwing the review away and coming back to the top of a
   * rebuilt one loses the place of whoever is halfway down it reading the
   * links. So the review stays up, and the scroll position with it.
   */
  async function doAnalyze({ inPlace = false } = {}) {
    own.problem = null;
    own.busy = 'analyze';
    /* A full analysis answers whatever a pending re-check was going to. */
    if (!inPlace) {
      clearTimeout(own.recheckTimer);
      own.recheckWanted = false;
    }
    own.log.clear();
    own.steps = [{ name: 'Reading both pages', state: 'running' }];
    if (inPlace) {
      own.rechecking = true;
      keepPlace(redraw);
    } else {
      goStep('running');
    }
    const onReport = (msg) => own.log.onReport(msg);
    try {
      own.summary = another
        ? await transfer.analyze({
            params: params(),
            settings: state.settings,
            onReport,
            log: (text) => {
              own.log.add('info', text);
              own.steps = [...own.steps.map((x) => ({ ...x, state: 'done' })), { name: text, state: 'running' }];
              /* Not while the review is up: redrawing it under the reader
                 for every line of progress is the thing `inPlace` avoids. */
              if (own.phase === 'running') redraw();
            }
          })
        : await runAction({
            featureId: 'page-upsert',
            action: 'analyze',
            params: params(),
            settings: state.settings,
            tabId: state.tab?.id,
            onReport
          });
      own.siteValues = own.summary.site ? own.summary.site.applied !== false : true;
      /* The acknowledgements were given for the plan just replaced. */
      own.ackRemovals = false;
      own.ackMetadata = false;
      own.phase = 'review';
    } catch (e) {
      own.log.add('fail', e.message);
      own.problem = e.message;
      /* A failure is worth seeing from the top, wherever it came from. */
      own.phase = 'pick';
      inPlace = false;
    }
    own.busy = null;
    own.rechecking = false;
    if (inPlace) {
      keepPlace(redraw);
      return;
    }
    toTop();
    redraw();
  }

  /** A step reported by either side, or by the transfer's own carrying. */
  function markStep(id, stepState, note) {
    const st = own.steps.find((x) => x.id === id);
    if (!st) return;
    st.state = stepState;
    st.note = note;
    if (own.phase === 'running') redraw();
  }

  async function doRun() {
    own.problem = null;
    own.busy = 'run';
    own.log.clear();
    own.steps = (own.summary.sections || []).map((sec) => ({
      id: sec.id,
      name: sec.title,
      state: 'todo'
    }));
    goStep('running');
    try {
      const onReport = (msg) => {
        own.log.onReport(msg);
        if (msg.level !== 'data' || msg.message !== 'step' || !msg.data?.id) return;
        markStep(msg.data.id, msg.data.state, msg.data.note);
      };
      own.result = another
        ? await transfer.commit({
            params: writeParams(),
            settings: state.settings,
            onReport,
            log: (text, level) => {
              own.log.add(level || 'info', text);
              if (level === 'warn') own.problem = null;
              own.note = text;
              if (own.phase === 'running') redraw();
            },
            step: markStep
          })
        : await runAction({
            featureId: 'page-upsert',
            action: 'run',
            params: writeParams(),
            settings: state.settings,
            tabId: state.tab?.id,
            onReport
          });
      own.phase = 'done';
    } catch (e) {
      own.log.add('fail', e.message);
      own.problem = e.message;
      /* What the run did before it stopped is still worth having: the images
         it could not carry are listed on the failure, not thrown away with
         the result that never came back. */
      own.failedWithByHand = e.imagesByHand || null;
      own.phase = 'review';
    }
    own.busy = null;
    toTop();
    redraw();
  }
}

/* -------------------------------------------------------------- pieces */

/**
 * The review's list of what would be removed: each component, and the
 * properties going from each node, one row per node. Page properties are the
 * page-properties box's to show, so they are not repeated here.
 */
function removalRows(s) {
  const rows = [];
  for (const n of s.nodes?.deleted || []) rows.push(removalRow('Component removed', n.node));
  const emptied = new Set((s.nodes?.emptied || []).map((n) => n.node));
  const byNode = new Map();
  for (const p of s.props?.deleted || []) {
    if (p.metadata || !p.node) continue;
    if (!byNode.has(p.node)) byNode.set(p.node, []);
    byNode.get(p.node).push(p.prop);
  }
  for (const [node, props] of byNode) {
    const row = removalRow(emptied.has(node) ? 'Left with nothing in it' : 'Properties removed', node);
    row.append(el('div', 'field-hint', props.join(', ')));
    rows.push(row);
  }
  return rows;
}

function removalRow(key, path) {
  const row = el('div', 'kv');
  row.dataset.mono = 'true';
  const v = el('div', 'kv-value mono');
  v.append(...pathParts(path));
  row.append(el('div', 'kv-key', key), v);
  return row;
}

/**
 * One image the run could not carry, and where to get it.
 *
 * An image gone from the source DAM may still be served by Dynamic Media:
 * that copy is then the only place left to get it back from, so its links
 * are the most useful thing on the row, not a detail.
 */
function byHandRow(b) {
  const row = el('div', 'byhand');
  row.append(el('div', 'byhand-reason', b.reason || 'Will not be carried'));
  row.append(el('div', 'mono', b.from));
  if (b.to && b.to !== b.from) row.append(el('div', 'mono byhand-to', `→ ${b.to}`));
  for (const u of b.urls || []) {
    const line = el('div', 'byhand-url');
    line.append(el('span', 'byhand-url-name', u.name));
    const link = el('a', 'byhand-link', u.url);
    link.href = u.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = u.url;
    line.append(link);
    row.append(line);
  }
  return row;
}

function pathField(labelText, value, placeholder, onInput, hint) {
  const field = el('div', 'field');
  field.append(el('div', 'field-label', labelText));
  const input = el('input');
  input.type = 'text';
  input.value = value || '';
  input.spellcheck = false;
  input.placeholder = placeholder;
  input.setAttribute('aria-label', labelText);
  input.addEventListener('input', () => onInput(input.value.trim()));
  field.append(input);
  if (hint) field.append(el('div', 'field-hint', hint));
  return field;
}

/** One of the instances in settings - never a free-typed host. */
function originField(labelText, value, origins, onChange, hint) {
  const field = el('div', 'field');
  field.append(el('div', 'field-label', labelText));
  const select = el('select');
  select.setAttribute('aria-label', labelText);
  if (!origins.length) {
    const o = el('option', null, 'No instances in Settings yet');
    o.value = '';
    select.append(o);
    select.disabled = true;
  } else if (!value) {
    /* Without this the browser shows the first instance while nothing has
       been chosen, and the form looks filled in when it is not. */
    const o = el('option', null, 'Choose an instance');
    o.value = '';
    o.selected = true;
    select.append(o);
  }
  for (const o of origins) {
    const opt = el('option', null, host(o));
    opt.value = o;
    opt.selected = o === value;
    select.append(opt);
  }
  select.addEventListener('change', () => onChange(select.value));
  field.append(select);
  if (hint) field.append(el('div', 'field-hint', hint));
  return field;
}

function check(title, checked, onChange, hint, disabled) {
  const wrap = el('label', 'check-row');
  if (disabled) wrap.dataset.disabled = 'true';
  const box = el('input');
  box.type = 'checkbox';
  box.checked = !!checked;
  box.disabled = !!disabled;
  box.setAttribute('aria-label', title);
  box.addEventListener('change', () => onChange(box.checked));
  const text = el('div', 'check-text');
  text.append(el('div', 'check-title', title));
  if (hint) text.append(el('div', 'check-hint', hint));
  wrap.append(box, text);
  return wrap;
}

/** The banner that replaces "preview only" while a box is being answered. */
function recheckNotice() {
  const box = notice('read', 'Working out the plan again', 'The counts below are the previous answer until it comes back.');
  box.replaceChild(spinner(), box.firstChild);
  return box;
}

/**
 * Redraw without moving the page under the reader.
 *
 * The shell rebuilds the whole view, so the browser has no scroll position
 * to restore by itself. Taken before and put back after the new view is in
 * the document - two frames, because the first is where it is laid out.
 */
function keepPlace(redraw) {
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  const back = () => window.scrollTo(0, y);
  Promise.resolve(redraw()).then(() => {
    back();
    requestAnimationFrame(back);
  }, back);
}

/**
 * One page property, with both values: what the destination holds now and
 * what the source would put there.
 *
 * Which one is in bold is which one the page will end up with, so the box
 * above can be read by looking at this list rather than by working out what
 * "would be overwritten" means for each name in turn.
 */
function metaRow(r, overwrite) {
  /* Not the mono path row: that one uppercases its label, and a property
     name is case-sensitive - ogTitle is not OGTITLE. */
  const row = el('div', 'kv meta-row');
  row.append(el('div', 'kv-key', r.prop));

  const unset = r.now === undefined || r.now === '';
  const now = unset ? '(not set)' : String(r.now);
  /* Nothing from the source means the source does not have the property at
     all - ticking the box clears it rather than replacing it. */
  const would = r.would === undefined ? '(cleared)' : r.would === '' ? '(empty)' : String(r.would);

  /* An empty field is not something anyone chose to keep, so the source's
     value is written there whether the box is ticked or not. Saying
     otherwise would make the list disagree with the run. */
  const sourceWins = !!overwrite || unset;

  const v = el('div', 'kv-value mono');
  const keep = el('div', 'meta-val');
  keep.dataset.wins = String(!sourceWins);
  keep.dataset.blank = String(unset);
  keep.append(el('span', 'meta-tag', 'now'), el('span', 'meta-text', now));
  const take = el('div', 'meta-val');
  take.dataset.wins = String(sourceWins);
  take.append(el('span', 'meta-tag', 'source'), el('span', 'meta-text', would));
  v.append(keep, take);
  row.append(v);
  return row;
}

/**
 * The links to one other site, under its tick box.
 *
 * At most eight: the point is to see what kind of links they are and decide,
 * not to read a page's whole link list in a 400px panel. The rest are
 * counted, so nothing is hidden without saying so.
 */
function linkRows(links, site, destSite, repoint) {
  const all = links || [];
  const shown = all.slice(0, 8);
  const rows = shown.map((l) => {
    const row = el('div', 'link-sub');
    const from = el('div', 'link-sub-from');
    from.append(...pathParts(l.link));
    row.append(from);
    const note = repoint && destSite ? `→ /${destSite}` : 'kept as it is';
    row.append(
      el('span', 'link-sub-note', l.uses > 1 ? `${note} · used ${l.uses}×` : note)
    );
    return row;
  });
  if (all.length > shown.length) {
    rows.push(el('div', 'link-sub-more', `and ${all.length - shown.length} more to /${site}`));
  }
  return rows;
}

/** "uk → lb, worked out" - what the advanced box would use if left alone. */
function localeNote(own) {
  const of = (p) => String(p || '').split('/').filter(Boolean)[2] || '?';
  const a = own.srcSite || of(own.source);
  const b = own.destSite || of(own.dest);
  const typed = own.srcSite || own.destSite;
  return `${a} → ${b}, ${typed ? 'typed in' : 'worked out'}`;
}

function reset(own) {
  own.phase = 'pick';
  own.summary = null;
  own.result = null;
  own.problem = null;
  own.busy = null;
  /* A re-check waiting on a review that is no longer there. */
  clearTimeout(own.recheckTimer);
  own.recheckTimer = null;
  own.recheckWanted = false;
  own.rechecking = false;
  own.steps = [];
}
