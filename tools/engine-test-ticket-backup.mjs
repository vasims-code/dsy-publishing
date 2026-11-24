/**
 * A second backup of a page, for a Jira ticket - <page's backup>/DSY-1234 -
 * the real Backup worker against an in-memory AEM that applies what it is
 * sent. Imported by engine-test.mjs; runs on its own:
 *
 *   node tools/engine-test-ticket-backup.mjs
 *
 * Two people on the same page each keep a copy: the ticket's backup is a
 * child page of the page's own backup. What is checked is what lands - its
 * title, its content - and that updating either backup leaves the other alone.
 * The in-memory AEM is the one engine-test-home-backup.mjs uses.
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

const TEMPLATE = '/conf/samsung/settings/wcm/templates/page-guide';
const PAGE = '/content/samsung/levant/home-appliances/buying-guide';
const MAIN = '/content/samsung/levant/india/backup/home-appliances/buying-guide';
const TICKET = `${MAIN}/DSY-1234`;

const page = () => ({
  'jcr:primaryType': 'cq:Page',
  'jcr:content': {
    'jcr:primaryType': 'cq:PageContent',
    'jcr:title': 'Buying guide',
    'cq:template': TEMPLATE,
    'sling:resourceType': 'samsung/components/structure/page',
    description: 'How to choose',
    root: {
      'jcr:primaryType': 'nt:unstructured',
      'sling:resourceType': 'wcm/foundation/components/responsivegrid',
      responsivegrid: {
        'jcr:primaryType': 'nt:unstructured',
        'sling:resourceType': 'wcm/foundation/components/responsivegrid',
        hero: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': 'samsung/components/hero', headlineText: 'Choose well' },
        text: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': 'samsung/components/text', text: '<p>Body</p>' }
      }
    }
  }
});
const plainPage = (kids = {}) => ({
  'jcr:primaryType': 'cq:Page',
  'jcr:content': { 'jcr:primaryType': 'cq:PageContent', 'jcr:title': 'Home appliances', 'cq:template': SETTINGS.marketingTemplate },
  ...kids
});
const world = () =>
  repoOf({
    content: {
      'jcr:primaryType': 'sling:Folder',
      samsung: {
        'jcr:primaryType': 'sling:Folder',
        levant: {
          'jcr:primaryType': 'cq:Page',
          'jcr:content': { 'jcr:primaryType': 'cq:PageContent', 'jcr:title': 'Levant' },
          'home-appliances': plainPage({ 'buying-guide': page() })
        }
      }
    }
  });

const grid = (repo, p) => repo.get(`${p}/jcr:content/root/responsivegrid`);
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
const run = (c, params) => COPY.actions.run({ client: c, settings: SETTINGS, report: quiet, params: { source: PAGE, ...params } });
const analyze = (c, params) => COPY.actions.analyze({ client: c, settings: SETTINGS, report: quiet, params: { source: PAGE, ...params } });

console.log('');
console.log('--- a backup for a Jira ticket ---');

await check('a ticket is read as a Jira key, in capitals', async () => {
  // WSC20200056-27758 is the shape the team's tickets really have: a project key with digits in it.
  const got = ['dsy-1234', ' DSY-1234 ', 'ab2-7', 'WSC20200056-27758', 'wsc20200056-27758'].map(P.jiraTicket).join(',');
  return got === 'DSY-1234,DSY-1234,AB2-7,WSC20200056-27758,WSC20200056-27758' ? null : got;
});
await check('anything else is not a ticket', async () => {
  const bad = ['', 'DSY', '1234', 'DSY 1234', 'DSY-12a', '../DSY-1', 'DSY-1/x', 'DSY_1234', '-1234'].filter((t) => P.jiraTicket(t));
  return bad.length ? `accepted ${bad.join(', ')}` : null;
});
await check("its backup is a child page of the page's backup, and a backup to Versions", async () => {
  const at = P.ticketBackupPath(MAIN, 'dsy-1234');
  return at === TICKET && P.insideBackupFolder(at, 'india/backup', 3) ? null : at;
});

const repo = world();
const c = clientOf(repo);

await check('with no backup of the page yet, a ticket backup is refused and nothing is written', async () => {
  try {
    await analyze(c, { ticket: 'DSY-1234' });
    return 'it was planned';
  } catch (e) {
    if (c.log.length) return `wrote ${JSON.stringify(c.log)}`;
    return /no backup of this page/.test(e.message) ? null : e.message;
  }
});
await check('a typed name that is not a ticket is refused', async () => {
  try {
    await analyze(c, { ticket: 'not a ticket' });
    return 'it was planned';
  } catch (e) {
    return /not a Jira ticket/.test(e.message) ? null : e.message;
  }
});

await run(c, {});
await check("the page's own backup is taken first, as before", async () => (repo.get(MAIN)?.['jcr:content'] ? null : 'no main backup'));

await check('the review names the ticket backup and says it is new', async () => {
  const s = await analyze(c, { ticket: 'dsy-1234' });
  if (s.dest !== TICKET || s.ticket !== 'DSY-1234' || s.mode !== 'create') return `${s.dest} ${s.ticket} ${s.mode}`;
  if (s.create.length) return `would create ${s.create.map((x) => x.path)}`;
  return /for DSY-1234/.test(s.copy?.why || '') ? null : s.copy?.why;
});

const mainBefore = contentOf(repo.get(`${MAIN}/jcr:content`));
await check("taking it: titled with the ticket, the page's template and content, under the backup", async () => {
  c.log.length = 0;
  await run(c, { ticket: 'dsy-1234' });
  if (c.log.some((l) => l[0] === 'COPYPAGE')) return 'AEM copy was used - it cannot rename';
  const made = c.log.find((l) => l[0] === 'CREATEPAGE');
  if (made?.[1] !== TICKET || made[2] !== TEMPLATE) return `created ${JSON.stringify(made)}`;
  const jc = repo.get(`${TICKET}/jcr:content`);
  if (jc['jcr:title'] !== 'Buying guide (DSY-1234)') return `title ${jc['jcr:title']}`;
  if (jc.description !== 'How to choose') return 'page properties not copied';
  return contentOf(grid(repo, TICKET)) === contentOf(grid(repo, PAGE)) ? null : 'content differs from the page';
});
await check("the page's own backup is untouched by it", async () => (contentOf(repo.get(`${MAIN}/jcr:content`)) === mainBefore ? null : 'the main backup changed'));

await check('the same ticket again is an update of that backup, already up to date', async () => {
  const s = await analyze(c, { ticket: 'DSY-1234' });
  return s.mode === 'update' && s.upToDate ? null : `mode ${s.mode}, upToDate ${s.upToDate}, ${JSON.stringify(s.sync?.counts)}`;
});

await check("the page's own backup is still up to date with a ticket backup under it", async () => {
  const s = await analyze(c, {});
  return s.mode === 'update' && s.upToDate ? null : `mode ${s.mode}, upToDate ${s.upToDate}`;
});

grid(repo, PAGE).hero.headlineText = 'Choose better';
await check("updating the page's own backup leaves the ticket backup where it is, as it was", async () => {
  const ticketBefore = contentOf(repo.get(TICKET));
  await run(c, {});
  if (grid(repo, MAIN).hero.headlineText !== 'Choose better') return 'the main backup was not updated';
  if (!repo.get(TICKET)) return 'the ticket backup was removed';
  return contentOf(repo.get(TICKET)) === ticketBefore ? null : 'the ticket backup changed';
});

await check('updating the ticket backup carries the edit and keeps its title', async () => {
  const mainNow = contentOf(repo.get(`${MAIN}/jcr:content`));
  await run(c, { ticket: 'DSY-1234' });
  const jc = repo.get(`${TICKET}/jcr:content`);
  if (grid(repo, TICKET).hero.headlineText !== 'Choose better') return 'not updated';
  if (jc['jcr:title'] !== 'Buying guide (DSY-1234)') return `title ${jc['jcr:title']}`;
  if (contentOf(repo.get(`${MAIN}/jcr:content`)) !== mainNow) return 'the main backup changed';
  const s = await analyze(c, { ticket: 'DSY-1234' });
  return s.upToDate ? null : 'not up to date after the update';
});

await check('a second ticket is a second backup beside the first', async () => {
  await run(c, { ticket: 'DSY-99' });
  return repo.get(`${MAIN}/DSY-99`) && repo.get(TICKET) ? null : 'missing one';
});

await check('the page itself is never written', async () =>
  c.log.some((l) => l[0] === 'WRITE' && l[1].startsWith(PAGE)) ? 'the page was written' : null
);

if (failed) console.log(`\n${failed} ticket-backup check(s) FAILED`);
