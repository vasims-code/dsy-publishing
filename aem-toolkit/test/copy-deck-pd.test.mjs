/* The copy deck of a product detail (PD) page: its copy comes from PIM, so it
 * is read from the page as rendered - the parser that reads it, which parts of
 * the page become rows and which are left off, the representative and sibling
 * SKU sheets, the workbook, the worker reading a page through a simulated AEM,
 * and the import refusing such a sheet and such a page.
 *
 * The fixture is the real ca QN80H page as served with wcmmode=disabled,
 * trimmed: no scripts, no header or footer, one review, attributes nothing
 * here reads taken out. It gives the same rows as the whole page.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/';
const html = await import(pathToFileURL(base + 'src/features/copy-deck/html.js'));
const pd = await import(pathToFileURL(base + 'src/features/copy-deck/pd.js'));
const core = await import(pathToFileURL(base + 'src/features/copy-deck/core.js'));
const { toXlsx } = await import(pathToFileURL(base + 'src/features/copy-deck/xlsx.js'));
const { AemClient } = await import(pathToFileURL(base + 'src/core/aem-client.js'));
const { actions: deckActions } = await import(pathToFileURL(base + 'src/features/copy-deck/worker.js'));
const { actions: importActions } = await import(pathToFileURL(base + 'src/features/copy-deck-import/worker.js'));

const PAGE_HTML = readFileSync(base + 'test/fixtures/copy-deck-pd-ca-qn80h.html', 'utf8');
const PAGE = '/content/samsung/ca/tvs/qled-tv/qn80h-75-inch-neo-qled-4k-mini-led-smart-tv-qn75qn80hafxzc';
const TEMPLATE = '/conf/consumer/settings/wcm/templates/page-standard-pd';

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};

console.log('--- reading HTML without a DOM --------------------------------------');
{
  const doc = html.parseHtml(
    '<ul><li>One<li>Two <b>bold</ul><p>Para<div id="d">Block</div>' +
      '<img alt="An &quot;image&quot;"><svg><use href="#x"/></svg><span>after</span>' +
      '<script>if (a < b) document.write("<p>not markup</p>")</script></i></p><p>End &amp; &#34;q&#34; &trade;</p>'
  );
  const lis = html.findAll(doc, (n) => n.tag === 'li');
  check('a <li> left open is closed by the next one', lis.length === 2 && html.textOf(lis[0]) === 'One', JSON.stringify(lis.map(html.textOf)));
  const d = html.find(doc, (n) => n.attrs.id === 'd');
  check('a <div> closes an open <p>, as in a browser', d.parent.tag === '#root', d.parent.tag);
  const img = html.find(doc, (n) => n.tag === 'img');
  check('void elements and <use/> take no children, attributes are decoded', img.children.length === 0 && img.attrs.alt === 'An "image"', JSON.stringify(img.attrs));
  check('...so what follows them is their sibling', html.find(doc, (n) => n.tag === 'span').parent.tag === '#root', '');
  check('a script is never read as markup', !html.findAll(doc, (n) => n.tag === 'p').some((p) => /not markup/.test(html.textOf(p))), '');
  check('a stray closing tag is ignored', html.findAll(doc, (n) => n.tag === 'p').length === 2, '');
  check('text is decoded', html.textOf(html.findAll(doc, (n) => n.tag === 'p').at(-1)) === 'End & "q" ™', html.textOf(html.findAll(doc, (n) => n.tag === 'p').at(-1)));
}

console.log('\n--- which pages are product pages ------------------------------------');
check('the page-standard-pd template is a product page', pd.isPdPage({ template: TEMPLATE }), '');
check('...under any /conf, or known by its resource type', pd.isPdPage({ template: '/conf/brand-x/settings/wcm/templates/page-standard-pd' }) && pd.isPdPage({ content: { 'sling:resourceType': 'samsung/components/structure/consumer/global/page-standard-pd' } }), '');
check('a page-pcd page is not', !pd.isPdPage({ template: '/conf/consumer/settings/wcm/templates/page-pcd' }) && !pd.isPdPage({}), '');

console.log('\n--- video descriptions (levant F6000: two videos with "alt text" posters) ---');
{
  const v = (title, alt) =>
    `<div class="video" data-image-default="true" data-video-data="{&#34;src&#34; : &#34;//x/feature/167144954/v.mp4&#34;,\n&#34;muted&#34; : true,\n&#34;title&#34; : &#34;${title}&#34;}">` +
    `<button><span class="hidden">${title}</span></button><img class="image__main" alt="${alt}" data-desktop-src="//x/feature/167144954/a.jpg"></div>`;
  const page =
    '<html><body><div id="content"><div class="pd-g-feature-benefit-ux2"><section class="feature-benefit-half-text">' +
    '<h3>Enjoy sound optimized to your content</h3>' +
    v('Soundwaves beneath the TV change in shape.', 'alt text') +
    '</section><section class="feature-benefit-half-text">' +
    v('A person on a motorcycle is zipping past.', 'A person on a motorcycle is zipping past.') +
    `<div class="video" data-video-data='{"title": "Broken, \\"quoted\\" title", '></div>` +
    '</section></div></div></body></html>';
  const rows = pd.selectPdRows(pd.extractPdDeck(page).items);
  const r = rows.find((x) => x.source === 'Soundwaves beneath the TV change in shape.');
  check('a video description is a row, though its poster alt is a placeholder', r?.field === 'Video description' && r.notes.includes('PIM feature 167144954'), JSON.stringify(rows));
  check('...once: not again from the hidden text the page also has', rows.filter((x) => /Soundwaves/.test(x.source)).length === 1, '');
  check('...one row with a poster alt in the same words', rows.filter((x) => /motorcycle/.test(x.source)).length === 1 && rows.find((x) => /motorcycle/.test(x.source)).notes.some((n) => /Also used as: Image alt/.test(n)), JSON.stringify(rows));
  check('...and read from settings that are not valid JSON', rows.some((x) => x.source === 'Broken, "quoted" title'), JSON.stringify(rows.map((x) => x.source)));
}

const deck = pd.extractPdDeck(PAGE_HTML, { pagePath: PAGE });
const items = deck.items;
const rep = pd.selectPdRows(items, { categories: pd.SKU_PRESETS.rep });
const sibling = pd.selectPdRows(items, { categories: pd.SKU_PRESETS.sibling });
const find = (rows, text) => rows.find((r) => r.source === text);
const has = (rows, re) => rows.some((r) => re.test(r.source));

console.log('\n--- what becomes a row -----------------------------------------------');
check('the page reads as a product page: name, gallery, features and specs found', JSON.stringify(deck.found) === JSON.stringify({ product: true, gallery: true, features: true, specs: true }), JSON.stringify(deck.found));
check('its language is the page’s', deck.language === 'en-CA', deck.language);
{
  const desc = find(rep, 'Immerse yourself in the 75" Neo QLED QN80H Vision AI Smart TV (QN75QN80HAFXZC) with NQ4 AI Gen2 Processor, Quantum Mini LED, 144Hz motion and Dolby Atmos sound.');
  check('the page title and SEO come from <head> - PIM fills them, the page properties do not', find(rep, 'QN80H 75 Inch Neo QLED 4K Vision AI Smart TV (2026) | Samsung Canada')?.field === 'Page title' && desc?.section === 'Page title & SEO', JSON.stringify(rep.slice(0, 3)));
  check('...the description once, saying where else it is used', desc?.notes.includes('Also used as: Open Graph description; Twitter description'), JSON.stringify(desc?.notes));
}
check('the product name is a row of its own', find(rep, '75" Neo QLED QN80H 4K Samsung Vision AI Smart TV (2026)')?.category === 'product', '');
{
  const g = rep.filter((r) => r.category === 'gallery');
  check('every gallery image title is a row', g.length === 9 && g[0].field === 'Image 1 › Title', JSON.stringify(g.map((r) => r.field)));
  check('...and a {size} in it is to keep as written', g[1].tags.includes('{size}') && /Keep as written: \{size\}/.test(core.buildSheet([g[1]]).records[0][2]), JSON.stringify(g[1].tags));
}
{
  const r = find(rep, 'Ask your companion anything. Samsung Vision AI is here.');
  check('a feature is a section, named after its headline', r?.section.endsWith('· Feature · Ask your companion anything. Samsung Vision AI is…') && r.field === 'Headline', r?.section);
  check('...its sub-headline and description named from the page’s own classes', find(rep, 'Samsung Vision AI Companion')?.field === 'Sub-headline' && rep.some((x) => x.field === 'Description' && x.sectionNo === r.sectionNo), '');
  check('...and every row in it says which PIM feature it belongs to', r.pim === '167448823' && r.notes[0] === 'PIM feature 167448823', JSON.stringify(r.notes));
}
{
  const d = rep.find((r) => /^TV becomes an intelligent companion/.test(r.source));
  check('a footnote marker is not part of the sentence, but is noted', /evolving\.$/.test(d.source) && d.notes.includes('Has footnote 1'), `${d.source.slice(-30)} ${JSON.stringify(d.notes)}`);
  const br = rep.find((r) => /^Enjoy seamless visuals/.test(r.source));
  check('a <br> stays a line break in the cell', br.lineBreaks === 2 && br.format === 'multiline' && br.source.includes('144Hz.\nSamsung’s') && br.source.endsWith('4K\n144 Hz or 2K 240Hz.'), JSON.stringify(br.source));
}
{
  const alt = items.filter((r) => r.source === 'Dull close-up image of fruits and berries looks incredibly vibrant and colourful when displayed on a Real QLED TV.');
  check('an image alt rendered four times (desktop, mobile, preview, main) is one row', alt.length === 1 && alt[0].category === 'alt' && alt[0].field === 'Image alt', String(alt.length));
}
check('a section with no headline is named after its first text', rep.some((r) => r.section.endsWith('· Feature · Compared to 2026 Neo QLED 4K (NQ4 AI Processor)')), '');
check('screen-reader and carousel text is not copy', !has(items, /^(Previous|Next|Playing video|Indicator \d|Layer Popup Close|Go to feature)$/), JSON.stringify(items.filter((r) => /^(Previous|Next|Playing video)$/.test(r.source)).map((r) => r.key)));
{
  const specs = rep.filter((r) => r.category === 'specs');
  check('a spec value is a row, named by its group and spec', find(specs, 'Wide Viewing Angle')?.field === 'Video › Viewing Angle', JSON.stringify(find(specs, 'Wide Viewing Angle')));
  check('...the spec names and group names are not rows - they are PIM’s attribute labels', !find(items, 'Screen Size') && !find(items, 'Connectivity') && !find(items, 'Specifications') && !find(items, 'Expand all'), '');
  const yes = find(specs, 'Yes');
  check('...a value many specs share is one row, saying how many', yes && items.filter((r) => r.source === 'Yes').length === 1 && /and \d+ more$/.test(yes.notes.at(-1)), JSON.stringify(yes?.notes));
  check('...and a value with no letters in it (75", 4) is not a row', !has(items, /^[^\p{L}]+$/u), '');
  check('...nor a code on its own - the same in every language', !['QN75QN80HAFXZC', 'TM2280A', '30W', '2CH'].some((c) => find(items, c)) && find(specs, 'eARC') && find(specs, 'BLACK'), '');
}
{
  const f1 = items.find((r) => r.field === 'Footnote 1');
  check('the feature footnotes are rows, numbered, each with its PIM feature', f1?.category === 'disclaimer' && f1.pim === '167448823' && f1.source.startsWith('For illustrative purposes only.\nFeature available'), JSON.stringify(f1));
  check('...the general disclaimers under them too', find(items, '* Key feature may be different from Key Spec')?.field === 'Disclaimer', '');
}

console.log('\n--- what is left off --------------------------------------------------');
check('prices, options and offers - the buying tool - are not rows', !has(items, /Choose your size|Personalize your TV|Buy Now Pay Later|Out of Stock|\{\{/), JSON.stringify(items.filter((r) => /Choose your|\{\{/.test(r.source)).map((r) => r.source)));
check('reviews, support and the buy direct benefits are not rows', !has(items, /User manual|Product support|Buy direct|Samsung Rewards/) && !items.some((r) => /review/i.test(r.section)), '');
check('...nor the breadcrumb and the page navigation', !find(items, 'QLED TV') && !find(items, 'Spec'), '');
{
  const parts = deck.leftOff.map((l) => l.part);
  check('what is left off is listed, with why', ['Page navigation', 'Buying options', 'Buy direct benefits', 'Reviews', 'Support & downloads', 'Breadcrumb'].every((p) => parts.includes(p)) && deck.leftOff.every((l) => l.why && l.texts > 0), JSON.stringify(deck.leftOff));
}
{
  const other = pd.extractPdDeck(
    '<html><body><div id="content"><div class="pd-g-whats-in-the-box"><h2>What’s in the box</h2><p>Remote control</p></div></div></body></html>'
  );
  check('a part of the page it does not know is read, under Other text', other.items.length === 2 && other.items.every((r) => r.category === 'other') && other.items[0].section === '01 · Whats In The Box', JSON.stringify(other.items.map((r) => [r.section, r.category])));
}

console.log('\n--- the sheet ---------------------------------------------------------');
check('keys are the product page’s own, unique, in page order', new Set(items.map((r) => r.key)).size === items.length && items.every((r) => /^pd:\d{2}\.\d+$/.test(r.key)), items.slice(0, 3).map((r) => r.key).join(' '));
check('a representative SKU sheet has each text once', new Set(rep.map((r) => r.source)).size === rep.length, '');
{
  const nq4 = find(rep, 'NQ4 AI Gen2 Processor');
  check('...where it is first seen, naming the other sections that show it', nq4.section === '03 · Highlights' && /^Also in section 10, \d+$/.test(nq4.notes.at(-1)), JSON.stringify(nq4.notes));
  const s = find(sibling, 'NQ4 AI Gen2 Processor');
  check('a sibling SKU sheet is the gallery and the specs only', sibling.every((r) => r.category === 'gallery' || r.category === 'specs') && sibling.length < rep.length, `${sibling.length} rows`);
  check('...where a spec value seen first in the features is still on it, under Specs', s?.category === 'specs' && s.field === 'Video › Picture Engine', JSON.stringify(s));
}
{
  const counts = pd.countPdByCategory(items);
  check('the count beside each group is what that group alone puts on the sheet', pd.PD_CATEGORIES.every((c) => counts[c.id] === pd.selectPdRows(items, { categories: [c.id] }).length), JSON.stringify(counts));
}
{
  const sheet = core.buildSheet(rep, { pagePath: PAGE, exportedAt: '2026-10-01 20:00', pd: true });
  const r = sheet.records.find((x) => x[5] === 'Ask your companion anything. Samsung Vision AI is here.');
  check('the Notes column carries the PIM feature', r[2] === 'PIM feature 167448823', r[2]);
  check('the #END row says the translations go into PIM', /product page: text from PIM, translations go into PIM/.test(sheet.records.at(-1)[2]) && sheet.records.at(-1)[3] === '#meta', sheet.records.at(-1)[2]);
  const read = core.readSheet([sheet.columns, ...sheet.records]);
  check('...and still reads back as a whole sheet', read.ok && read.rows.length === rep.length && read.meta.rows === rep.length, JSON.stringify(read.meta));
  const book = new TextDecoder().decode(toXlsx(sheet, { pagePath: PAGE, exportedAt: '2026-10-01 20:00', pd: true }));
  check('the workbook’s How to translate tab is the product page’s', book.includes('Keep anything in curly brackets exactly as written - {size}') && book.includes('The translations are entered in PIM.') && !book.includes('Static content') && !book.includes('Tips'), '');
  const plain = new TextDecoder().decode(toXlsx(core.buildSheet([]), {}));
  check('...and an ordinary page’s has the rule for static content, and its tips', plain.includes('are put on the page by hand, by the web team or a developer') && plain.includes('check them in the formula bar') && plain.includes('Write numbers and units the way your market writes them.') && !plain.includes('curly brackets'), '');
}

console.log('\n--- reading the page --------------------------------------------------');

const mk = (status, text) => ({ status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) });

/** One PD page: its node (page properties only, as on author) and its rendered HTML. */
function installFetch({ page = PAGE_HTML, template = TEMPLATE } = {}) {
  const calls = [];
  const node = {
    'jcr:primaryType': 'cq:Page',
    'jcr:content': {
      'jcr:primaryType': 'cq:PageContent',
      'jcr:title': 'QN80H 75 Inch Neo QLED 4K Vision AI Smart TV (2026) | Samsung Canada',
      'cq:template': template,
      'sling:resourceType': `samsung/components/structure/consumer/global/${template.split('/').pop()}`,
      modelCode: 'QN75QN80HAFXZC',
      root: { 'sling:resourceType': 'wcm/foundation/components/responsivegrid', responsivegrid: {} }
    }
  };
  globalThis.fetch = async (url, init = {}) => {
    const [path, query = ''] = decodeURI(String(url)).split('?');
    calls.push(`${(init.method || 'GET').toUpperCase()} ${path}${query.includes('wcmmode=disabled') ? '?wcmmode=disabled' : ''}`);
    if ((init.method || 'GET').toUpperCase() !== 'GET') return mk(500, 'no writes expected');
    if (path === `${PAGE}.1.json`) return mk(200, JSON.stringify(node));
    if (path === `${PAGE}/jcr:content.infinity.json`) return mk(200, JSON.stringify(node['jcr:content']));
    if (path === `${PAGE}.html`) return page === null ? mk(404, 'nf') : mk(200, page);
    return mk(404, 'nf');
  };
  return calls;
}

