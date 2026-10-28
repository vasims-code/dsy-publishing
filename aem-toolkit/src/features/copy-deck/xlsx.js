/**
 * The copy deck as an Excel workbook - the file that goes to translators.
 *
 * A CSV cannot carry a column width, a wrapped cell or a frozen header, and it
 * opens in one column wherever Windows lists with ';' (most of Europe). An
 * .xlsx carries all of that, opens the same in every locale, and marks every
 * cell as text, so Excel never turns "1/2" into a date - including in what the
 * translator types, because the columns themselves are text-formatted.
 *
 * Written from scratch rather than with a library: a workbook is a zip of a few
 * XML files, and a stored (uncompressed) zip is a CRC and three headers. No
 * dependency to vendor into two extensions, nothing fetched at runtime.
 *
 * spub-swiss-army-knife had a copy (spub_modular/copydeck/xlsx.js) from before
 * the product page (PD) sheet; the PD guide on the second tab is built here only.
 *
 * Pure: no DOM, no chrome.* - returns the file's bytes.
 */

import { assertCellsFit, columnLetter } from './core.js';

/* ----------------------------------------------------------------- layout */

/**
 * How each column looks, by header. Widths are Excel character units. The
 * translator's column is tinted, the columns they must not touch are grey.
 */
/* Section to Check are hidden, not removed: the import needs them, and a
 * column nobody sees is a column nobody edits. Unhide them in Excel to read them. */
const COLUMN_LOOK = {
  Section: { width: 30, style: 'body', hidden: true },
  Field: { width: 26, style: 'body', hidden: true },
  Notes: { width: 34, style: 'note', hidden: true },
  'Key (do not edit)': { width: 16, style: 'key', hidden: true },
  'Check (do not edit)': { width: 11, style: 'key', hidden: true },
  'Source text': { width: 60, style: 'source' },
  Translation: { width: 60, style: 'input' }
};
const DEFAULT_LOOK = { width: 20, style: 'body' };

