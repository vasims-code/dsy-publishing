/* Exercise the extension's page-copy worker against a simulated AEM 6.5. */
import { pathToFileURL } from 'node:url';

const T = {
  cat: '/conf/consumer/settings/wcm/templates/page-category',
  prod: '/conf/consumer/settings/wcm/templates/page-product',
  guide: '/conf/consumer/settings/wcm/templates/page-buying-guide',
  mkt: '/conf/consumer/settings/wcm/templates/page-marketing',
};

/* --- DOMParser shim, faithful enough for Sling's HtmlResponse ------------ */
class FakeDoc {
  constructor(html) { this.html = html; }
  getElementById(id) {
    const m = this.html.match(new RegExp('<div id="' + id + '">([\\s\\S]*?)</div>'));
    return m ? { textContent: m[1] } : null;
  }
  querySelector(s) {
    if (s !== 'title') return null;
    const m = this.html.match(/<title>([\s\S]*?)<\/title>/);
    return m ? { textContent: m[1] } : null;
  }
}
globalThis.DOMParser = class { parseFromString(s) { return new FakeDoc(s); } };

const htmlResponse = (status, message, path) =>
  `<html><head><title>Status</title></head><body>
<div id="Status">${status}</div><div id="Message">${message}</div>
<div id="Path">${path || ''}</div><div id="Location">${path || ''}</div></body></html>`;

const mk = (status, text, ctype = 'application/json') => ({
  status, ok: status >= 200 && status < 300, redirected: false, url: '',
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? ctype : null) },
  text: async () => text,
  json: async () => JSON.parse(text),
});

function installFetch(repo, writes, opts = {}) {
  function render(path, depth) {
    const node = repo.get(path);
    if (!node) return null;
    const out = path.endsWith('/jcr:content')
      ? { 'jcr:primaryType': 'cq:PageContent', ...(node.props || {}) }
      : { 'jcr:primaryType': node.primaryType };
    if (depth <= 0) return out;
    if (node.primaryType === 'cq:Page') {
      const cp = repo.get(path + '/jcr:content');
      out['jcr:content'] = cp
        ? render(path + '/jcr:content', depth - 1)
        : { 'jcr:primaryType': 'cq:PageContent', 'cq:template': node.template, 'jcr:title': node.title };
    }
    for (const [p] of repo) {
      if (p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/') && !p.endsWith('/jcr:content')) {
        out[p.slice(path.length + 1)] = render(p, depth - 1);
      }
    }
    return out;
  }

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url).split('?')[0];
    if (u === '/libs/granite/csrf/token.json') return mk(200, JSON.stringify({ token: 'tok' }));

    if ((init.method || 'GET').toUpperCase() === 'GET') {
      const m = u.match(/^(.*)\.(\d+)\.json$/);
      if (!m) return mk(404, 'nf', 'text/html');
      const path = decodeURI(m[1]);
      if (!repo.has(path)) return mk(404, 'nf', 'text/html');
      return mk(200, JSON.stringify(render(path, parseInt(m[2], 10))));
    }

    const body = new URLSearchParams(init.body);
    const cmd = body.get('cmd');
    if (!init.headers?.['CSRF-Token']) return mk(403, 'CSRF token mismatch', 'text/html');

    if (cmd === 'createPage') {
      const p = body.get('parentPath') + '/' + body.get('label');
      const tpl = body.get('template');
      writes.push(`create ${p} [${tpl.split('/').pop()}]`);
      if (opts.rejectCreate?.(p, tpl)) return mk(200, htmlResponse(500, 'Template not allowed here'), 'text/html');
      repo.set(p, { primaryType: 'cq:Page', template: tpl, title: body.get('title') });
      return mk(200, htmlResponse(200, 'created', p), 'text/html');
    }

    if (cmd === 'copyPage') {
      const src = body.get('srcPath');
      const shallow = body.get('shallow') === 'true';
      let p = body.get('destParentPath') + '/' + body.get('destName');
      if (repo.has(p)) p += '1';
      writes.push(`copy ${src} -> ${p} shallow=${shallow}`);
      repo.set(p, { ...repo.get(src) });
      for (const [q, v] of [...repo]) {
        if (q.startsWith(src + '/')) {
          const isChildPage = !q.slice(src.length + 1).startsWith('jcr:content');
          if (!isChildPage || !shallow || opts.ignoreShallow) repo.set(p + q.slice(src.length), { ...v });
        }
      }
      // Which path the servlet REPORTS is separate from where the copy landed:
      // real 6.5 reports the source. Tests can override it either way.
      const reported = opts.reportPathAs ? opts.reportPathAs(src, p) : p;
      return mk(200, htmlResponse(200, 'copied', reported), 'text/html');
    }
    return mk(200, htmlResponse(500, 'unknown'), 'text/html');
  };
}

