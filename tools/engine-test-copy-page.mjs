/**
 * Copy a page, both features, against a small in-memory AEM: the refusals,
 * the read-back and the page-properties box, each on the shape that once got
 * past them. Imported by engine-test.mjs; runs on its own too.
 *
 *   node tools/engine-test-copy-page.mjs
 */

const W = await import('../src/features/page-transfer/worker.js');
const U = await import('../src/features/page-upsert/worker.js');
const P = await import('../src/core/protocol.js');
const D = await import('../src/core/diff.js');
const SV = await import('../src/core/site-values.js');

const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * A Sling POST applied the way AEM would - or, for the faults these tests are
 * about, not quite: 'nothing' (an empty ChangeLog), 'dropNodeProps' (nodes
 * created, none of their properties kept - 1 November), 'partial' (one value
 * in ten kept).
 */
function applyTo(target, pairs, mode = 'normal') {
  const changes = [];
  if (mode === 'nothing') return changes;
  const seen = new Set();
  const created = new Set();
  const at = (rel) => {
    let node = target;
    let path = '';
    for (const name of rel.split('/').filter(Boolean)) {
      path += `/${name}`;
      if (!isNode(node[name])) {
        node[name] = { 'jcr:primaryType': 'nt:unstructured' };
        created.add(path);
        changes.push('created(');
      }
      node = node[name];
    }
    return { node, path };
  };
  let vals = 0;
  for (const [key, value] of pairs) {
    if (key === '_charset_' || key.endsWith('@TypeHint')) continue;
    const path = key.replace(/^\.\/?/, '');
    if (key.endsWith('@Delete')) {
      const t = path.slice(0, -'@Delete'.length);
      const { node } = at(t.includes('/') ? t.slice(0, t.lastIndexOf('/')) : '');
      const name = t.slice(t.lastIndexOf('/') + 1);
      if (name in node) {
        delete node[name];
        changes.push('deleted(');
      }
      continue;
    }
    const { node, path: np } = at(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
    const prop = path.slice(path.lastIndexOf('/') + 1);
    if (mode === 'dropNodeProps' && created.has(np) && prop !== 'jcr:primaryType') continue;
    if (mode === 'partial' && ++vals % 10 !== 0) continue;
    // Sling removes a property posted empty.
    if (value === '' && !seen.has(key)) {
      delete node[prop];
      continue;
    }
    node[prop] = seen.has(key) ? [].concat(node[prop], value) : value;
    seen.add(key);
    changes.push('modified(');
  }
  return changes;
}

/** repo: { pages: { [path]: jcr:content }, folders: [], templateContent } */
function client(repo, { writeMode = 'normal', log = [] } = {}) {
  const exists = (p) => p in repo.pages || Object.keys(repo.pages).some((k) => k.startsWith(`${p}/`)) || (repo.folders || []).includes(p);
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
  return {
    log,
    resetCaches() {},
    forgetProbe() {},
    assertReadable() {},
    async inspect(path) {
      if (repo.inspectThrows) throw new Error(repo.inspectThrows);
      const c = repo.pages[path];
      return c
        ? { path, exists: true, isPage: true, primaryType: 'cq:Page', title: c['jcr:title'], template: c['cq:template'], childPages: [] }
        : { path, exists: exists(path), isPage: false, primaryType: 'sling:Folder', childPages: [] };
    },
    async probe(path) {
      if (/^\/(apps|libs|conf)\//.test(path)) return 'yes';
      if (contentAt(path)) return 'yes';
      return exists(path) ? 'yes' : 'no';
    },
    async readTree(path) {
      const n = contentAt(path);
      return n ? structuredClone(n) : null;
    },
    async readTreeWhole(path) {
      return this.readTree(path);
    },
    async readJson(path) {
      const n = contentAt(path);
      return n ? { status: 200, json: structuredClone(n) } : { status: 404, json: null };
    },
    async readProps(path) {
      const n = contentAt(path);
      return n ? Object.fromEntries(Object.entries(n).filter(([, v]) => !isNode(v))) : null;
    },
    async assetSize() {
      return null;
    },
    async createFolder(path) {
      (repo.folders ||= []).push(path);
      return { success: true, http: 200, effective: 200 };
    },
    async createPage({ parentPath, label, title, template }) {
      log.push({ kind: 'page', path: `${parentPath}/${label}` });
      repo.pages[`${parentPath}/${label}`] = {
        'jcr:primaryType': 'cq:PageContent', 'jcr:title': title, 'cq:template': template,
        ...structuredClone(repo.templateContent || {})
      };
      return { success: true, http: 200, effective: 200 };
    },
    async copyPage({ srcPath, destPath }) {
      log.push({ kind: 'copy', from: srcPath, to: destPath });
      repo.pages[destPath] = structuredClone(repo.pages[srcPath]);
      return { success: true, http: 200, effective: 200, resultPath: destPath };
    },
    async versionPage(o) {
      log.push({ kind: 'version', path: o.path });
      return { success: true, http: 200, effective: 200 };
    },
    async orderNode() {
      return { success: true, http: 200, effective: 200 };
    },
    async writeTree(root, pairs) {
      log.push({ kind: 'write', root, pairs });
      const page = root.replace(/\/jcr:content$/, '');
      return { success: true, http: 200, effective: 200, changes: applyTo(repo.pages[page], pairs, writeMode) };
    },
    async writeNode(path, pairs) {
      return this.writeTree(path, pairs);
    }
  };
}

const SETTINGS = {
  rootDepth: 3, backupFolder: 'india/backup', upsertHosts: '', upsertKeepAtDest: 'hreflangGroup', upsertKeepNodes: '',
  upsertSharedSites: 'global', upsertCopyAssets: true, upsertOverwriteAssets: false, upsertReorder: true,
  upsertVersionFirst: false, upsertStripReplication: true, upsertRewriteShop: false, transferPreserve: '',
  transferCopyAssets: true, transferOverwriteAssets: false
};

const S = '/content/samsung/uk/p/a';
const T = '/content/samsung/levant/p/a';
const RT = 'samsung/components/text';
const comp = (props = {}) => ({ 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': RT, ...props });
const page = (grid, props = {}) => ({
  'jcr:primaryType': 'cq:PageContent', 'cq:template': '/conf/t/page', 'sling:resourceType': 'site/page', 'jcr:title': 'T', ...props,
  root: {
    'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': 'wcm/foundation/components/responsivegrid',
    responsivegrid: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': 'wcm/foundation/components/responsivegrid', ...grid }
  }
});
const full = (n, tag = '') =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`text_${i}`, comp({ headline: `Head ${i}${tag}`, body: `Body ${i}${tag}` })]));
const withContent = (p) => Object.values(p.root.responsivegrid).filter((v) => isNode(v) && Object.keys(v).length > 2).length;

/**
 * The panel's flow (ui/transfer.js) over two in-memory instances. `ack`:
 * 'removals' sends the review's fingerprint; `metadata` ticks the
 * page-properties box with the names the review showed.
 */
async function transfer({ src, dst, ack = null, metadata = false, writeMode, between, lines = [] }) {
  const report = (level, message) => level !== 'data' && lines.push(`${level}: ${message}`);
  const base = { source: S, dest: T, sourceOrigin: 'https://src', destOrigin: 'https://dst', allowDeletes: true, backupFirst: false };
  const sp = await W.actions.readPage({ client: client(src), settings: SETTINGS, report, params: base });
  const review = await W.actions.analyze({ client: client(dst), settings: SETTINGS, report, params: { ...base, sourcePage: sp } });
  if (between) await between();

  const p = { ...base };
  if (ack === 'removals') p.removalsAck = { fingerprint: review.removalsFingerprint };
  if (metadata && review.metadata?.props?.length) p.metadataAck = { props: [...review.metadata.props] };

  const dc = client(dst, { writeMode });
  const plan = await W.actions.analyze({ client: dc, settings: SETTINGS, report: () => {}, params: { ...p, sourcePage: sp } });
  if (plan.largeRemoval && !P.removalsConfirmed(plan, p)) throw new Error(`refused: ${plan.largeRemoval}`);
  if (p.metadataAck && !P.metadataConfirmed(plan, p)) throw new Error(`refused: ${P.metadataRefusal(plan)}`);
  const prepared = await W.actions.prepare({ client: dc, settings: SETTINGS, report, params: { ...p, sourcePage: sp, folders: plan.folders } });
  const result = await W.actions.apply({
    client: dc, settings: SETTINGS, report, params: { ...p, sourcePage: sp, pageCreated: prepared.created }
  });
  return { review, result, lines };
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
console.log('--- Copy a page: removals, read-back and the page-properties box ---');

await check('a near-hollow source with one changed value is held for the removals box', async () => {
  const src = { pages: { [S]: page({ ...Object.fromEntries(Object.keys(full(20)).map((k) => [k, comp()])), text_0: comp({ headline: 'changed' }) }) } };
  const dst = { pages: { [T]: page(full(20)) } };
  const why = await refusal(() => transfer({ src, dst }));
  if (!why || !/standing with nothing in them/.test(why)) return `not held: ${why}`;
  return withContent(dst.pages[T]) === 20 ? null : 'the page was changed anyway';
});

await check('the strip guard under the write refuses 3+ emptied components unless confirmed', async () => {
  const { assertNotStripping } = await import('../src/core/execute.js');
  const d = {
    propAdds: [{ rel: '/x', prop: 'a', to: '1' }], propUpdates: [], nodeAdds: [],
    removal: { emptied: ['/r/a', '/r/b', '/r/c'] }
  };
  const dels = ['/r/a', '/r/b', '/r/c'].map((rel) => ({ rel, prop: 'headline' }));
  const unconfirmed = await refusal(async () => assertNotStripping(d, dels, T));
  const confirmed = await refusal(async () => assertNotStripping(d, dels, T, { acked: true }));
  return unconfirmed && !confirmed ? null : `unconfirmed: ${unconfirmed}, confirmed: ${confirmed}`;
});

await check('an empty source grid over a five-component page is held', async () => {
  const dst = { pages: { [T]: page(full(5)) } };
  const why = await refusal(() => transfer({ src: { pages: { [S]: page({}) } }, dst }));
  return why && /every component on the page/.test(why) ? null : `not held: ${why}`;
});

await check('14 of 60 components removed is held, and goes once confirmed', async () => {
  const f = full(60);
  const src = { pages: { [S]: page(Object.fromEntries(Object.entries(f).slice(0, 46))) } };
  const dst = { pages: { [T]: page(f) } };
  if (!(await refusal(() => transfer({ src, dst })))) return 'not held';
  const r = await transfer({ src, dst, ack: 'removals' });
  return r.result.done && Object.keys(dst.pages[T].root.responsivegrid).filter((k) => isNode(dst.pages[T].root.responsivegrid[k])).length === 46
    ? null
    : 'the confirmed run did not remove them';
});

await check('a colleague editing a component between review and run is refused', async () => {
  const f = full(8);
  const src = { pages: { [S]: page({ text_0: f.text_0, text_1: f.text_1 }) } };
  const dst = { pages: { [T]: page(f) } };
  const why = await refusal(() =>
    transfer({ src, dst, ack: 'removals', between: () => { dst.pages[T].root.responsivegrid.text_5.headline = 'launch copy'; } })
  );
  return why && dst.pages[T].root.responsivegrid.text_5 ? null : 'the run went ahead';
});

await check('components created with none of their properties (1 November) are not "done" as a match', async () => {
  const dst = { pages: { '/content/samsung/levant/p': {} } };
  const lines = [];
  const r = await transfer({ src: { pages: { [S]: page(full(10)) } }, dst, writeMode: 'dropNodeProps', lines });
  if (!r.result.unconfirmed) return 'no warning on the result';
  return lines.some((l) => /^ok: Done\./.test(l)) ? 'the log still says Done.' : null;
});

await check('a partial read-back is a warning naming what did not hold', async () => {
  const dst = { pages: { [T]: page(full(10)) } };
  const r = await transfer({ src: { pages: { [S]: page(full(10, ' new')) } }, dst, writeMode: 'partial' });
  const u = r.result.unconfirmed;
  return u && u.holding === 2 && u.checked === 20 && u.missing.length ? null : `got ${JSON.stringify(u)}`;
});

await check('a removal-only write AEM acts on none of is not done', async () => {
  const dst = { pages: { [T]: page(full(4)) } };
  const why = await refusal(() =>
    transfer({ src: { pages: { [S]: page({ text_0: comp({ headline: 'Head 0', body: 'Body 0' }) }) } }, dst, ack: 'removals', writeMode: 'nothing' })
  );
  return why && /not one of the .* changes checked/.test(why) ? null : `not refused: ${why}`;
});

await check('the locale-owned properties are never carried across, onto a new page or an existing one', async () => {
  const own = { localContent: 'true', publishedDateByWorkflow: 'Wed Nov 18 2020' };
  const grid = { t1: comp({ headline: 'A' }) };
  const created = { pages: { '/content/samsung/levant/p': {} } };
  await transfer({ src: { pages: { [S]: page(grid, own) } }, dst: created });
  const existing = { pages: { [T]: page(grid) } };
  await transfer({ src: { pages: { [S]: page(grid, own) } }, dst: existing });
  const leaked = [created.pages[T], existing.pages[T]].flatMap((p) => P.LOCALE_OWNED.filter((k) => k in p));
  return leaked.length ? `carried: ${leaked.join(', ')}` : null;
});

await check('a same-server create takes the source locale\'s own properties off the copy', async () => {
  const repo = { pages: { [S]: page({ t1: comp({ headline: 'A' }) }, { localContent: 'true', publishedDateByWorkflow: 'x' }), '/content/samsung/levant/p': {} } };
  const params = { source: S, dest: '/content/samsung/levant/p/a', allowDeletes: true, backupFirst: false };
  await U.actions.run({ client: client(repo), settings: SETTINGS, report: () => {}, params });
  const left = P.LOCALE_OWNED.filter((k) => k in repo.pages['/content/samsung/levant/p/a']);
  return left.length ? `still there: ${left.join(', ')}` : null;
});

await check('ticking the page-properties box on a page with a property the source lacks goes through', async () => {
  const grid = { t1: comp({ headline: 'A' }), t2: comp({ headline: 'B' }) };
  const dst = { pages: { [T]: page(grid, { canonical: 'https://x/levant/a', redirectTarget: '/levant/other' }) } };
  const r = await transfer({ src: { pages: { [S]: page(grid, { canonical: 'https://x/uk/b' }) } }, dst, metadata: true });
  if (!r.review.metadata.props.includes('redirectTarget')) return 'the review did not list the removal the box makes';
  return dst.pages[T].redirectTarget === undefined ? null : 'redirectTarget was not cleared';
});

await check('both boxes ticked agree with the review', async () => {
  const grid = { t1: comp({ headline: 'A' }) };
  const dst = { pages: { [T]: page({ ...grid, ...full(4) }, { redirectTarget: '/levant/other' }) } };
  const r = await transfer({ src: { pages: { [S]: page(grid) } }, dst, ack: 'removals', metadata: true });
  return r.result.done ? null : 'not done';
});

await check('a page created from a template with its own nodes is filled, and the nodes named', async () => {
  const tpl = { root: { 'jcr:primaryType': 'nt:unstructured', ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`tpl_${i}`, comp({ fragmentPath: `/xf/${i}` })])) } };
  const dst = { pages: { '/content/samsung/levant/p': {} }, templateContent: tpl };
  const lines = [];
  const r = await transfer({ src: { pages: { [S]: page({ t: comp({ headline: 'h' }) }) } }, dst, lines });
  if (!r.result.done) return 'not done';
  if (dst.pages[T].root.responsivegrid?.t?.headline !== 'h') return 'the content is not on the page';
  return lines.some((l) => /template put 7 nodes/.test(l) && /tpl_0/.test(l)) ? null : 'the template nodes were not named';
});

