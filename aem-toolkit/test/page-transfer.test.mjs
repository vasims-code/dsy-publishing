/* Exercise page-transfer against TWO simulated AEM instances.
 *
 * The real panel module drives it, so the orchestration - read there, plan
 * here, ferry each image across, then write - is under test too, not just the
 * two workers. `CURRENT` stands in for "which tab is this action running in".
 */
import { pathToFileURL } from 'node:url';

/* --- Sling HtmlResponse shim -------------------------------------------- */
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
  headers: { get: (h) => headers[h.toLowerCase()] ?? null },
  text: async () => text,
  json: async () => JSON.parse(text),
  arrayBuffer: async () => new TextEncoder().encode(text).buffer
});

/* --- repository --------------------------------------------------------- */
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
const parentNode = (root, path) => resolve(root, '/' + segs(path).slice(0, -1).join('/'));

function render(node, depth) {
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (isNode(v)) { if (depth > 0) out[k] = render(v, depth - 1); }
    else out[k] = v;
  }
  return out;
}

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

/** One simulated instance. */
let versionSeq = 0;

/** A promise that only ends when the request is abandoned - a server that never answers. */
const hang = (init) =>
  new Promise((_, reject) =>
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  );

function instance(root, {
  forbidden = [], truncate = false, assetBytes = 'IMAGEDATA', quietVersionFailure = false,
  /* Asset file names: upload answered with this status / never answered / stored but never answered. */
  uploadStatus = {}, uploadHangs = [], uploadLandsSilently = [],
  /* Asset paths whose read never sends a byte. */
  readHangs = []
} = {}) {
  const writes = [];
  const forbid = new Set(forbidden);

  const handler = async (url, init = {}) => {
    const u = decodeURI(String(url).split('?')[0]);
    if (u === '/libs/granite/csrf/token.json') return mk(200, JSON.stringify({ token: 'tok' }));

    if ((init.method || 'GET').toUpperCase() === 'GET') {
      const m = u.match(/^(.*)\.(\d+|infinity)\.json$/);
      if (m) {
        const path = m[1];
        if (forbid.has(path)) return mk(403, 'forbidden');
        const node = resolve(root, path);
        if (!isNode(node)) return mk(404, 'nf');
        if (m[2] === 'infinity' && truncate) return mk(200, '{"jcr:prim');
        return mk(200, JSON.stringify(render(node, m[2] === 'infinity' ? 99 : parseInt(m[2], 10))));
      }
      // A raw read: the asset's bytes.
      if (readHangs.includes(u)) return hang(init);
      if (forbid.has(u)) return mk(403, 'forbidden');
      const node = resolve(root, u);
      if (!isNode(node)) return mk(404, 'nf');
      return mk(200, node.__bytes || assetBytes, {
        'content-type': node.__mime || 'image/png',
        ...(node.__declared ? { 'content-length': String(node.__declared) } : {})
      });
    }

    /* ---- uploads ------------------------------------------------------- */
    if (u.endsWith('.createasset.html')) {
      const folder = u.slice(0, -'.createasset.html'.length);
      const fd = init.body;
      const fileName = fd.get('fileName');
      const file = fd.get('file');
      if (uploadStatus[fileName]) return mk(uploadStatus[fileName], 'refused');
      if (uploadHangs.includes(fileName)) return hang(init);
      const holder = resolve(root, folder);
      if (!isNode(holder)) return mk(500, 'no folder');
      holder[fileName] = {
        'jcr:primaryType': 'dam:Asset',
        __bytes: await file.text(),
        __mime: file.type
      };
      writes.push(`upload ${folder}/${fileName} (${file.size}b ${file.type})`);
      if (uploadLandsSilently.includes(fileName)) return hang(init);
      return mk(200, '<html>ok</html>');
    }

    const body = new URLSearchParams(init.body);
    if (!init.headers?.['CSRF-Token']) return mk(403, 'CSRF token mismatch');

    if (u === '/bin/wcmcommand') {
      const cmd = body.get('cmd');
      if (cmd === 'createVersion') {
        const QUIET = quietVersionFailure;
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
      if (cmd === 'createPage') {
        const p = `${body.get('parentPath')}/${body.get('label')}`;
        const holder = resolve(root, body.get('parentPath'));
        if (!isNode(holder)) return mk(200, htmlResponse(500, 'no parent'));
        holder[body.get('label')] = {
          'jcr:primaryType': 'cq:Page',
          'jcr:content': {
            'jcr:primaryType': 'cq:PageContent',
            'cq:template': body.get('template'),
            'jcr:title': body.get('title')
          }
        };
        writes.push(`createPage ${p} [${body.get('template').split('/').pop()}]`);
        return mk(200, htmlResponse(200, 'created', p));
      }
      // Within this instance only - the backup of the page here, shallow.
      if (cmd === 'copyPage') {
        const holder = resolve(root, body.get('destParentPath'));
        const from = resolve(root, body.get('srcPath'));
        if (!isNode(holder) || !isNode(from)) return mk(200, htmlResponse(500, 'no parent'));
        const name = body.get('destName');
        const dest = `${body.get('destParentPath')}/${name}`;
        holder[name] = Object.fromEntries(
          Object.entries(from).filter(([, v]) => !(isNode(v) && v['jcr:primaryType'] === 'cq:Page')).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])
        );
        writes.push(`copyPage ${body.get('srcPath')} -> ${dest}`);
        return mk(200, htmlResponse(200, 'copied', dest));
      }
      return mk(200, htmlResponse(500, 'unknown'));
    }

    const op = body.get(':operation');
    if (op === 'delete') {
      const holder = parentNode(root, u);
      const name = segs(u).pop();
      if (!holder?.[name]) return mk(200, htmlResponse(404, 'nf'));
      delete holder[name];
      writes.push(`delete ${u}`);
      return mk(200, htmlResponse(200, 'deleted', u));
    }

    if (body.has(':order') && [...body.keys()].every((k) => k === ':order' || k === '_charset_')) {
      const holder = parentNode(root, u);
      const name = segs(u).pop();
      if (!holder?.[name]) return mk(200, htmlResponse(404, 'nf'));
      reorderChild(holder, name, parseInt(body.get(':order'), 10));
      writes.push(`order ${u} ${body.get(':order')}`);
      return mk(200, htmlResponse(200, 'ordered', u));
    }

    let node = root;
    for (const s of segs(u)) {
      if (!isNode(node[s])) node[s] = { 'jcr:primaryType': 'nt:unstructured' };
      node = node[s];
    }
    const applied = [];
    try {
      for (const key of new Set([...body.keys()].filter((k) => !k.startsWith(':') && k !== '_charset_'))) {
        if (key.endsWith('@Delete')) { delete node[key.slice(0, -7)]; applied.push(`-${key.slice(0, -7)}`); continue; }
        if (key.endsWith('@TypeHint')) continue;
        const values = body.getAll(key);
        if (!values.length) continue;
        node[key] = coerce(values, body.get(`${key}@TypeHint`) || 'String');
        applied.push(key);
      }
    } catch (e) { return mk(200, htmlResponse(500, e.message)); }
    // Sling honours :order on the request that creates the node, too.
    if (body.has(':order')) {
      const holder = parentNode(root, u);
      if (holder) reorderChild(holder, segs(u).pop(), parseInt(body.get(':order'), 10));
    }
    writes.push(`write ${u} {${applied.sort().join(',')}}`);
    return mk(200, htmlResponse(200, 'modified', u));
  };

  return { root, writes, handler };
}

/* --- fixtures ----------------------------------------------------------- */
const base = 'D:/chrome-extensions/aem-toolkit/src/';
const { AemClient, LIMITS } = await import(pathToFileURL(base + 'core/aem-client.js'));
const { actions } = await import(pathToFileURL(base + 'features/page-transfer/worker.js'));
const feature = await import(pathToFileURL(base + 'features/page-transfer/panel.js'));

const TPL = '/conf/consumer/settings/wcm/templates/page-static-gnb';
const RT = {
  grid: 'wcm/foundation/components/responsivegrid',
  fb: 'samsung/components/content/consumer/global/product/pd-g-feature-benefit',
  text: 'samsung/components/content/consumer/global/common/cm-g-text-block',
  static: 'samsung/components/content/consumer/global/common/cm-g-static-content',
  video: 'samsung/components/content/consumer/global/common/cm-g-video'
};

