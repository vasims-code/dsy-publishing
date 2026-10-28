/**
 * The copy deck of a product detail (PD) page.
 *
 * A page made from the page-standard-pd template keeps almost nothing in AEM:
 * its jcr:content holds a few page properties and an empty layout. The product
 * name, gallery, highlights, features and specs come from PIM when the page is
 * served - and are translated in PIM, not in AEM. So this reads the page as it
 * is rendered (`<page>.html?wcmmode=disabled`), and a row says where on the
 * page its text is rather than which property holds it. The translations go
 * back into PIM by hand; such a sheet cannot be imported.
 *
 * Only the product's own copy is listed. The buying tool (prices, options,
 * offers), reviews, support downloads, the "buy direct" benefits, navigation
 * and popups come from elsewhere and are left off - and said to be. A part of
 * the page this does not know goes under "Other text on the page", so nothing
 * new goes missing without a word.
 *
 * The same words are often rendered more than once - an image's alt for
 * desktop and mobile, the product name in four places. `items` keeps each
 * place; selectPdRows puts each text on the sheet once, where it is first seen
 * in the groups chosen.
 *
 * Pure: the page's HTML in, rows out. Runs in a content script and a test alike.
 */

import { baseLabel, sourceHash } from './core.js';
import { classes, decodeHtml, find, findAll, hasClass, parseHtml, textOf } from './html.js';

/** What PD pages are made from. Matched on the name, so any /conf/<brand>/ holding it counts. */
const PD_TEMPLATE = /\/page-standard-pd$/;

/** Is this a product detail page? `info` is what AemClient.inspect returns. */
export const isPdPage = (info) =>
  PD_TEMPLATE.test(info?.template || '') || PD_TEMPLATE.test(info?.content?.['sling:resourceType'] || '');

/** The groups of a PD sheet, in the order shown. */
export const PD_CATEGORIES = [
  { id: 'page', label: 'Page title & SEO' },
  { id: 'product', label: 'Product name' },
  { id: 'gallery', label: 'Gallery image titles' },
  { id: 'highlights', label: 'Highlights' },
  { id: 'features', label: 'Features' },
  { id: 'alt', label: 'Feature image alt text' },
  { id: 'disclaimer', label: 'Footnotes & disclaimers' },
  { id: 'specs', label: 'Specs' },
  { id: 'other', label: 'Other text on the page' }
];

/**
 * A sibling SKU - the same model in another size or colour - shares its
 * features with the representative SKU, which is translated in full. Only its
 * gallery and specs are its own.
 */
export const SKU_PRESETS = {
  rep: PD_CATEGORIES.map((c) => c.id),
  sibling: ['gallery', 'specs']
};

/** Parts of a PD page that are not the product's copy: left off, and listed as left off. */
const LEFT_OFF = [
  [/^pd-g-product-promotion-bar/, 'Promotion bar', 'site promotions, not the product'],
  [/^pd-g-anchor-navigation/, 'Page navigation', 'menu labels and prices'],
  [/^pd-g-product-review/, 'Reviews', 'written by customers'],
  [/^pd-g-product-support/, 'Support & downloads', 'manuals and support links'],
  [/^pd-g-reasons-to-buy/, 'Buy direct benefits', 'the same on every product page'],
  [/^pd-g-(manufacturer-info|.*-popup$)/, 'Popup', 'shop and service popups'],
  [/^pd-g-product-video-carousel/, 'Video carousel', 'videos from a third party']
];

/** Words a visitor never reads: screen-reader text, a closed element, controls and forms. */
const HIDDEN_CLASS = /^(hidden|blind|sr-only|sr_only|visually-hidden|a11y-hidden|screen-reader-text|hide)$/;
const NOT_COPY = new Set(['svg', 'select', 'option', 'input', 'form', 'iframe', 'object', 'video', 'audio', 'canvas']);
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'button', 'cite', 'code', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd',
  'label', 'mark', 'nobr', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr'
]);
const IMAGE_ALTS = ['alt', 'data-desktop-alt', 'data-mobile-alt'];

