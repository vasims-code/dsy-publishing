/**
 * What the screens are supposed to do, checked.
 *
 * Each test drives a real screen module against a stubbed tab and looks at
 * what it drew. The point is the things a walkthrough misses: the refusals,
 * the empty cases, the labels that say the wrong thing, and the parameters a
 * worker would refuse.
 */

import * as LOG from '/src/ui/log.js';
import * as H from './harness.js';

const T = [];
const test = (name, fn) => T.push({ name, fn });

function expect(cond, said) {
  if (!cond) throw new Error(said);
}
const has = (ctx, text, said) =>
  expect(H.shown(ctx).toLowerCase().includes(text.toLowerCase()), said || `expected to see "${text}"`);
const hasNot = (ctx, text, said) =>
  expect(!H.shown(ctx).toLowerCase().includes(text.toLowerCase()), said || `did not expect "${text}"`);

/* ------------------------------------------------------------- fixtures */

const SCAN = (count = 4) => ({
  page: '/content/samsung/uk/offers/spring-sale',
  title: 'Spring sale',
  hosts: ['www.samsung.com'],
  nodes: 48,
  count,
  components: count
    ? [
        { node: 'root/hero', type: 'hero', title: 'Hero', liveCopy: false, links: [
          { prop: 'text', index: -1, start: 0, from: 'https://www.samsung.com/uk/a/', to: '/uk/a/', value: 'v1' }] },
        { node: 'root/t1', type: 'teaser', title: 'Teaser 1', liveCopy: false, links: [
          { prop: 'linkURL', index: -1, start: 0, from: 'https://www.samsung.com/uk/b/', to: '/uk/b/', value: 'v2' }] },
        { node: 'root/t2', type: 'teaser', title: 'Teaser 2', liveCopy: false, links: [
          { prop: 'linkURL', index: -1, start: 0, from: 'https://www.samsung.com/de/c/', to: '/de/c/', value: 'v3' }] },
        { node: 'root/p', type: 'promo', title: 'Promo', liveCopy: true, links: [
          { prop: 'ctaLink', index: -1, start: 0, from: 'https://www.samsung.com/uk/d/', to: '/uk/d/', value: 'v4' }] }
      ]
    : []
});

const BACKUP = (over = {}) => ({
  mode: 'create',
  upToDate: false,
  source: '/content/samsung/levant/tvs',
  dest: '/content/samsung/levant/india/backup/tvs',
  create: [{ path: '/content/samsung/levant/india/backup/tvs', title: 'TVs' }],
  skip: [{ path: '/content/samsung/levant/india' }],
  copy: { path: '/content/samsung/levant/india/backup/tvs' },
  update: null,
  sync: null,
  counts: { create: 1, skip: 1, root: 3 },
  ...over
});

const VERSIONS = (over = {}) => ({
  page: '/content/samsung/lb/india/backup/ac',
  title: 'AC',
  historyPath: '/jcr:system/x',
  neverVersioned: false,
  current: '1.1',
  currentNumber: 2,
  live: { lastModified: '2026-10-30T11:20:00Z', lastModifiedBy: 'tester' },
  drift: { changed: false, where: [] },
  versions: [
    { name: '1.1', id: 'v2', number: 2, created: '2026-10-29T14:02:00Z', labels: [], comment: 'Second', lastModified: '2026-10-29T14:02:00Z', lastModifiedBy: 'a', current: true },
    { name: '1.0', id: 'v1', number: 1, created: '2026-10-02T11:05:00Z', labels: [], comment: null, lastModified: '2026-10-02T11:05:00Z', lastModifiedBy: 'b', current: false }
  ],
  ...over
});

const CP = (over = {}) => ({
  // page-upsert's own shape: 'sync' or 'create', and images to copy as `assetsToCopy`.
  mode: 'sync',
  source: '/content/samsung/uk/a',
  dest: '/content/samsung/lb/a',
  rewrite: { enabled: true, srcSite: 'uk', destSite: 'lb' },
  sections: [{ id: 'props', title: 'Write properties', count: 9 }],
  site: null,
  imagesByHand: [],
  blockers: [],
  largeRemoval: null,
  metadata: null,
  nodes: { deleted: [] },
  props: { deleted: [] },
  removalsFingerprint: 'fp',
  counts: { links: 2, properties: 9, assetsToCopy: 0, nodesAdded: 0, nodesDeleted: 0 },
  ...over
});

/* A row as extractCopyDeck makes one (copy-deck/core.js): the stored value,
   what the sheet shows, its format and the hash its Check cell carries. */
const DECK_ROW = (key, section, sectionNo, category, field, path, prop, value, extra = {}) => ({
  key, path, prop, value, source: value, format: 'plain', tags: [], lineBreaks: 0, category, field,
  inactive: null, added: undefined, limit: undefined, hash: 'h1a2b3c4d',
  section, sectionNo, place: section, ...extra
});

const DECK = (over = {}) => ({
  page: '/content/samsung/uk/offers/spring-sale',
  title: 'Spring sale',
  language: 'en_GB',
  tree: {},
  dialogs: {},
  titles: {},
  fields: { add: [], ignore: [] },
  pagePath: '/content/samsung/uk/offers/spring-sale',
  rows: [
    DECK_ROW('.@jcr:title', 'Page properties', 0, 'page', 'Page title', '', 'jcr:title', 'Spring sale'),
    DECK_ROW('root/hero@title', '01 · Hero', 1, 'copy', 'Headline', 'root/hero', 'title', 'Big savings'),
    DECK_ROW('root/hero@cta', '01 · Hero', 1, 'cta', 'Button', 'root/hero', 'cta', 'Shop'),
    DECK_ROW('root/hero@x', '01 · Hero', 1, 'copy', 'Hidden', 'root/hero', 'x', 'Hidden one', { inactive: 'hidden on the page' })
  ],
  newFields: [], references: [], staticLeftOff: [], staticCode: [], scriptWarnings: [],
  ...over
});

/* A row as planImport gives one back (copy-deck/core.js): what the page holds
   now, what the sheet was exported from, and what the translator typed. */
const IMP_ROW = (over) => ({
  sheetRow: 2, key: 'root/hero@title', section: '1 · Hero', field: 'Headline', category: 'copy',
  current: '', sheetSource: '', sheetRowNo: 2, translation: '', reusedFrom: null, message: '', warnings: [],
  status: 'ready', ...over
});

const IMP = (over = {}) => ({
  page: '/content/samsung/levant_ar/a',
  origin: 'https://p6-ap-author.samsung.com',
  pagePath: '/content/samsung/levant_ar/a',
  title: 'A',
  exportedFrom: '/content/samsung/levant_ar/a',
  language: 'ar',
  approved: 'sig',
  warnings: [],
  sections: [{ id: '1 · Hero', static: false }],
  selected: ['1 · Hero'],
  rows: [
    IMP_ROW({ status: 'ready', current: 'Big savings', sheetSource: 'Big savings', translation: 'وفورات', newValue: 'وفورات' }),
    IMP_ROW({
      sheetRow: 3, sheetRowNo: 3, key: 'root/hero@cta', field: '', category: '', status: 'missing', sheetSource: 'Gone', translation: 'ذهب',
      message: 'Not on this page: the component was removed or renamed, or the sheet is for another page.'
    })
  ],
  writes: [{ path: 'root/hero', prop: 'title', from: 'Big savings', to: 'وفورات', rows: [2], section: '1 · Hero' }],
  offered: [{ path: 'root/hero', prop: 'title', from: 'Big savings', to: 'وفورات', rows: [2], section: '1 · Hero' }],
  notInSheet: [],
  staticBlocks: [],
  counts: { ready: 1, reuse: 0, manual: 0, already: 0, same: 0, untranslated: 0, changed: 0, missing: 1, notFound: 0, invalid: 0, duplicate: 0 },
  ...over
});

/* What the import worker's apply returns once every value is read back. */
const WRITTEN = (n = 1) => ({
  done: true,
  page: '/content/samsung/levant_ar/a',
  dest: '/content/samsung/levant_ar/a',
  written: n,
  title: `${n} translation${n === 1 ? '' : 's'} written`,
  editorUrl: '/editor.html/content/samsung/levant_ar/a.html'
});

/* A translated sheet as Excel puts it on the clipboard: the exported header,
   a row, and the #END row that says the sheet is complete. */
const PASTED = [
  ['Section', 'Field', 'Notes', 'Key (do not edit)', 'Check (do not edit)', 'Source text', 'Translation'],
  ['1 · Hero', 'Headline', '', 'root/hero@title', 'h1a2b3c4d', 'Big savings', 'وفورات'],
  ['#END - keep this row, it tells the import the sheet is complete', '/content/samsung/uk/a', 'rows=1 · exported 2026-11-03 10:00 · copy deck v4', '#meta', 'h00000000', '', '']
].map((r) => r.join('\t')).join('\r\n');

/**
 * Drive a screen: render it, and keep re-rendering as it asks.
 *
 * The shell puts the activity log at the bottom of any screen that did not
 * place it itself (ui/panel.js). This stands in for the shell, so it does the
 * same - otherwise a test would pass on a screen the real panel draws
 * differently.
 */
async function mount(mod, { state, own = {} } = {}) {
  const ctx = H.makeCtx({ state, own });
  ctx.draw = async () => {
    await mod.render(ctx, ctx.own);
    if (ctx.own.log?.lines.length && !ctx.view.querySelector('.log-box')) {
      ctx.view.append(LOG.logBox(ctx.own.log.lines));
    }
  };
  await ctx.render();
  await H.settle(0);
  return ctx;
}

/* ===================================================== Relative Link Fixer */

test('Link Fixer · scan, review, confirm, run, result', async () => {
  const mod = await import('/src/ui/screens/link-fixer.js');
  H.tab.reply = async (m) =>
    m.action === 'scan'
      ? { ok: true, result: SCAN() }
      : { ok: true, result: { done: true, page: SCAN().page, fixed: 2, left: 1 } };
  const ctx = await mount(mod);

  has(ctx, 'Scan this page', 'the pick step offers a scan');
  has(ctx, 'Preview only', 'a read says so');
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('to fix'));

  has(ctx, 'to fix', 'the review counts what it found');
  has(ctx, 'Continue with', 'the review moves on by saying what it carries');
  hasNot(ctx, 'Review 4 changes', 'the old confusing label is gone');
  H.btn(ctx, 'Continue with').click();
  await H.settle(20);

  has(ctx, 'This will change content in AEM', 'the confirm step warns');
  has(ctx, 'Writes to AEM', 'the footer tag says it writes');
  H.btn(ctx, 'in AEM').click();
  await H.until(() => H.shown(ctx).includes('changed'));
  has(ctx, 'changed', 'the result says what changed');
});

test('Link Fixer · a clean page stays on Review and offers no write', async () => {
  const mod = await import('/src/ui/screens/link-fixer.js');
  H.tab.reply = async () => ({ ok: true, result: SCAN(0) });
  const ctx = await mount(mod);
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('Nothing to fix'));

  has(ctx, 'Nothing to fix', 'it says there is nothing to fix');
  has(ctx, 'nodes read', 'it says how much it looked at');
  has(ctx, 'Nothing was written', 'the footer says nothing was written');
  expect(!H.btn(ctx, 'in AEM'), 'there must be no write button');
  hasNot(ctx, 'Done', 'it must not look like a finished run');
});

test('Link Fixer · a failed scan says why and stays on Pick', async () => {
  const mod = await import('/src/ui/screens/link-fixer.js');
  H.tab.reply = async () => ({ ok: false, error: 'Page does not exist: /content/nope' });
  const ctx = await mount(mod);
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('That did not work'));

  has(ctx, 'That did not work', 'a failure is said');
  has(ctx, 'Page does not exist', "the worker's own words are kept");
  has(ctx, 'Scan this page', 'it stays where it can be tried again');
});

test('Link Fixer · another country and inherited links are not ticked', async () => {
  const mod = await import('/src/ui/screens/link-fixer.js');
  H.tab.reply = async () => ({ ok: true, result: SCAN() });
  const ctx = await mount(mod);
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('another country'));

  has(ctx, 'another country', 'the other-country link is called out');
  has(ctx, 'inherited', 'the inherited link is called out');
  has(ctx, '2 of 4 selected', 'only the safe two are ticked');
});

/* ===================================================== Broken Link Finder */

/* Shaped like the broken-links worker's scan result: a page whose link
   carries a filter after it, which author cannot confirm. */
const LINKS_SCAN = () => ({
  page: '/content/samsung/iq_ar/tvs/what-is-mini-led',
  title: 'What is Mini LED',
  host: 'p6-ap-author.samsung.com',
  origin: 'https://p6-ap-author.samsung.com',
  contentRoot: '/content/samsung',
  site: 'iq_ar',
  hosts: ['www.samsung.com'],
  pd: false,
  nodes: 4,
  components: 1,
  links: 1,
  checked: 1,
  broken: 0,
  look: 1,
  ok: 0,
  unchecked: 0,
  at: Date.now(),
  targets: [
    {
      key: 'page|/content/samsung/in/tvs/all-tvs?mini-led1234',
      kind: 'page',
      path: '/content/samsung/in/tvs/all-tvs',
      raw: '/in/tvs/all-tvs/?mini-led1234',
      site: 'in',
      query: '?mini-led1234',
      state: 'query',
      title: 'All TVs',
      note: 'the page is on author, but "?mini-led1234" after it could not be checked - open the link and check it by hand',
      uses: [{ node: 'text', component: 'Text Editor', section: '01 · Text Editor', field: 'Description', within: '', prop: 'description', index: -1, raw: '/in/tvs/all-tvs/?mini-led1234', text: 'M80H', context: 'attribute', pos: 0 }]
    }
  ]
});

test('Broken Link Finder · a link with a query is sent to be checked by hand', async () => {
  const mod = await import('/src/ui/screens/broken-links.js');
  H.tab.reply = async (m) => (m.action === 'scan' ? { ok: true, result: LINKS_SCAN() } : { ok: false, error: 'nothing else is asked' });
  const ctx = await mount(mod, { state: { page: { path: LINKS_SCAN().page, title: 'What is Mini LED' } } });
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('Check by hand'));

  has(ctx, 'Check by hand', 'the row is tagged for a person to check');
  has(ctx, '?mini-led1234', 'the query is named');
  has(ctx, 'need a look', 'it counts among the links that need a look');
  hasNot(ctx, '1 broken', 'it is not called broken');
  expect(!!H.btn(ctx, 'Open on author'), 'the page can be opened to check it');
  const text = mod.reportText(LINKS_SCAN());
  expect(/NEED A LOOK[\s\S]*\[Check by hand\] \/in\/tvs\/all-tvs\/\?mini-led1234/.test(text), 'the copied report lists it under Need a look');
});

