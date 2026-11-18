/**
 * Run the real transfer engine against a fake AEM, in Node.
 *
 * The browser tests prove a screen draws what it should. They cannot prove a
 * run does the right thing to a page, because every worker is stubbed. This
 * does the opposite: no screens, the actual page-transfer worker, and an
 * in-memory repository it reads and writes.
 *
 * Written after a cross-server copy left a destination page with its
 * components and none of their content.
 *
 *   node tools/engine-test.mjs
 */

import { readFileSync } from 'node:fs';

/* Real pages, with every piece of copy replaced: what the engine reasons
   about is the shape, the paths and the resource types, and those are kept
   exactly as AEM served them. DSY_DATA points it at the real JSON instead. */
const DATA = process.env.DSY_DATA || new URL('./fixtures/', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
const SRC_PAGE = '/content/samsung/uk/mobile-phone-buying-guide/samsung-galaxy-z-flip-6-vs-z-flip-5';
const DEST_PAGE = '/content/samsung/levant/india/backup/mobile-phone-buying-guide/samsung-z-flip-3-vs-z-flip';

const SOURCE_JSON = JSON.parse(readFileSync(`${DATA}/src.json`, 'utf8'));
const STRIPPED = JSON.parse(readFileSync(`${DATA}/dst.json`, 'utf8'));

/**
 * The destination as it must have been before the run: the shape it was left
 * in, with each component filled from a source component of the same family.
 * The real "before" is gone - no backup was taken, because the page sits
 * inside the backup folder - so this stands in for it, and what matters about
 * it is only that it is a full page of a different shape.
 */
function refill(node, donor) {
  const out = { 'jcr:primaryType': node['jcr:primaryType'] };
  for (const [k, v] of Object.entries(donor)) if (!isNode(v)) out[k] = v;
  for (const [k, v] of Object.entries(node)) {
    if (isNode(v)) out[k] = refill(v, isNode(donor[k]) ? donor[k] : donor);
  }
  return out;
}
const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);

const DEST_JSON = (() => {
  const page = structuredClone(STRIPPED);
  for (const [k, v] of Object.entries(SOURCE_JSON)) if (!isNode(v) && !(k in page)) page[k] = v;
  const grid = page.root?.responsivegrid || {};
  const donors = Object.values(SOURCE_JSON.root.responsivegrid).filter(isNode);
  let i = 0;
  for (const [name, node] of Object.entries(grid)) {
    if (!isNode(node)) continue;
    const family = name.split('_').slice(0, 3).join('_');
    const donor = donors.find((d) => String(d['sling:resourceType'] || '').includes(family.replace(/_/g, '-'))) || donors[i % donors.length];
    grid[name] = refill(node, donor);
    i++;
  }
  return page;
})();

const writes = [];

/**
 * Apply a Sling POST to the live destination, the way AEM would.
 *
 * Without this the fake took every write and changed nothing, which is
 * exactly the state `confirmWritten` exists to catch - so the ordinary path
 * failed its own check. Now a copy can be shown to have actually landed,
 * which is the one thing the browser tests can never say.
 *
 * Returns Sling's ChangeLog, as a list of what it touched.
 */
function applyTo(target, pairs) {
  const changes = [];
  const at = (rel) => {
    let node = target;
    for (const name of rel.split('/').filter(Boolean)) {
      if (!node[name] || typeof node[name] !== 'object' || Array.isArray(node[name])) {
        node[name] = { 'jcr:primaryType': 'nt:unstructured' };
        changes.push('created(');
      }
      node = node[name];
    }
    return node;
  };

  for (const [key, value] of pairs) {
    if (key === '_charset_') continue;
    const path = key.replace(/^\.\/?/, '');
    if (key.endsWith('@TypeHint')) continue;

    if (key.endsWith('@Delete')) {
      const target2 = path.slice(0, -'@Delete'.length);
      const rel = target2.slice(0, target2.lastIndexOf('/'));
      const name = target2.slice(target2.lastIndexOf('/') + 1);
      const node = name && target2.includes('/') ? at(rel) : target;
      if (name in node) {
        delete node[name];
        changes.push('deleted(');
      }
      continue;
    }

    const rel = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const prop = path.slice(path.lastIndexOf('/') + 1);
    const node = at(rel);
    /* A repeated name is a multi-value property, which is how Sling reads it. */
    if (seenThisRequest.has(key)) {
      node[prop] = [].concat(node[prop], value);
    } else {
      node[prop] = value;
      seenThisRequest.add(key);
    }
    changes.push('modified(');
  }
  seenThisRequest.clear();
  return changes;
}

