/**
 * The detail tables in an analysis.
 *
 * These hold JCR paths, and a path is only useful whole: "/content/dam/samsung/
 * uk/mobi…" and "/content/dam/samsung/lb/mobi…" are the two halves of a decision
 * that cannot be made from the visible part. Fitting five columns into a side
 * panel guarantees that, so the table is given real widths and allowed to
 * scroll sideways instead - and the column edges can be dragged, the way anyone
 * reading a grid of paths expects.
 *
 * Widths are per column NAME rather than per position, so the same kind of
 * column is the same size in every table without each one declaring it.
 */

const WIDTH = {
  /* short and fixed */
  action: 104, origin: 110, size: 64, scope: 62, uses: 48, count: 58, index: 54, props: 58, toIndex: 62, texts: 54,
  /* medium */
  here: 132, prop: 140, part: 150, reason: 170, node: 190, component: 200, why: 280,
  source: 200, destination: 200, was: 220,
  /* paths and links - wide enough for a typical DAM path */
  from: 360, to: 360, link: 360, path: 360, src: 360, dest: 360,
  folder: 360, asset: 360, sourceHas: 300, kept: 300, keeps: 300
};

const DEFAULT_WIDTH = 220;
const MIN_WIDTH = 40;
const MAX_ROWS = 200;

/**
 * Drag to resize, double-click to fit the widest value in the column.
 *
 * Fit uses each cell's scrollWidth, which is the content's real width because
 * the cells clip rather than wrap - so it measures what is actually there
 * rather than guessing from character counts.
 */
function addGrip(el, th, col, table, index) {
  const grip = el('span', 'col-grip');
  grip.title = 'Drag to resize, double-click to fit';

  grip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = col.getBoundingClientRect().width;
    document.body.classList.add('col-resizing');

    const move = (ev) => {
      col.style.width = `${Math.max(MIN_WIDTH, startW + ev.clientX - startX)}px`;
    };
    const up = () => {
      document.body.classList.remove('col-resizing');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  grip.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    let widest = 0;
    for (const row of table.rows) {
      const cell = row.cells[index];
      if (cell) widest = Math.max(widest, cell.scrollWidth);
    }
    col.style.width = `${Math.max(MIN_WIDTH, widest + 14)}px`;
  });

  // A summary inside a <details> toggles on click; the grip must not.
  grip.addEventListener('click', (e) => e.stopPropagation());
  th.append(grip);
}

/** The marker drawn beside a table's title, so a diff reads added / changed / removed at a glance. */
const TONE_MARK = { add: '+', change: '~', remove: '−', info: '•' };

/**
 * One collapsible table. Returns nothing and appends nothing when there are no
 * rows, so callers can list every possible table unconditionally.
 *
 * `tone` is add | change | remove | info, and only colours the heading.
 */
export function renderTable(parent, { title, rows, cols, note, tone }, el) {
  if (!rows?.length) return;

  const d = el('details', 'detail');
  d.dataset.tone = tone || 'info';
  const sum = el('summary');
  sum.append(el('span', 'detail-mark', TONE_MARK[tone] || TONE_MARK.info));
  sum.append(el('span', 'detail-title', title));
  sum.append(el('span', 'detail-count', String(rows.length)));
  d.append(sum);
  if (note) d.append(el('p', 'detail-note', note));

  const scroll = el('div', 'detail-scroll');
  const table = el('table', 'detail-table');

  const group = el('colgroup');
  const colEls = cols.map((c) => {
    const col = el('col');
    col.style.width = `${WIDTH[c] ?? DEFAULT_WIDTH}px`;
    group.append(col);
    return col;
  });
  table.append(group);

  const head = el('tr');
  cols.forEach((c, i) => {
    const th = el('th');
    th.append(el('span', null, c));
    if (i < cols.length - 1) addGrip(el, th, colEls[i], table, i);
    head.append(th);
  });
  table.append(head);

  for (const r of rows.slice(0, MAX_ROWS)) {
    const tr = el('tr');
    for (const c of cols) {
      const v = r[c] == null ? '' : String(r[c]);
      const td = el('td', null, v);
      td.title = v; // the whole value, however narrow the column is dragged
      tr.append(td);
    }
    table.append(tr);
  }

  scroll.append(table);
  d.append(scroll);
  if (rows.length > MAX_ROWS) {
    d.append(el('p', 'detail-note', `${rows.length - MAX_ROWS} more not shown.`));
  }
  parent.append(d);
}

