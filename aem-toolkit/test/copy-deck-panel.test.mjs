/* The copy deck's review screen, run for real: the panel module draws into a
 * small stand-in for the DOM, the list's Add and Ignore are clicked, a change
 * arrives from settings, and another feature takes the result area over.
 *
 * This is the code that only ran in a browser before - which is how
 * "Assignment to constant variable" reached a real panel. Here it has to draw,
 * and draw again, without throwing.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/';

/* A redraw from a settings change runs in a promise: its error would be "Uncaught (in promise)" in Chrome. */
const thrown = [];
process.on('unhandledRejection', (e) => thrown.push(`(in promise) ${e?.name}: ${e?.message}`));
process.on('uncaughtException', (e) => thrown.push(`${e?.name}: ${e?.message}`));

/* ------------------------------------------------------ a DOM, just enough */

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.own = '';
    this.className = '';
    Object.assign(this, { hidden: false, disabled: false, checked: false, type: '', title: '', open: false, selected: false });
    this._value = '';
  }
  append(...nodes) {
    for (const n of nodes) {
      const node = typeof n === 'string' ? Object.assign(new El('#text'), { own: n }) : n;
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = this;
      this.children.push(node);
    }
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  get textContent() {
    return this.own + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    for (const c of this.children) c.parent = null;
    this.children = [];
    this.own = String(v ?? '');
  }
  get isConnected() {
    let n = this;
    while (n.parent) n = n.parent;
    return n === document.body;
  }
  get value() {
    if (this.tagName !== 'SELECT') return this._value;
    const opts = this.children.filter((c) => c.tagName === 'OPTION');
    return (opts.find((o) => o.selected) || opts[0])?._value ?? '';
  }
  set value(v) {
    if (this.tagName !== 'SELECT') return void (this._value = String(v));
    for (const o of this.children) o.selected = o._value === String(v);
  }
  setAttribute(k, v) {
    this[`attr:${k}`] = v;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  dispatchEvent(e) {
    for (const fn of this.listeners[e.type] || []) fn(e);
  }
  click() {
    if (!this.disabled) this.dispatchEvent({ type: 'click' });
  }
  scrollIntoView() {}
  *all() {
    for (const c of this.children) {
      if (c.tagName === '#TEXT') continue;
      yield c;
      yield* c.all();
    }
  }
  matches(simple) {
    const [tag, ...classes] = simple.split('.');
    const mine = this.className.split(/\s+/);
    return (!tag || this.tagName === tag.toUpperCase()) && classes.every((c) => mine.includes(c));
  }
  querySelectorAll(selector) {
    const chains = selector.split(',').map((s) => s.trim().split(/\s+/));
    const hit = (node, chain) => {
      if (!node.matches(chain.at(-1))) return false;
      let up = node.parent;
      for (let i = chain.length - 2; i >= 0; i--) {
        while (up && !up.matches(chain[i])) up = up.parent;
        if (!up) return false;
        up = up.parent;
      }
      return true;
    };
    return [...this.all()].filter((n) => chains.some((c) => hit(n, c)));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

const docListeners = {};
globalThis.document = {
  body: new El('body'),
  createElement: (tag) => new El(tag),
  addEventListener: (type, fn) => (docListeners[type] ||= []).push(fn),
  dispatchEvent: (e) => (docListeners[e.type] || []).forEach((fn) => fn(e)),
  querySelectorAll: (s) => document.body.querySelectorAll(s)
};
globalThis.CustomEvent = class {
  constructor(type) {
    this.type = type;
  }
};
globalThis.window = { scrollY: 0, scrollTo() {} };
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };

/* chrome.storage.sync, answering late the way it does, with onChanged. */
let items = {};
const changed = [];
globalThis.chrome = {
  storage: {
    sync: {
      async get(keys) {
        await new Promise((r) => setTimeout(r, 2));
        return Object.fromEntries([].concat(keys).filter((k) => k in items).map((k) => [k, structuredClone(items[k])]));
      },
      async set(next) {
        await new Promise((r) => setTimeout(r, 2));
        Object.assign(items, structuredClone(next));
        const c = Object.fromEntries(Object.keys(next).map((k) => [k, { newValue: next[k] }]));
        for (const l of changed) l(c, 'sync');
      }
    },
    onChanged: { addListener: (l) => changed.push(l) },
    /* chrome.storage.local, for the Static Content cards: get(null) is everything. */
    local: {
      items: {},
      async get(keys) {
        const all = this.items;
        return structuredClone(keys === null ? all : Object.fromEntries([].concat(keys).filter((k) => k in all).map((k) => [k, all[k]])));
      },
      async set(next) {
        Object.assign(this.items, structuredClone(next));
      },
      async remove(keys) {
        for (const k of [].concat(keys)) delete this.items[k];
      }
    }
  }
};

/* The clipboard, as Chrome's: a ClipboardItem's value may be a promise, and a promise that fails leaves the clipboard as it was. */
let clip = 'what was there before';
globalThis.ClipboardItem = class {
  constructor(items) {
    this.items = items;
  }
};
const clipboard = {
  async write([item]) {
    const blob = await item.items['text/plain'];
    clip = await blob.text();
  }
};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard } });

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const settle = () => new Promise((r) => setTimeout(r, 40));

/* ------------------------------------------------------------------ tests */

const core = await import(pathToFileURL(base + 'src/features/copy-deck/core.js'));
const panel = await import(pathToFileURL(base + 'src/features/copy-deck/panel.js'));

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};
const attempt = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
};

const tree = JSON.parse(readFileSync(base + 'test/fixtures/copy-deck-za-tvs.json', 'utf8'));
tree.root.responsivegrid.cm_g_promo_banner_1 = {
  'sling:resourceType': 'samsung/components/content/consumer/global/common/cm-g-promo-banner',
  headlineText: 'Save on every TV',
  ctaLabel: 'Buy',
  list: { item0: { cardTitle: 'Picture quality' }, item1: { cardTitle: 'Sound' } }
};
const PAGE = '/content/samsung/za/tvs';
const result = { page: PAGE, title: 'TVs', language: null, tree, fields: { add: [], ignore: [] }, ...core.extractCopyDeck(tree, { pagePath: PAGE }) };

const root = el('div', 'result');
document.body.append(root);
const flow = [];
document.addEventListener('aemt:flow-changed', () => flow.push(panel.commitState()));

console.log('--- drawing ---------------------------------------------------------');