const seenThisRequest = new Set();


/** Only what the worker actually calls. */
function fakeClient() {
  return {
    resetCaches() {},
    forgetProbe() {},
    assertReadable() {},
    async inspect(path) {
      return {
        exists: true,
        isPage: true,
        primaryType: 'cq:Page',
        title: path === SRC_PAGE ? 'Flip6 vs Flip5' : 'Flip3 vs Flip',
        template: '/conf/consumer/settings/wcm/templates/page-static-gnb'
      };
    },
    async probe(path) {
      if (path === SRC_PAGE || path === DEST_PAGE) return 'yes';
      if (path === parentOf(DEST_PAGE)) return 'yes';
      if (path.startsWith('/apps/') || path.startsWith('/libs/') || path.startsWith('/conf/')) return 'yes';
      if (path.startsWith('/content/dam/')) return 'yes';
      return 'no';
    },
    async readTree(path) {
      if (path === `${SRC_PAGE}/jcr:content`) return structuredClone(SOURCE_JSON);
      if (path === `${DEST_PAGE}/jcr:content`) return structuredClone(DEST_JSON);
      if (/\/content\/samsung\/[a-z]+\/jcr:content$/.test(path)) return { 'jcr:title': 'Samsung UK' };
      return null;
    },
    async readBytes() {
      return new Uint8Array([1, 2, 3]);
    },
    async assetSize() {
      return 1024;
    },
    async createAsset(folder, name) {
      writes.push({ kind: 'asset', folder, name });
      return { success: true, http: 200, effective: 200 };
    },
    async createFolder(path) {
      writes.push({ kind: 'folder', path });
      return { success: true, http: 200, effective: 200 };
    },
    async createPage(path) {
      writes.push({ kind: 'page', path });
      return { success: true, http: 200, effective: 200 };
    },
    async versionPage(path) {
      writes.push({ kind: 'version', path });
      return { success: true, http: 200, effective: 200 };
    },
    async orderNode(path, index) {
      writes.push({ kind: 'order', path, index });
      return { success: true, http: 200, effective: 200 };
    },
    async writeTree(root, pairs) {
      writes.push({ kind: 'write', root, pairs });
      const changes = applyTo(live, pairs);
      return { success: true, http: 200, effective: 200, changes };
    }
  };
}

const parentOf = (p) => p.slice(0, p.lastIndexOf('/'));

const settings = {
  rootDepth: 3,
  backupFolder: 'india/backup',
  upsertHosts: '',
  upsertKeepAtDest: 'hreflangGroup',
  upsertKeepNodes: '',
  upsertSharedSites: 'global',
  upsertCopyAssets: true,
  upsertOverwriteAssets: false,
  upsertReorder: true,
  upsertVersionFirst: false,
  upsertStripReplication: true,
  upsertRewriteShop: false,
  transferPreserve: '',
  transferCopyAssets: true,
  transferOverwriteAssets: false
};

const lines = [];
const report = (level, message) => lines.push(`${level}: ${message}`);

const { actions } = await import('../src/features/page-transfer/worker.js');

/* 1. the source, read on its own instance - exactly what the panel sends on */
const sourcePage = await actions.readPage({
  client: fakeClient(),
  settings,
  report,
  params: { source: SRC_PAGE }
});

console.log('source nodes read:', sourcePage.nodes);
console.log('source tree keys:', Object.keys(sourcePage.tree).length);

/* 2. the plan, with the params the screen builds */
const params = {
  source: SRC_PAGE,
  dest: DEST_PAGE,
  sourceOrigin: 'https://p6-eu-author.samsung.com',
  destOrigin: 'https://p6-ap-author.samsung.com',
  allowDeletes: true,
  keepSiteValues: false,
  backupFirst: true,
  sourcePage
};

