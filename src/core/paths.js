/**
 * Pure JCR path helpers. No network, no DOM - so they are equally usable from
 * the panel, the content script and a plain node test harness.
 */

/**
 * A part that names somewhere else rather than a node: `.` and `..` - also
 * spelled `%2e` - which fetch() resolves before the request leaves, and an
 * encoded slash, which a server may. A path holding one is checked as one
 * page and read or written as another, so it is refused here, where every
 * path is taken apart, rather than in each check that might miss it. No JCR
 * node can be called any of these, so no real path is turned away.
 */
const NOT_A_NAME = /^(\.|%2e){1,2}$|%2f|%5c/i;

export function segs(p) {
  const s = String(p || '').split('/').filter(Boolean);
  if (s.some((name) => NOT_A_NAME.test(name))) {
    const e = new Error(
      `${String(p)} is not a page path DSY will use: it has a "." or ".." part, or an encoded slash, ` +
        'so it points somewhere other than it reads. Type the full path without it.'
    );
    // Shown to the operator as it is, like any other refusal - see content/runtime.js.
    e.isAbort = true;
    throw e;
  }
  return s;
}

export function norm(p) {
  return '/' + segs(p).join('/');
}

export function nameOf(p) {
  const s = segs(p);
  return s[s.length - 1] || '';
}

export function parentOf(p) {
  return '/' + segs(p).slice(0, -1).join('/');
}

