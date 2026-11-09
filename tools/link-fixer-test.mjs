/**
 * The Relative Link Fixer's worker, the content script's origin check, team
 * defaults and the manifest, run for real in Node. Imported at the end of
 * engine-test.mjs, so `node tools/engine-test.mjs` runs it too.
 *
 * The browser suite stubs every worker, so it can say what the review drew
 * but never what the scanner finds or what the fix would write. Each case
 * here is a fault that was found by a probe, not a guess at one.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')), '..');
const url = (rel) => new URL(`file:///${join(ROOT, rel).split('\\').join('/')}`).href;

/* The worker reads location.hostname and the content script location.origin.
   Both are put back afterwards, so nothing after this file sees them. */
const had = { location: globalThis.location, chrome: globalThis.chrome };
globalThis.location = { hostname: 'author.example.com', origin: 'https://author.example.com', host: 'author.example.com' };

let failures = 0;
const check = (ok, name, why = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !why ? '' : ` - ${why}`}`);
  if (!ok) failures++;
};

console.log('');
console.log('--- the Relative Link Fixer ---');

const { hostList, findInString } = await import(url('src/features/link-fixer/links.js'));
const { actions } = await import(url('src/features/link-fixer/worker.js'));
const hosts = hostList(['author.example.com']);
const found = (s) => findInString(s, hosts).map((f) => [f.from, f.to]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* 1. A host name on its own is a name. */
for (const s of ['Samsung.com', 'www.samsung.com', 'samsung.com', '{"label":"Samsung.com"}']) {
  check(!found(s).length, `"${s}" alone is not a link`, JSON.stringify(found(s)));
}
check(same(found('www.samsung.com/uk/tvs/'), [['www.samsung.com/uk/tvs/', '/uk/tvs/']]), 'a bare host with a path still is');
check(same(found('https://www.samsung.com'), [['https://www.samsung.com', '/']]), 'and so is a host with its scheme');
check(
  !found('<img alt="www.samsung.com/uk/" title="https://www.samsung.com/uk/" src="x">').length,
  'nothing inside alt or title is a link'
);
check(!found('{"title":"https://www.samsung.com/uk/"}').length, 'nor a JSON title');

/* 10. srcset, closing punctuation, author consoles. */
check(
  same(found('<img srcset="https://www.samsung.com/a.jpg 1x, https://www.samsung.com/b.jpg 2x">').map((f) => f[1]), ['/a.jpg', '/b.jpg']),
  'every URL in a srcset is found, not only the first'
);
check(same(found('https://www.samsung.com/uk/x)'), [['https://www.samsung.com/uk/x', '/uk/x']]), 'a closing bracket is not part of the link');
check(same(found('https://www.samsung.com/uk/(x)'), [['https://www.samsung.com/uk/(x)', '/uk/(x)']]), 'one the link opened is');
for (const s of [
  'https://author.example.com/sites.html/content/samsung/uk',
  'https://author.example.com/cf#/content/samsung/uk/x.html',
  'https://author.example.com/assets.html/content/dam/x'
]) {
  check(!found(s).length, `an author console link is left alone: ${s.split('.com')[1]}`);
}
check(
  same(found('https://author.example.com/editor.html/content/samsung/uk/x.html'), [
    ['https://author.example.com/editor.html/content/samsung/uk/x.html', '/content/samsung/uk/x.html']
  ]),
  'an editor link still becomes the page'
);

/* An AEM that holds one page and applies what is posted to it. */
const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);
function makeAem(content) {
  const PAGE = '/content/samsung/uk/p';
  const page = { 'jcr:primaryType': 'cq:Page', 'jcr:content': content };
  const get = (path) => {
    if (!path.startsWith(PAGE)) return null;
    let n = page;
    for (const s of path.slice(PAGE.length).split('/').filter(Boolean)) n = n?.[s];
    return n ?? null;
  };
  const props = (n) => (n ? Object.fromEntries(Object.entries(n).filter(([, v]) => !isNode(v))) : null);
  const posts = [];
  const client = {
    resetCaches() {},
    assertReadable() {},
    async inspect(p) {
      return { exists: !!get(p), isPage: true, title: 'P', primaryType: 'cq:Page' };
    },
    async readTreeWhole(p) {
      return structuredClone(get(p));
    },
    async readProps(p) {
      const n = get(p);
      return n ? structuredClone(props(n)) : null;
    },
    async currentUser() {
      return 'me';
    },
    async writeNode(target, pairs) {
      posts.push(pairs);
      const base = get(target);
      const hints = {};
      for (const [k, v] of pairs) if (k.endsWith('@TypeHint')) hints[k.slice(0, -9)] = v;
      const vals = {};
      for (const [k, v] of pairs) if (!k.includes('@')) (vals[k] ||= []).push(v);
      for (const [k, list] of Object.entries(vals)) {
        const parts = k.replace(/^\.\//, '').split('/');
        const prop = parts.pop();
        let n = base;
        for (const s of parts) n = n[s] ||= { 'jcr:primaryType': 'nt:unstructured' };
        n[prop] = String(hints[k] || '').endsWith('[]') ? list : list[0];
      }
      return { success: true, http: 200, effective: 200, resultPath: target };
    }
  };
  return { client, posts, page, PAGE };
}

const CONTENT = () => ({
  'jcr:primaryType': 'cq:PageContent',
  root: {
    'jcr:primaryType': 'nt:unstructured',
    text: {
      'sling:resourceType': 'x/text',
      text: '<p><a href="https://www.samsung.com/uk/a">a</a> <a href="https://www.samsung.com/fr/b">b</a></p>',
      'jcr:title': 'Samsung.com'
    },
    image: {
      'sling:resourceType': 'x/image',
      fileReference: 'https://images.samsung.com/is/image/samsung/p6pim/uk/x.jpg',
      linkURL: 'https://shop.samsung.com/uk/cart'
    },
    cta: { 'sling:resourceType': 'x/cta', links: ['https://www.samsung.com/uk/c'] }
  }
});
const lines = [];
const report = (level, message) => lines.push(`${level}: ${message}`);

/* 2. Copy a page's extra hosts are not the Link Fixer's. */
{
  const aem = makeAem(CONTENT());
  const scan = await actions.scan({
    client: aem.client,
    report,
    params: { page: aem.PAGE },
    settings: { upsertHosts: 'images.samsung.com, shop.samsung.com' }
  });
  const froms = scan.components.flatMap((c) => c.links.map((l) => l.from));
  check(!froms.some((f) => /images\.|shop\./.test(f)), 'images. and shop. are never rewritten, whatever Copy a page lists', froms.join(', '));
  check(!scan.hosts.includes('images.samsung.com'), 'and are not among the hosts the scan names');
  check(scan.count === 3, `the three samsung.com links are found (got ${scan.count})`);

  /* 6. A run that did all it was asked is not partly done. */
  const picks = new Map();
  for (const c of scan.components) {
    for (const l of c.links) {
      if (l.to.startsWith('/fr')) continue; // left unticked on purpose
      const id = `${c.node}|${l.prop}`;
      if (!picks.has(id)) picks.set(id, { node: c.node, prop: l.prop, expect: l.value, links: [] });
      picks.get(id).links.push({ index: l.index, start: l.start, from: l.from, to: l.to });
    }
  }
  const r = await actions.fix({ client: aem.client, report, params: { page: aem.PAGE, picks: [...picks.values()] }, settings: {} });
  check(r.fixed === 2 && r.left === 0, `two ticked, two fixed, none left (fixed ${r.fixed}, left ${r.left})`);
  check(r.remaining === 1, `the unticked one is counted as still there, not as left (remaining ${r.remaining})`);
  check(aem.page['jcr:content'].root.text['jcr:title'] === 'Samsung.com', 'a title that names the site is untouched');
}

/* 9. The fix writes only what the scanner itself would. */
const refused = async (name, picks) => {
  const aem = makeAem(CONTENT());
  let why = null;
  try {
    await actions.fix({ client: aem.client, report, params: { page: aem.PAGE, picks }, settings: {} });
  } catch (e) {
    why = e.message;
  }
  check(!!why && !aem.posts.length, name, why ? `wrote ${aem.posts.length} requests` : 'it was written');
};
const C = CONTENT();
await refused('a pick whose "to" is not what the scanner makes is refused', [
  { node: 'root/cta', prop: 'links', expect: C.root.cta.links, links: [{ index: 0, start: 0, from: 'https://www.samsung.com/uk/c', to: 'https://evil.example/' }] }
]);
await refused('a pick that is not a link at all is refused', [
  { node: 'root/text', prop: 'text', expect: C.root.text.text, links: [{ index: -1, start: 0, from: '<p>', to: '' }] }
]);
await refused('a link the scanner would not take - an image host - is refused', [
  {
    node: 'root/image',
    prop: 'fileReference',
    expect: C.root.image.fileReference,
    links: [{ index: -1, start: 0, from: 'https://images.samsung.com', to: '/' }]
  }
]);
await refused('a pick on a page property is refused', [
  { node: '.', prop: 'jcr:title', expect: undefined, links: [{ index: -1, start: 0, from: 'x', to: '/' }] }
]);

/* 4. The content script refuses a command meant for another server. */
console.log('');
console.log('--- the content script ---');
{
  let listener = null;
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => (listener = fn) },
      sendMessage: async () => {},
      getURL: (p) => url(p)
    }
  };
  const { init } = await import(url('src/content/runtime.js'));
  init();
  const ask = (msg) => new Promise((done) => listener(msg, {}, done));
  const other = await ask({ type: 'aemt:command', runId: 'r1', feature: 'link-fixer', action: 'scan', params: {}, settings: {}, origin: 'https://other.example.com' });
  check(other?.ok === false && /not other\.example\.com/.test(other.error), 'a command for another server is refused before anything runs', JSON.stringify(other));
}

/* 5. Team defaults are checked the way Settings checks what is typed. */
console.log('');
console.log('--- team defaults ---');
{
  const store = { sync: {}, local: {} };
  const area = (a) => ({
    async get(k) {
      return Object.fromEntries([].concat(k).filter((x) => x in store[a]).map((x) => [x, store[a][x]]));
    },
    async set(o) {
      Object.assign(store[a], o);
    }
  });
  const file = {
    version: 5,
    settings: {
      origins: ['https://P6-EU-Author.samsung.com/', 'https://p6-eu-author.samsung.com', 'p6-ap-author.samsung.com', 'not a host at all/'],
      transferMaxImageMb: 0,
      rootDepth: 'abc',
      verifyShallow: 'yes',
      backupFolder: ' india/backup '
    }
  };
  globalThis.chrome = { runtime: { getURL: (f) => `x:${f}` }, storage: { sync: area('sync'), local: area('local') } };
  const fetchWas = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => file });
  const warnWas = console.warn;
  console.warn = () => {};
  try {
    const { applyTeamDefaults } = await import(url('src/core/team-defaults.js'));
    const { loadSettings } = await import(url('src/core/protocol.js'));
    const applied = await applyTeamDefaults();
    const s = await loadSettings();
    check(
      same(s.origins, ['https://p6-eu-author.samsung.com', 'https://p6-ap-author.samsung.com']),
      'origins are lower case, without a slash, https for a bare host, and once each',
      JSON.stringify(s.origins)
    );
    check(s.rootDepth === 3 && s.transferMaxImageMb === 25 && s.verifyShallow === true, 'a depth, a limit or a tick box that is not one keeps the default', JSON.stringify([s.rootDepth, s.transferMaxImageMb, s.verifyShallow]));
    check(s.backupFolder === 'india/backup', 'text is trimmed, as Settings trims it');
    check((applied?.dropped || []).length === 4, `each value left out is said (${(applied?.dropped || []).length})`, JSON.stringify(applied?.dropped));
  } finally {
    globalThis.fetch = fetchWas;
    console.warn = warnWas;
  }
}

/* 11. The page can reach only what the content script imports, and only
   through a URL that changes every session. */
console.log('');
console.log('--- the manifest ---');
{
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  const war = manifest.web_accessible_resources || [];
  const patterns = war.flatMap((w) => w.resources);
  const re = (p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
  const exposed = (rel) => patterns.some((p) => re(p).test(rel));

  /* What runtime.js pulls in, following every relative import - and the
     registry's workers, which it imports by name. */
  const seen = new Set();
  const ids = [];
  for (const d of readdirSync(join(ROOT, 'src/features'))) {
    if (statSync(join(ROOT, 'src/features', d)).isDirectory()) ids.push(d);
  }
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] || m[2];
      if (spec.startsWith('.')) walk(resolve(dirname(file), spec));
    }
    if (file.endsWith('registry.js')) for (const id of ids) walk(resolve(dirname(file), id, 'worker.js'));
  };
  walk(join(ROOT, 'src/content/runtime.js'));
  const needed = [...seen].map((f) => relative(ROOT, f).split('\\').join('/'));
  const missing = needed.filter((f) => !exposed(f));
  check(!missing.length, `every module the content script loads is reachable (${needed.length})`, missing.join(', '));
  check(!patterns.some((p) => p.startsWith('src/ui')), 'nothing of the panel is');
  /* Kept as 1.0.0 shipped it. use_dynamic_url would hide the extension from
     sites, but whether getURL hands a content script the per-session address
     was never seen working in Chrome, and if it does not, no tool starts. */
  check(war.every((w) => !w.use_dynamic_url), 'resources are reached at the fixed address, as in 1.0.0');
}

globalThis.location = had.location;
globalThis.chrome = had.chrome;
if (failures) {
  console.log(`\n${failures} link-fixer, shell or settings check(s) FAILED`);
  process.exitCode = 1;
}
