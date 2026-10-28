/* The copy deck: which properties become rows, how their text is shown to a
 * translator, the sheet built from them - and the worker reading a page whole,
 * including one too big for a single .infinity.json.
 *
 * The fixture is the real za/tvs jcr:content, trimmed to one of each component.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/';
const core = await import(pathToFileURL(base + 'src/features/copy-deck/core.js'));
const { AemClient } = await import(pathToFileURL(base + 'src/core/aem-client.js'));
const { actions } = await import(pathToFileURL(base + 'src/features/copy-deck/worker.js'));

const FIXTURE = JSON.parse(readFileSync(base + 'test/fixtures/copy-deck-za-tvs.json', 'utf8'));
const PAGE = '/content/samsung/za/tvs';
const clone = (o) => JSON.parse(JSON.stringify(o));

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};

const deck = core.extractCopyDeck(clone(FIXTURE), { pagePath: PAGE });
const rows = deck.rows;
const byKey = (k) => rows.find((r) => r.key === k);
const keys = rows.map((r) => r.key);

console.log('--- what becomes a row ---------------------------------------------');

check(
  'English-only analytics values are never exported',
  !keys.some((k) => /(engtext|analytics|analytis|englishTitle|pageTrack)/i.test(k.split('@')[1])),
  keys.filter((k) => /(engtext|analytics|analytis|englishTitle|pageTrack)/i.test(k)).join(', ')
);
check(
  'settings, paths and system properties are never exported',
  !keys.some((k) => /@(ogImageReference|canonical|twitterSite|cq:|jcr:(?!title)|sling:|linkPath|desktopImage|componentTheme)/.test(k)),
  keys.filter((k) => /@(ogImageReference|canonical|twitterSite|cq:|sling:|linkPath)/.test(k)).join(', ')
);
check('page title is a row, keyed on the page', byKey('.@jcr:title')?.category === 'page', JSON.stringify(byKey('.@jcr:title')));
check(
  'containers follow the rendered order: top, then iparsys, then root',
  rows.findIndex((r) => r.key.startsWith('responsivegrid-top/')) < rows.findIndex((r) => r.key.startsWith('main-ipar/')) &&
    rows.findIndex((r) => r.key.startsWith('main-ipar/')) < rows.findIndex((r) => r.key.startsWith('root/')),
  keys.slice(0, 15).join('\n        ')
);
{
  const hero = rows.filter((r) => r.key.startsWith('root/responsivegrid/pd_g_feature_benefit@')).map((r) => r.prop);
  check(
    'a component reads headline, description, then alt text - not JCR order',
    JSON.stringify(hero) === JSON.stringify(['headlineText', 'description', 'imageAlternativeText', 'imageMobileAlternativeText']),
    JSON.stringify(hero)
  );
}
check(
  'sections are numbered in page order and named after the component and its headline',
  byKey('root/responsivegrid/pd_g_feature_benefit_1828229403@headlineText')?.section.endsWith('Feature Benefit Full Bleed · Micro RGB'),
  byKey('root/responsivegrid/pd_g_feature_benefit_1828229403@headlineText')?.section
);
check(
  'a list item says which item it is',
  byKey('root/responsivegrid/pd_g_feature_benefit_1828229403/list/item1@text')?.field === 'Item 2 › Button text',
  byKey('root/responsivegrid/pd_g_feature_benefit_1828229403/list/item1@text')?.field
);

console.log('\n--- groups ---------------------------------------------------------');

const cat = (k) => byKey(k)?.category;
check('a CTA text is a button', cat('root/responsivegrid/pd_g_feature_benefit_1828229403/list/item0@text') === 'cta', cat('root/responsivegrid/pd_g_feature_benefit_1828229403/list/item0@text'));
check('a text with a link path is link text', byKey('main-ipar/nv_g_pd_category_sub/item/list/item0@text')?.field === 'Item 1 › Link text', byKey('main-ipar/nv_g_pd_category_sub/item/list/item0@text')?.field);
check('a link title is screen-reader text', cat('root/responsivegrid/pd_g_feature_benefit_1828229403/list/item0@linkTitle') === 'a11y', '');
check('alternativeForLinkAction1 is screen-reader text', cat('root/responsivegrid/pd_g_feature_benefit_427973104/list/item2@alternativeForLinkAction1') === 'a11y', '');
check('imageAlt is alt text', cat('main-ipar/nv_g_pd_category_sub/item/list/item0@imageAlt') === 'alt', '');
check('a disclaimer list item is a disclaimer', cat('root/responsivegrid/pd_g_feature_benefit_1828229403/disclaimerList/item0@disclaimer') === 'disclaimer', '');
check(
  'everything in a breadcrumb is in the breadcrumb group',
  rows.filter((r) => r.key.includes('nv_g_breadcrumb')).every((r) => r.category === 'breadcrumb') &&
    rows.filter((r) => r.key.includes('nv_g_breadcrumb')).length === 3,
  JSON.stringify(rows.filter((r) => r.key.includes('nv_g_breadcrumb')).map((r) => [r.prop, r.category]))
);

console.log('\n--- how text is shown ----------------------------------------------');

{
  const h = byKey('root/responsivegrid/pd_g_feature_benefit@headlineText');
  check('a CRLF line break becomes a line break inside the cell', h.source === 'Discover Samsung TVs designed\nfor every way you watch', JSON.stringify(h.source));
  check('...and is counted, so the note can mention it', h.lineBreaks === 1 && h.format === 'multiline', `${h.lineBreaks} ${h.format}`);
}
{
  const d = byKey('root/responsivegrid/pd_g_feature_benefit_1828229403@description');
  check('<sup> stays as written, in one row, not split', d.source.includes('Color Booster Pro<sup>1</sup>  and Glare Free<sup>2</sup>'), d.source);
  check('...and the row is marked as HTML', d.format === 'html', d.format);
}
{
  const d = byKey('.@disclaimer');
  const stored = FIXTURE.disclaimer.replace(/\r\n?/g, '\n').trim();
  check('a link is shown as stored - <a href="…"> and its URL - for the translation team', d.source === stored && /<a [^>]*href=/.test(d.source), d.source);
  const before = core.extractCopyDeck(clone(FIXTURE), { placeholders: true }).rows.find((r) => r.key === '.@disclaimer');
  check('...where a sheet made before v3 showed <a1>…</a1>, without the URL', before.source.includes('<a1>www.samsung.com </a1>') && !before.source.includes('href'), before.source);
  const sup = core.extractCopyDeck(clone(FIXTURE), { placeholders: true }).rows.find((r) => r.key === 'root/responsivegrid/pd_g_feature_benefit_1828229403@description');
  check('...and listed its tags to keep', sup.tags.includes('<sup>') && sup.tags.includes('</sup>'), JSON.stringify(sup.tags));
}
check('surrounding spaces are trimmed ("Why OLED ")', byKey('root/responsivegrid/pd_g_feature_benefit_427973104/list/item2@headlineText')?.source === 'Why OLED', '');
check('the stored value itself is kept exactly, for the import', byKey('root/responsivegrid/pd_g_feature_benefit_427973104/list/item2@headlineText')?.value === 'Why OLED ', '');

console.log('\n--- not shown on the page ------------------------------------------');

check('video fields on a block that shows an image are marked', byKey('root/responsivegrid/pd_g_feature_benefit_395738741@videoCaption')?.inactive?.includes('image'), JSON.stringify(byKey('root/responsivegrid/pd_g_feature_benefit_395738741@videoCaption')));
check('...but its image alt text is not', !byKey('root/responsivegrid/pd_g_feature_benefit_395738741@imageAlternativeText')?.inactive, '');
check('the common disclaimer is marked when no component uses it', !!byKey('.@disclaimer')?.inactive, '');
{
  const t = clone(FIXTURE);
  t.root.responsivegrid.pd_g_feature_benefit.useCommonDisclaimer = 'true';
  const d = core.extractCopyDeck(t).rows.find((r) => r.key === '.@disclaimer');
  check('...and not marked once a component does', d && !d.inactive, JSON.stringify(d));
}
{
  // levant/mobile-phone-buying-guide: the Text Editor keeps useFlag "false" on its own node and still shows its disclaimer.
  const t = clone(FIXTURE);
  t.root.responsivegrid.cm_g_text_editor_cop = {
    'sling:resourceType': 'samsung/components/content/consumer/global/common/cm-g-text-editor',
    useFlag: 'false',
    textIsRich: ['true', 'true'],
    column1: { description: '<p>*All specifications may change.</p>' },
    column2: { useFlag: 'false', description: '<p>Hidden column</p>' }
  };
  const got = core.extractCopyDeck(t).rows;
  const c1 = got.find((r) => r.key === 'root/responsivegrid/cm_g_text_editor_cop/column1@description');
  const c2 = got.find((r) => r.key === 'root/responsivegrid/cm_g_text_editor_cop/column2@description');
  check('useFlag "false" on a component\'s own node does not switch it off (Text Editor)', c1 && !c1.inactive, JSON.stringify(c1));
  check('...but still switches off an item of it', !!c2?.inactive, JSON.stringify(c2));
}
{
  // levant/mobile-phone-buying-guide: a Header Carousel slide's fields are named "carousel" + the plain name.
  const t = clone(FIXTURE);
  t.root.responsivegrid.pd_g_header_carousel = {
    'sling:resourceType': 'samsung/components/content/consumer/global/product/pd-g-header-carousel',
    carouselList: {
      item0: {
        carouselHeadlineText: 'Which Samsung<br>phone is best for you?',
        carouselDescription: 'Finding the best Samsung phone means matching innovation to your lifestyle.',
        carouselImageAlternativeText: 'Galaxy S26 Ultra next to Galaxy Ultra',
        carouselImageMobileAlternativeText: 'Galaxy S26 Ultra next to Galaxy Ultra',
        carouselHeadlineLinkTextForAnalytics: 'Which Samsung phone is best for you'
      }
    }
  };
  const got = core.extractCopyDeck(t).rows.filter((r) => r.path.includes('pd_g_header_carousel'));
  const cat = (p) => got.find((r) => r.prop === p)?.category;
  check(
    'a Header Carousel slide: headline, description and alt texts are rows',
    cat('carouselHeadlineText') === 'copy' && cat('carouselDescription') === 'copy' && cat('carouselImageAlternativeText') === 'alt' && cat('carouselImageMobileAlternativeText') === 'alt',
    JSON.stringify(got.map((r) => [r.prop, r.category]))
  );
  check('...its analytics text is not', !cat('carouselHeadlineLinkTextForAnalytics'), '');
  check('...read in order, headline first', got[0]?.prop === 'carouselHeadlineText', got.map((r) => r.prop).join(', '));
}
{
  // levant/.../best-tablet-to-buy: a Lineup Compare's spec cells are spec/text1, text2 - one per row of categoryList.
  const t = clone(FIXTURE);
  t.root.responsivegrid.pd_g_lineup_compare = {
    'sling:resourceType': 'samsung/components/content/consumer/global/product/pd-g-lineup-compare',
    categoryList: { item0: { text: 'Storage Options' }, item1: { text: 'External<br>Memory Support' } },
    itemList: {
      item0: {
        product: { altText: 'Galaxy Tab S11', linkPath: '/levant/tablets/x', text: 'Galaxy Tab S11', textAnalytics: 'Galaxy Tab S11' },
        spec: { text1: '<p>128 GB, 256 GB, 512 GB</p>\r\n', text2: '<p>MicroSD (Up to 2TB)</p>\r\n' }
      }
    }
  };
  const got = core.extractCopyDeck(t).rows.filter((r) => r.path.includes('pd_g_lineup_compare'));
  const at = (k) => got.find((r) => r.key === `root/responsivegrid/pd_g_lineup_compare/${k}`);
  check('a Lineup Compare\'s spec cells are rows', at('itemList/item0/spec@text1')?.field === 'Product 1 › Spec 1' && at('itemList/item0/spec@text2')?.field === 'Product 1 › Spec 2', JSON.stringify(got.map((r) => [r.key, r.field])));
  check('...its table rows read "Category N"', at('categoryList/item1@text')?.field === 'Category 2 › Text', JSON.stringify(at('categoryList/item1@text')));
  check('...its analytics text is not a row', !got.some((r) => r.prop === 'textAnalytics'), '');
}
check('left off the sheet unless asked for', !core.selectRows(rows).some((r) => r.inactive), '');
check('included when asked for', core.selectRows(rows, { includeInactive: true }).length === rows.length, '');
check(
  'groups can be left out',
  core.selectRows(rows, { categories: ['copy'] }).every((r) => r.category === 'copy') && core.selectRows(rows, { categories: [] }).length === 0,
  ''
);

console.log('\n--- static HTML ----------------------------------------------------');

{
  const st = rows.filter((r) => r.category === 'static');
  const texts = st.map((r) => r.source);
  const words = (t) => t.replace(/<[^>]*>/g, '');
  check('text between tags is listed', texts.includes('Find the right TV size for your space') && texts.includes('We Recommend'), JSON.stringify(texts));
  check('a closing bracket survives ("Viewing Distance (meters)")', texts.includes('Viewing Distance (meters)'), JSON.stringify(texts));
  check('title and aria-label attributes are listed', texts.includes('Select viewing distance') && texts.includes('Learn more: TV Buying Guide What size TV should i get?'), '');
  check(
    'two links side by side are two buttons, a text each - the link itself stays the page’s; its aria-label is a row of its own',
    texts.includes("View all 75'' TVs") && texts.includes('Learn more') && !texts.some((t) => t.includes('<a ')),
    JSON.stringify(texts)
  );
  check(
    'the two ends of the scale, "1.1m" and "2.5m" side by side, are a text each - no words as one, but each reads as a size',
    texts.includes('1.1m') && texts.includes('2.5m'),
    JSON.stringify(texts)
  );
  check('the strings of a <script> in the Body are code: not on the sheet', !texts.some((t) => /TVs or larger|43" TVs/.test(t)), JSON.stringify(texts));
  check('nor is CSS content text', !texts.includes('or more'), '');
  const order = [...new Set(rows.map((r) => r.section))];
  const at = order.findIndex((s) => s.startsWith('Static content 1 of 1'));
  check(
    'a Static Content block goes by its own number, and takes none of the others’: the section after it follows on from the one before',
    at > 0 && Number(order[at + 1].slice(0, 2)) === Number(order[at - 1].slice(0, 2)) + 1,
    JSON.stringify(order.slice(at - 1, at + 2))
  );
  check(
    'selectors, URLs, event names and comments are not',
    !texts.some((t) => /^\.|https?:|^input$|VD TVs PCD/.test(words(t))),
    JSON.stringify(texts.filter((t) => /^\.|https?:|^input$|VD TVs PCD/.test(words(t))))
  );
  check('every one is applied by hand', st.every((r) => r.format === 'manual'), '');
  check('each carries the fingerprint of its own text, and how many places it is in', st.every((r) => r.hash === `${core.sourceHash(r.source)}/${r.count}`), JSON.stringify(st.map((r) => r.hash)));
  check(
    'each is keyed by its words and tags, not by its position in the block',
    st[0].key === `root/responsivegrid/cm_g_static_content_@bodyHtml#${core.sourceHash('Find the right TV size for your space')}`,
    st[0].key
  );
}

console.log('\n--- a Static Content block’s code ----------------------------------');

const SHOWCASE = 'root/responsivegrid/cm_g_static_content__1282587421';
/**
 * The fixture with a block like explore-samsung-health's showcase: an empty
 * <div> in its Body, the app that fills it in its Footer - its tiles' words in
 * the script - and its styles in the Header. CRLF, as AEM stores it.
 */
