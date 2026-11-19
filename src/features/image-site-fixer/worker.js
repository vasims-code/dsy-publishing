/**
 * image-site-fixer: find images in a page's content that sit in another
 * site's DAM folder - /content/dam/samsung/lb/... or images.samsung.com/is/
 * image/samsung/assets/lb/... on an /iq_ku page - then upload the ticked ones
 * to the page's own folder and point the page at them.
 *
 * Uploaded, never copied in the repository: an upload is processed by AEM as
 * a new asset, and on a Dynamic Media instance pushed to Scene7, which is what
 * gives it its own images.samsung.com address. A repository copy carries the
 * source's Scene7 metadata and never reaches Scene7. The upload is Copy a
 * page's own (page-upsert's uploadAsset); an image gone from the source DAM
 * but still on Dynamic Media is read from there, as Copy a page does.
 *
 * The scan reads only. The fix is checked the way the Site Code Link Fixer's
 * is: every pick must be an image the scan finds now, every property must
 * still hold what the scan read, the images are uploaded and found before any
 * property is changed, and every property is read back after the write.
 */

import { abort } from '../../core/aem-client.js';
import { findOnDelivery } from '../../core/dynamic-media.js';
import { norm, parentOf, segs } from '../../core/paths.js';
import { sameValue } from '../../core/rewrite.js';
import { uploadAsset } from '../page-upsert/worker.js';
import {
  assertWrite,
  componentTitles,
  pack,
  pairsFor,
  pool,
  readPage,
  siteFor
} from '../site-code-fixer/worker.js';
import { applyFixes, destOf, repoint, scanContent } from './images.js';

const PROBE_CONCURRENCY = 6;
const DAM_FOLDER_TYPE = 'sling:OrderedFolder';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** /content/samsung -> /content/dam/samsung */
const damRootOf = (contentRoot) => '/content/dam/' + segs(contentRoot).slice(1).join('/');

/**
 * The page's own DAM folder: the one named on the form, or the site code.
 * A page and its images are not always named alike - /ae_ar keeps its images
 * under /ae - so it can be named, and it must exist.
 */
async function ownFolder(client, page, settings, params) {
  const { site, contentRoot } = siteFor(page, settings);
  const damRoot = damRootOf(contentRoot);
  const named = String(params.damFolder || '').trim().replace(/^\/+|\/+$/g, '');
  if (named && !/^[A-Za-z0-9][\w-]*$/.test(named)) throw abort(`"${named}" is not a DAM folder name. Give one folder, such as ${site}.`);
  const folder = named || site;
  const at = await client.probe(`${damRoot}/${folder}`).catch(() => 'error');
  if (at !== 'yes') {
    throw abort(
      at === 'no'
        ? `There is no DAM folder ${damRoot}/${folder}. If this site keeps its images under another name, give it as the DAM folder.`
        : `Could not read ${damRoot}/${folder} (${at}). Nothing has been written.`
    );
  }
  return { site, contentRoot, damRoot, folder };
}

/** The references into folders other than the page's own. */
function foreignRefs(content, own) {
  const { refs, nodes } = scanContent(content, own.damRoot);
  return { refs: refs.filter((r) => r.folder !== own.folder), nodes };
}

/** Which folders are sites - a page at /content/<brand>/<folder>. Unreadable counts as no. */
async function siteFolders(client, contentRoot, folders) {
  const found = new Set();
  await pool([...folders], PROBE_CONCURRENCY, async (f) => {
    const props = await client.readProps(`${contentRoot}/${f}`).catch(() => null);
    if (props?.['jcr:primaryType'] === 'cq:Page') found.add(f);
  });
  return found;
}

/**
 * One row per image: where it is, where it would go, and what can be done.
 *   upload            in the source DAM, not yet in this folder
 *   upload-delivery   gone from the source DAM, still on Dynamic Media - uploaded from there
 *   there             already in this folder: only the page is re-pointed
 *   missing           in neither: nothing to upload, so it is left as it is
 *   unreadable        the DAM would not say
 */
async function planImages(client, refs, own) {
  const byPath = new Map();
  for (const r of refs) {
    if (!byPath.has(r.path)) byPath.set(r.path, { path: r.path, folder: r.folder, refs: [] });
    byPath.get(r.path).refs.push(r);
  }
  return pool([...byPath.values()], PROBE_CONCURRENCY, async (img) => {
    const dest = destOf(img.path, own.damRoot, img.folder, own.folder);
    const base = { src: img.path, dest, folder: img.folder, uses: img.refs.length };
    const here = await client.probe(dest).catch(() => 'error');
    if (here === 'yes') return { ...base, action: 'there' };
    if (here !== 'no') return { ...base, action: 'unreadable', why: `${dest} could not be read` };
    const at = await client.probe(img.path).catch(() => 'error');
    if (at === 'yes') return { ...base, action: 'upload' };
    if (at !== 'no') return { ...base, action: 'unreadable', why: `${img.path} could not be read` };
    const delivery = await findOnDelivery(img.path);
    const via = delivery.found[0]?.url || null;
    return via ? { ...base, action: 'upload-delivery', via } : { ...base, action: 'missing', delivery };
  });
}

