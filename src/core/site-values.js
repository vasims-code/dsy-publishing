/**
 * Site values: the page properties that name the site itself rather than say
 * anything about the page - the Twitter handle, the "| Samsung Lebanon" at the
 * end of the share titles, the page language.
 *
 * Nothing about them can be read off the path. "levant" becomes @SamsungLEVANT,
 * "Samsung Jordan" and en-JO, and none of those follow from "levant". What
 * does hold them is each site's home page - /content/samsung/levant - so they
 * are read from there, on both sides, and nothing here knows a single site.
 *
 * Pure except `readHome`, so the workers and a node test share the same rules.
 */

/** Set to the destination home page's value, whatever the source had. */
const HANDLES = ['twitterSite', 'twitterCreator'];

/** Only their ending changes: "Air Conditioners | Samsung Lebanon" -> "Air Conditioners | Samsung Jordan". */
const TITLES = ['ogTitle', 'twitterTitle'];

/** Normally set on the home page only, so set only where the source page has it too. */
const LANGUAGE = 'jcr:language';

/** Every property this can change, for the workers' lists. */
export const SITE_PROPS = [...HANDLES, ...TITLES, LANGUAGE];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const text = (v) => (typeof v === 'string' && v.trim() ? v : null);
const quote = (v) => `"${String(v).trim()}"`;
const and = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0]);

/** Does this page set any of them? Without one there is no home page to read. */
export const touchesSite = (page) => SITE_PROPS.some((p) => text(page?.[p]) !== null);

/** The home page of a site: /content/samsung + /levant. */
export const homeOf = (sites, site) => `${sites.contentRoot}/${site}`;

/**
 * A home page's properties, as { path, state, props }. `state` is 'ok',
 * 'missing' or 'unreadable' - the last kept apart, because "this site has no
 * handle" and "this account cannot see the home page" are different answers.
 * Reads only.
 */
export async function readHome(client, path) {
  try {
    const { status, json } = await client.readJson(`${path}/jcr:content`, 0);
    if (status === 200 && json) return { path, state: 'ok', props: json };
    return { path, state: status === 403 ? 'unreadable' : 'missing', props: null };
  } catch {
    return { path, state: 'unreadable', props: null };
  }
}

/** Only what this needs - a home page read crosses between tabs on a transfer. */
export const homeProps = (props) =>
  props ? Object.fromEntries(['jcr:title', ...SITE_PROPS].filter((p) => p in props).map((p) => [p, props[p]])) : null;

/**
 * The ways a site's titles might end, best guess first.
 *
 * A home page does not state its ending; it has to be read out of what the
 * home page calls itself, and more than one reading is possible. Samsung's
 * UK home page is titled "Samsung UK" and shares as "Samsung UK | Home
 * Appliances | TV", so "everything after its own name" reads the ending as
 * " | Home Appliances | TV" - while every content page on that site ends
 * " | Samsung UK". Both readings are plausible from the home page alone, and
 * only the page being copied can say which is right (see `siteValues`).
 *
 * So the readings are offered rather than chosen:
 *
 *   after-name     its share title minus its own name: for a site whose home
 *                  page shares as "Mobiles, TVs | Samsung Lebanon"
 *   last-segment   the last "| ..." of its share title
 *   name-first     its FIRST segment, moved to the end: for a home page that
 *                  names the site and then describes it, "Samsung UK | Home
 *                  Appliances | TV", whose content pages end " | Samsung UK"
 *   site-name      " | " and its own name - how a content page usually ends
 *
 * Empty when the home page gives nothing. Nothing is invented.
 */
export function titleEndings(home) {
  if (!home) return [];
  const out = [];
  const title = text(home['jcr:title'])?.trim();
  const push = (rule, ending) => {
    if (!ending?.trim()) return;
    if (!out.some((c) => c.ending.trim() === ending.trim())) out.push({ rule, ending });
  };

  for (const p of TITLES) {
    const v = text(home[p])?.trim();
    if (!v) continue;
    // Its own title, then a separator: "Mobiles, TVs | Samsung Lebanon" minus "Mobiles" is not an ending.
    if (title && v.length > title.length && v.startsWith(title) && /^\s*[|\-–—:·]\s*\S/.test(v.slice(title.length))) {
      push('after-name', v.slice(title.length));
    }
    /* One segment. `[^|]+` rather than `[^|]*\S[^|]*`, which let a bar
       through as its own \S and matched two segments as one. */
    const bar = v.match(/\s*\|[^|]+$/);
    if (bar && bar.index > 0) push('last-segment', bar[0]);

    /* The home page names the site first and describes it after. Samsung's
       do: "Samsung UK | Home Appliances | TV", while every content page on
       that site ends " | Samsung UK". The site's name is the first segment,
       and it belongs at the end. */
    const first = v.split('|')[0]?.trim();
    if (first && v.includes('|')) push('name-first', ` | ${first}`);
  }
  if (title) push('site-name', ` | ${title}`);
  return out;
}