await check('a removal names its old value, not "(not set)"', async () => {
  const m = D.metadataFor('sync', { propAdds: [], propUpdates: [], propDeletes: [{ rel: '', prop: 'redirectTarget', was: '/levant/x' }], preserved: [] });
  return m.rows[0].now === '/levant/x' && m.rows[0].would === undefined ? null : JSON.stringify(m.rows[0]);
});

await check('a source value of "" is not planned again once Sling has dropped it', async () => {
  const dst = { pages: { [T]: page({ t1: comp({ headline: 'A' }) }) } };
  const src = { pages: { [S]: page({ t1: comp({ headline: 'A', subline: '' }) }) } };
  const r = await transfer({ src, dst });
  return r.review.counts.properties === 0 ? null : `planned ${r.review.counts.properties} properties`;
});

/* Two empty components and their grid are three nodes, under the four the
   check asks for - '/root' counted as a fourth when it was matched as 'root'. */
await check('the root container is not counted as a hollow component', async () => {
  const src = { pages: { [S]: page({ a: comp(), b: comp() }) } };
  const why = await refusal(() => W.actions.readPage({ client: client(src), settings: SETTINGS, report: () => {}, params: { source: S } }));
  return why ? `refused: ${why}` : null;
});

await check('a backup that cannot be checked does not fail the analysis', async () => {
  const b = await U.backupOrWhy(client({ pages: {}, inspectThrows: 'Unexpected HTTP 500' }), SETTINGS, T);
  return b.state === 'unavailable' && /HTTP 500/.test(b.reason) ? null : JSON.stringify(b);
});

