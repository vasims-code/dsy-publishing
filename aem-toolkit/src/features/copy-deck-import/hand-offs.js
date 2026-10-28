/**
 * copy-deck-import: what a Static Content block needs from someone other than
 * the web team, worked out - and the list of English still on the page.
 *
 * Links still pointing at another site, and the opt-in to re-point them in
 * the value the web team copies; the block's pictures, for a designer to
 * check for English; the layout, keys and fonts a developer looks at; and
 * what of the page is still in English once everyone is done. Nothing here
 * asks AEM for anything, and nothing here is ever written to it: the panel
 * shows it, and the worker's read-only checkAll uses englishLeft.
 */

import { buildRules, otherSiteLinks, resolveSites, rewriteTokens, rewriteValue } from '../../core/rewrite.js';
import { prepareBody, readBlock, verify } from '../copy-deck/static-content.js';

/** The hosts page copy re-points links on (see page-transfer). */
const HOSTS = ['www.samsung.com'];
const SHOP_HOSTS = ['shop.samsung.com'];

/** The site of a page: /content/samsung/levant/… is levant. */
export const siteOf = (page) => String(page || '').split('/')[3] || '';

/** The sheet's page and the page it is imported into, as page copy reads them: from the one site, to the other. */
const sitesFor = (from, to) => resolveSites({ source: from || to, dest: to, hosts: HOSTS, shopHosts: SHOP_HOSTS });
const linkRules = (from, to) => buildRules(sitesFor(from, to), { images: false, links: true });

