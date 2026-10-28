/* Exercise the extension's page-upsert worker against a simulated AEM 6.5.
 *
 * The repository is a nested object, because that is what .infinity.json is and
 * because JS preserves key insertion order - which is how child node order (and
 * therefore component order) can be asserted at all.
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
  `<div id="Path">${path || ''}</div><div id="Location">${path || ''}</div></body></html>`;

const mk = (status, text, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => text,
  json: async () => JSON.parse(text),
  arrayBuffer: async () => new TextEncoder().encode(text).buffer
});

/* The upload goes by XMLHttpRequest, for its progress events: this one sends the
 * body in one go and hands the request to the simulated instance's fetch. */
globalThis.XMLHttpRequest = class {
  constructor() { this.upload = {}; this.headers = {}; }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  abort() { this.aborted = true; }
  send(body) {
    const size = body.get('file')?.size || 0;
    this.upload.onprogress?.({ loaded: size, total: size });
    this.upload.onload?.();
    globalThis.fetch(this.url, { method: this.method, headers: this.headers, body })
      .then((res) => {
        if (this.aborted) return;
        this.status = res.status;
        this.onload?.();
      })
      .catch(() => {});
  }
};

/* ------------------------------------------------------------- repository */

const clone = (o) => JSON.parse(JSON.stringify(o));
const isNode = (v) => v && typeof v === 'object' && !Array.isArray(v);
const segs = (p) => p.split('/').filter(Boolean);

function resolve(root, path) {
  let cur = root;
  for (const s of segs(path)) {
    if (!isNode(cur)) return undefined;
    cur = cur[s];
  }
  return cur;
}
function parentNode(root, path) {
  return resolve(root, '/' + segs(path).slice(0, -1).join('/'));
}