const sent = [];
check('the read is asked for with the fields stored so far', !(await attempt(() => panel.analyze({ params: { page: PAGE }, send: async (a, p) => sent.push([a, p]) })) ) && sent[0]?.[0] === 'read' && JSON.parse(sent[0][1].fields).add.length === 0, JSON.stringify(sent));
const drawError = await attempt(() => panel.renderResult(root, result, { el }));
check('the review screen draws without throwing', drawError === null, drawError);
const rowsOnScreen = () => root.querySelectorAll('.deck-row').length;
const listed = () => root.querySelectorAll('.new-field .new-field-prop').map((n) => n.textContent);
{
  const places = core.selectRows(result.rows);
  const texts = core.mergeRows(places);
  const numbers = root.querySelectorAll('.deck-row .deck-rownum').map((n) => n.textContent);
  check('...every place on the page in the preview, under its own section', rowsOnScreen() === places.length, `${rowsOnScreen()} vs ${places.length}`);
  check(
    '...numbered with the Excel row it lands on: places that share a row share a number',
    new Set(numbers).size === texts.length && numbers.length > texts.length,
    `${new Set(numbers).size} numbers for ${texts.length} rows`
  );
  const tags = root.querySelectorAll('.deck-row .deck-tag').map((t) => t.textContent);
  check('...the first place of a repeated text says how many more', tags.some((t) => /^also in \d+ more places?$/.test(t)), tags.join(', '));
  check('...and each other place which Excel row it shares', tags.filter((t) => /^same Excel row as /.test(t)).length === places.length - texts.length, tags.join(', '));

  const sections = () => root.querySelectorAll('details.deck-section');
  const toggleAll = () => root.querySelector('.deck-preview-tools .link-btn');
  check(
    'each section folds, closed to start with: its title and how many places it has',
    sections().length === new Set(places.map((r) => r.section)).size &&
      sections().every((s) => !s.open) &&
      sections()[0].querySelector('.detail-title').textContent === places[0].section &&
      Number(sections()[0].querySelector('.detail-count').textContent) === places.filter((r) => r.section === places[0].section).length,
    JSON.stringify(sections().map((s) => [s.querySelector('.detail-title').textContent, s.querySelector('.detail-count').textContent, s.open]).slice(0, 3))
  );
  check('...with "Expand all" above them', toggleAll()?.textContent === 'Expand all', toggleAll()?.textContent);
  toggleAll().click();
  check('"Expand all" opens every section, and then reads "Collapse all"', sections().every((s) => s.open) && toggleAll().textContent === 'Collapse all', toggleAll().textContent);
  toggleAll().click();
  check('..."Collapse all" closes them again', sections().every((s) => !s.open) && toggleAll().textContent === 'Expand all', '');

  const second = sections()[1];
  second.open = true;
  second.dispatchEvent({ type: 'toggle' });
  const alt = root.querySelectorAll('input').find((i) => i.dataset.category === 'alt');
  alt.checked = false;
  alt.dispatchEvent({ type: 'change' });
  const title = second.querySelector('.detail-title').textContent;
  const again = sections().find((s) => s.querySelector('.detail-title').textContent === title);
  check('a section opened stays open when the preview is drawn again - a group unticked', again && again !== second && again.open && sections().filter((s) => s.open).length === 1, `${title}: ${again?.open}`);
  alt.checked = true;
  alt.dispatchEvent({ type: 'change' });

  /* ---- search ------------------------------------------------------------- */
  const box = () => root.querySelector('input.deck-search');
  const status = () => root.querySelector('.deck-search-status');
  const type = (text) => {
    box().value = text;
    box().dispatchEvent({ type: 'input' });
  };
  const shownRows = () => root.querySelectorAll('.deck-row').filter((li) => !li.hidden && !li.parent.parent.hidden);
  check('a search box sits above the sections, empty', box() && box().value === '' && status().hidden, '');

  const learn = places.filter((r) => r.source.replace(/\s+/g, ' ').toLowerCase().includes('learn more'));
  type('learn MORE');
  check(
    'typing keeps only the places with that text, whatever the case - their sections opened, the others hidden',
    shownRows().length === learn.length &&
      sections().filter((s) => !s.hidden).every((s) => s.open) &&
      sections().filter((s) => !s.hidden).length === new Set(learn.map((r) => r.section)).size,
    `${shownRows().length} vs ${learn.length}`
  );
  check('...the words found are marked', shownRows().every((li) => li.querySelector('mark.deck-hit')?.textContent === 'Learn more'), '');
  check('...each section says how many of its places match', sections().filter((s) => !s.hidden).every((s) => / of \d+$/.test(s.querySelector('.detail-count').textContent)), '');
  check('...and above them, how many places have it', status().textContent.startsWith(`${learn.length} places on the sheet have “learn MORE”.`) && status().dataset.tone === 'ok', status().textContent);

  type('designed   for every');
  check('a line break or a run of spaces in the text is one space to a search', shownRows().length === 1 && /Discover Samsung TVs designed/.test(shownRows()[0].textContent), shownRows().map((li) => li.textContent).join(' | '));

  const nf = result.newFields.find((f) => !places.some((r) => r.source.toLowerCase().includes(f.text.toLowerCase())));
  type(nf.text);
  check(
    'text on the page that is not on the sheet says where it is: under "Fields not on the sheet"',
    shownRows().length === 0 &&
      status().dataset.tone === 'warn' &&
      status().textContent.startsWith(`Nothing on the sheet has “${nf.text}”.`) &&
      status().textContent.includes(`In “Fields not on the sheet”: ${nf.componentLabel} · ${nf.prop}`),
    `${nf.text}: ${status().textContent}`
  );

  const lone = places.find((r) => r.category === 'alt' && !places.some((x) => x.category !== 'alt' && x.source === r.source));
  alt.checked = false;
  alt.dispatchEvent({ type: 'change' });
  type(lone.source.slice(0, 30));
  check('...or in a group not ticked', /Left off the sheet: 1 place in “Image alt text”, which is not ticked\./.test(status().textContent), `${lone.source} -> ${status().textContent}`);
  alt.checked = true;
  alt.dispatchEvent({ type: 'change' });
  check('the search stays when the preview is drawn again', box().value === lone.source.slice(0, 30) && shownRows().length >= 1, box().value);

  type('no such words anywhere');
  check('text the page does not have at all says where it may come from instead', /Not in this page’s content at all/.test(status().textContent), status().textContent);

  type('');
  check(
    'clearing the search shows every place again, sections as they were',
    shownRows().length === places.length && status().hidden && sections().filter((s) => s.open).length === 1 && !root.querySelector('mark.deck-hit'),
    `${shownRows().length} vs ${places.length}, open ${sections().filter((s) => s.open).length}`
  );

  // The page read again: a new result, every section closed.
  root.textContent = '';
  panel.renderResult(root, { ...result }, { el });
  check('...and a page read again starts with every section closed', sections().length > 1 && sections().every((s) => !s.open), sections().filter((s) => s.open).length);
}
check('...and the fields not on the sheet, to add or ignore', JSON.stringify(listed().sort()) === JSON.stringify(['cardTitle', 'ctaLabel', 'productGroupCodeName']), JSON.stringify(listed()));
check('...and the download button is told what to say', flow.length > 0 && /Not on it: 3 fields/.test(flow.at(-1).caption), JSON.stringify(flow.at(-1)));

console.log('\n--- add and ignore --------------------------------------------------');

const entry = (prop) => root.querySelectorAll('.new-field').find((li) => li.querySelector('.new-field-prop').textContent === prop);
{
  const card = entry('cardTitle');
  card.querySelector('select').value = 'cta';
  card.querySelector('.btn').click();
  await settle();
  const added = root.querySelectorAll('.deck-row').filter((li) => li.querySelectorAll('.deck-tag').some((t) => t.textContent === 'added'));
  check('Add puts the field on the sheet at once, in the group chosen - no second read', added.length === 2 && added.every((li) => li.dataset.category === 'cta') && sent.length === 1, `${added.length} added rows`);
  check('...takes it off the list', !listed().includes('cardTitle'), JSON.stringify(listed()));
  check('...and keeps the choice in settings', JSON.stringify(items['aemt.copyDeck.added']) === JSON.stringify([{ c: 'cm-g-promo-banner', p: 'cardTitle', g: 'cta' }]), JSON.stringify(items));
}
{
  entry('productGroupCodeName').querySelector('.link-btn').click();
  await settle();
  check('Ignore takes a field off the list and keeps that too', !listed().includes('productGroupCodeName') && items['aemt.copyDeck.ignored']?.[0]?.p === 'productGroupCodeName', JSON.stringify(listed()));
}
{
  // Taken back in settings: the list and the sheet follow, on the screen as it is.
  await chrome.storage.sync.set({ 'aemt.copyDeck.added': [], 'aemt.copyDeck.ignored': [] });
  await settle();
  check('a change made in settings redraws the screen', listed().includes('cardTitle') && listed().includes('productGroupCodeName') && !root.querySelectorAll('.deck-tag').some((t) => t.textContent === 'added'), JSON.stringify(listed()));
}
{
  // A refused choice is said on the entry on screen.
  const real = chrome.storage.sync.set;
  chrome.storage.sync.set = async () => {
    throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
  };
  entry('ctaLabel').querySelector('.btn').click();
  await settle();
  chrome.storage.sync.set = real;
  const problem = entry('ctaLabel').querySelector('.new-field-problem');
  check('a choice that cannot be saved says why, on its entry, and can be tried again', !problem.hidden && /list of fields is full/.test(problem.textContent) && !entry('ctaLabel').querySelector('.btn').disabled, problem.textContent);
}

