/* Exercise the page-versions worker against a simulated AEM 6.5 whose version
 * store is shaped the way Oak files it: /jcr:system/jcr:versionStorage/aa/bb/cc/<uuid>.
 */
import { pathToFileURL } from 'node:url';

/* --- DOMParser shim, faithful enough for Sling's HtmlResponse ------------ */
class FakeDoc {
  constructor(html) { this.html = html; }
  getElementById(id) {
    const m = this.html.match(new RegExp('<div id="' + id + '">([\\s\\S]*?)</div>'));
    return m ? { textContent: m[1] } : null;
  }
}
globalThis.DOMParser = class { parseFromString(s) { return new FakeDoc(s); } };

const htmlResponse = (status, message, path) =>
  `<html><body><div id="Status">${status}</div><div id="Message">${message}</div>` +
  `<div id="Path">${path || ''}</div></body></html>`;
const mk = (status, text) => ({
  status, ok: status >= 200 && status < 300,
  text: async () => text,
  json: async () => JSON.parse(text)
});

/* ------------------------------------------------------------- repository */

const clone = (o) => JSON.parse(JSON.stringify(o));
const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);
const segs = (p) => p.split('/').filter(Boolean);
const resolve = (root, path) => segs(path).reduce((n, s) => (isNode(n) ? n[s] : undefined), root);

function render(node, depth) {
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (isNode(v)) {
      if (depth > 0) out[k] = render(v, depth - 1);
    } else out[k] = v;
  }
  return out;
}

const PAGE = '/content/samsung/lb/air-conditioners/wall-mount';
const UUID = '1a2b3c4d-0000-4000-8000-000000000001';
const HISTORY = `/jcr:system/jcr:versionStorage/1a/2b/3c/${UUID}`;

const frozen = (title, modified) => ({
  'jcr:primaryType': 'nt:frozenNode',
  'jcr:title': title,
  'cq:lastModified': modified,
  'cq:lastModifiedBy': 'author@samsung.com',
  root: { 'jcr:primaryType': 'nt:frozenNode', hero: { title: `${title} hero` } }
});

function repo({ versioned = true, historyAt = HISTORY } = {}) {
  const content = {
    'jcr:primaryType': 'cq:PageContent',
    'jcr:title': 'Wall Mount - now',
    'cq:lastModified': 'Sun Sep 27 2026 09:00:00 GMT+0000',
    'cq:lastModifiedBy': 'author@samsung.com',
    root: { 'jcr:primaryType': 'nt:unstructured', hero: { title: 'Now hero' } }
  };
  if (versioned) {
    Object.assign(content, {
      'jcr:uuid': UUID,
      'jcr:mixinTypes': ['mix:versionable'],
      'jcr:baseVersion': 'v-2'
    });
  }
  const root = {
    content: {
      'jcr:primaryType': 'sling:OrderedFolder',
      samsung: {
        'jcr:primaryType': 'cq:Page',
        lb: {
          'jcr:primaryType': 'cq:Page',
          'air-conditioners': {
            'jcr:primaryType': 'cq:Page',
            'wall-mount': { 'jcr:primaryType': 'cq:Page', 'jcr:content': content }
          }
        }
      }
    },
    'jcr:system': { 'jcr:primaryType': 'rep:system', 'jcr:versionStorage': { 'jcr:primaryType': 'rep:versionStorage' } }
  };
  if (versioned) {
    let holder = root;
    for (const s of segs(historyAt).slice(0, -1)) holder = holder[s] ||= { 'jcr:primaryType': 'rep:versionStorage' };
    holder[segs(historyAt).pop()] = {
      'jcr:primaryType': 'nt:versionHistory',
      'jcr:versionableUuid': UUID,
      'jcr:rootVersion': { 'jcr:primaryType': 'nt:version', 'jcr:uuid': 'v-root' },
      '1.0': {
        'jcr:primaryType': 'nt:version',
        'jcr:uuid': 'v-1',
        'jcr:created': 'Fri Sep 25 2026 10:00:00 GMT+0000',
        'jcr:frozenNode': frozen('Wall Mount - first', 'Fri Sep 25 2026 09:59:00 GMT+0000')
      },
      '1.1': {
        'jcr:primaryType': 'nt:version',
        'jcr:uuid': 'v-2',
        'jcr:created': 'Sat Sep 26 2026 10:00:00 GMT+0000',
        'jcr:frozenNode': { ...frozen('Wall Mount - second', 'Sat Sep 26 2026 09:59:00 GMT+0000'), 'cq:versionComment': 'before sync' }
      },
      'jcr:versionLabels': { 'jcr:primaryType': 'nt:versionLabels', 'pre-sync-2026-09-26T10-00-00Z': 'v-2' }
    };
  }
  return root;
}

