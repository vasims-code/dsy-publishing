/**
 * The Site Code Link Fixer's link rules, run for real in Node. Imported at the
 * end of engine-test.mjs, so `node tools/engine-test.mjs` runs it too.
 *
 * Covers placeholders such as {site_code} where a site code goes, as the SEO
 * schema markup component holds them: found, flagged, and re-pointed only
 * when an author ticks one.
 */

import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')), '..');
const url = (rel) => new URL(`file:///${join(ROOT, rel).split('\\').join('/')}`).href;

let failures = 0;
const check = (ok, name, why = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !why ? '' : ` - ${why}`}`);
  if (!ok) failures++;
};

console.log('');
console.log('--- the Site Code Link Fixer ---');

const { siteOfPage, hostList, findInString, readLink, scanContent, keepSites, applyFixes } = await import(url('src/features/site-code-fixer/links.js'));
const ctx = { ...siteOfPage('/content/samsung/iq_ar/india/backup/tvs/tv-buying-guide/what-is-mini-led'), hosts: hostList([]) };

/* The schema markup's body as the component stores it: no outer braces. */
const schema =
  '"@type": "Guide",\r\n  "url": "https://www.samsung.com/{site-code}/tvs/tv-buying-guide/what-is-mini-led/",\r\n' +
  '  "isPartOf": {\r\n    "@type": "Guide",\r\n    "url": "https://www.samsung.com/{site_code}/tvs/tv-buying-guide/"\r\n  }';
const found = findInString(schema, ctx);
check(found.length === 2, 'both placeholders in the schema markup are found', JSON.stringify(found.map((f) => f.from)));
check(found.every((f) => f.placeholder), 'and each is marked a placeholder');
check(found[1]?.to === 'https://www.samsung.com/iq_ar/tvs/tv-buying-guide/', 'its fix puts the page’s own site in its place', found[1]?.to);
check(found[0]?.code === '{site-code}' && found[1]?.code === '{site_code}', 'each keeps its own spelling', `${found[0]?.code} ${found[1]?.code}`);

const fixed = applyFixes(schema, [found[1]].map((f) => ({ ...f, index: -1 })));
check(fixed.includes('/iq_ar/tvs/tv-buying-guide/"') && fixed.includes('{site-code}'), 'a ticked placeholder is replaced, an unticked one is left');

check(readLink('/content/samsung/{site_code}/tvs/tv-buying-guide', ctx)?.to === '/content/samsung/iq_ar/tvs/tv-buying-guide', 'a content path with a placeholder is found too');
check(readLink('/{site_code}/tvs/', ctx)?.placeholder === true, 'and a site-relative one');
check(readLink('/in/tvs/all-tvs/', ctx)?.placeholder === false, 'a real site code is not a placeholder');
check(readLink('/{site_code}x/tvs/', ctx) === null, 'braces that are not the whole segment are not a placeholder');

/* keepSites keeps placeholders though AEM has no site called {site_code}. */
const content = { seo: { 'sling:resourceType': 'x/seo', contentHtml: schema }, link: { 'sling:resourceType': 'x/link', linkPath: '/in/tvs/' } };
const kept = keepSites(scanContent(content, ctx).components, new Set());
check(kept.length === 1 && kept[0].links.length === 2, 'placeholders survive the site check; an unconfirmed code does not', JSON.stringify(kept.map((c) => c.node)));

/* A sentence that starts with a quote is still not JSON. */
check(!findInString('"Hello" said /in/tvs/ to me', ctx).length, 'a quoted sentence is not read as JSON');

if (failures) {
  console.log(`\n${failures} site-code-fixer check(s) FAILED`);
  process.exitCode = 1;
}