/** A picture or a video, or a path in DAM: never a link to re-point. */
const MEDIA = /\/content\/dam\/|\.(png|jpe?g|gif|webp|svg|avif|mp4|webm)(?=[?#]|$)/i;
/** A Samsung model code at the end of a link, sm-l715fzkamid: the page is of one product, which the other site may not sell. */
const PRODUCT = /[-/](?=[a-z]{0,4}\d)[a-z\d]{9,}(?=[/#?]|$)/i;

/**
 * A block's links that point at another site, as [{ field, link, to, site,
 * product }]: links to the sheet's site, with `to` what re-pointing makes of
 * them (see repointLinks), and links to any third site, `to` null - those are
 * only listed, to check. `product` marks a link to one product's page, to
 * check that page exists on the new site.
 */
export function linksOf(old, from, to) {
  const sites = sitesFor(from, to);
  const ctx = buildRules(sites, { images: false, links: true });
  const out = [];
  const seen = new Set();
  const put = (field, link, next, site) => {
    if (seen.has(`${field}\n${link}`) || MEDIA.test(link)) return;
    seen.add(`${field}\n${link}`);
    out.push({ field, link, to: next, site, product: PRODUCT.test(link.split(/[?#]/)[0].replace(/\/buy\/?$/, '/')) });
  };
  for (const [field, value] of [['Body(HTML)', old?.bodyHtml], ['Footer(Javascript)', old?.footerInclude]]) {
    if (typeof value !== 'string') continue;
    for (const t of rewriteTokens(value, ctx)) put(field, t.from, t.to, sites.srcSite);
    // The page and the sheet on one site: links to any other are still worth a look.
    for (const t of otherSiteLinks(value, { ...sites, enabled: true })) put(field, t.link, null, t.site);
  }
  return out;
}

/**
 * The prepared Body (HTML) with its links re-pointed at the page's own site:
 * links only, by page copy's rules with images off, so a picture or a DAM
 * path is never touched. It is made on the block's old value with the links
 * re-pointed, then the texts put in as before - so it passes the three checks
 * again (see verify), with the link changes planned: the re-pointed old value
 * must be the old value with each listed link swapped for what the rules make
 * of it, and nothing else. `rec` is the block's record, as the card keeps it.
 *
 * Returns { rec, links }: the record with the new value and the links
 * changed - none, and `rec` as it was, when no link points at the sheet's
 * site - or { refused } with why.
 */
export function repointLinks(rec, from, to) {
  const ctx = linkRules(from, to);
  const old = String(rec.old?.bodyHtml ?? '');
  const links = rewriteTokens(old, ctx);
  if (!links.length) return { rec, links };
  if (links.some((l) => MEDIA.test(l.from) || MEDIA.test(l.to))) return { refused: 'Re-pointing would change a picture or a DAM path - DSY leaves this block’s links as they are.' };
  const base = rewriteValue(old, ctx);
  // Each link swapped by hand, where it is: anything else the rules changed would show here.
  let swapped = '';
  let last = 0;
  for (const m of old.matchAll(ctx.leftoverRe)) {
    swapped += old.slice(last, m.index) + rewriteValue(m[0], ctx);
    last = m.index + m[0].length;
  }
  if (swapped + old.slice(last) !== base) return { refused: 'Re-pointing would change more than the listed links - DSY leaves this block’s links as they are.' };

  const items = rec.items || [];
  // A text sent back stays English: its translation is what was refused.
  const prep = prepareBody(base, items.map((i) => ({ cell: i.cell, translation: i.status === 'sent back' ? '' : (i.translation ?? '') })));
  const lost = items.filter((i, n) => i.status === 'placed' && prep.items[n]?.status !== 'placed').length;
  if (lost) return { refused: `With the links re-pointed, ${lost} text${lost === 1 ? '' : 's'} could not be put in - DSY leaves this block’s links as they are.` };
  const checks = verify(base, prep.value, prep.placed);
  if (checks.length) return { refused: `DSY’s own check of the re-pointed value found a problem - ${checks[0]}.` };
  return {
    rec: { ...rec, prepared: prep.value, items: items.map((i, n) => (i.status === 'sent back' ? i : { ...i, ...prep.items[n] })) },
    links
  };
}

/** A file's name, its desktop or mobile mark, and what is left of it to pair by: mep-kv-dt.jpg and mep-kv-mo-v3.jpg are a pair. */
const DESKTOP = new Set(['dt', 'pc', 'desktop']);
const MOBILE = new Set(['mo', 'm', 'mobile']);
function fileParts(src) {
  const path = String(src).split(/[?#]/)[0];
  const name = path.split('/').pop();
  const words = name.replace(/\.[^.]+$/, '').toLowerCase().split(/[-_]+/);
  const kind = words.some((w) => DESKTOP.has(w)) ? 'desktop' : words.some((w) => MOBILE.has(w)) ? 'mobile' : null;
  const stem = words.filter((w) => !DESKTOP.has(w) && !MOBILE.has(w) && !/^(webp|v\d+)$/.test(w)).join('-');
  return { name, kind, pair: `${path.slice(0, path.length - name.length)}${stem}` };
}

/**
 * A block's pictures and videos, for a designer, as [{ field, say, files }]:
 * a desktop file and its mobile one together where their names pair up, any
 * other file on its own. The Body's from its tags, the Footer's from the
 * script's strings ("02_sleep_tracking/sleep_tracking_bento1_dt-webp.png").
 */
export function imagesOf(old) {
  const files = readBlock(old).body.report.images.map((src) => ['Body(HTML)', src]);
  for (const m of String(old?.footerInclude ?? '').matchAll(/["'`]([^"'`\s]+\.(?:png|jpe?g|gif|webp|avif|mp4|webm))["'`]/gi)) files.push(['Footer(Javascript)', m[1]]);
  const out = [];
  const done = new Set();
  const all = [...new Map(files.map(([field, src]) => [src, { field, src, ...fileParts(src) }])).values()];
  for (const f of all) {
    if (done.has(f.src)) continue;
    done.add(f.src);
    const mate = f.kind && all.find((o) => !done.has(o.src) && o.field === f.field && o.kind && o.kind !== f.kind && o.pair === f.pair);
    if (mate) done.add(mate.src);
    const both = mate ? (f.kind === 'desktop' ? [f, mate] : [mate, f]) : [f];
    out.push({ field: f.field, say: both.map((x) => `${x.name}${x.kind ? ` (${x.kind})` : ''}`).join(' + '), files: both.map((x) => x.src) });
  }
  return out;
}

/** The first font of each font-family, but the ones every computer has. */
const COMMON_FONTS = /^(inherit|initial|unset|serif|sans-serif|monospace|cursive|system-ui|-apple-system|BlinkMacSystemFont|Segoe UI|Roboto|Arial|Helvetica|Helvetica Neue|Tahoma|Verdana)$/i;

/**
 * What a developer looks at in a block, beyond the Footer's texts: a
 * left/right layout, arrow keys, fonts that may have Latin letters only, and
 * scripts in the Body, which DSY leaves as they are. Read off the block's
 * three fields; one line each.
 */
export function developerReport(old) {
  const { report } = readBlock(old).body;
  const head = String(old?.headerInclude ?? '');
  const foot = String(old?.footerInclude ?? '');
  const out = [];
  const sides = [
    ...report.rtl.filter((r) => !/^"Arrow/.test(r)),
    ...[...head.matchAll(/(?:^|[;{\s])((?:left|right)\s*:\s*[^;}]+|text-align\s*:\s*(?:left|right))/g)].map((m) => m[1].trim()),
    ...(foot.match(/\b(?:to(?:Left|Right)|(?:left|right)Fixed)\b/g) || [])
  ];
  const list = (xs) => {
    const u = [...new Set(xs)];
    return `${u.slice(0, 4).join(', ')}${u.length > 4 ? ` and ${u.length - 4} more` : ''}`;
  };
  if (sides.length) out.push(`Left/right layout (${list(sides)}) - check it for a right-to-left language`);
  const keys = report.rtl.filter((r) => /^"Arrow/.test(r));
  if (keys.length) out.push(`${list(keys)} key handling - the arrows swap in a right-to-left language`);
  const fonts = [...`${old?.bodyHtml ?? ''}\n${head}\n${foot}`.matchAll(/font-family\s*:\s*["']?([^,;"'}]+)/gi)].map((m) => m[1].trim()).filter((f) => !COMMON_FONTS.test(f));
  if (fonts.length) out.push(`Fonts ${list(fonts)} - may have Latin letters only: check the new language shows in them`);
  if (report.scripts.length) out.push(`${report.scripts.length} <script> left unchanged`);
  return out;
}

/** What each status says is why the English is still there. */
const STILL = {
  ready: 'not written yet - Write on the import',
  reuse: 'not written yet - Write on the import',
  manual: 'to apply by hand',
  untranslated: 'no translation on the sheet',
  same: 'the sheet keeps the English',
  invalid: 'its row needs fixing',
  placed: 'not pasted yet',
  'sent back': 'sent back - its row needs fixing'
};

/** The node a Key names, from jcr:content: "root/responsivegrid/cm_g_static_content_"; the page's own is "". */
const pathOf = (key) => String(key).split('@')[0].replace(/^\.$/, '');

/**
 * Find English still on the page: every text of the sheet whose English is still on it, from
 * a plan made again with the same sheet on the page as it is now (see
 * planImport) - and the page's texts the sheet has no row for. Each is
 * { text, where, why }: `text` the English, which is what "kept on purpose"
 * marks.
 */
export function englishLeft(plan) {
  const out = [];
  const seen = new Set();
  const add = (text, where, why) => {
    if (!text || !why || seen.has(`${where}\n${text}`)) return;
    seen.add(`${where}\n${text}`);
    out.push({ text, where, why });
  };
  // A block with a card is listed from its card's texts, as pasted or not.
  const cards = new Set((plan.staticBlocks || []).map((b) => b.path));
  const whereOf = (r) => [r.section, r.field].filter(Boolean).join(' › ');
  for (const r of plan.rows) if (!cards.has(pathOf(r.key))) add(r.source ?? r.current, whereOf(r), STILL[r.status]);
  for (const r of plan.notInSheet) if (!(r.category === 'static' && cards.has(r.path))) add(r.source, whereOf(r), 'not on the sheet');
  for (const b of plan.staticBlocks || []) {
    const where = b.label;
    for (const i of b.items) add(i.cell, `${where} › Body(HTML)`, STILL[i.status]);
    for (const t of b.notOnSheet) add(t, `${where} › Body(HTML)`, 'not on the sheet');
    for (const s of b.script) add(s.cell, `${where} › Footer(Javascript)`, s.status === 'placed' ? 'still in the script - not written yet' : STILL[s.status]);
  }
  return out;
}