const SETTINGS = {
  rootDepth: 3,
  upsertHosts: '',
  upsertReorder: true,
  upsertVersionFirst: true,
  upsertKeepAtDest: 'hreflangGroup',
  transferCopyAssets: true,
  transferOverwriteAssets: false,
  transferPreserve: ''
};

/** UK source: 4 components, two of which LB will not have. */
const UK_CONTENT = () => ({
  'jcr:primaryType': 'cq:PageContent',
  'cq:template': TPL,
  'sling:resourceType': 'samsung/components/structure/page-static-gnb',
  'jcr:title': 'Fold vs Flip',
  ogTitle: "Flip vs Fold | Samsung UK",
  twitterSite: '@SamsungUK',
  description: 'The UK page description.',
  titleOption: 'A',
  canonical: 'https://www.samsung.com/uk/mobile-phone-buying-guide/samsung-fold-vs-flip/',
  root: {
    'jcr:primaryType': 'nt:unstructured',
    'sling:resourceType': RT.grid,
    cm_g_static_content_: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': RT.static,
      bodyHtml: '<script>FAQ schema</script>' },
    cm_g_video: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': RT.video, videoId: '3vvJeRHe3sk' },
    pd_g_feature_benefit_2084490669: {
      'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': RT.fb,
      headlineText: '1. Flexible hinges',
      imageDesktopImageRef: '/content/dam/samsung/uk/guide/Tile_DT.png',
      description: 'see <a href="/uk/mobile-phone-buying-guide/how-do-foldable-phone-screens-work/">this</a>'
    },
    cm_g_static_content: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': RT.static,
      bodyHtml: '<div class="anchor-bar"></div>' }
  }
});

/** LB destination: same content, independently authored, different node names. */
const LB_CONTENT = () => ({
  'jcr:primaryType': 'cq:PageContent',
  'cq:template': TPL,
  'sling:resourceType': 'samsung/components/structure/page-static-gnb',
  'jcr:title': 'Fold vs Flip',
  ogTitle: 'Flip vs Fold | Samsung Lebanon',
  twitterSite: '@SamsungLEVANT',
  description: 'The Lebanon page description, written locally.',
  titleOption: 'B',
  canonical: 'https://www.samsung.com/lb/mobile-phone-buying-guide/samsung-fold-vs-flip/',
  root: {
    'jcr:primaryType': 'nt:unstructured',
    'sling:resourceType': RT.grid,
    cm_g_static_content: { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': RT.static,
      bodyHtml: '<script>FAQ schema</script>' },
    pd_g_feature_benefit_552501717: {
      'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': RT.fb,
      headlineText: 'OLD hinges headline',
      imageDesktopImageRef: '/content/dam/samsung/lb/guide/Tile_DT.jpg',
      // Stale body copy, and its link still points at the old wording too.
      description: 'OLD body copy with <a href="/lb/mobile-phone-buying-guide/old-screens/">a link</a>'
    }
  }
});

const asset = () => ({ 'jcr:primaryType': 'dam:Asset' });
const folder = (kids) => ({ 'jcr:primaryType': 'sling:OrderedFolder', ...(kids || {}) });

function ukRepo() {
  return {
    content: {
      'jcr:primaryType': 'sling:OrderedFolder',
      samsung: { 'jcr:primaryType': 'cq:Page',
        uk: { 'jcr:primaryType': 'cq:Page',
          'fold-vs-flip': { 'jcr:primaryType': 'cq:Page', 'jcr:content': UK_CONTENT() } } },
      dam: { 'jcr:primaryType': 'sling:OrderedFolder',
        samsung: folder({ uk: folder({ guide: folder({ 'Tile_DT.png': asset() }) }) }) }
    }
  };
}

/** Destination instance. Same codebase deployed, per the stated premise. */
function lbRepo({ withPage = true, missingTemplate = false, missingComponent = null, dest = null } = {}) {
  const apps = { 'jcr:primaryType': 'sling:Folder' };
  const add = (rt) => {
    let cur = apps;
    for (const s of segs(rt)) {
      if (!cur[s]) cur[s] = { 'jcr:primaryType': 'cq:Component' };
      cur = cur[s];
    }
  };
  for (const rt of Object.values(RT)) if (rt !== missingComponent) add(rt);
  add('samsung/components/structure/page-static-gnb');

  const conf = missingTemplate ? {} : {
    consumer: { settings: { wcm: { templates: { 'page-static-gnb': { 'jcr:primaryType': 'cq:Template' } } } } }
  };

  return {
    apps,
    libs: { 'jcr:primaryType': 'sling:Folder', wcm: { foundation: { components: { responsivegrid: {} } } } },
    conf: { 'jcr:primaryType': 'sling:Folder', ...conf },
    content: {
      'jcr:primaryType': 'sling:OrderedFolder',
      samsung: { 'jcr:primaryType': 'cq:Page',
        lb: { 'jcr:primaryType': 'cq:Page',
          ...(withPage || dest
            ? { 'fold-vs-flip': { 'jcr:primaryType': 'cq:Page', 'jcr:content': dest || LB_CONTENT() } }
            : {}) } },
      dam: { 'jcr:primaryType': 'sling:OrderedFolder', samsung: folder({ lb: folder({}) }) }
    }
  };
}

const DEST_ORIGIN = 'https://p6-ap-author.example.com';

const PARAMS = {
  sourceOrigin: 'https://p6-eu-author.example.com',
  destOrigin: DEST_ORIGIN,
  source: '/content/samsung/uk/fold-vs-flip',
  dest: '/content/samsung/lb/fold-vs-flip'
};

/* --- driver ------------------------------------------------------------- */
let CURRENT = null;
globalThis.fetch = (url, init) => CURRENT(url, init);

/* The upload goes by XMLHttpRequest, for its progress events. This one sends
 * the body in one go and hands the request to the same simulated instance. */
globalThis.XMLHttpRequest = class {
  constructor() { this.upload = {}; this.headers = {}; }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  abort() { this.aborted = true; this.ctl?.abort(); }
  send(body) {
    const handler = CURRENT;
    this.ctl = new AbortController();
    const size = body.get('file')?.size || 0;
    this.upload.onprogress?.({ loaded: size, total: size });
    this.upload.onload?.();
    handler(this.url, { method: this.method, headers: this.headers, body, signal: this.ctl.signal })
      .then((res) => {
        if (this.aborted) return;
        this.status = res.status;
        this.onload?.();
      })
      .catch(() => {});
  }
};

/** Run with the stall and answer limits cut to milliseconds. */
async function quickly(fn) {
  const saved = { ...LIMITS };
  Object.assign(LIMITS, { readStallMs: 40, uploadStallMs: 40, uploadAnswerMs: 40 });
  try { return await fn(); } finally { Object.assign(LIMITS, saved); }
}

async function drive(kind, { src, dst, params = PARAMS, settings = {}, ctxOrigin, noAck = false }) {
  const lines = [];
  const report = (level, message, data) => {
    if (level === 'data' && message === 'analysis') lines.analysis = data;
    else if (level !== 'data') lines.push(`${level.toUpperCase()} ${message}`);
  };

  const clients = {
    src: new AemClient({ report }),
    dst: new AemClient({ report })
  };

  const ctx = {
    params,
    settings: { ...SETTINGS, ...settings },
    origin: ctxOrigin ?? DEST_ORIGIN,
    tabId: 'dst',
    tabFor: async (o) => (o === params.sourceOrigin ? 'src' : 'dst'),
    log: (l, m) => lines.push(`${l.toUpperCase()} ${m}`),
    send: async (action, p, tab) => {
      const which = tab === 'src' ? 'src' : 'dst';
      CURRENT = which === 'src' ? src.handler : dst.handler;
      try {
        return {
          ok: true,
          result: await actions[action]({
            client: clients[which], settings: { ...SETTINGS, ...settings }, report, params: p
          })
        };
      } catch (e) {
        return { ok: false, error: e.message, aborted: !!e.isAbort };
      }
    }
  };

  /* Someone running it has read the review and ticked "update them" for the
   * page properties it named - unless the case is about not having done so. */
  if (kind === 'commit' && !params.metadataAck && !noAck) {
    const review = await feature.analyze({ ...ctx, log: () => {} });
    if (review?.ok && review.result.metadata) ctx.params = { ...params, metadataAck: { props: review.result.metadata.props } };
    lines.length = 0;
    delete lines.analysis;
  }
  const res = await feature[kind](ctx);
  return { res, lines, analysis: lines.analysis };
}