await check('updating a backup that differs saves a version of it first', async () => {
  const backup = '/content/samsung/levant/india/backup/p/a';
  const log = [];
  const lines = [];
  const repo = { pages: { [T]: page(full(2, ' new')), [backup]: page(full(2)) } };
  await U.backupFirst(client(repo, { log }), SETTINGS, (l, m) => l !== 'data' && lines.push(m), T, { backupFirst: true });
  const v = log.findIndex((x) => x.kind === 'version' && x.path === backup);
  const w = log.findIndex((x) => x.kind === 'write');
  if (v < 0) return 'no version of the backup';
  if (w >= 0 && w < v) return 'the backup was written before it was versioned';
  return lines.some((m) => /version of the backup/.test(m)) ? null : 'the log does not say so';
});

/* The strip guard under every write wants the removals confirmed. A backup
   update has no review to confirm on, so it leans on the version just saved;
   the Backup tool's own review passes its box on. Without either, every
   backup that would empty three components was refused under the write. */
await check('a backup update that empties components goes once the backup is versioned', async () => {
  const backup = '/content/samsung/levant/india/backup/p/a';
  const log = [];
  const hollow = { ...Object.fromEntries(Object.keys(full(5)).map((k) => [k, comp()])), text_0: comp({ headline: 'kept' }) };
  const repo = { pages: { [T]: page(hollow), [backup]: page(full(5)) } };
  const why = await refusal(() => U.backupFirst(client(repo, { log }), SETTINGS, () => {}, T, { backupFirst: true }));
  if (why) return `refused: ${why}`;
  if (!log.some((x) => x.kind === 'version' && x.path === backup)) return 'no version taken';
  return withContent(repo.pages[backup]) === 1 ? null : 'the backup was not updated';
});