const base = 'D:/chrome-extensions/aem-toolkit/src/';
const { AemClient } = await import(pathToFileURL(base + 'core/aem-client.js'));
const { actions } = await import(pathToFileURL(base + 'features/page-copy/worker.js'));
const { backupPathFor, globalBackupPathFor } = await import(pathToFileURL(base + 'core/paths.js'));

const SETTINGS = {
  marketingTemplate: T.mkt,
  rootDepth: 3,
  verifyShallow: true,
  backupFolder: 'india/backup',
};

const BASE = {
  '/content': { primaryType: 'sling:OrderedFolder' },
  '/content/samsung': { primaryType: 'cq:Page', template: T.cat, title: 'Samsung' },
  '/content/samsung/levant': { primaryType: 'cq:Page', template: T.cat, title: 'Levant' },
  '/content/samsung/lb': { primaryType: 'cq:Page', template: T.cat, title: 'Lebanon' },
};
const pg = (tpl, title) => ({ primaryType: 'cq:Page', template: tpl, title });

let pass = 0, failed = 0;

async function run(name, entries, params, expect, opts = {}) {
  const repo = new Map(Object.entries(entries));
  const writes = [];
  const lines = [];
  installFetch(repo, writes, opts);

  const report = (level, message) => lines.push(`${level.toUpperCase().padEnd(4)} ${message}`);
  const client = new AemClient({ report });

  let error = null;
  try {
    await actions[opts.action || 'run']({
      client, settings: { ...SETTINGS, ...opts.settings }, report, params
    });
  } catch (e) {
    error = e.message;
  }

  const got = { writes, error: error ? error.slice(0, 60) : null };
  const ok = JSON.stringify(got.writes) === JSON.stringify(expect.writes) &&
             (expect.error ? String(error).includes(expect.error) : error === null);

  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok || opts.verbose) {
    lines.forEach((l) => console.log('        ' + l));
    console.log('        writes: ' + JSON.stringify(writes));
    if (error) console.log('        error:  ' + error);
    if (!ok) {
      console.log('        EXPECTED writes: ' + JSON.stringify(expect.writes));
      if (expect.error) console.log('        EXPECTED error:  ' + expect.error);
    }
  }
  ok ? pass++ : failed++;
}

/* ------------------------------------------------------ destination paths */

const same = (name, got, want) => {
  const ok = got === want;
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got:      ${got}\n        EXPECTED: ${want}`);
  ok ? pass++ : failed++;
};
const throwsWith = (name, fn, fragment) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  const ok = msg !== null && msg.includes(fragment);
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got: ${msg}\n        EXPECTED error containing: ${fragment}`);
  ok ? pass++ : failed++;
};

same('PATH  backup folder goes under the site root',
  backupPathFor('/content/samsung/levant/home-appliances/buying-guide/microwaves', 3, 'india/backup'),
  '/content/samsung/levant/india/backup/home-appliances/buying-guide/microwaves');
same('PATH  stray slashes on the source and the folder are ignored',
  backupPathFor('/content/samsung/lb/tvs/', 3, '/india/backup/'),
  '/content/samsung/lb/india/backup/tvs');
same('PATH  follows the configured site root depth',
  backupPathFor('/content/samsung/in/en/tvs', 4, 'india/backup'),
  '/content/samsung/in/en/india/backup/tvs');
throwsWith('PATH  a page already inside the backup folder is refused',
  () => backupPathFor('/content/samsung/levant/india/backup/tvs', 3, 'india/backup'), 'already inside');
throwsWith('PATH  the site root itself has no backup location',
  () => backupPathFor('/content/samsung/levant', 3, 'india/backup'), 'site root');
throwsWith('PATH  outside /content is refused',
  () => backupPathFor('/etc/samsung/levant/tvs', 3, 'india/backup'), '/content');

/* ------------------------------------------------------------------ cases */

await run('EX1  tvs intermediate from source template',
  { ...BASE,
    '/content/samsung/levant/tvs': pg(T.cat, 'TVs'),
    '/content/samsung/levant/tvs/40-inch-tvs': pg(T.prod, '40 Inch'),
    '/content/samsung/levant/tvs/40-inch-tvs/kid': pg(T.prod, 'Kid') },
  { source: '/content/samsung/levant/tvs/40-inch-tvs' },
  { writes: [
    'create /content/samsung/levant/india [page-marketing]',
    'create /content/samsung/levant/india/backup [page-marketing]',
    'create /content/samsung/levant/india/backup/tvs [page-category]',
    'copy /content/samsung/levant/tvs/40-inch-tvs -> /content/samsung/levant/india/backup/tvs/40-inch-tvs shallow=true',
  ] });