test('Broken Link Finder · an anchor with no such id on the page is broken', async () => {
  const mod = await import('/src/ui/screens/broken-links.js');
  const use = (raw) => ({ node: 'cta', component: 'CTA', section: '02 · CTA', field: 'CTA link', within: '', prop: 'ctaUrl', index: -1, raw, text: 'Learn more', context: 'value', pos: 1 });
  const scan = {
    ...LINKS_SCAN(),
    links: 2,
    checked: 2,
    broken: 1,
    look: 0,
    ok: 1,
    targets: [
      { key: 'anchor|#2', kind: 'anchor', id: '2', path: null, raw: '#2', state: 'missing', note: 'nothing on the page has id="2" - the link goes nowhere. If a script adds it in the browser, check it on the live page', uses: [use('#2')] },
      { key: 'anchor|#1', kind: 'anchor', id: '1', path: null, raw: '#1', state: 'ok', uses: [use('#1')] }
    ]
  };
  H.tab.reply = async (m) => (m.action === 'scan' ? { ok: true, result: scan } : { ok: false, error: 'nothing else is asked' });
  const ctx = await mount(mod, { state: { page: { path: scan.page, title: 'What is Mini LED' } } });
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('No such id'));

  has(ctx, 'No such id', 'the broken anchor is tagged');
  has(ctx, 'id="2"', 'and the note names the id');
  expect(!H.btn(ctx, 'Open on author'), 'an anchor offers no page to open');
  const text = mod.reportText(scan);
  expect(/BROKEN[^\n]*\n\s+\[No such id\] #2/.test(text), 'the copied report lists #2 under Broken');
  expect(/OK[^\n]*\n\s+\[OK\] #1/.test(text), 'and #1 under OK');
});

test('Broken Link Finder · www.samsung without .com is broken, with the address it should be', async () => {
  const mod = await import('/src/ui/screens/broken-links.js');
  const raw = 'https://www.samsung/iq_ar/tvs/tv-buying-guide/';
  const scan = {
    ...LINKS_SCAN(),
    broken: 1,
    look: 0,
    targets: [
      {
        key: `badhost|${raw}`,
        kind: 'badhost',
        path: null,
        href: raw,
        host: 'www.samsung',
        raw,
        state: 'missing',
        note: '"www.samsung" is missing ".com" - it should be https://www.samsung.com/iq_ar/tvs/tv-buying-guide/',
        uses: [{ node: 'seo', component: 'SEO Schema Markup', section: 'SEO Schema Markup', field: 'Content html', within: '', prop: 'contentHtml', index: -1, raw, text: null, context: 'json', pos: 0 }]
      }
    ]
  };
  H.tab.reply = async (m) => (m.action === 'scan' ? { ok: true, result: scan } : { ok: false, error: 'nothing else is asked' });
  const ctx = await mount(mod, { state: { page: { path: scan.page, title: 'TV Buying Guide' } } });
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('No .com'));

  has(ctx, 'No .com', 'the link is tagged');
  has(ctx, 'https://www.samsung.com/iq_ar/tvs/tv-buying-guide/', 'the note gives the right address');
  expect(/BROKEN[^\n]*\n\s+\[No \.com\]/.test(mod.reportText(scan)), 'the copied report lists it under Broken');
});

/* ================================================== Site Code Link Fixer */

/* Shaped like the site-code-fixer worker's scan result: the SEO schema
   markup's two placeholders, and one real link into another site. */
const SITE_SCAN = () => {
  const schema = '"@type": "Guide",\r\n  "url": "https://www.samsung.com/{site_code}/tvs/tv-buying-guide/"';
  const at = schema.indexOf('https://');
  return {
    page: '/content/samsung/iq_ar/tvs/what-is-mini-led',
    title: 'What is Mini LED',
    site: 'iq_ar',
    contentRoot: '/content/samsung',
    nodes: 6,
    count: 2,
    otherSites: [{ code: 'in', links: 1 }, { code: '{site_code}', links: 1 }],
    components: [
      {
        node: 'root/responsivegrid/cm_g_seo_schema_mark',
        resourceType: 'samsung/components/content/consumer/global/common/cm-g-seo-schema-markup-content',
        type: 'cm-g-seo-schema-markup-content',
        title: 'SEO Schema Markup',
        liveCopy: false,
        links: [
          { prop: 'contentHtml', index: -1, start: at, from: 'https://www.samsung.com/{site_code}/tvs/tv-buying-guide/', to: 'https://www.samsung.com/iq_ar/tvs/tv-buying-guide/', code: '{site_code}', placeholder: true, at: 24, target: '/content/samsung/iq_ar/tvs/tv-buying-guide', context: 'json', text: null, value: schema, exists: 'yes' }
        ]
      },
      {
        node: 'root/responsivegrid/cm_g_text_editor_cop/column1',
        resourceType: 'samsung/components/content/consumer/global/common/cm-g-text-editor',
        type: 'cm-g-text-editor',
        title: 'Text Editor',
        liveCopy: false,
        links: [
          { prop: 'description', index: -1, start: 9, from: '/in/tvs/all-tvs/?mini-led', to: '/iq_ar/tvs/all-tvs/?mini-led', code: 'in', placeholder: false, at: 1, target: '/content/samsung/iq_ar/tvs/all-tvs', context: 'attribute', text: 'M80H', value: '<a href="/in/tvs/all-tvs/?mini-led">M80H</a>', exists: 'yes' }
        ]
      }
    ]
  };
};

test('Site Code Link Fixer · a {site_code} placeholder is listed unticked, and fixed when ticked', async () => {
  const mod = await import('/src/ui/screens/site-code-fixer.js');
  H.tab.reply = async (m) => (m.action === 'scan' ? { ok: true, result: SITE_SCAN() } : { ok: true, result: { done: true, fixed: 1, left: 0, title: '1 link pointed at /iq_ar' } });
  const ctx = await mount(mod, { state: { page: { path: SITE_SCAN().page, title: 'What is Mini LED' } } });
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('Placeholder'));

  has(ctx, 'Placeholder', 'the row is tagged as a placeholder');
  has(ctx, 'placeholder such as {site_code}', 'the review says what it is');
  has(ctx, '1 of 2 selected', 'only the real site code is ticked for the author');

  const box = ctx.view.querySelector('input[aria-label^="Point https://www.samsung.com/{site_code}"]');
  expect(!!box && !box.checked, 'the placeholder has an unticked box');
  H.tick(box, true);
  await H.settle(20);
  has(ctx, '2 of 2 selected', 'ticking it selects it');
  H.btn(ctx, 'Continue with').click();
  await H.settle(20);
  H.btn(ctx, 'in AEM').click();
  const fix = await H.until(() => H.tab.sent.find((m) => m.action === 'fix'));
  const sent = fix.params.picks.flatMap((p) => p.links);
  expect(
    sent.some((l) => l.from.includes('{site_code}') && l.to === 'https://www.samsung.com/iq_ar/tvs/tv-buying-guide/'),
    'the fix sent replaces the placeholder with the page’s site code'
  );
});

/* ============================================== Image Site Code Fixer */

/* Shaped like the image-site-fixer worker's scan result (tools/image-site-fixer-test.mjs
   runs that worker): an /lb image as an images.samsung.com address, one /lb
   image only Dynamic Media still has, a shared /global icon, and one lost. */
const IMG_SCAN = () => {
  const DM = 'https://images.samsung.com/is/image/samsung/assets';
  const use = (form, from, to) => ({ node: 'root/responsivegrid/static', prop: 'bodyHtml', index: -1, start: 10, from, to, form, title: 'RC01_Static Content', type: 'cm-g-static-content', liveCopy: false });
  const img = (folder, site, file, action, extra = {}) => ({
    src: `/content/dam/samsung/${folder}/apps/samsung-health/${file}`,
    dest: `/content/dam/samsung/iq_ku/apps/samsung-health/${file}`,
    folder,
    site,
    action,
    uses: [use('delivery', `${DM}/${folder}/apps/samsung-health/${file}`, `${DM}/iq_ku/apps/samsung-health/${file}`)],
    ...extra
  });
  return {
    page: '/content/samsung/iq_ku/apps/samsung-health',
    title: 'Samsung Health',
    site: 'iq_ku',
    damRoot: '/content/dam/samsung',
    folder: 'iq_ku',
    nodes: 12,
    images: [
      img('lb', true, 'mindful1081.jpg', 'upload'),
      img('lb', true, 'gone.jpg', 'upload-delivery', { via: `${DM}/lb/apps/samsung-health/gone.jpg` }),
      img('lb', true, 'lost.jpg', 'missing'),
      img('global', false, 'arrow.svg', 'upload')
    ],
    props: [{ node: 'root/responsivegrid/static', prop: 'bodyHtml', expect: '<picture>…</picture>' }],
    otherFolders: [{ folder: 'lb', site: true, images: 3 }, { folder: 'global', site: false, images: 1 }]
  };
};

test('Image Site Code Fixer · another site’s images are ticked, a shared one is not, a lost one has no box', async () => {
  const mod = await import('/src/ui/screens/image-site-fixer.js');
  H.tab.reply = async (m) =>
    m.action === 'scan'
      ? { ok: true, result: IMG_SCAN() }
      : { ok: true, result: { done: true, page: IMG_SCAN().page, folder: '/content/dam/samsung/iq_ku', fixed: 2, uploaded: 2, references: 2, remaining: 2, uploadedPaths: ['/content/dam/samsung/iq_ku/apps/samsung-health/gone.jpg'] } };
  const ctx = await mount(mod, { state: { page: { path: IMG_SCAN().page, title: 'Samsung Health' } } });
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('Images from other folders'));

  has(ctx, '/content/dam/samsung/iq_ku', 'the page’s own folder is named');
  has(ctx, '2 of 3 selected', 'the two /lb images that can be fixed are ticked; the shared one is not');
  has(ctx, 'Shared folder', 'the /global icon is tagged');
  has(ctx, 'From images.samsung.com', 'the image the DAM lost is taken from Dynamic Media');
  has(ctx, 'cannot be fixed', 'the lost image is called out');
  expect(!ctx.view.querySelector('input[aria-label$="lost.jpg to /iq_ku"]'), 'the lost image has no box to tick');
  const shared = ctx.view.querySelector('input[aria-label^="Move /content/dam/samsung/global/"]');
  expect(!!shared && !shared.checked, 'the shared image has an unticked box');

  H.btn(ctx, 'Continue with').click();
  await H.settle(20);
  has(ctx, 'Will upload', 'the confirm step says what it uploads');
  has(ctx, '2 images to /content/dam/samsung/iq_ku', 'and where');
  hasNot(ctx, 'Publish afterwards', 'no publishing message');
  has(ctx, 'Writes to AEM', 'it says it writes');
  H.btn(ctx, 'in AEM').click();
  const fix = await H.until(() => H.tab.sent.find((m) => m.action === 'fix'));
  const picks = [...fix.params.picks].sort();
  expect(
    JSON.stringify(picks) === JSON.stringify(['/content/dam/samsung/lb/apps/samsung-health/gone.jpg', '/content/dam/samsung/lb/apps/samsung-health/mindful1081.jpg']),
    `the fix is sent the two ticked images: ${picks}`
  );
  expect(fix.params.props?.length === 1 && fix.params.damFolder === 'iq_ku', 'with what the scan read, and the folder');
  await H.until(() => H.shown(ctx).includes('now in /content/dam/samsung/iq_ku'));
  has(ctx, 'gone.jpg', 'the result lists what was uploaded');
  hasNot(ctx, 'Publish the images', 'no publishing message');
});

test('Links · the image fixer is a fourth card, and says it writes', async () => {
  const mod = await import('/src/ui/screens/links.js');
  const ways = mod.ways();
  const img = ways.find((w) => w.id === 'image-site-fixer');
  expect(ways.length === 4 && img?.title === 'Fix the site code in images' && img.does === 'write', JSON.stringify(ways));
  const ctx = await mount(mod);
  has(ctx, 'Fix the site code in images', 'the card is drawn');
  has(ctx, 'All four work on one page', 'the note counts four');
});

/* ================================================================= Backup */

test('Backup · analyze, review the tree, run, done', async () => {
  const mod = await import('/src/ui/screens/backup.js');
  H.tab.reply = async (m) =>
    m.action === 'analyze'
      ? { ok: true, result: BACKUP() }
      : { ok: true, result: { ...BACKUP(), done: true, title: 'Backup ready' } };
  const ctx = await mount(mod);

  has(ctx, 'Analyze paths', 'the pick step offers an analysis');
  H.btn(ctx, 'Analyze paths').click();
  await H.until(() => H.shown(ctx).includes('Destination in the repositor'));

  has(ctx, 'Destination in the repository', 'the tree is drawn');
  has(ctx, 'to create', 'the counts are there');
  has(ctx, 'Create the backup', 'the write button names what it does');
  H.btn(ctx, 'Create the backup').click();
  await H.until(() => H.shown(ctx).includes('Backup ready'));
  has(ctx, 'Backup ready', 'the done step says so');
  has(ctx, 'Where it went', 'it says where it went');
});

test("Backup · a site's home page goes to the backup folder as home", async () => {
  const mod = await import('/src/ui/screens/backup.js');
  const ctx = await mount(mod, {
    state: { page: { path: '/content/samsung/levant_ar', title: 'Samsung Levant' }, settings: { rootDepth: 3, backupFolder: 'india/backup' } }
  });
  has(ctx, '/content/samsung/levant_ar/india/backup/home', 'the backup page is named');
  has(ctx, 'backed up as "home"', 'and the hint says why it is not the usual path');
  hasNot(ctx, 'has no backup location', 'it is not refused');
  expect(!H.btn(ctx, 'Analyze paths').disabled, 'it can be analyzed');
});

test('Backup · a backup that already matches offers nothing to write', async () => {
  const mod = await import('/src/ui/screens/backup.js');
  H.tab.reply = async () => ({ ok: true, result: BACKUP({ mode: 'update', upToDate: true, update: { path: 'x' }, copy: null }) });
  const ctx = await mount(mod);
  H.btn(ctx, 'Analyze paths').click();
  await H.until(() => H.shown(ctx).includes('Already up to date'));

  has(ctx, 'Already up to date', 'it says the backup matches');
  has(ctx, 'Nothing to write', 'the footer says nothing will be written');
  expect(H.btn(ctx, 'Nothing to update')?.disabled, 'the write button must be disabled');
});