const plan = await actions.analyze({ client: fakeClient(), settings, report, params });

console.log('\nmode:', plan.mode);
console.log('sections:', (plan.sections || []).map((x) => `${x.title} (${x.count})`).join(', ') || 'none');
console.log('counts:', JSON.stringify(plan.counts));
console.log('props added:', plan.props.added.length);
console.log('props updated:', plan.props.updated.length);
console.log('props deleted:', plan.props.deleted.length);
console.log('nodes added:', plan.nodes.added.length);
console.log('nodes deleted:', plan.nodes.deleted.length);
console.log('blockers:', plan.blockers);
console.log('largeRemoval:', plan.largeRemoval || 'none');
console.log('metadata props:', plan.metadata?.props || 'none');

const verdict =
  plan.props.added.length + plan.props.updated.length === 0 && plan.props.deleted.length > 0
    ? 'REPRODUCED: the plan removes properties and writes none'
    : 'the plan writes the source content';
console.log('\n' + verdict);

/* ------------------------------------------------------------- the write */

const { LOCALE_OWNED, removalsFingerprint } = await import('../src/core/protocol.js');
const { flatten } = await import('../src/core/execute.js');

/* The destination as it stands, which each section starts fresh: one
   section's copy really does change it, and the next must not inherit that. */
let live = structuredClone(DEST_JSON);
const freshDestination = () => {
  live = structuredClone(DEST_JSON);
};
const writeClient = () => {
  const c = fakeClient();
  c.readTree = async (path) => {
    if (path === `${SRC_PAGE}/jcr:content`) return structuredClone(SOURCE_JSON);
    if (path === `${DEST_PAGE}/jcr:content`) return structuredClone(live);
    if (/\/content\/samsung\/[a-z]+\/jcr:content$/.test(path)) return { 'jcr:title': 'Samsung UK' };
    return null;
  };
  return c;
};

const writeParams = {
  ...params,
  pageCreated: false,
  removalsAck: { fingerprint: removalsFingerprint(plan) },
  metadataAck: { props: plan.metadata?.props || [] }
};

const res = await actions.apply({ client: writeClient(), settings, report, params: writeParams });

const content = writes.filter((w) => w.kind === 'write');
console.log('\n--- what would be sent ---');
console.log('content requests:', content.length);
for (const w of content) console.log('  parameters:', w.pairs.length);
const all = content.flatMap((w) => w.pairs);
const deletes = all.filter(([k]) => k.endsWith('@Delete'));
const values = all.filter(([k]) => !k.endsWith('@Delete') && !k.endsWith('@TypeHint'));
console.log('deletes:', deletes.length, ' values written:', values.length);
console.log('sample values:', values.slice(0, 3).map(([k]) => k));
console.log('sample deletes:', deletes.slice(0, 3).map(([k]) => k));
console.log('reorder requests:', writes.filter((w) => w.kind === 'order').length);
console.log('done:', res.done);
if (!res.done || values.length < 100) {
  console.log('AN ORDINARY COPY NO LONGER WRITES THE SOURCE CONTENT');
  process.exitCode = 1;
}

/* Not what was sent - what is on the page afterwards. The fake applies the
   writes, so the destination can be read back and compared with the source,
   which is the one thing the browser tests can never say. */
const landed = (() => {
  const dest = {};
  const order = {};
  flatten(structuredClone(live), '', dest, order);
  const src = sourcePage.tree;

  let checked = 0;
  const wrong = [];
  for (const c of [...plan.props.added, ...plan.props.updated]) {
    const node = dest[c.node === '(page properties)' ? '' : c.node];
    if (!node) continue;
    checked++;
    if (node[c.prop] === undefined) wrong.push(`${c.node} ${c.prop}`);
  }
  /* And the copy itself: the headline of a component the source has. */
  const sampleRel = Object.keys(src).find((r) => src[r].headlineText);
  return { checked, wrong, sampleRel, sample: sampleRel ? src[sampleRel].headlineText : null };
})();

console.log(`properties on the page afterwards: ${landed.checked - landed.wrong.length} of ${landed.checked}`);
if (landed.wrong.length) {
  console.log('THE COPY DID NOT LAND:', landed.wrong.slice(0, 5).join(', '));
  process.exitCode = 1;
}