const isHidden = (el) => el.attrs.hidden !== undefined || el.attrs['aria-hidden'] === 'true' || classes(el).some((c) => HIDDEN_CLASS.test(c));
const skip = (el) => NOT_COPY.has(el.tag) || el.raw !== undefined || isHidden(el);

/**
 * Words a translator can work on: a letter in it, and not a template's
 * `{{price.text}}` or a code on its own - a model code, a remote's, "30W",
 * "2CH" - which is the same in every language.
 */
const isCopy = (t) =>
  t.length > 1 &&
  /\p{L}/u.test(t) &&
  !/^\{\{[^{}]*\}\}$/.test(t.replace(/\s+/g, '')) &&
  !(/\d/.test(t) && /^[\p{Lu}\d][\p{Lu}\d./+-]*$/u.test(t));

/** A section's name: one line, short enough to read in a column. */
const short = (t) => {
  const line = String(t).replace(/\s+/g, ' ').trim();
  return line.length > 50 ? `${line.slice(0, 49)}…` : line;
};

/** Whitespace as a visitor sees it: runs as one space, a line break where <br> was. */
const tidy = (s) =>
  String(s)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** A footnote marker inside copy: <sup><a href="#featureBottomDiclaimer3">3</a></sup>. */
const isFootnoteMark = (el) =>
  el.tag === 'sup' &&
  /^[\d\s,*†‡§]+$/.test(textOf(el).trim()) &&
  (hasClass(el, 'disclaimer-bottom-number') || !!find(el, (a) => a.tag === 'a' && /^#/.test(a.attrs.href || '')));

/** Only inline elements below: then it reads as part of the sentence around it. */
const flat = (el) => !find(el, (d) => !INLINE.has(d.tag) && d.tag !== 'img');

/** The text of inline content, footnote markers taken out and their numbers kept. */
function inlineText(nodes) {
  const footnotes = [];
  const read = (n) => {
    if ('text' in n) return n.text;
    if (n.tag === 'br') return '\n';
    if (skip(n)) return '';
    if (isFootnoteMark(n)) {
      footnotes.push(...textOf(n).match(/\d+/g));
      return '';
    }
    return n.children.map(read).join('');
  };
  return { text: tidy(nodes.map(read).join('')), footnotes };
}

/** What a class says an element is, BEM-style: "feature-benefit__sub-title" is a sub-headline. */
function fieldByClass(el) {
  for (const c of classes(el)) {
    const m = c.match(/__([a-z0-9-]+)$/i);
    if (!m) continue;
    const n = m[1].toLowerCase();
    if (/sub-?(title|headline|heading)|eyebrow/.test(n)) return 'Sub-headline';
    if (/headline|title|heading/.test(n)) return 'Headline';
    if (/disclaimer|footnote|legal/.test(n)) return 'Disclaimer';
    if (/caption/.test(n)) return 'Caption';
    if (/name/.test(n)) return 'Name';
    if (/desc|copy|body|text|paragraph|content/.test(n)) return 'Description';
    if (/cta|btn|button|link/.test(n)) return 'Button text';
    if (/badge|tag|chip|label/.test(n)) return 'Label';
  }
  return null;
}

function fieldByTag(el) {
  if (/^h[12]$/.test(el.tag)) return 'Headline';
  if (/^h[3-6]$/.test(el.tag)) return 'Sub-headline';
  if (el.tag === 'a' || el.tag === 'button') return 'Button text';
  if (el.tag === 'li') return 'List item';
  return null;
}

/**
 * What a piece of text is: what the class of its element - or of the one
 * element inside it, `<a class="cta"><span>…</span></a>` - says, failing that
 * its tag, failing that "Text".
 */
function fieldOf(el) {
  const chain = [el];
  for (let n = el; ; ) {
    const kids = n.children.filter((c) => c.tag || c.text.trim());
    if (kids.length !== 1 || !kids[0].tag) break;
    n = kids[0];
    chain.push(n);
  }
  for (const n of chain) {
    const f = fieldByClass(n);
    if (f) return f;
  }
  for (const n of chain) {
    const f = fieldByTag(n);
    if (f) return f;
  }
  return 'Text';
}

/**
 * Every piece of copy under `root`, in page order: `onText(owner, text,
 * footnotes)` for each run of text, `onImage(img)` for each image,
 * `onVideo(el, title)` for each video's description. A run is
 * the text of one element, with what is inline in it (a link, a <sup>, a <br>)
 * read as part of it, so a sentence with a link or a footnote in it stays one
 * sentence. Hidden elements, controls and markup inside a script are not read.
 */
function walkCopy(root, { onText, onImage, onVideo = () => {}, skipEl = () => false }) {
  const walk = (el) => {
    if (skip(el) || skipEl(el)) return;
    if (el.tag === 'img') return void onImage(el);
    if (el.attrs['data-video-data']) {
      const title = videoTitle(el.attrs['data-video-data']);
      if (title) onVideo(el, title);
    }
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const nodes = run;
      run = [];
      const { text, footnotes } = inlineText(nodes);
      if (!isCopy(text)) return;
      // A run that is one element - a link, a <strong> - is that element's text.
      const els = nodes.filter((n) => n.tag);
      const alone = els.length === 1 && nodes.every((n) => n.tag || !n.text.trim());
      onText(alone ? els[0] : el, text, footnotes);
    };
    for (const c of el.children) {
      if ('text' in c) run.push(c);
      else if (c.raw !== undefined) continue;
      else if (INLINE.has(c.tag) && flat(c)) {
        if (skip(c) || skipEl(c)) continue;
        for (const img of findAll(c, (d) => d.tag === 'img')) onImage(img);
        run.push(c);
      } else {
        flush();
        walk(c);
      }
    }
    flush();
  };
  walk(root);
}

/**
 * A video's description: the "title" in its data-video-data settings. Screen
 * readers announce it (the page also puts it in hidden text, which is not read),
 * and its poster image's alt is often a placeholder, so it is read from here.
 */
function videoTitle(data) {
  try {
    const t = JSON.parse(data).title;
    return typeof t === 'string' ? t : '';
  } catch {
    const m = String(data).match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return m ? m[1].replace(/\\(.)/g, '$1') : '';
  }
}

/* -------------------------------------------------------------- PIM ids */

const FEATURE_ID = /\/feature\/(\d{5,})\/|featureBottomDiclaimerGoBack(\d{5,})/g;

/** The PIM feature a piece of copy belongs to: the one feature its nearest ancestor shows images of. */
function featureIds() {
  const memo = new WeakMap();
  const idsOf = (node) => {
    if (memo.has(node)) return memo.get(node);
    const ids = new Set();
    for (const v of Object.values(node.attrs || {})) for (const m of v.matchAll(FEATURE_ID)) ids.add(m[1] || m[2]);
    for (const c of node.children || []) if (c.tag) for (const id of idsOf(c)) ids.add(id);
    memo.set(node, ids);
    return ids;
  };
  return (el, stop) => {
    for (let n = el; n && n !== stop.parent; n = n.parent) {
      const ids = idsOf(n);
      if (ids.size === 1) return [...ids][0];
      if (ids.size > 1) return null;
    }
    return null;
  };
}

/**
 * `root` cut into its parts, in page order: every element `isPart` picks (and
 * not what is inside it), and every stretch between them as a part of its own,
 * so text that sits outside any known part is read too, where it is.
 */
function split(root, isPart) {
  const parts = [];
  const visit = (el) => {
    for (const c of el.children) {
      if (!c.tag || c.raw !== undefined) continue;
      if (isPart(c) || !find(c, isPart)) parts.push(c);
      else visit(c);
    }
  };
  visit(root);
  return parts;
}

/* -------------------------------------------------------------- extract */

/**
 * Every piece of the product's copy on a rendered PD page. Returns `items` - one
 * per place a text appears, in page order, already shaped like copy deck rows -
 * the parts of the page left off (`leftOff`), the page's language, and what was
 * `found`, so a page that did not render as a product page can be told apart.
 */
export function extractPdDeck(html, { pagePath = '' } = {}) {
  const doc = parseHtml(html);
  const head = find(doc, (n) => n.tag === 'head') || doc;
  const body = find(doc, (n) => n.tag === 'body') || doc;
  const content = find(body, (n) => n.attrs.id === 'content') || body;
  const pim = featureIds();

  const items = [];
  const leftOff = [];
  let sectionCount = 0;

  /** A section of the sheet. Numbered once it gets its first row, so empty parts leave no gaps. */
  const section = (label, { page = false } = {}) => ({ label, no: page ? 0 : null, texts: new Map(), n: 0 });

  /**
   * One place a text appears. Within a section the same words are one row: an
   * alt rendered for desktop and for mobile, a spec value shared by many specs -
   * the other places are named in the notes.
   */
  const add = (s, category, field, raw, { notes = [], featureId = null } = {}) => {
    const text = tidy(raw);
    if (!isCopy(text)) return;
    const seen = s.texts.get(text);
    if (seen) {
      if (seen.field !== field) seen.also.add(field);
      return;
    }
    if (s.no === null) s.no = ++sectionCount;
    const placeholders = [...new Set(text.match(/\{[^{}\s]+\}/g) || [])];
    const item = {
      key: `pd:${String(s.no).padStart(2, '0')}.${++s.n}`,
      sec: s,
      sectionNo: s.no,
      field,
      category,
      value: text,
      source: text,
      format: text.includes('\n') ? 'multiline' : 'plain',
      tags: placeholders,
      lineBreaks: (text.match(/\n/g) || []).length,
      hash: sourceHash(text),
      pim: featureId,
      notes: [...(featureId ? [`PIM feature ${featureId}`] : []), ...notes],
      also: new Set()
    };
    s.texts.set(text, item);
    items.push(item);
  };

  /** The generic reader: headlines, copy, buttons and image alts, each named after its element. */
  const readCopy = (root, s, category, { altCategory = category, skipEl, featureRoot = root, field: named } = {}) => {
    walkCopy(root, {
      skipEl,
      onText: (owner, text, footnotes) => {
        const field = named || fieldOf(owner);
        const notes = footnotes.length ? [`Has footnote ${footnotes.join(', ')}`] : [];
        add(s, field === 'Disclaimer' ? 'disclaimer' : category, field, text, { notes, featureId: pim(owner, featureRoot) });
      },
      onImage: (img) => {
        for (const a of IMAGE_ALTS) {
          if (img.attrs[a]) add(s, altCategory, 'Image alt', img.attrs[a], { featureId: pim(img, featureRoot) });
        }
      },
      onVideo: (el, title) => add(s, altCategory, 'Video description', title, { featureId: pim(el, featureRoot) })
    });
  };

  /** Copy no rule here reads: how many texts a part of the page that is left off holds. */
  const countCopy = (root) => {
    let n = 0;
    walkCopy(root, { onText: () => n++, onImage: () => {}, onVideo: () => n++ });
    return n;
  };

  /* ---- the page's title and SEO, from <head> ---------------------------- */
  const pageSection = section('Page title & SEO', { page: true });
  const title = find(head, (n) => n.tag === 'title');
  if (title) add(pageSection, 'page', 'Page title', decodeHtml(title.raw || ''));
  const META = [
    ['description', 'Meta description'],
    ['og:title', 'Open Graph title'],
    ['og:description', 'Open Graph description'],
    ['twitter:title', 'Twitter title'],
    ['twitter:description', 'Twitter description'],
    ['keywords', 'Meta keywords']
  ];
  for (const [name, field] of META) {
    const meta = find(head, (n) => n.tag === 'meta' && (n.attrs.name === name || n.attrs.property === name));
    if (meta?.attrs.content) add(pageSection, 'page', field, meta.attrs.content);
  }

  /* ---- the product's name: the page's headline -------------------------- */
  const productSection = section('Product name');
  const name =
    find(content, (n) => hasClass(n, 'sg-product-display-name')) ||
    find(content, (n) => n.tag === 'h1' && !isHidden(n)) ||
    find(content, (n) => hasClass(n, 'pd-info__title'));
  if (name) add(productSection, 'product', 'Product name', inlineText([name]).text);

  /* ---- the parts of the page, in order ---------------------------------- */
  const component = (el) => classes(el).find((c) => /^pd-g-/.test(c));
  const units = split(content, component);

  const found = { product: !!name, gallery: false, features: false, specs: false };
  const label = (cls) => baseLabel(cls.replace(/-ux\d+$/, ''));

  for (const unit of units) {
    const cls = component(unit) || '';

    /* the product header: its gallery is the product's; the buying tool around it is the shop's */
    if (/^pd-g-(product-detail-header|pdp-header)/.test(cls)) {
      const gallery = find(unit, (n) => hasClass(n, 'hdd02-gallery')) || unit;
      const s = section('Gallery');
      const slides = findAll(gallery, (n) => hasClass(n, 'hdd02-gallery__item') || n.attrs['data-type-headline'] !== undefined);
      slides.forEach((li, i) => {
        found.gallery = true;
        const texts = [li.attrs['data-type-headline'], ...findAll(li, (n) => n.tag === 'img').flatMap((img) => IMAGE_ALTS.map((a) => img.attrs[a]))];
        const distinct = [...new Set(texts.filter(Boolean).map(tidy))];
        distinct.forEach((t, j) => add(s, 'gallery', `Image ${i + 1} › ${j === 0 ? 'Title' : 'Alt text'}`, t));
      });
      const rest = countCopy(unit) - (slides.length ? countCopy(gallery) : 0);
      if (rest > 0) leftOff.push({ part: 'Buying options', why: 'prices, sizes, offers and services - set up in the shop, not PIM', texts: rest });
      continue;
    }

    /* features, and the highlights at their top */
    if (/^pd-g-feature/.test(cls)) {
      // Each <section> in it is a section of the sheet; anything between them is read too, in its place.
      for (const block of split(unit, (n) => n.tag === 'section')) {
        if (hasClass(block, 'pdd30-highlights')) {
          readCopy(block, section('Highlights'), 'highlights', { altCategory: 'alt' });
          continue;
        }
        // Named after its headline - or, with none (a banner image, an infographic), after its first text.
        const headline = find(block, (n) => /^h[1-4]$/.test(n.tag) && !isHidden(n) && isCopy(inlineText([n]).text));
        const s = section('Feature');
        readCopy(block, s, 'features', { altCategory: 'alt' });
        if (s.no === null) continue;
        found.features = true;
        s.label = `Feature · ${short(headline ? inlineText([headline]).text : s.texts.keys().next().value)}`;
      }
      continue;
    }

    /* specs: the values, each named by its group and spec. The names are PIM's own attribute labels. */
    if (/^pd-g-product-spec/.test(cls) || find(unit, (n) => hasClass(n, 'pdd32-product-spec'))) {
      const s = section('Specs');
      for (const item of findAll(unit, (n) => hasClass(n, 'pdd32-product-spec__item'))) {
        const group = tidy(textOf(find(item, (n) => hasClass(n, 'pdd32-product-spec__title')) || { children: [] }));
        for (const li of findAll(item, (n) => hasClass(n, 'pdd32-product-spec__content-item'))) {
          const specName = tidy(textOf(find(li, (n) => hasClass(n, 'pdd32-product-spec__content-item-title')) || { children: [] }));
          const values = findAll(li, (n) => hasClass(n, 'pdd32-product-spec__content-item-desc'));
          for (const v of values) add(s, 'specs', [group, specName].filter(Boolean).join(' › ') || 'Spec', inlineText([v]).text);
        }
      }
      // Anything else in the specs - a note under them, say - but never the headings and names.
      readCopy(unit, s, 'specs', {
        skipEl: (n) =>
          hasClass(n, 'pdd32-product-spec__item') ||
          hasClass(n, 'pdd32-product-spec__headline-wrap') ||
          n.tag === 'button'
      });
      if (s.no !== null) found.specs = true;
      continue;
    }

    /* the footnotes the features point at */
    const footnotes = hasClass(unit, 'feature-bottom-disclaimer') ? unit : find(unit, (n) => hasClass(n, 'feature-bottom-disclaimer'));
    if (footnotes) {
      const s = section('Footnotes');
      for (const li of findAll(unit, (n) => hasClass(n, 'feature-bottom-disclaimer__item'))) {
        const num = tidy(textOf(find(li, (n) => hasClass(n, 'feature-bottom-disclaimer__num')) || { children: [] })).replace(/\D+/g, '');
        const body = find(li, (n) => hasClass(n, 'feature-bottom-disclaimer__text')) || li;
        const text = inlineText(body.children.filter((c) => !c.tag || !/cta|blind/.test(c.attrs.class || ''))).text;
        add(s, 'disclaimer', num ? `Footnote ${num}` : 'Disclaimer', text, { featureId: pim(li, li) });
      }
      readCopy(unit, s, 'disclaimer', { field: 'Disclaimer', skipEl: (n) => hasClass(n, 'feature-bottom-disclaimer__list') });
      continue;
    }

    if (unit.tag === 'nav' || hasClass(unit, 'breadcrumb') || find(unit, (n) => hasClass(n, 'breadcrumb'))) {
      const n = countCopy(unit);
      if (n) leftOff.push({ part: 'Breadcrumb', why: 'category names, from the site’s own pages', texts: n });
      continue;
    }

    const known = LEFT_OFF.find(([re]) => re.test(cls));
    if (known) {
      const n = countCopy(unit);
      if (n) leftOff.push({ part: known[1], why: known[2], texts: n });
      continue;
    }

    /* a part this does not know: listed, so it is there to tick or untick */
    readCopy(unit, section(cls ? label(cls) : 'Other'), 'other');
  }

  const lang = find(doc, (n) => n.tag === 'html')?.attrs.lang || null;
  return {
    pagePath,
    mode: 'pd',
    language: lang,
    items: items.map(({ also, sec, ...it }) => ({
      ...it,
      section: sec.no === 0 ? sec.label : `${String(sec.no).padStart(2, '0')} · ${sec.label}`,
      notes: also.size ? [...it.notes, `Also used as: ${[...also].slice(0, 3).join('; ')}${also.size > 3 ? ` and ${also.size - 3} more` : ''}`] : it.notes
    })),
    leftOff,
    found
  };
}

/* -------------------------------------------------------------- the sheet */

/**
 * The rows for the sheet: the items in the groups asked for, each text once -
 * where it is first seen among them, with the other sections it appears in
 * named. One translation covers every place, and the translations go into PIM
 * by hand, so a text twice on the sheet would only be translated twice.
 */
export function selectPdRows(items, { categories } = {}) {
  const want = categories ? new Set(categories) : null;
  const first = new Map();
  const rows = [];
  for (const it of items) {
    if (want && !want.has(it.category)) continue;
    const row = first.get(it.source);
    if (row) {
      if (it.sectionNo !== row.sectionNo) row.alsoIn.add(it.sectionNo);
      continue;
    }
    const fresh = { ...it, alsoIn: new Set() };
    first.set(it.source, fresh);
    rows.push(fresh);
  }
  return rows.map(({ alsoIn, ...r }) => {
    if (!alsoIn.size) return r;
    const names = [...alsoIn].map((n) => (n === 0 ? 'Page title & SEO' : String(n).padStart(2, '0')));
    return { ...r, notes: [...r.notes, `Also in section ${names.join(', ')}`] };
  });
}

/** Texts per group, each counted once - what the sheet would hold with only that group ticked. */
export function countPdByCategory(items) {
  const counts = Object.fromEntries(PD_CATEGORIES.map((c) => [c.id, 0]));
  const seen = new Set();
  for (const it of items) {
    const k = `${it.category}\u0000${it.source}`;
    if (seen.has(k)) continue;
    seen.add(k);
    counts[it.category] = (counts[it.category] || 0) + 1;
  }
  return counts;
}

/** Is this a sheet exported from a PD page? Its keys say so. */
export const isPdKey = (key) => /^pd:/.test(String(key || '').trim());