test('Backup · a large removal is held until it is confirmed', async () => {
  const mod = await import('/src/ui/screens/backup.js');
  const sync = { largeRemoval: '12 components would go.', counts: { nodesDeleted: 12 }, props: { deleted: [] }, removalsFingerprint: 'fp' };
  H.tab.reply = async () => ({ ok: true, result: BACKUP({ mode: 'update', sync, update: { path: 'x' }, copy: null }) });
  const ctx = await mount(mod);
  H.btn(ctx, 'Analyze paths').click();
  await H.until(() => H.shown(ctx).includes('This will delete a lot from the backup page'));

  has(ctx, 'This will delete a lot from the backup page', 'it warns about the scale');
  expect(H.btn(ctx, 'Tick the box above')?.disabled, 'the write waits for the tick');

  const box = ctx.view.querySelector('input[aria-label*="delete these from the backup page"]');
  expect(!!box, 'there must be a box to tick');
  H.tick(box, true);
  await H.settle(40);
  expect(!H.btn(ctx, 'Tick the box above'), 'once ticked the button changes');
});

/* =============================================================== Versions */

test('Versions · list, restore, done', async () => {
  const mod = await import('/src/ui/screens/versions.js');
  H.tab.reply = async (m) =>
    m.action === 'list'
      ? { ok: true, result: VERSIONS() }
      : { ok: true, result: { done: true, page: VERSIONS().page, restored: '1.0', restoredNumber: 1, confirmed: true, title: 'Version restored' } };
  const ctx = await mount(mod, { state: { page: { path: '/content/samsung/lb/india/backup/ac', title: 'AC' } } });

  H.btn(ctx, 'Show versions').click();
  await H.until(() => H.shown(ctx).includes('Saved versions'));
  has(ctx, 'Saved versions', 'the list is drawn');
  has(ctx, 'On the page now', 'the current version is marked');

  const older = ctx.view.querySelector('input[aria-label="Version 1"]');
  expect(!!older, 'the older version must be pickable');
  H.tick(older, true);
  await H.settle(40);
  has(ctx, 'Restore version 1', 'the button names the version');

  H.btn(ctx, 'Restore version 1').click();
  await H.settle(40);
  has(ctx, 'Restore version 1?', 'a dialog asks first');
  H.btn(ctx, 'Restore this version').click();
  await H.until(() => H.shown(ctx).includes('Version restored'));
  has(ctx, 'Version restored', 'the result says so');
});

test('Versions · the version the page is on offers nothing', async () => {
  const mod = await import('/src/ui/screens/versions.js');
  H.tab.reply = async () => ({ ok: true, result: VERSIONS() });
  const ctx = await mount(mod, { state: { page: { path: '/content/samsung/lb/india/backup/ac', title: 'AC' } } });
  H.btn(ctx, 'Show versions').click();
  await H.until(() => H.shown(ctx).includes('Already on version 2'));

  has(ctx, 'Already on version 2', 'it says the page already holds it');
  has(ctx, 'Nothing to write', 'the tag says nothing is written');
  expect(H.btn(ctx, 'Already on version 2')?.disabled, 'the button must be disabled');
});

test('Versions · a changed page offers to undo, not to restore', async () => {
  const mod = await import('/src/ui/screens/versions.js');
  H.tab.reply = async () => ({ ok: true, result: VERSIONS({ drift: { changed: true, where: [] } }) });
  const ctx = await mount(mod, { state: { page: { path: '/content/samsung/lb/india/backup/ac', title: 'AC' } } });
  H.btn(ctx, 'Show versions').click();
  await H.until(() => H.shown(ctx).includes('no longer matches version 2'));

  has(ctx, 'no longer matches version 2', 'it says the page has moved on');
  has(ctx, 'Undo the changes since version 2', 'the button says undo');
  hasNot(ctx, 'What differs', 'the paths list is gone');
});

test('Versions · a page outside the backup folder is read-only', async () => {
  const mod = await import('/src/ui/screens/versions.js');
  H.tab.reply = async () => ({ ok: true, result: VERSIONS({ page: '/content/samsung/uk/offers/spring-sale' }) });
  const ctx = await mount(mod);
  H.btn(ctx, 'Show versions').click();
  await H.until(() => H.shown(ctx).includes('Listing only'));

  has(ctx, 'Listing only', 'it says it can only list');
  has(ctx, 'Back this page up first', 'it offers the way forward');
  const radio = ctx.view.querySelector('input[type="radio"]');
  expect(radio?.disabled, 'the versions must not be pickable');
});

test('Versions · a page with no versions says so', async () => {
  const mod = await import('/src/ui/screens/versions.js');
  H.tab.reply = async () => ({ ok: true, result: VERSIONS({ neverVersioned: true, versions: [], current: null, currentNumber: null }) });
  const ctx = await mount(mod, { state: { page: { path: '/content/samsung/lb/india/backup/ac', title: 'AC' } } });
  H.btn(ctx, 'Show versions').click();
  await H.until(() => H.shown(ctx).includes('No saved versions'));
  has(ctx, 'No saved versions', 'it says there are none');
});

/* ------------------------------------- Backup and Versions, fixed 2026-11-03 */

test('Versions · a page that could not be compared says so and can still be restored', async () => {
  const mod = await import('/src/ui/screens/versions.js');
  // The worker's shape when readTree fails: changed is null, with the reason.
  const drift = { changed: null, unknown: true, why: 'json.maximumresults', where: [] };
  H.tab.reply = async () => ({ ok: true, result: VERSIONS({ drift }) });
  const ctx = await mount(mod, { state: { page: { path: '/content/samsung/lb/india/backup/ac', title: 'AC' } } });
  H.btn(ctx, 'Show versions').click();
  await H.until(() => H.shown(ctx).includes('Saved versions'));

  has(ctx, 'Could not compare the page with version 2', 'it says the comparison did not run');
  hasNot(ctx, 'Already on version 2', 'not knowing is not "already on it"');
  hasNot(ctx, 'already holds it', 'nor "the page already holds it"');
  const again = H.btn(ctx, 'Restore version 2 again');
  expect(again && !again.disabled, 'the version it sits on can still be restored');
  expect(!H.btn(ctx, 'Save current content as a version')?.disabled, 'and the current content saved');
});

test('Versions · an unconfirmed restore is not headlined as done', async () => {
  const mod = await import('/src/ui/screens/versions.js');
  H.tab.reply = async (m) =>
    m.action === 'list'
      ? { ok: true, result: VERSIONS() }
      : { ok: true, result: { done: true, page: VERSIONS().page, restored: '1.0', restoredNumber: 1, confirmed: false, title: 'Restore not confirmed', why: 'json.maximumresults' } };
  const ctx = await mount(mod, { state: { page: { path: '/content/samsung/lb/india/backup/ac', title: 'AC' } } });
  H.btn(ctx, 'Show versions').click();
  await H.until(() => H.shown(ctx).includes('Saved versions'));
  H.tick(ctx.view.querySelector('input[aria-label="Version 1"]'), true);
  await H.until(() => H.btn(ctx, 'Restore version 1'));
  H.btn(ctx, 'Restore version 1').click();
  await H.until(() => H.btn(ctx, 'Restore this version'));
  H.btn(ctx, 'Restore this version').click();
  await H.until(() => H.shown(ctx).includes('Restore not confirmed'));

  hasNot(ctx, 'back to version 1', 'it must not claim the page is back');
  expect(!ctx.view.querySelector('.notice[data-tone="ok"]'), 'no green notice heads it');
  has(ctx, 'Open the page and check', 'it says what to do');
});

test('Versions · the save-first step moves when the worker reports it', async () => {
  const mod = await import('/src/ui/screens/versions.js');
  let finish;
  H.tab.reply = async (m) =>
    m.action === 'list'
      ? { ok: true, result: VERSIONS() }
      : new Promise((r) => {
          finish = () => r({ ok: true, result: { done: true, page: VERSIONS().page, restored: '1.0', restoredNumber: 1, confirmed: true, title: 'Version restored' } });
        });
  const ctx = await mount(mod, { state: { page: { path: '/content/samsung/lb/india/backup/ac', title: 'AC' } } });
  H.btn(ctx, 'Show versions').click();
  await H.until(() => H.shown(ctx).includes('Saved versions'));
  H.tick(ctx.view.querySelector('input[aria-label="Version 1"]'), true);
  await H.until(() => H.btn(ctx, 'Restore version 1'));
  H.btn(ctx, 'Restore version 1').click();
  await H.until(() => H.btn(ctx, 'Restore this version'));
  H.btn(ctx, 'Restore this version').click();
  await H.until(() => finish && H.shown(ctx).includes('Saving the current content first'));

  // The id page-versions/worker.js sends for this step.
  H.report(H.lastRunId(), { id: 'save', state: 'done', note: 'skipped' });
  await H.until(() => H.shown(ctx).includes('skipped'));
  has(ctx, 'skipped', 'the step shows what the worker said about it');
  finish();
  await H.until(() => H.shown(ctx).includes('Version restored'));
});

test('Versions · a failed restore reads the versions again', async () => {
  const mod = await import('/src/ui/screens/versions.js');
  let lists = 0;
  H.tab.reply = async (m) => {
    if (m.action === 'list') {
      lists++;
      // The second read finds the page moved: the restore landed, then its check failed.
      return { ok: true, result: lists === 1 ? VERSIONS() : VERSIONS({ drift: { changed: true, where: [] } }) };
    }
    return { ok: false, error: 'AEM said version 1 was restored, but the page does not hold that version.', aborted: true };
  };
  const ctx = await mount(mod, { state: { page: { path: '/content/samsung/lb/india/backup/ac', title: 'AC' } } });
  H.btn(ctx, 'Show versions').click();
  await H.until(() => H.shown(ctx).includes('Saved versions'));
  H.tick(ctx.view.querySelector('input[aria-label="Version 1"]'), true);
  await H.until(() => H.btn(ctx, 'Restore version 1'));
  H.btn(ctx, 'Restore version 1').click();
  await H.until(() => H.btn(ctx, 'Restore this version'));
  H.btn(ctx, 'Restore this version').click();
  await H.until(() => lists === 2 && H.shown(ctx).includes('no longer matches version 2'));

  has(ctx, 'does not hold that version', 'the failure is still said');
  has(ctx, 'no longer matches version 2', 'the list drawn is the one read after the failure');
});

test('Versions · india/backup deeper in a live path is not a backup page', async () => {
  const mod = await import('/src/ui/screens/versions.js');
  H.tab.reply = async () => ({ ok: true, result: VERSIONS({ page: '/content/samsung/lb/promo/india/backup/ac' }) });
  const ctx = await mount(mod, { state: { page: { path: '/content/samsung/lb/promo/india/backup/ac', title: 'AC' } } });
  H.btn(ctx, 'Show versions').click();
  await H.until(() => H.shown(ctx).includes('Saved versions'));
  has(ctx, 'Listing only', 'the worker would refuse to write here, so the screen does not offer it');
});

test('Backup · a global page asks for its target site before it can be analysed', async () => {
  const mod = await import('/src/ui/screens/backup.js');
  H.tab.sent.length = 0;
  H.tab.reply = async () => ({ ok: true, result: BACKUP({ source: '/content/samsung/global/hq/vd/tvs/x', dest: '/content/samsung/levant/india/backup/tvs/x' }) });
  const ctx = await mount(mod, { state: { page: { path: '/content/samsung/global/hq/vd/tvs/x', title: 'X' } } });

  const site = H.input(ctx, 'Target site');
  expect(site && !site.closest('.field').hidden, 'a global page shows the Target site field');
  expect(H.btn(ctx, 'Analyze paths')?.disabled, 'Analyze waits for a site the worker will accept');
  has(ctx, 'Type the site', 'Goes to says what is missing, not a path the worker would refuse');
  hasNot(ctx, '/content/samsung/global/india/backup', 'it never shows a backup inside /global');

  H.setValue(site, 'levant');
  await H.until(() => !H.btn(ctx, 'Analyze paths')?.disabled);
  has(ctx, '/content/samsung/levant/india/backup/tvs/x', 'Goes to shows the path the worker will build');
  H.btn(ctx, 'Analyze paths').click();
  await H.until(() => H.tab.sent.some((m) => m.action === 'analyze'));
  expect(H.tab.sent.find((m) => m.action === 'analyze').params?.targetSite === 'levant', 'the site typed goes to the worker');

  const local = await mount(mod);
  expect(H.input(local, 'Target site')?.closest('.field').hidden, 'any other page hides it');
});

test('Backup · progress counts only the pages it writes', async () => {
  const mod = await import('/src/ui/screens/backup.js');
  let finish;
  H.tab.reply = async (m) =>
    m.action === 'analyze'
      ? { ok: true, result: BACKUP() }
      : new Promise((r) => {
          finish = () => r({ ok: true, result: { ...BACKUP(), done: true } });
        });
  const ctx = await mount(mod);
  H.btn(ctx, 'Analyze paths').click();
  await H.until(() => H.btn(ctx, 'Create the backup'));
  H.btn(ctx, 'Create the backup').click();
  await H.until(() => finish && H.shown(ctx).includes('pages written'));

  // The worker passes the pages already there with a done step of their own.
  const run = H.lastRunId();
  H.report(run, { path: '/content/samsung/levant', state: 'done' });
  H.report(run, { path: '/content/samsung/levant/india', state: 'done' });
  H.report(run, { path: '/content/samsung/levant/india/backup', state: 'done' });
  await H.settle(20);
  has(ctx, 'of 1 pages written', 'the total is the pages written');
  expect(ctx.view.querySelector('.big-n')?.textContent === '0', 'pages passed over are not counted as written');
  H.report(run, { path: '/content/samsung/levant/india/backup/tvs', state: 'done' });
  await H.until(() => ctx.view.querySelector('.big-n')?.textContent === '1');
  finish();
  await H.until(() => H.shown(ctx).includes('Backup ready'));
});

