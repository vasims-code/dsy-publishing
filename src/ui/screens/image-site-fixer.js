/**
 * Image Site Code Fixer: images from another site's DAM folder, uploaded to
 * the page's own folder and the page pointed at them.
 *
 * The same five steps as the Site Code Link Fixer: pick the page, review what
 * the scan found, confirm what will be uploaded and written, watch it run,
 * read the result. The scan reads only; nothing is written until the amber
 * button on Confirm.
 *
 * What is ticked for you is an image from another SITE's folder that can be
 * put in this one. An image from a shared folder (global, common) is listed
 * unticked - it may be shared on purpose - and so is one on an inherited
 * component. One the DAM and Dynamic Media have both lost has no box at all.
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
  more,
  notice,
  runStep,
  startingStep,
  stepBar,
  toTop,
  whatHappens
} from '../parts.js';
import { logBox, makeLog } from '../log.js';
import { runAction } from '../run.js';

const STEPS = ['Pick', 'Review', 'Confirm', 'Run', 'Result'];
const SHOW_FIRST = 8;
const FEATURE = 'image-site-fixer';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const hostOf = (origin) => String(origin || '').replace(/^https?:\/\//, '');
const fileOf = (path) => String(path || '').split('/').pop();

/** Can be fixed: it is, or can be put, in this site's folder. */
const fixable = (img) => img.action === 'upload' || img.action === 'upload-delivery' || img.action === 'there';
const inherited = (img) => (img.uses || []).some((u) => u.liveCopy);
/** Ticked for you: another site's image, fixable, on nothing inherited. */
const ticksItself = (img) => fixable(img) && img.site && !inherited(img);
/** Called out on the review, unticked. */
const needsLook = (img) => fixable(img) && !ticksItself(img);

