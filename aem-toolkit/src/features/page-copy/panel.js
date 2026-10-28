/**
 * Renders the page-copy analysis as a repository tree, the way CRXDE Lite
 * draws one.
 *
 * The thing being decided on is a path hierarchy, so it is drawn as the
 * repository people already read every day: one compact row per node, a
 * disclosure arrow, a node-type icon, and the full chain from the root, with a
 * tag at the right of each row for what the run does to that node.
 *
 * The same tree doubles as the progress view: once the copy starts, each node
 * picks up a live state from the step events the worker emits, so you watch it
 * fill in rather than reading a separate log.
 *
 * When the backup already exists, the leaf is an update and what matters is
 * the list of edits, not the shape - so the Sync page renderer draws that list
 * beneath the tree, and its step events are handed straight to it.
 */

import * as syncPanel from '../page-upsert/panel.js';

const TAG = {
  create: { label: 'new', title: 'Does not exist yet - created as an empty page' },
  skip: { label: 'exists', title: 'Already in the destination - left exactly as it is' },
  copy: { label: 'copy', title: 'The requested page - copied with all of its content' },
  update: { label: 'update', title: 'The backup already exists - only what differs from the source is written' },
  current: { label: 'up to date', title: 'The backup already matches the source - nothing to write' }
};

/* Small node-type icons, drawn to CRXDE's vocabulary: the repository root, a
 * folder and a page. */
const GLYPH = {
  root:
    '<ellipse cx="8" cy="3.8" rx="5.5" ry="2.1" fill="var(--crx-root-fill)" stroke="var(--crx-root)"/>' +
    '<path d="M2.5 3.8v8.4c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1V3.8" fill="var(--crx-root-fill)" stroke="var(--crx-root)"/>' +
    '<path d="M2.5 8c0 1.2 2.5 2.1 5.5 2.1s5.5-.9 5.5-2.1" fill="none" stroke="var(--crx-root)"/>',
  folder:
    '<path d="M1.5 4a1 1 0 0 1 1-1h3.6l1.4 1.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1z" ' +
    'fill="var(--crx-folder-fill)" stroke="var(--crx-folder)"/>',
  page:
    '<path d="M3.5 1.5h6l3 3v10h-9z" fill="var(--crx-page-fill)" stroke="var(--crx-page)" stroke-linejoin="round"/>' +
    '<path d="M9.5 1.5v3h3" fill="none" stroke="var(--crx-page)" stroke-linejoin="round"/>' +
    '<path d="M5.5 8h5M5.5 10.5h5" stroke="var(--crx-page)" stroke-linecap="round"/>'
};

function glyph(el, kind) {
  const s = el('span', 'crx-icon');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" stroke-width="1.1">${GLYPH[kind]}</svg>`;
  return s;
}

export function renderResult(root, data, { el }) {
  if (!data?.create && !data?.copy && !data?.update) return;

  const wrap = el('div', 'analysis crx');
  wrap.append(summaryBar(el, data));
  wrap.append(explorer(el, data));
  root.append(wrap);

  if (data.upToDate) {
    root.append(upToDate(el, data));
  } else if (data.sync) {
    // The update's own plan and evidence. Images are not checked for a backup,
    // so no image list appears.
    const sync = el('div', 'backup-sync');
    syncPanel.renderResult(sync, data.sync, { el });
    root.append(sync);
  }
}

/* ------------------------------------------------------------------ parts */

/** In place of an empty plan: the backup matches, and nothing will be written. */
function upToDate(el, data) {
  const box = el('div', 'up-to-date');
  box.append(el('span', 'up-to-date-mark', '\u2713'));
  const text = el('div');
  text.append(el('p', 'up-to-date-title', 'Already up to date'));
  text.append(
    el('p', 'up-to-date-text', 'The backup is the same as the original page. Nothing will be changed.')
  );
  // A source at AEM's JSON limit may have come back short, and removals were
  // not checked against it - so "the same" is only as good as that read.
  if (data.sync?.truncationRisk) {
    text.append(
      el(
        'p',
        'up-to-date-warn',
        'This page is very large, so AEM may not have sent all of it. Components removed ' +
          'from the original could not be checked.'
      )
    );
  }
  box.append(text);
  return box;
}

function summaryBar(el, data) {
  const bar = el('div', 'summary');

  const counts = el('div', 'summary-counts');
  if (data.counts.create) counts.append(stat(el, data.counts.create, 'to create', 'create'));
  if (data.counts.skip) counts.append(stat(el, data.counts.skip, 'already there', 'skip'));
  if (data.copy) counts.append(stat(el, 1, 'copied in full', 'copy'));
  if (data.update && data.upToDate) counts.append(stat(el, 1, 'backup already up to date', 'skip'));
  else if (data.update) counts.append(stat(el, 1, 'existing backup to update', 'copy'));
  bar.append(counts);

  const from = el('div', 'summary-from');
  from.append(el('span', 'summary-label', 'from'));
  from.append(el('span', 'summary-path', data.source));
  bar.append(from);

  return bar;
}

