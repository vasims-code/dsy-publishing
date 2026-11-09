/**
 * A page's HTML as a tree, without a DOM.
 *
 * The PD copy deck reads a rendered page, and the rest of the copy deck is
 * pure - it runs in a content script, a panel and a test alike - so this is
 * pure too: no DOMParser, which a test in Node does not have. It is forgiving
 * the way a browser is about what pages actually contain - tags left open,
 * stray closing tags, `<br>` and `<img>` with no end, SVG's `<use/>` - and it
 * never reads the inside of `<script>`, `<style>`, `<template>` or `<noscript>`
 * as markup.
 *
 * A node is `{ tag, attrs, children, parent }`; text is `{ text, parent }`,
 * already decoded (`&#34;` is `"`).
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Elements whose content is not markup, and is never a visitor's text here. */
const RAW = new Set(['script', 'style', 'template', 'noscript', 'textarea', 'title']);

/** An open element that a new one of these closes, as a browser does: `<li>` after `<li>`. */
const CLOSED_BY = {
  li: new Set(['li']),
  option: new Set(['option', 'optgroup']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  tr: new Set(['tr']),
  td: new Set(['td', 'th', 'tr']),
  th: new Set(['td', 'th', 'tr'])
};

/** Starting one of these closes an open `<p>`. */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul'
]);

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', trade: '™',
  reg: '®', copy: '©', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', bull: '•', middot: '·',
  deg: '°', times: '×', euro: '€', pound: '£', yen: '¥', cent: '¢', sup1: '¹', sup2: '²', sup3: '³', frac12: '½',
  shy: '­', zwj: '‍', zwnj: '‌', thinsp: ' ', ensp: ' ', emsp: ' ', dagger: '†',
  Dagger: '‡', sect: '§', para: '¶', micro: 'µ', plusmn: '±', iexcl: '¡', iquest: '¿'
};

export function decodeHtml(s) {
  return String(s).replace(/&(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue; // the first one counts, as in a browser
    attrs[name] = decodeHtml(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** The document as a tree. The root is `{ tag: '#root' }`. */
export function parseHtml(html) {
  const s = String(html);
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const append = (node) => {
    node.parent = top();
    top().children.push(node);
  };
  const closeTo = (i) => {
    stack.length = Math.max(1, i);
  };

  const TOKEN = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(s))) {
    const [all, slash, rawName, rest] = m;
    if (!rawName) {
      if (all[0] === '<' && all.length > 1) continue; // a comment, doctype or processing instruction
      append({ text: decodeHtml(all) });
      continue;
    }
    const tag = rawName.toLowerCase();

    if (slash) {
      const i = stack.findLastIndex((n) => n.tag === tag);
      if (i > 0) closeTo(i);
      continue;
    }

    const closes = CLOSED_BY[tag];
    if (closes) {
      // An open <li> is closed by the next <li> - but not one inside a list nested in it.
      for (let i = stack.length - 1; i > 0; i--) {
        const t = stack[i].tag;
        if (closes.has(t)) {
          closeTo(i);
          break;
        }
        if (t === 'ul' || t === 'ol' || t === 'table' || t === 'select' || t === 'dl' || t === 'div' || t === 'section') break;
      }
    }
    if (CLOSES_P.has(tag) && top().tag === 'p') stack.pop();

    const node = { tag, attrs: parseAttrs(rest), children: [] };
    append(node);

    if (RAW.has(tag)) {
      const end = s.toLowerCase().indexOf(`</${tag}`, TOKEN.lastIndex);
      const stop = end === -1 ? s.length : end;
      node.raw = s.slice(TOKEN.lastIndex, stop);
      const close = end === -1 ? s.length : s.indexOf('>', end);
      TOKEN.lastIndex = close === -1 ? s.length : close + 1;
      continue;
    }
    if (VOID.has(tag) || /\/\s*$/.test(rest)) continue;
    stack.push(node);
  }
  return root;
}

/* ------------------------------------------------------------- helpers */

export const classes = (node) => (node?.attrs?.class || '').split(/\s+/).filter(Boolean);

export const hasClass = (node, name) => classes(node).includes(name);

/** Every element under `node`, in document order. */
export function* elements(node) {
  for (const c of node.children || []) {
    if (!c.tag) continue;
    yield c;
    yield* elements(c);
  }
}

export function find(node, test) {
  for (const el of elements(node)) if (test(el)) return el;
  return null;
}

export function findAll(node, test) {
  const out = [];
  for (const el of elements(node)) if (test(el)) out.push(el);
  return out;
}

/** The nearest element at or above `node` that passes `test`. */
export function closest(node, test) {
  for (let n = node; n && n.tag !== '#root'; n = n.parent) if (n.tag && test(n)) return n;
  return null;
}

/** Text under a node, as written: tags dropped, nothing collapsed. */
export function textOf(node) {
  if (!node) return '';
  if ('text' in node) return node.text;
  if (node.raw !== undefined) return '';
  return node.children.map(textOf).join('');
}