test('Backup · done says where it went and only what was checked', async () => {
  const mod = await import('/src/ui/screens/backup.js');
  H.tab.reply = async (m) =>
    m.action === 'analyze' ? { ok: true, result: BACKUP() } : { ok: true, result: { ...BACKUP(), done: true } };
  const ctx = await mount(mod);
  H.btn(ctx, 'Analyze paths').click();
  await H.until(() => H.btn(ctx, 'Create the backup'));
  H.btn(ctx, 'Create the backup').click();
  await H.until(() => H.shown(ctx).includes('Backup ready'));

  has(ctx, 'Where it went', 'it says where it went');
  has(ctx, '/content/samsung/levant/india/backup/tvs', 'with the backup path itself');
  hasNot(ctx, 'Every row was read back', 'it does not claim checks the worker does not make');
  has(ctx, 'with its content and the source', 'it says what the read-back did check');
});

/* ============================================================ Copy a page */

test('Copy a page · this server: analyze, confirm, run, result', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  H.tab.reply = async (m) =>
    m.action === 'analyze'
      ? { ok: true, result: CP() }
      : { ok: true, result: { ...CP(), done: true, title: 'Page copied' } };
  const ctx = await mount(mod);

  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  await H.settle(20);
  H.btn(ctx, 'Analyze').click();
  await H.until(() => H.shown(ctx).includes('What will happen, in this or'));

  has(ctx, 'What will happen, in this order', 'the plan is listed');
  H.btn(ctx, 'Continue to copy').click();
  await H.settle(20);
  has(ctx, 'Copy this page to', 'the confirm step restates it');
  H.btn(ctx, 'Copy page').click();
  await H.until(() => H.shown(ctx).includes('What happened'));
  has(ctx, 'What happened', 'the result says what happened');
});

/* Shaped like page-upsert's `components` action: both pages' components in page order. */
const PARTS = () => ({
  source: {
    page: '/content/samsung/uk/a',
    title: 'A',
    components: [
      { rel: '/root/responsivegrid', name: 'responsivegrid', resourceType: 'wcm/foundation/components/responsivegrid', type: 'responsivegrid', headline: null, depth: 0, container: true, title: 'Layout Container' },
      { rel: '/root/responsivegrid/feature', name: 'feature', resourceType: 'samsung/components/feature', type: 'feature', headline: 'What is Mini LED?', depth: 1, container: false, title: 'FT02_Feature Benefit' }
    ]
  },
  dest: {
    page: '/content/samsung/lb/a',
    title: 'A',
    components: [
      { rel: '/root/responsivegrid', name: 'responsivegrid', resourceType: 'wcm/foundation/components/responsivegrid', type: 'responsivegrid', headline: null, depth: 0, container: true, title: 'Layout Container' },
      { rel: '/root/responsivegrid/text_1', name: 'text_1', resourceType: 'samsung/components/text', type: 'text', headline: 'Second', depth: 1, container: false, title: 'Text Block' }
    ]
  }
});
const COMPONENT = { from: '/root/responsivegrid/feature', to: '/root/responsivegrid/feature', name: 'feature', renamed: false, container: '/root/responsivegrid', before: '/root/responsivegrid/text_1', into: null, resourceType: 'samsung/components/feature', nodes: 2 };

test('Copy a component · choose it, place it, review, copy', async () => {
  const mod = await import('/src/ui/screens/copy-component.js');
  H.tab.sent = [];
  H.tab.reply = async (m) =>
    m.action === 'components'
      ? { ok: true, result: PARTS() }
      : m.action === 'analyze'
        ? { ok: true, result: CP({ component: COMPONENT }) }
        : { ok: true, result: { ...CP({ component: COMPONENT }), done: true } };
  const ctx = await mount(mod, { state: { page: { path: '/content/samsung/uk/a', title: 'A' } } });

  await H.until(() => H.btn(ctx, 'Choose the component'));
  hasNot(ctx, 'Remove components that no longer exist', 'the whole-page removal box is not offered');
  expect(H.btn(ctx, 'This server')?.getAttribute('aria-pressed') === 'true', 'it starts on this server');
  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  await H.settle(20);
  /* Before the components are read, the footer's own button reads them - it is
     the one H.btn finds first - rather than standing there as a greyed-out Analyze. */
  const footerBtn = ctx.footer.querySelector('button');
  expect(/Choose the component/.test(footerBtn.textContent) && !footerBtn.disabled, `the footer offers to read the components: ${footerBtn.textContent}`);
  expect(!H.btn(ctx, 'Analyze'), 'Analyze is not offered before there is a component to analyze');
  const same = [...ctx.view.querySelectorAll('button'), ...ctx.footer.querySelectorAll('button')].filter((b) => /Choose the component/.test(b.textContent));
  expect(same.length === 1, `one button reads the components, not ${same.length}`);

  footerBtn.click();
  await H.until(() => ctx.view.querySelector('select[aria-label="Component to copy"]'));
  const pick = (aria, value) => {
    const sel = ctx.view.querySelector(`select[aria-label="${aria}"]`);
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };
  has(ctx, 'FT02_Feature Benefit · What is Mini LED?', 'components are named as the editor names them, with their headline');
  expect(H.btn(ctx, 'Analyze')?.disabled, 'once read, the footer is Analyze, waiting for a pick');
  pick('Component to copy', '/root/responsivegrid/feature');
  expect(H.btn(ctx, 'Analyze').disabled, 'nor before where it goes');
  pick('Put it above', 'before:/root/responsivegrid/text_1');
  expect(!H.btn(ctx, 'Analyze').disabled, 'with both, it can be analyzed');

  H.btn(ctx, 'Analyze').click();
  await H.until(() => H.shown(ctx).includes('Goes'));
  const analyze = H.tab.sent.find((m) => m.action === 'analyze');
  expect(
    analyze.params.component?.from === '/root/responsivegrid/feature' && analyze.params.component?.before === '/root/responsivegrid/text_1',
    `the analysis is asked for that component and place: ${JSON.stringify(analyze.params.component)}`
  );
  expect(analyze.feature === 'component-copy', `and of its own feature, not Copy a page's: ${analyze.feature}`);
  has(ctx, 'above Text Block · Second', 'the review says where it goes');

  H.btn(ctx, 'Continue to copy').click();
  await H.until(() => H.btn(ctx, 'Copy component'));
  has(ctx, 'Add this component to a?', 'the confirmation is about a component, not the page');
  H.btn(ctx, 'Copy component').click();
  const run = await H.until(() => H.tab.sent.find((m) => m.action === 'run'));
  expect(run.params.component?.from === '/root/responsivegrid/feature', 'the write carries the component');
  await H.until(() => H.shown(ctx).includes('Component copied'));
  has(ctx, 'Nothing else on the page was changed', 'the done step says what it did');
});

test('Copy a component · from another server: each server lists its own page, and the copy goes through the transfer', async () => {
  const mod = await import('/src/ui/screens/copy-component.js');
  const AP = 'https://p6-ap-author.samsung.com';
  const EU = 'https://p6-eu-author.samsung.com';
  /* The two servers' tabs: this one (1) on AP, and one (2) on EU. */
  const realQuery = chrome.tabs.query;
  chrome.tabs.query = async (q) =>
    q?.url?.startsWith(EU) ? [{ id: 2, url: `${EU}/`, title: 'eu' }] : [{ id: 1, url: `${AP}/editor.html/content/samsung/uk/a.html`, title: 'A' }];
  try {
    H.tab.sent = [];
    H.tab.reply = async (m, tabId) => {
      if (m.feature !== 'page-transfer') return { ok: false, error: `asked ${m.feature}, not the transfer` };
      if (m.action === 'components') return { ok: true, result: tabId === 1 ? PARTS().source : PARTS().dest };
      if (m.action === 'readPage') return { ok: true, result: { source: '/content/samsung/uk/a', tree: {}, order: {}, assets: [] } };
      if (m.action === 'analyze') return { ok: true, result: CP({ component: COMPONENT }) };
      return { ok: true, result: null };
    };
    const ctx = await mount(mod, {
      state: { page: { path: '/content/samsung/uk/a', title: 'A' }, origin: AP, settings: { origins: [AP, EU], rootDepth: 3, backupFolder: 'india/backup' } }
    });
    H.btn(ctx, 'Another server').click();
    await H.until(() => ctx.view.querySelector('select[aria-label="Destination server"]'));
    has(ctx, 'It must already exist on that server', 'the destination page must be there already');
    const dst = ctx.view.querySelector('select[aria-label="Destination server"]');
    dst.value = EU;
    dst.dispatchEvent(new Event('change', { bubbles: true }));
    await H.settle(20);
    H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
    await H.settle(20);

    H.btn(ctx, 'Choose the component').click();
    await H.until(() => ctx.view.querySelector('select[aria-label="Component to copy"]'));
    const lists = H.tab.sent.filter((m) => m.action === 'components');
    expect(
      lists.length === 2 && lists.find((m) => m.tabId === 1)?.params.page === '/content/samsung/uk/a' && lists.find((m) => m.tabId === 2)?.params.page === '/content/samsung/lb/a',
      `each server is asked for its own page: ${JSON.stringify(lists.map((m) => [m.tabId, m.params.page]))}`
    );
    has(ctx, 'FT02_Feature Benefit · What is Mini LED?', 'the source server’s components are listed');
    const pick = (aria, value) => {
      const sel = ctx.view.querySelector(`select[aria-label="${aria}"]`);
      sel.value = value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    pick('Component to copy', '/root/responsivegrid/feature');
    pick('Put it above', 'before:/root/responsivegrid/text_1');
    H.btn(ctx, 'Analyze').click();
    await H.until(() => H.shown(ctx).includes('Goes'));
    const read = H.tab.sent.find((m) => m.action === 'readPage');
    expect(read?.tabId === 1 && read.params.component?.from === '/root/responsivegrid/feature', 'the source server reads only the component');
    const analyze = H.tab.sent.find((m) => m.action === 'analyze');
    expect(
      analyze?.tabId === 2 && analyze.params.component?.before === '/root/responsivegrid/text_1',
      `the destination server plans it, with its place: ${JSON.stringify(analyze?.params.component)}`
    );
    has(ctx, 'above Text Block · Second', 'the review says where it goes');
  } finally {
    chrome.tabs.query = realQuery;
  }
});

test('Copy a component · a tab that lists nothing is said in words, not as a null read', async () => {
  const mod = await import('/src/ui/screens/copy-component.js');
  H.tab.reply = async () => ({ ok: true, result: null });
  const ctx = await mount(mod, { state: { page: { path: '/content/samsung/uk/a', title: 'A' } } });
  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  await H.settle(20);
  H.btn(ctx, 'Choose the component').click();
  await H.until(() => H.shown(ctx).includes('That did not work'));
  has(ctx, 'did not list the components', 'the reason is plain');
  hasNot(ctx, 'Cannot read properties', 'no script error reaches the screen');
});

test('Copy a page · copies whole pages only: the component tool is its own', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  const ctx = await mount(mod);
  expect(!H.btn(ctx, 'One component'), 'no component choice on Copy a page');
  expect(!H.btn(ctx, 'Choose the component'), 'and no component picker');
  has(ctx, 'Remove components that no longer exist', 'it copies the whole page');
  const { TOOLS } = await import('/src/ui/tools.js');
  const tool = TOOLS.find((t) => t.id === 'copy-component');
  expect(tool?.title === 'Copy a component' && tool.features.join() === 'component-copy', 'Copy a component has its own home row and feature');
});

test('Copy a page · the two confirmations hold the run back', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  H.tab.reply = async () => ({
    ok: true,
    result: CP({
      largeRemoval: '20 components would go.',
      counts: { ...CP().counts, nodesDeleted: 20 },
      metadata: { props: ['ogTitle'] }
    })
  });
  const ctx = await mount(mod);
  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  await H.settle(20);
  H.btn(ctx, 'Analyze').click();
  await H.until(() => H.btn(ctx, 'Tick the box above'));

  expect(H.btn(ctx, 'Tick the box above')?.disabled, 'the removals box holds it');
  H.tick(ctx.view.querySelector('input[aria-label*="delete these from the destination page"]'), true);
  await H.settle(40);

  /* Losing components still holds the run. The destination's own page
     properties do not: leaving that box alone keeps them and copies the rest,
     which is a choice someone makes, not a mistake to be stopped. */
  expect(!!H.btn(ctx, 'Continue to copy'), 'the page properties box does not hold it');
  has(ctx, 'Optional', 'and it says so in as many words');
  H.tick(ctx.view.querySelector('input[aria-label*="Overwrite these"]'), true);
  await H.settle(40);
  expect(!!H.btn(ctx, 'Continue to copy'), 'and it can still go on, either way');
});

test('Copy a page \u00b7 leaving the page properties alone still sends the copy', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  H.tab.sent = [];
  H.tab.reply = async (m) =>
    m.action === 'analyze'
      ? {
          ok: true,
          result: CP({
            metadata: {
              props: ['canonical', 'redirectTarget'],
              rows: [
                { prop: 'canonical', now: 'https://www.samsung.com/lb/x', would: 'https://www.samsung.com/uk/x' },
                { prop: 'redirectTarget', now: '/lb/y', would: undefined }
              ]
            }
          })
        }
      : { ok: true, result: { done: true } };
  const ctx = await mount(mod);
  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  await H.settle(20);
  H.btn(ctx, 'Analyze').click();
  await H.until(() => H.btn(ctx, 'Continue to copy'));

  has(ctx, 'canonical', 'the properties are named');
  /* Both values, so the box is a decision about addresses rather than about
     the word "overwritten". */
  has(ctx, 'www.samsung.com/lb/x', "the destination's own value is shown");
  has(ctx, 'www.samsung.com/uk/x', "and the source's beside it");
  has(ctx, '(cleared)', 'a property the source does not have says what ticking would do');

  const winner = () =>
    [...ctx.view.querySelectorAll('.meta-val[data-wins="true"] .meta-text')].map((n) => n.textContent);
  expect(winner().includes('https://www.samsung.com/lb/x'), "unticked, the destination's value wins");

  H.tick(ctx.view.querySelector('input[aria-label*="Overwrite these"]'), true);
  await H.settle(40);
  expect(winner().includes('https://www.samsung.com/uk/x'), "ticked, the source's value wins");
  H.tick(ctx.view.querySelector('input[aria-label*="Overwrite these"]'), false);
  await H.settle(40);

  H.btn(ctx, 'Continue to copy').click();
  await H.until(() => H.btn(ctx, 'Copy page'));
  H.btn(ctx, 'Copy page').click();

  const write = await H.until(() => H.tab.sent.find((x) => x.action === 'run'));
  expect(!!write, 'the write must be sent');
  expect(!write.params.metadataAck, 'with no acknowledgement, which is what keeps them');
});

