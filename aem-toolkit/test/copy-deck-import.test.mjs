/* The translated copy deck coming back: reading it the way Excel hands it over,
 * and checking every row against the page as it is now. The sheet is made by
 * the real export, "translated", then passed through Excel's clipboard format
 * - so what is tested is the round trip, not a hand-written sheet.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const base = 'D:/chrome-extensions/aem-toolkit/';
const core = await import(pathToFileURL(base + 'src/features/copy-deck/core.js'));
const { toXlsx, readXlsx } = await import(pathToFileURL(base + 'src/features/copy-deck/xlsx.js'));
const { AemClient } = await import(pathToFileURL(base + 'src/core/aem-client.js'));
const { actions } = await import(pathToFileURL(base + 'src/features/copy-deck-import/worker.js'));

const FIXTURE = JSON.parse(readFileSync(base + 'test/fixtures/copy-deck-za-tvs.json', 'utf8'));
const SOURCE = '/content/samsung/za/tvs';
const TARGET = '/content/samsung/nl/tvs';
const clone = (o) => JSON.parse(JSON.stringify(o));

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};

/** Excel's clipboard: tabs and CRLF, a cell quoted only when it holds a line break or a tab. */
const clipboard = (grid) =>
  grid.map((r) => r.map((c) => (/[\n\r\t]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join('\t')).join('\r\n');

/**
 * Export `tree`, fill in translations by key - any of a row's keys - and hand
 * back what Excel would paste. `placeholders` makes the sheet of copy deck v2:
 * rich text as <a1> placeholders, a row of its own for a link's title.
 * `version: 3` the sheet of copy deck v3: static HTML in pieces, "…@bodyHtml#03".
 */
function roundTrip(tree, translations, { pagePath = SOURCE, include, fields, placeholders = false, version = core.SHEET_VERSION } = {}) {
  const deck = core.extractCopyDeck(tree, { pagePath, fields, placeholders, staticPieces: placeholders || version < 4 });
  const sheet = core.buildSheet(core.selectRows(deck.rows, include), { pagePath, exportedAt: '2026-09-27 14:30' });
  const K = sheet.columns.indexOf('Key (do not edit)');
  const T = sheet.columns.indexOf('Translation');
  const N = sheet.columns.indexOf('Notes');
  for (const rec of sheet.records) {
    const hit = rec[K].split('\n').find((k) => k in translations);
    if (hit) rec[T] = translations[hit];
  }
  const made = placeholders ? 2 : version;
  sheet.records.at(-1)[N] = sheet.records.at(-1)[N].replace(/copy deck v\d+/, `copy deck v${made}`);
  return { sheet, text: clipboard([sheet.columns, ...sheet.records]) };
}

/** The Key of a text of static HTML without tags, as the export makes it: its shape is the text itself. */
const staticKey = (path, text) => `${path}@bodyHtml#${core.sourceHash(text)}`;

/** The sheet as copy deck v1 made it: one row per place, a repeat marked "Same as row N". */
function legacyText(tree, translations, { pagePath = SOURCE } = {}) {
  const rows = core.selectRows(core.extractCopyDeck(tree, { pagePath, staticPieces: true }).rows);
  const first = new Map();
  const records = rows.map((r, i) => {
    const same = first.get(r.source);
    if (!same) first.set(r.source, i + 2);
    return [r.section, r.field, same ? `Same as row ${same} - leave blank to use that translation` : '', r.key, r.hash, r.source, translations[r.key] ?? ''];
  });
  records.push(['#END - keep this row, it tells the import the sheet is complete', pagePath, `rows=${rows.length} · exported 2026-09-27 14:30 · copy deck v1`, '#meta', 'h0', '', '']);
  return clipboard([core.SHEET_COLUMNS, ...records]);
}

const plan = (target, text, pagePath = TARGET) => core.planImport(target, core.readSheet(core.gridFromText(text)), { pagePath });
const rowOf = (p, key) => p.rows.find((r) => r.key === key);
const writeOf = (p, path, prop) => p.writes.find((w) => w.path === path && w.prop === prop);
const nodeAt0 = (c, path) => path.split('/').reduce((n, s) => n?.[s], c);

const HERO = 'root/responsivegrid/pd_g_feature_benefit';
const MICRO = 'root/responsivegrid/pd_g_feature_benefit_1828229403';
const WHY = 'root/responsivegrid/pd_g_feature_benefit_427973104/list/item2';

console.log('--- reading what Excel hands over ------------------------------------');

{
  const g = core.parseDelimited('"Best TV" says critics\t"two\nlines"\tplain\r\nx\t\ty', { excel: true });
  check('a cell that only starts with a quote keeps its quotes', g[0][0] === '"Best TV" says critics', JSON.stringify(g));
  check('a quoted cell with a line break is one cell', g[0][1] === 'two\nlines' && g[0][2] === 'plain', JSON.stringify(g));
  check('an empty cell stays in its column', JSON.stringify(g[1]) === JSON.stringify(['x', '', 'y']), JSON.stringify(g[1]));
}
check("a CSV saved with ';' is read as such", core.detectDelimiter('a;b;"c,d"\r\n1;2;3') === ';', core.detectDelimiter('a;b;"c,d"'));
check('a CSV with quoted commas is read as such', JSON.stringify(core.gridFromText('a,"b, c",d')[0]) === JSON.stringify(['a', 'b, c', 'd']), '');
check('a BOM is ignored', core.gridFromText('\uFEFFKey\tTranslation')[0][0] === 'Key', '');
check('a DRM-encrypted file is recognised', core.isDrmProtected(new TextEncoder().encode('<## NASCA DRM FILE - VER1.00 ##>rA!')), '');
check('...and an ordinary one is not', !core.isDrmProtected(new TextEncoder().encode('PK\u0003\u0004 not drm')), '');

{
  const { text } = roundTrip(clone(FIXTURE), {});
  const sheet = core.readSheet(core.gridFromText(text));
  check('the sheet is read, with its closing row', sheet.ok && sheet.meta?.pagePath === SOURCE && sheet.meta.rows === sheet.rows.length, JSON.stringify(sheet.meta));
  check('rows remember where they are on the sheet', sheet.rows[0].sheetRow === 2, String(sheet.rows[0].sheetRow));
  const moved = core.gridFromText(text).map((r) => [r[6], r[3], r[4], r[0], r[1], r[2], r[5]]);
  const again = core.readSheet(moved);
  check('columns are found by header, wherever they are', again.ok && again.rows.length === sheet.rows.length && again.rows[0].key === sheet.rows[0].key, '');
}
check('no header row is refused, and says why', !core.readSheet([['a', 'b'], ['c', 'd']]).ok && /header row/.test(core.readSheet([['a']]).problem), '');
check('a sheet without the Check column is refused', /Check column/.test(core.readSheet([['Key (do not edit)', 'Translation'], ['k', 't']]).problem || ''), '');

console.log('\n--- the round trip ---------------------------------------------------');

{
  const { text } = roundTrip(clone(FIXTURE), {
    '.@jcr:title': 'Koop Smart TVs | OLED, QLED en Neo QLED TVs',
    [`${HERO}@headlineText`]: 'Ontdek Samsung TVs\nvoor elke manier van kijken',
    [`${MICRO}@description`]: 'Samsung Micro RGB TVs met Color Booster Pro<sup>1</sup> en Glare Free<sup>2</sup>.',
    [`${MICRO}/list/item0@text`]: 'Meer informatie',
    [`${WHY}@headlineText`]: 'Waarom OLED',
    [staticKey('root/responsivegrid/cm_g_static_content_', 'Find the right TV size for your space')]: 'Vind het juiste formaat'
  });
  const p = plan(clone(FIXTURE), text);
  check('a plain text is ready, and written as typed', writeOf(p, '', 'jcr:title')?.to === 'Koop Smart TVs | OLED, QLED en Neo QLED TVs', JSON.stringify(writeOf(p, '', 'jcr:title')));
  check('a line break is stored the way the page stores it (CRLF)', writeOf(p, HERO, 'headlineText')?.to === 'Ontdek Samsung TVs\r\nvoor elke manier van kijken', JSON.stringify(writeOf(p, HERO, 'headlineText')?.to));
  check('<sup> is kept', writeOf(p, MICRO, 'description')?.to.includes('Color Booster Pro<sup>1</sup> en Glare Free<sup>2</sup>'), '');
  check('the source’s trailing space is put back ("Why OLED ")', writeOf(p, WHY, 'headlineText')?.to === 'Waarom OLED ', JSON.stringify(writeOf(p, WHY, 'headlineText')?.to));

  const also = rowOf(p, `${WHY}@textForLinkAction1`);
  check(
    '"Learn more" in two places is one row, and its translation goes to both',
    also?.status === 'ready' && also.sheetRow === rowOf(p, `${MICRO}/list/item0@text`).sheetRow && writeOf(p, WHY, 'textForLinkAction1')?.to === 'Meer informatie',
    JSON.stringify(also)
  );
  check('a different text is not reused ("View all" stays)', rowOf(p, `${MICRO}/list/item1@text`)?.status === 'untranslated', rowOf(p, `${MICRO}/list/item1@text`)?.status);
  check(
    'static HTML is listed to apply by hand, never written',
    rowOf(p, staticKey('root/responsivegrid/cm_g_static_content_', 'Find the right TV size for your space'))?.status === 'manual' && !p.writes.some((w) => w.prop === 'bodyHtml'),
    ''
  );
  check('every write names the sheet rows it comes from', p.writes.every((w) => w.rows.length > 0), '');
  check('the page it came from is known', p.exportedFrom === SOURCE && p.warnings.length === 0, JSON.stringify(p.warnings));
}

console.log('\n--- one row, several places -----------------------------------------');

{
  const { sheet, text } = roundTrip(clone(FIXTURE), { [`${MICRO}/list/item0@text`]: 'Meer informatie' });
  const K = sheet.columns.indexOf('Key (do not edit)');
  const C = sheet.columns.indexOf('Check (do not edit)');
  const rec = sheet.records.find((r) => r[K].split('\n').includes(`${WHY}@textForLinkAction1`));
  const keys = rec[K].split('\n');
  check('a row of a text in several places names every place, a Key and a Check per line', keys.length >= 2 && rec[C].split('\n').length === keys.length, JSON.stringify(rec));
  const read = core.readSheet(core.gridFromText(text));
  const row = read.rows.find((r) => r.keys.includes(`${WHY}@textForLinkAction1`));
  check('...and is read back as one row with all its places', row && row.keys.length === keys.length && row.checks.length === keys.length, JSON.stringify(row));
  check('the sheet is complete: its row count is rows, not places', read.meta.rows === read.rows.length && !plan(clone(FIXTURE), text).warnings.length, JSON.stringify(read.meta));

  const target = clone(FIXTURE);
  nodeAt0(target, WHY).textForLinkAction1 = 'Discover';
  const p = plan(target, text);
  check(
    'a place changed on the page since the export is blocked; the others in its row are still written',
    rowOf(p, `${WHY}@textForLinkAction1`)?.status === 'changed' && writeOf(p, `${MICRO}/list/item0`, 'text')?.to === 'Meer informatie',
    JSON.stringify(p.rows.filter((r) => r.sheetRow === row.sheetRow).map((r) => [r.key, r.status]))
  );

  const cut = core.gridFromText(text).map((r) => (r[3] === rec[K] ? [...r.slice(0, 4), r[4].split('\n')[0], ...r.slice(5)] : r));
  const broken = core.planImport(clone(FIXTURE), core.readSheet(cut), { pagePath: TARGET }).rows.filter((r) => keys.includes(r.key));
  check(
    'a row whose Key and Check no longer pair up line for line is blocked, every place of it',
    broken.length === keys.length && broken.every((r) => r.status === 'invalid' && /one line per place/.test(r.message)),
    JSON.stringify(broken.map((r) => [r.key, r.status]))
  );
}
{
  // A sheet exported before rows were merged: one row per place, repeats left blank.
  const p = plan(clone(FIXTURE), legacyText(clone(FIXTURE), { [`${MICRO}/list/item0@text`]: 'Meer informatie' }));
  const reuse = rowOf(p, `${WHY}@textForLinkAction1`);
  check('an older sheet still imports: a blank repeat takes the translation of the first "Learn more"', reuse?.status === 'reuse' && writeOf(p, WHY, 'textForLinkAction1')?.to === 'Meer informatie', JSON.stringify(reuse));
  check('...and says where it came from', reuse?.reusedFrom === rowOf(p, `${MICRO}/list/item0@text`).sheetRow && reuse.sheetRow !== reuse.reusedFrom, '');
  check(
    '...and its row count still adds up: the one warning is that its static HTML is in pieces',
    JSON.stringify(p.warnings) === JSON.stringify(['Made by an older DSY - export again to get whole sentences ready to paste.']),
    JSON.stringify(p.warnings)
  );
}

console.log('\n--- rich text, written out in full (v3) -------------------------------');

const RICH = 'root/responsivegrid/cm_g_text_block_copy_1409814884';
const richTree = () => {
  const t = clone(FIXTURE);
  t.root.responsivegrid.cm_g_text_block_copy_1409814884.description =
    'See <a href="/za/offers/" title="View all offers" target="_self">our offers</a> today.<br>Only online.';
  return t;
};
{
  const { sheet, text } = roundTrip(richTree(), {
    [`${RICH}@description`]: 'Bekijk <a href="/za/offers/" title="Alle aanbiedingen" target="_self">onze aanbiedingen</a> vandaag.<br>Alleen online.'
  });
  const rec = sheet.records.find((r) => r[3] === `${RICH}@description`);
  check('the sheet has the text as stored: the link, its URL and its title', rec[5] === richTree().root.responsivegrid.cm_g_text_block_copy_1409814884.description, rec[5]);
  check('...and no row of its own for the title', !sheet.records.some((r) => r[3].includes('~')), '');
  const p = plan(richTree(), text);
  check(
    'the translation, tags and all, is what is written',
    rowOf(p, `${RICH}@description`)?.status === 'ready' &&
      writeOf(p, RICH, 'description')?.to === 'Bekijk <a href="/za/offers/" title="Alle aanbiedingen" target="_self">onze aanbiedingen</a> vandaag.<br>Alleen online.' &&
      !rowOf(p, `${RICH}@description`).warnings.length,
    JSON.stringify([rowOf(p, `${RICH}@description`), writeOf(p, RICH, 'description')?.to])
  );
}
const full = (translation) => {
  const { text } = roundTrip(richTree(), { [`${RICH}@description`]: translation });
  return rowOf(plan(richTree(), text), `${RICH}@description`);
};
{
  const r = full('Bekijk <a href="/nl/aanbiedingen/" title="Alle aanbiedingen">onze aanbiedingen</a> vandaag.<br>Alleen online.');
  check('another link is the translation team’s to set - written, and pointed out', r.status === 'ready' && r.warnings.some((w) => /Links differ from the source \(source: \/za\/offers\/; translation: \/nl\/aanbiedingen\/\)/.test(w)), JSON.stringify(r));
}
{
  const r = full('Bekijk onze aanbiedingen vandaag.<br>Alleen online.');
  check('a link left out is written as translated - and pointed out', r.status === 'ready' && r.warnings.some((w) => /Links differ/.test(w)) && r.warnings.some((w) => /Tags differ/.test(w)), JSON.stringify(r));
}
{
  const r = full('Bekijk <a href="/za/offers/">onze aanbiedingen vandaag.<br>Alleen online.');
  check('a tag left open is pointed out', r.status === 'ready' && r.warnings.some((w) => /Not closed as often as opened: <a>/.test(w)), JSON.stringify(r.warnings));
}
check('a script is never written', /not allowed/.test(full('<a href="/x">x</a><script>alert(1)</script>').message), full('<script>x</script>').message);
check('...nor code that runs on a click or a hover', /runs a script/.test(full('<a href="/za/offers/" onmouseover="alert(1)">x</a>').message), full('<a onclick="x()">y</a>').message);
check('...nor a javascript: link', /links to a script/.test(full('<a href="javascript:alert(1)">x</a>').message), full('<a href="javascript:alert(1)">x</a>').message);
check('...but an embed the page already has, exactly as it has it, is the page’s own', (() => {
  const t = richTree();
  const embed = '<iframe src="https://www.youtube.com/embed/x" width="560"></iframe>';
  t.root.responsivegrid.cm_g_text_block_copy_1409814884.description = `Watch ${embed}`;
  const { text } = roundTrip(clone(t), { [`${RICH}@description`]: `Bekijk ${embed}` });
  return rowOf(plan(t, text), `${RICH}@description`)?.status === 'ready';
})(), '');
{
  // An image and its alt, nothing else: one row, the alt translated in place.
  const t = richTree();
  t.root.responsivegrid.cm_g_text_block_copy_1409814884.description = '<img src="/x.png" alt="A TV on a wall">';
  const { text } = roundTrip(clone(t), { [`${RICH}@description`]: '<img src="/x.png" alt="Een tv aan de muur">' });
  const p = plan(t, text);
  check('an image alone comes back with its alt translated', writeOf(p, RICH, 'description')?.to === '<img src="/x.png" alt="Een tv aan de muur">', JSON.stringify(writeOf(p, RICH, 'description')));
  check('...and nothing about it is listed as not on the sheet', !p.notInSheet.some((r) => r.key.startsWith(`${RICH}@description`)), JSON.stringify(p.notInSheet.map((r) => r.key)));
}

console.log('\n--- placeholders: sheets made before v3 -------------------------------');

{
  const { text } = roundTrip(
    richTree(),
    {
      [`${RICH}@description`]: 'Bekijk <a1>onze aanbiedingen</a1> vandaag.<br>Alleen online.',
      [`${RICH}@description~a1.title`]: 'Alle "aanbiedingen" & acties'
    },
    { placeholders: true }
  );
  const p = plan(richTree(), text);
  check(
    'the link comes back from the page, with the translated title inside it',
    writeOf(p, RICH, 'description')?.to === 'Bekijk <a href="/za/offers/" title="Alle &quot;aanbiedingen&quot; &amp; acties" target="_self">onze aanbiedingen</a> vandaag.<br>Alleen online.',
    JSON.stringify(writeOf(p, RICH, 'description')?.to)
  );
  check('the text and its title are one write', p.writes.filter((w) => w.path === RICH && w.prop === 'description').length === 1, '');
}
{
  const { text } = roundTrip(richTree(), { [`${RICH}@description~a1.title`]: 'Alle aanbiedingen' }, { placeholders: true });
  const p = plan(richTree(), text);
  check(
    'a title alone changes only the title',
    writeOf(p, RICH, 'description')?.to === 'See <a href="/za/offers/" title="Alle aanbiedingen" target="_self">our offers</a> today.<br>Only online.',
    JSON.stringify(writeOf(p, RICH, 'description')?.to)
  );
}
const bad = (translation) => {
  const { text } = roundTrip(richTree(), { [`${RICH}@description`]: translation }, { placeholders: true });
  return rowOf(plan(richTree(), text), `${RICH}@description`);
};
check('a lost placeholder blocks the row', bad('Bekijk onze aanbiedingen vandaag.<br>Alleen online.').status === 'invalid', bad('Bekijk onze aanbiedingen.').message);
{
  // No #END row to say which kind of sheet it is: the row's Source cell, with its <a1>, says it.
  const { text } = roundTrip(richTree(), { [`${RICH}@description`]: 'Bekijk onze aanbiedingen vandaag.<br>Alleen online.' }, { placeholders: true });
  const cut = core.gridFromText(text).filter((r) => r[3] !== '#meta');
  const r = core.planImport(richTree(), core.readSheet(cut), { pagePath: TARGET }).rows.find((x) => x.key === `${RICH}@description`);
  check('...also on an older sheet that lost its #END row', r?.status === 'invalid', JSON.stringify(r));
}
check('a placeholder twice blocks the row', bad('<a1>x</a1> <a1>y</a1><br>z').status === 'invalid', '');
check('a placeholder that is not in the source blocks the row', /not in the source/.test(bad('<a1>x</a1> <a2>y</a2><br>z').message), bad('<a1>x</a1> <a2>y</a2><br>z').message);
check('a new link blocks the row', /attributes/.test(bad('<a1>x</a1><br><a href="https://evil">y</a>').message), bad('<a1>x</a1><br><a href="https://evil">y</a>').message);
check('a script blocks the row', /not allowed/.test(bad('<a1>x</a1><br><script>alert(1)</script>').message), '');
{
  const r = bad('Bekijk <a1>onze aanbiedingen</a1> vandaag. Alleen online.');
  check('a <br> taken out is allowed, and pointed out', r.status === 'ready' && r.warnings.some((w) => /Tags differ/.test(w)), JSON.stringify(r));
}

console.log('\n--- what stops a row --------------------------------------------------');

{
  const { text } = roundTrip(clone(FIXTURE), {
    '.@jcr:title': 'Koop Smart TVs',
    '.@localTitle': 'TVs',
    [`${HERO}@description`]: '#NAME?',
    [`${MICRO}@headlineText`]: 'Micro RGB Ã© kapot',
    [`${WHY}@textForLinkAction1`]: 'Meer <b>info</b>'
  });
  const target = clone(FIXTURE);
  target['jcr:title'] = 'Somebody edited this after the export';
  const p = plan(target, text);
  check('a text changed on the page since the export is blocked', rowOf(p, '.@jcr:title')?.status === 'changed', rowOf(p, '.@jcr:title')?.status);
  check('a translation the same as the source changes nothing', rowOf(p, '.@localTitle')?.status === 'same' && !writeOf(p, '', 'localTitle'), '');
  check('an Excel error value is blocked', rowOf(p, `${HERO}@description`)?.status === 'invalid', '');
  check('garbled characters are blocked', /encoding/.test(rowOf(p, `${MICRO}@headlineText`)?.message), rowOf(p, `${MICRO}@headlineText`)?.message);
  check('markup in a plain field is blocked', /plain text/.test(rowOf(p, `${WHY}@textForLinkAction1`)?.message), '');
  check('a blocked row is never among the writes', !p.writes.some((w) => w.path === HERO || (w.path === '' && w.prop === 'jcr:title')), JSON.stringify(p.writes));
}
{
  const { text } = roundTrip(clone(FIXTURE), { '.@jcr:title': 'Koop Smart TVs' });
  const target = clone(FIXTURE);
  target['jcr:title'] = 'Koop Smart TVs';
  check('a translation already on the page is recognised, not called a change', rowOf(plan(target, text), '.@jcr:title')?.status === 'already', '');
}
{
  const { text } = roundTrip(clone(FIXTURE), { '.@jcr:title': 'Een' });
  const lines = text.split('\r\n');
  const dup = [
    lines[0],
    lines[1],
    lines[1].replace('Een', 'Twee'),
    'x\ty\tz\troot/responsivegrid/gone@headlineText\th00000000\tGhost\tSpook',
    'x\ty\tz\t\th00000000\tNo key\tGeen sleutel',
    ...lines.slice(2)
  ].join('\r\n');
  const p = plan(clone(FIXTURE), dup);
  check('a key on the sheet twice: the first counts, the second is flagged', rowOf(p, '.@jcr:title')?.status === 'ready' && p.rows.filter((r) => r.key === '.@jcr:title')[1]?.status === 'duplicate', '');
  check('a key the page does not have is flagged', rowOf(p, 'root/responsivegrid/gone@headlineText')?.status === 'missing', JSON.stringify(p.rows.slice(0, 5).map((r) => [r.key, r.status])));
  check('an emptied Key cell is flagged', p.rows.find((r) => r.key === '')?.status === 'invalid', '');
  check('...and the row count no longer matches the closing row', p.warnings.some((w) => /came through/.test(w)), JSON.stringify(p.warnings));
}
{
  const { sheet } = roundTrip(clone(FIXTURE), {});
  const S = sheet.columns.indexOf('Source text');
  const K = sheet.columns.indexOf('Key (do not edit)');
  const rec = sheet.records.find((r) => r[K] === '.@jcr:title');
  rec[S] = 'Koop Smart TVs (typed in the wrong column)';
  const p = plan(clone(FIXTURE), clipboard([sheet.columns, ...sheet.records]));
  check('a translation typed into Source text is pointed out', /wrong column/.test(rowOf(p, '.@jcr:title')?.message), JSON.stringify(rowOf(p, '.@jcr:title')));
}

console.log('\n--- the sheet as a whole ---------------------------------------------');

{
  const { text } = roundTrip(clone(FIXTURE), { '.@jcr:title': 'Koop' });
  const noEnd = text.split('\r\n').filter((l) => !l.includes('#meta')).join('\r\n');
  check('a sheet without its #END row is flagged as possibly incomplete', plan(clone(FIXTURE), noEnd).warnings.some((w) => /#END/.test(w)), '');
  check('importing into the page it was exported from is pointed out', plan(clone(FIXTURE), text, SOURCE).warnings.some((w) => /exported from/.test(w)), '');
  const other = { 'jcr:primaryType': 'cq:PageContent', 'jcr:title': 'Another page', root: {} };
  check('a sheet for another page is recognised as such', plan(other, text).warnings.some((w) => /not on this page/.test(w)), JSON.stringify(plan(other, text).warnings));
}
/** The sheet with its #END row saying another copy deck version. */
const asVersion = (text, v) => text.replace(/copy deck v\d+/, `copy deck v${v}`);
{
  const { text } = roundTrip(clone(FIXTURE), { '.@jcr:title': 'Koop Smart TVs' });
  const newer = core.readSheet(core.gridFromText(asVersion(text, 99)));
  check(
    'a sheet a newer DSY made (#END says v99) is refused whole, saying what to do',
    !newer.ok && newer.problem === 'This sheet was made by a newer version of DSY - update DSY, then import again.' && newer.rows.length === 0,
    JSON.stringify([newer.ok, newer.problem])
  );
  check('...so nothing of it is planned or written', core.planImport(clone(FIXTURE), newer, { pagePath: TARGET }).writes.length === 0, '');
  const next = core.readSheet(core.gridFromText(asVersion(text, core.SHEET_VERSION + 1)));
  check('...and so is one just one version ahead', !next.ok && next.problem === newer.problem && next.rows.length === 0, JSON.stringify([next.ok, next.problem]));
  // The version read wherever the #END row has it, in any case: a Notes column renamed does not hide it.
  const shouted = core.readSheet(core.gridFromText(text.replace(/copy deck v\d+/, 'COPY DECK V99')));
  const renamed = core.readSheet(core.gridFromText(asVersion(text, 99)).map((r, i) => (i === 0 ? r.map((c) => (c === 'Notes' ? 'Remarks' : c)) : r)));
  check('...however the version is written, and whatever the Notes column is called', !shouted.ok && !renamed.ok && renamed.problem === newer.problem, JSON.stringify([shouted.problem, renamed.problem]));
  const v3 = plan(clone(FIXTURE), asVersion(text, 3));
  check('a sheet of this version (v3) imports as before', JSON.stringify(v3.writes.map((w) => [w.prop, w.to])) === JSON.stringify([['jcr:title', 'Koop Smart TVs']]) && !v3.warnings.length, JSON.stringify(v3.writes));
  const noEnd = plan(clone(FIXTURE), text.split('\r\n').filter((l) => !l.includes('#meta')).join('\r\n'));
  check('...and so does one that lost its #END row, with the warning it always had', noEnd.writes.length === 1 && noEnd.warnings.some((w) => /#END/.test(w)), JSON.stringify(noEnd.warnings));
}
{
  const { text } = roundTrip(clone(FIXTURE), {}, { include: { categories: ['page'] } });
  const p = plan(clone(FIXTURE), text);
  check('text on the page that is not on the sheet is listed', p.notInSheet.length > 0 && p.notInSheet.every((r) => r.category !== 'page'), String(p.notInSheet.length));
}
{
  const t = clone(FIXTURE);
  t.keywords = ['smart TV', 'QLED', 'OLED'];
  const { text } = roundTrip(t, { '.@keywords[1]': 'QLED-tv' });
  const w = writeOf(plan(clone(t), text), '', 'keywords');
  check('one value of a multi-value property changes, the others stay', JSON.stringify(w?.to) === JSON.stringify(['smart TV', 'QLED-tv', 'OLED']), JSON.stringify(w));
}

console.log('\n--- fields added to the copy deck ------------------------------------');

const PROMO_PATH = 'root/responsivegrid/cm_g_promo_banner_1';
/** A component no rule knows, with its words in names of its own. */
function withPromo(t) {
  t.root.responsivegrid.cm_g_promo_banner_1 = {
    'sling:resourceType': 'samsung/components/content/consumer/global/common/cm-g-promo-banner',
    headlineText: 'Save on every TV',
    ctaLabel: 'Buy',
    tabs: ['Overview', 'Specs'],
    linkUrl: '/za/offers/',
    headlineEngText: 'save on every tv',
    list: { item0: { cardTitle: 'Picture quality' }, item1: { cardTitle: 'Sound' } }
  };
  return t;
}
const PROMO_FIELDS = {
  add: [
    { component: 'cm-g-promo-banner', prop: 'cardTitle', group: 'copy' },
    { component: 'cm-g-promo-banner', prop: 'ctaLabel', group: 'cta' },
    { component: 'cm-g-promo-banner', prop: 'tabs', group: 'copy' },
    { component: 'page-pcd', prop: 'productGroupCodeName', group: 'page' }
  ]
};
{
  const { text } = roundTrip(withPromo(clone(FIXTURE)), {
    [`${PROMO_PATH}/list/item0@cardTitle`]: 'Beeldkwaliteit',
    [`${PROMO_PATH}@ctaLabel`]: 'Koop',
    [`${PROMO_PATH}@tabs[1]`]: 'Specificaties',
    '.@productGroupCodeName': 'Televisie'
  }, { fields: PROMO_FIELDS });
  // No fields passed: the import has only the sheet, as on a machine where nobody added them.
  const p = plan(withPromo(clone(FIXTURE)), text);
  check(
    'a row for an added field is ready, from its Key alone - no settings needed',
    ['/list/item0@cardTitle', '@ctaLabel', '@tabs[1]'].every((k) => rowOf(p, `${PROMO_PATH}${k}`)?.status === 'ready') && rowOf(p, '.@productGroupCodeName')?.status === 'ready',
    JSON.stringify(p.rows.filter((r) => r.key.includes('promo') || r.key.includes('productGroup')).map((r) => [r.key, r.status, r.message]))
  );
  check('...and written to that property', writeOf(p, `${PROMO_PATH}/list/item0`, 'cardTitle')?.to === 'Beeldkwaliteit' && writeOf(p, PROMO_PATH, 'ctaLabel')?.to === 'Koop', JSON.stringify(p.writes));
  check('...a multi-value one only in the value translated', JSON.stringify(writeOf(p, PROMO_PATH, 'tabs')?.to) === JSON.stringify(['Overview', 'Specificaties']), JSON.stringify(writeOf(p, PROMO_PATH, 'tabs')));
  check('...a page property too', writeOf(p, '', 'productGroupCodeName')?.to === 'Televisie', '');
  check('...and a row left blank stays as it is', rowOf(p, `${PROMO_PATH}/list/item1@cardTitle`)?.status === 'untranslated', '');

  // Changed on the page since the export: blocked like any other row.
  const changed = withPromo(clone(FIXTURE));
  changed.root.responsivegrid.cm_g_promo_banner_1.list.item0.cardTitle = 'Picture quality, now brighter';
  check('...and the Check still guards it', rowOf(plan(changed, text), `${PROMO_PATH}/list/item0@cardTitle`)?.status === 'changed', '');

  const gone = clone(FIXTURE);
  check('...where the page no longer has the component, it is "not on this page"', rowOf(plan(gone, text), `${PROMO_PATH}/list/item0@cardTitle`)?.status === 'missing', '');
}
{
  /* A Key pointing somewhere the export would never put a row - a system
   * property, an analytics value, a link - is refused even with a matching
   * Check: the import writes only what the copy deck could have exported. */
  const target = withPromo(clone(FIXTURE));
  const node = target.root.responsivegrid.cm_g_promo_banner_1;
  const header = ['Section', 'Field', 'Notes', 'Key (do not edit)', 'Check (do not edit)', 'Source text', 'Translation'];
  const row = (key, value, translation) => ['s', 'f', '', key, core.sourceHash(value), value, translation];
  const grid = [
    header,
    row(`${PROMO_PATH}@sling:resourceType`, node['sling:resourceType'], 'x/evil'),
    row(`${PROMO_PATH}@headlineEngText`, node.headlineEngText, 'bespaar'),
    row(`${PROMO_PATH}@linkUrl`, node.linkUrl, '/nl/aanbiedingen/'),
    row('root/responsivegrid@sling:resourceType', 'wcm/foundation/components/responsivegrid', 'x/evil'),
    row('.@cq:template', target['cq:template'], '/conf/x')
  ];
  const p = core.planImport(target, core.readSheet(grid), { pagePath: TARGET });
  check(
    'a Key naming a system property, an analytics value or a link is refused, Check or not',
    p.writes.length === 0 && p.rows.every((r) => r.status === 'missing'),
    JSON.stringify(p.rows.map((r) => [r.key, r.status]))
  );
}
{
  /* The same field holding text on one node and a link on another: the text row
   * on the sheet must not open the door for the link - judged value by value. */
  const target = clone(FIXTURE);
  target.root.responsivegrid.a = { 'sling:resourceType': 'x/cm-g-offer', linkUrl: '/content/samsung/za/offers', tabs: ['Overview', '#specs'] };
  target.root.responsivegrid.b = { 'sling:resourceType': 'x/cm-g-offer', linkUrl: 'Shop the offers' };
  const header = ['Section', 'Field', 'Notes', 'Key (do not edit)', 'Check (do not edit)', 'Source text', 'Translation'];
  const row = (key, value, translation) => ['s', 'f', '', key, core.sourceHash(value), value, translation];
  const grid = [
    header,
    row('root/responsivegrid/b@linkUrl', 'Shop the offers', 'Bekijk de aanbiedingen'),
    row('root/responsivegrid/a@linkUrl', '/content/samsung/za/offers', '/content/samsung/nl/aanbiedingen'),
    row('root/responsivegrid/a@tabs[0]', 'Overview', 'Overzicht'),
    row('root/responsivegrid/a@tabs[1]', '#specs', '#specificaties')
  ];
  const p = core.planImport(target, core.readSheet(grid), { pagePath: TARGET });
  const status = Object.fromEntries(p.rows.map((r) => [r.key.split('/').pop(), r.status]));
  check(
    'a link or a path is refused even when a text row of the same field is on the sheet',
    status['a@linkUrl'] === 'missing' && status['a@tabs[1]'] === 'missing' && status['b@linkUrl'] === 'ready' && status['a@tabs[0]'] === 'ready',
    JSON.stringify(status)
  );
  check(
    '...so nothing but the text is written',
    JSON.stringify(p.writes.map((w) => [w.path, w.prop, w.to])) ===
      JSON.stringify([['root/responsivegrid/b', 'linkUrl', 'Bekijk de aanbiedingen'], ['root/responsivegrid/a', 'tabs', ['Overzicht', '#specs']]]),
    JSON.stringify(p.writes)
  );
}
{
  // The review names each row's section as the sheet does, whatever the page would number it now.
  const { text } = roundTrip(clone(FIXTURE), { [`${HERO}@headlineText`]: 'Ontdek' });
  const sheet = core.readSheet(core.gridFromText(text));
  const p = plan(clone(FIXTURE), text);
  const onSheet = Object.fromEntries(sheet.rows.flatMap((r) => r.keys.map((k) => [k, r.section])));
  check(
    'each row is shown under the Section the sheet gives it - static content under its block, as the page numbers it',
    p.rows.every((r) => r.section === (r.category === 'static' ? 'Static content 1 of 1 · Find the right TV size for your space' : onSheet[r.key])) &&
      onSheet[`${HERO}@headlineText`].includes('Feature Benefit'),
    JSON.stringify(p.rows.filter((r) => r.section !== onSheet[r.key]).map((r) => [r.key, r.section, onSheet[r.key]]))
  );
  const edited = core.gridFromText(text).map((r, i) => (i && r[3].split('\n').includes(`${HERO}@headlineText`) ? ['My own section', ...r.slice(1)] : r));
  check('...even one the operator renamed', core.planImport(clone(FIXTURE), core.readSheet(edited), { pagePath: TARGET }).rows.find((r) => r.key === `${HERO}@headlineText`)?.section === 'My own section', '');
}
{
  const { text: titled } = roundTrip(clone(FIXTURE), { '.@jcr:title': 'Koop Smart TVs' });
  const without = plan(clone(FIXTURE), titled);
  const withIt = plan(withPromo(clone(FIXTURE)), titled);
  check(
    'a component no rule knows changes nothing that is written, nor the fingerprint the write is held to',
    withIt.writes.length === 1 && core.writesFingerprint(withIt.writes) === core.writesFingerprint(without.writes),
    JSON.stringify(withIt.writes)
  );
}

console.log('\n--- static HTML, and a Static Content block’s code -------------------');

const BLOCK = 'root/responsivegrid/cm_g_static_content_';
const SHOW = 'root/responsivegrid/cm_g_static_content__1282587421';
const TABS = 'root/responsivegrid/cm_g_static_content__1495926445';
const STATIC_TYPE = 'samsung/components/content/consumer/global/common/cm-g-static-content';
const CODE_REFUSED = 'A Static Content block’s Header (CSS) and Footer (JavaScript) are code: the import never writes them - a developer changes them by hand.';
/** A row as someone could type it: any Key, with the Check of the value it names. */
const handRow = (key, value, translation) => ['s', 'f', '', key, core.sourceHash(value), value, translation];

/**
 * Two blocks like explore-samsung-health's, trimmed, CRLF as AEM stores them:
 * the showcase - an empty <div>, its app in the Footer, its styles in the
 * Header - and the tabbed product block, with an inline onclick and a script
 * whose string holds markup.
 */
function withStaticBlocks(t) {
  t.root.responsivegrid.cm_g_static_content__1282587421 = {
    'sling:resourceType': STATIC_TYPE,
    bodyHtml: '<div id="showcase"></div>',
    headerInclude: '.showcase .tile:after {\r\n  content: "Learn more about Samsung Health";\r\n}',
    footerInclude:
      '(function () {\r\n  "use strict";\r\n  const tiles = [\r\n' +
      '    { title: "Sleep better", text: "Get to know your sleep patterns and wake up refreshed.", cta: "Learn more" }\r\n  ];\r\n' +
      '  document.getElementById("showcase").innerHTML = tiles.map((t) => `<p>${t.title}</p>`).join("");\r\n})();'
  };
  t.root.responsivegrid.cm_g_static_content__1495926445 = {
    'sling:resourceType': STATIC_TYPE,
    bodyHtml: [
      '<section id="mep-tab-component">',
      '  <div class="tabs" role="tablist" aria-label="Product categories">',
      '    <button id="tab1-header" class="tab active ch-dt-19 ch-mo-19" role="tab" aria-selected="true">',
      '      Everyday wellness',
      '    </button>',
      '  </div>',
      '  <img class="header__image" src="/content/dam/samsung/levant/mobile/explore-samsung-health/wellness-kv-dt-webp.png" alt="Everyday wellness" loading="lazy" />',
      '  <h2 class="ch-dt-38 ch-mo-26 header1">',
      '    Made to support your<br /><span class="header-highlight">everyday wellness</span>',
      '  </h2>',
      '  <p>Built to push boundaries, Galaxy Watch Ultra withstands up to 55°C heat, 9,000m altitude.</p>',
      `  <button class="cta" onclick="window.location.href = 'https://www.samsung.com/levant/watches/galaxy-watch/'">Buy now</button>`,
      '</section>',
      '<script>',
      `  tooltip.innerHTML = '<span class="tooltip__name">Titanium Gray</span>';`,
      '</script>'
    ].join('\r\n')
  };
  return t;
}
{
  /* A sheet made by hand, or exported before the block's code was taken off by
   * someone who had added it: every form a Key takes, for the script and the styles. */
  const target = withStaticBlocks(clone(FIXTURE));
  const node = nodeAt0(target, SHOW);
  const forms = ['', '[0]', '#01', '~script1.title'];
  const grid = [
    core.SHEET_COLUMNS,
    handRow('.@jcr:title', FIXTURE['jcr:title'], 'Koop Smart TVs'),
    ...['footerInclude', 'headerInclude'].flatMap((prop) => forms.map((f) => handRow(`${SHOW}@${prop}${f}`, node[prop], node[prop].replace(/Learn more/g, 'En savoir plus'))))
  ];
  const p = core.planImport(target, core.readSheet(grid), { pagePath: TARGET });
  const code = p.rows.filter((r) => /@(header|footer)Include/.test(r.key));
  check(
    'a row for a Static Content block’s script or styles is refused, in every form a Key takes, and says why',
    code.length === 8 && code.every((r) => r.status === 'invalid' && r.message === CODE_REFUSED),
    JSON.stringify(code.map((r) => [r.key.split('@')[1], r.status, r.message]))
  );
  check('...and nothing of it is written - the rest of the sheet is', p.writes.length === 1 && writeOf(p, '', 'jcr:title')?.to === 'Koop Smart TVs', JSON.stringify(p.writes.map((w) => [w.path, w.prop])));
}
{
  // Static HTML is applied by hand: no Key a sheet can hold writes a bodyHtml - not even one on the page itself.
  const target = withStaticBlocks(clone(FIXTURE));
  target.bodyHtml = '<p>Welcome to our TV range</p>';
  const body = nodeAt0(target, BLOCK).bodyHtml;
  const grid = [
    core.SHEET_COLUMNS,
    handRow(`${BLOCK}@bodyHtml`, body, body.replace('Find the right TV size', 'Vind het juiste formaat')),
    handRow(`${BLOCK}@bodyHtml[0]`, body, body.replace('Find the right TV size', 'Vind het juiste formaat')),
    handRow(`${BLOCK}@bodyHtml#02`, body, 'Vind het juiste tv-formaat voor uw ruimte'),
    handRow('.@bodyHtml', target.bodyHtml, '<p>Welkom bij onze tv’s</p>')
  ];
  const p = core.planImport(target, core.readSheet(grid), { pagePath: TARGET });
  check('no bodyHtml is ever among the writes', !p.writes.some((w) => w.prop === 'bodyHtml'), JSON.stringify(p.writes.map((w) => [w.path, w.prop])));
  check('...a piece of it, translated, is listed to apply by hand', rowOf(p, `${BLOCK}@bodyHtml#02`)?.status === 'manual', JSON.stringify(rowOf(p, `${BLOCK}@bodyHtml#02`)));
  check(
    '...and one on the page itself, which no rule makes static, is stopped by the last guard and says why',
    rowOf(p, '.@bodyHtml')?.status === 'invalid' && /Static HTML is applied by hand/.test(rowOf(p, '.@bodyHtml').message),
    JSON.stringify(rowOf(p, '.@bodyHtml'))
  );
}

/* Applied by hand, but checked first like any translation: what is pasted into
 * the block goes onto the page as it stands. A sheet made before v4 has static
 * HTML in pieces, "…@bodyHtml#08" (the default here); v4 in whole texts. */
const byHand = (translations, version = 3) => {
  const tree = withStaticBlocks(clone(FIXTURE));
  const { text } = roundTrip(clone(tree), translations, { version });
  return plan(tree, text);
};
const WE_RECOMMEND = staticKey(BLOCK, 'We Recommend');
{
  const p = byHand({
    [`${BLOCK}@bodyHtml#02`]: 'Find the right TV size for your space',
    [`${BLOCK}@bodyHtml#03`]: '#VALUE!',
    [`${BLOCK}@bodyHtml#04`]: 'Kijkafstand (meter) Ã© kapot',
    [`${BLOCK}@bodyHtml#05`]: 'Kies de kijkafstand<script>alert(1)</script>',
    [`${BLOCK}@bodyHtml#08`]: '<span onmouseover="alert(1)">Wij raden aan</span>',
    [`${BLOCK}@bodyHtml#12`]: '<a href="javascript:alert(1)">Meer informatie</a>'
  });
  const at = (n) => rowOf(p, `${BLOCK}@bodyHtml#${n}`);
  check('a static row translated as the English is the same as the source - not work to do by hand', at('02')?.status === 'same', JSON.stringify(at('02')));
  check('an Excel error in a static row is refused', at('03')?.status === 'invalid' && /Excel error \(#VALUE!\)/.test(at('03').message), JSON.stringify(at('03')));
  check('...and garbled characters', at('04')?.status === 'invalid' && /encoding/.test(at('04').message), JSON.stringify(at('04')));
  check('...and a <script>', at('05')?.status === 'invalid' && /<script> is not allowed/.test(at('05').message), JSON.stringify(at('05')));
  check('...and code that runs on a hover', at('08')?.status === 'invalid' && /runs a script/.test(at('08').message), JSON.stringify(at('08')));
  check('...and a javascript: link', at('12')?.status === 'invalid' && /links to a script/.test(at('12').message), JSON.stringify(at('12')));
  check('...none of them listed to apply by hand, nothing written', p.counts.manual === 0 && !p.writes.length, JSON.stringify(p.counts));
}
{
  /* A script written the way a browser still runs it: a handler after a "/" or
   * a closing quote, a link spelled with codes or a tab, one hidden behind a
   * comment, a quote that closes the attribute it is pasted into. Refused in a
   * static row, and in rich text, which is written. */
  const tricks = {
    'a handler after a "/"': '<svg/onload=alert(1)>Wij raden aan',
    'a handler right after a quoted value': '<img src="x"onerror="alert(1)">Wij raden aan',
    'a handler after a quoted value and a "/"': '<img src="x"/onerror="alert(1)">Wij raden aan',
    'a link spelled with a code': '<a href="&#106;avascript:alert(1)">Wij raden aan</a>',
    '...a code without its ";"': '<a href="&#106avascript:alert(1)">Wij raden aan</a>',
    '...a named code for the colon': '<a href="javascript&colon;alert(1)">Wij raden aan</a>',
    '...a tab inside': '<a href="java\tscript:alert(1)">Wij raden aan</a>',
    '...a tab as a code': '<a href="java&#9;script:alert(1)">Wij raden aan</a>',
    'a tag hidden in a comment and a quote': '<!-- <a title=" --><img src=x onerror=alert(1)>"-->Wij raden aan',
    'a quote that closes the attribute it goes into': 'Wij raden aan" onmouseover="alert(1)',
    '...then another attribute, then a handler': 'Wij raden aan" x=1 onmouseover="alert(1)',
    '...then a bare attribute, then a handler': 'Wij raden aan" x onmouseover=alert(1) y="',
    '...then a "/**/" before the handler': 'Wij raden aan"/**/onmouseover="alert(1)',
    '...then autofocus, and a handler for it': 'Wij raden aan" autofocus onfocus="alert(1)',
    "...a single quote, another attribute, a handler": "Wij raden aan' x onmouseover=alert(1) y='",
    '...then another attribute, then a script link': 'Wij raden aan" x href="javascript:alert(1)',
    'SVG that turns a link into a script': '<svg><a><animate attributeName="href" values="0;javascript:alert(1)"/></a></svg>Wij'
  };
  for (const [name, payload] of Object.entries(tricks)) {
    const p = byHand({ [`${BLOCK}@bodyHtml#08`]: payload });
    const whole = rowOf(byHand({ [WE_RECOMMEND]: payload }, 4), WE_RECOMMEND);
    const rich = full(`Bekijk ${payload} vandaag.<br>Alleen online.`);
    check(
      `${name}: refused in a static row - a piece (v3) or a whole text (v4) - and in rich text, which is never written`,
      rowOf(p, `${BLOCK}@bodyHtml#08`)?.status === 'invalid' &&
        /not allowed in a translation/.test(rowOf(p, `${BLOCK}@bodyHtml#08`).message) &&
        whole?.status === 'invalid' &&
        /not allowed in a translation/.test(whole.message) &&
        rich.status === 'invalid',
      JSON.stringify([rowOf(p, `${BLOCK}@bodyHtml#08`), whole, rich.status, rich.message])
    );
  }
  // Words that only look a little like it go through.
  const p = byHand({
    [`${BLOCK}@bodyHtml#02`]: 'Koop er één = krijg er één gratis',
    [`${BLOCK}@bodyHtml#03`]: 'JavaScript: zet het aan in uw browser',
    [`${BLOCK}@bodyHtml#05`]: 'Online = 10% korting, "onze" keuze'
  });
  check('...but "één =", a word like "JavaScript:", "Online =" to begin with or "onze" in quotes is fine', ['02', '03', '05'].every((n) => rowOf(p, `${BLOCK}@bodyHtml#${n}`)?.status === 'manual'), JSON.stringify(p.rows.filter((r) => r.status !== 'manual' && r.translation)));
  /* ...and so are words like them in the middle of a sentence: "bestel online =", "only =", "= JavaScript:" -
   * outside a tag, with no quote before them to close an attribute, they are text, wherever they go. */
  const plain = ['Samsung The Frame: bestel online = gratis bezorging', 'Eén prijs, only = alles inbegrepen', 'Zet het aan = JavaScript: ja, in uw browser'];
  for (const words of plain) {
    const piece = rowOf(byHand({ [`${BLOCK}@bodyHtml#02`]: words }), `${BLOCK}@bodyHtml#02`);
    const whole = rowOf(byHand({ [WE_RECOMMEND]: words }, 4), WE_RECOMMEND);
    const rich = full(`Bekijk <a href="/za/offers/">onze aanbiedingen</a>: ${words}.<br>Alleen online.`);
    check(
      `..."${words}": listed to apply by hand (v3 and v4), and rich text with it is written`,
      piece?.status === 'manual' && whole?.status === 'manual' && rich.status === 'ready',
      JSON.stringify([piece?.status, piece?.message, whole?.status, whole?.message, rich.status, rich.message])
    );
  }
  /* ...and after an apostrophe in a word - l'offre, Samsung's - which closes neither text between tags nor an
   * attribute in double quotes. A piece of a sheet made before v4 may be pasted by hand into one in single
   * quotes, so it is still read strictly there. */
  const apostrophes = ["Profitez de l'offre online = 10% de remise", "Samsung's best deals online = up to 20% off", "C'est simple = JavaScript: activé"];
  for (const words of apostrophes) {
    const piece = rowOf(byHand({ [`${BLOCK}@bodyHtml#02`]: words }), `${BLOCK}@bodyHtml#02`);
    const whole = rowOf(byHand({ [WE_RECOMMEND]: words }, 4), WE_RECOMMEND);
    const rich = full(`Bekijk <a href="/za/offers/">onze aanbiedingen</a>: ${words}.<br>Alleen online.`);
    check(
      `..."${words}": listed to apply by hand (v4), and rich text with it is written - a piece (v3) is still refused`,
      whole?.status === 'manual' && rich.status === 'ready' && piece?.status === 'invalid',
      JSON.stringify([piece?.status, piece?.message, whole?.status, whole?.message, rich.status, rich.message])
    );
  }
  const link = full('Bekijk <a href="/za/offers/?tv=75&amp;size=xl" title="Alle aanbiedingen" target="_self">onze aanbiedingen</a> vandaag.<br>Alleen online.');
  check('...and so is a link with a code in its address', link.status === 'ready', JSON.stringify(link));
}
{
  const p = byHand({
    [`${BLOCK}@bodyHtml#01`]: 'ou plus',
    [`${BLOCK}@bodyHtml#02`]: 'Trouvez la taille de téléviseur idéale pour votre espace',
    [`${BLOCK}@bodyHtml#03`]: 'Ces recommandations sont conçues pour une expérience « immersive » & confortable.',
    [`${BLOCK}@bodyHtml#09`]: 'تلفزيونات 75"',
    [`${BLOCK}@bodyHtml#10`]: "Voir tous les téléviseurs 75''",
    [`${BLOCK}@bodyHtml#11`]: 'En savoir plus : guide d’achat - quelle taille de téléviseur choisir ?',
    [`${BLOCK}@bodyHtml#14`]: '98" TV ou plus',
    [`${TABS}@bodyHtml#01`]: 'فئات المنتجات',
    [`${TABS}@bodyHtml#06`]: "Conçue pour repousser les limites, la Galaxy Watch Ultra résiste jusqu'à 55 °C & 9 000 m d'altitude.",
    [`${TABS}@bodyHtml#08`]: '<span class="tooltip__name">Gris titane</span>'
  });
  const mine = p.rows.filter((r) => r.translation);
  check(
    'a translation with quotes, &, apostrophes, Arabic or accents is listed to apply by hand - as is a script’s string keeping its markup',
    mine.length === 10 && mine.every((r) => r.status === 'manual'),
    JSON.stringify(mine.filter((r) => r.status !== 'manual').map((r) => [r.key, r.status, r.message]))
  );
}
{
  // Every static row of blocks like the real ones, translated: none is refused for what its source is - in pieces (v3) or whole (v4).
  const tree = withStaticBlocks(clone(FIXTURE));
  for (const version of [3, 4]) {
    const statics = core.extractCopyDeck(clone(tree), { staticPieces: version < 4 }).rows.filter((r) => r.format === 'manual');
    const p = byHand(Object.fromEntries(statics.map((r) => [r.key, `« ${r.source} » (FR)`])), version);
    const off = p.rows.filter((r) => statics.some((s) => s.key === r.key) && r.status !== 'manual');
    check(
      `every static row of blocks like explore-samsung-health’s, and of the za/tvs page, translated, is listed to apply by hand - none refused (v${version})`,
      statics.length >= (version < 4 ? 20 : 12) && !off.length,
      JSON.stringify(off.map((r) => [r.key, r.status, r.message]))
    );
  }
}

console.log('\n--- reading a workbook ------------------------------------------------');

{
  const { sheet } = roundTrip(clone(FIXTURE), { '.@jcr:title': 'Koop' });
  const grid = await readXlsx(toXlsx(sheet, { pagePath: SOURCE }));
  check('the workbook the export writes reads back cell for cell', JSON.stringify(grid) === JSON.stringify([sheet.columns, ...sheet.records]), 'grids differ');

  // The way Excel saves: deflated, text in a shared-strings table, rich text in runs.
  const shared = [
    'Key (do not edit)', 'Check (do not edit)', 'Translation',
    '.@jcr:title', core.sourceHash(FIXTURE['jcr:title']),
    '<r><t>Koop </t></r><r><rPr><b/></rPr><t>Smart</t></r><r><t xml:space="preserve"> TVs</t></r><rPh sb="0" eb="1"><t>ignored</t></rPh>',
    'Regel_x000D_\nnieuw &amp; &lt;beter&gt;'
  ];
  const sst = `<sst xmlns="x" count="${shared.length}">${shared.map((s) => (s.startsWith('<r>') ? `<si>${s}</si>` : `<si><t>${s}</t></si>`)).join('')}</sst>`;
  const sheetXml =
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="D2" t="s"><v>5</v></c></row>' +
    '<row r="4"><c r="D4" t="s"><v>6</v></c><c r="E4"><v>42</v></c></row>' +
    '</sheetData></worksheet>';
  const excelFile = zipDeflated([
    ['xl/workbook.xml', '<workbook><sheets><sheet name="Copy deck" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', sst],
    ['xl/worksheets/sheet1.xml', sheetXml]
  ]);
  const g = await readXlsx(excelFile);
  check('an Excel-saved workbook (deflated, shared strings) is read', g[1][0] === '.@jcr:title' && g[1][3] === 'Koop Smart TVs', JSON.stringify(g));
  check('rich-text runs join up and phonetic guides are skipped', g[1][3] === 'Koop Smart TVs', g[1][3]);
  check('a skipped row and a skipped column stay in place', g[2].length === 0 && g[3][3] !== undefined && g[3][0] === '', JSON.stringify(g));
  check("Excel's _x000D_ and XML escapes are decoded", g[3][3] === 'Regel\r\nnieuw & <beter>' && g[3][4] === '42', JSON.stringify(g[3]));
}

/* ------------------------------------------------------------ the worker */

console.log('\n--- the worker --------------------------------------------------------');

const mk = (status, text) => ({ status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) });
const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);
const render = (n, d) => Object.fromEntries(Object.entries(n).filter(([, v]) => !isNode(v) || d > 0).map(([k, v]) => [k, isNode(v) ? render(v, d - 1) : v]));
function installFetch(content, more = {}) {
  const root = { content: { samsung: { nl: { tvs: { 'jcr:primaryType': 'cq:Page', 'jcr:content': content } } } }, ...more };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURI(String(url).split('?')[0]);
    calls.push(`${(init.method || 'GET').toUpperCase()} ${u}`);
    if ((init.method || 'GET').toUpperCase() !== 'GET') return mk(500, 'no writes expected');
    const m = u.match(/^(.*)\.(\d+|infinity)\.json$/);
    const node = m && m[1].split('/').filter(Boolean).reduce((n, s) => (isNode(n) ? n[s] : undefined), root);
    if (!isNode(node)) return mk(404, 'nf');
    return mk(200, JSON.stringify(render(node, m[2] === 'infinity' ? 99 : Number(m[2]))));
  };
  return calls;
}
async function run(params, content = FIXTURE) {
  const calls = installFetch(clone(content));
  const lines = [];
  const report = (level, message, data) => lines.push({ level, message, data });
  try {
    return { result: await actions.check({ client: new AemClient({ report }), report, params, settings: {} }), calls, lines, error: null };
  } catch (e) {
    return { result: null, calls, lines, error: e.message };
  }
}
{
  const { text } = roundTrip(clone(FIXTURE), { '.@jcr:title': 'Koop Smart TVs' });
  const t = await run({ page: TARGET, sheet: JSON.stringify(core.gridFromText(text)) });
  check('checks the sheet against the page', t.error === null && t.result.writes.length === 1 && t.result.page === TARGET, t.error || JSON.stringify(t.result?.writes));
  check('reads only - nothing is posted', t.calls.length > 0 && t.calls.every((c) => c.startsWith('GET ')), JSON.stringify(t.calls));
  check('hands the panel the plan', t.lines.some((l) => l.level === 'data' && l.message === 'analysis' && l.data.writes), '');
  check('says plainly that nothing was written', t.lines.some((l) => l.message === 'Nothing has been written.'), '');
}
{
  // Exported with a field added from the list; checked where no settings exist - the sheet is all there is.
  const target = withPromo(clone(FIXTURE));
  const { text } = roundTrip(withPromo(clone(FIXTURE)), { [`${PROMO_PATH}/list/item0@cardTitle`]: 'Beeldkwaliteit' }, { fields: PROMO_FIELDS });
  const t = await run({ page: TARGET, sheet: JSON.stringify(core.gridFromText(text)) }, target);
  check(
    'the worker writes a field added to the copy deck, read from the row’s Key alone',
    t.error === null && t.result.writes.length === 1 && t.result.writes[0].prop === 'cardTitle' && t.result.writes[0].to === 'Beeldkwaliteit',
    t.error || JSON.stringify(t.result?.writes)
  );
}
{
  const t = await run({ page: TARGET, sheet: '' });
  check('no sheet: asks for one', /Paste the translated sheet/.test(String(t.error)) && t.calls.length === 0, String(t.error));
}
{
  const t = await run({ page: TARGET, sheet: JSON.stringify([['nothing', 'useful']]) });
  check('a paste that is not the sheet is refused before the page is read', /header row/.test(String(t.error)) && t.calls.length === 0, String(t.error));
}
{
  const { text } = roundTrip(clone(FIXTURE), { '.@jcr:title': 'Koop Smart TVs' });
  const t = await run({ page: TARGET, sheet: JSON.stringify(core.gridFromText(asVersion(text, core.SHEET_VERSION + 1))) });
  check(
    'a sheet a newer DSY made stops the check before the page is read, and says to update DSY',
    t.error === 'This sheet was made by a newer version of DSY - update DSY, then import again.' && t.calls.length === 0,
    `${t.error} ${JSON.stringify(t.calls)}`
  );
}

console.log('\n--- the Static Content cards: read only --------------------------------');

{
  const calls = installFetch(clone(FIXTURE));
  globalThis.location = { origin: 'https://author.test' };
  const act = async (name, params) => {
    try {
      return { result: await actions[name]({ client: new AemClient(), report: () => {}, params, settings: {} }), error: null };
    } catch (e) {
      return { result: null, error: e.message };
    }
  };
  const BLOCK = 'root/responsivegrid/cm_g_static_content_';
  const s = await act('staticStatus', { page: `${TARGET}.html`, node: BLOCK });
  check(
    'staticStatus reads one block’s three fields, who changed it last, and the server it ran on',
    s.error === null && s.result.bodyHtml === FIXTURE.root.responsivegrid.cm_g_static_content_.bodyHtml && s.result.headerInclude === (FIXTURE.root.responsivegrid.cm_g_static_content_.headerInclude ?? null) && s.result.modifiedBy === (FIXTURE.root.responsivegrid.cm_g_static_content_['jcr:lastModifiedBy'] ?? null) && s.result.origin === 'https://author.test' && s.result.page === TARGET,
    s.error || JSON.stringify(Object.keys(s.result))
  );
  check('the cards no longer read the page’s versions: there is no pageVersions action', !('pageVersions' in actions), '');
  const refused = [
    await act('staticStatus', { page: TARGET, node: '../../../etc' }),
    await act('staticStatus', { page: TARGET, node: `${BLOCK}.infinity` }),
    await act('staticStatus', { page: TARGET, node: 'root/responsivegrid/pd_g_feature_benefit' }),
    await act('staticStatus', { page: '/content/dam/samsung/x', node: BLOCK }),
    await act('staticStatus', { page: '/etc/x', node: BLOCK })
  ];
  check(
    'each refuses what is not a Static Content block under a page’s jcr:content, or not a page under /content',
    /Not a block of the page/.test(refused[0].error) &&
      /Not a block of the page/.test(refused[1].error) &&
      /Not a Static Content block/.test(refused[2].error) &&
      refused.slice(3).every((r) => /Give a page under \/content/.test(r.error)),
    JSON.stringify(refused.map((r) => r.error))
  );
  // Check all: the page planned again with the same sheet - every text still in English.
  const { text } = roundTrip(clone(FIXTURE), { '.@jcr:title': 'Koop Smart TVs' });
  const sweep = calls.length;
  const all = await act('checkAll', { page: TARGET, sheet: JSON.stringify(core.gridFromText(text)) });
  check(
    'checkAll plans the page again with the same sheet and lists what is still in English, with why',
    all.error === null && all.result.origin === 'https://author.test' && all.result.page === TARGET &&
      all.result.left.some((x) => x.where === 'Page properties › Page title' && x.why === 'not written yet - Write on the import') &&
      all.result.left.some((x) => x.why === 'no translation on the sheet'),
    all.error || JSON.stringify(all.result.left.slice(0, 3))
  );
  check('...reading only: every request of Check all is a GET', calls.length > sweep && calls.slice(sweep).every((c) => c.startsWith('GET ')), JSON.stringify(calls.slice(sweep)));
  check('the cards’ actions send GET requests only - nothing is posted, put or deleted', calls.length > 0 && calls.every((c) => c.startsWith('GET ')), JSON.stringify(calls));
  delete globalThis.location;
}

/* -------------------------------------------------------------- writing */

console.log('\n--- writing -----------------------------------------------------------');

/* DOMParser shim, faithful enough for Sling's HtmlResponse. */
globalThis.DOMParser = class {
  parseFromString(html) {
    return {
      getElementById: (id) => {
        const m = html.match(new RegExp(`<div id="${id}">([\\s\\S]*?)</div>`));
        return m ? { textContent: m[1] } : null;
      }
    };
  }
};
const slingResponse = (status, message, path) =>
  `<html><body><div id="Status">${status}</div><div id="Message">${message}</div><div id="Path">${path}</div></body></html>`;

/**
 * An AEM 6.5 author with one page, whose Sling POST behaves like Sling where it
 * matters here: names relative to the target ("./a/b/prop"), @TypeHint, a
 * missing node CREATED on the way, an empty single value DELETING the property,
 * and the whole request saved at once - or, when rejected, not at all.
 */
function installAem(content, opts = {}) {
  const root = { content: { samsung: { nl: { tvs: { 'jcr:primaryType': 'cq:Page', 'jcr:content': content } } } } };
  const log = { calls: [], created: [], deleted: [], posts: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURI(String(url).split('?')[0]);
    const method = (init.method || 'GET').toUpperCase();
    log.calls.push(`${method} ${u}`);
    if (u === '/libs/granite/csrf/token.json') return mk(200, JSON.stringify({ token: 'tok' }));
    if (u === '/libs/granite/security/currentuser.json') return mk(200, JSON.stringify({ authorizableId: opts.user || 'translator@samsung.com' }));

    if (method === 'GET') {
      const m = u.match(/^(.*)\.(\d+|infinity)\.json$/);
      const node = m && m[1].split('/').filter(Boolean).reduce((n, s) => (isNode(n) ? n[s] : undefined), root);
      if (!isNode(node)) return mk(404, 'nf');
      return mk(200, JSON.stringify(render(node, m[2] === 'infinity' ? 99 : Number(m[2]))));
    }

    if (init.headers?.['CSRF-Token'] !== 'tok') return mk(403, 'CSRF token mismatch');
    // Read the body as the server receives it: serialised, then parsed. Multipart
    // turns every line break into CRLF on the way - which is what a write must plan for.
    const multipart = init.body instanceof FormData;
    const entries = multipart
      ? [...(await new Request('http://sling.test/', { method: 'POST', body: init.body }).formData()).entries()]
      : [...new URLSearchParams(init.body).entries()];
    log.posts.push({ url: u, multipart, entries });
    const get = (k) => entries.find(([n]) => n === k)?.[1];

    if (u !== '/content/samsung/nl/tvs/jcr:content') return mk(200, slingResponse(500, `unexpected write to ${u}`, u));
    if (opts.reject) return mk(200, slingResponse(500, 'javax.jcr.nodetype.ConstraintViolationException', u));
    const hints = {};
    const values = new Map();
    for (const [name, value] of entries) {
      if (name === '_charset_') continue;
      if (name.endsWith('@TypeHint')) hints[name.slice(0, -9)] = value;
      else values.set(name, [...(values.get(name) || []), value]);
    }
    for (const [name, vals] of values) {
      const parts = name.replace(/^\.\//, '').split('/');
      const prop = parts.pop();
      let node = content;
      for (const seg of parts) {
        if (!isNode(node[seg])) {
          node[seg] = { 'jcr:primaryType': 'nt:unstructured' };
          log.created.push(parts.join('/'));
        }
        node = node[seg];
      }
      const hint = hints[name] || 'String';
      if (hint.endsWith('[]')) node[prop] = vals;
      else if (vals.at(-1) === '') {
        delete node[prop];
        log.deleted.push(name);
      } else node[prop] = vals.at(-1);
    }
    if (opts.dropAfterWrite) delete nodeAt(content, opts.dropAfterWrite.path)[opts.dropAfterWrite.prop];
    return mk(200, slingResponse(200, 'Content modified', u));
  };
  return log;
}
const nodeAt = (c, path) => (path ? path.split('/').reduce((n, s) => n?.[s], c) : c);

/** The fixture as most target pages are: not locked. (The real za/tvs is locked by admin.) */
const unlocked = (t = clone(FIXTURE)) => {
  delete t['jcr:lockOwner'];
  return t;
};

/** Check, then (optionally after something changes) write - the way the panel drives it. */
async function checkThenWrite({ tree = unlocked(), translations, opts = {}, between, approved } = {}) {
  const target = clone(tree);
  const log = installAem(target, opts);
  const { text } = roundTrip(clone(tree), translations);
  const params = { page: TARGET, sheet: JSON.stringify(core.gridFromText(text)) };
  const checked = await actions.check({ client: new AemClient(), report: () => {}, params, settings: {} });
  if (between) between(target);
  log.calls.length = 0;
  log.posts.length = 0;
  const lines = [];
  const steps = [];
  const report = (level, message, data) => (level === 'data' && message === 'step' ? steps.push(data) : lines.push({ level, message }));
  let result = null;
  let error = null;
  try {
    result = await actions.apply({ client: new AemClient({ report }), report, params: { ...params, approved: approved ?? checked.approved }, settings: {} });
  } catch (e) {
    error = e.message;
  }
  return { checked, result, error, target, log, lines, steps };
}
const contentPosts = (log) => log.posts.filter((p) => p.url.endsWith('/jcr:content'));

{
  const t = await checkThenWrite({
    tree: unlocked(richTree()),
    translations: {
      '.@jcr:title': 'Koop Smart TVs | OLED, QLED en Neo QLED TVs',
      [`${HERO}@headlineText`]: 'Ontdek Samsung TVs\nvoor elke manier van kijken',
      [`${MICRO}@description`]: 'Samsung Micro RGB TVs met Color Booster Pro<sup>1</sup> en Glare Free<sup>2</sup>.',
      [`${MICRO}/list/item0@text`]: 'Meer informatie',
      [`${WHY}@headlineText`]: 'Waarom OLED',
      [`${RICH}@description`]: 'Bekijk <a href="/za/offers/" title="Alle aanbiedingen" target="_self">onze aanbiedingen</a> vandaag.<br>Alleen online.',
      'root/responsivegrid/cm_g_static_content_@bodyHtml#02': 'Vind het juiste formaat'
    }
  });
  const c = t.target;
  check('the write runs through', t.error === null && t.result?.done, t.error);
  check('every reviewed property now holds its translation', t.result?.written === t.checked.writes.length && t.checked.writes.length === 7, `${t.result?.written} / ${t.checked.writes.length}`);
  check('plain text as typed', c['jcr:title'] === 'Koop Smart TVs | OLED, QLED en Neo QLED TVs', c['jcr:title']);
  check('line breaks stored as CRLF, like the source', nodeAt(c, HERO).headlineText === 'Ontdek Samsung TVs\r\nvoor elke manier van kijken', JSON.stringify(nodeAt(c, HERO).headlineText));
  check('the trailing space is kept', nodeAt(c, WHY).headlineText === 'Waarom OLED ', JSON.stringify(nodeAt(c, WHY).headlineText));
  check('a text used twice got its one translation in both places', nodeAt(c, WHY).textForLinkAction1 === 'Meer informatie', nodeAt(c, WHY).textForLinkAction1);
  check(
    'the link written out in the translation, its title translated, is what lands',
    nodeAt(c, RICH).description === 'Bekijk <a href="/za/offers/" title="Alle aanbiedingen" target="_self">onze aanbiedingen</a> vandaag.<br>Alleen online.',
    nodeAt(c, RICH).description
  );
  check('static HTML is not touched', nodeAt(c, 'root/responsivegrid/cm_g_static_content_').bodyHtml === FIXTURE.root.responsivegrid.cm_g_static_content_.bodyHtml, '');
  check('untranslated text is not touched', nodeAt(c, `${MICRO}/list/item1`).text === 'View all', nodeAt(c, `${MICRO}/list/item1`).text);

  check('no version is saved: the one request to jcr:content is all that is posted', t.log.posts.length === 1 && !t.log.posts.some((p) => p.url === '/bin/wcmcommand'), JSON.stringify(t.log.posts.map((p) => p.url)));
  check('the texts go in ONE request, form-encoded like the other DSY writes (a multipart one was ignored by the Samsung authors)', contentPosts(t.log).length === 1 && !contentPosts(t.log)[0].multipart, JSON.stringify(t.log.posts.map((p) => [p.url, p.multipart])));
  check('...with the charset declared', contentPosts(t.log)[0].entries.some(([k, v]) => k === '_charset_' && v === 'utf-8'), '');
  check('no node is created, no property deleted', t.log.created.length === 0 && t.log.deleted.length === 0, JSON.stringify({ created: t.log.created, deleted: t.log.deleted }));
  check('the page is marked modified, by whoever wrote', /^\d{4}-\d{2}-\d{2}T/.test(c['cq:lastModified']) && c['cq:lastModifiedBy'] === 'translator@samsung.com', `${c['cq:lastModified']} ${c['cq:lastModifiedBy']}`);
  check('nothing is published', !t.log.posts.some((p) => /replicate|activate/i.test(p.url + JSON.stringify(p.entries))), '');
  check(
    'the steps run in order and all finish',
    JSON.stringify(t.steps.filter((s) => s.state === 'done').map((s) => s.id)) === JSON.stringify(['recheck', 'lock', 'write', 'verify']),
    JSON.stringify(t.steps)
  );
  check('the result opens the page in the editor', t.result?.editorUrl === `/editor.html${TARGET}.html`, t.result?.editorUrl);
}
{
  const t = await checkThenWrite({ translations: { '.@jcr:title': 'تلفزيونات ذكية | ทีวีอัจฉริยะ | 스마트 TV' } });
  check('Arabic, Thai and Korean arrive exactly as typed', t.target['jcr:title'] === 'تلفزيونات ذكية | ทีวีอัจฉริยะ | 스마트 TV', t.target['jcr:title']);
}
{
  const t = await checkThenWrite({
    translations: { '.@jcr:title': 'Koop Smart TVs' },
    between: (c) => {
      c['jcr:title'] = 'Edited by an author after the check';
    }
  });
  check('a page edited after the check is not written', /changed since you checked|Nothing on the sheet/.test(String(t.error)), String(t.error));
  check('...nothing at all is posted', t.log.posts.length === 0, JSON.stringify(t.log.posts.map((p) => p.url)));
}
{
  const t = await checkThenWrite({ translations: { '.@jcr:title': 'Koop Smart TVs' }, approved: 'h00000000' });
  check('writes that are not the ones reviewed are refused', /no longer what you reviewed/.test(String(t.error)) && t.log.posts.length === 0, String(t.error));
}
{
  const locked = unlocked();
  locked['jcr:lockOwner'] = 'admin';
  const t = await checkThenWrite({ tree: locked, translations: { '.@jcr:title': 'Koop Smart TVs' } });
  check('a page locked by someone else stops the run before anything is written', /locked by admin/.test(String(t.error)) && t.log.posts.length === 0, String(t.error));
  const mine = await checkThenWrite({ tree: locked, translations: { '.@jcr:title': 'Koop Smart TVs' }, opts: { user: 'admin' } });
  check('...a page locked by the writer is written', mine.error === null && mine.target['jcr:title'] === 'Koop Smart TVs', String(mine.error));
}
{
  const t = await checkThenWrite({ translations: { '.@jcr:title': 'Koop Smart TVs', '.@localTitle': 'Tv’s' }, opts: { reject: true } });
  check('a rejected write stops the run and says nothing was saved', /Nothing was saved/.test(String(t.error)), String(t.error));
  check('...and it is: nothing half-written', t.target['jcr:title'] === FIXTURE['jcr:title'] && t.target.localTitle === FIXTURE.localTitle, '');
  check('...the write step is marked failed', t.steps.some((s) => s.id === 'write' && s.state === 'failed'), JSON.stringify(t.steps));
}
{
  const t = await checkThenWrite({
    translations: { '.@jcr:title': 'Koop Smart TVs', [`${HERO}@headlineText`]: 'Ontdek' },
    opts: { dropAfterWrite: { path: HERO, prop: 'headlineText' } }
  });
  check('a property that did not land is caught on reading back', /do(es)? not hold/.test(String(t.error)) && String(t.error).includes('headlineText'), String(t.error));
  check('...and named in the activity log', t.lines.some((l) => l.message.includes('differs') && l.message.includes('headlineText')), '');
}
{
  const t = await checkThenWrite({ translations: {} });
  check('nothing to write is refused', /Nothing on the sheet can be written/.test(String(t.error)) && t.log.posts.length === 0, String(t.error));
}
{
  const tree = unlocked();
  tree.keywords = ['smart TV', 'QLED', 'OLED'];
  const t = await checkThenWrite({ tree, translations: { '.@keywords[1]': 'QLED-tv' } });
  check('a multi-value property stays multi-value', JSON.stringify(t.target.keywords) === JSON.stringify(['smart TV', 'QLED-tv', 'OLED']), JSON.stringify(t.target.keywords));
  check('...because it was sent as String[]', contentPosts(t.log)[0].entries.some(([k, v]) => k === './keywords@TypeHint' && v === 'String[]'), '');
}
{
  // Checked and written the way the panel drives it: a sheet with the showcase's script on it, beside a title.
  const tree = withStaticBlocks(unlocked());
  const target = clone(tree);
  const log = installAem(target);
  const script = nodeAt(tree, SHOW).footerInclude;
  const grid = [core.SHEET_COLUMNS, handRow('.@jcr:title', tree['jcr:title'], 'Koop Smart TVs'), handRow(`${SHOW}@footerInclude`, script, script.replace('Sleep better', 'Mieux dormir'))];
  const params = { page: TARGET, sheet: JSON.stringify(grid) };
  const checked = await actions.check({ client: new AemClient(), report: () => {}, params, settings: {} });
  let error = null;
  try {
    await actions.apply({ client: new AemClient(), report: () => {}, params: { ...params, approved: checked.approved }, settings: {} });
  } catch (e) {
    error = e.message;
  }
  check(
    'written for real, a sheet with a block’s script on it writes the title and leaves the script exactly as it was',
    error === null && target['jcr:title'] === 'Koop Smart TVs' && nodeAt(target, SHOW).footerInclude === script,
    String(error)
  );
  check('...the script is not even in the request', !contentPosts(log).some((p) => p.entries.some(([k]) => k.includes('Include'))), JSON.stringify(contentPosts(log).map((p) => p.entries.map(([k]) => k))));
}

console.log('\n--- Static Content: written only when its section is ticked -----------');

{
  /* The explore-samsung-health page, its 8 blocks, every text "translated" on a
   * v4 sheet - checked and written the way the panel drives it: the sections
   * ticked, and the fingerprint of the writes they make, with the write. */
  const FIX = JSON.parse(readFileSync(base + 'test/fixtures/copy-deck-explore-samsung-health.json', 'utf8'));
  const sheet = core.buildSheet(core.extractCopyDeck(clone(FIX), { pagePath: SOURCE }).rows, { pagePath: SOURCE, exportedAt: '2026-10-12 10:00' });
  const S = sheet.columns.indexOf('Source text');
  const T = sheet.columns.indexOf('Translation');
  for (const rec of sheet.records.slice(0, -1)) rec[T] = `[fr] ${rec[S]}`;
  const sheetParam = JSON.stringify(core.gridFromText(clipboard([sheet.columns, ...sheet.records])));
  const blocksOf = (c) => Object.entries(c.root.responsivegrid).filter(([, n]) => n?.['sling:resourceType']?.endsWith('cm-g-static-content'));

  /** Checked, then written with `pick` - the sections ticked, from the check's - and the fingerprint the panel makes for them. */
  async function write({ pick = (c) => c.selected, approve = pick, between, before } = {}) {
    const target = unlocked(clone(FIX));
    if (before) before(target);
    const log = installAem(target);
    const params = { page: TARGET, sheet: sheetParam };
    const checked = await actions.check({ client: new AemClient(), report: () => {}, params, settings: {} });
    if (between) between(target);
    log.posts.length = 0;
    const steps = [];
    const report = (level, message, data) => level === 'data' && message === 'step' && steps.push(data);
    const sections = pick(checked);
    const ids = approve(checked);
    const approved = core.writesFingerprint(checked.offered.filter((w) => ids.includes(w.section)), { origin: checked.origin, page: checked.page, sections: ids });
    let error = null;
    try {
      await actions.apply({ client: new AemClient({ report }), report, params: { ...params, sections, approved }, settings: {} });
    } catch (e) {
      error = e.message;
    }
    return { checked, target, log, steps, error };
  }
  const statics = (c) => c.sections.filter((s) => s.static).map((s) => s.id);
  const all = (c) => c.sections.map((s) => s.id);

  const off = await write();
  check(
    'Static Content sections are unticked by default: the check offers their writes, writes none, and every block is as it was',
    off.error === null && off.checked.writes.length > 0 && !off.checked.writes.some((w) => w.static) && off.checked.offered.some((w) => w.static) &&
      statics(off.checked).length === 8 && statics(off.checked).every((id) => !off.checked.selected.includes(id)) &&
      blocksOf(off.target).every(([name, n]) => n.bodyHtml === FIX.root.responsivegrid[name].bodyHtml && n.footerInclude === FIX.root.responsivegrid[name].footerInclude) &&
      !contentPosts(off.log).some((p) => p.entries.some(([k]) => /bodyHtml|footerInclude/.test(k))),
    String(off.error)
  );

  const on = await write({ pick: all });
  const prepared = on.checked.staticBlocks.filter((b) => b.prepared !== null);
  const footers = on.checked.staticBlocks.filter((b) => b.preparedFooter !== null);
  const written = on.checked.offered.filter((w) => w.static);
  check(
    'all ticked: the writes add each block’s prepared Body(HTML), and block 3’s Footer, after the texts',
    prepared.length > 0 && prepared.length < on.checked.staticBlocks.length && footers.length === 1 && footers[0].no === 3 &&
      JSON.stringify(written.map((w) => [w.path, w.prop, w.to])) ===
        JSON.stringify(on.checked.staticBlocks.flatMap((b) => [...(b.prepared !== null ? [[b.path, 'bodyHtml', b.prepared]] : []), ...(b.preparedFooter !== null ? [[b.path, 'footerInclude', b.preparedFooter]] : [])])) &&
      JSON.stringify(on.checked.offered.filter((w) => !w.static)) === JSON.stringify(off.checked.writes),
    JSON.stringify([prepared.length, footers.map((b) => b.no), on.checked.staticBlocks.map((b) => b.footerReason)])
  );
  check(
    '...written, each block holds its prepared values exactly, CRLF and all; a block with none is as it was; no Header written',
    on.error === null &&
      prepared.every((b) => nodeAt(on.target, b.path).bodyHtml === b.prepared) &&
      footers.every((b) => nodeAt(on.target, b.path).footerInclude === b.preparedFooter) &&
      on.checked.staticBlocks.filter((b) => b.prepared === null).every((b) => nodeAt(on.target, b.path).bodyHtml === nodeAt(FIX, b.path).bodyHtml) &&
      blocksOf(on.target).every(([name, n]) => n.headerInclude === FIX.root.responsivegrid[name].headerInclude) &&
      !contentPosts(on.log).some((p) => p.entries.some(([k]) => k.includes('headerInclude'))),
    String(on.error)
  );
  check(
    '...one request for the texts and one per Body or Footer, and the read-back passes',
    contentPosts(on.log).length === 1 + written.length && on.steps.some((s) => s.id === 'verify' && s.state === 'done'),
    JSON.stringify(on.steps)
  );

  // The Footer DSY writes: its code exactly as it was - the same tokens - only the strings put in changed.
  const show = footers[0];
  const tokens = (js) => {
    const out = [];
    const re = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
    let at = 0;
    for (const m of js.matchAll(re)) {
      out.push(js.slice(at, m.index));
      at = m.index + m[0].length;
    }
    return [...out, js.slice(at)].join('""');
  };
  const sentence = '`${e[6] === "open" ? "Close" : "Open"} showcase container`';
  check(
    'the Footer written has the old script’s code exactly, only the strings changed, the built sentence a choice of the two translations',
    tokens(show.preparedFooter) === tokens(show.old.footerInclude.split(sentence).join('(e[6] === "open" ? "" : "")')) &&
      show.preparedFooter.includes('title: "[fr] Energy Score"') &&
      show.preparedFooter.includes('(e[6] === "open" ? "[fr] Close showcase container" : "[fr] Open showcase container")') &&
      !show.preparedFooter.includes(sentence),
    show.preparedFooter.slice(0, 200)
  );

  // A translation with quotes, a backslash and "</script>" in it: escaped, and the script still has the same code.
  const sc = await import(pathToFileURL(base + 'src/features/copy-deck/static-content.js'));
  const js = 'var t = { title: "Energy Score", label: \'Heart health\' };\r\nel.textContent = "Sleep better";';
  const tricky = sc.prepareFooter(js, [
    { cell: 'Energy Score', translation: 'Score "énergie" \\ </script><!-- x' },
    { cell: 'Heart health', translation: "Santé l'cœur" },
    { cell: 'Sleep better', translation: '' }
  ]);
  check(
    'quotes, a backslash, "</script" and "<!--" in a translation are escaped for their string; an untranslated string stays as it was',
    tricky.value === 'var t = { title: "Score \\"énergie\\" \\\\ <\\/script><\\!-- x", label: \'Santé l\\\'cœur\' };\r\nel.textContent = "Sleep better";',
    JSON.stringify(tricky)
  );
  const notChoice = sc.prepareFooter('el.title = `${a ? "Close" : b ? "Pause" : "Open"} showcase container`;\r\nvar t = { title: "Energy Score" };', [
    { cell: '{…} showcase container', translation: '{…} vitrine' },
    { cell: 'Energy Score', translation: 'Score' }
  ]);
  check('a built sentence that is not one choice: no Footer is offered, and why is said', notChoice.value === null && /not one choice between two sentences/.test(notChoice.reason), JSON.stringify(notChoice));

  // A Footer that fails DSY's own check - "</script" in its code - is not written; the block's Body still is.
  const broken = await write({
    pick: all,
    before: (c) => {
      nodeAt(c, show.path).footerInclude += '\r\ndocument.write("<script></script>");';
    }
  });
  const b3 = broken.checked.staticBlocks.find((b) => b.no === 3);
  check(
    'a Footer that fails the check is not offered, says why, and is not written - while its Body(HTML) still is',
    broken.error === null && b3.preparedFooter === null && /^Not offered: DSY’s own check of the new Footer\(Javascript\) found a problem/.test(b3.footerReason) &&
      !broken.checked.offered.some((w) => w.prop === 'footerInclude') &&
      nodeAt(broken.target, b3.path).footerInclude === nodeAt(FIX, b3.path).footerInclude + '\r\ndocument.write("<script></script>");' &&
      (b3.prepared === null || nodeAt(broken.target, b3.path).bodyHtml === b3.prepared) &&
      broken.checked.staticBlocks.filter((b) => b.prepared !== null).every((b) => nodeAt(broken.target, b.path).bodyHtml === b.prepared),
    JSON.stringify([broken.error, b3.footerReason])
  );

  // One section ticked: only its writes.
  const one = await write({ pick: (c) => [statics(c).find((id) => c.offered.some((w) => w.section === id))] });
  const oneId = statics(one.checked).find((id) => one.checked.offered.some((w) => w.section === id));
  check(
    'one Static Content section ticked, nothing else: only that block is written - no text, no other block',
    // The page's own cq:lastModified goes in the request the texts would: one more.
    one.error === null && contentPosts(one.log).length === 1 + one.checked.offered.filter((w) => w.section === oneId).length &&
      blocksOf(one.target).every(([name, n]) => (name === one.checked.offered.find((w) => w.section === oneId).path.split('/').pop()) || n.bodyHtml === FIX.root.responsivegrid[name].bodyHtml) &&
      one.target['jcr:title'] === FIX['jcr:title'],
    JSON.stringify([one.error, oneId, contentPosts(one.log).length])
  );
  const none = await write({ pick: () => [] });
  check('nothing ticked: the write refuses, nothing is posted', /Nothing on the sheet can be written/.test(String(none.error)) && none.log.posts.length === 0, String(none.error));

  const changed = await write({
    pick: all,
    between: (c) => {
      const n = nodeAt(c, prepared[0].path);
      n.bodyHtml = `<!-- edited after Check -->\r\n${n.bodyHtml}`;
    }
  });
  check('a block changed after Check refuses the write - nothing is posted', /no longer what you reviewed/.test(String(changed.error)) && changed.log.posts.length === 0, String(changed.error));
  const turned = await write({ pick: all, approve: (c) => c.selected });
  check('...and so does a selection other than the one the fingerprint was made for', /no longer what you reviewed/.test(String(turned.error)) && turned.log.posts.length === 0, String(turned.error));
}

console.log('\n--- review fixes: writing --------------------------------------------');

/* A placeholder with something added is not the link: it must be refused. */
{
  const r1 = bad('Bekijk <a1 title="voorwaarden">onze aanbiedingen</a1> vandaag.<br>Alleen online.');
  check('a placeholder given attributes (<a1 title=…>) is refused', r1.status === 'invalid' && /stay exactly as they are/.test(r1.message), JSON.stringify(r1));
  const r2 = bad('<a1 onmouseover="alert(document.cookie)">x</a1><br>y');
  check('...and so is one given an event handler', r2.status === 'invalid', JSON.stringify(r2));
}

/* The exported header wins; two candidates for a column that decides the write is refused. */
{
  const { sheet } = roundTrip(clone(FIXTURE), { '.@jcr:title': 'Koop Smart TVs' });
  const T = sheet.columns.indexOf('Translation');
  const withNotes = [sheet.columns, ...sheet.records].map((r, i) => [...r.slice(0, T), i === 0 ? 'Translation notes' : 'keep it short', ...r.slice(T)]);
  const s1 = core.readSheet(withNotes);
  const title = s1.rows.find((r) => r.key === '.@jcr:title');
  check('an added "Translation notes" column is not read as the translation', s1.ok && title.translation === 'Koop Smart TVs', JSON.stringify(title));
  const renamed = withNotes.map((r, i) => (i === 0 ? r.map((c) => (c === 'Translation' ? 'Translation (NL)' : c)) : r));
  const s2 = core.readSheet(renamed);
  check('two columns that could be Translation, neither exact, is refused', !s2.ok && /More than one column/.test(s2.problem), JSON.stringify(s2.problem));
  const onlyRenamed = [sheet.columns.map((c) => (c === 'Translation' ? 'Translation (NL)' : c)), ...sheet.records];
  check('...while a single renamed Translation column is still found', core.readSheet(onlyRenamed).rows.find((r) => r.key === '.@jcr:title')?.translation === 'Koop Smart TVs', '');
}

/* Line breaks as AEM will store them: the plan, the fingerprint and the read-back agree. */
{
  const tree = unlocked();
  tree.root.responsivegrid.pd_g_feature_benefit.headlineText = 'Discover Samsung TVs\nfor every room'; // stored with LF
  const t = await checkThenWrite({ tree, translations: { [`${HERO}@headlineText`]: 'Ontdek Samsung TVs\nvoor elke kamer', '.@jcr:title': 'Koop\nSmart TVs' } });
  check('a line break is planned as CRLF - what the multipart write stores', t.checked.writes.find((w) => w.prop === 'headlineText')?.to === 'Ontdek Samsung TVs\r\nvoor elke kamer', JSON.stringify(t.checked.writes.find((w) => w.prop === 'headlineText')?.to));
  check('...even where the source had none (Alt+Enter in a one-line field)', t.checked.writes.find((w) => w.prop === 'jcr:title')?.to === 'Koop\r\nSmart TVs', '');
  check('...so the write reads back as written, not as a failure', t.error === null && t.steps.some((s) => s.id === 'verify' && s.state === 'done'), String(t.error));
  check('...and the page holds exactly that', nodeAt(t.target, HERO).headlineText === 'Ontdek Samsung TVs\r\nvoor elke kamer', JSON.stringify(nodeAt(t.target, HERO).headlineText));
}
{
  const t = richTree();
  t.root.responsivegrid.cm_g_text_block_copy_1409814884.description = 'See <a href="/za/offers/" title="line one\r\nline two">our offers</a>.';
  const { text } = roundTrip(clone(t), { [`${RICH}@description`]: 'Bekijk <a1>onze aanbiedingen</a1>.' }, { placeholders: true });
  const w = writeOf(plan(clone(t), text), RICH, 'description');
  check('a CRLF inside a tag that is put back stays one CRLF', w?.to === 'Bekijk <a href="/za/offers/" title="line one\r\nline two">onze aanbiedingen</a>.', JSON.stringify(w?.to));
}

/* Entities in attributes are written once, not twice. */
{
  const t = richTree();
  t.root.responsivegrid.cm_g_text_block_copy_1409814884.description = 'See <a href="/x" title="Galaxy S24&trade; &ndash; Ultra">it</a>.';
  const { text } = roundTrip(clone(t), { [`${RICH}@description~a1.title`]: 'Galaxy S24&trade; &ndash; Ultra NL & meer' }, { placeholders: true });
  const w = writeOf(plan(clone(t), text), RICH, 'description');
  check('&trade; in a translated title stays an entity, a bare & is escaped', w?.to.includes('title="Galaxy S24&trade; &ndash; Ultra NL &amp; meer"'), JSON.stringify(w?.to));
}

/* A plain heading next to one with a class is not an invented placeholder. */
{
  const t = richTree();
  t.root.responsivegrid.cm_g_text_block_copy_1409814884.description = '<h2 class="title">Big screens</h2><h3>For every room</h3>';
  const { text } = roundTrip(clone(t), { [`${RICH}@description`]: '<h21>Grote schermen</h21><h3>Voor elke kamer</h3>' }, { placeholders: true });
  const p = plan(clone(t), text);
  check('<h2 class> beside a plain <h3> can be translated', rowOf(p, `${RICH}@description`)?.status === 'ready', JSON.stringify(rowOf(p, `${RICH}@description`)));
  check('...and is written with the heading’s own class', writeOf(p, RICH, 'description')?.to === '<h2 class="title">Grote schermen</h2><h3>Voor elke kamer</h3>', writeOf(p, RICH, 'description')?.to);
  const { text: t2 } = roundTrip(clone(t), { [`${RICH}@description`]: '<h21>Grote</h21><h22>schermen</h22><h3>Voor elke kamer</h3>' }, { placeholders: true });
  check('...while an invented <h22> is still refused', /not in the source/.test(rowOf(plan(clone(t), t2), `${RICH}@description`)?.message), '');
}

/* Approved on one server, written on another: refused. */
{
  const target = unlocked();
  const log = installAem(target);
  const { text } = roundTrip(unlocked(), { '.@jcr:title': 'Koop Smart TVs' });
  const params = { page: TARGET, sheet: JSON.stringify(core.gridFromText(text)) };
  globalThis.location = { origin: 'https://stage-author.samsung.com' };
  const checked = await actions.check({ client: new AemClient(), report: () => {}, params, settings: {} });
  globalThis.location = { origin: 'https://prod-author.samsung.com' };
  log.posts.length = 0;
  let error = null;
  try {
    await actions.apply({ client: new AemClient(), report: () => {}, params: { ...params, approved: checked.approved }, settings: {} });
  } catch (e) {
    error = e.message;
  }
  delete globalThis.location;
  check('a write approved on one author instance is refused on another', /another server or page/.test(String(error)) && log.posts.length === 0, String(error));
  check('...the check says which server it ran on', checked.origin === 'https://stage-author.samsung.com', checked.origin);
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

/** A zip the way Excel writes one: every entry deflated. */
function zipDeflated(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const n = enc.encode(name);
    const raw = enc.encode(text);
    const data = new Uint8Array(deflateRawSync(raw));
    const l = new DataView(new ArrayBuffer(30));
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(8, 8, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, raw.length, true);
    l.setUint16(26, n.length, true);
    locals.push(new Uint8Array(l.buffer), n, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(10, 8, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, raw.length, true);
    c.setUint16(28, n.length, true);
    c.setUint32(42, offset, true);
    centrals.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const size = centrals.reduce((s, b) => s + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(e.buffer)];
  const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
}
