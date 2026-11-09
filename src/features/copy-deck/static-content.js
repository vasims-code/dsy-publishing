/**
 * Static Content: the words in a cm-g-static-content block, read the way a
 * translator needs them.
 *
 * A block is code, put on the page as it stands: Body (HTML) is markup, Footer
 * (JavaScript) a script. What a visitor reads in it is cut into units:
 *
 *   text    a whole sentence - the content of one block element (p, h2,
 *           button, dt…) or a run of loose text - with its inline tags (a,
 *           span, br, strong, sup…) kept, so a sentence is never cut in two.
 *           Each tag is shown with its href and class only.
 *   attr    the words of an attribute a visitor reads or hears: alt, title,
 *           aria-label, aria-description, placeholder, a button's value, and
 *           from a fixed list data-tooltip, data-title, data-label,
 *           data-caption, data-text - a script may match on any other data-*.
 *           One on a tag inside a sentence - a link's title - is a unit too.
 *   script  a string of the Footer at a spot that shows it: a data field
 *           named like text (title, text, bgAlt…), a text node, an aria-label
 *           or a title the script sets. A sentence the script builds -
 *           `${open ? "Close" : "Open"} showcase container` - is read as the
 *           whole sentences it can make.
 *
 * Every unit keeps where it is in the stored value, to the character, so what
 * is put back goes to that spot and nowhere else - never found again by
 * search, so "Active" can never land in class="tab active". Code is never a
 * unit: <style>, <script>, SVG, templates, ids, classes, links, other data-*.
 * What is not words but matters to someone - empty slots, links, images, a
 * left-or-right layout - is collected as a report.
 *
 * It has its own small parser rather than html.js: html.js closes tags the way
 * a browser does (a <div> closes an open <p>) and keeps no positions, so where
 * a unit is in the stored value could not be worked out from it - and a second
 * reader that sees the markup differently is what can check this one's work.
 * Both find a tag with the same pattern, though: html.js checks how the tags
 * fit together, not where each one starts. A tag a browser would read where
 * this reader sees words - one with a quote left open - is placeText's to
 * catch: it never puts words into a sentence that has one.
 *
 * The way back is here too, at the end: a block's new Body (HTML), every
 * translation put where its text was read and the page's own tags written
 * back byte for byte, checked three ways - the third by html.js, a reader that
 * sees the markup another way - for the web team to paste whole; the Footer
 * as a list, line by line, for a developer; and, after the paste, where a
 * block stands, read only.
 *
 * Pure: no DOM, no chrome.* - it runs in a content script, a panel and a test alike.
 */

import { decodeHtml, elements, parseHtml } from './html.js';

/* -------------------------------------------------------------- the cell */

