/**
 * Finding every link a page's content holds, and where each one points on
 * this author instance.
 *
 * Pure - no network, no DOM - so the worker, the panel and a test page share
 * one set of rules, and what the review lists is exactly what the scan checked.
 *
 * WHAT COUNTS AS A LINK. Only where a link is stored:
 *
 *   the whole value          linkPath = "/sa_en/smartphones/galaxy-s/"
 *   an attribute in markup   <a href="/sa_en/offers/">, <img src="/content/dam/…">
 *   a CSS url()              background: url(/content/dam/…)
 *   a quoted value in JSON   {"url":"/sa_en/offers/"}
 *
 * Words that merely mention an address - "visit samsung.com" in a paragraph -
 * are not a link and are left alone.
 *
 * WHERE A LINK POINTS. The live site serves /content/samsung/sa_en/x as
 * /sa_en/x, so a site-relative link is checked at the content root of the
 * page being scanned: on a page under /content/samsung, /sa_en/x is
 * /content/samsung/sa_en/x. A full URL to one of our own hosts is read the
 * same way. A link to any other host is external and is listed but never
 * checked: the question this tool answers is whether the page exists on
 * author, never whether the live site answers.
 */

import { segs } from '../../core/paths.js';

/* ------------------------------------------------------------- the site */

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
 * What a scan needs to know about the page it is on. `rootDepth` is how many
 * segments make the site root: 3 means /content/<brand>/<site>, so the
 * content root is /content/<brand> and the site is the third segment.
 */
export function siteContext({ page, rootDepth = 3, hosts = [] }) {
  const s = segs(page);
  const depth = Number.isInteger(rootDepth) && rootDepth >= 2 ? rootDepth : 3;
  return {
    page: '/' + s.join('/'),
    contentRoot: '/' + s.slice(0, Math.min(depth - 1, s.length)).join('/'),
    site: s[depth - 1] || null,
    hosts: hostList(hosts)
  };
}

/* --------------------------------------------------------- where it goes */

/* The repository's own folders. A link into one is configuration or a
   client library, not a page an author meant to link to. */
const SYSTEM = new Set(['etc', 'libs', 'apps', 'conf', 'bin', 'var', 'mnt', 'home', 'system', 'tmp', 'oak:index', 'jcr:system']);

/* The author's own consoles. A link to one of them is a mistake of its own
   kind - a dead link on the live site - but it is not a page to look up. */