/* Style ids - positions in cellXfs below. */
const XF = { default: 0, header: 1, body: 2, note: 3, key: 4, source: 5, input: 6, end: 7, title: 8, text: 9, label: 10 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><color rgb="FF1428A0"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1428A0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF7D6"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD9DDE3"/></left><right style="thin"><color rgb="FFD9DDE3"/></right><top style="thin"><color rgb="FFD9DDE3"/></top><bottom style="thin"><color rgb="FFD9DDE3"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1" applyProtection="1"><alignment vertical="top" wrapText="1"/><protection locked="0"/></xf>
<xf numFmtId="49" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="49" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="49" fontId="5" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/* ------------------------------------------------------------ the workbook */

/**
 * `sheet` is what buildSheet returns: { columns, records }, the last record
 * being the closing #meta row. Returns the .xlsx file as bytes.
 */
export function toXlsx(sheet, { pagePath = '', exportedAt = '', modified = new Date(), pd = false } = {}) {
  // A cell longer than Excel's limit: refused, in the words the CSV and the clipboard use too.
  assertCellsFit(sheet);
  const looks = sheet.columns.map((c) => COLUMN_LOOK[c] || DEFAULT_LOOK);
  const last = sheet.records.length; // index of the closing row among records
  const rows = [
    row(1, sheet.columns.map(() => XF.header), sheet.columns),
    ...sheet.records.map((rec, i) =>
      row(i + 2, rec.map((_, c) => (i === last - 1 ? XF.end : XF[looks[c].style])), rec)
    )
  ];
  const lastCell = `${colName(sheet.columns.length)}${sheet.records.length + 1}`;
  const deckRef = `A1:${colName(sheet.columns.length)}${sheet.records.length}`; // the #END row is not filtered

  const deck = worksheet({
    // The column default is plain text-format, so a cell typed below the data is
    // still text; the tint and borders belong to the data cells only.
    cols: looks.map((l, i) => `<col min="${i + 1}" max="${i + 1}" width="${l.width}" customWidth="1"${l.hidden ? ' hidden="1"' : ''} style="${XF.text}"/>`),
    rows,
    dimension: `A1:${lastCell}`,
    // Header frozen; the cursor starts in the first Translation cell.
    view: `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${colName(sheet.columns.indexOf('Translation') + 1 || 1)}2" sqref="${colName(sheet.columns.indexOf('Translation') + 1 || 1)}2"/>`,
    after: `<autoFilter ref="${deckRef}"/>`,
    selected: true
  });

  const guideLines = guideRows({ pagePath, exportedAt, count: sheet.records.length - 1, columns: sheet.columns, pd });
  const guide = worksheet({
    cols: ['<col min="1" max="1" width="4" customWidth="1"/>', `<col min="2" max="2" width="110" customWidth="1" style="${XF.text}"/>`],
    rows: guideLines,
    dimension: `A1:B${guideLines.length}`,
    view: '',
    after: '',
    selected: false
  });

  const files = [
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['docProps/app.xml', APP],
    ['xl/workbook.xml', workbook(deckRef)],
    ['xl/_rels/workbook.xml.rels', WORKBOOK_RELS],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', deck],
    ['xl/worksheets/sheet2.xml', guide]
  ];
  return zip(files, modified);
}

/**
 * The second tab: what a translator needs to know, in their words. A product
 * page's sheet (`pd`) has each text once and goes into PIM, so its rules differ;
 * an ordinary page's has static content, with a rule of its own, and two tips.
 */
function guideRows({ pagePath, exportedAt, count, columns, pd = false }) {
  const letter = (name) => colName(columns.indexOf(name) + 1);
  const src = letter('Source text');
  const tr = letter('Translation');
  const steps = pd
    ? [
        `1.  Type each translation in column ${tr} (Translation), next to the source text in column ${src}. Change nothing else.`,
        '2.  Each text is on the sheet once, even where the page shows it in several places. One translation covers them all.',
        '3.  Keep anything in curly brackets exactly as written - {size} - the website fills it in.',
        '4.  A line break inside a cell (Alt+Enter) can stay where it is or move to where the sentence breaks best.',
        '5.  The Notes column says where a text is used: its PIM feature, a footnote it carries, other sections that show it.',
        `6.  Columns ${letter('Section')} to ${letter('Check (do not edit)')} are hidden: they tell DSY where each text goes. To read the Field or Notes, unhide them (right-click the column letters, Unhide), but do not edit them. Do not delete, add or re-sort rows, and keep the last row (#END).`,
        '7.  Save the file as an Excel Workbook (.xlsx) and send it back. The translations are entered in PIM.'
      ]
    : [
        `1.  Type each translation in column ${tr} (Translation), next to the source text in column ${src}. Change nothing else.`,
        '2.  Some texts are HTML, as the website stores them - <a href="…" title="…">…</a>, <img alt="…">, <sup>1</sup>, <br>, &nbsp;. Translate the words, including the words in a title="…" or alt="…", and keep every tag complete and in the right place. Rows marked "Static content" have a rule of their own (6).',
        '3.  A line break inside a cell (Alt+Enter) can stay where it is or move to where the sentence breaks best.',
        '4.  Each text is on the sheet once, even where the page shows it in several places - the Field column lists them, and "Used in N places" in Notes says so. One translation covers them all.',
        '5.  "Length" in Notes is the limit the page is designed for, such as "up to 30 characters and 2 lines". Keep the translation within it where you can.',
        '6.  Rows marked "Static content" are put on the page by hand, by the web team or a developer. Keep every tag: you may move a tag to suit your word order, but not into or out of another tag. A <br> may move or go, but never be added. Do not change link addresses - the page keeps its own. A tag shows only its link and class: a title or alt text inside it has a row of its own.',
        '7.  "Not shown on the page" rows are included only on request. Translate them too.',
        `8.  Columns ${letter('Section')} to ${letter('Check (do not edit)')} are hidden: they tell DSY where each text goes. To read the Field or Notes, unhide them (right-click the column letters, Unhide), but do not edit them. Do not delete, add or re-sort rows, and keep the last row (#END).`,
        '9.  Save the file as an Excel Workbook (.xlsx) and send it back.'
      ];
  const tips = pd
    ? []
    : [
        'In an Arabic cell Excel shows tags in a confusing order; check them in the formula bar.',
        "Write numbers and units the way your market writes them. The English writes them its own way, such as 55°C and 9,000 m."
      ];
  const lines = [
    [XF.title, 'How to translate this sheet'],
    [XF.text, ''],
    [XF.label, 'What to do'],
    ...steps.map((t) => [XF.text, t]),
    [XF.text, ''],
    ...(tips.length ? [[XF.label, 'Tips'], ...tips.map((t) => [XF.text, t]), [XF.text, '']] : []),
    [XF.label, 'This sheet'],
    [XF.text, `Page: ${pagePath}`],
    ...(pd ? [[XF.text, 'A product page: its text comes from PIM, and the translations go back into PIM.']] : []),
    [XF.text, `Rows: ${count}`],
    [XF.text, `Exported: ${exportedAt}`]
  ];
  return lines.map(([style, text], i) => row(i + 1, [XF.default, style], ['', text]));
}

/* ---------------------------------------------------------------- the XML */

const xmlText = (s) =>
  String(s)
    // Characters XML 1.0 cannot hold at all; Excel refuses the file over one.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A column's name from its number: 1 is "A", 27 is "AA". */
const colName = (n) => (n > 0 ? columnLetter(n - 1) : '');

/**
 * One row. Every value is an inline string, never a number - which, with the
 * text format on every style, is what keeps "0800 123" and "3-5" as typed.
 * Row height is left to Excel, which sizes a row with wrapped text to fit.
 */
function row(r, styles, values) {
  const cells = values
    .map((v, i) => {
      const ref = `${colName(i + 1)}${r}`;
      const text = String(v ?? '');
      if (!text) return `<c r="${ref}" s="${styles[i]}"/>`;
      return `<c r="${ref}" s="${styles[i]}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
    })
    .join('');
  return `<row r="${r}">${cells}</row>`;
}

function worksheet({ cols, rows, dimension, view, after, selected }) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="${dimension}"/>` +
    `<sheetViews><sheetView ${selected ? 'tabSelected="1" ' : ''}workbookViewId="0">${view}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols.join('')}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    after +
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
    '</worksheet>'
  );
}

const workbook = (deckRef) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<bookViews><workbookView activeTab="0"/></bookViews>' +
  '<sheets><sheet name="Copy deck" sheetId="1" r:id="rId1"/><sheet name="How to translate" sheetId="2" r:id="rId2"/></sheets>' +
  `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Copy deck'!${deckRef.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName></definedNames>` +
  '</workbook>';

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
  '</Relationships>';

const WORKBOOK_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

const APP =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Copy deck</Application></Properties>';

/* ------------------------------------------------------------- reading one */

/**
 * The first sheet of a workbook - "Copy deck" if there is one - as rows of
 * cell text. For a translated sheet that comes back as a file: Excel saves it
 * deflate-compressed with shared strings, so both are read here. Async only
 * because inflating is (DecompressionStream, in browsers and Node alike).
 */
export async function readXlsx(bytes) {
  const entries = unzipEntries(bytes);
  const read = async (name) => {
    const e = entries.get(name);
    return e ? new TextDecoder().decode(await inflate(bytes, e)) : null;
  };

  const workbookXml = await read('xl/workbook.xml');
  if (!workbookXml) throw new Error('This is not an Excel workbook (.xlsx).');
  const sheets = [...workbookXml.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: xmlUnescape(attr(m[0], 'name') || ''),
    rid: attr(m[0], 'r:id')
  }));
  const rels = (await read('xl/_rels/workbook.xml.rels')) || '';
  const target = (rid) => {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, 'Id') === rid);
    const t = rel ? attr(rel, 'Target') : null;
    return t ? (t.startsWith('/') ? t.slice(1) : `xl/${t}`) : null;
  };
  const sheet = sheets.find((s) => s.name.toLowerCase() === 'copy deck') || sheets[0];
  const sheetXml = sheet ? await read(target(sheet.rid) || 'xl/worksheets/sheet1.xml') : null;
  if (!sheetXml) throw new Error('The workbook has no sheet to read.');

  const shared = [];
  const sst = await read('xl/sharedStrings.xml');
  if (sst) for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(runText(si[1]));

  const grid = [];
  for (const rm of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(attr(rm[1], 'r')) || grid.length + 1;
    const cells = [];
    let next = 0;
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r');
      const col = ref ? colIndex(ref) : next;
      next = col + 1;
      const type = attr(cm[1], 't');
      const body = cm[2] || '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let text = '';
      if (type === 's') text = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') text = runText(body.match(/<is>([\s\S]*?)<\/is>/)?.[1] || '');
      else if (v !== undefined) text = xmlUnescape(v);
      cells[col] = text;
    }
    grid[r - 1] = Array.from(cells, (c) => c ?? '');
  }
  return Array.from(grid, (r) => r ?? []);
}