function withShowcase() {
  const t = clone(FIXTURE);
  t.root.responsivegrid.cm_g_static_content__1282587421 = {
    'sling:resourceType': 'samsung/components/content/consumer/global/common/cm-g-static-content',
    'jcr:primaryType': 'nt:unstructured',
    bodyHtml: '<div id="showcase"></div>',
    headerInclude: '.showcase .tile:after {\r\n  content: "Learn more about Samsung Health";\r\n}',
    footerInclude:
      '(function () {\r\n  "use strict";\r\n  const tiles = [\r\n' +
      '    { title: "Sleep better", text: "Get to know your sleep patterns and wake up refreshed.", cta: "Learn more" },\r\n' +
      '    { title: "Stay active", text: "Track every step, run and swim.", cta: "Learn more" }\r\n  ];\r\n' +
      '  document.getElementById("showcase").innerHTML = tiles.map((t) => `<p>${t.title}</p>`).join("");\r\n})();'
  };
  return t;
}
{
  const t = withShowcase();
  const node = t.root.responsivegrid.cm_g_static_content__1282587421;
  const d = core.extractCopyDeck(clone(t), { pagePath: PAGE });
  check('the script and the styles read like words - which is why they were offered', core.readsAsText(node.footerInclude) && core.readsAsText(node.headerInclude), '');
  check(
    'a Static Content block’s Footer (script) and Header (styles) are never listed under "Fields not on the sheet"',
    !d.newFields.some((f) => /^(header|footer)Include$/.test(f.prop)) && d.newFields.some((f) => f.prop === 'productGroupCodeName'),
    JSON.stringify(d.newFields.map((f) => `${f.component}@${f.prop}`))
  );
  // A dialog that calls the Footer a text field changes nothing: the list decides, not the dialog.
  const dialogs = { [node['sling:resourceType']]: [{ path: '', prop: 'footerInclude', kind: 'text', label: 'Footer', hint: '' }] };
  check('...whatever the dialog says', !core.extractCopyDeck(clone(t), { dialogs }).newFields.some((f) => f.prop === 'footerInclude'), '');

  const added = {
    add: [
      { component: 'cm-g-static-content', prop: 'footerInclude', group: 'copy' },
      { component: '*', prop: 'headerInclude', group: 'copy' }
    ]
  };
  const a = core.extractCopyDeck(clone(t), { pagePath: PAGE, fields: added });
  const script = d.rows.filter((r) => r.prop === 'footerInclude');
  check(
    'the script’s strings at the places that show them are rows, for a developer to put in - "use strict" and the template’s markup are not',
    JSON.stringify(script.map((r) => r.source)) === JSON.stringify(['Sleep better', 'Get to know your sleep patterns and wake up refreshed.', 'Stay active', 'Track every step, run and swim.']) &&
      script.every((r) => r.format === 'manual' && r.category === 'static' && new RegExp(`^${SHOWCASE}@footerInclude#h[0-9a-f]{8}$`).test(r.key)),
    JSON.stringify(script.map((r) => [r.key, r.source]))
  );
  check(
    'added before, from the list or in settings, they are still not on the sheet as a whole value - not as copy, not as static HTML',
    !a.rows.some((r) => /^(header|footer)Include$/.test(r.prop) && r.format !== 'manual') && JSON.stringify(a.rows.map((r) => r.key)) === JSON.stringify(d.rows.map((r) => r.key)),
    JSON.stringify(a.rows.filter((r) => r.key.startsWith(SHOWCASE)).map((r) => [r.key, r.category]))
  );
  const sheet = core.buildSheet(core.selectRows(a.rows), { pagePath: PAGE });
  check('...so no sheet has a row for them, nor a cell too long for Excel', !sheet.records.some((r) => /Include$/m.test(r[3])) && !!core.toCsv(sheet), '');
  check('the block’s Body is static HTML as before: listed to apply by hand', a.rows.filter((r) => r.format === 'manual').length === d.rows.filter((r) => r.format === 'manual').length, '');
}

