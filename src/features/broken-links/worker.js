/**
 * broken-links: read a page, find every link in its content, and look each
 * one up on this author instance.
 *
 * Reads only. The page is read the way the copy deck reads it (readPageCopy):
 * its jcr:content subtree as JSON, and the dialogs of the components on it -
 * so every link found is named the way the copy deck names a text: the
 * component as the editor shows it ("03 · FT02_Feature Benefit · Galaxy S25")
 * and the field as its dialog labels it ("CTA link"), which is where an
 * author goes to fix it. Each distinct target is then one more read. The live
 * site is never asked: a link is broken here when the page it names is not
 * on author, whatever the dispatcher would say.
 */

import { abort, isSignInAnswer, signedOut } from '../../core/aem-client.js';
import { humanize, norm } from '../../core/paths.js';
import { componentTypes, fieldLabel } from '../copy-deck/core.js';
import { readDialogs } from '../copy-deck/dialog.js';
import { readPageCopy } from '../copy-deck/worker.js';
import { anchorVerdict, idsIn, scanContent, siteContext, targetsOf, verdict } from './links.js';

/** How many lookups go to the server at once. Kind to a busy author instance; quick enough on a long page. */
const PARALLEL = 6;

/** Run `fn` over `items`, at most `limit` at a time; results in input order. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    })
  );
  return out;
}

/* ------------------------------------------------------------- lookups */

/* Starts from the clock, not 0: the dispatcher caches by URL, so a read in
   one run must never repeat a URL from an earlier run. */
let ck = Date.now();

/**
 * A repository path as a URL path, exactly as the client encodes one: a `%XX`
 * already in it is kept rather than encoded again, and `#` and `?` are
 * encoded, which encodeURI would leave as URL syntax.
 */
