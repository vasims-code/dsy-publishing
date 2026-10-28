/**
 * Copy deck core: a page's authored content in, rows for translators out.
 *
 * The content is the page's jcr:content tree - `<page>/jcr:content.infinity.json`
 * on author - not the rendered page. That is what makes the sheet round-trip:
 * every row names the node and property its text came from, so a translation
 * can be written back to exactly that property, and nothing a template or a
 * script renders around the content (popups, carousel buttons, global banners)
 * ends up in front of a translator.
 *
 * Also used by spub-swiss-army-knife (spub_modular/copydeck/core.js), whose copy
 * stops at the import dry run and predates added fields: writing translations
 * back (writesFingerprint and the copy-deck-import worker) and the fields added
 * or ignored by the operator (newFields, cleanFields, fieldsFromSheet) are built
 * here only. So is the product page (PD) sheet, read from the rendered page:
 * see pd.js - and static HTML read whole-sentence: see static-content.js.
 *
 * Pure: no DOM, no chrome.*, no network - it runs in a content script, a panel
 * and a test alike.
 */

import { buildRules, resolveSites, rewriteValue } from '../../core/rewrite.js';
import {
  ALREADY_IN_BLOCK,
  LINK_OR_PATH,
  NOT_IN_BLOCK,
  TAG,
  WORDS_ONLY,
  blockTexts,
  developerList,
  placesNote,
  prepareBody,
  prepareFooter,
  readBlock,
  repairTags,
  sameWords,
  scriptDataWarnings,
  shapeOf,
  shapesOf,
  textsNow,
  verify
} from './static-content.js';

/**
 * 4: static HTML in whole sentences, tags kept - one row per text, keyed by
 * the text's shape (…@bodyHtml#hb11688fa), and merged with the same text
 * elsewhere like any other row; the strings of a Static Content block's script
 * too, for a developer. Sheets of v1-v3 cut it into pieces keyed by position
 * (…@bodyHtml#03): they import as they did.
 * 3: rich text as it is stored, every tag and link written out, for the
 * translation team to translate in place - no <a1> placeholders, no rows of
 * their own for a link's title or an image's alt.
 * 2: a text used in several places is one row, its Key and Check cells holding
 * one line per place.
 * Sheets of every version import: v1 (one row per place, repeats marked "Same
 * as row N") and v1/v2 placeholders included.
 */
export const SHEET_VERSION = 4;

/**
 * The sheet, left to right: context first, then the text and its translation
 * side by side at the end, so the translator works in the last column. The
 * import finds columns by header, never by position.
 */
export const SHEET_COLUMNS = ['Section', 'Field', 'Notes', 'Key (do not edit)', 'Check (do not edit)', 'Source text', 'Translation'];

/** Groups the operator can include or leave out. Order is the order shown. */
export const CATEGORIES = [
  { id: 'page', label: 'Page title & SEO' },
  { id: 'copy', label: 'Headlines & body copy' },
  { id: 'cta', label: 'Buttons & link text' },
  { id: 'alt', label: 'Image alt text' },
  { id: 'a11y', label: 'Link titles (screen reader)' },
  { id: 'disclaimer', label: 'Disclaimers' },
  { id: 'breadcrumb', label: 'Breadcrumb' },
  { id: 'static', label: 'Static HTML (applied by hand)' }
];

/* ----------------------------------------------------------------- rules */

/** jcr:content's own properties that are copy. Everything else on the page node is not. */
const PAGE_FIELDS = {
  'jcr:title': { category: 'page', label: 'Page title' },
  'jcr:description': { category: 'page', label: 'Page description' },
  pageTitle: { category: 'page', label: 'Browser title' },
  navTitle: { category: 'page', label: 'Navigation title' },
  localTitle: { category: 'page', label: 'Local title' },
  description: { category: 'page', label: 'Meta description' },
  keywords: { category: 'page', label: 'Meta keywords' },
  ogTitle: { category: 'page', label: 'Open Graph title' },
  ogDescription: { category: 'page', label: 'Open Graph description' },
  twitterTitle: { category: 'page', label: 'Twitter title' },
  twitterDescription: { category: 'page', label: 'Twitter description' },
  disclaimer: { category: 'disclaimer', label: 'Common disclaimer' }
};

/**
 * Component properties that are copy. First match wins, and the order here is
 * the order a node's rows appear in - the order the component reads in, not
 * whatever order JCR happens to store them. `text` is decided by the node it
 * sits on: a button, a link, or body copy.
 */
const FIELD_RULES = [
  { test: /^(desktop|mobile)?[hH]eadlineText\d*$/, category: 'copy', label: 'Headline' },
  { test: /^subHeadlineText\d*$/, category: 'copy', label: 'Sub-headline' },
  { test: /^description\d*$/, category: 'copy', label: 'Description' },
  { test: /^(text|desktopText|mobileText)$/, category: 'text', label: 'Text' },
  // A Lineup Compare's spec cells: spec/text1 is the row of categoryList/item0, text2 of item1.
  // Elsewhere text2 is a button's text (a Feature Benefit's second CTA): only here are they specs.
  { test: /^text\d+$/, component: 'pd-g-lineup-compare', category: 'copy', label: 'Spec text' },
  { test: /^textForLinkAction\d+$/, category: 'cta', label: 'Button text' },
  { test: /^(linkTitle|clickableStateLinkTitle)$/, category: 'a11y', label: 'Link title' },
  { test: /^alternativeForLinkAction\d+$/, category: 'a11y', label: 'Link title' },
  { test: /^imageAlternativeText$/, category: 'alt', label: 'Image alt (desktop)' },
  { test: /^imageMobileAlternativeText$/, category: 'alt', label: 'Image alt (mobile)' },
  { test: /^(altText|alternativeText|imageAlt)$/, category: 'alt', label: 'Image alt' },
  { test: /^videoCaption$/, category: 'copy', label: 'Video caption' },
  { test: /^videoAlternativeText$/, category: 'alt', label: 'Video alt' },
  { test: /^disclaimer\d*$/, category: 'disclaimer', label: 'Disclaimer' }
];

const PAGE_ORDER = Object.keys(PAGE_FIELDS);

/* A Header Carousel names its slide's fields after the plain ones, with
 * "carousel" in front: carouselHeadlineText, carouselDescription,
 * carouselImageAlternativeText. The rules read them by the plain name. */
const ruleName = (prop) => String(prop).replace(/^carousel([A-Z])/, (_, c) => c.toLowerCase());
const ruleFor = (prop, component) => FIELD_RULES.find((r) => (!r.component || r.component === component) && r.test.test(ruleName(prop)));

/**
 * Never exported. System properties, and the English-only values analytics
 * reads: translating `headlineEngText`, `linkEng` or `textForAnalytics2` would
 * break reporting across every locale, quietly. And the page's social settings
 * that look like words: `twitterCard` holds "Summary", `ogType` "website".
 */
const DENY = [
  /^(jcr|cq|sling|rep|dam|mix):/,
  /engtext$/i,
  /Eng\d*$/,
  /^englishTitle$/,
  /analytics\d*$/i,
  /^analytis/i,
  /track/i,
  /^(twitterCard|ogType)$/
];

/** Properties that hold a block of raw HTML. Its text is listed, and applied by hand. */
const STATIC_HTML_PROPS = ['bodyHtml'];

/** The component whose blocks are numbered on the sheet, and whose script's strings are rows too. */
const STATIC_CONTENT = 'cm-g-static-content';

/** A text of static HTML, or of a Static Content block's script, by its shape: "…@bodyHtml#hb11688fa" (sheet v4). */
const STATIC_KEY = /#h[\da-f]{8}$/;
/** A piece of static HTML by its position in the block, as sheets v1-v3 cut it: "…@bodyHtml#03". */
const STATIC_PIECE = new RegExp(`@(${STATIC_HTML_PROPS.join('|')})#\\d+$`);

/**
 * Code a component puts on the page as it stands: a Static Content block's
 * style sheet (Header) and script (Footer). Never offered, never on the sheet,
 * never written by the import, whatever was added - words in a script are not
 * copy, and one wrong quote in it blanks the block. Changing it is a
 * developer's job. The import reads no dialogs, so this list is what keeps
 * code from being written: a component found to keep code in a text area of
 * its own belongs here too.
 */
const CODE_FIELDS = { [STATIC_CONTENT]: ['headerInclude', 'footerInclude'] };

export const isCodeField = (component, prop) => CODE_FIELDS[component]?.includes(prop) ?? false;

/** What the import says to a row for that code, however the sheet came to have one - in the words of the block's dialog. */
const CODE_REFUSED = 'A Static Content block’s Header (CSS) and Footer (JavaScript) are code: the import never writes them - a developer changes them by hand.';

/** Top-level containers in the order the page renders them; any others follow in JCR order. */
const CONTAINER_ORDER = ['responsivegrid-top', 'main-ipar', 'root'];

const LAYOUT_CONTAINER = /(responsivegrid|iparsys|parsys)(\/par)?$/;

const COMPONENT_LABELS = {
  'nv-g-quick-filter-card': 'Page Headline',
  'nv-g-pd-category-main': 'Category Navigation',
  'nv-g-pd-category-sub': 'Size Navigation',
  'pd-g-feature-benefit': 'Feature Benefit',
  'pd-g-feature-benefit-full-bleed': 'Feature Benefit Full Bleed',
  'pd-g-feature-benefit-column-carousel': 'Feature Column Carousel',
  'cm-g-text-block': 'Text Block',
  'cm-g-static-content': 'Static Content (HTML)',
  'cm-g-bleed-card': 'Bleed Card',
  'nv-g-breadcrumb': 'Breadcrumb'
};

