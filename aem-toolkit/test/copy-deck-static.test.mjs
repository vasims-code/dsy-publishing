/* Static Content on the copy deck: a block's Body (HTML) read in whole
 * sentences with their tags, its Footer's strings for a developer, the blocks
 * numbered and named, one Key per text - and the import listing each text to
 * put in by hand, never writing it.
 *
 * The fixture is the real explore-samsung-health jcr:content, trimmed: its 8
 * Static Content blocks, CRLF as AEM stores them, the showcase's script cut to
 * its first tiles.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/';
const core = await import(pathToFileURL(base + 'src/features/copy-deck/core.js'));
const sc = await import(pathToFileURL(base + 'src/features/copy-deck/static-content.js'));

const FIXTURE = JSON.parse(readFileSync(base + 'test/fixtures/copy-deck-explore-samsung-health.json', 'utf8'));
const PAGE = '/content/samsung/levant/explore-samsung-health';
const TARGET = '/content/samsung/levant_ar/explore-samsung-health';
const GRID = 'root/responsivegrid';
const B2 = `${GRID}/cm_g_static_content_`;
const B3 = `${GRID}/cm_g_static_content__1282587421`;
const B4 = `${GRID}/cm_g_static_content__861707988`;
const B5 = `${GRID}/cm_g_static_content__1495926445`;
const B7 = `${GRID}/cm_g_static_content__532194702`;
const B8 = `${GRID}/cm_g_static_content__1841334301`;
const NBSP = String.fromCharCode(0xa0);
const clone = (o) => JSON.parse(JSON.stringify(o));
const nodeAt = (c, path) => path.split('/').reduce((n, s) => n?.[s], c);

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};

const deck = (tree = FIXTURE) => core.extractCopyDeck(clone(tree), { pagePath: PAGE });
const statics = (tree) => deck(tree).rows.filter((r) => r.category === 'static');
const bySource = (rows, source) => rows.find((r) => r.source === source);
/** A block's Body as a test changes it. */
const withBody = (path, change) => {
  const t = clone(FIXTURE);
  nodeAt(t, path).bodyHtml = change(nodeAt(t, path).bodyHtml);
  return t;
};

