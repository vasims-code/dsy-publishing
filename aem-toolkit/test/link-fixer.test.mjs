/* Relative Link Fixer: which full URLs are found, what each becomes, and the
 * fix replacing exactly the occurrences ticked - nothing in page properties. */
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/src/';
const { hostList, findInString, findInValue, applyFixes, scanContent, relativeOf } = await import(
  pathToFileURL(base + 'features/link-fixer/links.js')
);

let pass = 0;
let failed = 0;
function check(name, ok, got) {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}`, got === undefined ? '' : JSON.stringify(got));
  }
}

const hosts = hostList(['https://p6-eu-author.samsung.com', 'localhost:4502']);
const tos = (s) => findInString(s, hosts).map((f) => f.to);

console.log('\n--- hosts ----------------------------------------------------------');
check('www, bare, author host and port stripped', JSON.stringify(hosts) === JSON.stringify(['www.samsung.com', 'samsung.com', 'p6-eu-author.samsung.com', 'localhost']), hosts);

console.log('\n--- what is found ---------------------------------------------------');
const url = 'https://www.samsung.com/uk/mobile-phone-buying-guide/best-smart-watch/';
check('the user\u2019s example, as a link field', tos(url)[0] === '/uk/mobile-phone-buying-guide/best-smart-watch/', tos(url));
check('http, no scheme, protocol-relative', ['http://www.samsung.com/uk/a/', 'www.samsung.com/uk/a/', '//www.samsung.com/uk/a/'].every((s) => tos(s)[0] === '/uk/a/'));
check('query and anchor kept', tos('https://www.samsung.com/uk/tvs/?cid=x#faq')[0] === '/uk/tvs/?cid=x#faq', tos('https://www.samsung.com/uk/tvs/?cid=x#faq'));
check('bare host becomes /', tos('https://www.samsung.com')[0] === '/' && tos('https://www.samsung.com/')[0] === '/');
check('upper-case host', tos('HTTPS://WWW.SAMSUNG.COM/uk/x/')[0] === '/uk/x/', tos('HTTPS://WWW.SAMSUNG.COM/uk/x/'));
check('author link through the editor', tos('https://p6-eu-author.samsung.com/editor.html/content/samsung/uk/x.html')[0] === '/content/samsung/uk/x.html');
check('localhost with port', tos('http://localhost:4502/content/samsung/uk/x.html')[0] === '/content/samsung/uk/x.html');
check('href in rich text, with the words clicked', (() => {
  const f = findInString('<p>See <a href="https://www.samsung.com/uk/watches/" target="_blank">our <b>watches</b></a>.</p>', hosts);
  return f.length === 1 && f[0].to === '/uk/watches/' && f[0].context === 'attribute' && f[0].text === 'our watches';
})());
check('single-quoted href', tos("<a href='https://www.samsung.com/uk/x/'>x</a>")[0] === '/uk/x/');
check('escaped href in stored JSON', tos('{"html":"<a href=\\"https://www.samsung.com/uk/x/\\">x</a>"}')[0] === '/uk/x/', tos('{"html":"<a href=\\"https://www.samsung.com/uk/x/\\">x</a>"}'));
check('a URL in a JSON list', tos('{"url":"https://www.samsung.com/uk/x/","t":"a"}')[0] === '/uk/x/');
check('two links in one rich text', tos('<a href="https://www.samsung.com/uk/a/">a</a> <a href="https://samsung.com/uk/b/">b</a>').join() === '/uk/a/,/uk/b/');

console.log('\n--- what is left alone ----------------------------------------------');
check('already relative', !tos('/uk/x/').length && !tos('<a href="/uk/x/">x</a>').length);
check('other sites', !tos('https://www.youtube.com/watch?v=1').length);
check('shop and image hosts', !tos('https://shop.samsung.com/uk/cart').length && !tos('https://images.samsung.com/is/image/x').length);
check('a longer host: news.samsung.com, samsung.com.au', !tos('https://news.samsung.com/uk/x').length && !tos('https://www.samsung.com.au/x').length, tos('https://www.samsung.com.au/x'));
check('host mentioned in text, not a link', !tos('<p>Visit https://www.samsung.com/uk/ today</p>').length && !tos('Buy at www.samsung.com/uk').length);
check('host inside another URL\u2019s query', !tos('https://www.youtube.com/redirect?q=https://www.samsung.com/uk/').length);
check('image src on our host is still an attribute link', tos('<img src="https://www.samsung.com/etc/x.png">')[0] === '/etc/x.png');

console.log('\n--- the fix -----------------------------------------------------------');
const html = '<a href="https://www.samsung.com/uk/a/">a</a> and <a href="https://www.samsung.com/uk/a/">again</a>';
const both = findInString(html, hosts).map((f) => ({ index: -1, ...f }));
check('only the ticked occurrence of two identical links', applyFixes(html, [both[1]]) === '<a href="https://www.samsung.com/uk/a/">a</a> and <a href="/uk/a/">again</a>', applyFixes(html, [both[1]]));
check('both, offsets kept right', applyFixes(html, both) === '<a href="/uk/a/">a</a> and <a href="/uk/a/">again</a>');
const arr = ['/uk/ok/', 'https://www.samsung.com/uk/b/'];
const inArr = findInValue(arr, hosts);
check('array element, others untouched', inArr.length === 1 && inArr[0].index === 1 && JSON.stringify(applyFixes(arr, inArr)) === '["/uk/ok/","/uk/b/"]');
let threw = false;
try {
  applyFixes('changed since', [{ index: -1, start: 0, from: url, to: '/uk/' }]);
} catch {
  threw = true;
}
check('a value that moved on is refused', threw);
check('relativeOf', relativeOf('') === '/' && relativeOf('?a=1') === '/?a=1' && relativeOf('/editor.html/content/x.html') === '/content/x.html');

console.log('\n--- a page: content only, never page properties -----------------------');
const content = {
  'jcr:primaryType': 'cq:PageContent',
  'jcr:title': 'Best smart watch',
  canonical: 'https://www.samsung.com/uk/x/',
  image: { fileReference: 'https://www.samsung.com/uk/thumb.png', 'sling:resourceType': 'foundation/components/image' },
  'cq:featuredimage': { link: 'https://www.samsung.com/uk/y/' },
  root: {
    'sling:resourceType': 'wcm/foundation/components/responsivegrid',
    hero: {
      'sling:resourceType': 'samsung/components/content/consumer/global/product/pd-g-feature-benefit-full-bleed',
      ctaLink: 'https://www.samsung.com/uk/watches/',
      title: 'Galaxy Watch'
    },
    text: {
      'sling:resourceType': 'samsung/components/content/consumer/global/common/cm-g-text-block',
      text: '<p><a href="https://www.samsung.com/uk/a/">a</a> <a href="/uk/b/">b</a></p>'
    },
    ok: { 'sling:resourceType': 'x/cm-g-text-block', link: '/uk/fine/' }
  }
};
const scan = scanContent(content, hosts);
check('two components found, in page order', scan.components.map((c) => c.node).join() === 'root/hero,root/text', scan.components.map((c) => c.node));
check('page properties and thumbnail ignored', !scan.components.some((c) => /^(image|cq:)/.test(c.node)) && scan.components.every((c) => c.node.startsWith('root/')));
check('type is the component name', scan.components[0].type === 'pd-g-feature-benefit-full-bleed');
check('the scanned value travels with the link', scan.components[1].links[0].value === content.root.text.text);
const live = scanContent({ 'jcr:mixinTypes': ['cq:LiveRelationship'], root: { a: { 'jcr:mixinTypes': ['cq:LiveRelationship'], l: url }, b: { 'jcr:mixinTypes': ['cq:LiveRelationship', 'cq:LiveSyncCancelled'], l: url } } }, hosts);
check('live copy flagged, cancelled inheritance not', live.components.map((c) => c.liveCopy).join() === 'true,false', live.components.map((c) => c.liveCopy));

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