/** Child NODE names in repository order - which is component order in AEM. */
const childOrder = (root, path) => {
  const n = resolve(root, path);
  return n ? Object.keys(n).filter((k) => isNode(n[k])) : [];
};

/* --- runner ------------------------------------------------------------- */
let pass = 0;
let failed = 0;
const T = { problems: [] };
async function run(name, fn) {
  T.problems = [];
  try { await fn((cond, why) => { if (!cond) T.problems.push(why); }); }
  catch (e) { T.problems.push(`threw: ${e.message}\n${e.stack?.split('\n')[1] || ''}`); }
  const ok = T.problems.length === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  for (const p of T.problems) console.log('        - ' + p);
  ok ? pass++ : failed++;
}

/* --- cases -------------------------------------------------------------- */

console.log('\n--- create on the other server ---------------------------------');

await run('analyze reads the source and writes nothing anywhere', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo({ withPage: false }));
  const { res, analysis } = await drive('analyze', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  ok(src.writes.length === 0, `wrote on the source: ${src.writes}`);
  ok(dst.writes.length === 0, `wrote on the destination: ${dst.writes}`);
  ok(analysis?.mode === 'create', `mode ${analysis?.mode}`);
  ok(analysis.rewrite.srcSite === 'uk' && analysis.rewrite.destSite === 'lb', 'site tokens');
});

await run('the page is created and every component written', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo({ withPage: false }));
  const { res } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  ok(src.writes.length === 0, `wrote on the source: ${src.writes}`);
  ok(dst.writes.some((w) => w.startsWith('createPage /content/samsung/lb/fold-vs-flip')), 'createPage');

  const c = resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content');
  const grid = c.root;
  ok(grid?.cm_g_video?.videoId === '3vvJeRHe3sk', 'video component should be written');
  ok(grid?.pd_g_feature_benefit_2084490669?.headlineText === '1. Flexible hinges', 'headline');
});

await run('links and image references are re-pointed at this site', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo({ withPage: false }));
  await drive('commit', { src, dst });
  const fb = resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content/root/pd_g_feature_benefit_2084490669');
  ok(fb.imageDesktopImageRef === '/content/dam/samsung/lb/guide/Tile_DT.png',
    `image ref: ${fb.imageDesktopImageRef}`);
  ok(fb.description.includes('/lb/mobile-phone-buying-guide/'), `link: ${fb.description}`);
  ok(!fb.description.includes('/uk/'), 'no /uk/ left behind');
  const c = resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content');
  ok(c.canonical === 'https://www.samsung.com/lb/mobile-phone-buying-guide/samsung-fold-vs-flip/',
    `canonical: ${c.canonical}`);
});

await run('the image is carried across and uploaded', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo({ withPage: false }));
  await drive('commit', { src, dst });
  ok(dst.writes.some((w) => w.startsWith('upload /content/dam/samsung/lb/guide/Tile_DT.png')),
    `uploads: ${dst.writes.filter((w) => w.startsWith('upload'))}`);
  const a = resolve(dst.root, '/content/dam/samsung/lb/guide/Tile_DT.png');
  ok(a?.['jcr:primaryType'] === 'dam:Asset', 'asset should exist at the destination');
  ok(a?.__bytes === 'IMAGEDATA', `bytes should survive the base64 hop, got ${a?.__bytes}`);
  ok(dst.writes.some((w) => w.startsWith('write /content/dam/samsung/lb/guide {')),
    'the DAM folder should be created first');
});

await run('a page being created gets the source metadata to edit', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo({ withPage: false }));
  await drive('commit', { src, dst });
  const c = resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content');
  ok(c.ogTitle === 'Flip vs Fold | Samsung UK', `ogTitle should be seeded, got ${c.ogTitle}`);
  ok(c.twitterSite === '@SamsungUK', `twitterSite should be seeded, got ${c.twitterSite}`);
});

console.log('\n--- sync onto an independently authored page --------------------');

await run('components are paired by position and type, not by name', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo());
  const { res, analysis } = await drive('analyze', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  ok(analysis.mode === 'sync', `mode ${analysis.mode}`);

  const pair = analysis.pairing.pairs.find((p) => p.destination === 'pd_g_feature_benefit_552501717');
  ok(pair?.source === 'pd_g_feature_benefit_2084490669',
    `hinges paired with ${pair?.source}`);

  const faq = analysis.pairing.pairs.find((p) => p.destination === 'cm_g_static_content');
  ok(faq?.source === 'cm_g_static_content_',
    `LB's FAQ schema paired with ${faq?.source} — must NOT be UK's same-named anchor bar`);
  ok(analysis.pairing.renamed >= 2, `renamed count ${analysis.pairing.renamed}`);
});

await run('the paired component is the one overwritten', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo());
  const { res } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  const grid = resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content/root');
  ok(grid.pd_g_feature_benefit_552501717?.headlineText === '1. Flexible hinges',
    `LB's own node should carry the UK headline, got ${grid.pd_g_feature_benefit_552501717?.headlineText}`);
  ok(grid.pd_g_feature_benefit_2084490669 === undefined,
    'the UK node name must not be created alongside the LB one');
  ok(grid.cm_g_static_content?.bodyHtml.includes('FAQ schema'),
    `LB's FAQ schema must not be replaced by the anchor bar, got ${grid.cm_g_static_content?.bodyHtml}`);
});

await run('components the source has and this page lacks are added', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo());
  await drive('commit', { src, dst });
  const grid = resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content/root');
  ok(grid.cm_g_video?.videoId === '3vvJeRHe3sk', 'the video component should be added');
  ok(grid.cm_g_static_content_ !== undefined || Object.keys(grid).some((k) => k.startsWith('cm_g_static_content')),
    "UK's anchor bar should be added, not merged into LB's FAQ node");
});

await run('locale metadata already set here is left alone', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo());
  const { analysis } = await drive('commit', { src, dst });
  const c = resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content');
  ok(c.ogTitle === 'Flip vs Fold | Samsung Lebanon', `ogTitle changed to ${c.ogTitle}`);
  ok(c.twitterSite === '@SamsungLEVANT', `twitterSite changed to ${c.twitterSite}`);
  ok(c.titleOption === 'B', `titleOption changed to ${c.titleOption}`);
  ok(analysis.counts.preserved >= 3, `preserved count ${analysis.counts.preserved}`);
});

await run('a component property is not frozen by the page-metadata list', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo());
  const { analysis } = await drive('analyze', { src, dst });

  // `description` is page metadata AND an everyday component property name.
  // Preserving it on the page must not preserve it on every component.
  const onPage = analysis.preserved.some((x) => x.prop === 'description' && x.node === '(page properties)');
  const onComponent = analysis.preserved.some((x) => x.prop === 'description' && x.node !== '(page properties)');
  ok(onPage, `the page's own description should be kept: ${JSON.stringify(analysis.preserved)}`);
  ok(!onComponent, `a component's description must not be: ${JSON.stringify(analysis.preserved)}`);

  // ...and because it is not frozen, the link inside it is re-pointed.
  ok(analysis.links.some((l) => l.from === '/uk/mobile-phone-buying-guide/how-do-foldable-phone-screens-work/'),
    `the link inside that component's rich text should be re-pointed: ${JSON.stringify(analysis.links)}`);
  ok(analysis.props.updated.some((c) => c.prop === 'description' && c.node !== '(page properties)'),
    'the component body copy should be updated');
  // Every update says what it is, so the review can show image paths and links apart from the text.
  ok(analysis.props.updated.length > 0 && analysis.props.updated.every((c) => ['image', 'link', 'other'].includes(c.kind)),
    `every update should carry its kind: ${JSON.stringify(analysis.props.updated.map((c) => [c.node, c.prop, c.kind]))}`);
});

await run('the canonical IS updated, because it can be derived', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo());
  await drive('commit', { src, dst });
  const c = resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content');
  ok(c.canonical.includes('/lb/'), `canonical: ${c.canonical}`);
});

console.log('\n--- component order --------------------------------------------');

const GRID = '/content/samsung/lb/fold-vs-flip/jcr:content/root';

