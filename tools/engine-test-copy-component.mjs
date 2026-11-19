/**
 * Copy a component: the real page-upsert worker, narrowed to one component,
 * against a small in-memory AEM. Imported by engine-test.mjs; runs on its own:
 *
 *   node tools/engine-test-copy-component.mjs
 *
 * What it proves is what the browser suite cannot, since every worker there is
 * stubbed: what lands on the destination page, and what does not move.
 */

const U = await import('../src/features/page-upsert/worker.js');
const C = await import('../src/features/page-upsert/component.js');

const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** A Sling POST to <page>/jcr:content, applied the way AEM would. */
function applyTo(target, pairs) {
  const seen = new Set();
  const at = (rel) => {
    let node = target;
    for (const name of rel.split('/').filter(Boolean)) {
      if (!isNode(node[name])) node[name] = { 'jcr:primaryType': 'nt:unstructured' };
      node = node[name];
    }
    return node;
  };
  for (const [key, value] of pairs) {
    if (key === '_charset_' || key.endsWith('@TypeHint')) continue;
    const path = key.replace(/^\.\/?/, '');
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const prop = path.slice(path.lastIndexOf('/') + 1);
    if (prop.endsWith('@Delete')) {
      delete at(parent)[prop.slice(0, -'@Delete'.length)];
      continue;
    }
    const node = at(parent);
    node[prop] = seen.has(key) ? [].concat(node[prop], value) : value;
    seen.add(key);
  }
  return ['modified('];
}

