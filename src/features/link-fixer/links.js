/**
 * Finding links authored as full URLs to our own site, and what each becomes
 * written the way the site wants it: relative.
 *
 *   https://www.samsung.com/uk/mobile-phone-buying-guide/best-smart-watch/   wrong
 *   /uk/mobile-phone-buying-guide/best-smart-watch/                          right
 *
 * Pure - no network, no DOM - so the worker, the panel and a node test all
 * share the same rules, and the review can never list a fix the write would
 * not make.
 *
 * WHAT COUNTS AS A LINK. A host name inside text is not a link; a reader may
 * be meant to see "www.samsung.com/uk" written out. So a URL is only taken
 * where a link is stored:
 *
 *   the whole value              linkUrl = "https://www.samsung.com/uk/tvs/"
 *   an attribute in markup       <a href="https://www.samsung.com/uk/tvs/">
 *   a quoted string in JSON      {"url":"https://www.samsung.com/uk/tvs/"}
 *
 * and never in an alt, title or label, which are words for a reader. A host
 * with no scheme and no path - "Samsung.com" - is a name, not a link.
 *
 * Only links to the hosts given are touched. Any other site - youtube.com,
 * shop.samsung.com, images.samsung.com - has to stay a full URL, because a
 * relative path would point it at www.samsung.com.
 */

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** www.samsung.com and samsung.com always; the rest is passed in. Ports dropped, lower case. */
export function hostList(extra = []) {
  const out = new Set(['www.samsung.com', 'samsung.com']);
  for (const h of extra) {
    const host = String(h || '')
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, '')
      .replace(/[/:].*$/, '');
    if (host) out.add(host);
  }
  return [...out];
}

/**
 * The scheme is optional - "www.samsung.com/uk/" in a link field is the same
 * mistake - and so is a port, which an author instance link can carry. The
 * host has to end the name: www.samsung.com.au is not www.samsung.com.
 * Group 1 is the scheme or "//", group 2 everything after the host.
 */
function linkRe(hosts) {
  const names = [...hosts].sort((a, b) => b.length - a.length).map(esc).join('|');
  return new RegExp(
    `((?:https?:)?\\/\\/|https?:)?(?:${names})(?::\\d+)?(?=[/?#"'\\\\\\s)\\],;!]|$)([^"'\\s<>\\\\]*)`,
    'gi'
  );
}

/* Attributes and JSON keys that hold words for a reader, not a link. A name
   written out in an image's alt text is what the reader is meant to see. */
const TEXT_NAMES = /^(?:alt|title|label|placeholder|aria-[\w-]+|data-title|data-alt|data-label)$/i;

/* Attributes holding a list of URLs, each followed by its size: every one of
   them is a link, not just the first. */
const LIST_ATTRS = /(?:^|-)srcset$/i;

/**
 * Closing punctuation after a link belongs to the words around it, not to the
 * link: "(see https://www.samsung.com/uk/x)" ends its link at x. A bracket is
 * kept when the link opened one of its own.
 */
function trimTail(rest) {
  let out = rest;
  for (;;) {
    const last = out.slice(-1);
    if (/[.,;:!]/.test(last)) out = out.slice(0, -1);
    else if (last === ')' && out.split('(').length < out.split(')').length) out = out.slice(0, -1);
    else if (last === ']' && out.split('[').length < out.split(']').length) out = out.slice(0, -1);
    else return out;
  }
}

