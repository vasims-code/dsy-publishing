/* The usual round trip: the sheet is exported from one site's page (the English
 * /levant, or /uk), Sync page copies it to another site (levant_ar, fr, de -
 * re-pointing its links), and the translation is imported there. Texts with
 * links must still import, and links the translator kept on the source site -
 * relative or written out in full - end up on the new one. A real edit is
 * still "changed".
 */
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/src/';
const core = await import(pathToFileURL(base + 'features/copy-deck/core.js'));
const rw = await import(pathToFileURL(base + 'core/rewrite.js'));

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};

const RICH = 'samsung/components/content/consumer/global/product/pd-g-feature-benefit';
const pageOn = (site) => `/content/samsung/${site}/mobile-phone-buying-guide/what-screen-size`;
const tree = (site) => ({
  'jcr:primaryType': 'cq:PageContent',
  root: { responsivegrid: {
    a: { 'sling:resourceType': RICH, description: `<a href="/${site}/smartphones/galaxy-z/">Foldable phones</a> use a compact cover screen.` },
    b: { 'sling:resourceType': RICH, description: `Explore our <a href="https://www.samsung.com/${site}/smartphones/galaxy-z/">Galaxy Z</a> series today.` },
    c: { 'sling:resourceType': RICH, description: 'No link in this one at all.' }
  } }
});
// The translator keeps the source site's links, as in the levant FAQ.
const translations = (from) => ({
  a: `<a href="/${from}/smartphones/galaxy-z/">ترجمة</a> نص.`,
  b: `استكشف <a href="https://www.samsung.com/${from}/smartphones/galaxy-z/">Galaxy Z</a> اليوم.`,
  c: 'لا يوجد رابط.'
});

/** Sync page from -> to, by its own rules. */
function synced(from, to) {
  const ctx = rw.buildRules(rw.resolveSites({ source: pageOn(from), dest: pageOn(to), hosts: ['www.samsung.com'] }));
  const sync = (o) => (typeof o === 'string' ? rw.rewriteValue(o, ctx) : Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sync(v)])));
  return sync(tree(from));
}

function plan(from, to, intoTree = synced(from, to), tr = translations(from)) {
  const deck = core.extractCopyDeck(tree(from), { pagePath: pageOn(from) });
  const sheet = core.buildSheet(core.selectRows(deck.rows), { pagePath: pageOn(from), exportedAt: '2026-10-26 10:00' });
  const K = sheet.columns.indexOf('Key (do not edit)');
  const T = sheet.columns.indexOf('Translation');
  for (const r of sheet.records) {
    const k = Object.keys(tr).find((x) => r[K].includes(`/${x}@`));
    if (k) r[T] = tr[k];
  }
  return core.planImport(intoTree, core.readSheet([sheet.columns, ...sheet.records]), { pagePath: pageOn(to) });
}
const row = (p, n) => p.rows.find((r) => r.key === `root/responsivegrid/${n}@description`);
const to = (p, n) => p.writes.find((w) => w.path === `root/responsivegrid/${n}`)?.to;

// The same round trip whatever the sites: one country's two languages, or one country's site to another's.
for (const [from, into] of [['levant', 'levant_ar'], ['uk', 'fr'], ['uk', 'de'], ['ch_de', 'ch_fr'], ['de', 'at']]) {
  const p = plan(from, into);
  for (const n of ['a', 'b', 'c']) check(`${from} -> ${into}, ${n}: ready, not "changed"`, row(p, n)?.status === 'ready', `${row(p, n)?.status} ${row(p, n)?.message}`);
  check(`${from} -> ${into}: relative link made ${into}`, to(p, 'a')?.includes(`href="/${into}/smartphones/galaxy-z/"`), to(p, 'a'));
  check(`${from} -> ${into}: full URL made ${into}`, to(p, 'b')?.includes(`href="https://www.samsung.com/${into}/smartphones/galaxy-z/"`), to(p, 'b'));
  check(`${from} -> ${into}: the change is said`, row(p, 'b').warnings.some((w) => w.startsWith('Links made this site')), row(p, 'b').warnings.join(' | '));
}

{
  // Edited on fr after the sync: still caught.
  const fr = synced('uk', 'fr');
  fr.root.responsivegrid.a.description = fr.root.responsivegrid.a.description.replace('compact', 'small');
  const p = plan('uk', 'fr', fr);
  check('a real edit is still "changed"', row(p, 'a')?.status === 'changed', row(p, 'a')?.status);
}

{
  // A link to a third site in the translation is not guessed at: kept, and flagged.
  const tr = { ...translations('uk'), a: '<a href="/es/smartphones/galaxy-s/">texte</a> texte.' };
  const p = plan('uk', 'fr', undefined, tr);
  check('third site kept, flagged', to(p, 'a')?.includes('"/es/smartphones/galaxy-s/"') && row(p, 'a').warnings.some((w) => w.startsWith('Links differ')), `${to(p, 'a')} ${row(p, 'a').warnings.join(' | ')}`);
}

{
  // The sheet imported into the page it came from: nothing re-pointed, nothing to allow for.
  const p = plan('uk', 'uk', tree('uk'), { a: '<a href="/uk/smartphones/galaxy-z/">x</a> y.', b: 'z', c: 'w' });
  check('same site: link left as it is', to(p, 'a')?.includes('"/uk/smartphones/galaxy-z/"') && !row(p, 'a').warnings.some((w) => w.startsWith('Links made')), to(p, 'a'));
}

{
  /* The levant_ar what-screen-size page, 2026-10-26: exported from levant_ar with
   * relative links; after the export its links became full www.samsung.com URLs.
   * Same words, same places - must import, with the translator's /levant links
   * made levant_ar. */
  const page = pageOn('levant_ar');
  const rel = '<a href="/levant_ar/smartphones/galaxy-z/">Foldable phones</a> use a compact cover screen for quick everyday tasks.';
  const full = rel.replace('href="/levant_ar', 'href="https://www.samsung.com/levant_ar');
  const t = (d) => ({ 'jcr:primaryType': 'cq:PageContent', root: { responsivegrid: { a: { 'sling:resourceType': RICH, description: d } } } });
  const deck = core.extractCopyDeck(t(rel), { pagePath: page });
  const sheet = core.buildSheet(core.selectRows(deck.rows), { pagePath: page, exportedAt: '2026-10-26 13:53' });
  const T = sheet.columns.indexOf('Translation');
  for (const r of sheet.records) if (r[0] && !r[0].startsWith('#')) r[T] = 'تستخدم <a href="https://www.samsung.com/levant/smartphones/galaxy-z/">الهواتف القابلة للطي</a> شاشة غطاء.';
  const p = core.planImport(t(full), core.readSheet([sheet.columns, ...sheet.records]), { pagePath: page });
  check('full URL on the page, relative on the sheet: ready', row(p, 'a')?.status === 'ready', `${row(p, 'a')?.status} ${row(p, 'a')?.message}`);
  check('…written with levant_ar', to(p, 'a')?.includes('href="https://www.samsung.com/levant_ar/smartphones/galaxy-z/"'), to(p, 'a'));
  // A link that now goes somewhere else is a real change.
  const elsewhere = full.replace('galaxy-z', 'galaxy-s');
  const q = core.planImport(t(elsewhere), core.readSheet([sheet.columns, ...sheet.records]), { pagePath: page });
  check('a link to another page is still "changed"', row(q, 'a')?.status === 'changed', row(q, 'a')?.status);
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
