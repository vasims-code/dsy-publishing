/* Site-token derivation and rewriting, across whatever pair of sites is put in.
 *
 * Nothing in the extension should know that a worked example happened to be
 * uk -> lb. This asserts that for a spread of real shapes: any two locales,
 * either direction, different depths, a different brand, and the case where
 * both paths are on the same site and there is nothing to rewrite at all.
 */
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/src/';
const { resolveSites, buildRules, rewriteValue, leftovers } = await import(
  pathToFileURL(base + 'core/rewrite.js')
);

let pass = 0;
let failed = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond && detail) console.log(`        ${detail}`);
  cond ? pass++ : failed++;
};

const ctxFor = (source, dest, rootDepth = 3, hosts = ['www.samsung.com']) =>
  buildRules(resolveSites({ source, dest, rootDepth, hosts, shopHosts: [], rewriteShop: false }));

/* ---------------------------------------------------------------- tokens */

console.log('\n--- token derivation, whatever the sites are -------------------');

const PAIRS = [
  ['/content/samsung/uk/guide/x', '/content/samsung/lb/guide/x', 'uk', 'lb'],
  ['/content/samsung/lb/guide/x', '/content/samsung/uk/guide/x', 'lb', 'uk'],
  ['/content/samsung/ae/guide/x', '/content/samsung/levant/guide/x', 'ae', 'levant'],
  ['/content/samsung/de/guide/x', '/content/samsung/fr/guide/x', 'de', 'fr'],
  ['/content/samsung/levant/a/b', '/content/samsung/levant/india/backup/a/b', 'levant', 'levant'],
  ['/content/acme/se/p', '/content/acme/no/p', 'se', 'no']
];

for (const [src, dst, wantSrc, wantDst] of PAIRS) {
  const s = resolveSites({ source: src, dest: dst, rootDepth: 3, hosts: [], shopHosts: [] });
  check(`${wantSrc} \u2192 ${wantDst}`,
    s.srcSite === wantSrc && s.destSite === wantDst,
    `derived ${s.srcSite} \u2192 ${s.destSite}`);
}

console.log('\n--- the DAM root follows the brand, not a hardcoded one --------');

const dam1 = resolveSites({ source: '/content/samsung/uk/p', dest: '/content/samsung/lb/p', rootDepth: 3, hosts: [], shopHosts: [] });
check('samsung', dam1.srcDam === '/content/dam/samsung/uk' && dam1.destDam === '/content/dam/samsung/lb',
  `${dam1.srcDam} \u2192 ${dam1.destDam}`);

const dam2 = resolveSites({ source: '/content/acme/se/p', dest: '/content/acme/no/p', rootDepth: 3, hosts: [], shopHosts: [] });
check('a different brand entirely',
  dam2.srcDam === '/content/dam/acme/se' && dam2.destDam === '/content/dam/acme/no',
  `${dam2.srcDam} \u2192 ${dam2.destDam}`);

const dam3 = resolveSites({ source: '/content/a/b/c/p', dest: '/content/a/b/d/p', rootDepth: 4, hosts: [], shopHosts: [] });
check('a site root four segments deep',
  dam3.srcSite === 'c' && dam3.destSite === 'd' && dam3.srcDam === '/content/dam/a/b/c',
  `${dam3.srcSite} \u2192 ${dam3.destSite}, dam ${dam3.srcDam}`);

console.log('\n--- rewriting is symmetric in the tokens -----------------------');

for (const [a, b] of [['uk', 'lb'], ['lb', 'uk'], ['ae', 'levant'], ['de', 'fr'], ['se', 'no']]) {
  const ctx = ctxFor(`/content/samsung/${a}/p`, `/content/samsung/${b}/p`);
  const cases = [
    [`/content/samsung/${a}/guide/x`, `/content/samsung/${b}/guide/x`],
    [`https://www.samsung.com/${a}/guide/`, `https://www.samsung.com/${b}/guide/`],
    [`<a href="/${a}/offers">o</a>`, `<a href="/${b}/offers">o</a>`],
    [`/content/dam/samsung/${a}/img.png`, `/content/dam/samsung/${b}/img.png`],
    [`/content/samsung/${a}.html`, `/content/samsung/${b}.html`]
  ];
  const bad = cases.filter(([from, to]) => rewriteValue(from, ctx) !== to);
  check(`${a} \u2192 ${b}: all four link forms`, bad.length === 0,
    bad.map(([f, t]) => `${f} gave ${rewriteValue(f, ctx)}, wanted ${t}`).join('; '));
}

console.log('\n--- a token is never confused with a longer one ----------------');

const c1 = ctxFor('/content/samsung/in/p', '/content/samsung/lb/p');
check('/in does not match inside /india',
  rewriteValue('/content/samsung/india/guide', c1) === '/content/samsung/india/guide',
  rewriteValue('/content/samsung/india/guide', c1));