console.log('\n--- reports --------------------------------------------------------');

check(
  'on the real page, the one field that reads like words but is not on the sheet is listed - a code, to ignore once',
  deck.newFields.length === 1 && deck.newFields[0].prop === 'productGroupCodeName' && deck.newFields[0].component === 'page-pcd',
  JSON.stringify(deck.newFields)
);
{
  const t = clone(FIXTURE);
  Object.assign(t.root.responsivegrid.cm_g_text_block_copy_1409814884, {
    promoLabel: 'Buy now and save',
    mobileTextLayout: 'x--top  x--left',
    someClass: ' text-center'
  });
  const d = core.extractCopyDeck(t);
  check(
    'a field no rule covers that reads like copy is listed, settings are not',
    d.newFields.some((f) => f.prop === 'promoLabel' && f.component === 'cm-g-text-block') && !d.newFields.some((f) => /mobileTextLayout|someClass/.test(f.prop)),
    JSON.stringify(d.newFields)
  );
}
{
  const t = clone(FIXTURE);
  t.root.responsivegrid.xf = {
    'sling:resourceType': 'samsung/components/content/consumer/global/common/experiencefragment',
    fragmentVariationPath: '/content/experience-fragments/samsung/za/promo/master'
  };
  const d = core.extractCopyDeck(t);
  check('an experience fragment is reported as kept elsewhere', d.references.some((r) => r.value.includes('experience-fragments')), JSON.stringify(d.references));
  check('...and not offered as a field to add', !d.newFields.some((f) => /fragment/i.test(f.prop)), '');
}
{
  const t = clone(FIXTURE);
  t.keywords = ['smart TV', 'QLED'];
  const d = core.extractCopyDeck(t);
  check('a multi-value property gives one row per value', d.rows.some((r) => r.key === '.@keywords[0]') && d.rows.some((r) => r.key === '.@keywords[1]' && r.index === 1), '');
}

console.log('\n--- fields not on the sheet: add or ignore -------------------------');