function render(node, depth) {
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (isNode(v)) {
      if (depth > 0) out[k] = render(v, depth - 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Sling's type coercion, including the part that rejects a bad hint. */
function coerce(values, hint) {
  const multi = hint.endsWith('[]');
  const base = multi ? hint.slice(0, -2) : hint;
  const one = (s) => {
    if (base === 'Boolean') return s === 'true';
    if (base === 'Long') {
      if (!/^-?\d+$/.test(s)) throw new Error(`For input string: "${s}"`);
      return parseInt(s, 10);
    }
    if (base === 'Double') return parseFloat(s);
    return s;
  };
  return multi ? values.map(one) : one(values[0]);
}


/**
 * Sling's `:order=<n>`: move this node to index n among its sibling NODES.
 * Property order is irrelevant in JCR, so only child nodes are resequenced.
 */
function reorderChild(holder, name, index) {
  const kids = Object.keys(holder).filter((k) => isNode(holder[k]));
  const others = kids.filter((k) => k !== name);
  const at = Math.min(Math.max(index, 0), others.length);
  const wanted = [...others.slice(0, at), name, ...others.slice(at)];

  const rebuilt = {};
  for (const k of Object.keys(holder)) if (!isNode(holder[k])) rebuilt[k] = holder[k];
  for (const k of wanted) rebuilt[k] = holder[k];
  for (const k of Object.keys(holder)) delete holder[k];
  Object.assign(holder, rebuilt);
}

let versionSeq = 0;

function installFetch(root, writes, opts = {}) {
  const forbidden = new Set(opts.forbidden || []);
  const fmt = (o) => JSON.stringify(o);

  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURI(String(url).split('?')[0]);
    /* Dynamic Media's live host: serves the paths in opts.delivery, 404 for the rest. */
    if (u.startsWith('https://')) {
      const DM = 'https://images.samsung.com/is/image/samsung/assets/';
      const p = u.startsWith(DM) ? u.slice(DM.length) : null;
      if (!p || !opts.delivery?.includes(p)) return mk(404, 'nf');
      if (opts.deliveryGetFails && (init.method || 'GET').toUpperCase() === 'GET') return mk(500, 'boom');
      return mk(200, `DM bytes of ${p}`, { 'content-type': 'image/jpeg' });
    }
    if (u === '/libs/granite/csrf/token.json') return mk(200, JSON.stringify({ token: 'tok' }));

    /* ------------------------------------------------------------ reads */
    if ((init.method || 'GET').toUpperCase() === 'GET') {
      const m = u.match(/^(.*)\.(\d+|infinity)\.json$/);
      // A raw read of an asset: its file.
      if (!m && u.startsWith('/content/dam/')) {
        const asset = resolve(root, u);
        if (!isNode(asset)) return mk(404, 'nf');
        if (opts.unreadable?.includes(u)) return mk(403, 'forbidden');
        return mk(200, asset.__bytes || `bytes of ${u}`, { 'content-type': asset.__mime || 'image/jpeg' });
      }
      if (!m) return mk(404, 'nf');
      const path = m[1];
      if (forbidden.has(path)) return mk(403, 'forbidden');
      const node = resolve(root, path);
      if (!isNode(node)) return mk(404, 'nf');
      const depth = m[2] === 'infinity' ? 99 : parseInt(m[2], 10);
      if (m[2] === 'infinity' && opts.truncate) return mk(200, '{"jcr:primary');

      const out = render(node, depth);
      // A node that IS in the repository but missing from the infinity JSON:
      // what truncation, or any other short read, actually looks like.
      if (m[2] === 'infinity' && opts.resurrect?.startsWith(path + '/')) {
        const rel = opts.resurrect.slice(path.length + 1).split('/');
        let cur = out;
        for (const s of rel.slice(0, -1)) cur = cur?.[s];
        if (cur) delete cur[rel[rel.length - 1]];
      }
      return mk(200, JSON.stringify(out));
    }

    /* ---------------------------------------------------------- uploads */
    if (u.endsWith('.createasset.html')) {
      if (!init.headers?.['CSRF-Token']) return mk(403, 'CSRF token mismatch');
      const folder = u.slice(0, -'.createasset.html'.length);
      const fileName = init.body.get('fileName');
      const file = init.body.get('file');
      if (opts.uploadFails?.includes(fileName)) return mk(500, 'refused');
      const holder = resolve(root, folder);
      if (!isNode(holder)) return mk(500, 'no folder');
      if (opts.uploadVanishes) return mk(200, '<html>ok</html>');
      holder[fileName] = { 'jcr:primaryType': 'dam:Asset', __bytes: await file.text(), __mime: file.type, __uploaded: true };
      writes.push(`upload ${folder}/${fileName} (${file.type})`);
      return mk(200, '<html>ok</html>');
    }

    /* ----------------------------------------------------------- writes */
    const body = new URLSearchParams(init.body);
    if (!init.headers?.['CSRF-Token']) return mk(403, 'CSRF token mismatch');
    /* Every write that would land under this path is refused - the backup that fails. */
    if (opts.refuseUnder && [u, body.get('srcPath') && `${body.get('destParentPath')}/${body.get('destName')}`, body.get('parentPath')]
      .some((x) => x && x.startsWith(opts.refuseUnder))) return mk(200, htmlResponse(500, 'refused'));

    if (u === '/bin/wcmcommand') {
      const cmd = body.get('cmd');

      if (cmd === 'createVersion') {
        const QUIET = opts.quietVersionFailure;
        /* What real AEM does with a version: jcr:baseVersion on the page's
         * jcr:content moves to it. A label that is not a valid JCR name gets a
         * 200 and no version - the quiet failure the extension has to catch.
         * `quietVersionFailure` fakes that failure for any label. */
        const label = body.get('label') || '';
        const content = resolve(root, `${body.get('path')}/jcr:content`);
        if (isNode(content) && !/[:/[\]*|]/.test(label) && !QUIET) {
          content['jcr:baseVersion'] = `version-${++versionSeq}`;
        }
        writes.push(`version ${body.get('path')}`);
        return mk(200, htmlResponse(200, 'versioned', body.get('path')));
      }

      if (cmd === 'copyPage') {
        const src = body.get('srcPath');
        const parent = body.get('destParentPath');
        let name = body.get('destName');
        const holder = resolve(root, parent);
        if (!isNode(holder)) return mk(200, htmlResponse(500, 'no parent'));
        // Someone else creating the destination between the analysis and the
        // write - the race the rename check exists for.
        if (opts.collide) holder[name] = { 'jcr:primaryType': 'cq:Page', 'jcr:content': { squatter: true } };
        // AEM renames around a collision rather than failing.
        if (holder[name]) name += '1';
        const dest = `${parent}/${name}`;
        writes.push(`copyPage ${src} -> ${dest} shallow=${body.get('shallow')}`);

        const source = resolve(root, src);
        const copy = {};
        for (const [k, v] of Object.entries(source)) {
          // shallow: child cq:Page nodes do not come across
          if (isNode(v) && v['jcr:primaryType'] === 'cq:Page' && body.get('shallow') === 'true') continue;
          copy[k] = isNode(v) ? clone(v) : v;
        }
        holder[name] = copy;
        return mk(200, htmlResponse(200, 'copied', opts.reportPathAs || dest));
      }
      return mk(200, htmlResponse(500, 'unknown command'));
    }

    /* ------------------------------------------- Sling POST to a node */
    const path = u;
    const op = body.get(':operation');

    if (op === 'delete') {
      const holder = parentNode(root, path);
      const name = segs(path).pop();
      if (!holder?.[name]) return mk(200, htmlResponse(404, 'not found'));
      delete holder[name];
      writes.push(`delete ${path}`);
      return mk(200, htmlResponse(200, 'deleted', path));
    }

    if (op === 'copy') {
      const dest = body.get(':dest');
      const source = resolve(root, path);
      if (!isNode(source)) return mk(200, htmlResponse(404, 'no source'));
      const holder = parentNode(root, dest);
      if (!isNode(holder)) return mk(200, htmlResponse(500, 'no destination parent'));
      holder[segs(dest).pop()] = clone(source);
      writes.push(`copy ${path} -> ${dest}`);
      return mk(200, htmlResponse(200, 'copied', dest));
    }

    if (body.has(':order') && [...body.keys()].every((k) => k === ':order' || k === '_charset_')) {
      const holder = parentNode(root, u);
      const name = segs(u).pop();
      if (!holder?.[name]) return mk(200, htmlResponse(404, 'nf'));
      reorderChild(holder, name, parseInt(body.get(':order'), 10));
      writes.push(`order ${u} ${body.get(':order')}`);
      return mk(200, htmlResponse(200, 'ordered', u));
    }

    // Property write. Sling creates missing intermediate nodes.
    let node = root;
    for (const s of segs(path)) {
      if (!isNode(node[s])) node[s] = { 'jcr:primaryType': 'nt:unstructured' };
      node = node[s];
    }

    const applied = [];
    const names = new Set([...body.keys()].filter((k) => !k.startsWith(':') && k !== '_charset_'));
    try {
      for (const key of names) {
        if (key.endsWith('@Delete')) {
          const p = key.slice(0, -'@Delete'.length);
          delete node[p];
          applied.push(`-${p}`);
          continue;
        }
        if (key.endsWith('@TypeHint')) continue;

        const values = body.getAll(key);
        const hint = body.get(`${key}@TypeHint`) || 'String';
        // Sling skips a property that has a hint but no value.
        if (!values.length) continue;
        node[key] = coerce(values, hint);
        applied.push(`${key}=${fmt(node[key])}`);
      }
    } catch (e) {
      return mk(200, htmlResponse(500, e.message));
    }

    if (body.has(':order')) {
      applied.push(`:order=${body.get(':order')}`);
    }
    writes.push(`write ${path} {${applied.sort().join(',')}}`);
    return mk(200, htmlResponse(200, 'modified', path));
  };
}

/* -------------------------------------------------------------- fixtures */

const base = 'D:/chrome-extensions/aem-toolkit/src/';
const { AemClient } = await import(pathToFileURL(base + 'core/aem-client.js'));
const { actions } = await import(pathToFileURL(base + 'features/page-upsert/worker.js'));
const { actions: backupActions } = await import(pathToFileURL(base + 'features/page-copy/worker.js'));

const SETTINGS = {
  rootDepth: 3,
  upsertHosts: '',
  upsertCopyAssets: true,
  upsertOverwriteAssets: false,
  upsertReorder: true,
  upsertVersionFirst: true,
  upsertStripReplication: true,
  upsertRewriteShop: false,
  upsertKeepAtDest: 'hreflangGroup'
};

const SRC_CONTENT = () => ({
  'jcr:primaryType': 'cq:PageContent',
  'jcr:title': 'Air Conditioners',
  'cq:template': '/conf/samsung/settings/wcm/templates/product',
  'sling:resourceType': 'samsung/components/page',
  'cq:lastModified': 'Wed Nov 18 2020 05:17:56 GMT+0900',
  'cq:lastReplicated': 'Thu Dec 10 2020 11:02:13 GMT+0900',
  hreflangGroup: 'samsung-ae',
  canonicalUrl: 'https://www.samsung.com/ae/air-conditioners/',
  homeLink: '/content/samsung/ae.html',
  root: {
    'jcr:primaryType': 'nt:unstructured',
    hero: {
      'jcr:primaryType': 'nt:unstructured',
      title: 'Wind-Free',
      fileReference: '/content/dam/samsung/ae/hero/ac.jpg?$ORIGIN_JPG$',
      linkURL: '/content/samsung/ae/air-conditioners/wind-free'
    },
    text: {
      'jcr:primaryType': 'nt:unstructured',
      text: '<a href="/ae/offers">o</a> <a href="shop.samsung.com/ae/buy">b</a>'
    },
    gallery: {
      'jcr:primaryType': 'nt:unstructured',
      caption: 'More at /ae/gallery',
      description: '<img src="/content/dam/samsung/ae/gone/missing.jpg"> <a href="/ae/g">g</a>'
    },
    cta: {
      'jcr:primaryType': 'nt:unstructured',
      links: ['/content/samsung/ae/buy', '/content/samsung/ae/support'],
      ratios: [1.5, 2.25],
      emptyList: []
    }
  }
});

const DEST_DRIFTED = () => ({
  'jcr:primaryType': 'cq:PageContent',
  'jcr:title': 'Air Conditioners',
  'cq:template': '/conf/samsung/settings/wcm/templates/product',
  'sling:resourceType': 'samsung/components/page',
  hreflangGroup: 'samsung-lb',
  canonicalUrl: 'https://www.samsung.com/lb/air-conditioners/',
  homeLink: '/content/samsung/ae.html',
  legacyFlag: true,
  root: {
    'jcr:primaryType': 'nt:unstructured',
    hero: {
      'jcr:primaryType': 'nt:unstructured',
      title: 'Old Title',
      fileReference: '/content/dam/samsung/lb/hero/ac.jpg?$ORIGIN_JPG$',
      linkURL: '/content/samsung/ae/air-conditioners/wind-free'
    },
    gallery: {
      'jcr:primaryType': 'nt:unstructured',
      caption: 'More at /ae/gallery',
      description: '<img src="/content/dam/samsung/ae/gone/missing.jpg"> <a href="/ae/g">g</a>'
    },
    cta: {
      'jcr:primaryType': 'nt:unstructured',
      links: ['/content/samsung/ae/buy', '/content/samsung/ae/support'],
      ratios: [1.5],
      emptyList: ['stale']
    },
    oldPromo: { 'jcr:primaryType': 'nt:unstructured', title: 'Retired' }
  }
});

const asset = () => ({ 'jcr:primaryType': 'dam:Asset' });
const folder = (kids) => ({ 'jcr:primaryType': 'sling:OrderedFolder', ...(kids || {}) });

function repo({ dest, extraDam } = {}) {
  return {
    content: {
      'jcr:primaryType': 'sling:OrderedFolder',
      samsung: {
        'jcr:primaryType': 'cq:Page',
        ae: {
          'jcr:primaryType': 'cq:Page',
          'air-conditioners': { 'jcr:primaryType': 'cq:Page', 'jcr:content': SRC_CONTENT() }
        },
        lb: {
          'jcr:primaryType': 'cq:Page',
          india: {
            'jcr:primaryType': 'cq:Page',
            backup: {
              'jcr:primaryType': 'cq:Page',
              ...(dest ? { 'air-conditioners': { 'jcr:primaryType': 'cq:Page', 'jcr:content': dest } } : {})
            }
          }
        },
        dam: undefined
      },
      dam: {
        'jcr:primaryType': 'sling:OrderedFolder',
        samsung: folder({
          ae: folder({ hero: folder({ 'ac.jpg': asset() }), ...(extraDam || {}) }),
          lb: folder({})
        })
      }
    }
  };
}

const PARAMS = {
  source: '/content/samsung/ae/air-conditioners',
  dest: '/content/samsung/lb/india/backup/air-conditioners'
};

/* ----------------------------------------------------------------- runner */

/** Child NODE names in repository order - which is component order in AEM. */
const childOrder = (root, path) => {
  const n = resolve(root, path);
  return n ? Object.keys(n).filter((k) => isNode(n[k])) : [];
};

let pass = 0;
let failed = 0;

async function run(name, { root, params = PARAMS, action = 'run', settings, opts = {}, worker = actions }, check) {
  const writes = [];
  const lines = [];
  installFetch(root, writes, opts);

  const report = (level, message, data) => {
    if (level !== 'data') lines.push(`${level.toUpperCase().padEnd(4)} ${message}`);
    else if (message === 'analysis') lines.analysis = data;
  };
  const client = new AemClient({ report });

  let error = null;
  let result = null;
  try {
    /* Someone running it has read the review and ticked "update them" for the
     * page properties it named - unless the case is about not having done so. */
    if (action === 'run' && worker === actions && !params.metadataAck && !opts.noAck) {
      const review = await actions.analyze({ client, settings: { ...SETTINGS, ...settings }, report: () => {}, params });
      if (review.metadata) params = { ...params, metadataAck: { props: review.metadata.props } };
      client.resetCaches();
    }
    result = await worker[action]({ client, settings: { ...SETTINGS, ...settings }, report, params });
  } catch (e) {
    error = e.message;
  }

  const problems = [];
  const t = {
    ok: (cond, what) => { if (!cond) problems.push(what); },
    writes,
    root,
    error,
    result,
    lines,
    analysis: lines.analysis,
    wrote: (frag) => writes.some((w) => w.includes(frag)),
    at: (p) => resolve(root, p)
  };
  try {
    check(t);
  } catch (e) {
    problems.push(`threw: ${e.message}`);
  }

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

console.log('\n--- create mode -------------------------------------------------');

await run('analyze writes absolutely nothing', { root: repo(), action: 'analyze' }, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.writes.length === 0, `expected no writes, got ${JSON.stringify(t.writes)}`);
  t.ok(t.analysis?.mode === 'create', 'mode should be create');
  t.ok(t.analysis.rewrite.enabled === true, 'rewrite should be on for ae -> lb');
});

await run('missing destination is created and rewritten', { root: repo() }, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.wrote('copyPage /content/samsung/ae/air-conditioners'), 'should copyPage');
  t.ok(t.wrote('shallow=true'), 'copy must be shallow');

  const c = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content');
  t.ok(c.canonicalUrl === 'https://www.samsung.com/lb/air-conditioners/', `canonical: ${c.canonicalUrl}`);
  t.ok(c.homeLink === '/content/samsung/lb.html', `homeLink not rewritten: ${c.homeLink}`);
  t.ok(c.root.hero.linkURL === '/content/samsung/lb/air-conditioners/wind-free', 'hero link');
  t.ok(c.root.hero.fileReference === '/content/dam/samsung/lb/hero/ac.jpg?$ORIGIN_JPG$', 'asset ref');
  t.ok(c.root.text.text.includes('/lb/offers'), 'site-relative link in rich text');
  t.ok(c.root.cta.links[0] === '/content/samsung/lb/buy', 'multi-value rewritten');
  t.ok(!('cq:lastReplicated' in c), 'inherited replication state must be cleared');
});

await run('assets are uploaded, not copied, and their folders created', { root: repo() }, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.wrote('upload /content/dam/samsung/lb/hero/ac.jpg (image/jpeg)'),
    'asset should be uploaded under its own name, the query string stripped, with its file type');
  // A repository copy is never processed by DAM, so Dynamic Media never has it.
  t.ok(!t.wrote('copy /content/dam'), `no repository copy of an asset: ${t.writes.filter((w) => w.startsWith('copy'))}`);
  const landed = t.at('/content/dam/samsung/lb/hero/ac.jpg');
  t.ok(landed?.__uploaded === true, 'asset should exist at destination, as an upload');
  t.ok(landed?.__bytes === 'bytes of /content/dam/samsung/ae/hero/ac.jpg', `the source file's bytes should be uploaded: ${landed?.__bytes}`);
  t.ok(!t.writes.some((w) => w.includes('$ORIGIN_JPG$') && w.startsWith('upload ')),
    'the Dynamic Media preset must never reach an asset name');
  t.ok(t.wrote('write /content/dam/samsung/lb/hero {'), 'the destination DAM folder should be created');
  t.ok(t.writes.indexOf(t.writes.find((w) => w.startsWith('write /content/dam/samsung/lb/hero'))) <
       t.writes.indexOf(t.writes.find((w) => w.startsWith('upload '))),
    'the folder must be created before the asset lands in it');
  t.ok(t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content').root.hero.fileReference ===
       '/content/dam/samsung/lb/hero/ac.jpg?$ORIGIN_JPG$', 'the page should point at the upload');
});

