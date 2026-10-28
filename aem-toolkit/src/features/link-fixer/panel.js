/**
 * link-fixer, panel side.
 *
 * Draws the links found, one fold per component in page order, each with the
 * relative path it becomes and a tick box - all ticked to start with. The shell
 * asks `commitState()` what the button says, and is told to ask again with an
 * `aemt:flow-changed` event whenever the ticks change.
 */

const STEPS = [
  ['check-first', 'Check the page', 'Each property must still hold what the scan read, and the page must not be locked by someone else.'],
  ['write', 'Make the ticked links relative', 'Only the properties holding them. Page properties are not changed.'],
  ['check', 'Read the page back', 'Confirm every property now holds the fixed value.']
];

let state = { data: null, ticked: new Set() };

const changed = () => document.dispatchEvent(new CustomEvent('aemt:flow-changed'));
const key = (c, l) => `${c.node}\u0000${l.prop}\u0000${l.index}\u0000${l.start}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const WHERE = { value: 'link field', attribute: 'in rich text', json: 'in a list' };

export function renderResult(root, data, { el }) {
  if (!data || !('components' in data)) return;
  state = {
    data,
    ticked: new Set(data.components.flatMap((c) => c.links.map((l) => key(c, l))))
  };

  const wrap = el('div', 'analysis link-fixer');

  /* ---- counts ----------------------------------------------------------- */
  const bar = el('div', 'summary');
  const counts = el('div', 'summary-counts');
  const stat = (n, label, kind) => {
    const s = el('span', 'stat');
    s.dataset.kind = kind;
    s.append(el('b', null, String(n)), el('span', null, ` ${label}`));
    counts.append(s);
  };
  stat(data.count, data.count === 1 ? 'full-URL link' : 'full-URL links', data.count ? 'warn' : 'copy');
  if (data.count) stat(data.components.length, data.components.length === 1 ? 'component' : 'components', 'skip');
  bar.append(counts);
  const hosts = el('div', 'summary-from');
  hosts.append(el('span', 'summary-label', 'Hosts'), el('span', 'summary-path', data.hosts.join(', ')));
  bar.append(hosts);
  wrap.append(bar);

  if (!data.count) {
    wrap.append(
      el('p', 'versions-empty', `Every link in the page content is already relative. ${data.nodes} nodes read; page properties not checked.`)
    );
    root.append(wrap);
    changed();
    return;
  }

  /* ---- Select all ---------------------------------------------------------- */
  const tools = el('div', 'import-tools');
  const allBox = el('label', 'check import-all');
  const all = el('input');
  all.type = 'checkbox';
  allBox.append(all, el('span', null, 'Select all'));
  tools.append(allBox);
  wrap.append(tools);

  /* ---- one fold per component ---------------------------------------------- */
  const boxes = [];
  const list = el('div', 'import-sections');
  for (const c of data.components) {
    const d = el('details', 'detail import-section');
    d.open = true;
    const sum = el('summary');
    // The editor's name for it, and the node's own name to tell two of a kind apart.
    const title = el('span', 'detail-title', c.title || c.type || c.node.split('/').pop());
    title.title = `${c.resourceType || ''}
