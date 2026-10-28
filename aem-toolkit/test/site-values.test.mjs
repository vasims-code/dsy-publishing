/* Site values: the Twitter handles, the title ending and the language, worked
 * out from the two sites' home pages - the rules, and the box on the review
 * and done screens, drawn into a small stand-in for the DOM.
 *
 * The home page values are lb's and levant's as they are on the author server.
 */
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/src/';
const sv = await import(pathToFileURL(base + 'core/site-values.js'));

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};

const LB = {
  'jcr:title': 'Mobiles, TVs, and Home Appliances',
  ogTitle: 'Mobiles, TVs, and Home Appliances | Samsung Lebanon',
  twitterTitle: 'Mobiles, TVs, and Home Appliances | Samsung Lebanon',
  twitterSite: '@SamsungLB',
  twitterCreator: '@SamsungLB',
  'jcr:language': 'en_LB',
  description: 'Welcome to Samsung Lebanon (Jordan, Iraq, and Lebanon).'
};
const LEVANT = {
  'jcr:title': 'Mobiles, Home Appliances, Electronics & More',
  ogTitle: 'Mobiles, Home Appliances, Electronics & More | Samsung Jordan',
  twitterTitle: 'Mobiles, Home Appliances, Electronics & More | Samsung Jordan',
  twitterSite: '@SamsungLEVANT',
  twitterCreator: '@SamsungLEVANT',
  'jcr:language': 'en-JO',
  'google-site-verification': 'gVabN'
};
const home = (path, props, state = 'ok') => ({ path, state, props });
const SRC = home('/content/samsung/lb', LB);
const DEST = home('/content/samsung/levant', LEVANT);

const PAGE = {
  'jcr:title': 'Air Conditioners',
  ogTitle: 'Air Conditioners | Samsung Lebanon',
  twitterTitle: 'Air Conditioners | Samsung Lebanon',
  twitterSite: '@SamsungLB',
  twitterCreator: '@SamsungLB',
  'jcr:language': 'en_LB',
  description: 'Cool air from Samsung Lebanon.'
};

console.log('--- the rules ------------------------------------------------------');

check('a home page title ending is its share title minus its own title',
  sv.titleEnding(LB) === ' | Samsung Lebanon' && sv.titleEnding(LEVANT) === ' | Samsung Jordan',
  `${JSON.stringify(sv.titleEnding(LB))} ${JSON.stringify(sv.titleEnding(LEVANT))}`);
check('a share title that does not start with the page title still gives the last "| …"',
  sv.titleEnding({ 'jcr:title': 'Home', ogTitle: 'Mobiles | Samsung Jordan' }) === ' | Samsung Jordan',
  sv.titleEnding({ 'jcr:title': 'Home', ogTitle: 'Mobiles | Samsung Jordan' }));
check('"Mobiles, TVs | …" minus "Mobiles" is not taken as an ending',
  sv.titleEnding({ 'jcr:title': 'Mobiles', ogTitle: 'Mobiles, TVs | Samsung Jordan' }) === ' | Samsung Jordan',
  sv.titleEnding({ 'jcr:title': 'Mobiles', ogTitle: 'Mobiles, TVs | Samsung Jordan' }));
check('a home page without a bar in its titles gives no ending',
  sv.titleEnding({ 'jcr:title': 'Samsung', ogTitle: 'Samsung Jordan' }) === null, 'expected null');

const swaps = [
  ['Air Conditioners | Samsung Lebanon', 'Air Conditioners | Samsung Jordan'],
  ['Air Conditioners|Samsung Lebanon', 'Air Conditioners | Samsung Jordan'],
  ['Air Conditioners  |  Samsung Lebanon\r\n', 'Air Conditioners | Samsung Jordan'],
  ['Galaxy S26 | S26+ | Samsung Lebanon', 'Galaxy S26 | S26+ | Samsung Jordan'],
  ['TVs | Buy Online', null],
  ['Samsung Lebanon offers', null],
  ['Air Conditioners | samsung lebanon', null]
];
const wrongSwaps = swaps.filter(([v, want]) => sv.swapEnding(v, ' | Samsung Lebanon', ' | Samsung Jordan') !== want);
check(`only the ending is swapped, whatever the spaces around the bar (${swaps.length} cases)`, !wrongSwaps.length,
  wrongSwaps.map(([v]) => `${JSON.stringify(v)} -> ${JSON.stringify(sv.swapEnding(v, ' | Samsung Lebanon', ' | Samsung Jordan'))}`).join('; '));