/** HTML's own whitespace. A no-break space (U+00A0) is a character, not a gap: it is kept, and shown as &nbsp;. */
const WS = /[ \t\r\n\f]+/g;
const trimWs = (s) => s.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '');
const showNbsp = (s) => s.replace(/\u00a0|&#160;|&#x0*a0;/gi, '&nbsp;');

/** A tag, its quoted attributes kept whole - core.js reads tags with it too. */
export const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ONE_TAG = /^<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>$/;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/dg;

/** A tag as a translator sees it: its name, href and class - the rest stays the page's. */
export function cellTag(raw) {
  const m = raw.match(ONE_TAG);
  if (!m) return raw;
  const name = m[2].toLowerCase();
  if (m[1]) return `</${name}>`;
  const kept = [];
  for (const a of m[3].matchAll(ATTR)) {
    const n = a[1].toLowerCase();
    if (n === 'href' || n === 'class') kept.push(`${n}="${trimWs((a[2] ?? a[3] ?? a[4] ?? '').replace(WS, ' '))}"`);
  }
  return `<${name}${kept.length ? ` ${kept.join(' ')}` : ''}>`;
}

/**
 * A stored sentence as its cell shows it: line breaks and indentation as one
 * space, each tag as cellTag shows it, codes like &amp; as written, a no-break
 * space as &nbsp;.
 */
export function cellText(stored) {
  let out = '';
  let last = 0;
  for (const m of stored.matchAll(TAG)) {
    out += stored.slice(last, m.index).replace(WS, ' ') + cellTag(m[0]);
    last = m.index + m[0].length;
  }
  out += stored.slice(last).replace(WS, ' ');
  return showNbsp(trimWs(out).replace(/[ ]+((?:<\/[a-z][\w-]*>)+)$/i, '$1').replace(/^((?:<[a-z][^>]*>)+)[ ]+/i, '$1'));
}

/** The words of a cell, as a visitor reads them. */
export const wordsOf = (cell) => trimWs(decodeHtml(String(cell).replace(TAG, ' ')).replace(WS, ' '));

/** Words as they are stored between tags: a bare & and a < escaped; a code already written - &nbsp;, &amp; - stays one. */
export const escapeText = (s) =>
  String(s)
    .replace(/&(?!#\d+;|#x[\da-f]+;|[a-z][a-z\d]*;)/gi, '&amp;')
    .replace(/</g, '&lt;');

/**
 * What a cell's Key is made from: the cell with each tag reduced to its name.
 * A link pointed elsewhere, a class changed, the code around it re-indented:
 * the same text, the same Key. Two cells that differ only there have one shape
 * - which is why the export never lets one Key cover both.
 */
export const shapeOf = (cell) => String(cell).replace(TAG, (t, slash, name) => `<${slash}${name.toLowerCase()}>`);

/**
 * The cell a translation reads as once it is in the block: a sentence with
 * its text escaped where it needs to be (a bare & or <), or words alone, as
 * they read in an attribute or a script's string.
 */
export function cellOf(text, kind) {
  text = String(text);
  if (kind !== 'text') return showNbsp(trimWs(decodeHtml(text).replace(WS, ' ')));
  let stored = '';
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    stored += escapeText(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return cellText(stored + escapeText(text.slice(last)));
}

/** The direction marks an Arabic or Hebrew cell picks up in Excel. */
const DIR_MARKS = '\\u061c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069';
const IN_TAG = new RegExp(`^<[\\s${DIR_MARKS}]*\\/?[${DIR_MARKS}]*[a-zA-Z]`);

/**
 * A translation's tags the way the translator meant them: inside a tag only,
 * the direction marks Excel puts in an Arabic cell taken out, and curly quotes
 * and Excel's doubled ones made plain - `<‏a href=“…”>` is `<a href="…">`, as
 * it is in the block once pasted. The words, and the marks around them, are
 * never touched.
 */
export function repairTags(text) {
  return String(text).replace(/<[^<>]*>/g, (m) =>
    IN_TAG.test(m)
      ? m
          .replace(new RegExp(`[${DIR_MARKS}]`, 'g'), '')
          .replace(/[“”″„]/g, '"')
          .replace(/=\s*""([^"]*)""/g, '="$1"')
      : m
  );
}

/**
 * How a translation reads once it is in a block, its tags repaired: as a
 * sentence (`text`), and as words alone (`words`), each by its shape - what
 * it is looked up by in textsNow.
 */
export function shapesOf(text) {
  const t = repairTags(text);
  return { text: shapeOf(cellOf(t, 'text')), words: shapeOf(cellOf(t, 'words')) };
}

/* ------------------------------------------------- the markup, with places */

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
]);
/** Elements whose content is not markup - xmp, noembed, noframes and plaintext too, long out of use but read so by a browser still. */
const RAW = new Set(['script', 'style', 'template', 'noscript', 'textarea', 'title', 'xmp', 'noembed', 'noframes', 'plaintext']);
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;

/** A tag's attributes, each with where its value is: [start, end) in the stored value, and its quote. */
function parseAttrs(src, base) {
  const out = [];
  for (const m of src.matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (out.some((a) => a.name === name)) continue; // the first one counts, as in a browser
    const g = m[2] !== undefined ? 2 : m[3] !== undefined ? 3 : m[4] !== undefined ? 4 : 0;
    if (!g) {
      out.push({ name, value: '', start: -1, end: -1, quote: null });
      continue;
    }
    const [s, e] = m.indices[g];
    out.push({ name, value: decodeHtml(m[g]), start: base + s, end: base + e, quote: g === 2 ? '"' : g === 3 ? "'" : '' });
  }
  return out;
}

/**
 * The markup as a tree that remembers where everything is. An element is
 * `{ tag, attrs, children, parent, start, end, innerStart, innerEnd }`; text is
 * `{ text, start, end }`, as stored. A closing tag closes what it names and
 * whatever is still open inside it - nothing more is guessed.
 */
export function parseMarkup(src) {
  const root = { tag: '#root', attrs: [], children: [], parent: null, start: 0, innerStart: 0 };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(src))) {
    const [all, slash, rawName, rest] = m;
    const start = m.index;
    const end = start + all.length;
    if (!rawName) {
      // <!-- … -->, and <!…> or <?…>, which a browser reads as a comment too.
      if (all[0] === '<' && all.length > 1) top().children.push({ comment: true, start, end, parent: top() });
      else top().children.push({ text: all, start, end, parent: top() });
      continue;
    }
    const tag = rawName.toLowerCase();
    if (slash) {
      const i = stack.findLastIndex((n) => n.tag === tag);
      if (i > 0) {
        for (let k = stack.length - 1; k > i; k--) Object.assign(stack[k], { innerEnd: start, end: start });
        Object.assign(stack[i], { innerEnd: start, end });
        stack.length = i;
      }
      continue;
    }
    const node = { tag, attrs: parseAttrs(rest, start + 1 + rawName.length), children: [], parent: top(), start, innerStart: end };
    top().children.push(node);
    if (RAW.has(tag)) {
      const close = src.toLowerCase().indexOf(`</${tag}`, end);
      const stop = close === -1 ? src.length : close;
      const gt = close === -1 ? src.length : src.indexOf('>', close) + 1 || src.length;
      Object.assign(node, { raw: src.slice(end, stop), innerEnd: stop, end: gt });
      TOKEN.lastIndex = gt;
      continue;
    }
    if (VOID.has(tag) || /\/\s*$/.test(rest)) {
      Object.assign(node, { innerEnd: end, end, void: true });
      continue;
    }
    stack.push(node);
  }
  for (const n of stack) Object.assign(n, { innerEnd: n.innerEnd ?? src.length, end: n.end ?? src.length });
  return root;
}

const attrOf = (el, name) => el.attrs?.find((a) => a.name === name);
const classes = (el) => (attrOf(el, 'class')?.value || '').split(/\s+/).filter(Boolean);
const walkAll = (el, fn) => {
  fn(el);
  for (const c of el.children || []) if (c.tag) walkAll(c, fn);
};

/* ------------------------------------------------------------ the words */

/**
 * A path in the repository (spaces and all - DAM names have them), an anchor
 * or a colour, a bare link: never words, whatever letters are in it. "Tel: 0860
 * 726 7864" and "www.samsung.com has every offer" are words. core.js reads
 * fields with it too.
 */
export const LINK_OR_PATH = /^\/(content|conf|etc|apps|libs|var|mnt|bin)\/|^\/\S*$|^#[\w-]*$|^(https?|mailto|tel):\S*$|^www\.\S*$/i;

/**
 * Words a visitor reads: a letter, and not a path, a link, a class list or a
 * setting's word. One word counts when it reads as one - "Grey", "Active", a
 * size like "18.5g" or "55°C", any word in another script - and not "smooth",
 * "open", "h2" or "fit3", which a block's code uses as values. Not core.js's
 * test for a field's value: what is in a block's markup or a script's spot is
 * there to be read, so a button's "Yes" or "No" is words here.
 */
export function wordy(v) {
  const t = String(v).replace(/\s+/g, ' ').trim();
  if (!/\p{L}/u.test(t) || LINK_OR_PATH.test(t)) return false;
  if (/^(true|false|none|null|undefined|auto|inherit)$/i.test(t)) return false;
  const words = t.split(' ');
  if (words.length > 1) return !words.every((w) => /^[a-z\d]+(?:(?:--?|__?|\.)[a-z\d]+)+$/.test(w));
  if (/(?![a-zA-Z])\p{L}/u.test(t)) return true;
  return /^\p{Lu}/u.test(t) || /^\d[\d.,]*\s?°?\p{L}{1,4}$/u.test(t);
}

/**
 * A string in a script of the Body that reads like words it shows a visitor -
 * "View all 98'' TVs" - by its shape alone, since where it goes cannot be
 * told: two words or more, a capital or a letter outside plain ASCII, and not
 * a selector, a link, a media query or code.
 */
const shownByCode = (v) => {
  const t = v.trim();
  return /\s/.test(t) && /\p{L}{2}/u.test(t) && /\p{Lu}|(?![a-zA-Z])\p{L}/u.test(t) && wordy(t) && !/^[.#/[]|^https?:|=>|[{};=<>]|\((min|max)-/i.test(t);
};

/* ------------------------------------------------------------ Body (HTML) */

/** Tags that sit inside a sentence. */
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd',
  'mark', 'nobr', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr'
]);
/** Never read: code, pictures drawn in code, and what a script fills in. */
const SKIP = new Set([
  'script', 'style', 'svg', 'template', 'noscript', 'textarea', 'select', 'iframe', 'object', 'canvas', 'math', 'xmp', 'noembed', 'noframes', 'plaintext'
]);
/** Attributes whose words a visitor reads or hears. Of data-*, only these: a script may match on any other value. */
export const TEXT_ATTRS = [
  'alt', 'aria-label', 'aria-description', 'title', 'placeholder',
  'data-tooltip', 'data-title', 'data-label', 'data-caption', 'data-text'
];

/** A script of structured data - JSON-LD - whose text values are words search engines show: rows on the sheet. */
export const isLdJson = (el) => el.tag === 'script' && /^\s*application\/ld\+json\s*$/i.test(attrOf(el, 'type')?.value || '');
/**
 * The keys of JSON-LD whose value is words: a video's name and description, an
 * article's headline, a question's and an answer's text. The rest - @type, a
 * URL, a date, a duration, a count - is data, never translated.
 */
export const LD_TEXT_KEYS = new Set([
  'name', 'description', 'headline', 'alternativeHeadline', 'caption', 'text', 'abstract',
  'articleBody', 'reviewBody', 'disambiguatingDescription', 'slogan', 'award'
]);

/**
 * The text values of one JSON-LD script, each where it is in the stored value
 * to the character - the inside of its quotes - as units of kind 'ld'. Only a
 * string that is a key's value (after a ':'), for a key above, and words: not
 * a link, a path or a date. A script that is not JSON gives none: it is code,
 * and stays a developer's.
 */
function ldUnits(src, el) {
  try {
    JSON.parse(el.raw);
  } catch {
    return [];
  }
  const units = [];
  const toks = scriptTokens(el.raw).filter((t) => t.type === 'str');
  const before = (i) => el.raw.slice(0, i).trimEnd().slice(-1);
  const after = (i) => el.raw.slice(i).trimStart()[0];
  let key = null;
  let type = null;
  for (const t of toks) {
    const value = unescapeJs(t.raw);
    if (after(t.end + 1) === ':') {
      key = value;
      continue;
    }
    if (before(t.start - 1) !== ':') continue;
    if (key === '@type') type = value;
    if (!LD_TEXT_KEYS.has(key) || !wordy(value) || /^\d{4}-\d\d-\d\d/.test(value)) continue;
    units.push({
      kind: 'ld',
      name: key,
      schema: type,
      start: el.innerStart + t.start,
      end: el.innerStart + t.end,
      cell: showNbsp(trimWs(value.replace(WS, ' '))),
      owner: el,
      inside: null
    });
  }
  return units;
}

/** An inline tag with only words and inline tags in it. One with a comment is not: a comment ends a sentence wherever it is, so it is never shown to a translator as words. */
const flat = (el) => el.children.every((c) => c.text !== undefined || (c.tag && INLINE.has(c.tag) && flat(c)));

/**
 * The units of a Body (HTML) value, in the order they are stored, each with
 * `start` and `end` in the value: { kind: 'text', cell, owner, html } or
 * { kind: 'attr', name, cell, quote, owner, inside } - `inside` is the sentence
 * an attribute's tag sits in. `all` adds the attributes whose words fail the
 * word test ("argent"), each marked `weak`: never rows, but what a block reads
 * now, to look a translation up in.
 *
 * `report` is what is not a unit but matters to someone: the Body's own
 * scripts and styles, and in `codeWords` the words they may show a visitor -
 * a script's "98'' TVs or larger", a style's content: "or more" - which stay
 * as they are, for a developer to change; empty slots, links, images, a
 * left-or-right layout.
 */
export function readBody(src, { all = false } = {}) {
  src = String(src ?? '');
  const root = parseMarkup(src);
  const units = [];
  const report = {
    scripts: [], styles: [], codeWords: [], emptySlots: [], links: [], images: [], videos: 0, rtl: [], cssContent: [], partOfSentence: []
  };
  walkAll(root, (el) => {
    // Structured data: its words are rows (see ldUnits); its code - the rest of it - is nobody's to translate.
    if (isLdJson(el)) {
      const ld = ldUnits(src, el);
      units.push(...ld);
      if (ld.length) return;
    }
    if (el.tag === 'script') report.scripts.push(el.raw);
    if (el.tag === 'style') report.styles.push(el.raw);
    if (el.tag === 'video') report.videos++;
  });
  const readable = (name, el) =>
    TEXT_ATTRS.includes(name) || (name === 'value' && el.tag === 'input' && /^(submit|button|reset)$/i.test(attrOf(el, 'type')?.value || ''));
  const attrUnits = (el, inside = null) => {
    for (const a of el.attrs) {
      if (!readable(a.name, el) || a.start < 0) continue;
      const weak = !wordy(a.value);
      // The word test decides what goes on the sheet; a weak one is only looked at.
      if (weak && (!all || !trimWs(a.value))) continue;
      const cell = showNbsp(trimWs(a.value.replace(WS, ' ')));
      units.push({ kind: 'attr', name: a.name, start: a.start, end: a.end, quote: a.quote, cell, owner: el, inside, weak });
    }
  };
  const attrUnitsDeep = (el, inside = null) => walkAll(el, (d) => attrUnits(d, inside));
  const hasWords = (n) =>
    n.text !== undefined
      ? /[\p{L}\d]/u.test(n.text)
      : n.tag && n.tag !== 'img' && n.tag !== 'br' && /[\p{L}\d]/u.test(wordsOf(src.slice(n.start, n.end)));
  const blank = (n) => (n.text !== undefined && !trimWs(n.text)) || n.comment;

  /**
   * A run of text and inline tags: one sentence, unless it has no words. Links
   * side by side with nothing but space between them are buttons, each a text
   * of its own; so are the parts of a run that is no words as a whole but whose
   * parts each read as words - the ends of a scale, "1.1m" and "2.5m".
   */
  const flushRun = (parent, run) => {
    if (!run.length) return;
    let s = run[0].start;
    let e = run[run.length - 1].end;
    const plain = wordsOf(src.slice(s, e));
    const words = wordy(plain) || /\p{L}{2}/u.test(plain);
    let nodes = run.filter((n) => !blank(n));
    if (nodes.length > 1 && (!words || nodes.every((n) => n.tag === 'a'))) {
      for (const n of nodes) flushRun(parent, [n]);
      return;
    }
    if (!words) {
      for (const n of run) if (n.tag) attrUnitsDeep(n);
      return;
    }
    let owner = parent;
    // A run that is one inline tag (a lone <span>, <a>) is that tag's words: the tag itself stays the page's.
    while (nodes.length === 1 && nodes[0].tag && nodes[0].tag !== 'br' && nodes[0].tag !== 'img') {
      const w = nodes[0];
      attrUnits(w);
      owner = w;
      s = w.innerStart;
      e = w.innerEnd;
      nodes = w.children.filter((n) => !blank(n));
    }
    while (s < e && /[ \t\r\n\f]/.test(src[s])) s++;
    while (e > s && /[ \t\r\n\f]/.test(src[e - 1])) e--;
    const cell = cellText(src.slice(s, e));
    const u = { kind: 'text', start: s, end: e, cell, owner, html: /<|&[#a-z\d]+;/i.test(cell) };
    units.push(u);
    // A title, an alt or an aria-label on a tag inside the sentence: a unit of its own.
    for (const n of nodes) if (n.tag) attrUnitsDeep(n, u);
  };
  /* An <img> stays in the sentence only with words on both sides of it (an icon
   * between words); anywhere else it ends the sentence, and its alt is its own. */
  const flush = (parent, run) => {
    let seg = [];
    run.forEach((n, i) => {
      if (n.tag !== 'img') {
        seg.push(n);
        return;
      }
      if (seg.some(hasWords) && run.slice(i + 1).some(hasWords)) {
        seg.push(n);
        return;
      }
      flushRun(parent, seg);
      seg = [];
      attrUnits(n);
    });
    flushRun(parent, seg);
  };
  const walk = (el) => {
    let run = [];
    for (const c of el.children) {
      if (c.comment) {
        flush(el, run);
        run = [];
      } else if (c.text !== undefined || (INLINE.has(c.tag) && flat(c)) || c.tag === 'img') {
        run.push(c);
      } else {
        // A block element with words on both sides cuts a sentence in two: reported, so it can be looked at.
        if (
          run.some(hasWords) &&
          /[\p{L}\d]/u.test(wordsOf(src.slice(c.end, el.innerEnd ?? c.end))) &&
          !/^(div|p|h[1-6]|ul|ol|li|dl|dt|dd|section|picture|figure|table|button|form)$/.test(c.tag)
        ) {
          report.partOfSentence.push(`<${c.tag}>`);
        }
        flush(el, run);
        run = [];
        visit(c);
      }
    }
    flush(el, run);
  };
  const visit = (el) => {
    if (SKIP.has(el.tag)) return;
    attrUnits(el);
    if (!el.void && !el.children.some((c) => c.tag || (c.text && trimWs(c.text))) && /^(p|h[1-6]|li|dd)$/.test(el.tag) && classes(el).length) {
      report.emptySlots.push(`<${el.tag} class="${classes(el).join(' ')}">`);
    }
    walk(el);
  };
  walk(root);
  units.sort((a, b) => a.start - b.start);

  for (const css of report.styles) for (const m of css.matchAll(/content\s*:\s*(["'])((?:(?!\1).)*)\1/g)) report.cssContent.push(m[2]);
  for (const js of report.scripts) {
    for (const t of scriptTokens(js)) if (t.type === 'str' && shownByCode(unescapeJs(t.raw))) report.codeWords.push(unescapeJs(t.raw).trim());
  }
  for (const v of report.cssContent) if (wordy(v)) report.codeWords.push(v.trim());
  for (const m of src.matchAll(/\bhref\s*=\s*"\s*([^"\s]+)|location\.href\s*=\s*'([^']+)'/g)) report.links.push(m[1] || m[2]);
  for (const m of src.matchAll(/<(?:img|source)\b[^>]*?\b(?:data-src|srcset|src)\s*=\s*"\s*([^"\s]+)/g)) report.images.push(m[1]);
  for (const css of report.styles) {
    for (const m of css.matchAll(/(?:^|[;{\s])((?:left|right)\s*:\s*[^;]+|text-align\s*:\s*(?:left|right))/g)) report.rtl.push(m[1].trim());
  }
  for (const js of report.scripts) for (const m of js.matchAll(/"Arrow(Right|Left)"/g)) report.rtl.push(m[0]);
  return { root, units, report };
}

/* ------------------------------------------------- where a unit is, and notes */

const textOfEl = (src, el) => wordsOf(src.slice(el.innerStart, el.innerEnd));

function byId(root, id) {
  let hit = null;
  walkAll(root, (el) => {
    if (!hit && attrOf(el, 'id')?.value === id) hit = el;
  });
  return hit;
}

/** The tab that shows an element: by aria-labelledby, or a tab whose aria-controls or data-* names its id. */
function tabFor(root, el) {
  const id = attrOf(el, 'id')?.value;
  const labelledBy = attrOf(el, 'aria-labelledby')?.value;
  if (labelledBy) {
    const t = byId(root, labelledBy);
    if (t && attrOf(t, 'role')?.value === 'tab') return t;
  }
  if (!id) return null;
  let hit = null;
  walkAll(root, (t) => {
    if (hit || attrOf(t, 'role')?.value !== 'tab') return;
    if (t.attrs.some((a) => (a.name === 'aria-controls' || a.name.startsWith('data-')) && a.value === id)) hit = t;
  });
  return hit;
}

/** What a text is, by a class it or a tag above it has. */
const KIND_BY_CLASS = [
  [/strapline|eyebrow|kicker/, 'Eyebrow (small line above the title)'],
  [/sub-?(title|headline|heading)/, 'Sub-headline'],
  [/colou?r/, 'Colour name'],
  [/price/, 'Price'],
  [/key-icon/, 'Icon label'],
  [/desc/, 'Description']
];

const ATTR_KIND = {
  alt: 'Image alt text',
  'aria-description': 'Screen-reader description',
  title: 'Hover text (title)',
  placeholder: 'Placeholder in a field',
  'data-tooltip': 'Tooltip (shown on hover)',
  value: 'Button text'
};

function kindOf(u) {
  if (u.kind === 'ld') return `Search engine data (${u.schema ? `${u.schema} ` : ''}${u.name})`;
  if (u.kind === 'attr') {
    if (u.name === 'aria-label') {
      if (u.owner.tag === 'video') return 'Video description (screen reader)';
      return u.owner.tag === 'button' ? 'Button label (screen reader)' : 'Screen-reader label';
    }
    return ATTR_KIND[u.name] || `Shown by the block's script (${u.name})`;
  }
  for (let el = u.owner; el && el.tag !== '#root'; el = el.parent) {
    for (const c of classes(el)) for (const [re, label] of KIND_BY_CLASS) if (re.test(c)) return label;
    if (el.tag === 'button' && attrOf(el, 'role')?.value === 'tab') return 'Tab label';
    if (/^h[12]$/.test(el.tag)) return 'Headline';
    if (/^h[3-6]$/.test(el.tag)) return 'Heading';
    if (el.tag === 'button' || el.tag === 'a') return 'Button / link text';
    if (el.tag === 'dt') return 'Spec label';
    if (el.tag === 'dd') return 'Spec value';
    if (el.tag === 'li') return 'List item';
    if (el.tag === 'p') return 'Paragraph';
    if (el.tag === 'label') return 'Form label';
  }
  return 'Text';
}

/** Kinds a page has little room for. A colour dot's tooltip too (see context). */
const SHORT = new Set([
  'Tab label', 'Button / link text', 'Spec label', 'Spec value', 'Colour name', 'Icon label', 'Eyebrow (small line above the title)', 'Button text'
]);

/** The tag rule for a sentence, said once per row: only the parts its tags need. */
function tagRule(cell) {
  const names = [...cell.matchAll(TAG)].filter((m) => !m[1]).map((m) => m[2].toLowerCase());
  if (!names.length) return null;
  let rule = 'Keep every tag. You may move a tag to suit your word order, but not into or out of another tag.';
  if (names.some((n) => n === 'br' || n === 'wbr')) rule += ' A <br> may move or go, never be added.';
  if (names.includes('a')) rule += " Do not change link addresses; the page's own link is kept.";
  return rule;
}

/**
 * Where a unit is, as a person finds it on the page - `where`, outermost
 * first: Tab "Active", Card "Galaxy Fit3", Details overlay - what it is
 * (`kind`), and what a translator should know: `notes` about the text, true
 * wherever it is - its tag rule, its numbers - and `hints` about this place
 * of it - a hidden tab, an overlay, a short label. `unquoted` marks an
 * attribute stored without quotes, `singleQuoted` one stored in single quotes.
 */
export function context(src, root, u) {
  const where = [];
  const hints = [];
  for (let el = u.owner; el && el.tag !== '#root'; el = el.parent) {
    const role = attrOf(el, 'role')?.value;
    const cls = classes(el);
    const tab = tabFor(root, el);
    if (role === 'tablist') where.unshift('Tab bar');
    else if (role === 'tabpanel' || tab) {
      const name = tab ? textOfEl(src, tab) : attrOf(el, 'id')?.value;
      where.unshift(role === 'tabpanel' ? `Tab "${name}"` : `Intro of tab "${name}"`);
      if (!(tab && attrOf(tab, 'aria-selected')?.value === 'true')) hints.push(`Hidden until the visitor clicks the "${name}" tab`);
    } else if (cls.some((c) => /(^|-)(overlay|modal|popup|dialog|drawer)$/.test(c) && !/fade/.test(c))) {
      where.unshift('Details overlay');
      hints.push('In an overlay that opens on click');
    } else if (cls.some((c) => /^card(--[\w-]+)?$/.test(c))) {
      let heading = null;
      walkAll(el, (d) => {
        if (!heading && /^h[2-6]$/.test(d.tag)) heading = textOfEl(src, d);
      });
      where.unshift(cls.includes('card--intro') ? 'Intro card' : `Card "${heading || attrOf(el, 'id')?.value || '?'}"`);
    }
  }
  // A title or an alt on a tag inside a sentence: named after the sentence it is in - "Sub-headline › Hover text (title)".
  if (u.inside) where.push(kindOf(u.inside));
  const kind = kindOf(u);
  const words = wordsOf(u.cell);
  const rule = u.kind === 'text' && u.html ? tagRule(u.cell) : null;
  // A tooltip on a colour dot - the dot or a tag around it says colour or swatch - is a colour's name.
  let colour = false;
  if (u.kind === 'attr' && u.name === 'data-tooltip') {
    for (let el = u.owner; el && el.tag !== '#root' && !colour; el = el.parent) colour = classes(el).some((c) => /colou?r|swatch|chip/i.test(c));
    hints.push(colour ? 'Shown when the visitor points at a colour dot' : 'Shown when the visitor points at it');
  }
  if (u.kind === 'ld') hints.push('Not shown on the page - search engines read it (structured data). Keep it true to what it describes');
  return {
    where,
    kind,
    notes: [...(rule ? [rule] : ['Words only - no markup']), ...wordNotes(words)],
    hints: [...hints, ...kindNotes(words, kind, colour)],
    unquoted: u.kind === 'attr' && u.quote === '',
    singleQuoted: u.kind === 'attr' && u.quote === "'"
  };
}

/** What a translator should know from the words themselves, wherever they are. */
function wordNotes(words) {
  const notes = [];
  const numbers = words.match(/\d[\d.,]*\s?(?:°C|°F|mAh|mm|cm|m|g|kg|nm|GB|TB|ATM|days|hours|%)(?![\p{L}])/gu);
  if (numbers) notes.push(`Numbers and units: ${[...new Set(numbers)].join(', ')} - use your market's format`);
  const handles = words.match(/[@#][\p{L}\d_]{3,}/gu);
  if (handles) notes.push(`Keep ${handles.join(', ')} as written`);
  return notes;
}

/** What a translator should know from what the words are in one place: a short label, a colour's name. */
function kindNotes(words, kind, colour = false) {
  const notes = [];
  if (SHORT.has(kind) || colour) notes.push(`Short label: ${words.length} characters in English - keep it short`);
  if (kind === 'Colour name' || colour) notes.push("Use the market's official colour name");
  return notes;
}

/* ---------------------------------------------------- Footer (JavaScript) */

/*
 * Text in a script is read by where a string sits, never by its shape:
 *   - a data field whose name says text - title, text, heading, description,
 *     caption, label, badge, *Alt, *Text, *Title… - and every string of an
 *     array under such a name (bentoAlt: ["…", "…"]);
 *   - the argument of a text-node call: document.createTextNode("…"), or a
 *     function the bundle wraps around it (V("…"));
 *   - the value of setAttribute("aria-label" | "title" | "alt" | "placeholder", "…"),
 *     or of a function the bundle wraps around it (u(x, "aria-label", "…"));
 *   - .textContent / .innerText / .title / .ariaLabel / .placeholder / .alt = "…".
 * A template with words in it is a sentence the code builds.
 */

const DATA_KEY = new RegExp(
  '^(title|text|heading|headline|subtitle|subheading|description|desc|caption|label|badge|alt|eyebrow|tooltip|message|cta_?text|button_?text)$' +
    '|[a-z](Alt|Text|Title|Label|Heading|Headline|Caption|Desc|Description|Tooltip)s?$'
);
const ATTR_NAMES = new Set(['aria-label', 'title', 'alt', 'placeholder', 'aria-description']);
const PROP_SET = /\.(textContent|innerText|title|ariaLabel|placeholder|alt)\s*=\s*$/;

/** Every string and template in a script, with where its inside is; comments and regular expressions skipped. */
function scriptTokens(js) {
  const out = [];
  const stack = [];
  let i = 0;
  let prevSig = '';
  while (i < js.length) {
    const c = js[i];
    if (c === '/' && js[i + 1] === '/') {
      i = js.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (c === '/' && js[i + 1] === '*') {
      i = js.indexOf('*/', i + 2);
      if (i === -1) break;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < js.length && js[j] !== c) j += js[j] === '\\' ? 2 : 1;
      out.push({ type: 'str', quote: c, start: i + 1, end: j, raw: js.slice(i + 1, j), bracket: stack[stack.length - 1] || null });
      prevSig = 'str';
      i = j + 1;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      const parts = [];
      let partStart = j;
      while (j < js.length && js[j] !== '`') {
        if (js[j] === '\\') {
          j += 2;
          continue;
        }
        if (js[j] === '$' && js[j + 1] === '{') {
          parts.push({ text: js.slice(partStart, j) });
          let depth = 1;
          let k = j + 2;
          while (k < js.length && depth) {
            if (js[k] === '{') depth++;
            else if (js[k] === '}') depth--;
            else if (js[k] === '"' || js[k] === "'") {
              const q = js[k];
              k++;
              while (k < js.length && js[k] !== q) k += js[k] === '\\' ? 2 : 1;
            }
            k++;
          }
          parts.push({ expr: js.slice(j + 2, k - 1) });
          j = k;
          partStart = j;
          continue;
        }
        j++;
      }
      parts.push({ text: js.slice(partStart, j) });
      out.push({ type: 'template', start: i + 1, end: j, raw: js.slice(i + 1, j), parts });
      prevSig = 'str';
      i = j + 1;
      continue;
    }
    // A "/" where a value is expected starts a regular expression, not a division.
    if (c === '/' && (/[(,=:[!&|?{};]$/.test(prevSig) || prevSig === '' || /^(return|typeof)$/.test(prevSig))) {
      let j = i + 1;
      let inClass = false;
      while (j < js.length && (js[j] !== '/' || inClass)) {
        if (js[j] === '\\') j++;
        else if (js[j] === '[') inClass = true;
        else if (js[j] === ']') inClass = false;
        else if (js[j] === '\n') break;
        j++;
      }
      i = j + 1;
      prevSig = 'regex';
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < js.length && /[\w$]/.test(js[j])) j++;
      prevSig = js.slice(i, j);
      i = j;
      continue;
    }
    if (c === '[' || c === '{' || c === '(') {
      const callee = c === '(' ? js.slice(Math.max(0, i - 60), i).match(/([A-Za-z_$][\w$.]*)\s*$/)?.[1].split('.').pop() : null;
      stack.push({ ch: c, callee: callee || null, at: i });
    }
    if (c === ']' || c === '}' || c === ')') stack.pop();
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out;
}

/** A string's value: what its escapes stand for. */
const unescapeJs = (s) =>
  s.replace(/\\(u\{[\da-f]+\}|u[\da-f]{4}|x[\da-f]{2}|.)/gis, (m, e) => {
    if (/^u\{/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (/^[ux]/i.test(e) && e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[e] ?? e;
  });

/** The functions a bundle defines around createTextNode and setAttribute: V and u in a Svelte build. */
function wrappers(js) {
  const text = new Set(['createTextNode']);
  const attr = new Set(['setAttribute']);
  for (const m of js.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{([^{}]{0,200})\}/g)) {
    if (/createTextNode\(/.test(m[2])) text.add(m[1]);
    if (/setAttribute\(/.test(m[2])) attr.add(m[1]);
  }
  return { text, attr };
}

/**
 * A ${…} that is one choice between two strings - `open ? "Close" : "Open"` -
 * as { test, yes, no }; null for any other, a choice inside a choice too:
 * `a ? "Pause" : b ? "Close" : "Open"` makes three sentences, not two.
 */
function oneChoice(expr) {
  const m = expr.match(/^([^?:]*)\?\s*(["'])((?:(?!\2).)*)\2\s*:\s*(["'])((?:(?!\4).)*)\4\s*$/);
  return m ? { test: m[1].trim(), yes: m[3], no: m[5] } : null;
}

/** The line a place in a value is on, counting from 1. */
export const lineOf = (s, i) => String(s).slice(0, i).split(/\r\n|\r|\n/).length;

// A string that is only a comment of code - /* … */, // …, <!-- … --> - never words a visitor reads.
const CODE_COMMENT = /^\s*(?:\/\*[\s\S]*\*\/|\/\/.*|<!--[\s\S]*-->)\s*$/;

/** A word of CSS, not of a sentence: a number with its unit, an animation's or a layout's keyword. */
const CSS_WORD =
  /^(?:-?\d*\.?\d+(?:ms|s|px|r?em|vh|vw|vmin|vmax|%|deg|fr|ch)?|ms|s|px|r?em|vh|vw|%|deg|linear|ease(?:-in|-out|-in-out)?|both|forwards|backwards|infinite|alternate(?:-reverse)?|normal|reverse|running|paused|none|auto|solid|dashed|dotted|inherit|initial|important|cubic-bezier|steps|translate[xyz3d]*|rotate[xyz]?|scale[xyz]?|opacity|transform)$/i;

/**
 * A template whose text is CSS or code, not a sentence: "${n}${k} ${t}ms
 * linear ${d}ms 1 both", an animation put together. What is left once its
 * CSS words are taken out is not two words - or its ${…} outnumber them.
 */
function codeTemplate(parts) {
  const words = parts
    .filter((p) => 'text' in p)
    .flatMap((p) => p.text.split(/[\s,()]+/))
    .filter((w) => w && !CSS_WORD.test(w));
  return words.length < 2 || parts.filter((p) => !('text' in p)).length > words.length;
}

/**
 * The words a Footer (JavaScript) value shows, in the order they are stored:
 * `units`, each { kind: 'script', how, name, start, end, quote, cell, line,
 * tile } - `how` is 'data', 'text-call', 'attr-call' or 'prop'; `tile` the
 * title of the data object it is in - and `built`, each sentence a template
 * builds: { start, end, line, code, parts, sentences } - `parts` its words
 * and its ${…} in order, each { text } or { expr }.
 */
export function readScript(js) {
  js = String(js ?? '');
  const tokens = scriptTokens(js);
  const { text, attr } = wrappers(js);
  const units = [];
  const built = [];
  /** The names of the objects a string is in, innermost last: ["tiles", "energy"]. */
  const objectPath = (t) => {
    const keys = [];
    const before = js.slice(0, t.start - 1);
    let depth = 0;
    for (let k = before.length - 1; k >= 0 && keys.length < 3; k--) {
      const ch = before[k];
      if (ch === '}' || ch === ']' || ch === ')') depth++;
      else if (ch === '{' || ch === '[' || ch === '(') {
        if (depth) depth--;
        else {
          const km = before.slice(Math.max(0, k - 60), k).match(/([A-Za-z_$][\w$]*)\s*[:=]\s*$/);
          if (km && ch === '{') keys.unshift(km[1]);
        }
      }
    }
    return keys;
  };
  tokens.forEach((t, n) => {
    if (t.type === 'template') {
      const statics = t.parts.filter((p) => 'text' in p).map((p) => p.text).join(' ');
      if (/[{};<]/.test(statics) || !/\p{L}{2,}\s+\p{L}{2,}/u.test(statics) || codeTemplate(t.parts)) return;
      // `${x ? "Close" : "Open"} showcase container` builds two whole sentences; any other value stays {…} (see oneChoice).
      let sentences = [''];
      for (const p of t.parts) {
        if ('text' in p) sentences = sentences.map((v) => v + p.text);
        else {
          const choice = oneChoice(p.expr);
          sentences = choice ? sentences.flatMap((v) => [v + choice.yes, v + choice.no]) : sentences.map((v) => `${v}{…}`);
        }
      }
      built.push({
        start: t.start,
        end: t.end,
        line: lineOf(js, t.start),
        code: `\`${t.raw}\``,
        parts: t.parts,
        sentences: sentences.map((v) => v.replace(/\s+/g, ' ').trim())
      });
      return;
    }
    const value = unescapeJs(t.raw);
    if (!wordy(value) || CODE_COMMENT.test(value)) return;
    const before = js.slice(Math.max(0, t.start - 120), t.start - 1);
    let how = null;
    let name = null;
    const key = before.match(/([A-Za-z_$][\w$]*)\s*:\s*$/);
    if (key && DATA_KEY.test(key[1])) [how, name] = ['data', key[1]];
    else if (t.bracket?.ch === '[' && /[[,]\s*$/.test(before)) {
      const list = js.slice(Math.max(0, t.bracket.at - 60), t.bracket.at).match(/([A-Za-z_$][\w$]*)\s*:\s*$/);
      if (list && DATA_KEY.test(list[1])) [how, name] = ['data', list[1]];
    }
    if (!how && t.bracket?.ch === '(' && text.has(t.bracket.callee) && /\(\s*$/.test(before)) how = 'text-call';
    if (!how && t.bracket?.ch === '(' && attr.has(t.bracket.callee)) {
      const prev = tokens[n - 1];
      if (prev?.type === 'str' && ATTR_NAMES.has(prev.raw) && /^\s*,\s*$/.test(js.slice(prev.end + 1, t.start - 1))) [how, name] = ['attr-call', prev.raw];
    }
    if (!how && PROP_SET.test(before)) [how, name] = ['prop', before.match(PROP_SET)[1]];
    if (!how) return;
    const path = how === 'data' ? objectPath(t) : [];
    units.push({ kind: 'script', how, name, path, start: t.start, end: t.end, quote: t.quote, line: lineOf(js, t.start), cell: showNbsp(value) });
  });
  for (const u of units) {
    if (u.how === 'data') u.tile = units.find((x) => x.how === 'data' && x.name === 'title' && x.path.join('.') === u.path.join('.'))?.cell;
  }
  return { units, built };
}

/** A script's string, named the way the Body's are: by what its spot is for. First match wins. */
const SCRIPT_KIND = [
  [/^(aria-label|ariaLabel)$/, 'Screen-reader label'],
  [/alt$/i, 'Image alt text'],
  [/(cta|button)_?text$/i, 'Button text'],
  [/title$/i, 'Title'],
  [/head(line|ing)$/i, 'Headline'],
  [/desc(ription)?$/i, 'Description'],
  [/tooltip$/i, 'Tooltip (shown on hover)'],
  [/^(text|textContent|innerText)$/, 'Text']
];

/**
 * Where a string of the script is, and what a translator should know about it
 * - as context() does for the Body. `quote` is the quote the string is in,
 * which the developer escapes in a translation.
 */
export function scriptContext(u) {
  const kind =
    u.how === 'text-call' ? 'Text the script shows' : SCRIPT_KIND.find(([re]) => re.test(u.name))?.[1] || u.name.charAt(0).toUpperCase() + u.name.slice(1);
  const where = [`Footer script, line ${u.line}`];
  if (u.tile) where.push(`Tile "${u.tile}"`);
  const words = wordsOf(u.cell);
  return {
    where,
    // The name in the code too, for the developer who puts it in - unless it says no more than the kind: "Title", not "Title (title)".
    kind: u.name && u.name.toLowerCase() !== kind.toLowerCase() ? `${kind} (${u.name})` : kind,
    notes: [...(/<[a-z]/i.test(u.cell) ? [] : ['Words only - no markup']), ...wordNotes(words)],
    hints: kindNotes(words, kind),
    quote: u.quote
  };
}

/**
 * Where a sentence the script builds is: the line of the template that builds
 * it. The developer puts it in as a string in double quotes.
 */
export function builtContext(t) {
  return {
    where: [`Footer script, line ${t.line}`],
    kind: 'Built sentence',
    notes: ['Words only - no markup'],
    hints: ['The code builds this sentence - write the whole sentence'],
    quote: '"'
  };
}

/* --------------------------------------------------------------- a block */

/**
 * A block's name, as the page shows it: its first h1-h3, else its first text.
 * A block whose Body has none is named after its script's first title -
 * "Showcase (script) · Energy Score" - or, without one, "Script only"; a block
 * with neither is "No text".
 */
export function blockName(body, script, footer = '') {
  let heading = null;
  const look = (el) => {
    if (heading || SKIP.has(el.tag)) return;
    if (/^h[1-3]$/.test(el.tag)) heading = textOfEl(body.src, el);
    else for (const c of el.children || []) if (c.tag) look(c);
  };
  look(body.root);
  const first = heading || wordsOf(body.units.find((u) => u.kind === 'text')?.cell ?? '') || wordsOf(body.units[0]?.cell ?? '');
  if (first) return first;
  const title = script.units.find((u) => u.how === 'data' && u.name === 'title')?.cell;
  if (title) return `Showcase (script) · ${wordsOf(title)}`;
  return script.units.length || script.built.length || trimWs(footer) ? 'Script only' : 'No text';
}

/** A Static Content block, read: its Body's units, its Footer's, and its name. */
export function readBlock(node) {
  const src = typeof node?.bodyHtml === 'string' ? node.bodyHtml : '';
  const footer = typeof node?.footerInclude === 'string' ? node.footerInclude : '';
  const body = { src, ...readBody(src) };
  const script = readScript(footer);
  return { body, script, name: blockName(body, script, footer) };
}

/**
 * A block's texts for the sheet: one entry per distinct cell, Body (HTML)
 * first, then Footer (JavaScript), each in the order it is stored - `prop`
 * says which - with `places`, every place the cell is in as { where, kind,
 * notes, hints } (see context). The same words twice in a block - "Grey" a
 * colour's name and its tooltip - are one entry: one translation, put in both
 * places. A sentence two templates build has a place for each.
 */
export function blockTexts(block) {
  const out = [];
  const byCell = new Map();
  const put = (prop, cell, place) => {
    const id = `${prop}\n${cell}`;
    if (!byCell.has(id)) {
      byCell.set(id, { prop, cell, places: [] });
      out.push(byCell.get(id));
    }
    byCell.get(id).places.push(place);
  };
  for (const u of block.body.units) put('bodyHtml', u.cell, context(block.body.src, block.body.root, u));
  const script = [...block.script.units, ...block.script.built].sort((a, b) => a.start - b.start);
  for (const s of script) {
    if (s.sentences) for (const sentence of s.sentences) put('footerInclude', sentence, builtContext(s));
    else put('footerInclude', s.cell, scriptContext(s));
  }
  return out;
}

/**
 * Every text a Body (HTML) or a Footer (JavaScript) value holds now, as
 * `<text|words>\n<shape>` (see shapesOf) - what a translation is looked up
 * in, to tell one put in already from one not found. Wider than the rows: the
 * words of an attribute that fail the word test ("argent"), and every string
 * of a script wherever it sits - a developer may put a sentence the script
 * built in as two plain strings, `open ? "Fermer la vitrine" : "Ouvrir la
 * vitrine"`, or a title as one lowercase word.
 */
export function textsNow(value, prop) {
  const now = new Set();
  if (typeof value !== 'string') return now;
  if (prop === 'footerInclude') {
    for (const t of scriptTokens(value)) if (t.type === 'str') now.add(`words\n${shapeOf(cellOf(unescapeJs(t.raw), 'words'))}`);
    for (const b of readScript(value).built) for (const sentence of b.sentences) now.add(`words\n${shapeOf(sentence)}`);
  } else {
    for (const u of readBody(value, { all: true }).units) now.add(`${u.kind === 'text' ? 'text' : 'words'}\n${shapeOf(u.cell)}`);
  }
  return now;
}

/* ---------------------------------------------- putting translations back */

/*
 * DSY never writes a block. For each one the import prepares its new Body
 * (HTML) whole, for the web team to paste over the old one: every translation
 * goes where the reader found its text - by position, never found again by
 * search - and everything else, the page's own tags included, stays byte for
 * byte. The value is checked three ways before it is offered (see verify).
 * The Footer is a developer's: a list, line by line (see developerList).
 * After the paste, pasteStatus and footerStatus say where a block stands,
 * read only.
 */

/** U+2028 and U+2029, which end a line in a script - in a string too. Made from their codes: as they are, either would end a line of this file. */
const LS = String.fromCharCode(0x2028);
const LINE_SEPARATORS = new RegExp(`[${LS}${String.fromCharCode(0x2029)}]`, 'g');

/** An attribute's value: both quotes and > escaped too, always - so one stored in single quotes, or in none, is as safe as one in double. */
export const escapeAttr = (s) => escapeText(s).replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * A string of a script: its codes turned into the characters they stand for
 * first - a script shows "&nbsp;" as it is written, not as a space - then
 * whatever would end the string or the script escaped: a backslash, the
 * string's own quote, a line break, U+2028 and U+2029, and the "</" and
 * "<!--" a page reads as the end of its <script>.
 */
export function escapeScript(s, quote) {
  const q = quote || '"';
  return decodeHtml(s)
    .replace(/\\/g, '\\\\')
    .split(q)
    .join(`\\${q}`)
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(LINE_SEPARATORS, (c) => (c === LS ? '\\u2028' : '\\u2029'))
    .replace(/<\//g, '<\\/')
    .replace(/<!--/g, '<\\!--');
}

/** What the import says of a static text - on its review screen and in a block's own list alike. */
export const ALREADY_IN_BLOCK = 'The block already has this translation.';
export const NOT_IN_BLOCK =
  'Not found: the block holds neither the English nor this translation. If an earlier sheet was pasted, export the translated page again and correct that sheet.';
export const WORDS_ONLY = 'Words only - the English has no markup, so the translation cannot have any.';

/** One Key over several texts: the same words with another link or class, which the sheet cannot tell apart. */
export const sameWords = (n) => `The block has these words ${n} times now, each with another link or style - translate them by hand in the block.`;

/** A text in fewer or more places than at the export. */
export function placesNote(cell, was, now) {
  const words = wordsOf(cell);
  return `"${words.length > 60 ? `${words.slice(0, 59)}…` : words}": ${was} place${was === 1 ? '' : 's'} at export, ${now} now - look at the block.`;
}

/** Tags a translation may move or leave out, but never add. */
const LOOSE = new Set(['br', 'wbr']);

/**
 * A sentence's tags: each opening one - br and wbr aside, kept in `loose` as
 * { name, raw } - with where it is (`at`), its form as the cell shows it (see
 * cellTag), its closing tag, and the index of the one it sits in (`parent`,
 * -1 for none). A </br> is a <br>, as a browser reads it; a </wbr> is taken
 * for a <wbr> too.
 */
function tagsOf(s) {
  const opens = [];
  const loose = [];
  const stack = [];
  for (const m of String(s).matchAll(TAG)) {
    const name = m[2].toLowerCase();
    if (LOOSE.has(name)) {
      loose.push({ name, raw: m[0] });
      continue;
    }
    if (m[1]) {
      const i = stack.map((t) => t.name).lastIndexOf(name);
      if (i >= 0) {
        stack[i].close = m[0];
        stack.length = i;
      }
      continue;
    }
    const tag = {
      name,
      raw: m[0],
      at: m.index,
      form: cellTag(m[0]),
      close: null,
      parent: stack.length ? stack[stack.length - 1].index : -1,
      index: opens.length,
      void: VOID.has(name) || /\/\s*>$/.test(m[0])
    };
    opens.push(tag);
    if (!tag.void) stack.push(tag);
  }
  return { opens, loose };
}

/** The tags of a sentence that must be the page's own, byte for byte, as many times: all but br and wbr, in any order. */
const ownTags = (s) =>
  [...String(s).matchAll(TAG)]
    .filter((m) => !LOOSE.has(m[2].toLowerCase()))
    .map((m) => m[0])
    .sort()
    .join('\n');

/**
 * A tag of a translation that runs a script: a handler (on…=), or a link to a
 * script the page's own tag - a form the cell showed - does not have.
 */
function runsScript(m, forms) {
  const attrs = [...m[3].matchAll(ATTR)];
  if (attrs.some((a) => /^on/i.test(a[1]))) return true;
  if (forms.has(cellTag(m[0]))) return false;
  return attrs.some((a) => /^\s*(javascript|vbscript):/i.test(decodeHtml(a[2] ?? a[3] ?? a[4] ?? '').replace(/[\t\n\r]/g, '')));
}

/** A sentence's <br> or <wbr> tags, as tagsOf keeps them. */
const looseOf = (tags, name) => tags.loose.filter((x) => x.name === name);

/**
 * One sentence, translated, as it goes into the block. `live` is the sentence
 * as stored now - a title or an alt in it already translated - `cell` as the
 * sheet showed it, `text` the translation.
 *
 * Each tag of the translation is matched to the cell's by its form - its href
 * and class - so two links whose words swap places keep their own words; a
 * changed one only when it is the one tag of its name left, and the page's
 * link is kept. The page's own tag at that place is then written, byte for
 * byte, and the words between the tags are escaped (see escapeText). A <br>
 * or a <wbr> may move or go, never be added: the page's own, of the name the
 * translator wrote, goes where the translator put it.
 *
 * Returns { html, errors, notes, at }. Any error - a tag added, left out, not
 * closed, moved into or out of another tag, running a script, or two changed
 * tags that cannot be told apart; or the page's own code in the sentence not
 * read the way a browser reads it - sends the text back, and `html` is null.
 * A note is said with it. `at` is where in `html` each of the cell's tags
 * went, by its index.
 */
export function placeText(live, cell, text) {
  const C = tagsOf(cell);
  const L = tagsOf(live);
  const errors = [];
  const notes = [];
  /* A tag this reader could not read - a quote in it left open - is words to it,
   * but a browser may read it as a tag, a comment or the end of one: what is
   * really there cannot be told, so nothing is put in. */
  if (/<[a-zA-Z!?/]/.test(String(live).replace(TAG, ''))) {
    return { html: null, errors: ['The page’s code in this text cannot be read safely (a tag with a quote left open?) - translate it by hand in the block'], notes, at: [] };
  }
  if (C.opens.length !== L.opens.length || C.opens.some((c, i) => c.name !== L.opens[i].name)) {
    return { html: null, errors: ['The tags of this text on the page changed since the export - export the page again'], notes, at: [] };
  }
  const t = repairTags(text);
  const T = [...t.matchAll(TAG)];
  const opening = T.filter((m) => !m[1] && !LOOSE.has(m[2].toLowerCase()));
  // Each tag as the sheet showed it first; then a changed one, only when it is the one tag of its name left.
  const pick = new Map();
  const used = new Set();
  for (const m of opening) {
    const c = C.opens.find((x) => !used.has(x.index) && x.form === cellTag(m[0]));
    if (!c) continue;
    pick.set(m, c.index);
    used.add(c.index);
  }
  for (const m of opening) {
    if (pick.has(m)) continue;
    const name = m[2].toLowerCase();
    const left = C.opens.filter((x) => !used.has(x.index) && x.name === name);
    if (left.length === 1) {
      pick.set(m, left[0].index);
      used.add(left[0].index);
      notes.push(`${cellTag(m[0])} is not as on the sheet - the page’s own tag is kept`);
    } else if (left.length) {
      errors.push(`${cellTag(m[0])} was changed, and ${left.length} <${name}> tags are left - cannot tell which one it is`);
    } else {
      errors.push(`<${name}> is not in the English - a tag may be moved, not added`);
    }
  }
  for (const c of C.opens) if (!used.has(c.index)) errors.push(`${c.form} is missing from the translation`);
  const forms = new Set(C.opens.map((c) => c.form));
  for (const m of T) if (!m[1] && runsScript(m, forms)) errors.push(`${m[0].slice(0, 60)} runs a script - not allowed in a translation`);

  // The tags open at each point, each { name, k } - k the cell's tag it is, none for one already in error.
  const stack = [];
  const at = [];
  const loose = { br: 0, wbr: 0 };
  let html = '';
  let last = 0;
  for (const m of T) {
    html += escapeText(t.slice(last, m.index));
    last = m.index + m[0].length;
    const name = m[2].toLowerCase();
    if (LOOSE.has(name)) {
      // The page's own, in its order; one more than it has is an error below.
      const own = looseOf(L, name);
      html += own[Math.min(loose[name]++, own.length - 1)]?.raw ?? m[0];
      continue;
    }
    if (!m[1]) {
      const k = pick.get(m);
      const parent = stack.length ? stack[stack.length - 1].k : -1;
      if (k !== undefined && C.opens[k].parent !== parent) errors.push(`${C.opens[k].form} is now inside another tag - a tag may move, but not into or out of another tag`);
      if (k !== undefined) at[k] = html.length;
      html += k === undefined ? m[0] : L.opens[k].raw;
      const closed = k === undefined ? !VOID.has(name) && !/\/\s*>$/.test(m[0]) : !C.opens[k].void;
      if (closed) stack.push({ name, k });
      continue;
    }
    const open = stack.pop();
    if (open?.name !== name) {
      errors.push(`</${name}> closes a tag that is not open`);
      html += m[0];
    } else {
      html += open.k === undefined ? m[0] : (L.opens[open.k].close ?? '');
    }
  }
  html += escapeText(t.slice(last));
  if (stack.length) errors.push(`<${stack[stack.length - 1].name}> is opened but not closed`);
  for (const name of LOOSE) {
    const what = name === 'br' ? 'line breaks (<br>)' : '<wbr>';
    const own = looseOf(L, name).length;
    if (loose[name] > own) errors.push(`${loose[name]} ${what} in the translation, ${own} in the English - a <${name}> may move or go, never be added`);
    else if (loose[name] < own) notes.push(name === 'br' ? 'A line break (<br>) was left out - allowed' : 'A <wbr> was left out - allowed');
  }
  // Last, the other way round: every tag but br and wbr is the page's own, byte for byte, as many times.
  const H = tagsOf(html);
  if (!errors.length && (ownTags(html) !== ownTags(live) || [...LOOSE].some((name) => looseOf(H, name).length > looseOf(L, name).length))) {
    errors.push('The tags are not the page’s own - sent back to be safe');
  }
  return { html: errors.length ? null : html, errors, notes, at };
}

/** Markup, as written or as codes that become it: "&lt;b&gt;" is a <b> to a script that puts a tooltip on the page. */
const hasMarkup = (s) => /<\/?[a-zA-Z]/.test(s) || /<\/?[a-zA-Z]/.test(decodeHtml(s));

/**
 * Words as the inside of a JSON string in a <script>: JSON's own escapes, and
 * every < as \u003c so nothing in it can close the script - "</script>" in a
 * translation stays words. U+2028 and U+2029 escaped too.
 */
export const escapeLd = (text) =>
  JSON.stringify(String(text)).slice(1, -1).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** A translation as an attribute's value: escaped, and in quotes where the page stored the value without. */
const asAttr = (u, text) => (u.quote ? escapeAttr(text) : `"${escapeAttr(text)}"`);

/**
 * A block's Body (HTML) with the sheet's translations put in: the value the
 * web team pastes. `live` is the value as read now; `texts` the sheet's texts
 * of the block, each { cell, translation, places } - the cell as the sheet
 * showed it, and how many places it had at the export, if known.
 *
 * Every place of a text gets the same translation, where the reader found it
 * (see readBody): a sentence through placeText, the words of an attribute
 * escaped for it (see escapeAttr). A title or an alt on a tag inside a
 * sentence goes into the page's tag before the sentence is placed. A text that
 * cannot go into one of its places goes into none: it stays English in the
 * whole block, and the rest of the block is still prepared.
 *
 * Returns `value`; `items`, one per text in order, each the text with its
 * `status` - placed, same, untranslated, already (the block has the
 * translation; its English is gone), not found, or sent back (it stays
 * English) - its `message`, its `notes`, and in `warnings` what to look at in
 * the block; `notOnSheet`, the block's texts the sheet has neither a row nor
 * a translation for; and `placed`, where each translation went - a title or
 * an alt inside a sentence in the sentence's `nested` - for verify.
 */
export function prepareBody(live, texts) {
  live = String(live ?? '');
  const { units } = readBody(live);
  // A translation's line breaks as the block's own: CRLF, as AEM stores it, stays CRLF.
  const lineBreak = live.includes('\r\n') ? '\r\n' : '\n';
  const byShape = new Map();
  for (const u of units) byShape.set(shapeOf(u.cell), [...(byShape.get(shapeOf(u.cell)) || []), u]);
  let now = null;
  const onSheet = new Set();
  const translated = new Set();
  /** What goes into a unit: { text, item }. */
  const goes = new Map();
  const items = texts.map((x) => {
    const item = { ...x, cell: String(x.cell ?? ''), status: 'placed', message: '', notes: [], warnings: [] };
    const say = (status, message = '') => Object.assign(item, { status, message });
    onSheet.add(shapeOf(item.cell));
    const text = trimWs(String(x.translation ?? '').replace(/﻿/g, '')).replace(/\r\n|\r|\n/g, lineBreak);
    if (!text) return say('untranslated');
    if (!hasMarkup(item.cell) && hasMarkup(repairTags(text))) return say('sent back', WORDS_ONLY);
    const shape = shapesOf(text);
    translated.add(shape.text).add(shape.words);
    if (text === item.cell) return say('same');
    const here = byShape.get(shapeOf(item.cell));
    if (!here) {
      now ??= textsNow(live, 'bodyHtml');
      return now.has(`text\n${shape.text}`) || now.has(`words\n${shape.words}`) ? say('already', ALREADY_IN_BLOCK) : say('not found', NOT_IN_BLOCK);
    }
    const cells = new Set(here.map((u) => u.cell));
    if (cells.size > 1) return say('sent back', sameWords(cells.size));
    if (x.places !== undefined && x.places !== here.length) item.warnings.push(placesNote(item.cell, x.places, here.length));
    for (const u of here) goes.set(u, { text, item });
    return item;
  });

  const going = (u) => goes.get(u)?.item.status === 'placed';
  /* Each sentence through placeText; one sent back takes its text out of every
   * place, which can change what goes into another sentence - the title in
   * it - so the sentences are placed again until none is sent back. */
  let sentences;
  for (let again = true; again; ) {
    again = false;
    sentences = new Map();
    for (const u of units) {
      if (u.kind !== 'text' || !going(u)) continue;
      const { text, item } = goes.get(u);
      const nested = units.filter((a) => a.inside === u && going(a)).sort((a, b) => a.start - b.start);
      // The sentence as stored, each title or alt in it translated - and where each of those is in it now.
      let stored = '';
      let from = u.start;
      const spots = [];
      for (const a of nested) {
        stored += live.slice(from, a.start);
        const put = asAttr(a, goes.get(a).text);
        spots.push({ unit: a, at: stored.length, length: put.length });
        stored += put;
        from = a.end;
      }
      stored += live.slice(from, u.end);
      const r = placeText(stored, item.cell, text);
      if (r.errors.length) {
        Object.assign(item, { status: 'sent back', message: r.errors.join('; ') });
        again = true;
        break;
      }
      // Where each title or alt went: in the page's own tag, written where the translator put it.
      const own = tagsOf(stored).opens;
      for (const spot of spots) {
        const k = own.findIndex((x) => x.at <= spot.at && spot.at < x.at + x.raw.length);
        if (r.at[k] !== undefined) spot.offset = r.at[k] + spot.at - own[k].at;
      }
      sentences.set(u, { ...r, text, spots });
    }
  }

  const edits = [];
  for (const [u, r] of sentences) {
    const { item } = goes.get(u);
    for (const n of r.notes) if (!item.notes.includes(n)) item.notes.push(n);
    edits.push({
      unit: u,
      start: u.start,
      end: u.end,
      html: r.html,
      kind: 'text',
      // What a visitor should read there, worked out from the translation itself - never from what was made of it.
      reads: wordsOf(cellOf(repairTags(r.text), 'text')),
      nested: r.spots.map((x) => ({ unit: x.unit, offset: x.offset, length: x.length, reads: decodeHtml(escapeAttr(goes.get(x.unit).text)) }))
    });
  }
  // Structured data: each value written as a JSON string's inside, read back as one (see verify).
  for (const u of units) {
    if (u.kind !== 'ld' || !going(u)) continue;
    const { text } = goes.get(u);
    const reads = text.replace(WS, ' ');
    edits.push({ unit: u, start: u.start, end: u.end, html: escapeLd(reads), kind: 'ld', reads });
  }
  for (const u of units) {
    if (u.kind !== 'attr' || !going(u) || sentences.has(u.inside)) continue;
    const { text } = goes.get(u);
    edits.push({ unit: u, start: u.start, end: u.end, html: asAttr(u, text), kind: 'attr', reads: decodeHtml(escapeAttr(text)) });
  }
  edits.sort((a, b) => a.start - b.start);

  let value = '';
  let last = 0;
  const placed = [];
  for (const e of edits) {
    value += live.slice(last, e.start);
    const at = value.length;
    const nested = e.nested?.map((n) => (n.offset === undefined ? n : { ...n, newStart: at + n.offset, newEnd: at + n.offset + n.length }));
    placed.push({ ...e, ...(nested && { nested }), newStart: at, newEnd: at + e.html.length });
    value += e.html;
    last = e.end;
  }
  value += live.slice(last);
  const notOnSheet = [...new Set(units.filter((u) => !onSheet.has(shapeOf(u.cell)) && !translated.has(shapeOf(u.cell))).map((u) => u.cell))];
  return { value, items, notOnSheet, placed };
}

/**
 * Three checks on a prepared value, each its own way; a value that fails one
 * is never offered. `placed` is where prepareBody put each translation.
 *   a. Outside the places, every byte is the old value's.
 *   b. At each place, the text reads as its translation - by position, so a
 *      one-word "argent" is checked like any sentence, and a title inside a
 *      sentence wherever its tag went. What a place should read is worked out
 *      from the translation, never from what was made of it.
 *   c. A second reader, html.js - which closes tags the way a browser does -
 *      sees the same elements, the same attributes but the ones planned, the
 *      same script and style, and the same text outside the planned sentences
 *      (see secondReader).
 * Returns what is wrong, or nothing.
 */
export function verify(old, value, placed) {
  const problems = [];
  const reading = (p) => {
    const at = value.slice(p.newStart, p.newEnd);
    const json = () => {
      try {
        return JSON.parse(`"${at}"`);
      } catch {
        return '(not a JSON string)';
      }
    };
    const reads = p.kind === 'text' ? wordsOf(cellText(at)) : p.kind === 'ld' ? json() : decodeHtml(at.replace(/^"|"$/g, ''));
    if (reads !== p.reads) problems.push(`At line ${lineOf(value, p.newStart)} the text reads "${reads.slice(0, 40)}", not "${p.reads.slice(0, 40)}"`);
  };
  for (const p of placed) {
    reading(p);
    // A title or an alt in the sentence, in the page's tag wherever the translator put it.
    for (const n of p.nested || []) if (n.newStart !== undefined) reading(n);
  }
  const outside = (v, spans) => {
    const parts = [];
    let from = 0;
    for (const [start, end] of spans) {
      parts.push({ text: v.slice(from, start), at: from });
      from = end;
    }
    return [...parts, { text: v.slice(from), at: from }];
  };
  const before = outside(old, placed.map((p) => [p.start, p.end]));
  const after = outside(value, placed.map((p) => [p.newStart, p.newEnd]));
  const k = before.findIndex((x, i) => x.text !== after[i].text);
  if (k !== -1) {
    let i = 0;
    while (before[k].text[i] === after[k].text[i]) i++;
    problems.push(`The code outside the texts changed at line ${lineOf(value, after[k].at + i)}`);
  }
  return [...problems, ...secondReader(old, value, placed)];
}

/**
 * Check c of verify: the old value and the new, as html.js reads them. Outside
 * the planned sentences, each element is compared with the one in its place;
 * inside a sentence, its elements as a set - a tag may move within it, as two
 * links whose words swap places do, but none may come, go or change.
 */
function secondReader(old, value, placed) {
  const problems = [];
  const elementsOf = (v) => [...elements(parseHtml(v))].filter((e) => !LOOSE.has(e.tag));
  const before = elementsOf(old);
  const after = elementsOf(value);
  if (before.length !== after.length) return [`Second reader: ${before.length} elements before, ${after.length} after`];
  // This reader's elements, in the same order: where each one is, to know which ones the plan touches.
  const placesOf = (v) => {
    const out = [];
    walkAll(parseMarkup(v), (e) => e.tag !== '#root' && !LOOSE.has(e.tag) && out.push(e));
    return out;
  };
  const was = placesOf(old);
  const now = placesOf(value);
  if (was.length !== before.length || now.length !== after.length) {
    return [`Second reader: the two readers see ${was.length} and ${before.length} elements before, ${now.length} and ${after.length} after`];
  }
  const indexOf = (el) => was.findIndex((e) => e.start === el.start && e.tag === el.tag);
  const free = new Set();
  const planned = new Map();
  /* A JSON-LD script with translations in it: its content may change, but only
   * there - checked as JSON below, not byte for byte. */
  const ld = new Map();
  for (const p of placed) {
    if (p.kind === 'ld') {
      const i = indexOf(p.unit.owner);
      ld.set(i, [...(ld.get(i) || []), p.reads]);
      continue;
    }
    if (p.kind === 'attr') {
      planned.set(`${indexOf(p.unit.owner)}|${p.unit.name}`, p.reads);
      continue;
    }
    free.add(indexOf(p.unit.owner));
    for (const n of p.nested || []) planned.set(`${indexOf(n.unit.owner)}|${n.unit.name}`, n.reads);
  }
  /** Element i's attributes as the plan wants them: a planned one as it should read now. */
  const wanted = (i) => Object.fromEntries(Object.entries(before[i].attrs).map(([name, v]) => [name, planned.get(`${i}|${name}`) ?? v]));
  const shown = (v) => (v === undefined ? 'none' : `"${v.length > 60 ? `${v.slice(0, 59)}…` : v}"`);
  /** How element i, now `y`, differs from what the plan wants. */
  const attrsDiffer = (i, y, where = '') => {
    const want = wanted(i);
    return [...new Set([...Object.keys(want), ...Object.keys(y.attrs)])]
      .filter((name) => want[name] !== y.attrs[name])
      .map((name) =>
        planned.has(`${i}|${name}`)
          ? `Second reader: <${y.tag}> ${name}${where} reads ${shown(y.attrs[name])}, planned ${shown(want[name])}`
          : `Second reader: <${y.tag}> ${name}${where} changed (${shown(want[name])} -> ${shown(y.attrs[name])})`
      );
  };
  const ownText = (e) =>
    e.children
      .filter((c) => 'text' in c)
      .map((c) => c.text)
      .join('')
      .replace(WS, ' ')
      .trim();

  // The planned sentence each element is in, by where it starts: -1 for none.
  const sentences = placed.filter((p) => p.kind === 'text');
  const zone = (e, start, end) => sentences.findIndex((p) => e.start >= p[start] && e.start < p[end]);
  const zonesBefore = was.map((e) => zone(e, 'start', 'end'));
  const zonesAfter = now.map((e) => zone(e, 'newStart', 'newEnd'));
  const inZone = (zones, z) => zones.flatMap((x, i) => (x === z ? [i] : []));

  const xs = inZone(zonesBefore, -1);
  const ys = inZone(zonesAfter, -1);
  if (xs.length !== ys.length) return [`Second reader: ${xs.length} elements outside the texts before, ${ys.length} after`];
  for (let n = 0; n < xs.length; n++) {
    const [i, x, y] = [xs[n], before[xs[n]], after[ys[n]]];
    if (x.tag !== y.tag) {
      problems.push(`Second reader: element ${i + 1} was <${x.tag}>, now <${y.tag}>`);
      break;
    }
    problems.push(...attrsDiffer(i, y));
    if (ld.has(i)) problems.push(...ldDiffers(x.raw, y.raw, ld.get(i)));
    else if ((x.raw ?? null) !== (y.raw ?? null)) problems.push(`Second reader: the content of <${x.tag}> changed`);
    if (!free.has(i) && ownText(x) !== ownText(y)) problems.push(`Second reader: the text of <${x.tag}> changed outside the plan`);
  }

  // Inside each sentence: the same elements, as the plan wants them, in whatever order the translation put them.
  const key = (tag, attrs, raw) => JSON.stringify([tag, Object.entries(attrs).sort(([a], [b]) => (a < b ? -1 : 1)), raw ?? null]);
  sentences.forEach((p, z) => {
    const left = inZone(zonesAfter, z).map((j) => ({ y: after[j], key: key(after[j].tag, after[j].attrs, after[j].raw) }));
    const lost = [];
    for (const i of inZone(zonesBefore, z)) {
      const k = left.findIndex((x) => x.key === key(before[i].tag, wanted(i), before[i].raw));
      if (k === -1) lost.push(i);
      else left.splice(k, 1);
    }
    const where = ` (in the text at line ${lineOf(value, p.newStart)})`;
    // One of the same name that differs is said by what differs in it; the rest by name.
    for (const i of [...lost]) {
      const k = left.findIndex((x) => x.y.tag === before[i].tag);
      if (k === -1) continue;
      problems.push(...attrsDiffer(i, left[k].y, where));
      lost.splice(lost.indexOf(i), 1);
      left.splice(k, 1);
    }
    if (lost.length || left.length) {
      const names = (list) => list.map((t) => `<${t}>`).join(' ') || 'none';
      problems.push(`Second reader: the text at line ${lineOf(value, p.newStart)} had ${names(lost.map((i) => before[i].tag))}, now ${names(left.map((x) => x.y.tag))}`);
    }
  });
  return problems;
}

/**
 * A JSON-LD script before and after its translations went in, read as JSON:
 * it must still be JSON, with the same keys in the same shape, and every value
 * that changed must be one of the planned translations (`reads`).
 */
function ldDiffers(was, now, reads) {
  let a;
  let b;
  try {
    a = JSON.parse(was);
    b = JSON.parse(now);
  } catch {
    return ['Second reader: the structured data (JSON-LD) no longer reads as JSON'];
  }
  const leaves = (v, path = '', out = []) => {
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) leaves(x, `${path}/${k}`, out);
    else out.push([path, v]);
    return out;
  };
  const x = leaves(a);
  const y = leaves(b);
  if (x.length !== y.length || x.some(([p], i) => p !== y[i][0])) return ['Second reader: the structured data (JSON-LD) changed shape'];
  const wanted = new Set(reads);
  const off = y.filter(([, v], i) => v !== x[i][1] && !wanted.has(v));
  return off.length ? [`Second reader: the structured data (JSON-LD) changed outside the plan, at ${off[0][0]}`] : [];
}

/* -------------------------------------------------------- after the paste */

/** Only CRLF or LF, and spaces or tabs at the start or end of a line, may differ: no line break added or lost. */
function sameButIndent(a, b) {
  const lines = (s) => String(s).split(/\r\n|\r|\n/).map((l) => l.replace(/^[ \t]+|[ \t]+$/g, ''));
  const x = lines(a);
  const y = lines(b);
  return x.length === y.length && x.every((l, i) => l === y[i]);
}

/** A link's or a picture's address in a value - the rest of it is the block's own. */
const ADDRESS = /((?:href|src|srcset|data-src|data-srcset|poster)\s*=\s*"|location\.href\s*=\s*')[^"']*/g;
const HAS_MARKUP = /<[a-zA-Z!/]/;

/** Open the block, the wrong tab: put its old value back. */
function putBack(tab, was) {
  return was
    ? `open the block, tab ${tab}, press Ctrl+A and paste back its old value (Copy old ${tab} on the card)`
    : `open the block, tab ${tab}, press Ctrl+A, then Delete`;
}

/**
 * What is still to do in a block once it is pasted: a text sent back, not
 * found or with no translation on the sheet, places to look at, text not on
 * the sheet.
 */
function stillOpen(record) {
  const words = (cell) => {
    const w = wordsOf(cell);
    return w.length > 60 ? `${w.slice(0, 59)}…` : w;
  };
  const open = [];
  for (const i of record.items || []) {
    if (i.status === 'sent back') open.push(`"${words(i.cell)}" was sent back - it stays English: ${i.message}`);
    if (i.status === 'not found') open.push(`"${words(i.cell)}": ${i.message}`);
    if (i.status === 'untranslated') open.push(`"${words(i.cell)}": no translation on the sheet - it stays English`);
    open.push(...(i.warnings || []));
  }
  if (record.notOnSheet?.length) open.push(`Not on the sheet - stays English: ${record.notOnSheet.map((c) => `"${words(c)}"`).join(', ')}`);
  return open;
}

/** The first line of `now` that differs from `was` beyond its indentation, shown around the first character that does. */
function firstDifference(now, was, label) {
  const a = now.split(/\r\n|\r|\n/);
  const b = was.split(/\r\n|\r|\n/);
  let i = 0;
  while (i < Math.min(a.length, b.length) && a[i].trim() === b[i].trim()) i++;
  const x = (a[i] ?? '').trim();
  const y = (b[i] ?? '').trim();
  let c = 0;
  while (c < Math.min(x.length, y.length) && x[c] === y[c]) c++;
  const from = Math.max(0, c - 25);
  return `Differs at line ${i + 1}: now ${JSON.stringify(x.slice(from, c + 25))}, ${label} ${JSON.stringify(y.slice(from, c + 25))}`;
}

/**
 * Where a block stands after the paste, read only. `now` is its three fields
 * read again; `record` what was prepared for it - { no, old: { headerInclude,
 * bodyHtml, footerInclude }, prepared, reason, items, notOnSheet }, as
 * prepareBody and the import give them, `prepared` null for a block DSY
 * offered no value; `others` the same for the page's other blocks.
 *
 * Returns { status, say, done, open, extra }: `status` one of pasted, not
 * pasted, nothing to paste, wrong tab, wrong block, cut short, differs; `say`
 * what to tell the person, the fix included; `done` only once pasted with
 * nothing left - or, for a block with nothing to paste, once nothing is left -
 * never a plain done while `open` lists a text sent back, not found, left
 * without a translation, in fewer places than at the export, or not on the
 * sheet; `extra` a change to the block's Header or Footer, for a developer.
 * The editor may change line endings and indentation: a value is known with
 * or without them.
 */
export function pasteStatus(now, record, others = []) {
  const body = String(now?.bodyHtml ?? '');
  const head = String(now?.headerInclude ?? '');
  const foot = String(now?.footerInclude ?? '');
  const old = record.old || {};
  const was = { body: String(old.bodyHtml ?? ''), head: String(old.headerInclude ?? ''), foot: String(old.footerInclude ?? '') };
  const prepared = typeof record.prepared === 'string' && record.prepared ? record.prepared : null;
  const open = stillOpen(record);
  const extra = [];
  // With nothing prepared, a block is done once nothing is left open and no text waits for a value DSY could not offer.
  const idle = !(record.items || []).some((i) => i.status === 'placed');
  const result = (status, say) => ({ status, say, done: !open.length && (status === 'pasted' || (status === 'nothing to paste' && idle)), open, extra });
  const same = (v, x) => v === x || sameButIndent(v, x) || (!v.trim() && !x.trim());
  /** Another block whose value, new or old, `v` is. */
  const otherBlock = (v) => others.find((o) => (o.prepared?.trim() && same(v, o.prepared)) || (o.old?.bodyHtml?.trim() && same(v, o.old.bodyHtml)));
  /** A Body value - this block's, new or old, or another's - in the wrong tab. */
  const aBody = (v) => (prepared !== null && same(v, prepared)) || (was.body.trim() && same(v, was.body)) || otherBlock(v);

  if (!same(head, was.head)) {
    if (HAS_MARKUP.test(head) || aBody(head)) {
      return result('wrong tab', `Pasted into Header(CSS) by mistake: ${putBack('Header(CSS)', was.head)}; then paste into the Body(HTML) field and click Done.`);
    }
    if (!head.trim()) return result('wrong tab', `Header(CSS) was cleared by mistake: ${putBack('Header(CSS)', was.head)}, then click Done.`);
    extra.push('Header(CSS) changed (CSS only): developer work - check with the developer');
  }
  if (!same(foot, was.foot)) {
    if ((HAS_MARKUP.test(foot) && !HAS_MARKUP.test(was.foot)) || aBody(foot)) {
      return result('wrong tab', `Pasted into Footer(Javascript) by mistake: ${putBack('Footer(Javascript)', was.foot)}; then paste into the Body(HTML) field and click Done.`);
    }
    if (!foot.trim()) return result('wrong tab', `Footer(Javascript) was cleared by mistake: ${putBack('Footer(Javascript)', was.foot)}, then click Done.`);
    extra.push('Footer(Javascript) changed: developer work');
  }

  const restore = 'paste back its old value (Copy old Body(HTML) on the card)';
  if (prepared === null) {
    if (same(body, was.body)) return result('nothing to paste', record.reason || 'Nothing to paste in this block.');
    const o = otherBlock(body);
    if (o) return result('wrong block', `This block holds the value of block ${o.no}. Open THIS block again and ${restore}; then paste block ${o.no}'s value into block ${o.no}.`);
    if (!body.trim()) return result('cut short', `Body(HTML) is empty: the field was cleared. DSY prepared nothing for this block - ${restore}.`);
    return result('differs', `${firstDifference(body, was.body, 'was')}. DSY prepared nothing for this block - if nobody meant to change it, ${restore}.`);
  }
  const pasted = (say) => result('pasted', open.length ? say.replace('(done)', `(not done: ${open.length} still to do)`) : say);
  if (body === prepared) return pasted('Pasted (done)');
  if (sameButIndent(body, prepared)) return pasted('Pasted (done) (the editor changed line endings or indentation only)');
  if (same(body, was.body)) return result('not pasted', 'Not pasted yet');
  const o = otherBlock(body);
  if (o) return result('wrong block', `This block holds the value of block ${o.no}. Open THIS block again and paste its own value; then paste block ${o.no}'s value into block ${o.no}.`);
  if (!body.trim()) return result('cut short', 'Body(HTML) is empty: the paste did not land, or the field was cleared. Copy and paste again.');
  if (body.length < prepared.length && prepared.startsWith(body)) {
    const n = (x) => x.toLocaleString('en');
    return result('cut short', `Cut short: only the first ${n(body.length)} of ${n(prepared.length)} characters (ends at line ${lineOf(body, body.length)}). Copy and paste again.`);
  }
  // Cut short, its line endings or indentation changed by the editor too: counted in lines.
  const trimmed = (s) => s.split(/\r\n|\r|\n/).map((l) => l.trim()).join('\n');
  if (trimmed(body).length < trimmed(prepared).length && trimmed(prepared).startsWith(trimmed(body))) {
    return result('cut short', `Cut short: it ends at line ${lineOf(body, body.length)} of ${lineOf(prepared, prepared.length)}. Copy and paste again.`);
  }
  if (body.replace(ADDRESS, '$1') === prepared.replace(ADDRESS, '$1')) {
    return pasted('Pasted (done) - links or image paths changed after the paste: if that was intended, nothing to do');
  }
  return result('differs', firstDifference(body, prepared, 'prepared'));
}

/** A line longer than this - a script squeezed onto one - is shown around its change only. */
const LONG_LINE = 240;
const AROUND = 80;

/**
 * A template that builds its sentences from one choice - `${open ? "Close" :
 * "Open"} showcase container` - as code that chooses between the whole
 * sentences, translated: (open ? "Fermer la vitrine" : "Ouvrir la vitrine").
 * Null for any other template: the developer writes that one.
 */
function wholeChoice(parts, texts) {
  const exprs = parts.filter((p) => 'expr' in p);
  const choice = exprs.length === 1 && texts.length === 2 ? oneChoice(exprs[0].expr) : null;
  if (!choice) return null;
  const [yes, no] = texts.map((x) => escapeScript(x.translation || x.cell, '"'));
  return `(${choice.test} ? "${yes}" : "${no}")`;
}

/**
 * The Footer (JavaScript) for a developer: what to change, line by line -
 * never a value to paste, since one quote out of place stops the script.
 * `translations` maps a text as the sheet shows it to its translation.
 *
 * Each item is { lines, texts, built }: `lines` each { line, now, new } - the
 * line as it is, and the same line with the translation in, escaped for the
 * string it goes into (see escapeScript); `texts` the { cell, translation } it
 * puts in. A sentence the script builds is one item over every line that
 * builds it, `built`: its template becomes a choice between the whole
 * sentences, translated - or, for a template that is not one choice, `new` is
 * null and the developer writes it.
 */
export function developerList(footer, translations) {
  const js = String(footer ?? '');
  const { units, built } = readScript(js);
  const lines = js.split(/\r\n|\r|\n/);
  const starts = [0, ...[...js.matchAll(/\r\n|\r|\n/g)].map((m) => m.index + m[0].length)];
  /** Line n as it is, and as it is with `changes` - each { start, end, put } in the value. */
  const change = (n, changes) => {
    const at = starts[n - 1];
    const was = lines[n - 1];
    let now = was;
    for (const c of [...changes].sort((p, q) => q.start - p.start)) now = now.slice(0, c.start - at) + c.put + now.slice(c.end - at);
    if (was.length <= LONG_LINE) return { line: n, now: was.trim(), new: now.trim() };
    const from = Math.max(0, Math.min(...changes.map((c) => c.start)) - at - AROUND);
    const to = Math.max(...changes.map((c) => c.end)) - at + AROUND;
    const cut = (s, end) => `${from > 0 ? '…' : ''}${s.slice(from, end)}${end < s.length ? '…' : ''}`;
    return { line: n, now: cut(was, to), new: cut(now, to + now.length - was.length) };
  };

  const items = [];
  const byLine = new Map();
  for (const u of units) {
    const t = translations.get(u.cell);
    if (!t || t === u.cell) continue;
    if (!byLine.has(u.line)) byLine.set(u.line, { changes: [], texts: [] });
    byLine.get(u.line).changes.push({ start: u.start, end: u.end, put: escapeScript(t, u.quote) });
    byLine.get(u.line).texts.push({ cell: u.cell, translation: t });
  }
  for (const [n, { changes, texts }] of byLine) items.push({ lines: [change(n, changes)], texts, built: false });

  const byCode = new Map();
  for (const b of built) byCode.set(b.code, [...(byCode.get(b.code) || []), b]);
  for (const group of byCode.values()) {
    const texts = group[0].sentences.map((cell) => ({ cell, translation: translations.get(cell) ?? '' }));
    if (!texts.some((x) => x.translation && x.translation !== x.cell)) continue;
    // A template over several lines is the developer's to write too.
    const put = /[\r\n]/.test(group[0].code) ? null : wholeChoice(group[0].parts, texts);
    items.push({
      lines: group.map((b) => (put ? change(b.line, [{ start: b.start - 1, end: b.end + 1, put }]) : { line: b.line, now: lines[b.line - 1].trim(), new: null })),
      texts,
      built: true
    });
  }
  return items.sort((p, q) => p.lines[0].line - q.lines[0].line);
}

/** A script with the inside of every string and template taken out: the code around them, quotes and backticks kept. */
const codeAround = (js, tokens) => {
  let out = '';
  let at = 0;
  for (const t of tokens) {
    out += js.slice(at, t.start);
    at = t.end;
  }
  return out + js.slice(at);
};

/**
 * The Footer (JavaScript) with the translations in, for DSY to write when its
 * block is ticked - { value } - or { value: null, reason }. `texts` are the
 * sheet's texts of the Footer to put in, each { cell, translation }. Only the
 * inside of each string readScript found changes, the translation escaped for
 * that string's quote (see escapeScript); a sentence the script builds from
 * one choice becomes a choice between the two whole sentences, translated
 * (see wholeChoice). Every other string stays exactly as it was.
 *
 * Checked before it is offered - never run: an extension may not eval. Read
 * again with the same tokenizer, the new script must have the old one's code
 * exactly and the same strings in the same order, only those put in changed,
 * each reading back as its translation - and none with "</script" or "<!--".
 */
export function prepareFooter(footer, texts) {
  const js = String(footer ?? '');
  const translations = new Map(texts.filter((x) => x.translation && x.translation !== x.cell).map((x) => [x.cell, x.translation]));
  const nothing = { value: null, reason: 'Nothing to write: no translation on the sheet changes its Footer(Javascript).' };
  if (!js.trim() || !translations.size) return nothing;
  const value = (s) => decodeHtml(s).replace(/\r\n|\r/g, '\n');
  const { units, built } = readScript(js);
  // Each change: where it goes, what goes in, the same with its strings empty, and the strings it puts in - { raw, value }.
  const changes = [];
  for (const u of units) {
    const t = translations.get(u.cell);
    if (!t) continue;
    const raw = escapeScript(t, u.quote);
    changes.push({ start: u.start, end: u.end, put: raw, blank: '', strings: [{ raw, value: value(t) }] });
  }
  for (const b of built) {
    const sentences = b.sentences.map((cell) => ({ cell, translation: translations.get(cell) ?? '' }));
    if (!sentences.some((x) => x.translation)) continue;
    const exprs = b.parts.filter((p) => 'expr' in p);
    const choice = exprs.length === 1 && sentences.length === 2 && !/[\r\n]/.test(b.code) ? oneChoice(exprs[0].expr) : null;
    if (!choice) return { value: null, reason: `The sentence the script builds on line ${b.line} is not one choice between two sentences - the developer writes it.` };
    const strings = sentences.map((x) => ({ raw: escapeScript(x.translation || x.cell, '"'), value: value(x.translation || x.cell) }));
    changes.push({
      start: b.start - 1,
      end: b.end + 1,
      put: wholeChoice(b.parts, sentences),
      blank: `(${choice.test} ? "" : "")`,
      strings
    });
  }
  if (!changes.length) return nothing;

  const made = (key) => [...changes].sort((p, q) => q.start - p.start).reduce((s, c) => s.slice(0, c.start) + c[key] + s.slice(c.end), js);
  const next = made('put');
  const refuse = (why) => ({ value: null, reason: `Not offered: DSY’s own check of the new Footer(Javascript) found a problem - ${why}. The developer puts it in.` });
  const going = changes.sort((p, q) => p.start - q.start).flatMap((c) => c.strings);
  if (going.some((s) => /<\/script|<!--/i.test(s.raw)) || /<\/script/i.test(next)) return refuse('"</script" or "<!--" would be in it');

  // The same script with the strings put in left empty: what the new one must read as, but for those strings.
  const blank = made('blank');
  const was = scriptTokens(blank);
  const now = scriptTokens(next);
  if (now.length !== was.length || codeAround(next, now) !== codeAround(blank, was)) return refuse('the code around the strings would change');
  const todo = [...going];
  for (let i = 0; i < now.length; i++) {
    const [a, b] = [was[i], now[i]];
    if (a.type !== b.type || a.quote !== b.quote) return refuse('the strings would no longer be the same');
    if (a.raw === b.raw) continue;
    const s = a.raw === '' ? todo.shift() : null;
    if (!s || s.raw !== b.raw || unescapeJs(b.raw) !== s.value) return refuse(`a string would not read as its translation (line ${lineOf(next, b.start)})`);
  }
  if (todo.length) return refuse('a translation did not go in');
  return { value: next, reason: null };
}

/**
 * The Footer (JavaScript) checked again, read only: how many of the sheet's
 * strings are still in English in it, whether the sentence it builds is
 * translated, and whether it has "</script" - where the page's <script> would
 * stop. `texts` are the sheet's texts of the Footer, each { cell, translation,
 * built } - `built` for a sentence the script builds. Never compared with a
 * value of DSY's: the developer puts the translations in their own way.
 */
export function footerStatus(footer, texts) {
  const js = String(footer ?? '');
  const { units, built } = readScript(js);
  const english = new Set([...units.map((u) => u.cell), ...built.flatMap((b) => b.sentences)]);
  const now = textsNow(js, 'footerInclude');
  const todo = texts.filter((x) => x.translation && x.translation !== x.cell);
  const strings = todo.filter((x) => !x.built);
  const still = strings.filter((x) => english.has(x.cell)).length;
  // An emptied Footer has no English either: it counts as done only with every translation in it.
  const translated = strings.filter((x) => now.has(`words\n${shapesOf(x.translation).words}`)).length;
  const sentences = todo.filter((x) => x.built);
  let sentence = null;
  if (sentences.length) {
    if (sentences.some((x) => english.has(x.cell))) sentence = 'still in English';
    else sentence = sentences.every((x) => now.has(`words\n${shapesOf(x.translation).words}`)) ? 'translated' : 'not found';
  }
  const scriptEnd = /<\/script/i.test(js);
  const say = [
    `${still} of ${strings.length} still in English`,
    ...(still < strings.length && translated < strings.length - still ? [`${strings.length - still - translated} neither English nor translated`] : []),
    ...(sentence ? [`built sentence ${sentence}`] : []),
    scriptEnd ? '"</script" in it - the page’s script stops there' : 'no </script'
  ].join(', ');
  return { strings: strings.length, english: still, translated, built: sentence, scriptEnd, empty: !js.trim(), say };
}

/** A key a link is kept under in script data: cta, url, href, link, ctaUrl. */
const LINK_KEY = /^(cta|url|href|link)$|(Cta|Url|Href|Link)$/;

/**
 * Script data that looks copied from another page and never changed - for the
 * export to say before anyone translates it. Generic, and quiet unless sure:
 * only data objects with a title each count as tiles, at least three of them,
 * no two titled alike.
 *   - A long text, or list of texts, the same on every tile that has it -
 *     where each tile should have its own (an alt text of another product).
 *   - An id the same on every tile: each tile opens the same thing.
 *   - A link empty on a tile while the other tiles have one.
 * Returns [{ say, cells }]: `cells` the sheet's texts it is about - the
 * repeated texts, or the titles of the tiles concerned.
 */
export function scriptDataWarnings(footer) {
  const js = String(footer ?? '');
  const out = [];
  const quoted = (list) => list.map((x) => `"${x.length > 40 ? `${x.slice(0, 39)}…` : x}"`).join(', ');

  // Each tile's texts by name, from the reader: a list (bentoAlt: [ … ]) is one value.
  const byName = new Map();
  for (const u of readScript(js).units) {
    if (u.how !== 'data' || !u.tile || u.name === 'title') continue;
    if (!byName.has(u.name)) byName.set(u.name, new Map());
    const tiles = byName.get(u.name);
    const tile = u.path.join('.');
    if (!tiles.has(tile)) tiles.set(tile, { title: u.tile, cells: [] });
    tiles.get(tile).cells.push(u.cell);
  }
  for (const [name, tiles] of byName) {
    const list = [...tiles.values()];
    const values = new Set(list.map((t) => t.cells.join('\n')));
    if (list.length < 3 || values.size > 1 || [...values][0].length < 20 || new Set(list.map((t) => t.title)).size < list.length) continue;
    const cells = [...new Set(list[0].cells)];
    out.push({ say: `All ${list.length} tiles have the same ${name}: ${quoted(cells)} - each tile should have its own.`, cells });
  }

  // Each object's own "key": "value" pairs, by where the object opens: ids and links are not words, so the reader leaves them.
  const objects = new Map();
  for (const t of scriptTokens(js)) {
    if (t.type !== 'str' || t.bracket?.ch !== '{') continue;
    const key = js.slice(Math.max(0, t.start - 61), t.start - 1).match(/([A-Za-z_$][\w$]*)\s*:\s*$/)?.[1];
    if (!key) continue;
    if (!objects.has(t.bracket.at)) objects.set(t.bracket.at, new Map());
    objects.get(t.bracket.at).set(key, showNbsp(unescapeJs(t.raw)));
  }
  const tiles = [...objects.values()].filter((o) => wordy(o.get('title') ?? ''));
  if (tiles.length < 3 || new Set(tiles.map((o) => o.get('title'))).size < tiles.length) return out;
  for (const key of new Set(tiles.flatMap((o) => [...o.keys()]))) {
    const having = tiles.filter((o) => o.has(key));
    if (having.length < 3) continue;
    const values = new Set(having.map((o) => o.get(key)));
    if (/id$/i.test(key) && values.size === 1 && [...values][0].trim()) {
      out.push({ say: `All ${having.length} tiles have the same ${key}, "${[...values][0]}" - each tile should open its own.`, cells: having.map((o) => o.get('title')) });
    }
    if (LINK_KEY.test(key)) {
      const empty = having.filter((o) => !o.get(key).trim());
      if (empty.length && empty.length < having.length) {
        for (const o of empty) out.push({ say: `Tile "${o.get('title')}" has an empty ${key} - the other tiles have a link.`, cells: [o.get('title')] });
      }
    }
  }
  return out;
}