await run('EX2  india+backup marketing, rest from source',
  { ...BASE,
    '/content/samsung/levant/home-appliances': pg(T.cat, 'HA'),
    '/content/samsung/levant/home-appliances/buying-guide': pg(T.guide, 'BG'),
    '/content/samsung/levant/home-appliances/buying-guide/microwaves': pg(T.prod, 'Microwaves') },
  { source: '/content/samsung/levant/home-appliances/buying-guide/microwaves' },
  { writes: [
    'create /content/samsung/levant/india [page-marketing]',
    'create /content/samsung/levant/india/backup [page-marketing]',
    'create /content/samsung/levant/india/backup/home-appliances [page-category]',
    'create /content/samsung/levant/india/backup/home-appliances/buying-guide [page-buying-guide]',
    'copy /content/samsung/levant/home-appliances/buying-guide/microwaves -> /content/samsung/levant/india/backup/home-appliances/buying-guide/microwaves shallow=true',
  ] });

await run('EX3  same shape under lb',
  { ...BASE,
    '/content/samsung/lb/home-appliances': pg(T.cat, 'HA'),
    '/content/samsung/lb/home-appliances/buying-guide': pg(T.guide, 'BG'),
    '/content/samsung/lb/home-appliances/buying-guide/dishwashers': pg(T.prod, 'Dishwashers') },
  { source: '/content/samsung/lb/home-appliances/buying-guide/dishwashers' },
  { writes: [
    'create /content/samsung/lb/india [page-marketing]',
    'create /content/samsung/lb/india/backup [page-marketing]',
    'create /content/samsung/lb/india/backup/home-appliances [page-category]',
    'create /content/samsung/lb/india/backup/home-appliances/buying-guide [page-buying-guide]',
    'copy /content/samsung/lb/home-appliances/buying-guide/dishwashers -> /content/samsung/lb/india/backup/home-appliances/buying-guide/dishwashers shallow=true',
  ] });

/* A global page has no backup folder of its own: it goes into the target site's,
 * with /global/hq/vd dropped - or, with Edit path ticked, where it is typed. */
const GLOBAL = {
  ...BASE,
  '/content/samsung/global': pg(T.cat, 'Global'),
  '/content/samsung/global/hq': pg(T.cat, 'HQ'),
  '/content/samsung/global/hq/vd': pg(T.cat, 'VD'),
  '/content/samsung/global/hq/vd/tvs': pg(T.cat, 'TVs'),
  '/content/samsung/global/hq/vd/tvs/tv-buying-guide': pg(T.guide, 'Guide'),
  '/content/samsung/global/hq/vd/tvs/tv-buying-guide/tv-comparison-guide': pg(T.prod, 'Comparison'),
};
const GSRC = '/content/samsung/global/hq/vd/tvs/tv-buying-guide/tv-comparison-guide';
const GDEST = '/content/samsung/levant/india/backup/tvs/tv-buying-guide/tv-comparison-guide';
const GWRITES = [
  'create /content/samsung/levant/india [page-marketing]',
  'create /content/samsung/levant/india/backup [page-marketing]',
  'create /content/samsung/levant/india/backup/tvs [page-category]',
  'create /content/samsung/levant/india/backup/tvs/tv-buying-guide [page-buying-guide]',
  `copy ${GSRC} -> ${GDEST} shallow=true`,
];

same('PATH  global page goes into the target site, without /global/hq/vd',
  globalBackupPathFor(GSRC, 'levant', 3, 'india/backup'), GDEST);
same('PATH  stray slashes on the target site are ignored',
  globalBackupPathFor(GSRC, ' /levant/ ', 3, 'india/backup'), GDEST);
throwsWith('PATH  a target site with a path in it is refused',
  () => globalBackupPathFor(GSRC, 'levant/tvs', 3, 'india/backup'), 'not a site name');
throwsWith('PATH  global as the target site is refused',
  () => globalBackupPathFor(GSRC, 'global', 3, 'india/backup'), 'not be global');
throwsWith('PATH  a global page with nothing under hq/vd is refused',
  () => globalBackupPathFor('/content/samsung/global/hq/vd', 'levant', 3, 'india/backup'), 'no page path');