console.log('\n--- another feature on screen ---------------------------------------');

{
  // The shell empties the one result area and another feature draws there.
  root.textContent = '';
  const other = el('div', 'analysis import', 'IMPORT DRY RUN');
  root.append(other);
  const before = flow.length;
  await chrome.storage.sync.set({ 'aemt.copyDeck.ignored': [{ c: 'cm-g-promo-banner', p: 'ctaLabel' }] });
  await settle();
  check('a change made in settings then leaves the other screen alone', root.children.length === 1 && root.children[0] === other && !root.querySelector('.copy-deck'), root.textContent.slice(0, 80));
  check('...and does not touch its button', flow.length === before, `${flow.length - before} flow changes`);
}
{
  // Back to the copy deck: a new read draws it again, with the change made meanwhile.
  root.textContent = '';
  const error = await attempt(() => panel.renderResult(root, result, { el }));
  check('the copy deck draws again after that, with the choice made meanwhile', error === null && !listed().includes('ctaLabel'), error || JSON.stringify(listed()));
}

console.log('\n--- an entry nothing redraws ----------------------------------------');

{
  // The choice is saved, but nothing on screen had to change: the entry must not stay greyed out.
  const { renderNewFields } = await import(pathToFileURL(base + 'src/features/copy-deck/new-fields.js'));
  const box = el('div');
  document.body.append(box);
  const field = { component: 'cm-g-x', componentLabel: 'X', prop: 'y', where: '', key: 'a@y', text: 'Hello', count: 1, group: 'copy' };
  let calls = 0;
  renderNewFields(box, [field], { el, onChoose: async () => void calls++ });
  const li = box.querySelector('.new-field');
  li.querySelector('.btn').click();
  await settle();
  li.querySelector('.btn').click();
  await settle();
  check(
    'an entry whose choice changed nothing on screen gets its controls back, and can be clicked again',
    calls === 2 && li.querySelectorAll('select, button').every((c) => !c.disabled),
    `${calls} calls; disabled: ${li.querySelectorAll('select, button').map((c) => c.disabled)}`
  );
  box.remove();
}

console.log('\n--- a product page (PD) ---------------------------------------------');

{
  const pd = await import(pathToFileURL(base + 'src/features/copy-deck/pd.js'));
  const PD_PAGE = '/content/samsung/ca/tvs/qled-tv/qn80h';
  const deck = pd.extractPdDeck(readFileSync(base + 'test/fixtures/copy-deck-pd-ca-qn80h.html', 'utf8'), { pagePath: PD_PAGE });
  const { items, ...rest } = deck;
  const pdResult = { page: PD_PAGE, title: 'QN80H', newFields: [], references: [], ...rest, rows: items };
  const rep = pd.selectPdRows(items, { categories: pd.SKU_PRESETS.rep }).length;
  // Every place shows, in its section; places of one text share its Excel row number.
  const sheetRowsOnScreen = () => new Set(root.querySelectorAll('.deck-row .deck-rownum').map((n) => n.textContent)).size;
  const repPlaces = items.filter((it) => pd.SKU_PRESETS.rep.includes(it.category)).length;
  const sib = pd.selectPdRows(items, { categories: pd.SKU_PRESETS.sibling }).length;

  const ordinary = store.get('aemt.copyDeck.include');
  root.textContent = '';
  const error = await attempt(() => panel.renderResult(root, pdResult, { el }));
  check('a product page draws without throwing', error === null, error);
  check('...says its text comes from PIM and the sheet cannot be imported', /comes from PIM/.test(root.querySelector('.notice')?.textContent) && /cannot be imported/.test(root.querySelector('.notice')?.textContent), root.querySelector('.notice')?.textContent);
  const groups = () => root.querySelectorAll('.deck-group span').filter((s) => !s.className).map((s) => s.textContent);
  check('...offers the product page’s groups, not the ordinary ones', groups().includes('Specs') && groups().includes('Gallery image titles') && !groups().includes('Breadcrumb') && !groups().includes('Also include text not shown on the page'), JSON.stringify(groups()));
  check('...with no fields to add', !root.querySelector('.new-fields'), '');
  const button = (sku) => root.querySelectorAll('.deck-sku-btn').find((b) => b.dataset.sku === sku);
  const pressed = (sku) => button(sku)['attr:aria-pressed'];
  check('...each text once: a representative SKU to start with', sheetRowsOnScreen() === rep && pressed('rep') === 'true' && pressed('sibling') === 'false', `${sheetRowsOnScreen()} vs ${rep}, ${pressed('rep')}`);
  {
    // A text the page shows in two sections - a highlight that is also a feature's headline - is under both, on one Excel row.
    const twice = items.find((it, i) => pd.SKU_PRESETS.rep.includes(it.category) && items.some((o, j) => j > i && o.source === it.source && o.sectionNo !== it.sectionNo && pd.SKU_PRESETS.rep.includes(o.category)));
    const lis = root.querySelectorAll('.deck-row').filter((li) => li.querySelector('.deck-text')?.textContent === twice?.source);
    const nums = new Set(lis.map((li) => li.querySelector('.deck-rownum').textContent));
    check(
      '...every place under its own section: a text in two sections shows in both, with one Excel row number',
      !!twice && rowsOnScreen() === repPlaces && lis.length >= 2 && nums.size === 1 &&
        lis.slice(1).every((li) => li.querySelectorAll('.deck-tag').some((t) => t.dataset.kind === 'same-row' && t.textContent.startsWith('same Excel row as'))) &&
        lis[0].querySelectorAll('.deck-tag').some((t) => /^also in \d+ more place/.test(t.textContent)),
      JSON.stringify([twice?.source, rowsOnScreen(), repPlaces, lis.length, [...nums]])
    );
  }
  check('...and its PIM feature beside a row', root.querySelectorAll('.deck-tag').some((t) => t.textContent === 'PIM 167448823'), '');
  check('...and what was left off, with why', root.querySelectorAll('.detail-title').some((t) => /Left off/.test(t.textContent)), '');

  button('sibling').click();
  check('Sibling SKU puts only the gallery and the specs on the sheet', sheetRowsOnScreen() === sib && pressed('sibling') === 'true' && pressed('rep') === 'false', `${sheetRowsOnScreen()} vs ${sib}`);
  check('...ticks just those two groups', root.querySelectorAll('.deck-group input').filter((i) => i.checked).map((i) => i.dataset.category).join() === 'gallery,specs', '');
  check('...and the download says so', flow.at(-1).label === `Download Excel · ${sib} rows` && /entered in PIM/.test(flow.at(-1).caption), JSON.stringify(flow.at(-1)));
  const specs = root.querySelectorAll('.deck-group input').find((i) => i.dataset.category === 'specs');
  specs.checked = false;
  specs.dispatchEvent({ type: 'change' });
  check('a group ticked by hand leaves neither SKU pressed', pressed('sibling') === 'false' && pressed('rep') === 'false', `${pressed('sibling')} ${pressed('rep')}`);
  button('rep').click();
  check('Representative SKU puts everything back', sheetRowsOnScreen() === rep && pressed('rep') === 'true', `${sheetRowsOnScreen()} vs ${rep}`);
  check('the product page’s choice leaves the ordinary page’s alone', store.get('aemt.copyDeck.include') === ordinary, store.get('aemt.copyDeck.include'));
  button('sibling').click();
  root.textContent = '';
  await attempt(() => panel.renderResult(root, pdResult, { el }));
  check('a product page read again starts as a representative SKU - a sibling’s choice does not carry over', sheetRowsOnScreen() === rep && pressed('rep') === 'true', `${sheetRowsOnScreen()} vs ${rep}`);

  // A field chosen in settings meanwhile does not redraw a product page: it has no fields.
  const before = rowsOnScreen();
  await chrome.storage.sync.set({ 'aemt.copyDeck.added': [{ c: '*', p: 'title', g: 'copy' }] });
  await settle();
  check('a change in settings leaves a product page as it is', rowsOnScreen() === before && root.querySelector('.deck-sku'), '');

  // And an ordinary page after it is ordinary again.
  root.textContent = '';
  const again = await attempt(() => panel.renderResult(root, result, { el }));
  check('an ordinary page after a product page draws as before', again === null && !root.querySelector('.deck-sku') && !root.querySelector('.notice') && root.querySelector('.new-fields'), again);
}