${c.node}`.trim();
    const name = el('span', 'link-node', c.node.split('/').pop());
    name.title = c.node;
    sum.append(title, name, el('span', 'detail-count', String(c.links.length)));
    d.append(sum);

    const items = el('ol', 'import-rows');
    if (c.liveCopy) {
      items.append(
        el(
          'li',
          'link-note',
          'Live copy: a rollout from the blueprint will put the full URL back unless this component’s inheritance is cancelled.'
        )
      );
    }
    for (const l of c.links) {
      const li = el('li', 'import-row link-row');
      const head = el('label', 'import-row-head link-head');
      const tick = el('input', 'import-tick');
      tick.type = 'checkbox';
      tick.checked = true;
      const k = key(c, l);
      tick.addEventListener('change', () => {
        if (tick.checked) state.ticked.add(k);
        else state.ticked.delete(k);
        refresh();
      });
      boxes.push({ tick, k });
      const where = el('span', 'deck-tag', `${l.prop}${l.index >= 0 ? `[${l.index}]` : ''} · ${WHERE[l.context] || ''}`);
      head.append(tick, where);
      if (l.text) head.append(el('span', 'link-text', `“${l.text}”`));
      li.append(head);

      const line = (label, text, kind) => {
        const row = el('div', 'import-line');
        row.dataset.kind = kind;
        const t = el('span', 'import-text link-url', text);
        t.title = text;
        row.append(el('span', 'import-label', label), t);
        return row;
      };
      li.append(line('now', l.from, 'old'), line('becomes', l.to, 'new'));
      items.append(li);
    }
    d.append(items);
    list.append(d);
  }
  wrap.append(list);

  const plan = el('ol', 'plan link-plan');
  for (const [id, t, hint] of STEPS) {
    const li = el('li', 'plan-step');
    li.dataset.step = id;
    li.dataset.state = 'pending';
    const main = el('div', 'plan-main');
    main.append(el('span', 'plan-title', t), el('span', 'plan-state'));
    li.append(main, el('div', 'plan-hint', hint));
    plan.append(li);
  }
  wrap.append(plan);

  const refresh = () => {
    const n = state.ticked.size;
    all.checked = n === boxes.length;
    all.indeterminate = n > 0 && n < boxes.length;
    changed();
  };
  all.addEventListener('change', () => {
    for (const b of boxes) {
      b.tick.checked = all.checked;
      if (all.checked) state.ticked.add(b.k);
      else state.ticked.delete(b.k);
    }
    refresh();
  });

  root.append(wrap);
  refresh();
}

/* ------------------------------------------------------------------ flow */

export function commitState() {
  const n = state.ticked.size;
  if (!state.data?.count) return { ready: false, label: 'Nothing to fix', question: 'No full-URL links on this page.' };
  if (!n) return { ready: false, label: 'Tick a link to fix', question: 'Tick the links to fix.' };
  return {
    ready: true,
    label: `Fix ${plural(n, 'link')}`,
    busy: 'Fixing\u2026',
    question: `Make ${plural(n, 'link')} relative?`,
    caption:
      'Only the ticked links change; page properties are not touched.'
  };
}

/** One pick per property: the value scanned, and which of its links to fix. */
export async function commit(ctx) {
  const picks = new Map();
  for (const c of state.data?.components || []) {
    for (const l of c.links) {
      if (!state.ticked.has(key(c, l))) continue;
      const id = `${c.node}\u0000${l.prop}`;
      if (!picks.has(id)) picks.set(id, { node: c.node, prop: l.prop, expect: l.value, links: [] });
      picks.get(id).links.push({ index: l.index, start: l.start, from: l.from, to: l.to });
    }
  }
  if (!picks.size) return { ok: false, error: 'Tick at least one link first.' };
  return ctx.send('fix', { ...ctx.params, picks: [...picks.values()] });
}

/* --------------------------------------------------------------- progress */

export function updateStep(root, { id, state: s, note }) {
  const li = root.querySelector(`.link-plan .plan-step[data-step="${cssEscape(id)}"]`);
  if (!li) return;
  li.dataset.state = s;
  const cell = li.querySelector('.plan-state');
  if (cell) {
    cell.textContent = s === 'done' ? (note ? `\u2713 ${note}` : '\u2713') : s === 'failed' ? '\u2717' : note || '';
  }
  if (s === 'running') li.scrollIntoView({ block: 'nearest' });
}

/** What was left unticked, under the outcome. */
export function renderDone(root, outcome, { el }) {
  if (!outcome?.left) return;
  root.append(
    el(
      'p',
      'versions-hint',
      `${plural(outcome.left, 'full-URL link')} still on the page - unticked, or added since the scan. Scan again to see them.`
    )
  );
}

function cssEscape(v) {
  return window.CSS?.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
}