/** An image that can be fixed: one that is, or can be put, in this folder. */
export const fixable = (img) => img.action === 'upload' || img.action === 'upload-delivery' || img.action === 'there';

export const actions = {
  /** Reads only. Lists every image in the page's content from another DAM folder. */
  async scan({ client, report, params, settings }) {
    client.resetCaches();
    const { page, title, content } = await readPage(client, params.page);
    const own = await ownFolder(client, page, settings, params);
    const { refs, nodes } = foreignRefs(content, own);

    const folders = new Set(refs.map((r) => r.folder));
    const sites = folders.size ? await siteFolders(client, own.contentRoot, folders) : new Set();
    const images = await planImages(client, refs, own);
    const titles = await componentTitles(client, new Set(refs.map((r) => r.resourceType)));

    for (const img of images) {
      img.site = sites.has(img.folder);
      img.uses = refs
        .filter((r) => r.path === img.src)
        .map((r) => ({
          node: r.node,
          prop: r.prop,
          index: r.index,
          start: r.start,
          from: r.from,
          to: repoint(r, own.folder),
          form: r.form,
          title: titles.get(r.resourceType) || null,
          type: r.type,
          liveCopy: !!r.liveCopy
        }));
    }
    // The value each property held when it was read, once per property: the fix is refused if it has moved on.
    const props = [];
    const seen = new Set();
    for (const r of refs) {
      const id = `${r.node}|${r.prop}`;
      if (seen.has(id)) continue;
      seen.add(id);
      props.push({ node: r.node, prop: r.prop, expect: r.value });
    }
    images.sort((a, b) => Number(b.site) - Number(a.site) || a.folder.localeCompare(b.folder) || a.src.localeCompare(b.src));

    const otherFolders = [...folders]
      .map((f) => ({ folder: f, site: sites.has(f), images: images.filter((i) => i.folder === f).length }))
      .sort((a, b) => b.images - a.images || a.folder.localeCompare(b.folder));

    const r = { page, title, site: own.site, damRoot: own.damRoot, folder: own.folder, nodes, images, props, otherFolders };
    report('data', 'analysis', r);
    report(
      'info',
      images.length
        ? `${plural(images.length, 'image')} from other DAM folders (${otherFolders.map((o) => `/${o.folder} ${o.images}`).join(', ')}) ` +
            `in ${plural(refs.length, 'place')}. This page's folder is ${own.damRoot}/${own.folder}. Nothing has been written.`
        : `Every image in ${nodes} nodes is in ${own.damRoot}/${own.folder}. Nothing to fix.`
    );
    for (const img of images.filter((i) => i.action === 'missing' || i.action === 'unreadable')) {
      report('warn', `${img.src}: ${img.action === 'missing' ? 'not in the DAM, nor on Dynamic Media' : img.why} - left as it is`);
    }
    return r;
  },

  /**
   * Writes. `picks` is the DAM paths of the images to fix, `props` the
   * [{ node, prop, expect }] the scan read.
   */
  async fix({ client, report, params, settings }) {
    client.resetCaches();
    const step = (id, state, note) => report('data', 'step', { id, state, note });
    const picks = [...new Set((Array.isArray(params.picks) ? params.picks : []).map(String))];
    if (!picks.length) throw abort('Tick at least one image to fix.');

    const page = norm(params.page);
    const target = `${page}/jcr:content`;

    /* ---- 1. every pick is an image the scan finds now, every property as scanned */
    step('check-first', 'running');
    const fail = (why) => {
      step('check-first', 'failed');
      return abort(`${why} Nothing has been written - scan the page again.`);
    };
    const own = await ownFolder(client, page, settings, params);
    const content = (await client.readTreeWhole(target)) || {};
    const { refs } = foreignRefs(content, own);
    const images = await planImages(client, refs.filter((r) => picks.includes(r.path)), own);
    for (const p of picks) {
      const img = images.find((i) => i.src === p);
      if (!img) throw fail(`${p} is not an image the scan finds on the page now.`);
      if (!fixable(img)) throw fail(`${p} can no longer be fixed (${img.action}).`);
    }
    const expected = new Map((Array.isArray(params.props) ? params.props : []).map((x) => [`${x?.node}|${x?.prop}`, x?.expect]));
    const touched = new Map();
    for (const r of refs) {
      if (!picks.includes(r.path)) continue;
      const id = `${r.node}|${r.prop}`;
      if (!touched.has(id)) touched.set(id, { node: r.node, prop: r.prop, value: r.value, refs: [] });
      touched.get(id).refs.push(r);
    }
    const writes = [];
    for (const [id, t] of touched) {
      if (!expected.has(id) || !sameValue(t.value, expected.get(id))) throw fail(`${t.node} › ${t.prop} has changed since the scan.`);
      let to;
      try {
        to = applyFixes(t.value, t.refs, own.folder);
      } catch (e) {
        throw fail(`${t.node} › ${t.prop}: ${e.message}.`);
      }
      writes.push({ node: t.node, prop: t.prop, to, refs: t.refs });
    }
    const lockOwner = (await client.readProps(target))?.['jcr:lockOwner'] || null;
    const me = await client.currentUser().catch(() => null);
    if (lockOwner && lockOwner !== me) {
      step('check-first', 'failed');
      throw abort(`The page is locked by ${lockOwner}. Ask them to unlock it, then fix again. Nothing has been written.`);
    }
    step('check-first', 'done');

    /* ---- 2. the images, before anything points at them -------------------- */
    const uploads = images.filter((i) => i.action === 'upload' || i.action === 'upload-delivery');
    step('upload', 'running');
    const folders = new Set();
    for (const a of uploads) {
      let cur = parentOf(a.dest);
      while (cur.length > `${own.damRoot}/${own.folder}`.length) {
        folders.add(cur);
        cur = parentOf(cur);
      }
    }
    try {
      for (const f of [...folders].sort((a, b) => a.length - b.length)) {
        if ((await client.probe(f)) === 'yes') continue;
        assertWrite(await client.createFolder(f, DAM_FOLDER_TYPE), `Creating the folder ${f}`);
        report('ok', `folder  ${f}`);
      }
      let n = 0;
      for (const a of uploads) {
        const of = `${n + 1}/${uploads.length}`;
        await uploadAsset(client, { src: a.src, dest: a.dest, via: a.via || null }, (note) => step('upload', 'running', `${of} · ${note}`));
        report('ok', `uploaded  ${a.dest}${a.via ? ` (from Dynamic Media, ${a.via})` : ''}`);
        n++;
      }
    } catch (e) {
      step('upload', 'failed');
      throw abort(`${e.message.replace(/\.$/, '')}. The page has not been changed.`);
    }
    step('upload', 'done', uploads.length ? plural(uploads.length, 'image') : 'already there');

    /* ---- 3. the page --------------------------------------------------------- */
    step('write', 'running');
    const units = pairsFor(writes);
    // The page shows as modified, so it is picked up for publishing.
    units.push([['./cq:lastModified@TypeHint', 'Date'], ['./cq:lastModified', new Date().toISOString()]]);
    if (me) units[units.length - 1].push(['./cq:lastModifiedBy', me]);
    const requests = pack(units);
    let sent = 0;
    try {
      for (const part of requests) {
        const answer = assertWrite(await client.writeNode(target, part), 'Writing the image paths');
        if (answer.effective === 201 || (answer.resultPath && decodeURI(answer.resultPath) !== target)) {
          throw abort(`AEM saved the request, but not into this page (status ${answer.effective} for ${answer.resultPath || '(no path)'})`);
        }
        sent++;
      }
    } catch (e) {
      step('write', 'failed');
      throw abort(
        `${e.message.replace(/\.$/, '')}. The images are uploaded. ` +
          (sent ? `${sent} of ${requests.length} requests were saved before this one - scan the page again to see where it stands.` : 'The page was not changed.')
      );
    }
    const changed = writes.reduce((n, w) => n + w.refs.length, 0);
    for (const w of writes) for (const r of w.refs) report('ok', `${w.node} › ${w.prop}: ${r.from} → ${repoint(r, own.folder)}`);
    step('write', 'done', plural(changed, 'reference'));

    /* ---- 4. read back -------------------------------------------------------- */
    step('check', 'running');
    const off = [];
    for (const w of writes) {
      const live = await client.readProps(`${target}/${w.node}`);
      if (!live || !sameValue(live[w.prop], w.to)) off.push(`${w.node} › ${w.prop}`);
    }
    if (off.length) {
      step('check', 'failed');
      for (const o of off) report('warn', `does not hold the fixed value: ${o}`);
      throw abort(`${plural(off.length, 'property', 'properties')} did not read back as written - check the page.`);
    }
    const after = await client.readTreeWhole(target);
    const remaining = after ? new Set(foreignRefs(after, own).refs.map((r) => r.path)).size : 0;
    step('check', 'done', remaining ? `${remaining} other image${remaining === 1 ? '' : 's'} left as they were` : `every image in /${own.folder}`);
    report('ok', `Done. ${plural(picks.length, 'image')} now in ${own.damRoot}/${own.folder}, ${plural(changed, 'reference')} re-pointed on ${page}`);

    return {
      done: true,
      page,
      dest: page,
      site: own.site,
      folder: `${own.damRoot}/${own.folder}`,
      fixed: picks.length,
      uploaded: uploads.length,
      references: changed,
      remaining,
      uploadedPaths: uploads.map((a) => a.dest),
      title: `${plural(picks.length, 'image')} moved to /${own.folder}`,
      editorUrl: `/editor.html${page}.html`
    };
  }
};
