/**
 * Site-token rewriting: turning every reference to one site into the same
 * reference against another. Pure - no network, no DOM - so the panel, the
 * content script and a node test harness all use the same rules.
 *
 * A "site token" is the path segment that identifies a locale site, e.g. the
 * `ae` in /content/samsung/ae/... . The same token shows up in a page's
 * properties in several disguises, and a copy that only fixes one of them
 * leaves a page that half-points back at where it came from:
 *
 *   /content/samsung/ae/...            authored link
 *   https://www.samsung.com/ae/...     canonical / hreflang
 *   /ae/...                            site-relative link inside rich text
 *   /content/dam/samsung/ae/...        asset reference
 *
 * When source and destination sit on the SAME site there is nothing to rewrite;
 * `enabled` is false and every value passes through untouched.
 */

import { segs } from './paths.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What may follow a token for it to be the whole segment.
 *
 * `.` `?` `#` `&` are in here deliberately: /content/samsung/ae.html and
 * /ae?wcmmode=disabled are ordinary authored links, and a lookahead that only
 * accepted `/` or a quote silently left both of them pointing at the source.
 */
const TAIL = '(?=[\\/.?#&"\'\\s,)\\]}<]|$)';

/** What may precede a bare site-relative token, so /aerodynamics is not one. */
const BOUND = '(^|[\\s"\'(\\[=>,])';

/**
 * Derive the content root, the two site tokens and the two DAM roots.
 *
 * Nothing here knows which locales are involved: `rootDepth` says how many
 * leading segments are site root, and the token is whatever segment follows on
 * each side. 3 means /content/<brand>/<site>, so uk -> lb, se -> no and
 * acme/de -> acme/fr all fall out the same way, in either direction.
 *
 * ONE CASE IT CANNOT DERIVE. A locale written as two segments - /content/
 * samsung/in/en - is indistinguishable from a one-segment locale with a section
 * under it. /content/samsung/lb/india/backup is exactly that shape and means
 * something different: a backup folder inside lb, whose links should still
 * point at /lb. No rule separates them, so `srcSite` and `destSite` can be
 * passed in explicitly when the token is not a single segment.
 */
export function resolveSites({
  source, dest, rootDepth = 3,
  srcSite: srcOverride = null, destSite: destOverride = null,
  hosts = [], shopHosts = [], rewriteShop = false
}) {
  const s = segs(source);
  const d = segs(dest);
  const trimToken = (t) => String(t || '').replace(/^\/+|\/+$/g, '') || null;

  const contentRoot = '/' + s.slice(0, rootDepth - 1).join('/');
  const srcSite = trimToken(srcOverride) || s[rootDepth - 1] || null;
  const destSite = trimToken(destOverride) || d[rootDepth - 1] || null;

  // /content/samsung -> /content/dam/samsung
  const damRoot = '/content/dam/' + segs(contentRoot).slice(1).join('/');

  return {
    contentRoot,
    damRoot,
    srcSite,
    destSite,
    srcDam: `${damRoot}/${srcSite}`,
    destDam: `${damRoot}/${destSite}`,
    /* One token containing the other (in -> in/en) would let a rule match what
     * an earlier rule just produced. Callers refuse rather than risk it. */
    overlapping:
      !!srcSite && !!destSite &&
      (srcSite.startsWith(`${destSite}/`) || destSite.startsWith(`${srcSite}/`)),
    derived: {
      srcSite: !trimToken(srcOverride),
      destSite: !trimToken(destOverride)
    },
    enabled: !!srcSite && !!destSite && srcSite !== destSite,
    hosts,
    shopHosts,
    rewriteShop
  };
}

/**
 * Every prefix a site token can sit behind, longest first so that
 * `host/content/samsung/ae` is matched before `host/ae` can claim part of it.
 */