await run('a page created on the other server is built in the source order', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo({ withPage: false }));
  const { res } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);

  // copyPage cannot cross servers, so every node is written individually -
  // order is something this has to get right rather than inherit.
  const kids = childOrder(dst.root, GRID);
  ok(JSON.stringify(kids) === JSON.stringify([
    'cm_g_static_content_', 'cm_g_video', 'pd_g_feature_benefit_2084490669', 'cm_g_static_content'
  ]), `got ${JSON.stringify(kids)}`);
});

await run('a component added mid-page lands mid-page, not at the end', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo());          // has only FAQ + hinges, in that order
  const { res } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);

  /* UK order is FAQ, video, hinges, anchor. The video belongs BETWEEN the two
   * components LB already has, and the anchor after them - appending both to
   * the end would be the easy wrong answer. */
  const kids = childOrder(dst.root, GRID);
  ok(kids.length === 4, `expected 4 components, got ${JSON.stringify(kids)}`);
  ok(kids[0] === 'cm_g_static_content', `FAQ first, got ${kids[0]}`);
  ok(kids[1] === 'cm_g_video', `the video should be second, got ${kids[1]}`);
  ok(kids[2] === 'pd_g_feature_benefit_552501717', `LB's own hinges node third, got ${kids[2]}`);
  ok(kids[3].startsWith('cm_g_static_content'), `the anchor last, got ${kids[3]}`);
});

await run('a page re-ordered HERE is flagged, because order is what pairs them', async (ok) => {
  /* The limitation, pinned deliberately. Matching is by order and type; reverse
   * the destination and the alignment pairs each component with the wrong one -
   * correctly by its own rules, wrongly by any other measure. It cannot know.
   * What it must do is say which rows the question applies to. */
  const lb = LB_CONTENT();
  const r = lb.root;
  lb.root = {
    'jcr:primaryType': r['jcr:primaryType'],
    pd_g_feature_benefit_552501717: r.pd_g_feature_benefit_552501717,
    cm_g_static_content: r.cm_g_static_content
  };

  const src = instance(ukRepo());
  const dst = instance(lbRepo({ dest: lb }));
  const { res, analysis } = await drive('analyze', { src, dst });
  ok(res.ok, `errored: ${res.error}`);

  // UK has two cm-g-static-content components, so only order separates them.
  ok(analysis.pairing.ambiguous > 0,
    `the repeated type should be flagged: ${JSON.stringify(analysis.pairing.pairs)}`);
  const flagged = analysis.pairing.pairs.filter((p) => p.ambiguous);
  ok(flagged.every((p) => p.kind === 'cm-g-static-content'),
    `only the repeated type should be flagged: ${JSON.stringify(flagged)}`);
});

await run('the operator is warned when only order separates two components', async (ok) => {
  const lb = LB_CONTENT();
  const r = lb.root;
  lb.root = {
    'jcr:primaryType': r['jcr:primaryType'],
    pd_g_feature_benefit_552501717: r.pd_g_feature_benefit_552501717,
    cm_g_static_content: r.cm_g_static_content
  };
  const src = instance(ukRepo());
  const dst = instance(lbRepo({ dest: lb }));
  const { lines } = await drive('analyze', { src, dst });
  ok(lines.some((l) => l.startsWith('WARN') && /only their order tells them apart/.test(l)),
    `should warn: ${lines.filter((l) => l.startsWith('WARN')).join(' | ')}`);
});

await run('a unique component type is never flagged as ambiguous', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo());
  const { analysis } = await drive('analyze', { src, dst });
  const fb = analysis.pairing.pairs.find((p) => p.kind === 'pd-g-feature-benefit');
  ok(fb && fb.ambiguous === false,
    `the only feature-benefit on the page is unambiguous: ${JSON.stringify(fb)}`);
});

console.log('\n--- images outside the site’s own DAM folder -----------------');

/** The shape that used to report "0 asset references" and stop there. */
function ukWithSharedImage() {
  const uk = ukRepo();
  uk.content.samsung.uk['fold-vs-flip']['jcr:content'].root.pd_g_feature_benefit_2084490669
    .imageMobileImageRef = '/content/dam/samsung/global/shared/logo.png';
  uk.content.dam.samsung.global = folder({ shared: folder({ 'logo.png': asset() }) });
  return uk;
}

await run('an image outside the site folder is transferred too', async (ok) => {
  const src = instance(ukWithSharedImage());
  const dst = instance(lbRepo({ withPage: false }));
  const { res, analysis } = await drive('analyze', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  ok(analysis.counts.assets === 2, `should see both images, got ${analysis.counts.assets}`);
  ok(analysis.counts.uploads === 2, `both should upload, got ${analysis.counts.uploads}`);
  ok(analysis.counts.shared === 1, `one is outside the site folder, got ${analysis.counts.shared}`);
});

await run('and it keeps its own path, because the reference does', async (ok) => {
  const src = instance(ukWithSharedImage());
  const dst = instance(lbRepo({ withPage: false }));
  const { res } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);

  // Outside the site folder: same path on the destination.
  ok(resolve(dst.root, '/content/dam/samsung/global/shared/logo.png') !== undefined,
    `shared image not uploaded. uploads: ${dst.writes.filter((w) => w.startsWith('upload'))}`);
  // Under the site folder: moved with the site token.
  ok(resolve(dst.root, '/content/dam/samsung/lb/guide/Tile_DT.png') !== undefined,
    'site image not uploaded');

  const fb = resolve(dst.root,
    '/content/samsung/lb/fold-vs-flip/jcr:content/root/pd_g_feature_benefit_2084490669');
  ok(fb.imageMobileImageRef === '/content/dam/samsung/global/shared/logo.png',
    `the shared reference must not be rewritten, got ${fb.imageMobileImageRef}`);
  ok(fb.imageDesktopImageRef === '/content/dam/samsung/lb/guide/Tile_DT.png',
    `the site reference must be rewritten, got ${fb.imageDesktopImageRef}`);
});

await run('folders are created outside the site folder as well', async (ok) => {
  const src = instance(ukWithSharedImage());
  const dst = instance(lbRepo({ withPage: false }));
  await drive('commit', { src, dst });
  ok(dst.writes.some((w) => w.startsWith('write /content/dam/samsung/global {')),
    `should create /global: ${dst.writes.filter((w) => w.includes('/content/dam'))}`);
  ok(dst.writes.some((w) => w.startsWith('write /content/dam/samsung/global/shared {')),
    'should create /global/shared');
});

await run('a page with no DAM references at all says so plainly', async (ok) => {
  const uk = ukRepo();
  delete uk.content.samsung.uk['fold-vs-flip']['jcr:content']
    .root.pd_g_feature_benefit_2084490669.imageDesktopImageRef;

  const src = instance(uk);
  const dst = instance(lbRepo({ withPage: false }));
  const { analysis, lines } = await drive('analyze', { src, dst });
  ok(analysis.counts.assets === 0, `expected no assets, got ${analysis.counts.assets}`);
  ok(analysis.counts.uploads === 0, `expected no uploads, got ${analysis.counts.uploads}`);
  ok(lines.some((l) => /references no DAM assets at all/.test(l)),
    `should say so: ${lines.join(' | ')}`);
});

await run('every link that will be re-pointed is listed', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo({ withPage: false }));
  const { analysis, lines } = await drive('analyze', { src, dst });

  ok(analysis.counts.siteRefs > 0, `siteRefs ${analysis.counts.siteRefs}`);
  ok(lines.some((l) => /distinct link\(s\) will be re-pointed/.test(l)),
    `should report the count: ${lines.join(' | ')}`);

  const byFrom = Object.fromEntries(analysis.links.map((l) => [l.from, l]));

  ok(byFrom['https://www.samsung.com/uk/mobile-phone-buying-guide/samsung-fold-vs-flip/']?.to ===
    'https://www.samsung.com/lb/mobile-phone-buying-guide/samsung-fold-vs-flip/',
    `canonical: ${JSON.stringify(analysis.links)}`);

  ok(byFrom['/uk/mobile-phone-buying-guide/how-do-foldable-phone-screens-work/']?.to ===
    '/lb/mobile-phone-buying-guide/how-do-foldable-phone-screens-work/',
    'a link inside rich text should be listed on its own, not as the whole blob');

  ok(analysis.links.every((l) => !l.from.startsWith('/content/dam/')),
    `image paths belong in the Images table: ${JSON.stringify(analysis.links)}`);

  ok(analysis.links.every((l) => l.on && l.uses >= 1),
    `each link should say where it appears: ${JSON.stringify(analysis.links)}`);
});