/* ---------------------------------------- the fault of 2026-11-01, guarded */

/**
 * A source tree whose nodes are there but hold nothing: the shape the
 * destination was left in. Whatever produced it on the day, a plan built
 * from it removes everything and writes nothing - and must not reach AEM.
 */
const EMPTY_SOURCE = JSON.parse(readFileSync(`${DATA}/dst.json`, 'utf8'));

freshDestination();

const strippedClient = () => {
  const c = fakeClient();
  c.readTree = async (path) => {
    if (path === `${SRC_PAGE}/jcr:content`) return structuredClone(EMPTY_SOURCE);
    if (path === `${DEST_PAGE}/jcr:content`) return structuredClone(live);
    if (/\/content\/samsung\/[a-z]+\/jcr:content$/.test(path)) return { 'jcr:title': 'Samsung UK' };
    return null;
  };
  return c;
};

let readRefused = null;
let hollow = null;
try {
  hollow = await actions.readPage({ client: strippedClient(), settings, report, params: { source: SRC_PAGE } });
} catch (e) {
  readRefused = e.message;
}

console.log('');
console.log('--- a source read as empty ---');
console.log('refused at the read:', readRefused ? 'yes' : 'NO - IT WAS ACCEPTED');
if (readRefused) console.log('  ' + readRefused);
if (!readRefused) process.exitCode = 1;

/* The same shape again, this time let past the read, to check the floor under
   the write itself holds on its own. */
const hollowTree = (() => {
  const tree = {};
  const order = {};
  flatten(structuredClone(EMPTY_SOURCE), '', tree, order);
  return { tree, order };
})();
hollow = {
  source: SRC_PAGE,
  srcDam: '/content/dam/samsung/uk',
  srcSite: 'uk',
  title: 'Flip',
  template: SOURCE_JSON['cq:template'],
  tree: hollowTree.tree,
  order: hollowTree.order,
  home: null,
  assets: [],
  nodes: Object.keys(hollowTree.tree).length,
  truncationRisk: false
};

const hollowParams = { ...params, sourcePage: hollow };
const hollowPlan = await actions.analyze({ client: strippedClient(), settings, report, params: hollowParams });

console.log('props added:', hollowPlan.props.added.length, ' updated:', hollowPlan.props.updated.length);
console.log('props deleted:', hollowPlan.props.deleted.length, 'on', new Set(hollowPlan.props.deleted.map((p) => p.node)).size, 'components');
console.log('nodes added:', hollowPlan.nodes.added.length, ' deleted:', hollowPlan.nodes.deleted.length);

const before = writes.filter((w) => w.kind === 'write').length;
let refused = null;
try {
  await actions.apply({
    client: strippedClient(),
    settings,
    report,
    params: {
      ...hollowParams,
      pageCreated: false,
      removalsAck: { fingerprint: removalsFingerprint(hollowPlan) },
      metadataAck: { props: hollowPlan.metadata?.props || [] }
    }
  });
} catch (e) {
  refused = e.message;
}

console.log('refused at the write:', refused ? 'yes' : 'NO - IT WOULD HAVE WRITTEN');
if (refused) console.log('  ' + refused);
console.log('content requests made:', writes.filter((w) => w.kind === 'write').length - before);
if (!refused) process.exitCode = 1;

/* --------------------------------- the page created by the run, as it was */

/**
 * What the day's run actually did: the destination did not exist, `prepare`
 * created it from the template, and `apply` wrote every component. The page
 * was left with its components standing and nothing in them, so this checks
 * what the engine puts in a node it creates.
 */
writes.length = 0;

/* The page `prepare` leaves behind: the template's own, nothing on it. */
let created = false;
const FRESH_PAGE = {
  'jcr:primaryType': 'cq:PageContent',
  'jcr:created': 'Sun Nov 01 2026 22:16:52 GMT+0900',
  'jcr:createdBy': 'tester',
  'jcr:title': SOURCE_JSON['jcr:title'],
  'cq:template': SOURCE_JSON['cq:template'],
  'sling:resourceType': SOURCE_JSON['sling:resourceType'],
  root: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': 'wcm/foundation/components/responsivegrid' }
};