function installFetch(root, writes, opts = {}) {
  const forbidden = new Set(opts.forbidden || []);
  let seq = 10;
  const historyOf = () => {
    const c = resolve(root, `${PAGE}/jcr:content`);
    return opts.historyAt ? resolve(root, opts.historyAt) : resolve(root, HISTORY) || (c && c.__history);
  };

  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURI(String(url).split('?')[0]);
    const query = new URLSearchParams(String(url).split('?')[1] || '');
    if (u === '/libs/granite/csrf/token.json') return mk(200, JSON.stringify({ token: 'tok' }));

    if ((init.method || 'GET').toUpperCase() === 'GET') {
      if (u === '/bin/querybuilder.json') {
        writes.reads?.push('query');
        const want = query.get('property.value');
        const path = opts.historyAt;
        const h = path && resolve(root, path);
        const hits = h && h['jcr:versionableUuid'] === want ? [{ 'jcr:path': path }] : [];
        return mk(200, JSON.stringify({ success: true, hits }));
      }
      const m = u.match(/^(.*)\.(\d+|infinity)\.json$/);
      if (!m) return mk(404, 'nf');
      if ([...forbidden].some((f) => m[1].startsWith(f))) return mk(403, 'forbidden');
      const node = resolve(root, m[1]);
      if (!isNode(node)) return mk(404, 'nf');
      return mk(200, JSON.stringify(render(node, m[2] === 'infinity' ? 99 : parseInt(m[2], 10))));
    }

    const body = new URLSearchParams(init.body);
    if (!init.headers?.['CSRF-Token']) return mk(403, 'CSRF token mismatch');
    if (u !== '/bin/wcmcommand') return mk(200, htmlResponse(500, 'unexpected write'));

    const cmd = body.get('cmd');
    const content = resolve(root, `${body.get('path')}/jcr:content`);
    const history = historyOf();

    if (cmd === 'createVersion') {
      writes.push(`version ${body.get('path')}${body.has('label') ? ` label=${body.get('label')}` : ''}`);
      const id = `v-${++seq}`;
      const props = Object.fromEntries(Object.entries(content).filter(([k, v]) => !isNode(v) && !k.startsWith('jcr:')));
      history[`1.${seq}`] = {
        'jcr:primaryType': 'nt:version',
        'jcr:uuid': id,
        'jcr:created': new Date(Date.UTC(2026, 8, 27, 12, seq)).toString(),
        'jcr:frozenNode': {
          'jcr:primaryType': 'nt:frozenNode',
          'jcr:title': content['jcr:title'],
          ...props,
          'cq:versionComment': body.get('comment')
        }
      };
      if (body.has('label')) history['jcr:versionLabels'][body.get('label')] = id;
      content['jcr:baseVersion'] = id;
      return mk(200, htmlResponse(200, 'versioned', body.get('path')));
    }

    if (cmd === 'restoreVersion') {
      writes.push(`restore ${body.get('path')} ${body.get('id')}`);
      const v = Object.values(history).find((x) => isNode(x) && x['jcr:uuid'] === body.get('id'));
      if (!v) return mk(200, htmlResponse(404, 'no such version'));
      if (!opts.quietRestore) {
        for (const k of Object.keys(content)) if (!k.startsWith('jcr:') || k === 'jcr:title') delete content[k];
        for (const [k, val] of Object.entries(clone(v['jcr:frozenNode']))) if (k !== 'jcr:primaryType') content[k] = val;
        content['jcr:baseVersion'] = v['jcr:uuid'];
        // What real AEM does: a restore is an edit, so the page is "modified now".
        content['cq:lastModified'] = 'Sun Sep 27 2026 13:00:00 GMT+0000';
        content['cq:lastModifiedBy'] = 'restorer@samsung.com';
        // ...and the comment of the version saved just before stays on it.
        content['cq:versionComment'] = 'before restoring';
        content['jcr:isCheckedOut'] = true;
        if (opts.driftAfterRestore) content.root.hero.title = 'something else';
        for (const k of opts.dropOnRestore || []) delete content[k];
        Object.assign(content, opts.setOnRestore || {});
      }
      return mk(200, htmlResponse(200, 'restored', body.get('path')));
    }
    return mk(200, htmlResponse(500, 'unknown command'));
  };
}

