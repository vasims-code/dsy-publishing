/**
 * Finding links that point into another site's tree, and what each becomes
 * pointed at the page's own site.
 *
 *   on /content/samsung/sa/...:   /ae_ar/smartphones/galaxy-z-fold8-ultra/   wrong
 *                                 /sa/smartphones/galaxy-z-fold8-ultra/      right
 *
 * A "site code" is the path segment that names a site - sa, ae_ar, levant,
 * uk - the segment at the site root depth (3: /content/<brand>/<site>). The
 * page's own is read off its path, so a backup page under
 * /content/samsung/sa/india/backup/... is still an /sa page.
 *
 * Only the site code is changed. The form of the link stays as authored - a
 * relative /ae_ar/... stays relative, a https://www.samsung.com/ae/... stays a
 * full URL (making it relative is the Relative Link Fixer's job), a
 * /content/samsung/levant/... stays a content path.
 *
 * Pure - no network, no DOM - so the worker, the panel and a test share the
 * same rules, and the review can never list a fix the write would not make.
 * Whether a candidate code really is a site is asked of AEM by the worker:
 * this module only finds candidates.
 */

/** First segments that are never a site: the repository's own folders, and shared paths served beside the sites. */
const NOT_A_SITE = new Set(['content', 'dam', 'etc', 'libs', 'apps', 'conf', 'bin', 'var', 'mnt', 'is', 'aemapi', 'api', 'common']);

/** A site code: letters and digits with underscores between - uk, ae_ar, africa_en. */
const SITE_CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/i;

/* A placeholder where the site code goes: {site_code}, {site-code}. The SEO
   schema markup is authored this way for every locale at once. Whether the
   component fills it in when the page is published is not known here, so it
   is listed for an author to decide on, never ticked for them. */
const PLACEHOLDER = /^\{[a-z][\w-]*\}$/i;

/* Attributes and JSON keys that hold words for a reader, not a link. */
const TEXT_NAMES = /^(?:alt|title|label|placeholder|aria-[\w-]+|data-title|data-alt|data-label)$/i;

/* An image's list of sources: images are Copy a page's business, not this tool's. */
const LIST_ATTRS = /(?:^|-)srcset$/i;

/**
 * The page's site code and its content root, read off its path.
 * `depth` is the site root depth: 3 means /content/<brand>/<site>.
 */
export function siteOfPage(path, depth = 3) {
  const segs = String(path || '').split('/').filter(Boolean);
  if (segs[0] !== 'content' || segs.length < depth) return null;
  const site = segs[depth - 1];
  if (!site || !SITE_CODE.test(site)) return null;
  return { site: site.toLowerCase(), contentRoot: '/' + segs.slice(0, depth - 1).join('/') };
}

/** www.samsung.com and samsung.com always; the author instances passed in. Ports dropped, lower case. */
export function hostList(extra = []) {
  const out = new Set(['www.samsung.com', 'samsung.com']);
  for (const h of extra) {
    const host = String(h || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/:].*$/, '');
    if (host) out.add(host);
  }
  return [...out];
}