/** Moves a child to `index` among its siblings, as Sling's :order does. */
function orderIn(pages, path, index) {
  const m = path.match(/^(.*?)\/jcr:content(\/.*)$/);
  const segs = m[2].split('/').filter(Boolean);
  const name = segs.pop();
  let parent = pages[m[1]];
  for (const s of segs) parent = parent[s];
  const entries = Object.entries(parent);
  const props = entries.filter(([, v]) => !isNode(v));
  const kids = entries.filter(([, v]) => isNode(v));
  const i = kids.findIndex(([k]) => k === name);
  const [moved] = kids.splice(i, 1);
  kids.splice(index, 0, moved);
  for (const k of Object.keys(parent)) delete parent[k];
  Object.assign(parent, Object.fromEntries([...props, ...kids]));
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
  const exists = (p) => p in repo.pages || (repo.dam || []).includes(p) || Object.keys(repo.pages).some((k) => k.startsWith(`${p}/`));
  const ok = { success: true, http: 200, effective: 200 };
  return {
    log,
    resetCaches() {},
    forgetProbe() {},
    assertReadable() {},
    async inspect(path) {
      const c = repo.pages[path];
      return c
        ? { path, exists: true, isPage: true, primaryType: 'cq:Page', title: c['jcr:title'], childPages: [] }
        : { path, exists: exists(path), isPage: false, primaryType: 'sling:Folder', childPages: [] };
    },
    async probe(path) {
      if (/^\/(apps|libs|conf)\//.test(path)) return 'yes';
      return contentAt(path) || exists(path) ? 'yes' : 'no';
    },
    async readTree(path) {
      const n = contentAt(path);
      return n ? structuredClone(n) : null;
    },
    async readTreeWhole(path) {
      return this.readTree(path);
    },
    async readProps(path) {
      if (path.startsWith('/apps/')) return { 'jcr:title': `Title of ${path.split('/').pop()}` };
      const n = contentAt(path);
      return n ? Object.fromEntries(Object.entries(n).filter(([, v]) => !isNode(v))) : null;
    },
    async createFolder(path) {
      log.push({ kind: 'folder', path });
      (repo.dam ||= []).push(path);
      return ok;
    },
    async readBytes(path, opts = {}) {
      log.push({ kind: 'read', path, url: opts.url || null });
      return { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg', size: 3 };
    },
    async createAsset({ folder, fileName }) {
      log.push({ kind: 'upload', path: `${folder}/${fileName}` });
      (repo.dam ||= []).push(`${folder}/${fileName}`);
    },
    async orderNode(path, index) {
      log.push({ kind: 'order', path, index });
      orderIn(repo.pages, path, index);
      return ok;
    },
    async versionPage() {
      return ok;
    },
    async currentUser() {
      return 'tester';
    },
    async writeTree(root, pairs) {
      log.push({ kind: 'write', root, pairs });
      return { ...ok, changes: applyTo(repo.pages[root.replace(/\/jcr:content$/, '')], pairs) };
    },
    async writeNode(path, pairs) {
      return this.writeTree(path, pairs);
    }
  };
}

const SETTINGS = {
  rootDepth: 3, backupFolder: 'india/backup', upsertHosts: '', upsertKeepAtDest: 'hreflangGroup', upsertKeepNodes: '',
  upsertSharedSites: 'global', upsertCopyAssets: true, upsertOverwriteAssets: false, upsertReorder: true,
  upsertVersionFirst: false, upsertStripReplication: true, upsertRewriteShop: false
};

const GRID = 'wcm/foundation/components/responsivegrid';
const page = (grid, title = 'T') => ({
  'jcr:primaryType': 'cq:PageContent', 'sling:resourceType': 'site/page', 'jcr:title': title, canonical: 'https://www.samsung.com/x/',
  root: {
    'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': GRID,
    responsivegrid: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': GRID, ...grid }
  }
});
const text = (headline, more = {}) => ({ 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': 'samsung/components/text', headlineText: headline, ...more });

/* The component being copied: a link into its site, an image from its DAM, and a child node holding more of both. */
const feature = () => ({
  'jcr:primaryType': 'nt:unstructured',
  'sling:resourceType': 'samsung/components/feature',
  headlineText: 'What is Mini LED?',
  ctaUrl: '/uk/tvs/all-tvs/',
  desktopImageRef: '/content/dam/samsung/uk/tvs/hero-pc.jpg',
  carousel1: {
    'jcr:primaryType': 'nt:unstructured',
    description: 'See <a href="https://www.samsung.com/uk/tvs/">all TVs</a>',
    imageMobileImageRef: '/content/dam/samsung/uk/tvs/hero-mo.jpg'
  }
});

const SRC = '/content/samsung/uk/tvs/guide';
const DST = '/content/samsung/levant/tvs/guide';
const FROM = '/root/responsivegrid/feature';
const kids = (p) => Object.keys(p.root.responsivegrid).filter((k) => isNode(p.root.responsivegrid[k]));

function repoOf() {
  return {
    pages: {
      [SRC]: page({ intro: text('Intro'), feature: feature() }, 'Source'),
      [DST]: page({ text_0: text('First', { ctaUrl: '/levant/a/' }), text_1: text('Second') }, 'Destination'),
      '/content/samsung/uk': page({}),
      '/content/samsung/levant': page({})
    },
    dam: ['/content/dam/samsung/uk/tvs/hero-pc.jpg', '/content/dam/samsung/uk/tvs/hero-mo.jpg', '/content/dam/samsung/levant']
  };
}

async function copy(repo, params) {
  const lines = [];
  const report = (level, message) => level !== 'data' && lines.push(`${level}: ${message}`);
  const log = [];
  const c = client(repo, log);
  const review = await U.actions.analyze({ client: c, settings: SETTINGS, report, params });
  const result = await U.actions.run({ client: c, settings: SETTINGS, report, params: { ...params, backupFirst: false } });
  return { review, result, log, lines };
}

let failed = 0;
const check = async (name, fn) => {
  let why = null;
  try {
    why = await fn();
  } catch (e) {
    why = `threw: ${e.message}`;
  }
  console.log(`  ${why ? 'FAIL' : 'ok  '} ${name}${why ? ` - ${why}` : ''}`);
  if (why) {
    failed++;
    process.exitCode = 1;
  }
};
const refusal = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.message;
  }
};

console.log('');
console.log('--- Copy a component ---');

await check('between sites: added above the chosen component, links and images re-pointed, images uploaded', async () => {
  const repo = repoOf();
  const before = structuredClone(repo.pages[DST]);
  const { review, log } = await copy(repo, { source: SRC, dest: DST, component: { from: FROM, before: '/root/responsivegrid/text_1' } });
  const dst = repo.pages[DST];
  const got = dst.root.responsivegrid.feature;
  if (!got) return `no feature on the destination: ${kids(dst).join(', ')}`;
  if (kids(dst).join(',') !== 'text_0,feature,text_1') return `order is ${kids(dst).join(',')}`;
  if (got.ctaUrl !== '/levant/tvs/all-tvs/') return `ctaUrl ${got.ctaUrl}`;
  if (got.desktopImageRef !== '/content/dam/samsung/levant/tvs/hero-pc.jpg') return `image ${got.desktopImageRef}`;
  if (!/www\.samsung\.com\/levant\/tvs\//.test(got.carousel1?.description || '')) return `child link ${got.carousel1?.description}`;
  if (got.carousel1?.imageMobileImageRef !== '/content/dam/samsung/levant/tvs/hero-mo.jpg') return 'child image not re-pointed';
  const uploads = log.filter((l) => l.kind === 'upload').map((l) => l.path).sort();
  if (uploads.join(',') !== '/content/dam/samsung/levant/tvs/hero-mo.jpg,/content/dam/samsung/levant/tvs/hero-pc.jpg') return `uploads ${uploads}`;
  if (review.component?.to !== '/root/responsivegrid/feature') return `summary component ${JSON.stringify(review.component)}`;
  if (review.counts.nodesDeleted || review.props.deleted.length || review.largeRemoval) return 'plans a removal';
  // Everything that was there is exactly as it was.
  for (const k of ['text_0', 'text_1']) {
    if (JSON.stringify(dst.root.responsivegrid[k]) !== JSON.stringify(before.root.responsivegrid[k])) return `${k} changed`;
  }
  const own = (p) => JSON.stringify(Object.fromEntries(Object.entries(p).filter(([, v]) => !isNode(v))));
  if (own(dst) !== own(before)) return 'page properties changed';
  if (dst.root.responsivegrid.text_0.ctaUrl !== '/levant/a/') return "the destination's own link moved";
  return null;
});

/* The fault of 2026-11-19: a static content component from /lb to /iq_ku named its
   images by their Dynamic Media URLs, which nothing read as images - none was
   uploaded and every URL still named /lb. */
await check('images named by their Dynamic Media URLs are uploaded and re-pointed', async () => {
  const LB = '/content/samsung/lb/apps/samsung-health';
  const IQ = '/content/samsung/iq_ku/apps/samsung-health';
  const dm = 'https://images.samsung.com/is/image/samsung/assets/lb/apps/samsung-health/27_07';
  const body =
    '<picture class="bg">\r\n' +
    `  <source media="(min-width: 1081px)" srcset="${dm}/mindful1081.jpg?imbypass=true" />\r\n` +
    `  <source media="(min-width: 768px)" srcset="${dm}/mindful768.jpg?imbypass=true&imwidth=1080" />\r\n` +
    `  <img src="${dm}/mindfulfull.jpg?imbypass=true" alt="A person" />\r\n</picture>\r\n` +
    '<a href="https://shealth.samsung.com/deepLink?sc_id=mood">Try now</a>';
  const repo = {
    pages: {
      [LB]: page({ cm_g_static_content__1: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': 'samsung/components/content/consumer/global/common/cm-g-static-content', bodyHtml: body } }),
      [IQ]: page({ text_0: text('First') }),
      '/content/samsung/lb': page({}),
      '/content/samsung/iq_ku': page({})
    },
    // mindfulfull.jpg is not in the DAM: only images.samsung.com still has it.
    dam: ['mindful1081.jpg', 'mindful768.jpg'].map((f) => `/content/dam/samsung/lb/apps/samsung-health/27_07/${f}`).concat('/content/dam/samsung/iq_ku')
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: String(url) === `${dm}/mindfulfull.jpg`, status: String(url) === `${dm}/mindfulfull.jpg` ? 200 : 404 });
  let log;
  try {
    ({ log } = await copy(repo, { source: LB, dest: IQ, component: { from: '/root/responsivegrid/cm_g_static_content__1', into: '/root/responsivegrid' } }));
  } finally {
    globalThis.fetch = realFetch;
  }
  const downloaded = log.filter((l) => l.kind === 'read' && l.url).map((l) => l.url);
  if (downloaded.join() !== `${dm}/mindfulfull.jpg`) return `downloaded from Dynamic Media: ${downloaded.join() || 'nothing'}`;
  const got = repo.pages[IQ].root.responsivegrid.cm_g_static_content__1?.bodyHtml || '';
  if (got.includes('/assets/lb/')) return `still names /lb: ${got.match(/\S*assets\/lb\/\S*/)[0]}`;
  const want = body.split('/assets/lb/').join('/assets/iq_ku/');
  if (got !== want) return `bodyHtml is ${JSON.stringify(got)}`;
  const uploads = log.filter((l) => l.kind === 'upload').map((l) => l.path.split('/').pop()).sort().join(',');
  if (uploads !== 'mindful1081.jpg,mindful768.jpg,mindfulfull.jpg') return `uploads ${uploads}`;
  if (!log.some((l) => l.kind === 'upload' && l.path === '/content/dam/samsung/iq_ku/apps/samsung-health/27_07/mindfulfull.jpg')) return 'uploaded to the wrong folder';
  return null;
});

/* Copy a page on this server goes through the same plan - the whole page this time. */
await check('Copy a page (this server): Dynamic Media URLs on the page are uploaded and re-pointed', async () => {
  const LB = '/content/samsung/lb/apps/samsung-health';
  const IQ = '/content/samsung/iq_ku/apps/samsung-health';
  const dm = 'https://images.samsung.com/is/image/samsung/assets/lb/apps/samsung-health/27_07';
  const body = `<picture><source srcset="${dm}/a.jpg?imbypass=true" /><img src="${dm}/b.jpg?imbypass=true" alt="x" /></picture>`;
  const sc = { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': 'samsung/components/content/consumer/global/common/cm-g-static-content', bodyHtml: body };
  const repo = {
    pages: { [LB]: page({ sc }), [IQ]: page({}), '/content/samsung/lb': page({}), '/content/samsung/iq_ku': page({}) },
    dam: ['/content/dam/samsung/lb/apps/samsung-health/27_07/a.jpg', '/content/dam/samsung/lb/apps/samsung-health/27_07/b.jpg', '/content/dam/samsung/iq_ku']
  };
  const { log } = await copy(repo, { source: LB, dest: IQ, metadataAck: true });
  const got = repo.pages[IQ].root.responsivegrid.sc?.bodyHtml;
  if (got !== body.split('/assets/lb/').join('/assets/iq_ku/')) return `bodyHtml ${JSON.stringify(got)}`;
  const uploads = log.filter((l) => l.kind === 'upload').map((l) => l.path).sort().join(',');
  return uploads === '/content/dam/samsung/iq_ku/apps/samsung-health/27_07/a.jpg,/content/dam/samsung/iq_ku/apps/samsung-health/27_07/b.jpg' ? null : `uploads ${uploads}`;
});

await check('same site: copied as it is, nothing re-pointed or uploaded', async () => {
  const repo = repoOf();
  const other = '/content/samsung/uk/tvs/other';
  repo.pages[other] = page({ only: text('Only') });
  const { review, log } = await copy(repo, { source: SRC, dest: other, component: { from: FROM, into: '/root/responsivegrid' } });
  const got = repo.pages[other].root.responsivegrid.feature;
  if (review.rewrite.enabled) return 'rewrite is on';
  if (got?.ctaUrl !== '/uk/tvs/all-tvs/' || got?.desktopImageRef !== '/content/dam/samsung/uk/tvs/hero-pc.jpg') return JSON.stringify(got);
  if (log.some((l) => l.kind === 'upload')) return 'uploaded an image';
  if (kids(repo.pages[other]).join(',') !== 'only,feature') return `order is ${kids(repo.pages[other])}`;
  return null;
});

await check('a name already taken gets the next free one, and the existing component is untouched', async () => {
  const repo = repoOf();
  repo.pages[DST].root.responsivegrid.feature = text('Already here');
  const { review } = await copy(repo, { source: SRC, dest: DST, component: { from: FROM, before: '/root/responsivegrid/text_0' } });
  const g = repo.pages[DST].root.responsivegrid;
  if (review.component?.name !== 'feature_copy' || !review.component.renamed) return JSON.stringify(review.component);
  if (g.feature.headlineText !== 'Already here') return 'the existing one was overwritten';
  if (g.feature_copy?.headlineText !== 'What is Mini LED?') return 'the copy is not there';
  if (kids(repo.pages[DST])[0] !== 'feature_copy') return `order is ${kids(repo.pages[DST])}`;
  return null;
});

await check('within one page: a second copy of a component', async () => {
  const repo = repoOf();
  await copy(repo, { source: SRC, dest: SRC, component: { from: FROM, before: '/root/responsivegrid/intro' } });
  const order = kids(repo.pages[SRC]).join(',');
  return order === 'feature_copy,intro,feature' ? null : `order is ${order}`;
});

for (const [name, params, want] of [
  ['a destination that is not there', { dest: '/content/samsung/levant/tvs/nope', component: { from: FROM, before: '/root/responsivegrid/text_0' } }, /not there/],
  ['a component not on the source', { component: { from: '/root/responsivegrid/gone', before: '/root/responsivegrid/text_0' } }, /not on the source/],
  ['a place not on the destination', { component: { from: FROM, before: '/root/responsivegrid/gone' } }, /not on the destination/],
  ['no place at all', { component: { from: FROM } }, /Choose where/],
  ['the page root', { component: { from: '/root', before: '/root/responsivegrid/text_0' } }, /not on the source/]
]) {
  await check(`refused: ${name}`, async () => {
    const repo = repoOf();
    const before = JSON.stringify(repo.pages);
    const why = await refusal(() => copy(repo, { source: SRC, dest: DST, ...params }));
    if (!why) return 'it ran';
    if (!want.test(why)) return `said: ${why}`;
    return JSON.stringify(repo.pages) === before ? null : 'something was written';
  });
}

await check('refused: a component with nothing in it', async () => {
  const repo = repoOf();
  repo.pages[SRC].root.responsivegrid.empty = { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': 'samsung/components/text' };
  const why = await refusal(() => copy(repo, { source: SRC, dest: DST, component: { from: '/root/responsivegrid/empty', before: '/root/responsivegrid/text_0' } }));
  return why && /no content/.test(why) ? null : `said: ${why}`;
});

await check('the picker lists components in page order, containers marked', async () => {
  const repo = repoOf();
  const { source, dest } = await U.actions.components({ client: client(repo), settings: SETTINGS, params: { source: SRC, dest: DST } });
  const s = source.components.map((c) => `${c.name}${c.container ? '*' : ''}`).join(',');
  if (s !== 'responsivegrid*,intro,feature') return s;
  if (source.components[2].headline !== 'What is Mini LED?') return `headline ${source.components[2].headline}`;
  if (source.components[2].title !== 'Title of feature') return `title ${source.components[2].title}`;
  return dest.components.map((c) => c.name).join(',') === 'responsivegrid,text_0,text_1' ? null : 'destination list';
});

await check('freeName counts on', async () => {
  const n = C.freeName('a', ['a', 'a_copy', 'a_copy_2']);
  return n === 'a_copy_3' ? null : n;
});

/* Its own feature: the same plan, but never a whole-page copy by omission. */
const F = await import('../src/features/component-copy/worker.js');
await check('the component-copy feature copies a component, through the same plan', async () => {
  const repo = repoOf();
  const c = client(repo);
  const params = { source: SRC, dest: DST, component: { from: FROM, before: '/root/responsivegrid/text_1' }, backupFirst: false };
  const review = await F.actions.analyze({ client: c, settings: SETTINGS, report: () => {}, params });
  await F.actions.run({ client: c, settings: SETTINGS, report: () => {}, params });
  if (review.component?.name !== 'feature') return JSON.stringify(review.component);
  return kids(repo.pages[DST]).join(',') === 'text_0,feature,text_1' ? null : kids(repo.pages[DST]).join(',');
});
for (const [name, component] of [['no component', undefined], ['a component and no place', { from: FROM }]]) {
  await check(`the component-copy feature refuses ${name}, and writes nothing`, async () => {
    const repo = repoOf();
    const before = JSON.stringify(repo.pages);
    const why = await refusal(() =>
      F.actions.run({ client: client(repo), settings: SETTINGS, report: () => {}, params: { source: SRC, dest: DST, component, backupFirst: false } })
    );
    if (!why || !/Choose/.test(why)) return `said: ${why}`;
    return JSON.stringify(repo.pages) === before ? null : 'something was written';
  });
}

if (failed) console.log(`\n${failed} copy-a-component check(s) FAILED`);