const freshClient = () => {
  const c = fakeClient();
  c.probe = async (path) => {
    if (path === DEST_PAGE) return created ? 'yes' : 'no';
    if (path === parentOf(DEST_PAGE)) return 'yes';
    if (path === SRC_PAGE) return 'yes';
    if (/^\/(apps|libs|conf)\//.test(path) || path.startsWith('/content/dam/')) return 'yes';
    return 'no';
  };
  c.inspect = async (path) => ({
    exists: path !== DEST_PAGE || created,
    isPage: true,
    primaryType: 'cq:Page',
    title: SOURCE_JSON['jcr:title'],
    template: SOURCE_JSON['cq:template']
  });
  c.createPage = async () => {
    created = true;
    writes.push({ kind: 'page', path: DEST_PAGE });
    return { success: true, http: 200, effective: 200 };
  };
  c.writeTree = async (root, pairs) => {
    writes.push({ kind: 'write', root, pairs });
    return { success: true, http: 200, effective: 200, changes: applyTo(FRESH_PAGE, pairs) };
  };
  c.readTree = async (path) => {
    if (path === `${SRC_PAGE}/jcr:content`) return structuredClone(SOURCE_JSON);
    if (path === `${DEST_PAGE}/jcr:content`) return created ? structuredClone(FRESH_PAGE) : null;
    if (/\/content\/samsung\/[a-z]+\/jcr:content$/.test(path)) return { 'jcr:title': 'Samsung UK' };
    return null;
  };
  return c;
};

console.log('');
console.log('--- a destination created by the run, as on the day ---');
const freshPlan = await actions.analyze({ client: freshClient(), settings, report, params });
console.log('mode:', freshPlan.mode, ' nodes added:', freshPlan.nodes.added.length);

const prepared = await actions.prepare({ client: freshClient(), settings, report, params });
console.log('created:', prepared.created);

await actions.apply({
  client: freshClient(),
  settings,
  report,
  params: { ...params, pageCreated: true, removalsAck: { fingerprint: removalsFingerprint(freshPlan) } }
});

const req = writes.filter((w) => w.kind === 'write');
const sent = req.flatMap((w) => w.pairs);
const byNode = new Map();
for (const [k] of sent) {
  const node = k.slice(0, k.lastIndexOf('/'));
  byNode.set(node, (byNode.get(node) || 0) + 1);
}
/* A container node - disclaimerList, categoryList - really does hold only its
   primary type, so what matters is whether the components that hold the copy
   got it. */
const withCopy = [...byNode].filter(([, n]) => n > 2).length;
console.log('requests:', req.length, ' parameters:', sent.length);
console.log('components written:', byNode.size, ' of them with content:', withCopy);
if (withCopy < byNode.size * 0.5) {
  console.log('REPRODUCED: components would be created empty');
  process.exitCode = 1;
} else {
  console.log('the components that hold copy were written with it');
}

/* ------------------------------------------- how long a big upload is given */

const { uploadWait, LIMITS } = await import('../src/core/aem-client.js');
const MB = 1024 * 1024;

console.log('');
console.log('--- the wait between two bytes of an upload ---');
for (const size of [0.5, 5, 68, 400]) {
  console.log(`  ${size} MB -> ${Math.round(uploadWait(size * MB) / 1000)}s`);
}

/* The two images given up on at 60s on 2026-11-01 were about 68 MB each. */
const big = uploadWait(68 * MB);
if (big <= LIMITS.uploadStallMs) {
  console.log('A BIG UPLOAD IS GIVEN NO LONGER THAN A SMALL ONE');
  process.exitCode = 1;
}
if (uploadWait(10_000 * MB) > LIMITS.uploadStallMaxMs) {
  console.log('THE WAIT IS NOT CAPPED');
  process.exitCode = 1;
}
if (uploadWait(0) !== LIMITS.uploadStallMs) {
  console.log('THE FLOOR MOVED');
  process.exitCode = 1;
}
console.log('a big upload waits longer than a small one, and the wait is capped');

/* -------------------------------------------- which ending a site really uses */

const SV = await import('../src/core/site-values.js');

console.log('');
console.log('--- the title ending read off a home page ---');

const siteCase = (name, { srcHome, destHome, page, expect: want }) => {
  const out = SV.siteValues({
    page,
    src: { path: '/content/samsung/src', state: 'ok', props: srcHome },
    dest: { path: '/content/samsung/dest', state: 'ok', props: destHome }
  });
  const got = out.values.ogTitle ?? null;
  const ok = got === want;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) {
    console.log(`        wanted: ${JSON.stringify(want)}`);
    console.log(`        got:    ${JSON.stringify(got)}`);
    console.log(`        notes:  ${JSON.stringify(out.notes)}`);
    process.exitCode = 1;
  }
};

