/**
 * The image rules of the Image Site Code Fixer, pure - no network, no DOM -
 * so the worker, the screen and a node test all read a page the same way.
 *
 * A page's images live in its own site's DAM folder. On /iq_ku an image is
 * /content/dam/samsung/iq_ku/... - or, written as Dynamic Media serves it,
 * https://images.samsung.com/is/image/samsung/assets/iq_ku/... . An image in
 * /lb's folder is one /lb owns: moved, renamed or deleted there, it goes from
 * this page too. This finds every image reference in the page's content, in
 * either form, and says which DAM folder it is in.
 */

import { normalizeAsset } from '../../core/rewrite.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The delivery hosts' asset folder: what images.samsung.com puts in front of a DAM path under /content/dam/samsung. */
const DELIVERY = '(?:https?:)?\\/\\/(?:stg-)?images\\.samsung\\.com\\/is\\/image\\/samsung\\/assets';

/** A folder name: a site code (iq_ku, ae_ar), or a shared folder (global, common). */
const FOLDER = '[A-Za-z0-9][\\w-]*';

/** Where a path in text ends - at a quote, a space, a bracket, a query or a fragment. */
const REST = '[^"\'\\s,)\\]}<>?#\\\\]+';

/**
 * The patterns for one DAM root. Only /content/dam/samsung has a delivery
 * form; another brand's root is read as paths only.
 */
export function patternsFor(damRoot) {
  const forms = [{ form: 'dam', before: esc(damRoot) }];
  if (damRoot === '/content/dam/samsung') forms.push({ form: 'delivery', before: DELIVERY });
  return forms.map((f) => ({ form: f.form, re: new RegExp(`(${f.before}\\/)(${FOLDER})(\\/${REST})`, 'g') }));
}

/** Rich text writes a space as %20; the DAM name has the space. A bad escape stays as it is. */
const decode = (s) => {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
};

/**
 * Every image reference in a string, as
 *   { start, from, form, folder, at, path }
 * `from` is the reference as written (no query), `at` where its folder name
 * starts inside `from`, `path` the DAM path it names, decoded and cut to the
 * asset itself (a rendition path names its asset).
 *
 * A value that is one DAM path and nothing else - a fileReference - is taken
 * whole, spaces and brackets included, since nothing else can be in it.
 */
export function findInString(s, damRoot) {
  if (typeof s !== 'string' || !s.includes('/')) return [];
  const whole = s.trim();
  const one = new RegExp(`^${esc(damRoot)}\\/(${FOLDER})\\/[^<>"\\n\\r\\t]+$`).exec(whole);
  if (one && !whole.slice(damRoot.length + 1).includes(damRoot)) {
    const start = s.indexOf(whole);
    const from = whole.split('?')[0].split('#')[0];
    return [{ start, from, form: 'dam', folder: one[1], at: damRoot.length + 1, path: normalizeAsset(from) }];
  }
  const out = [];
  for (const { form, re } of patternsFor(damRoot)) {
    re.lastIndex = 0;
    for (const m of s.matchAll(re)) {
      const [from, before, folder, rest] = m;
      out.push({
        start: m.index,
        from,
        form,
        folder,
        at: before.length,
        path: normalizeAsset(decode(`${damRoot}/${folder}${rest}`))
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The same for a value of any shape: `index` is the array element, -1 for a single value. */
export function findInValue(value, damRoot) {
  if (Array.isArray(value)) return value.flatMap((v, index) => findInString(v, damRoot).map((f) => ({ index, ...f })));
  return findInString(value, damRoot).map((f) => ({ index: -1, ...f }));
}

/** Children of jcr:content that are page properties, not page content. */
const isPagePropertyNode = (name) => name === 'image' || /^(?:cq|jcr|rep|sling):/.test(name);

/** Properties that never name an authored image. */
const SKIP_PROPS = /^(?:jcr:primaryType|jcr:mixinTypes|jcr:uuid|jcr:created(?:By)?|jcr:lastModified(?:By)?|cq:lastModified(?:By)?|cq:lastReplicat\w*|sling:resource(?:Super)?Type|cq:template)$/;

const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Every image reference in a page's content, in page order, as
 *   { node, prop, value, resourceType, type, liveCopy, index, start, from, form, folder, at, path }
 * `node` is relative to jcr:content. The page properties are not looked at -
 * the same rule as the Site Code Link Fixer: they are set from the site.
 */
export function scanContent(content, damRoot) {
  const refs = [];
  let nodes = 0;
  const walk = (node, rel, inherited) => {
    nodes++;
    const mixins = [].concat(node['jcr:mixinTypes'] || []);
    const liveCopy = mixins.includes('cq:LiveSyncCancelled') ? false : inherited || mixins.includes('cq:LiveRelationship');
    const resourceType = node['sling:resourceType'] || null;
    const type = String(resourceType || '').split('/').pop() || null;
    for (const [prop, value] of Object.entries(node)) {
      if (isNode(value) || SKIP_PROPS.test(prop)) continue;
      for (const f of findInValue(value, damRoot)) refs.push({ node: rel, prop, value, resourceType, type, liveCopy, ...f });
    }
    for (const [name, child] of Object.entries(node)) if (isNode(child)) walk(child, `${rel}/${name}`, liveCopy);
  };
  const pageLive = [].concat(content?.['jcr:mixinTypes'] || []).includes('cq:LiveRelationship');
  for (const [name, child] of Object.entries(content || {})) {
    if (isNode(child) && !isPagePropertyNode(name)) walk(child, name, pageLive);
  }
  return { refs, nodes };
}

/** Where an image from another folder lands in this site's folder: the same path under it. */
export const destOf = (path, damRoot, folder, to) => `${damRoot}/${to}${path.slice(`${damRoot}/${folder}`.length)}`;

/** A reference with its folder name swapped for `to`, written in the form it was found in. */
export const repoint = (ref, to) => ref.from.slice(0, ref.at) + to + ref.from.slice(ref.at + ref.folder.length);

/**
 * The value with the references to the picked images re-pointed. Each
 * occurrence must still read what the scan found there: a value that moved on
 * since is refused rather than patched in the wrong place.
 */
export function applyFixes(value, refs, to) {
  const fixOne = (s, list) => {
    let out = s;
    for (const r of [...list].sort((a, b) => b.start - a.start)) {
      if (out.slice(r.start, r.start + r.from.length) !== r.from) throw new Error(`"${r.from}" is no longer where it was found`);
      out = out.slice(0, r.start) + repoint(r, to) + out.slice(r.start + r.from.length);
    }
    return out;
  };
  if (Array.isArray(value)) {
    return value.map((v, i) => {
      const list = refs.filter((r) => r.index === i);
      return list.length ? fixOne(v, list) : v;
    });
  }
  return fixOne(value, refs.filter((r) => r.index === -1));
}