async function run(actions, action, params, opts) {
  const calls = installFetch(opts);
  const lines = [];
  const report = (level, message, data) => lines.push({ level, message, data });
  const client = new AemClient({ report });
  try {
    return { result: await actions[action]({ client, report, params, settings: {} }), calls, lines, error: null };
  } catch (e) {
    return { result: null, calls, lines, error: e.message };
  }
}

{
  const t = await run(deckActions, 'read', { page: PAGE });
  check('a product page is read as rendered, with wcmmode=disabled', t.error === null && t.calls.includes(`GET ${PAGE}.html?wcmmode=disabled`), t.error || JSON.stringify(t.calls));
  check('...not from jcr:content, which holds none of its copy', !t.calls.some((c) => c.includes('infinity')), JSON.stringify(t.calls));
  check('...and hands the panel the same rows as the page itself gives, once', t.result?.mode === 'pd' && JSON.stringify(t.result.rows) === JSON.stringify(items) && !('items' in t.result), '');
  check('...with no fields to add and nothing kept elsewhere', t.result.newFields.length === 0 && t.result.references.length === 0, '');
  check('...saying where the copy came from, and where the translations go', t.lines.some((l) => /comes from PIM/.test(l.message)) && t.lines.some((l) => /cannot be imported/.test(l.message)), JSON.stringify(t.lines.map((l) => l.message)));
  check('reads only', t.calls.every((c) => c.startsWith('GET ')), JSON.stringify(t.calls));
}
{
  const t = await run(deckActions, 'read', { page: PAGE }, { page: '<html><body><form name="login">Sign in</form></body></html>' });
  check('a page that did not render as a product page - a login page - stops the run and says so', /did not render as a product page/.test(String(t.error)) && /session/.test(String(t.error)), String(t.error));
}
{
  const t = await run(deckActions, 'read', { page: PAGE }, { page: null });
  check('a product page that does not render stops the run', /does not render/.test(String(t.error)), String(t.error));
}
{
  const t = await run(deckActions, 'read', { page: PAGE }, { template: '/conf/consumer/settings/wcm/templates/page-pcd' });
  check('any other page is still read from jcr:content', t.error === null && t.result.mode === undefined && t.calls.some((c) => c.includes('infinity')) && !t.calls.some((c) => c.includes('.html')), t.error || JSON.stringify(t.calls));
}