const PROMO = 'root/responsivegrid/cm_g_promo_banner_1';
/** The fixture with a component no rule knows: text in names of its own, among settings. */
function withPromo() {
  const t = clone(FIXTURE);
  t.root.responsivegrid.cm_g_promo_banner_1 = {
    'sling:resourceType': 'samsung/components/content/consumer/global/common/cm-g-promo-banner',
    'jcr:primaryType': 'nt:unstructured',
    'jcr:title': 'Spring deals',
    'jcr:lastModifiedBy': 'Someone Else',
    headlineText: 'Save on every TV',
    sectionHeading: 'Discover more',
    badgeLabel: 'New',
    ctaLabel: 'Buy',
    eyebrowText: 'Limited time only',
    tabs: ['Overview', 'large'],
    localWord: 'Téléviseurs',
    iconHtml: '<img src="/content/dam/samsung/za/free.png" alt="Free delivery on all TVs">',
    promoNote: '[Exclusive] Save R2 000 on Neo QLED',
    size: 'large',
    theme: ' bg-white',
    layout: 'x--top  x--left',
    classes: 'text-center s-mo-left',
    target: '_self',
    linkUrl: '/za/offers/',
    image: '/content/dam/samsung/za/QN900F KV PC.jpg',
    external: 'https://www.samsung.com/za/offers/',
    showBadge: 'TRUE',
    flag: 'Y',
    model: 'QN75QN80HAFXZC',
    color: '#ffffff',
    locale: 'en-ZA',
    updated: 'Tue Sep 22 2026 02:22:41 GMT+0900',
    textForAnalytics: 'buy',
    headlineEngText: 'save on every tv',
    list: {
      'jcr:primaryType': 'nt:unstructured',
      item0: { 'jcr:primaryType': 'nt:unstructured', 'cq:panelTitle': 'Specs', cardTitle: 'Picture quality', contentsType: 'headlineOnly' },
      item1: { 'jcr:primaryType': 'nt:unstructured', 'cq:panelTitle': 'Sound', cardTitle: 'Dolby Atmos sound' }
    }
  };
  return t;
}
const promoFields = (d) => Object.fromEntries(d.newFields.filter((f) => f.component === 'cm-g-promo-banner').map((f) => [f.prop, f]));
{
  const d = core.extractCopyDeck(withPromo(), { pagePath: PAGE });
  const f = promoFields(d);
  const want = ['jcr:title', 'sectionHeading', 'badgeLabel', 'ctaLabel', 'eyebrowText', 'tabs', 'localWord', 'iconHtml', 'promoNote', 'cq:panelTitle', 'cardTitle'];
  check(
    'every field that reads like words is listed - one word, a system title, a setting-like name, another script, alt text only, a bracket',
    JSON.stringify(Object.keys(f).sort()) === JSON.stringify([...want].sort()),
    JSON.stringify(Object.keys(f))
  );
  check('...but not one already on the sheet', !f.headlineText && d.rows.some((r) => r.key === `${PROMO}@headlineText`), '');
  check(
    '...nor settings, paths with spaces, links, flags, codes, colours, locales, dates or analytics values',
    !Object.keys(f).some((p) => /^(size|theme|layout|classes|target|linkUrl|image|external|showBadge|flag|model|color|locale|updated|textForAnalytics|headlineEngText|contentsType|jcr:lastModifiedBy)$/.test(p)),
    JSON.stringify(Object.keys(f))
  );
  check('one entry per component and property, however often it occurs', f.cardTitle.count === 2 && f['cq:panelTitle'].count === 2 && d.newFields.filter((x) => x.prop === 'cardTitle').length === 1, JSON.stringify(f.cardTitle));
  check('...saying where it was seen and what it says', f.cardTitle.where === 'list/item0' && f.cardTitle.text === 'Picture quality' && f.ctaLabel.where === '', JSON.stringify(f.cardTitle));
  check('...shown as read: markup left out, alt text when that is all there is', f.iconHtml.text === 'Free delivery on all TVs' && f.localWord.text === 'Téléviseurs', JSON.stringify(f.iconHtml));
  check('...with a group to start from', f.ctaLabel.group === 'cta' && f.cardTitle.group === 'copy' && deck.newFields[0].group === 'page', `${f.ctaLabel.group} ${f.cardTitle.group}`);
  check('...and the component named as the list shows it', f.cardTitle.componentLabel === 'Promo Banner' && deck.newFields[0].componentLabel === 'Page properties', f.cardTitle.componentLabel);
  check('listing them changes no row', JSON.stringify(d.rows.filter((r) => !r.key.startsWith(PROMO)).map((r) => r.key)) === JSON.stringify(keys), '');
}
{
  const fields = { add: [{ component: 'cm-g-promo-banner', prop: 'cardTitle', group: 'cta' }] };
  const d = core.extractCopyDeck(withPromo(), { pagePath: PAGE, fields });
  const added = d.rows.filter((r) => r.prop === 'cardTitle');
  check(
    'an added field is on the sheet, every time it occurs in that component',
    JSON.stringify(added.map((r) => r.key)) === JSON.stringify([`${PROMO}/list/item0@cardTitle`, `${PROMO}/list/item1@cardTitle`]),
    JSON.stringify(added.map((r) => r.key))
  );
  check('...in the group chosen, named after the property, marked as added', added.every((r) => r.category === 'cta' && r.added === true) && added[0].field === 'Item 1 › Card title', JSON.stringify(added[0]));
  check('...with a fingerprint like any other row, for the import', added[0].hash === core.sourceHash('Picture quality'), '');
  check('...and is no longer listed', !promoFields(d).cardTitle, '');
  check('nothing else on the sheet changes', JSON.stringify(d.rows.filter((r) => !r.added && !r.key.startsWith(PROMO)).map((r) => r.key)) === JSON.stringify(keys), '');
}
{
  const t = withPromo();
  t.root.responsivegrid.cm_g_badge = { 'sling:resourceType': 'x/cm-g-badge', cardTitle: 'Best seller' };
  const d = core.extractCopyDeck(t, { fields: { add: [{ component: 'cm-g-promo-banner', prop: 'cardTitle', group: 'copy' }] } });
  check('an added field counts for its component only: the same name elsewhere is still listed', d.newFields.some((f) => f.component === 'cm-g-badge' && f.prop === 'cardTitle') && !d.rows.some((r) => r.key.includes('cm_g_badge')), '');
  const any = core.extractCopyDeck(t, { fields: { add: [{ component: '*', prop: 'cardTitle', group: 'copy' }] } });
  check('...and "*" means every component', any.rows.some((r) => r.key === 'root/responsivegrid/cm_g_badge@cardTitle') && any.rows.some((r) => r.key === `${PROMO}/list/item1@cardTitle`), '');
}
{
  const d = core.extractCopyDeck(withPromo(), { fields: { ignore: [{ component: 'cm-g-promo-banner', prop: 'ctaLabel' }, { component: '*', prop: 'badgeLabel' }] } });
  check('an ignored field is not listed, and not on the sheet', !promoFields(d).ctaLabel && !promoFields(d).badgeLabel && !d.rows.some((r) => /@(ctaLabel|badgeLabel)$/.test(r.key)), JSON.stringify(Object.keys(promoFields(d))));
}
{
  const d = core.extractCopyDeck(withPromo(), {
    fields: { add: [{ component: 'cm-g-promo-banner', prop: 'jcr:title', group: 'copy' }, { component: 'cm-g-promo-banner', prop: 'cq:panelTitle', group: 'copy' }] }
  });
  check('a system title can be added (AEM’s own Title, Teaser and Tabs keep their words there)', d.rows.some((r) => r.key === `${PROMO}@jcr:title`) && d.rows.filter((r) => r.prop === 'cq:panelTitle').length === 2, '');
}
{
  const bad = ['sling:resourceType', 'jcr:primaryType', 'cq:template', 'headlineEngText', 'textForAnalytics', 'pageTrack'];
  const d = core.extractCopyDeck(withPromo(), { fields: { add: bad.map((prop) => ({ component: '*', prop, group: 'copy' })) } });
  check('a system property or an analytics value can never be added - the import would write it', !d.rows.some((r) => bad.includes(r.prop)), JSON.stringify(d.rows.filter((r) => bad.includes(r.prop)).map((r) => r.key)));
  check('...and is refused before it is kept', bad.every((p) => !core.fieldAllowed(p)) && ['jcr:title', 'cq:panelTitle', 'cardTitle'].every(core.fieldAllowed), '');
}
{
  const d = core.extractCopyDeck(clone(FIXTURE), { fields: { add: [{ component: 'page-pcd', prop: 'productGroupCodeName', group: 'page' }] } });
  const r = d.rows.find((x) => x.key === '.@productGroupCodeName');
  check('a page property can be added, for that kind of page', r?.category === 'page' && r.section === 'Page properties' && d.newFields.length === 0, JSON.stringify(r));
  const other = core.extractCopyDeck(clone(FIXTURE), { fields: { add: [{ component: 'page-standard-pd', prop: 'productGroupCodeName', group: 'page' }] } });
  check('...and not for another kind', !other.rows.some((x) => x.key === '.@productGroupCodeName'), '');
}
{
  const d = core.extractCopyDeck(clone(FIXTURE), { fields: { add: [{ component: '*', prop: 'inheritance', group: 'copy' }, { component: '*', prop: 'headlineText', group: 'cta' }] } });
  check('an added field never reaches the layout containers between components', !d.rows.some((r) => r.prop === 'inheritance'), '');
  check('where a rule knows the property, the rule still decides', JSON.stringify(d.rows.map((r) => [r.key, r.category])) === JSON.stringify(rows.map((r) => [r.key, r.category])), '');
}
{
  const t = clone(FIXTURE);
  t.root.responsivegrid.cm_g_text_block_copy_1409814884.description = '<img src="/x.png" alt="Samsung QLED TV on a living room wall">';
  const d = core.extractCopyDeck(t).rows.filter((r) => r.key.startsWith('root/responsivegrid/cm_g_text_block_copy_1409814884@description'));
  check(
    'a field whose only words are an image’s alt is a row, the image written out, its alt translated in place',
    d.length === 1 && d[0].key.endsWith('@description') && d[0].source === '<img src="/x.png" alt="Samsung QLED TV on a living room wall">' && d[0].category === 'alt',
    JSON.stringify(d.map((r) => [r.key, r.source, r.category]))
  );
  const before = core.extractCopyDeck(t, { placeholders: true }).rows.filter((r) => r.key.startsWith('root/responsivegrid/cm_g_text_block_copy_1409814884@description'));
  check(
    '...a sheet made before v3 gave the alt a row of its own',
    before.length === 1 && before[0].key.endsWith('@description~img1.alt') && before[0].source === 'Samsung QLED TV on a living room wall',
    JSON.stringify(before.map((r) => r.key))
  );
}
{
  const c = core.cleanFields({
    add: [{ component: 'x', prop: 'a', group: 'cta' }, { component: 'x', prop: 'a', group: 'copy' }, { component: 'x', prop: 'b', group: 'nope' }, { component: '', prop: 'c' }, null, { component: 'x', prop: 'sling:resourceType' }],
    ignore: [{ component: 'x', prop: 'a' }, { component: 'y', prop: 'd' }, 'junk']
  });
  check(
    'stored choices are checked: duplicates, blanks, junk and forbidden properties dropped, a bad group made "copy", added beats ignored',
    JSON.stringify(c) === JSON.stringify({ add: [{ component: 'x', prop: 'a', group: 'cta' }, { component: 'x', prop: 'b', group: 'copy' }], ignore: [{ component: 'y', prop: 'd' }] }),
    JSON.stringify(c)
  );
  check('no choices stored is no choices', JSON.stringify(core.cleanFields(undefined)) === JSON.stringify({ add: [], ignore: [] }), '');
  const full = core.cleanFields({ add: [{ component: 'samsung/components/content/consumer/global/common/cm-g-promo-banner', prop: 'cardTitle' }, { component: ' * ', prop: 'x' }] });
  check('a full resource type pasted as the component is taken as its last part; "*" stays "*"', full.add[0].component === 'cm-g-promo-banner' && full.add[1].component === '*', JSON.stringify(full));
}
{
  const t = withPromo();
  t.root.responsivegrid.cm_g_badge = { 'sling:resourceType': 'x/cm-g-badge', cardTitle: 'Best seller' };
  const both = { add: [{ component: '*', prop: 'cardTitle', group: 'copy' }], ignore: [{ component: 'cm-g-badge', prop: 'cardTitle' }] };
  const d = core.extractCopyDeck(t, { fields: both });
  check(
    'for one component its own Ignore beats an Add for "*"',
    !d.rows.some((r) => r.key.includes('cm_g_badge')) && d.rows.some((r) => r.key === `${PROMO}/list/item0@cardTitle`),
    JSON.stringify(d.rows.filter((r) => r.prop === 'cardTitle').map((r) => r.key))
  );
  const other = core.extractCopyDeck(t, { fields: { add: [{ component: 'cm-g-badge', prop: 'cardTitle', group: 'copy' }], ignore: [{ component: '*', prop: 'cardTitle' }] } });
  check('...and its own Add beats an Ignore for "*"', other.rows.some((r) => r.key.includes('cm_g_badge')) && !other.newFields.some((f) => f.prop === 'cardTitle'), '');
}
{
  const t = withPromo();
  Object.assign(t.root.responsivegrid.cm_g_promo_banner_1, { ctaLabel: 'www.samsung.com/za', tabs: ['Overview', '#specs'], suffix: '/month' });
  const add = ['ctaLabel', 'tabs', 'suffix'].map((prop) => ({ component: 'cm-g-promo-banner', prop, group: 'copy' }));
  const d = core.extractCopyDeck(t, { fields: { add } });
  const keys3 = d.rows.filter((r) => ['ctaLabel', 'tabs', 'suffix'].includes(r.prop)).map((r) => r.key);
  check(
    'a value of an added field that is a link or a path never goes on the sheet - judged value by value',
    JSON.stringify(keys3) === JSON.stringify([`${PROMO}@tabs[0]`]),
    JSON.stringify(keys3)
  );
}
{
  // A link whose only words are its title: offered for them, and added, the title is what goes on the sheet.
  const t = clone(FIXTURE);
  t.root.responsivegrid.cm_g_support = {
    'sling:resourceType': 'x/cm-g-support',
    supportLink: '<a href="https://www.samsung.com/za/support/" title="Samsung Support">https://www.samsung.com/za/support/</a>'
  };
  const offered = core.extractCopyDeck(clone(t)).newFields.find((f) => f.prop === 'supportLink');
  const added = { fields: { add: [{ component: 'cm-g-support', prop: 'supportLink', group: 'cta' }] } };
  const d = core.extractCopyDeck(t, added);
  const got = d.rows.filter((r) => r.prop === 'supportLink');
  check('a link whose only words are in its title is offered for them', offered?.text === 'https://www.samsung.com/za/support/' || offered?.text === 'Samsung Support', JSON.stringify(offered));
  check(
    '...and once added goes on the sheet as stored, its title to translate in place',
    got.length === 1 && got[0].key.endsWith('@supportLink') && got[0].source.includes('title="Samsung Support"'),
    JSON.stringify(got.map((r) => [r.key, r.source]))
  );
  const gotBefore = core.extractCopyDeck(clone(t), { ...added, placeholders: true }).rows.filter((r) => r.prop === 'supportLink');
  check(
    '...where a sheet made before v3 had its title alone, not its link text',
    gotBefore.length === 1 && gotBefore[0].key.endsWith('@supportLink~a1.title') && gotBefore[0].source === 'Samsung Support' && gotBefore[0].attrOnly === true,
    JSON.stringify(gotBefore.map((r) => [r.key, r.source]))
  );
  check('...and it is not offered again', !d.newFields.some((f) => f.prop === 'supportLink'), '');
  const onlyLink = clone(FIXTURE);
  onlyLink.root.responsivegrid.cm_g_support = { 'sling:resourceType': 'x/cm-g-support', supportLink: 'www.samsung.com/za/support' };
  const none = core.extractCopyDeck(onlyLink, { fields: { add: [{ component: 'cm-g-support', prop: 'supportLink', group: 'cta' }] } });
  check('an added field whose value here is only a link gives no row, and is not offered', !none.rows.some((r) => r.prop === 'supportLink') && !none.newFields.some((f) => f.prop === 'supportLink'), '');
}
{
  const t = clone(FIXTURE);
  t.root.responsivegrid.cm_g_text_block_copy_1409814884.description = '<img src="/x.png" alt="Samsung QLED TV on a living room wall">';
  // The notes of a sheet made before v3, whose title and alt rows the import still reads.
  const picked = core.extractCopyDeck(t, { placeholders: true }).rows;
  const sheet = core.buildSheet(picked);
  const notes = sheet.columns.indexOf('Notes');
  const alt = sheet.records.find((r) => r[3].endsWith('@description~img1.alt'));
  const title = sheet.records.find((r) => r[3].endsWith('pd_g_feature_benefit_1828229403/list/item0@text') === false && /~a1\.title$/.test(r[3]));
  check(
    'an alt with no text of its own is not sent to "the text above" - the row above is another field',
    alt && /the text around it is not on the sheet/.test(alt[notes]) && !/text above/.test(alt[notes]),
    alt && alt[notes]
  );
  check('...while one inside a text still points at it', !title || /in the text above/.test(title[notes]), title && title[notes]);
  check('a property reads as a label', core.fieldLabel('cardTitle') === 'Card title' && core.fieldLabel('cq:panelTitle') === 'Panel title' && core.fieldLabel('jcr:title') === 'Title', core.fieldLabel('cardTitle'));
}
{
  const yes = ['Buy', 'OLED', 'TVs', 'Wi-Fi', 'New!', 'Samsung’s', 'Téléviseurs', 'télé', '구매', 'شراء', 'Купить', 'learn more', '#1 Best Seller', '<p>Buy</p>', 'TV & AV', 'Up to 30% off', '<!-- x --><h3>Find the right TV</h3><style>.a--b{}</style>', '[Exclusive] Save R2 000 on Neo QLED', '[삼성닷컴 단독] 갤럭시 S25 사전 구매', '{name}, your TV is ready', 'Tel: 0860 726 7864', 'www.samsung.com has every offer', '<img src="/x.png" alt="Free delivery on all TVs">', 'Free*', 'QLED®', 'Bespoke™', '(New)', 'More…', '“Exclusive”', '¡Nuevo!', 'New†', 'Our top 10 2025 picks', 'Buy the 65 2025 Neo QLED'];
  const no = ['large', 'headlineOnly', 'h2', ' bg-white', '_self', 'true', 'TRUE', 'Yes', 'Y', 'B', 'QN75QN80HAFXZC', '4K', '1set', 's-image-bottom', 'x--top  x--left', 'feature-benefit-full-bleed--m-bottom  feature-benefit-full-bleed--m-left', 'text-center s-mo-left', '/za/tvs/', '/content/dam/samsung/za/QN900F KV PC.jpg', 'https://www.samsung.com/za/', 'www.samsung.com', 'tel:08607267864', '#ffffff', '#anchor-id', '{"a": 1}', '["Buy", "Now"]', 'en-ZA', 'Yes!', '(TRUE)', '@SamsungSA', 'Tue Sep 22 2026 02:22:41 GMT+0900', '2026-09-27T10:00:00.000+09:00', '<p>&nbsp;</p>', '583649', 'padding-bottom--48', ''];
  check('words read as text, in any script', yes.every(core.readsAsText), JSON.stringify(yes.filter((v) => !core.readsAsText(v))));
  check('settings, class lists, paths, links, flags, codes, locales, JSON and dates do not', !no.some(core.readsAsText), JSON.stringify(no.filter(core.readsAsText)));
}

