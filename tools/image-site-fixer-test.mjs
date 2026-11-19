/**
 * The Image Site Code Fixer, run for real in Node against a small in-memory
 * AEM: the real worker, the real upload (page-upsert's uploadAsset), and a
 * page read back after the write. Imported at the end of engine-test.mjs, so
 * `node tools/engine-test.mjs` runs it too; it runs on its own as well.
 */

import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')), '..');
const url = (rel) => new URL(`file:///${join(ROOT, rel).split('\\').join('/')}`).href;

const { actions } = await import(url('src/features/image-site-fixer/worker.js'));
const I = await import(url('src/features/image-site-fixer/images.js'));

let failures = 0;
const check = async (name, fn) => {
  let why = null;
  try {
    why = await fn();
  } catch (e) {
    why = `threw: ${e.message}`;
  }
  console.log(`  ${why ? 'FAIL' : 'ok  '} ${name}${why ? ` - ${why}` : ''}`);
  if (why) failures++;
};
const refusal = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.message;
  }
};

const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);
const PAGE = '/content/samsung/iq_ku/apps/samsung-health';
const DM = 'https://images.samsung.com/is/image/samsung/assets';
const SC = 'samsung/components/content/consumer/global/common/cm-g-static-content';

const body = (site) =>
  '<picture class="bg">\r\n' +
  `  <source media="(min-width: 1081px)" srcset="${DM}/${site}/apps/samsung-health/27_07/mindful1081.jpg?imbypass=true" />\r\n` +
  `  <source media="(min-width: 768px)" srcset="${DM}/${site}/apps/samsung-health/27_07/mindful768.jpg?imbypass=true&imwidth=1080" />\r\n` +
  `  <img src="${DM}/${site}/apps/samsung-health/27_07/gone.jpg?imbypass=true" alt="A person" />\r\n</picture>\r\n` +
  '<a href="https://shealth.samsung.com/deepLink?sc_id=mood">Try now</a>';

function repoOf() {
  return {
    pages: {
      [PAGE]: {
        'jcr:primaryType': 'cq:PageContent',
        'jcr:title': 'Samsung Health',
        root: {
          'jcr:primaryType': 'nt:unstructured',
          responsivegrid: {
            'jcr:primaryType': 'nt:unstructured',
            static: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': SC, bodyHtml: body('lb') },
            hero: {
              'jcr:primaryType': 'nt:unstructured',
              'sling:resourceType': 'samsung/components/hero',
              fileReference: '/content/dam/samsung/lb/apps/samsung-health/hero image (1).jpg',
              mobileRef: '/content/dam/samsung/iq_ku/apps/samsung-health/own.jpg',
              sharedRef: '/content/dam/samsung/global/icons/arrow.svg'
            }
          }
        }
      },
      '/content/samsung/iq_ku': { 'jcr:primaryType': 'cq:PageContent' },
      '/content/samsung/lb': { 'jcr:primaryType': 'cq:PageContent' }
    },
    sites: ['/content/samsung/iq_ku', '/content/samsung/lb'],
    dam: [
      '/content/dam/samsung/iq_ku',
      '/content/dam/samsung/iq_ku/apps/samsung-health/own.jpg',
      '/content/dam/samsung/lb/apps/samsung-health/27_07/mindful1081.jpg',
      '/content/dam/samsung/lb/apps/samsung-health/27_07/mindful768.jpg',
      '/content/dam/samsung/lb/apps/samsung-health/hero image (1).jpg',
      '/content/dam/samsung/global/icons/arrow.svg'
    ]
  };
}