await run('a page being created is not told its metadata was kept', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo({ withPage: false }));
  const { analysis } = await drive('analyze', { src, dst });
  // There is no destination value to protect yet - it all gets written.
  ok(analysis.counts.preserved === 0,
    `nothing to preserve on a create, got ${analysis.counts.preserved}: ` +
    JSON.stringify(analysis.preserved));
});

console.log('\n--- site values: handle and title ending, from each home page -----');

const UK_HOME = {
  'jcr:primaryType': 'cq:PageContent',
  'jcr:title': 'Mobile Phones, TVs & Appliances',
  ogTitle: 'Mobile Phones, TVs & Appliances | Samsung UK',
  twitterSite: '@SamsungUK',
  description: 'Not needed at the other end.'
};
const LB_HOME = {
  'jcr:primaryType': 'cq:PageContent',
  'jcr:title': 'Mobiles, TVs, and Home Appliances',
  ogTitle: 'Mobiles, TVs, and Home Appliances | Samsung Lebanon',
  twitterSite: '@SamsungLB'
};
const withHome = (repo, site, props) => {
  repo.content.samsung[site]['jcr:content'] = structuredClone(props);
  return repo;
};
const ukHomed = () => withHome(ukRepo(), 'uk', UK_HOME);
const lbHomed = (o) => withHome(lbRepo(o), 'lb', LB_HOME);
const LB_PC = '/content/samsung/lb/fold-vs-flip/jcr:content';

/* The transfer without the panel, for a choice the panel keeps to itself: the box unticked. */
async function transferDirect({ src, dst, params = PARAMS, settings = {} }) {
  const clients = { src: new AemClient({ report: () => {} }), dst: new AemClient({ report: () => {} }) };
  const send = (action, p, which) => {
    CURRENT = which === 'src' ? src.handler : dst.handler;
    return actions[action]({ client: clients[which], settings: { ...SETTINGS, ...settings }, report: () => {}, params: p });
  };
  const sourcePage = await send('readPage', { source: params.source }, 'src');
  const plan = await send('analyze', { ...params, sourcePage }, 'dst');
  await send('prepare', { ...params, sourcePage, folders: plan.folders }, 'dst');
  return send('apply', { ...params, sourcePage }, 'dst');
}

await run('site values: a page created here gets this site\'s handle and title ending', async (ok) => {
  const src = instance(ukHomed());
  const dst = instance(lbHomed({ withPage: false }));
  const { res, analysis } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  const c = resolve(dst.root, LB_PC);
  ok(c.twitterSite === '@SamsungLB', `twitterSite: ${c.twitterSite}`);
  ok(c.ogTitle === 'Flip vs Fold | Samsung Lebanon', `ogTitle: ${c.ogTitle}`);
  ok(c.description === 'The UK page description.', `the description is copy, not a site value: ${c.description}`);
  ok(res.result.site?.applied && res.result.site.rows.length === 2, `the done screen has them: ${JSON.stringify(res.result.site)}`);
  ok(src.writes.length === 0, `nothing written on the source: ${src.writes}`);
});

await run('site values: the source tab sends its home page along - only what is needed', async (ok) => {
  const src = instance(ukHomed());
  CURRENT = src.handler;
  const page = await actions.readPage({ client: new AemClient({ report: () => {} }), settings: SETTINGS, report: () => {}, params: { source: PARAMS.source } });
  ok(page.home?.state === 'ok' && page.home.path === '/content/samsung/uk', `home: ${JSON.stringify(page.home)}`);
  ok(page.home && !('description' in page.home.props) && page.home.props.twitterSite === '@SamsungUK',
    `props: ${JSON.stringify(page.home?.props)}`);
});

await run('site values: an old handle left here by an earlier transfer is put right; the title is still kept', async (ok) => {
  const src = instance(ukHomed());
  const local = 'Fold or Flip, which one? | Samsung Lebanon';
  const dst = instance(lbHomed({ dest: { ...LB_CONTENT(), twitterSite: '@SamsungUK', ogTitle: local } }));
  const { res, analysis } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  const c = resolve(dst.root, LB_PC);
  ok(c.twitterSite === '@SamsungLB', `twitterSite: ${c.twitterSite}`);
  ok(c.ogTitle === local, `this page's own title stays: ${c.ogTitle}`);
  ok(analysis.preserved.some((p) => p.prop === 'ogTitle') && !analysis.preserved.some((p) => p.prop === 'twitterSite'),
    `kept: ${JSON.stringify(analysis.preserved)}`);
});

await run('site values unticked: the handle here is left as it is', async (ok) => {
  const src = instance(ukHomed());
  const dst = instance(lbHomed({ dest: { ...LB_CONTENT(), twitterSite: '@SamsungUK' } }));
  const result = await transferDirect({ src, dst, params: { ...PARAMS, keepSiteValues: true } });
  const c = resolve(dst.root, LB_PC);
  ok(c.twitterSite === '@SamsungUK', `left as it was: ${c.twitterSite}`);
  ok(result.site?.applied === false, `listed as not set: ${JSON.stringify(result.site)}`);
});

await run('site values: a handle already right here is not written', async (ok) => {
  const src = instance(ukHomed());
  const dst = instance(lbHomed({ dest: { ...LB_CONTENT(), twitterSite: '@SamsungLB' } }));
  const { res } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  ok(!dst.writes.some((w) => w.startsWith(`write ${LB_PC} {`) && w.includes('twitterSite')), `writes: ${dst.writes}`);
});

await run('site values: a handle named in settings to keep is kept, even when it could be worked out', async (ok) => {
  const src = instance(ukHomed());
  const dst = instance(lbHomed({ dest: { ...LB_CONTENT(), twitterSite: '@SamsungUK' } }));
  const { res } = await drive('commit', { src, dst, settings: { transferPreserve: 'twitterSite' } });
  ok(res.ok, `errored: ${res.error}`);
  ok(resolve(dst.root, LB_PC).twitterSite === '@SamsungUK', `kept: ${resolve(dst.root, LB_PC).twitterSite}`);
});

console.log('\n--- an existing page\'s page properties: confirmed first -------------');

/* Here: a page whose handle and title the transfer would change. */
const lbStale = () => lbHomed({ dest: { ...LB_CONTENT(), twitterSite: '@SamsungUK', ogTitle: undefined } });

await run('page properties: the review names the ones that would change on a page already here', async (ok) => {
  const { analysis } = await drive('analyze', { src: instance(ukHomed()), dst: instance(lbStale()) });
  ok(analysis.metadata && analysis.metadata.props.includes('twitterSite') && analysis.metadata.props.includes('ogTitle'),
    `metadata: ${JSON.stringify(analysis.metadata)}`);
});

await run('page properties: not confirmed, the transfer writes nothing on either side', async (ok) => {
  const src = instance(ukHomed());
  const dst = instance(lbStale());
  const { res } = await drive('commit', { src, dst, noAck: true });
  ok(!res.ok && String(res.error).includes('Refusing to write') && String(res.error).includes('twitterSite'), `should refuse: ${res.error}`);
  ok(dst.writes.length === 0, `nothing written here - no version, folder or image: ${dst.writes}`);
  ok(src.writes.length === 0, `nothing written on the source: ${src.writes}`);
});

await run('page properties: the write itself refuses too, if asked without the box', async (ok) => {
  const src = instance(ukHomed());
  const dst = instance(lbStale());
  const clients = { src: new AemClient({ report: () => {} }), dst: new AemClient({ report: () => {} }) };
  CURRENT = src.handler;
  const sourcePage = await actions.readPage({ client: clients.src, settings: SETTINGS, report: () => {}, params: { source: PARAMS.source } });
  CURRENT = dst.handler;
  let error = null;
  try {
    await actions.apply({ client: clients.dst, settings: SETTINGS, report: () => {}, params: { ...PARAMS, sourcePage } });
  } catch (e) {
    error = e.message;
  }
  ok(String(error).includes('Refusing to write'), `should refuse: ${error}`);
  ok(!dst.writes.some((w) => w.startsWith(`write ${LB_PC}`)), `the page is not written: ${dst.writes}`);
});

await run('page properties: confirmed, the transfer goes ahead', async (ok) => {
  const src = instance(ukHomed());
  const dst = instance(lbStale());
  const { res } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  ok(resolve(dst.root, LB_PC).twitterSite === '@SamsungLB', `twitterSite: ${resolve(dst.root, LB_PC).twitterSite}`);
});