console.log('\n--- the import refuses it ---------------------------------------------');
{
  const sheet = core.buildSheet(rep.slice(0, 5), { pagePath: PAGE, exportedAt: 'x', pd: true });
  const grid = [sheet.columns, ...sheet.records];
  grid[1][6] = 'Une traduction';
  const t = await run(importActions, 'check', { page: '/content/samsung/ca_fr/tvs/x', sheet: JSON.stringify(grid) });
  check('a sheet exported from a product page is refused: its translations go into PIM', /from a product page \(PD\)/.test(String(t.error)) && /entered in PIM/.test(String(t.error)), String(t.error));
  check('...before anything is read', t.calls.length === 0, JSON.stringify(t.calls));
}
{
  const page = { 'jcr:title': 'x', ogTitle: 'Title' };
  const sheet = core.buildSheet(core.extractCopyDeck(page).rows, { pagePath: '/content/samsung/ca/x' });
  const grid = [sheet.columns, ...sheet.records];
  grid[1][6] = 'Titre';
  const t = await run(importActions, 'check', { page: PAGE, sheet: JSON.stringify(grid) });
  check('any sheet is refused for a product page: AEM does not hold its copy', /is a product page \(PD\)/.test(String(t.error)) && !t.calls.some((c) => c.includes('infinity')), String(t.error));
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
