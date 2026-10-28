/* Structured data (JSON-LD) in a Static Content block: its words on the sheet,
 * and back into the block as JSON. Made from the block that showed it: the
 * levant best-tablet-for-student page's video schema.
 */
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/src/features/copy-deck/';
const core = await import(pathToFileURL(base + 'core.js'));
const sc = await import(pathToFileURL(base + 'static-content.js'));

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};

const PAGE = '/content/samsung/levant_ar/mobile-phone-buying-guide/best-tablet-for-student';
const RT = 'samsung/components/content/consumer/global/common/cm-g-static-content';
const NAME = 'Next Level Multitasking | Galaxy Tab S8 Tablet & Book Cover Keyboard | Samsung LEVANT';
const DESC = 'Boost your productivity with the Galaxy Tab S8, S8+ or S8 Ultra tablet and the Book Cover Keyboard.  Shop the latest Galaxy S Series tablets at: https://bit.ly/buy-tab-s8';
const BODY =
  '<style>\r\n.hideInAem {\r\n    display: none;\r\n}\r\n</style>\r\n\r\n<p class="hideInAem">Schema</p>\r\n\r\n' +
  '<script type="application/ld+json">{\r\n  "@context": "http://schema.org",\r\n  "@type": "VideoObject",\r\n' +
  `  "name": "${NAME}",\r\n  "description": "${DESC}",\r\n` +
  '  "thumbnailUrl": "https://i.ytimg.com/vi/Z5Gvmd_dSIE/default.jpg",\r\n  "uploadDate": "2022-03-10T08:00:24Z",\r\n' +
  '  "duration": "PT19S",\r\n  "embedUrl": "https://www.youtube.com/embed/Z5Gvmd_dSIE",\r\n  "interactionCount": "4017"\r\n}</script>';

const tree = (body = BODY) => ({
  'jcr:primaryType': 'cq:PageContent',
  'jcr:title': 'Best Tablet For Students',
  root: { responsivegrid: { cm_g_static_content: { 'sling:resourceType': RT, bodyHtml: body } } }
});

/* ------------------------------------------------------------ the export */
const deck = core.extractCopyDeck(tree(), { pagePath: PAGE });
const ld = deck.rows.filter((r) => r.category === 'static' && r.source !== 'Schema');
check('the name and description are rows', ld.map((r) => r.source).join('|') === `${NAME}|${DESC.replace(/\s+/g, ' ')}`, JSON.stringify(ld.map((r) => r.source)));
check('in the Static HTML group', ld.every((r) => r.category === 'static'), '');
check('no URL, date, duration, count or @type is a row', !deck.rows.some((r) => /ytimg|2022-03|PT19S|4017|VideoObject|schema\.org/.test(r.source)), JSON.stringify(deck.rows.map((r) => r.source)));
check('no longer listed as code for a developer', !(deck.staticCode || []).some((c) => c.texts.some((t) => t.startsWith('Next Level'))), JSON.stringify(deck.staticCode));
const block = sc.readBlock({ bodyHtml: BODY });
const place = sc.blockTexts(block).find((t) => t.cell === NAME).places[0];
check('labelled as search engine data', place.kind === 'Search engine data (VideoObject name)', place.kind);
check('with a hint that it is not on the page', place.hints.some((h) => h.includes('search engines')), JSON.stringify(place.hints));

{
  const notJson = BODY.replace('"@type": "VideoObject",', '"@type": "VideoObject",,');
  const d = core.extractCopyDeck(tree(notJson), { pagePath: PAGE });
  check('a script that is not JSON gives no rows - it stays code', !d.rows.some((r) => r.source === NAME), JSON.stringify(d.rows.map((r) => r.source)));
}

/* ------------------------------------------------------------ the way back */
const AR_NAME = 'تعدد المهام بمستوى جديد | الجهاز اللوحي Galaxy Tab S8 ولوحة المفاتيح Book Cover Keyboard | ‏Samsung المشرق';
const AR_DESC = 'عزز إنتاجيتك مع "Galaxy Tab S8" - C:\\ \\n 100% {}';

function importWith(translations) {
  const rows = core.selectRows(deck.rows);
  const sheet = core.buildSheet(rows, { pagePath: PAGE, exportedAt: '2026-10-21 16:00' });
  const S = sheet.columns.indexOf('Source text');
  const T = sheet.columns.indexOf('Translation');
  for (const rec of sheet.records) if (rec[S] in translations) rec[T] = translations[rec[S]];
  const read = core.readSheet([sheet.columns, ...sheet.records]);
  return core.planImport(tree(), read, { pagePath: PAGE, sections: null });
}

{
  const plan = importWith({ [NAME]: AR_NAME, [ld[1].source]: AR_DESC });
  const b = plan.staticBlocks[0];
  check('the block is prepared', b && b.prepared !== null, `reason: ${b?.reason} ${JSON.stringify(b?.checks)}`);
  const script = b?.prepared?.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  let json = null;
  try {
    json = JSON.parse(script);
  } catch {}
  check('the script still reads as JSON', json !== null, script);
  check('the name is the translation', json?.name === AR_NAME, json?.name);
  check('quotes, backslashes and braces stay words', json?.description === AR_DESC, json?.description);
  check('nothing in a translation can close the script', (b?.prepared.match(/<\/script>/g) || []).length === 1, b?.prepared);
  check('the rest of the JSON is as it was', json?.embedUrl === 'https://www.youtube.com/embed/Z5Gvmd_dSIE' && json?.duration === 'PT19S' && json?.['@type'] === 'VideoObject', JSON.stringify(json));
  const outside = (v) => v.replace(/"name": "[^"]*"/, '').replace(/"description": "(?:[^"\\]|\\.)*"/, '');
  check('every byte outside the two values is the block\'s own', outside(b?.prepared ?? '') === outside(BODY), '');
}

{
  const plan = importWith({ [NAME]: '</script><script>alert(1)</script>' });
  const b = plan.staticBlocks[0];
  const item = b.items.find((i) => i.cell === NAME);
  // Nothing else translated in the block: there is no new Body at all, and the English stays.
  const name = b.prepared ? JSON.parse(b.prepared.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]).name : NAME;
  check('markup in a translation is sent back, the English kept', item?.status === 'sent back' && name === NAME, JSON.stringify(item));
}

{
  const plan = importWith({ [NAME]: AR_NAME });
  const b = plan.staticBlocks[0];
  const json = JSON.parse(b.prepared.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  check('one value translated, the other left in English', json.name === AR_NAME && json.description === DESC, JSON.stringify(json));
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
