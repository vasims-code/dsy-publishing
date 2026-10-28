/* Component alignment, tested against the real UK -> LB pair.
 *
 * The fixture is the actual component sequence of
 *   p6-eu-author  /content/samsung/uk/mobile-phone-buying-guide/samsung-fold-vs-flip
 *   p6-ap-author  /content/samsung/lb/mobile-phone-buying-guide/samsung-fold-vs-flip
 * reduced to node name + sling:resourceType, which is all the matcher looks at.
 */
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/src/';
const { alignTrees, relabel, destResolver } = await import(pathToFileURL(base + 'core/align.js'));

const RT = {
  static: 'samsung/components/content/consumer/global/common/cm-g-static-content',
  text: 'samsung/components/content/consumer/global/common/cm-g-text-block',
  video: 'samsung/components/content/consumer/global/common/cm-g-video',
  fb: 'samsung/components/content/consumer/global/product/pd-g-feature-benefit',
  fbfull: 'samsung/components/content/consumer/global/product/pd-g-feature-benefit-full-bleed',
  curation: 'samsung/components/content/consumer/global/product/pd-g-curation-card',
  compare: 'samsung/components/content/consumer/global/product/pd-g-lineup-compare',
  showcase: 'samsung/components/content/consumer/global/home/ho-g-showcase-card',
  crumb: 'samsung/components/content/consumer/global/navigation/nv-g-breadcrumb',
  grid: 'wcm/foundation/components/responsivegrid'
};

const UK = [
  ['cm_g_static_content_', 'static', 'FAQ schema'],
  ['pd_g_feature_benefit', 'fbfull', 'hero KV'],
  ['cm_g_text_block_copy', 'text', 'intro copy'],
  ['cm_g_static_content', 'static', 'anchor bar'],
  ['cm_g_video', 'video', 'YouTube Fold7'],
  ['cm_g_static_content__1683658206', 'static', 'video schema Fold7'],
  ['cm_g_text_block_7132', 'text', 'difference'],
  ['pd_g_feature_benefit_2084490669', 'fb', '1. hinges'],
  ['pd_g_feature_benefit_156565575', 'fb', '2. design'],
  ['pd_g_feature_benefit_1658789418', 'fb', '3. displays'],
  ['pd_g_curation_card_c', 'curation', 'curation cards'],
  ['pd_g_feature_benefit_1764679494', 'fb', '4. cameras'],
  ['pd_g_feature_benefit_588466554', 'fb', '5. productivity'],
  ['pd_g_feature_benefit_1210036945', 'fb', '6. battery'],
  ['pd_g_feature_benefit_1401532846', 'fb', '7. gaming'],
  ['pd_g_feature_benefit_2060440731', 'fb', '8. ecosystem'],
  ['cm_g_text_block_7132_728535168', 'text', 'which one is best'],
  ['cm_g_static_content__765162189', 'static', 'video schema Flip7'],
  ['pd_g_lineup_compare__706351827', 'compare', 'compare table'],
  ['cm_g_text_block_7132_1835373130', 'text', 'why foldable'],
  ['pd_g_feature_benefit_295509795', 'fbfull', 'explore fold'],
  ['cm_g_text_block_1604', 'text', 'most common Qs'],
  ['ho_g_showcase_card_c_1591443929', 'showcase', 'showcase cards'],
  ['cm_g_text_block_4825', 'text', 'back to guide'],
  ['nv_g_breadcrumb_copy', 'crumb', 'breadcrumb']
];