check('but /in itself is rewritten',
  rewriteValue('/content/samsung/in/guide', c1) === '/content/samsung/lb/guide');

const c2 = ctxFor('/content/samsung/de/p', '/content/samsung/fr/p');
check('/de does not match inside /denmark',
  rewriteValue('a /denmark b', c2) === 'a /denmark b',
  rewriteValue('a /denmark b', c2));
check('and the DAM root is not confused either',
  rewriteValue('/content/dam/samsung/denmark/x.png', c2) === '/content/dam/samsung/denmark/x.png');

console.log('\n--- same site on both sides: nothing to rewrite ----------------');

const same = resolveSites({
  source: '/content/samsung/levant/a/b',
  dest: '/content/samsung/levant/india/backup/a/b',
  rootDepth: 3, hosts: [], shopHosts: []
});
check('rewriting is switched off', same.enabled === false, `enabled=${same.enabled}`);
const sameCtx = buildRules(same);
check('and every value passes through untouched',
  rewriteValue('/content/samsung/levant/x', sameCtx) === '/content/samsung/levant/x');
check('leftovers reports nothing when there is no rewriting to do',
  leftovers('/content/samsung/levant/x', sameCtx).length === 0);

console.log('\n--- leftovers name whichever token is the source one -----------');

const c3 = ctxFor('/content/samsung/ae/p', '/content/samsung/fr/p');
check('an unconfigured host is reported against /ae',
  leftovers('https://images.example.com/ae/x.png', c3)[0] === 'https://images.example.com/ae/x.png',
  JSON.stringify(leftovers('https://images.example.com/ae/x.png', c3)));
check('a rewritten value reports nothing',
  leftovers(rewriteValue('/content/samsung/ae/x', c3), c3).length === 0);

/* ------------------------------------------------------- the known limit */

console.log('\n--- known limit: a locale written as two segments --------------');

const multi = resolveSites({
  source: '/content/samsung/uk/p', dest: '/content/samsung/in/en/p',
  rootDepth: 3, hosts: [], shopHosts: []
});
check('a two-segment destination locale is NOT derived automatically',
  multi.destSite === 'in',
  `derived "${multi.destSite}" — if this ever reads "in/en", update this test and the README`);
check('and the analysis can say which tokens it had to guess',
  multi.derived.srcSite === true && multi.derived.destSite === true);

console.log('\n--- stating the tokens explicitly ------------------------------');

const told = ctxFor('/content/samsung/uk/p', '/content/samsung/in/en/p');
const toldCtx = buildRules(resolveSites({
  source: '/content/samsung/uk/p', dest: '/content/samsung/in/en/p',
  rootDepth: 3, srcSite: 'uk', destSite: 'in/en', hosts: ['www.samsung.com'], shopHosts: []
}));
const toldSites = toldCtx.sites;
check('a two-segment token is taken as given',
  toldSites.destSite === 'in/en', toldSites.destSite);
check('the DAM root follows it',
  toldSites.destDam === '/content/dam/samsung/in/en', toldSites.destDam);
check('content paths rewrite to the full token',
  rewriteValue('/content/samsung/uk/guide/x', toldCtx) === '/content/samsung/in/en/guide/x',
  rewriteValue('/content/samsung/uk/guide/x', toldCtx));
check('so do site-relative links',
  rewriteValue('<a href="/uk/offers">o</a>', toldCtx) === '<a href="/in/en/offers">o</a>',
  rewriteValue('<a href="/uk/offers">o</a>', toldCtx));
check('and DAM references',
  rewriteValue('/content/dam/samsung/uk/x.png', toldCtx) === '/content/dam/samsung/in/en/x.png',
  rewriteValue('/content/dam/samsung/uk/x.png', toldCtx));
check('and it is marked as stated rather than guessed',
  toldSites.derived.destSite === false);
check('leaving it blank still derives, unchanged',
  told.sites.destSite === 'in' && told.sites.derived.destSite === true);

console.log('\n--- overlapping tokens are refused, not risked -----------------');

const over = resolveSites({
  source: '/content/samsung/in/p', dest: '/content/samsung/in/en/p',
  rootDepth: 3, srcSite: 'in', destSite: 'in/en', hosts: [], shopHosts: []
});
check('one token containing the other is flagged', over.overlapping === true);
check('the other way round too', resolveSites({
  source: '/content/samsung/in/en/p', dest: '/content/samsung/in/p',
  rootDepth: 3, srcSite: 'in/en', destSite: 'in', hosts: [], shopHosts: []
}).overlapping === true);
check('two ordinary tokens are not flagged',
  resolveSites({ source: '/content/samsung/uk/p', dest: '/content/samsung/lb/p',
    rootDepth: 3, hosts: [], shopHosts: [] }).overlapping === false);
check('and neither is a token that merely starts the same way',
  resolveSites({ source: '/content/samsung/in/p', dest: '/content/samsung/india/p',
    rootDepth: 3, hosts: [], shopHosts: [] }).overlapping === false);

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