console.log('\n--- review fixes ---------------------------------------------------');

{
  const t = clone(FIXTURE);
  t.root.responsivegrid.cm_g_text_block_copy_1409814884.description =
    'See <a href="/za/offers/" title="View all Samsung offers" aria-label="Samsung offers page">our offers</a> today.<img src="/x.png" alt="Samsung logo on a TV">';
  const now = core.extractCopyDeck(clone(t)).rows.filter((r) => r.key.startsWith('root/responsivegrid/cm_g_text_block_copy_1409814884@description'));
  check(
    'rich text is one row, written out in full: the link, its title and aria-label, the image and its alt',
    now.length === 1 && now[0].source === t.root.responsivegrid.cm_g_text_block_copy_1409814884.description && !now.some((r) => r.attr),
    JSON.stringify(now.map((r) => [r.key, r.source]))
  );
  {
    const sheet = core.buildSheet(now);
    check('...and its Notes say it is HTML, to translate the words and keep the tags', /HTML - translate the words, and any title or alt text; keep every tag complete/.test(sheet.records[0][2]), sheet.records[0][2]);
  }
  // A sheet made before v3: placeholders, and a row of their own for the words in a tag.
  const d = core.extractCopyDeck(t, { placeholders: true }).rows.filter((r) => r.key.startsWith('root/responsivegrid/cm_g_text_block_copy_1409814884@description'));
  const byAttr = Object.fromEntries(d.filter((r) => r.attr).map((r) => [r.key.split('~')[1], r]));
  check('a link title inside rich text is a row of its own', byAttr['a1.title']?.source === 'View all Samsung offers' && byAttr['a1.title'].category === 'a11y', JSON.stringify(d.map((r) => [r.key, r.source])));
  check('...and so is its aria-label', byAttr['a1.aria-label']?.source === 'Samsung offers page', '');
  check('an image alt inside rich text is alt text', byAttr['img1.alt']?.source === 'Samsung logo on a TV' && byAttr['img1.alt'].category === 'alt', '');
  check('attribute rows follow the text they belong to', d[0].key.endsWith('@description') && !d[0].attr && d.length === 4, JSON.stringify(d.map((r) => r.key)));
  check('each carries the fingerprint of its own value', byAttr['a1.title'].hash === core.sourceHash('View all Samsung offers'), '');
}
check(
  'a numeric entity outside Unicode stays as written instead of stopping the export',
  core.decodeEntities('Price &#x1F4B0000; only &#1114112;') === 'Price &#x1F4B0000; only &#1114112;',
  core.decodeEntities('Price &#x1F4B0000; only')
);
check('...and a valid one still decodes', core.decodeEntities('&#x1F4B0;&sup2;&amp;') === '\u{1F4B0}&sup2;&', core.decodeEntities('&#x1F4B0;&sup2;&amp;'));
{
  const segs = core.segmentStaticHtml('<SCRIPT>var msg = "Hello world"; if (a < b) {}</SCRIPT><Style>.x:before{content:"or more"}</Style><P>Visible</P>');
  check(
    'an upper-case <SCRIPT> or <Style> block is still read as code',
    JSON.stringify(segs.map((s) => s.text)) === JSON.stringify(['Hello world', 'or more', 'Visible']),
    JSON.stringify(segs)
  );
}
check('<br /> and <o:p> are listed as tags to keep (sheets made before v3)', ['<br />', '<o:p>'].every((x) => core.describe('One<br />two<o:p></o:p>', { placeholders: true }).tags.includes(x)), JSON.stringify(core.describe('One<br />two<o:p></o:p>', { placeholders: true }).tags));
check('written out in full, a value is shown exactly as stored', core.describe('See <a href="/x" title="Go">this</a>&nbsp;now ').text === 'See <a href="/x" title="Go">this</a>&nbsp;now', core.describe('See <a href="/x" title="Go">this</a>&nbsp;now ').text);
check('an entity with digits (&sup2;) marks the value as markup', core.describe('Area 5m&sup2; big').format === 'html', core.describe('Area 5m&sup2; big').format);
{
  const t = clone(FIXTURE);
  Object.assign(t.root.responsivegrid.cm_g_text_block_copy_1409814884, { description: '<p>&nbsp;</p>', subHeadlineText: '&nbsp;' });
  t.root.responsivegrid.pd_g_feature_benefit_1828229403.disclaimerList.item0.disclaimer = '<br>';
  const keys2 = core.extractCopyDeck(t).rows.map((r) => r.key);
  check(
    'an empty rich-text field (<p>&nbsp;</p>) is not a row',
    !keys2.some((k) => /cm_g_text_block_copy_1409814884@(description|subHeadlineText)$|disclaimerList\/item0@disclaimer$/.test(k)),
    keys2.filter((k) => k.includes('cm_g_text_block_copy_1409814884')).join(', ')
  );
}