const LB = [
  ['cm_g_static_content', 'static', 'FAQ schema'],
  ['pd_g_feature_benefit', 'fbfull', 'hero KV'],
  ['cm_g_text_block_copy', 'text', 'intro copy'],
  ['cm_g_text_block_copy_1992476737', 'text', 'difference'],
  ['pd_g_feature_benefit_552501717', 'fb', '1. hinges'],
  ['pd_g_feature_benefit_1985716446', 'fb', '2. design'],
  ['pd_g_feature_benefit_1490592640', 'fb', '3. displays'],
  ['pd_g_feature_benefit_1364469040', 'fb', '4. cameras'],
  ['pd_g_feature_benefit_233064155', 'fb', '5. productivity'],
  ['pd_g_feature_benefit_1338704811', 'fb', '6. battery'],
  ['pd_g_feature_benefit_146036993', 'fb', '7. gaming'],
  ['pd_g_feature_benefit_1789376516', 'fb', '8. ecosystem'],
  ['cm_g_text_block_copy_1815386099', 'text', 'which one is best'],
  ['pd_g_lineup_compare_', 'compare', 'compare table'],
  ['cm_g_text_block_copy_1543985576', 'text', 'why foldable'],
  ['pd_g_feature_benefit_2022972114', 'fbfull', 'explore fold'],
  ['cm_g_text_block_1604', 'text', 'most common Qs'],
  ['ho_g_showcase_card_c', 'showcase', 'showcase cards'],
  ['cm_g_text_block_4825', 'text', 'back to guide'],
  ['nv_g_breadcrumb_copy', 'crumb', 'breadcrumb']
];

/** Build tree + order in the shape the worker's flatten() produces. */
function build(components, extraChildren = {}) {
  const GRID = '/root/responsivegrid';
  const tree = {
    '': { 'jcr:primaryType': 'cq:PageContent' },
    '/root': { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': RT.grid },
    [GRID]: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': RT.grid }
  };
  const order = { '': ['root'], '/root': ['responsivegrid'], [GRID]: components.map((c) => c[0]) };

  for (const [name, kind, label] of components) {
    const rel = `${GRID}/${name}`;
    tree[rel] = { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': RT[kind], label };
    order[rel] = extraChildren[name] || [];
    for (const child of order[rel]) {
      tree[`${rel}/${child}`] = { 'jcr:primaryType': 'nt:unstructured' };
      order[`${rel}/${child}`] = [];
    }
  }
  return { tree, order };
}

let pass = 0;
let failed = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail) console.log(`        ${detail}`);
  cond ? pass++ : failed++;
};

/* ------------------------------------------------------------------ cases */

console.log('\n--- the real UK -> LB pair ------------------------------------');

const src = build(UK);
const dst = build(LB);
const { destToSrc, decisions, addedAtSource, missingAtSource } = alignTrees(
  src.tree, src.order, dst.tree, dst.order
);

const GRID = '/root/responsivegrid';
const labelOf = (rel, t) => t[rel]?.label;
let correct = 0;
let mispaired = [];
for (const [d, s] of destToSrc) {
  if (!d.startsWith(`${GRID}/`)) continue;
  const dl = labelOf(d, dst.tree);
  const sl = labelOf(s, src.tree);
  if (dl && sl) (dl === sl ? correct++ : mispaired.push(`${sl} -> ${dl}`));
}

check('every LB component is paired', correct + mispaired.length === LB.length,
  `paired ${correct + mispaired.length} of ${LB.length}`);
check('all 20 pairs are correct', mispaired.length === 0, mispaired.join('; '));

check('the 5 UK-only components are identified',
  addedAtSource.length === 5,
  `got ${addedAtSource.length}: ${addedAtSource.join(', ')}`);
check('nothing is reported as absent from the source',
  missingAtSource.length === 0,
  missingAtSource.join(', '));

const renamed = decisions.find((d) => d.parent === GRID)?.renamed;
check('it reports how many were matched under a different name', renamed === 15,
  `reported ${renamed}, expected 15`);

/* The specific trap: same node name, different component. */
const faqSrc = destToSrc.get(`${GRID}/cm_g_static_content`);
check('cm_g_static_content is NOT paired with the UK node of the same name',
  faqSrc === `${GRID}/cm_g_static_content_`,
  `LB's FAQ schema paired with ${faqSrc} (UK's cm_g_static_content is the anchor bar)`);
check("UK's anchor bar is treated as an addition, not an overwrite",
  addedAtSource.includes(`${GRID}/cm_g_static_content`),
  addedAtSource.join(', '));

/* Relabelling must put both trees in the same coordinates. */
const re = relabel(dst.tree, dst.order, destToSrc);
const hinges = re.tree[`${GRID}/pd_g_feature_benefit_2084490669`];
check('relabelling moves LB content under the UK path',
  hinges?.label === '1. hinges',
  `got ${hinges?.label}`);
check('relabelled child order follows the rename',
  re.order[GRID].includes('pd_g_feature_benefit_2084490669'),
  re.order[GRID].slice(0, 6).join(', '));