/* The run of 2026-11-01. Samsung's home pages are named first and described
   after, so "everything after its own name" reads the ending as the
   description - and every content page ends with the site's name instead. */
siteCase('a home page named first, described after', {
  srcHome: { 'jcr:title': 'Samsung UK', ogTitle: 'Samsung UK | Home Appliances | TV' },
  destHome: { 'jcr:title': 'Samsung Levant', ogTitle: 'Samsung Levant | Home Appliances | TV' },
  page: { ogTitle: 'Z Flip 3 vs Z Flip | Samsung UK' },
  expect: 'Z Flip 3 vs Z Flip | Samsung Levant'
});

/* And the other way round, which is what the first reading was written for. */
siteCase('a home page described first, named after', {
  srcHome: { 'jcr:title': 'Mobiles, TVs', ogTitle: 'Mobiles, TVs | Samsung Lebanon' },
  destHome: { 'jcr:title': 'Mobiles, TVs', ogTitle: 'Mobiles, TVs | Samsung Jordan' },
  page: { ogTitle: 'Air Conditioners | Samsung Lebanon' },
  expect: 'Air Conditioners | Samsung Jordan'
});

/* The run of 2026-11-02: the uk home page is titled "Samsung" and shares as
   "Samsung UK | Home Appliances | TV", so neither "after its own name" nor
   "its own name" reaches " | Samsung UK" - the site's name is the FIRST
   segment of its share title and belongs at the end. */
siteCase('a home page whose first segment is the site name', {
  srcHome: { 'jcr:title': 'Samsung', ogTitle: 'Samsung UK | Home Appliances | TV' },
  destHome: { 'jcr:title': 'Samsung', ogTitle: 'Samsung Levant | Home Appliances | TV' },
  page: { ogTitle: 'Z Flip 3 vs Z Flip | Samsung UK' },
  expect: 'Z Flip 3 vs Z Flip | Samsung Levant'
});

/* A page that ends in none of the readings is left exactly as it is. */
siteCase('a page ending some other way is left alone', {
  srcHome: { 'jcr:title': 'Samsung UK', ogTitle: 'Samsung UK | Home Appliances | TV' },
  destHome: { 'jcr:title': 'Samsung Levant', ogTitle: 'Samsung Levant | Home Appliances | TV' },
  page: { ogTitle: 'Z Flip 3 vs Z Flip — Samsung Global' },
  expect: null
});

/* A home page with no share title of its own still names the site. */
siteCase('a home page with only its own title', {
  srcHome: { 'jcr:title': 'Samsung UK' },
  destHome: { 'jcr:title': 'Samsung Levant' },
  page: { ogTitle: 'Z Flip 3 vs Z Flip | Samsung UK' },
  expect: 'Z Flip 3 vs Z Flip | Samsung Levant'
});

/* When nothing matches, the note says so in terms of the page rather than
   quoting a reading nobody meant. */
{
  const out = SV.siteValues({
    page: { ogTitle: 'Z Flip 3 vs Z Flip — Samsung Global' },
    src: { path: '/content/samsung/uk', state: 'ok', props: { 'jcr:title': 'Samsung', ogTitle: 'Samsung UK | Phones' } },
    dest: { path: '/content/samsung/levant', state: 'ok', props: { 'jcr:title': 'Samsung', ogTitle: 'Samsung Levant | TV' } }
  });
  const said = out.notes.join(' ');
  if (!/does not end any way .* names/.test(said) || !/readings tried were/.test(said)) {
    console.log(`  FAIL the note does not say which readings were tried: ${said}`);
    process.exitCode = 1;
  } else {
    console.log('  ok   a page matching no reading is told which were tried');
  }
}

