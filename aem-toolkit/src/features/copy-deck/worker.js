/**
 * copy-deck: read a page's authored content and list the copy on it.
 *
 * Reads only. The rows come from the page's jcr:content tree, so each one names
 * the node and property its text lives in; the panel turns them into the sheet.
 * The tree is read whole or not at all - a page cut short by AEM's JSON limit
 * would quietly lose rows from the end of the sheet, so a large page is read a
 * level at a time instead of being accepted short.
 *
 * The tree goes back to the panel with the rows: adding or ignoring a field
 * there builds the sheet again from it, without reading the page again.
 *
 * The dialogs of the components on the page are read too (dialog.js), so a
 * field is known for what it is - a setting, English for analytics, or a text
 * with a label and a length limit - rather than guessed from its value. They
 * go back with the tree. A dialog that cannot be read changes nothing: the
 * values decide, as before.
 *
 * A product detail (PD) page is the exception. Its copy is not in jcr:content -
 * it comes from PIM as the page is rendered, and is translated in PIM - so the
 * page is read as rendered instead (pd.js), and its sheet goes to translators
 * for PIM, not back into AEM.
 */

import { abort } from '../../core/aem-client.js';
import { norm } from '../../core/paths.js';
import { cleanFields, componentTypes, extractCopyDeck } from './core.js';
import { readDialogs } from './dialog.js';
import { extractPdDeck, isPdPage } from './pd.js';

/** The fields added or ignored, as the panel sends them. Unreadable is none: the rules alone. */
function fieldsFrom(params) {
  try {
    return JSON.parse(params.fields || 'null') || undefined;
  } catch {
    return undefined;
  }
}

/** A PD page, read as rendered: the product's copy from PIM, and what was left off. */
async function readPd({ client, report, page, info }) {
  const html = await client.readRendered(page);
  if (html === null) throw abort(`Page does not render: ${page}.html was not found.`);
  const deck = extractPdDeck(html, { pagePath: page });
  const { found } = deck;
  if (!found.product && !found.features && !found.specs && !found.gallery) {
    throw abort(
      `${page}.html did not render as a product page - no product name, gallery, features or specs on it. ` +
        'The session may have expired: log in again and retry.'
    );
  }
  const { items, ...rest } = deck;
  const result = {
    page,
    title: info.title,
    newFields: [],
    references: [],
    ...rest,
    language: deck.language || info.content?.['jcr:language'] || null,
    // Every place a text appears; the panel puts each text on the sheet once.
    rows: items
  };
  report('data', 'analysis', result);

  report('info', `Product page (PD): its copy comes from PIM, so it was read from ${page}.html as rendered, not from AEM.`);
  report('info', `${new Set(items.map((r) => r.source)).size} texts on ${page}.`);
  const missing = Object.entries(found).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) report('warn', `Not found on the page: ${missing.join(', ')}. Check the page renders in full.`);
  for (const l of deck.leftOff) report('info', `Left off: ${l.part} (${l.why}).`);
  report('info', 'Nothing has been written. The translations go into PIM - this sheet cannot be imported into AEM.');
  return result;
}

export const actions = {
  async read({ client, report, params }) {
    client.resetCaches();

    // A pasted preview path carries selectors and an extension: tvs.html -> tvs.
    const page = norm(params.page || '').replace(/\/([^/.]+)\.[^/]*$/, '/$1');
    if (!/^\/content\//.test(page) || page.startsWith('/content/dam/')) {
      throw abort(`Give a page under /content, not ${page || 'nothing'}.`);
    }

    const info = await client.inspect(page);
    client.assertReadable(info, 'page');
    if (!info.exists) throw abort(`Page does not exist: ${page}`);
    if (!info.isPage) throw abort(`Not a cq:Page (it is ${info.primaryType}): ${page}`);

    if (isPdPage(info)) return readPd({ client, report, page, info });

    const tree = await client.readTreeWhole(`${page}/jcr:content`);
    if (!tree) throw abort(`The page has no jcr:content: ${page}`);

    const types = componentTypes(tree);
    let dialogs = {};
    let unread = types.length;
    try {
      ({ dialogs, unread } = await readDialogs(client, types));
    } catch {
      // Never a reason to stop: without the dialogs, the values decide.
    }

    const fields = cleanFields(fieldsFrom(params));
    const deck = extractCopyDeck(tree, { pagePath: page, fields, dialogs });
    const result = {
      page,
      title: info.title,
      language: tree['jcr:language'] || null,
      tree,
      dialogs,
      // What the rows were built with, so the panel can tell if the choices moved on meanwhile.
      fields,
      ...deck
    };
    report('data', 'analysis', result);

    // A row of static content can be several places of its block: each counts.
    const places = (rows) => rows.reduce((n, r) => n + (r.count || 1), 0);
    const hidden = places(deck.rows.filter((r) => r.inactive));
    const texts = new Set(deck.rows.filter((r) => !r.inactive).map((r) => r.source)).size;
    report(
      'info',
      `${places(deck.rows) - hidden} places with text on ${page}, ${texts} different texts${hidden ? `, plus ${hidden} not shown on the page` : ''}.`
    );
    report(
      'info',
      `Read the dialogs of ${types.length - unread} of ${types.length} components, to tell text from settings.` +
        (unread ? ' The others are judged by their values.' : '')
    );
    if (deck.newFields.length) {
      report(
        'warn',
        `${deck.newFields.length} field(s) look like text but are not on the sheet - listed under "Fields not on the sheet": add them or ignore them.`
      );
    }
    for (const ref of deck.references) report('warn', `Not on this sheet: ${ref.key} points at ${ref.value}`);
    /* The same words twice in a block, with another link or class: the sheet
     * could not tell which translation goes where. A text longer than an Excel
     * cell holds: kept off, rather than the whole sheet refused for it. */
    for (const l of deck.staticLeftOff) {
      if (l.why === 'too long') {
        // Its first words, cut where a word ends.
        const start = l.texts[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 61).replace(/\s+\S*$/, '');
        report(
          'warn',
          `Not on this sheet: a text of ${l.texts[0].length.toLocaleString('en')} characters in ${l.section} ("${start}…") - too long for one Excel cell. Translate it by hand in the block.`
        );
        continue;
      }
      report(
        'warn',
        `Not on this sheet: ${l.texts.map((t) => `"${t}"`).join(' and ')} in ${l.section} - the same words with a different link or style, which the sheet cannot tell apart. Translate them by hand in the block.`
      );
    }
    // Words a script or a style in a block's Body shows: code, so not on the sheet - but someone has to change them.
    for (const c of deck.staticCode) {
      report(
        'warn',
        `Left in English in ${c.section}: ${c.texts.map((t) => `"${t}"`).join(', ')} - a script or a style in the block shows them, and they are not on the sheet. A developer changes them.`
      );
    }
    // Script data copied from another page and never changed: translating it first would only translate the mistake.
    for (const w of deck.scriptWarnings) {
      for (const say of w.says) report('warn', `Fix before translating, in ${w.section}: ${say} The rows it is about say so too.`);
    }
    report('info', 'Nothing has been written.');
    return result;
  }
};
