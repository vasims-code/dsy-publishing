/* The way back for Static Content: a block's new Body (HTML) built from the
 * sheet's translations - each put where its text was read, the page's own
 * tags written back byte for byte, the words escaped for where they go - and
 * checked three ways; the Footer as a list for a developer; where a block
 * stands after the paste; and the import carrying all of it, block by block,
 * writing none of it.
 *
 * The fixture is the real explore-samsung-health jcr:content, trimmed (see
 * copy-deck-static.test.mjs). Cases C1-C11 are the ones a prototype run
 * verified on it, with the same translations.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/';
const core = await import(pathToFileURL(base + 'src/features/copy-deck/core.js'));
const sc = await import(pathToFileURL(base + 'src/features/copy-deck/static-content.js'));

const FIXTURE = JSON.parse(readFileSync(base + 'test/fixtures/copy-deck-explore-samsung-health.json', 'utf8'));
const PAGE = '/content/samsung/levant/explore-samsung-health';
const TARGET = '/content/samsung/levant_ar/explore-samsung-health';
const GRID = 'root/responsivegrid';
const NBSP = String.fromCharCode(0xa0);
const clone = (o) => JSON.parse(JSON.stringify(o));
const nodeAt = (c, path) => path.split('/').reduce((n, s) => n?.[s], c);

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};

/** The 8 blocks in page order: { no, path, node }. */
const BLOCKS = Object.entries(nodeAt(FIXTURE, GRID))
  .filter(([, v]) => /cm-g-static-content$/.test(v?.['sling:resourceType'] || ''))
  .map(([name, node], i) => ({ no: i + 1, path: `${GRID}/${name}`, node }));
const block = (no) => BLOCKS[no - 1];
const record = (no, p) => ({ no, old: { headerInclude: block(no).node.headerInclude, bodyHtml: block(no).node.bodyHtml, footerInclude: block(no).node.footerInclude }, prepared: p.value, items: p.items, notOnSheet: p.notOnSheet });

/** A block's Body texts as the sheet has them, each translated with `translate(cell)`. */
const textsOf = (body, translate) =>
  sc
    .blockTexts(sc.readBlock({ bodyHtml: body }))
    .filter((t) => t.prop === 'bodyHtml')
    .map((t) => ({ cell: t.cell, places: t.places.length, translation: translate(t.cell) }));
/** A text as it is stored in a Body now. */
const storedOf = (body, cell) => {
  const u = sc.readBody(body).units.find((x) => x.cell === cell);
  return u ? body.slice(u.start, u.end) : null;
};

// The prototype's translations: a few by hand, the rest "[fr] …".
const LINK_SENTENCE = sc.blockTexts(sc.readBlock(block(2).node)).find((t) => t.cell.startsWith('All of our')).cell;
const FR = {
  'Pick your perfect fitness partner': 'Choisissez votre partenaire fitness idéal',
  [LINK_SENTENCE]: LINK_SENTENCE.replace(/^All of our.*?intuitive /, 'Toutes nos Galaxy Watch et Smart Ring fonctionnent avec notre ').replace(
    '>Samsung Health App</a>, that',
    '>application Samsung Health</a> intuitive, qui'
  ),
  'Made to support your<br><span class="header-highlight">everyday wellness</span>': 'Conçu pour votre<br><span class="header-highlight">bien-être au quotidien</span>',
  'Made to support your<br><span class="header-highlight">active lifestyle</span>': 'Conçu pour votre <span class="header-highlight">mode de vie actif</span>',
  'Harmonise your health journey and enhance your fitness with Galaxy Buds,<br> ready for workout music, walking podcasts and more.':
    'Avec les Galaxy Buds, harmonisez votre parcours santé et votre forme, pour la musique, les podcasts et plus encore.',
  'Product categories': 'Catégories de "produits" & co',
  Silver: 'argent',
  'Pink Gold': 'Or rose',
  'Learn more': 'En savoir&nbsp;plus'
};
const tr = (cell) => FR[cell] ?? `[fr] ${cell}`;
const prep = (body, translate = tr) => sc.prepareBody(body, textsOf(body, translate));

console.log('--- escaping, by where the words go -----------------------------------');

check(
  'text: a bare & and a < are escaped, a code already written stays one',
  sc.escapeText('Santé & forme <3, 9&nbsp;000 m &amp; plus &#8482;') === 'Santé &amp; forme &lt;3, 9&nbsp;000 m &amp; plus &#8482;',
  sc.escapeText('Santé & forme <3, 9&nbsp;000 m &amp; plus &#8482;')
);
check(
  'an attribute: both quotes and > too, always',
  sc.escapeAttr(`Catégories de "produits" & l'été > 3`) === 'Catégories de &quot;produits&quot; &amp; l&#39;été &gt; 3',
  sc.escapeAttr(`Catégories de "produits" & l'été > 3`)
);
{
  const s = sc.escapeScript('En savoir&nbsp;plus', '"');
  check('a script string: &nbsp; becomes the no-break character itself, never the letters', s === `En savoir${NBSP}plus` && s.codePointAt(9) === 0xa0, JSON.stringify(s));
  const all = sc.escapeScript(`a\\b "q" 's' x\r\ny${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}</script><!-- &lt;`, '"');
  check(
    '...then a backslash, its own quote, line breaks, U+2028/2029, "</" and "<!--" escaped - the other quote left alone',
    all === `a\\\\b \\"q\\" 's' x\\ny\\u2028\\u2029<\\/script><\\!-- <`,
    JSON.stringify(all)
  );
  check('...and in a string in single quotes, the single quote', sc.escapeScript("l'été \"x\"", "'") === "l\\'été \"x\"", sc.escapeScript("l'été \"x\"", "'"));
}
{
  // C8: words with & and <, an alt in single quotes, an alt with no quotes at all.
  const body = "<p>Tips</p><img src='/a.png' alt='Grey' /><img src=/b.png alt=Silver>";
  const p = prep(body, (c) => ({ Tips: 'Santé & forme <3', Grey: "gris de l'ardoise", Silver: 'Argent "clair"' })[c]);
  check(
    'C8: each escaped for where it goes - text, an attribute in single quotes, one stored without quotes (which gets them)',
    p.value === `<p>Santé &amp; forme &lt;3</p><img src='/a.png' alt='gris de l&#39;ardoise' /><img src=/b.png alt="Argent &quot;clair&quot;">` &&
      sc.verify(body, p.value, p.placed).length === 0,
    JSON.stringify([p.value, sc.verify(body, p.value, p.placed)])
  );
  const onze = sc.prepareBody('<img src="/x.png" alt="Our choice">', [{ cell: 'Our choice', translation: 'Online = 10% korting, "onze" keuze' }]);
  check(
    '...so words that only look like code in a quoted value stay words: "onze" cannot close the attribute',
    onze.value === '<img src="/x.png" alt="Online = 10% korting, &quot;onze&quot; keuze">',
    onze.value
  );
}
{
  // Markup written as codes is a tag once a script puts a tooltip on the page with innerHTML.
  const body = '<span class="colour-chip" data-tooltip="Silver"></span><p>Use the &lt;Back&gt; button.</p>';
  const p = prep(body, (c) => (c === 'Silver' ? '&lt;img src=x onerror=alert(1)&gt;' : 'Utilisez le bouton &lt;Retour&gt;.'));
  check(
    'markup written as codes (&lt;img …&gt;) is sent back from a words-only text; codes the English has too are words',
    p.items[0].status === 'sent back' &&
      p.items[0].message === sc.WORDS_ONLY &&
      p.items[1].status === 'placed' &&
      p.value === '<span class="colour-chip" data-tooltip="Silver"></span><p>Utilisez le bouton &lt;Retour&gt;.</p>',
    JSON.stringify([p.items, p.value])
  );
}

console.log('\n--- one sentence: the tag rule (placeText) -----------------------------');

