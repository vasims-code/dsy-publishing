/**
 * The Arabic fixer's scan, run for real in Node: what the copy deck lists
 * from a page and what findIssues makes of it. Imported at the end of
 * engine-test.mjs, so `node tools/engine-test.mjs` runs it too.
 *
 * The fixer checks only the fields the copy deck lists, so a field the copy
 * deck misses is a field that is never fixed - and no browser test can tell,
 * since every worker there is stubbed.
 */

const { extractCopyDeck } = await import('../src/features/copy-deck/core.js');
const { findIssues } = await import('../src/features/arabic-fixer/worker.js');
const { rulesFor } = await import('../src/features/arabic-fixer/bidi.js');

let failures = 0;
const check = (ok, name, why = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !why ? '' : ` - ${why}`}`);
  if (!ok) failures++;
};

console.log('');
console.log('--- the Arabic fixer ---');

/* 1. A Text Editor's footnotes - shaped as the SA Fold8 buying guide stores
   them, the shown part and the part behind "more" - are checked. */
const editor = {
  'sling:resourceType': 'samsung/components/content/consumer/global/common/cm-g-text-editor',
  componentTheme: 'bg-white',
  useAccordionCTA: 'false',
  useFlag: 'false',
  textIsRich: ['true', 'true'],
  column1: {
    descriptionDefaultText:
      '<p><sup>5</sup>&nbsp;السعة المُقدَّرة لبطارية هاتف Galaxy Z Fold8 هي 4660 mAh.</p>\r\n',
    useAccordionCTA: 'true',
    descriptionHiddenText: '<p><sup>13</sup>&nbsp;السعة المُقدَّرة لبطارية هاتف Galaxy Z Fold8 هي 4660 mAh.</p>\r\n',
    headlineHeadingLevel: 'h5',
    descriptionTextSize: 'text-editor--description-text-size-small'
  },
  column2: { useFlag: 'false', useAccordionCTA: 'false' }
};
const tree = {
  'jcr:primaryType': 'cq:PageContent',
  'jcr:title': 'Galaxy Z Fold8: الميزات والمواصفات',
  root: {
    'sling:resourceType': 'wcm/foundation/components/responsivegrid',
    responsivegrid: { 'sling:resourceType': 'wcm/foundation/components/responsivegrid', editor }
  }
};
const deck = extractCopyDeck(tree, { pagePath: '/content/samsung/sa/test' });
const listed = (prop) => deck.rows.some((r) => r.path === 'root/responsivegrid/editor/column1' && r.prop === prop);
check(listed('descriptionDefaultText'), "a Text Editor's shown text is on the copy deck");
check(listed('descriptionHiddenText'), 'and the text behind its "more" button');
check(!deck.newFields.some((f) => /^description(Default|Hidden)Text$/.test(f.prop)), 'neither is offered as a new field to add');
check(!deck.rows.some((r) => r.prop === 'descriptionTextSize'), 'its text size setting is not copy');

const { issues } = findIssues(tree, deck.rows, rulesFor({}));
const issue = (prop) => issues.find((i) => i.key === `root/responsivegrid/editor/column1|${prop}`);
check(issue('descriptionDefaultText')?.runs.includes('4660 mAh'), 'the fixer finds the flipping run in the shown text', JSON.stringify(issues.map((i) => i.key)));
check(issue('descriptionHiddenText')?.runs.includes('4660 mAh'), 'and in the text behind "more"');
check(/<sup>5<\/sup>/.test(issue('descriptionDefaultText')?.to || ''), 'the fix keeps the markup');

if (failures) {
  console.log(`\n${failures} Arabic fixer check(s) failed`);
  process.exitCode = 1;
}