/** The text of a string item: every <t>, skipping phonetic guides (<rPh>). */
function runText(xml) {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)]
    .map((m) => xmlUnescape(m[1] || ''))
    .join('');
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`));
  return m ? m[1] : null;
}

/** XML entities, and Excel's own _xHHHH_ escapes for characters XML cannot hold. */
function xmlUnescape(s) {
  return s
    .replace(/&(lt|gt|quot|apos|amp|#\d+|#x[\da-f]+);/gi, (m, e) => {
      const named = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e.toLowerCase()];
      if (named) return named;
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .replace(/_x([\da-fA-F]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

function colIndex(ref) {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/i)[0].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** name -> where its data is, from the zip's central directory. */
function unzipEntries(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('This is not an Excel workbook (.xlsx) - no zip directory found.');
  const entries = new Map();
  let at = v.getUint32(end + 16, true);
  for (let i = 0, count = v.getUint16(end + 10, true); i < count; i++) {
    const method = v.getUint16(at + 10, true);
    const size = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    entries.set(name, { method, start, size });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflate(bytes, { method, start, size }) {
  const data = bytes.subarray(start, start + size);
  if (method === 0) return data;
  if (method !== 8) throw new Error(`Unsupported compression in the workbook (method ${method}).`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ----------------------------------------------------------------- the zip */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A stored zip: every entry as-is, which every Office reader accepts. */
function zip(files, modified) {
  const enc = new TextEncoder();
  const d = modified instanceof Date && !Number.isNaN(+modified) ? modified : new Date(1980, 0, 1);
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), nameBytes, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, dosTime, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