test('Copy a page · the write carries both acknowledgements', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  H.tab.sent = [];
  H.tab.reply = async (m) =>
    m.action === 'analyze'
      ? { ok: true, result: CP({ largeRemoval: 'lots', counts: { ...CP().counts, nodesDeleted: 20 }, metadata: { props: ['ogTitle'] }, props: { deleted: [{ node: '/root/responsivegrid/text_1', prop: 'headline', was: 'Old', reason: 'absent at source' }] } }) }
      : { ok: true, result: { done: true } };
  const ctx = await mount(mod);
  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  await H.settle(20);
  H.btn(ctx, 'Analyze').click();
  // The box itself, not the absence of the run screen: that is true before the analysis has even started.
  await H.until(() => ctx.view.querySelector('input[aria-label*="delete these from the destination page"]'), { ms: 4000 });
  H.tick(ctx.view.querySelector('input[aria-label*="delete these from the destination page"]'), true);
  await H.settle(30);
  H.tick(ctx.view.querySelector('input[aria-label*="Overwrite these"]'), true);
  await H.settle(30);
  H.btn(ctx, 'Continue to copy').click();
  await H.until(() => H.btn(ctx, 'Copy page'));
  H.btn(ctx, 'Copy page').click();

  const write = await H.until(() => H.tab.sent.find((s) => s.action === 'run'));
  expect(!!write, 'the write must be sent');
  expect(write.params.removalsAck?.fingerprint === 'fp', 'the removals fingerprint must be sent');
  expect(write.params.metadataAck?.props?.includes('ogTitle'), 'the metadata names must be sent');
  /* Unticked to start with, and nobody ticked it: writing a second page is
     a decision someone makes, not what happens by leaving a box alone. */
  expect(write.params.backupFirst === false, 'the backup choice must be sent as given');
  expect('keepSiteValues' in write.params, 'the site values choice must be sent');
});

test('Copy a page · a blocker stops it', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  H.tab.reply = async () => ({ ok: true, result: CP({ blockers: ['The destination parent does not exist.'] }) });
  const ctx = await mount(mod);
  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  await H.settle(20);
  H.btn(ctx, 'Analyze').click();
  await H.until(() => H.shown(ctx).includes('This cannot run'));

  has(ctx, 'This cannot run', 'it says it cannot run');
  has(ctx, 'destination parent does not exist', 'and why');
  expect(H.btn(ctx, 'Continue to copy')?.disabled, 'the way on must be closed');
});

test('Copy a page · another server starts from the page open in this tab', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  H.tab.reply = async () => ({ ok: true, result: CP() });
  const two = ['https://p6-ap-author.samsung.com', 'https://p6-eu-author.samsung.com'];
  const ctx = await mount(mod, { state: { settings: { origins: two, rootDepth: 3, backupFolder: 'india/backup' } } });

  H.btn(ctx, 'Another server').click();
  await H.until(() => ctx.view.querySelector('select[aria-label="Source server"]'));

  const src = ctx.view.querySelector('select[aria-label="Source server"]');
  const dst = ctx.view.querySelector('select[aria-label="Destination server"]');

  /* The page you are looking at is the one being copied, so this tab is the
     source. Where it goes is the one thing only you can say. */
  expect(src.value === 'https://p6-ap-author.samsung.com', "the source is this tab's instance");
  expect(
    H.input(ctx, 'Source page').value === '/content/samsung/uk/offers/spring-sale',
    "the tab's page stays as the source"
  );
  expect(dst.value === '', 'the destination instance is left for you to choose');
  has(ctx, 'Choose an instance', 'the unchosen menu says so');
});

/* The standing warning about 1 November was taken off the screen on purpose;
   the two guards in the engine are what stop that plan now. */
test('Copy a page · a copy between servers can be started', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  const two = ['https://p6-ap-author.samsung.com', 'https://p6-eu-author.samsung.com'];
  const ctx = await mount(mod, { state: { settings: { origins: two, rootDepth: 3, backupFolder: 'india/backup' } } });
  H.btn(ctx, 'Another server').click();
  await H.until(() => ctx.view.querySelector('select[aria-label="Destination server"]'));

  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  const dst = ctx.view.querySelector('select[aria-label="Destination server"]');
  dst.value = 'https://p6-eu-author.samsung.com';
  dst.dispatchEvent(new Event('change', { bubbles: true }));
  await H.until(() => H.btn(ctx, 'Analyze') && !H.btn(ctx, 'Analyze').disabled);
  expect(!H.btn(ctx, 'Analyze').disabled, 'and it can be started');
});

test('Copy a page · copying within one server still runs', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  H.tab.reply = async () => ({ ok: true, result: CP() });
  const ctx = await mount(mod);
  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  await H.until(() => H.btn(ctx, 'Analyze') && !H.btn(ctx, 'Analyze').disabled);
  expect(!H.btn(ctx, 'Analyze').disabled, 'this server is unaffected');
});

test('Copy a page · an image still on Dynamic Media shows where to get it', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  H.tab.reply = async () => ({
    ok: true,
    result: CP({
      imagesByHand: [
        {
          kind: 'delivered',
          from: '/content/dam/samsung/ae/mobile-phone-buying-guide/compare/kv.jpg',
          to: '/content/dam/samsung/lb/mobile-phone-buying-guide/compare/kv.jpg',
          reason: 'Not in the source DAM, but Dynamic Media still serves it.',
          urls: [
            { name: 'live', url: 'https://images.samsung.com/is/image/samsung/assets/ae/mobile-phone-buying-guide/compare/kv.jpg' },
            { name: 'staging', url: 'https://stg-images.samsung.com/is/image/samsung/assets/ae/mobile-phone-buying-guide/compare/kv.jpg' }
          ]
        }
      ]
    })
  });
  const ctx = await mount(mod);
  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  await H.settle(20);
  H.btn(ctx, 'Analyze').click();
  await H.until(() => H.shown(ctx).includes('to do by hand'));

  has(ctx, 'Dynamic Media still serves it', 'the reason is given');
  const links = [...ctx.view.querySelectorAll('a.byhand-link')].map((a) => a.href);
  expect(links.some((u) => u.includes('images.samsung.com/is/image/samsung/assets/')), 'the live delivery URL is offered');
  expect(links.some((u) => u.includes('stg-images.samsung.com')), 'the staging one too');
});

/* A review or result put straight on screen, as the transfer leaves it: the
   two-tab flow itself is not stubbed here, and these are about what is drawn. */
const transferAt = (phase, extra) => ({
  phase,
  where: 'another',
  source: '/content/samsung/uk/a',
  dest: '/content/samsung/lb/a',
  sourceOrigin: 'https://p6-eu-author.samsung.com',
  destOrigin: 'https://p6-ap-author.samsung.com',
  keepSites: [],
  siteValues: true,
  steps: [],
  ...extra
});

/* page-transfer's own shape: it counts images to carry as `uploads`, not `assetsToCopy`. */
const CPX = (over = {}) =>
  CP({ mode: 'sync', counts: { links: 2, properties: 9, uploads: 2, nodesAdded: 0, nodesDeleted: 0 }, ...over });

test('Copy a page · images carried between servers are counted, not shown as 0', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  const ctx = await mount(mod, { own: transferAt('review', { summary: CPX() }) });
  const images = [...ctx.view.querySelectorAll('.count')].find((t) => t.textContent.includes('images'));
  expect(images?.querySelector('.count-n')?.textContent === '2', `the review counts 2 images, got ${images?.textContent}`);

  const done = await mount(mod, { own: transferAt('done', { result: { ...CPX(), done: true } }) });
  has(done, 'Images uploaded', 'the result says images went across');
  has(done, '2 of 2', 'and how many');
});

test('Copy a page · the review names what will be removed', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  const summary = CPX({
    largeRemoval: 'This would remove 1 of the 4 components here and leave 2 more standing with nothing in them.',
    counts: { ...CPX().counts, nodesDeleted: 1 },
    nodes: { deleted: [{ node: '/root/responsivegrid/faq_schema', content: 'x' }], emptied: [{ node: '/root/responsivegrid/text_1' }] },
    props: {
      deleted: [
        { node: '/root/responsivegrid/text_1', prop: 'headline', was: 'Big savings', reason: 'absent at source' },
        { node: '/root/responsivegrid/text_1', prop: 'body', was: 'Copy', reason: 'absent at source' },
        { node: '(page properties)', prop: 'redirectTarget', was: '/lb/x', reason: 'absent at source', metadata: true }
      ]
    }
  });
  const ctx = await mount(mod, { own: transferAt('review', { summary }) });
  has(ctx, 'What will be removed', 'the removals have their own list');
  has(ctx, 'faq_schema', 'the component going is named');
  has(ctx, 'Left with nothing in it', 'an emptied component is said as that');
  has(ctx, 'headline, body', 'with the properties going from it');
  const list = [...ctx.view.querySelectorAll('.list')].find((l) => l.textContent.includes('What will be removed'));
  expect(!list.textContent.includes('redirectTarget'), 'a page property is left to its own box');
});

test('Copy a page · a write that did not all land says so, never that it matches', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  const result = {
    ...CPX(),
    done: true,
    unconfirmed: { checked: 20, holding: 2, missing: ['/root/responsivegrid/text_0 headline (not written)'], more: 17 }
  };
  const ctx = await mount(mod, { own: transferAt('done', { result }) });
  has(ctx, 'not all of it is on the page', 'it is a warning');
  has(ctx, '2 of the 20', 'with how much holds');
  has(ctx, 'text_0 headline', 'and what did not');
  hasNot(ctx, 'now matches the source', 'and it never claims a match');
});

/* =========================================================== Copy deck */

test('Copy deck · the chooser offers both halves with what each does', async () => {
  const mod = await import('/src/ui/screens/copy-deck.js');
  const ctx = await mount(mod);
  expect(H.btn(ctx, 'Export'), 'the export is offered');
  expect(H.btn(ctx, 'Import translations'), 'the import is offered');
  has(ctx, 'Read-only · nothing is written', 'the export is marked as a read');
  has(ctx, 'Changes AEM after you confirm', 'the import is marked as a write');
});

/** The export, read and on its review. */
async function deckReview(result = DECK()) {
  const mod = await import('/src/ui/screens/copy-deck.js');
  H.tab.reply = async () => ({ ok: true, result });
  const ctx = await mount(mod);
  H.btn(ctx, 'Export').click();
  await H.until(() => H.btn(ctx, 'Review'));
  H.btn(ctx, 'Review').click();
  await H.until(() => H.shown(ctx).includes('What goes on the sheet'));
  return ctx;
}

test('Copy deck export · read, review the groups, build the sheet', async () => {
  const ctx = await deckReview();
  expect(H.tab.sent.at(-1)?.action === 'read', 'the export asks the worker to read, nothing else');
  has(ctx, 'What goes on the sheet', 'the groups are offered');
  has(ctx, 'Headlines & body copy', 'the real group names are used');
  has(ctx, 'Also include text not shown on the page', 'the hidden text is offered');
  has(ctx, 'Components', 'the components are listed');
  has(ctx, 'Excel rows', 'the counts are there');

  H.btn(ctx, 'Build the sheet').click();
  await H.until(() => H.shown(ctx).includes('sheet is ready'));
  has(ctx, 'Download Excel', 'Excel is offered');
  has(ctx, 'Copy for Excel', 'the clipboard is offered');
  has(ctx, 'Download CSV', 'CSV is offered');
  has(ctx, 'Nothing is written to AEM', 'it says it writes nothing');
  hasNot(ctx, 'too long', 'a sheet that fits says nothing about length');
});

test('Copy deck export · excluding every component closes the way on', async () => {
  const ctx = await deckReview();
  H.btn(ctx, 'Exclude all').click();
  await H.until(() => H.btn(ctx, 'Build the sheet')?.disabled);
  expect(H.btn(ctx, 'Build the sheet')?.disabled, 'with nothing selected there is no sheet to build');
});

test('Copy deck export · one text too long for Excel is left off and named, not the whole sheet', async () => {
  const long = DECK_ROW('root/hero@disclaimer', '01 · Hero', 1, 'disclaimer', 'Disclaimer', 'root/hero', 'disclaimer', 'Terms apply. '.repeat(2600));
  const ctx = await deckReview(DECK({ rows: [...DECK().rows, long] }));
  H.btn(ctx, 'Build the sheet').click();
  await H.until(() => H.shown(ctx).includes('sheet is ready'));
  has(ctx, 'too long for Excel', 'the text left off is called out');
  has(ctx, '01 · Hero › Disclaimer', 'by where it is on the page');
  has(ctx, '33,800 characters', 'with how long it is');
  expect(H.btn(ctx, 'Download Excel') && !H.btn(ctx, 'Download Excel').disabled, 'and the rest of the sheet can still be saved');
  const texts = [...ctx.view.querySelectorAll('.kv')].find((k) => k.firstChild?.textContent === 'Texts');
  expect(texts?.querySelector('.kv-value')?.textContent === '3', 'the texts on the sheet do not count it');
});

/** Open a section of the review by its name: they start folded. */
async function openSection(ctx, name, then) {
  [...ctx.view.querySelectorAll('.sec-open')].find((n) => n.textContent.includes(name)).click();
  await H.until(() => H.shown(ctx).includes(then));
}

/** The import, the sheet pasted, the check answered. */
async function imported(reply, sheet = PASTED) {
  const mod = await import('/src/ui/screens/copy-deck.js');
  H.tab.reply = reply;
  const ctx = await mount(mod);
  H.btn(ctx, 'Import translations').click();
  await H.until(() => H.input(ctx, 'Paste the translated sheet'));
  H.setValue(H.input(ctx, 'Paste the translated sheet'), sheet);
  await H.until(() => !H.btn(ctx, 'Check the translation')?.disabled);
  H.btn(ctx, 'Check the translation').click();
  return ctx;
}

