/**
 * copy-deck-import, panel side: a Static Content block in its section.
 *
 * The import prepares each block's new Body (HTML) whole (see staticWork in
 * core.js), and its Footer (JavaScript) when the script's strings can be put
 * in safely (see prepareFooter). Its section on the review, ticked, lets
 * DSY write them with the import's Write; unticked - as it starts - the web
 * team can still paste the Body by hand: Copy new Body(HTML), open the block,
 * click the Body(HTML) tab, Ctrl+A, Ctrl+V, Done - then Check again. All a
 * block asks the page for is read only: its three fields.
 *
 * A block's old value as first read, and the value prepared for it, are kept
 * in chrome.storage.local, per server, page, block and old value - so closing
 * the panel loses nothing, and Copy old Body(HTML) can always put a block
 * back. The first old value, once kept, is never replaced.
 *
 * Beside the buttons, the hand-offs (see hand-offs.js): the Footer for a
 * developer line by line, links to re-point or check, pictures for a
 * designer.
 */

import { sourceHash } from '../copy-deck/core.js';
import { blockTexts, footerStatus, pasteStatus, prepareBody, readBlock, verify } from '../copy-deck/static-content.js';
import { developerReport, imagesOf, linksOf, repointLinks, siteOf } from './hand-offs.js';

const STORE = 'aemt.pasteByHand ';
const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 30;
/** chrome.storage.local holds 10 MB without "unlimitedStorage": the kept pages stay well under it. */
const KEEP_CHARS = 3_000_000;

const fmt = (n) => n.toLocaleString('en');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Lines without their indentation: a value the editor re-indented is the same value. */
const flat = (s) => String(s ?? '').split(/\r\n|\r|\n/).map((l) => l.trim()).join('\n');

/* ------------------------------------------------------- copy, prepare */

/**
 * Prepare again: the block's new Body (HTML) made once more, on what it holds
 * now - someone's edit since Check is kept. `rec` is what was prepared for it
 * ({ no, old, prepared, items, notOnSheet }, as pasteStatus takes it), `now`
 * its three fields read again, `others` the page's other blocks.
 *
 * Refused - { refused } with the fix - when the block holds another block's
 * value, is cut short, or has HTML in Header(CSS) or the Footer. Otherwise
 * { value, rec }: the value, checked three ways (see verify), and the record
 * it belongs to now.
 */
export function prepareAgain(rec, now, others = []) {
  const s = pasteStatus(now, rec, others);
  if (['wrong tab', 'wrong block', 'cut short'].includes(s.status)) return { refused: s.say };
  const body = String(now?.bodyHtml ?? '');
  const items = rec.items || [];
  // A text sent back stays English: its translation is what was refused.
  const prep = prepareBody(body, items.map((i) => ({ cell: i.cell, translation: i.status === 'sent back' ? '' : (i.translation ?? '') })));
  if (!prep.placed.length) {
    return { refused: 'Nothing to put in: the block as it is now has none of the sheet’s English left. Check again says where it stands.' };
  }
  const checks = verify(body, prep.value, prep.placed);
  if (checks.length) return { refused: `DSY’s own check of the new value found a problem - ${checks[0]}.` };
  return {
    value: prep.value,
    rec: {
      ...rec,
      old: { headerInclude: now.headerInclude ?? null, bodyHtml: body, footerInclude: now.footerInclude ?? null },
      prepared: prep.value,
      items: items.map((i, n) => (i.status === 'sent back' ? i : { ...i, ...prep.items[n] })),
      notOnSheet: prep.notOnSheet
    }
  };
}

/**
 * What Copy new Body(HTML) puts on the clipboard, for a block read again just
 * now: the prepared value while the block still holds its old one; made again
 * on what it holds if someone changed it since Check (see prepareAgain); and
 * nothing - { refused }, with the fix - for a block pasted already, one that
 * holds another block's value, is cut short, or has HTML in a wrong tab.
 */
export function forCopy(rec, now, others = []) {
  const s = pasteStatus(now, rec, others);
  if (s.status === 'not pasted') return { value: rec.prepared };
  if (s.status === 'differs') return prepareAgain(rec, now, others);
  if (s.status === 'pasted') return { refused: 'This block is pasted already - there is nothing to copy. Check again says where it stands.' };
  return { refused: s.say };
}

/* ------------------------------------------------------------- storage */

async function readKept(key) {
  try {
    return (await chrome.storage.local.get(key))[key] || null;
  } catch {
    return null;
  }
}