await run('an asset already at the destination is not uploaded again', {
  root: (() => { const r = repo(); r.content.dam.samsung.lb.hero = folder({ 'ac.jpg': asset() }); return r; })()
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(!t.wrote('upload '), `nothing should be uploaded: ${t.writes.filter((w) => w.startsWith('upload'))}`);
  t.ok(t.at('/content/dam/samsung/lb/hero/ac.jpg').__uploaded === undefined, 'the one there should be left as it is');
  t.ok(t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content').root.hero.fileReference.startsWith('/content/dam/samsung/lb/'),
    'the page should point at the one there');
});

await run('with "upload again" on, it is uploaded over the one there', {
  root: (() => { const r = repo(); r.content.dam.samsung.lb.hero = folder({ 'ac.jpg': asset() }); return r; })(),
  settings: { upsertOverwriteAssets: true }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.wrote('upload /content/dam/samsung/lb/hero/ac.jpg'), 'it should be uploaded over');
  t.ok(t.at('/content/dam/samsung/lb/hero/ac.jpg').__uploaded === true, 'the one there should be replaced by the upload');
  t.ok(!t.wrote('write /content/dam/samsung/lb/hero {'), 'the folder is there already, so it is not made');
});

await run('an upload the server refuses stops the run before the page is re-pointed', {
  root: repo(),
  opts: { uploadFails: ['ac.jpg'] }
}, (t) => {
  t.ok(t.error?.includes('Uploading /content/dam/samsung/lb/hero/ac.jpg failed'), `error: ${t.error}`);
  t.ok(t.error?.includes('not been re-pointed'), `the error should say the page is untouched: ${t.error}`);
  const c = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content');
  t.ok(c.root.hero.fileReference.startsWith('/content/dam/samsung/ae/'), `the page should still point at the source image: ${c.root.hero.fileReference}`);
});

await run('an upload that answers but leaves nothing there stops the run too', {
  root: repo(),
  opts: { uploadVanishes: true }
}, (t) => {
  t.ok(t.error?.includes('nothing is at /content/dam/samsung/lb/hero/ac.jpg'), `error: ${t.error}`);
  t.ok(t.error?.includes('not uploaded twice'), `the error should say a re-run is safe: ${t.error}`);
  const c = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content');
  t.ok(c.root.hero.fileReference.startsWith('/content/dam/samsung/ae/'), 'the page should still point at the source image');
});

await run('an asset the source will not hand over stops the run', {
  root: repo(),
  opts: { unreadable: ['/content/dam/samsung/ae/hero/ac.jpg'] }
}, (t) => {
  t.ok(t.error?.includes('Cannot read asset (403)') && t.error.includes('not been re-pointed'), `error: ${t.error}`);
  t.ok(!t.wrote('upload '), `nothing should be uploaded: ${t.writes.filter((w) => w.startsWith('upload'))}`);
  const c = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content');
  t.ok(c.root.hero.fileReference.startsWith('/content/dam/samsung/ae/'), 'the page should still point at the source image');
});

await run('a property naming a missing asset is still written, pointing where the asset belongs', { root: repo() }, (t) => {
  const g = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content/root/gallery');
  t.ok(g.description.includes('/content/dam/samsung/lb/gone/missing.jpg'), `image re-pointed: ${g.description}`);
  t.ok(g.description.includes('/lb/g'), `and its link with it: ${g.description}`);
  t.ok(g.caption === 'More at /lb/gallery', 'its sibling property is rewritten too');
  const row = t.result.imagesByHand?.find((a) => a.from.endsWith('missing.jpg'));
  t.ok(row?.kind === 'missing' && row.to === '/content/dam/samsung/lb/gone/missing.jpg' && /not available/.test(row.reason),
    `listed to add by hand: ${JSON.stringify(t.result.imagesByHand)}`);
});

await run('an asset deleted from the DAM but still on Dynamic Media is uploaded from there', {
  root: repo(),
  opts: { delivery: ['ae/gone/missing.jpg'] }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  const up = t.at('/content/dam/samsung/lb/gone/missing.jpg');
  t.ok(up?.__bytes === 'DM bytes of ae/gone/missing.jpg', `uploaded from Dynamic Media: ${JSON.stringify(up?.__bytes)}`);
  t.ok(t.wrote('write /content/dam/samsung/lb/gone'), 'its folder is created first');
  const g = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content/root/gallery');
  t.ok(g.description.includes('/content/dam/samsung/lb/gone/missing.jpg'), `re-pointed: ${g.description}`);
  t.ok(!t.result.imagesByHand?.some((a) => a.from.endsWith('missing.jpg')), 'uploaded, so not on the list');
});

await run('...and the analysis says where it comes from', {
  root: repo(),
  action: 'analyze',
  opts: { delivery: ['ae/gone/missing.jpg'] }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  const a = t.result.assets.find((x) => x.src.endsWith('missing.jpg'));
  t.ok(a?.action === 'upload' && a.source === 'Dynamic Media' && a.via?.startsWith('https://images.samsung.com/'),
    `row: ${JSON.stringify(a)}`);
  t.ok(t.result.counts.fromDelivery === 1 && t.result.counts.assetsMissing === 0, `counts: ${JSON.stringify(t.result.counts)}`);
});

await run('a Dynamic Media copy that cannot be read stops the run before the page is re-pointed', {
  root: repo(),
  opts: { delivery: ['ae/gone/missing.jpg'], deliveryGetFails: true }
}, (t) => {
  t.ok(String(t.error).includes('Dynamic Media') && String(t.error).includes('not been re-pointed'), `error: ${t.error}`);
  t.ok(!t.wrote('jcr:content/root/gallery'), 'the page is not written');
});

await run('AEM reporting the source path is not a failure', {
  root: repo(),
  opts: { reportPathAs: '/content/samsung/ae/air-conditioners' }
}, (t) => {
  // 6.5 copyPage reports the resource it acted on. That is every healthy copy,
  // so it must not be mistaken for a rename.
  t.ok(t.error === null, `a source-reported path should not abort: ${t.error}`);
  t.ok(t.wrote('write /content/samsung/lb/india/backup/air-conditioners'), 'the rewrite should proceed');
});

await run('a page appearing mid-run is caught by the rename', {
  root: repo(),
  opts: { collide: true }
}, (t) => {
  t.ok(String(t.error).includes('renamed to'), `expected a rename abort, got: ${t.error}`);
  t.ok(!t.wrote('write /content/samsung/lb/india/backup/air-conditioners/jcr:content'),
    'nothing may be written onto the page that was already there');
  t.ok(t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content').squatter === true,
    'the pre-existing page must be left exactly as it was');
});

await run('destination parent must exist', {
  root: repo(),
  params: { ...PARAMS, dest: '/content/samsung/lb/nope/air-conditioners' }
}, (t) => {
  t.ok(String(t.error).includes('parent does not exist'), `expected a parent abort, got: ${t.error}`);
  t.ok(t.writes.length === 0, 'nothing should be written');
});

console.log('\n--- sync mode ---------------------------------------------------');

await run('existing destination is versioned, then patched', { root: repo({ dest: DEST_DRIFTED() }) }, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.writes[0] === 'version /content/samsung/lb/india/backup/air-conditioners',
    `version must come first, got: ${t.writes[0]}`);
  t.ok(!t.wrote('copyPage'), 'an existing page must never be copyPaged over');

  const c = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content');
  t.ok(c.hreflangGroup === 'samsung-lb', `hreflangGroup must survive, got ${c.hreflangGroup}`);
  t.ok(c.homeLink === '/content/samsung/lb.html', 'stale link updated');
  t.ok(c.root.hero.title === 'Wind-Free', 'drifted title restored');
  t.ok(c.root.text !== undefined, 'component added at source should appear');
});

await run('a version AEM says it saved but did not stops the run before any write', {
  root: repo({ dest: DEST_DRIFTED() }),
  opts: { quietVersionFailure: true }
}, (t) => {
  t.ok(String(t.error).includes('no new version exists'), `should refuse, got: ${t.error}`);
  t.ok(String(t.error).includes('Nothing has been written'), 'should say nothing was written');
  t.ok(t.writes.length === 1 && t.writes[0].startsWith('version '), `only the version request, got ${JSON.stringify(t.writes)}`);
  const c = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content');
  t.ok(c.root.hero.title === 'Old Title', 'the page must be exactly as it was');
});

await run('a saved version is proven by jcr:baseVersion moving', { root: repo({ dest: DEST_DRIFTED() }) }, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  const c = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content');
  t.ok(/^version-\d+$/.test(c['jcr:baseVersion'] || ''), `a version should exist, got ${c['jcr:baseVersion']}`);
});

await run('what the source dropped is removed by default', { root: repo({ dest: DEST_DRIFTED() }) }, (t) => {
  const r = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content/root');
  t.ok(r.oldPromo === undefined, 'a component absent at source should be removed');
  const c = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content');
  t.ok(c.legacyFlag === undefined, 'a property absent at source should be removed');
  t.ok(c.root.cta.emptyList === undefined, 'a property emptied at source should be removed');
  t.ok(t.wrote('delete /content/samsung/lb/india/backup/air-conditioners/jcr:content/root/oldPromo'),
    'the delete should be issued against the component, not the page');
});

await run('removals can be turned off for a run', {
  root: repo({ dest: DEST_DRIFTED() }),
  params: { ...PARAMS, allowDeletes: false }
}, (t) => {
  const r = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content/root');
  t.ok(r.oldPromo !== undefined, 'the component should survive');
  const c = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content');
  t.ok(c.legacyFlag === true, 'the property should survive');
  t.ok(!t.wrote('delete '), 'no delete should be issued');
  t.ok(c.homeLink === '/content/samsung/lb.html', 'updates should still happen');
});