await run('page properties: a page the transfer creates asks nothing', async (ok) => {
  const src = instance(ukHomed());
  const dst = instance(lbHomed({ withPage: false }));
  const { res, analysis } = await drive('commit', { src, dst, noAck: true });
  ok(res.ok, `errored: ${res.error}`);
  ok(resolve(dst.root, LB_PC)?.twitterSite === '@SamsungLB', 'the new page is written in full');
});

console.log('\n--- refusals ---------------------------------------------------');

await run('a template missing here blocks the transfer', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo({ withPage: false, missingTemplate: true }));
  const { res, analysis } = await drive('analyze', { src, dst });
  ok(res.ok, `analysis itself should succeed: ${res.error}`);
  ok(analysis.blockers.some((b) => b.includes('template')), `blockers: ${analysis.blockers}`);

  const c = await drive('commit', { src, dst: instance(lbRepo({ withPage: false, missingTemplate: true })) });
  ok(!c.res.ok, 'commit should refuse');
});

await run('a component not deployed here blocks the transfer', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo({ withPage: false, missingComponent: RT.video }));
  const { analysis } = await drive('analyze', { src, dst });
  ok(analysis.blockers.some((b) => b.includes('component')), `blockers: ${analysis.blockers}`);
  ok(dst.writes.length === 0, 'nothing written');
});

/* LB with eight components the UK page has no counterpart for: well over a quarter of it removed. */
const lbMassRemoval = () => {
  const c = LB_CONTENT();
  for (let i = 0; i < 8; i++) {
    c.root[`legacy_promo_${i}`] = { 'jcr:primaryType': 'nt:unstructured', 'sling:resourceType': RT.static, bodyHtml: `old ${i}` };
  }
  return instance(lbRepo({ dest: c }));
};

await run('a mass removal here is flagged for confirmation, not blocked', async (ok) => {
  const { res, analysis, lines } = await drive('analyze', { src: instance(ukRepo()), dst: lbMassRemoval() });
  ok(res.ok, `errored: ${res.error}`);
  ok(analysis.blockers.length === 0, `it should not be a blocker: ${analysis.blockers}`);
  ok(/This would remove \d+ of \d+ components here/.test(analysis.largeRemoval || ''), `largeRemoval: ${analysis.largeRemoval}`);
  ok(lines.some((l) => l.startsWith('WARN') && l.includes('confirm the removal')), 'the log should say it waits for a confirmation');
});

await run('an unconfirmed mass removal writes nothing, not even an image or a folder', async (ok) => {
  const dst = lbMassRemoval();
  const { res } = await drive('commit', { src: instance(ukRepo()), dst });
  ok(!res.ok && String(res.error).includes('Refusing to write'), `should refuse, got: ${res.error}`);
  ok(dst.writes.length === 0, `nothing written: ${dst.writes}`);
});

await run('a mass removal confirmed for fewer than the run would remove is refused', async (ok) => {
  const dst = lbMassRemoval();
  const { analysis } = await drive('analyze', { src: instance(ukRepo()), dst: lbMassRemoval() });
  const short = analysis.counts.nodesDeleted - 1;
  const { res } = await drive('commit', {
    src: instance(ukRepo()), dst, params: { ...PARAMS, removalsAck: { nodes: short, props: 0 } }
  });
  ok(!res.ok && String(res.error).includes('Refusing to write'), `should refuse, got: ${res.error}`);
  ok(dst.writes.length === 0, `nothing written: ${dst.writes}`);
});

await run('a confirmed mass removal goes across', async (ok) => {
  const dst = lbMassRemoval();
  const { analysis } = await drive('analyze', { src: instance(ukRepo()), dst: lbMassRemoval() });
  const { res } = await drive('commit', {
    src: instance(ukRepo()), dst, params: { ...PARAMS, removalsAck: { nodes: analysis.counts.nodesDeleted, props: 0 } }
  });
  ok(res.ok, `errored: ${res.error}`);
  const content = '/content/samsung/lb/fold-vs-flip/jcr:content';
  const gone = analysis.nodes.deleted.map((n) => n.node);
  ok(gone.length > 5, `precondition: a mass removal, got ${gone}`);
  for (const rel of gone) ok(resolve(dst.root, content + rel) === undefined, `${rel} should be removed`);
  ok(resolve(dst.root, content + '/root').pd_g_feature_benefit_552501717?.headlineText === '1. Flexible hinges',
    'the rest of the transfer should happen too');
});

await run('the page write refuses an unconfirmed mass removal on its own, too', async (ok) => {
  // The panel checks first; this is the worker's own check, for a caller that skips the panel.
  const src = instance(ukRepo());
  const dst = lbMassRemoval();
  const report = () => {};
  CURRENT = src.handler;
  const sourcePage = await actions.readPage({ client: new AemClient({ report }), settings: SETTINGS, report, params: { source: PARAMS.source } });
  CURRENT = dst.handler;
  let error = null;
  try {
    await actions.apply({ client: new AemClient({ report }), settings: SETTINGS, report, params: { ...PARAMS, sourcePage } });
  } catch (e) {
    error = e.message;
  }
  ok(String(error).includes('confirm the removal'), `should refuse for the removal, got: ${error}`);
  ok(dst.writes.length === 0, `nothing written: ${dst.writes}`);
});

await run('an unreadable image is listed to do by hand, never called missing', async (ok) => {
  const src = instance(ukRepo(), { forbidden: ['/content/dam/samsung/uk/guide/Tile_DT.png'] });
  const dst = instance(lbRepo({ withPage: false }));
  const { analysis } = await drive('analyze', { src, dst });
  ok(!analysis.blockers.length, `an image problem must not block: ${analysis.blockers}`);
  const row = analysis.imagesByHand.find((a) => a.from.endsWith('Tile_DT.png'));
  ok(row && /403/.test(row.reason) && !/missing/.test(row.reason), `listed as a 403: ${JSON.stringify(row)}`);
  ok(row?.to === '/content/dam/samsung/lb/guide/Tile_DT.png', `with where it belongs: ${row?.to}`);
});

await run('...and the page still goes across, pointing where it belongs', async (ok) => {
  const src = instance(ukRepo(), { forbidden: ['/content/dam/samsung/uk/guide/Tile_DT.png'] });
  const dst = instance(lbRepo({ withPage: false }));
  const { res } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  const fb = resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content/root/pd_g_feature_benefit_2084490669');
  ok(fb?.imageDesktopImageRef === '/content/dam/samsung/lb/guide/Tile_DT.png', `re-pointed: ${fb?.imageDesktopImageRef}`);
  ok(res.result.imagesByHand?.some((a) => a.from.endsWith('Tile_DT.png')), 'and it is on the list at the end');
});

await run('a truncated source page aborts', async (ok) => {
  const src = instance(ukRepo(), { truncate: true });
  const dst = instance(lbRepo());
  const { res } = await drive('analyze', { src, dst });
  ok(!res.ok, 'should not succeed');
  ok(String(res.error).includes('json.maximumresults'), `error: ${res.error}`);
  ok(dst.writes.length === 0, 'nothing written');
});

await run('a missing source page aborts before this instance is touched', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo());
  const { res } = await drive('analyze', {
    src, dst, params: { ...PARAMS, source: '/content/samsung/uk/nope' }
  });
  ok(!res.ok, 'should not succeed');
  ok(dst.writes.length === 0, 'nothing written here');
});

await run('a missing destination parent aborts, and says where it looked', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo({ withPage: false }));
  const { res } = await drive('analyze', {
    src, dst, params: { ...PARAMS, dest: '/content/samsung/lb/nope/fold-vs-flip' }
  });
  ok(!res.ok, 'should not succeed');
  ok(String(res.error).includes('/content/samsung/lb/nope'), `error: ${res.error}`);
  // The message has to point at the likely cause, because the likely cause is
  // having the two instances the wrong way round.
  ok(/destination instance/i.test(String(res.error)), `error: ${res.error}`);
  ok(dst.writes.length === 0, 'nothing written');
});

await run('the same instance on both sides is refused', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo());
  const { res, lines } = await drive('analyze', {
    src, dst, params: { ...PARAMS, destOrigin: PARAMS.sourceOrigin }
  }).catch((e) => ({ res: { ok: false, error: e.message }, lines: [] }));
  ok(!res.ok, 'should not succeed');
  ok(/Sync page/.test(String(res.error)), `error should point at the right feature: ${res.error}`);
});