{
  // C1: <br> dropped, moved, added - block 6, and block 4's headline, which has none.
  const cell = 'Harmonise your health journey and enhance your fitness with Galaxy Buds,<br> ready for workout music, walking podcasts and more.';
  const live = storedOf(block(6).node.bodyHtml, cell);
  const dropped = sc.placeText(live, cell, 'Avec les Galaxy Buds, harmonisez votre forme, pour la musique et plus.');
  check(
    'C1: a <br> left out is allowed, and said',
    dropped.errors.length === 0 && dropped.html === 'Avec les Galaxy Buds, harmonisez votre forme, pour la musique et plus.' && dropped.notes.includes('A line break (<br>) was left out - allowed'),
    JSON.stringify(dropped)
  );
  const moved = sc.placeText(live, cell, 'Avec les Galaxy Buds,<br> harmonisez votre forme, pour la musique et plus.');
  check('C1: a <br> moved is the page’s own <br>, where the translator put it', moved.errors.length === 0 && moved.html === 'Avec les Galaxy Buds,<br> harmonisez votre forme, pour la musique et plus.', JSON.stringify(moved));
  const added = sc.placeText(live, cell, 'Avec les Galaxy Buds,<br> harmonisez<br> votre forme.');
  check(
    'C1: a <br> added is sent back',
    added.html === null && added.errors.includes('2 line breaks (<br>) in the translation, 1 in the English - a <br> may move or go, never be added'),
    JSON.stringify(added)
  );
  const h = 'Find your perfect companion';
  const none = sc.placeText(storedOf(block(4).node.bodyHtml, h), h, 'Trouvez votre<br> compagnon idéal');
  check('C1: ...and so is one in a text whose English has none', none.html === null && none.errors.includes('1 line breaks (<br>) in the translation, 0 in the English - a <br> may move or go, never be added'), JSON.stringify(none));
  const closing = sc.placeText(live, cell, 'Avec les Galaxy Buds,</br>prêts pour la musique.');
  check('C1: a </br>, which a browser reads as a <br>, is the page’s <br> - the words either side not run together', closing.html === 'Avec les Galaxy Buds,<br>prêts pour la musique.', JSON.stringify(closing));
}
{
  // <br> and <wbr>: each the page's own, of the name the translator wrote, where it was written.
  const at = (t) => sc.placeText('Meet the Galaxy<wbr>Watch8 series.<br />Now with more.', 'Meet the Galaxy<wbr>Watch8 series.<br>Now with more.', t);
  const swapped = at('Plus encore.<br>Voici la série Galaxy<wbr>Watch8.');
  check('a <br> and a <wbr> in the other order: each where the translator wrote it', swapped.html === 'Plus encore.<br />Voici la série Galaxy<wbr>Watch8.', JSON.stringify(swapped));
  const gone = at('Voici la série Galaxy Watch8.<br>Plus encore.');
  check('...a <wbr> left out is allowed, and said', gone.html === 'Voici la série Galaxy Watch8.<br />Plus encore.' && gone.notes.includes('A <wbr> was left out - allowed'), JSON.stringify(gone));
  const more = at('Voici la<wbr> série Galaxy<wbr>Watch8.<br>Plus.');
  check('...one added is sent back', more.html === null && more.errors.includes('2 <wbr> in the translation, 1 in the English - a <wbr> may move or go, never be added'), JSON.stringify(more));
}
{
  const cell = 'Made to support your<br><span class="header-highlight">everyday wellness</span>';
  const live = storedOf(block(5).node.bodyHtml, cell);
  const at = (t) => sc.placeText(live, cell, t);
  check(
    'a tag added is sent back',
    at('Conçu pour <b>votre</b><br><span class="header-highlight">bien-être</span>').errors.includes('<b> is not in the English - a tag may be moved, not added'),
    JSON.stringify(at('Conçu pour <b>votre</b><br><span class="header-highlight">bien-être</span>').errors)
  );
  check('...a tag left out', at('Conçu pour votre bien-être').errors.includes('<span class="header-highlight"> is missing from the translation'), JSON.stringify(at('Conçu pour votre bien-être').errors));
  check('...a tag opened and not closed', at('Conçu pour votre<br><span class="header-highlight">bien-être').errors.includes('<span> is opened but not closed'), JSON.stringify(at('Conçu pour votre<br><span class="header-highlight">bien-être').errors));
  check('...a closing tag with nothing open', at('Conçu</span> pour votre<br><span class="header-highlight">bien-être</span>').errors.includes('</span> closes a tag that is not open'), '');
  const click = at('Conçu pour votre<br><span class="header-highlight" onclick="alert(1)">bien-être</span>');
  check('...a tag given a handler (onclick) - though only the page’s own tag is ever written', click.html === null && click.errors.some((e) => /runs a script - not allowed in a translation/.test(e)), JSON.stringify(click.errors));
  const ok = at('Conçu pour votre<br><span class="header-highlight">bien-être & plus</span>');
  check(
    'the page’s own tags, byte for byte - its <br />, its span over three lines - and the words escaped',
    ok.errors.length === 0 && ok.html === 'Conçu pour votre<br /><span class="header-highlight"\r\n                    >bien-être &amp; plus</span\r\n                  >',
    JSON.stringify(ok)
  );
}
{
  // A link with a bold word in it: the bold may move inside the link, never out of it.
  const live = '<a href="/levant/buy/"\r\n  class="cta">Buy <strong>now</strong></a> today';
  const cell = '<a href="/levant/buy/" class="cta">Buy <strong>now</strong></a> today';
  const inside = sc.placeText(live, cell, 'Achetez <a href="/levant/buy/" class="cta"><strong>maintenant</strong> en ligne</a>');
  check('a tag moved within the tag it is in is fine', inside.errors.length === 0 && inside.html === 'Achetez <a href="/levant/buy/"\r\n  class="cta"><strong>maintenant</strong> en ligne</a>', JSON.stringify(inside));
  const out = sc.placeText(live, cell, '<strong>Maintenant</strong> <a href="/levant/buy/" class="cta">achetez</a>');
  check(
    '...moved out of it, it is sent back',
    out.html === null && out.errors.includes('<strong> is now inside another tag - a tag may move, but not into or out of another tag'),
    JSON.stringify(out.errors)
  );
  const script = sc.placeText(live, cell, 'Achetez <a href="javascript:alert(1)" class="cta"><strong>maintenant</strong></a>');
  check('...and a link changed into a script is sent back', script.html === null && script.errors.some((e) => /runs a script/.test(e)), JSON.stringify(script.errors));
}
{
  // The page's own javascript: link, kept as the cell showed it, is the page's.
  const body = '<p>Open the <a href="javascript:void(0)" class="open">product details</a> now.</p>';
  const p = prep(body, () => 'Ouvrez les <a href="javascript:void(0)" class="open">détails du produit</a> maintenant.');
  check(
    'a link the page itself points at javascript:, kept as it is: placed',
    p.items[0].status === 'placed' && p.value === '<p>Ouvrez les <a href="javascript:void(0)" class="open">détails du produit</a> maintenant.</p>' && sc.verify(body, p.value, p.placed).length === 0,
    JSON.stringify(p.items)
  );
}
{
  // A tag this reader could not read - a quote left open in it - is words to it, but an image to a browser.
  const body = '<p><img src=/levant/tv.png alt=55" class="tv">Shop the new TVs today.</p>';
  const p = prep(body, () => 'Achetez les nouveaux téléviseurs.');
  check(
    'code in a sentence that a browser may read as a tag, and this reader cannot: sent back, the block left as it is',
    p.items[0].status === 'sent back' && /^The page’s code in this text cannot be read safely/.test(p.items[0].message) && p.value === body,
    JSON.stringify([p.items, p.value])
  );
}
{
  // A comment inside a tag of a sentence ends the sentence, as one between sentences does: never shown as words.
  const body = '<p>Made to support your<br><span class="hl"><!-- TODO: legal check -->everyday wellness</span> today.</p>';
  const cells = sc.readBody(body).units.map((u) => u.cell);
  const p = prep(body);
  check(
    'a comment inside a tag of a sentence: no cell shows it, and the block keeps it byte for byte',
    JSON.stringify(cells) === JSON.stringify(['Made to support your<br>', 'everyday wellness', 'today.']) &&
      p.value === '<p>[fr] Made to support your<br><span class="hl"><!-- TODO: legal check -->[fr] everyday wellness</span> [fr] today.</p>' &&
      sc.verify(body, p.value, p.placed).length === 0,
    JSON.stringify([cells, p.value])
  );
  const cdata = sc.readBody('<p>Hello <![CDATA[x]]> world and more</p>').units.map((u) => u.cell);
  check('...and so does <![CDATA[…]]>, which a browser reads as a comment', JSON.stringify(cdata) === '["Hello","world and more"]', JSON.stringify(cdata));
  // What a browser shows as it is written - an & would show as &amp; - is never a text to put a translation in.
  const old = '<xmp>Hello <b>world</b> here</xmp><plaintext>Fish & chips';
  check('the inside of <xmp> and <plaintext>, long out of use, is never read', sc.readBody(old).units.length === 0, JSON.stringify(sc.readBody(old).units.map((u) => u.cell)));
}
{
  // The page's own tag is kept, line breaks and all.
  const live = storedOf(block(2).node.bodyHtml, LINK_SENTENCE);
  const r = sc.placeText(live, LINK_SENTENCE, FR[LINK_SENTENCE]);
  check(
    'a link is written back as the page stores it, its own line breaks inside the tag included',
    r.errors.length === 0 &&
      r.html.includes('notre <a href="https://www.samsung.com/levant/apps/samsung-health/"\r\n            >application Samsung Health</a\r\n          > intuitive, qui'),
    JSON.stringify(r)
  );
}

console.log('\n--- two links whose words swap places ---------------------------------');

{
  const W = 'https://www.samsung.com/levant/watches/all-watches/';
  const H = 'https://www.samsung.com/levant/apps/samsung-health/';
  const two = block(2).node.bodyHtml.replace('All of our Galaxy Watches and', `All of our <a href="${W}"\r\n            >Galaxy Watches</a\r\n          > and`);
  const cell = sc.readBody(two).units.find((u) => u.kind === 'text' && u.cell.startsWith('All of our')).cell;
  const linkOf = (html, words) => html?.replace(/\s+/g, ' ').match(new RegExp(`<a href="([^"]+)"[^>]*>\\s*${words}`))?.[1];
  const place = (t, page = two) => sc.placeText(storedOf(page, sc.readBody(page).units.find((u) => u.kind === 'text' && u.cell.startsWith('All of our')).cell), cell, t);
  const SW = `L'<a href="${H}">application Samsung Health</a> accompagne toutes nos <a href="${W}">montres Galaxy</a>.`;
  const kept = place(`Toutes nos <a href="${W}">montres Galaxy</a> fonctionnent avec <a href="${H}">l'application Samsung Health</a>.`);
  check('two links in their own order keep their links', linkOf(kept.html, 'montres Galaxy') === W && linkOf(kept.html, "l'application") === H, JSON.stringify(kept));
  const swapped = place(SW);
  check(
    'two links swapped by the translator keep their own words - matched by link, not by order',
    swapped.errors.length === 0 && linkOf(swapped.html, 'montres Galaxy') === W && linkOf(swapped.html, 'application Samsung Health') === H,
    JSON.stringify(swapped)
  );
  const repointed = place(SW, two.split('/levant/').join('/levant_ar/'));
  check(
    '...and on a page whose links were re-pointed since, the page’s links, each with its own words',
    linkOf(repointed.html, 'montres Galaxy') === W.replace('/levant/', '/levant_ar/') && linkOf(repointed.html, 'application Samsung Health') === H.replace('/levant/', '/levant_ar/'),
    JSON.stringify(repointed)
  );
  const one = place(SW.replace(H, 'https://www.samsung.com/fr/apps/samsung-health/'));
  check(
    'one link changed by the translator: the page’s own link is kept, with a note',
    one.errors.length === 0 &&
      linkOf(one.html, 'application Samsung Health') === H &&
      linkOf(one.html, 'montres Galaxy') === W &&
      one.notes.includes('<a href="https://www.samsung.com/fr/apps/samsung-health/"> is not as on the sheet - the page’s own tag is kept'),
    JSON.stringify(one)
  );
  const both = place(`L'<a href="/fr/a/">application Samsung Health</a> accompagne nos <a href="/fr/b/">montres Galaxy</a>.`);
  check(
    'both changed: which is which cannot be told - sent back',
    both.html === null && both.errors.includes('<a href="/fr/a/"> was changed, and 2 <a> tags are left - cannot tell which one it is'),
    JSON.stringify(both.errors)
  );
  const excel = place(`Toutes nos <a href=""${W}"">montres Galaxy</a> avec <a href="${H}">l'application Samsung Health</a> & plus.`);
  check('Excel’s doubled quotes in a tag are repaired, and a bare & escaped', excel.errors.length === 0 && linkOf(excel.html, 'montres Galaxy') === W && excel.html.endsWith('&amp; plus.'), JSON.stringify(excel));
  // The whole block, end to end: the second reader takes a tag moved within its sentence.
  const whole = sc.prepareBody(two, textsOf(two, (c) => (c === cell ? SW : tr(c))));
  check(
    'the block with the two links swapped is prepared, and passes all three checks',
    whole.items.find((i) => i.cell === cell)?.status === 'placed' && linkOf(whole.value, 'montres Galaxy') === W && sc.verify(two, whole.value, whole.placed).length === 0,
    JSON.stringify(sc.verify(two, whole.value, whole.placed))
  );
  const body = '<p>Get the <a href="/levant/buy/">Galaxy Watch</a> with <strong>free</strong> delivery.</p>';
  const bold = prep(body, () => 'Livraison <strong>gratuite</strong> avec la <a href="/levant/buy/">Galaxy Watch</a>.');
  check(
    '...as is a <strong> moved before an <a>',
    bold.items[0].status === 'placed' &&
      bold.value === '<p>Livraison <strong>gratuite</strong> avec la <a href="/levant/buy/">Galaxy Watch</a>.</p>' &&
      sc.verify(body, bold.value, bold.placed).length === 0,
    JSON.stringify([bold.value, sc.verify(body, bold.value, bold.placed)])
  );
}