export function humanize(name) {
  return String(name)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Right-align two paths segment by segment, from the leaf backwards.
 *
 *   src  /content/samsung/levant/              home-appliances/buying-guide/microwaves
 *   dst  /content/samsung/levant/india/backup/ home-appliances/buying-guide/microwaves
 *                               └─ inserted ─┘ └──────────── aligned ────────────────┘
 *
 * The matching suffix tells us which destination segments have a counterpart in
 * the source; everything above it was inserted and has none. Suffix alignment
 * rather than a by-name search, so a repeated segment name resolves correctly.
 */
export function align(source, dest, rootDepth) {
  const s = segs(source);
  const d = segs(dest);

  let k = 0;
  while (k < s.length && k < d.length && s[s.length - 1 - k] === d[d.length - 1 - k]) k++;

  const steps = d.map((name, i) => {
    const offsetFromEnd = d.length - i; // 1 == leaf
    const aligned = offsetFromEnd <= k;
    const srcIdx = s.length - offsetFromEnd;
    return {
      name,
      destPath: '/' + d.slice(0, i + 1).join('/'),
      isLeaf: i === d.length - 1,
      withinRoot: i < rootDepth,
      aligned,
      sourceCandidate: aligned && srcIdx >= 0 ? '/' + s.slice(0, srcIdx + 1).join('/') : null
    };
  });

  return { commonSuffix: k, steps };
}

/**
 * Where a page's backup lives: the backup folder inserted directly under the
 * site root, with the rest of the source path kept as it is.
 *
 *   /content/samsung/levant/            home-appliances/buying-guide/microwaves
 *   /content/samsung/levant/india/backup/home-appliances/buying-guide/microwaves
 *
 * Derived rather than typed, so a backup always lands where the next person
 * will look for it. Throws with a readable reason when there is no sensible
 * answer - the panel shows it under the field, the worker aborts on it.
 */
export function backupPathFor(source, rootDepth, folder) {
  const s = segs(source);
  const f = segs(folder);

  if (!f.length) throw new Error('No backup folder is configured. Set one in settings.');
  if (s[0] !== 'content') throw new Error('The source page must be under /content.');
  if (s.length <= rootDepth) {
    throw new Error(`The source is at or above the site root (depth ${rootDepth}), so it has no backup location.`);
  }
  if (atBackupFolder(s, f, rootDepth)) {
    throw new Error(`The source is already inside the backup folder (${f.join('/')}).`);
  }

  return '/' + [...s.slice(0, rootDepth), ...f, ...s.slice(rootDepth)].join('/');
}

/** Does the backup folder start right under the site root of these segments? */
const atBackupFolder = (s, f, rootDepth) => f.every((name, i) => s[rootDepth + i] === name);

/**
 * Is this page inside the backup folder - /content/<brand>/<site>/india/backup/...?
 *
 * What the Versions tool asks before it will restore or create anything, so
 * it is also what decides whether versioning a page before writing to it is
 * worth doing: a version on any other page cannot be restored from here.
 *
 * The same rule backupPathFor uses: the folder directly under the site root,
 * and nowhere else. Matched anywhere in the path, a live page such as
 * /uk/promo/india/backup/x passed as a backup while backupPathFor still
 * treated it as live. `rootDepth` defaults to the settings' own default.
 */
export function insideBackupFolder(path, folder, rootDepth = 3) {
  const f = segs(folder);
  const s = segs(path);
  return !!f.length && s[0] === 'content' && s.length > rootDepth + f.length && atBackupFolder(s, f, rootDepth);
}

/** Is this page on the global site - /content/<brand>/global/...? */
export function isGlobalPage(path, rootDepth) {
  return segs(path)[rootDepth - 1] === 'global';
}

/** Folders between /global and the page path a site mirrors: hq/vd, hq/da... */
const GLOBAL_PREFIX = 2;

/**
 * A global page's backup, built from the site it is backed up into: the two
 * folders under /global dropped, the rest kept under that site's backup folder.
 *
 *   /content/samsung/global/hq/vd/       tvs/tv-buying-guide/tv-comparison-guide
 *   /content/samsung/levant/india/backup/tvs/tv-buying-guide/tv-comparison-guide
 */
export function globalBackupPathFor(source, site, rootDepth, folder) {
  const s = segs(source);
  const f = segs(folder);
  const token = String(site || '').trim().replace(/^\/+|\/+$/g, '');

  if (!f.length) throw new Error('No backup folder is configured. Set one in settings.');
  if (!token) throw new Error('Type the site this global page is backed up into, e.g. levant.');
  if (!/^[a-z0-9_-]+$/i.test(token)) throw new Error(`"${token}" is not a site name - type just the name, e.g. levant.`);
  if (token === 'global') throw new Error('The target site must not be global itself.');
  if (s.length <= rootDepth + GLOBAL_PREFIX) {
    throw new Error(`The source has no page path under /global/${s.slice(rootDepth, rootDepth + GLOBAL_PREFIX).join('/')}.`);
  }

  return '/' + [...s.slice(0, rootDepth - 1), token, ...f, ...s.slice(rootDepth + GLOBAL_PREFIX)].join('/');
}

/**
 * The Edit path escape hatch for a global page - its destination typed in full:
 *
 *   /content/samsung/global/hq/vd/       tvs/tv-buying-guide/tv-comparison-guide
 *   /content/samsung/levant/india/backup/tvs/tv-buying-guide/tv-comparison-guide
 *
 * Checked rather than trusted: it must sit inside a site's backup folder, so a
 * backup can never overwrite a live page, and keep the source's page name -
 * copyPage cannot rename.
 */
export function typedBackupPath(source, dest, rootDepth, folder) {
  const s = segs(source);
  const d = segs(dest);
  const f = segs(folder);

  if (!d.length) throw new Error('Type the destination page: a global page has no backup folder of its own.');
  if (!f.length) throw new Error('No backup folder is configured. Set one in settings.');
  if (d[0] !== 'content') throw new Error('The destination page must be under /content.');
  if (!atBackupFolder(d, f, rootDepth)) {
    throw new Error(`The destination must be inside a site's backup folder: /content/<brand>/<site>/${f.join('/')}/...`);
  }
  if (d.length <= rootDepth + f.length) throw new Error('The destination is the backup folder itself - add the page path under it.');
  if (d[d.length - 1] !== s[s.length - 1]) {
    throw new Error(`The destination must end in the source's page name, "${s[s.length - 1]}" - a copy cannot rename.`);
  }
  if (isGlobalPage(dest, rootDepth)) throw new Error('The destination must not be on the global site.');

  return '/' + d.join('/');
}