/** Keeps a page's record; then drops pages kept too long, and the oldest while all of them together are too big. */
async function keep(key, page) {
  try {
    await chrome.storage.local.set({ [key]: page });
    const all = await chrome.storage.local.get(null);
    const pages = Object.entries(all)
      .filter(([k]) => k.startsWith(STORE))
      .sort(([, a], [, b]) => (b.at || 0) - (a.at || 0));
    const drop = [];
    let size = 0;
    for (const [k, v] of pages) {
      const n = JSON.stringify(v).length;
      if (k !== key && (Date.now() - (v.at || 0) > KEEP_DAYS * DAY || size + n > KEEP_CHARS)) drop.push(k);
      else size += n;
    }
    if (drop.length) await chrome.storage.local.remove(drop);
  } catch {
    // The kept values are a help - Copy old Body(HTML) puts a block back from them: without them a block still works.
  }
}

const idOf = (b) => `${b.path}#${sourceHash(b.old.bodyHtml ?? '')}`;

/**
 * A block's kept record: `first`, its three fields as first read - from an
 * earlier check when there was one, never replaced - and `base` and
 * `prepared`, the value this check prepared and what it was made from. A
 * block checked again after its paste has a new old value, so it is found by
 * the value prepared for it before: its first old value goes along, and so
 * does that value - this check prepares nothing for it, and the block can
 * still say it is pasted. A block changed again after its paste - a word
 * fixed, the editor's own rewrite - matches neither: its first old value is
 * still taken from the oldest record of the same block, never from what it
 * holds now.
 */
function recordFor(kept, b) {
  const id = idOf(b);
  const same = Object.entries(kept.blocks).filter(([k]) => k.startsWith(`${b.path}#`)).map(([, r]) => r);
  const before = kept.blocks[id] || same.find((r) => r.prepared && flat(r.prepared) === flat(b.old.bodyHtml));
  // `since` is when the first old value was read; `at` moves on with every save.
  const oldest = same.filter((r) => r.first).sort((p, q) => (p.since ?? p.at ?? 0) - (q.since ?? q.at ?? 0))[0];
  const pasted = !b.prepared && before?.prepared && flat(before.prepared) === flat(b.old.bodyHtml);
  return {
    first: oldest?.first || b.old,
    since: oldest ? (oldest.since ?? oldest.at) : Date.now(),
    base: pasted ? before.base : b.old,
    prepared: pasted ? before.prepared : b.prepared,
    at: Date.now()
  };
}

/** No earlier record, and texts already translated in it: what the block holds now is not its value from before the paste. */
const noOldValue = (kept, b) =>
  !Object.keys(kept.blocks).some((k) => k.startsWith(`${b.path}#`)) && b.items.some((i) => i.status === 'already');

/* --------------------------------------------------------------- blocks */

/** Where to look after the paste: the places a visitor only sees on a click or a pointer. */
function lookAt(block) {
  const seen = new Set();
  for (const t of blockTexts(block)) {
    for (const h of t.places.flatMap((p) => p.hints)) {
      const tab = h.match(/^Hidden until the visitor clicks the "(.*)" tab$/);
      if (tab) seen.add(`tab "${tab[1]}"`);
      else if (h === 'In an overlay that opens on click') seen.add('the overlay that opens on click');
      else if (h === 'Shown when the visitor points at a colour dot') seen.add('the colour dots’ tooltips');
      else if (h === 'Shown when the visitor points at it') seen.add('the tooltips');
    }
  }
  return [...seen];
}