console.log('\n--- a cell too long for Excel ---------------------------------------');

{
  /* Downloads and the clipboard, recorded: what the CSV saves and what Copy for Excel puts there. */
  const saved = [];
  const copied = [];
  URL.createObjectURL = (blob) => (saved.push(blob), 'blob:test');
  URL.revokeObjectURL = () => {};
  globalThis.ClipboardItem = class {
    constructor(items) {
      this.items = items;
    }
  };
  Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { write: async (items) => void copied.push(items) } });
  const said = [];
  const log = (level, message) => said.push([level, message]);
  const button = (text) => root.querySelectorAll('.deck-actions .btn').find((b) => b.textContent.startsWith(text));

  root.textContent = '';
  panel.renderResult(root, result, { el, log });
  button('Download CSV').click();
  button('Copy for Excel').click();
  await settle();
  check('an ordinary page: Download CSV saves a file, Copy for Excel fills the clipboard, nothing is said', saved.length === 1 && copied.length === 1 && said.length === 0, JSON.stringify({ saved: saved.length, copied: copied.length, said }));

  // A text block holding some 40,000 characters: one cell Excel cannot hold.
  const long = JSON.parse(JSON.stringify(tree));
  long.root.responsivegrid.cm_g_text_block_copy_1409814884.description = 'Every TV, every room. '.repeat(1820);
  const longResult = { ...result, tree: long, ...core.extractCopyDeck(long, { pagePath: PAGE }) };
  root.textContent = '';
  panel.renderResult(root, longResult, { el, log });
  button('Download CSV').click();
  await settle();
  const refused = /^Cell F\d+ is longer than Excel allows \(40039 characters\)\.$/;
  check(
    'a CSV with a cell longer than Excel allows is refused in the log, as the Excel download is - and nothing is saved',
    said.length === 1 && said[0][0] === 'fail' && refused.test(said[0][1]) && saved.length === 1,
    JSON.stringify({ said, saved: saved.length })
  );
  check('...the button says so too, with the reason on it', refused.test(button('Could not save')?.title ?? ''), JSON.stringify(root.querySelectorAll('.deck-actions .btn').map((b) => [b.textContent, b.title])));
  button('Copy for Excel').click();
  await settle();
  check(
    '...and Copy for Excel too: said in the log, nothing put on the clipboard, the button says it could not copy',
    said.length === 2 && said[1][0] === 'fail' && refused.test(said[1][1]) && copied.length === 1 && button('Could not copy'),
    JSON.stringify({ said, copied: copied.length })
  );

  // A host that gives no log - the DSY browser draws this panel too: the refusal is still said, on the button.
  root.textContent = '';
  panel.renderResult(root, longResult, { el });
  const heard = said.length;
  button('Download CSV').click();
  await settle();
  check('with no log to say it in, the CSV button says it could not save, and why - nothing saved', said.length === heard && saved.length === 1 && refused.test(button('Could not save')?.title ?? ''), JSON.stringify(root.querySelectorAll('.deck-actions .btn').map((b) => [b.textContent, b.title])));

  // The clipboard itself saying no - the panel not focused, say - stays on the button, as it always has.
  Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { write: async () => Promise.reject(new Error('Document is not focused.')) } });
  root.textContent = '';
  panel.renderResult(root, result, { el, log });
  const before = said.length;
  button('Copy for Excel').click();
  await settle();
  check('a copy the clipboard refuses says so on the button, not in the log', said.length === before && button('Could not copy')?.title === 'Document is not focused.', JSON.stringify(said));
}

console.log('\n--- static content: places, not rows ---------------------------------');

{
  // A row of static content can be several places of its block: the counts say places.
  const explore = JSON.parse(readFileSync(base + 'test/fixtures/copy-deck-explore-samsung-health.json', 'utf8'));
  const deck = core.extractCopyDeck(explore, { pagePath: PAGE });
  const box = el('div', 'result');
  const error = await attempt(() => panel.renderResult(box, { page: PAGE, title: 'Explore', language: null, tree: explore, fields: { add: [], ignore: [] }, ...deck }, { el }));
  const stats = Object.fromEntries(box.querySelectorAll('.summary-counts .stat').map((s) => [s.children[1].textContent.trim(), Number(s.children[0].textContent)]));
  const block5 = box.querySelectorAll('details.deck-section').find((d) => d.querySelector('.detail-title').textContent.startsWith('Static content 5 of 8'));
  check(
    'the review counts places: 106 of static content to apply by hand, the repeats merged, and block 5’s 40',
    error === null &&
      stats['applied by hand'] === 106 &&
      stats['repeats merged - one translation for every place'] === 108 - 72 &&
      block5?.querySelector('.detail-count').textContent === '40',
    error || JSON.stringify([stats, block5?.querySelector('.detail-count').textContent])
  );
}

console.log('\n--- the import: the pasted sheet, source and translation --------------');