const all = sv.siteValues({ page: PAGE, src: SRC, dest: DEST });
check('lb -> levant: every site value is the levant home page\'s',
  JSON.stringify(all.values) === JSON.stringify({
    twitterSite: '@SamsungLEVANT',
    twitterCreator: '@SamsungLEVANT',
    ogTitle: 'Air Conditioners | Samsung Jordan',
    twitterTitle: 'Air Conditioners | Samsung Jordan',
    'jcr:language': 'en-JO'
  }) && all.notes.length === 0,
  JSON.stringify(all));
check('where they were read is named', all.from === '/content/samsung/lb' && all.to === '/content/samsung/levant', `${all.from} ${all.to}`);
check('the description is never touched - it is copy, not a site value', !('description' in all.values), JSON.stringify(all.values));
check('nothing from the home page alone rides along', !('google-site-verification' in all.values), JSON.stringify(all.values));

const noLang = sv.siteValues({ page: { ...PAGE, 'jcr:language': undefined }, src: SRC, dest: DEST });
check('a page without jcr:language does not get one', !('jcr:language' in noLang.values), JSON.stringify(noLang.values));

const noHandle = sv.siteValues({ page: { twitterSite: '@SamsungLB' }, src: SRC, dest: DEST });
check('a page without twitterCreator does not get one', !('twitterCreator' in noHandle.values), JSON.stringify(noHandle.values));

const odd = sv.siteValues({ page: { ...PAGE, twitterTitle: 'TVs | Buy Online' }, src: SRC, dest: DEST });
check('a title ending some other way is left as it is, and said so',
  !('twitterTitle' in odd.values) && odd.values.ogTitle === 'Air Conditioners | Samsung Jordan' &&
    odd.notes.some((n) => n.includes('twitterTitle') && n.includes('Buy Online')),
  JSON.stringify(odd));

const already = sv.siteValues({ page: { ...PAGE, ogTitle: 'Air Conditioners | Samsung Jordan' }, src: SRC, dest: DEST });
check('a title already ending the destination\'s way is not flagged',
  !('ogTitle' in already.values) && !already.notes.some((n) => n.includes('ogTitle')), JSON.stringify(already));

const unread = sv.siteValues({ page: PAGE, src: SRC, dest: home('/content/samsung/levant', null, 'unreadable') });
check('a destination home page that cannot be read: nothing is guessed, and it is said once',
  Object.keys(unread.values).length === 0 && unread.notes.length === 1 && unread.notes[0].includes('no access'),
  JSON.stringify(unread));

const noSrcHome = sv.siteValues({ page: PAGE, src: home('/content/samsung/lb', null, 'missing'), dest: DEST });
check('without the source home page the handles and language are still set, the titles are not',
  noSrcHome.values.twitterSite === '@SamsungLEVANT' && noSrcHome.values['jcr:language'] === 'en-JO' &&
    !('ogTitle' in noSrcHome.values) && noSrcHome.notes.some((n) => n.includes('could not be read')),
  JSON.stringify(noSrcHome));

const bare = sv.siteValues({ page: PAGE, src: SRC, dest: home('/content/samsung/levant', { 'jcr:title': 'Home' }) });
check('a destination home page without a handle: the source\'s is kept, and said so',
  Object.keys(bare.values).length === 0 && bare.notes.some((n) => n.includes('no twitterSite') && n.includes('@SamsungLB')),
  JSON.stringify(bare));

check('a page with none of them needs no home page read',
  !sv.touchesSite({ 'jcr:title': 'x', description: 'y' }) && sv.touchesSite({ twitterSite: '@x' }), 'touchesSite');
check('only the props it needs cross between tabs',
  JSON.stringify(Object.keys(sv.homeProps(LEVANT)).sort()) ===
    JSON.stringify(['jcr:language', 'jcr:title', 'ogTitle', 'twitterCreator', 'twitterSite', 'twitterTitle']),
  JSON.stringify(sv.homeProps(LEVANT)));