/* One segment means one segment: a bar is not whitespace. */
const last = SV.titleEndings({ ogTitle: 'Samsung UK | Home Appliances | TV' }).find((c) => c.rule === 'last-segment');
if (last?.ending.trim() !== '| TV') {
  console.log(`  FAIL the last segment of a two-bar title is ${JSON.stringify(last?.ending)}, not " | TV"`);
  process.exitCode = 1;
} else {
  console.log('  ok   the last segment of a two-bar title is one segment');
}

/* --------------------------------------- the biggest image a transfer carries */

console.log('');
console.log('--- the image size limit ---');

/* Two images, one either side of the limit, both really on the source DAM. */
const SIZES = {
  '/content/dam/samsung/uk/a/small.png': 4 * MB,
  '/content/dam/samsung/uk/a/video_desktop.png': 68 * MB
};

const sizedClient = () => {
  const c = fakeClient();
  c.readTree = async (path) => {
    if (path !== `${SRC_PAGE}/jcr:content`) return null;
    return {
      ...structuredClone(SOURCE_JSON),
      root: {
        'jcr:primaryType': 'nt:unstructured',
        responsivegrid: {
          'jcr:primaryType': 'nt:unstructured',
          hero: {
            'jcr:primaryType': 'nt:unstructured',
            'sling:resourceType': 'samsung/components/content/consumer/global/common/cm-g-text-block',
            headlineText: 'A headline',
            imageA: '/content/dam/samsung/uk/a/small.png',
            imageB: '/content/dam/samsung/uk/a/video_desktop.png'
          }
        }
      }
    };
  };
  c.probe = async (path) => {
    if (path === SRC_PAGE) return 'yes';
    if (path === DEST_PAGE) return 'no';
    if (path === parentOf(DEST_PAGE)) return 'yes';
    if (path in SIZES) return 'yes';
    if (/^\/(apps|libs|conf)\//.test(path)) return 'yes';
    return 'no';
  };
  c.assetSize = async (path) => SIZES[path] ?? null;
  return c;
};

for (const [limit, carried, byHand] of [[25, 1, 1], [100, 2, 0]]) {
  const withLimit = { ...settings, transferMaxImageMb: limit };
  const page = await actions.readPage({ client: sizedClient(), settings: withLimit, report, params: { source: SRC_PAGE } });
  const plan = await actions.analyze({
    client: sizedClient(),
    settings: withLimit,
    report,
    params: { ...params, sourcePage: page }
  });

  const over = (plan.imagesByHand || []).filter((b) => /over the .* this transfer carries/.test(b.reason || ''));
  const ok = plan.uploads.length === carried && over.length === byHand;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} a ${limit} MB limit carries ${plan.uploads.length} and leaves ${over.length} by hand` +
      (ok ? '' : ` (wanted ${carried} and ${byHand})`)
  );
  if (!ok) process.exitCode = 1;
  if (limit === 25 && over[0] && !/25 MB/.test(over[0].reason)) {
    console.log(`  FAIL the reason does not name the limit: ${over[0].reason}`);
    process.exitCode = 1;
  }
  /* Skipped, never a blocker: the page still goes across. */
  if (plan.blockers.length) {
    console.log(`  FAIL an image over the limit stopped the run: ${plan.blockers[0]}`);
    process.exitCode = 1;
  }
}
console.log('  ok   an image over the limit is skipped, named, and never stops the page');


/* ------------------------------------ the page-properties box, both ways */

console.log('');
console.log('--- an existing destination and its own page properties ---');

/* What a locale maintains itself, and what the box is about: the destination
   has its own and the source has different ones. */
const DEST_OWN = {
  canonical: 'https://www.samsung.com/levant/mobile/flip/',
  redirectTarget: '/levant/mobile/newer-flip/',
  localContent: 'true',
  publishedDateByWorkflow: 'Wed Nov 18 2020 05:17:56 GMT+0900',
  titleOption: 'B'
};

const metaCase = async (name, { ack }) => {
  freshDestination();
  Object.assign(live, DEST_OWN);
  const client = () => {
    const c = fakeClient();
    c.readTree = async (path) => {
      if (path === `${SRC_PAGE}/jcr:content`) return structuredClone(SOURCE_JSON);
      if (path === `${DEST_PAGE}/jcr:content`) return structuredClone(live);
      if (/\/content\/samsung\/[a-z]+\/jcr:content$/.test(path)) return { 'jcr:title': 'Samsung UK' };
      return null;
    };
    c.writeTree = async (root, pairs) => ({
      success: true, http: 200, effective: 200, changes: applyTo(live, pairs)
    });
    return c;
  };

  const page = await actions.readPage({ client: client(), settings, report, params: { source: SRC_PAGE } });
  const base = { ...params, sourcePage: page };
  const plan = await actions.analyze({ client: client(), settings, report, params: base });

  const runParams = {
    ...base,
    pageCreated: false,
    removalsAck: { fingerprint: removalsFingerprint(plan) },
    ...(ack ? { metadataAck: { props: plan.metadata?.props || [] } } : {})
  };

  /* What the destination has now, so it can be compared with what it keeps. */
  const before = structuredClone(live);
  const watched = Object.keys(DEST_OWN).filter((prop) => before[prop] !== undefined);
  if (!watched.length) {
    console.log(`  FAIL ${name}: the destination has none of its own, so this proves nothing`);
    process.exitCode = 1;
    return;
  }

  let failed = null;
  try {
    await actions.apply({ client: client(), settings, report, params: runParams });
  } catch (e) {
    failed = e.message;
  }

  if (failed) {
    console.log(`  FAIL ${name}: the run was refused - ${failed}`);
    process.exitCode = 1;
    return;
  }

  const kept = watched.filter((prop) => live[prop] === before[prop]).length;
  const copied = Object.keys(live.root?.responsivegrid || {}).filter(
    (k) => live.root.responsivegrid[k] && typeof live.root.responsivegrid[k] === 'object'
  ).length;

  /* Ticked, only what the box offers is overwritten - the always-kept ones
     (titleOption and the rest of the metadata that cannot be derived) stay
     either way. */
  const offered = new Set(plan.metadata?.props || []);
  const wantKept = ack ? watched.filter((prop) => !offered.has(prop)).length : watched.length;
  /* Never offered, so never overwritten by ticking: a locale's own publish
     date and its localContent flag are not the source page's to give. */
  const offeredLocale = LOCALE_OWNED.filter((prop) => offered.has(prop));
  const heldLocale = LOCALE_OWNED.filter((prop) => live[prop] === DEST_OWN[prop]);
  const ok =
    kept === wantKept &&
    copied > 10 &&
    !offeredLocale.length &&
    heldLocale.length === LOCALE_OWNED.filter((prop) => prop in DEST_OWN).length;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${name}: ${kept} of ${watched.length} kept ` +
      `(${offered.size} offered by the box), ${copied} components on the page` +
      `, ${heldLocale.length} locale-owned held` +
      (ok ? '' : ` - wanted ${wantKept} kept, ${offeredLocale.length} locale-owned offered`)
  );
  if (!ok) process.exitCode = 1;
};

await metaCase('unticked keeps them, and still copies the page', { ack: false });
await metaCase('ticked overwrites them', { ack: true });

/* Backup and Versions live in their own file, so their fake AEM - the version
   store, the backup folder - does not crowd the transfer one above. */
await import('./engine-test-backup-versions.mjs');

/* The Relative Link Fixer, the content script's origin check, team defaults
   and the manifest - their own file, for the same reason. */
await import('./link-fixer-test.mjs');
await import('./broken-links-test.mjs');
await import('./site-code-fixer-test.mjs');

/* Copy a page's refusals, read-back and page-properties box, on a small
   in-memory AEM of its own - the shapes that once got past them. */
await import('./engine-test-copy-page.mjs');
await import('./engine-test-copy-component.mjs');
await import('./engine-test-home-backup.mjs');

/* Copy deck, export and import: the sheet read back every way it comes back,
   planned, and written by the real import worker to an in-memory AEM. */
await import('./engine-test-copy-deck.mjs');