const encPath = (p) =>
  norm(p)
    .split(/(%[0-9A-Fa-f]{2})/)
    .map((part, i) => (i % 2 ? part : encodeURI(part).replace(/#/g, '%23').replace(/\?/g, '%3F')))
    .join('');

/**
 * Where a followed redirect ended up, as a path on this instance - or null if
 * the answer came straight back. `fetch` follows the whole chain, so this is
 * the end of it, not the first hop.
 */
function redirectedTo(res) {
  if (!res.redirected || !res.url) return null;
  let u;
  try {
    u = new URL(res.url, location.origin);
  } catch {
    return null;
  }
  // Off this instance altogether - the live site, say: name it in full.
  if (u.origin !== location.origin) return `${u.origin}${u.pathname}`;
  // .../galaxy-s22.html, or the .1.json that was asked for, back to the path.
  return u.pathname.replace(/\/([^/.]+)\.[^/]*$/, '/$1');
}

/**
 * Is there a node at this path, and what is it? The question a link check
 * asks, once per link, so nothing here stops the run: a server hiccup on
 * one link is that link's answer, not the end of the scan.
 *
 *   yes        { state: 'yes', json }   the node at depth 1: its own properties
 *                                       and its children's, so a page's
 *                                       jcr:content comes with it
 *   no         404 - nothing is there
 *   forbidden  403 - something is there that this account may not read
 *   redirected { state: 'redirected', to }  the server sent the request
 *                                       somewhere else and answered there
 *   error      no answer, a timeout, a 5xx, or an answer that is not JSON
 *
 * A 200 is only "yes" when it is the node's JSON. A signed-out session
 * answers every path with the sign-in page at 200 - which is the one answer
 * that does stop the run, because every link would pass on it.
 */
async function lookup(path, { timeout = 20000 } = {}) {
  let res;
  try {
    res = await fetch(`${encPath(path)}.1.json?ck=${++ck}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeout)
    });
  } catch (e) {
    if (e?.isAbort) throw e;
    return { state: 'error', note: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timed out' : 'no answer from the server' };
  }
  if (res.status === 404) return { state: 'no' };
  if (res.status === 403) return { state: 'forbidden' };
  if (!res.ok) return { state: 'error', note: `HTTP ${res.status}` };

  const text = await res.text().catch(() => '');
  try {
    return { state: 'yes', json: JSON.parse(text), to: redirectedTo(res) };
  } catch {
    if (isSignInAnswer(res, text)) throw signedOut();
    /* Sent somewhere else, and answered there. A page whose redirect is set
       answers the .json request with the target's HTML - the .json is lost
       on the way - so the body is not JSON and never was going to be. The
       link resolves: reading that as "no answer" called every redirected
       page a problem. The status above is the end of the chain, so a 404 at
       the far end is already a 404 here. */
    const to = redirectedTo(res);
    if (to) return { state: 'redirected', to };
    return { state: 'error', note: 'answered with something other than JSON' };
  }
}

/* ------------------------------------------------------------ the site */

/**
 * Our hosts: www.samsung.com and samsung.com, this author instance, the other
 * author instances in settings, and whatever Settings adds. A link to one of
 * them is a link into this repository and is looked up here.
 */
function hostsFrom(settings) {
  const origins = (settings?.origins || []).map((o) => {
    try {
      return new URL(o).hostname;
    } catch {
      return null;
    }
  });
  const extra = String(settings?.linkSiteHosts || '')
    .split(/[,\s]+/)
    .map((h) => h.trim())
    .filter(Boolean);
  return [location.hostname, ...origins, ...extra].filter(Boolean);
}

const depthFrom = (settings) => {
  const n = Number(settings?.rootDepth);
  return Number.isInteger(n) && n >= 2 ? n : 3;
};

/* ------------------------------------------------------------ the page */

/**
 * The page, read as the copy deck reads it: checked, its jcr:content whole,
 * and the dialogs and names of its components. A product page (PD) has its
 * copy in PIM, so the copy deck reads nothing past its properties - but its
 * links are authored in AEM like any other page's, so its tree is read here
 * and its components are named from their dialogs alone.
 */
async function readPage({ client, settings, params }) {
  const copy = await readPageCopy({ client, settings, params });
  const { page, info } = copy;
  if (!copy.pd) return { page, title: info.title, content: copy.tree, rows: copy.deck.rows, dialogs: copy.dialogs, titles: copy.titles, pd: false };

  const content = await client.readTreeWhole(`${page}/jcr:content`);
  if (!content) throw abort(`The page has no jcr:content: ${page}`);
  let dialogs = {};
  let titles = {};
  try {
    ({ dialogs, titles } = await readDialogs(client, componentTypes(content)));
  } catch {
    // Never a reason to stop: without the dialogs, the components go by their node names.
  }
  return { page, title: info.title, content, rows: [], dialogs, titles, pd: true };
}

/* --------------------------------------------------------- the naming */

/* A link field's label where its dialog does not give one: the words an
   author knows it by rather than the property's name. Anything else reads as
   its property spelled out - "linkTitle" as "Link title". */
const LINK_LABELS = {
  linkPath: 'Link',
  linkUrl: 'Link',
  link: 'Link',
  url: 'Link',
  href: 'Link',
  ctaUrl: 'CTA link',
  ctaLink: 'CTA link',
  ctaPath: 'CTA link',
  buttonLink: 'Button link',
  buttonUrl: 'Button link',
  fileReference: 'Image',
  imagePath: 'Image',
  image: 'Image',
  videoUrl: 'Video',
  videoPath: 'Video',
  canonical: 'Canonical URL',
  canonicalUrl: 'Canonical URL',
  redirectTarget: 'Redirect'
};

const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** The component's node: the one with links, less where inside it the links sit. */
const componentNode = (c) => (c.within ? c.node.slice(0, c.node.length - c.within.length - 1) : c.node);

/**
 * The copy deck's names for where a link sits, from what it read: `rows` are
 * its rows (each names its node, section and field), `dialogs` what the
 * components' dialogs say about their fields, `titles` the components' own
 * names from /apps.
 */
function namer({ content, rows, dialogs, titles }) {
  /* A component's section is the one the copy deck gave its texts: the row
     on the component's own node, else the shallowest row under it - a
     component nested inside it sits deeper. */
  const bySection = new Map();
  for (const r of rows || []) {
    if (!r?.path && r?.path !== '') continue;
    const have = bySection.get(r.path);
    if (!have) bySection.set(r.path, r);
  }
  const rowPaths = [...bySection.keys()].filter((p) => p !== '');
  const sectionOf = (node) => {
    if (bySection.has(node)) return bySection.get(node).section;
    const under = rowPaths.filter((p) => p.startsWith(`${node}/`)).sort((a, b) => a.split('/').length - b.split('/').length);
    return under.length ? bySection.get(under[0]).section : null;
  };

  /* With no text on the sheet, the component goes by its own name - the one
     the editor shows - and its headline, as the copy deck would name it,
     without a number: it has none on the sheet. */
  const nodeAt = (path) => {
    let n = content;
    for (const seg of path ? path.split('/') : []) {
      n = n?.[seg];
      if (!isNode(n)) return null;
    }
    return n;
  };
  const ownName = (c) => {
    const base = (c.resourceType && titles?.[c.resourceType]) || (c.type ? humanize(c.type.replace(/^[a-z]{2}-g-/, '')) : null) || c.node;
    const node = nodeAt(componentNode(c));
    const headline = [node?.headlineText, node?.desktopHeadlineText, node?.contents?.desktopHeadlineText].find((v) => typeof v === 'string' && v.trim());
    if (!headline) return base;
    const short = headline.replace(/<[^>]*>/g, '').split(/\r?\n/)[0].trim();
    return `${base} · ${short.length > 40 ? `${short.slice(0, 39)}…` : short}`;
  };

  const fieldRows = new Map();
  for (const r of rows || []) {
    const key = `${r.path}|${r.prop}`;
    if (r.field && !fieldRows.has(key)) fieldRows.set(key, r.field);
  }
  /* What the component's dialog calls the field: the entry for this property
     whose path is where the node sits in the component - "list/*" for any
     item of a list. */
  const dialogLabel = (c, prop) => {
    const fields = c.resourceType ? dialogs?.[c.resourceType] : null;
    if (!Array.isArray(fields)) return null;
    const inner = c.within ? c.within.split('/') : [];
    const hit = fields.find((f) => {
      if (!f || f.prop !== prop) return false;
      const p = f.path ? f.path.split('/') : [];
      return p.length === inner.length && p.every((s, i) => s === '*' || s === inner[i]);
    });
    return hit?.label || null;
  };

  return {
    section: (c) => (c.pageProps ? 'Page properties' : sectionOf(componentNode(c)) || ownName(c)),
    field: (c, prop) => fieldRows.get(`${c.node}|${prop}`) || dialogLabel(c, prop) || LINK_LABELS[prop] || fieldLabel(prop)
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where a link sits, in the copy deck's words: "03 · FT02_Feature Benefit · Galaxy S25 › CTA link". */
export const whereOf = (u) => `${u.section} › ${u.field}${u.index >= 0 ? ` [${u.index + 1}]` : ''}`;

export const actions = {
  /** Reads only. Every link in the page's content, and whether each one is on author. */
  async scan({ client, report, params, settings }) {
    const step = (id, state, note) => report('data', 'step', { id, state, note });

    /* ---- 1. the page ---------------------------------------------------- */
    step('read', 'running');
    const { page, title, content, rows, dialogs, titles, pd } = await readPage({ client, settings, params });
    const ctx = siteContext({ page, rootDepth: depthFrom(settings), hosts: hostsFrom(settings) });
    const { components, nodes } = scanContent(content, ctx);
    step('read', 'done', `${plural(nodes, 'node')} read`);

    /* ---- 2. the links --------------------------------------------------- */
    step('find', 'running');
    const name = namer({ content, rows, dialogs, titles });
    components.forEach((c, pos) => {
      c.title = c.pageProps ? 'Page properties' : (c.resourceType && titles?.[c.resourceType]) || c.type || null;
      c.section = name.section(c);
      c.pos = pos;
      for (const l of c.links) l.field = name.field(c, l.prop);
    });
    const targets = targetsOf(components);
    /* Each use named the copy deck's way, for the review and the report. */
    for (const t of targets) {
      for (const u of t.uses) {
        const c = components.find((x) => x.node === u.node);
        const l = c?.links.find((x) => x.prop === u.prop && x.index === u.index && x.raw === u.raw);
        u.section = c?.section || u.component;
        u.field = l?.field || LINK_LABELS[u.prop] || fieldLabel(u.prop);
        u.pos = c?.pos ?? 0;
      }
    }
    const linkCount = components.reduce((n, c) => n + c.links.length, 0);

    for (const t of targets) {
      if (t.kind === 'page' || t.kind === 'anchor') continue;
      t.state = t.kind === 'placeholder' ? 'placeholder' : t.kind === 'badhost' ? 'missing' : 'unchecked';
      if (t.kind === 'badhost') report('fail', `no .com  ${t.raw}  ←  ${whereOf(t.uses[0])}${t.uses.length > 1 ? ` and ${t.uses.length - 1} more` : ''}`);
      if (t.kind === 'asset') t.note = 'images and files are not checked, on purpose';
      else if (t.kind === 'external') t.note = 'another site - not checked, on purpose';
    }
    const toCheck = targets.filter((t) => !t.state && t.kind === 'page');
    const anchors = targets.filter((t) => t.kind === 'anchor');
    step(
      'find',
      'done',
      `${plural(linkCount, 'link')} in ${plural(components.length, 'component')} · ${plural(toCheck.length, 'distinct target')} to check`
    );
    report(
      'info',
      `${plural(linkCount, 'link')} found on ${page}: ${plural(toCheck.length, 'distinct page')} to look up on ${location.host}` +
        (ctx.site ? `, site-relative links read under ${ctx.contentRoot}` : '') +
        '.'
    );
    if (pd) report('info', 'Product page (PD): its copy comes from PIM, so its components are named from their dialogs, without the copy deck’s numbers.');

    /* ---- 3. each one, on author ------------------------------------------ */
    step('check', toCheck.length ? 'running' : 'done', toCheck.length ? `0 of ${toCheck.length}` : 'nothing to check');
    let done = 0;
    /* ?mini-led and ?mini-led1234 on one page are two targets but one page:
       it is read once. */
    const asked = new Map();
    const lookupOnce = (path) => {
      if (!asked.has(path)) asked.set(path, lookup(path));
      return asked.get(path);
    };
    await pool(toCheck, PARALLEL, async (t) => {
      const answer = await lookupOnce(t.path);
      /* AEM's paths are case-sensitive and people's typing is not: a 404 for
         /sa_en/Galaxy-S is looked for again as /sa_en/galaxy-s, and said as
         a case difference rather than a missing page. */
      const lower = answer.state === 'no' && t.path !== t.path.toLowerCase() ? await lookupOnce(t.path.toLowerCase()) : null;
      Object.assign(t, verdict(t, answer, lower));
      done++;
      if (done % 2 === 0 || done === toCheck.length) step('check', 'running', `${done} of ${toCheck.length}`);
      if (t.state === 'missing') report('fail', `404  ${t.path}  ←  ${whereOf(t.uses[0])}${t.uses.length > 1 ? ` and ${t.uses.length - 1} more` : ''}`);
      else if (t.state === 'query') report('warn', `check by hand  ${t.raw}: ${t.note}`);
      else if (t.state !== 'ok') report('warn', `${t.state}  ${t.path}: ${t.note}`);
    });

    /* "#1", "#mini-led": an element on this page with that id. The ids are
       read off the page as AEM renders it for a visitor - once, however many
       anchors there are. A rendering that fails says so on each anchor rather
       than calling them all broken. */
    if (anchors.length) {
      const html = await client.readRendered(page).catch(() => null);
      const ids = html == null ? null : idsIn(html);
      for (const t of anchors) {
        Object.assign(t, anchorVerdict(t, ids));
        if (t.state === 'missing') report('fail', `no id  ${t.raw}  ←  ${whereOf(t.uses[0])}${t.uses.length > 1 ? ` and ${t.uses.length - 1} more` : ''}`);
        else if (t.state !== 'ok') report('warn', `${t.state}  ${t.raw}: ${t.note}`);
      }
    }

    const count = (state) => targets.filter((t) => t.state === state).length;
    const broken = count('missing');
    const look = ['case', 'notpage', 'forbidden', 'error', 'placeholder', 'query'].reduce((n, s) => n + count(s), 0);
    const ok = count('ok');
    step('check', 'done', broken ? `${plural(broken, 'broken link')} found` : 'none broken');

    const result = {
      page,
      title,
      host: location.host,
      origin: location.origin,
      contentRoot: ctx.contentRoot,
      site: ctx.site,
      hosts: ctx.hosts,
      pd,
      nodes,
      components: components.length,
      links: linkCount,
      checked: toCheck.length + anchors.length,
      broken,
      look,
      ok,
      unchecked: count('unchecked'),
      targets,
      at: Date.now()
    };
    report('data', 'analysis', result);
    report(
      broken ? 'fail' : look ? 'warn' : 'ok',
      broken
        ? `${plural(broken, 'broken link')} on ${page}: ${broken === 1 ? 'it points' : 'they point'} at ${broken === 1 ? 'a page that is' : 'pages that are'} not on ${location.host}.`
        : look
          ? `No broken links on ${page}, but ${plural(look, 'link')} need${look === 1 ? 's' : ''} a look.`
          : `No broken links on ${page}: all ${plural(toCheck.length, 'target')} checked exist on ${location.host}.`
    );
    return result;
  }
};
