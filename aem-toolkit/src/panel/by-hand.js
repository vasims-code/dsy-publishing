/**
 * The images a run will not carry - or did not - for someone to do by hand.
 *
 * Grouped by what has to be done about them, as a list rather than a table: a
 * DAM path is only useful whole, and a reason three columns to the right is a
 * reason nobody reads. Each line is a block, so selecting the list and copying
 * it keeps one value per line; Copy list gives tab-separated rows for Excel.
 *
 * Each entry is { kind, from, to, reason, urls? }:
 *
 *   upload     exists, belongs at `to`, was not carried
 *   delivered  gone from the source DAM, still served by Dynamic Media at `urls`
 *   missing    gone from the DAM and from Dynamic Media - nothing to get back
 */

/* What each kind of image asks of someone, before the run and after it. */
const GROUPS = [
  {
    kind: 'upload',
    title: 'Put in place by hand',
    copy: 'Put in place',
    before: 'Will not be carried. The page will point at the path shown — put the image there.',
    after:
      'The page already points at the path shown for each. Put the image there — a content ' +
      'package, or an upload in Assets — and it appears on the page.'
  },
  {
    kind: 'delivered',
    title: 'Not in the DAM, still on Dynamic Media',
    copy: 'Not in the DAM, on Dynamic Media',
    before:
      'Deleted from the source DAM, but Dynamic Media still serves its copy, so the page shows ' +
      'them today. Download each from a link below and upload it to the DAM path shown, before ' +
      'that copy is cleared.',
    after:
      'Deleted from the source DAM, but Dynamic Media still serves its copy. Download each from ' +
      'a link below and upload it to the DAM path shown.'
  },
  {
    kind: 'missing',
    title: 'Image not available',
    copy: 'Image not available',
    before: 'Not in the source DAM, and not on Dynamic Media live or staging either, so there is ' +
      'nothing to carry. Add the image at the path shown, or fix the reference on the page.',
    after: 'Not in the source DAM, and not on Dynamic Media live or staging either. Add the image ' +
      'at the path shown, or fix the reference on the page.'
  }
];

const kindOf = (a) => a.kind || (a.to ? 'upload' : 'missing');

/**
 * @param {object}   opts
 * @param {boolean}  opts.done   after the run rather than before it
 * @param {string}  [opts.title] the heading; "N images to do by hand" by default
 * @param {string}  [opts.tail]  a closing line, shown before the run only
 */
export function byHandBox(el, list, { done, title, tail } = {}) {
  const box = el('div', 'by-hand');
  const head = el('div', 'by-hand-head');
  head.append(el('p', 'by-hand-title',
    title || `${list.length} image${list.length === 1 ? '' : 's'} to do by hand`));
  head.append(copyButton(el, list));
  box.append(head);

  for (const g of GROUPS) {
    const rows = list.filter((a) => kindOf(a) === g.kind);
    if (!rows.length) continue;
    const group = el('div', 'by-hand-group');
    group.append(el('p', 'by-hand-group-title', `${g.title} · ${rows.length}`));
    group.append(el('p', 'by-hand-note', done ? g.after : g.before));

    const ul = el('ul', 'by-hand-list');
    for (const a of rows) {
      const li = el('li');
      const from = el('div', 'by-hand-from', a.from);
      from.title = a.from;
      li.append(from);
      if (a.to && a.to !== a.from) {
        const to = el('div', 'by-hand-to', `→ ${a.to}`);
        to.title = a.to;
        li.append(to);
      }
      for (const u of a.urls || []) {
        const line = el('div', 'by-hand-url');
        line.append(el('span', 'by-hand-url-name', u.name));
        const link = el('a', '', u.url);
        link.href = u.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = u.url;
        line.append(link);
        li.append(line);
      }
      li.append(el('div', 'by-hand-why', a.reason));
      ul.append(li);
    }
    group.append(ul);
    box.append(group);
  }

  if (!done && tail) box.append(el('p', 'by-hand-note', tail));
  return box;
}

function copyButton(el, list) {
  const copy = el('button', 'link-btn', 'Copy list');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    const what = Object.fromEntries(GROUPS.map((g) => [g.kind, g.copy]));
    const url = (a, name) => a.urls?.find((u) => u.name === name)?.url || '';
    const rows = [
      ['To do', 'Image on the source', 'Put it here', 'Live URL', 'Staging URL', 'Why'],
      ...list.map((a) => [what[kindOf(a)], a.from, a.to || '', url(a, 'live'), url(a, 'staging'), a.reason])
    ];
    try {
      await navigator.clipboard.writeText(rows.map((r) => r.join('\t')).join('\n'));
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Could not copy';
    }
    setTimeout(() => (copy.textContent = 'Copy list'), 1600);
  });
  return copy;
}