function client(repo, log = []) {
  const contentAt = (path) => {
    const m = path.match(/^(.*?)\/jcr:content(\/.*)?$/);
    if (!m || !repo.pages[m[1]]) return null;
    let node = repo.pages[m[1]];
    for (const n of (m[2] || '').split('/').filter(Boolean)) {
      node = node?.[n];
      if (!isNode(node)) return null;
    }
    return node;
  };
  const ok = { success: true, http: 200, effective: 200 };
  return {
    log,
    resetCaches() {},
    forgetProbe() {},
    assertReadable() {},
    async inspect(path) {
      const c = repo.pages[path];
      return c ? { path, exists: true, isPage: true, primaryType: 'cq:Page', title: c['jcr:title'] } : { path, exists: false };
    },
    async probe(path) {
      if (/^\/(apps|libs)\//.test(path)) return 'yes';
      return contentAt(path) || repo.pages[path] || repo.dam.includes(path) ? 'yes' : 'no';
    },
    async readTreeWhole(path) {
      const n = contentAt(path);
      return n ? structuredClone(n) : null;
    },
    async readProps(path) {
      if (/^\/(apps|libs)\//.test(path)) return { 'jcr:title': `Title of ${path.split('/').pop()}` };
      if (repo.sites.includes(path)) return { 'jcr:primaryType': 'cq:Page' };
      const n = contentAt(path);
      return n ? Object.fromEntries(Object.entries(n).filter(([, v]) => !isNode(v))) : null;
    },
    async currentUser() {
      return 'tester';
    },
    async createFolder(path) {
      log.push({ kind: 'folder', path });
      repo.dam.push(path);
      return ok;
    },
    async readBytes(path, opts = {}) {
      log.push({ kind: 'read', path, url: opts.url || null });
      return { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg', size: 3 };
    },
    async createAsset({ folder, fileName }) {
      log.push({ kind: 'upload', path: `${folder}/${fileName}` });
      repo.dam.push(`${folder}/${fileName}`);
    },
    async writeNode(path, pairs) {
      log.push({ kind: 'write', path, pairs });
      const node = contentAt(path);
      const seen = new Set();
      for (const [key, value] of pairs) {
        if (key.endsWith('@TypeHint')) continue;
        const rel = key.replace(/^\.\//, '').split('/');
        const prop = rel.pop();
        let n = node;
        for (const s of rel) n = n[s];
        n[prop] = seen.has(key) ? [].concat(n[prop], value) : value;
        seen.add(key);
      }
      return { ...ok, changes: ['modified('] };
    }
  };
}

const SETTINGS = { rootDepth: 3 };
const quiet = () => {};

/* Dynamic Media still serves gone.jpg; the DAM has lost it. */
async function withDelivery(fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => ({ ok: /\/lb\/.*\/gone\.jpg$/.test(u) && u.startsWith('https://images.'), status: /gone\.jpg$/.test(u) && u.startsWith('https://images.') ? 200 : 404 });
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

async function scanAndFix(repo, pick = (img) => img.site) {
  const log = [];
  const c = client(repo, log);
  return withDelivery(async () => {
    const scan = await actions.scan({ client: c, report: quiet, params: { page: PAGE }, settings: SETTINGS });
    const picks = scan.images.filter(pick).map((i) => i.src);
    const result = await actions.fix({ client: c, report: quiet, params: { page: PAGE, picks, props: scan.props }, settings: SETTINGS });
    return { scan, result, log };
  });
}

console.log('');
console.log('--- the Image Site Code Fixer ---');

await check('both forms are found: a DAM path and an images.samsung.com URL, with where the folder is', async () => {
  const f = I.findInString(`<img src="${DM}/lb/a/b.jpg?x=1"> <img src="/content/dam/samsung/lb/a/c%20d.jpg">`, '/content/dam/samsung');
  const got = f.map((x) => `${x.form}:${x.folder}:${x.path}:${I.repoint(x, 'iq_ku')}`).join(' | ');
  const want =
    `delivery:lb:/content/dam/samsung/lb/a/b.jpg:${DM}/iq_ku/a/b.jpg | ` +
    'dam:lb:/content/dam/samsung/lb/a/c d.jpg:/content/dam/samsung/iq_ku/a/c%20d.jpg';
  return got === want ? null : got;
});

await check('a whole-value reference keeps its spaces and brackets', async () => {
  const f = I.findInString('/content/dam/samsung/lb/x/hero image (1).jpg', '/content/dam/samsung');
  return f.length === 1 && f[0].path === '/content/dam/samsung/lb/x/hero image (1).jpg' ? null : JSON.stringify(f);
});

await check('the scan lists images from other folders only, with what each needs', async () => {
  const repo = repoOf();
  const before = JSON.stringify(repo);
  const { scan } = await withDelivery(async () => ({
    scan: await actions.scan({ client: client(repo), report: quiet, params: { page: PAGE }, settings: SETTINGS })
  }));
  if (JSON.stringify(repo) !== before) return 'the scan wrote something';
  const rows = scan.images.map((i) => `${i.src.split('/').pop()} ${i.folder} ${i.site ? 'site' : 'shared'} ${i.action}`).sort();
  const want = [
    'arrow.svg global shared upload',
    'gone.jpg lb site upload-delivery',
    'hero image (1).jpg lb site upload',
    'mindful1081.jpg lb site upload',
    'mindful768.jpg lb site upload'
  ];
  if (JSON.stringify(rows) !== JSON.stringify(want)) return JSON.stringify(rows);
  return scan.folder === 'iq_ku' && scan.props.length === 3 ? null : `folder ${scan.folder}, props ${scan.props.length}`;
});

await check('the fix uploads the ticked images, then re-points every reference in its own form', async () => {
  const repo = repoOf();
  const { result, log } = await scanAndFix(repo);
  const grid = repo.pages[PAGE].root.responsivegrid;
  const wantBody = body('iq_ku');
  if (grid.static.bodyHtml !== wantBody) return `bodyHtml ${JSON.stringify(grid.static.bodyHtml)}`;
  if (grid.hero.fileReference !== '/content/dam/samsung/iq_ku/apps/samsung-health/hero image (1).jpg') return `fileReference ${grid.hero.fileReference}`;
  if (grid.hero.sharedRef !== '/content/dam/samsung/global/icons/arrow.svg') return 'an unticked shared image was moved';
  if (grid.hero.mobileRef !== '/content/dam/samsung/iq_ku/apps/samsung-health/own.jpg') return 'the page’s own image changed';
  const uploads = log.filter((l) => l.kind === 'upload').map((l) => l.path.replace('/content/dam/samsung/iq_ku/apps/samsung-health/', '')).sort();
  if (uploads.join() !== '27_07/gone.jpg,27_07/mindful1081.jpg,27_07/mindful768.jpg,hero image (1).jpg') return `uploads ${uploads}`;
  const fromDm = log.filter((l) => l.kind === 'read' && l.url).map((l) => l.url);
  if (fromDm.join() !== `${DM}/lb/apps/samsung-health/27_07/gone.jpg`) return `read from Dynamic Media: ${fromDm}`;
  if (!log.some((l) => l.kind === 'folder' && l.path === '/content/dam/samsung/iq_ku/apps/samsung-health/27_07')) return 'the 27_07 folder was not made';
  // Uploaded before the page is written: the page never points at an image that is not there.
  if (log.findIndex((l) => l.kind === 'write') < log.findLastIndex((l) => l.kind === 'upload')) return 'the page was written before the uploads finished';
  return result.fixed === 4 && result.uploaded === 4 && result.remaining === 1 ? null : JSON.stringify(result);
});

await check('an image already in this folder is not uploaded again - only the page is re-pointed', async () => {
  const repo = repoOf();
  repo.dam.push('/content/dam/samsung/iq_ku/apps/samsung-health/27_07/mindful1081.jpg');
  const { log, result } = await scanAndFix(repo, (i) => i.src.endsWith('mindful1081.jpg'));
  if (log.some((l) => l.kind === 'upload')) return 'uploaded it again';
  const b = repo.pages[PAGE].root.responsivegrid.static.bodyHtml;
  return b.includes('/iq_ku/apps/samsung-health/27_07/mindful1081.jpg') && b.includes('/lb/apps/samsung-health/27_07/mindful768.jpg') && result.uploaded === 0
    ? null
    : b;
});

await check('an image in neither the DAM nor Dynamic Media cannot be picked, and nothing is written', async () => {
  const repo = repoOf();
  repo.pages[PAGE].root.responsivegrid.static.bodyHtml = `<img src="${DM}/lb/x/lost.jpg">`;
  const c = client(repo);
  const scan = await withDelivery(() => actions.scan({ client: c, report: quiet, params: { page: PAGE }, settings: SETTINGS }));
  const lost = scan.images.find((i) => i.src.endsWith('lost.jpg'));
  if (lost?.action !== 'missing') return `action ${lost?.action}`;
  const before = JSON.stringify(repo.pages);
  const why = await withDelivery(() => refusal(() => actions.fix({ client: c, report: quiet, params: { page: PAGE, picks: [lost.src], props: scan.props }, settings: SETTINGS })));
  if (!why || !/can no longer be fixed/.test(why)) return `said: ${why}`;
  return JSON.stringify(repo.pages) === before ? null : 'something was written';
});

await check('a property edited since the scan is refused before any upload', async () => {
  const repo = repoOf();
  const log = [];
  const c = client(repo, log);
  const scan = await withDelivery(() => actions.scan({ client: c, report: quiet, params: { page: PAGE }, settings: SETTINGS }));
  repo.pages[PAGE].root.responsivegrid.static.bodyHtml += '<p>edited</p>';
  const why = await withDelivery(() =>
    refusal(() => actions.fix({ client: c, report: quiet, params: { page: PAGE, picks: scan.images.map((i) => i.src), props: scan.props }, settings: SETTINGS }))
  );
  if (!why || !/changed since the scan/.test(why)) return `said: ${why}`;
  return log.some((l) => l.kind === 'upload' || l.kind === 'write') ? 'something was uploaded or written' : null;
});

await check('a pick the page does not have is refused', async () => {
  const repo = repoOf();
  const c = client(repo);
  const scan = await withDelivery(() => actions.scan({ client: c, report: quiet, params: { page: PAGE }, settings: SETTINGS }));
  const why = await withDelivery(() =>
    refusal(() => actions.fix({ client: c, report: quiet, params: { page: PAGE, picks: ['/content/dam/samsung/lb/not/here.jpg'], props: scan.props }, settings: SETTINGS }))
  );
  return why && /not an image the scan finds/.test(why) ? null : `said: ${why}`;
});

await check('a DAM folder that is not there is refused, and another can be named', async () => {
  const repo = repoOf();
  const c = client(repo);
  const why = await refusal(() => actions.scan({ client: c, report: quiet, params: { page: PAGE, damFolder: 'iq' }, settings: SETTINGS }));
  if (!why || !/no DAM folder \/content\/dam\/samsung\/iq\b/.test(why)) return `said: ${why}`;
  repo.dam.push('/content/dam/samsung/iq');
  const scan = await withDelivery(() => actions.scan({ client: c, report: quiet, params: { page: PAGE, damFolder: 'iq' }, settings: SETTINGS }));
  // Named "iq", the page's own iq_ku image is now from another folder too.
  return scan.folder === 'iq' && scan.images.some((i) => i.folder === 'iq_ku') ? null : JSON.stringify(scan.images.map((i) => i.folder));
});

await check('a page with every image in its own folder has nothing to fix', async () => {
  const repo = repoOf();
  repo.pages[PAGE].root.responsivegrid = { 'jcr:primaryType': 'nt:unstructured', hero: { fileReference: '/content/dam/samsung/iq_ku/apps/samsung-health/own.jpg' } };
  const scan = await actions.scan({ client: client(repo), report: quiet, params: { page: PAGE }, settings: SETTINGS });
  return scan.images.length === 0 ? null : JSON.stringify(scan.images);
});

if (failures) {
  console.log(`\n${failures} image-site-fixer check(s) FAILED`);
  process.exitCode = 1;
}