await run('a component still present at the source is never removed', {
  root: (() => {
    const r = repo({ dest: DEST_DRIFTED() });
    // Present in the repository, hidden from the scanned tree by `resurrect`.
    r.content.samsung.ae['air-conditioners']['jcr:content'].root.oldPromo = {
      'jcr:primaryType': 'nt:unstructured',
      title: 'Retired'
    };
    return r;
  })(),
  opts: { resurrect: '/content/samsung/ae/air-conditioners/jcr:content/root/oldPromo' }
}, (t) => {
  // The scanned tree said it was gone; the live re-read says otherwise. That
  // disagreement means the tree was wrong, so the delete must not go ahead.
  const r = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content/root');
  t.ok(r.oldPromo !== undefined, 'the component must survive a disagreeing re-read');
  t.ok(t.lines.some((l) => l.includes('still resolves at the source')), 'and say why');
});

await run('component order is restored', {
  root: repo({ dest: DEST_DRIFTED() }),
}, (t) => {
  const r = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content/root');
  const kids = Object.keys(r).filter((k) => k !== 'jcr:primaryType');
  t.ok(JSON.stringify(kids) === JSON.stringify(['hero', 'text', 'gallery', 'cta']),
    `order should match the source, got ${JSON.stringify(kids)}`);
});

await run('a destination whose components are in a different order is resequenced', {
  root: (() => {
    const d = DEST_DRIFTED();
    // Same components, deliberately shuffled.
    const r = d.root;
    const shuffled = { 'jcr:primaryType': r['jcr:primaryType'] };
    for (const k of ['cta', 'oldPromo', 'gallery', 'hero']) shuffled[k] = r[k];
    d.root = shuffled;
    return repo({ dest: d });
  })(),
  params: { ...PARAMS, allowDeletes: true }
}, (t) => {
  const kids = childOrder(t.root, '/content/samsung/lb/india/backup/air-conditioners/jcr:content/root');
  t.ok(JSON.stringify(kids) === JSON.stringify(['hero', 'text', 'gallery', 'cta']),
    `expected the source order, got ${JSON.stringify(kids)}`);
});

await run('an array of doubles is not sent as Long[]', { root: repo({ dest: DEST_DRIFTED() }) }, (t) => {
  const cta = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content/root/cta');
  t.ok(JSON.stringify(cta.ratios) === '[1.5,2.25]', `ratios should be written, got ${JSON.stringify(cta.ratios)}`);
  t.ok(!t.lines.some((l) => l.startsWith('FAIL')), 'nothing should have failed');
});

await run('same-site sync does no rewriting', {
  root: (() => {
    const r = repo();
    r.content.samsung.ae.backup = {
      'jcr:primaryType': 'cq:Page',
      'air-conditioners': { 'jcr:primaryType': 'cq:Page', 'jcr:content': SRC_CONTENT() }
    };
    return r;
  })(),
  params: {
    source: '/content/samsung/ae/air-conditioners',
    dest: '/content/samsung/ae/backup/air-conditioners'
  },
  action: 'analyze'
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.analysis.rewrite.enabled === false, 'same site means no rewriting');
  t.ok(t.analysis.mode === 'sync', 'destination exists, so sync');
  t.ok(t.analysis.counts.properties === 0, 'identical pages should need no property writes');
});

console.log('\n--- updates, told apart ----------------------------------------');

{
  const kindOf = (a, node, prop) => a.props.updated.find((c) => c.node === node && c.prop === prop)?.kind;
  await run('a create shows image paths and links apart from the text and settings', { root: repo(), action: 'analyze' }, (t) => {
    const a = t.analysis;
    t.ok(kindOf(a, '/root/hero', 'fileReference') === 'image', `fileReference: ${kindOf(a, '/root/hero', 'fileReference')}`);
    for (const [node, prop] of [['(page properties)', 'canonicalUrl'], ['(page properties)', 'homeLink'], ['/root/hero', 'linkURL'], ['/root/cta', 'links']]) {
      t.ok(kindOf(a, node, prop) === 'link', `${node} ${prop}: ${kindOf(a, node, prop)}`);
    }
    t.ok(kindOf(a, '/root/text', 'text') === 'link', `rich text whose only change is its links: ${kindOf(a, '/root/text', 'text')}`);
    t.ok(a.props.updated.every((c) => ['image', 'link', 'other'].includes(c.kind)), 'every update has a kind');
  });
  await run('a sync keeps a changed title and setting under Properties updated', { root: repo({ dest: DEST_DRIFTED() }), action: 'analyze' }, (t) => {
    const a = t.analysis;
    t.ok(kindOf(a, '/root/hero', 'title') === 'other', `title: ${kindOf(a, '/root/hero', 'title')}`);
    t.ok(kindOf(a, '/root/cta', 'ratios') === 'other', `ratios: ${kindOf(a, '/root/cta', 'ratios')}`);
  });

  const { changeKind } = await import(pathToFileURL(base + 'core/diff.js'));
  const { buildRules, resolveSites } = await import(pathToFileURL(base + 'core/rewrite.js'));
  const ctx = buildRules(resolveSites({ source: '/content/samsung/ae/x', dest: '/content/samsung/lb/x', rootDepth: 3 }));
  const cases = [
    ['a DAM path', '/content/dam/samsung/ae/a.jpg', '/content/dam/samsung/lb/a.jpg', 'image'],
    ['a Dynamic Media URL', '//images.samsung.com/is/image/samsung/p6pim/ae/a', '//images.samsung.com/is/image/samsung/p6pim/lb/a', 'image'],
    ['a media file', 'https://cdn.example.com/v/intro.mp4', 'https://cdn.example.com/v/intro-2.mp4', 'image'],
    ['a page link', '/content/samsung/ae/tvs', '/content/samsung/lb/tvs', 'link'],
    ['a URL', 'https://www.samsung.com/ae/tvs/', 'https://www.samsung.com/lb/tvs/', 'link'],
    ['an anchor', '#specs', '#features', 'link'],
    ['a list of links', ['/ae/a', '/ae/b'], ['/lb/a', '/lb/b'], 'link'],
    ['a colour is a setting, not an anchor', '#ffffff', '#000000', 'other'],
    ['text whose only change is its image', '<img src="/content/dam/samsung/ae/a.jpg">', '<img src="/content/dam/samsung/lb/a.jpg">', 'image'],
    ['text with an image and a link re-pointed', '<img src="/content/dam/samsung/ae/a.jpg"> <a href="/ae/b">b</a>', '<img src="/content/dam/samsung/lb/a.jpg"> <a href="/lb/b">b</a>', 'link'],
    ['text that changed, links or not', '<a href="/lb/b">Old words</a>', '<a href="/lb/b">New words</a>', 'other'],
    ['a title', 'Old Title', 'Wind-Free', 'other'],
    ['a number', 1.5, 2, 'other']
  ];
  const wrong = cases.filter(([, from, to, want]) => changeKind(from, to, ctx) !== want);
  console.log(`${wrong.length ? 'FAIL' : 'PASS'}  each kind of change is told apart (${cases.length} cases)`);
  for (const [name, from, to, want] of wrong) console.log(`        - ${name}: ${changeKind(from, to, ctx)}, want ${want}`);
  wrong.length ? failed++ : pass++;
}

console.log('\n--- a shared source site: keep its images, keep its links --------');

{
  const { DEFAULT_SETTINGS } = await import(pathToFileURL(base + 'core/protocol.js'));
  console.log(`${DEFAULT_SETTINGS.upsertSharedSites === 'global' ? 'PASS' : 'FAIL'}  the shared site is /global unless settings say otherwise`);
  DEFAULT_SETTINGS.upsertSharedSites === 'global' ? pass++ : failed++;

  // The test repository copies ae -> lb, so ae stands in for /global here.
  const SHARED = { upsertSharedSites: 'ae' };
  const DEST_CONTENT = '/content/samsung/lb/india/backup/air-conditioners/jcr:content';

  await run('from a shared site both choices are offered, with how much each is about', { root: repo(), action: 'analyze', settings: SHARED }, (t) => {
    const c = t.analysis.choice;
    t.ok(c.offered === true && c.keepImages === false && c.keepLinks === false, `choice: ${JSON.stringify(c)}`);
    t.ok(c.images === 2 && c.links === 7, `counted ${c.images} image paths and ${c.links} links`);
  });
  await run('from any other site they are not - and asking for them changes nothing', {
    root: repo(),
    params: { ...PARAMS, keepImages: true, keepLinks: true }
  }, (t) => {
    t.ok(t.result.choice.offered === false, `choice: ${JSON.stringify(t.result.choice)}`);
    t.ok(t.wrote('upload /content/dam/samsung/lb/hero/ac.jpg'), 'the image should still be uploaded');
    t.ok(t.at(DEST_CONTENT).root.hero.linkURL === '/content/samsung/lb/air-conditioners/wind-free', 'the link should still be re-pointed');
  });
  await run('images kept: none copied, no folder made, every image path as it was - links still re-pointed', {
    root: repo(),
    settings: SHARED,
    params: { ...PARAMS, keepImages: true }
  }, (t) => {
    t.ok(t.error === null, `errored: ${t.error}`);
    t.ok(!t.wrote('upload '), `no image should be uploaded: ${t.writes.filter((w) => w.startsWith('upload'))}`);
    t.ok(!t.wrote('write /content/dam/samsung/lb'), 'no DAM folder should be created');
    const c = t.at(DEST_CONTENT);
    t.ok(c.root.hero.fileReference === '/content/dam/samsung/ae/hero/ac.jpg?$ORIGIN_JPG$', `image path: ${c.root.hero.fileReference}`);
    t.ok(c.root.hero.linkURL === '/content/samsung/lb/air-conditioners/wind-free', `link: ${c.root.hero.linkURL}`);
    t.ok(c.canonicalUrl === 'https://www.samsung.com/lb/air-conditioners/', `canonical: ${c.canonicalUrl}`);
    t.ok(!t.result.leftovers.some((l) => l.link.startsWith('/content/dam/samsung/ae')), `kept image paths are not "left over": ${JSON.stringify(t.result.leftovers)}`);
    t.ok(!t.result.props.updated.some((u) => u.kind === 'image'), 'nothing under Image paths updated');
  });
  await run('links kept: every link as it was - images still copied and re-pointed', {
    root: repo(),
    settings: SHARED,
    params: { ...PARAMS, keepLinks: true }
  }, (t) => {
    t.ok(t.error === null, `errored: ${t.error}`);
    const c = t.at(DEST_CONTENT);
    t.ok(c.root.hero.linkURL === '/content/samsung/ae/air-conditioners/wind-free', `link: ${c.root.hero.linkURL}`);
    t.ok(c.homeLink === '/content/samsung/ae.html' && c.canonicalUrl === 'https://www.samsung.com/ae/air-conditioners/', `${c.homeLink} ${c.canonicalUrl}`);
    t.ok(c.root.text.text.includes('/ae/offers') && c.root.cta.links[0] === '/content/samsung/ae/buy', 'links in text and in lists as they were');
    t.ok(t.wrote('upload /content/dam/samsung/lb/hero/ac.jpg'), 'the image should still be uploaded');
    t.ok(c.root.hero.fileReference === '/content/dam/samsung/lb/hero/ac.jpg?$ORIGIN_JPG$', `image path: ${c.root.hero.fileReference}`);
    t.ok(!t.result.leftovers.some((l) => /\/ae\/(offers|gallery)|samsung\/ae\/buy/.test(l.link)), `kept links are not "left over": ${JSON.stringify(t.result.leftovers)}`);
  });
  await run('both kept: the page is copied as it is, nothing re-pointed', {
    root: repo(),
    settings: SHARED,
    params: { ...PARAMS, keepImages: true, keepLinks: true }
  }, (t) => {
    t.ok(t.error === null, `errored: ${t.error}`);
    t.ok(t.wrote('copyPage /content/samsung/ae/air-conditioners'), 'the page should be copied');
    t.ok(!t.wrote('upload '), 'no image uploaded');
    const c = t.at(DEST_CONTENT);
    t.ok(c.root.hero.linkURL === '/content/samsung/ae/air-conditioners/wind-free' && c.root.hero.fileReference.startsWith('/content/dam/samsung/ae/'), 'as the source has them');
    t.ok(!('cq:lastReplicated' in c), 'the inherited replication state is still cleared');
    t.ok(t.result.counts.properties === 0, `properties written: ${t.result.counts.properties}`);
  });
}