test('Copy deck import · paste, check, confirm, write', async () => {
  let release = null;
  const held = new Promise((r) => {
    release = r;
  });
  const ctx = await imported(async (m) => {
    if (m.action === 'check') return { ok: true, result: IMP() };
    /* The worker's own step reports, in its own ids (copy-deck-import/worker.js). */
    H.report(m.runId, { id: 'recheck', state: 'done', note: '1' });
    H.report(m.runId, { id: 'lock', state: 'done', note: 'not locked' });
    H.report(m.runId, { id: 'write', state: 'running' });
    await held;
    return { ok: true, result: WRITTEN(1) };
  });
  await H.until(() => H.shown(ctx).includes('Needs attention'));
  expect(H.tab.sent.at(-1)?.action === 'check', 'the check is a check');
  await openSection(ctx, 'Needs attention', 'Not on this page');

  has(ctx, 'Needs attention', 'the rows that stop something gather at the end');
  has(ctx, 'Not on this page', 'the real status wording is used');
  has(ctx, '1 · Hero', 'the rows sit under the component they belong to');
  H.btn(ctx, 'Write 1 translation').click();
  await H.until(() => H.shown(ctx).includes('This will change content in AEM'));
  H.btn(ctx, 'Write 1 translation').click();

  /* The steps move as the worker reports them - not stuck on the first. */
  const step = (name) => [...ctx.view.querySelectorAll('.run-step')].find((s) => s.textContent.includes(name));
  await H.until(() => step('Writing the translations')?.dataset.state === 'running');
  expect(step('Checking the page has not moved on')?.dataset.state === 'done', 'the re-check shows done');
  expect(step('Checking nobody else has the page locked')?.dataset.state === 'done', 'the lock check shows done');
  has(ctx, '1 value', 'with the count in words');
  expect(step('Reading the page back')?.dataset.state === 'todo', 'and the read-back is still to come');

  release();
  await H.until(() => H.shown(ctx).includes('Translations written'));
  has(ctx, '1 value written to the page', 'the result says what was written');
});

test('Copy deck import · a row shows the texts it is about, not just a status', async () => {
  const ctx = await imported(async () => ({
    ok: true,
    result: IMP({
      rows: [
        IMP_ROW({
          status: 'changed',
          current: 'Big savings this spring',
          sheetSource: 'Big savings',
          translation: 'وفورات',
          message: 'The text on the page changed after the export, so this translation may no longer fit. Export the page again.',
          sheetRow: 7,
          sheetRowNo: 7
        })
      ]
    })
  }));
  await H.until(() => H.shown(ctx).includes('Needs attention'));
  await openSection(ctx, 'Needs attention', 'Big savings this spring');

  /* "The page changed" is not a thing anyone can act on; the two texts are. */
  has(ctx, 'Big savings this spring', "the page's text now");
  has(ctx, 'Big savings', 'and the English the sheet was exported from');
  has(ctx, 'Headline', 'named by its field');
  has(ctx, '#7', 'and the sheet row to find it by');
});

test('Copy deck import · ticking a component keeps the review up', async () => {
  let checks = 0;
  let release = null;
  const held = new Promise((r) => {
    release = r;
  });
  const ctx = await imported(async (m) => {
    if (m.action !== 'check') return { ok: true, result: WRITTEN(0) };
    checks++;
    if (checks === 2) await held;
    return { ok: true, result: IMP() };
  });
  await H.until(() => H.shown(ctx).includes('Sections'));

  const box = () => ctx.view.querySelector('input[aria-label="Write 1 · Hero"]');
  H.tick(box(), false);
  await H.until(() => checks === 2);
  await H.until(() => H.shown(ctx).includes('Checking the page again'));
  has(ctx, 'Sections', 'without leaving the review');
  expect(!box().disabled, 'and the box can still be answered');

  release();
  await H.until(() => !H.shown(ctx).includes('Checking the page again'));
  expect(checks === 2, 'one tick costs one check');
  expect(H.tab.sent.at(-1)?.params?.sections?.length === 0, 'and the check is asked with the box unticked');
});

test('Copy deck import · the rows can be searched and a component folded away', async () => {
  const ctx = await imported(async () => ({
    ok: true,
    result: IMP({
      sections: [{ id: 'Page properties', static: false }, { id: '01 · FT02_Feature Benefit', static: false }],
      selected: ['Page properties', '01 · FT02_Feature Benefit'],
      rows: [
        IMP_ROW({ key: '.@jcr:title', section: 'Page properties', field: 'Page title', category: 'page', current: 'Battery life', translation: 'عمر البطارية' }),
        IMP_ROW({ key: 'root/fb@title', section: '01 · FT02_Feature Benefit', field: 'Headline', current: 'How long does it last', translation: 'كم تدوم', sheetRow: 5, sheetRowNo: 5 })
      ]
    })
  }));
  await H.until(() => H.shown(ctx).includes('Sections'));

  /* Folded to begin with: the sections are listed, their rows opened on asking. */
  for (const name of ['Page properties', 'FT02_Feature Benefit']) {
    [...ctx.view.querySelectorAll('.sec-open')].find((n) => n.textContent.includes(name)).click();
    await H.until(() => H.shown(ctx).includes(name === 'Page properties' ? 'Page title' : 'Headline'));
  }
  has(ctx, 'Page title', 'both components are listed');
  has(ctx, 'Headline', 'including the second one');

  /* Searching narrows the list rather than making it scrollable. */
  H.setValue(ctx.view.querySelector('.imp-search input'), 'headline');
  await H.until(() => !H.shown(ctx).includes('Page title'));
  has(ctx, 'Headline', 'and the one that matches stays');

  H.setValue(ctx.view.querySelector('.imp-search input'), '');
  await H.until(() => H.shown(ctx).includes('Page title'));

  /* Folding a component hides its rows, not its tick box. */
  [...ctx.view.querySelectorAll('.sec-open')].find((n) => n.textContent.includes('Page properties')).click();
  await H.until(() => !H.shown(ctx).includes('Page title'));
  expect(!!ctx.view.querySelector('input[aria-label="Write Page properties"]'), 'its tick box stays');
  has(ctx, 'Page properties', 'and so does its name');
});

test('Copy deck import · a sheet from another page is called out', async () => {
  const ctx = await imported(async () => ({ ok: true, result: IMP({ exportedFrom: '/content/samsung/uk/a' }) }));
  await H.until(() => H.shown(ctx).includes('came from another page'));
  has(ctx, '/content/samsung/uk/a', 'naming the page it came from');
});

test('Copy deck import · nothing to write closes the way on', async () => {
  const ctx = await imported(async () => ({ ok: true, result: IMP({ writes: [], offered: [], rows: [IMP().rows[1]] }) }));
  await H.until(() => H.btn(ctx, 'Nothing to write'));
  expect(H.btn(ctx, 'Nothing to write')?.disabled, 'with nothing to write there is nothing to confirm');
});

test('Copy deck import · a refused check says why and stays put', async () => {
  const ctx = await imported(async () => ({ ok: false, error: 'This copy deck is from a product page (PD).' }));
  await H.until(() => H.shown(ctx).includes('product page'));
  has(ctx, 'product page', "the worker's reason is shown");
  has(ctx, 'Check the translation', 'it stays where it can be tried again');
});

test('Copy deck import · a sheet that cannot be read gets the reason, not a tick', async () => {
  const mod = await import('/src/ui/screens/copy-deck.js');
  H.tab.reply = async () => ({ ok: true, result: IMP() });
  const ctx = await mount(mod);
  H.btn(ctx, 'Import translations').click();
  await H.until(() => H.input(ctx, 'Paste the translated sheet'));

  H.setValue(H.input(ctx, 'Paste the translated sheet'), 'Key\tSource\na\tb');
  await H.until(() => H.shown(ctx).includes('No header row'));
  expect(H.btn(ctx, 'Check the translation')?.disabled, 'a sheet with no Translation column cannot be checked');
  hasNot(ctx, 'rows read', 'and is not ticked as read');

  /* Every translation a row low: the last one lands on the #END row. */
  const rows = PASTED.split('\r\n').map((r) => r.split('\t'));
  rows[2][6] = rows[1][6];
  rows[1][6] = '';
  H.setValue(H.input(ctx, 'Paste the translated sheet'), rows.map((r) => r.join('\t')).join('\r\n'));
  await H.until(() => H.shown(ctx).includes('slipped a row'));
  expect(H.btn(ctx, 'Check the translation')?.disabled, 'a slipped Translation column is refused before any check');

  H.setValue(H.input(ctx, 'Paste the translated sheet'), PASTED);
  await H.until(() => H.shown(ctx).includes('rows read') || H.shown(ctx).includes('row read'));
  expect(!H.btn(ctx, 'Check the translation')?.disabled, 'a good sheet can be checked');
  expect(H.tab.sent.length === 0 || H.tab.sent.at(-1)?.action !== 'apply', 'and nothing was written on the way');
});

test('Copy deck import · a file of the wrong kind is named as that', async () => {
  const mod = await import('/src/ui/screens/copy-deck.js');
  H.tab.reply = async () => ({ ok: true, result: IMP() });
  const ctx = await mount(mod);
  H.btn(ctx, 'Import translations').click();
  await H.until(() => H.btn(ctx, 'Upload file'));
  H.btn(ctx, 'Upload file').click();
  await H.until(() => ctx.view.querySelector('input[type="file"]'));

  const choose = (bytes, name) => {
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name));
    const input = ctx.view.querySelector('input[type="file"]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  };

  choose(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3]), 'deck.xls');
  await H.until(() => H.shown(ctx).includes('older Excel file'));
  has(ctx, 'deck.xls', 'the file is named');
  hasNot(ctx, 'rows read', 'and not ticked as read');

  choose(new Uint8Array(0), 'empty.xlsx');
  await H.until(() => H.shown(ctx).includes('is empty'));

  choose(new TextEncoder().encode('\uFEFF<## NASCA DRM FILE - VER1.00 ##>junk'), 'locked.xlsx');
  await H.until(() => H.shown(ctx).includes('corporate DRM'));

  /* Excel's "Unicode Text": UTF-16 with a byte order mark, read as the sheet it is. */
  const u16 = new Uint8Array([0xff, 0xfe, ...[...PASTED].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])]);
  choose(u16, 'deck.txt');
  await H.until(() => H.shown(ctx).includes('rows read'));
  hasNot(ctx, 'That did not work', 'a Unicode Text file is read');
  expect(!H.btn(ctx, 'Check the translation')?.disabled, 'and can be checked');
});

test('a step still going turns, and a step that is over does not', async () => {
  const { runStep, startingStep } = await import('/src/ui/parts.js');

  const going = runStep({ name: 'Uploading 3 images', state: 'running' });
  expect(!!going.querySelector('.spinner'), 'a running step turns');
  expect(going.textContent.includes('Uploading 3 images'), 'and still says what it is doing');

  for (const state of ['done', 'failed', 'todo']) {
    expect(!runStep({ name: 'x', state }).querySelector('.spinner'), `a ${state} step does not turn`);
    expect(!!runStep({ name: 'x', state }).querySelector('svg'), `a ${state} step wears an icon`);
  }

  /* The first moments, before the run has named a step of its own. */
  expect(!!startingStep().querySelector('.spinner'), 'the opening line turns too');
});

test('Copy a page · links to a third site are shown, and answering stays on the review', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  let analyses = 0;
  /* The second analysis is held open, so the moment in between can be looked
     at: that moment is what this test is about. */
  let release = null;
  const held = new Promise((r) => {
    release = r;
  });
  H.tab.reply = async (m) => {
    if (m.action !== 'analyze') return { ok: true, result: { done: true } };
    analyses++;
    if (analyses === 2) await held;
    return {
      ok: true,
      result: CP({
        otherSites: [
          {
            site: 'uk',
            properties: 3,
            repointed: true,
            links: [
              { link: '/content/samsung/uk/offers/spring-sale', uses: 2 },
              { link: '/content/samsung/uk/support', uses: 1 }
            ]
          }
        ]
      })
    };
  };
  const ctx = await mount(mod);
  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  await H.settle(20);
  H.btn(ctx, 'Analyze').click();
  await H.until(() => H.btn(ctx, 'Continue to copy'));

  has(ctx, 'Links to other sites', 'the site has its own box');
  has(ctx, '/content/samsung/uk/offers/spring-sale', 'and the links themselves are listed');
  has(ctx, 'used 2', 'with how often each one is used');

  /* Answering the box changes the plan, so it is worked out again - but the
     review stays up rather than throwing the reader back to the run screen
     and then to the top of a rebuilt page. */
  const siteBox = () => ctx.view.querySelector('input[aria-label*="Update links to /uk"]');
  H.tick(siteBox(), false);
  await H.settle(40);
  has(ctx, 'Working out the plan again', 'it says what it is doing');
  has(ctx, 'Links to other sites', 'without leaving the review');
  expect(!H.shown(ctx).includes('What is happening'), 'and without going to the run screen');

  /* And the box is still answerable while that happens: taking the boxes
     away mid-decision is what this replaced. */
  expect(!siteBox().disabled, 'the box can still be answered');
  expect(!siteBox().checked, 'and it shows the answer already given');
  expect(H.btn(ctx, 'Working out the plan again…')?.disabled, 'only writing is held back');

  await H.until(() => analyses === 2);
  release();
  await H.settle(80);
  expect(!!H.btn(ctx, 'Continue to copy'), 'and it can go on when the answer is back');
  expect(analyses === 2, 'one tick costs one re-read of both pages');
});

test('Copy a page · overwriting a backup page asks for a version of it first', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  const dest = '/content/samsung/levant_ar/india/backup/guides/battery';
  H.tab.sent = [];
  H.tab.reply = async (m) =>
    m.action === 'analyze' ? { ok: true, result: CP({ dest }) } : { ok: true, result: { done: true } };
  const ctx = await mount(mod, {
    state: { settings: { origins: [], rootDepth: 3, backupFolder: 'india/backup' } }
  });
  H.setValue(H.input(ctx, 'Destination page'), dest);
  await H.settle(20);
  H.btn(ctx, 'Analyze').click();
  await H.until(() => H.btn(ctx, 'Continue to copy'));

  has(ctx, 'Before overwriting this backup page', 'it asks');
  const box = ctx.view.querySelector('input[aria-label*="Create a version of it first"]');
  expect(!!box && !box.checked, 'unticked to start with: taking one is a decision, not a default');
  H.tick(box, true);
  await H.settle(30);

  H.btn(ctx, 'Continue to copy').click();
  await H.until(() => H.btn(ctx, 'Copy page'));
  H.btn(ctx, 'Copy page').click();
  const write = await H.until(() => H.tab.sent.find((x) => x.action === 'run'));
  expect(write.params.versionFirst === true, 'and the answer is sent with the write');
});

