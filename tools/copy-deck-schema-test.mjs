/**
 * Copy deck, export and import, on a Static Content block's FAQ schema
 * (JSON-LD) with a line break inside an answer. No screens, no AEM: the sheet
 * as the export writes it, read back and planned by the import.
 *
 *   node tools/copy-deck-schema-test.mjs
 *
 * On tr/mobile-phone-buying-guide/best-samsung-galaxy-z-phone an answer had
 * been pasted in from a document with its line breaks. A raw line break inside
 * a string is not JSON, so the reader took the whole script for code and none
 * of its texts reached the sheet. The browser suite stubs every worker, so it
 * could never have shown that - this runs the real reader.
 *
 * Written to drop into engine-test-copy-deck.mjs as a section of its own: the
 * helpers below are that file's.
 */

const C = await import('../src/features/copy-deck/core.js');

const PAGE = '/content/samsung/tr/test-page';

let failed = 0;
const check = (ok, said, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${said}${ok || !detail ? '' : ` - ${detail}`}`);
  if (!ok) failed++;
};

const exported = (content, pagePath = '/content/samsung/uk/test-page') =>
  C.buildSheet(C.extractCopyDeck(content, { pagePath }).rows, { pagePath, exportedAt: '2026-11-22 10:00' });
/** The sheet with each Translation cell set from its Source text. */
const translated = (sheet, fn) => ({ ...sheet, records: sheet.records.map((r) => (r[3] === '#meta' ? r : [...r.slice(0, 6), fn(r[5], r)])) });
/** The grid as Excel hands it over, cell for cell. */
const gridOf = (sheet) => [sheet.columns, ...sheet.records].map((r) => r.map(String));
const plan = (content, grid, pagePath = PAGE) => {
  const rs = C.readSheet(grid);
  return rs.ok ? C.planImport(content, rs, { pagePath }) : { problem: rs.problem };
};
const isSchemaRow = (r) => /Search engine data/.test(r.join('|'));

console.log('');
console.log('--- copy deck: FAQ schema with a line break inside an answer ---');
{
  const SC = 'samsung/components/content/consumer/global/common/cm-g-static-content';
  // Stored as AEM serves it: CRLF throughout, and one answer broken across two lines.
  const body =
    '<p class="hideInAem">FAQ schema for page</p>\r\n\r\n<script type="application/ld+json">\r\n{\r\n  "@context": "https://schema.org",\r\n  "@type": "FAQPage",\r\n' +
    '  "mainEntity": [{\r\n    "@type": "Question",\r\n    "name": "What is the Samsung Galaxy Z Series?",\r\n    "acceptedAnswer": {\r\n      "@type": "Answer",\r\n' +
    '      "text": "The Galaxy Z Series is designed for\r\nthe future, with you in mind."\r\n    }\r\n  },{\r\n    "@type": "Question",\r\n' +
    '    "name": "Should I buy the Samsung Galaxy Z Fold5?",\r\n    "acceptedAnswer": {\r\n      "@type": "Answer",\r\n      "text": "If you are looking for an epic Samsung phone, yes."\r\n    }\r\n  }]\r\n}\r\n</script>\r\n';
  const content = {
    'jcr:primaryType': 'cq:PageContent',
    'jcr:title': 'Best Samsung Galaxy Z Fold & Flip Phones',
    root: { 'jcr:primaryType': 'nt:unstructured', faq: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': SC, bodyHtml: body } }
  };

  const sheet = exported(content);
  const ld = sheet.records.filter(isSchemaRow);
  check(ld.length === 4, 'each question and answer of the schema is a row', `${ld.length} rows`);
  check(ld.some((r) => r[5] === 'The Galaxy Z Series is designed for the future, with you in mind.'), 'the answer with a line break reads as one line');

  const grid = gridOf(translated(sheet, (src, r) => (isSchemaRow(r) ? `FR ${src}` : '')));
  const p = plan(content, grid);
  const block = p.staticBlocks?.find((b) => b.path === 'root/faq');
  check(Boolean(block?.prepared), 'the import offers the block with its translations in', block?.reason || p.problem);
  let parsed = null;
  try {
    parsed = JSON.parse(block.prepared.slice(block.prepared.indexOf('{'), block.prepared.lastIndexOf('}') + 1));
  } catch {
    // Stays null: the check below says so.
  }
  check(parsed?.mainEntity?.[0]?.acceptedAnswer?.text === 'FR The Galaxy Z Series is designed for the future, with you in mind.', 'the translated schema is strict JSON, the answer translated');
  check(Boolean(block?.prepared?.startsWith('<p class="hideInAem">FAQ schema for page</p>')), 'the rest of the block is as it was');

  // Only the answer without a line break translated: the other keeps its break, and the import's own check still passes.
  const one = gridOf(translated(sheet, (src) => (src.startsWith('If you are') ? `FR ${src}` : '')));
  const b1 = plan(content, one).staticBlocks?.find((b) => b.path === 'root/faq');
  check(Boolean(b1?.prepared) && b1.prepared.includes('designed for\r\nthe future'), 'an untranslated answer keeps its line break, and the block is still offered', b1?.reason);

  // A script broken any other way is still code: no rows from it.
  const broken = { ...content, root: { ...content.root, faq: { ...content.root.faq, bodyHtml: body.replace('"FAQPage",', '"FAQPage"') } } };
  check(!exported(broken).records.some(isSchemaRow), 'a schema with a missing comma gives no rows');
}

if (failed) {
  console.log(`\ncopy deck schema: ${failed} FAILED`);
  process.exitCode = 1;
} else {
  console.log('\ncopy deck schema: all passed');
}