console.log('\n--- the fixture’s blocks, prepared ---------------------------------------');

const PREPARED = new Map();
for (const b of BLOCKS) {
  const texts = textsOf(b.node.bodyHtml, tr);
  if (!texts.length) continue;
  const p = sc.prepareBody(b.node.bodyHtml, texts);
  PREPARED.set(b.no, p);
  const problems = sc.verify(b.node.bodyHtml, p.value, p.placed);
  const lineBreaks = p.value.match(/\r?\n/g) || [];
  check(
    `block ${b.no}: every text placed, all three checks pass, every line break still CRLF`,
    problems.length === 0 && p.items.every((i) => i.status === 'placed') && lineBreaks.length > 0 && lineBreaks.every((n) => n === '\r\n') && p.notOnSheet.length === 0,
    JSON.stringify([problems, p.items.filter((i) => i.status !== 'placed')])
  );
}
check('block 3 has no text in its Body: nothing for the web team', !PREPARED.has(3) && PREPARED.size === 7, [...PREPARED.keys()].join());
{
  const p = prep(block(8).node.bodyHtml, () => 'Sentez-vous\nau top');
  check('a line break in a translation becomes the block’s own: CRLF', p.value.includes('Sentez-vous\r\nau top') && !/[^\r]\n/.test(p.value), JSON.stringify(p.value.slice(0, 200)));
}
{
  // Block 5's headline sent back: every other text of the block is placed all the same.
  const head = 'Made to support your<br><span class="header-highlight">everyday wellness</span>';
  const p = prep(block(5).node.bodyHtml, (c) => (c === head ? 'Conçu pour <b>votre</b><br><span class="header-highlight">bien-être</span>' : tr(c)));
  const others = p.items.filter((i) => i.cell !== head);
  const placedAt = (cell) => p.placed.some((x) => x.unit.cell === cell || x.nested?.some((n) => n.unit.cell === cell));
  check(
    'a sentence sent back: each of the block’s other 31 texts still placed, in every place it has',
    p.items.find((i) => i.cell === head)?.status === 'sent back' &&
      others.length === 31 &&
      others.every((i) => i.status === 'placed' && placedAt(i.cell)) &&
      p.placed.length === 39 &&
      sc.verify(block(5).node.bodyHtml, p.value, p.placed).length === 0,
    JSON.stringify([p.placed.length, others.filter((i) => !placedAt(i.cell)).map((i) => i.cell)])
  );
}
{
  const p5 = PREPARED.get(5);
  check('block 5: 40 places, 32 texts', p5.placed.length === 40 && p5.items.length === 32, `${p5.placed.length} / ${p5.items.length}`);
  check(
    '...an aria-label with quotes and & escaped, tooltips in, a one-word lowercase "argent" too',
    p5.value.includes('aria-label="Catégories de &quot;produits&quot; &amp; co"') && p5.value.includes('data-tooltip="argent"') && p5.value.includes('data-tooltip="Or rose"'),
    ''
  );
  check(
    '...a headline whose <br> the translator left out',
    p5.items.find((i) => i.cell.endsWith('active lifestyle</span>'))?.notes.includes('A line break (<br>) was left out - allowed'),
    JSON.stringify(p5.items.find((i) => i.cell.endsWith('active lifestyle</span>')))
  );
  const p2 = PREPARED.get(2).value;
  check(
    'block 2: the translated sentence on one line, the page’s link tag as it was',
    p2.includes('Toutes nos Galaxy Watch et Smart Ring fonctionnent avec notre <a href="https://www.samsung.com/levant/apps/samsung-health/"\r\n            >application Samsung Health</a\r\n          > intuitive, qui'),
    ''
  );
  // C2: the lowercase word is put in, and the same sheet imported again finds it there.
  const again = sc.prepareBody(p5.value, textsOf(block(5).node.bodyHtml, tr));
  check(
    'C2: "Silver" -> "argent" is placed and checked; the same sheet again on the pasted block: "already"',
    again.items.find((i) => i.cell === 'Silver')?.status === 'already' && again.items.find((i) => i.cell === 'Silver').message === 'The block already has this translation.',
    JSON.stringify(again.items.find((i) => i.cell === 'Silver'))
  );
}
{
  // C4: every block, the same sheet again after the paste: nothing left to place, nothing listed as new.
  const after = [...PREPARED].map(([no, p]) => [no, sc.prepareBody(p.value, textsOf(block(no).node.bodyHtml, tr))]);
  check(
    'C4: imported again after the paste, every text of every block is "already" - none "not on the sheet"',
    after.every(([, q]) => q.items.every((i) => i.status === 'already') && q.notOnSheet.length === 0 && q.placed.length === 0),
    JSON.stringify(after.map(([no, q]) => [no, q.items.filter((i) => i.status !== 'already').map((i) => [i.cell, i.status]), q.notOnSheet]))
  );
  // A corrected sheet on the pasted block: its English is gone and the new translation is not in it.
  const pasted = PREPARED.get(4).value;
  const corrected = sc.prepareBody(pasted, textsOf(block(4).node.bodyHtml, (c) => (c === 'Find your perfect companion' ? 'Trouvez le compagnon qu’il vous faut' : tr(c))));
  const fixed = corrected.items.find((i) => i.cell === 'Find your perfect companion');
  check(
    'C4: a corrected sheet on a pasted block: "not found", with the rule to export the translated page again',
    fixed?.status === 'not found' && fixed.message === sc.NOT_IN_BLOCK && /export the translated page again and correct that sheet/.test(fixed.message),
    JSON.stringify(fixed)
  );
  // The rule followed: export the pasted page, its Source is the first translation, fix that cell.
  const re = prep(pasted, (c) => (c === '[fr] Find your perfect companion' ? 'Trouvez le compagnon qu’il vous faut' : c));
  const head = re.items.find((i) => i.cell === '[fr] Find your perfect companion');
  check(
    '...and with the translated page exported again and that cell fixed, it is placed and checked',
    head?.status === 'placed' && sc.verify(pasted, re.value, re.placed).length === 0 && re.value.includes('\r\n          Trouvez le compagnon qu’il vous faut\r\n') && !re.value.includes('[fr] Find'),
    JSON.stringify([head, sc.verify(pasted, re.value, re.placed)])
  );
}

console.log('\n--- English changed after the export (C3) ---------------------------------');

{
  let live = block(5).node.bodyHtml;
  const at = live.lastIndexOf('Buy now');
  live = `${live.slice(0, at)}Buy it now${live.slice(at + 7)}`;
  const end = live.indexOf('</p>', live.indexOf('much more.')) + 4;
  live = `${live.slice(0, end)}\r\n                  <p class="ch-dt-19">Free delivery on all watches this week.</p>${live.slice(end)}`;
  live = live.replace('Own your daily wellbeing', 'Own your daily well-being');
  const p = sc.prepareBody(live, textsOf(block(5).node.bodyHtml, tr));
  check(
    'C3: text the sheet has no row for is listed - it stays English',
    JSON.stringify(p.notOnSheet) ===
      JSON.stringify(['Own your daily well-being, with AI powered health tracking at your fingertips.', 'Buy it now', 'Free delivery on all watches this week.']),
    JSON.stringify(p.notOnSheet)
  );
  const buy = p.items.find((i) => i.cell === 'Buy now');
  check('C3: a text in fewer places than at the export is placed, with a warning', buy?.status === 'placed' && JSON.stringify(buy.warnings) === JSON.stringify(['"Buy now": 2 places at export, 1 now - look at the block.']), JSON.stringify(buy));
  const gone = p.items.find((i) => i.cell.startsWith('Own your daily wellbeing'));
  check('C3: a text whose English is gone, and no translation in its place: not found', gone?.status === 'not found', JSON.stringify(gone));
  check('...and the rest of the block is still prepared, and passes the checks', p.placed.length === 38 && sc.verify(live, p.value, p.placed).length === 0, String(p.placed.length));
}

console.log('\n--- what sits inside a sentence ------------------------------------------');