{
  const importPanel = await import(pathToFileURL(base + 'src/features/copy-deck-import/panel.js'));
  const host = el('div');
  const input = el('input');
  let changes = 0;
  importPanel.renderField(host, {}, { el, input, changed: () => changes++ });
  const box = host.querySelector('div.sheet-box');
  const zone = box?.querySelector('textarea.sheet-paste');
  const preview = host.querySelector('details.sheet-preview');
  const links = () => box.querySelectorAll('button.link-btn').filter((b) => !b.hidden).map((b) => b.textContent);
  check(
    'before a paste: one box, the paste area with Choose a file instead in it, nothing to read through',
    !!zone && !zone.hidden && box.dataset.state === 'empty' && box.querySelector('.sheet-loaded').hidden && links().join('|') === 'Choose a file instead' && preview.hidden,
    JSON.stringify([box?.dataset.state, links()])
  );
  const tsv = [
    ['Section', 'Field', 'Notes', 'Key (do not edit)', 'Check (do not edit)', 'Source text', 'Translation'],
    ['01 · Hero', 'Headline', '', 'a/b@title', 'h1', 'Find the right TV', 'Vind de juiste tv'],
    ['01 · Hero', 'Text', '', 'a/b@text', 'h2', 'Line one\nLine two', ''],
    ['#END', '/content/x', 'rows=2 · copy deck v4', '#meta', 'h3', '', '']
  ]
    .map((r) => r.map((c) => (c.includes('\n') ? `"${c}"` : c)).join('\t'))
    .join('\r\n');
  box.dispatchEvent({ type: 'paste', preventDefault() {}, clipboardData: { getData: () => tsv } });
  check(
    'a paste turns the same box into what was read: a tick, Sheet pasted, the counts, Choose another file and Clear',
    box.dataset.state === 'ok' && zone.hidden && !box.querySelector('.sheet-loaded').hidden && box.querySelector('.sheet-mark .icon') &&
      box.querySelector('.sheet-title').textContent === 'Sheet pasted' &&
      box.querySelector('.sheet-status').textContent === '2 rows · 1 with a translation · exported from /content/x' &&
      links().join('|') === 'Choose another file|Clear',
    JSON.stringify([box.dataset.state, box.querySelector('.sheet-title').textContent, box.querySelector('.sheet-status').textContent, links()])
  );
  const rows = preview.querySelectorAll('li.import-row');
  const line = (li, label) => li.querySelectorAll('.import-line').find((l) => l.querySelector('.import-label')?.textContent === label);
  check(
    'a paste shows every row, open: its Excel row, section, Source and Translation',
    !preview.hidden && preview.open && rows.length === 2 &&
      rows[0].querySelector('.deck-rownum').textContent === '2' && rows[0].querySelector('.deck-field').textContent === '01 · Hero' &&
      line(rows[0], 'Source')?.querySelector('.import-text').textContent === 'Find the right TV' &&
      line(rows[0], 'Translation')?.querySelector('.import-text').textContent === 'Vind de juiste tv' &&
      line(rows[1], 'Source')?.querySelector('.import-text').textContent === 'Line one\nLine two',
    JSON.stringify(rows.map((li) => li.textContent))
  );
  check(
    '...a row without a translation says so, and the fold counts them',
    line(rows[1], 'Translation')?.dataset.kind === 'reason' && line(rows[1], 'Translation').textContent.includes('Not translated') &&
      preview.querySelector('summary .detail-count').textContent === '2' && preview.querySelector('.sheet-preview-missing')?.textContent === '1 without a translation',
    preview.querySelector('summary')?.textContent
  );
  box.querySelectorAll('button.link-btn').find((b) => b.textContent === 'Clear').click();
  check(
    'Clear empties the box back to the paste area and hides the rows',
    preview.hidden && input.value === '' && changes === 2 && box.dataset.state === 'empty' && !zone.hidden && links().join('|') === 'Choose a file instead',
    JSON.stringify([changes, box.dataset.state, links()])
  );
  box.dispatchEvent({ type: 'paste', preventDefault() {}, clipboardData: { getData: () => 'just\ttext' } });
  check(
    'a paste that is not the sheet: a warning in the box, no rows, Clear to start again',
    preview.hidden && box.dataset.state === 'warn' && /not the translated sheet/.test(box.querySelector('.sheet-title').textContent) && links().includes('Clear') && input.value === '',
    JSON.stringify([box.dataset.state, box.querySelector('.sheet-title').textContent])
  );
}

console.log('\n--- the import: the review, a fold per section ------------------------');

{
  const importPanel = await import(pathToFileURL(base + 'src/features/copy-deck-import/panel.js'));
  const NL = '/content/samsung/nl/tvs';
  const page = JSON.parse(readFileSync(base + 'test/fixtures/copy-deck-za-tvs.json', 'utf8'));
  const sheet = core.buildSheet(core.extractCopyDeck(page, { pagePath: PAGE }).rows, { pagePath: PAGE, exportedAt: '2026-10-11 10:00' });
  const S = sheet.columns.indexOf('Source text');
  const T = sheet.columns.indexOf('Translation');
  const K = sheet.columns.indexOf('Key (do not edit)');
  const to = {
    'Find the right TV size for your space': 'Vind het juiste formaat voor uw ruimte',
    'These recommendations are designed for an immersive viewing experience.': 'Deze aanbevelingen zijn gemaakt om helemaal op te gaan in het beeld.',
    'Viewing Distance (meters)': '#VALUE!'
  };
  for (const rec of sheet.records) if (rec[S] in to) rec[T] = to[rec[S]];
  const title = sheet.records.find((rec) => rec[K] === '.@jcr:title');
  title[T] = 'Koop Smart TVs';
  const checked = core.planImport(page, core.readSheet([sheet.columns, ...sheet.records]), { pagePath: NL });
  const manual = checked.rows.filter((r) => r.status === 'manual');

  root.textContent = '';
  const error = await attempt(() => importPanel.renderResult(root, { ...checked, page: NL, origin: 'https://author.test', approved: 'h00000000' }, { el }));
  const folds = () => root.querySelectorAll('details.import-section');
  const fold = (id) => folds().find((d) => d.dataset.section === id);
  const line = (li, label) => li.querySelectorAll('.import-line').find((l) => l.querySelector('.import-label')?.textContent === label)?.querySelector('.import-text')?.textContent;
  const said = (li) => li.querySelectorAll('.import-line').find((l) => !l.querySelector('.import-label'))?.textContent;
  check(
    'the review is a fold per section of the sheet, in page order, each with a tick, its name and a count of changes',
    error === null && folds().length === checked.sections.length && folds().map((d) => d.dataset.section).join('|') === checked.sections.map((s) => s.id).join('|') &&
      folds().every((d) => d.querySelector('summary input')?.type === 'checkbox' && d.querySelector('summary .detail-title') && /^\d+$/.test(d.querySelector('summary .detail-count').textContent)),
    error || folds().map((d) => d.dataset.section).join('|')
  );
  const titleRow = checked.rows.find((r) => r.key === '.@jcr:title');
  const pageFold = fold(titleRow.section);
  const titleLi = pageFold?.querySelectorAll('li.import-row').find((li) => li.title === '.@jcr:title');
  check(
    'a text shows its field, Old - the page now - and New - the translation; its section is ticked and counts it',
    !!titleLi && line(titleLi, 'Old') === titleRow.current && line(titleLi, 'New') === 'Koop Smart TVs' && pageFold.querySelector('summary input').checked && pageFold.querySelector('.detail-count').textContent === '1',
    titleLi ? JSON.stringify(titleLi.querySelectorAll('.import-line').map((l) => l.textContent)) : 'no row'
  );
  const block = checked.staticBlocks[0];
  const staticFold = fold(block.label);
  const placed = staticFold ? staticFold.querySelectorAll('li.import-row').filter((li) => manual.some((r) => r.key === li.title)) : [];
  check(
    'a Static Content block is its own section: unticked, its block card in it, its texts as Old/New',
    staticFold?.dataset.static === 'true' && !staticFold.querySelector('summary input').checked && !!staticFold.querySelector('.paste-card') &&
      manual.length === 2 && placed.length === 2 && placed.every((li, i) => line(li, 'Old') === manual[i].current && line(li, 'New') === manual[i].translation),
    `${placed.length} of ${manual.length}`
  );
  const stopped = staticFold ? staticFold.querySelectorAll('li.import-row').filter((li) => li.dataset.status === 'invalid') : [];
  check(
    'a text that will not be written stays in its section with why, and nothing to tick',
    stopped.length === 1 && /^Needs attention: .*Excel error/.test(said(stopped[0])) && !stopped[0].querySelector('input') &&
      staticFold.querySelectorAll('li.import-row').some((li) => li.dataset.status === 'untranslated' && said(li) === 'Not translated'),
    JSON.stringify(stopped.map((li) => said(li)))
  );
  check(
    'one line at the top says Static Content is unticked, and why',
    root.querySelectorAll('p.notice').some((p) => p.textContent === 'Static Content blocks hold page code. Tick them to let DSY update them, then check those blocks on the page.'),
    root.querySelectorAll('p.notice').map((p) => p.textContent).join(' | ')
  );
  check('the Write counts what is ticked', importPanel.commitState().label === 'Write 1 text', importPanel.commitState().label);
  const box = staticFold.querySelector('summary input');
  box.checked = true;
  box.dispatchEvent({ type: 'change' });
  check('...a Static Content section ticked: "Write 1 text and 1 Static Content block"', importPanel.commitState().label === 'Write 1 text and 1 Static Content block', importPanel.commitState().label);
  for (const d of folds()) {
    const b = d.querySelector('summary input');
    if (!b.disabled) {
      b.checked = false;
      b.dispatchEvent({ type: 'change' });
    }
  }
  check('...and nothing ticked: "Nothing to write"', importPanel.commitState().label === 'Nothing to write' && importPanel.commitState().ready === false, importPanel.commitState().label);
}