console.log('\n--- fingerprint ----------------------------------------------------');

check('starts with a letter, so Excel keeps it as text', /^h[0-9a-f]{8}$/.test(core.sourceHash('abc')), core.sourceHash('abc'));
check('CRLF and LF give the same fingerprint', core.sourceHash('a\r\nb') === core.sourceHash('a\nb'), '');
check('any change gives a different one', core.sourceHash('View all') !== core.sourceHash('View all '), '');

console.log('\n--- tags -----------------------------------------------------------');

{
  const t = core.tokenizeTags('<a href="/x">one</a> and <a href="/y">two</a>');
  check('links are numbered in order', t.text === '<a1>one</a1> and <a2>two</a2>', t.text);
  check('...and the originals are kept to put back', t.tokens[1].original === '<a href="/y">', JSON.stringify(t.tokens));
}
check(
  'a tag with attributes around a plain one closes with its own number',
  core.tokenizeTags('<span class="c">x<sup>1</sup></span>').text === '<span1>x<sup>1</sup></span1>',
  core.tokenizeTags('<span class="c">x<sup>1</sup></span>').text
);
check('a void tag with attributes self-closes', core.tokenizeTags('a<img src="x" alt="y">b').text === 'a<img1/>b', core.tokenizeTags('a<img src="x" alt="y">b').text);
check('the same value always tokenizes the same way', core.tokenizeTags('<a href="1">x</a>').text === core.tokenizeTags('<a href="2">x</a>').text, '');
check('an HTML code is kept, and noted on a sheet made before v3', core.describe('Tom&nbsp;&amp; Jerry').text === 'Tom&nbsp;&amp; Jerry' && core.describe('Tom&nbsp;&amp; Jerry', { placeholders: true }).tags.includes('&nbsp;'), JSON.stringify(core.describe('Tom&nbsp;&amp; Jerry')));

console.log('\n--- the sheet ------------------------------------------------------');

{
  const picked = core.selectRows(rows);
  const sheet = core.buildSheet(picked, { pagePath: PAGE, exportedAt: '2026-09-27 14:30' });
  const col = Object.fromEntries(sheet.columns.map((c, i) => [c.split(' ')[0], i]));
  check(
    'seven columns, source and translation last',
    sheet.columns.length === 7 && sheet.columns.at(-2) === 'Source text' && sheet.columns.at(-1) === 'Translation',
    JSON.stringify(sheet.columns)
  );
  const texts = core.mergeRows(picked);
  check('one record per text, plus the closing row', sheet.records.length === texts.length + 1 && texts.length < picked.length, `${sheet.records.length} vs ${texts.length} texts, ${picked.length} places`);
  check('every place is on the sheet, once', sheet.records.slice(0, -1).flatMap((r) => r[col.Key].split('\n')).join() === texts.flatMap((t) => t.places.map((p) => p.key)).join() && texts.flatMap((t) => t.places).length === picked.length, '');
  const last = sheet.records.at(-1);
  check(
    'the closing row carries the page and the row count',
    last[col.Key] === '#meta' && last[col.Field] === PAGE && last[col.Notes].startsWith(`rows=${texts.length} `) && last[col.Notes].includes(`copy deck v${core.SHEET_VERSION}`) && last[col.Section].startsWith('#END'),
    JSON.stringify(last)
  );
  check('translation cells are empty', sheet.records.every((r) => r[col.Translation] === ''), '');

  // Static content merges like any other text: one translation, put in by hand where the block has it.
  {
    const t = clone(FIXTURE);
    t.root.responsivegrid.cm_g_static_content_.bodyHtml += '\r\n<p class="cta">Learn more</p>';
    const merged = core.buildSheet(core.selectRows(core.extractCopyDeck(t).rows), { pagePath: PAGE }).records.filter((r) => r[col.Source] === 'Learn more');
    check(
      'static content is merged too: the block’s "Learn more" is a place on the row of every other "Learn more", and its Notes say who puts it in',
      merged.length === 1 && /^root\/responsivegrid\/cm_g_static_content_@bodyHtml#h[0-9a-f]{8}$/m.test(merged[0][col.Key]) && merged[0][col.Notes].includes('Static content - the web team puts this on the page'),
      JSON.stringify(merged)
    );
  }
  // The page's "Learn more" buttons, and the one in its Static Content block: one row.
  const learnMore = sheet.records.filter((r) => r[col.Source] === 'Learn more');
  const places = picked.filter((r) => r.source === 'Learn more');
  check(
    'a text used in several places is one row: each place a line in Field, Key and Check, and the Notes say so',
    learnMore.length === 1 &&
      places.length >= 3 &&
      places.some((p) => p.format === 'manual') &&
      learnMore[0][col.Key].split('\n').length === places.length &&
      learnMore[0][col.Check].split('\n').join() === places.map((p) => p.hash).join() &&
      learnMore[0][col.Field].split('\n').length === places.length &&
      learnMore[0][col.Notes].includes(`Used in ${places.length} places - one translation for all of them`),
    JSON.stringify(learnMore)
  );
  check(
    '...naming each place with its section when they are in different sections - a Static Content block by its own number',
    learnMore[0][col.Field].split('\n').every((l) => /^(\d\d · .+|1\/1) › /.test(l)) && learnMore[0][col.Field].includes('\n1/1 › '),
    learnMore[0][col.Field]
  );
  check('a text used once says nothing about places', sheet.records.filter((r) => !r[col.Key].includes('\n')).every((r) => !/Used in/.test(r[col.Notes])), '');
  const sup = sheet.records.find((r) => r[col.Key].endsWith('pd_g_feature_benefit_1828229403@description'));
  check('a text with HTML says so in the notes', sup[col.Notes].includes('HTML - translate the words') && sup[col.Source].includes('<sup>1</sup>'), sup[col.Notes]);

  const csv = core.toCsv(sheet);
  check('CSV starts with a BOM and uses CRLF between records', csv.startsWith('\uFEFF"Section"') && csv.includes('"\r\n"'), JSON.stringify(csv.slice(0, 40)));
  check('quotes inside a cell are doubled', csv.includes('"75"" TVs"'), '');
  check('the CSV parses back to the same grid', JSON.stringify(parseCsv(csv.slice(1))) === JSON.stringify([sheet.columns, ...sheet.records]), 'round trip differs');

  const html = core.toHtmlTable(sheet);
  check('the clipboard table makes every cell text', html.includes("mso-number-format:'\\@'"), '');
  check('...keeps line breaks in their cell', html.includes('designed<br style="mso-data-placement:same-cell">for every'), '');
  check('...and escapes markup', html.includes('Pro&lt;sup&gt;1&lt;/sup&gt;') && !html.includes('Pro<sup>'), '');

  const tsv = core.toTsv(sheet);
  check('the clipboard text quotes a cell with a line break', tsv.includes('"Discover Samsung TVs designed\nfor every way you watch"'), '');
}
{
  const sheet = core.buildSheet([{ source: '-20% off', section: 's', field: 'f', key: 'k@p', hash: 'h1', category: 'copy' }]);
  const source = sheet.columns.indexOf('Source text');
  check('in a CSV, a cell Excel would read as a formula gets an apostrophe', core.toCsv(sheet).includes(`"'-20% off"`), core.toCsv(sheet));
  check('...and in the clipboard text', core.toTsv(sheet).includes("\t'-20% off\t"), core.toTsv(sheet));
  check('...but not in the sheet itself, whose cells are text already', sheet.records[0][source] === '-20% off', sheet.records[0][source]);
}
{
  // An 83,549-character script was once one cell: Excel cuts a cell at 32,767, or calls the file damaged.
  const { toXlsx } = await import(pathToFileURL(base + 'src/features/copy-deck/xlsx.js'));
  const one = (n) => core.buildSheet([{ source: 'x'.repeat(n), section: 's', field: 'f', key: 'k@p', hash: 'h1', category: 'copy' }]);
  const refused = (fn, sheet) => {
    try {
      fn(sheet);
      return null;
    } catch (e) {
      return e.message;
    }
  };
  const said = 'Cell F2 is longer than Excel allows (32768 characters).';
  check('a CSV with a cell longer than Excel allows is refused, naming the cell', refused(core.toCsv, one(32768)) === said, refused(core.toCsv, one(32768)));
  check('...and so is the clipboard text', refused(core.toTsv, one(32768)) === said, refused(core.toTsv, one(32768)));
  check('...and the clipboard table', refused(core.toHtmlTable, one(32768)) === said, refused(core.toHtmlTable, one(32768)));
  check('...each in the words the Excel download uses', refused(toXlsx, one(32768)) === said, refused(toXlsx, one(32768)));
  check('a cell right at the limit is not refused', [core.toCsv, core.toTsv, core.toHtmlTable].every((fn) => refused(fn, one(32767)) === null), '');
  // At the limit and starting with "-": the apostrophe that keeps it from being a formula makes it one too long, in plain text only.
  const formula = core.buildSheet([{ source: `-${'x'.repeat(32766)}`, section: 's', field: 'f', key: 'k@p', hash: 'h1', category: 'copy' }]);
  check(
    'a cell measured as written: at the limit with its apostrophe, the CSV and the clipboard text refuse it',
    [core.toCsv, core.toTsv].every((fn) => refused(fn, formula) === said),
    JSON.stringify([core.toCsv, core.toTsv].map((fn) => refused(fn, formula)))
  );
  check('...the clipboard table and the workbook, which need none, do not', refused(core.toHtmlTable, formula) === null && refused(toXlsx, formula) === null, '');
}
check('the file is named after site, page and time', core.fileName(PAGE, new Date(2026, 8, 27, 14, 5)) === 'copydeck_za_tvs_20260927-1405.xlsx', core.fileName(PAGE, new Date(2026, 8, 27, 14, 5)));
check('...with the CSV named the same way', core.fileName(PAGE, new Date(2026, 8, 27, 14, 5), 'csv') === 'copydeck_za_tvs_20260927-1405.csv', '');
check('a nested page joins its segments', core.fileName('/content/samsung/uk/tvs/oled-tv', new Date(2026, 0, 2, 3, 4)) === 'copydeck_uk_tvs-oled-tv_20260102-0304.xlsx', '');

