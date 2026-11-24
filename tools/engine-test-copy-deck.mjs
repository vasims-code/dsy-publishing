/**
 * Copy deck, export and import, without a screen: the sheet as the export
 * writes it, read back the ways it comes back - pasted, saved as text, saved
 * as .xlsx - planned against a page, and written by the real import worker to
 * a small in-memory AEM. Each case is a shape that once got past the import.
 * Imported by engine-test.mjs; runs on its own too.
 *
 *   node tools/engine-test-copy-deck.mjs
 */

import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const C = await import('../src/features/copy-deck/core.js');
const X = await import('../src/features/copy-deck/xlsx.js');
const { actions } = await import('../src/features/copy-deck-import/worker.js');

const DATA = process.env.DSY_DATA || new URL('./fixtures/', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
const SRC_PAGE = '/content/samsung/uk/mobile-phone-buying-guide/samsung-galaxy-z-flip-6-vs-z-flip-5';
const PAGE = '/content/samsung/fr/test-page';

let failed = 0;
const check = (ok, said, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${said}${ok || !detail ? '' : ` - ${detail}`}`);
  if (!ok) failed++;
};

/** A page of one Text Block, shaped as AEM serves it. */
const page = (extra = {}) => ({
  'jcr:primaryType': 'cq:PageContent',
  'sling:resourceType': 'samsung/components/page/page-standard',
  'jcr:title': 'Galaxy Phones | Samsung UK',
  description: 'Buy the best phones',
  root: {
    'jcr:primaryType': 'nt:unstructured',
    'sling:resourceType': 'wcm/foundation/components/responsivegrid',
    tb: {
      'jcr:primaryType': 'nt:unstructured',
      'sling:resourceType': 'samsung/components/content/cm-g-text-block',
      headlineText: 'Great headline',
      description: '<p>Rich <a href="/uk/smartphones/">phones</a> here</p>',
      textForLinkAction1: 'Buy now',
      ...extra
    }
  }
});
const exported = (content, pagePath = '/content/samsung/uk/test-page') =>
  C.buildSheet(C.extractCopyDeck(content, { pagePath }).rows, { pagePath, exportedAt: '2026-11-03 10:00' });
/** The sheet with each Translation cell set from its Source text. */
const translated = (sheet, fn) => ({ ...sheet, records: sheet.records.map((r) => (r[3] === '#meta' ? r : [...r.slice(0, 6), fn(r[5], r)])) });
/** The grid as Excel hands it over, cell for cell. */
const gridOf = (sheet) => [sheet.columns, ...sheet.records].map((r) => r.map(String));
const plan = (content, grid, pagePath = PAGE) => {
  const rs = C.readSheet(grid);
  return rs.ok ? C.planImport(content, rs, { pagePath }) : { problem: rs.problem };
};
const rowOf = (p, key) => p.rows?.find((r) => r.key === key);
const HEAD = 'root/tb@headlineText';
const RICH = 'root/tb@description';
const onlyHeadline = (t) => (src) => (src === 'Great headline' ? t : '');

/** A Sling POST applied as AEM would, form-encoded on the wire. `dropOn` saves request n and then loses the answer. */
function fakeAem(content, { failOn = null, dropOn = null } = {}) {
  const live = structuredClone(content);
  const posts = [];
  return {
    live,
    posts,
    resetCaches() {},
    assertReadable() {},
    async inspect() {
      return { exists: true, isPage: true, primaryType: 'cq:Page', title: 'T', template: '/conf/x/templates/page-standard' };
    },
    async readTreeWhole(path) {
      return path === `${PAGE}/jcr:content` ? structuredClone(live) : null;
    },
    async readJson() {
      return { status: 404, json: null };
    },
    async currentUser() {
      return 'admin';
    },
    async writeNode(target, pairs) {
      const n = posts.length + 1;
      const sent = [...new URLSearchParams(new URLSearchParams(pairs).toString())];
      posts.push(sent.map(([k]) => k));
      if (failOn === n) return { success: false, http: 500, effective: 500, message: 'boom' };
      const changes = [];
      for (const [k, v] of sent) {
        if (k.endsWith('@TypeHint')) continue;
        const parts = k.replace(/^\.\//, '').split('/');
        const prop = parts.pop();
        let node = live;
        for (const s of parts) node = node[s] ??= {};
        node[prop] = v;
        changes.push('modified(');
      }
      if (dropOn === n) throw new Error('network lost');
      return { success: true, http: 200, effective: 200, resultPath: target, changes };
    }
  };
}

/** Check, then write what the check approved - as the panel does. */
async function run(content, grid, opts = {}) {
  const client = fakeAem(content, opts);
  const lines = [];
  const report = (level, message, data) => lines.push(level === 'data' ? { message, data } : `${level}: ${message}`);
  const params = { page: PAGE, sheet: JSON.stringify(grid), sections: null };
  let error = null;
  try {
    const chk = await actions.check({ client, settings: {}, report, params });
    await actions.apply({ client, settings: {}, report, params: { ...params, sections: chk.selected, approved: chk.approved } });
  } catch (e) {
    error = e.message;
  }
  return { client, lines, error };
}

/* The parts of DSY's own .xlsx, and a zip of them again: stored, as DSY writes it. */
function unzip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset);
  const out = [];
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    const size = v.getUint32(at + 18, true);
    const nl = v.getUint16(at + 26, true);
    const xl = v.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nl));
    out.push([name, new TextDecoder().decode(bytes.subarray(at + 30 + nl + xl, at + 30 + nl + xl + size))]);
    at += 30 + nl + xl + size;
  }
  return out;
}
function zip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let off = 0;
  for (const [n, t] of files) {
    const nb = enc.encode(n);
    const d = enc.encode(t);
    const crc = zlib.crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, d.length, true);
    h.setUint32(22, d.length, true);
    h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, d);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, d.length, true);
    c.setUint32(24, d.length, true);
    c.setUint16(28, nb.length, true);
    c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + d.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const x of all) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}

console.log('');
console.log('--- copy deck: the round trip ---');
{
  const content = JSON.parse(readFileSync(`${DATA}/src.json`, 'utf8'));
  const sheet = C.buildSheet(C.extractCopyDeck(content, { pagePath: SRC_PAGE }).rows, { pagePath: SRC_PAGE, exportedAt: '2026-11-03 10:00' });
  const same = translated(sheet, (src) => src);
  for (const [how, grid] of [
    ['pasted', C.gridFromText(C.toTsv(sheet))],
    ['saved as CSV', C.gridFromText(C.toCsv(sheet))],
    ['saved as .xlsx', await X.readXlsx(X.toXlsx(sheet, { pagePath: SRC_PAGE }))],
    ['pasted, translation the same as the source', C.gridFromText(C.toTsv(same))],
    ['saved as .xlsx, translation the same as the source', await X.readXlsx(X.toXlsx(same, { pagePath: SRC_PAGE }))]
  ]) {
    const p = plan(content, grid, '/content/samsung/fr/x');
    check(!p.problem && p.writes.length === 0 && !p.counts.invalid, `an unchanged page ${how} writes nothing`, p.problem || `${p.writes.length} writes, ${p.counts.invalid} invalid`);
  }
  const guide = unzip(X.toXlsx(sheet, { pagePath: SRC_PAGE, exportedAt: '2026-11-03 10:00' })).find(([n]) => n === 'xl/worksheets/sheet2.xml')[1];
  check(guide.includes('Exported: 2026-11-03 10:00'), 'the "How to translate" tab says when it was exported');
}

console.log('');
console.log('--- copy deck: a Translation column out of line (1) ---');
{
  const content = page();
  const g = gridOf(exported(content));
  // Every translation one row low: the last lands on the #END row.
  for (let i = g.length - 1; i >= 2; i--) g[i][6] = `FR ${g[i - 1][5]}`;
  g[1][6] = '';
  const p = plan(content, g);
  check(/Row \d+ has a translation but is the #END row/.test(p.problem || ''), 'a translation on the #END row refuses the sheet', p.problem || `${p.writes?.length} writes`);
  const k = gridOf(exported(content));
  k.splice(3, 0, ['', '', '', '', '', '', 'Titre perdu']);
  check(/has a translation but no Key/.test(plan(content, k).problem || ''), 'a translation on a row with no Key refuses the sheet');
  const bare = plan(content, gridOf(translated(exported(content), (src) => (src.startsWith('<p>Rich') ? 'Riche téléphones ici' : ''))));
  check(rowOf(bare, RICH)?.status === 'invalid' && /Every tag of the source is gone/.test(rowOf(bare, RICH).message), 'rich text with every tag gone is blocked, not warned', rowOf(bare, RICH)?.status);
  check(!bare.writes.length, 'and nothing is written for it');
}

console.log('');
console.log('--- copy deck: quotes and the export\'s apostrophe (2) ---');
{
  const content = page();
  const cases = {
    'He said "hi"': 'He said "hi"',
    '"': '"',
    '"Quote"\nmore': '"Quote"\r\nmore',
    '-': '-',
    '=SUM': '=SUM',
    "'Allo": "'Allo"
  };
  for (const [typed, want] of Object.entries(cases)) {
    const p = plan(content, C.gridFromText(C.toTsv(translated(exported(content), onlyHeadline(typed)))));
    const got = p.writes?.find((w) => w.prop === 'headlineText')?.to;
    check(got === want, `${JSON.stringify(typed)} pasted comes back as typed`, `got ${JSON.stringify(got)}`);
  }
  // A cell Excel hands over bare, starting with a quote: a testimonial keeps its quotes.
  const g = gridOf(exported(content));
  const at = g.findIndex((r) => r[3] === HEAD);
  g[at][6] = '"Great phone"';
  const text = g.map((r) => r.join('\t')).join('\r\n');
  const p = plan(content, C.gridFromText(text));
  check(p.writes?.find((w) => w.prop === 'headlineText')?.to === '"Great phone"', 'a bare "quoted" cell keeps its quotes');
}

console.log('');
console.log('--- copy deck: translations that show nothing, or cannot be stored (3, 12) ---');
{
  const content = page();
  for (const [name, t] of Object.entries({ 'zero-width space': '\u200B', 'direction mark': '\u200F', joiners: '\u200D\u200C', 'no-break space': '\u00A0', BOM: '\uFEFF' })) {
    const p = plan(content, gridOf(translated(exported(content), onlyHeadline(t))));
    check(rowOf(p, HEAD)?.status === 'untranslated' && !p.writes.length, `a ${name} alone is not a translation`, rowOf(p, HEAD)?.status);
  }
  for (const [name, t] of Object.entries({ 'vertical tab': 'Grand\u000Btitre', NUL: 'Grand titre\u0000', 'lone surrogate': 'Titre \ud83d' })) {
    const p = plan(content, gridOf(translated(exported(content), onlyHeadline(t))));
    check(rowOf(p, HEAD)?.status === 'invalid' && !p.writes.length, `a ${name} is refused before writing`, rowOf(p, HEAD)?.status);
  }
  check(!!plan(content, gridOf(translated(exported(content), onlyHeadline('📱👍🏽')))).writes.length, 'a whole emoji is written');
  const { client, error } = await run(content, gridOf(translated(exported(content), onlyHeadline('\u200B'))));
  check(!!error && client.posts.length === 0 && client.live.root.tb.headlineText === 'Great headline', 'an invisible translation never reaches AEM');
}

console.log('');
console.log('--- copy deck: a workbook whose Translation cells are numbers (4) ---');
{
  const content = page({ headlineText: 'Up to 50% off', subHeadlineText: 'From 1/2 price', textForLinkAction2: 'Shop _x0041_ now' });
  const s = exported(content);
  const files = unzip(X.toXlsx(s, {}));
  const at = (src) => s.records.findIndex((r) => r[5] === src) + 2;
  const patch = (cells) =>
    zip(
      files.map(([n, t]) => {
        if (n !== 'xl/worksheets/sheet1.xml') return [n, t];
        let out = t;
        for (const [src, cell] of cells) {
          const r = at(src);
          const re = new RegExp(`<c r="G${r}"[^>]*/>`);
          if (!re.test(out)) throw new Error(`no empty G${r} to patch`);
          out = out.replace(re, cell.replace(/REF/g, `G${r}`));
        }
        return [n, out];
      })
    );
  for (const [name, cell, says] of [
    ['a percentage', '<c r="REF"><v>0.5</v></c>', 'a number (stored as 0.5)'],
    ['a date', '<c r="REF" s="0"><v>45293</v></c>', 'a number (stored as 45293)'],
    ['TRUE', '<c r="REF" t="b"><v>1</v></c>', 'TRUE or FALSE']
  ]) {
    let said = null;
    try {
      await X.readXlsx(patch([['Up to 50% off', cell]]));
    } catch (e) {
      said = e.message;
    }
    check(said?.includes(`Cell G${at('Up to 50% off')} in the Translation column holds ${says}`), `${name} in a Translation cell is refused, the cell named`, said);
  }
  const grid = await X.readXlsx(patch([['Shop _x0041_ now', '<c r="REF" t="inlineStr"><is><t>Acheter maintenant</t></is></c>']]));
  check(!!grid.length, 'a text cell is read as ever');
  const back = plan(content, await X.readXlsx(X.toXlsx(translated(s, (src) => src), {})));
  check(back.writes.length === 0, 'text that reads like an Excel escape (_x0041_) comes back as it was', JSON.stringify(back.writes?.map((w) => w.to)));
}

console.log('');
console.log('--- copy deck: a write that stops part-way (5, 6) ---');
{
  // Six texts of 30,000 characters: two requests, under Excel's cell limit.
  const props = ['headlineText', 'subHeadlineText', 'description1', 'description2', 'description3', 'disclaimer1'];
  const content = page(Object.fromEntries(props.map((p) => [p, `${p} ${'x'.repeat(30000)}`])));
  content['cq:lastModified'] = 'Mon Oct 27 2025 10:12:32 GMT+0000';
  content['cq:lastModifiedBy'] = 'someone';
  const grid = gridOf(translated(exported(content), (src) => (src.length > 1000 ? `FR ${src}` : '')));
  const asWas = (c) => props.every((p) => c.live.root.tb[p] === content.root.tb[p]);
  const stamp = (c) => [c.live['cq:lastModified'], c.live['cq:lastModifiedBy']].join(' / ');

  const ok = await run(content, grid);
  check(!ok.error && ok.client.posts.length === 2 && props.every((p) => ok.client.live.root.tb[p].startsWith('FR ')), 'an ordinary run writes all six, in two requests', ok.error);
  check(ok.client.posts.at(-1).includes('./cq:lastModified') && !ok.client.posts[0].includes('./cq:lastModified'), 'the page is stamped by the last request, not the first');

  const refused = await run(content, grid, { failOn: 2 });
  check(asWas(refused.client), 'a request refused after one was saved: every text is put back');
  check(stamp(refused.client) === 'Mon Oct 27 2025 10:12:32 GMT+0000 / someone', 'and the page keeps its last-modified stamp', stamp(refused.client));
  check(/the page is as it was/.test(refused.error || ''), 'and it says the page is as it was', refused.error);

  const lost = await run(content, grid, { dropOn: 2 });
  check(asWas(lost.client), 'the connection lost after AEM saved the last request: its texts are put back too', props.map((p) => lost.client.live.root.tb[p].slice(0, 3)).join(','));
  check(/no answer to request 2 of 2/.test(lost.error || '') && /last-modified date and user now show this attempt/.test(lost.error || ''), 'and it says the stamp moved, not that nothing changed', lost.error);

  const first = await run(content, grid, { dropOn: 1 });
  check(asWas(first.client) && !/Nothing was saved/.test(first.error || ''), 'the first request unanswered is put back, not called unsaved', first.error);

  const steps = ok.lines.filter((l) => l.message === 'step').map((l) => l.data.id);
  check(['recheck', 'lock', 'write', 'verify'].every((id) => steps.includes(id)), 'the worker reports the steps the screen lists', steps.join(','));
}

console.log('');
console.log('--- copy deck: the file chosen is not a sheet (8) ---');
{
  const enc = new TextEncoder();
  const tsv = C.toTsv(translated(exported(page()), onlyHeadline('Grand titre')));
  const u16 = new Uint8Array([0xff, 0xfe, ...[...tsv].flatMap((ch) => [ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8])]);
  for (const [name, bytes, says] of [
    ['an empty file', new Uint8Array(0), /is empty/],
    ['a legacy .xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...enc.encode('garbage')]), /older Excel file \(\.xls\)/],
    ['DRM after a BOM', enc.encode('\uFEFF<## NASCA DRM FILE - VER1.00 ##>junk'), /corporate DRM/],
    ['DRM in lower case', enc.encode('<## nasca drm file ##>junk'), /corporate DRM/],
    ['binary', new Uint8Array([1, 2, 3, 0, 0, 5, 200, 201, 202, 0, 7]), /binary data|not text saved as UTF-8/],
    ['text in another encoding', new Uint8Array([0x4b, 0x65, 0x79, 0x09, 0xe9, 0xe8, 0x0a]), /not text saved as UTF-8/]
  ]) {
    const got = C.sheetFile(bytes, 'deck.x');
    check(says.test(got.problem || ''), `${name} is named as that`, got.problem || JSON.stringify(Object.keys(got)));
  }
  check(C.isDrmProtected(enc.encode('<## NASCA DRM FILE - VER1.00 ##>')), 'isDrmProtected still knows the header as it was');
  const unicode = C.sheetFile(u16, 'deck.txt');
  check(unicode.text && C.readSheet(C.gridFromText(unicode.text)).ok, "Excel's Unicode Text is read as the sheet it is");
  check(C.sheetFile(X.toXlsx(exported(page()), {}), 'deck.xlsx').xlsx === true, 'a workbook is a workbook');
}

console.log('');
console.log('--- copy deck: one text too long for a cell (9) ---');
{
  const content = page({ disclaimer1: `<p>${'Terms apply. '.repeat(2600)}</p>` });
  const s = exported(content);
  check(s.tooLong.length === 1 && s.tooLong[0].key === 'root/tb@disclaimer1', 'it is left off the sheet and named', JSON.stringify(s.tooLong));
  let threw = null;
  for (const f of [() => X.toXlsx(s), () => C.toCsv(s), () => C.toTsv(s), () => C.toHtmlTable(s)]) {
    try {
      f();
    } catch (e) {
      threw = e.message;
    }
  }
  check(!threw, 'and the rest of the sheet is saved', threw);
  const p = plan(content, gridOf(s));
  check(!p.problem && !p.warnings.some((w) => /rows, but/.test(w)), 'the import does not call the sheet short for it', p.problem || p.warnings.join(' '));
}

console.log('');
console.log('--- copy deck: the same text, stored differently (10) ---');
{
  for (const [name, stored, typed] of [
    ['a double space', 'Galaxy  S24 Ultra', 'Galaxy S24 Ultra'],
    ['a decomposed accent', 'Café offers', 'Café offers']
  ]) {
    const content = page({ headlineText: stored });
    const p = plan(content, gridOf(translated(exported(content), (src) => (src === stored ? typed : ''))));
    check(rowOf(p, HEAD)?.status === 'same' && !p.writes.length, `${name} on the page: the source typed again is "same", not a write`, rowOf(p, HEAD)?.status);
  }
}

console.log('');
console.log('--- copy deck: attributes in translated rich text (11) ---');
{
  const content = page();
  const of = (t) => rowOf(plan(content, gridOf(translated(exported(content), (src) => (src.startsWith('<p>Rich') ? t : '')))), RICH);
  const styled = of('<p>Riche <a href="/uk/smartphones/" style="position:fixed;top:0">téléphones</a> ici</p>');
  check(styled.status === 'ready' && styled.warnings.some((w) => /Attributes added or changed: <a style="position:fixed/.test(w)), 'an added style is warned about', styled.warnings.join(' | '));
  const img = of('<p>Riche <a href="/uk/smartphones/">téléphones</a> ici<img src="https://evil.example/t.gif"></p>');
  check(img.warnings.some((w) => /<img src="https:\/\/evil\.example/.test(w)), 'an image from another site is warned about', img.warnings.join(' | '));
  for (const t of ['<p>Riche <a href="data:text/html;base64,PHNjcmlwdD4=">téléphones</a> ici</p>', '<p>Riche <a href="/uk/smartphones/">t</a><img src=" data:image/svg+xml,x"></p>', '<p>Riche <a href="da&#116;a:text/html,x">t</a></p>']) {
    check(of(t).status === 'invalid' && /data: address/.test(of(t).message), `a data: link is refused: ${t.slice(10, 50)}`, of(t).status);
  }
  const plain = of('<p>Riche <a href="/uk/smartphones/">téléphones</a> ici</p>');
  check(plain.status === 'ready' && !plain.warnings.length, 'a translation keeping the tags as they were has nothing to say');
}

console.log('');
console.log('--- copy deck: words that match what happens (13) ---');
{
  const content = page();
  const g = gridOf(translated(exported(content), onlyHeadline('Grand titre')));
  const at = g.findIndex((r) => r[3] === HEAD);
  g[at][4] = g[at][4].toUpperCase();
  const upper = rowOf(plan(content, g), HEAD);
  check(upper.status === 'invalid' && /Check cell of this row was edited/.test(upper.message), 'an upper-cased Check cell is said to be edited', upper.message);

  const d = gridOf(exported(content));
  const i = d.findIndex((r) => r[3] === HEAD);
  d.splice(i + 1, 0, [...d[i].slice(0, 6), 'Grand titre']);
  const p = plan(content, d);
  const dup = p.rows.find((r) => r.status === 'duplicate');
  check(p.writes.some((w) => w.to === 'Grand titre') && /translation is written there instead/.test(dup?.message || ''), "a repeat whose translation is used says so", dup?.message);
  const e = gridOf(exported(content));
  const j = e.findIndex((r) => r[3] === HEAD);
  e[j][6] = 'Titre un';
  e.splice(j + 1, 0, [...e[j].slice(0, 6), 'Titre deux']);
  const dup2 = plan(content, e).rows.find((r) => r.status === 'duplicate');
  check(/only that row is used/.test(dup2?.message || ''), 'a repeat whose translation is not used says that', dup2?.message);
}

console.log('');
console.log('--- copy deck: the client copy and short file names ---');
{
  const at = new Date(2026, 10, 24, 14, 52);
  check(
    C.fileName('/content/samsung/levant/india/backup/home-appliances/buying-guide', at) === 'levant_buying-guide_261124-1452.xlsx',
    'a file is named by site, the page and when',
    C.fileName('/content/samsung/levant/india/backup/home-appliances/buying-guide', at)
  );
  check(C.fileName('/content/samsung/levant/india/backup/home-appliances/buying-guide', at, 'xlsx', { client: true }) === 'levant_buying-guide_261124-1452_client.xlsx', "the client's copy ends in _client");
  check(C.fileName('/content/samsung/uk', at, 'csv') === 'uk_home_261124-1452.csv', 'a site home page is "home"');

  const content = page();
  const sheet = exported(content);
  const client = C.clientSheet(sheet);
  check(client.columns.join('|') === 'Source text|Translation', 'the client copy has only Source text and Translation');
  check(
    client.records.length === sheet.records.length - 1 && client.records.every((r, i) => r[0] === sheet.records[i][5] && r[1] === ''),
    'its rows are the full sheet\'s, in order, with no #END row'
  );

  const bytes = X.toClientXlsx(client, { modified: at });
  const parts = unzip(bytes);
  check(parts.filter(([n]) => n.startsWith('xl/worksheets/')).length === 1, 'the client workbook has one sheet');
  const back = await X.readXlsx(bytes);
  check(back.length === client.records.length + 1 && back[1][0] === client.records[0][0], 'it reads back cell for cell', JSON.stringify(back[1]));

  const alone = C.readSheet(back);
  check(!alone.ok && /client's copy/.test(alone.problem), "importing the client copy on its own says what to do instead", alone.problem);

  // The client fills Translation; its column is pasted into the full sheet, row for row.
  const filled = back.map((r, i) => (i === 0 ? r : [r[0], r[0] === 'Great headline' ? 'Grand titre' : '']));
  const full = gridOf(sheet);
  filled.slice(1).forEach((r, i) => (full[i + 1][6] = r[1]));
  const p = plan(content, full);
  check(p.writes?.some((w) => w.to === 'Grand titre' && rowOf(p, HEAD)), 'the full sheet with the pasted column imports', p.problem);
}

if (failed) {
  console.log(`\ncopy deck: ${failed} FAILED`);
  process.exitCode = 1;
} else {
  console.log('\ncopy deck: all passed');
}