const back = destResolver(
  alignTrees(src.tree, src.order, dst.tree, dst.order).srcToDest
);
check('the inverse maps a source path back to the real LB node',
  back(`${GRID}/pd_g_feature_benefit_2084490669`) === `${GRID}/pd_g_feature_benefit_552501717`,
  back(`${GRID}/pd_g_feature_benefit_2084490669`));
check('a component with no counterpart keeps the source name, to be created',
  back(`${GRID}/cm_g_video`) === `${GRID}/cm_g_video`);

/* The trap's other half: the newcomer must not land on the node it clashes with. */
const clash = back(`${GRID}/cm_g_static_content`);
check("an addition whose name is taken here gets a free one instead",
  clash !== `${GRID}/cm_g_static_content`,
  `UK's anchor bar would be written to ${clash}, which is where LB's FAQ schema lives`);
check('and the free name stays under the same parent',
  clash.startsWith(`${GRID}/cm_g_static_content`), clash);
check('the clash is reported rather than silently worked around',
  alignTrees(src.tree, src.order, dst.tree, dst.order).renamedOnArrival.length === 1,
  JSON.stringify(alignTrees(src.tree, src.order, dst.tree, dst.order).renamedOnArrival));

console.log('\n--- a page that really was copied ------------------------------');

const copied = build(UK);
const r2 = alignTrees(src.tree, src.order, copied.tree, copied.order);
check('identical names pair by name, not by inference',
  r2.decisions.length === 0,
  JSON.stringify(r2.decisions.map((d) => d.method)));
check('every node maps to itself',
  [...r2.destToSrc].every(([d, s]) => d === s));
check('nothing added or missing', r2.addedAtSource.length === 0 && r2.missingAtSource.length === 0);

console.log('\n--- alignment refuses rather than guessing ---------------------');

const a = build([['x', 'text', 'A'], ['y', 'fb', 'B'], ['z', 'text', 'C']]);
const b = build([['p', 'curation', 'X'], ['q', 'showcase', 'Y']]);
const r3 = alignTrees(a.tree, a.order, b.tree, b.order);
const pairsUnder = [...r3.destToSrc].filter(([d]) => d.startsWith(`${GRID}/`)).length;
check('no shared component kinds means no pairs invented', pairsUnder === 0,
  `invented ${pairsUnder}`);
check('all three source components are additions', r3.addedAtSource.length === 3);
check('both destination components are unmatched', r3.missingAtSource.length === 2);

console.log('\n--- nested components ------------------------------------------');

const ns = build([['pd_g_feature_benefit_2084490669', 'fb', '1. hinges']],
  { pd_g_feature_benefit_2084490669: ['carousel1', 'carousel2', 'disclaimerList'] });
const nd = build([['pd_g_feature_benefit_552501717', 'fb', '1. hinges']],
  { pd_g_feature_benefit_552501717: ['carousel1', 'carousel2', 'disclaimerList'] });
const r4 = alignTrees(ns.tree, ns.order, nd.tree, nd.order);
check('children inside a renamed component still pair by their own names',
  r4.destToSrc.get(`${GRID}/pd_g_feature_benefit_552501717/carousel2`) ===
    `${GRID}/pd_g_feature_benefit_2084490669/carousel2`,
  r4.destToSrc.get(`${GRID}/pd_g_feature_benefit_552501717/carousel2`));

console.log('\n--- writing inside a component matched under another name ------');

const deep = destResolver(alignTrees(ns.tree, ns.order, nd.tree, nd.order).srcToDest);
check('a child of a renamed component is written INSIDE it',
  deep(`${GRID}/pd_g_feature_benefit_2084490669/carousel1`) ===
    `${GRID}/pd_g_feature_benefit_552501717/carousel1`,
  deep(`${GRID}/pd_g_feature_benefit_2084490669/carousel1`));
check('and so is a grandchild the map has never seen',
  deep(`${GRID}/pd_g_feature_benefit_2084490669/disclaimerList/item0`) ===
    `${GRID}/pd_g_feature_benefit_552501717/disclaimerList/item0`,
  deep(`${GRID}/pd_g_feature_benefit_2084490669/disclaimerList/item0`));

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