console.log('\n--- the workbook ---------------------------------------------------');

{
  const { crc32 } = await import('node:zlib');
  const { toXlsx } = await import(pathToFileURL(base + 'src/features/copy-deck/xlsx.js'));
  const sheet = core.buildSheet(core.selectRows(rows), { pagePath: PAGE, exportedAt: '2026-09-27 14:30' });
  const bytes = toXlsx(sheet, { pagePath: PAGE, exportedAt: '2026-09-27 14:30', modified: new Date(2026, 8, 27, 14, 30) });
  const parts = unzip(bytes);
  const names = Object.keys(parts);
  const text = (n) => new TextDecoder().decode(parts[n].data);

  check('a zip whose entries all pass their CRC', names.length === 8 && names.every((n) => crc32(parts[n].data) === parts[n].crc), JSON.stringify(names));
  check(
    'holds a workbook, two sheets and styles',
    ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].every((n) => names.includes(n)),
    JSON.stringify(names)
  );
  const wb = text('xl/workbook.xml');
  check('the tabs are the copy deck and the translator guide', wb.includes('name="Copy deck"') && wb.includes('name="How to translate"'), wb);
  const s1 = text('xl/worksheets/sheet1.xml');
  check('the header row is frozen', s1.includes('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'), '');
  check('the cursor starts in the first Translation cell', s1.includes('activeCell="G2"'), '');
  check('every column has a set width', (s1.match(/<col [^>]*customWidth="1"/g) || []).length === 7, '');
  check('the filter covers the rows but not the closing row', s1.includes(`<autoFilter ref="A1:G${sheet.records.length}"/>`), s1.match(/<autoFilter[^>]*>/)?.[0]);
  check(
    'no cell is a number - all inline text',
    !/<c [^>]*t="n"|<v>/.test(s1) && (s1.match(/t="inlineStr"/g) || []).length === [sheet.columns, ...sheet.records].flat().filter(Boolean).length,
    ''
  );
  check('a line break stays inside its cell', s1.includes('Discover Samsung TVs designed\nfor every way you watch'), '');
  check('markup is escaped, not interpreted', s1.includes('Color Booster Pro&lt;sup&gt;1&lt;/sup&gt;'), '');
  const styles = text('xl/styles.xml');
  check('every data style is text-formatted', (styles.match(/<xf numFmtId="49"/g) || []).length === 10, '');
  check('the translation cells are tinted and editable', /fillId="3"[^>]*applyProtection="1"><alignment[^>]*\/><protection locked="0"\/>/.test(styles), '');
  const guide = text('xl/worksheets/sheet2.xml');
  check('the guide names the right columns', guide.includes('column G (Translation), next to the source text in column F') && guide.includes('Columns A to E are hidden'), '');
  check('Section, Field, Notes, Key and Check are hidden, not removed; Source and Translation show', (text('xl/worksheets/sheet1.xml').match(/<col [^>]*hidden="1"/g) || []).length === 5 && /<col min="6"(?![^>]*hidden)/.test(text('xl/worksheets/sheet1.xml')) && /<col min="7"(?![^>]*hidden)/.test(text('xl/worksheets/sheet1.xml')), '');
  check('...and the page and row count', guide.includes(`Page: ${PAGE}`) && guide.includes(`Rows: ${sheet.records.length - 1}`), '');

  const odd = toXlsx({ columns: ['Source text', 'Translation'], records: [['a\u0001b & <c>', ''], ['#END', '']] });
  check('characters XML cannot hold are dropped, & and < escaped', new TextDecoder().decode(unzip(odd)['xl/worksheets/sheet1.xml'].data).includes('ab &amp; &lt;c&gt;'), '');
  let tooLong = null;
  try {
    toXlsx({ columns: ['Source text'], records: [['x'.repeat(32768)], ['#END']] });
  } catch (e) {
    tooLong = e.message;
  }
  check('a cell longer than Excel allows is refused, not written', /longer than Excel allows/.test(String(tooLong)), String(tooLong));
}

/* ------------------------------------------------------------ the worker */

console.log('\n--- reading the page -----------------------------------------------');

const mk = (status, text) => ({ status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) });
const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);
function render(node, depth) {
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (isNode(v)) {
      if (depth > 0) out[k] = render(v, depth - 1);
    } else out[k] = v;
  }
  return out;
}

/** A repository holding the one page. `limit` is AEM refusing big trees, `how` how it refuses. */
function installFetch({ limit = Infinity, how = '300', session = true, content = FIXTURE } = {}) {
  const root = { content: { samsung: { za: { tvs: { 'jcr:primaryType': 'cq:Page', 'jcr:content': clone(content) } } } } };
  const calls = [];
  const count = (n) => Object.values(n).reduce((s, v) => s + (isNode(v) ? 1 + count(v) : 0), 0);
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURI(String(url).split('?')[0]);
    calls.push(`${(init.method || 'GET').toUpperCase()} ${u}`);
    if ((init.method || 'GET').toUpperCase() !== 'GET') return mk(500, 'no writes expected');
    if (!session) return mk(200, '<html><body>Sign in</body></html>');
    const m = u.match(/^(.*)\.(\d+|infinity)\.json$/);
    if (!m) return mk(404, 'nf');
    const node = m[1].split('/').filter(Boolean).reduce((n, s) => (isNode(n) ? n[s] : undefined), root);
    if (!isNode(node)) return mk(404, 'nf');
    if (m[2] === 'infinity' && count(node) > limit) {
      if (how === '300') return mk(300, JSON.stringify([`${m[1]}.1.json`]));
      return mk(200, JSON.stringify(render(node, 99)).slice(0, 500)); // cut off mid-way
    }
    return mk(200, JSON.stringify(render(node, m[2] === 'infinity' ? 99 : parseInt(m[2], 10))));
  };
  return calls;
}

async function read(opts, params = { page: PAGE }) {
  const calls = installFetch(opts);
  const lines = [];
  const report = (level, message, data) => lines.push({ level, message, data });
  const client = new AemClient({ report });
  try {
    return { result: await actions.read({ client, report, params, settings: {} }), calls, lines, error: null };
  } catch (e) {
    return { result: null, calls, lines, error: e.message };
  }
}