export async function render(ctx) {
  const { view, footer, state, goHome } = ctx;

  const own = ctx.own;
  if (!own.log) own.log = makeLog(() => {
    if (own.phase === 'running') redraw();
  });
  if (!own.phase) {
    Object.assign(own, {
      phase: 'pick',
      page: null,
      damFolder: '',
      scan: null,
      ticked: new Set(),
      showAll: false,
      result: null,
      problem: null,
      steps: [],
      busy: null
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
    own.phase === 'running' ? (own.busy === 'fix' ? 3 : 0) : { pick: 0, review: 1, confirm: 2, result: 4 }[own.phase];

  view.append(
    connPill({
      host: hostOf(state.origin),
      signedIn: !state.session || state.session.state === 'in' || state.session.state === 'unknown'
    }),
    stepBar(STEPS, phaseIndex)
  );

  if (own.problem) {
    view.append(notice('err', 'That did not work', own.problem, 'warn'));
    view.append(logBox(own.log.lines, { open: true, title: 'What happened' }));
  }

  const images = own.scan?.images || [];
  const folder = own.scan?.folder || '';
  const folderPath = own.scan ? `${own.scan.damRoot}/${folder}` : '';

  /* ------------------------------------------------------------ 1. pick */

  if (own.phase === 'pick') {
    view.append(
      notice('read', 'Preview only', 'Scanning only reads the page. Nothing is written.'),
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
      } else {
        const use = el('button', 'label-action', 'Use this');
        use.type = 'button';
        use.addEventListener('click', () => {
          own.page = state.page.path;
          redraw();
        });
        card.append(use);
      }
      view.append(card);
    }

    const pageField = el('div', 'field');
    pageField.append(el('div', 'field-label', 'Page path'));
    const input = el('input');
    input.type = 'text';
    input.value = own.page;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Page path');
    input.placeholder = '/content/samsung/iq_ku/apps/samsung-health';
    input.addEventListener('input', () => {
      own.page = input.value.trim();
      scanBtn.disabled = !own.page.startsWith('/content/');
    });
    pageField.append(input);
    pageField.append(
      el('div', 'field-hint', 'Its site code is read off the path - the "iq_ku" in /content/samsung/iq_ku/… . Its images belong in that site’s DAM folder.')
    );
    view.append(pageField);

    const damField = el('div', 'field');
    damField.append(el('div', 'field-label', 'This site’s DAM folder'));
    const dam = el('input');
    dam.type = 'text';
    dam.value = own.damFolder;
    dam.spellcheck = false;
    dam.setAttribute('aria-label', 'This site’s DAM folder');
    dam.placeholder = 'Folder name only, e.g. ae';
    dam.addEventListener('input', () => {
      own.damFolder = dam.value.trim();
    });
    damField.append(dam);
    damField.append(
      el('div', 'field-hint', 'Leave it empty to use the site code. Fill it in only when the images are in a folder with another name: for an ae_ar page whose images are in /content/dam/samsung/ae, type ae.')
    );
    view.append(damField);

    view.append(
      ...whatHappens([
        ['search', 'Reads every component and lists images from another site’s DAM folder, such as /lb/… on an /iq_ku page.'],
        ['image', 'Finds them as DAM paths and as images.samsung.com addresses, in image fields, rich text and Static Content HTML.'],
        ['import', 'Uploads the images you tick to this site’s folder, at the same path. An image deleted from the DAM is taken from images.samsung.com.'],
        ['pen', 'Then points every reference at the uploaded copy, in the form it was written. Every changed property is read back.']
      ])
    );

    const scanBtn = button('Scan this page', 'primary', doScan, { disabled: !own.page.startsWith('/content/') });
    footer.append(...footerBar({ tag: { kind: 'read', text: 'Preview only' }, note: 'No changes yet', buttons: [scanBtn] }));
    return;
  }

  /* --------------------------------------------------------- 2. review */

  if (own.phase === 'review') {
    const fixableRows = images.filter(fixable);
    const lost = images.filter((i) => !fixable(i));
    const look = images.filter(needsLook);
    const tickedCount = own.ticked.size;
    const lookUnticked = look.filter((i) => !own.ticked.has(i.src)).length;
    const nothingFound = !images.length;

    view.append(
      nothingFound
        ? notice('ok', 'Nothing to fix', `Every image on this page is in ${folderPath}. ${own.scan.nodes} nodes were read and nothing was written.`, 'check')
        : notice('read', 'Preview only · nothing is written', 'You confirm before anything is uploaded or changed.')
    );

    const page = el('div', 'card page-summary');
    const text = el('div', 'tool-text');
    text.append(
      el('div', 'page-card-eyebrow', `Page · site /${own.scan.site}`),
      el('div', 'page-card-title', own.scan.title || own.page.split('/').pop()),
      el('div', 'page-card-path', own.scan.page || own.page),
      el(
        'div',
        'page-card-note',
        nothingFound ? `${own.scan.nodes} nodes read` : `${plural(images.length, 'image')} from other DAM folders`
      )
    );
    const change = el('button', 'label-action', 'Change');
    change.type = 'button';
    change.addEventListener('click', () => {
      own.phase = 'pick';
      own.scan = null;
      own.ticked.clear();
      redraw();
    });
    page.append(text, change);
    view.append(page);

    if (nothingFound) {
      footer.append(
        ...footerBar({
          tag: { kind: 'read', text: 'Preview only' },
          note: 'Nothing was written',
          buttons: [
            button('Scan another page', 'primary', () => {
              own.scan = null;
              own.ticked.clear();
              goStep('pick');
            }),
            button('Scan this page again', 'ghost', doScan),
            button('Back to tools', 'link', () => {
              reset(own);
              goHome();
            })
          ]
        })
      );
      return;
    }

    view.append(
      counts([
        { n: tickedCount, label: 'to fix' },
        { n: lookUnticked, label: 'need a look', tone: lookUnticked ? 'warn' : null },
        { n: lost.length, label: 'cannot fix', tone: lost.length ? 'warn' : null }
      ])
    );

    view.append(
      list([
        kv('This page’s images go in', folderPath, true),
        kv('Images found from', (own.scan.otherFolders || []).map((o) => `/${o.folder} (${o.images})`).join(' · '), true)
      ])
    );

    const shared = look.filter((i) => !i.site).length;
    const inheritedN = look.filter((i) => i.site && inherited(i)).length;
    if (shared || inheritedN || lost.length) {
      const warn = el('div', 'notice-stack');
      const line = (iconName, strong, rest) => {
        const row = el('div', 'notice-line');
        row.append(icon(iconName, 18, 2));
        const span = el('span');
        span.append(el('b', null, strong), document.createTextNode(' ' + rest));
        row.append(span);
        warn.append(row);
      };
      const they = (n) => (n === 1 ? 'It is unticked.' : 'They are unticked.');
      if (shared) {
        line('warn', `${plural(shared, 'image')} ${shared === 1 ? 'is' : 'are'} in a shared folder, not another site’s.`, `A folder like /global may be shared on purpose. ${they(shared)}`);
      }
      if (inheritedN) {
        line('history', `${plural(inheritedN, 'image')} ${inheritedN === 1 ? 'is' : 'are'} on an inherited component.`, `Fixing breaks inheritance for that property. ${they(inheritedN)}`);
      }
      if (lost.length) {
        line(
          'warn',
          `${plural(lost.length, 'image')} cannot be fixed.`,
          `${lost.length === 1 ? 'It is' : 'They are'} in neither the DAM nor on images.samsung.com, or could not be read, so there is nothing to upload. Left as ${lost.length === 1 ? 'it is' : 'they are'}.`
        );
      }
      view.append(warn);
    }

    view.append(
      label('Images from other folders', {
        text: tickedCount === fixableRows.length ? 'Select none' : 'Select all',
        onClick: () => {
          if (tickedCount === fixableRows.length) own.ticked.clear();
          else for (const i of fixableRows) own.ticked.add(i.src);
          redraw();
        }
      })
    );

    const shown = own.showAll ? images : images.slice(0, SHOW_FIRST);
    const items = shown.map((img) => imageRow(img, folder, own.ticked, redraw));
    if (!own.showAll && images.length > SHOW_FIRST) {
      items.push(
        more(`Show ${images.length - SHOW_FIRST} more`, () => {
          own.showAll = true;
          redraw();
        })
      );
    }
    view.append(list(items));

    footer.append(
      ...footerBar({
        tag: { kind: 'read', text: 'Preview only' },
        note: `${tickedCount} of ${fixableRows.length} selected`,
        buttons: [
          button(tickedCount ? `Continue with ${plural(tickedCount, 'image')}` : 'Tick an image to continue', 'primary', () => goStep('confirm'), {
            disabled: !tickedCount
          }),
          button('Scan again', 'ghost', doScan)
        ]
      })
    );
    return;
  }

  /* -------------------------------------------------------- 3. confirm */

  if (own.phase === 'confirm') {
    const picked = images.filter((i) => own.ticked.has(i.src));
    const toUpload = picked.filter((i) => i.action !== 'there').length;
    const refs = picked.reduce((n, i) => n + (i.uses?.length || 0), 0);
    const left = images.length - picked.length;
    const scanned = hostOf(own.scanned?.origin || state.origin);
    const front = hostOf(state.origin);

    view.append(notice('write', 'This will change content in AEM', 'Images are uploaded to the DAM, then the page is changed, on the server below.', 'pen'));
    if (front && scanned && front !== scanned) {
      view.append(notice('warn', `The tab in front is on ${front}`, `This writes to ${scanned}, where the page was scanned.`, 'warn'));
    }
    view.append(
      label('Check before you confirm'),
      list([
        kv('Server', scanned, true),
        kv('Page', own.scan.page || own.page, true),
        kv('Will upload', toUpload ? `${plural(toUpload, 'image')} to ${folderPath}` : 'Nothing - every ticked image is already there'),
        kv('Will change', `${plural(refs, 'reference')} on the page, pointed at /${folder}`),
        kv('Will not change', left ? `${plural(left, 'image')} left as ${left === 1 ? 'it is' : 'they are'}` : 'Nothing - every image is ticked')
      ])
    );
    footer.append(
      ...footerBar({
        tag: { kind: 'write', text: 'Writes to AEM' },
        note: `${plural(picked.length, 'image')} · 1 page`,
        buttons: [
          button(`Fix ${plural(picked.length, 'image')} in AEM`, 'write', doFix, { iconName: 'pen' }),
          button('Back to preview', 'ghost', () => goStep('review'))
        ]
      })
    );
    return;
  }

  /* ------------------------------------------------------------ 4. run */

  if (own.phase === 'running') {
    const writing = own.busy === 'fix';
    view.append(
      writing
        ? notice('write', 'Writing to AEM', 'Leave this tab open until it finishes.', 'pen')
        : notice('read', 'Reading the page', 'Nothing is written while it reads.', 'eye')
    );
    view.append(label('What is happening'));
    view.append(list(own.steps.length ? own.steps.map(runStep) : [startingStep()]));
    view.append(logBox(own.log.lines));
    footer.append(...footerBar({ buttons: [busyButton(writing ? 'Writing…' : 'Reading…')] }));
    return;
  }

  /* --------------------------------------------------------- 5. result */

  const r = own.result || {};
  const fixed = r.fixed || 0;
  const skipped = images.length - own.ticked.size;
  const added = Math.max(0, (r.remaining || 0) - skipped);

  view.append(
    notice(
      'ok',
      'Done',
      `${plural(fixed, 'image')} now in ${r.folder || folderPath}${r.uploaded ? `, ${r.uploaded} of them uploaded` : ''}. ${plural(r.references || 0, 'reference')} on the page changed.`,
      'check'
    )
  );
  if (added) {
    view.append(
      notice(
        'warn',
        `${plural(added, 'more image')} from other folders on the page`,
        `${added === 1 ? 'It was' : 'They were'} not there when the page was scanned. Scan it again to see ${added === 1 ? 'it' : 'them'}.`,
        'warn'
      )
    );
  }
  view.append(
    counts([
      { n: r.uploaded || 0, label: 'uploaded', tone: 'ok' },
      { n: r.references || 0, label: 'references changed', tone: 'ok' },
      { n: skipped, label: 'left as they were' }
    ])
  );
  const uploaded = r.uploadedPaths || [];
  if (uploaded.length) {
    view.append(label('Uploaded'), list(uploaded.map((p) => kv(fileOf(p), p, true))));
  }
  view.append(
    label('Page'),
    list([kv('Page', r.page || own.scan?.page || own.page, true), kv('Server', hostOf(own.scanned?.origin || state.origin), true)])
  );
  view.append(logBox(own.log.lines));
  footer.append(
    ...footerBar({
      buttons: [
        button('Back to tools', 'primary', () => {
          reset(own);
          goHome();
        }),
        button('Fix another page', 'link', () => {
          reset(own);
          own.page = state.page?.path || '';
          redraw();
        })
      ]
    })
  );

  /* ---------------------------------------------------------- the work */

  async function doScan() {
    const scanned = { tabId: state.tab?.id, origin: state.origin || null };
    own.log?.clear();
    own.problem = null;
    own.busy = 'scan';
    own.steps = [{ name: 'Reading the page and checking each image', state: 'running' }];
    goStep('running');
    try {
      const scan = await runAction({
        featureId: FEATURE,
        action: 'scan',
        params: { page: own.page, damFolder: own.damFolder },
        settings: state.settings,
        tabId: scanned.tabId,
        origin: scanned.origin,
        onReport: (msg) => own.log.onReport(msg)
      });
      own.scan = scan;
      own.scanned = scanned;
      own.showAll = false;
      own.ticked = new Set((scan.images || []).filter(ticksItself).map((i) => i.src));
      own.phase = 'review';
      own.result = null;
    } catch (e) {
      own.log?.add('fail', e.message);
      own.problem = e.message;
      own.phase = 'pick';
    }
    own.busy = null;
    toTop();
    redraw();
  }

  async function doFix() {
    own.log?.clear();
    own.problem = null;
    own.busy = 'fix';
    own.phase = 'running';
    own.steps = [
      { name: 'Checking nothing changed', state: 'running' },
      { name: 'Uploading the images', state: 'todo' },
      { name: 'Writing the image paths', state: 'todo' },
      { name: 'Reading the page back', state: 'todo' }
    ];
    const byId = { 'check-first': 0, upload: 1, write: 2, check: 3 };
    redraw();
    try {
      own.result = await runAction({
        featureId: FEATURE,
        action: 'fix',
        params: {
          page: own.scan?.page || own.page,
          damFolder: own.scan?.folder || own.damFolder,
          picks: [...own.ticked],
          props: own.scan?.props || []
        },
        settings: state.settings,
        tabId: own.scanned?.tabId ?? state.tab?.id,
        origin: own.scanned?.origin || state.origin || null,
        onReport: (msg) => {
          own.log.onReport(msg);
          if (msg.level !== 'data' || msg.message !== 'step') return;
          const i = byId[msg.data.id];
          if (i == null) return;
          own.steps[i].state = msg.data.state;
          own.steps[i].note = msg.data.note;
          if (own.phase === 'running') redraw();
        }
      });
      own.phase = 'result';
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

/** What happens to an image, in a word or two, for its tag. */
function actionTag(img, folder) {
  if (img.action === 'there') return `Already in /${folder}`;
  if (img.action === 'upload-delivery') return 'From images.samsung.com';
  if (img.action === 'missing') return 'Not found anywhere';
  if (img.action === 'unreadable') return 'Could not be read';
  return null;
}

/** One image: its file, where it is used, and its folder struck out with this site's beside it. */
function imageRow(img, folder, ticked, redraw) {
  const can = fixable(img);
  const wrap = el(can ? 'label' : 'div', 'link-row');
  if (can) {
    const box = el('input');
    box.type = 'checkbox';
    box.checked = ticked.has(img.src);
    box.setAttribute('aria-label', `Move ${img.src} to /${folder}`);
    box.addEventListener('change', () => {
      if (box.checked) ticked.add(img.src);
      else ticked.delete(img.src);
      redraw();
    });
    wrap.append(box);
  } else {
    wrap.append(icon('warn', 16, 2));
  }

  const uses = img.uses || [];
  const first = uses[0] || {};
  const where = el('div', 'link-where');
  const place = `${first.title || first.type || first.node || ''} · ${first.prop || ''}`;
  where.append(el('span', null, `${place}${uses.length > 1 ? ` + ${uses.length - 1} more` : ''}`));
  if (!img.site) where.append(el('span', 'link-tag', 'Shared folder'));
  if (inherited(img)) where.append(el('span', 'link-tag', 'Inherited'));
  const tag = actionTag(img, folder);
  if (tag) where.append(el('span', 'link-tag', tag));

  // The reference as the page writes it - an images.samsung.com address stays one.
  const from = first.from || img.src;
  const at = from.indexOf(`/${img.folder}/`) + 1;
  const url = el('div', 'link-url');
  url.title = `Uploaded from ${img.src} to ${img.dest}`;
  url.append(
    el('span', null, from.slice(0, at)),
    el('span', 'link-cut', img.folder),
    el('span', 'link-new', folder),
    el('span', null, from.slice(at + img.folder.length))
  );

  const text = el('div', 'link-text');
  text.append(where, url);
  wrap.append(text);
  return wrap;
}

function reset(own) {
  own.phase = 'pick';
  own.scan = null;
  own.ticked = new Set();
  own.showAll = false;
  own.result = null;
  own.problem = null;
  own.steps = [];
  own.busy = null;
  own.scanned = null;
}