console.log('\n--- links to other sites ---------------------------------------');

{
  const { otherSiteLinks, buildRules, resolveSites, rewriteValue } = await import(pathToFileURL(base + 'core/rewrite.js'));
  const { changeKind } = await import(pathToFileURL(base + 'core/diff.js'));
  const sites = resolveSites({ source: '/content/samsung/global/hq/x', dest: '/content/samsung/ae/x', rootDepth: 3, hosts: ['www.samsung.com'] });
  const found = (v) => otherSiteLinks(v, sites).map((o) => `${o.site} ${o.link}`);
  const cases = [
    ['a URL to another site', 'https://www.samsung.com/uk/tvs/all-tvs/', ['uk https://www.samsung.com/uk/tvs/all-tvs/']],
    ['a /content path to another site', '/content/samsung/uk/tvs/help-me-choose/', ['uk /content/samsung/uk/tvs/help-me-choose/']],
    ['any site, not a list of them', 'https://www.samsung.com/levant_ar/offers/', ['levant_ar https://www.samsung.com/levant_ar/offers/']],
    ['inside rich text and script', '<a href="https://www.samsung.com/uk/a/">a</a> const l = ["https://www.samsung.com/us/b/"]', ['uk https://www.samsung.com/uk/a/', 'us https://www.samsung.com/us/b/']],
    ['not the source site', '/content/samsung/global/hq/vd/tvs/', []],
    ['not the destination site', 'https://www.samsung.com/ae/tvs/', []],
    ['not a placeholder', 'https://www.samsung.com/{site-code}/tvs/', []],
    ['not the site’s own files', 'https://www.samsung.com/etc.clientlibs/samsung/x.png', []],
    ['not a DAM path', '/content/dam/samsung/uk/tvs/a.jpg', []],
    ['not an image host nobody listed', 'https://stg-images.samsung.com/is/image/samsung/assets/uk/a.jpg', []],
    ['not a bare path inside text', '<a href="/uk/tvs/">x</a>', []],
    ['a site home page as .html', '<a href="/content/samsung/uk.html">UK</a> or https://www.samsung.com/uk.html', ['uk /content/samsung/uk.html', 'uk https://www.samsung.com/uk.html']],
    ['a link ending a sentence, without its full stop', 'Visit www.samsung.com/uk/tvs/. Or www.samsung.com/uk.', ['uk www.samsung.com/uk/tvs/', 'uk www.samsung.com/uk']],
    ['a link inside another link’s query', 'https://www.samsung.com/global/login?returnUrl=https://www.samsung.com/uk/business/', ['uk https://www.samsung.com/uk/business/']],
    ['a link in escaped markup ends at the escaped quote', 'href=&quot;https://www.samsung.com/uk/tvs/&quot;>TVs', ['uk https://www.samsung.com/uk/tvs/']],
    ['not the paths www.samsung.com serves beside its sites', 'https://www.samsung.com/aemapi/v6/x?sku=1 https://www.samsung.com/common/review/', []],
    ['not a file at the host’s root', 'https://www.samsung.com/favicon.ico', []]
  ];
  const wrong = cases.filter(([, v, want]) => JSON.stringify(found(v)) !== JSON.stringify(want));
  console.log(`${wrong.length ? 'FAIL' : 'PASS'}  links to other sites are found on the page, whatever the site (${cases.length} cases)`);
  for (const [name, v, want] of wrong) console.log(`        - ${name}: ${JSON.stringify(found(v))}, want ${JSON.stringify(want)}`);
  wrong.length ? failed++ : pass++;

  const ctx = buildRules(sites, { alsoSites: ['uk'] });
  const rewrites = [
    ['https://www.samsung.com/uk/tvs/all-tvs/', 'https://www.samsung.com/ae/tvs/all-tvs/'],
    ['/content/samsung/uk/tvs/help-me-choose/', '/content/samsung/ae/tvs/help-me-choose/'],
    ['<a href="https://www.samsung.com/uk/a/">a</a>', '<a href="https://www.samsung.com/ae/a/">a</a>'],
    ['https://www.samsung.com/us/b/', 'https://www.samsung.com/us/b/'],
    ['/content/dam/samsung/uk/tvs/a.jpg', '/content/dam/samsung/uk/tvs/a.jpg'],
    ['<a href="/uk/tvs/">x</a>', '<a href="/uk/tvs/">x</a>']
  ];
  const bad = rewrites.filter(([from, want]) => rewriteValue(from, ctx) !== want);
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  a ticked site's links point at the destination - only that site, only its written-out links, never its images`);
  for (const [from, want] of bad) console.log(`        - ${from}: ${rewriteValue(from, ctx)}, want ${want}`);
  bad.length ? failed++ : pass++;
  const kind = changeKind('<p>See <a href="https://www.samsung.com/uk/a/">all</a></p>', '<p>See <a href="https://www.samsung.com/ae/a/">all</a></p>', ctx);
  console.log(`${kind === 'link' ? 'PASS' : 'FAIL'}  text whose only change is another site's links is under Links updated (${kind})`);
  kind === 'link' ? pass++ : failed++;
  const mixed = changeKind(
    '<p><img src="/content/dam/samsung/global/hq/a.jpg"> See <a href="https://www.samsung.com/uk/tvs/">all</a></p>',
    '<p><img src="/content/dam/samsung/ae/hq/a.jpg"> See <a href="https://www.samsung.com/ae/tvs/">all</a></p>',
    ctx
  );
  const imageOnly = changeKind('<p><img src="/content/dam/samsung/global/hq/a.jpg"></p>', '<p><img src="/content/dam/samsung/ae/hq/a.jpg"></p>', ctx);
  console.log(`${mixed === 'link' && imageOnly === 'image' ? 'PASS' : 'FAIL'}  a text changing an image and another site's link is a link change; an image alone is an image change (${mixed}, ${imageOnly})`);
  mixed === 'link' && imageOnly === 'image' ? pass++ : failed++;

  // A destination locale written as two segments: /in is part of it, never another site.
  const twoPart = resolveSites({ source: '/content/samsung/global/hq/x', dest: '/content/samsung/in/en/x', rootDepth: 3, destSite: 'in/en', hosts: ['www.samsung.com'] });
  const inRules = buildRules(twoPart, { alsoSites: ['in'] });
  const doubled = rewriteValue('/content/samsung/global/hq/tvs/oled/', inRules);
  const okTwoPart = otherSiteLinks('https://www.samsung.com/in/tvs/', twoPart).length === 0 && doubled === '/content/samsung/in/en/hq/tvs/oled/';
  console.log(`${okTwoPart ? 'PASS' : 'FAIL'}  with a destination of in/en, /in is not another site - asking for it doubles nothing (${doubled})`);
  okTwoPart ? pass++ : failed++;

  // The test repository copies ae -> lb; its source gains links to /uk.
  const withUk = () => {
    const root = repo();
    root.content.samsung.uk = { 'jcr:primaryType': 'cq:Page' }; // a site AEM has - /semiconductor is not one
    const src = root.content.samsung.ae['air-conditioners']['jcr:content'];
    src.root.hero.shopLink = 'https://www.samsung.com/uk/air-conditioners/all/';
    src.root.hero.ssdLink = 'https://www.samsung.com/semiconductor/minisite/ssd/';
    src.root.text.more = '<a href="https://www.samsung.com/uk/offers/">offers</a> and <a href="/content/samsung/uk/support/">support</a>';
    // Never written, so never counted: kept at the destination, and held back for a missing image.
    src.hreflangGroup = 'https://www.samsung.com/uk/air-conditioners/';
    src.root.gallery.description += ' <a href="https://www.samsung.com/uk/gallery/">uk</a>';
    return root;
  };
  const DEST_CONTENT = '/content/samsung/lb/india/backup/air-conditioners/jcr:content';
  await run('links to another site are listed with a tick box, ticked: they point at the destination', { root: withUk() }, (t) => {
    t.ok(t.error === null, `errored: ${t.error}`);
    const uk = t.result.otherSites.find((o) => o.site === 'uk');
    t.ok(uk && uk.properties === 3 && uk.repointed === true && uk.links.length === 4, `otherSites: ${JSON.stringify(t.result.otherSites)}`);
    t.ok(!t.result.otherSites.some((o) => o.site === 'ae' || o.site === 'lb'), 'the source and destination are never "other"');
    t.ok(!t.result.otherSites.some((o) => o.site === 'semiconductor'), 'a path AEM has no site for is never taken for one');
    t.ok(t.at(DEST_CONTENT).root.hero.ssdLink === 'https://www.samsung.com/semiconductor/minisite/ssd/', 'and its link is left alone');
    const c = t.at(DEST_CONTENT);
    t.ok(c.root.hero.shopLink === 'https://www.samsung.com/lb/air-conditioners/all/', `shopLink: ${c.root.hero.shopLink}`);
    t.ok(c.root.text.more.includes('https://www.samsung.com/lb/offers/') && c.root.text.more.includes('/content/samsung/lb/support/'), `text: ${c.root.text.more}`);
    t.ok(c.root.hero.linkURL === '/content/samsung/lb/air-conditioners/wind-free' && c.root.hero.fileReference.includes('/samsung/lb/'), 'the source site still re-pointed');
    t.ok(t.result.props.updated.filter((u) => ['shopLink', 'more'].includes(u.prop)).every((u) => u.kind === 'link'), 'under Links updated');
  });
  await run('unticked, they are left as they are - the rest of the run as it was', {
    root: withUk(),
    params: { ...PARAMS, keepSites: ['uk'] }
  }, (t) => {
    t.ok(t.error === null, `errored: ${t.error}`);
    const c = t.at(DEST_CONTENT);
    t.ok(c.root.hero.shopLink === 'https://www.samsung.com/uk/air-conditioners/all/', `untouched: ${c.root.hero.shopLink}`);
    t.ok(c.root.text.more.includes('https://www.samsung.com/uk/offers/') && c.root.text.more.includes('/content/samsung/uk/support/'), `text: ${c.root.text.more}`);
    t.ok(c.root.hero.linkURL === '/content/samsung/lb/air-conditioners/wind-free', 'the source site still re-pointed');
    t.ok(t.result.otherSites.find((o) => o.site === 'uk').repointed === false, 'shown as left');
  });
  await run('leaving a site the page does not link to changes nothing - the others are still re-pointed', {
    root: withUk(),
    params: { ...PARAMS, keepSites: 'us, fr' }
  }, (t) => {
    t.ok(t.error === null, `errored: ${t.error}`);
    const c = t.at(DEST_CONTENT);
    t.ok(c.root.hero.shopLink === 'https://www.samsung.com/lb/air-conditioners/all/', `uk re-pointed: ${c.root.hero.shopLink}`);
    t.ok(t.result.otherSites.length === 1 && t.result.otherSites[0].repointed, JSON.stringify(t.result.otherSites));
  });
}