await run('GLB1  global page goes into the target site backup folder',
  GLOBAL, { source: GSRC, targetSite: 'levant', dest: '/content/samsung/lb/whatever' }, { writes: GWRITES });

await run('GLB2  global page with no target site is refused',
  GLOBAL, { source: GSRC }, { writes: [], error: 'Type the site' });

await run('GLB3  Edit path: the typed destination is used',
  GLOBAL, { source: GSRC, targetSite: 'lb', editDest: true, dest: GDEST }, { writes: GWRITES });

await run('GLB4  Edit path: outside a backup folder is refused',
  GLOBAL, { source: GSRC, editDest: true, dest: '/content/samsung/levant/tvs/tv-buying-guide/tv-comparison-guide' },
  { writes: [], error: 'backup folder' });

await run('GLB4b Edit path: another page name is refused',
  GLOBAL, { source: GSRC, editDest: 'true', dest: '/content/samsung/levant/india/backup/tvs/other' },
  { writes: [], error: 'page name' });

await run('GLB5  target site and typed destination are ignored for a non-global page',
  { ...BASE,
    '/content/samsung/levant/tvs': pg(T.cat, 'TVs'),
    '/content/samsung/levant/tvs/40-inch-tvs': pg(T.prod, '40 Inch') },
  { source: '/content/samsung/levant/tvs/40-inch-tvs', targetSite: 'lb', editDest: true, dest: '/content/samsung/lb/india/backup/tvs/40-inch-tvs' },
  { writes: [
    'create /content/samsung/levant/india [page-marketing]',
    'create /content/samsung/levant/india/backup [page-marketing]',
    'create /content/samsung/levant/india/backup/tvs [page-category]',
    'copy /content/samsung/levant/tvs/40-inch-tvs -> /content/samsung/levant/india/backup/tvs/40-inch-tvs shallow=true',
  ] });

await run('DEST  a destination sent by the panel is ignored',
  { ...BASE,
    '/content/samsung/lb/home-appliances': pg(T.cat, 'HA'),
    '/content/samsung/lb/home-appliances/dishwashers': pg(T.prod, 'D') },
  { source: '/content/samsung/lb/home-appliances/dishwashers',
    dest: '/content/samsung/levant/somewhere-else/dishwashers' },
  { writes: [
    'create /content/samsung/lb/india [page-marketing]',
    'create /content/samsung/lb/india/backup [page-marketing]',
    'create /content/samsung/lb/india/backup/home-appliances [page-category]',
    'copy /content/samsung/lb/home-appliances/dishwashers -> /content/samsung/lb/india/backup/home-appliances/dishwashers shallow=true',
  ] });

await run('DEST  the backup folder comes from settings',
  { ...BASE,
    '/content/samsung/lb/home-appliances': pg(T.cat, 'HA'),
    '/content/samsung/lb/home-appliances/dishwashers': pg(T.prod, 'D') },
  { source: '/content/samsung/lb/home-appliances/dishwashers' },
  { writes: [
    'create /content/samsung/lb/archive [page-marketing]',
    'create /content/samsung/lb/archive/home-appliances [page-category]',
    'copy /content/samsung/lb/home-appliances/dishwashers -> /content/samsung/lb/archive/home-appliances/dishwashers shallow=true',
  ] },
  { settings: { backupFolder: 'archive' } });

await run('SKIP  existing intermediate untouched',
  { ...BASE,
    '/content/samsung/lb/india': pg(T.mkt, 'India'),
    '/content/samsung/lb/home-appliances': pg(T.cat, 'HA'),
    '/content/samsung/lb/home-appliances/dishwashers': pg(T.prod, 'D') },
  { source: '/content/samsung/lb/home-appliances/dishwashers' },
  { writes: [
    'create /content/samsung/lb/india/backup [page-marketing]',
    'create /content/samsung/lb/india/backup/home-appliances [page-category]',
    'copy /content/samsung/lb/home-appliances/dishwashers -> /content/samsung/lb/india/backup/home-appliances/dishwashers shallow=true',
  ] });

await run('ABORT  something other than a page at the destination',
  { ...BASE,
    '/content/samsung/levant/tvs': pg(T.cat, 'TVs'),
    '/content/samsung/levant/tvs/40-inch-tvs': pg(T.prod, 'A'),
    '/content/samsung/levant/india': pg(T.mkt, 'India'),
    '/content/samsung/levant/india/backup': pg(T.mkt, 'Backup'),
    '/content/samsung/levant/india/backup/tvs': pg(T.cat, 'TVs'),
    '/content/samsung/levant/india/backup/tvs/40-inch-tvs': { primaryType: 'nt:unstructured' } },
  { source: '/content/samsung/levant/tvs/40-inch-tvs' },
  { writes: [], error: 'not a page' });