{
  const t = await read({});
  check('reads the page and returns its rows', t.error === null && t.result.rows.length === rows.length, t.error || `${t.result.rows.length} vs ${rows.length}`);
  check('reads only', t.calls.every((c) => c.startsWith('GET ')), JSON.stringify(t.calls));
  check('hands the panel the analysis', t.lines.some((l) => l.level === 'data' && l.message === 'analysis'), '');
  check('hands the panel the page it read, so adding or ignoring a field builds the sheet again without reading it again', JSON.stringify(t.result.tree) === JSON.stringify(FIXTURE), '');
  check(
    'a field not on the sheet is a warning that says where to decide it',
    t.lines.some((l) => l.level === 'warn' && /^1 field\(s\) look like text but are not on the sheet - listed under "Fields not on the sheet"/.test(l.message)),
    JSON.stringify(t.lines.filter((l) => l.level === 'warn'))
  );
}
{
  const fields = { add: [{ component: 'cm-g-promo-banner', prop: 'cardTitle', group: 'cta' }], ignore: [{ component: 'page-pcd', prop: 'productGroupCodeName' }] };
  const t = await read({ content: withPromo() }, { page: PAGE, fields: JSON.stringify(fields) });
  check('the fields added so far are read with the page', t.result.rows.filter((r) => r.prop === 'cardTitle' && r.added).length === 2, t.error || '');
  check('...and the ignored ones are not listed', !t.result.newFields.some((f) => f.prop === 'productGroupCodeName' || f.prop === 'cardTitle'), JSON.stringify(t.result.newFields.map((f) => f.prop)));
  check('...and it says which choices it read them with, for the panel to compare', JSON.stringify(t.result.fields) === JSON.stringify(core.cleanFields(fields)), JSON.stringify(t.result.fields));
}
{
  // The same words twice in a block with another link: kept off the sheet, and Activity says so.
  const t = clone(FIXTURE);
  t.root.responsivegrid.cm_g_static_content_.bodyHtml += '\r\n<p>See <a href="/za/a/">more</a></p>\r\n<p>See <a href="/za/b/">more</a></p>';
  const r = await read({ content: t });
  check(
    'two texts one Key would cover are left off the sheet, and the run names them',
    !r.result.rows.some((x) => x.source.startsWith('See <a')) &&
      r.lines.some(
        (l) =>
          l.level === 'warn' &&
          l.message ===
            'Not on this sheet: "See <a href="/za/a/">more</a>" and "See <a href="/za/b/">more</a>" in Static content 1 of 1 · Find the right TV size for your space - the same words with a different link or style, which the sheet cannot tell apart. Translate them by hand in the block.'
      ),
    JSON.stringify(r.lines.filter((l) => l.level === 'warn'))
  );
}
{
  // Words the block's own script and style show: not on the sheet, and the run says they stay English.
  const t = await read({});
  check(
    'the words a script or a style in a Static Content block shows are named in the run, for a developer',
    t.lines.some(
      (l) =>
        l.level === 'warn' &&
        l.message ===
          'Left in English in Static content 1 of 1 · Find the right TV size for your space: "43" TVs", "98" TVs or larger", "View all 43\'\' TVs", "View all 98\'\' TVs or larger", "or more" - a script or a style in the block shows them, and they are not on the sheet. A developer changes them.'
    ),
    JSON.stringify(t.lines.filter((l) => l.level === 'warn'))
  );

  // A text longer than an Excel cell holds: kept off, the run says so, and the sheet is still made.
  const long = clone(FIXTURE);
  const terms = Array.from({ length: 600 }, (_, i) => `Clause ${i + 1}: valid while stocks last, at participating stores only.`).join('<br>\r\n');
  long.root.responsivegrid.cm_g_static_content_.bodyHtml += `\r\n<p class="terms">${terms}</p>`;
  const r = await read({ content: long });
  const said = r.lines.find((l) => l.level === 'warn' && l.message.startsWith('Not on this sheet: a text of '));
  check(
    'a static text too long for one Excel cell is left off, and the run says where and what it is',
    /^Not on this sheet: a text of \d\d,\d\d\d characters in Static content 1 of 1 · Find the right TV size for your space \("Clause 1: valid while stocks last, at participating stores…"\) - too long for one Excel cell\. Translate it by hand in the block\.$/.test(said?.message) &&
      core.toCsv(core.buildSheet(r.result.rows)).length > 0,
    JSON.stringify(said)
  );

  // Places, not rows: a row of static content can be several places of its block.
  const twice = clone(FIXTURE);
  twice.root.responsivegrid.cm_g_static_content_.bodyHtml = twice.root.responsivegrid.cm_g_static_content_.bodyHtml.replace('<p>We Recommend</p>', '<p>We Recommend</p><p>We Recommend</p>');
  const w = await read({ content: twice });
  const shown = w.result.rows.filter((x) => !x.inactive);
  const places = shown.reduce((n, x) => n + (x.count || 1), 0);
  check(
    'the run counts every place with text - "We Recommend" twice in its block is one row and two places',
    places === shown.length + 1 && w.lines.some((l) => l.message.startsWith(`${places} places with text on ${PAGE}, `)),
    JSON.stringify(w.lines.filter((l) => / places with text /.test(l.message)))
  );
}
{
  const t = await read({}, { page: PAGE, fields: '{not json' });
  check('unreadable choices are no choices: the page is still read', t.error === null && t.result.rows.length === rows.length, String(t.error));
}
{
  const t = await read({ limit: 5, how: '300' });
  check('a page AEM answers with 300 is read a level at a time, whole', t.error === null && JSON.stringify(t.result.rows) === JSON.stringify(rows), t.error || 'rows differ');
  check('...which took more than one request', t.calls.filter((c) => c.includes('.1.json')).length > 1, JSON.stringify(t.calls.slice(0, 6)));
}
{
  const t = await read({ limit: 5, how: 'cut' });
  check('a page AEM cuts off at the limit is read a level at a time, whole', t.error === null && JSON.stringify(t.result.rows) === JSON.stringify(rows), t.error || 'rows differ');
}
{
  const t = await read({ session: false });
  check('an expired session stops the run and says so', /session/i.test(String(t.error)), String(t.error));
}
{
  const t = await read({}, { page: `${PAGE}.html` });
  check('a pasted preview path (tvs.html) reads the page, not a rendered HTML page', t.error === null && t.result.page === PAGE, String(t.error));
}
{
  const t = await read({}, { page: '/content/samsung/za/missing' });
  check('a missing page stops the run', /does not exist/.test(String(t.error)), String(t.error));
}
{
  const t = await read({}, { page: '/content/dam/samsung/za/x.jpg' });
  check('a DAM path is refused before anything is read', /under \/content/.test(String(t.error)) && t.calls.length === 0, `${t.error} ${t.calls}`);
}

console.log('\n--- export warnings: script data to fix before translating -----------');

{
  // The showcase script of explore-samsung-health, read as this page: its tiles were copied from a Fold6 page.
  const EXPLORE = JSON.parse(readFileSync(base + 'test/fixtures/copy-deck-explore-samsung-health.json', 'utf8'));
  const t = await read({ content: EXPLORE });
  const fix = t.lines.filter((l) => l.level === 'warn' && l.message.startsWith('Fix before translating'));
  check(
    'the export warns in Activity of script data to fix before translating: the Fold6 alt texts, popupId "learn-fold6", the empty cta',
    t.error === null &&
      fix.length === 3 &&
      /in Static content 3 of 8 · Showcase \(script\) · Energy Score: All 6 tiles have the same bentoAlt: "Circle to Search with Google", "Battery 4400 milliamp-hours"/.test(fix[0].message) &&
      /All 6 tiles have the same popupId, "learn-fold6" - each tile should open its own\./.test(fix[1].message) &&
      /Tile "Mindfulness" has an empty cta - the other tiles have a link\. The rows it is about say so too\.$/.test(fix[2].message),
    t.error || JSON.stringify(fix.map((l) => l.message))
  );
  check('...and reads only', t.calls.every((c) => c.startsWith('GET ')), JSON.stringify(t.calls.filter((c) => !c.startsWith('GET '))));
  const sheet = core.buildSheet(t.result.rows, { pagePath: PAGE });
  const [N, S] = ['Notes', 'Source text'].map((c) => sheet.columns.indexOf(c));
  const notesOf = (source) => sheet.records.find((r) => r[S] === source)?.[N] ?? '';
  check(
    '...and on the sheet, as a note on the rows it is about: each alt text, the tiles’ titles - no other row',
    /Fix before translating: All 6 tiles have the same bentoAlt/.test(notesOf('Note Assist')) &&
      /Fix before translating: All 6 tiles have the same popupId/.test(notesOf('Sleep tracking')) &&
      /Fix before translating: Tile "Mindfulness" has an empty cta/.test(notesOf('Mindfulness')) &&
      !/empty cta/.test(notesOf('Sleep tracking')) &&
      sheet.records.filter((r) => /Fix before translating/.test(r[N] ?? '')).length === 11,
    JSON.stringify([notesOf('Note Assist'), notesOf('Mindfulness')])
  );
  const za = await read({});
  check(
    'no false alarm on a page without such data: za tvs',
    za.error === null && !za.lines.some((l) => /Fix before translating/.test(l.message)) && deck.scriptWarnings.length === 0,
    JSON.stringify(deck.scriptWarnings)
  );
  // Tiles that differ, or too few to tell: nothing said.
  const sc = await import(pathToFileURL(base + 'src/features/copy-deck/static-content.js'));
  const tile = (title, alt, id, cta) => `${title.toLowerCase()}: { title: "${title}", alt: "${alt}", popupId: "${id}", cta: "${cta}" }`;
  const js = (...tiles) => `const tiles = { ${tiles.join(', ')} };`;
  check(
    'quiet unless sure: tiles with their own alt text, popup and link - or only two tiles - say nothing',
    sc.scriptDataWarnings(js(tile('Sleep', 'A watch face shows sleep data', 'learn-sleep', '/a/'), tile('Heart', 'A heartbeat line on the watch', 'learn-heart', '/b/'), tile('Fitness', 'A runner with pace times', 'learn-fit', '/c/'))).length === 0 &&
      sc.scriptDataWarnings(js(tile('Sleep', 'The same long alt text here', 'x', ''), tile('Heart', 'The same long alt text here', 'x', '/b/'))).length === 0,
    ''
  );
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

/** Read a stored zip from its central directory: name -> { crc, data }. */
function unzip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out = {};
  for (let i = 0; i < count; i++) {
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out[name] = { crc, data: bytes.subarray(start, start + size) };
    at += 46 + nameLen;
  }
  return out;
}

/** RFC 4180, enough to prove the CSV means what it says. */
function parseCsv(text) {
  const out = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell), out.push(row), (row = []), (cell = ''), i++;
    } else cell += c;
  }
  return out;
}