test('Copy a page · an ordinary destination is not asked about versions', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  const dest = '/content/samsung/levant/guides/battery';
  H.tab.sent = [];
  H.tab.reply = async (m) =>
    m.action === 'analyze' ? { ok: true, result: CP({ dest }) } : { ok: true, result: { done: true } };
  const ctx = await mount(mod, {
    state: { settings: { origins: [], rootDepth: 3, backupFolder: 'india/backup' } }
  });
  H.setValue(H.input(ctx, 'Destination page'), dest);
  await H.settle(20);
  H.btn(ctx, 'Analyze').click();
  await H.until(() => H.btn(ctx, 'Continue to copy'));

  /* A version here could not be restored from the Versions tool, so there is
     nothing to ask about. */
  expect(!H.shown(ctx).includes('Before overwriting this backup page'), 'no box');
  H.btn(ctx, 'Continue to copy').click();
  await H.until(() => H.btn(ctx, 'Copy page'));
  H.btn(ctx, 'Copy page').click();
  const write = await H.until(() => H.tab.sent.find((x) => x.action === 'run'));
  expect(!('versionFirst' in write.params), 'and nothing is sent: the setting decides');
});

test('a bare HTTP number is explained, without losing what was said', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  H.tab.reply = async () => ({
    ok: false,
    error: 'Unexpected HTTP 502 while reading /content/samsung/uk/offers/spring-sale'
  });
  const ctx = await mount(mod);
  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  await H.settle(20);
  H.btn(ctx, 'Analyze').click();
  await H.until(() => H.shown(ctx).includes('That did not work'));

  has(ctx, 'HTTP 502', 'the original words are kept');
  has(ctx, 'may be restarting', 'and what it means is added');
  has(ctx, 'Nothing was written', 'and whether anything was written');
});

test('a path with digits in it is not read as a status', async () => {
  const mod = await import('/src/ui/screens/link-fixer.js');
  H.tab.reply = async () => ({ ok: false, error: 'Page does not exist: /content/samsung/uk/f404/a' });
  const ctx = await mount(mod);
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('That did not work'));

  has(ctx, 'Page does not exist', 'the reason is shown');
  hasNot(ctx, 'Nothing is at that path on this instance', 'and no status is invented from the path');
});

test('the page is opened in AEM at one address, not two', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  const opened = [];
  const realCreate = chrome.tabs.create;
  chrome.tabs.create = async (o) => {
    opened.push(o.url);
    return { id: 9 };
  };
  try {
    /* A transfer's worker hands back a whole URL; every other worker hands
       back a path. Both must end up as one address. */
    H.tab.reply = async (m) =>
      m.action === 'analyze'
        ? { ok: true, result: CP() }
        : { ok: true, result: { ...CP(), done: true, editorUrl: 'https://p6-eu-author.samsung.com/editor.html/content/a.html' } };
    const ctx = await mount(mod);
    H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
    await H.settle(20);
    H.btn(ctx, 'Analyze').click();
    await H.until(() => H.btn(ctx, 'Continue to copy'));
    H.btn(ctx, 'Continue to copy').click();
    await H.until(() => H.btn(ctx, 'Copy page'));
    H.btn(ctx, 'Copy page').click();
    await H.until(() => H.btn(ctx, 'Open page in AEM'));
    H.btn(ctx, 'Open page in AEM').click();
    await H.settle(40);

    expect(opened.length === 1, 'one tab is opened');
    expect(
      opened[0] === 'https://p6-eu-author.samsung.com/editor.html/content/a.html',
      `the address must not be doubled up, got: ${opened[0]}`
    );
    expect((opened[0].match(/https?:\/\//g) || []).length === 1, 'exactly one scheme in the address');
  } finally {
    chrome.tabs.create = realCreate;
  }
});

/* ================================================= labels, messages, UI */

const SCREENS = [
  ['link-fixer', (m) => ({ ok: true, result: SCAN() }), 'Scan this page'],
  ['image-site-fixer', () => ({ ok: true, result: IMG_SCAN() }), 'Scan this page'],
  ['backup', () => ({ ok: true, result: BACKUP() }), 'Analyze paths'],
  ['versions', () => ({ ok: true, result: VERSIONS() }), 'Show versions'],
  ['copy-page', () => ({ ok: true, result: CP() }), 'Analyze'],
  ['copy-deck', () => ({ ok: true, result: DECK() }), null]
];

test('every screen draws without undefined, null or NaN in its words', async () => {
  for (const [name, reply, firstButton] of SCREENS) {
    const mod = await import(`/src/ui/screens/${name}.js`);
    H.tab.reply = async (m) => reply(m);
    const ctx = await mount(mod);
    if (firstButton) {
      H.btn(ctx, firstButton)?.click();
      await H.until(() => !H.shown(ctx).includes('What is happening'), { ms: 4000 });
    }
    const text = H.shown(ctx);
    for (const bad of ['undefined', 'null', 'NaN', '[object Object]']) {
      expect(!text.includes(bad), `${name}: "${bad}" reached the screen`);
    }
  }
});

test('every control a person uses has a name for a screen reader', async () => {
  for (const [name, reply, firstButton] of SCREENS) {
    const mod = await import(`/src/ui/screens/${name}.js`);
    H.tab.reply = async (m) => reply(m);
    const ctx = await mount(mod);
    if (firstButton) {
      H.btn(ctx, firstButton)?.click();
      await H.until(() => !H.shown(ctx).includes('What is happening'), { ms: 4000 });
    }
    for (const node of ctx.view.querySelectorAll('input, textarea, select')) {
      const named =
        node.getAttribute('aria-label') ||
        node.closest('label') ||
        (node.id && ctx.view.querySelector(`label[for="${node.id}"]`));
      expect(named, `${name}: a ${node.type || node.tagName.toLowerCase()} has no label`);
    }
    for (const b of [...ctx.view.querySelectorAll('button'), ...ctx.footer.querySelectorAll('button')]) {
      expect(
        (b.textContent || '').trim() || b.getAttribute('aria-label'),
        `${name}: a button has no words on it`
      );
    }
  }
});

test('a read never says it writes, and a write always says it does', async () => {
  const mod = await import('/src/ui/screens/link-fixer.js');
  H.tab.reply = async () => ({ ok: true, result: SCAN() });
  const ctx = await mount(mod);
  has(ctx, 'Preview only', 'the pick step is a read');
  hasNot(ctx, 'Writes to AEM', 'the pick step must not claim a write');

  H.btn(ctx, 'Scan this page').click();
  await H.until(() => !H.shown(ctx).includes('What is happening'), { ms: 4000 });
  hasNot(ctx, 'Writes to AEM', 'the review is still a read');

  H.btn(ctx, 'Continue with').click();
  await H.settle(20);
  has(ctx, 'Writes to AEM', 'the confirm step says it writes');
});

test('a tab that is gone is said in plain words', async () => {
  const mod = await import('/src/ui/screens/link-fixer.js');
  const ctx = await mount(mod, { state: { tab: null } });
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('No AEM tab'));
  has(ctx, 'No AEM tab', 'a missing tab is named');
});

test('a tab that stops answering is said as that, not as a port closing', async () => {
  const mod = await import('/src/ui/screens/link-fixer.js');
  H.tab.reply = async () => {
    throw new Error('The message port closed before a response was received.');
  };
  const ctx = await mount(mod);
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('stopped answering'));
  has(ctx, 'stopped answering', 'it is said in words a person can act on');
  hasNot(ctx, 'message port', 'the browser’s own words are not shown');
});

/* ------------------------------------------------------------------ run */

export async function run() {
  const out = [];
  for (const { name, fn } of T) {
    H.tab.sent = [];
    try {
      await fn();
      out.push({ name, ok: true });
    } catch (e) {
      out.push({ name, ok: false, why: e.message });
    }
  }
  return out;
}

/* ===================================================== the activity log */

test('a run keeps every line it was told, and shows it', async () => {
  const mod = await import('/src/ui/screens/link-fixer.js');
  H.tab.reply = async (m) => {
    H.say(m.runId, 'ok', 'checked 12 links');
    H.say(m.runId, 'warn', 'one link points at another country');
    return m.action === 'scan' ? { ok: true, result: SCAN() } : { ok: true, result: { written: 12 } };
  };
  const ctx = await mount(mod);
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => ctx.view.querySelector('.log-box'));
  await H.settle(40);

  /* Folded away until it is wanted, which is how a person meets it. The
     screen redraws as lines arrive, so the box is found again rather than
     held on to. */
  const box = ctx.view.querySelector('.log-box');
  expect(box, 'the log is on the screen');
  expect(!box.open, 'a run that went fine folds its log away');
  expect(ctx.own.log.lines.length === 2, `both lines were kept, got ${ctx.own.log.lines.length}`);
  box.open = true;

  has(ctx, 'checked 12 links', 'what the worker said is kept');
  has(ctx, 'one link points at another country', 'warnings too');
  has(ctx, 'Copy the log', 'and it can be taken away in one tap');
});

test('a failed run leaves an account of itself, opened', async () => {
  const mod = await import('/src/ui/screens/link-fixer.js');
  H.tab.reply = async (m) => {
    H.say(m.runId, 'ok', 'read the page');
    H.say(m.runId, 'warn', 'skipped an image: HTTP 503');
    return { ok: false, error: 'Unexpected HTTP 503 while writing' };
  };
  const ctx = await mount(mod);
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('That did not work'));

  has(ctx, 'What happened', 'the log is there under the failure');
  has(ctx, 'skipped an image', 'with what happened before it failed');
  has(ctx, 'Unexpected HTTP 503 while writing', 'and the failure itself');
  const box = ctx.view.querySelector('.log-box');
  expect(box && box.open, 'and it is open, not folded away');
});

test('Copy a page · an image over the limit is named, with where to change it', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  H.tab.reply = async () => ({
    ok: true,
    result: CP({
      maxImageBytes: 25 * 1024 * 1024,
      imagesByHand: [
        {
          kind: 'upload',
          from: '/content/dam/samsung/uk/a/video_desktop.png',
          to: '/content/dam/samsung/lb/a/video_desktop.png',
          reason: '68 MB, over the 25 MB this transfer carries (Settings)'
        }
      ]
    })
  });
  const ctx = await mount(mod);
  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  await H.settle(20);
  H.btn(ctx, 'Analyze').click();
  await H.until(() => H.shown(ctx).includes('over the'));

  has(ctx, '1 image over the 25 MB limit', 'the limit is named');
  has(ctx, 'video_desktop.png', 'and so is the image');
  has(ctx, 'where each one belongs', 'it says the page still goes across');
  has(ctx, 'Change the limit in Settings', 'and where to change it');
});

test('Copy a page · an image likely too big for AEM is called out first', async () => {
  const mod = await import('/src/ui/screens/copy-page.js');
  H.tab.reply = async () => ({
    ok: true,
    result: CP({
      uploads: [
        { from: '/content/dam/samsung/uk/a/video_desktop.png', to: '/content/dam/samsung/lb/a/video_desktop.png', bytes: 68 * 1024 * 1024 },
        { from: '/content/dam/samsung/uk/a/small.png', to: '/content/dam/samsung/lb/a/small.png', bytes: 40000 }
      ]
    })
  });
  const ctx = await mount(mod);
  H.setValue(H.input(ctx, 'Destination page'), '/content/samsung/lb/a');
  await H.settle(20);
  H.btn(ctx, 'Analyze').click();
  await H.until(() => H.shown(ctx).includes('will take a while'));

  has(ctx, '1 image will take a while', 'only the big one is named');
  has(ctx, 'video_desktop.png', 'by name');
  has(ctx, '68 MB', 'with its size');
  has(ctx, 'minutes of quiet', 'and how long it is given before it counts as stuck');
  has(ctx, 'to do by hand', 'and that the copy carries on without it');
  hasNot(ctx, 'small.png', 'an ordinary image is not called out');
});

/* ============================ Relative Link Fixer: counts, country, result */

/** The tiles a review draws, as { label: n }. */
const tiles = (ctx) =>
  Object.fromEntries(
    [...ctx.view.querySelectorAll('.count')].map((t) => [
      t.querySelector('.count-label')?.textContent,
      Number(t.querySelector('.count-n')?.textContent)
    ])
  );

/** Tick or untick the row whose link becomes `to`. */
const tickLink = (ctx, to, on) => H.tick(ctx.view.querySelector(`input[aria-label="Fix link to ${to}"]`), on);

async function scanned(over = {}) {
  const mod = await import('/src/ui/screens/link-fixer.js');
  H.tab.reply = async (m) => (m.action === 'scan' ? { ok: true, result: over.scan || SCAN() } : over.fix || { ok: true, result: { done: true, fixed: 2, left: 0 } });
  const ctx = await mount(mod, { state: over.state });
  H.btn(ctx, 'Scan this page').click();
  await H.until(() => H.shown(ctx).includes('selected'));
  return ctx;
}

test('Link Fixer · Select all with flagged links never counts below zero', async () => {
  const ctx = await scanned();
  let t = tiles(ctx);
  expect(t['to fix'] === 2 && t['need a look'] === 2 && t['left alone'] === 0, `before: ${JSON.stringify(t)}`);
  H.btn(ctx, 'Select all').click();
  await H.until(() => H.shown(ctx).includes('4 of 4 selected'));
  t = tiles(ctx);
  expect(t['to fix'] === 4 && t['need a look'] === 0 && t['left alone'] === 0, `after Select all: ${JSON.stringify(t)}`);
  for (const [k, n] of Object.entries(t)) expect(n >= 0, `${k} is ${n}`);

  H.btn(ctx, 'Continue with').click();
  await H.until(() => H.shown(ctx).includes('Will not change'));
  has(ctx, 'Nothing - every link is ticked', 'the confirm step agrees nothing is left');
});

test('Link Fixer · a flagged link ticked by hand is not counted as left for a look', async () => {
  const ctx = await scanned();
  tickLink(ctx, '/uk/a/', false);
  tickLink(ctx, '/de/c/', true);
  await H.until(() => H.shown(ctx).includes('2 of 4 selected'));
  const t = tiles(ctx);
  expect(t['to fix'] === 2 && t['need a look'] === 1 && t['left alone'] === 1, JSON.stringify(t));

  H.btn(ctx, 'Continue with').click();
  await H.until(() => H.shown(ctx).includes('Will not change'));
  has(ctx, '2 links, 1 flagged for a look', 'only the flagged one still unticked is counted');
});

test('Link Fixer · a site root deeper than the page ticks nothing for you', async () => {
  const ctx = await scanned({ state: { settings: { origins: [], rootDepth: 9 } } });
  has(ctx, '0 of 4 selected', 'no link is ticked when the country cannot be read');
  has(ctx, 'could not be checked for country', 'and it says why');
  has(ctx, 'Country unknown', 'each row says so');
});

test('Link Fixer · a site root depth that is not a number reads as 3', async () => {
  const ctx = await scanned({ state: { settings: { origins: [], rootDepth: 'abc' } } });
  has(ctx, '2 of 4 selected', 'the same two are ticked as with the default');
  hasNot(ctx, 'could not be checked', 'and the country is read');
});