await check('the Backup tool writes a confirmed large removal, and holds an unconfirmed one', async () => {
  const C = await import('../src/features/page-copy/worker.js');
  const backup = '/content/samsung/levant/india/backup/p/a';
  const hollow = { ...Object.fromEntries(Object.keys(full(5)).map((k) => [k, comp()])), text_0: comp({ headline: 'kept' }) };
  const fresh = () => ({ pages: { [T]: page(hollow), [backup]: page(full(5)) } });
  const params = { source: T };

  const held = fresh();
  const no = await refusal(() => C.actions.run({ client: client(held), settings: SETTINGS, report: () => {}, params }));
  if (!no) return 'an unconfirmed removal was written';

  const repo = fresh();
  const s = await C.actions.analyze({ client: client(repo), settings: SETTINGS, report: () => {}, params });
  if (!s.sync?.largeRemoval) return 'the review did not hold the removal';
  const ack = { fingerprint: s.sync.removalsFingerprint };
  const why = await refusal(() => C.actions.run({ client: client(repo), settings: SETTINGS, report: () => {}, params: { ...params, removalsAck: ack } }));
  if (why) return `refused once confirmed: ${why}`;
  return withContent(repo.pages[backup]) === 1 ? null : 'the backup was not updated';
});

await check('a signed-out session is said as that, not as "it exists" or a truncated page', async () => {
  const { AemClient } = await import('../src/core/aem-client.js');
  const LOGIN = '<html><head><title>AEM Sign In</title></head><body><input name="j_username"></body></html>';
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    ok: true, status: 200, redirected: true, url: 'https://x/libs/granite/core/content/login.html',
    text: async () => LOGIN, headers: { get: () => 'text/html' }
  });
  try {
    const c = new AemClient();
    const probe = await refusal(() => c.probe('/content/samsung/levant/new-page'));
    const tree = await refusal(() => c.readTree('/content/samsung/levant/new-page/jcr:content'));
    return /session .* has ended/.test(probe || '') && /session .* has ended/.test(tree || '') ? null : `probe: ${probe}; tree: ${tree}`;
  } finally {
    globalThis.fetch = real;
  }
});