await run('a destination instance other than the panel tab is honoured', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo({ withPage: false }));
  // ctx.origin is a THIRD origin, so only the explicit destOrigin can route this.
  const { res } = await drive('commit', {
    src, dst, params: { ...PARAMS, destOrigin: DEST_ORIGIN }, ctxOrigin: 'https://elsewhere.example.com'
  });
  ok(res.ok, `errored: ${res.error}`);
  ok(dst.writes.some((w) => w.startsWith('createPage')), 'the page should be created on the destination');
  ok(src.writes.length === 0, 'and nothing written on the source');
});

console.log('\n--- large images ---------------------------------------------');

const MB = 1024 * 1024;
/* 20MB of numbered 16-byte blocks, so a piece out of order or lost changes it. */
const BIG = Array.from({ length: (20 * MB) / 16 }, (_, i) => String(i).padStart(16, '0')).join('');

/** UK with one more image on the page, as `name`, holding `node`. */
function ukWithImage(name, node) {
  const uk = ukRepo();
  uk.content.samsung.uk['fold-vs-flip']['jcr:content'].root.cm_g_video.posterImageRef =
    `/content/dam/samsung/uk/guide/${name}`;
  uk.content.dam.samsung.uk.guide[name] = node;
  return uk;
}

await run('an image over one piece is carried in pieces and uploaded whole', async (ok) => {
  const src = instance(ukWithImage('Big.png', { ...asset(), __bytes: BIG }));
  const dst = instance(lbRepo({ withPage: false }));
  let reads = 0;
  const raw = src.handler;
  src.handler = (url, init) => {
    if (String(url).endsWith('/Big.png')) reads++;
    return raw(url, init);
  };
  const { res, lines } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  const up = resolve(dst.root, '/content/dam/samsung/lb/guide/Big.png');
  ok(up?.__bytes?.length === BIG.length, `uploaded ${up?.__bytes?.length} bytes, expected ${BIG.length}`);
  ok(up?.__bytes === BIG, 'the uploaded bytes should be exactly the source bytes, in order');
  ok(reads === 1, `the source should be read once and handed over in pieces, read ${reads} times`);
  ok(dst.writes.filter((w) => w.startsWith('upload /content/dam/samsung/lb/guide/Big.png')).length === 1,
    'uploaded once, not once per piece');
  ok(lines.some((l) => /uploaded .*Big\.png \(20 MB\)/.test(l)), `log should give the size: ${lines.join(' | ')}`);
});

const HUGE_META = (bytes) => ({
  ...asset(),
  'jcr:content': {
    'jcr:primaryType': 'dam:AssetContent',
    renditions: { original: { 'jcr:primaryType': 'nt:file', 'jcr:content': { ':jcr:data': bytes } } }
  }
});