console.log('--- the review and done screens -----------------------------------');

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
    this.checked = false;
    this.disabled = false;
  }
  append(...nodes) {
    for (const n of nodes) {
      const node = typeof n === 'string' ? Object.assign(new El('#text'), { own: n }) : n;
      node.parent = this;
      this.children.push(node);
    }
  }
  after(node) {
    node.parent = this.parent;
    this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node);
  }
  get firstChild() { return this.children[0] || null; }
  get textContent() { return this.own + this.children.map((c) => c.textContent).join(' '); }
  set textContent(v) { this.children = []; this.own = String(v ?? ''); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(e) { for (const fn of this.listeners[e.type] || []) fn(e); }
  *all() {
    for (const c of this.children) {
      if (c.tagName === '#TEXT') continue;
      yield c;
      yield* c.all();
    }
  }
  querySelectorAll(sel) {
    const [tag, ...classes] = sel.split('.');
    return [...this.all()].filter((n) =>
      (!tag || n.tagName === tag.toUpperCase()) && classes.every((c) => n.className.split(/\s+/).includes(c)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
globalThis.document = { createElement: (tag) => new El(tag) };
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const panel = await import(pathToFileURL(base + 'panel/site-values.js'));
const preview = (v) => (v == null ? '' : String(v));
const changes = [
  { prop: 'twitterSite', from: '@SamsungLB', to: '@SamsungLEVANT', keeps: '@SamsungLB' },
  { prop: 'ogTitle', from: 'Air Conditioners | Samsung Lebanon', to: 'Air Conditioners | Samsung Jordan', keeps: 'Air Conditioners | Samsung Lebanon' }
];
const summary = (applied, notes = []) =>
  sv.siteSummary({ from: '/content/samsung/lb', to: '/content/samsung/levant', notes }, changes, { applied, preview });
const data = (site, mode = 'create') => ({ mode, site, rewrite: { srcSite: 'lb', destSite: 'levant' } });

{
  const root = el('div');
  const said = [];
  panel.renderSiteValues(root, data(summary(true, ['twitterTitle "TVs | Buy Online" does not end with …'])), { el, onChange: (t) => said.push(t) });
  const box = root.querySelector('input');
  const text = root.textContent;
  check('ticked: the box is ticked, and says what it does',
    box?.checked === true && text.includes("Set these page properties to the /levant site's values"), text);
  check('ticked: each value is listed with what it replaces',
    text.includes('@SamsungLEVANT') && text.includes('Air Conditioners | Samsung Jordan') && text.includes('/content/samsung/levant'), text);
  check('anything left alone is listed under it, as a warning',
    root.querySelectorAll('p.detail-note').some((p) => p.dataset.tone === 'warn' && p.textContent.includes('Buy Online')), text);
  box.checked = false;
  box.dispatchEvent({ type: 'change' });
  check('unticking asks for the review again with the box off, and holds the box until then',
    said.length === 1 && said[0] === false && box.disabled === true, JSON.stringify(said));
}

{
  const root = el('div');
  panel.renderSiteValues(root, data(summary(false)), { el, onChange: () => {} });
  const text = root.textContent;
  check('unticked on a new page: it says the source\'s values arrive, and lists them',
    root.querySelector('input')?.checked === false && text.includes("gets the source's values") &&
      text.includes('@SamsungLB') && !text.includes('@SamsungLEVANT'), text);
}

{
  const root = el('div');
  panel.renderSiteValues(root, data(summary(false), 'sync'), { el, onChange: () => {} });
  check('unticked on an existing page: it says they stay', root.textContent.includes('These stay as shown below'), root.textContent);
}

{
  const root = el('div');
  const notesOnly = sv.siteSummary({ from: '/a', to: '/content/samsung/levant', notes: ['Could not read /content/samsung/levant (no access).'] }, [], { applied: true, preview });
  panel.renderSiteValues(root, data(notesOnly), { el, onChange: () => {} });
  check('nothing to set but something to say: the note, and no box to tick',
    !root.querySelector('input') && root.textContent.includes('no access'), root.textContent);
}

{
  const root = el('div');
  panel.renderSiteValues(root, data(null), { el, onChange: () => {} });
  check('the same site: no box at all', root.children.length === 0, root.textContent);
  check('nothing to set and nothing to say is not a box either',
    sv.siteSummary({ from: '/a', to: '/b', notes: [] }, [], { applied: true, preview }) === null, 'expected null');
}

{
  const root = el('div');
  panel.renderSiteDone(root, { site: sv.markFailed(summary(true, ['twitterTitle left as it is']), ['ogTitle']) }, { el });
  const text = root.textContent;
  check('done: what was set is listed, from where',
    text.includes('Site values set from /content/samsung/levant') && text.includes('twitterSite: @SamsungLEVANT'), text);
  check('done: a value whose write was refused does not claim to be set',
    text.includes('ogTitle: not written') && !text.includes('ogTitle: Air Conditioners | Samsung Jordan'), text);
  check('done: what is left to check by hand is listed', text.includes('Check these page properties by hand') && text.includes('twitterTitle left'), text);
}

{
  const root = el('div');
  panel.renderSiteDone(root, { site: summary(false) }, { el });
  check('done, unticked: it says nothing was set, and what the page has',
    root.textContent.includes('Site values not set') && root.textContent.includes('twitterSite: @SamsungLB'), root.textContent);
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
