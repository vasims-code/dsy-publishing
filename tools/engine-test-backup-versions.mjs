/**
 * Backup and Versions, run for real against a fake AEM - the half of their
 * checks the browser suite cannot make, because there every worker is stubbed.
 *
 * Imported at the end of engine-test.mjs, so `node tools/engine-test.mjs`
 * runs it; it also runs on its own:
 *
 *   node tools/engine-test-backup-versions.mjs
 *
 * Reads go through the real AemClient._encPath and then the URL parser, the
 * way fetch() would send them - so a path that is checked as one page and
 * fetched as another shows up here as exactly that.
 */

import { AemClient } from '../src/core/aem-client.js';
import * as P from '../src/core/paths.js';
import * as COPY from '../src/features/page-copy/worker.js';
import * as VERS from '../src/features/page-versions/worker.js';

console.log('\nBackup and Versions');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` - ${detail}`}`);
  if (!ok) {
    failures++;
    process.exitCode = 1;
  }
}
const throws = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
};
async function rejects(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

/* ------------------------------------------------------------ the fake */

/** Where fetch() would actually go for a repository path. */
const fetched = (p) => decodeURI(new URL(AemClient.prototype._encPath(p), 'https://author.example').pathname);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function repoOf(root) {
  const get = (p) => {
    let n = root;
    for (const s of p.split('/').filter(Boolean)) {
      if (!isObj(n)) return undefined;
      n = n[s];
    }
    return n;
  };
  const cut = (n, d) => {
    const o = {};
    for (const [k, v] of Object.entries(n)) {
      if (isObj(v)) {
        if (d > 0) o[k] = cut(v, d - 1);
      } else o[k] = v;
    }
    return o;
  };
  return { root, get, cut };
}

/** Only the client calls these two workers make. Writes are logged, never applied unless asked. */
function clientOf(repo, opts = {}) {
  const log = [];
  const c = {
    log,
    resetCaches() {},
    forgetProbe() {},
    assertReadable(info, what) {
      if (info.forbidden) {
        const e = new Error(`Cannot read the ${what} (403).`);
        e.isAbort = true;
        throw e;
      }
    },
    async readJson(path, depth) {
      const p = fetched(path);
      log.push(['GET', p]);
      if (opts.forbid?.(p)) return { status: 403, json: null };
      const n = repo.get(p);
      if (!isObj(n)) return { status: 404, json: null };
      return { status: 200, json: structuredClone(repo.cut(n, depth)) };
    },
    async inspect(path) {
      const { status, json } = await c.readJson(path, 1);
      if (status === 404) return { path, exists: false };
      if (status === 403) return { path, exists: null, forbidden: true };
      const content = json['jcr:content'] || null;
      return {
        path,
        exists: true,
        primaryType: json['jcr:primaryType'],
        isPage: json['jcr:primaryType'] === 'cq:Page',
        content,
        template: content?.['cq:template'] || null,
        title: content?.['jcr:title'] || null,
        childPages: Object.keys(json).filter((k) => k !== 'jcr:content' && json[k]?.['jcr:primaryType'] === 'cq:Page')
      };
    },
    async readProps(path) {
      const r = await c.readJson(path, 0);
      return r.status === 200 ? r.json : null;
    },
    async readTree(path) {
      const p = fetched(path);
      if (opts.tooBig?.(p)) throw new Error(`${path}.infinity.json did not parse - json.maximumresults`);
      const n = repo.get(p);
      return isObj(n) ? structuredClone(n) : null;
    },
    async getJson() {
      return { hits: [] };
    },
    async restoreVersion({ path, id }) {
      log.push(['RESTORE', fetched(path), id]);
      return opts.onRestore ? opts.onRestore(path, id) : { success: true, http: 200, effective: 200 };
    },
    async versionPage({ path }) {
      log.push(['VERSION', fetched(path)]);
      return { success: true, http: 200, effective: 200, version: 'new' };
    },
    async createPage(a) {
      log.push(['CREATEPAGE', a.parentPath, a.label]);
      return opts.onCreate ? opts.onCreate(a) : { success: true, http: 200, effective: 200 };
    },
    async copyPage(a) {
      log.push(['COPYPAGE', a.srcPath, a.destPath]);
      return opts.onCopy ? opts.onCopy(a) : { success: true, http: 200, effective: 200 };
    }
  };
  return c;
}
const writesIn = (c) => c.log.filter(([k]) => k !== 'GET');

const SETTINGS = {
  rootDepth: 3,
  backupFolder: 'india/backup',
  marketingTemplate: '/conf/t/marketing',
  upsertKeepAtDest: '',
  upsertKeepNodes: '',
  upsertSharedSites: 'global',
  upsertStripReplication: true,
  upsertHosts: '',
  upsertReorder: true,
  versionsSaveBeforeRestore: false
};
const quiet = () => {};

/* ---------------------------------------- 1. ".." never gets past a check */

{
  const refused = ['/content/samsung/uk/x/..', '/content/samsung/uk/india/backup/../../live', '/content/samsung/uk/%2e%2e/x', '/content/samsung/uk/.%2E/x', '/content/a/./b', '/content/a/b%2fc'];
  const passed = refused.filter((p) => !throws(() => P.norm(p)));
  check('a ".", ".." or encoded slash in a path is refused by norm', !passed.length, `let through: ${passed.join(', ')}`);

  const plain = throws(() => P.norm('/content/a/..'));
  check('the refusal is shown as it is, not as an unexpected error', plain?.isAbort === true);

  const kept = ['/content/samsung/uk/a', '/content/samsung/uk/a/', '/content/samsung/uk/..a/b.', '/content/dam/x/Galaxy%20S24.jpg'];
  const broke = kept.filter((p) => throws(() => P.norm(p)));
  check('an ordinary path still goes through norm unchanged', !broke.length, `refused: ${broke.join(', ')}`);

  check(
    'backupPathFor refuses a ".." that would land on the backup folder page',
    !!throws(() => P.backupPathFor('/content/samsung/uk/x/..', 3, 'india/backup'))
  );
  check(
    'typedBackupPath refuses a ".." that climbs out of the backup folder',
    !!throws(() => P.typedBackupPath('/content/samsung/global/hq/vd/tvs/x', '/content/samsung/levant/india/backup/../../../uk/tvs/x', 3, 'india/backup'))
  );
  const g = throws(() => COPY.destinationFor('/content/samsung/global/hq/vd/tvs/x', SETTINGS, { editDest: true, dest: '/content/samsung/levant/india/backup/../../../uk/tvs/x' }));
  check('the Backup worker refuses the same typed destination', !!g);

  // A run on such a path writes nothing, wherever it would have landed.
  const root = { content: { samsung: { 'jcr:primaryType': 'cq:Page', uk: { 'jcr:primaryType': 'cq:Page', x: { 'jcr:primaryType': 'cq:Page' }, india: { 'jcr:primaryType': 'cq:Page', backup: { 'jcr:primaryType': 'cq:Page' } } } } } };
  const c = clientOf(repoOf(root));
  const e = await rejects(() => COPY.actions.run({ client: c, settings: SETTINGS, report: quiet, params: { source: '/content/samsung/uk/x/..' } }));
  check('a backup run from /x/.. is refused and writes nothing', !!e && !writesIn(c).length, e ? `wrote ${JSON.stringify(writesIn(c))}` : 'it ran');
}

/* ------------------------------------- 2. the backup folder is one place */

{
  const cases = [
    ['/content/samsung/uk/india/backup/x', 'india/backup', true],
    ['/content/samsung/uk/india/backup', 'india/backup', false],
    ['/content/samsung/uk/promo/india/backup/x', 'india/backup', false],
    ['/content/samsung/uk/support/backup/how-to', 'backup', false],
    ['/content/samsung/uk/backup/how-to', 'backup', true]
  ];
  const wrong = cases.filter(([p, f, want]) => P.insideBackupFolder(p, f, 3) !== want);
  check('insideBackupFolder: the folder right under the site root, nowhere else', !wrong.length, wrong.map(([p]) => p).join(', '));

  // The same answer backupPathFor gives: what it treats as live, this treats as live.
  const live = '/content/samsung/uk/promo/india/backup/x';
  check(
    'a page backupPathFor backs up is never called a backup page',
    !!P.backupPathFor(live, 3, 'india/backup') && !P.insideBackupFolder(live, 'india/backup', 3)
  );
}

/* ---------------------------------------------------- the Versions world */

const UUID = 'aabbccdd-0000-0000-0000-000000000001';
const comp = (t) => ({ 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': 'x/text', text: t });
const pageContent = (extra = {}, t = 'hello') => ({ 'jcr:title': 'T', 'cq:template': '/t', root: { 'jcr:primaryType': 'nt:unstructured', text: comp(t) }, ...extra });
const frozen = (extra = {}, t = 'hello') => ({
  'jcr:primaryType': 'nt:frozenNode',
  'jcr:frozenPrimaryType': 'cq:PageContent',
  'jcr:frozenUuid': UUID,
  'cq:name': 'jcr:content',
  'cq:parentPath': '/x',
  'cq:siblingOrder': 1,
  ...pageContent(extra, t)
});

/** A page at `path` sitting on version `base`, with the history where Oak files it. */
function versionsWorld({ path, live, versions, base, opts }) {
  const hist = { 'jcr:primaryType': 'nt:versionHistory', 'jcr:rootVersion': { 'jcr:primaryType': 'nt:version', 'jcr:uuid': 'root' }, 'jcr:versionLabels': {} };
  for (const v of versions) {
    hist[v.name] = { 'jcr:primaryType': 'nt:version', 'jcr:uuid': v.id, 'jcr:created': v.created, 'jcr:frozenNode': v.frozen };
  }
  const root = { 'jcr:system': { 'jcr:versionStorage': { aa: { bb: { cc: { [UUID]: hist } } } } } };
  let n = root;
  const s = path.split('/').filter(Boolean);
  for (const name of s.slice(0, -1)) n = n[name] ||= { 'jcr:primaryType': 'cq:Page' };
  n[s.at(-1)] = {
    'jcr:primaryType': 'cq:Page',
    'jcr:content': { 'jcr:primaryType': 'cq:PageContent', 'jcr:uuid': UUID, 'jcr:mixinTypes': ['mix:versionable'], 'jcr:baseVersion': base, ...live }
  };
  const repo = repoOf(root);
  return { repo, client: clientOf(repo, opts) };
}
const BACKUP_PAGE = '/content/samsung/uk/india/backup/p';
const V1 = (f) => ({ name: '1.0', id: 'v1', created: 'Mon Nov 02 2026 10:00:00 GMT+0000', frozen: f });

/* ------------------------------- 1, 2. Versions writes only where it should */

{
  const live = '/content/samsung/uk/live-page';
  const { client } = versionsWorld({ path: live, live: pageContent({}, 'edited'), versions: [V1(frozen({}, 'old'))], base: 'v1' });
  const e = await rejects(() =>
    VERS.actions.restore({ client, report: quiet, settings: SETTINGS, params: { page: '/content/samsung/uk/india/backup/../../live-page', versionId: 'v1' } })
  );
  check('a restore through india/backup/../.. is refused before it reads or writes', !!e && !client.log.length, e ? `requests: ${JSON.stringify(client.log)}` : 'it ran');
}
{
  const promo = '/content/samsung/uk/promo/india/backup/x';
  const { client } = versionsWorld({ path: promo, live: pageContent({}, 'edited'), versions: [V1(frozen({}, 'old'))], base: 'v1' });
  const e = await rejects(() => VERS.actions.restore({ client, report: quiet, settings: SETTINGS, params: { page: promo, versionId: 'v1' } }));
  check('a restore on a live page with india/backup deeper in its path is refused', !!e && !writesIn(client).length);
  const c2 = await rejects(() => VERS.actions.create({ client, report: quiet, settings: SETTINGS, params: { page: promo, message: 'x' } }));
  check('so is saving a version on it', !!c2 && !writesIn(client).length);
}

/* --------------------------------------- 3. page properties are content */

for (const [what, extra] of [
  ['tags', { 'cq:tags': ['a:b'] }],
  ['navTitle', { navTitle: 'New nav' }],
  ['pageTitle', { pageTitle: 'New' }],
  ['hideInNav', { hideInNav: 'true' }],
  ['sling:vanityPath', { 'sling:vanityPath': '/promo' }],
  ['cq:redirectTarget', { 'cq:redirectTarget': '/content/x' }]
]) {
  const { client } = versionsWorld({ path: BACKUP_PAGE, live: pageContent(extra), versions: [V1(frozen())], base: 'v1' });
  const r = await VERS.actions.list({ client, report: quiet, settings: SETTINGS, params: { page: BACKUP_PAGE } });
  check(`${what} set since the version counts as a change`, r.drift?.changed === true, JSON.stringify(r.drift));
}
{
  // AEM's own records still do not: a restore moves cq:lastModified, a publish its own stamps.
  const extra = { 'cq:lastModified': 'Tue Nov 03 2026 09:00:00 GMT+0000', 'cq:lastReplicated': 'Tue Nov 03 2026 09:00:00 GMT+0000', publishedDateByWorkflow: 'x' };
  const { client } = versionsWorld({ path: BACKUP_PAGE, live: pageContent(extra), versions: [V1(frozen())], base: 'v1' });
  const r = await VERS.actions.list({ client, report: quiet, settings: SETTINGS, params: { page: BACKUP_PAGE } });
  check('AEM’s own stamps on the page are not a change', r.drift?.changed === false, JSON.stringify(r.drift));
}
{
  // A restore AEM accepts but that leaves a tag behind is caught by the read-back.
  const { client } = versionsWorld({ path: BACKUP_PAGE, live: pageContent({ 'cq:tags': ['a:b'] }), versions: [V1(frozen())], base: 'v1' });
  const e = await rejects(() => VERS.actions.restore({ client, report: quiet, settings: SETTINGS, params: { page: BACKUP_PAGE, versionId: 'v1' } }));
  check('a restore that leaves a page property behind fails its check', !!e && /does not hold/.test(e.message), e?.message || 'it passed');
}

/* ------------------------------------- 4, 5. a page too big to compare */

{
  const tooBig = (p) => p.endsWith('/jcr:content');
  const { client } = versionsWorld({ path: BACKUP_PAGE, live: pageContent({}, 'edited'), versions: [V1(frozen())], base: 'v1', opts: { tooBig } });
  const r = await VERS.actions.list({ client, report: quiet, settings: SETTINGS, params: { page: BACKUP_PAGE } });
  check('a drift that could not be checked says so, with why', r.drift?.unknown === true && r.drift.changed === null && /maximumresults/.test(r.drift.why || ''), JSON.stringify(r.drift));

  const res = await VERS.actions.restore({ client, report: quiet, settings: SETTINGS, params: { page: BACKUP_PAGE, versionId: 'v1' } });
  check('an unconfirmed restore is not titled as restored', res.confirmed === false && res.title !== 'Version restored' && !!res.why, JSON.stringify({ confirmed: res.confirmed, title: res.title }));
}

/* ---------------------------------------------- 6. the step ids it sends */

{
  const { client } = versionsWorld({ path: BACKUP_PAGE, live: pageContent(), versions: [V1(frozen())], base: 'v1' });
  const ids = new Set();
  const report = (level, message, data) => {
    if (level === 'data' && message === 'step') ids.add(data.id);
  };
  await VERS.actions.restore({ client, report, settings: SETTINGS, params: { page: BACKUP_PAGE, versionId: 'v1' } });
  // versions.js names these three; a different id here and its row never moves.
  const want = ['save', 'restore', 'check'];
  check('restore reports the step ids the Versions screen draws', want.every((id) => ids.has(id)) && ids.size === want.length, [...ids].join(', '));
}

/* --------------------------------------------- 8. backupState never throws */

const pageNode = (title = 'P', template = '/t') => ({ 'jcr:primaryType': 'cq:Page', 'jcr:content': { 'jcr:primaryType': 'cq:PageContent', 'jcr:title': title, 'cq:template': template } });
{
  const root = { content: { samsung: { 'jcr:primaryType': 'cq:Page', uk: { 'jcr:primaryType': 'cq:Page', p: pageNode(), india: { 'jcr:primaryType': 'cq:Page', backup: { 'jcr:primaryType': 'cq:Page', p: { 'jcr:primaryType': 'sling:Folder' } } } } } } };
  let r;
  const e = await rejects(async () => {
    r = await COPY.backupState(clientOf(repoOf(root)), SETTINGS, '/content/samsung/uk/p');
  });
  check('a folder at the backup path: backupState says unavailable, with why', !e && r?.state === 'unavailable' && /not a page/.test(r.reason || ''), e?.message || JSON.stringify(r));
}
{
  const root = { content: { samsung: { 'jcr:primaryType': 'cq:Page', uk: { 'jcr:primaryType': 'cq:Page', p: pageNode(), india: { 'jcr:primaryType': 'cq:Page' } } } } };
  const forbid = (p) => p.startsWith('/content/samsung/uk/india/backup');
  let r;
  const e = await rejects(async () => {
    r = await COPY.backupState(clientOf(repoOf(root), { forbid }), SETTINGS, '/content/samsung/uk/p');
  });
  check('a 403 at the backup path: backupState says unavailable, with why', !e && r?.state === 'unavailable' && /403/.test(r.reason || ''), e?.message || JSON.stringify(r));
}

/* ------------------------------------------ 11. what the copy is checked for */

{
  const source = '/content/samsung/uk/a/p';
  const build = () => ({
    content: {
      samsung: {
        'jcr:primaryType': 'cq:Page',
        uk: { 'jcr:primaryType': 'cq:Page', a: { ...pageNode('A'), p: pageNode('P', '/t/article') }, india: { 'jcr:primaryType': 'cq:Page', backup: { 'jcr:primaryType': 'cq:Page', a: pageNode('A') } } }
      }
    }
  });
  const land = (repo, node) => () => {
    repo.get('/content/samsung/uk/india/backup/a').p = node;
    return { success: true, http: 200, effective: 200 };
  };

  const good = repoOf(build());
  const ok = await rejects(() =>
    COPY.actions.run({ client: clientOf(good, { onCopy: land(good, pageNode('P', '/t/article')) }), settings: SETTINGS, report: quiet, params: { source } })
  );
  check('a copy that landed whole passes the read-back', !ok, ok?.message);

  const bare = repoOf(build());
  const e1 = await rejects(() =>
    COPY.actions.run({ client: clientOf(bare, { onCopy: land(bare, { 'jcr:primaryType': 'cq:Page' }) }), settings: SETTINGS, report: quiet, params: { source } })
  );
  check('a copied page with no jcr:content fails the read-back', !!e1 && /no jcr:content/.test(e1.message), e1?.message || 'it passed');

  const other = repoOf(build());
  const e2 = await rejects(() =>
    COPY.actions.run({ client: clientOf(other, { onCopy: land(other, pageNode('P', '/t/other')) }), settings: SETTINGS, report: quiet, params: { source } })
  );
  check('a copied page with another template fails the read-back', !!e2 && /template/.test(e2.message), e2?.message || 'it passed');
}

/* ------------------------------------ 10. which steps are pages written */

{
  // Three ancestors already in the backup, one page copied: the run passes the
  // three and writes one. The screen counts only the paths in create/copy/update.
  const root = {
    content: {
      samsung: {
        'jcr:primaryType': 'cq:Page',
        uk: {
          'jcr:primaryType': 'cq:Page',
          a: { ...pageNode(), b: { ...pageNode(), c: { ...pageNode(), p: pageNode() } } },
          india: { 'jcr:primaryType': 'cq:Page', backup: { 'jcr:primaryType': 'cq:Page', a: { ...pageNode(), b: { ...pageNode(), c: pageNode() } } } }
        }
      }
    }
  };
  const repo = repoOf(root);
  const onCopy = () => {
    repo.get('/content/samsung/uk/india/backup/a/b/c').p = pageNode();
    return { success: true, http: 200, effective: 200 };
  };
  const c = clientOf(repo, { onCopy });
  const params = { source: '/content/samsung/uk/a/b/c/p' };
  const s = await COPY.actions.analyze({ client: c, settings: SETTINGS, report: quiet, params });
  const steps = {};
  await COPY.actions.run({ client: c, settings: SETTINGS, params, report: (l, m, d) => l === 'data' && m === 'step' && (steps[d.path] = d.state) });
  const writes = new Set([...s.create.map((x) => x.path), ...(s.copy ? [s.copy.path] : [])]);
  const doneAll = Object.values(steps).filter((v) => v === 'done').length;
  const doneWritten = Object.entries(steps).filter(([p, v]) => v === 'done' && writes.has(p)).length;
  check(
    'existing ancestors report done steps, and only the written page is in create/copy',
    doneAll > writes.size && doneWritten === writes.size && writes.size === 1,
    `${doneAll} done, ${doneWritten} of ${writes.size} written`
  );
}

if (failures) console.log(`  ${failures} failed`);