function prefixes(sites, hostPathPrefixes) {
  const out = [{ id: 'contentPath', before: sites.contentRoot, boundary: false }];

  if (sites.rewriteShop) {
    for (const h of sites.shopHosts) out.push({ id: `shop:${h}`, before: h, boundary: false });
  }

  for (const p of [...new Set(hostPathPrefixes)].sort((a, b) => b.length - a.length)) {
    for (const h of sites.hosts) out.push({ id: `host:${h}${p || '/'}`, before: h + p, boundary: false });
  }

  // Bare /ae/... last: by now the qualified forms have already been consumed.
  out.push({ id: 'siteRelative', before: '', boundary: true });
  return out;
}

const hostPathPrefixesOf = (sites) => ['', sites.contentRoot, '/' + segs(sites.contentRoot).slice(1).join('/')];

/**
 * `images: false` leaves DAM paths pointing where they are, `links: false`
 * leaves links: the run keeps using the source site's images or pages - a
 * shared site like /global, say - instead of re-pointing them.
 *
 * `alsoSites` re-points links to OTHER sites too - a /global page's links to
 * /uk, say - at the destination. Only their written-out forms, a URL on a
 * listed host or a /content path: a bare /uk/... inside text is too easily
 * something else. Their images are left alone.
 */
export function buildRules(sites, { images = true, links = true, alsoSites = [] } = {}) {
  if (!sites.enabled) return { rules: [], leftoverRe: null, sites };

  const hostPathPrefixes = hostPathPrefixesOf(sites);

  const rules = images ? [{ id: 'dam', re: new RegExp(esc(sites.srcDam) + TAIL, 'g'), to: sites.destDam }] : [];

  for (const p of links ? prefixes(sites, hostPathPrefixes) : []) {
    rules.push({
      id: p.id,
      re: new RegExp((p.boundary ? BOUND : '') + esc(`${p.before}/${sites.srcSite}`) + TAIL, 'g'),
      to: (p.boundary ? '$1' : '') + `${p.before}/${sites.destSite}`
    });
  }

  for (const other of alsoSites) {
    if (!isOtherSite(other, sites)) continue;
    for (const p of prefixes(sites, hostPathPrefixes)) {
      if (p.boundary) continue;
      // The same end as otherSiteLinks: what the review lists is exactly what is re-pointed.
      rules.push({ id: `site:${other}:${p.id}`, re: new RegExp(esc(`${p.before}/${other}`) + OTHER_TAIL, 'g'), to: `${p.before}/${sites.destSite}` });
    }
  }

  /**
   * Leftover detection runs on the value AFTER rewriting, so anything still
   * carrying the source token with a real path tail is by definition something
   * the rules did not handle. One scan of the whole surrounding token catches
   * prefixes the rules skip on purpose (shop hosts) and hosts nobody listed -
   * a detector built from the rule prefixes can see neither.
   */
  const leftoverRe = new RegExp(
    `[^\\s"'(\\[=>,]*\\/${esc(sites.srcSite)}${TAIL}[^"'\\s,)\\]}<]*`,
    'g'
  );

  return { rules, leftoverRe, sites };
}

/**
 * First path segments that are never a site: the repository's own folders, and
 * the shared paths www.samsung.com serves beside its sites. Whether any other
 * token is a site is asked of AEM - see the Sync page worker - never guessed
 * from a list of sites.
 */
const NOT_A_SITE = new Set(['content', 'dam', 'etc', 'libs', 'apps', 'conf', 'bin', 'var', 'mnt', 'is', 'aemapi', 'api', 'common']);

/**
 * What may follow another site's token for it to be the whole segment: a path
 * or query, a quote or bracket, ".html" (/content/samsung/uk.html), or a full
 * stop ending a sentence - but not "etc.clientlibs" or "favicon.ico".
 */
const OTHER_TAIL = '(?=[\\/?#&"\'\\s,)\\]}<|]|\\.html?(?![\\w-])|\\.(?=[\\s"\'<)\\]]|$)|$)';

/**
 * Is this a site other than the source and the destination? Not them, and not
 * part of them either: with a destination locale written as "in/en", /in is not
 * another site - re-pointing it would turn /in/en/... into /in/en/en/....
 */