/* A value that is JSON, or the schema markup's body without its outer braces. */
const jsonShaped = (s) => /^\s*[[{]/.test(s) || /^\s*"[^"\\]*"\s*:/.test(s);

/* Words only code uses. A value that is neither markup nor JSON and has one of
   these is a script - the Static Content footerInclude is one. */
const SCRIPT_WORDS = /\b(?:function|const|let|var)\s|\b(?:document|window)\.|=>/;

/* A property in a script's object literal: href: "https://…", 'url': '/…'. */
const SCRIPT_PROP = /(?:^|[\s,{(\[])(["']?)([A-Za-z_$][\w$-]*)\1\s*:\s*(\\?)(["'`])((?:https?:\/\/|\/\/|\/)[^"'`<>\\\s]*)\3\4/g;

/**
 * The stretches of a string that are script: the whole value when it is one,
 * or each <script> block in markup. A link there is fixed like any other -
 * only the site code changes, and a site code is letters, digits and
 * underscores, so the script's syntax is never touched - but it is marked, so
 * the author is told to check the component still works afterwards.
 */
function scriptRanges(s) {
  if (!s.trim().startsWith('<') && !jsonShaped(s) && SCRIPT_WORDS.test(s)) return [[0, s.length]];
  return [...s.matchAll(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi)].map((m) => [m.index, m.index + m[0].length]);
}

/**
 * Where links are stored in a string, as { start, url, context }: the whole
 * value, an attribute in markup, a string in JSON, or a string in a script
 * (context 'script'). A path written in the
 * words of a sentence is not a link and is not touched.
 */
function urlsIn(s) {
  const out = [];
  const trimmed = s.trim();
  if (/^(?:https?:\/\/|\/\/|\/)[^\s<>"']*$/i.test(trimmed)) {
    out.push({ start: s.indexOf(trimmed), url: trimmed, context: 'value' });
    return out;
  }
  const scripts = scriptRanges(s);
  const inScript = (at) => scripts.some(([from, to]) => at >= from && at < to);
  // href="/ae_ar/..." and, inside a JSON-escaped value, href=\"/ae_ar/...\".
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(\\?)(["'])([^"'<>\\]*)\2\3/g)) {
    if (TEXT_NAMES.test(m[1]) || LIST_ATTRS.test(m[1])) continue;
    if (!/^(?:https?:\/\/|\/\/|\/)/i.test(m[4])) continue;
    out.push({ start: m.index + m[0].length - m[2].length - 1 - m[4].length, url: m[4], context: 'attribute', attr: m[1] });
  }
  /* JSON, or a fragment of it: the schema markup component keeps its body
     without the outer braces - "@type": "Guide", "url": "…" - and adds them itself. */
  if (jsonShaped(s)) {
    for (const m of s.matchAll(/"([^"\\]*)"\s*:\s*"((?:https?:\/\/|\/)[^"\\\s]*)"/g)) {
      if (TEXT_NAMES.test(m[1])) continue;
      out.push({ start: m.index + m[0].length - 1 - m[2].length, url: m[2], context: 'json' });
    }
  }
  if (!scripts.length) return out;
  // Object-literal links are looked for only inside a script, so nothing outside one is newly read as a link.
  const seen = new Set(out.map((u) => u.start));
  for (const m of s.matchAll(SCRIPT_PROP)) {
    const start = m.index + m[0].length - m[3].length - 1 - m[5].length;
    if (TEXT_NAMES.test(m[2]) || seen.has(start) || !inScript(start)) continue;
    seen.add(start);
    out.push({ start, url: m[5], context: 'script' });
  }
  // Whatever form a link in a script was found in, the author is warned about it.
  for (const u of out) if (inScript(u.start)) u.context = 'script';
  return out.sort((a, b) => a.start - b.start);
}

/**
 * One link, read: whether it points into a site other than `site`, which one,
 * where in the link its code sits, and what the link becomes. Null for a link
 * that is fine, or that is not ours to judge (another host, an image, a path
 * outside the brand).
 */
export function readLink(url, { site, contentRoot, hosts }) {
  const m = String(url).match(/^((?:https?:)?\/\/([^/?#\s]+))?([^?#]*)(.*)$/i);
  if (!m) return null;
  const [, origin = '', hostPort = '', path] = m;
  if (origin) {
    const host = hostPort.toLowerCase().replace(/:\d+$/, '');
    if (!hosts.includes(host)) return null;
  }
  if (!path.startsWith('/')) return null;

  /* /content/samsung/<code>/... or, outside /content, /<code>/... . Any other
     /content path - an image in /content/dam, another brand - is not a link
     into a site. */
  let prefix = '';
  if (path === contentRoot || path.startsWith(`${contentRoot}/`) || path.startsWith(`${contentRoot}.`)) prefix = contentRoot;
  else if (path.startsWith('/content/')) return null;

  const after = path.slice(prefix.length);
  const seg = after.match(/^\/([^/.]+)(\.html?)?(?=\/|$)/i);
  if (!seg) return null;
  const code = seg[1];
  const placeholder = PLACEHOLDER.test(code);
  if (!placeholder && (!SITE_CODE.test(code) || NOT_A_SITE.has(code.toLowerCase()) || code.toLowerCase() === site)) return null;
  // /editor.html/... and other consoles are never a page link.
  if (!prefix && seg[2]) return null;

  const at = origin.length + prefix.length + 1;
  const to = url.slice(0, at) + site + url.slice(at + code.length);
  /* The page the corrected link names, on this site - asked of AEM by the
     worker, so a link re-pointed at a page /sa does not have is flagged. */
  const rest = after
    .slice(1 + code.length)
    .replace(/\.html?$/i, '')
    .replace(/\/+$/, '');
  /* A placeholder keeps its spelling: it is shown struck out as written, and
     {site-code} beside {site_code} on one page is worth seeing. */
  return { code: placeholder ? code : code.toLowerCase(), at, to, target: `${contentRoot}/${site}${rest}`, placeholder };
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

/** Every candidate in a string, as { start, from, to, code, at, target, context, text }. */
export function findInString(s, ctx) {
  if (typeof s !== 'string' || !s) return [];
  const out = [];
  for (const u of urlsIn(s)) {
    const r = readLink(u.url, ctx);
    if (!r) continue;
    out.push({
      start: u.start,
      from: u.url,
      to: r.to,
      code: r.code,
      placeholder: r.placeholder,
      at: r.at,
      target: r.target,
      context: u.context,
      // In a script: fixed like the rest, with a warning to check the component afterwards.
      inScript: u.context === 'script',
      text: u.context === 'attribute' ? anchorText(s, u.start) : null
    });
  }
  return out;
}

/** The same for a property value of any shape: `index` is the array element, -1 for a single value. */
export function findInValue(value, ctx) {
  if (Array.isArray(value)) return value.flatMap((v, index) => findInString(v, ctx).map((f) => ({ index, ...f })));
  return findInString(value, ctx).map((f) => ({ index: -1, ...f }));
}

/**
 * The value with the picked links re-pointed. Each pick names an occurrence by
 * element and offset, and must still read what was found there - a value that
 * moved on since the scan is refused rather than patched in the wrong place.
 */
export function applyFixes(value, picks) {
  const fixOne = (s, list) => {
    let out = s;
    for (const p of [...list].sort((a, b) => b.start - a.start)) {
      if (out.slice(p.start, p.start + p.from.length) !== p.from) throw new Error(`"${p.from}" is no longer where it was found`);
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

/** Children of jcr:content that are page properties, not page content. */
const isPagePropertyNode = (name) => name === 'image' || /^(?:cq|jcr|rep|sling):/.test(name);

/** Properties never holding an authored link. */
const SKIP_PROPS = /^(?:jcr:primaryType|jcr:mixinTypes|jcr:uuid|jcr:created(?:By)?|jcr:lastModified(?:By)?|cq:lastModified(?:By)?|cq:lastReplicat\w*|sling:resource(?:Super)?Type|cq:template)$/;

const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Every component under a page's jcr:content holding a link into another site,
 * in page order, as { node, resourceType, type, liveCopy, links: [...] }.
 * `node` is relative to jcr:content. The page properties - jcr:content's own,
 * where the canonical and hreflang live - are not looked at: they are the
 * locale's own, set by Copy a page from the site's home page.
 */
export function scanContent(content, ctx) {
  const components = [];
  let nodes = 0;
  const walk = (node, rel, inherited) => {
    nodes++;
    const mixins = [].concat(node['jcr:mixinTypes'] || []);
    const liveCopy = mixins.includes('cq:LiveSyncCancelled') ? false : inherited || mixins.includes('cq:LiveRelationship');
    const links = [];
    for (const [prop, value] of Object.entries(node)) {
      if (isNode(value) || SKIP_PROPS.test(prop)) continue;
      for (const f of findInValue(value, ctx)) links.push({ prop, ...f, value });
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
    for (const [name, child] of Object.entries(node)) if (isNode(child)) walk(child, `${rel}/${name}`, liveCopy);
  };
  const pageLive = [].concat(content?.['jcr:mixinTypes'] || []).includes('cq:LiveRelationship');
  for (const [name, child] of Object.entries(content || {})) {
    if (isNode(child) && !isPagePropertyNode(name)) walk(child, name, pageLive);
  }
  return { components, nodes };
}

/** Only the links into codes AEM confirmed are sites, and placeholders; a component left with none is dropped. */
export function keepSites(components, sites) {
  return components
    .map((c) => ({ ...c, links: c.links.filter((l) => l.placeholder || sites.has(l.code)) }))
    .filter((c) => c.links.length);
}