{
  // C5: a title on the link inside block 2's sentence: a text of its own, put into the page's own tag.
  const body = block(2).node.bodyHtml.replace(
    '<a href="https://www.samsung.com/levant/apps/samsung-health/"',
    '<a href="https://www.samsung.com/levant/apps/samsung-health/" title="Open the Samsung Health App page" target="_blank"'
  );
  const sentence = sc.readBody(body).units.find((u) => u.cell.startsWith('All of our')).cell;
  const T = (c) => (c === sentence ? FR[LINK_SENTENCE] : c === 'Open the Samsung Health App page' ? "Ouvrir la page de l'application Samsung Health" : tr(c));
  const p = prep(body, T);
  check(
    'C5: a title on a link inside a sentence goes into the page’s tag, escaped, the sentence around it',
    p.value.includes(
      '<a href="https://www.samsung.com/levant/apps/samsung-health/" title="Ouvrir la page de l&#39;application Samsung Health" target="_blank"\r\n            >application Samsung'
    ) && sc.verify(body, p.value, p.placed).length === 0,
    JSON.stringify(sc.verify(body, p.value, p.placed))
  );
  const back = prep(body, (c) => (c === sentence ? `${FR[LINK_SENTENCE]} <b>!</b>` : T(c)));
  check(
    '...and when the sentence is sent back, the title still goes in, on its own',
    back.items.find((i) => i.cell === sentence)?.status === 'sent back' &&
      back.value.includes('title="Ouvrir la page de l&#39;application Samsung Health"') &&
      back.value.includes('All of our Galaxy Watches') &&
      sc.verify(body, back.value, back.placed).length === 0,
    JSON.stringify(back.items.map((i) => [i.cell.slice(0, 30), i.status, i.message]))
  );
}
{
  // C6: an icon between words stays in the sentence, and may move.
  const body = block(7).node.bodyHtml.replace('Mention @samsunglevant', 'Mention <img src="/ig.svg" alt="Instagram" /> @samsunglevant');
  const sentence = 'Get hints, tips and more from other Samsung Galaxy devices. Mention <img> @samsunglevant for your chance to feature.';
  const p = prep(body, (c) => (c === sentence ? 'Astuces et plus des autres appareils Samsung Galaxy. Mentionnez @samsunglevant <img> pour être mis en avant.' : c === 'Instagram' ? 'Instagram' : tr(c)));
  check(
    'C6: an <img> moved by the translator is the page’s own <img>, where it now stands',
    p.items.find((i) => i.cell === sentence)?.status === 'placed' &&
      p.value.includes('Mentionnez @samsunglevant <img src="/ig.svg" alt="Instagram" /> pour être mis en avant.') &&
      sc.verify(body, p.value, p.placed).length === 0,
    JSON.stringify(p.items)
  );
}
{
  // C7: no-break spaces - a heading with &nbsp; and an alt with the character are one text.
  const body = `<h2>Galaxy&nbsp;Buds</h2>\r\n<img src="/x.png" alt="Galaxy${NBSP}Buds" />`;
  const p = prep(body, () => 'Galaxy&nbsp;Buds FR');
  check(
    'C7: a heading with &nbsp; and an alt with the character are one text: the translation goes into both, its &nbsp; as written',
    p.items.length === 1 && p.placed.length === 2 && p.value === '<h2>Galaxy&nbsp;Buds FR</h2>\r\n<img src="/x.png" alt="Galaxy&nbsp;Buds FR" />' && sc.verify(body, p.value, p.placed).length === 0,
    JSON.stringify([p.value, sc.verify(body, p.value, p.placed)])
  );
}
{
  // C9: Arabic, as Excel hands it back - a direction mark and curly quotes inside the tag, marks outside it.
  const t = `جميع ساعات Galaxy وخواتم Smart Ring تعمل مع ‏<‏a href=“https://www.samsung.com/levant/apps/samsung-health/”>تطبيق Samsung Health</a>‏ الذكي.`;
  const p = prep(block(2).node.bodyHtml, (c) => (c === LINK_SENTENCE ? t : tr(c)));
  const item = p.items.find((i) => i.cell === LINK_SENTENCE);
  check(
    'C9: the tag repaired and matched, the page’s own link written, the marks outside the tag kept',
    item?.status === 'placed' &&
      p.value.match(/<a [^>]*>/)[0] === '<a href="https://www.samsung.com/levant/apps/samsung-health/"\r\n            >' &&
      p.value.includes('تعمل مع ‏<a href') &&
      p.value.includes('</a\r\n          >‏ الذكي.') &&
      sc.verify(block(2).node.bodyHtml, p.value, p.placed).length === 0,
    JSON.stringify(item)
  );
}
{
  // Words-only texts: markup in the translation is sent back - in every place of the text.
  const p = prep(block(5).node.bodyHtml, (c) => (c === 'Grey' ? '<b>Gris</b>' : tr(c)));
  const grey = p.items.find((i) => i.cell === 'Grey');
  check(
    'a words-only text with markup in its translation is sent back, and stays English in both its places',
    grey?.status === 'sent back' && grey.message === sc.WORDS_ONLY && p.value.includes('data-tooltip="Grey"') && !p.value.includes('Gris') && p.placed.length === 38,
    JSON.stringify(grey)
  );
}

console.log('\n--- the checks catch a placing bug (C10) ---------------------------------');

{
  const body = block(5).node.bodyHtml;
  const p = PREPARED.get(5);
  // Bug 1: the aria-label's translation written into the class of the same tag.
  const start = body.lastIndexOf('<', body.indexOf('aria-label="Product categories"'));
  const end = body.indexOf('>', start);
  const tag = body.slice(start, end);
  const wrong = tag.replace(/class="[^"]*"/, 'class="Catégories de produits"');
  const bad1 = body.slice(0, start) + wrong + body.slice(end);
  const plan1 = p.placed
    .filter((x) => x.unit.name === 'aria-label')
    .map((x) => ({ ...x, newStart: x.start + wrong.length - tag.length, newEnd: x.end + wrong.length - tag.length }));
  const found1 = sc.verify(body, bad1, plan1);
  check(
    'C10 bug 1: a translation written into the wrong attribute is caught - by the second reader too',
    found1.includes('Second reader: <div> class changed ("tabs" -> "Catégories de produits")') && found1.some((f) => /^The code outside the texts changed at line 3/.test(f)),
    JSON.stringify(found1)
  );
  check(
    '...and at its own place, the aria-label still reads the English - by position, and to the second reader',
    found1.includes('At line 3 the text reads "Product categories", not "Catégories de "produits" & co"') &&
      found1.includes('Second reader: <div> aria-label reads "Product categories", planned "Catégories de "produits" & co"'),
    JSON.stringify(found1)
  );
  // Bug 2: an escaping bug lets a tag through inside a text - and the plan, wrong too, expects it. Only the second reader sees it.
  const t = p.placed.find((x) => x.kind === 'text' && !x.html.includes('<'));
  const html = t.html.replace(' ', ' <b>x</b> ');
  const grow = html.length - t.html.length;
  const bad2 = p.value.slice(0, t.newStart) + html + p.value.slice(t.newEnd);
  const plan2 = p.placed.map((x) =>
    x === t ? { ...x, newEnd: x.newStart + html.length, reads: sc.wordsOf(sc.cellText(html)) } : x.newStart > t.newStart ? { ...x, newStart: x.newStart + grow, newEnd: x.newEnd + grow } : x
  );
  const found2 = sc.verify(body, bad2, plan2);
  check(
    'C10 bug 2: an unescaped tag inside a text, which the first two checks are blind to, is caught by the second reader',
    found2.length === 1 && found2[0] === 'Second reader: 102 elements before, 103 after',
    JSON.stringify(found2)
  );
  // A class changed outside every text, the plan none the wiser.
  const bad3 = p.value.replace('class="tabs"', 'class="tabs rtl"');
  const found3 = sc.verify(body, bad3, p.placed.map((x) => (x.newStart > p.value.indexOf('class="tabs"') ? { ...x, newStart: x.newStart + 4, newEnd: x.newEnd + 4 } : x)));
  check(
    'a change outside the texts: the bytes differ, and the second reader sees the attribute',
    found3.some((f) => /^The code outside the texts changed at line 3$/.test(f)) && found3.some((f) => f.startsWith('Second reader: <div> class changed')),
    JSON.stringify(found3)
  );
}
{
  /** A prepared value with one placed text's html replaced by `html`, and the plan moved to match - as a bug in placing would leave it. */
  const broken = (p, t, html) => {
    const grow = html.length - t.html.length;
    const value = p.value.slice(0, t.newStart) + html + p.value.slice(t.newEnd);
    const plan = p.placed.map((x) =>
      x === t ? { ...x, html, newEnd: x.newStart + html.length } : x.newStart > t.newStart ? { ...x, newStart: x.newStart + grow, newEnd: x.newEnd + grow } : x
    );
    return { value, plan };
  };
  // Bug 3: the words after a sentence's last tag lost. The code around it is whole, and the second reader leaves a sentence's own words to check b.
  const p2 = PREPARED.get(2);
  const t = p2.placed.find((x) => x.kind === 'text' && x.html.includes('</a'));
  const cut = broken(p2, t, t.html.slice(0, t.html.lastIndexOf('>') + 1));
  const found = sc.verify(block(2).node.bodyHtml, cut.value, cut.plan);
  check(
    'C10 bug 3: a sentence’s last words lost in placing - only check b sees it, the words read against the translation itself',
    found.length === 1 && /^At line 12 the text reads "Toutes nos Galaxy Watch et Smart Ring fo", not "Toutes nos Galaxy Watch et Smart Ring fo"$/.test(found[0]) && cut.value !== p2.value,
    JSON.stringify(found)
  );
  // Bug 4: the page's <span> in a sentence written as an <em>. The words are right, so only the second reader sees it.
  const p5 = PREPARED.get(5);
  const s = p5.placed.find((x) => x.kind === 'text' && x.html.includes('<span class="header-highlight"'));
  const em = broken(p5, s, s.html.replace('<span class="header-highlight"', '<em class="header-highlight"').replace('</span', '</em'));
  const found4 = sc.verify(block(5).node.bodyHtml, em.value, em.plan);
  check('C10 bug 4: a tag of a sentence renamed - caught by the second reader', found4.length === 1 && /^Second reader: the text at line \d+ had <span>, now <em>$/.test(found4[0]), JSON.stringify(found4));
}
{
  /* A plan that is wrong itself - it says words were put where code was changed - leaves the first two checks
   * blind, as in bug 2: the second reader still sees the code. Block 8: its <style>, its headline, its <h2>. */
  const body = block(8).node.bodyHtml;
  const all = [];
  const walk = (e) => {
    all.push(e);
    for (const c of e.children || []) if (c.tag) walk(c);
  };
  walk(sc.parseMarkup(body));
  const h2 = all.find((e) => e.tag === 'h2');
  /** `body` with each { at, was, put } changed, and a plan that calls each change an attribute of the <h2> put in. */
  const covered = (changes) => {
    let value = '';
    let last = 0;
    const plan = [];
    for (const { at, was, put } of changes) {
      value += body.slice(last, at);
      plan.push({ kind: 'attr', unit: { owner: h2, name: 'data-x' }, start: at, end: at + was.length, newStart: value.length, newEnd: value.length + put.length, reads: put });
      value += put;
      last = at + was.length;
    }
    return sc.verify(body, value + body.slice(last), plan);
  };
  const style = covered([{ at: body.indexOf('940px'), was: '940px', put: '100%' }]);
  check('C10 bug 6: a style changed under cover of a wrong plan - the second reader sees it', JSON.stringify(style) === '["Second reader: the content of <style> changed"]', JSON.stringify(style));
  const words = covered([{ at: body.indexOf('Feel on top'), was: 'Feel on top', put: 'Feel great' }]);
  check('...a text no sentence of the plan covers', JSON.stringify(words) === '["Second reader: the text of <h2> changed outside the plan"]', JSON.stringify(words));
  const renamed = covered([
    { at: body.indexOf('<h2') + 1, was: 'h2', put: 'h3' },
    { at: body.indexOf('</h2') + 2, was: 'h2', put: 'h3' }
  ]);
  check('...a tag renamed', JSON.stringify(renamed) === '["Second reader: element 3 was <h2>, now <h3>"]', JSON.stringify(renamed));
}
{
  // Bug 5: the title of a link inside a sentence given words other than its translation.
  const body = block(2).node.bodyHtml.replace(
    '<a href="https://www.samsung.com/levant/apps/samsung-health/"',
    '<a href="https://www.samsung.com/levant/apps/samsung-health/" title="Open the Samsung Health App page"'
  );
  const p = prep(body);
  const s = p.placed.find((x) => x.nested?.length);
  const n = s.nested[0];
  const wrong = p.value.slice(0, n.newStart) + '[fr] Open the Samsung Health page' + p.value.slice(n.newEnd);
  const grow = wrong.length - p.value.length;
  const plan = p.placed.map((x) => (x === s ? { ...x, newEnd: x.newEnd + grow, nested: [{ ...n, newEnd: n.newEnd + grow }] } : x.newStart > s.newStart ? { ...x, newStart: x.newStart + grow, newEnd: x.newEnd + grow } : x));
  const found = sc.verify(body, wrong, plan);
  check(
    'C10 bug 5: a title inside a sentence that does not read as its translation - caught where it is, and by the second reader',
    n.newStart > s.newStart &&
      p.value.slice(n.newStart, n.newEnd) === '[fr] Open the Samsung Health App page' &&
      found.some((f) => /^At line \d+ the text reads "\[fr\] Open the Samsung Health page", not "\[fr\] Open the Samsung Health App page"$/.test(f)) &&
      found.some((f) => /^Second reader: <a> title \(in the text at line \d+\) reads "\[fr\] Open the Samsung Health page", planned "\[fr\] Open the Samsung Health App page"$/.test(f)),
    JSON.stringify([p.value.slice(n.newStart, n.newEnd), found])
  );
}