await run('ABORT  source already inside the backup folder',
  { ...BASE,
    '/content/samsung/levant/india': pg(T.mkt, 'India'),
    '/content/samsung/levant/india/backup': pg(T.mkt, 'Backup'),
    '/content/samsung/levant/india/backup/tvs': pg(T.cat, 'TVs') },
  { source: '/content/samsung/levant/india/backup/tvs' },
  { writes: [], error: 'already inside the backup folder' });

await run('ABORT  source missing',
  { ...BASE },
  { source: '/content/samsung/levant/tvs/40-inch-tvs' },
  { writes: [], error: 'Source page does not exist' });

await run('ABORT  createPage refused, reports server message',
  { ...BASE,
    '/content/samsung/lb/home-appliances': pg(T.cat, 'HA'),
    '/content/samsung/lb/home-appliances/dishwashers': pg(T.prod, 'D') },
  { source: '/content/samsung/lb/home-appliances/dishwashers' },
  { writes: ['create /content/samsung/lb/india [page-marketing]',
             'create /content/samsung/lb/india/backup [page-marketing]'],
    error: 'Template not allowed here' },
  { rejectCreate: (p) => p.endsWith('/backup') });

await run('ANALYZE  writes nothing',
  { ...BASE,
    '/content/samsung/lb/home-appliances': pg(T.cat, 'HA'),
    '/content/samsung/lb/home-appliances/dishwashers': pg(T.prod, 'D') },
  { source: '/content/samsung/lb/home-appliances/dishwashers' },
  { writes: [] }, { action: 'analyze' });

await run('WARN  server ignores shallow, child pages reported',
  { ...BASE,
    '/content/samsung/levant/india': pg(T.mkt, 'India'),
    '/content/samsung/levant/india/backup': pg(T.mkt, 'Backup'),
    '/content/samsung/levant/tvs': pg(T.cat, 'TVs'),
    '/content/samsung/levant/tvs/40-inch-tvs': pg(T.prod, 'A'),
    '/content/samsung/levant/tvs/40-inch-tvs/kid1': pg(T.prod, 'K1'),
    '/content/samsung/levant/tvs/40-inch-tvs/kid2': pg(T.prod, 'K2') },
  { source: '/content/samsung/levant/tvs/40-inch-tvs' },
  { writes: [
    'create /content/samsung/levant/india/backup/tvs [page-category]',
    'copy /content/samsung/levant/tvs/40-inch-tvs -> /content/samsung/levant/india/backup/tvs/40-inch-tvs shallow=true',
  ] }, { ignoreShallow: true, verbose: true });

// Regression: AEM 6.5 reports the SOURCE path for copyPage. Treating that as a
// mismatch aborted every successful copy.
await run('REPORTED PATH  servlet names the source, not the destination',
  { ...BASE,
    '/content/samsung/lb/home-appliances': pg(T.cat, 'HA'),
    '/content/samsung/lb/home-appliances/learn': pg(T.prod, 'Learn') },
  { source: '/content/samsung/lb/home-appliances/learn' },
  { writes: [
    'create /content/samsung/lb/india [page-marketing]',
    'create /content/samsung/lb/india/backup [page-marketing]',
    'create /content/samsung/lb/india/backup/home-appliances [page-category]',
    'copy /content/samsung/lb/home-appliances/learn -> /content/samsung/lb/india/backup/home-appliances/learn shallow=true',
  ] },
  { reportPathAs: (src) => src });

// The one shape that IS a collision: a sibling of the intended destination.
await run('COLLISION  sibling rename is still caught',
  { ...BASE,
    '/content/samsung/lb/home-appliances': pg(T.cat, 'HA'),
    '/content/samsung/lb/home-appliances/learn': pg(T.prod, 'Learn') },
  { source: '/content/samsung/lb/home-appliances/learn' },
  { writes: [
    'create /content/samsung/lb/india [page-marketing]',
    'create /content/samsung/lb/india/backup [page-marketing]',
    'create /content/samsung/lb/india/backup/home-appliances [page-category]',
    'copy /content/samsung/lb/home-appliances/learn -> /content/samsung/lb/india/backup/home-appliances/learn shallow=true',
  ], error: 'renamed to' },
  { reportPathAs: (src, landed) => landed + '1' });

console.log(`\n${'='.repeat(50)}\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