function stat(el, n, label, kind) {
  const s = el('span', 'stat');
  s.dataset.kind = kind;
  s.append(el('b', null, String(n)));
  s.append(el('span', null, ' ' + label));
  return s;
}

/**
 * A destination path is a single chain, so depth ordering is enough - there is
 * never more than one child at a level.
 */
function chainOf(data) {
  const nodes = [
    ...data.skip.map((n) => ({ ...n, kind: 'skip' })),
    ...data.create.map((n) => ({ ...n, kind: 'create' })),
    ...(data.copy ? [{ ...data.copy, kind: 'copy' }] : []),
    ...(data.update ? [{ ...data.update, kind: 'update' }] : [])
  ];
  return nodes.sort((a, b) => depth(a.path) - depth(b.path));
}

const segs = (p) => p.split('/').filter(Boolean);
const depth = (p) => segs(p).length;
const nameOf = (p) => segs(p).pop();

/* ---------------------------------------------------------------- explorer */

/** The tree, from the repository root down to the requested page. */
function explorer(el, data) {
  const nodes = chainOf(data);
  const box = el('div', 'crx-explorer');
  if (!nodes.length) return box;

  const tree = el('ul', 'crx-tree');
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', 'Destination in the repository');

  /* Everything above the first planned node is context: the repository root,
   * then each segment down to where the plan starts. The analysis does not
   * read these, so they carry no tag - only their place in the tree. */
  tree.append(row(el, { name: '/', icon: 'root', level: 0, context: true }));
  const above = segs(nodes[0].path).slice(0, -1);
  above.forEach((name, i) => {
    tree.append(row(el, { name, icon: i === 0 ? 'folder' : 'page', level: i + 1, context: true }));
  });

  nodes.forEach((n, i) => {
    const li = row(el, {
      name: nameOf(n.path),
      icon: n.primaryType && n.primaryType !== 'cq:Page' ? 'folder' : 'page',
      level: depth(n.path),
      leaf: i === nodes.length - 1,
      tag: n.kind === 'update' && data.upToDate ? 'current' : n.kind,
      node: n
    });
    tree.append(li);
  });

  box.append(tree);
  return box;
}

function row(el, { name, icon, level, context, leaf, tag, node }) {
  const li = el('li', context ? 'crx-row crx-context' : 'crx-row node');
  li.setAttribute('role', 'treeitem');
  li.style.setProperty('--level', String(level));
  if (!leaf) li.setAttribute('aria-expanded', 'true');

  // Every row but the requested page has the next one open beneath it.
  li.append(el('span', 'crx-twisty', leaf ? '' : '▾'));
  li.append(glyph(el, icon));
  li.append(el('span', 'crx-name node-name', name));

  if (node) {
    li.dataset.kind = tag;
    li.dataset.path = node.path;
    li.dataset.state = 'pending';
    li.tabIndex = 0;

    // The full path is worth having, but not worth a line each - so it is the
    // tooltip, and a click copies it.
    li.title = `${node.path}\n${TAG[tag].title}\nClick to copy the path`;
    const copyPath = () =>
      navigator.clipboard?.writeText(node.path).then(() => flash(el, li), () => {});
    li.addEventListener('click', copyPath);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        copyPath();
      }
    });

    const t = el('span', 'crx-tag', TAG[tag].label);
    t.dataset.kind = tag;
    li.append(t);

    // Filled in while the copy runs.
    li.append(el('span', 'node-state'));
  }
  return li;
}

function flash(el, li) {
  const t = el('span', 'flash', 'path copied');
  li.querySelector('.crx-name').after(t);
  setTimeout(() => t.remove(), 1200);
}

/* --------------------------------------------------------------- progress */

/** Called for each step event while the copy runs. */
export function updateStep(root, data) {
  // Section steps from the update carry an id, not a path.
  if (data.id) return syncPanel.updateStep(root, data);

  const { path, state } = data;
  const li = root.querySelector(`.node[data-path="${cssEscape(path)}"]`);
  if (!li) return;
  li.dataset.state = state;

  const cell = li.querySelector('.node-state');
  if (cell) cell.textContent = state === 'done' ? '\u2713' : state === 'failed' ? '\u2717' : '';

  if (state === 'running') li.scrollIntoView({ block: 'nearest' });
}

function cssEscape(v) {
  return window.CSS?.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&');
}