/* Title endings that once went wrong. */
const ending = (srcHome, destHome, ogTitle) =>
  SV.siteValues({
    page: { ogTitle },
    src: { path: '/content/samsung/uk', state: 'ok', props: srcHome },
    dest: { path: '/content/samsung/jo', state: 'ok', props: destHome }
  }).values.ogTitle ?? null;

await check('a destination home titled for its products still ends with the site\'s name', async () => {
  const got = ending(
    { 'jcr:title': 'Samsung', ogTitle: 'Samsung UK | Home Appliances | TV' },
    { 'jcr:title': 'Mobiles, TVs', ogTitle: 'Mobiles, TVs | Samsung Jordan' },
    'Z Flip | Samsung UK'
  );
  return got === 'Z Flip | Samsung Jordan' ? null : `got ${JSON.stringify(got)}`;
});

await check('a page genuinely ending " | TV" is left as it is', async () => {
  const got = ending(
    { 'jcr:title': 'Samsung UK', ogTitle: 'Samsung UK | Mobile | TV' },
    { 'jcr:title': 'Samsung Levant', ogTitle: 'Samsung Levant | Mobile | Home' },
    'Best 8K | TV'
  );
  return got === null ? null : `got ${JSON.stringify(got)}`;
});

console.log(failed ? `  ${failed} failed` : '  all passed');