console.log('\n--- refusals ----------------------------------------------------');

await run('an unreadable asset blocks the run', {
  root: repo(),
  opts: { forbidden: ['/content/dam/samsung/ae/hero/ac.jpg'] }
}, (t) => {
  t.ok(String(t.error).includes('Refusing to write'), `expected a refusal, got: ${t.error}`);
  t.ok(t.writes.length === 0, `nothing should be written, got ${JSON.stringify(t.writes)}`);
});

/* oldPromo and d1-d6 are not at the source: 7 removals, over a quarter of the destination. */
const MASS_DELETE = () => {
  const d = DEST_DRIFTED();
  for (const n of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']) {
    d.root[n] = { 'jcr:primaryType': 'nt:unstructured' };
  }
  return repo({ dest: d });
};

await run('a mass deletion is flagged for confirmation, not blocked', { root: MASS_DELETE(), action: 'analyze' }, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.analysis.blockers.length === 0, `it should not be a blocker: ${JSON.stringify(t.analysis.blockers)}`);
  t.ok(String(t.analysis.largeRemoval).includes('This would remove 7 of'), `largeRemoval: ${t.analysis.largeRemoval}`);
  t.ok(t.lines.some((l) => l.startsWith('WARN') && l.includes('confirm the removal')), 'the log should say it waits for a confirmation');
});

await run('an unconfirmed mass deletion is refused', { root: MASS_DELETE() }, (t) => {
  t.ok(String(t.error).includes('Refusing to write'), `expected a refusal, got: ${t.error}`);
  t.ok(t.writes.length === 0, 'nothing should be written, not even the version');
});

await run('a mass deletion confirmed for fewer removals than the run would make is refused', {
  root: MASS_DELETE(),
  params: { ...PARAMS, removalsAck: { nodes: 6, props: 99 } }
}, (t) => {
  t.ok(String(t.error).includes('Refusing to write'), `expected a refusal, got: ${t.error}`);
  t.ok(t.writes.length === 0, 'nothing should be written, not even the version');
});

await run('a confirmed mass deletion runs', {
  root: MASS_DELETE(),
  params: { ...PARAMS, removalsAck: { nodes: 7, props: 3 } }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  const r = t.at('/content/samsung/lb/india/backup/air-conditioners/jcr:content/root');
  for (const n of ['oldPromo', 'd1', 'd6']) t.ok(r[n] === undefined, `${n} should be removed`);
  t.ok(r.hero.title === 'Wind-Free', 'the rest of the sync should happen too');
});

await run('a truncated source aborts rather than planning against half a page', {
  root: repo({ dest: DEST_DRIFTED() }),
  opts: { truncate: true }
}, (t) => {
  t.ok(String(t.error).includes('json.maximumresults'), `expected a truncation abort, got: ${t.error}`);
  t.ok(t.writes.length === 0, 'nothing should be written');
});

await run('a source at the JSON limit turns deletions off rather than acting on a short tree', {
  root: (() => {
    const d = DEST_DRIFTED();
    const r = repo({ dest: d });
    // Wide enough to sit on AEM's json.maximumresults default.
    const content = r.content.samsung.ae['air-conditioners']['jcr:content'];
    for (let i = 0; i < 950; i++) {
      content.root[`filler${i}`] = { 'jcr:primaryType': 'nt:unstructured', n: i };
    }
    return r;
  })(),
  action: 'analyze'
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.analysis.truncationRisk === true, 'the risk should be flagged');
  t.ok(t.analysis.deletesEnabled === false, 'deletions must be forced off');
  t.ok(t.analysis.nodes.deleted.length === 0, 'nothing may be queued for deletion');
  t.ok(t.lines.some((l) => l.includes('truncated')), 'the operator should be told why');
});

await run('a forbidden source subtree aborts', {
  root: repo(),
  opts: { forbidden: ['/content/samsung/ae/air-conditioners/jcr:content'] }
}, (t) => {
  t.ok(t.error !== null, 'should abort rather than treat 403 as empty');
  t.ok(t.writes.length === 0, 'nothing should be written');
});

await run('source and destination cannot be the same', {
  root: repo(),
  params: { source: PARAMS.source, dest: PARAMS.source }
}, (t) => {
  t.ok(String(t.error).includes('same path'), `got: ${t.error}`);
});

console.log('\n--- site values: handle, title ending, language -----------------');

/* lb and levant as they are on the author server: what each home page says the site is called. */
const LB_HOME = () => ({
  'jcr:primaryType': 'cq:PageContent',
  'jcr:title': 'Mobiles, TVs, and Home Appliances',
  ogTitle: 'Mobiles, TVs, and Home Appliances | Samsung Lebanon',
  twitterTitle: 'Mobiles, TVs, and Home Appliances | Samsung Lebanon',
  twitterSite: '@SamsungLB',
  twitterCreator: '@SamsungLB',
  'jcr:language': 'en_LB'
});
const LEVANT_HOME = () => ({
  'jcr:primaryType': 'cq:PageContent',
  'jcr:title': 'Mobiles, Home Appliances, Electronics & More',
  ogTitle: 'Mobiles, Home Appliances, Electronics & More | Samsung Jordan',
  twitterTitle: 'Mobiles, Home Appliances, Electronics & More | Samsung Jordan',
  twitterSite: '@SamsungLEVANT',
  twitterCreator: '@SamsungLEVANT',
  'jcr:language': 'en-JO'
});
const LB_PAGE = () => ({
  'jcr:primaryType': 'cq:PageContent',
  'jcr:title': 'Air Conditioners',
  'cq:template': '/conf/samsung/settings/wcm/templates/product',
  'sling:resourceType': 'samsung/components/page',
  ogTitle: 'Air Conditioners | Samsung Lebanon',
  twitterTitle: 'Air Conditioners | Samsung Lebanon',
  twitterSite: '@SamsungLB',
  twitterCreator: '@SamsungLB',
  'jcr:language': 'en_LB',
  description: 'Cool air from Samsung Lebanon.',
  root: { 'jcr:primaryType': 'nt:unstructured', text: { 'jcr:primaryType': 'nt:unstructured', text: 'Wind-Free' } }
});
/* A levant page someone already put right by hand after an earlier sync. */
const LEVANT_BY_HAND = () => ({
  ...LB_PAGE(),
  ogTitle: 'Air Conditioners | Samsung Jordan',
  twitterTitle: 'Air Conditioners | Samsung Jordan',
  twitterSite: '@SamsungLEVANT',
  twitterCreator: '@SamsungLEVANT',
  'jcr:language': 'en-JO'
});

function siteRepo({ dest, levantHome = LEVANT_HOME() } = {}) {
  return {
    content: {
      'jcr:primaryType': 'sling:OrderedFolder',
      samsung: {
        'jcr:primaryType': 'cq:Page',
        lb: {
          'jcr:primaryType': 'cq:Page',
          'jcr:content': LB_HOME(),
          'air-conditioners': { 'jcr:primaryType': 'cq:Page', 'jcr:content': LB_PAGE() }
        },
        levant: {
          'jcr:primaryType': 'cq:Page',
          ...(levantHome ? { 'jcr:content': levantHome } : {}),
          ...(dest ? { 'air-conditioners': { 'jcr:primaryType': 'cq:Page', 'jcr:content': dest } } : {})
        }
      },
      dam: { 'jcr:primaryType': 'sling:OrderedFolder', samsung: folder({ lb: folder({}), levant: folder({}) }) }
    }
  };
}
const SITE_PARAMS = { source: '/content/samsung/lb/air-conditioners', dest: '/content/samsung/levant/air-conditioners' };
const LEVANT_PC = '/content/samsung/levant/air-conditioners/jcr:content';
const LEVANT_VALUES = {
  twitterSite: '@SamsungLEVANT',
  twitterCreator: '@SamsungLEVANT',
  ogTitle: 'Air Conditioners | Samsung Jordan',
  twitterTitle: 'Air Conditioners | Samsung Jordan',
  'jcr:language': 'en-JO'
};
const valuesOf = (c) => Object.fromEntries(Object.keys(LEVANT_VALUES).map((p) => [p, c?.[p]]));
const wroteSiteProp = (t) => t.writes.some((w) => w.startsWith(`write ${LEVANT_PC} {`) && /twitter|ogTitle|jcr:language/.test(w));