const CONSOLE = /^\/(?:(?:sites|assets|damadmin|siteadmin|miscadmin)\.html|cf#|siteadmin|damadmin|miscadmin|aem\/|crx\/)(?:$|[/?#.])/i;

const stripHtml = (p) => p.replace(/\.html?$/i, '');

/**
 * A path, as a link target: where on this author instance it should be.
 *
 *   /content/dam/…              an asset, checked as it is
 *   /content/…                  a page, checked as it is
 *   /sa_en/…                    site-relative: checked under the content root
 *   /etc/…, /libs/…             the repository's own folders - not a link
 */
function fromPath(p, raw, ctx) {
  let path = String(p).split(/[?#]/)[0];
  try {
    path = decodeURI(path);
  } catch {
    // A stray "%" - left as written, and encoded again on the way out.
  }
  if (/^\/editor\.html\//i.test(path)) path = path.slice('/editor.html'.length);
  if (CONSOLE.test(path)) return { kind: 'special', raw, note: 'an author console, not a page' };
  path = path.replace(/\/+$/, '') || '/';

  let s;
  try {
    s = segs(path);
  } catch {
    return { kind: 'special', raw, note: 'not a path AEM would serve' };
  }

  if (s[0] === 'content') {
    if (s[1] === 'dam') return { kind: 'asset', raw, path: '/' + s.join('/') };
    return { kind: 'page', raw, path: stripHtml('/' + s.join('/')), site: s[2] || null };
  }
  if (s.length && (SYSTEM.has(s[0]) || /^etc\./i.test(s[0]))) return { kind: 'system', raw, path };

  // Site-relative: /sa_en/offers/ lives at /content/samsung/sa_en/offers.
  const rel = s.length ? '/' + s.join('/') : '';
  return { kind: 'page', raw, path: stripHtml(`${ctx.contentRoot}${rel}`), site: s[0] || null };
}

/**
 * What a stored value points at, as
 *
 *   { kind: 'page' | 'asset', path }          something to look up on author
 *   { kind: 'external', href, host }          another host - listed, not checked
 *   { kind: 'anchor' | 'placeholder' | 'special', raw, note }
 *   { kind: 'system' }                        the repository's own folders - dropped
 *   null                                      not a link at all
 */
export function classify(raw, ctx) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^data:/i.test(s)) return null;

  if (s.startsWith('#')) {
    // "#FFFFFF" in a colour field is a colour; "#" on its own is a CTA that goes nowhere yet.
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return null;
    if (/^#\/?$/.test(s)) return { kind: 'placeholder', raw: s, note: 'goes nowhere yet' };
    return { kind: 'anchor', raw: s, note: 'a place on the same page' };
  }
  if (/^(?:javascript|mailto|tel|sms|whatsapp|intent|market|itms[a-z-]*|fb|twitter):/i.test(s)) {
    return { kind: 'special', raw: s, note: `a ${s.split(':')[0].toLowerCase()}: link` };
  }

  let url = null;
  if (/^\/\//.test(s)) url = `https:${s}`;
  else if (/^https?:/i.test(s)) url = s;
  else if (/^www\./i.test(s)) url = `https://${s}`;

  if (url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return { kind: 'special', raw: s, note: 'not a valid address' };
    }
    if (!/^https?:$/.test(u.protocol)) return { kind: 'special', raw: s, note: `a ${u.protocol} link` };
    const host = u.hostname.toLowerCase();
    if (!ctx.hosts.includes(host)) return { kind: 'external', raw: s, href: u.href, host };
    return fromPath(u.pathname, s, ctx);
  }

  if (s.startsWith('/')) return fromPath(s, s, ctx);
  return null;
}

/* --------------------------------------------------- links inside strings */

/* AEM's own properties: the node's type, its dates, who touched it. Never an authored link. */
const SKIP_PROPS = /^(?:jcr|cq|sling|rep|oak|granite|mix|nt):/;

/* A value that is nothing but one address. */
const WHOLE = /^(?:(?:https?:)?\/\/\S+|https?:\S+|\/\S*|#\S*|(?:javascript|mailto|tel|sms|whatsapp):\S*|www\.\S+)$/i;

/* Where markup keeps a link. srcset holds several, each with a size after it. */
const ATTR = /\b(href|src|poster|action|data-(?:href|link|url|src|path|poster)|srcset|data-srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')\s]+))\s*\)/gi;
/* Keys a component's JSON blob is likely to keep a link under. */
const JSON_KEY = /"(?:url|href|link|linkUrl|linkPath|path|src|target|redirect|ctaUrl|ctaLink|buttonLink|imageUrl|videoUrl)"\s*:\s*"((?:[^"\\]|\\.)*)"/gi;

const unescapeAttr = (v) =>
  v
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const unescapeJson = (v) => v.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(["\\/])/g, '$1');

/** The words a reader clicks, for an <a> found in markup - so the review can say which link it is. */
function anchorText(s, attrAt) {
  const open = s.lastIndexOf('<', attrAt);
  if (open < 0 || !/^<a\b/i.test(s.slice(open, open + 3))) return null;
  const close = s.indexOf('>', attrAt);
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
 * Every stored link in a string, as { start, raw, context, text }. `context`
 * is where it was found: the whole value, an attribute, a CSS url() or a JSON
 * string. `start` is the offset in the string, so two occurrences of one
 * address are two links.
 */
export function findInString(s) {
  if (typeof s !== 'string') return [];
  const v = s.trim();
  if (!v) return [];
  if (WHOLE.test(v)) return [{ start: s.indexOf(v), raw: v, context: 'value', text: null }];

  const out = [];
  const seen = new Set();
  const push = (start, raw, context, text) => {
    const r = String(raw || '').trim();
    if (!r) return;
    const key = `${start}|${r}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ start, raw: r, context, text: text || null });
  };

  if (s.includes('=')) {
    for (const m of s.matchAll(ATTR)) {
      const val = unescapeAttr(m[2] ?? m[3] ?? '');
      const at = m.index + m[0].length - (m[2] ?? m[3] ?? '').length - 1;
      if (/srcset$/i.test(m[1])) {
        for (const part of val.split(',')) push(at, part.trim().split(/\s+/)[0], 'attribute', null);
      } else {
        push(at, val, 'attribute', /^href$/i.test(m[1]) ? anchorText(s, m.index) : null);
      }
    }
  }
  if (/url\(/i.test(s)) {
    for (const m of s.matchAll(CSS_URL)) push(m.index, m[1] ?? m[2] ?? m[3] ?? '', 'css', null);
  }
  if (/"\s*:\s*"/.test(s)) {
    for (const m of s.matchAll(JSON_KEY)) push(m.index, unescapeJson(m[1]), 'json', null);
  }
  return out;
}

/* --------------------------------------------------------------- the page */

const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Children of jcr:content that are page properties, not page content: the
 * thumbnail, and anything the repository or AEM keeps there.
 */
export const isPagePropertyNode = (name) => name === 'image' || /^(?:cq|jcr|rep|sling):/.test(name);

/* The words on a CTA, read off the property beside its link: linkPath has
   linkText, ctaUrl has ctaText, and failing those the node's own text. */
const TEXT_PROPS = ['linkText', 'ctaText', 'buttonText', 'text', 'label', 'title', 'linkTitle', 'headlineText'];

function ctaText(node, prop) {
  const twin = prop.replace(/(Path|Url|Link|Href|Target)(\d*)$/i, 'Text$2');
  const candidates = twin !== prop ? [twin, ...TEXT_PROPS] : TEXT_PROPS;
  for (const p of candidates) {
    const v = node[p];
    if (typeof v === 'string' && v.trim() && !/[<>]/.test(v)) {
      // Authored copy carries its line breaks; a label on one line does not.
      const t = v.replace(/\s+/g, ' ').trim();
      return t.length > 80 ? `${t.slice(0, 77)}…` : t;
    }
  }
  return null;
}

/**
 * Every link in a page's content, in page order, as
 *
 *   { components: [{ node, resourceType, type, pageProps, links: [...] }], nodes }
 *
 * where each link is { prop, index, start, raw, context, text, target }.
 * `node` is relative to jcr:content; '' is jcr:content itself, whose own
 * properties - the canonical, a redirect target - are read as the page's.
 * A multifield item with no sling:resourceType of its own is named after the
 * nearest component above it, so the review can say which component it is in.
 */
export function scanContent(content, ctx) {
  const components = [];
  let nodes = 0;

  const collect = (node) => {
    const links = [];
    for (const [prop, value] of Object.entries(node)) {
      if (isNode(value) || SKIP_PROPS.test(prop)) continue;
      const values = Array.isArray(value) ? value : [value];
      values.forEach((s, i) => {
        if (typeof s !== 'string') return;
        for (const f of findInString(s)) {
          const target = classify(f.raw, ctx);
          if (!target || target.kind === 'system') continue;
          links.push({
            prop,
            index: Array.isArray(value) ? i : -1,
            start: f.start,
            raw: f.raw,
            context: f.context,
            text: f.text || (f.context === 'value' ? ctaText(node, prop) : null),
            target
          });
        }
      });
    }
    return links;
  };

  const walk = (node, rel, owner) => {
    nodes++;
    const rt = node['sling:resourceType'] || null;
    const mine = rt ? { resourceType: rt, node: rel } : owner;
    const links = collect(node);
    if (links.length) {
      components.push({
        node: rel,
        resourceType: mine?.resourceType || null,
        type: mine?.resourceType ? String(mine.resourceType).split('/').pop() : null,
        /* Where this node sits under its component: "list/item0" under a carousel. */
        within: mine && mine.node !== rel ? rel.slice(mine.node.length + 1) : '',
        pageProps: false,
        links
      });
    }
    for (const [name, child] of Object.entries(node)) {
      if (isNode(child)) walk(child, `${rel}/${name}`, mine);
    }
  };

  nodes++;
  const own = collect(content || {});
  if (own.length) {
    components.push({ node: '', resourceType: null, type: 'Page properties', within: '', pageProps: true, links: own });
  }
  for (const [name, child] of Object.entries(content || {})) {
    if (isNode(child) && !isPagePropertyNode(name)) walk(child, name, null);
  }
  return { components, nodes };
}

/**
 * The distinct places the page's links go, each with every use of it. One
 * target is looked up once however many CTAs point at it, and the review
 * lists it once with all of them under it.
 */
export function targetsOf(components) {
  const map = new Map();
  for (const c of components) {
    for (const l of c.links) {
      const t = l.target;
      const key = t.kind === 'page' || t.kind === 'asset' ? `${t.kind}|${t.path}` : `${t.kind}|${t.href || t.raw}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          kind: t.kind,
          path: t.path || null,
          href: t.href || null,
          host: t.host || null,
          raw: t.raw,
          site: t.site || null,
          note: t.note || null,
          uses: []
        });
      }
      map.get(key).uses.push({
        node: c.node,
        component: c.title || c.type || (c.pageProps ? 'Page properties' : c.node),
        within: c.within,
        prop: l.prop,
        index: l.index,
        raw: l.raw,
        text: l.text,
        context: l.context
      });
    }
  }
  return [...map.values()];
}

/* ------------------------------------------------------------- the answer */

/**
 * What a lookup says about a target. `answer` is AemClient.lookup's result;
 * `lower` is the answer for the same path in lower case, when that was asked.
 *
 *   ok           it is there - for a page, a cq:Page with content, or a
 *                redirect that landed on one
 *   missing      404: nothing is there. This is a broken link.
 *   case         nothing at the path as written, but there in lower case
 *   notpage      something is there, but not a page: a folder, or a page
 *                with no content - which renders as 404 on the live site
 *   forbidden    403: this account cannot see it, so nobody can say
 *   error        the server did not answer properly
 */
export function verdict(target, answer, lower = null) {
  if (answer.state === 'no') {
    if (lower?.state === 'yes') return { state: 'case', note: `exists only as ${target.path.toLowerCase()}` };
    return { state: 'missing', note: 'nothing is at this path on author' };
  }
  if (answer.state === 'forbidden') return { state: 'forbidden', note: 'your account cannot read this path' };
  /* The server sent the request on and answered at the other end. A redirect
     is how a page is retired, not how one breaks: the link still lands
     somewhere that renders, and a dead end would have come back as the 404
     above. So it is OK, and the screen says where it goes. */
  if (answer.state === 'redirected') return { state: 'ok', redirect: answer.to };
  if (answer.state !== 'yes') return { state: 'error', note: answer.note || 'no answer' };

  const json = answer.json || {};
  const type = json['jcr:primaryType'] || null;

  if (target.kind === 'page') {
    if (type !== 'cq:Page') return { state: 'notpage', note: `exists, but is ${type ? `a ${type}` : 'not a page'} - it would not render` };
    const jc = json['jcr:content'];
    if (!isNode(jc)) return { state: 'notpage', note: 'a page with no content - it would not render' };
    return {
      state: 'ok',
      title: typeof jc['jcr:title'] === 'string' ? jc['jcr:title'] : null,
      /* Its own redirect property if it has one, else where the request was
         actually sent - both are "this link goes somewhere else". */
      redirect: (typeof jc.redirectTarget === 'string' && jc.redirectTarget.trim() ? jc.redirectTarget.trim() : null) || answer.to || null
    };
  }

  if (type === 'dam:Asset') return { state: 'ok' };
  if (/folder/i.test(String(type))) return { state: 'notpage', note: 'a folder, not a file' };
  return { state: 'ok', note: type ? `a ${type}` : null };
}