console.log('\n--- after the paste: Check again (C11) -----------------------------------');

{
  const recs = [...PREPARED].map(([no, p]) => record(no, p));
  const r5 = recs.find((r) => r.no === 5);
  const r2 = recs.find((r) => r.no === 2);
  const others5 = recs.filter((r) => r.no !== 5);
  const old = r5.old;
  const P = r5.prepared;
  const lines = P.split('\r\n');
  const at = lines.findIndex((l) => l.includes('// Keyboard navigation'));
  lines.splice(at, 2, `${lines[at]} ${lines[at + 1].trim()}`);
  const say = (now, rec = r5, others = others5) => sc.pasteStatus(now, rec, others);
  const cases = [
    ['exactly as prepared', { ...old, bodyHtml: P }, 'pasted', 'Pasted (done)'],
    ['LF for CRLF, indented again', { ...old, bodyHtml: P.replace(/\r\n/g, '\n').replace(/\n/g, '\n  ') }, 'pasted', 'Pasted (done) (the editor changed line endings or indentation only)'],
    ['a comment line joined with the next (the script broken)', { ...old, bodyHtml: lines.join('\r\n') }, 'differs', 'Differs at line 347: now "// Keyboard navigation document", prepared "// Keyboard navigation"'],
    ['nothing changed', { ...old }, 'not pasted', 'Not pasted yet'],
    [
      'pasted into Header(CSS)',
      { ...old, headerInclude: P },
      'wrong tab',
      'Pasted into Header(CSS) by mistake: open the block, tab Header(CSS), press Ctrl+A, then Delete; then paste into the Body(HTML) field and click Done.'
    ],
    [
      'pasted into Footer(Javascript)',
      { ...old, footerInclude: P },
      'wrong tab',
      'Pasted into Footer(Javascript) by mistake: open the block, tab Footer(Javascript), press Ctrl+A, then Delete; then paste into the Body(HTML) field and click Done.'
    ],
    [
      "block 4's new value pasted here",
      { ...old, bodyHtml: recs.find((r) => r.no === 4).prepared },
      'wrong block',
      "This block holds the value of block 4. Open THIS block again and paste its own value; then paste block 4's value into block 4."
    ],
    ["block 4's old value pasted here", { ...old, bodyHtml: block(4).node.bodyHtml }, 'wrong block', "This block holds the value of block 4. Open THIS block again and paste its own value; then paste block 4's value into block 4."],
    ['cut short', { ...old, bodyHtml: P.slice(0, 6319) }, 'cut short', 'Cut short: only the first 6,319 of 15,835 characters (ends at line 155). Copy and paste again.'],
    ['cleared, nothing pasted', { ...old, bodyHtml: '' }, 'cut short', 'Body(HTML) is empty: the paste did not land, or the field was cleared. Copy and paste again.'],
    [
      'links re-pointed after the paste',
      { ...old, bodyHtml: P.split('https://www.samsung.com/levant/').join('https://www.samsung.com/levant_ar/') },
      'pasted',
      'Pasted (done) - links or image paths changed after the paste: if that was intended, nothing to do'
    ],
    [
      'an image path changed after the paste',
      { ...old, bodyHtml: P.replace(/wellness-kv-mo-webp-v2\.png/, 'wellness-kv-mo-ar.png') },
      'pasted',
      'Pasted (done) - links or image paths changed after the paste: if that was intended, nothing to do'
    ],
    ['a word changed', { ...old, bodyHtml: P.replace('[fr] Buy now', '[fr] Buy') }, 'differs', 'Differs at line 176: now "[fr] Buy", prepared "[fr] Buy now"']
  ];
  for (const [label, now, status, words] of cases) {
    const s = say(now);
    check(`C11: ${label} -> ${status}`, s.status === status && s.say === words, JSON.stringify(s));
  }
  const css = say({ ...old, bodyHtml: P, headerInclude: '.x { direction: rtl; }' });
  check(
    'C11: CSS added to Header(CSS) by a developer: done, and said for the developer',
    css.status === 'pasted' && css.done && JSON.stringify(css.extra) === JSON.stringify(['Header(CSS) changed (CSS only): developer work - check with the developer']),
    JSON.stringify(css)
  );
  const js = say({ ...old, bodyHtml: P, footerInclude: 'console.log("rtl");' });
  check('...a script added to its Footer, likewise', js.status === 'pasted' && JSON.stringify(js.extra) === JSON.stringify(['Footer(Javascript) changed: developer work']), JSON.stringify(js));
  const lost = sc.pasteStatus({ ...r2.old, bodyHtml: r2.prepared.replace('notre <a', 'notre<a') }, r2, recs.filter((r) => r.no !== 2));
  check(
    'C11: block 2, a visible space lost before the link',
    lost.status === 'differs' && lost.say === 'Differs at line 12: now "g fonctionnent avec notre<a href=\\"https://www.sams", prepared "g fonctionnent avec notre <a href=\\"https://www.sam"',
    JSON.stringify(lost)
  );
  const withCss = { ...r5, old: { ...old, headerInclude: '.tabs { gap: 8px; }' } };
  check(
    'a Header that had CSS, pasted over: the fix puts its old value back',
    say({ ...withCss.old, headerInclude: P }, withCss).say ===
      'Pasted into Header(CSS) by mistake: open the block, tab Header(CSS), press Ctrl+A and paste back its old value (Copy old Header(CSS) on the card); then paste into the Body(HTML) field and click Done.',
    say({ ...withCss.old, headerInclude: P }, withCss).say
  );

  // The editor may turn CRLF into LF and indent again: a value is known all the same - another block's, the old one, one cut short.
  const lf = (v) => v.replace(/\r\n/g, '\n');
  const b4 = recs.find((r) => r.no === 4);
  const loose = [
    ["block 4's new value, its line endings changed", { ...old, bodyHtml: lf(b4.prepared) }, 'wrong block', "This block holds the value of block 4. Open THIS block again and paste its own value; then paste block 4's value into block 4."],
    ["block 4's old value, indented again", { ...old, bodyHtml: block(4).node.bodyHtml.replace(/\r\n/g, '\n  ') }, 'wrong block', "This block holds the value of block 4. Open THIS block again and paste its own value; then paste block 4's value into block 4."],
    ['its own old value, its line endings changed', { ...old, bodyHtml: lf(old.bodyHtml) }, 'not pasted', 'Not pasted yet'],
    ['cut short, its line endings changed and indented again', { ...old, bodyHtml: lf(P.slice(0, 6319)).replace(/\n/g, '\n  ') }, 'cut short', 'Cut short: it ends at line 155 of 361. Copy and paste again.'],
    ['a word changed, the rest indented again', { ...old, bodyHtml: P.replace('[fr] Buy now', '[fr] Buy').replace(/\r\n/g, '\n    ') }, 'differs', 'Differs at line 176: now "[fr] Buy", prepared "[fr] Buy now"'],
    [
      'pasted into Header(CSS), cut short',
      { ...old, headerInclude: P.slice(0, 500) },
      'wrong tab',
      'Pasted into Header(CSS) by mistake: open the block, tab Header(CSS), press Ctrl+A, then Delete; then paste into the Body(HTML) field and click Done.'
    ]
  ];
  for (const [label, now, status, words] of loose) {
    const s = say(now);
    check(`C11: ${label} -> ${status}`, s.status === status && s.say === words, JSON.stringify(s));
  }
  const cleared = say({ ...withCss.old, bodyHtml: P, headerInclude: '' }, withCss);
  check(
    'a Header that had CSS, cleared: not done - the fix puts its old value back',
    cleared.status === 'wrong tab' &&
      !cleared.done &&
      cleared.say === 'Header(CSS) was cleared by mistake: open the block, tab Header(CSS), press Ctrl+A and paste back its old value (Copy old Header(CSS) on the card), then click Done.',
    JSON.stringify(cleared)
  );
  const twoLines = { ...r5, old: { ...old, headerInclude: '.tabs {\r\n  gap: 8px;\r\n}' } };
  const editor = say({ ...twoLines.old, bodyHtml: P, headerInclude: '.tabs {\n    gap: 8px;\n}' }, twoLines);
  check('...its line endings changed by the editor only: done, nothing for the developer', editor.status === 'pasted' && editor.done && !editor.extra.length, JSON.stringify(editor));

  // A Footer with a script: cleared, or a Body value put into it - this block's re-indented, or another block's.
  const FOOT = block(3).node.footerInclude;
  const scripted = { ...r5, old: { ...old, footerInclude: FOOT } };
  const foot = (footerInclude) => say({ ...scripted.old, bodyHtml: P, footerInclude }, scripted);
  check(
    'a Footer cleared: not done - the fix puts its old value back',
    foot('').status === 'wrong tab' &&
      !foot('').done &&
      foot('').say === 'Footer(Javascript) was cleared by mistake: open the block, tab Footer(Javascript), press Ctrl+A and paste back its old value (Copy old Footer(Javascript) on the card), then click Done.',
    JSON.stringify(foot(''))
  );
  check(
    '...the new Body pasted into it, indented again, or block 4’s - though the script had markup of its own already',
    [P.replace(/\r\n/g, '\n  '), b4.prepared].every((v) => foot(v).status === 'wrong tab' && /^Pasted into Footer\(Javascript\) by mistake: .*paste back its old value/.test(foot(v).say)),
    JSON.stringify([foot(P.replace(/\r\n/g, '\n  ')), foot(b4.prepared)].map((s) => s.say))
  );
  const plain = { ...r5, old: { ...old, footerInclude: 'console.log("tabs");' } };
  check(
    '...markup in a Footer whose script had none: pasted in by mistake',
    say({ ...plain.old, bodyHtml: P, footerInclude: '<div class="tabs">Tabs</div>' }, plain).status === 'wrong tab',
    JSON.stringify(say({ ...plain.old, bodyHtml: P, footerInclude: '<div class="tabs">Tabs</div>' }, plain))
  );

  // A text with no translation on the sheet stays English: never a plain done.
  const blank = { ...r5, items: r5.items.map((i, n) => (n ? i : { ...i, status: 'untranslated', translation: '' })) };
  const left = say({ ...old, bodyHtml: P }, blank);
  check(
    'pasted, one text left without a translation: not done, and said',
    left.status === 'pasted' && !left.done && left.say === 'Pasted (not done: 1 still to do)' && left.open[0] === `"${sc.wordsOf(r5.items[0].cell)}": no translation on the sheet - it stays English`,
    JSON.stringify(left)
  );

  // A block DSY offered no value for: nothing to paste - never "Pasted (done)", whatever is in it.
  const r3 = { no: 3, old: { headerInclude: null, bodyHtml: block(3).node.bodyHtml, footerInclude: FOOT }, prepared: null, reason: 'No text of its Body (HTML) is on the sheet.', items: [], notOnSheet: [] };
  const three = (bodyHtml, rec = r3) => sc.pasteStatus({ headerInclude: null, bodyHtml, footerInclude: FOOT }, rec, recs);
  check('block 3, nothing to paste, as it was: done, saying why', three(r3.old.bodyHtml).status === 'nothing to paste' && three(r3.old.bodyHtml).done && three(r3.old.bodyHtml).say === r3.reason, JSON.stringify(three(r3.old.bodyHtml)));
  check(
    '...its Body cleared: not done - the fix puts its old value back',
    three('').status === 'cut short' && !three('').done && three('').say === 'Body(HTML) is empty: the field was cleared. DSY prepared nothing for this block - paste back its old value (Copy old Body(HTML) on the card).',
    JSON.stringify(three(''))
  );
  check(
    '...block 4’s value in it',
    three(b4.prepared).status === 'wrong block' &&
      three(b4.prepared).say === "This block holds the value of block 4. Open THIS block again and paste back its old value (Copy old Body(HTML) on the card); then paste block 4's value into block 4.",
    JSON.stringify(three(b4.prepared))
  );
  check(
    '...changed by someone',
    three('<div id="showcase" class="rtl"></div>').status === 'differs' &&
      three('<div id="showcase" class="rtl"></div>').say ===
        'Differs at line 1: now "<div id=\\"showcase\\" class=\\"rtl\\"></div>", was "<div id=\\"showcase\\"></div>". DSY prepared nothing for this block - if nobody meant to change it, paste back its old value (Copy old Body(HTML) on the card).',
    three('<div id="showcase" class="rtl"></div>').say
  );
  const notOffered = { ...r5, prepared: null, reason: 'Not offered: DSY’s own check of the new value found a problem - …' };
  const waiting = sc.pasteStatus({ ...old }, notOffered, others5);
  check('a block whose value was not offered: nothing to paste, but not done - its texts are still to place', waiting.status === 'nothing to paste' && !waiting.done && waiting.say === notOffered.reason, JSON.stringify(waiting));
  const already = { ...r5, prepared: null, reason: 'Nothing new to paste: the block has the sheet’s translations already.', items: r5.items.map((i) => ({ ...i, status: 'already' })) };
  check('a block with every translation in it already: nothing to paste, and done', sc.pasteStatus({ ...old }, already, others5).done, JSON.stringify(sc.pasteStatus({ ...old }, already, others5)));
}
{
  // What is still to do: never a plain "done" while a text is sent back, not found, in fewer places, or not on the sheet.
  let live = block(5).node.bodyHtml;
  const at = live.lastIndexOf('Buy now');
  live = `${live.slice(0, at)}Buy it now${live.slice(at + 7)}`.replace('Own your daily wellbeing', 'Own your daily well-being');
  const p = sc.prepareBody(live, textsOf(block(5).node.bodyHtml, (c) => (c === 'Weight' ? 'Poids <b>net</b>' : tr(c))));
  const rec = { no: 5, old: { bodyHtml: live }, prepared: p.value, items: p.items, notOnSheet: p.notOnSheet };
  const s = sc.pasteStatus({ bodyHtml: p.value }, rec, []);
  check(
    'pasted, but not done: what is still to do is listed',
    s.status === 'pasted' &&
      !s.done &&
      s.say === 'Pasted (not done: 4 still to do)' &&
      JSON.stringify(s.open) ===
        JSON.stringify([
          `"Own your daily wellbeing, with AI powered health tracking a…": ${sc.NOT_IN_BLOCK}`,
          '"Buy now": 2 places at export, 1 now - look at the block.',
          `"Weight" was sent back - it stays English: ${sc.WORDS_ONLY}`,
          'Not on the sheet - stays English: "Own your daily well-being, with AI powered health tracking …", "Buy it now"'
        ]),
    JSON.stringify(s)
  );
}