await run('an image too large to carry is on the review, not a blocker', async (ok) => {
  const src = instance(ukWithImage('Huge.png', HUGE_META(300 * MB)));
  const dst = instance(lbRepo({ withPage: false }));
  const { res, analysis, lines } = await drive('analyze', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  const row = analysis.assets.find((a) => a.from.endsWith('Huge.png'));
  ok(row?.action === 'too large', `should be marked too large, got ${row?.action}`);
  ok(row?.size === '300 MB', `size shown, got ${row?.size}`);
  ok(analysis.counts.tooLarge === 1, `counted, got ${analysis.counts.tooLarge}`);
  ok(!analysis.blockers.length, `must not block: ${analysis.blockers}`);
  ok(!analysis.uploads.some((u) => u.from.endsWith('Huge.png')), 'must not be queued for upload');
  ok(lines.some((l) => l.startsWith('WARN') && l.includes('Huge.png') && l.includes('by hand')),
    `the log should say it is left to do by hand: ${lines.join(' | ')}`);
  ok(analysis.imagesByHand.some((a) => a.from.endsWith('Huge.png') && a.to.endsWith('/lb/guide/Huge.png')),
    `and it is on the list, with where it belongs: ${JSON.stringify(analysis.imagesByHand)}`);
});

await run('...and the rest of the page still goes across, pointing where it belongs', async (ok) => {
  const src = instance(ukWithImage('Huge.png', HUGE_META(300 * MB)));
  const dst = instance(lbRepo({ withPage: false }));
  const { res } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  ok(resolve(dst.root, '/content/dam/samsung/lb/guide/Tile_DT.png') !== undefined, 'the other image is uploaded');
  ok(resolve(dst.root, '/content/dam/samsung/lb/guide/Huge.png') === undefined, 'the huge one is not');
  const video = resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content/root/cm_g_video');
  ok(video?.posterImageRef === '/content/dam/samsung/lb/guide/Huge.png',
    `the reference points where the package will put it, got ${video?.posterImageRef}`);
});

await run('one found too large only while reading is skipped, and the run finishes', async (ok) => {
  // No rendition to say its size in advance; the response headers say it.
  const src = instance(ukWithImage('Late.png', { ...asset(), __declared: 400 * MB }));
  const dst = instance(lbRepo({ withPage: false }));
  const { res, lines } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  ok(lines.some((l) => l.startsWith('WARN') && l.includes('Skipped') && l.includes('Late.png')),
    `should warn: ${lines.join(' | ')}`);
  ok(res.result.imagesByHand?.some((a) => a.from.endsWith('Late.png') && /400 MB/.test(a.reason)),
    `and list it at the end: ${JSON.stringify(res.result.imagesByHand)}`);
  ok(resolve(dst.root, '/content/dam/samsung/lb/guide/Late.png') === undefined, 'not uploaded');
  ok(resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content/root') !== undefined, 'the page is written');
});

console.log('\n--- an image going wrong never stops the transfer --------------');

/** UK with a second image, Other.png, beside Tile_DT.png. */
const ukTwoImages = () => ukWithImage('Other.png', asset());

const byHandFor = (res, name) => res.result?.imagesByHand?.find((a) => a.from.endsWith(name));

await run('an upload the server refuses is skipped, the rest carries on, and it is listed', async (ok) => {
  const src = instance(ukTwoImages());
  const dst = instance(lbRepo({ withPage: false }), { uploadStatus: { 'Tile_DT.png': 413 } });
  const { res, lines } = await drive('commit', { src, dst });
  ok(res.ok, `the run should finish: ${res.error}`);
  ok(resolve(dst.root, '/content/dam/samsung/lb/guide/Other.png') !== undefined, 'the other image is uploaded');
  ok(resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content/root') !== undefined, 'the page is written');
  const row = byHandFor(res, 'Tile_DT.png');
  ok(row && /413/.test(row.reason), `listed with the reason: ${JSON.stringify(row)}`);
  ok(row?.to === '/content/dam/samsung/lb/guide/Tile_DT.png', `and where it belongs: ${row?.to}`);
  ok(!lines.some((l) => l.startsWith('FAIL')), `a skipped image is a warning, not a failure: ${lines.filter((l) => l.startsWith('FAIL'))}`);
});

await run('an upload that never answers is given up on, not waited on for ever', async (ok) => {
  const src = instance(ukTwoImages());
  const dst = instance(lbRepo({ withPage: false }), { uploadHangs: ['Tile_DT.png'] });
  const { res } = await quickly(() => drive('commit', { src, dst }));
  ok(res.ok, `the run should finish: ${res.error}`);
  const row = byHandFor(res, 'Tile_DT.png');
  ok(row && /did not answer/.test(row.reason), `listed as unanswered: ${JSON.stringify(row)}`);
  ok(resolve(dst.root, '/content/dam/samsung/lb/guide/Other.png') !== undefined, 'the next image still goes');
});

await run('an upload that lands but is never confirmed counts as uploaded', async (ok) => {
  const src = instance(ukTwoImages());
  const dst = instance(lbRepo({ withPage: false }), { uploadLandsSilently: ['Tile_DT.png'] });
  const { res } = await quickly(() => drive('commit', { src, dst }));
  ok(res.ok, `the run should finish: ${res.error}`);
  ok(resolve(dst.root, '/content/dam/samsung/lb/guide/Tile_DT.png') !== undefined, 'it is there');
  ok(!byHandFor(res, 'Tile_DT.png'), `so it is not on the list: ${JSON.stringify(res.result?.imagesByHand)}`);
});

await run('a read that stalls on the source is given up on and listed', async (ok) => {
  const src = instance(ukTwoImages(), { readHangs: ['/content/dam/samsung/uk/guide/Tile_DT.png'] });
  const dst = instance(lbRepo({ withPage: false }));
  const { res } = await quickly(() => drive('commit', { src, dst }));
  ok(res.ok, `the run should finish: ${res.error}`);
  const row = byHandFor(res, 'Tile_DT.png');
  ok(row && /stalled/.test(row.reason), `listed as stalled: ${JSON.stringify(row)}`);
  ok(resolve(dst.root, '/content/dam/samsung/lb/guide/Other.png') !== undefined, 'the next image still goes');
});

await run('the list at the end has both kinds: known before the run, and found during it', async (ok) => {
  const src = instance(ukWithImage('Huge.png', HUGE_META(300 * MB)));
  const dst = instance(lbRepo({ withPage: false }), { uploadStatus: { 'Tile_DT.png': 500 } });
  const { res } = await drive('commit', { src, dst });
  ok(res.ok, `the run should finish: ${res.error}`);
  ok(byHandFor(res, 'Huge.png') && byHandFor(res, 'Tile_DT.png'),
    `both listed: ${JSON.stringify(res.result?.imagesByHand)}`);
});

await run('the list tells an image to put in place from one missing on the source', async (ok) => {
  const uk = ukWithImage('Gone.png', undefined);
  const src = instance(uk, { forbidden: ['/content/dam/samsung/uk/guide/Tile_DT.png'] });
  const dst = instance(lbRepo({ withPage: false }));
  const { analysis } = await drive('analyze', { src, dst });
  const gone = analysis.imagesByHand.find((a) => a.from.endsWith('Gone.png'));
  const locked = analysis.imagesByHand.find((a) => a.from.endsWith('Tile_DT.png'));
  ok(gone?.kind === 'missing' && gone.to === '/content/dam/samsung/lb/guide/Gone.png',
    `missing everywhere, with the path the page will point at: ${JSON.stringify(gone)}`);
  ok(locked?.kind === 'upload' && locked.to.endsWith('/lb/guide/Tile_DT.png'), `to put in place: ${JSON.stringify(locked)}`);
});

console.log('\n--- deleted from the source DAM, still on Dynamic Media ---------');

const DM_LIVE = 'https://images.samsung.com/is/image/samsung/assets/';

/** The source instance, plus a Dynamic Media live host serving `served` (paths under uk/). */
function withDelivery(src, served) {
  const raw = src.handler;
  const asked = [];
  src.handler = (url, init) => {
    const u = String(url);
    if (!u.startsWith('https://')) return raw(url, init);
    asked.push(u);
    const hit = served.some((p) => u === `${DM_LIVE}${p}`);
    return Promise.resolve(hit ? mk(200, 'DMBYTES', { 'content-type': 'image/png' }) : mk(404, 'nf'));
  };
  return asked;
}

/** UK with Tile_DT.png deleted from its DAM - the page still points at it. */
function ukImageDeleted() {
  const uk = ukRepo();
  delete uk.content.dam.samsung.uk.guide['Tile_DT.png'];
  return uk;
}

await run('an image Dynamic Media still serves is carried from there, to where it belongs', async (ok) => {
  const src = instance(ukImageDeleted());
  withDelivery(src, ['uk/guide/Tile_DT.png']);
  const dst = instance(lbRepo({ withPage: false }));
  const { res } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  const up = resolve(dst.root, '/content/dam/samsung/lb/guide/Tile_DT.png');
  ok(up?.__bytes === 'DMBYTES', `uploaded from Dynamic Media, got ${JSON.stringify(up?.__bytes)}`);
  const fb = resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content/root/pd_g_feature_benefit_2084490669');
  ok(fb?.imageDesktopImageRef === '/content/dam/samsung/lb/guide/Tile_DT.png', `reference: ${fb?.imageDesktopImageRef}`);
  ok(!byHandFor(res, 'Tile_DT.png'), `carried, so not on the list: ${JSON.stringify(res.result?.imagesByHand)}`);
});

await run('...and the review says where it comes from', async (ok) => {
  const src = instance(ukImageDeleted());
  withDelivery(src, ['uk/guide/Tile_DT.png']);
  const dst = instance(lbRepo({ withPage: false }));
  const { analysis } = await drive('analyze', { src, dst });
  const row = analysis.assets.find((a) => a.from.endsWith('Tile_DT.png'));
  ok(row?.action === 'upload' && row.source === 'Dynamic Media', `row: ${JSON.stringify(row)}`);
  ok(analysis.counts.fromDelivery === 1, `counted: ${analysis.counts.fromDelivery}`);
});

await run('a sync replaces the old image here, even when the source image is gone everywhere', async (ok) => {
  // The paired component here has its own, older image. Leaving the property
  // alone kept that image beside the new text - the bug this guards against.
  const src = instance(ukImageDeleted());
  withDelivery(src, []);
  const dst = instance(lbRepo());
  const { res } = await drive('commit', { src, dst });
  ok(res.ok, `errored: ${res.error}`);
  const fb = resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content/root/pd_g_feature_benefit_552501717');
  ok(fb?.imageDesktopImageRef === '/content/dam/samsung/lb/guide/Tile_DT.png',
    `the old image should be replaced by where the source's belongs, got ${fb?.imageDesktopImageRef}`);
  const row = byHandFor(res, 'Tile_DT.png');
  ok(row?.kind === 'missing' && /not available/.test(row.reason), `listed as not available: ${JSON.stringify(row)}`);
});

await run('a Dynamic Media copy that cannot be read is listed with its links', async (ok) => {
  const src = instance(ukImageDeleted());
  const asked = withDelivery(src, ['uk/guide/Tile_DT.png']);
  // Found by the HEAD at analysis, gone by the time it is read.
  const head = src.handler;
  src.handler = (url, init) =>
    String(url).startsWith(DM_LIVE) && (init?.method || 'GET') === 'GET'
      ? Promise.resolve(mk(404, 'nf'))
      : head(url, init);
  const dst = instance(lbRepo({ withPage: false }));
  const { res } = await drive('commit', { src, dst });
  ok(res.ok, `the run should finish: ${res.error}`);
  const row = byHandFor(res, 'Tile_DT.png');
  ok(row?.kind === 'delivered' && row.urls?.some((u) => u.url.startsWith(DM_LIVE)),
    `listed with the Dynamic Media link: ${JSON.stringify(row)}`);
  ok(asked.length > 0, 'Dynamic Media was asked');
});

/* ------------------------------------- the page here backed up before a transfer */

await run('backup first: the page here is backed up under india/backup before the transfer writes', async (ok) => {
  const src = instance(ukRepo());
  const dst = instance(lbRepo());
  const settings = { backupFolder: 'india/backup', marketingTemplate: '/conf/consumer/settings/wcm/templates/page-static-gnb' };
  const review = await drive('analyze', { src, dst, settings });
  ok(review.analysis?.backup?.state === 'missing', `review should say missing, got ${JSON.stringify(review.analysis?.backup)}`);
  const before = JSON.stringify(resolve(dst.root, '/content/samsung/lb/fold-vs-flip/jcr:content'));
  const { res, lines } = await drive('commit', { src, dst, settings });
  ok(res.ok, `commit failed: ${res.error}`);
  const backup = resolve(dst.root, '/content/samsung/lb/india/backup/fold-vs-flip/jcr:content');
  ok(backup, 'the backup should be there');
  const strip = (o) => JSON.stringify(o, (k, v) => (/^(jcr:uuid|jcr:created|jcr:createdBy|cq:last\w*|jcr:lastModified\w*|jcr:baseVersion|jcr:predecessors|jcr:versionHistory|jcr:isCheckedOut)$/.test(k) ? undefined : v));
  ok(backup && strip(backup) === strip(JSON.parse(before)), 'the backup should hold the page as it was before the transfer');
  const backupAt = dst.writes.findIndex((w) => w.includes('/india/backup/'));
  const pageAt = dst.writes.findIndex((w) => w.includes('/content/samsung/lb/fold-vs-flip/') || w.startsWith('version /content/samsung/lb/fold-vs-flip'));
  ok(backupAt !== -1 && backupAt < pageAt, `the backup must come first: ${JSON.stringify(dst.writes.slice(0, 6))}`);
  ok(lines.some((l) => l.includes('backup taken')), 'the log should say so');
});


console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