/** Excel's clipboard: tabs and CRLF, a cell quoted only when it holds a line break or a tab. */
const clipboard = (grid) =>
  grid.map((r) => r.map((c) => (/[\n\r\t]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join('\t')).join('\r\n');

/** Export `tree`, translate each text with `translate(source)`, and read the sheet back as the import gets it. */
function sheetOf(tree, translate, { staticPieces = false } = {}) {
  const sheet = core.buildSheet(core.extractCopyDeck(clone(tree), { pagePath: PAGE, staticPieces }).rows, { pagePath: PAGE, exportedAt: '2026-10-11 10:00' });
  const S = sheet.columns.indexOf('Source text');
  const T = sheet.columns.indexOf('Translation');
  for (const rec of sheet.records.slice(0, -1)) rec[T] = translate(rec[S]) ?? '';
  if (staticPieces) sheet.records.at(-1)[2] = sheet.records.at(-1)[2].replace(/copy deck v\d+/, 'copy deck v3');
  return core.readSheet(core.gridFromText(clipboard([sheet.columns, ...sheet.records])));
}
const plan = (tree, sheet) => core.planImport(clone(tree), sheet, { pagePath: TARGET });
const rowsOf = (p, source) => p.rows.filter((r) => r.current === source);

console.log('--- blocks, numbered and named --------------------------------------');

{
  const labels = [...new Set(statics().map((r) => r.section))];
  check(
    'the fixture gives 8 distinct labels, numbered in page order and named after the first heading',
    JSON.stringify(labels) ===
      JSON.stringify([
        'Static content 1 of 8 · Pick your perfect fitness partner',
        'Static content 2 of 8 · Explore Samsung Health',
        'Static content 3 of 8 · Showcase (script) · Energy Score',
        'Static content 4 of 8 · Find your perfect companion',
        'Static content 5 of 8 · Made to support your everyday wellness',
        'Static content 6 of 8 · Galaxy Buds',
        'Static content 7 of 8 · See what others, like you, have to say',
        'Static content 8 of 8 · Feel on top of your health'
      ]),
    JSON.stringify(labels, null, 1)
  );

  // A block with no text still counts: "5 of 8" is the fifth block in the editor, where all are "RC01_Static Content".
  const t = clone(FIXTURE);
  const grid = nodeAt(t, GRID);
  const entries = Object.entries(grid);
  for (const k of Object.keys(grid)) delete grid[k];
  for (const [k, v] of entries) {
    grid[k] = v;
    if (k === 'cm_g_static_content_') grid.cm_g_static_content_spacer = { 'sling:resourceType': nodeAt(FIXTURE, B2)['sling:resourceType'], bodyHtml: '<div class="spacer"></div>' };
  }
  const nine = [...new Set(statics(t).map((r) => r.section))];
  check(
    'every block counts, one that gives no rows too',
    nine.length === 8 && nine[1] === 'Static content 2 of 9 · Explore Samsung Health' && nine[2] === 'Static content 4 of 9 · Showcase (script) · Energy Score',
    JSON.stringify(nine)
  );
  const name = (bodyHtml, footerInclude) => sc.readBlock({ bodyHtml, footerInclude }).name;
  check(
    'with no heading, a block is named after its first text; with no text, after its script',
    name('<div><p>First words here</p><h4>Small heading</h4></div>') === 'First words here' &&
      name('<div id="app"></div>', 'document.body.append(1);') === 'Script only' &&
      name('<div class="spacer"></div>') === 'No text',
    JSON.stringify([name('<div><p>First words here</p><h4>Small heading</h4></div>'), name('<div id="app"></div>', 'document.body.append(1);'), name('<div class="spacer"></div>')])
  );
}

console.log('\n--- whole sentences ---------------------------------------------------');

const rows = statics();
{
  const link = rows.find((r) => r.source.startsWith('All of our Galaxy'));
  check(
    'a sentence with a link in it is one row, the tag kept with its link only',
    link?.source ===
      'All of our Galaxy Watches and Smart Rings are teamed up with our intuitive <a href="https://www.samsung.com/levant/apps/samsung-health/">Samsung Health App</a>, that\'s thoughtfully designed to help you achieve your wellness goals. Stay on track and keep motivation high, with AI-powered personalised insights.',
    link?.source
  );
  check(
    '...and a headline with its <br> and <span>, line breaks and indentation read as one space',
    !!bySource(rows, 'Made to support your<br><span class="header-highlight">everyday wellness</span>') &&
      !!bySource(rows, 'Made to support your<br><span class="header-highlight">active lifestyle</span>'),
    JSON.stringify(rows.filter((r) => r.source.startsWith('Made to')).map((r) => r.source))
  );
  check(
    'a sentence stored over three lines is one cell',
    !!bySource(rows, "Discover our Galaxy wearable range, ready to help you take your health and fitness to the next level. Whatever your lifestyle there's the perfect device waiting for you."),
    JSON.stringify(rows.filter((r) => r.key.startsWith(`${GRID}/cm_g_static_content@`)).map((r) => r.source))
  );
  check(
    'code is never a row: no "use strict", no CSS ":", no selector, no media query',
    !rows.some((r) => /use strict|^:$|max-width|^\.|LazyLoad/.test(r.source)),
    JSON.stringify(rows.filter((r) => /use strict|^:$|max-width|^\.|LazyLoad/.test(r.source)).map((r) => r.source))
  );
  const tips = rows.filter((r) => /Tooltip/.test(r.field)).map((r) => r.source);
  check('data-tooltip is a row ("Grey", "Silver", "Pink Gold")', JSON.stringify(tips) === JSON.stringify(['Grey', 'Silver', 'Pink Gold']), JSON.stringify(tips));
  check('...and data-* not on the list (data-omni, data-header, data-modelcode) never is', !rows.some((r) => /^(header\d|bottom|top)$/.test(r.source)), '');
  const grey = bySource(rows, 'Grey');
  check(
    'one Key covers every place of a text in its block: "Grey" the colour name and its tooltip, Check "<hash>/2"',
    grey?.count === 2 &&
      grey.key === `${B5}@bodyHtml#${core.sourceHash('Grey')}` &&
      grey.hash === `${core.sourceHash('Grey')}/2` &&
      grey.field === 'Tab "Active" › Card "Galaxy Fit3" › Colour name\nTab "Active" › Card "Galaxy Fit3" › Details overlay › Tooltip (shown on hover)',
    JSON.stringify(grey)
  );
  const head = bySource(rows, 'Made to support your<br><span class="header-highlight">everyday wellness</span>');
  check(
    'the Key is the shape of the cell - the words and each tag by its name - the Check the cell itself',
    head?.key === `${B5}@bodyHtml#${core.sourceHash('Made to support your<br><span>everyday wellness</span>')}` &&
      head.hash === `${core.sourceHash('Made to support your<br><span class="header-highlight">everyday wellness</span>')}/1` &&
      head.key.endsWith('#hb11688fa') &&
      head.hash === 'h0604d321/1',
    JSON.stringify(head)
  );
  check(
    'the Field says where a visitor sees it, and the Notes what is hidden',
    bySource(rows, 'Weight')?.field === 'Tab "Active" › Card "Galaxy Fit3" › Details overlay › Spec label' &&
      bySource(rows, 'Weight')?.notes?.includes('Hidden until the visitor clicks the "Active" tab') &&
      bySource(rows, 'Weight')?.notes?.includes('In an overlay that opens on click'),
    JSON.stringify(bySource(rows, 'Weight'))
  );
}

console.log('\n--- what the reader does with the parts of a sentence -------------------');

{
  const body = sc.readBody(`<p class="spec">Withstands up to 55${NBSP}°C heat, 9&nbsp;000 m altitude</p>\r\n<img src="/x.png" alt="Galaxy${NBSP}Buds" />\r\n<h2>Galaxy&nbsp;Buds</h2>`);
  const cells = body.units.map((u) => u.cell);
  check(
    'a no-break space is shown as &nbsp;, as written or stored as the character - only normal spaces and line breaks are collapsed',
    JSON.stringify(cells) === JSON.stringify(['Withstands up to 55&nbsp;°C heat, 9&nbsp;000 m altitude', 'Galaxy&nbsp;Buds', 'Galaxy&nbsp;Buds']),
    JSON.stringify(cells)
  );
  const t = clone(FIXTURE);
  nodeAt(t, GRID).cm_g_static_content__869640381.bodyHtml = `<h2>Galaxy&nbsp;Buds</h2>\r\n<img src="/x.png" alt="Galaxy${NBSP}Buds" />`;
  const buds = statics(t).filter((r) => r.source === 'Galaxy&nbsp;Buds');
  check('...so an alt with the character and a heading with &nbsp; are one row, one Key', buds.length === 1 && buds[0].count === 2, JSON.stringify(buds));
}
{
  const t = withBody(B2, (b) =>
    b.replace(
      '<a href="https://www.samsung.com/levant/apps/samsung-health/"',
      '<a href="https://www.samsung.com/levant/apps/samsung-health/" title="Open the Samsung Health App page" target="_blank"'
    )
  );
  const r = statics(t).filter((x) => x.key.startsWith(`${B2}@`));
  const sentence = r.find((x) => x.source.startsWith('All of our'));
  check(
    'a title on a link inside a sentence is a row of its own; the sentence shows the tag with its link only',
    !!bySource(r, 'Open the Samsung Health App page') &&
      bySource(r, 'Open the Samsung Health App page').field === 'Sub-headline › Hover text (title)' &&
      sentence.source.includes('<a href="https://www.samsung.com/levant/apps/samsung-health/">Samsung Health App</a>'),
    JSON.stringify(r.map((x) => [x.source.slice(0, 60), x.field]))
  );
}
{
  const t = withBody(B7, (b) => b.replace('Mention @samsunglevant', 'Mention <img src="/ig.svg" alt="Instagram" /> @samsunglevant'));
  const r = statics(t).filter((x) => x.key.startsWith(`${B7}@`));
  check(
    'an <img> between words stays in the sentence; its alt is a row of its own',
    !!bySource(r, 'Get hints, tips and more from other Samsung Galaxy devices. Mention <img> @samsunglevant for your chance to feature.') && !!bySource(r, 'Instagram'),
    JSON.stringify(r.map((x) => x.source))
  );
  check(
    '...and the handle is to be kept as written',
    bySource(r, 'Get hints, tips and more from other Samsung Galaxy devices. Mention <img> @samsunglevant for your chance to feature.')?.notes?.includes('Keep @samsunglevant as written'),
    ''
  );
}

console.log('\n--- the showcase script ------------------------------------------------');

{
  const script = rows.filter((r) => r.prop === 'footerInclude');
  const energy = bySource(script, 'Energy Score');
  check(
    'a string of the Footer at a spot that shows it is a row: its Key "@footerInclude#h…", its Field the line and the tile',
    energy?.key === `${B3}@footerInclude#${core.sourceHash('Energy Score')}` && energy.field === 'Footer script, line 75 › Tile "Energy Score" › Title' && energy.format === 'manual',
    JSON.stringify(energy)
  );
  check('...as is a label the script sets ("Close product details modal")', bySource(script, 'Close product details modal')?.field.startsWith('Footer script, line 180 › Screen-reader label'), JSON.stringify(bySource(script, 'Close product details modal')));
  const built = ['Open showcase container', 'Close showcase container'].map((s) => bySource(script, s));
  check(
    'the sentence the script builds from a choice is two whole sentences, each in the two lines that build it',
    built.every((b) => b && b.count === 2 && b.field === 'Footer script, line 52 › Built sentence\nFooter script, line 53 › Built sentence' && b.notes.includes('The code builds this sentence - write the whole sentence')),
    JSON.stringify(built)
  );
  check('50 strings and the 2 built sentences, every one for a developer', script.filter((r) => !/Built/.test(r.field)).reduce((n, r) => n + r.count, 0) === 50 && script.every((r) => r.format === 'manual'), String(script.length));
}

console.log('\n--- the sheet --------------------------------------------------------');

{
  const d = deck();
  const sheet = core.buildSheet(d.rows, { pagePath: PAGE, exportedAt: '2026-10-11 10:00' });
  const col = Object.fromEntries(sheet.columns.map((c, i) => [c.split(' ')[0], i]));
  const records = sheet.records.slice(0, -1);
  const staticRecords = records.filter((r) => /@(bodyHtml|footerInclude)#h/.test(r[col.Key]));
  const places = rows.reduce((n, r) => n + r.count, 0);
  check(
    '70 static rows, 104 places in the blocks plus 2 for the built sentences (each on two lines), 2 rows of page properties',
    staticRecords.length === 70 && records.length === 72 && rows.length === 71 && places === 106,
    `${staticRecords.length} static rows, ${records.length} rows, ${rows.length} keys, ${places} places`
  );
  check('no Key covers two texts, so none is left off', d.staticLeftOff?.length === 0, JSON.stringify(d.staticLeftOff));
  check('the longest cell is 309 characters - far inside what Excel holds', Math.max(...records.map((r) => r[col.Source].length)) === 309, '');
  check('the closing row says copy deck v4', sheet.records.at(-1)[col.Notes].includes('copy deck v4') && core.SHEET_VERSION === 4, sheet.records.at(-1)[col.Notes]);

  const learn = records.find((r) => r[col.Source] === 'Learn more');
  check(
    'identical texts merge across blocks: "Learn more" in the script and twice in block 5 is one row, each place on its own line with its block',
    learn?.[col.Key] === `${B3}@footerInclude#hd517a63a\n${B5}@bodyHtml#hd517a63a` &&
      learn?.[col.Check] === 'hd517a63a/1\nhd517a63a/2' &&
      learn?.[col.Field].split('\n').length === 3 &&
      learn?.[col.Field].split('\n').every((l) => /^[35]\/8 › /.test(l)) &&
      learn?.[col.Notes].startsWith('Used in 3 places - one translation for all of them'),
    JSON.stringify(learn)
  );
  check(
    '...and say who puts them in: the web team the markup, a developer the script',
    learn?.[col.Notes].includes('Static content - the web team puts this on the page') && learn?.[col.Notes].includes('Static content in the script - a developer puts this in'),
    learn?.[col.Notes]
  );
  const active = records.find((r) => r[col.Source] === 'Active');
  check('"Active" - a tab, an image alt and a heading in block 5 - is one row with one Key', active?.[col.Key].split('\n').length === 1 && active?.[col.Check].endsWith('/3'), JSON.stringify(active));
  const sentence = records.find((r) => r[col.Source].startsWith('All of our'));
  check(
    'a sentence with tags carries the tag rule, said once',
    sentence?.[col.Notes] ===
      "Static content - the web team puts this on the page · Keep every tag. You may move a tag to suit your word order, but not into or out of another tag. Do not change link addresses; the page's own link is kept.",
    sentence?.[col.Notes]
  );
  const grey = records.find((r) => r[col.Source] === 'Grey');
  check(
    'a words-only row says so, with what the visitor sees around it',
    ['Words only - no markup', 'Short label: 4 characters in English - keep it short', "Use the market's official colour name", 'Shown when the visitor points at a colour dot'].every((n) => grey?.[col.Notes].includes(n)),
    grey?.[col.Notes]
  );
  const spec = records.find((r) => r[col.Source].startsWith('Built to push boundaries'));
  check('numbers and units are pointed out', /Numbers and units: 55°C, 9,000m, 10 ATM, 3nm - use your market's format/.test(spec?.[col.Notes]), spec?.[col.Notes]);
}
{
  // A row of a text that is somewhere else on the sheet already is never put on it twice.
  const r = { key: 'a@bodyHtml#h00000001', source: 'One', field: 'x', places: [] };
  const merged = core.mergeRows([r, { ...r, source: 'Two' }, { ...r }]);
  check('one Key is one place: a second row with it is never put on the sheet', merged.length === 1 && merged[0].places.length === 1 && merged[0].source === 'One', JSON.stringify(merged));
}
{
  // The same words with another link: one Key would cover two texts. Kept off and listed, the rest of the block still exported.
  const t = withBody(B4, (b) => `${b}\r\n<p>Read <a href="/levant/a/">more</a></p>\r\n<p>Read <a href="/levant/b/">more</a></p>`);
  const d = deck(t);
  const mine = d.rows.filter((r) => r.key.startsWith(`${B4}@`));
  check(
    'two texts that would share a Key are left off the sheet and listed - the rest of the block is on it',
    d.staticLeftOff?.length === 1 &&
      JSON.stringify(d.staticLeftOff?.[0]?.texts) === JSON.stringify(['Read <a href="/levant/a/">more</a>', 'Read <a href="/levant/b/">more</a>']) &&
      d.staticLeftOff?.[0]?.section === 'Static content 4 of 8 · Find your perfect companion' &&
      !mine.some((r) => r.source.startsWith('Read')) &&
      mine.length === 2,
    JSON.stringify([d.staticLeftOff, mine.map((r) => r.source)])
  );
  check('...and Keys stay one per text across the whole sheet', new Set(d.rows.map((r) => r.key)).size === d.rows.length, '');
}

console.log('\n--- Keys that outlive edits around the words ------------------------------');

{
  const keysOf = (tree) => statics(tree).map((r) => r.key).join('\n');
  const checksOf = (tree) => statics(tree).map((r) => r.hash).join('\n');
  const css = withBody(B5, (b) => b.replace('content: ":";', 'content: "";\r\n          direction: rtl;'));
  check('a change to the block’s CSS changes no Key and no Check', keysOf(css) === keysOf() && checksOf(css) === checksOf(), '');
  const t = clone(FIXTURE);
  for (const node of Object.values(nodeAt(t, GRID))) {
    if (typeof node?.bodyHtml === 'string') node.bodyHtml = node.bodyHtml.replace(/\r\n/g, '\n').replace(/\n/g, '\n    ');
  }
  check('re-indenting a block, LF for CRLF, changes no Key and no Check', keysOf(t) === keysOf() && checksOf(t) === checksOf(), '');
  const moved = withBody(B2, (b) => b.split('https://www.samsung.com/levant/').join('https://www.samsung.com/levant_ar/'));
  const was = statics().find((r) => r.source.startsWith('All of our'));
  const now = statics(moved).find((r) => r.source.startsWith('All of our'));
  check('a link pointed elsewhere keeps the Key; only the Check, which is the cell, moves', keysOf(moved) === keysOf() && now.key === was.key && now.hash !== was.hash, '');

  // Imported onto the page with the link already re-pointed: listed, and the page's link is to be kept.
  const p = plan(moved, sheetOf(FIXTURE, (s) => (s === was.source ? s.replace('Samsung Health App', 'تطبيق Samsung Health') : null)));
  const r = p.rows.find((x) => x.key === was.key);
  check(
    '...the translation still applies by hand, with a word about the link',
    r?.status === 'manual' && r.warnings.some((w) => /A link or a class in this text changed on the page since the export - keep the page’s own/.test(w)),
    JSON.stringify(r)
  );
}

console.log('\n--- the import --------------------------------------------------------');

const FR = (s) => `[fr] ${s}`;
{
  const p = plan(FIXTURE, sheetOf(FIXTURE, FR));
  const mine = p.rows.filter((r) => r.category === 'static');
  check(
    'every static place of a translated sheet is listed to put in by hand - whole sentences - and none is written',
    mine.length === 71 && mine.every((r) => r.status === 'manual') && !p.writes.some((w) => /bodyHtml|Include/.test(w.prop)) && p.writes.length === 2,
    JSON.stringify(p.rows.filter((r) => r.status !== 'manual').map((r) => [r.key, r.status, r.message]))
  );
  check('...as text the block has, nothing missing from the sheet', p.notInSheet.length === 0 && p.warnings.length === 0, JSON.stringify([p.notInSheet.map((r) => r.source), p.warnings]));
  const script = mine.filter((r) => r.key.includes('@footerInclude#h'));
  check('the script’s strings too, for the developer - 26 of its own and "Learn more": listed, never refused as code', script.length === 27 && script.every((r) => r.status === 'manual'), String(script.length));
}
{
  // Pasted already: block 4's heading in French, a lowercase tooltip in block 5.
  const sheet = sheetOf(FIXTURE, (s) => ({ 'Find your perfect companion': 'Trouvez votre compagnon idéal', Silver: 'argent' })[s]);
  const pasted = clone(FIXTURE);
  nodeAt(pasted, B4).bodyHtml = nodeAt(pasted, B4).bodyHtml.replace('Find your perfect companion', 'Trouvez votre compagnon idéal');
  nodeAt(pasted, B5).bodyHtml = nodeAt(pasted, B5).bodyHtml.replace('data-tooltip="Silver"', 'data-tooltip="argent"');
  const p = plan(pasted, sheet);
  const heading = p.rows.find((r) => r.key === `${B4}@bodyHtml#${core.sourceHash('Find your perfect companion')}`);
  const silver = p.rows.find((r) => r.key === `${B5}@bodyHtml#${core.sourceHash('Silver')}`);
  check(
    'a text whose translation is in the block already is "already" - found by position-free shape, a lowercase word too',
    heading?.status === 'already' && silver?.status === 'already' && heading.message === 'The block already has this translation.',
    JSON.stringify([heading, silver])
  );
  check('...and the translation is not listed as text missing from the sheet', !p.notInSheet.some((r) => /Trouvez|argent/.test(r.source)), JSON.stringify(p.notInSheet.map((r) => r.source)));
}
{
  // English changed and added after the export.
  let body = nodeAt(FIXTURE, B5).bodyHtml;
  const at = body.lastIndexOf('Buy now');
  body = `${body.slice(0, at)}Buy it now${body.slice(at + 7)}`;
  const end = body.indexOf('</p>', body.indexOf('much more.')) + 4;
  body = `${body.slice(0, end)}\r\n                  <p class="ch-dt-19">Free delivery on all watches this week.</p>${body.slice(end)}`;
  body = body.replace('Own your daily wellbeing', 'Own your daily well-being');
  const now = clone(FIXTURE);
  nodeAt(now, B5).bodyHtml = body;
  const p = plan(now, sheetOf(FIXTURE, FR));
  const buy = p.rows.find((r) => r.current === 'Buy now');
  check('a text in fewer places than at the export is put in, with a warning', buy?.status === 'manual' && buy.warnings.includes('"Buy now": 2 places at export, 1 now - look at the block.'), JSON.stringify(buy));
  const gone = p.rows.find((r) => r.translation === FR('Own your daily wellbeing, with AI powered health tracking at your fingertips.'));
  check(
    'a text whose English is no longer in the block, nor its translation, is not found - and says what to do',
    gone?.status === 'notFound' && /^Not found: the block holds neither the English nor this translation\./.test(gone.message) && core.IMPORT_STATUS.notFound?.group === 'blocked',
    JSON.stringify(gone)
  );
  const added = p.notInSheet.filter((r) => r.path === B5).map((r) => r.source);
  check(
    'text in the block with no row on the sheet is listed: the English added or changed after the export',
    JSON.stringify(added) === JSON.stringify(['Own your daily well-being, with AI powered health tracking at your fingertips.', 'Buy it now', 'Free delivery on all watches this week.']),
    JSON.stringify(added)
  );
}
{
  const sheet = sheetOf(FIXTURE, (s) => ({ Grey: '<b>Gris</b>', 'Explore Samsung Health': 'Explorez <i>Samsung Health</i>', 'Pick your perfect fitness partner': 'Choisissez " onmouseover="alert(1)' })[s]);
  const p = plan(FIXTURE, sheet);
  const at = (s) => p.rows.find((r) => r.current === s);
  check(
    'markup in a row whose English has none is sent back: words only',
    at('Grey')?.status === 'invalid' && /^Words only/.test(at('Grey').message) && at('Explore Samsung Health')?.status === 'invalid',
    JSON.stringify([at('Grey'), at('Explore Samsung Health')])
  );
  check('a quote that closes the attribute it may go into is refused', at('Pick your perfect fitness partner')?.status === 'invalid' && /runs a script/.test(at('Pick your perfect fitness partner').message), JSON.stringify(at('Pick your perfect fitness partner')));
}
{
  // Hand-made Keys: a Header "text", a whole Footer, the whole Body - refused, never written.
  const node = nodeAt(FIXTURE, B3);
  const grid = [
    core.SHEET_COLUMNS,
    ['s', 'f', '', `${B3}@headerInclude#${core.sourceHash('x')}`, `${core.sourceHash('x')}/1`, 'x', 'y'],
    ['s', 'f', '', `${B3}@footerInclude`, core.sourceHash(node.footerInclude), node.footerInclude.slice(0, 50), 'y'],
    ['s', 'f', '', `${B5}@bodyHtml`, core.sourceHash(nodeAt(FIXTURE, B5).bodyHtml), 'x', 'y']
  ];
  const p = plan(FIXTURE, core.readSheet(grid));
  check(
    'a Header with a text Key is still code, a whole Footer or Body is still refused - nothing written',
    p.rows.length === 3 && p.rows.every((r) => r.status === 'invalid') && /Header \(CSS\) and Footer \(JavaScript\) are code/.test(p.rows[0].message) && /Static HTML is applied by hand/.test(p.rows[2].message) && !p.writes.length,
    JSON.stringify(p.rows.map((r) => [r.key, r.status, r.message]))
  );
}

{
  // A Check cell edited by hand: its count lost.
  const sheet = sheetOf(FIXTURE, (s) => (s === 'Galaxy Buds' ? 'Galaxy Buds (AR)' : null));
  const row = sheet.rows.find((r) => r.source === 'Galaxy Buds');
  row.check = row.check.split('/')[0];
  row.checks = [row.check];
  const r = plan(FIXTURE, sheet).rows.find((x) => x.sheetRow === row.sheetRow);
  check('a static row whose Check cell was edited is refused, and says so', r?.status === 'invalid' && /The Check cell of this row was changed/.test(r.message), JSON.stringify(r));
}

console.log('\n--- a sheet made before v4 --------------------------------------------');

{
  const old = sheetOf(FIXTURE, (s) => (s === 'Pick your perfect fitness partner' ? 'Choisissez votre partenaire fitness idéal' : null), { staticPieces: true });
  const p = plan(FIXTURE, old);
  const piece = p.rows.find((r) => /@bodyHtml#\d\d$/.test(r.key) && r.translation);
  check(
    'a v3 sheet, static HTML in pieces keyed by position, still imports into the Now / Becomes list',
    old.meta.version === 3 && piece?.status === 'manual' && piece.current === 'Pick your perfect fitness partner' && !p.writes.length,
    JSON.stringify(piece)
  );
  check('...with a word that it is older', p.warnings.includes('Made by an older DSY - export again to get whole sentences ready to paste.'), JSON.stringify(p.warnings));
  check(
    '...and the text not on it is read in pieces too: nothing listed that the sheet has',
    p.notInSheet.every((r) => !r.key.includes('#h')) && p.notInSheet.length === 0,
    JSON.stringify(p.notInSheet.map((r) => r.key))
  );
}

console.log('\n--- static HTML on the page itself ----------------------------------------');

{
  const t = clone(FIXTURE);
  t.bodyHtml = '<div class="promo"><p>Welcome to <a href="/levant/health/">Samsung Health</a> week.</p></div>';
  const d = core.extractCopyDeck(clone(t), { pagePath: PAGE });
  const own = d.rows.filter((r) => r.path === '');
  check(
    'a bodyHtml on jcr:content itself is static HTML: never offered as a field to add, its text a row to put in by hand',
    !d.newFields.some((f) => f.prop === 'bodyHtml') &&
      own.some((r) => r.key === `.@bodyHtml#${core.sourceHash('Welcome to <a>Samsung Health</a> week.')}` && r.format === 'manual' && r.category === 'static'),
    JSON.stringify([d.newFields, own.map((r) => [r.key, r.format])])
  );
  const added = core.extractCopyDeck(clone(t), { fields: { add: [{ component: 'page-static-gnb', prop: 'bodyHtml', group: 'copy' }] } });
  check('...even where it was added before: never ordinary copy', !added.rows.some((r) => r.prop === 'bodyHtml' && r.format !== 'manual'), '');
  const p = plan(t, sheetOf(t, (s) => (s.startsWith('Welcome') ? 'Bienvenue à la semaine <a href="/levant/health/">Samsung Health</a>.' : null)));
  const r = p.rows.find((x) => x.key.startsWith('.@bodyHtml#h'));
  check('...so the import lists it to put in by hand, and writes nothing of it', r?.status === 'manual' && !p.writes.some((w) => w.prop === 'bodyHtml'), JSON.stringify(r));
}

console.log('\n--- where the import says a text is ------------------------------------');

{
  // "Learn more": the script of block 3 and twice block 5 - one row, its Section the first place's.
  const p = plan(FIXTURE, sheetOf(FIXTURE, FR));
  const learn = p.rows.filter((r) => r.translation === FR('Learn more'));
  check(
    'each place of a row merged from several blocks is listed under its own block, as this page numbers it',
    learn.length === 2 &&
      learn.find((r) => r.key.startsWith(`${B3}@`))?.section === 'Static content 3 of 8 · Showcase (script) · Energy Score' &&
      learn.find((r) => r.key.startsWith(`${B5}@`))?.section === 'Static content 5 of 8 · Made to support your everyday wellness',
    JSON.stringify(learn.map((r) => [r.key, r.section]))
  );

  // The same row with a component's "Learn more" before the blocks: the sheet's Section is that component's.
  const t = clone(FIXTURE);
  const grid = nodeAt(t, GRID);
  const entries = Object.entries(grid);
  for (const k of Object.keys(grid)) delete grid[k];
  grid.ks_feature = { 'sling:resourceType': 'samsung/components/content/consumer/global/pd/pd-g-feature-benefit', headlineText: 'Learn more' };
  for (const [k, v] of entries) grid[k] = v;
  const sheet = sheetOf(t, FR);
  const row = sheet.rows.find((r) => r.source === 'Learn more');
  const q = plan(t, sheet);
  const at = (prefix) => q.rows.find((r) => r.key.startsWith(prefix));
  check(
    '...and with another component first, the component’s place is under the sheet’s Section, each block’s under its block',
    /^01 · Feature Benefit/.test(row?.section) &&
      at(`${GRID}/ks_feature@`)?.section === row.section &&
      at(`${B3}@`)?.section.startsWith('Static content 3 of 8') &&
      at(`${B5}@`)?.section.startsWith('Static content 5 of 8'),
    JSON.stringify(q.rows.filter((r) => r.translation === FR('Learn more')).map((r) => [r.key, r.section]))
  );

  // English changed since the export: the row has no place on the page, and still names its block.
  const now = withBody(B4, (b) => b.replace('Find your perfect companion', 'Find your ideal companion'));
  const gone = plan(now, sheetOf(FIXTURE, FR)).rows.find((r) => r.translation === FR('Find your perfect companion'));
  check('...a text no longer in its block too', gone?.status === 'notFound' && gone.section === 'Static content 4 of 8 · Find your ideal companion', JSON.stringify(gone));
}

console.log('\n--- put in already ----------------------------------------------------');

{
  // The developer puts the built sentence in as design section 6 says: the template on lines 52 and 53 becomes two plain strings.
  const TEMPLATE = '`${e[6] === "open" ? "Close" : "Open"} showcase container`';
  const fr = { 'Open showcase container': 'Ouvrir la vitrine', 'Close showcase container': 'Fermer la vitrine', Fitness: 'fitness' };
  const sheet = sheetOf(FIXTURE, (s) => fr[s]);
  const t = clone(FIXTURE);
  const footer = nodeAt(t, B3).footerInclude;
  nodeAt(t, B3).footerInclude = footer
    .split(TEMPLATE)
    .join('e[6] === "open" ? "Fermer la vitrine" : "Ouvrir la vitrine"')
    .replace('title: "Fitness"', 'title: "fitness"');
  const p = plan(t, sheet);
  const status = (s) => p.rows.find((r) => r.translation === s)?.status;
  check(
    'a sentence the script built, put in by the developer as two plain strings, is there already',
    footer.split(TEMPLATE).length === 3 && status('Ouvrir la vitrine') === 'already' && status('Fermer la vitrine') === 'already',
    JSON.stringify(p.rows.filter((r) => r.translation).map((r) => [r.translation, r.status, r.message]))
  );
  check('...and so is a title put in as one lowercase word', status('fitness') === 'already', status('fitness'));
}
{
  // Arabic, as Excel hands it back: a direction mark and curly quotes inside the tag. Once pasted, the tag is clean.
  const link = rows.find((r) => r.source.startsWith('All of our Galaxy'));
  const href = 'https://www.samsung.com/levant/apps/samsung-health/';
  const ar = `جميع ساعات Galaxy تعمل مع ‏<‏a href=“${href}”>تطبيق Samsung Health</a>‏ الذكي.`;
  const sheet = sheetOf(FIXTURE, (s) => (s === link.source ? ar : null));
  const fresh = plan(FIXTURE, sheet).rows.find((r) => r.key === link.key);
  check('an Arabic cell with a direction mark and curly quotes inside its tag is listed to put in', fresh?.status === 'manual', JSON.stringify(fresh));

  const pasted = clone(FIXTURE);
  const body = nodeAt(pasted, B2).bodyHtml;
  const start = body.indexOf('All of our Galaxy');
  const end = body.indexOf('insights.', start) + 'insights.'.length;
  nodeAt(pasted, B2).bodyHtml = `${body.slice(0, start)}جميع ساعات Galaxy تعمل مع ‏<a href="${href}">تطبيق Samsung Health</a>‏ الذكي.${body.slice(end)}`;
  const p = plan(pasted, sheet);
  const r = p.rows.find((x) => x.key === link.key);
  check(
    '...and once pasted, its tag clean, it is there already - and not a text missing from the sheet',
    r?.status === 'already' && !p.notInSheet.some((x) => x.path === B2),
    JSON.stringify([r, p.notInSheet.filter((x) => x.path === B2).map((x) => x.source)])
  );
  const hidden = plan(FIXTURE, sheetOf(FIXTURE, (s) => (s === link.source ? `${ar} <‏img src=x onerror=alert(1)>` : null))).rows.find((x) => x.key === link.key);
  check('...but a tag hiding behind a direction mark is read as the tag it becomes: a script is refused', hidden?.status === 'invalid' && /runs a script/.test(hidden.message), JSON.stringify(hidden));
}

console.log('\n--- texts kept off the sheet -------------------------------------------');

{
  // The same words twice in block 4 with another link: kept off the sheet - and the import lists them, to translate by hand.
  const t = withBody(B4, (b) => `${b}\r\n<p>Read <a href="/levant/a/">more</a></p>\r\n<p>Read <a href="/levant/b/">more</a></p>`);
  const p = plan(t, sheetOf(t, FR));
  const off = p.notInSheet.filter((r) => r.path === B4);
  check(
    'texts one Key would cover are listed by the import as on the page but not in the sheet, under their block',
    JSON.stringify(off.map((r) => r.source)) === JSON.stringify(['Read <a href="/levant/a/">more</a>', 'Read <a href="/levant/b/">more</a>']) &&
      off.every((r) => r.section === 'Static content 4 of 8 · Find your perfect companion' && r.field === 'Paragraph'),
    JSON.stringify(off)
  );

  // Exported before the second link was added: the row's Key covers two texts on the page now.
  const before = withBody(B4, (b) => `${b}\r\n<p>Read <a href="/levant/a/">more</a></p>`);
  const late = plan(t, sheetOf(before, FR)).rows.find((r) => r.translation === FR('Read <a href="/levant/a/">more</a>'));
  check(
    '...and a row whose Key covers two texts now is held back, saying why',
    late?.status === 'changed' && late.message === 'The block has these words 2 times now, each with another link or style - translate them by hand in the block.',
    JSON.stringify(late)
  );
}
{
  // A terms block: 400 sentences in one paragraph, joined by <br> - one text, longer than an Excel cell holds.
  const terms = Array.from({ length: 400 }, (_, i) => `Clause ${i + 1}: the offer is valid while stocks last, at participating stores only.`).join('<br>\r\n');
  const t = withBody(B8, (b) => `${b}\r\n<p class="terms">${terms}</p>`);
  const d = deck(t);
  const sheet = core.buildSheet(d.rows, { pagePath: PAGE });
  const long = d.staticLeftOff.find((l) => l.why === 'too long');
  check(
    'a text too long for one Excel cell is kept off the sheet and listed - the rest of the page still exports',
    long?.texts[0].length > 32767 && !d.rows.some((r) => r.source.startsWith('Clause 1:')) && core.toCsv(sheet).length > 0 && d.rows.filter((r) => r.category === 'static').length === 71,
    JSON.stringify(d.staticLeftOff.map((l) => [l.why, l.texts[0].length]))
  );
  const listed = plan(t, sheetOf(t, FR)).notInSheet.find((r) => r.source.startsWith('Clause 1:'));
  check('...and the import lists it, cut short, to translate in the block', listed?.source.length === 300 && listed.source.endsWith('…') && listed.section.startsWith('Static content 8 of 8'), JSON.stringify(listed));
}

console.log('\n--- what a row says ----------------------------------------------------');

{
  const sheet = core.buildSheet(deck().rows, { pagePath: PAGE });
  const col = Object.fromEntries(sheet.columns.map((c, i) => [c.split(' ')[0], i]));
  const notes = (source) => sheet.records.find((r) => r[col.Source] === source)?.[col.Notes].split(' · ');
  const active = notes('Active');
  check(
    'a note about some of a row’s places says how many: "Active" is hidden in two of its three places, and a tab label in one',
    active?.includes('Hidden until the visitor clicks the "Active" tab (2 of the 3 places)') &&
      active.includes('Short label: 6 characters in English - keep it short (1 of the 3 places)') &&
      active.includes('Words only - no markup'),
    JSON.stringify(active)
  );
  check(
    '...one about all of them says it plainly: "Grey" is hidden and a colour in both, in an overlay in one',
    notes('Grey')?.includes('Hidden until the visitor clicks the "Active" tab') &&
      notes('Grey').includes("Use the market's official colour name") &&
      notes('Grey').includes('In an overlay that opens on click (1 of the 2 places)'),
    JSON.stringify(notes('Grey'))
  );

  const tip = sc.readBlock({ bodyHtml: '<p>Water resistant <span class="info" data-tooltip="Tested to 50 metres for 10 minutes">i</span></p>' });
  const [place] = sc.blockTexts(tip).find((x) => x.cell === 'Tested to 50 metres for 10 minutes').places;
  check(
    'a tooltip that is not on a colour dot is no colour’s name',
    place.hints?.includes('Shown when the visitor points at it') && !place.hints?.some((h) => /colour|Short label/.test(h)),
    JSON.stringify(place)
  );
  const cells = sc.readBody('<dl><dt>Heat</dt><dd>55°C</dd></dl>').units.map((u) => u.cell);
  check('a size with a degree sign reads as words: "55°C"', cells.includes('55°C'), JSON.stringify(cells));
}
{
  // A quote in a script's string, or a backslash, ends it early: the developer is told to escape it.
  const sheet = sheetOf(FIXTURE, (s) => ({ 'Energy Score': 'Score "énergie"', 'Heart health': 'Santé cardiaque' })[s]);
  const p = plan(FIXTURE, sheet);
  const energy = p.rows.find((r) => r.translation === 'Score "énergie"');
  const heart = p.rows.find((r) => r.translation === 'Santé cardiaque');
  check(
    'a script’s string translated with its own quote in it says how it is escaped',
    energy?.status === 'manual' && energy.warnings.includes('Has " in it: in the script it is written \\" instead, or the script stops working. DSY does this when it writes the Footer.') && heart?.warnings.length === 0,
    JSON.stringify([energy, heart])
  );
}
{
  // A tooltip stored without quotes: a space is enough to start an attribute of its own.
  const t = withBody(B5, (b) => b.replace('data-tooltip="Silver"', 'data-tooltip=Silver'));
  const p = plan(t, sheetOf(t, (s) => ({ Silver: 'Argent onmouseover=alert(1)', 'Pink Gold': 'Or rose onmouseover=alert(1)' })[s]));
  const silver = p.rows.find((r) => r.translation.startsWith('Argent'));
  const pink = p.rows.find((r) => r.translation.startsWith('Or rose'));
  check(
    'into an attribute stored without quotes, a handler is refused without a quote before it - into a quoted one, it is only words',
    silver?.status === 'invalid' && /runs a script/.test(silver.message) && pink?.status === 'manual',
    JSON.stringify([silver, pink])
  );
}

console.log('\n--- the hand-offs: links, images, the developer, Check all ------------');

{
  const h = await import(pathToFileURL(base + 'src/features/copy-deck-import/hand-offs.js'));
  const sheet = core.buildSheet(deck().rows, { pagePath: PAGE, exportedAt: '2026-10-12 10:00' });
  const [S, T] = ['Source text', 'Translation'].map((c) => sheet.columns.indexOf(c));
  for (const rec of sheet.records.slice(0, -1)) rec[T] = rec[S] === 'Galaxy Fit3' ? rec[S] : `[fr] ${rec[S]}`;
  const read = core.readSheet([sheet.columns, ...sheet.records]);
  const planOf = (tree) => core.planImport(clone(tree), read, { pagePath: TARGET });
  const plan = planOf(FIXTURE);
  const block = (path) => plan.staticBlocks.find((b) => b.path === path);
  const links = (path) => h.linksOf(block(path).old, PAGE, TARGET);

  const l2 = links(B2);
  const l3 = links(B3);
  const l5 = links(B5);
  check(
    'links to the sheet’s site, per block: block 2 one in its Body, block 3 five in its Footer, block 5 its Body’s, each with what re-pointing makes of it',
    l2.length === 1 && l2[0].to === 'https://www.samsung.com/levant_ar/apps/samsung-health/' && l2[0].field === 'Body(HTML)' && !l2[0].product &&
      l3.length === 5 && l3.every((l) => l.field === 'Footer(Javascript)' && l.to.startsWith('/levant_ar/') && l.product) &&
      l5.length > 0 && l5.every((l) => l.field === 'Body(HTML)' && l.to.includes('/levant_ar/')),
    JSON.stringify([l2, l3.length, l5.map((l) => l.link)])
  );
  check(
    '...a link to one product’s page is marked, to check that page exists on the new site; no picture or DAM path is ever a link',
    l5.filter((l) => l.product).length >= 1 && l5.some((l) => /sm-r390nzaamea\/buy\/$/.test(l.link) && l.product) && [...l2, ...l3, ...l5].every((l) => !/\/content\/dam\/|\.(png|jpe?g|webp|mp4)/i.test(l.link)),
    JSON.stringify(l5.map((l) => [l.link.slice(-30), l.product]))
  );
  const third = h.linksOf({ bodyHtml: '<a href="https://www.samsung.com/uk/watches/">UK</a>' }, PAGE, PAGE);
  check('...and a link to any third site is listed to check, never re-pointed - on one site too', third.length === 1 && third[0].site === 'uk' && third[0].to === null, JSON.stringify(third));

  // Re-pointing, opted in: inside the prepared value only.
  const b5 = block(B5);
  const rec5 = { old: b5.old, prepared: b5.prepared, items: b5.items };
  const r = h.repointLinks(rec5, PAGE, TARGET);
  const dam = (s) => (s.match(/\/content\/dam\/[^"'\s)]+/g) || []).join('|');
  check(
    're-pointing changes the links in the prepared value and nothing else - every picture and DAM path as it was',
    !r.refused && r.links.length === 4 && r.rec.prepared !== b5.prepared && !/www\.samsung\.com\/levant\//.test(r.rec.prepared) &&
      dam(r.rec.prepared) === dam(b5.prepared) && dam(b5.prepared).includes('/content/dam/samsung/levant/') &&
      r.rec.prepared.split('/levant/').join('/levant_ar/') === b5.prepared.split('/levant/').join('/levant_ar/') && r.rec.old === b5.old,
    r.refused || `${r.links.length} links`
  );
  const placed = r.rec.items.filter((i) => i.status === 'placed').length;
  check(
    '...the value passes the three checks again, with the link changes planned - every text still placed, and Check again knows the paste',
    placed === b5.items.filter((i) => i.status === 'placed').length && sc.pasteStatus({ ...b5.old, bodyHtml: r.rec.prepared }, r.rec).status === 'pasted' && sc.pasteStatus(b5.old, r.rec).status === 'not pasted',
    `${placed} placed`
  );
  check('...a block with no link to re-point is left as it was', h.repointLinks({ old: block(B4).old, prepared: block(B4).prepared, items: block(B4).items }, PAGE, TARGET).links.length === 0, '');
  const picture = h.repointLinks({ old: { bodyHtml: '<p>Hi</p><img src="/levant/promo.png" alt="x">' }, prepared: '<p>Salut</p><img src="/levant/promo.png" alt="x">', items: [] }, PAGE, TARGET);
  check('...and one where the rules would touch a picture is refused, left as it was', /would change a picture or a DAM path/.test(picture.refused || ''), JSON.stringify(picture));

  // Images, for a designer.
  const i1 = h.imagesOf(nodeAt(FIXTURE, `${GRID}/cm_g_static_content`));
  const i5 = h.imagesOf(b5.old);
  const i3 = h.imagesOf(block(B3).old);
  check(
    'images per block, a desktop file and its mobile one together: block 1’s key visual, block 5’s, and the showcase’s pictures from its script',
    i1.length === 1 && i1[0].say === 'mep-kv-dt.jpg (desktop) + mep-kv-mo-v3.jpg (mobile)' &&
      i5.some((x) => x.say === 'wellness-kv-dt-webp.png (desktop) + wellness-kv-mo-webp-v2.png (mobile)') && i5.some((x) => x.say === 'active-1-mo.mp4 (mobile)') &&
      i3.length > 10 && i3.every((x) => x.field === 'Footer(Javascript)'),
    JSON.stringify([i1, i5.map((x) => x.say), i3.length])
  );

  // The developer's report.
  const d1 = h.developerReport(nodeAt(FIXTURE, `${GRID}/cm_g_static_content`));
  const d3 = h.developerReport(block(B3).old);
  const d5 = h.developerReport(b5.old);
  check(
    'for the developer: block 1’s left: 32px and SamsungSharpSans, block 3’s toLeft/rightFixed and SamsungOne, block 5’s "ArrowRight" and its script',
    d1.includes('Left/right layout (left: 32px, left: 0) - check it for a right-to-left language') &&
      d1.includes('Fonts SamsungSharpSans - may have Latin letters only: check the new language shows in them') &&
      d3.includes('Left/right layout (rightFixed, toLeft) - check it for a right-to-left language') && d3.some((x) => x.startsWith('Fonts SamsungOne')) &&
      d5.includes('"ArrowRight" key handling - the arrows swap in a right-to-left language') && d5.includes('1 <script> left unchanged'),
    JSON.stringify([d1, d3, d5])
  );

  // Check all: what is still English, before and after block 5 is pasted.
  const left = h.englishLeft(plan);
  const in5 = (l) => l.filter((x) => x.where.startsWith(block(B5).label));
  const pasted = clone(FIXTURE);
  nodeAt(pasted, B5).bodyHtml = b5.prepared;
  const after = h.englishLeft(planOf(pasted));
  check(
    'Check all lists every text whose English is still on the page: the normal rows not written, each block’s texts not pasted, the Footer’s',
    left.some((x) => x.where === 'Page properties › Page title' && x.why.startsWith('not written yet')) &&
      in5(left).length > 20 && in5(left).every((x) => x.why === 'not pasted yet' || x.why === 'the sheet keeps the English') &&
      left.some((x) => x.where.endsWith('Footer(Javascript)') && x.why === 'still in the script - not written yet') &&
      left.some((x) => x.text === 'Galaxy Fit3' && x.why === 'the sheet keeps the English'),
    JSON.stringify(left.slice(0, 3))
  );
  check(
    '...and once block 5 is pasted, only what the sheet keeps in English is left of it',
    in5(after).every((x) => x.why === 'the sheet keeps the English') && after.length < left.length,
    JSON.stringify(in5(after).slice(0, 3))
  );
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