console.log('\n--- the Footer, for a developer ---------------------------------------');

const FOOTER = block(3).node.footerInclude;
const SCRIPT_TEXTS = sc.blockTexts(sc.readBlock({ footerInclude: FOOTER })).filter((t) => t.prop === 'footerInclude');
{
  const fr = { 'Learn more': 'En savoir&nbsp;plus', 'Energy Score': 'Score "énergie"', 'Open showcase container': 'Ouvrir la vitrine', 'Close showcase container': 'Fermer la vitrine' };
  const list = sc.developerList(FOOTER, new Map(SCRIPT_TEXTS.map((t) => [t.cell, fr[t.cell] ?? `[fr] ${t.cell}`])));
  const line = (n) => list.find((i) => i.lines.some((l) => l.line === n));
  check(
    'each line with its translation: line 75, the title, its own quote escaped',
    JSON.stringify(line(75)?.lines) === JSON.stringify([{ line: 75, now: 'title: "Energy Score",', new: 'title: "Score \\"énergie\\"",' }]),
    JSON.stringify(line(75))
  );
  check(
    '...line 43, "Learn more": the sheet’s &nbsp; becomes the no-break character itself',
    line(43)?.lines[0].now.includes('(n = V("Learn more"))') && line(43).lines[0].new.includes(`(n = V("En savoir${NBSP}plus"))`) && !line(43).lines[0].new.includes('&nbsp;'),
    JSON.stringify(line(43))
  );
  check(
    '...line 180, a label the script sets',
    line(180)?.lines[0].new === '((i = S("button")), u(i, "aria-label", "[fr] Close product details modal"), u(i, "class", "svelte-181p854"));',
    JSON.stringify(line(180))
  );
  const built = list.filter((i) => i.built);
  check(
    'the built sentence is one item over both lines that build it: a choice between the whole sentences, translated',
    built.length === 1 &&
      JSON.stringify(built[0].lines.map((l) => l.line)) === '[52,53]' &&
      built[0].lines[0].now === 'u(a, "title", (m = `${e[6] === "open" ? "Close" : "Open"} showcase container`)),' &&
      built[0].lines[0].new === 'u(a, "title", (m = (e[6] === "open" ? "Fermer la vitrine" : "Ouvrir la vitrine"))),' &&
      built[0].lines[1].new === 'u(a, "aria-label", (p = (e[6] === "open" ? "Fermer la vitrine" : "Ouvrir la vitrine"))),',
    JSON.stringify(built)
  );
  check('the 26 lines with strings, and the built sentence: 27 items, in line order', list.length === 27 && list.every((x, i) => !i || x.lines[0].line > list[i - 1].lines[0].line), String(list.length));
  const long = sc.developerList(`var a=${'1,'.repeat(300)}b={title:"Sleep better"},c=${'2,'.repeat(300)}0;`, new Map([['Sleep better', 'Mieux dormir']]));
  check(
    'a script squeezed onto one line is shown around the change only',
    long[0].lines[0].now.length < 200 && long[0].lines[0].now.startsWith('…') && long[0].lines[0].now.endsWith('…') && long[0].lines[0].new.includes('title:"Mieux dormir"'),
    JSON.stringify(long[0].lines[0])
  );
  const other = sc.developerList('el.title = `${n} of ${total} tiles shown`;', new Map([['{…} of {…} tiles shown', '{…} sur {…} tuiles']]));
  check('a template that is not one choice is listed for the developer to write', other.length === 1 && other[0].built && other[0].lines[0].new === null, JSON.stringify(other));
  // A choice inside a choice makes three sentences: never read as two of them.
  const nested = 'el.title = `${a ? "Pause" : b ? "Close" : "Open"} showcase container`;';
  const three = sc.developerList(nested, new Map([['{…} showcase container', '{…} la vitrine']]));
  check(
    '...nor is a choice inside a choice: read as {…}, and left for the developer to write',
    JSON.stringify(sc.readScript(nested).built[0].sentences) === '["{…} showcase container"]' && three.length === 1 && three[0].lines[0].new === null,
    JSON.stringify([sc.readScript(nested).built[0].sentences, three])
  );
  const same = sc.developerList(FOOTER, new Map([['Energy Score', 'Energy Score'], ['Learn more', 'En savoir plus']]));
  check(
    'a translation the same as the English is nothing for the developer to change',
    same.length === 1 && JSON.stringify(same[0].texts) === JSON.stringify([{ cell: 'Learn more', translation: 'En savoir plus' }]),
    JSON.stringify(same)
  );
}
{
  const texts = SCRIPT_TEXTS.map((t) => ({ cell: t.cell, translation: `[fr] ${t.cell}`, built: t.places.some((p) => p.kind === 'Built sentence') }));
  const before = sc.footerStatus(FOOTER, texts);
  check(
    'the Footer checked again, before the developer: every string still English, the built sentence too',
    before.strings === 25 && before.english === 25 && before.built === 'still in English' && before.say === '25 of 25 still in English, built sentence still in English, no </script',
    JSON.stringify(before)
  );
  // The developer puts everything in, the built sentence as two plain strings - one of them with "</script" in it by mistake.
  let done = FOOTER;
  for (const t of SCRIPT_TEXTS) if (!t.places.some((p) => p.kind === 'Built sentence')) done = done.split(`"${t.cell}"`).join(`"[fr] ${t.cell}"`);
  done = done.split('`${e[6] === "open" ? "Close" : "Open"} showcase container`').join('(e[6] === "open" ? "[fr] Close showcase container" : "[fr] Open showcase container")');
  const after = sc.footerStatus(done, texts);
  check('...after: none still English, the built sentence translated', after.english === 0 && after.built === 'translated' && !after.scriptEnd, JSON.stringify(after));
  const broken = sc.footerStatus(done.replace('"[fr] Energy Score"', '"[fr] Energy Score</script>"'), texts);
  check('..."</script" in it is pointed out: the page’s script would stop there', broken.scriptEnd && /"<\/script" in it/.test(broken.say), broken.say);
  const own = done.split('"[fr] Close showcase container"').join('"Fermer"').split('"[fr] Open showcase container"').join('"Ouvrir"');
  const words = sc.footerStatus(own, texts);
  check('...the built sentence put in as words of the developer’s own, neither the English nor the sheet’s: not found', words.built === 'not found' && /built sentence not found/.test(words.say), JSON.stringify(words));
  check('...every translation in it, and said so', after.translated === 25 && !after.empty, JSON.stringify(after));
  // No English left is not done: an emptied Footer, or one with its strings cut out, has none either.
  const plain = texts.filter((t) => !t.built);
  const emptied = sc.footerStatus('', plain);
  const cut = sc.footerStatus(FOOTER.replace(/"(?:[^"\\]|\\.)*"/g, '""'), plain);
  check(
    'an emptied Footer, or its strings cut out: no English, but no translation either - said so',
    emptied.empty && emptied.english === 0 && emptied.translated === 0 && /neither English nor translated/.test(emptied.say) &&
      !cut.empty && cut.english === 0 && cut.translated === 0 && /neither English nor translated/.test(cut.say),
    JSON.stringify([emptied, cut])
  );
}