console.log('\n--- the import: Static Content blocks, ticked or pasted by hand -------');

{
  /* The explore-samsung-health page, its 8 blocks: every text "translated", checked
   * on author.test. The page's worker is a stand-in that answers from `live` -
   * what the server holds now - and records every action asked of it. */
  const importPanel = await import(pathToFileURL(base + 'src/features/copy-deck-import/panel.js'));
  const paste = await import(pathToFileURL(base + 'src/features/copy-deck-import/paste-by-hand.js'));
  const sc = await import(pathToFileURL(base + 'src/features/copy-deck/static-content.js'));
  const { englishLeft } = await import(pathToFileURL(base + 'src/features/copy-deck-import/hand-offs.js'));
  const FIX = JSON.parse(readFileSync(base + 'test/fixtures/copy-deck-explore-samsung-health.json', 'utf8'));
  const LEVANT = '/content/samsung/levant/explore-samsung-health';
  const AR = '/content/samsung/levant_ar/explore-samsung-health';
  const AUTHOR = 'https://author.test';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const nodeAt = (c, path) => path.split('/').reduce((n, s) => n?.[s], c);
  const sheet = core.buildSheet(core.extractCopyDeck(clone(FIX), { pagePath: LEVANT }).rows, { pagePath: LEVANT, exportedAt: '2026-10-12 10:00' });
  const S = sheet.columns.indexOf('Source text');
  const T = sheet.columns.indexOf('Translation');
  for (const rec of sheet.records.slice(0, -1)) rec[T] = `[fr] ${rec[S]}`;
  const read = core.readSheet([sheet.columns, ...sheet.records]);
  const planOf = (tree) => ({ ...core.planImport(clone(tree), read, { pagePath: AR }), page: AR, origin: AUTHOR, approved: 'h00000000' });
  const data = planOf(FIX);
  const B = data.staticBlocks;

  let live = clone(FIX);
  let answersFrom = AUTHOR;
  const asked = [];
  const send = async (action, params, tabId) => {
    asked.push([action, params.node ?? '', tabId]);
    if (action === 'check') return { ok: true, result: data };
    if (action === 'checkAll') return { ok: true, result: { origin: answersFrom, page: params.page, left: englishLeft(planOf(live)) } };
    if (action !== 'staticStatus') return { ok: false, error: `unexpected ${action}` };
    const n = nodeAt(live, params.node);
    const f = (k) => (typeof n[k] === 'string' ? n[k] : null);
    return { ok: true, result: { origin: answersFrom, page: params.page, node: params.node, headerInclude: f('headerInclude'), bodyHtml: f('bodyHtml'), footerInclude: f('footerInclude'), modifiedBy: f('jcr:lastModifiedBy') } };
  };
  let panelOn = AUTHOR;
  // The Copy for Excel checks above put their own clipboard in: Chrome's again.
  Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: clipboard });
  await importPanel.analyze({ tabId: 7, origin: AUTHOR, params: { page: AR }, send });
  asked.length = 0; // from here on, only what the review asks
  root.textContent = '';
  const drawn = await attempt(() => importPanel.renderResult(root, data, { el, origin: () => panelOn }));
  await settle();

  const card = (no) => root.querySelectorAll('.paste-card').find((c) => c.dataset.block === String(no));
  const foldOf = (no) => root.querySelectorAll('details.import-section').find((d) => d.dataset.section === B[no - 1].label);
  const metas = (no) => card(no).querySelectorAll('.paste-meta').map((m) => m.textContent);
  const button = (no, label) => card(no).querySelectorAll('button.paste-btn').find((b) => b.textContent === label);
  const status = (no) => card(no).querySelector('.paste-status').textContent;
  const lineOf = (no, label) => card(no).querySelectorAll('.paste-line').find((l) => l.textContent.startsWith(label))?.textContent;
  const nameOf = (no) => sc.readBlock(nodeAt(FIX, B[no - 1].path)).name;
  const click = async (no, label) => {
    button(no, label).click();
    await settle();
  };

  check(
    'a section per block, "Static content N of 8 · name", each with its card inside, in page order',
    drawn === null && root.querySelectorAll('.paste-card').length === 8 &&
      B.every((b) => foldOf(b.no)?.querySelector('.detail-title').textContent === `Static content ${b.no} of 8 · ${nameOf(b.no)}` && foldOf(b.no).querySelector('.paste-card') === card(b.no)),
    drawn || root.querySelectorAll('details.import-section').map((d) => d.dataset.section).join('|')
  );
  const n5 = nodeAt(FIX, B[4].path);
  check(
    'block 5: its node, first image, who changed it last, and its neighbours as they show now',
    metas(5)[0] === `cm_g_static_content__1495926445 · first image: wellness-kv-mo-webp-v2.png · last changed by: ${n5['jcr:lastModifiedBy']}` &&
      metas(5)[1] === `After block 4 "${nameOf(4)}" (not pasted) · before block 6 "${nameOf(6)}" (not pasted)` &&
      metas(1)[1] === `First block on the page · before block 2 "${nameOf(2)}" (not pasted)`,
    JSON.stringify([metas(5), metas(1)[1]])
  );
  check(
    '...its counts, where to look after the paste, and what to check rather than translate',
    card(5).querySelector('.paste-counts').textContent === '32 texts to place · 0 same as English · 0 sent back · 0 not on the sheet' &&
      /^After pasting, look at: .*tab "/.test(lineOf(5, 'After pasting')) &&
      lineOf(5, 'Check, not translate').includes('4 links to /levant/') &&
      lineOf(2, 'Check, not translate').includes('1 link to /levant/'),
    JSON.stringify([card(5).querySelector('.paste-counts').textContent, lineOf(5, 'After pasting'), lineOf(5, 'Check, not translate'), lineOf(2, 'Check, not translate')])
  );
  check(
    'the hand-paste steps, once, folded at the top - not saying which tab the dialog opens on',
    root.querySelectorAll('.import-paste-steps').length === 1 && root.querySelector('.import-paste-steps').textContent.includes('The dialog opens on Header(CSS) - click the Body(HTML) tab.'),
    root.querySelector('.import-paste-steps')?.textContent
  );

  /* ---- the ticks: counts and the button only, never the page ------------- */
  const folds = root.querySelectorAll('details.import-section');
  folds[0].open = true;
  foldOf(5).open = true;
  const statics = data.sections.filter((s) => s.static);
  const offeredIn = (id) => data.offered.filter((w) => w.section === id);
  const tickOf = (no) => foldOf(no).querySelector('summary input');
  const all = root.querySelector('.import-all input');
  let reanalyzed = 0;
  document.addEventListener('aemt:reanalyze', () => reanalyzed++);
  check(
    'Static Content sections start unticked; Select all is part-ticked',
    statics.every((s) => !root.querySelectorAll('details.import-section').find((d) => d.dataset.section === s.id).querySelector('summary input').checked) &&
      all.indeterminate === true && all.checked === false && !root.querySelectorAll('.paste-dsy').some((d) => !d.hidden),
    JSON.stringify([all.checked, all.indeterminate])
  );
  const before = importPanel.commitState().label;
  tickOf(5).checked = true;
  tickOf(5).dispatchEvent({ type: 'change' });
  await settle();
  check(
    'ticking a section asks nothing of the worker and draws nothing again: the same folds, still open as they were',
    asked.length === 0 && reanalyzed === 0 && root.querySelectorAll('details.import-section').every((d, i) => d === folds[i]) && folds[0].open && foldOf(5).open,
    JSON.stringify([asked, reanalyzed])
  );
  const texts = data.offered.filter((w) => !w.static).length;
  check(
    '...only the counts change: the button writes block 5 too, and its card says what DSY writes',
    before === `Write ${texts} texts` && importPanel.commitState().label === `Write ${texts} texts and 1 Static Content block` &&
      card(5).querySelector('.paste-dsy').textContent === 'DSY will write this block: Body(HTML)' && !card(5).querySelector('.paste-dsy').hidden &&
      button(5, 'Copy new Body(HTML)').hidden && !!button(5, 'Copy old Body(HTML)') && !button(5, 'Check again').disabled &&
      root.querySelectorAll('.import-plan .plan-step').find((li) => li.dataset.step === 'write')?.querySelector('.plan-title').textContent === `Write ${texts} texts and 1 Static Content block`,
    `${before} | ${importPanel.commitState().label}`
  );
  all.checked = true;
  all.dispatchEvent({ type: 'change' });
  const enabled = root.querySelectorAll('details.import-section summary input').filter((b) => !b.disabled);
  check(
    'Select all ticks every section that has something to write; the button counts it all',
    enabled.every((b) => b.checked) && !all.indeterminate && importPanel.commitState().label === `Write ${core.writesSaid(data.offered)}` &&
      card(3).querySelector('.paste-dsy').textContent === 'DSY will write this block: Footer(Javascript)',
    importPanel.commitState().label
  );
  all.checked = false;
  all.dispatchEvent({ type: 'change' });
  check('...and unticks them all: "Nothing to write"', enabled.every((b) => !b.checked) && importPanel.commitState().label === 'Nothing to write', importPanel.commitState().label);
  tickOf(3).checked = true;
  tickOf(3).dispatchEvent({ type: 'change' });
  const sentApply = [];
  await importPanel.commit({ origin: AUTHOR, params: { page: AR, sheet: 'the sheet' }, send: async (action, params) => (sentApply.push([action, params]), { ok: true }) });
  const [action, params] = sentApply[0] || [];
  check(
    'the write sends the ticked sections and the fingerprint of their writes - block 3’s Footer only - it has no Body text',
    action === 'apply' && JSON.stringify(params.sections) === JSON.stringify([B[2].label]) &&
      params.approved === core.writesFingerprint(offeredIn(B[2].label), { origin: AUTHOR, page: AR, sections: [B[2].label] }) &&
      offeredIn(B[2].label).map((w) => w.prop).join() === 'footerInclude' && asked.length === 0,
    JSON.stringify(params)
  );
  tickOf(3).checked = false;
  tickOf(3).dispatchEvent({ type: 'change' });

  /* ---- a block's buttons, for pasting by hand ----------------------------- */
  await click(5, 'Check again');
  check('Copy new Body(HTML) is on again once its section is unticked', !button(5, 'Copy new Body(HTML)').disabled && status(5) === 'Status: Not pasted yet', status(5));
  await click(5, 'Copy new Body(HTML)');
  const banner = () => root.querySelectorAll('.paste-copied').filter((b) => b.dataset.tone === 'ok');
  check(
    'Copy new reads the block again and copies its prepared value; the banner names the block',
    clip === B[4].prepared &&
      banner().length === 1 &&
      banner()[0].parent.parent === card(5) &&
      banner()[0].textContent === `Copied: block 5 of 8 · Made to support your everyday wellness · ${B[4].prepared.length.toLocaleString('en')} characters - paste into THIS block`,
    banner().map((b) => b.textContent).join(' | ')
  );
  check('...through the worker’s read-only action, to the tab that was checked', asked.filter(([a]) => a === 'staticStatus').every(([, node, tab]) => node === B[4].path && tab === 7), JSON.stringify(asked));

  // Block 6 holds block 5's new value: refused - the red line stays, and the clipboard keeps block 5's.
  nodeAt(live, B[5].path).bodyHtml = B[4].prepared;
  await click(6, 'Copy new Body(HTML)');
  const red = (no) => card(no).querySelectorAll('.paste-copied').filter((b) => b.dataset.tone === 'fail');
  check(
    'a copy refused shows "Not copied - do not paste" with the fix, and the clipboard is left as it was',
    clip === B[4].prepared && banner().length === 0 && red(6).length === 1 && red(6)[0].textContent.startsWith('Not copied - do not paste. This block holds the value of block 5.'),
    red(6).map((b) => b.textContent).join(' | ')
  );
  red(6)[0].querySelector('button').click();
  nodeAt(live, B[5].path).bodyHtml = nodeAt(FIX, B[5].path).bodyHtml;

  // Check again: a few of the ways a block can stand after the paste.
  const p5 = B[4].prepared;
  const old5 = n5.bodyHtml;
  const states = [
    [{ bodyHtml: p5 }, /^Status: Pasted \(done\)$/],
    [{ bodyHtml: old5 }, /^Status: Not pasted yet$/],
    [{ footerInclude: p5 }, /^Status: Pasted into Footer\(Javascript\) by mistake: /],
    [{ bodyHtml: p5.slice(0, 6000) }, /^Status: Cut short: only the first 6,000 of [\d,]+ characters/]
  ];
  const seen = [];
  for (const [now, says] of states) {
    const n = nodeAt(live, B[4].path);
    Object.assign(n, { headerInclude: n5.headerInclude, bodyHtml: old5, footerInclude: n5.footerInclude }, now);
    if (n.headerInclude === undefined) delete n.headerInclude;
    await click(5, 'Check again');
    seen.push([says.test(status(5)), status(5).slice(0, 110)]);
  }
  check('Check again shows each outcome with what to do', seen.every(([ok]) => ok), JSON.stringify(seen.filter(([ok]) => !ok)));
  Object.assign(nodeAt(live, B[4].path), { bodyHtml: old5, footerInclude: n5.footerInclude });

  // Checked again after the paste: block 5's old value is now the translation - its first old value goes along.
  const key = `aemt.pasteByHand ${AUTHOR}${AR}`;
  const pasted = clone(FIX);
  nodeAt(pasted, B[4].path).bodyHtml = p5;
  root.textContent = '';
  importPanel.renderResult(root, planOf(pasted), { el, origin: () => panelOn });
  await settle();
  const records = Object.entries(chrome.storage.local.items[key]?.blocks || {}).filter(([k]) => k.startsWith(`${B[4].path}#`));
  check(
    'the first old value is kept across checks, never replaced - even once the block holds its translation',
    records.length === 2 && records.every(([, r]) => r.first.bodyHtml === old5),
    JSON.stringify(records.map(([k, r]) => [k, r.first.bodyHtml?.slice(0, 30)]))
  );
  await click(5, 'Copy old Body(HTML)');
  check('...so Copy old Body(HTML) still copies the block as it was', clip === old5 && banner()[0]?.textContent.startsWith('Copied the OLD value: block 5 of 8 · '), banner()[0]?.textContent);

  // Prepare again is refused for a block holding another block's value, cut short, or with HTML in its Header.
  const rec5 = { no: 5, old: B[4].old, prepared: p5, items: B[4].items, notOnSheet: [] };
  const others = B.filter((b) => b.no !== 5).map((b) => ({ no: b.no, old: b.old, prepared: b.prepared }));
  const again = (now) => paste.prepareAgain(rec5, { ...B[4].old, ...now }, others);
  check(
    'Prepare again refuses a block holding another block’s value, one cut short, and HTML in Header(CSS)',
    /^This block holds the value of block 4/.test(again({ bodyHtml: B[3].prepared }).refused) &&
      /^Cut short: /.test(again({ bodyHtml: p5.slice(0, 5000) }).refused) &&
      /^Pasted into Header\(CSS\) by mistake/.test(again({ headerInclude: '<div class="x">y</div>' }).refused) &&
      again({ bodyHtml: `<!-- x -->${old5}` }).value?.startsWith('<!-- x -->'),
    JSON.stringify([again({ bodyHtml: B[3].prepared }).refused, again({ bodyHtml: p5.slice(0, 5000) }).refused])
  );

  // The panel moved to another server: refused, and nothing is asked of the page.
  panelOn = 'https://other.test';
  const sent = asked.length;
  await click(5, 'Check again');
  check(
    'Check again from a panel now on another server is refused, and nothing is sent',
    status(5) === 'Status: Could not check: This was checked on author.test, but the panel is now on other.test. Go back to that tab, or check again here.' && asked.length === sent,
    status(5)
  );
  panelOn = AUTHOR;

  /* ---- the Footer, compact, and the other hand-offs ---------------------- */
  live = clone(FIX);
  root.textContent = '';
  importPanel.renderResult(root, data, { el, origin: () => panelOn });
  await settle();
  const hand = (no, title) => card(no).querySelectorAll('details.paste-hand').find((d) => d.querySelector('summary').textContent.startsWith(title));
  const press = async (host, label) => {
    host.querySelectorAll('button.paste-btn').find((b) => b.textContent === label).click();
    await settle();
  };
  const dev = hand(3, 'Footer(Javascript), line by line');
  check(
    'block 3’s Footer, folded: line by line as it is and with the translation in, escaped - and a check of it',
    dev?.open === false && /Line \d+now: title: "Energy Score",new: title: "\[fr\] Energy Score",/.test(dev.textContent) &&
      /^Footer check: \d+ of \d+ still in English, built sentence still in English, no <\/script$/.test(dev.querySelector('.paste-status').textContent),
    dev?.textContent.slice(0, 200)
  );
  await press(dev, 'Copy old Footer(Javascript)');
  check('...Copy old Footer(Javascript) copies the Footer as it was, to put back', clip === nodeAt(FIX, B[2].path).footerInclude && /^Copied the OLD Footer\(Javascript\): block 3 of 8/.test(banner()[0]?.textContent), banner()[0]?.textContent);
  const items3 = foldOf(3).querySelectorAll('li.import-row').filter((li) => /@footerInclude/.test(li.title));
  check(
    '...and the script’s texts are in block 3’s section as Old/New, like the others',
    items3.length > 0 && items3.every((li) => li.querySelectorAll('.import-label').some((l) => l.textContent === 'Old') && li.querySelectorAll('.import-label').some((l) => l.textContent === 'New')),
    String(items3.length)
  );
  check(
    'the developer’s report on the cards: block 1’s layout and font, block 5’s arrow key and script',
    /Left\/right layout \(left: 32px, left: 0\)/.test(lineOf(1, 'Developer') || '') && /"ArrowRight" key handling/.test(lineOf(5, 'Developer') || ''),
    JSON.stringify([lineOf(1, 'Developer'), lineOf(5, 'Developer')])
  );
  const links5 = hand(5, 'Links to check');
  const tick = links5.querySelector('input');
  tick.checked = true;
  tick.dispatchEvent({ type: 'change' });
  await click(5, 'Copy new Body(HTML)');
  check(
    'ticked: Copy new copies the value with the links re-pointed - and only them',
    clip !== B[4].prepared && !/www\.samsung\.com\/levant\//.test(clip) && clip.split('/levant/').join('/levant_ar/') === B[4].prepared.split('/levant/').join('/levant_ar/'),
    links5.querySelector('.paste-hint').textContent
  );
  tick.checked = false;
  tick.dispatchEvent({ type: 'change' });
  const img1 = hand(1, 'Images for the designer');
  check('block 1’s images for a designer', img1?.querySelector('li').textContent === 'Body(HTML): mep-kv-dt.jpg (desktop) + mep-kv-mo-v3.jpg (mobile)', img1?.textContent);

  /* ---- "Find English still on the page", and no checklist ---------------- */
  const sweep = asked.length;
  await press(root.querySelector('.import-tools'), 'Find English still on the page');
  const lefts = () => root.querySelectorAll('.check-all-item');
  const says = () => root.querySelector('.import-sweep').textContent;
  check(
    '"Find English still on the page" lists every text whose English is still on it, through the worker’s read-only checkAll',
    asked.slice(sweep).map(([a]) => a).join() === 'checkAll' && lefts().length > 20 && /^\d+ texts still in English$/.test(says()) &&
      lefts().some((li) => li.querySelector('.paste-meta').textContent.endsWith(' - not pasted yet')),
    says()
  );
  const mark = lefts()[0].querySelector('input');
  mark.checked = true;
  mark.dispatchEvent({ type: 'change' });
  check('...a text can be marked kept on purpose', / · 1 kept on purpose$/.test(says()) && lefts()[0].dataset.kept === 'true', says());
  check(
    'the page checklist is gone: no list, no ticks kept, no "Check all" item',
    !root.querySelector('.page-checklist') && !root.querySelectorAll('.checklist-item').length && !Object.keys(chrome.storage.local.items).some((k) => k.startsWith('aemt.pageChecklist')) &&
      !/Page checklist/.test(root.textContent),
    Object.keys(chrome.storage.local.items).join()
  );
  check(
    'nothing the review asked for is a write: staticStatus and checkAll only',
    asked.every(([a]) => ['staticStatus', 'checkAll'].includes(a)),
    JSON.stringify([...new Set(asked.map(([a]) => a))])
  );
}

await settle();
check('nothing threw anywhere - not in a click, not in a redraw from settings', thrown.length === 0, thrown.join(' | '));

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