const fileOf = (url) => (url ? String(url).split(/[?#]/)[0].split('/').filter(Boolean).pop() : null);

/** What to check rather than translate. A block counts them. */
function toCheck(block, from, to) {
  const { report } = block.body;
  const out = [];
  const site = siteOf(from);
  const elsewhere = site && site !== siteOf(to) ? report.links.filter((l) => l.includes(`/${site}/`)).length : 0;
  if (elsewhere) out.push(`${plural(elsewhere, 'link')} to /${site}/`);
  if (report.emptySlots.length) out.push(plural(report.emptySlots.length, 'empty slot'));
  const media = [report.images.length ? plural(report.images.length, 'image') : '', report.videos ? plural(report.videos, 'video') : ''].filter(Boolean);
  if (media.length) out.push(media.join(', '));
  return out;
}

/** What is a developer's in the block: the Footer, and its layout, keys, fonts and scripts (see developerReport). */
function forDeveloper(b) {
  return [...(b.developer.length ? [`Footer(Javascript): ${plural(b.developer.length, 'change')}, line by line`] : []), ...developerReport(b.old)];
}

/**
 * One card per Static Content block, to go inside its section on the review:
 * where the block is, what DSY writes when its section is ticked, its Copy
 * new / Copy old / Check again buttons and its hand-offs. `ask(action,
 * params)` runs a read-only action of the worker in the tab that was
 * checked, and gives back its result or throws.
 *
 * Returns { cardOf, tick }: `cardOf(section)` the card for a block's section,
 * or null; `tick(section, on)` says on the card whether DSY writes the block
 * - the review's tick, nothing asked of the page.
 */
export function renderPasteByHand(data, { el, ask }) {
  const views = data.staticBlocks.map((b) => {
    const block = readBlock(b.old);
    return {
      b,
      block,
      name: block.name,
      modifiedBy: b.modifiedBy,
      first: b.old,
      // Until the kept values are read: texts translated already mean this may not be the old value.
      noOld: b.items.some((i) => i.status === 'already'),
      rec: { no: b.no, old: b.old, prepared: b.prepared, reason: b.reason, items: b.items, notOnSheet: b.notOnSheet },
      status: null,
      footer: b.script.length ? footerStatus(b.old.footerInclude, b.script) : null,
      links: linksOf(b.old, data.exportedFrom, data.page),
      images: imagesOf(b.old),
      ticked: false,
      failed: []
    };
  });
  const othersOf = (v) => views.filter((o) => o !== v).map((o) => o.rec);
  for (const v of views) v.status = pasteStatus(v.rec.old, v.rec, othersOf(v));
  const byNo = new Map(views.map((v) => [v.b.no, v]));
  // DSY writes the block's Body only when its section is ticked and a value was prepared and checked.
  const writes = (v) => v.ticked && v.b.prepared !== null;

  let banner = null;
  const storeKey = `${STORE}${data.origin || ''}${data.page}`;
  let kept = { at: Date.now(), blocks: {} };
  const save = (v) => {
    const r = kept.blocks[idOf(v.b)];
    if (!r) return;
    Object.assign(r, { base: v.rec.old, prepared: v.rec.prepared, at: Date.now() });
    kept.at = Date.now();
    keep(storeKey, kept);
  };

  // For the hand-offs on the cards: the site the links go to, a button, a sentence the script builds.
  const target = siteOf(data.page);
  const button = (label) => {
    const btn = el('button', 'paste-btn', label);
    btn.type = 'button';
    return btn;
  };
  const sentences = (item) => item.texts.map((x) => `"${x.cell}" becomes "${x.translation}"`).join(', ');

  /* ---- one card per block ------------------------------------------------ */
  for (const v of views) {
    const { b, block } = v;
    const card = el('div', 'paste-card');
    card.dataset.block = String(b.no);
    v.card = card;
    v.meta = el('div', 'paste-meta');
    v.around = el('div', 'paste-meta');
    const counts = (s) => b.items.filter((i) => i.status === s).length;
    const parts = [
      plural(counts('placed'), 'text') + ' to place',
      `${counts('same')} same as English`,
      `${counts('sent back')} sent back`,
      `${b.notOnSheet.length} not on the sheet`,
      ...(counts('already') ? [`${counts('already')} pasted already`] : []),
      ...(counts('not found') ? [`${counts('not found')} not found`] : [])
    ];
    card.append(v.meta, v.around, el('div', 'paste-counts', parts.join(' · ')));

    // What a tick writes, and what it cannot - and why.
    v.dsy = el('div', 'paste-dsy');
    card.append(v.dsy);
    if (b.prepared === null && b.items.some((i) => i.status === 'placed')) card.append(line(el, 'Body(HTML) not written:', b.reason));
    if (b.preparedFooter === null && b.footerReason) card.append(line(el, 'Footer(Javascript) not written:', b.footerReason));

    const buttons = el('div', 'paste-buttons');
    v.copyNew = el('button', 'paste-btn', 'Copy new Body(HTML)');
    v.copyNew.dataset.tone = 'primary';
    v.copyOld = el('button', 'paste-btn', 'Copy old Body(HTML)');
    v.again = el('button', 'paste-btn', 'Check again');
    for (const btn of [v.copyNew, v.copyOld, v.again]) btn.type = 'button';
    buttons.append(v.copyNew, v.copyOld, v.again);
    v.banners = el('div', 'paste-banners');
    card.append(buttons, v.banners);

    const look = lookAt(block);
    if (look.length) card.append(line(el, 'After pasting, look at:', look.join(', ')));
    const check = toCheck(block, data.exportedFrom, data.page);
    if (check.length) card.append(line(el, 'Check, not translate:', check.join(' · ')));
    const dev = forDeveloper(b);
    if (dev.length) card.append(line(el, 'Developer:', dev.join(' · ')));
    v.statusLine = el('div', 'paste-status');
    v.open = el('ul', 'paste-open');
    card.append(v.statusLine, v.open);
    if (b.developer.length || b.preparedFooter !== null) card.append(developerBox(v));
    if (v.links.length) card.append(linksBox(v));
    if (v.images.length) card.append(imagesBox(v));

    v.copyNew.addEventListener('click', () => copyNew(v));
    v.copyOld.addEventListener('click', () => copyOld(v));
    v.again.addEventListener('click', () => checkAgain(v));
  }

  /* ---- drawing what changes --------------------------------------------- */
  const near = (no) => {
    const o = byNo.get(no);
    if (!o) return `block ${no}`;
    const st = o.status.status === 'pasted' ? 'pasted - now shows its translation' : o.status.status === 'nothing to paste' ? 'nothing to paste' : 'not pasted';
    return `block ${no} "${o.name}" (${st})`;
  };
  const paint = (v) => {
    const { b } = v;
    v.meta.textContent = `${b.path.split('/').pop() || '(page)'} · first image: ${fileOf(v.block.body.report.images[0]) || 'none'} · last changed by: ${v.modifiedBy || 'unknown'}`;
    v.around.textContent = `${b.no > 1 ? `After ${near(b.no - 1)}` : 'First block on the page'} · ${b.no < b.of ? `before ${near(b.no + 1)}` : 'last block on the page'}`;
    const going = [b.prepared !== null ? 'Body(HTML)' : '', b.preparedFooter !== null ? 'Footer(Javascript)' : ''].filter(Boolean);
    v.dsy.hidden = !v.ticked || !going.length;
    v.dsy.textContent = `DSY will write this block: ${going.join(' and ')}`;
    v.copyNew.hidden = writes(v);
    v.copyNew.disabled = !v.rec.prepared || writes(v) || Boolean(v.busy);
    v.again.disabled = Boolean(v.busy);
    if (v.repointTick) v.repointTick.disabled = !v.rec.prepared || v.status.status === 'pasted' || writes(v) || Boolean(v.busy);
    if (v.devStatus && v.footer) v.devStatus.textContent = v.busy ? 'Footer check: checking…' : `Footer check: ${v.footer.say}`;
    v.statusLine.textContent = v.busy ? 'Status: checking…' : `Status: ${v.status.say}`;
    v.card.dataset.status = v.status.status;
    v.open.textContent = '';
    for (const o of [...v.status.open, ...v.status.extra]) v.open.append(el('li', null, o));
    if (v.footer) v.open.append(el('li', 'paste-footer', `Footer(Javascript): ${v.footer.say}`));
  };
  const paintAll = () => {
    for (const v of views) paint(v);
  };

  /* ---- what the buttons do ---------------------------------------------- */
  const read = async (v) => {
    const now = await ask('staticStatus', { page: data.page, node: v.b.path });
    v.now = now;
    v.name = readBlock(now).name;
    if (now.modifiedBy) v.modifiedBy = now.modifiedBy;
    v.status = pasteStatus(now, v.rec, othersOf(v));
    if (v.footer) v.footer = footerStatus(now.footerInclude, v.b.script);
    return now;
  };
  // The clipboard is about to change: what the last banner said is no longer true.
  const dropBanner = () => {
    banner?.remove();
    banner = null;
  };
  const copied = (v, text) => {
    dropBanner();
    banner = el('div', 'paste-copied', text);
    banner.dataset.tone = 'ok';
    v.banners.append(banner);
  };
  // Stays until dismissed: a person about to paste must see it.
  const notCopied = (v, why) => {
    const n = el('div', 'paste-copied');
    n.dataset.tone = 'fail';
    const close = el('button', 'link-btn', 'Dismiss');
    close.type = 'button';
    close.addEventListener('click', () => n.remove());
    n.append(el('b', null, 'Not copied - do not paste. '), el('span', null, `${why} The clipboard still holds what was there before.`), close);
    v.banners.append(n);
  };
  const where = (v) => `block ${v.b.no} of ${v.b.of} · ${v.name}`;

  /* The clipboard is written at once, inside the click, with a value that
   * arrives when the block has been read again - so the browser keeps the
   * click's permission while the read runs. */
  async function copyNew(v) {
    dropBanner();
    v.busy = true;
    paintAll();
    let made = false;
    const value = (async () => {
      let r = forCopy(v.rec, await read(v), othersOf(v));
      if (r.refused) throw new Error(r.refused);
      // Made again on the block as it is now: its links are re-pointed again, as ticked.
      if (r.rec && v.plain) {
        v.plain = r.rec;
        const p = repointLinks(r.rec, data.exportedFrom, data.page);
        if (p.refused) throw new Error(p.refused);
        r = { value: p.rec.prepared, rec: p.rec };
      }
      if (r.rec) {
        v.rec = r.rec;
        v.status = pasteStatus(v.now, v.rec, othersOf(v));
        made = true;
        save(v);
      }
      return r.value;
    })();
    const blob = value.then((s) => new Blob([s], { type: 'text/plain' }));
    blob.catch(() => {});
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      const s = await value;
      copied(
        v,
        `Copied: ${where(v)} · ${fmt(s.length)} characters - paste into THIS block` +
          (made ? '. The block changed since Check: DSY made the value again on it as it is now, keeping that change.' : '')
      );
    } catch (e) {
      notCopied(v, await value.then(() => e.message, (x) => x.message));
    }
    v.busy = false;
    paintAll();
  }

  /** Plain text to the clipboard, at once: an old value, or the developer's list. `say` is the banner, from the text. */
  async function copyText(v, text, say) {
    dropBanner();
    try {
      if (typeof text !== 'string') throw new Error('DSY has no value of this block from before the paste, so there is nothing to put back.');
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      copied(v, say(text));
    } catch (e) {
      notCopied(v, e.message);
    }
  }

  // Pasted before DSY kept anything: what the block holds now is no old value, so nothing is copied as one.
  const copyOld = (v) =>
    copyText(v, v.noOld ? null : v.first.bodyHtml, (s) => `Copied the OLD value: ${where(v)} · ${fmt(s.length)} characters - paste it into THIS block only to undo the paste`);

  async function checkAgain(v) {
    v.busy = true;
    paintAll();
    const [checked] = await Promise.allSettled([read(v)]);
    if (checked.status === 'rejected') v.status = { status: 'failed', say: `Could not check: ${checked.reason.message}`, open: [], extra: [] };
    v.busy = false;
    paintAll();
  }

  /* ---- the hand-offs on a card ------------------------------------------ */

  /** The developer's list as plain text, for Copy list: a line's number, then the line now and as it becomes. */
  const devList = (v) =>
    [
      `${where(v)} - Footer(Javascript), line by line`,
      ...v.b.developer.flatMap((item) =>
        item.lines.flatMap((l) => [`Line ${l.line}`, `  now: ${l.now}`, `  new: ${l.new ?? `write it with the whole sentences - ${sentences(item)}`}`])
      )
    ].join('\r\n');

  /**
   * The Footer, folded: what changes line by line - DSY writes it when the
   * block is ticked, a developer can put it in instead - Copy old
   * Footer(Javascript) to undo either, and a check of it, read only.
   */
  function developerBox(v) {
    const d = el('details', 'paste-hand paste-dev');
    const lines = v.b.developer.flatMap((item) => item.lines.map((l) => ({ ...l, item })));
    d.append(el('summary', null, `Footer(Javascript), line by line (${plural(lines.length, 'line')})`));
    const list = el('ol', 'paste-dev-lines');
    for (const l of lines) {
      const li = el('li');
      li.append(el('div', 'paste-label', `Line ${l.line}`), el('div', 'paste-code', `now: ${l.now}`));
      li.append(el('div', 'paste-code', `new: ${l.new ?? `write it with the whole sentences - ${sentences(l.item)}`}`));
      list.append(li);
    }
    const warn = el('p', 'paste-warn', 'After the change, open Preview. If the showcase area is empty, the script broke - paste the old Footer back at once.');
    const buttons = el('div', 'paste-buttons');
    const copyList = button('Copy list');
    const copyOldFooter = button('Copy old Footer(Javascript)');
    const again = button('Check again');
    copyList.addEventListener('click', () => copyText(v, devList(v), () => `Copied the developer’s list: ${where(v)} · ${plural(lines.length, 'line')}`));
    copyOldFooter.addEventListener('click', () =>
      copyText(v, v.first.footerInclude, (s) => `Copied the OLD Footer(Javascript): ${where(v)} · ${fmt(s.length)} characters - paste it into THIS block’s Footer only to undo`)
    );
    again.addEventListener('click', () => checkAgain(v));
    buttons.append(copyList, copyOldFooter, again);
    v.devStatus = el('div', 'paste-status');
    d.append(list, warn, buttons, v.devStatus);
    return d;
  }

  /** Links that point at another site: the sheet's, which can be re-pointed in the value copied - opt in - and any other, to check. */
  function linksBox(v) {
    const d = el('details', 'paste-hand');
    d.append(el('summary', null, `Links to check (${v.links.length})`));
    const list = el('ul', 'paste-hand-list');
    for (const l of v.links) {
      const says = [`${l.field}: ${l.link}`, `points at /${l.site}/`];
      if (l.field !== 'Body(HTML)') says.push('the developer changes it');
      else if (!l.to) says.push('check it');
      if (l.product) says.push(`check this page exists on ${target}`);
      list.append(el('li', null, says.join(' - ')));
    }
    d.append(list);
    if (target && v.links.some((l) => l.to && l.field === 'Body(HTML)')) {
      const box = el('label', 'paste-version');
      v.repointTick = el('input');
      v.repointTick.type = 'checkbox';
      box.append(v.repointTick, el('span', null, `Re-point links to ${target}`));
      const say = el('div', 'paste-hint', 'Only in the value Copy new Body(HTML) copies. Images and DAM paths are never touched. Nothing is written to AEM.');
      v.repointTick.addEventListener('change', () => repoint(v, say));
      d.append(box, say);
    }
    return d;
  }

  /** The tick to re-point: the value is made again with its links re-pointed, and checked again; unticked, it is as it was. */
  function repoint(v, say) {
    dropBanner();
    if (v.repointTick.checked) {
      const r = repointLinks(v.rec, data.exportedFrom, data.page);
      if (r.refused) {
        v.repointTick.checked = false;
        say.textContent = r.refused;
        return;
      }
      v.plain = v.rec;
      v.rec = r.rec;
      say.textContent = r.links.length
        ? `${plural(r.links.length, 'link')} re-pointed in the new Body(HTML), and the value checked again. Copy new Body(HTML) copies it so.`
        : `No link in the block points at /${siteOf(data.exportedFrom)}/ now.`;
    } else {
      if (v.plain) v.rec = v.plain;
      v.plain = null;
      say.textContent = 'Links left as they are.';
    }
    v.status = pasteStatus(v.now ?? v.b.old, v.rec, othersOf(v));
    save(v);
    paintAll();
  }

  /** The block's pictures and videos, for a designer. */
  function imagesBox(v) {
    const d = el('details', 'paste-hand');
    d.append(el('summary', null, `Images for the designer (${v.images.length})`));
    d.append(el('p', 'paste-hand-note', 'Check each picture for English words. New images are uploaded to DAM, never copied. Change the path in the block before Copy new Body(HTML).'));
    const list = el('ul', 'paste-hand-list');
    for (const f of v.images) {
      const li = el('li', null, `${f.field}: ${f.say}`);
      li.title = f.files.join('\n');
      list.append(li);
    }
    d.append(list);
    return d;
  }

  paintAll();
  readKept(storeKey).then((k) => {
    kept = { at: Date.now(), blocks: k?.blocks || {} };
    for (const v of views) {
      v.noOld = noOldValue(kept, v.b);
      const r = recordFor(kept, v.b);
      kept.blocks[idOf(v.b)] = r;
      v.first = r.first;
      // Pasted at an earlier check: what it holds is checked against the value prepared then.
      if (!v.rec.prepared && r.prepared) v.rec = { ...v.rec, old: r.base, prepared: r.prepared };
    }
    for (const v of views) v.status = pasteStatus(v.b.old, v.rec, othersOf(v));
    paintAll();
    return keep(storeKey, kept);
  });

  const bySection = new Map(views.map((v) => [v.b.label, v]));
  return {
    cardOf: (section) => bySection.get(section)?.card ?? null,
    tick(section, on) {
      const v = bySection.get(section);
      if (!v) return;
      v.ticked = on;
      paint(v);
    }
  };
}

function line(el, label, text) {
  const d = el('div', 'paste-line');
  d.append(el('span', 'paste-label', `${label} `), el('span', null, text));
  return d;
}
