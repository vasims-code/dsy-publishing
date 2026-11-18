/**
 * A site's home page, backed up as <site>/<backup folder>/home - the real
 * Backup worker against an in-memory AEM that applies what it is sent.
 * Imported by engine-test.mjs; runs on its own:
 *
 *   node tools/engine-test-home-backup.mjs
 *
 * AEM's copy cannot rename, so this backup is made from the home page's
 * template and then filled by the sync plan. What is checked is what lands:
 * the content, the template, that no page copy was asked for, and that a
 * second run finds nothing to do.
 */

const P = await import('../src/core/paths.js');
const COPY = await import('../src/features/page-copy/worker.js');

const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);

function repoOf(root) {
  const get = (p) => {
    let n = root;
    for (const s of String(p).split('/').filter(Boolean)) {
      if (!isNode(n)) return undefined;
      n = n[s];
    }
    return n;
  };
  return { root, get };
}

const cut = (n, d) => {
  const o = {};
  for (const [k, v] of Object.entries(n)) {
    if (isNode(v)) {
      if (d > 0) o[k] = cut(v, d - 1);
    } else o[k] = v;
  }
  return o;
};

/** A Sling POST to `root`, applied the way AEM would. */
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
    if (value === '' && !seen.has(key)) {
      delete node[prop];
      continue;
    }
    node[prop] = seen.has(key) ? [].concat(node[prop], value) : value;
    seen.add(key);
  }
}

/* What a fresh page from the template holds: a grid with one component in it, which is nobody's content. */
const fromTemplate = (title, template) => ({
  'jcr:primaryType': 'cq:PageContent',
  'jcr:title': title,
  'cq:template': template,
  'sling:resourceType': 'samsung/components/structure/page',
  root: {
    'jcr:primaryType': 'nt:unstructured',
    'sling:resourceType': 'wcm/foundation/components/responsivegrid',
    responsivegrid: {
      'jcr:primaryType': 'nt:unstructured',
      'sling:resourceType': 'wcm/foundation/components/responsivegrid',
      starter: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': 'samsung/components/text', headlineText: 'Template text' }
    }
  }
});

