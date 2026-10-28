/**
 * The "Site values" box, shared by Sync page and From another server: the
 * Twitter handles, the title ending and the language, set to the destination
 * site's as read off its home page - with the tick box that leaves them alone.
 * And the same values again on the done screen, so what went in is on record.
 */

import { renderTable } from './table.js';

/**
 * On the review. Ticked, the table is what will be written; unticked, it is
 * what the page is left with. Anything the run could not work out is listed
 * under it either way, because those are what someone has to fix by hand.
 * `onChange(ticked)` reviews again with the new choice.
 */
export function renderSiteValues(parent, data, { el, onChange }) {
  const s = data.site;
  if (!s) return;
  const dest = `/${data.rewrite.destSite}`;

  const holder = el('div');
  renderTable(
    holder,
    {
      title: 'Site values',
      rows: s.applied ? s.rows : s.rows.map((r) => ({ prop: r.prop, keeps: r.keeps })),
      cols: s.applied ? ['prop', 'from', 'to'] : ['prop', 'keeps'],
      note: s.applied ? `Read from ${s.to}, the ${dest} home page. Untick to leave them as they are.` : null,
      tone: 'change'
    },
    el
  );
  // Nothing to set, only something to say: the box without a table.
  let d = holder.firstChild;
  if (!d) {
    d = el('details', 'detail');
    d.dataset.tone = 'info';
    const sum = el('summary');
    sum.append(el('span', 'detail-mark', '•'), el('span', 'detail-title', 'Site values'), el('span', 'detail-count', '0'));
    d.append(sum);
  }
  d.open = true;
  d.dataset.choice = 'site';

  if (s.rows.length) {
    const box = el('label', 'check detail-choice');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = s.applied;
    input.addEventListener('change', () => {
      input.disabled = true; // until the page is reviewed again with it
      onChange(input.checked);
    });
    box.append(input, el('span', null, `Set these page properties to the ${dest} site's values`));
    d.querySelector('summary').after(box);
    if (!s.applied) {
      box.after(
        el(
          'p',
          'detail-note detail-kept',
          data.mode === 'create'
            ? "Not set. The new page gets the source's values below — change them in page properties afterwards."
            : 'Not set. These stay as shown below.'
        )
      );
    }
  }

  for (const n of s.notes) {
    const p = el('p', 'detail-note', n);
    p.dataset.tone = 'warn';
    d.append(p);
  }
  parent.append(d);
}

/** On the done screen: what was set, or that nothing was, and what is left to check. */
export function renderSiteDone(root, outcome, { el }) {
  const s = outcome?.site;
  if (!s) return;

  if (s.rows.length) {
    const box = el('div', 'notice site-done');
    box.dataset.tone = s.applied ? 'info' : 'warn';
    box.append(
      el(
        'p',
        'site-done-title',
        s.applied ? `Site values set from ${s.to}` : 'Site values not set — change them in page properties if needed'
      )
    );
    const ul = el('ul', 'site-done-list');
    for (const r of s.rows) {
      const value = s.applied ? r.to : r.keeps;
      ul.append(el('li', null, r.failed ? `${r.prop}: not written — see the log` : `${r.prop}: ${value}`));
    }
    box.append(ul);
    root.append(box);
  }

  if (s.notes.length) {
    const box = el('div', 'notice site-done');
    box.dataset.tone = 'warn';
    box.append(el('p', 'site-done-title', 'Check these page properties by hand'));
    const ul = el('ul', 'site-done-list');
    for (const n of s.notes) ul.append(el('li', null, n));
    box.append(ul);
    root.append(box);
  }
}