await run('site values: the review lists them in their own box and writes nothing', {
  root: siteRepo(), params: SITE_PARAMS, action: 'analyze'
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.writes.length === 0, `nothing written: ${JSON.stringify(t.writes)}`);
  const s = t.analysis.site;
  t.ok(s?.applied === true && s.to === '/content/samsung/levant' && s.from === '/content/samsung/lb', `site: ${JSON.stringify(s)}`);
  t.ok(s?.rows.length === 5 && s.rows.every((r) => LEVANT_VALUES[r.prop] === r.to), `rows: ${JSON.stringify(s?.rows)}`);
  t.ok(!t.analysis.props.updated.some((c) => c.prop === 'twitterSite' && c.kind !== 'site'),
    'the handle is not also listed as an ordinary property');
  t.ok(t.lines.some((l) => l.startsWith('INFO') && l.includes('Site values from /content/samsung/levant')), 'the log says so');
});

await run('site values: a new page gets the destination site\'s handle, title ending and language', {
  root: siteRepo(), params: SITE_PARAMS
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  const c = t.at(LEVANT_PC);
  t.ok(JSON.stringify(valuesOf(c)) === JSON.stringify(LEVANT_VALUES), `values: ${JSON.stringify(valuesOf(c))}`);
  t.ok(c.description === 'Cool air from Samsung Lebanon.', `the description is copy, not a site value: ${c.description}`);
  t.ok(c['jcr:title'] === 'Air Conditioners', `the title itself is not touched: ${c['jcr:title']}`);
  t.ok(t.result.site?.applied && t.result.site.rows.length === 5 && !t.result.site.rows.some((r) => r.failed),
    `the done screen has them: ${JSON.stringify(t.result.site)}`);
  t.ok(t.lines.some((l) => l.startsWith('OK') && l.includes('Site values set from /content/samsung/levant')), 'the log says what went in');
});

await run('site values unticked: a new page keeps the source\'s, and says so', {
  root: siteRepo(), params: { ...SITE_PARAMS, keepSiteValues: true }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  const c = t.at(LEVANT_PC);
  t.ok(c.twitterSite === '@SamsungLB' && c.ogTitle === 'Air Conditioners | Samsung Lebanon' && c['jcr:language'] === 'en_LB',
    `the copy's values: ${JSON.stringify(valuesOf(c))}`);
  t.ok(t.result.site?.applied === false && t.result.site.rows.length === 5, `listed as not set: ${JSON.stringify(t.result.site)}`);
});

await run('site values: an existing page with the source\'s old values is put right', {
  root: siteRepo({ dest: LB_PAGE() }), params: SITE_PARAMS
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(JSON.stringify(valuesOf(t.at(LEVANT_PC))) === JSON.stringify(LEVANT_VALUES), `values: ${JSON.stringify(valuesOf(t.at(LEVANT_PC)))}`);
});

await run('site values: a page already put right by hand is left alone', {
  root: siteRepo({ dest: LEVANT_BY_HAND() }), params: SITE_PARAMS
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(JSON.stringify(valuesOf(t.at(LEVANT_PC))) === JSON.stringify(LEVANT_VALUES), `values: ${JSON.stringify(valuesOf(t.at(LEVANT_PC)))}`);
  t.ok(!wroteSiteProp(t), `none of them rewritten: ${JSON.stringify(t.writes)}`);
  t.ok(t.result.site === null, `nothing to show: ${JSON.stringify(t.result.site)}`);
});

await run('site values unticked: a page put right by hand is not overwritten with the source\'s', {
  root: siteRepo({ dest: LEVANT_BY_HAND() }), params: { ...SITE_PARAMS, keepSiteValues: true }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(JSON.stringify(valuesOf(t.at(LEVANT_PC))) === JSON.stringify(LEVANT_VALUES), `values: ${JSON.stringify(valuesOf(t.at(LEVANT_PC)))}`);
  t.ok(!wroteSiteProp(t), `none of them written: ${JSON.stringify(t.writes)}`);
});

await run('site values unticked: an existing page keeps what it has', {
  root: siteRepo({ dest: { ...LB_PAGE(), twitterSite: '@Mine' } }), params: { ...SITE_PARAMS, keepSiteValues: true }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  const c = t.at(LEVANT_PC);
  t.ok(c.twitterSite === '@Mine', `left as it was: ${c.twitterSite}`);
  t.ok(!wroteSiteProp(t), `none of them written: ${JSON.stringify(t.writes)}`);
  t.ok(t.result.site?.rows.find((r) => r.prop === 'twitterSite')?.keeps === '@Mine', `the review says what stays: ${JSON.stringify(t.result.site)}`);
});

await run('site values: a destination home page that is not there - nothing guessed, and the review says why', {
  root: siteRepo({ levantHome: null }), params: SITE_PARAMS
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  const c = t.at(LEVANT_PC);
  t.ok(c.twitterSite === '@SamsungLB' && c.ogTitle === 'Air Conditioners | Samsung Lebanon', `the source's values: ${JSON.stringify(valuesOf(c))}`);
  t.ok(t.result.site?.rows.length === 0 && t.result.site.notes.some((n) => n.includes('Could not read /content/samsung/levant')),
    `said why: ${JSON.stringify(t.result.site)}`);
  t.ok(t.lines.some((l) => l.startsWith('WARN') && l.includes('Could not read /content/samsung/levant')), 'and the log too');
});

await run('site values: a page with none of them has no box', { root: repo(), action: 'analyze' }, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.analysis.site === null, `no site values without a site change: ${JSON.stringify(t.analysis.site)}`);
});

console.log('\n--- an existing page\'s page properties: confirmed first -------------');

await run('page properties: the review names the ones that would change on an existing page', {
  root: siteRepo({ dest: LB_PAGE() }), params: SITE_PARAMS, action: 'analyze'
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  const m = t.analysis.metadata;
  t.ok(m && JSON.stringify(m.props) === JSON.stringify(['jcr:language', 'ogTitle', 'twitterCreator', 'twitterSite', 'twitterTitle']),
    `metadata: ${JSON.stringify(m)}`);
  t.ok(m?.count === m?.props.length, 'the count is the list');
});

await run('page properties: not confirmed, nothing at all is written - not even the version', {
  root: siteRepo({ dest: LB_PAGE() }), params: SITE_PARAMS, opts: { noAck: true }
}, (t) => {
  t.ok(String(t.error).includes('Refusing to write') && String(t.error).includes('twitterSite') && String(t.error).includes('tick the box'),
    `should refuse and say why: ${t.error}`);
  t.ok(t.writes.length === 0, `nothing written: ${JSON.stringify(t.writes)}`);
  t.ok(t.at(LEVANT_PC).twitterSite === '@SamsungLB', 'the page is as it was');
});

await run('page properties: confirmed for fewer than would change is refused', {
  root: siteRepo({ dest: LB_PAGE() }), params: { ...SITE_PARAMS, metadataAck: { props: ['twitterSite'] } }
}, (t) => {
  t.ok(String(t.error).includes('Refusing to write'), `should refuse: ${t.error}`);
  t.ok(t.writes.length === 0, `nothing written: ${JSON.stringify(t.writes)}`);
});

await run('page properties: confirmed, they are written', {
  root: siteRepo({ dest: LB_PAGE() }),
  params: { ...SITE_PARAMS, metadataAck: { props: ['jcr:language', 'ogTitle', 'twitterCreator', 'twitterSite', 'twitterTitle'] } }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.at(LEVANT_PC).twitterSite === '@SamsungLEVANT', `twitterSite: ${t.at(LEVANT_PC).twitterSite}`);
});

await run('page properties: a new page asks nothing', { root: siteRepo(), params: SITE_PARAMS, opts: { noAck: true } }, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.result.metadata === null, `nothing to confirm on a create: ${JSON.stringify(t.result.metadata)}`);
});

await run('page properties: an existing page whose page properties stay as they are asks nothing', {
  root: siteRepo({ dest: { ...LEVANT_BY_HAND(), root: { 'jcr:primaryType': 'nt:unstructured', text: { 'jcr:primaryType': 'nt:unstructured', text: 'Old' } } } }),
  params: SITE_PARAMS, opts: { noAck: true }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.result.metadata === null, `only a component changed: ${JSON.stringify(t.result.metadata)}`);
  t.ok(t.at(LEVANT_PC).root.text.text === 'Wind-Free', 'the component is synced');
});

await run('page properties: with the site values unticked and nothing else changing, there is nothing to confirm', {
  root: siteRepo({ dest: { ...LB_PAGE(), 'jcr:language': 'en_LB' } }), params: { ...SITE_PARAMS, keepSiteValues: true }, action: 'analyze'
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.analysis.metadata === null, `nothing changes on the page: ${JSON.stringify(t.analysis.metadata)}`);
});

console.log('\n--- backup tab: an existing backup is updated ----------------------');

/* The Backup tab hands an existing backup to the sync above. Same site on both
 * sides, so this is the structural half of the sync with no rewriting. */
const BACKUP = '/content/samsung/ae/india/backup/air-conditioners';

const BACKUP_STALE = () => {
  const c = SRC_CONTENT();
  c.root.hero.title = 'Old Title';
  delete c.root.text;
  c.root.oldPromo = { 'jcr:primaryType': 'nt:unstructured', title: 'Retired' };
  return c;
};

function backupRepo(content) {
  const r = repo();
  r.content.samsung.ae.india = {
    'jcr:primaryType': 'cq:Page',
    backup: {
      'jcr:primaryType': 'cq:Page',
      'air-conditioners': { 'jcr:primaryType': 'cq:Page', 'jcr:content': content }
    }
  };
  return r;
}

const BACKUP_RUN = {
  worker: backupActions,
  params: { source: PARAMS.source },
  settings: { backupFolder: 'india/backup', marketingTemplate: '/conf/x/page-marketing', verifyShallow: true }
};

await run('backup: an existing backup is analyzed as an update, writing nothing', {
  ...BACKUP_RUN,
  root: backupRepo(BACKUP_STALE()),
  action: 'analyze'
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.writes.length === 0, `expected no writes, got ${JSON.stringify(t.writes)}`);
  t.ok(t.result.mode === 'update', `mode should be update, got ${t.result.mode}`);
  t.ok(t.result.variant === 'update', 'the panel should be told to offer an update');
  t.ok(t.result.dest === BACKUP, `destination should be derived, got ${t.result.dest}`);
  t.ok(t.result.update?.path === BACKUP, 'the leaf should be marked for update');
  t.ok(t.result.copy === null && t.result.create.length === 0, 'nothing should be created or copied');
  t.ok(t.result.sync.mode === 'sync', 'the sync plan should be against the existing page');
  t.ok(t.result.sync.rewrite.enabled === false, 'a backup on the same site needs no rewriting');
  t.ok(t.result.upToDate === false, 'a stale backup is not up to date');
  t.ok(!t.result.sync.sections.some((x) => x.id === 'version'), 'a backup is never versioned');
});