function clientOf(repo) {
  const log = [];
  const ok = { success: true, http: 200, effective: 200 };
  const c = {
    log,
    resetCaches() {},
    forgetProbe() {},
    assertReadable() {},
    async readJson(path, depth) {
      const n = repo.get(path);
      return isNode(n) ? { status: 200, json: structuredClone(cut(n, depth)) } : { status: 404, json: null };
    },
    async inspect(path) {
      const n = repo.get(path);
      if (!isNode(n)) return { path, exists: false };
      const content = n['jcr:content'] || null;
      return {
        path,
        exists: true,
        primaryType: n['jcr:primaryType'],
        isPage: n['jcr:primaryType'] === 'cq:Page',
        content,
        template: content?.['cq:template'] || null,
        title: content?.['jcr:title'] || null,
        childPages: Object.keys(n).filter((k) => n[k]?.['jcr:primaryType'] === 'cq:Page')
      };
    },
    async probe(path) {
      if (/^\/(apps|libs|conf)\//.test(path)) return 'yes';
      return isNode(repo.get(path)) ? 'yes' : 'no';
    },
    async readProps(path) {
      const n = repo.get(path);
      return isNode(n) ? Object.fromEntries(Object.entries(n).filter(([, v]) => !isNode(v))) : null;
    },
    async readTree(path) {
      const n = repo.get(path);
      return isNode(n) ? structuredClone(n) : null;
    },
    async readTreeWhole(path) {
      return c.readTree(path);
    },
    async createPage({ parentPath, label, title, template }) {
      log.push(['CREATEPAGE', `${parentPath}/${label}`, template]);
      const parent = repo.get(parentPath);
      if (!isNode(parent)) return { success: false, http: 404, effective: 404, message: 'no parent' };
      parent[label] = { 'jcr:primaryType': 'cq:Page', 'jcr:content': fromTemplate(title, template) };
      return { ...ok, resultPath: `${parentPath}/${label}` };
    },
    async copyPage(a) {
      log.push(['COPYPAGE', a.srcPath, a.destPath]);
      const parent = repo.get(a.destPath.slice(0, a.destPath.lastIndexOf('/')));
      parent[a.destPath.split('/').pop()] = { 'jcr:primaryType': 'cq:Page', 'jcr:content': structuredClone(repo.get(`${a.srcPath}/jcr:content`)) };
      return { ...ok, resultPath: a.destPath };
    },
    async writeTree(root, pairs) {
      log.push(['WRITE', root]);
      applyTo(repo.get(root), pairs);
      return { ...ok, changes: ['modified('] };
    },
    async writeNode(path, pairs) {
      return c.writeTree(path, pairs);
    },
    async orderNode() {
      return ok;
    },
    async versionPage({ path }) {
      log.push(['VERSION', path]);
      return ok;
    },
    async currentUser() {
      return 'tester';
    },
    async createFolder(path) {
      log.push(['FOLDER', path]);
      return ok;
    }
  };
  return c;
}

const SETTINGS = {
  rootDepth: 3, backupFolder: 'india/backup', marketingTemplate: '/conf/samsung/settings/wcm/templates/page-marketing',
  verifyShallow: true, upsertHosts: '', upsertKeepAtDest: 'hreflangGroup', upsertKeepNodes: '', upsertSharedSites: 'global',
  upsertCopyAssets: true, upsertOverwriteAssets: false, upsertReorder: true, upsertVersionFirst: false,
  upsertStripReplication: true, upsertRewriteShop: false
};

const HOME_TEMPLATE = '/conf/samsung/settings/wcm/templates/page-home';
const home = () => ({
  'jcr:primaryType': 'cq:Page',
  'jcr:content': {
    'jcr:primaryType': 'cq:PageContent',
    'jcr:title': 'Samsung Levant',
    'cq:template': HOME_TEMPLATE,
    'sling:resourceType': 'samsung/components/structure/page',
    description: 'Home of the Levant site',
    root: {
      'jcr:primaryType': 'nt:unstructured',
      'sling:resourceType': 'wcm/foundation/components/responsivegrid',
      responsivegrid: {
        'jcr:primaryType': 'nt:unstructured',
        'sling:resourceType': 'wcm/foundation/components/responsivegrid',
        hero: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': 'samsung/components/hero', headlineText: 'Welcome', ctaUrl: '/levant_ar/offers/' },
        offers: {
          'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': 'samsung/components/cards', headlineText: 'Offers',
          item0: { 'jcr:primaryType': 'nt:unstructured', linkUrl: '/levant_ar/tvs/' }
        }
      }
    }
  },
  tvs: { 'jcr:primaryType': 'cq:Page', 'jcr:content': { 'jcr:primaryType': 'cq:PageContent', 'jcr:title': 'TVs', 'cq:template': SETTINGS.marketingTemplate } }
});
const world = () => repoOf({ content: { 'jcr:primaryType': 'sling:Folder', samsung: { 'jcr:primaryType': 'sling:Folder', levant_ar: home() } } });

const HOME = '/content/samsung/levant_ar';
const BACKUP = '/content/samsung/levant_ar/india/backup/home';
const grid = (repo, page) => repo.get(`${page}/jcr:content/root/responsivegrid`);
const kidsOf = (n) => Object.keys(n || {}).filter((k) => isNode(n[k]));
const contentOf = (n) => JSON.stringify(n, (k, v) => (/^(jcr:(created|lastModified)(By)?|cq:lastModified(By)?)$/.test(k) ? undefined : v));

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
const quiet = () => {};

console.log('');
console.log('--- the home page backup ---');

await check('the home page backs up to <site>/india/backup/home', async () => {
  const at = P.backupPathFor(HOME, 3, 'india/backup');
  return at === BACKUP ? null : at;
});

await check('a real page called "home" under the site is refused, not mixed with it', async () => {
  try {
    P.backupPathFor('/content/samsung/levant_ar/home', 3, 'india/backup');
    return 'it was given a backup path';
  } catch (e) {
    return /same place as the site's home page/.test(e.message) ? null : e.message;
  }
});

await check('above the site root is still refused', async () => {
  try {
    P.backupPathFor('/content/samsung', 3, 'india/backup');
    return 'it was given a backup path';
  } catch (e) {
    return /above the site root/.test(e.message) ? null : e.message;
  }
});

await check('the backup is a backup page to the Versions tool', async () => (P.insideBackupFolder(BACKUP, 'india/backup', 3) ? null : 'not inside'));

const repo = world();
const c = clientOf(repo);

await check('the review names the backup and says how it is made', async () => {
  const s = await COPY.actions.analyze({ client: c, settings: SETTINGS, report: quiet, params: { source: HOME } });
  if (s.dest !== BACKUP) return `dest ${s.dest}`;
  if (s.mode !== 'create') return `mode ${s.mode}`;
  if (!s.copy || !/made from its template/.test(s.copy.why)) return `copy ${JSON.stringify(s.copy)}`;
  return s.create.map((x) => x.path).join(',') === '/content/samsung/levant_ar/india,/content/samsung/levant_ar/india/backup' ? null : `creates ${s.create.map((x) => x.path)}`;
});

await check('taking it: made from the home template, filled with the home page, no page copy asked', async () => {
  await COPY.actions.run({ client: c, settings: SETTINGS, report: quiet, params: { source: HOME } });
  if (c.log.some((l) => l[0] === 'COPYPAGE')) return 'AEM copy was used - it cannot rename';
  const made = c.log.find((l) => l[0] === 'CREATEPAGE' && l[1] === BACKUP);
  if (!made || made[2] !== HOME_TEMPLATE) return `created with ${made?.[2]}`;
  const g = grid(repo, BACKUP);
  if (kidsOf(g).join(',') !== 'hero,offers') return `components ${kidsOf(g)}`;
  if (contentOf(g) !== contentOf(grid(repo, HOME))) return 'content differs from the home page';
  if (repo.get(`${BACKUP}/jcr:content`).description !== 'Home of the Levant site') return 'page properties not copied';
  if (repo.get(`${BACKUP}/tvs`)) return 'a child page came across';
  return null;
});

/* Its content, not the node: the backup folder lives under the home page, so a child page appears there by design. */
await check('the home page itself is untouched', async () => {
  const fresh = home();
  return contentOf(repo.get(`${HOME}/jcr:content`)) === contentOf(fresh['jcr:content']) ? null : 'the home page changed';
});

await check('a second run finds the backup up to date', async () => {
  const s = await COPY.actions.analyze({ client: c, settings: SETTINGS, report: quiet, params: { source: HOME } });
  return s.mode === 'update' && s.upToDate ? null : `mode ${s.mode}, upToDate ${s.upToDate}`;
});

await check('an edit to the home page is carried by the next backup', async () => {
  repo.get(`${HOME}/jcr:content/root/responsivegrid/hero`).headlineText = 'Welcome back';
  const before = (await COPY.backupState(c, SETTINGS, HOME)).state;
  await COPY.actions.run({ client: c, settings: SETTINGS, report: quiet, params: { source: HOME } });
  const after = (await COPY.backupState(c, SETTINGS, HOME)).state;
  const got = grid(repo, BACKUP).hero.headlineText;
  return before === 'differs' && after === 'same' && got === 'Welcome back' ? null : `${before} -> ${after}, headline ${got}`;
});

await check('another page still goes through AEM copy, as before', async () => {
  const r2 = world();
  const c2 = clientOf(r2);
  await COPY.actions.run({ client: c2, settings: SETTINGS, report: quiet, params: { source: '/content/samsung/levant_ar/tvs' } });
  const copied = c2.log.find((l) => l[0] === 'COPYPAGE');
  return copied?.[2] === '/content/samsung/levant_ar/india/backup/tvs' ? null : JSON.stringify(c2.log.filter((l) => l[0] !== 'WRITE'));
});

if (failed) console.log(`\n${failed} home-backup check(s) FAILED`);
