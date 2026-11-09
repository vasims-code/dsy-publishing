/**
 * The repository tree, drawn the way CRXDE draws it: one row per path
 * segment, indented by depth, with a tag on the right saying what the run
 * will do to that node.
 *
 * The same tree is used twice - on the review, where every tag is a promise,
 * and on the run, where each row fills in as it happens. Nothing about it is
 * specific to Backup, so a tool that writes a path can reuse it.
 */

import { icon } from './icons.js';
import { el, spinner } from './parts.js';

/* What a row says it will do. The wording is the extension's own. */
export const TAG = {
  create: 'new',
  skip: 'exists',
  copy: 'copy',
  update: 'update',
  current: 'up to date',
  root: ''
};

/**
 * Builds the rows for a destination path.
 *
 * `marks` is { '<full path>': 'create' | 'skip' | 'copy' | 'update' | 'current' },
 * and anything not named is drawn plain - the parts of /content/<brand> that
 * were already there before anyone asked.
 */
export function pathRows(dest, marks = {}) {
  const segs = String(dest || '').split('/').filter(Boolean);
  const rows = [{ name: '/', level: 0, kind: 'root', path: '' }];
  let path = '';
  segs.forEach((name, i) => {
    path += `/${name}`;
    rows.push({
      name,
      level: i + 1,
      kind: marks[path] || null,
      // The last segment is the page itself; everything above it is a folder.
      leaf: i === segs.length - 1,
      path
    });
  });
  return rows;
}

/** One row. `state` is set while a run is going: todo, running, done, failed. */
function row(r, state) {
  const li = el('li', 'tree-row');
  li.setAttribute('role', 'treeitem');
  if (!r.leaf) li.setAttribute('aria-expanded', 'true');
  li.style.paddingLeft = `${r.level * 16 + 6}px`;
  if (r.kind) li.dataset.kind = r.kind;
  if (state) li.dataset.state = state;

  li.append(el('span', 'tree-twisty', r.leaf ? '' : '▾'));

  const ic = icon(r.kind === 'root' ? 'yard' : r.leaf ? 'deck' : 'folder', 14, 1.9);
  ic.classList.add('tree-icon');
  li.append(ic, el('span', 'tree-name', r.name));

  /* While a path is being worked on it turns instead of wearing a word -
     the same signal the run screen's steps give, so one glance reads both. */
  if (state === 'running') {
    li.append(spinner('tree-spin'));
  } else {
    const tag = state === 'done' ? 'done' : state === 'failed' ? 'failed' : TAG[r.kind];
    if (tag) li.append(el('span', 'tree-tag', tag));
  }
  return li;
}

/**
 * The tree inside its card. `title` heads it; `states` is an optional
 * { '<path>': 'running' | 'done' | 'failed' } for a run in progress.
 */
export function tree(title, rows, states = {}) {
  const card = el('div', 'list');
  card.append(el('div', 'tree-title', title));
  const scroll = el('div', 'tree-scroll');
  const ul = el('ul', 'tree');
  ul.setAttribute('role', 'tree');
  ul.setAttribute('aria-label', title);
  for (const r of rows) ul.append(row(r, states[r.path]));
  scroll.append(ul);
  card.append(scroll);
  return card;
}