/** System properties that can still hold words a visitor reads: AEM's own Title, Teaser and Tabs keep them here. */
const SYSTEM_TEXT = new Set(['jcr:title', 'jcr:description', 'cq:panelTitle']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* ---------------------------------------------------------- added fields */

/*
 * The rules above go by property name, so a component that names its fields its
 * own way would lose its text from the sheet without a word. Instead, every
 * field that reads like words but is not on the sheet is listed (newFields), and
 * the operator adds it or ignores it. The choices are kept in settings:
 *
 *   { add: [{ component, prop, group }], ignore: [{ component, prop }] }
 *
 * A field is a component AND a property, because the same name can be copy in
 * one component and a setting in another. `component` is the component's name -
 * the last part of its sling:resourceType, "cm-g-promo-banner"; for the page's
 * own properties the page's, "page-standard-pd" - or "*" for any.
 */

/** Can this property ever go on the sheet? Never a system property, never a value analytics reads in English. */
export const fieldAllowed = (prop) => SYSTEM_TEXT.has(prop) || !DENY.some((re) => re.test(String(prop)));

/** How a field is known: the last part of the resource type. */
export const componentName = (resourceType) => String(resourceType || '').split('/').pop();

export const fieldId = (f) => `${f.component}@${f.prop}`;

/** A component as a field names it: a full resource type pasted from CRXDE means its last part; "*" stays "*". */
export const fieldComponent = (c) => {
  const t = String(c ?? '').trim();
  return t === '*' ? '*' : componentName(t.replace(/\/+$/, ''));
};

/** The groups an added field can go in. Static HTML is not one: it is applied by hand. */
export const FIELD_GROUPS = CATEGORIES.filter((c) => c.id !== 'static');

/**
 * The stored choices, checked: anything malformed, or a property that may never
 * go on the sheet - a Static Content block's code, added before it was taken
 * off, among them - is dropped; a field both added and ignored counts as added.
 */
export function cleanFields(fields) {
  const groups = new Set(FIELD_GROUPS.map((g) => g.id));
  const good = (f) =>
    f && typeof f.component === 'string' && typeof f.prop === 'string' && f.component.trim() && f.prop.trim() && fieldAllowed(f.prop.trim());
  const list = (v) =>
    (Array.isArray(v) ? v : [])
      .filter(good)
      .map((f) => ({ ...f, component: fieldComponent(f.component), prop: f.prop.trim() }))
      .filter((f) => f.component && !isCodeField(f.component, f.prop));
  const seen = new Set();
  const add = [];
  for (const f of list(fields?.add)) {
    if (seen.has(fieldId(f))) continue;
    seen.add(fieldId(f));
    add.push({ component: f.component, prop: f.prop, group: groups.has(f.group) ? f.group : 'copy' });
  }
  const ignore = [];
  for (const f of list(fields?.ignore)) {
    if (seen.has(fieldId(f))) continue;
    seen.add(fieldId(f));
    ignore.push({ component: f.component, prop: f.prop });
  }
  return { add, ignore };
}

/** The choices, made quick to ask: which group a field was added to, and whether it is ignored. */
function choicesFor(fields) {
  const { add, ignore } = cleanFields(fields);
  const added = new Map(add.map((f) => [fieldId(f), f.group]));
  const ignored = new Set(ignore.map(fieldId));
  return {
    // The component's own choice first: an Ignore for one component beats an Add for "*", and the other way round.
    group: (component, prop) =>
      added.get(`${component}@${prop}`) ?? (ignored.has(`${component}@${prop}`) ? null : added.get(`*@${prop}`)) ?? null,
    ignored: (component, prop) => ignored.has(`${component}@${prop}`) || (ignored.has(`*@${prop}`) && !added.has(`${component}@${prop}`))
  };
}

/** "cardTitle" reads "Card title", "cq:panelTitle" "Panel title". */
export const fieldLabel = (prop) =>
  String(prop)
    .replace(/^\w+:/, '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

/** The group a field most likely belongs in - a starting point the operator can change. */
function guessGroup(prop, isPage) {
  if (isPage) return 'page';
  if (/^alt|Alt(?![a-z])|[aA]lternative/.test(prop)) return 'alt';
  if (/[dD]isclaimer/.test(prop)) return 'disclaimer';
  if (/[aA]ria|[lL]inkTitle/.test(prop)) return 'a11y';
  if (/[cC]ta|[bB]utton|[lL]ink/.test(prop)) return 'cta';
  return 'copy';
}

/* --------------------------------------------------------------- extract */

/**
 * Every translatable value on the page, in page order.
 *
 * Returns `rows` - one per property occurrence, each writing back to its own
 * property; the sheet puts the places of one text on one row (mergeRows) -
 * plus `newFields`, fields that read like words but are not on the sheet, one
 * per component and property, for the operator to add or ignore, and
 * `references`, content that lives elsewhere and so is not on this sheet.
 * `fields` is the operator's choices (see cleanFields). `dialogs` is what the
 * components' dialogs say about their fields (see dialog.js): a setting or an
 * English-only analytics field is never offered, and a text field brings its
 * label and its length limit. `placeholders` reads rich text the way copy deck
 * v1 and v2 showed it (see describe), `staticPieces` static HTML the way v1 to
 * v3 cut it (see segmentStaticHtml) - for the import of a sheet made then.
 * `staticLeftOff` lists static texts kept off the sheet - two that one Key
 * would cover, or one too long for a cell (see addStatic) - and `staticCode`
 * the words the scripts and styles inside static HTML show, which stay as
 * they are for a developer to change. `scriptWarnings` is what a block's
 * script data seems to hold by mistake - the same alt texts on every tile,
 * say (see scriptDataWarnings): to fix before translating, so each is said
 * on its rows too.
 */
export function extractCopyDeck(content, { pagePath = '', fields, dialogs, placeholders = false, staticPieces = false } = {}) {
  if (!isObject(content)) throw new Error('No jcr:content to read.');

  const rows = [];
  const references = [];
  const sections = [];
  const staticLeftOff = [];
  const staticCode = [];
  const scriptWarnings = [];
  const choices = choicesFor(fields);
  const dialogOf = dialogIndex(dialogs);
  const usesCommonDisclaimer = someNode(content, (n) => n.useCommonDisclaimer === 'true');
  const blocks = staticBlocks(content);
  let sectionCount = 0;

  const pageSection = {
    no: 0,
    page: true,
    label: 'Page properties',
    resourceType: content['sling:resourceType'] || '',
    component: componentName(content['sling:resourceType']) || 'page',
    relPath: ''
  };

  /* A Static Content block goes by its own number among the blocks ("5/8"),
   * so it takes none of the sections' numbers: they run on without a gap. */
  const add = (section, row) => {
    if (section.no === null) section.no = section.block ? `${section.block.no}/${section.block.of}` : ++sectionCount;
    section.rowCount = (section.rowCount || 0) + 1;
    rows.push({ ...row, section: sectionLabel(section), sectionNo: section.no, place: placeLabel(section) });
  };

  /* Static HTML, read the way a translator needs it (see static-content.js):
   * a row per text, whole sentences with their tags. Its Key is the text's
   * shape - its words and the names of its tags - so one Key covers every place
   * the text is in, in this block, and outlives a link pointed elsewhere, a
   * re-indent or a change to the block's CSS. Its Check is the text itself and
   * how many places it is in. A Key that would cover two different texts - the
   * same words with another link or class - is never made: both are kept off
   * the sheet and listed, to be done by hand. So is a text too long for one
   * Excel cell, rather than the whole sheet refused for it. */
  const addStatic = (section, relPath, read, inactive, footer = '') => {
    const texts = blockTexts(read);
    const warned = scriptDataWarnings(footer);
    if (warned.length) scriptWarnings.push({ path: relPath, section: section.label, says: warned.map((w) => w.say) });
    // A row the script data's mistake is about says so, for whoever fixes it before translating.
    const fixFirst = (t) => (t.prop === 'footerInclude' ? warned.filter((w) => w.cells.includes(t.cell)).map((w) => `Fix before translating: ${w.say}`) : []);
    const keyOf = (t) => `${relPath || '.'}@${t.prop}#${sourceHash(shapeOf(t.cell))}`;
    const byKey = new Map();
    for (const t of texts) byKey.set(keyOf(t), [...(byKey.get(keyOf(t)) || []), t]);
    const inside = fieldContext(relPath, section);
    // One line per place: "Tab "Active" › Card "Galaxy Fit3" › Colour name". Past 100, the rest are only counted, so the cell still fits.
    const fieldOf = (t) => {
      const lines = t.places.map((p) => [inside, ...p.where, p.kind].filter(Boolean).join(' › '));
      return (lines.length > MAX_PLACES ? [...lines.slice(0, MAX_PLACES), `… and ${lines.length - MAX_PLACES} more places`] : lines).join('\n');
    };
    const leaveOff = (t, why, same) =>
      staticLeftOff.push({
        key: keyOf(t),
        path: relPath,
        prop: t.prop,
        section: section.label,
        why,
        texts: same.map((x) => x.cell),
        fields: same.map(fieldOf),
        inactive
      });
    for (const t of texts) {
      const same = byKey.get(keyOf(t));
      if (same.length > 1) {
        if (same[0] === t) leaveOff(t, 'same key', same);
        continue;
      }
      if (excelSafe(t.cell).length > MAX_CELL) {
        leaveOff(t, 'too long', [t]);
        continue;
      }
      add(section, {
        key: keyOf(t),
        path: relPath,
        prop: t.prop,
        value: t.cell,
        source: t.cell,
        format: 'manual',
        category: 'static',
        field: fieldOf(t),
        // What is said of the text, and - a line per place - what is said of each place of it: a hidden tab, a short label.
        notes: [...new Set([...fixFirst(t), ...t.places.flatMap((p) => [...p.notes, ...p.hints])])],
        placeNotes: t.places.map((p) => p.hints),
        count: t.places.length,
        inactive,
        hash: `${sourceHash(t.cell)}/${t.places.length}`,
        // An attribute stored without quotes: nothing but a space ends what is put in it; in single quotes, an apostrophe does (see refusal).
        unquoted: t.places.some((p) => p.unquoted) || undefined,
        singleQuoted: t.places.some((p) => p.singleQuoted) || undefined,
        // A sentence the script builds, which the developer puts in whole.
        built: t.places.some((p) => p.kind === 'Built sentence') || undefined,
        // The quotes a script holds the text in, which a developer escapes in its translation.
        quotes: t.prop === 'footerInclude' ? [...new Set(t.places.map((p) => p.quote))] : undefined
      });
    }
    const code = read.body.report.codeWords;
    if (code.length) staticCode.push({ path: relPath, section: section.label, texts: [...new Set(code)] });
  };

  const visitProps = (node, relPath, section, inactive, isPage) => {
    for (const [prop, raw] of readingOrder(node, isPage)) {
      if (isObject(raw)) continue;
      const key = `${relPath || '.'}@${prop}`;

      if (/fragment(Variation)?Path$/i.test(prop) && typeof raw === 'string' && raw) {
        references.push({ key, value: raw });
        continue;
      }

      const dialog = dialogOf(section, relPath, prop);
      const rule = classify(prop, node, section, isPage, choices, dialog);
      if (!rule) continue;
      const limit = dialog?.kind === 'text' && dialog.hint ? dialog.hint : undefined;

      if (rule.category === 'static') {
        if (typeof raw !== 'string' || !raw.trim()) continue;
        if (staticPieces) {
          const hash = sourceHash(raw);
          segmentStaticHtml(raw).forEach((seg, i) => {
            add(section, {
              key: `${key}#${String(i + 1).padStart(2, '0')}`,
              path: relPath,
              prop,
              value: seg.text,
              source: seg.text,
              format: 'manual',
              category: 'static',
              field: `Static HTML › ${seg.label}`,
              inactive,
              hash,
              piece: true
            });
          });
          continue;
        }
        // A Static Content block is read whole - its Body and its script's strings - in walk.
        if (!blocks.has(relPath)) addStatic(section, relPath, readBlock({ bodyHtml: raw }), inactive);
        continue;
      }

      const multi = Array.isArray(raw);
      (multi ? raw : [raw]).forEach((value, index) => {
        if (typeof value !== 'string') return;
        // An empty rich-text field is stored as "<p>&nbsp;</p>": nothing to translate -
        // unless a tag in it has words of its own, an image's alt, which get their rows below.
        /* An added field holds whatever its component puts there: a value of it whose
         * text is a path or a link ("www.samsung.com/za", "#specs") is not text, and
         * never goes to a translator - but words in its tags still do, a link's title
         * say, as readsAsText counts them. The import reads the page the same way, so
         * it refuses such a text row value by value, whatever else is on the sheet. */
        const linkOnly = rule.added && LINK_OR_PATH.test(plainText(value));
        const visible = !linkOnly && hasWords(value.replace(TAG, ''));
        const inTags = tagWords(value).length > 0;
        if (!visible && !inTags) return;
        const shown = describe(value, { placeholders });
        const rowKey = multi ? `${key}[${index}]` : key;
        const field = [fieldContext(relPath, section), rule.label].filter(Boolean).join(' › ');
        const hidden = inactive || inactiveReason(prop, node, isPage, usesCommonDisclaimer);
        /* Written out in full, a value whose only words are in its tags - an image
         * and its alt - is a row like any other: the alt is translated in place. */
        if (visible || !placeholders) add(section, {
          key: rowKey,
          path: relPath,
          prop,
          index: multi ? index : undefined,
          value,
          source: shown.text,
          format: shown.format,
          tags: shown.tags,
          lineBreaks: shown.lineBreaks,
          category: visible ? rule.category : tagCategory(value) || rule.category,
          field,
          inactive: hidden,
          added: rule.added,
          limit,
          hash: sourceHash(value)
        });

        /* Placeholders only (sheets made before v3): a link's title, an image's alt -
         * words inside a tag the row shows as <a1> - get a row of their own, keyed by
         * the placeholder, so the translation can be put into that tag when the
         * import rebuilds it from AEM. Written out in full, they are in the text. */
        if (!placeholders || shown.format !== 'html') return;
        for (const { token, original } of tokenizeTags(value).tokens) {
          for (const [attr, label, category] of TAG_ATTRS) {
            const stored = attrValue(original, attr);
            if (stored === null || !hasWords(stored)) continue;
            add(section, {
              key: `${rowKey}~${token}.${attr}`,
              path: relPath,
              prop,
              index: multi ? index : undefined,
              attr: { token, name: attr },
              // No text row of its own above it: an image alone, say. The sheet's note says so.
              attrOnly: visible ? undefined : true,
              value: stored,
              source: decodeEntities(stored).replace(/\s+/g, ' ').trim(),
              format: 'attribute',
              category,
              field: `${field} › <${token}> ${label}`,
              inactive: hidden,
              added: rule.added,
              hash: sourceHash(stored)
            });
          }
        }
      });
    }
  };

  const walk = (node, relPath, section, inactive) => {
    const resourceType = node['sling:resourceType'];
    const starts = resourceType && !LAYOUT_CONTAINER.test(resourceType);
    if (starts) {
      const component = componentName(resourceType);
      const block = blocks.get(relPath);
      section = { no: null, resourceType, component, relPath, label: componentLabel(resourceType, node, block), nodes: [], block };
      sections.push(section);
    }
    /* useFlag "false" switches off an item of a component - a carousel slide, a
     * column. On the component's own node it is one of its settings, not a
     * switch: a Text Editor stores it there and still shows its text. */
    if (!starts && node.useFlag === 'false') inactive = inactive || 'switched off in AEM';
    section.nodes?.push([node, relPath]);

    visitProps(node, relPath, section, inactive, false);
    if (section.block && section.relPath === relPath && !staticPieces) addStatic(section, relPath, section.block, inactive, node.footerInclude);
    for (const [name, child] of Object.entries(node)) {
      if (isObject(child)) walk(child, relPath ? `${relPath}/${name}` : name, section, inactive);
    }
  };

  visitProps(content, '', pageSection, null, true);
  for (const [name, child] of orderedContainers(content)) walk(child, name, pageSection, null);

  return { pagePath, rows, newFields: newFieldsIn(content, pageSection, sections, rows, choices, dialogOf), references, staticLeftOff, staticCode, scriptWarnings };
}

/**
 * The page's Static Content blocks in page order, each read (see readBlock)
 * and numbered: relPath → { no, of, name, body, script }. Every block counts,
 * one with no text too, so "5 of 8" is the fifth block in the editor - where
 * all of them are called "RC01_Static Content".
 */
function staticBlocks(content) {
  const found = [];
  const walk = (node, relPath) => {
    if (componentName(node['sling:resourceType']) === STATIC_CONTENT) found.push([relPath, node]);
    for (const [name, child] of Object.entries(node)) if (isObject(child)) walk(child, `${relPath}/${name}`);
  };
  for (const [name, child] of orderedContainers(content)) walk(child, name);
  return new Map(found.map(([relPath, node], i) => [relPath, { no: i + 1, of: found.length, ...readBlock(node) }]));
}

/**
 * Every component type on the page, the page's own included: the dialogs to
 * read. Layout containers hold no copy, so theirs are not wanted.
 */
export function componentTypes(content) {
  const types = new Set();
  const walk = (node) => {
    const type = node['sling:resourceType'];
    if (typeof type === 'string' && type && !LAYOUT_CONTAINER.test(type)) types.add(type);
    for (const child of Object.values(node)) if (isObject(child)) walk(child);
  };
  if (isObject(content)) walk(content);
  return [...types];
}

/*
 * What a component's dialog says about a field. `dialogs` maps a resource type
 * to its fields, each { path, prop, kind, label, hint }: kind 'text', 'setting',
 * 'analytics' or 'code'; path relative to the component's node, with '*' for any one
 * item of a list ("list/*"). Returns a lookup by section, node and property.
 */
function dialogIndex(dialogs) {
  const byType = new Map();
  for (const [type, fields] of Object.entries(isObject(dialogs) ? dialogs : {})) {
    if (!Array.isArray(fields)) continue;
    const byProp = new Map();
    for (const f of fields) {
      if (!f || typeof f.prop !== 'string') continue;
      if (!byProp.has(f.prop)) byProp.set(f.prop, []);
      byProp.get(f.prop).push(f);
    }
    byType.set(type, byProp);
  }
  return (section, relPath, prop) => {
    const candidates = byType.get(section.resourceType)?.get(prop);
    if (!candidates) return null;
    // The page's dialog speaks for the page node only; a component's, for the nodes inside it.
    let inner;
    if (section.page) {
      if (relPath) return null;
      inner = [];
    } else {
      const base = section.relPath;
      if (relPath === base) inner = [];
      else if (relPath.startsWith(`${base}/`)) inner = relPath.slice(base.length + 1).split('/');
      else return null;
    }
    return (
      candidates.find((f) => {
        const p = f.path ? f.path.split('/') : [];
        return p.length === inner.length && p.every((s, i) => s === '*' || s === inner[i]);
      }) || null
    );
  };
}

/**
 * Fields that read like words but are not on the sheet - one entry per
 * component and property, however many times it occurs, because that is what
 * the operator decides: add it, or ignore it. The page's own properties are
 * looked at, and every component's nodes down to the next component; the
 * layout containers between components hold no copy. Read wider than the
 * rules on purpose (see readsAsText): a text left off costs more than a
 * setting shown once and ignored - unless the component's dialog says what
 * the field is: a setting, an English-only value for analytics or code is
 * never offered; a text field is, with the label and the limit the author
 * sees. Nor, dialog or not, is a Static Content block's script or style sheet
 * (see CODE_FIELDS).
 */
function newFieldsIn(content, pageSection, sections, rows, choices, dialogOf) {
  const exported = new Set(rows.map((r) => `${r.path}@${r.prop}`));
  const found = new Map();
  const look = (section, node, relPath, isPage) => {
    const { component } = section;
    for (const [prop, raw] of readingOrder(node, isPage)) {
      if (isObject(raw) || !fieldAllowed(prop) || /fragment(Variation)?Path$/i.test(prop)) continue;
      // Code, not copy, however many words are in it: never asked about (see CODE_FIELDS).
      if (isCodeField(component, prop)) continue;
      // Static HTML is read whole wherever it is, the page's own too (see classify): never a field to add.
      if (STATIC_HTML_PROPS.includes(prop)) continue;
      // Decided already - added (even where it gave no row here) or ignored: not asked again.
      if (exported.has(`${relPath}@${prop}`) || choices.ignored(component, prop) || choices.group(component, prop)) continue;
      const dialog = dialogOf(section, relPath, prop);
      if (dialog && dialog.kind !== 'text') continue;
      const values = (Array.isArray(raw) ? raw : [raw]).filter(readsAsText);
      if (!values.length) continue;
      const id = `${component}@${prop}`;
      if (!found.has(id)) {
        found.set(id, {
          component,
          componentLabel: isPage ? 'Page properties' : baseLabel(component),
          prop,
          // Where in the component it was first seen: "list/item0", or '' on the component itself.
          where: relPath.slice(section.relPath ? section.relPath.length + 1 : 0),
          key: `${relPath || '.'}@${prop}`,
          text: shortText(values[0]),
          count: 0,
          group: guessGroup(prop, isPage),
          // A text field in the component's dialog, as the author sees it.
          label: dialog?.label || '',
          limit: dialog?.hint || ''
        });
      }
      found.get(id).count += values.length;
    }
  };
  look(pageSection, content, '', true);
  for (const s of sections) for (const [node, relPath] of s.nodes) look(s, node, relPath, false);
  return [...found.values()];
}

/** The words in a value: markup, comments, scripts and styles left out. */
const plainText = (value) =>
  decodeEntities(
    String(value)
      .replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(TAG, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();

/** The words inside tags - a link's title, an image's alt - in the order they come. */
const tagWords = (value) =>
  tokenizeTags(String(value))
    .tokens.flatMap((t) => TAG_ATTRS.map(([attr]) => attrValue(t.original, attr)))
    .filter((s) => s !== null && hasWords(s))
    .map((s) => decodeEntities(s).replace(/\s+/g, ' ').trim());

/** A value as a person reads it, cut short enough to list: its text, or failing that the words in its tags. */
function shortText(value) {
  const t = plainText(value) || tagWords(value).join(' · ');
  return t.length > 300 ? `${t.slice(0, 299)}…` : t;
}

const FLAG_WORD = /^(true|false|yes|no|on|off|none|null|undefined)$/i;

const isJson = (v) => {
  try {
    JSON.parse(v);
    return true;
  } catch {
    return false;
  }
};

/** One piece of text: words, or a setting's value? See readsAsText. */
function wordy(v) {
  if (!/\p{L}/u.test(v)) return false;
  // "#1 Best Seller" and "[Exclusive] Save R2 000" are words; ["a", "b"] is not.
  if (LINK_OR_PATH.test(v) || (/^[{[]/.test(v) && isJson(v))) return false;
  if (/^\w{3} \w{3} \d{2} \d{4} \d{2}:\d{2}:\d{2}/.test(v)) return false; // JCR dates: "Tue Sep 22 2026 02:22:41 GMT+0900"
  const words = v.split(' ');
  // Class lists: "text-center s-mo-left", "x--top x--left".
  if (words.length > 1) return !words.every((w) => /^[a-z\d]+(?:(?:--?|__?|\.)[a-z\d]+)+$/.test(w));
  // One word, with the marks copy puts around it: "Free*", "QLED®", "(New)", "More…", "¡Nuevo!".
  // Not @ # _ / - a handle, a tag, an id and a path are not words.
  const word = v.replace(/^[(\[{“”„«‹‘'"¡¿]+/, '').replace(/[)\]}“”»›’'"*†‡§¶™®©…!?.:,;]+$/, '');
  if (FLAG_WORD.test(word) || /^[a-zA-Z]{2}[-_][A-Z]{2}$/.test(word)) return false; // TRUE, Yes, en-ZA
  if (/(?![a-zA-Z])\p{L}/u.test(word)) return true;
  return word.length > 1 && /^\p{Lu}[\p{L}\p{M}'’.&-]*$/u.test(word);
}

/**
 * Would a visitor read this value? Wider than the rules, on purpose: it decides
 * what is offered to add, where a text left off costs more than a setting shown
 * once and ignored. So one word counts too, when it reads as a word - "Buy",
 * "OLED", "Wi-Fi", or any word with a letter outside plain ASCII ("Téléviseurs",
 * "구매") - and not as a setting's value ("large", "headlineOnly", "h2",
 * "bg-white", "_self", "QN75QN80HAFXZC", "TRUE"). Markup whose only words are
 * in a tag - an image's alt - counts too. Short codes, prices and sizes on
 * their own ("QN90F", "R999", "55\"") do not.
 */
export function readsAsText(value) {
  if (typeof value !== 'string') return false;
  return wordy(plainText(value)) || tagWords(value).some(wordy);
}

function classify(prop, node, section, isPage, choices, dialog) {
  // The dialog says this is the English the analytics read: never translated, whatever its name.
  if (dialog?.kind === 'analytics') return null;
  /* Code - a Static Content block's style sheet or script, or a text area its
   * dialog labels (CSS) or (JavaScript): never on the sheet, even added. An Add
   * kept in settings from before cannot bring it back. */
  if (dialog?.kind === 'code' || isCodeField(section.component, prop)) return null;
  /* A field the operator added - on the page itself, or in a component; never
   * on the layout containers between components, which hold no copy. The
   * rules still come first where they know the property. */
  const group = isPage || section.no !== 0 ? choices.group(section.component, prop) : null;
  const label = (dialog?.kind === 'text' && dialog.label) || fieldLabel(prop);
  const added = group && fieldAllowed(prop) ? { category: group, label, added: true } : null;

  /* Static HTML wherever it is - on the page itself too, where it would
   * otherwise be offered as copy that the import then always refuses. */
  if (STATIC_HTML_PROPS.includes(prop)) return { category: 'static', label: 'Static HTML' };
  if (isPage) return PAGE_FIELDS[prop] || added;
  if (DENY.some((re) => re.test(prop))) return added;

  const rule = ruleFor(prop, section.component);
  if (!rule) return added;
  if (/breadcrumb/.test(section.resourceType || '')) {
    return { category: 'breadcrumb', label: rule.category === 'text' ? 'Link text' : rule.label };
  }
  if (rule.label === 'Spec text') return { ...rule, label: `Spec ${prop.slice(4)}` };
  if (rule.category !== 'text') return rule;
  if (node.ctaType || node.buttonTheme) return { category: 'cta', label: 'Button text' };
  if (node.linkPath) return { category: 'cta', label: 'Link text' };
  return { category: 'copy', label: 'Text' };
}

/** Why a value is on the page's content but not on the page a visitor sees. */
function inactiveReason(prop, node, isPage, usesCommonDisclaimer) {
  if (/^video/i.test(prop) && node.contentsType && !/video/i.test(node.contentsType)) {
    return `the block shows ${node.contentsType}, not video`;
  }
  if (isPage && prop === 'disclaimer' && !usesCommonDisclaimer) {
    return 'no component uses the common disclaimer';
  }
  return null;
}

/** A node's properties with the copy first, in the order the rules list it. Stable otherwise. */
function readingOrder(node, isPage) {
  const rank = (prop) => {
    const i = isPage ? PAGE_ORDER.indexOf(prop) : FIELD_RULES.indexOf(ruleFor(prop));
    return i === -1 ? Infinity : i;
  };
  return Object.entries(node)
    .map((entry, i) => ({ entry, i, r: rank(entry[0]) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.entry);
}

function orderedContainers(content) {
  const rank = (name) => {
    const i = CONTAINER_ORDER.indexOf(name);
    return i === -1 ? CONTAINER_ORDER.length : i;
  };
  return Object.entries(content)
    .filter(([, v]) => isObject(v))
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => rank(a.entry[0]) - rank(b.entry[0]) || a.i - b.i)
    .map((x) => x.entry);
}

function someNode(node, predicate) {
  if (!isObject(node)) return false;
  if (predicate(node)) return true;
  return Object.values(node).some((v) => isObject(v) && someNode(v, predicate));
}

/** "cm-g-promo-banner" reads "Promo Banner". */
export const baseLabel = (name) =>
  COMPONENT_LABELS[name] ||
  String(name)
    .replace(/^[a-z]{2}-g-/, '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/**
 * A section's name: the component and its headline - or, for a Static Content
 * block, its number on the page and its first heading (see blockName):
 * "Static content 3 of 8 · Showcase (script) · Energy Score".
 */
function componentLabel(resourceType, node, block) {
  if (block) return `Static content ${block.no} of ${block.of} · ${block.name.length > 40 ? `${block.name.slice(0, 39)}…` : block.name}`;
  const base = baseLabel(componentName(resourceType));

  const headline = [node.headlineText, node.desktopHeadlineText, node.contents?.desktopHeadlineText].find(
    (v) => typeof v === 'string' && v.trim()
  );
  if (!headline) return base;
  const short = headline.replace(/<[^>]*>/g, '').split(/\r?\n/)[0].trim();
  return `${base} · ${short.length > 40 ? `${short.slice(0, 39)}…` : short}`;
}

/** "03 · Text Block · …". A Static Content block goes by its own number, so it carries no second one. */
const sectionLabel = (s) => (s.no === 0 || s.block ? s.label : `${String(s.no).padStart(2, '0')} · ${s.label}`);

/** A section, short: "03 · Text Block", a Static Content block "5/8" - how a row names a place in another section. */
const placeLabel = (s) => (s.no === 0 ? s.label : s.block ? `${s.block.no}/${s.block.of}` : `${String(s.no).padStart(2, '0')} · ${baseLabel(s.component)}`);

/** "list/item1" under a component reads "Item 2". */
function fieldContext(relPath, section) {
  if (!section.relPath || !relPath.startsWith(section.relPath)) return '';
  return relPath
    .slice(section.relPath.length)
    .split('/')
    .filter(Boolean)
    .map((seg, i, segs) => {
      let m;
      // A Lineup Compare: categoryList/item0 is the first row of its table, itemList/item0 its first product.
      const list = { categoryList: 'Category', itemList: 'Product', carouselList: 'Slide' }[segs[i - 1]];
      if ((m = seg.match(/^item(\d+)$/))) return `${list || 'Item'} ${Number(m[1]) + 1}`;
      if ((m = seg.match(/^column(\d+)$/))) return `Column ${m[1]}`;
      if ((m = seg.match(/^column_m(\d+)_(\d+)$/))) return `Mobile ${m[1]}, column ${m[2]}`;
      if ((m = seg.match(/^carousel(\d+)$/))) return `Slide ${m[1]}`;
      if ((m = seg.match(/^linkAction(\d*)$/))) return `CTA ${m[1] || 1}`;
      if (/^(list|item|text|contents|image|columns|disclaimerList|linkActionMultifield|cardList|carouselList|categoryList|itemList|product|spec|setting)$/.test(seg)) return '';
      return seg;
    })
    .filter(Boolean)
    .join(' › ');
}

/* ------------------------------------------------------ text for the sheet */

const HAS_TAG = /<\/?[a-zA-Z][\w:-]*(?:[^>"']|"[^"]*"|'[^']*')*>/;
const ENTITIES = /&(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi;

/** Attributes whose value a visitor reads or hears: [name, label, group]. */
const TAG_ATTRS = [
  ['title', 'title', 'a11y'],
  ['aria-label', 'aria-label', 'a11y'],
  ['alt', 'alt text', 'alt'],
  ['placeholder', 'placeholder', 'copy']
];

/** Letters or digits once markup codes are decoded - "&nbsp;" alone is not copy. */
const hasWords = (s) => /[\p{L}\p{N}]/u.test(decodeEntities(s));

/** The group of the first words inside a tag - an image's alt is alt text - for a value that has no others. */
function tagCategory(value) {
  for (const { original } of tokenizeTags(String(value)).tokens) {
    for (const [attr, , category] of TAG_ATTRS) {
      const v = attrValue(original, attr);
      if (v !== null && hasWords(v)) return category;
    }
  }
  return null;
}

/** An attribute's value as stored in the tag, or null when the tag has none. */
function attrValue(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}
const VOID = new Set(['br', 'img', 'hr', 'input', 'wbr', 'source', 'meta', 'link']);

/**
 * How a stored value is shown to a translator.
 *
 * As it is stored: rich text with every tag written out - `<a href="…">`,
 * its link, a `title` or an `alt` inside it - for the translation team to
 * translate in place. Line breaks become real line breaks in the cell; the
 * surrounding whitespace is trimmed here and put back from the source on import.
 *
 * `placeholders` is how copy deck v1 and v2 showed it, and how the import still
 * reads a sheet made then: tags WITH attributes became numbered placeholders -
 * `<a href="…">` was `<a1>` - and the import took the tag back from AEM; tags
 * without attributes (`<sup>1</sup>`) stayed as they were.
 */
export function describe(value, { placeholders = false } = {}) {
  const text = String(value).replace(/\r\n?/g, '\n');
  const codes = [...new Set(text.match(ENTITIES) || [])];
  const html = HAS_TAG.test(text) || codes.length > 0;
  const shown = (html && placeholders ? tokenizeTags(text).text : text).trim();
  return {
    text: shown,
    format: html ? 'html' : shown.includes('\n') ? 'multiline' : 'plain',
    // Codes like &nbsp; stay as written: decoding them would make the import guess.
    tags: html && placeholders ? [...new Set([...(shown.match(TAG) || []), ...codes])] : [],
    lineBreaks: (shown.match(/\n/g) || []).length
  };
}

/**
 * Replace every tag that carries attributes with a numbered placeholder, and
 * return the originals so the same numbering can be put back. Deterministic:
 * the same value always tokenizes the same way, which is what lets the import
 * rebuild the map from AEM instead of trusting anything in the sheet.
 */
export function tokenizeTags(html) {
  const counters = {};
  const open = [];
  const tokens = [];
  const text = String(html).replace(TAG, (match, close, name, attrs) => {
    const tag = name.toLowerCase();
    if (close) {
      for (let i = open.length - 1; i >= 0; i--) {
        if (open[i].tag !== tag) continue;
        const [t] = open.splice(i, 1);
        if (!t.entry) return match;
        t.entry.closing = match; // kept as written, so putting it back changes nothing
        return `</${t.entry.token}>`;
      }
      return match;
    }
    const selfClosing = /\/\s*$/.test(attrs) || VOID.has(tag);
    if (!attrs.replace(/\/\s*$/, '').trim()) {
      if (!selfClosing) open.push({ tag, entry: null });
      return match;
    }
    counters[tag] = (counters[tag] || 0) + 1;
    const entry = { token: `${tag}${counters[tag]}`, tag, original: match, closing: null, selfClosing };
    tokens.push(entry);
    if (!selfClosing) open.push({ tag, entry });
    return selfClosing ? `<${entry.token}/>` : `<${entry.token}>`;
  });
  return { text, tokens };
}

/**
 * Put the tags back: every placeholder becomes the tag it stood for. The
 * inverse of tokenizeTags, given the same tokens - which the import rebuilds
 * from the page, never from the sheet.
 */
export function detokenize(text, tokens) {
  const byToken = new Map(tokens.map((t) => [t.token.toLowerCase(), t]));
  return String(text).replace(/<(\/?)([a-zA-Z][\w:-]*?\d+)\s*(\/?)>/g, (match, close, token) => {
    const t = byToken.get(token.toLowerCase());
    if (!t) return match;
    if (close) return t.closing ?? `</${t.original.match(/^<([^\s>/]+)/)[1]}>`;
    return t.original;
  });
}

/**
 * The text a person reads in a block of raw HTML: text between tags, and the
 * attributes a screen reader or a button shows. Styles and scripts are skipped -
 * except their human-readable strings, which are listed for a developer, since
 * they cannot be changed safely without reading the code around them.
 *
 * How copy deck v1 to v3 cut static HTML - a sentence with a link in it was
 * three pieces - kept so a sheet made then still imports. The export reads it
 * whole-sentence now: see static-content.js.
 */
export function segmentStaticHtml(html) {
  const out = [];
  const push = (text, label) => {
    const t = decodeEntities(text).replace(/\s+/g, ' ').trim();
    if (t && /\p{L}/u.test(t)) out.push({ text: t, label });
  };
  let lastTag = '';
  const re = /<!--[\s\S]*?-->|<![^>]*>|<(script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>|<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const [all, blockName, body, tag, attrs] = m;
    const block = blockName?.toLowerCase();
    if (all.startsWith('<!')) continue;
    if (block === 'style') {
      for (const s of body.matchAll(/content\s*:\s*(["'])((?:(?!\1).)*)\1/g)) push(s[2], 'CSS text (developer)');
    } else if (block === 'script') {
      for (const s of body.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
        const v = s[1] ?? s[2];
        if (/\s/.test(v.trim()) && !/^[.#/]|^https?:|=>/.test(v.trim())) push(v, 'Script text (developer)');
      }
    } else if (tag) {
      if (all.startsWith('</')) continue;
      lastTag = tag.toLowerCase();
      for (const [n, label] of [['title', 'Title'], ['aria-label', 'aria-label'], ['alt', 'Alt text'], ['placeholder', 'Placeholder']]) {
        const v = attrValue(all, n);
        if (v !== null) push(v, label);
      }
      if (lastTag === 'input' && /type\s*=\s*["']?(submit|button)/i.test(attrs)) {
        const v = attrValue(all, 'value');
        if (v !== null) push(v, 'Button value');
      }
    } else if (all !== '<') {
      push(all, lastTag ? `Text <${lastTag}>` : 'Text');
    }
  }
  return out;
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

export function decodeEntities(s) {
  return String(s).replace(ENTITIES, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      // Out of Unicode's range (a typo like &#x1F4B0000;) stays as written rather than throwing.
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/**
 * A fingerprint of the stored value, so the import can tell whether the page
 * still says what was sent for translation. FNV-1a over the NFC form with line
 * endings normalised, as eight hex digits behind an "h": a leading letter keeps
 * Excel from reading the cell as a number and rewriting it.
 */
export function sourceHash(value) {
  const s = String(value).normalize('NFC').replace(/\r\n?/g, '\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `h${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/* ----------------------------------------------------------------- sheet */

/** Rows in the groups asked for; values not shown on the page only when asked for too. */
export function selectRows(rows, { categories, includeInactive = false } = {}) {
  const want = categories ? new Set(categories) : null;
  return rows.filter((r) => (!want || want.has(r.category)) && (includeInactive || !r.inactive));
}

/** The most places one row takes. Past it the text starts a new row, so a Key cell stays far inside Excel's 32,767 characters. */
const MAX_PLACES = 100;

/**
 * The sheet's rows: every place a text appears goes on one row, at the first
 * of them, in page order. One translation then goes to all of them - a place
 * that needs other words is changed in AEM afterwards. Static content too,
 * across blocks and with the page's other rows: it is put on the page by hand,
 * but with the same one translation. Each entry is the first place's row, with
 * `places` listing all of them. A Key is one place: a second row with it -
 * which the export never makes - is left out, never put on the sheet twice.
 */
export function mergeRows(rows) {
  const out = [];
  const bySource = new Map();
  const keys = new Set();
  for (const r of rows) {
    if (keys.has(r.key)) continue;
    keys.add(r.key);
    const same = bySource.get(r.source);
    if (same && same.places.length < MAX_PLACES) {
      same.places.push(r);
      if (r.added) same.added = true;
      if (!r.inactive) same.inactive = null;
      continue;
    }
    const entry = { ...r, places: [r] };
    bySource.set(r.source, entry);
    out.push(entry);
  }
  return out;
}

/**
 * Where the places of a row are: each on its own line, with its section when
 * they are not all in one. A row of static content can hold several places of
 * its block already, a line each.
 */
function placesField(entry) {
  const { places } = entry;
  if (places.length === 1) return entry.field;
  const oneSection = places.every((p) => p.sectionNo === entry.sectionNo);
  return places.flatMap((p) => p.field.split('\n').map((line) => (oneSection || !p.place ? line : `${p.place} › ${line}`))).join('\n');
}

/** How many places a row covers: a row of static content can cover several in its block. */
const placeCount = (places) => places.reduce((n, p) => n + (p.count || 1), 0);

/**
 * The sheet as a grid of strings: header, one record per text (see mergeRows),
 * and a closing `#meta` record that carries the page and the row count. The
 * import uses that last record to notice a sheet that came back short - a
 * filter left on, a paste that stopped at a blank row. The Key and Check cells
 * of a text used in several places hold one line per place. `pd` marks the
 * sheet of a product page, whose translations go into PIM rather than back
 * through an import.
 */
export function buildSheet(rows, { pagePath = '', exportedAt = '', pd = false } = {}) {
  const entries = mergeRows(rows);
  const rowOfKey = new Map();
  entries.forEach((e, i) => e.places.forEach((p) => rowOfKey.set(p.key, i + 2)));

  const records = entries.map((e, i) => {
    const excelRow = i + 2;
    const { places } = e;
    const notes = [];
    const total = placeCount(places);
    if (total > 1) notes.push(`Used in ${total} places - one translation for all of them`);
    const hidden = places.filter((p) => p.inactive);
    if (hidden.length === places.length) notes.push(`Not shown on the page: ${places[0].inactive}`);
    else if (hidden.length) notes.push(`Not shown on the page in ${placeCount(hidden)} of the ${total} places`);
    // Static content is put on the page by hand: the markup by the web team, a script's strings by a developer.
    const byHand = places.filter((p) => p.format === 'manual');
    if (byHand.some((p) => p.prop !== 'footerInclude')) notes.push('Static content - the web team puts this on the page');
    if (byHand.some((p) => p.prop === 'footerInclude')) notes.push('Static content in the script - a developer puts this in');
    if (places.length > 1 && places.some((p) => p.attr)) {
      notes.push('Words only - no markup');
    } else if (e.attr) {
      // The text the tag sits in is on its own row: the one above, usually - unless that text was merged into an earlier row.
      const textRow = e.attrOnly ? null : rowOfKey.get(e.key.split('~')[0]);
      const where = !textRow ? ' - the text around it is not on the sheet' : textRow === excelRow - 1 ? ' in the text above' : ` in the text of row ${textRow}`;
      notes.push(`The ${e.attr.name} of <${e.attr.token}>${where} - words only`);
    }
    if (e.tags?.length) notes.push(`Keep as written: ${e.tags.join(' ')}`);
    else if (e.format === 'html') notes.push('HTML - translate the words, and any title or alt text; keep every tag complete');
    if (e.lineBreaks) notes.push(`${e.lineBreaks} line break${e.lineBreaks === 1 ? '' : 's'} - keep or move`);
    const limits = [...new Set(places.map((p) => p.limit).filter(Boolean))];
    if (limits.length) notes.push(`Length: ${limits.join(' / ')}`);
    /* What static content says about its text - a tag rule, its numbers - is
     * said once for all its places; what it says about a place - a hidden tab,
     * an overlay, a short label - says how many of the places it is about,
     * when it is not all of them. */
    const hints = new Set(byHand.flatMap((p) => (p.placeNotes || []).flat()));
    const own = byHand.length ? [...new Set(byHand.flatMap((p) => p.notes || []))].filter((n) => !hints.has(n)) : e.notes || [];
    notes.push(...own);
    for (const hint of hints) {
      const n = byHand.reduce((sum, p) => sum + (p.placeNotes || []).filter((h) => h.includes(hint)).length, 0);
      notes.push(n < total ? `${hint} (${n} of the ${total} places)` : hint);
    }
    return [
      e.section,
      placesField(e),
      notes.join(' · '),
      places.map((p) => p.key).join('\n'),
      places.map((p) => p.hash).join('\n'),
      e.source,
      ''
    ];
  });

  const checksum = sourceHash(entries.flatMap((e) => e.places.map((p) => p.key)).join('\n'));
  records.push([
    '#END - keep this row, it tells the import the sheet is complete',
    pagePath,
    `rows=${entries.length} · exported ${exportedAt} · copy deck v${SHEET_VERSION}${pd ? ' · product page: text from PIM, translations go into PIM' : ''}`,
    '#meta',
    checksum,
    '',
    ''
  ]);
  return { columns: SHEET_COLUMNS, records };
}

/**
 * In plain text, a cell Excel would read as a formula (= + - @) is prefixed
 * with an apostrophe, so it is shown as text instead of evaluated. Only there:
 * the workbook and the HTML table mark their cells as text already, where an
 * apostrophe would simply show.
 */
const excelSafe = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

const csvCell = (v) => `"${excelSafe(String(v)).replace(/"/g, '""')}"`;

/** Excel's limit for one cell: longer, and Excel cuts the cell short or calls the file damaged. */
const MAX_CELL = 32767;

/** "A" for the first column, "AA" for the 27th - as Excel names them. */
export const columnLetter = (i) => (i >= 26 ? columnLetter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

/**
 * A cell Excel cannot hold is refused, never handed over to be cut short -
 * by the workbook, the CSV and the clipboard alike, in the same words. Each
 * cell is measured as `written` writes it: in plain text, with the apostrophe
 * excelSafe may put before it.
 */
export function assertCellsFit(sheet, written = (v) => String(v ?? '')) {
  [sheet.columns, ...sheet.records].forEach((record, r) =>
    record.forEach((v, c) => {
      const n = written(v).length;
      if (n > MAX_CELL) throw new Error(`Cell ${columnLetter(c)}${r + 1} is longer than Excel allows (${n} characters).`);
    })
  );
}

/** UTF-8 with a BOM, every cell quoted, CRLF between records. */
export function toCsv(sheet) {
  assertCellsFit(sheet, (v) => excelSafe(String(v)));
  const lines = [sheet.columns, ...sheet.records].map((r) => r.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Tab-separated, the clipboard's plain-text form. Quoted only where a cell needs it. */
export function toTsv(sheet) {
  assertCellsFit(sheet, (v) => excelSafe(String(v)));
  const cell = (v) => {
    const s = excelSafe(String(v));
    return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [sheet.columns, ...sheet.records].map((r) => r.map(cell).join('\t')).join('\r\n');
}

/**
 * The clipboard's HTML form. Excel pastes an HTML table cell for cell, and two
 * Office styles make it behave: `mso-number-format:\@` makes every cell text -
 * so "1/2" is never turned into a date, including what translators type later -
 * and `mso-data-placement:same-cell` keeps a line break inside its cell.
 */
export function toHtmlTable(sheet) {
  assertCellsFit(sheet);
  const esc = (v) =>
    String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br style="mso-data-placement:same-cell">');
  const td = (tag, v) => `<${tag} style="mso-number-format:'\\@';vertical-align:top">${esc(v)}</${tag}>`;
  const tr = (cells, tag) => `<tr>${cells.map((c) => td(tag, c)).join('')}</tr>`;
  return (
    '<html><head><meta charset="utf-8"></head><body><table>' +
    tr(sheet.columns, 'th') +
    sheet.records.map((r) => tr(r, 'td')).join('') +
    '</table></body></html>'
  );
}

/** copydeck_za_tvs_20260927-1430.xlsx - site and page, then when. */
export function fileName(pagePath, date = new Date(), ext = 'xlsx') {
  const segs = String(pagePath).split('/').filter(Boolean);
  const site = segs[2] || 'page';
  const page = segs.slice(3).join('-') || 'home';
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `copydeck_${site}_${page}_${stamp}.${ext}`.replace(/[^\w.-]+/g, '-');
}

/** Rows per group, counting only what is shown on the page unless asked otherwise. */
export function countByCategory(rows, { includeInactive = false } = {}) {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
  for (const r of rows) if (includeInactive || !r.inactive) counts[r.category] = (counts[r.category] || 0) + 1;
  return counts;
}

/* ================================================================ import */

/*
 * The translated sheet comes back, and every row is checked against the page
 * as it is NOW - not as it was at export. Nothing here writes. It works out
 * what a write would do, property by property, and why anything is left out,
 * so the operator reads that before anything reaches AEM.
 *
 * The sheet is trusted for two things only: which property a row is for (Key)
 * and what the translator typed (Translation). Everything else - the stored
 * value, its format, the URLs behind <a1> - is read from the page again.
 */

/** What each outcome means, and which heading it is listed under. */
export const IMPORT_STATUS = {
  ready: { label: 'Ready to write', group: 'write' },
  reuse: { label: 'Uses a repeat’s translation', group: 'write' },
  manual: { label: 'Apply by hand', group: 'manual' },
  already: { label: 'Already translated', group: 'skip' },
  same: { label: 'Same as the source', group: 'skip' },
  untranslated: { label: 'Not translated', group: 'skip' },
  changed: { label: 'Page changed since export', group: 'blocked' },
  missing: { label: 'Not on this page', group: 'blocked' },
  notFound: { label: 'Not found in the block', group: 'blocked' },
  invalid: { label: 'Needs fixing', group: 'blocked' },
  duplicate: { label: 'Row repeated', group: 'blocked' }
};

/** A file the corporate DRM has encrypted on disk: its bytes are not the sheet. */
export function isDrmProtected(bytes) {
  const head = String.fromCharCode(...bytes.subarray(0, 24));
  return head.startsWith('<## NASCA DRM FILE');
}

/**
 * Delimited text into rows of cells: Excel's clipboard (tab) or a CSV (',' or
 * ';', whichever the translator's Excel saved with).
 *
 * `excel` is the clipboard's own rule: Excel puts quotes around a cell only when
 * it holds a line break or a tab. A cell that merely starts with a quote - a
 * quoted testimonial - comes through bare, and must not lose its quotes.
 */
export function parseDelimited(text, { delimiter = '\t', excel = false } = {}) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let i = 0;
  const bare = (from) => {
    let j = from;
    while (j < s.length && s[j] !== delimiter && s[j] !== '\n' && s[j] !== '\r') j++;
    return j;
  };
  while (i < s.length) {
    let value = null;
    if (s[i] === '"') {
      let j = i + 1;
      let v = '';
      let closed = false;
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          j++;
          closed = true;
          break;
        }
        v += s[j++];
      }
      const endsCell = j >= s.length || s[j] === delimiter || s[j] === '\n' || s[j] === '\r';
      if (closed && endsCell && (!excel || /[\n\r\t]/.test(v))) {
        value = v;
        i = j;
      }
    }
    if (value === null) {
      const j = bare(i);
      value = s.slice(i, j);
      i = j;
    }
    row.push(value);
    if (i >= s.length) break;
    if (s[i] === delimiter) {
      i++;
      if (i >= s.length) row.push('');
      continue;
    }
    i += s[i] === '\r' && s[i + 1] === '\n' ? 2 : 1;
    rows.push(row);
    row = [];
  }
  if (row.length) rows.push(row);
  return rows;
}

/** Tab, ';' or ',' - counted on the first line, outside quotes. */
export function detectDelimiter(text) {
  const first = String(text).replace(/^﻿/, '').split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
  const count = (c) => first.split(c).length - 1;
  if (count('\t')) return '\t';
  return count(';') > count(',') ? ';' : ',';
}

/** Pasted text or a CSV file, into rows of cells. */
export function gridFromText(text) {
  const delimiter = detectDelimiter(text);
  return parseDelimited(text, { delimiter, excel: delimiter === '\t' });
}

const HEADERS = {
  section: /^section/i,
  field: /^field/i,
  notes: /^notes/i,
  key: /^key/i,
  check: /^check/i,
  source: /^source/i,
  translation: /^translation/i
};

/** The columns whose cells decide what is written: never guessed between two candidates. */
const DECISIVE = new Set(['key', 'check', 'translation']);

/**
 * Where each column is. The exported header, exactly, wins. Otherwise a header
 * that starts the same way - but only if it is the only one: an agency's added
 * "Translation notes" or "Translation status" column must never be read as the
 * translation. Two candidates for a column that decides what is written is a
 * question for a person, not a guess.
 */
function locateColumns(header) {
  const col = {};
  for (const [k, re] of Object.entries(HEADERS)) {
    const exported = SHEET_COLUMNS.find((c) => re.test(c)).toLowerCase();
    const exact = header.findIndex((h) => h.toLowerCase() === exported);
    if (exact !== -1) {
      col[k] = exact;
      continue;
    }
    const like = header.map((h, i) => (re.test(h) ? i : -1)).filter((i) => i !== -1);
    if (like.length > 1 && DECISIVE.has(k)) {
      return {
        problem: `More than one column could be "${SHEET_COLUMNS.find((c) => re.test(c))}": ${like.map((i) => `"${header[i]}"`).join(', ')}. Rename or remove the extra one and paste again.`
      };
    }
    col[k] = like.length ? like[0] : -1;
  }
  return { col };
}

/**
 * Rows of cells into sheet rows, by header name - never by position, so a
 * column the translator inserted or moved does not shift anything. The
 * closing #meta row is read separately: it says how many rows there should be.
 */
export function readSheet(grid) {
  const cell = (v) => String(v ?? '');
  const at = grid
    .slice(0, 10)
    .findIndex((r) => r.some((c) => HEADERS.key.test(cell(c).trim())) && r.some((c) => HEADERS.translation.test(cell(c).trim())));
  if (at === -1) {
    return {
      ok: false,
      problem: 'No header row with Key and Translation columns. Copy the whole sheet, header included (Ctrl+A, then Ctrl+C).',
      rows: [],
      meta: null
    };
  }
  const header = grid[at].map((c) => cell(c).trim());
  const located = locateColumns(header);
  if (located.problem) return { ok: false, problem: located.problem, rows: [], meta: null };
  const { col } = located;
  if (col.check === -1) {
    return {
      ok: false,
      problem: 'The Check column is missing, so there is no way to tell whether the page changed since the export.',
      rows: [],
      meta: null
    };
  }

  const rows = [];
  let meta = null;
  for (let i = at + 1; i < grid.length; i++) {
    const cells = grid[i];
    if (!cells.some((c) => cell(c).trim())) continue;
    const get = (k) => (col[k] === -1 ? '' : cell(cells[col[k]]));
    const key = get('key').trim();
    if (key === '#meta') {
      const n = get('notes').match(/rows=(\d+)/);
      // The version wherever the row has it, in any case: a Notes column renamed must not hide a newer sheet.
      const v = cells.map(cell).join('\n').match(/copy deck\s+v(\d+)/i);
      meta = { pagePath: get('field').trim(), rows: n ? Number(n[1]) : null, version: v ? Number(v[1]) : null, sheetRow: i + 1 };
      continue;
    }
    // A text used in several places: one Key and one Check per line, in the same order.
    const lines = (s) => s.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
    const keys = lines(key);
    const checks = lines(get('check'));
    rows.push({
      sheetRow: i + 1,
      key: keys[0] ?? '',
      keys: keys.length ? keys : [''],
      check: checks[0] ?? '',
      checks,
      section: get('section').trim(),
      source: get('source'),
      translation: get('translation')
    });
  }
  /* A sheet a newer DSY made, as its #END row says, may hold keys or cells this
   * one would read wrongly - and a row read wrongly could be written wrongly.
   * Refused whole, before a single row is checked. */
  if (meta?.version > SHEET_VERSION) {
    return { ok: false, problem: 'This sheet was made by a newer version of DSY - update DSY, then import again.', rows: [], meta };
  }
  return { ok: true, problem: null, rows, meta };
}

/** What the translator typed, made comparable: line endings, Unicode form, the edges. */
const cleanText = (s) =>
  String(s ?? '')
    .replace(/﻿/g, '')
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
    .trim();

const EXCEL_ERROR = /^#(NAME\?|VALUE!|REF!|DIV\/0!|N\/A|NUM!|NULL!|SPILL!|CALC!)$/;
/* Text saved in the wrong encoding: U+FFFD, or UTF-8 read as Windows-1252 ("Ã©", "â€™", "Â "). */
const MOJIBAKE = /�|Ã[\u0080-¿]|â€.|Â[ -¿]/;
/* SVG's animate and set can turn a link into a script, one value at a time. */
const DANGEROUS = /^(script|style|iframe|object|embed|form|input|link|meta|base|animate|set)$/i;

/** Is this translation safe to write into this property? Errors block; warnings are shown. */
function validate(pageRow, text) {
  const warnings = [];
  if (EXCEL_ERROR.test(text)) return { error: `The cell holds an Excel error (${text}), not a translation.` };
  if (MOJIBAKE.test(text)) {
    return { error: 'Some characters were lost or garbled - the file was probably saved in the wrong encoding. Save it as .xlsx and paste again.' };
  }

  if (pageRow.format === 'html') {
    const tokens = new Map(tokenizeTags(pageRow.value).tokens.map((t) => [t.token.toLowerCase(), t]));
    const seen = new Map();
    const literal = [];
    for (const m of text.matchAll(TAG)) {
      const [, close, name, attrs] = m;
      const t = tokens.get(name.toLowerCase());
      if (t) {
        /* A placeholder stays bare. <a1 title="…"> is not put back as the link -
         * it would be written as it stands, the link lost, and whatever was added
         * (an onmouseover, say) kept. */
        if (attrs.replace(/\/\s*$/, '').trim()) {
          return { error: `Placeholders must stay exactly as they are: ${m[0].slice(0, 50)} has something added. Use <${t.token}> alone.` };
        }
        const k = `${close ? '/' : ''}${t.token}`;
        seen.set(k, (seen.get(k) || 0) + 1);
        continue;
      }
      if (DANGEROUS.test(name)) return { error: `<${name}> is not allowed in a translation.` };
      // <a3> where the source has only <a1>: a placeholder that stands for nothing.
      // Compared on the real tag, so a plain <h3> next to an <h2 class> (token h21) is fine.
      const lower = name.toLowerCase();
      const invented = [...tokens.values()].some((x) => lower.length > x.tag.length && lower.startsWith(x.tag) && /^\d+$/.test(lower.slice(x.tag.length)));
      if (invented) {
        return { error: `<${close ? '/' : ''}${name}> is not in the source - keep the placeholders as they are.` };
      }
      if (attrs.replace(/\/\s*$/, '').trim()) {
        return { error: `New markup with attributes (${m[0].slice(0, 40)}) is not allowed - only the placeholders from the source, like <a1>.` };
      }
      literal.push(m[0].toLowerCase().replace(/\s+/g, ''));
    }
    for (const t of tokens.values()) {
      const opens = seen.get(t.token) || 0;
      const closes = seen.get(`/${t.token}`) || 0;
      const wantClose = t.selfClosing ? 0 : 1;
      if (opens !== 1 || closes !== wantClose) {
        const shape = t.selfClosing ? `<${t.token}/>` : `<${t.token}>…</${t.token}>`;
        return { error: `${shape} must appear exactly once, as in the source (found ${opens}${wantClose ? ` and ${closes} closing` : ''}).` };
      }
    }
    const sourceLiteral = [...pageRow.source.matchAll(TAG)]
      .filter((m) => !tokens.has(m[2].toLowerCase()))
      .map((m) => m[0].toLowerCase().replace(/\s+/g, ''));
    if (literal.slice().sort().join() !== sourceLiteral.slice().sort().join()) {
      warnings.push(`Tags differ from the source (source: ${sourceLiteral.join(' ') || 'none'}; translation: ${literal.join(' ') || 'none'}).`);
    }
  } else if (HAS_TAG.test(text)) {
    return { error: 'This field is plain text - remove the markup from the translation.' };
  }

  if (text.length > Math.max(60, pageRow.source.length * 3)) {
    warnings.push(`Much longer than the source (${text.length} characters, source ${pageRow.source.length}) - check it fits.`);
  }
  return { error: null, warnings };
}

/** Every link a value points at, in order. */
const linksIn = (s) => [...String(s).matchAll(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)].map((m) => m[1] ?? m[2] ?? m[3]);

/** The country of a site token: levant_ar -> levant, ae -> ae. */
const countryOf = (token) => String(token).replace(/^\//, '').split('_')[0];

/**
 * A link the translator kept from another site's page - "/levant/…" where this
 * page links "/levant_ar/…" - put back as the page's own. Three kinds are: a
 * link to the site the sheet was exported from (`from`) - /uk on a sheet of a
 * /uk page imported into /fr, after Sync page copied it there; a link that,
 * with its first folder swapped for this page's site, is one the page already
 * has; and any link to the same country in another language - /levant on a
 * levant_ar page, /ae on ae_ar. Any other site's link stays as typed, for
 * validateHtml to point out; so does a link the page itself has as it is.
 * Written out in full on www.samsung.com or shop.samsung.com the same, the
 * host kept as typed.
 */
function ownSiteLinks(value, text, site, from = null) {
  const own = new Set(linksIn(value));
  const fixed = [];
  if (!site) return { text, fixed };
  const LINK = /(\shref\s*=\s*)(["'])((?:https?:\/\/(?:www|shop)\.samsung\.com)?)(\/[^/"'?#]+)([^"']*)\2/gi;
  const out = text.replace(LINK, (m, pre, q, host, first, rest) => {
    const href = host + first + rest;
    const mine = `${host}/${site}${rest}`;
    const sister = (first === `/${from}` || countryOf(first) === countryOf(site)) && rest.startsWith('/');
    if (own.has(href) || first === `/${site}` || !(own.has(mine) || sister)) return m;
    fixed.push(`${href} → ${mine}`);
    return `${pre}${q}${mine}${q}`;
  });
  return { text: out, fixed };
}

/**
 * Spaces at the start of a line the source does not have there - a line break
 * typed as "\n " in Excel. Each line takes the source's own indent, line for
 * line; with the lines not matching, only a line left blank is emptied.
 */
function sourceIndents(source, text) {
  if (!/\n/.test(text)) return text;
  const lines = text.split('\n');
  const src = String(source).split(/\r\n|\r|\n/);
  const indent = (l) => l.match(/^[ \t]*/)[0];
  return lines
    .map((l, i) => {
      if (!l.trim()) return '';
      if (i === 0 || lines.length !== src.length) return l;
      return indent(src[i]) + l.slice(indent(l).length);
    })
    .join('\n');
}

/** Page properties that name the site: the share titles end with it, the descriptions may mention it. */
const SITE_NAMED = ['jcr:title', 'ogTitle', 'twitterTitle', 'description', 'ogDescription', 'twitterDescription', 'keywords'];
const ENDING_OF = (s) => String(s ?? '').match(/\|([^|]*\S[^|]*)$/)?.[1].trim() ?? null;
/** The words of a title ending, marks and "Samsung" left out: "‏Samsung الأردن" -> ["الأردن"]. */
const placeWords = (ending) =>
  ending
    .replace(/[‎‏؜]/g, '')
    .split(/\s+/)
    .filter((w) => w && !/^(samsung|سامسونج)$/i.test(w));

/** The tags of a value by name, attributes left out: "<a> </a> <br>". */
const tagNames = (s) => [...String(s).matchAll(TAG)].map((m) => `<${m[1]}${m[2].toLowerCase()}>`);

/** An attribute that runs a script - after a space, and after a "/" or a closing quote too: <svg/onload=…>, <img src="x"onerror=…>. */
const HANDLER = /[\s/"']on[a-z]+\s*=/i;
/** A value that links to a script, with whatever spaces or control characters a browser skips before it. */
const SCRIPT_LINK = /=\s*["']?[\u0000-\u0020]*(javascript|vbscript):/i;
/** Codes a browser decodes in a value that can spell out a link's scheme: "&colon;", "&Tab;". */
const LINK_CODES = { ...NAMED, colon: ':', tab: '\t', newline: '\n' };

/**
 * A value the way a browser reads it: its tags and comments (`markup`) and the
 * text between them, in order. A tag never closed, or with a quote left open,
 * makes the rest of the value markup: a browser reads on until something
 * closes it.
 */
const MARKUP = /<!--[\s\S]*?(?:-->|$)|<[!?][^>]*(?:>|$)|<\/?[a-zA-Z][\w:-]*(?:[^>"']|"[^"]*"|'[^']*')*>|<\/?[a-zA-Z][\s\S]*$|[^<]+|</g;
const markupParts = (s) => [...String(s).matchAll(MARKUP)].map((m) => ({ part: m[0], markup: m[0].length > 1 && m[0][0] === '<' }));

/**
 * Text the way a browser follows it as a link: codes decoded - "&#106;", and
 * "&#106" without its ";" too - and the tabs and line breaks a link loses
 * taken out, so "&#106;ava&#9;script:" reads "javascript:".
 */
const asLink = (s) =>
  String(s)
    .replace(/&#(?:x([\da-f]+)|(\d+));?|&([a-z]+);/gi, (m, hex, dec, name) => {
      if (name) return LINK_CODES[name.toLowerCase()] ?? m;
      const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD';
    })
    .replace(/[\t\n\r]/g, '');

/**
 * A quote that may close the attribute a text is put into. An apostrophe in a
 * word - l'offre, Samsung's - closes only an attribute in single quotes: so it
 * counts only where the text goes into one, or may - a piece of a sheet made
 * before v4, put in by hand wherever it goes (see refusal).
 */
const CLOSING_QUOTE = /"|(?<!\p{L})'|'(?!\p{L})/u;

/**
 * What no translation may be, whatever it goes into: an Excel error, garbled
 * characters, a script, or code that runs on a click or a hover. The reason,
 * or null. `pageRow.unquoted` is a text put into an attribute stored without
 * quotes, where a space is enough to start an attribute of its own;
 * `pageRow.singleQuoted` one put into an attribute in single quotes.
 */
function refusal(pageRow, text) {
  if (EXCEL_ERROR.test(text)) return `The cell holds an Excel error (${text}), not a translation.`;
  if (MOJIBAKE.test(text)) {
    return 'Some characters were lost or garbled - the file was probably saved in the wrong encoding. Save it as .xlsx and paste again.';
  }
  /* A tag the source already has, exactly as it is there - an embedded video,
   * say - is the page's own. The rest is read the way a browser reads it (see
   * markupParts): in a tag or a comment, or after one left open, a script is a
   * script however it is written. Plain text is words - "bestel online = 10%
   * korting", "= JavaScript:", "l'offre online = -10%" - up to its first quote
   * that may close the attribute the text is put into (see CLOSING_QUOTE), so
   * that all after it could be attributes of their own - `aan" x=1
   * onmouseover="…` - and is read as strictly as a tag. In an attribute stored
   * without quotes, all of it is. */
  const own = new Set([...String(pageRow.value).matchAll(TAG)].map((m) => m[0]));
  /** Where a match is, as the operator can find it: the tag it is in, or the text just before it. */
  const near = (s, i) => {
    const from = Math.max(s.lastIndexOf('<', i), i - 30, 0);
    const to = s.indexOf('>', i);
    return s.slice(from, to === -1 ? undefined : to + 1).slice(0, 60).trim();
  };
  for (const { part, markup } of markupParts(text)) {
    if (markup && own.has(part)) continue;
    if (markup) {
      for (const [, name] of part.matchAll(/<\/?([a-zA-Z][^\s/>]*)/g)) {
        if (DANGEROUS.test(name)) return `<${name}> is not allowed in a translation.`;
      }
    }
    const quote = markup || pageRow.unquoted ? 0 : part.search(pageRow.piece || pageRow.singleQuoted ? /["']/ : CLOSING_QUOTE);
    if (quote === -1) continue;
    const strict = part.slice(quote);
    const handler = strict.search(HANDLER);
    if (handler !== -1) return `${near(strict, handler)} runs a script (on…=) - not allowed in a translation.`;
    const followed = asLink(strict);
    const link = followed.search(SCRIPT_LINK);
    if (link !== -1) return `${near(followed, link)} links to a script - not allowed in a translation.`;
  }
  return null;
}

/**
 * Is a rich-text translation safe to write, written out in full (copy deck v3)?
 * The translation team looks after the HTML, so tags and links are theirs to
 * set - but never a script, nor code that runs on a click or a hover. What
 * differs from the source - another link, a tag left open - is shown to the
 * operator to look at before writing, never blocked.
 */
function validateHtml(pageRow, text) {
  const warnings = [];
  const refused = refusal(pageRow, text);
  if (refused) return { error: refused };

  const was = linksIn(pageRow.value);
  const now = linksIn(text);
  if (was.slice().sort().join('\n') !== now.slice().sort().join('\n')) {
    warnings.push(`Links differ from the source (source: ${was.join(', ') || 'none'}; translation: ${now.join(', ') || 'none'}).`);
  }
  const shape = (s) => tagNames(s).sort().join(' ');
  if (shape(text) !== shape(pageRow.source)) {
    warnings.push(`Tags differ from the source (source: ${tagNames(pageRow.source).join(' ') || 'none'}; translation: ${tagNames(text).join(' ') || 'none'}).`);
  }
  const open = new Map();
  for (const m of text.matchAll(TAG)) {
    const name = m[2].toLowerCase();
    if (VOID.has(name) || /\/\s*$/.test(m[3])) continue;
    open.set(name, (open.get(name) || 0) + (m[1] ? -1 : 1));
  }
  const unclosed = [...open].filter(([, n]) => n !== 0).map(([name]) => `<${name}>`);
  if (unclosed.length) warnings.push(`Not closed as often as opened: ${unclosed.join(' ')} - check the tags.`);

  if (text.length > Math.max(60, pageRow.source.length * 3)) {
    warnings.push(`Much longer than the source (${text.length} characters, source ${pageRow.source.length}) - check it fits.`);
  }
  return { error: null, warnings };
}

/** Does a translation use the placeholders of a sheet made before v3 - <a1>, </a1>, <img1/> - for this value? */
function usesPlaceholders(value, text) {
  const names = tokenizeTags(value).tokens.map((t) => t.token.replace(/[^\w:-]/g, ''));
  return names.length > 0 && new RegExp(`</?(${names.join('|')})\\s*/?>`, 'i').test(text);
}

/**
 * Rewrite one attribute of a tag, keeping the rest of the tag exactly as it was.
 * An `&` that already starts a reference (&trade;, &#8482;) stays one - the
 * translator saw it as written and kept it; escaping it again would put the
 * literal text "&trade;" on the page.
 */
function setAttr(tag, name, text) {
  const escaped = text
    .replace(/&(?!#\d+;|#x[\da-f]+;|[a-z][a-z\d]*;)/gi, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const re = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s"'>]+)`, 'i');
  return tag.replace(re, (m, pre) => `${pre}"${escaped}"`);
}

/**
 * The value to store: the translation, with the source's edges put back - and,
 * where it used placeholders (`tokens`, a sheet made before v3), the source's
 * tags. Written out in full, the translation's own tags are the value.
 */
function compose(pageRow, text, tokens) {
  const original = pageRow.value;
  const body = pageRow.format === 'html' && tokens ? detokenize(text, tokens) : text;
  return original.match(/^\s*/)[0] + body + original.match(/\s*$/)[0];
}

/**
 * Line breaks as AEM will store them. A write is a multipart POST, and the
 * multipart encoder turns every line break into CRLF on the way - so the plan
 * says CRLF too. What is reviewed, fingerprinted and read back is then exactly
 * what lands, and one break is one CRLF however it arrived (\n, \r, \r\n).
 */
const asStored = (v) => (typeof v === 'string' ? v.replace(/\r\n|\r|\n/g, '\r\n') : v);

const nodeAt = (content, path) =>
  path ? path.split('/').reduce((n, s) => (n && typeof n === 'object' ? n[s] : undefined), content) : content;

/** The component a node belongs to, as the export sees it: the nearest one at or above it; the page's own for the page. */
function componentAt(content, path) {
  if (!path) return componentName(content['sling:resourceType']) || 'page';
  let node = content;
  let name = null;
  for (const seg of path.split('/')) {
    node = isObject(node) ? node[seg] : undefined;
    if (!isObject(node)) return null;
    const type = node['sling:resourceType'];
    if (type && !LAYOUT_CONTAINER.test(type)) name = componentName(type);
  }
  return name;
}

/**
 * The node and the property a Key names, in every form the export makes one:
 * "…@prop", a value of a multi-value "…@prop[1]", a text of static content
 * "…@bodyHtml#hb11688fa" or "…@footerInclude#hd517a63a", a piece of static
 * HTML on a sheet made before v4 "…@bodyHtml#03", a tag's words on a sheet
 * made before v3 "…@prop~a1.title".
 */
function keyField(key) {
  const m = String(key).match(/^(.*)@([^@[\]#~]+)(?:\[\d+\])?(?:#\d+|#h[\da-f]{8}|~[\w:-]+\.[\w-]+)?$/);
  return m ? { path: m[1] === '.' ? '' : m[1], prop: m[2] } : null;
}

const STATIC_REFUSED = 'Static HTML is applied by hand - the import never writes it.';

/**
 * Why the import never writes a property, or null: static HTML and a Static
 * Content block's code are applied by hand. `prepared` - DSY made and checked
 * the block's new value, and its section is ticked on the review - lets a
 * Static Content block's Body (HTML) or Footer (JavaScript) be written, and
 * nothing else of static HTML: never its Header (CSS).
 */
function neverWrittenReason(component, prop, { prepared = false } = {}) {
  if (prepared && component === STATIC_CONTENT && (prop === 'bodyHtml' || prop === 'footerInclude')) return null;
  if (isCodeField(component, prop)) return CODE_REFUSED;
  if (STATIC_HTML_PROPS.includes(prop)) return STATIC_REFUSED;
  return null;
}

/** A row with no translation whose Source cell was changed. */
const MOVED = 'The Source text cell was changed and Translation is empty - was the translation typed into the wrong column?';

/**
 * Fields the sheet has rows for that the rules do not know - fields added from
 * the "not on the sheet" list when it was exported, on whoever's machine that
 * was. The row's Key names the node and the property, so the import needs no
 * settings to read them: each becomes a field for this check, and the page is
 * read again with it. Never a system property or an analytics value, never a
 * Static Content block's code (planImport refuses its row), never a node the
 * page does not have, never a value that is a path or a link - and the Check
 * must still match, like every other row.
 */
function fieldsFromSheet(content, places, known) {
  const add = [];
  for (const r of places) {
    if (!r.key || known.has(r.key)) continue;
    const field = keyField(r.key);
    // Static HTML is read whatever the settings, whole or in pieces: nothing to add for it.
    if (!field || !fieldAllowed(field.prop) || STATIC_HTML_PROPS.includes(field.prop)) continue;
    const stored = nodeAt(content, field.path)?.[field.prop];
    const text = (Array.isArray(stored) ? stored : [stored]).some((v) => typeof v === 'string');
    // Which values become rows - never a path or a link - is decided where the export decides it,
    // value by value, when the page is read again with the field.
    const component = text ? componentAt(content, field.path) : null;
    // Code is skipped here too, though classify would give it no row anyway: one more door kept shut.
    if (component && !isCodeField(component, field.prop)) add.push({ component, prop: field.prop, group: 'copy' });
  }
  return { add };
}

/**
 * The dry run. `content` is the target page's jcr:content as it is now;
 * `sheet` is what readSheet returned. Returns every row with its outcome, and
 * the writes a commit would make - one per property, with the value it has
 * now and the value it would get, and the sheet's section it is in.
 *
 * `offered` is every write there could be: the texts, and each Static Content
 * block's prepared Body (HTML) and Footer (JavaScript). `sections` lists the
 * sheet's sections in page order, each { id, static }; `sections` given -
 * the ids ticked on the review - `writes` are the offered ones in those
 * sections, and nothing else. Not given, every section but Static Content is
 * ticked: a block holds page code, so it is written only when ticked.
 * `selected` is the ids the writes are for.
 */
export function planImport(content, sheet, { pagePath = '', sections = null, siteEnding = null } = {}) {
  /* The page's site, as its links name it: /content/samsung/levant_ar/… -> levant_ar. */
  const site = pagePath.split('/').filter(Boolean)[2] ?? null;
  /* Every place on the sheet: a row of a text used in several places names each
   * of them, a Key and a Check per line, and its one translation goes to all. */
  const places = sheet.rows.flatMap((r) => {
    const keys = r.keys ?? [r.key];
    const checks = r.checks ?? [r.check];
    const broken = keys.length > 1 ? checks.length !== keys.length : checks.length > 1;
    return keys.map((key, i) => ({ ...r, key, check: checks[i] ?? '', broken }));
  });

  /* The page read the way the sheet shows it: rich text written out in full
   * (v3), static HTML in whole sentences (v4) - and the way sheets made before
   * showed it, with <a1> placeholders and rows of their own for a link's title
   * or an image's alt, and static HTML in pieces, so they import too. */
  const read = (fields) => [
    extractCopyDeck(content, { pagePath, fields }),
    extractCopyDeck(content, { pagePath, fields, placeholders: true, staticPieces: true })
  ];
  let [deck, older] = read();
  const fromSheet = fieldsFromSheet(content, places, new Set([...deck.rows, ...older.rows].map((r) => r.key)));
  if (fromSheet.add.length) [deck, older] = read(fromSheet);
  const shownBefore = new Map(older.rows.map((r) => [r.key, r.source]));
  const pageRows = new Map(older.rows.filter((r) => r.attr || r.piece).map((r) => [r.key, r]));
  for (const r of deck.rows) pageRows.set(r.key, { ...r, placeholderSource: shownBefore.get(r.key) ?? r.source });
  /** The text on the page as either kind of sheet shows it. */
  const isSource = (p, t) => t === p.source || t === p.placeholderSource;

  /* A sheet of another site's page - exported from /levant (or /uk), imported
   * into /levant_ar (or /fr, /de) after Sync page copied it there. Sync
   * re-pointed the page's links and images at the new site, so a text is still
   * the exported one when it is that once they are pointed back: the Check is
   * compared both ways. Only the site changes; any other edit is still caught. */
  const sheetPage = sheet.meta?.pagePath || '';
  const sheetSite = sheetPage.split('/').filter(Boolean)[2] ?? null;
  const back =
    site && sheetSite && sheetSite !== site
      ? buildRules(resolveSites({ source: pagePath, dest: sheetPage, hosts: ['www.samsung.com'], shopHosts: ['shop.samsung.com'], rewriteShop: true }))
      : null;
  /* A link written out in full on www.samsung.com is the same link as its
   * relative path: the Relative Link Fixer, a Sync page or an author can turn
   * one into the other after the export. The page's are compared as relative
   * too - the words, and where each link goes, must still be the same. */
  const relative = (s) => s.replace(/(\shref\s*=\s*["'])https?:\/\/(?:www\.)?samsung\.com(?=\/)/gi, '$1');
  const unchanged = (p, check) => {
    if (p.hash === check) return true;
    if (typeof p.value !== 'string') return false;
    const ways = [p.value, ...(back ? [rewriteValue(p.value, back)] : [])];
    return ways.some((v) => sourceHash(v) === check || sourceHash(relative(v)) === check);
  };

  /* Static content whose Key is not on the page any more: its English was
   * changed - or the translation was put in already. Every text of the node
   * now, by its shape (see textsNow), is what a translation is looked up in. */
  const readNow = new Map();
  const pastedIn = ({ path, prop }, text) => {
    const id = `${path}@${prop}`;
    if (!readNow.has(id)) readNow.set(id, textsNow(nodeAt(content, path)?.[prop], prop));
    const now = readNow.get(id);
    const shape = shapesOf(text);
    return now.has(`text\n${shape.text}`) || now.has(`words\n${shape.words}`);
  };
  /* A Static Content block goes by its number among the page's blocks - this
   * page's, as the editor shows them - whatever the sheet says: a row merged
   * from several blocks, or with another component, names only the first. */
  let blocksNow = null;
  const staticSection = (key) => {
    const p = pageRows.get(key);
    if (p) return p.section;
    blocksNow ??= staticBlocks(content);
    const block = blocksNow.get(keyField(key)?.path);
    return block ? componentLabel('', {}, block) : null;
  };
  /* Which kind of sheet this is, from its #END row: before v3, rich text came as
   * placeholders - and a translation that lost one is blocked, not taken as
   * text written out in full. Without the row, each row tells: its Source cell,
   * or placeholders in its translation. */
  const sheetUsesPlaceholders = sheet.meta?.version ? sheet.meta.version < 3 : null;
  const withPlaceholders = (r, p, text) =>
    sheetUsesPlaceholders ??
    (usesPlaceholders(p.value, text) || (p.placeholderSource !== p.source && cleanText(r.source).replace(/^'/, '') === p.placeholderSource));
  const results = [];
  const seen = new Set();

  /* "Same as row N, leave blank" on a version 1 sheet: the first translation of
   * each text, taken only from rows whose text is still what was exported. */
  const firstOf = new Map();
  for (const r of places) {
    const p = pageRows.get(r.key);
    const t = cleanText(r.translation);
    const k = p?.placeholderSource ?? p?.source;
    if (p && t && !r.broken && unchanged(p, r.check) && !firstOf.has(k)) firstOf.set(k, { text: t, sheetRow: r.sheetRow });
  }

  /* Another country named where this site's is expected: a share title ending
   * otherwise than the home page's titles do ("| Samsung الأردن" on a site whose
   * titles end "| Samsung لبنان"), and those words wherever the page properties
   * use them. Without the home page's ending nothing is guessed. */
  const ours = siteEnding ? placeWords(siteEnding.replace(/^\s*\|/, '')) : [];
  const elsewhere = new Set();
  if (ours.length) {
    for (const r of places) {
      const p = pageRows.get(r.key);
      if (p?.path !== '' || !['ogTitle', 'twitterTitle'].includes(p.prop)) continue;
      const end = ENDING_OF(cleanText(r.translation));
      if (end) for (const w of placeWords(end)) if (!ours.includes(w)) elsewhere.add(w);
    }
  }
  const wrongPlace = (p, text) => {
    if (p.path !== '' || !SITE_NAMED.includes(p.prop)) return [];
    const found = [...elsewhere].filter((w) => text.includes(w));
    return found.length ? [`Names ${found.map((w) => `"${w}"`).join(', ')} - this site's titles end "${siteEnding.trim()}". Check the country.`] : [];
  };

  for (const r of places) {
    const p = pageRows.get(r.key);
    const base = {
      sheetRow: r.sheetRow,
      key: r.key,
      // As the sheet says it, so the review reads like the Excel file in front of the operator:
      // the page can number its sections differently once rows were left off the sheet.
      // Not static content: it goes by its block (see staticSection).
      section: (STATIC_KEY.test(r.key) && staticSection(r.key)) || r.section || p?.section || '',
      field: p?.field ?? '',
      category: p?.category ?? '',
      current: p?.source ?? '',
      translation: cleanText(r.translation),
      reusedFrom: null,
      message: '',
      warnings: []
    };
    const out = (status, extra = {}) => results.push({ ...base, status, ...extra });

    if (!r.key) {
      out('invalid', { message: 'The Key cell is empty. Key cells must not be edited.' });
      continue;
    }
    if (seen.has(r.key)) {
      out('duplicate', { message: 'This key is on the sheet more than once; only its first row is used.' });
      continue;
    }
    seen.add(r.key);
    if (r.broken) {
      out('invalid', {
        message: 'The Key and Check cells of this row no longer have one line per place - they must not be edited. Export the page again.'
      });
      continue;
    }
    /* A Static Content block's style sheet or script, named by a sheet made by
     * hand or before it was taken off: refused, in every form a Key takes - but
     * one string of the script, a text of its own, is listed for a developer.
     * Static HTML likewise: only its texts, or its pieces on an older sheet. */
    const field = keyField(r.key);
    const component = field ? componentAt(content, field.path) : null;
    const staticText =
      field && STATIC_KEY.test(r.key) && (STATIC_HTML_PROPS.includes(field.prop) || (field.prop === 'footerInclude' && component === STATIC_CONTENT));
    if (field && !staticText && isCodeField(component, field.prop)) {
      out('invalid', { message: CODE_REFUSED });
      continue;
    }
    if (field && !staticText && STATIC_HTML_PROPS.includes(field.prop) && !STATIC_PIECE.test(r.key)) {
      out('invalid', { message: STATIC_REFUSED });
      continue;
    }
    /* A text of static content (v4): put in by hand, never written - checked
     * like any translation first. Its Key is its words and tags, so a Key not
     * on the page means the English changed - or that the translation is there
     * already. Its Check is the text itself and how many places it was in. */
    if (staticText && (!p || p.category === 'static') && isObject(nodeAt(content, field.path))) {
      const text = base.translation;
      if (!p) {
        // Kept off the sheet, were it exported now (see addStatic): its Key covers two texts in the block, or one too long for a cell.
        const off = deck.staticLeftOff.find((l) => l.key === r.key);
        if (!text) out('untranslated', { category: 'static' });
        else if (off) {
          out('changed', {
            category: 'static',
            current: off.texts[0],
            message: off.why === 'too long' ? 'This text is too long for one Excel cell now - translate it by hand in the block.' : sameWords(off.texts.length)
          });
        } else if (pastedIn(field, text)) out('already', { category: 'static', message: ALREADY_IN_BLOCK });
        else out('notFound', { category: 'static', message: NOT_IN_BLOCK });
        continue;
      }
      const check = r.check.match(/^(h[\da-f]{8})\/(\d+)$/);
      if (!check) {
        out('invalid', { message: 'The Check cell of this row was changed - Check cells must not be edited. Export the page again.' });
        continue;
      }
      if (!text) {
        const typed = cleanText(r.source).replace(/^'/, '');
        out('untranslated', typed && !isSource(p, typed) ? { message: MOVED } : {});
        continue;
      }
      if (isSource(p, text)) {
        out('same', { translation: text });
        continue;
      }
      // Read as it is, and as it is once the marks and quotes Excel puts in a tag are taken out (see repairTags).
      const repaired = repairTags(text);
      // Markup written as codes too: "&lt;img …&gt;" in a tooltip is a tag to a script that puts it on the page.
      const markup = (s) => HAS_TAG.test(s) || HAS_TAG.test(decodeEntities(s));
      const refused =
        refusal(p, text) ||
        refusal(p, repaired) ||
        (markup(repaired) && !markup(p.source) ? WORDS_ONLY : null);
      if (refused) {
        out('invalid', { translation: text, message: refused });
        continue;
      }
      const warnings = [];
      if (check[1] !== p.hash.split('/')[0]) warnings.push('A link or a class in this text changed on the page since the export - keep the page’s own.');
      const was = Number(check[2]);
      if (was !== p.count) warnings.push(placesNote(p.source, was, p.count));
      // A quote the script holds the text in, or a backslash, ends the string early unless it is escaped.
      const marks = p.prop === 'footerInclude' ? [...(p.quotes || []), '\\'].filter((q) => text.includes(q)) : [];
      if (marks.length) {
        warnings.push(
          `Has ${marks.join(' and ')} in it: in the script it is written ${marks.map((q) => `\\${q}`).join(' and ')} instead, or the script stops working. DSY does this when it writes the Footer.`
        );
      }
      out('manual', { translation: text, warnings });
      continue;
    }
    if (!p) {
      out('missing', { message: 'Not on this page: the component was removed or renamed, or the sheet is for another page.' });
      continue;
    }
    if (!unchanged(p, r.check)) {
      if (base.translation && isSource(p, base.translation)) out('already', { message: 'The page already has this translation.' });
      else out('changed', { message: 'The text on the page changed after the export, so this translation may no longer fit. Export the page again.' });
      continue;
    }

    let text = base.translation;
    let reusedFrom = null;
    if (!text) {
      const first = firstOf.get(p.placeholderSource ?? p.source);
      if (!first) {
        const typed = cleanText(r.source).replace(/^'/, '');
        const moved = typed && !isSource(p, typed);
        out('untranslated', moved ? { message: MOVED } : {});
        continue;
      }
      text = first.text;
      reusedFrom = first.sheetRow;
    }

    /* Tidied before it is checked, and the operator told what changed:
     * another site's links made this site's, and stray spaces at line starts. */
    const tidied = [];
    if (p.format !== 'manual') {
      const indented = sourceIndents(p.value ?? p.source, text);
      if (indented !== text) tidied.push('Spaces at the start of lines taken out, as in the source.');
      const { text: linked, fixed } = p.format === 'html' ? ownSiteLinks(p.value, indented, site, sheetSite) : { text: indented, fixed: [] };
      if (fixed.length) tidied.push(`Links made this site's: ${fixed.join(', ')}.`);
      text = linked;
    }

    if (isSource(p, text)) {
      out('same', { translation: text, reusedFrom });
      continue;
    }
    /* Static HTML is applied by hand, so nothing of it is written - but what is
     * pasted into the block goes onto the page as it stands, so it gets the
     * checks every translation gets (see refusal). Not the tag and link
     * comparison a whole field gets: a row is a piece cut from the block, and
     * whoever applies it judges its tags. */
    if (p.format === 'manual') {
      const refused = refusal(p, text);
      if (refused) out('invalid', { translation: text, reusedFrom, message: refused });
      else out('manual', { translation: text, reusedFrom });
      continue;
    }
    /* Rich text comes back written out in full (v3), or - from a sheet made
     * before - with its tags as <a1> placeholders, checked as they were then. */
    const placeholders = p.format === 'html' && !p.attr && withPlaceholders(r, p, text);
    const check =
      p.format === 'html' && !p.attr && !placeholders ? validateHtml(p, text) : validate(placeholders ? { ...p, source: p.placeholderSource } : p, text);
    if (check.error) {
      out('invalid', { translation: text, reusedFrom, message: check.error });
      continue;
    }
    out(reusedFrom ? 'reuse' : 'ready', {
      translation: text,
      reusedFrom,
      warnings: [...tidied, ...wrongPlace(p, text), ...check.warnings],
      placeholders
    });
  }

  /* One write per property: a text and the <a1> title inside it (a sheet made
   * before v3) are two rows but one stored value, so they are put together here. */
  const byProp = new Map();
  for (const res of results) {
    if (IMPORT_STATUS[res.status].group !== 'write') continue;
    const p = pageRows.get(res.key);
    const k = `${p.path}@${p.prop}`;
    if (!byProp.has(k)) byProp.set(k, { path: p.path, prop: p.prop, parts: [] });
    byProp.get(k).parts.push({ res, p });
  }

  const writes = [];
  for (const { path, prop, parts } of byProp.values()) {
    /* Never written, whatever let a row through above: static HTML and a Static
     * Content block's code are applied by hand. */
    const reason = neverWrittenReason(componentAt(content, path), prop);
    if (reason) {
      for (const { res } of parts) {
        res.status = 'invalid';
        res.message = reason;
        res.warnings = [];
      }
      continue;
    }
    const stored = nodeAt(content, path)?.[prop];
    const values = Array.isArray(stored) ? [...stored] : [stored];
    let leftover = null;
    for (const index of new Set(parts.map((x) => x.p.index ?? 0))) {
      let mine = parts.filter((x) => (x.p.index ?? 0) === index);
      const { text: tokenText, tokens } = tokenizeTags(values[index]);
      const main = mine.find((x) => !x.p.attr);
      const whole = main && main.p.format === 'html' && !main.res.placeholders;
      if (whole) {
        /* The text was translated with its tags written out, titles and alts in
         * them: a title row of an older sheet for the same text has nothing left
         * to go into. */
        for (const x of mine.filter((y) => y.p.attr)) {
          x.res.status = 'invalid';
          x.res.message = `The text this ${x.p.attr.name} is in was translated with its tags written out - put the ${x.p.attr.name} in there.`;
          x.res.warnings = [];
        }
        mine = mine.filter((y) => !y.p.attr);
      }
      for (const { res, p } of mine) {
        if (!p.attr) continue;
        const t = tokens.find((x) => x.token === p.attr.token);
        if (t) t.original = setAttr(t.original, p.attr.name, res.translation);
      }
      values[index] = main ? compose(main.p, main.res.translation, whole ? null : tokens) : detokenize(tokenText, tokens);

      /* Last guard: every placeholder must have become its tag again. Anything
       * still reading <a1 …> or </a1> would be stored as it stands. */
      const names = tokens.map((t) => t.token.replace(/[^\w:-]/g, ''));
      if (names.length) {
        const re = new RegExp(`</?(${names.join('|')})(?=[\\s/>])`, 'i');
        const m = String(values[index]).match(re);
        if (m) leftover = m[0];
      }
    }
    if (leftover) {
      for (const { res } of parts) {
        res.status = 'invalid';
        res.message = `A placeholder (${leftover}…) could not be put back as its tag. Keep the placeholders exactly as in the source.`;
        res.warnings = [];
      }
      continue;
    }
    const to = Array.isArray(stored) ? values.map(asStored) : asStored(values[0]);
    if (JSON.stringify(to) === JSON.stringify(stored)) continue;
    const used = parts.filter((x) => IMPORT_STATUS[x.res.status].group === 'write');
    writes.push({ path, prop, from: stored, to, rows: used.map((x) => x.res.sheetRow), section: parts[0].res.section });
    for (const { res } of used) res.newValue = to;
  }

  /* What the sheet itself says about how complete it is. */
  const warnings = [];
  if (!sheet.meta) {
    warnings.push(
      'The #END row is missing, so the sheet may be incomplete - a filter left on, or a paste that stopped at a blank row. Copy the whole sheet with Ctrl+A.'
    );
  } else if (sheet.meta.rows !== null && sheet.meta.rows !== sheet.rows.length) {
    warnings.push(
      `The sheet was exported with ${sheet.meta.rows} rows, but ${sheet.rows.length} came through. Check for a filter, or hidden or deleted rows.`
    );
  }
  if (sheet.meta?.pagePath && sheet.meta.pagePath === pagePath) {
    warnings.push('This is the page the sheet was exported from: writing would replace its text with the translation.');
  }
  const missing = results.filter((r) => r.status === 'missing').length;
  if (results.length >= 4 && missing > results.length / 2) {
    warnings.push(`${missing} of ${results.length} rows are not on this page. Is this the page the translation is for?`);
  }
  // Static HTML in pieces: a sheet made before v4. It imports, but the pieces are no help to whoever pastes them.
  const inPieces = new Set(places.filter((r) => STATIC_PIECE.test(r.key)).map((r) => keyField(r.key).path));
  if (inPieces.size) warnings.push('Made by an older DSY - export again to get whole sentences ready to paste.');

  /* Text on the page that is not on the sheet: static content as the sheet has
   * it - in pieces before v4, which had no script strings either, or whole -
   * and a translation from the sheet pasted into its block already is not new
   * text. Nor is a static text the export kept off the sheet (see addStatic)
   * on it: it is listed too, to be translated in the block. */
  const pasted = new Set();
  for (const r of places) {
    const f = STATIC_KEY.test(r.key) && keyField(r.key);
    const t = cleanText(r.translation);
    if (!f || !t) continue;
    const shape = shapesOf(t);
    pasted.add(`${f.path}@${f.prop}\n${shape.text}`).add(`${f.path}@${f.prop}\n${shape.words}`);
  }
  const before4 = sheet.meta?.version ? sheet.meta.version < 4 : inPieces.size > 0;
  const leftOff = deck.staticLeftOff.flatMap((l) =>
    l.texts.map((text, i) => ({
      key: l.key,
      path: l.path,
      prop: l.prop,
      section: staticSection(l.key) || l.section,
      field: l.fields[i],
      source: text.length > 300 ? `${text.slice(0, 299)}…` : text,
      category: 'static',
      inactive: l.inactive
    }))
  );
  const onPage = before4 ? [...deck.rows.filter((r) => r.category !== 'static'), ...older.rows.filter((r) => r.piece)] : [...deck.rows, ...leftOff];
  // A text an older sheet covered only through its title or alt rows (an image alone) is on the sheet too.
  const notInSheet = onPage.filter(
    (r) => !r.inactive && !seen.has(r.key) && ![...seen].some((k) => k.startsWith(`${r.key}~`)) && !pasted.has(`${r.path}@${r.prop}\n${shapeOf(r.source)}`)
  );
  // Each place of the sheet has its outcome, in the same order.
  const staticToPaste = before4 ? [] : staticWork(content, places.map((r, i) => ({ r, res: results[i], p: pageRows.get(r.key) })), notInSheet);

  /* The sheet's sections in page order, as the review groups them: a Static
   * Content block's is its own, unticked unless chosen. */
  const blockSections = new Set(staticToPaste.map((b) => b.label));
  const allSections = [...new Set([...results.map((r) => r.section), ...staticToPaste.map((b) => b.label)])].map((id) => ({ id, static: blockSections.has(id) }));
  const ticked = new Set(sections ?? allSections.filter((s) => !s.static).map((s) => s.id));
  const selected = allSections.filter((s) => ticked.has(s.id)).map((s) => s.id);

  /* DSY writes a block's prepared Body (HTML) and Footer (JavaScript) itself,
   * as the engine made them - CRLF and all - and only values that passed
   * their checks: a block without one, and a text sent back, stay as they
   * are. Offered always, written only when the block's section is ticked.
   * Never the Header (CSS). Last, so the other writes are the same whatever
   * is ticked. */
  const staticWrites = staticToPaste.flatMap((b) =>
    [
      ['bodyHtml', b.prepared, b.items],
      ['footerInclude', b.preparedFooter, b.script]
    ]
      .filter(([prop, to]) => to !== null && !neverWrittenReason(componentAt(content, b.path), prop, { prepared: sections === null || ticked.has(b.label) }))
      .map(([prop, to, items]) => ({
        path: b.path,
        prop,
        from: b.old[prop],
        to,
        rows: items.filter((i) => i.status === 'placed').map((i) => i.sheetRow),
        section: b.label,
        block: b.no,
        static: true
      }))
  );
  const offered = [...writes, ...staticWrites];

  const counts = Object.fromEntries(Object.keys(IMPORT_STATUS).map((k) => [k, 0]));
  for (const r of results) counts[r.status]++;

  return {
    pagePath,
    exportedFrom: sheet.meta?.pagePath || null,
    language: content['jcr:language'] || null,
    rows: results,
    writes: offered.filter((w) => ticked.has(w.section)),
    offered,
    sections: allSections,
    selected,
    notInSheet,
    staticBlocks: staticToPaste,
    warnings,
    counts
  };
}

/** A static text's outcome on the review screen, as a block's own list says it (see prepareBody). */
const IN_BLOCK = {
  manual: 'placed',
  same: 'same',
  untranslated: 'untranslated',
  already: 'already',
  notFound: 'not found',
  invalid: 'sent back',
  changed: 'sent back'
};

/**
 * Static content on a v4 sheet, block by block, in page order: what the web
 * team pastes and a developer puts in. Nothing of it is written here - the
 * plan carries it, and writes a block's Body (HTML) and Footer (JavaScript)
 * only when its section is ticked on the review (see planImport). `entries`
 * are the sheet's places, each { r, res, p }: the row, its outcome, the
 * page's row for its Key.
 *
 * Each block is { path, no, of, label, old, modifiedBy, prepared, reason,
 * checks, items, notOnSheet, script, developer, preparedFooter, footerReason }:
 * the last two the Footer with its translations in (see prepareFooter), or
 * null and why. `old` its three fields as
 * read now, `modifiedBy` who changed it last (its jcr:lastModifiedBy);
 * `prepared` its new Body (HTML), the texts to apply by hand put in (see
 * prepareBody) and checked three ways (see verify) - or null, and `reason`
 * says why; `checks` what verify found; `items` the Body's texts on the sheet
 * with their outcome, `script` the Footer's, each marked `built` for a
 * sentence the script builds (as footerStatus takes them); `notOnSheet` the
 * Body's texts the sheet has no row for; `developer` the Footer's list (see
 * developerList). A text the block cannot take as translated - a tag added,
 * one left open - is sent back: its row needs fixing, and the rest of the
 * block is prepared without it.
 */
function staticWork(content, entries, notInSheet) {
  const byPath = new Map();
  const at = (path) => {
    if (!byPath.has(path)) byPath.set(path, { body: [], script: [] });
    return byPath.get(path);
  };
  for (const e of entries) {
    const field = STATIC_KEY.test(e.r.key) && keyField(e.r.key);
    if (!field || !IN_BLOCK[e.res.status] || !isObject(nodeAt(content, field.path))) continue;
    if (field.prop === 'footerInclude') at(field.path).script.push(e);
    else if (STATIC_HTML_PROPS.includes(field.prop)) at(field.path).body.push(e);
  }
  for (const r of notInSheet) if (r.category === 'static') at(r.path);

  const blocks = staticBlocks(content);
  const typed = (e) => cleanText(e.r.source).replace(/^'/, '');
  const item = (e, done) => ({
    key: e.r.key,
    sheetRow: e.r.sheetRow,
    cell: e.p?.source ?? typed(e),
    translation: e.res.translation,
    status: done?.status ?? IN_BLOCK[e.res.status],
    message: done?.message || e.res.message,
    notes: done?.notes ?? [],
    warnings: done?.warnings ?? e.res.warnings
  });
  return [...byPath]
    .sort(([a], [b]) => (blocks.get(a)?.no ?? 0) - (blocks.get(b)?.no ?? 0))
    .map(([path, { body, script }]) => {
      const node = nodeAt(content, path);
      const text = (v) => (typeof v === 'string' ? v : null);
      const old = { headerInclude: text(node.headerInclude), bodyHtml: text(node.bodyHtml), footerInclude: text(node.footerInclude) };
      const block = blocks.get(path);

      /* The texts to apply by hand go in, each matched by the tags the
       * translator saw: the sheet's Source cell when its Check says it is the
       * one exported - a link re-pointed since is the page's to keep - else
       * the page's own; the same words and tags either way. */
      const going = body.filter((e) => e.res.status === 'manual' && e.p);
      const shown = (e) => [cleanText(e.r.source), typed(e)].find((s) => sourceHash(s) === e.r.check.split('/')[0] && shapeOf(s) === shapeOf(e.p.source));
      const prep = prepareBody(old.bodyHtml ?? '', going.map((e) => ({ cell: shown(e) ?? e.p.source, translation: e.res.translation, places: Number(e.r.check.split('/')[1]) })));
      const done = new Map(going.map((e, i) => [e.res, prep.items[i]]));
      for (const [res, x] of done) {
        if (x.status === 'sent back') Object.assign(res, { status: 'invalid', message: x.message, warnings: [] });
        else if (x.status === 'same') Object.assign(res, { status: 'same', warnings: [] });
        else for (const n of x.notes) if (!res.warnings.includes(n)) res.warnings.push(n);
      }

      let reason = null;
      let checks = [];
      if (old.bodyHtml === null || !body.length) reason = 'No text of its Body (HTML) is on the sheet.';
      else if (!prep.placed.length) {
        if (body.some((e) => IN_BLOCK[e.res.status] === 'sent back')) reason = 'Nothing to paste yet: its texts on the sheet were sent back - fix those rows and import again.';
        else if (body.some((e) => e.res.status === 'already')) reason = 'Nothing new to paste: the block has the sheet’s translations already.';
        else reason = 'Nothing to paste: no translation on the sheet changes its Body (HTML).';
      } else if (/<[a-zA-Z!]/.test(old.headerInclude ?? '')) {
        reason = 'Its Header (CSS) holds HTML - something was pasted into the wrong tab. Put the Header back as it was, then check again.';
      } else {
        checks = verify(old.bodyHtml, prep.value, prep.placed);
        if (checks.length) reason = `Not offered: DSY’s own check of the new value found a problem - ${checks[0]}`;
      }

      const scriptGoing = script.filter((e) => e.res.status === 'manual' && e.p);
      // The Footer with its translations in, for DSY to write when the block is ticked (see prepareFooter).
      const footer = !scriptGoing.length
        ? { value: null, reason: null }
        : /<[a-zA-Z!]/.test(old.headerInclude ?? '')
          ? { value: null, reason: 'Its Header (CSS) holds HTML - something was pasted into the wrong tab. Put the Header back as it was, then check again.' }
          : prepareFooter(old.footerInclude, scriptGoing.map((e) => ({ cell: e.p.source, translation: e.res.translation })));
      return {
        path,
        no: block?.no ?? null,
        of: block?.of ?? null,
        label: block ? componentLabel('', {}, block) : (body[0] ?? script[0])?.res.section ?? notInSheet.find((r) => r.path === path)?.section ?? '',
        old,
        modifiedBy: text(node['jcr:lastModifiedBy']),
        prepared: reason ? null : prep.value,
        reason,
        checks,
        items: body.map((e) => item(e, done.get(e.res))),
        notOnSheet: notInSheet.filter((r) => r.path === path && r.prop !== 'footerInclude').map((r) => r.source),
        script: script.map((e) => ({ ...item(e), built: Boolean(e.p?.built) })),
        developer: developerList(old.footerInclude ?? '', new Map(scriptGoing.map((e) => [e.p.source, e.res.translation]))),
        preparedFooter: footer.value,
        footerReason: footer.reason
      };
    });
}

/** "30 texts and 7 Static Content blocks": what the writes change, a block's Body (HTML) and Footer counted as its block. */
export function writesSaid(writes) {
  const blocks = new Set(writes.filter((w) => w.static).map((w) => w.path)).size;
  const n = writes.filter((w) => !w.static).length;
  return [n || !blocks ? `${n} text${n === 1 ? '' : 's'}` : '', blocks ? `${blocks} Static Content block${blocks === 1 ? '' : 's'}` : '']
    .filter(Boolean)
    .join(' and ');
}

/**
 * One value for "these exact writes, on this server, to this page": every
 * property, its value now and the value it gets. The panel sends it with the
 * write; the worker plans again against the live page and refuses unless it
 * comes out the same - so what is written is always what was read on the
 * review screen, and only where it was read. A stage and a prod author holding
 * the same page give different fingerprints. `sections`, the sections ticked
 * on the review, is in it too: another choice is another fingerprint.
 */
export function writesFingerprint(writes, { origin = '', page = '', sections = null } = {}) {
  const ticked = sections ? [sections] : [];
  return sourceHash(JSON.stringify([origin, page, ...ticked, ...writes.map((w) => [w.path, w.prop, w.from, w.to])]));
}
