/**
 * The Broken Link Finder's link rules, run for real in Node. Imported at the
 * end of engine-test.mjs, so `node tools/engine-test.mjs` runs it too.
 *
 * Covers what a link with "?…" after it becomes. Author has no way to say
 * whether /in/tvs/all-tvs/?mini-led is a filter the page understands and
 * ?mini-led1234 is not, so such a link is never called OK: the page is
 * looked up, and if it is there the link is sent to a person to check.
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
console.log('--- the Broken Link Finder ---');

const { siteContext, classify, scanContent, targetsOf, verdict } = await import(url('src/features/broken-links/links.js'));
const ctx = siteContext({ page: '/content/samsung/iq_ar/india/backup/tvs/tv-buying-guide/what-is-mini-led', hosts: ['author.example.com'] });

const a = classify('/in/tvs/all-tvs/?mini-led', ctx);
const b = classify('/in/tvs/all-tvs/?mini-led1234#top', ctx);
check(a.path === '/content/samsung/in/tvs/all-tvs' && b.path === a.path, 'a query is not part of the page looked up', `${a.path} / ${b.path}`);
check(a.query === '?mini-led' && b.query === '?mini-led1234', 'but it is kept, without the fragment', `${a.query} / ${b.query}`);
check(classify('/in/tvs/all-tvs/', ctx).query == null, 'a link with no query has none');
check(classify('/in/tvs/all-tvs/?', ctx).query == null, 'nor does a bare "?"');
check(classify('https://www.samsung.com/in/tvs/all-tvs/?mini-led', ctx).query === '?mini-led', 'a full URL to our own host keeps its query too');

/* The page from the report: one rich-text field, two links to one page. */
const content = {
  text: {
    'sling:resourceType': 'samsung/components/content/consumer/global/common/cm-g-text-editor',
    description: '<a href="/in/tvs/all-tvs/?mini-led">A</a> <a href="/in/tvs/all-tvs/?mini-led1234">B</a> <a href="/in/tvs/all-tvs/">C</a>'
  }
};
const targets = targetsOf(scanContent(content, ctx).components);
check(targets.length === 3, 'two queries and none on one page are three targets', targets.map((t) => t.raw).join(', '));

const page = { state: 'yes', json: { 'jcr:primaryType': 'cq:Page', 'jcr:content': { 'jcr:title': 'All TVs' } } };
const byRaw = (r) => targets.find((t) => t.raw === r);
const withQ = verdict(byRaw('/in/tvs/all-tvs/?mini-led1234'), page);
check(withQ.state === 'query', 'a page that is there, with a query, is sent to be checked by hand', withQ.state);
check(/mini-led1234/.test(withQ.note) && /by hand/.test(withQ.note), 'and the note names the query', withQ.note);
check(verdict(byRaw('/in/tvs/all-tvs/'), page).state === 'ok', 'the same page with no query is OK');
check(verdict(byRaw('/in/tvs/all-tvs/?mini-led'), { state: 'no' }).state === 'missing', 'a missing page is broken, query or not');
check(verdict(byRaw('/in/tvs/all-tvs/?mini-led'), { state: 'redirected', to: '/x' }).state === 'query', 'a redirected page with a query is still checked by hand');

/* Anchors: "#1" is an element on the page with id="1", read off the page as
   AEM renders it. None there is a broken link. */
const { idsIn, anchorVerdict } = await import(url('src/features/broken-links/links.js'));
const html = '<div id="1" data-id="9"><a name="top"></a><input name="q"><section id=mini-led></section><p id="a&amp;b"></p></div>';
const ids = idsIn(html);
check(ids.has('1') && ids.has('top') && ids.has('mini-led'), 'ids and <a name> are read off the rendered page', [...ids].join(','));
check(ids.has('a&b'), 'an entity in an id is read as the character', [...ids].join(','));
check(!ids.has('9') && !ids.has('q'), 'data-id and an input name are not anchors', [...ids].join(','));

const anchorsOf = (props) => targetsOf(scanContent({ c: { 'sling:resourceType': 'x/cta', ...props } }, ctx).components).filter((t) => t.kind === 'anchor');
const found = anchorsOf({ ctaUrl: '#1', linkPath: '#2', description: '<a href="#123">x</a> <a href="#mini-led">y</a>' });
check(found.map((t) => t.id).sort().join(',') === '1,123,2,mini-led', 'numbered and named anchors are all found, #123 in an href too', found.map((t) => t.raw).join(','));
check(!anchorsOf({ textColor: '#123', backgroundColor: '#abcdef' }).length, 'a colour in a colour field is still a colour');
check(anchorsOf({ linkPath: '#abc' }).length === 1, 'but "#abc" in a link field is an anchor');

const byId = (id) => found.find((t) => t.id === id);
check(anchorVerdict(byId('1'), ids).state === 'ok', '#1 with id="1" on the page is OK');
const two = anchorVerdict(byId('2'), ids);
check(two.state === 'missing' && /id="2"/.test(two.note), '#2 with nothing to land on is broken, and says which id', two.note);
check(anchorVerdict(byId('1'), null).state === 'error', 'a page that did not render is never called broken');

/* www.samsung without ".com": the schema markup on the iq_ar TV buying guide
   was written this way, and a copy to levant_ar left every link on /iq_ar. */
const schema = '  "@type": "CollectionPage",\r\n  "@id": "https://www.samsung/iq_ar/tvs/tv-buying-guide/#CollectionPage",\r\n  "url": "https://www.samsung/iq_ar/tvs/tv-buying-guide/"';
const bad = targetsOf(scanContent({ seo: { 'sling:resourceType': 'x/seo', contentHtml: schema } }, ctx).components);
check(bad.length === 1 && bad[0].kind === 'badhost', 'a www.samsung link in schema markup is found and called a bad address', JSON.stringify(bad.map((t) => [t.kind, t.raw])));
check(/https:\/\/www\.samsung\.com\/iq_ar\/tvs\/tv-buying-guide\//.test(bad[0]?.note || ''), 'and the note gives the address it should be', bad[0]?.note);
check(classify('https://samsung/uk/', ctx)?.kind === 'badhost', 'so is samsung on its own');
check(classify('https://www.samsung.com/uk/', ctx)?.kind === 'page', 'www.samsung.com is still a page link');
check(classify('https://news.samsung.com/uk/', ctx)?.kind === 'external', 'another Samsung site is still external');

if (failures) {
  console.log(`\n${failures} broken-links check(s) FAILED`);
  process.exitCode = 1;
}