test('Link Fixer · /UK/ is this country, not another', async () => {
  const scan = SCAN();
  scan.components = [
    { node: 'root/a', type: 'teaser', title: 'Teaser', liveCopy: false, links: [
      { prop: 'linkURL', index: -1, start: 0, from: 'HTTPS://WWW.SAMSUNG.COM/UK/e/', to: '/UK/e/', value: 'v' }] }
  ];
  const ctx = await scanned({ scan });
  has(ctx, '1 of 1 selected', 'ticked like any link in this country');
  hasNot(ctx, 'another country', 'and not called out as another');
});

test('Link Fixer · a link that becomes "/" strikes out the whole host', async () => {
  const scan = SCAN();
  scan.components = [
    { node: 'root/a', type: 'teaser', title: 'Teaser', liveCopy: false, links: [
      { prop: 'linkURL', index: -1, start: 0, from: 'https://www.samsung.com/', to: '/', value: 'v' }] }
  ];
  const ctx = await scanned({ scan });
  const cut = ctx.view.querySelector('.link-cut')?.textContent;
  expect(cut === 'https://www.samsung.com', `struck out "${cut}"`);
});

test('Link Fixer · a run that did all it was asked is Done, not Partly done', async () => {
  const ctx = await scanned({ fix: { ok: true, result: { done: true, page: SCAN().page, fixed: 2, left: 0, remaining: 2 } } });
  H.btn(ctx, 'Continue with').click();
  await H.until(() => H.btn(ctx, 'in AEM'));
  H.btn(ctx, 'in AEM').click();
  await H.until(() => H.shown(ctx).includes('skipped on purpose'));
  has(ctx, 'Done', 'the two unticked links were left on purpose');
  hasNot(ctx, 'Partly done', 'and are not a shortfall');
  hasNot(ctx, 'more full-URL', 'nothing appeared since the scan');
});

test('Link Fixer · full URLs added since the scan are said, without calling the run partly done', async () => {
  const ctx = await scanned({ fix: { ok: true, result: { done: true, page: SCAN().page, fixed: 2, left: 0, remaining: 3 } } });
  H.btn(ctx, 'Continue with').click();
  await H.until(() => H.btn(ctx, 'in AEM'));
  H.btn(ctx, 'in AEM').click();
  await H.until(() => H.shown(ctx).includes('skipped on purpose'));
  has(ctx, '1 more full-URL link on the page', 'the one the scan never saw is named');
  hasNot(ctx, 'Partly done', 'the run itself did everything');
});

test('Link Fixer · the fix goes to the tab and server that were scanned', async () => {
  const ctx = await scanned();
  // Another tab, on another server, comes to the front before the write.
  ctx.state.tab = { id: 2 };
  ctx.state.origin = 'https://p6-eu-author.samsung.com';
  H.btn(ctx, 'Continue with').click();
  await H.until(() => H.shown(ctx).includes('Will not change'));
  has(ctx, 'The tab in front is on p6-eu-author.samsung.com', 'the difference is said before the write');
  has(ctx, 'This writes to p6-ap-author.samsung.com', 'with where it will go');
  H.btn(ctx, 'in AEM').click();
  const fix = await H.until(() => H.tab.sent.find((m) => m.action === 'fix'));
  expect(fix.tabId === 1, `sent to tab ${fix.tabId}, not the scanned tab 1`);
  expect(fix.origin === 'https://p6-ap-author.samsung.com', `sent for ${fix.origin}`);
  const scan = H.tab.sent.find((m) => m.action === 'scan');
  expect(scan.origin === 'https://p6-ap-author.samsung.com', 'the scan names its server too');
});

/* ============================================ the panel shell, for real */

/**
 * The real panel.js in a frame of its own, over a stand-in Chrome that can
 * change which tab is in front, in which window. A frame because the shell
 * boots on import and keeps module state: each one starts clean.
 *
 * `tabs` are { id, windowId, url, title, active }; the panel's own window is
 * 7. `reply(msg, tabId)` answers commands, as `H.tab.reply` does.
 */
async function shell({ tabs, reply, lastFocused = 7 }) {
  const world = { tabs, sent: [], activated: [], updated: [] };
  const settings = {
    'aemt.settings': {
      origins: ['https://p6-ap-author.samsung.com', 'https://p6-eu-author.samsung.com'],
      settingsVersion: 2
    }
  };
  const front = (windowId) => world.tabs.find((t) => t.active && t.windowId === windowId);
  const stub = {
    tabs: {
      query: async (q) => {
        if (q?.active && q.windowId != null) return [front(q.windowId)].filter(Boolean);
        if (q?.active && q.lastFocusedWindow) return [front(lastFocused)].filter(Boolean);
        return world.tabs.filter((t) => !q?.url || t.url.startsWith(q.url.replace(/\*$/, '')));
      },
      get: async (id) => {
        const t = world.tabs.find((x) => x.id === id);
        if (!t) throw new Error(`No tab with id: ${id}.`);
        return t;
      },
      sendMessage: async (tabId, msg) => {
        if (msg?.type === 'aemt:release') return { ok: true };
        if (msg?.type === 'aemt:session') return { state: 'in', user: 'tester' };
        world.sent.push({ tabId, ...msg });
        return reply(msg, tabId);
      },
      onActivated: { addListener: (fn) => world.activated.push(fn) },
      onUpdated: { addListener: (fn) => world.updated.push(fn) }
    },
    windows: { getCurrent: async () => ({ id: 7 }) },
    permissions: { contains: async () => true, request: async () => true },
    storage: {
      onChanged: { addListener() {} },
      sync: { get: async (k) => (typeof k === 'string' ? { [k]: settings[k] } : { ...settings }), set: async (o) => Object.assign(settings, o) },
      local: { get: async () => ({}), set: async () => {} }
    },
    runtime: {
      getURL: (p) => '/' + p,
      openOptionsPage() {},
      onMessage: { addListener() {} },
      sendMessage: async () => ({ ok: true })
    }
  };

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;left:-10000px;top:0;width:400px;height:900px;border:0';
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(
    '<!doctype html><html><body>' +
      '<button id="back" type="button" aria-label="Back" hidden></button><div id="brand"></div>' +
      '<h1 id="title">DSY</h1><div id="subtitle"></div>' +
      '<button id="settings" type="button" aria-label="Settings"></button>' +
      '<main id="view"></main><footer id="footer"></footer></body></html>'
  );
  doc.close();
  frame.contentWindow.chrome = stub;
  const boot = doc.createElement('script');
  boot.type = 'module';
  boot.textContent = "import '/src/ui/panel.js';";
  doc.body.append(boot);

  const $ = (id) => doc.getElementById(id);
  const text = () => `${$('view').innerText || $('view').textContent}\n${$('footer').innerText || $('footer').textContent}`;
  const button = (words) =>
    [...doc.querySelectorAll('button')].find((b) => (b.textContent || '').toLowerCase().includes(words.toLowerCase())) || null;
  /* Another tab comes to the front of a window, as Chrome reports it. */
  const activate = async (tabId, windowId) => {
    for (const t of world.tabs) if (t.windowId === windowId) t.active = t.id === tabId;
    for (const fn of world.activated) await fn({ tabId, windowId });
  };
  await H.until(() => $('view').childElementCount, { ms: 5000 });
  return { frame, doc, world, $, text, button, activate, done: () => frame.remove() };
}

/* The Relative Link Fixer, opened the way a person does since 1.4.2: the
   Links row on the home screen, then its card. */
async function openLinkFixer(s) {
  s.button('Find broken links, or fix').click();
  await H.until(() => s.button('Turn full addresses'));
  s.button('Turn full addresses').click();
  await H.until(() => s.button('Scan this page'));
}

const AP = 'https://p6-ap-author.samsung.com';
const EU = 'https://p6-eu-author.samsung.com';

test('Shell · Back from a link tool goes to the Links cards, then home', async () => {
  const s = await shell({
    tabs: [{ id: 1, windowId: 7, active: true, url: `${AP}/editor.html/content/samsung/iq_ar/tvs/tv-buying-guide.html`, title: 'TV buying guide' }],
    reply: async () => ({ ok: true })
  });
  try {
    const home = s.button('Find broken links, or fix');
    expect(home && !home.disabled, `the Links row is there to press: ${s.text().slice(0, 300)}`);
    home.click();
    await H.until(() => s.text().includes('What do you want to do?'));
    /* The card, by its own words: "Find broken links" alone is also the home row's summary. */
    s.button('Check every button').click();
    await H.until(() => s.text().includes('Broken link finder'));

    s.$('back').click();
    await H.until(() => s.text().includes('What do you want to do?'));
    expect(s.$('title').textContent === 'Links', 'one press of Back is one level up: the Links cards');
    expect(!s.text().includes('Broken link finder'), 'and the tool is left');

    s.$('back').click();
    await H.until(() => !s.text().includes('What do you want to do?'));
    expect(s.$('back').hidden, 'a second press goes home');
  } finally {
    s.done();
  }
});

test('Shell · Back from Export or Import goes to the Copy deck cards, then home', async () => {
  const s = await shell({
    tabs: [{ id: 1, windowId: 7, active: true, url: `${AP}/editor.html/content/samsung/iq_ar/tvs/tv-buying-guide.html`, title: 'TV buying guide' }],
    reply: async () => ({ ok: true })
  });
  try {
    for (const card of ['Export the text of the open page', 'Paste or upload the translated rows']) {
      s.button('Export page text, import translations').click();
      await H.until(() => s.text().includes('What do you want to do?'));
      s.button(card).click();
      await H.until(() => !s.text().includes('What do you want to do?'));

      s.$('back').click();
      await H.until(() => s.text().includes('What do you want to do?'));
      expect(s.$('title').textContent === 'Copy deck', `${card}: one press of Back is one level up, to the cards`);

      s.$('back').click();
      await H.until(() => s.$('back').hidden);
      expect(!s.text().includes('What do you want to do?'), `${card}: a second press goes home`);
    }
  } finally {
    s.done();
  }
});

test('Shell · a page address with a stray % still draws the panel', async () => {
  for (const url of [`${AP}/content/samsung/uk/100%.html`, `${AP}/editor.html/content/samsung/uk/x%E2%82.html`]) {
    const s = await shell({ tabs: [{ id: 1, windowId: 7, active: true, url, title: '100%' }], reply: async () => ({ ok: true }) });
    try {
      expect(s.text().includes('Connected'), `${url}: the panel drew its home screen`);
      expect(s.text().includes('Find broken links, or fix how links and image paths are written'), `${url}: with its tools`);
      expect(s.text().includes('Copy one component into another page'), `${url}: Copy a component among them`);
    } finally {
      s.done();
    }
  }
});

test('Shell · another window cannot steer this panel', async () => {
  const s = await shell({
    tabs: [
      { id: 1, windowId: 7, active: true, url: `${AP}/editor.html/content/samsung/uk/a.html`, title: 'A' },
      { id: 5, windowId: 9, active: true, url: `${EU}/editor.html/content/samsung/de/b.html`, title: 'B' }
    ],
    lastFocused: 9,
    reply: async () => ({ ok: true })
  });
  try {
    expect(s.text().includes('p6-ap-author'), 'the panel shows the tab in its own window');
    await s.activate(5, 9);
    await H.settle(60);
    expect(s.text().includes('p6-ap-author') && !s.text().includes('p6-eu-author'), 'a tab coming forward in another window changes nothing');
  } finally {
    s.done();
  }
});

test('Shell · a tool stays with the tab it read, and its write goes there', async () => {
  const s = await shell({
    tabs: [
      { id: 1, windowId: 7, active: true, url: `${AP}/editor.html/content/samsung/uk/offers/spring-sale.html`, title: 'Spring sale' },
      { id: 2, windowId: 7, active: false, url: `${EU}/editor.html/content/samsung/de/x.html`, title: 'X' }
    ],
    reply: async (m) => (m.action === 'scan' ? { ok: true, result: SCAN() } : { ok: true, result: { done: true, fixed: 2, left: 0 } })
  });
  try {
    await openLinkFixer(s);
    s.button('Scan this page').click();
    await H.until(() => s.button('Continue with'));

    await s.activate(2, 7);
    await H.settle(60);
    expect(!s.text().includes('Still working on'), 'no note about the tab in front - it only confused');
    expect(s.text().includes('p6-ap-author'), 'the tool still shows the server it read');

    s.button('Continue with').click();
    await H.until(() => s.button('in AEM'));
    s.button('in AEM').click();
    const fix = await H.until(() => s.world.sent.find((m) => m.action === 'fix'));
    expect(fix.tabId === 1, `the write went to tab ${fix.tabId}, not the tab it read`);
    expect(fix.origin === AP, `and was meant for ${fix.origin}`);

    // Back at the tools, the panel follows the tab in front again. Back goes
    // up one level at a time: to the Links cards, then home.
    await H.until(() => s.text().includes('made relative'));
    s.$('back').click();
    await H.until(() => s.text().includes('What do you want to do?'));
    s.$('back').click();
    await H.until(() => s.text().includes('p6-eu-author'));
  } finally {
    s.done();
  }
});

test('Shell · Back waits while a write is under way, and the result is kept', async () => {
  let release = null;
  const held = new Promise((r) => (release = r));
  const s = await shell({
    tabs: [{ id: 1, windowId: 7, active: true, url: `${AP}/editor.html/content/samsung/uk/offers/spring-sale.html`, title: 'Spring sale' }],
    reply: async (m) => {
      if (m.action === 'scan') return { ok: true, result: SCAN() };
      await held;
      return { ok: true, result: { done: true, fixed: 2, left: 0 } };
    }
  });
  try {
    await openLinkFixer(s);
    s.button('Scan this page').click();
    await H.until(() => s.button('Continue with'));
    expect(!s.$('back').disabled, 'Back works while nothing is running');
    s.button('Continue with').click();
    await H.until(() => s.button('in AEM'));
    s.button('in AEM').click();
    await H.until(() => s.world.sent.find((m) => m.action === 'fix'));

    expect(s.$('back').disabled, 'Back is held while the write runs');
    s.$('back').click();
    await H.settle(30);
    expect(s.$('title').textContent === 'Links' && !s.text().includes('What do you want to do?'), 'and pressing it leaves the tool open, where it was');

    release();
    await H.until(() => s.text().includes('made relative'));
    expect(!s.$('back').disabled, 'Back works again once the run is over');
  } finally {
    s.done();
  }
});