/** Where the match starts: the whole value, an attribute in markup, or a JSON string. */
function linkContext(s, start, end) {
  const before = s.slice(0, start);
  if (!before.trim() && /^[)\].,;:!]*\s*$/.test(s.slice(end))) return 'value';
  const attr = before.match(/([\w:.-]+)\s*=\s*\\?["']([^"'<>]*)$/);
  if (attr) {
    if (TEXT_NAMES.test(attr[1])) return null;
    if (!attr[2]) return 'attribute';
    if (LIST_ATTRS.test(attr[1]) && /,\s*$/.test(attr[2])) return 'attribute';
    return null;
  }
  if (/^\s*[[{]/.test(s) && /\\?"$/.test(before)) {
    const key = before.match(/\\?"([^"\\]*)\\?"\s*:\s*\\?"$/);
    return key && TEXT_NAMES.test(key[1]) ? null : 'json';
  }
  return null;
}

/* The author's own consoles - the Sites and Assets consoles, the classic
   content finder, CRXDE. A relative path to one of those is a dead link on
   the live site, so a link there is left exactly as it is. */
const CONSOLE = /^\/(?:(?:sites|assets|editor|damadmin|siteadmin|miscadmin)\.html|cf#|siteadmin|damadmin|miscadmin|aem\/|mnt\/|crx\/|libs\/)(?:$|[/?#.]|(?<=\/))/i;

/**
 * What the link becomes: the path, query and fragment as they were, without
 * the scheme and host. An author link opened in the editor drops the editor
 * too. A bare host becomes "/".
 */
export function relativeOf(rest) {
  let path = rest || '/';
  if (!/^[/?#]/.test(path)) path = `/${path}`;
  if (/^\/editor\.html\//.test(path)) path = path.slice('/editor.html'.length);
  if (/^[?#]/.test(path)) path = `/${path}`;
  return path;
}

/** The words a reader clicks, for an <a> found in markup - so the review can say which link it is. */
function anchorText(s, end) {
  const open = s.slice(0, end).lastIndexOf('<');
  if (open < 0 || !/^<a\b/i.test(s.slice(open))) return null;
  const close = s.indexOf('>', end);
  if (close < 0) return null;
  const stop = s.slice(close + 1).search(/<\/a\s*>/i);
  if (stop < 0) return null;
  const text = s
    .slice(close + 1, close + 1 + stop)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? (text.length > 80 ? `${text.slice(0, 77)}…` : text) : null;
}

/**
 * Every link to one of `hosts` in a string, as
 * { start, from, to, context, text }. `start` is the offset in the string, so
 * the write can replace exactly the occurrence that was ticked.
 */
export function findInString(s, hosts) {
  if (typeof s !== 'string' || !s) return [];
  const re = linkRe(hosts);
  const out = [];
  for (const m of s.matchAll(re)) {
    // Inside a longer host name or path: ...//news.samsung.com, /redirect?u=www.samsung.com
    const prev = s[m.index - 1];
    if (prev && /[\w.\-/@]/.test(prev)) continue;
    const rest = trimTail(m[2]);
    // What follows the host has to be where a link goes next, or nothing.
    if (rest && !/^[/?#]/.test(rest)) continue;
    /* A host name on its own is a name, not a link: "Samsung.com" in a field
       is the brand. Without a scheme or "//" it takes a path to be a link. */
    if (!m[1] && !/^\/[^/\s]/.test(rest)) continue;
    const from = m[0].slice(0, m[0].length - (m[2].length - rest.length));
    const context = linkContext(s, m.index, m.index + from.length);
    if (!context) continue;
    const to = relativeOf(rest);
    if (CONSOLE.test(to)) continue;
    out.push({ start: m.index, from, to, context, text: context === 'attribute' ? anchorText(s, m.index) : null });
  }
  return out;
}

/** The same for a property value of any shape: `index` is the array element, -1 for a single value. */
export function findInValue(value, hosts) {
  if (Array.isArray(value)) {
    return value.flatMap((v, index) => findInString(v, hosts).map((f) => ({ index, ...f })));
  }
  return findInString(value, hosts).map((f) => ({ index: -1, ...f }));
}

/**
 * The value with the picked links made relative. Each pick names an occurrence
 * by element and offset, and must still read what was found there - a value
 * that moved on since the scan is refused rather than patched in the wrong place.
 */
export function applyFixes(value, picks) {
  const fixOne = (s, list) => {
    let out = s;
    for (const p of [...list].sort((a, b) => b.start - a.start)) {
      if (out.slice(p.start, p.start + p.from.length) !== p.from) {
        throw new Error(`"${p.from}" is no longer where it was found`);
      }
      out = out.slice(0, p.start) + p.to + out.slice(p.start + p.from.length);
    }
    return out;
  };
  if (Array.isArray(value)) {
    return value.map((v, i) => {
      const list = picks.filter((p) => p.index === i);
      return list.length ? fixOne(v, list) : v;
    });
  }
  return fixOne(value, picks.filter((p) => p.index === -1));
}

/**
 * Children of jcr:content that are page properties, not page content: the
 * thumbnail and featured image, and anything the repository or AEM keeps there.
 */
export const isPagePropertyNode = (name) => name === 'image' || /^(?:cq|jcr|rep|sling):/.test(name);

/** Properties never holding an authored link. */
const SKIP_PROPS = /^(?:jcr:primaryType|jcr:mixinTypes|jcr:uuid|jcr:created(?:By)?|jcr:lastModified(?:By)?|cq:lastModified(?:By)?|cq:lastReplicat\w*|sling:resource(?:Super)?Type|cq:template)$/;

const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Every component under a page's jcr:content holding a full-URL link, in page
 * order, as { node, type, liveCopy, links: [{ prop, index, start, from, to, context, text, value }] }.
 * `node` is relative to jcr:content. jcr:content's own properties - the page
 * properties - are never looked at.
 */
export function scanContent(content, hosts) {
  const components = [];
  let nodes = 0;
  const walk = (node, rel, inherited) => {
    nodes++;
    const mixins = [].concat(node['jcr:mixinTypes'] || []);
    const liveCopy = mixins.includes('cq:LiveSyncCancelled') ? false : inherited || mixins.includes('cq:LiveRelationship');
    const links = [];
    for (const [prop, value] of Object.entries(node)) {
      if (isNode(value) || SKIP_PROPS.test(prop)) continue;
      for (const f of findInValue(value, hosts)) links.push({ prop, ...f, value });
    }
    if (links.length) {
      components.push({
        node: rel,
        resourceType: node['sling:resourceType'] || null,
        type: String(node['sling:resourceType'] || '').split('/').pop() || null,
        liveCopy,
        links
      });
    }
    for (const [name, child] of Object.entries(node)) {
      if (isNode(child)) walk(child, `${rel}/${name}`, liveCopy);
    }
  };

  const pageLive = [].concat(content?.['jcr:mixinTypes'] || []).includes('cq:LiveRelationship');
  for (const [name, child] of Object.entries(content || {})) {
    if (isNode(child) && !isPagePropertyNode(name)) walk(child, name, pageLive);
  }
  return { components, nodes };
}