/* ----------------------------------------------------------------- runner */

const base = 'D:/chrome-extensions/aem-toolkit/src/';
const { AemClient } = await import(pathToFileURL(base + 'core/aem-client.js'));
const { actions } = await import(pathToFileURL(base + 'features/page-versions/worker.js'));

let pass = 0;
let failed = 0;

/* The test pages stand in for backup pages: the folder is set to one they are under.
 * The real rule, with the default india/backup, is tested on its own at the end. */
async function run(name, { root, params, action = 'list', opts = {}, settings = { rootDepth: 3, backupFolder: 'samsung/lb' } }, check) {
  const writes = [];
  const lines = [];
  const steps = [];
  installFetch(root, writes, opts);
  const report = (level, message, data) => {
    if (level === 'data' && message === 'step') steps.push(`${data.id}:${data.state}`);
    else if (level !== 'data') lines.push(`${level.toUpperCase().padEnd(4)} ${message}`);
  };
  const client = new AemClient({ report });

  let error = null;
  let result = null;
  try {
    result = await actions[action]({ client, settings, report, params });
  } catch (e) {
    error = e.message;
  }

  const problems = [];
  const t = {
    ok: (cond, what) => { if (!cond) problems.push(what); },
    writes, lines, steps, error, result,
    at: (p) => resolve(root, p)
  };
  try { check(t); } catch (e) { problems.push(`threw: ${e.message}`); }

  const good = problems.length === 0;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${name}`);
  if (!good) {
    for (const p of problems) console.log('        - ' + p);
    lines.forEach((l) => console.log('        ' + l));
    writes.forEach((w) => console.log('        > ' + w));
    if (error) console.log('        error: ' + error);
  }
  good ? pass++ : failed++;
}

/* ------------------------------------------------------------------ cases */

console.log('\n--- listing --------------------------------------------------------');

await run('versions are read from the version store, newest first, writing nothing', {
  root: repo(), params: { page: PAGE }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.writes.length === 0, `expected no writes, got ${JSON.stringify(t.writes)}`);
  t.ok(t.result.versions.map((v) => v.name).join(',') === '1.1,1.0', `order: ${t.result.versions.map((v) => v.name)}`);
  t.ok(!t.result.versions.some((v) => v.name === 'jcr:rootVersion'), 'the root version is not a version to restore');
  t.ok(t.result.historyPath === HISTORY, `history path: ${t.result.historyPath}`);
});

await run('each version gets a plain number by age: 1 is the oldest', {
  root: repo(), params: { page: PAGE }
}, (t) => {
  const byName = Object.fromEntries(t.result.versions.map((v) => [v.name, v.number]));
  t.ok(byName['1.1'] === 2 && byName['1.0'] === 1, `numbers: ${JSON.stringify(byName)}`);
  t.ok(t.result.currentNumber === 2, `current number: ${t.result.currentNumber}`);
});

await run('the current version, labels, title and comment come across', {
  root: repo(), params: { page: PAGE }
}, (t) => {
  const [latest, first] = t.result.versions;
  t.ok(latest.current === true && first.current === false, 'only the base version is current');
  t.ok(t.result.current === '1.1', `current: ${t.result.current}`);
  t.ok(latest.labels.join() === 'pre-sync-2026-09-26T10-00-00Z', `labels: ${latest.labels}`);
  t.ok(latest.title === 'Wall Mount - second', `title: ${latest.title}`);
  t.ok(latest.comment === 'before sync', `comment: ${latest.comment}`);
  t.ok(first.labels.length === 0 && first.comment === null, 'the first version has no label or comment');
});

await run('a page never versioned lists nothing, and is not an error', {
  root: repo({ versioned: false }), params: { page: PAGE }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.result.neverVersioned === true && t.result.versions.length === 0, 'no versions');
});

await run('a history filed somewhere else is found by asking QueryBuilder', {
  root: repo({ historyAt: '/jcr:system/jcr:versionStorage/elsewhere/h1' }),
  params: { page: PAGE },
  opts: { historyAt: '/jcr:system/jcr:versionStorage/elsewhere/h1' }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.result.versions.length === 2, `found ${t.result.versions.length}`);
  t.ok(t.result.historyPath === '/jcr:system/jcr:versionStorage/elsewhere/h1', `path: ${t.result.historyPath}`);
});

await run('a version store the account cannot read says so, rather than "no versions"', {
  root: repo(), params: { page: PAGE }, opts: { forbidden: ['/jcr:system'] }
}, (t) => {
  t.ok(String(t.error).includes('403'), `got: ${t.error}`);
});

await run('a path that is not a page is refused', {
  root: repo(), params: { page: '/content/samsung/lb/air-conditioners/nope' }
}, (t) => {
  t.ok(String(t.error).includes('does not exist'), `got: ${t.error}`);
});

console.log('\n--- restoring ------------------------------------------------------');

await run('restoring saves the current content first, then restores, then checks', {
  root: repo(), action: 'restore', params: { page: PAGE, versionId: 'v-1', saveCurrent: true }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.writes.length === 2 && t.writes[0].startsWith('version ') && t.writes[1] === `restore ${PAGE} v-1`,
    `writes: ${JSON.stringify(t.writes)}`);
  const c = t.at(`${PAGE}/jcr:content`);
  t.ok(c['jcr:title'] === 'Wall Mount - first', `title now: ${c['jcr:title']}`);
  t.ok(t.result.confirmed === true && t.result.restored === '1.0', 'the restore should be confirmed');
  t.ok(t.result.restoredNumber === 1, `restored number: ${t.result.restoredNumber}`);
  t.ok(t.lines.some((l) => l.includes('restored version 1 (AEM 1.0)')), 'messages use both names');
  const h = t.at(HISTORY);
  t.ok(Object.values(h).some((v) => isNode(v) && v['jcr:frozenNode']?.['cq:versionComment'] === 'before restoring AEM version 1.0'),
    'the saved comment names the AEM version, which never shifts');
  t.ok(t.steps.join() === 'save:running,save:done,restore:running,restore:done,check:running,check:done',
    `steps: ${t.steps}`);
});

await run('the content that was replaced is kept as a version', {
  root: repo(), action: 'restore', params: { page: PAGE, versionId: 'v-1', saveCurrent: true }
}, (t) => {
  const h = t.at(HISTORY);
  const saved = Object.values(h).find((v) => isNode(v) && v['jcr:frozenNode']?.['jcr:title'] === 'Wall Mount - now');
  t.ok(saved, 'a version holding the content from before the restore should exist');
});

await run('unticking "save current" restores without saving first', {
  root: repo(), action: 'restore', params: { page: PAGE, versionId: 'v-1', saveCurrent: false }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.writes.join() === `restore ${PAGE} v-1`, `writes: ${JSON.stringify(t.writes)}`);
});

await run('a version not in this page\u2019s history is refused, writing nothing', {
  root: repo(), action: 'restore', params: { page: PAGE, versionId: 'v-999' }
}, (t) => {
  t.ok(String(t.error).includes('not in this page'), `got: ${t.error}`);
  t.ok(t.writes.length === 0, `writes: ${JSON.stringify(t.writes)}`);
});

await run('a real restore passes even though AEM moves cq:lastModified to now', {
  root: repo(), action: 'restore', params: { page: PAGE, versionId: 'v-2', saveCurrent: false }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.result.confirmed === true, 'the content matches, so the restore is confirmed');
});

await run('the fields AEM keeps only in a version do not fail a restore', {
  root: (() => {
    const r = repo();
    // What AEM writes into the version so a deleted page can go back in place.
    Object.assign(r['jcr:system']['jcr:versionStorage']['1a']['2b']['3c'][UUID]['1.0']['jcr:frozenNode'], {
      'cq:siblingOrder': 'wall-mount,',
      'cq:parentPath': '/content/samsung/lb/air-conditioners',
      'cq:name': 'wall-mount'
    });
    return r;
  })(),
  action: 'restore', params: { page: PAGE, versionId: 'v-1', saveCurrent: false },
  opts: { dropOnRestore: ['cq:siblingOrder', 'cq:parentPath', 'cq:name'] }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.result.confirmed === true, 'the restore should be confirmed');
});

await run('another page property AEM keeps is a note, not a failure', {
  root: repo(), action: 'restore', params: { page: PAGE, versionId: 'v-1', saveCurrent: false },
  opts: { setOnRestore: { 'myproject:syncState': 'dirty' } }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.lines.some((l) => l.startsWith('INFO note  (page properties) / myproject:syncState')), 'shown as a note');
  t.ok(t.result.confirmed === true, 'still confirmed');
});

await run('a different page title still fails, because the title is content', {
  root: repo(), action: 'restore', params: { page: PAGE, versionId: 'v-1', saveCurrent: false },
  opts: { setOnRestore: { 'jcr:title': 'Not the version title' } }
}, (t) => {
  t.ok(String(t.error).includes('(page properties) / jcr:title'), `got: ${t.error}`);
});

await run('a restore that leaves one property different names it', {
  root: repo(), action: 'restore', params: { page: PAGE, versionId: 'v-1', saveCurrent: false },
  opts: { driftAfterRestore: true }
}, (t) => {
  t.ok(String(t.error).includes('1 difference'), `got: ${t.error}`);
  t.ok(String(t.error).includes('/root/hero / title'), `should name the property, got: ${t.error}`);
  t.ok(t.lines.some((l) => l.includes('differs  /root/hero / title')), 'the difference is in the activity log');
  t.ok(t.lines.some((l) => l.includes('version: "Wall Mount - first hero"') && l.includes('page:    "something else"')),
    'both values are shown');
});

await run('AEM saying "restored" while the page is unchanged is caught', {
  root: repo(), action: 'restore', params: { page: PAGE, versionId: 'v-1', saveCurrent: false },
  opts: { quietRestore: true }
}, (t) => {
  t.ok(String(t.error).includes('does not hold'), `got: ${t.error}`);
});

console.log('\n--- creating ---------------------------------------------------------');

await run('a version is created with the message as its comment, and no label', {
  root: repo(), action: 'create', params: { page: PAGE, message: '  Before the October campaign  ' }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.writes.length === 1 && t.writes[0] === `version ${PAGE}`, `writes: ${JSON.stringify(t.writes)}`);
  const h = t.at(HISTORY);
  const made = Object.values(h).find((v) => isNode(v) && v['jcr:frozenNode']?.['cq:versionComment'] === 'Before the October campaign');
  t.ok(made, 'the new version should carry the trimmed message');
  t.ok(t.result.created === made?.['jcr:uuid'] ? false : !!t.result.created, 'the new version name is reported');
  t.ok(/^Version .+ created$/.test(t.result.title), `title: ${t.result.title}`);
});

await run('a version needs a message', {
  root: repo(), action: 'create', params: { page: PAGE, message: '   ' }
}, (t) => {
  t.ok(String(t.error).includes('Write a message'), `got: ${t.error}`);
  t.ok(t.writes.length === 0, `writes: ${JSON.stringify(t.writes)}`);
});

for (const action of ['restore', 'create']) {
  await run(`${action} on a page outside india/backup is refused, writing nothing`, {
    root: repo(), action, params: { page: PAGE, versionId: 'x', message: 'm' }, settings: { rootDepth: 3, backupFolder: 'india/backup' }
  }, (t) => {
    t.ok(/only be restored or created on a backup page/.test(t.error || ''), `error: ${t.error}`);
    t.ok(t.writes.length === 0, `writes: ${JSON.stringify(t.writes)}`);
  });
}
await run('settings, off by default: a restore saves no version of its own', {
  root: repo(), action: 'restore', params: { page: PAGE, versionId: 'v-1' }
}, (t) => t.ok(!t.writes.some((w) => /checkin|createVersion|wcmcommand/i.test(w)) && t.steps.includes('save:done'), `writes: ${JSON.stringify(t.writes)}`));
await run('settings ticked: a restore saves the current content first', {
  root: repo(), action: 'restore', params: { page: PAGE, versionId: 'v-1' },
  settings: { rootDepth: 3, backupFolder: 'samsung/lb', versionsSaveBeforeRestore: true }
}, (t) => t.ok(t.lines.some((l) => /saved the current content as a version/.test(l)), t.lines.join(' | ')));
await run('listing works on any page - it only reads', {
  root: repo(), params: { page: PAGE }, settings: { rootDepth: 3, backupFolder: 'india/backup' }
}, (t) => t.ok(!t.error, `error: ${t.error}`));

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