export function isOtherSite(site, sites) {
  if (!site || site === segs(sites.contentRoot).slice(1)[0] || NOT_A_SITE.has(site)) return false;
  const part = (token) => token === site || String(token).startsWith(`${site}/`) || site.startsWith(`${token}/`);
  return !part(sites.srcSite) && !part(sites.destSite);
}

/**
 * Links to sites that are neither the source nor the destination, as
 * [{ site, link }] - read off the value, never a list of sites: whatever site a
 * page links to is found. Only the written-out forms the rules can re-point: a
 * URL on a listed host (www.samsung.com/uk/...) or a /content path
 * (/content/samsung/uk/...). A site token is lower case, letters and digits
 * with underscores between (uk, ae_ar, africa_en); "{site-code}" and
 * "etc.clientlibs" are not one. Candidates only: the Sync page asks AEM which
 * of them are sites before it offers any.
 */
export function otherSiteLinks(value, sites) {
  if (!sites.enabled) return [];
  const strings = (Array.isArray(value) ? value : [value]).filter((v) => typeof v === 'string');
  if (!strings.length) return [];
  const before = [
    ...new Set(prefixes(sites, hostPathPrefixesOf(sites)).filter((p) => !p.boundary).map((p) => p.before))
  ].sort((a, b) => b.length - a.length);
  // The scheme is taken along only so the link reads whole on the review.
  const re = new RegExp(`(?:https?:\\/\\/)?(?:${before.map(esc).join('|')})\\/([a-z][a-z0-9]*(?:_[a-z0-9]+)*)${OTHER_TAIL}`, 'g');
  const out = [];
  for (const s of strings) {
    for (const m of s.matchAll(re)) {
      if (!isOtherSite(m[1], sites)) continue;
      /* The rest of the link is read on but not consumed, so a link inside this
       * one's query - ?returnUrl=https://www.samsung.com/uk/... - is found too. It
       * ends where markup does, at an escaped quote, and without a sentence's full stop. */
      const rest = s
        .slice(m.index + m[0].length)
        .match(/^[^"'\s,)\]}<>|]*/)[0]
        .split(/&quot;|&#34;|&#x22;/i)[0];
      out.push({ site: m[1], link: (m[0] + rest).replace(/[.,;:!?]+$/, '') });
    }
  }
  return out;
}

export function rewriteString(value, { rules }) {
  if (typeof value !== 'string' || !rules.length) return null;
  let out = value;
  const hits = [];
  for (const r of rules) {
    r.re.lastIndex = 0;
    const next = out.replace(r.re, r.to);
    if (next !== out) {
      out = next;
      hits.push(r.id);
    }
  }
  return out === value ? null : { value: out, rules: hits };
}

/** Rewrites a property value of any shape, returning it unchanged if nothing matched. */
export function rewriteValue(value, ctx) {
  if (!ctx.rules.length) return value;
  if (Array.isArray(value)) {
    return value.map((v) => {
      const r = rewriteString(v, ctx);
      return r ? r.value : v;
    });
  }
  const r = rewriteString(value, ctx);
  return r ? r.value : value;
}

/**
 * The individual references inside a value that the rules would change, as
 * from -> to pairs.
 *
 * `rewriteValue` answers "what does this property become", which is what has to
 * be written but not what anyone wants to read: a rich-text blob is two
 * thousand characters of which forty matter. This pulls out just the links.
 *
 * It finds whole tokens the same way `leftovers` does, then asks the rules what
 * each one becomes on its own - so the list can never claim a rewrite the real
 * one would not make.
 */
export function rewriteTokens(value, ctx) {
  if (!ctx.leftoverRe) return [];
  const strings = Array.isArray(value)
    ? value.filter((v) => typeof v === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

  const out = [];
  for (const s of strings) {
    if (!s.includes('/' + ctx.sites.srcSite)) continue;
    ctx.leftoverRe.lastIndex = 0;
    let m;
    while ((m = ctx.leftoverRe.exec(s)) !== null) {
      if (m[0]) {
        const to = rewriteValue(m[0], ctx);
        if (to !== m[0]) out.push({ from: m[0], to });
      }
      if (m.index === ctx.leftoverRe.lastIndex) ctx.leftoverRe.lastIndex++;
    }
  }
  return out;
}

export function leftovers(value, ctx) {
  if (!ctx.leftoverRe) return [];
  const strings = Array.isArray(value)
    ? value.filter((v) => typeof v === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

  const found = [];
  for (const s of strings) {
    if (!s.includes('/' + ctx.sites.srcSite)) continue;
    ctx.leftoverRe.lastIndex = 0;
    let m;
    while ((m = ctx.leftoverRe.exec(s)) !== null) {
      if (m[0]) found.push(m[0]);
      if (m.index === ctx.leftoverRe.lastIndex) ctx.leftoverRe.lastIndex++;
    }
  }
  return found;
}

/* ------------------------------------------------------------------ assets */

/**
 * A DAM reference as authored is not always a DAM path. Dynamic Media appends
 * a preset (`?$ORIGIN_JPG$`), rich text appends a fragment, and components
 * sometimes point at a rendition inside the asset. Probing any of those as a
 * path is wrong - and worse, a query string LOOKS valid to the server, which
 * answers 200 for the asset and hides the mistake.
 */
export function normalizeAsset(raw) {
  let a = String(raw).split('?')[0].split('#')[0].replace(/[.,;:]+$/, '');
  const cut = a.search(/\/(?:_jcr_content|jcr:content)(?:\/|$)/);
  if (cut > -1) a = a.slice(0, cut);
  return a.replace(/\/+$/, '');
}

export function assetMatcher(srcDam) {
  return new RegExp(esc(srcDam) + '\\/[^"\'\\s,)\\]}<>?#\\\\]+', 'g');
}

export function assetsIn(value, re) {
  const strings = Array.isArray(value)
    ? value.filter((v) => typeof v === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

  const found = [];
  for (const s of strings) {
    re.lastIndex = 0;
    const m = s.match(re);
    if (m) for (const a of m) found.push(normalizeAsset(a));
  }
  return found;
}

/* -------------------------------------------------------------- properties */

/** Written by AEM itself, or meaningless at a new location. Never synced. */
export const SYSTEM_PROPS = [
  'jcr:primaryType', 'jcr:mixinTypes', 'jcr:uuid', 'jcr:created', 'jcr:createdBy',
  'jcr:baseVersion', 'jcr:predecessors', 'jcr:successors', 'jcr:versionHistory',
  'jcr:isCheckedOut', 'jcr:frozenUuid', 'jcr:frozenPrimaryType', 'jcr:lockOwner',
  'jcr:lockIsDeep', 'jcr:lastModified', 'jcr:lastModifiedBy', 'cq:lastModified',
  'cq:lastModifiedBy', 'cq:lastReplicated', 'cq:lastReplicatedBy', 'cq:lastReplicationAction'
];

/**
 * AEM serialises dates as "Wed Nov 18 2020 05:17:56 GMT+0900". Writing one back
 * as a string would turn a Date property into a String property, so any value
 * in that shape is left alone on both sides of the diff.
 */
const DATE_RE = /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4}$/;
export const isDate = (v) => typeof v === 'string' && DATE_RE.test(v);

/**
 * Sling needs to be told the type, or everything arrives as a String.
 *
 * Every element is inspected, not just the first: an array holding 1.5 is a
 * Double[], and calling it Long[] makes Sling reject the whole request - which
 * takes every other property in that request down with it.
 */
export function typeHint(v) {
  const arr = Array.isArray(v);
  const vals = arr ? v : [v];
  const t = vals.length ? typeof vals[0] : 'string';

  let base;
  if (t === 'boolean') base = 'Boolean';
  else if (t === 'number') {
    base = vals.some((x) => typeof x === 'number' && !Number.isInteger(x)) ? 'Double' : 'Long';
  } else base = 'String';

  return base + (arr ? '[]' : '');
}

export const isEmptyArray = (v) => Array.isArray(v) && v.length === 0;
export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