/** The first reading, for a caller with no page to check them against. */
export const titleEnding = (home) => titleEndings(home)[0]?.ending ?? null;

/** Does this value already end that way? The spaces around the bar may differ. */
const endsWith = (value, ending) => swapEnding(value, ending, ending) !== null;

/**
 * A title with the source site's ending swapped for the destination's, or null
 * when it does not end that way. The spaces around the bar may differ - the
 * words may not.
 */
export function swapEnding(value, from, to) {
  if (typeof value !== 'string') return null;
  const re = new RegExp(`\\s*${esc(from.trim()).replace(/\s+/g, '\\s*').replace(/\\\|/g, '\\s*\\|\\s*')}\\s*$`);
  if (!re.test(value)) return null;
  const head = value.replace(re, '');
  return head ? head + to : to.trim();
}

/** The words of a title, lower-cased, for telling which segment names the site. */
const wordsOf = (v) =>
  new Set(
    String(v ?? '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 2)
  );

/**
 * The words both sites' home pages have in common - "samsung" - read off what
 * each calls itself and shares as. Empty when they share none, and then
 * nothing is filtered on it. Not only their own titles: two home pages both
 * called "Mobiles, TVs" have the site's name in their share titles alone.
 *
 * A reading is only believed when its ending bears one of them. Without
 * that, a page genuinely ending " | TV" matched the last-segment reading of
 * "Samsung UK | Mobile | TV" and became " | Home"; and a destination home
 * page titled "Mobiles, TVs" offered " | Mobiles, TVs" as its site's name.
 */
function brandWords(srcHome, destHome) {
  const all = (h) => new Set(['jcr:title', ...TITLES].flatMap((p) => [...wordsOf(h?.[p])]));
  const dest = all(destHome);
  return new Set([...all(srcHome)].filter((w) => dest.has(w)));
}

/**
 * The site values this page gets at the destination, as
 * { from, to, values: { prop: value }, notes: [text] }.
 *
 * `page` is the source page's own properties (its jcr:content); `src` and
 * `dest` are the two home pages as `readHome` returns them. A value is given
 * only for a property the source page has, and only where it would change -
 * a property the page does not have is not added, and one the run cannot work
 * out keeps the source's value, with a note saying why. Notes are about this
 * page: a home page that cannot be read says nothing when the page has none of
 * the properties.
 */
export function siteValues({ page, src, dest }) {
  const values = {};
  const notes = [];
  const out = { from: src.path, to: dest.path, values, notes };
  const has = (p) => text(page?.[p]) !== null;
  const wanted = SITE_PROPS.filter(has);
  if (!wanted.length) return out;

  if (dest.state !== 'ok') {
    notes.push(
      `Could not read ${dest.path} (${dest.state === 'missing' ? 'not found' : 'no access'}), so ` +
        `${and(wanted)} keep${wanted.length === 1 ? 's' : ''} the source's value${wanted.length === 1 ? '' : 's'}.`
    );
    return out;
  }
  const d = dest.props;

  for (const p of HANDLES.filter(has)) {
    const to = text(d[p]);
    if (!to) notes.push(`${dest.path} has no ${p}, so this page keeps the source's ${quote(page[p])}.`);
    else if (to !== page[p]) values[p] = to;
  }

  const titles = TITLES.filter(has);
  if (titles.length) {
    /* The home pages offer several readings of their ending; the page being
       copied is the evidence for which one its site actually uses. Whichever
       reading the source page bears out is the one read off the destination
       too - the same rule on both sides, not the same words. */
    const brand = src.state === 'ok' ? brandWords(src.props, d) : new Set();
    const bears = (ending) => !brand.size || [...wordsOf(ending)].some((w) => brand.has(w));
    const srcCands = (src.state === 'ok' ? titleEndings(src.props) : []).filter((c) => bears(c.ending));
    const destCands = titleEndings(d).filter((c) => bears(c.ending));
    const borne = srcCands.find((c) => titles.some((p) => endsWith(page[p], c.ending))) || null;

    const fromEnd = (borne || srcCands[0])?.ending ?? null;
    /* A content page that ends with its own site's name - " | Samsung UK" -
       ends with the destination's name at the destination, whatever shape that
       home page's own title has. Reading the destination by the same rule as
       the source does not hold when the two home pages are written
       differently: "Samsung UK | Home Appliances" names the site first, while
       "Mobiles, Home Appliances | Samsung Jordan" names it last, and the same
       rule turned the second into " | Mobiles, Home Appliances". */
    const squash = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase();
    const srcName = text(src.props?.['jcr:title'])?.trim();
    const destName = text(d['jcr:title'])?.trim();
    const bearsName = !!(
      borne && srcName && destName && squash(borne.ending) === squash(`| ${srcName}`) && bears(` | ${destName}`)
    );
    /* The same rule on both sides - and when the destination's home page does
       not offer that reading in words that name the site, the first one it
       does offer, never one that only describes it. */
    const toEnd = bearsName
      ? ` | ${destName}`
      : ((borne ? destCands.find((c) => c.rule === borne.rule)?.ending : null) ?? destCands[0]?.ending ?? null);
    if (!fromEnd || !toEnd) {
      const where = !fromEnd ? src.path : dest.path;
      const why = !fromEnd && src.state !== 'ok' ? 'could not be read' : 'gives no title ending';
      notes.push(`${where} ${why}, so ${and(titles)} keep${titles.length === 1 ? 's' : ''} the source's ending.`);
    } else if (fromEnd.trim() !== toEnd.trim()) {
      for (const p of titles) {
        const swapped = swapEnding(page[p], fromEnd, toEnd);
        if (swapped !== null) {
          if (swapped !== page[p]) values[p] = swapped;
        } else if (swapEnding(page[p], toEnd, toEnd) === null) {
          // Already ending the destination's way is fine; any other ending is left for someone to look at.
          notes.push(
            borne
              ? `${p} ${quote(page[p])} does not end with ${quote(fromEnd)}, so it is left as it is.`
              : `${p} ${quote(page[p])} does not end any way ${src.path} names, so it is left as it is. ` +
                `Nothing there matches its ending - the readings tried were ${and(srcCands.map((c) => quote(c.ending)))}.`
          );
        }
      }
    }
  }

  if (has(LANGUAGE)) {
    const to = text(d[LANGUAGE]);
    if (!to) notes.push(`${dest.path} has no ${LANGUAGE}, so this page keeps the source's ${quote(page[LANGUAGE])}.`);
    else if (to !== page[LANGUAGE]) values[LANGUAGE] = to;
  }

  return out;
}

/* ------------------------------------------------------------- the review */

/**
 * The review's site values: where they were read, each value with what it
 * replaces and what unticking would leave, and anything left alone with why.
 * `changes` is the diff's `siteChanges`. Null when there is nothing to say -
 * the same site, or a page with none of them.
 */
export function siteSummary(site, changes, { applied, preview }) {
  if (!site) return null;
  const rows = changes.map((c) => ({ prop: c.prop, from: preview(c.from), to: preview(c.to), keeps: preview(c.keeps) }));
  if (!rows.length && !site.notes.length) return null;
  return { from: site.from, to: site.to, applied, rows, notes: site.notes };
}

/** What the site values box says, in the log. */
export function announceSite(report, summary) {
  const { rows, notes, applied, to } = summary;
  if (rows.length) {
    report(
      'info',
      applied
        ? `Site values from ${to}: ${rows.map((r) => `${r.prop} ${JSON.stringify(r.to)}`).join(', ')}.`
        : `Site values unticked: ${and(rows.map((r) => r.prop))} ${rows.length === 1 ? 'is' : 'are'} not set to the values on ${to}.`
    );
  }
  for (const n of notes) report('warn', n);
}

/**
 * After the writes: which site values went in. `failed` holds the changes whose
 * write was refused; their names come back, for the done screen to say so.
 */
export function reportSiteSet(report, site, changes, failed = new Set()) {
  const ours = changes.filter((c) => c.kind === 'site');
  const set = ours.filter((c) => !failed.has(c));
  if (set.length) {
    report('ok', `Site values set from ${site.to}: ${set.map((c) => `${c.prop} ${JSON.stringify(c.to)}`).join(', ')}`);
  }
  return ours.filter((c) => failed.has(c)).map((c) => c.prop);
}

/** The review's site values with the ones whose write was refused marked, for the done screen. */
export const markFailed = (summary, props) =>
  summary && props?.length
    ? { ...summary, rows: summary.rows.map((r) => (props.includes(r.prop) ? { ...r, failed: true } : r)) }
    : summary;