console.log('\n--- the import carries it, block by block ---------------------------------');

/** Excel's clipboard: tabs and CRLF, a cell quoted only when it holds a line break or a tab. */
const clipboard = (grid) => grid.map((r) => r.map((c) => (/[\n\r\t]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join('\t')).join('\r\n');
/** `edit(record, S)` may change a row by hand, as a translator might: S is the Source text column. */
function sheetOf(tree, translate, { staticPieces = false, edit } = {}) {
  const sheet = core.buildSheet(core.extractCopyDeck(clone(tree), { pagePath: PAGE, staticPieces }).rows, { pagePath: PAGE, exportedAt: '2026-10-12 10:00' });
  const S = sheet.columns.indexOf('Source text');
  const T = sheet.columns.indexOf('Translation');
  for (const rec of sheet.records.slice(0, -1)) rec[T] = translate(rec[S]) ?? '';
  if (edit) for (const rec of sheet.records.slice(0, -1)) edit(rec, S);
  if (staticPieces) sheet.records.at(-1)[2] = sheet.records.at(-1)[2].replace(/copy deck v\d+/, 'copy deck v3');
  return core.readSheet(core.gridFromText(clipboard([sheet.columns, ...sheet.records])));
}
const plan = (tree, sheet) => core.planImport(clone(tree), sheet, { pagePath: TARGET });
{
  const p = plan(FIXTURE, sheetOf(FIXTURE, tr));
  const blocks = p.staticBlocks;
  check(
    'every block, in page order, with its node, its label and its three fields as read',
    blocks.length === 8 &&
      blocks.every((b, i) => b.no === i + 1 && b.of === 8 && b.path === BLOCKS[i].path && b.old.bodyHtml === BLOCKS[i].node.bodyHtml && b.old.headerInclude === null) &&
      blocks[4].label === 'Static content 5 of 8 · Made to support your everyday wellness' &&
      blocks[2].old.footerInclude === FOOTER,
    JSON.stringify(blocks.map((b) => [b.no, b.path, b.label]))
  );
  check(
    'each Body prepared as prepareBody makes it from the page alone, all three checks passed',
    blocks.filter((b) => b.prepared).length === 7 && [...PREPARED].every(([no, x]) => blocks[no - 1].prepared === x.value && blocks[no - 1].checks.length === 0 && blocks[no - 1].reason === null),
    JSON.stringify(blocks.map((b) => [b.no, b.reason, b.checks]))
  );
  check('block 3 says why it has none', blocks[2].prepared === null && blocks[2].reason === 'No text of its Body (HTML) is on the sheet.', JSON.stringify(blocks[2].reason));
  check(
    'each text with its outcome and sheet row; nothing on the page left off the sheet',
    blocks[4].items.length === 32 && blocks[4].items.every((i) => i.status === 'placed' && i.sheetRow > 1 && i.key.startsWith(`${BLOCKS[4].path}@bodyHtml#h`)) && blocks.every((b) => b.notOnSheet.length === 0),
    JSON.stringify(blocks[4].items.slice(0, 2))
  );
  check(
    'block 3: its script’s 27 texts, and the developer’s list from them',
    blocks[2].script.length === 27 && blocks[2].script.every((i) => i.status === 'placed') && blocks[2].developer.length === 27 && blocks[2].developer.some((i) => i.built),
    JSON.stringify([blocks[2].script.length, blocks[2].developer.length])
  );
  check('nothing of it is written: the writes are the 2 page properties', p.writes.length === 2 && !p.writes.some((w) => /bodyHtml|headerInclude|footerInclude/.test(w.prop)), JSON.stringify(p.writes.map((w) => w.prop)));
  const lifestyle = p.rows.find((r) => r.current === 'Made to support your<br><span class="header-highlight">active lifestyle</span>');
  check('what the block says of a text is on its row too: the <br> the translator left out', lifestyle?.status === 'manual' && lifestyle.warnings.includes('A line break (<br>) was left out - allowed'), JSON.stringify(lifestyle));
  const texts = blocks[2].script;
  check(
    'the Footer’s texts, each marked when the script builds it, as footerStatus takes them',
    texts.filter((i) => i.built).length === 2 && sc.footerStatus(FOOTER, texts).say === '25 of 25 still in English, built sentence still in English, no </script',
    sc.footerStatus(FOOTER, texts).say
  );
  let copy = null;
  try {
    copy = JSON.parse(JSON.stringify(blocks));
  } catch {}
  check('the blocks are plain data: they cross from the page to the panel whole', JSON.stringify(copy) === JSON.stringify(blocks), '');
}
{
  // A tag added to a sentence: that text is sent back - its row needs fixing - and the rest of the block is prepared.
  const head = 'Made to support your<br><span class="header-highlight">everyday wellness</span>';
  const p = plan(FIXTURE, sheetOf(FIXTURE, (c) => (c === head ? 'Conçu pour <b>votre</b><br><span class="header-highlight">bien-être</span>' : tr(c))));
  const row = p.rows.find((r) => r.current === head);
  const b5 = p.staticBlocks[4];
  check(
    'a text the block cannot take is sent back: its row "Needs fixing", saying why',
    row?.status === 'invalid' && row.message === '<b> is not in the English - a tag may be moved, not added' && p.counts.invalid === 1 && p.counts.manual === 70,
    JSON.stringify(row)
  );
  check(
    '...the block still prepared without it - that headline left English',
    b5.prepared?.includes('Made to support your') && b5.prepared.includes('Catégories de &quot;produits&quot;') && b5.items.find((i) => i.cell === head)?.status === 'sent back' && b5.checks.length === 0,
    JSON.stringify(b5.items.find((i) => i.cell === head))
  );
}
{
  // The block pasted already, and the English changed in another: "already", and what is left.
  const t = clone(FIXTURE);
  nodeAt(t, BLOCKS[3].path).bodyHtml = PREPARED.get(4).value;
  nodeAt(t, BLOCKS[7].path).bodyHtml = nodeAt(t, BLOCKS[7].path).bodyHtml.replace('Feel on top of your health', 'Feel great about your health');
  const p = plan(t, sheetOf(FIXTURE, tr));
  check(
    'a pasted block: every text "already", nothing to paste - and says so',
    p.staticBlocks[3].items.every((i) => i.status === 'already') && p.staticBlocks[3].prepared === null && p.staticBlocks[3].reason === 'Nothing new to paste: the block has the sheet’s translations already.',
    JSON.stringify(p.staticBlocks[3])
  );
  check(
    'English changed after the export: not found, and the new English listed as not on the sheet',
    p.staticBlocks[7].items[0].status === 'not found' && JSON.stringify(p.staticBlocks[7].notOnSheet) === JSON.stringify(['Feel great about your health']),
    JSON.stringify(p.staticBlocks[7])
  );
}
{
  // A link re-pointed on the page since the export: the translation is matched by the tags the translator saw.
  const moved = clone(FIXTURE);
  nodeAt(moved, BLOCKS[1].path).bodyHtml = nodeAt(moved, BLOCKS[1].path).bodyHtml.split('/levant/').join('/levant_ar/');
  const p = plan(moved, sheetOf(FIXTURE, tr));
  const b2 = p.staticBlocks[1];
  check(
    'a link re-pointed since the export: the page’s new link is kept, the words in it translated',
    b2.prepared?.includes('notre <a href="https://www.samsung.com/levant_ar/apps/samsung-health/"\r\n            >application Samsung Health</a') && b2.checks.length === 0,
    JSON.stringify([b2.reason, b2.items])
  );
}
{
  // Header(CSS) with HTML in it - a paste into the wrong tab earlier: no value offered until it is put back.
  const t = clone(FIXTURE);
  nodeAt(t, BLOCKS[5].path).headerInclude = '<div class="buds">';
  const b6 = plan(t, sheetOf(FIXTURE, tr)).staticBlocks[5];
  check('a block whose Header holds HTML is offered no value, and says why', b6.prepared === null && /^Its Header \(CSS\) holds HTML/.test(b6.reason), JSON.stringify(b6.reason));
}
{
  // Static HTML on the page itself is static content too: prepared like a block, never ordinary copy.
  const t = clone(FIXTURE);
  t.bodyHtml = '<div class="promo"><p>Welcome to <a href="/levant/health/">Samsung Health</a> week.</p></div>';
  const p = plan(t, sheetOf(t, (s) => (s.startsWith('Welcome') ? 'Bienvenue à la semaine <a href="/levant/health/">Samsung Health</a>.' : tr(s))));
  const own = p.staticBlocks.find((b) => b.path === '');
  check(
    'a bodyHtml on jcr:content itself gets a prepared value too - and is never written',
    own?.prepared === '<div class="promo"><p>Bienvenue à la semaine <a href="/levant/health/">Samsung Health</a>.</p></div>' && own.no === null && !p.writes.some((w) => w.prop === 'bodyHtml'),
    JSON.stringify(own)
  );
}
{
  // Two links, re-pointed on the page since the export, their words swapped by the translator: matched by the links the sheet showed.
  const W = 'https://www.samsung.com/levant/watches/all-watches/';
  const H = 'https://www.samsung.com/levant/apps/samsung-health/';
  const tree = clone(FIXTURE);
  const node = nodeAt(tree, BLOCKS[1].path);
  node.bodyHtml = node.bodyHtml.replace('All of our Galaxy Watches and', `All of our <a href="${W}"\r\n            >Galaxy Watches</a\r\n          > and`);
  const sheet = sheetOf(tree, (c) =>
    c.startsWith('All of our') ? `L'<a href="${H}">application Samsung Health</a> accompagne toutes nos <a href="${W}">montres Galaxy</a>.` : tr(c)
  );
  const moved = clone(tree);
  nodeAt(moved, BLOCKS[1].path).bodyHtml = node.bodyHtml.split('/levant/').join('/levant_ar/');
  const b2 = plan(moved, sheet).staticBlocks[1];
  const linkOf = (html, words) => html?.replace(/\s+/g, ' ').match(new RegExp(`<a href="([^"]+)"[^>]*>\\s*${words}`))?.[1];
  check(
    'two links re-pointed since the export, swapped by the translator: offered, each of the page’s links with its own words',
    b2.prepared !== null &&
      b2.checks.length === 0 &&
      b2.items.every((i) => i.status === 'placed') &&
      linkOf(b2.prepared, 'montres Galaxy') === W.replace('/levant/', '/levant_ar/') &&
      linkOf(b2.prepared, 'application Samsung Health') === H.replace('/levant/', '/levant_ar/'),
    JSON.stringify([b2.reason, b2.items.map((i) => [i.status, i.message])])
  );
  // The sheet's Source cell flattened by hand: its Check does not match it, so the tags are matched with the page's own cell.
  const flat = plan(FIXTURE, sheetOf(FIXTURE, tr, { edit: (rec, S) => rec[S].startsWith('All of our') && (rec[S] = sc.wordsOf(rec[S])) }));
  const item = flat.staticBlocks[1].items.find((i) => i.cell.startsWith('All of our'));
  check('...and a Source cell whose tags were taken out by hand: the page’s own cell is used, and the text placed', item?.status === 'placed' && flat.staticBlocks[1].prepared !== null, JSON.stringify(item));
}
{
  // One place of "Buy now" gone since the export: the block's text says so, and Check again is never a plain done.
  const t = clone(FIXTURE);
  const n5 = nodeAt(t, BLOCKS[4].path);
  const at = n5.bodyHtml.lastIndexOf('Buy now');
  n5.bodyHtml = `${n5.bodyHtml.slice(0, at)}Buy it now${n5.bodyHtml.slice(at + 7)}`;
  const p = plan(t, sheetOf(FIXTURE, tr));
  const b5 = p.staticBlocks[4];
  const buy = b5.items.find((i) => i.cell === 'Buy now');
  const s = sc.pasteStatus({ ...b5.old, bodyHtml: b5.prepared }, b5, p.staticBlocks.filter((b) => b !== b5));
  check(
    'a text in fewer places than at the export: said on the block’s text, and Check again is not done',
    buy?.warnings.includes('"Buy now": 2 places at export, 1 now - look at the block.') && s.status === 'pasted' && !s.done && s.open.includes('"Buy now": 2 places at export, 1 now - look at the block.'),
    JSON.stringify([buy, s])
  );
}
{
  // A Footer row refused is never in the developer's list; a new string in the Footer is not the Body's.
  const t = clone(FIXTURE);
  nodeAt(t, BLOCKS[2].path).footerInclude = FOOTER.replace('title: "Energy Score"', 'title: "Energy Score+"');
  const p = plan(t, sheetOf(FIXTURE, (c) => (c === 'Learn more' ? 'En savoir <script>x()</script>' : tr(c))));
  const b3 = p.staticBlocks[2];
  check(
    'a Footer text refused: its row needs fixing, and it is not in the developer’s list',
    p.rows.find((r) => r.current === 'Learn more')?.status === 'invalid' && !b3.developer.some((i) => i.texts.some((x) => x.cell === 'Learn more')) && b3.developer.length === 25,
    JSON.stringify([p.rows.find((r) => r.current === 'Learn more'), b3.developer.length])
  );
  check(
    'a string added to the Footer since the export: on the page but not on the sheet - and never the Body’s text',
    p.notInSheet.some((r) => r.source === 'Energy Score+' && r.prop === 'footerInclude') && b3.notOnSheet.length === 0,
    JSON.stringify([p.notInSheet.map((r) => r.source), b3.notOnSheet])
  );
}
{
  // Block 8's only text sent back: nothing to paste yet, and the card says why.
  const p = plan(FIXTURE, sheetOf(FIXTURE, (c) => (c === 'Feel on top of your health' ? '<b>Restez</b> au top de votre santé' : tr(c))));
  check(
    'a block whose every text was sent back: nothing to paste yet - fix those rows',
    p.staticBlocks[7].prepared === null && p.staticBlocks[7].reason === 'Nothing to paste yet: its texts on the sheet were sent back - fix those rows and import again.',
    JSON.stringify(p.staticBlocks[7].reason)
  );
}
{
  // A check that fails: the value is never offered. The page leaves a <b> open; the translator closes it mid-sentence, so the words would run together.
  const t = clone(FIXTURE);
  const n8 = nodeAt(t, BLOCKS[7].path);
  n8.bodyHtml = n8.bodyHtml.replace('<p class="titleblock__subtitle ch-dt-19 ch-mo-19">\r\n          </p>', '<p class="titleblock__subtitle ch-dt-19 ch-mo-19">Track your <b>sleep</p>');
  const p = plan(t, sheetOf(t, (c) => (c === 'Track your <b>sleep' ? 'Suivez votre <b>sommeil</b>chaque nuit' : tr(c))));
  const b8 = p.staticBlocks[7];
  check(
    'a prepared value that fails a check is never offered, and the card says what was found',
    b8.prepared === null &&
      b8.reason === 'Not offered: DSY’s own check of the new value found a problem - At line 6 the text reads "Suivez votre sommeilchaque nuit", not "Suivez votre sommeil chaque nuit"' &&
      b8.checks.length === 1,
    JSON.stringify([b8.reason, b8.checks])
  );
}
{
  // Markup as codes in a words-only row; an apostrophe that may close the attribute a text goes into.
  const t = clone(FIXTURE);
  const n8 = nodeAt(t, BLOCKS[7].path);
  n8.bodyHtml = n8.bodyHtml.replace('</h2>', "</h2>\r\n        <img src='/levant/feel.png' alt='Feel great' />\r\n        <img src=\"/levant/top.png\" alt=\"On top\" />");
  const attack = "C'est l'offre x onmouseover=alert(1) y";
  const codes = '&lt;img src=x onerror=alert(1)&gt;';
  const p = plan(t, sheetOf(t, (c) => ({ Silver: codes, 'Energy Score': codes, 'Feel great': attack, 'On top': attack })[c] ?? tr(c)));
  const row = (c) => p.rows.find((r) => r.current === c);
  check(
    'markup written as codes in a words-only row needs fixing - in the Body, and in the Footer, whose strings a script may put on the page as markup',
    ['Silver', 'Energy Score'].every((c) => row(c)?.status === 'invalid' && row(c).message === sc.WORDS_ONLY),
    JSON.stringify([row('Silver'), row('Energy Score')])
  );
  check(
    'an apostrophe that closes an attribute in single quotes: what follows is read as code - refused',
    row('Feel great')?.status === 'invalid' && /runs a script/.test(row('Feel great').message),
    JSON.stringify(row('Feel great'))
  );
  check(
    '...in double quotes it closes nothing, and the block gets it escaped',
    row('On top')?.status === 'manual' && p.staticBlocks[7].prepared?.includes('alt="C&#39;est l&#39;offre x onmouseover=alert(1) y"') && p.staticBlocks[7].checks.length === 0,
    JSON.stringify([row('On top'), p.staticBlocks[7].reason])
  );
}
{
  // Two pieces of the real showcase Footer that reached the sheet as text: a comment in a string, and an animation put together.
  const js = [
    'r.textContent = "/* empty */";',
    'n.style.animation = `${k}${i} ${d}ms linear ${w}ms 1 both`;',
    'u(a, "title", (m = `${e[6] === "open" ? "Close" : "Open"} showcase container`)),',
    'el.textContent = "Sleep better tonight";'
  ].join('\r\n');
  const r = sc.readScript(js);
  check('a string that is a code comment ("/* empty */") is not a text', !r.units.some((u) => u.cell.includes('empty')), JSON.stringify(r.units.map((u) => u.cell)));
  check(
    '...nor a template of CSS ("{…}{…} {…}ms linear {…}ms 1 both"); the showcase container’s sentences and a real string still are',
    r.built.length === 1 &&
      JSON.stringify(r.built[0].sentences) === '["Close showcase container","Open showcase container"]' &&
      JSON.stringify(r.units.map((u) => u.cell)) === '["Sleep better tonight"]',
    JSON.stringify([r.built.map((b) => b.sentences), r.units.map((u) => u.cell)])
  );
  check('...a "// note" or "<!-- note -->" string neither', !sc.readScript('a.textContent = "// Keyboard navigation"; b.textContent = "<!-- Showcase tiles -->";').units.length, '');
}
{
  const old = plan(FIXTURE, sheetOf(FIXTURE, (s) => (s === 'Pick your perfect fitness partner' ? 'Choisissez votre partenaire fitness idéal' : null), { staticPieces: true }));
  check('a sheet made before v4, in pieces, gets no prepared blocks - only its list', old.staticBlocks.length === 0 && old.rows.some((r) => r.status === 'manual'), JSON.stringify(old.staticBlocks.length));
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