await run('backup: updating writes only the differences, with no version', {
  ...BACKUP_RUN,
  root: backupRepo(BACKUP_STALE())
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(!t.wrote('version '), `the backup must not be versioned, got: ${JSON.stringify(t.writes)}`);
  t.ok(!t.wrote('copyPage') && !t.wrote('createPage'), 'no page should be created or copied');

  const c = t.at(`${BACKUP}/jcr:content`);
  t.ok(c.root.hero.title === 'Wind-Free', 'the changed title should be updated');
  t.ok(c.root.text !== undefined, 'the component added at the source should appear');
  t.ok(c.root.oldPromo === undefined, 'the component the source dropped should be removed');
  t.ok(c.homeLink === '/content/samsung/ae.html', 'links stay on the same site');
  t.ok(t.writes.every((w) => !w.includes('/content/samsung/ae/air-conditioners/jcr:content') || w.startsWith('copy ')),
    'the source must never be written');
});

await run('backup: a backup that already matches is left alone', {
  ...BACKUP_RUN,
  root: backupRepo(SRC_CONTENT())
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.writes.length === 0, `expected no writes, got ${JSON.stringify(t.writes)}`);
  t.ok(t.lines.some((l) => l.includes('already up to date')), 'should say it is already up to date');
});

await run('backup: a matching backup is reported up to date before anything runs', {
  ...BACKUP_RUN,
  root: backupRepo(SRC_CONTENT()),
  action: 'analyze'
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.result.upToDate === true, 'the analysis should say the backup is up to date');
  t.ok(t.result.variant === 'current', `the panel should be told there is nothing to run, got ${t.result.variant}`);
  t.ok(t.result.update?.content === 'current', 'the leaf should be marked as current');
  t.ok(t.result.sync.sections.length === 0, `no plan steps expected, got ${JSON.stringify(t.result.sync.sections)}`);
});

await run('backup: versioning stays off even when Sync page has it on', {
  ...BACKUP_RUN,
  settings: { ...BACKUP_RUN.settings, upsertVersionFirst: true },
  root: backupRepo(BACKUP_STALE())
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(!t.wrote('version '), `the backup must not be versioned, got: ${JSON.stringify(t.writes)}`);
});

await run('backup: images are not checked, so an unreadable one cannot block the update', {
  ...BACKUP_RUN,
  root: backupRepo(BACKUP_STALE()),
  // Any probe of this image would come back 403 and block the run.
  opts: { forbidden: ['/content/dam/samsung/ae/hero/ac.jpg'] }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.result.sync.assets.length === 0, 'no image should be listed');
  t.ok(t.result.sync.folders.length === 0, 'no DAM folder should be listed');
  t.ok(!t.wrote('upload ') && !t.wrote('copy /content/dam'), 'no image should be uploaded');
  t.ok(t.at(`${BACKUP}/jcr:content`).root.hero.title === 'Wind-Free', 'the update should still happen');
});

await run('backup: a property naming a missing image is copied exactly as the source has it', {
  ...BACKUP_RUN,
  root: backupRepo((() => {
    const c = SRC_CONTENT();
    c.root.gallery.description = 'old text';
    return c;
  })())
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  const want = SRC_CONTENT().root.gallery.description;
  const got = t.at(`${BACKUP}/jcr:content`).root.gallery.description;
  t.ok(got === want, `the value should match the source, got ${got}`);
  t.ok(t.result.sync.ignored.length === 0, 'nothing should be held back');
});

const BACKUP_MASS = () => backupRepo((() => {
  const c = SRC_CONTENT();
  for (let i = 0; i < 12; i++) c.root[`extra${i}`] = { 'jcr:primaryType': 'nt:unstructured', title: `x${i}` };
  return c;
})());

await run('backup: an unconfirmed mass removal still blocks the update', { ...BACKUP_RUN, root: BACKUP_MASS() }, (t) => {
  t.ok(String(t.error).includes('Refusing to write'), `should refuse, got: ${t.error}`);
  t.ok(t.writes.length === 0, `nothing should be written, got ${JSON.stringify(t.writes)}`);
});

await run('backup: a confirmed mass removal updates', {
  ...BACKUP_RUN,
  root: BACKUP_MASS(),
  params: { ...BACKUP_RUN.params, removalsAck: { nodes: 12, props: 0 } }
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  const r = t.at('/content/samsung/ae/india/backup/air-conditioners/jcr:content/root');
  t.ok(r && r.extra0 === undefined && r.extra11 === undefined, 'the extra components should be removed');
});

/* ------------------------------------- the destination's backup, before a sync */

const LIVE = '/content/samsung/lb/air-conditioners';
const LIVE_BACKUP = '/content/samsung/lb/india/backup/air-conditioners';
/** A live destination page, with or without its backup under india/backup. */
function liveRepo({ backup } = {}) {
  const r = repo();
  r.content.samsung.lb['air-conditioners'] = { 'jcr:primaryType': 'cq:Page', 'jcr:content': BACKUP_STALE() };
  if (backup) r.content.samsung.lb.india.backup['air-conditioners'] = { 'jcr:primaryType': 'cq:Page', 'jcr:content': backup };
  return r;
}
const LIVE_RUN = { params: { ...PARAMS, dest: LIVE }, settings: { backupFolder: 'india/backup' } };

await run('backup check: no backup is said on the review, nothing written', {
  ...LIVE_RUN, root: liveRepo(), action: 'analyze'
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.writes.length === 0, `expected no writes, got ${JSON.stringify(t.writes)}`);
  t.ok(t.result?.backup?.state === 'missing', `state should be missing, got ${JSON.stringify(t.result?.backup)}`);
  t.ok(t.result?.backup?.backup === LIVE_BACKUP, `backup path, got ${t.result?.backup?.backup}`);
  t.ok(t.lines.some((l) => l.includes('has no backup')), 'the log should say so');
});

await run('backup check: a backup unlike the page is "differs", with what differs', {
  ...LIVE_RUN, root: liveRepo({ backup: SRC_CONTENT() }), action: 'analyze'
}, (t) => {
  t.ok(t.result?.backup?.state === 'differs', `state should be differs, got ${JSON.stringify(t.result?.backup)}`);
  const d = t.result?.backup?.differences;
  t.ok(d && d.properties + d.components > 0, `differences counted, got ${JSON.stringify(d)}`);
});

await run('backup check: an identical backup is "same"', {
  ...LIVE_RUN, root: liveRepo({ backup: BACKUP_STALE() }), action: 'analyze'
}, (t) => {
  t.ok(t.result?.backup?.state === 'same', `state should be same, got ${JSON.stringify(t.result?.backup)}`);
});

await run('backup check: a page the sync creates has nothing to back up', {
  params: { ...PARAMS, dest: LIVE }, settings: { backupFolder: 'india/backup' }, root: repo(), action: 'analyze'
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.result?.backup === undefined, 'no backup check for a page not there yet');
});

await run('backup first: missing - the backup is taken, then the page synced', {
  ...LIVE_RUN, root: liveRepo()
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  const b = t.at(`${LIVE_BACKUP}/jcr:content`);
  t.ok(b?.root?.hero?.title === 'Old Title', `the backup should hold the page as it was, got ${JSON.stringify(b?.root?.hero)}`);
  t.ok(t.at(`${LIVE}/jcr:content`).root.hero.title === 'Wind-Free', 'the page should then be synced');
  const backupAt = t.writes.findIndex((w) => w.includes(LIVE_BACKUP));
  const pageAt = t.writes.findIndex((w) => w.includes(`${LIVE}/`) && !w.includes('india/backup') && !w.startsWith('copyPage'));
  t.ok(backupAt !== -1 && backupAt < pageAt, `the backup must come before the page's first write: ${JSON.stringify(t.writes)}`);
  t.ok(t.lines.some((l) => l.includes('backup taken')), 'the log should say the backup was taken');
});

await run('backup first: differs - the backup is updated to the page, then the page synced', {
  ...LIVE_RUN, root: liveRepo({ backup: SRC_CONTENT() })
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  const b = t.at(`${LIVE_BACKUP}/jcr:content`);
  t.ok(b.root.hero.title === 'Old Title' && b.root.oldPromo !== undefined && b.root.text === undefined, 'the backup should now match the page as it was');
  t.ok(t.at(`${LIVE}/jcr:content`).root.hero.title === 'Wind-Free', 'the page should then be synced');
  t.ok(t.lines.some((l) => l.includes('backup updated')), 'the log should say the backup was updated');
});

await run('backup first: same - nothing written to the backup', {
  ...LIVE_RUN, root: liveRepo({ backup: BACKUP_STALE() })
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(!t.writes.some((w) => w.includes(LIVE_BACKUP)), `the backup should be left alone: ${JSON.stringify(t.writes)}`);
  t.ok(t.at(`${LIVE}/jcr:content`).root.hero.title === 'Wind-Free', 'the page should be synced');
});

await run('backup first: unticked - no backup, the page synced', {
  ...LIVE_RUN, params: { ...LIVE_RUN.params, backupFirst: false }, root: liveRepo()
}, (t) => {
  t.ok(t.error === null, `errored: ${t.error}`);
  t.ok(t.at(LIVE_BACKUP) === undefined && !t.writes.some((w) => w.includes(LIVE_BACKUP)), 'no backup should be taken');
  t.ok(t.at(`${LIVE}/jcr:content`).root.hero.title === 'Wind-Free', 'the page should be synced');
});

await run('backup first: a backup that fails stops the sync, the page untouched', {
  ...LIVE_RUN, root: liveRepo(), opts: { refuseUnder: '/content/samsung/lb/india/backup' }
}, (t) => {
  t.ok(/backup failed, so nothing has been written/.test(t.error || ''), `should stop with the reason, got: ${t.error}`);
  t.ok(t.at(`${LIVE}/jcr:content`).root.hero.title === 'Old Title', 'the page must be as it was');
  t.ok(!t.writes.some((w) => w.includes(`${LIVE}/`) && !w.includes('india/backup')), `nothing written to the page: ${JSON.stringify(t.writes)}`);
});

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
