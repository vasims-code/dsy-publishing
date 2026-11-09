/**
 * Arabic BiDi flipping, found and fixed - the Flipping Converter, whole.
 *
 * In Arabic text, an English or numeric run - 1-120Hz, (2520 × 1080),
 * Wi-Fi 7¹, 1,299 SAR - is laid out by the browser's BiDi rules, which move
 * its digits, brackets and % to the wrong side. An LRM where the run begins
 * (and where it ends, when it ends on something neutral) keeps it whole.
 *
 * Two converters, as the Flipping Converter has them:
 *   - Static (convert): text or HTML, its runs found by the rules below. The
 *     page scan runs it with the defaults - invisible characters, and only on
 *     the side of a run that would flip ("Fewest marks"). Pasted text can
 *     also have every side marked, an RLM at each line start or after the
 *     last run, or &lrm; entities for an HTML source view.
 *   - PDP (convertPdp): specifications, where every value with a number is
 *     wrapped as &lrm;value&lrm;.
 * Both can first turn commas into full stops (commasToDots).
 *
 * Every mark already in the text, real or broken by an encoding accident, is
 * taken out first, so running it again over fixed text changes nothing.
 *
 * Pure - no network, no DOM - so the worker, the panel and a test all share
 * the same rules, and the review can never list a fix the write would not make.
 */

export const LRM = '\u200E';
export const RLM = '\u200F';

/**
 * The lists Settings holds, under "Arabic flipping fixer": the units a number
 * can carry, and the English feature names that stand on their own in Arabic
 * copy. These are what Settings starts with, and what an empty box means.
 */
export const DEFAULT_UNITS = [
  'mAh', 'Wh', 'GB', 'TB', 'MB', 'KB', 'ATM', 'GHz', 'MHz', 'kHz', 'Hz', 'W', 'nits',
  'Gbps', 'Mbps', 'fps', 'MP', 'mm', 'cm', 'kg', 'g', 'ms', 'mph', 'km'
];
export const DEFAULT_NAMES = [
  'Now Brief', 'Now Bar', 'Call Assist', 'Audio Eraser', 'Live Translate', 'Note Assist', 'Photo Assist',
  'Transcript Assist', 'Browsing Assist', 'Writing Assist', 'Chat Assist', 'Drawing Assist', 'Circle to Search',
  'Generative Edit', 'Sketch to Image', 'Interpreter', 'Galaxy AI', 'Gemini', 'Bixby'
];

/** A comma-separated list as Settings holds one: trimmed, no blanks, each once. */
export function parseList(value) {
  const items = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(items.map((s) => String(s).trim()).filter(Boolean))];
}

const SUP = '[¹²³⁴⁵⁶⁷⁸⁹⁰*]*';
const SP = '[ \\u00A0]';
const NUM = '\\d+(?:[.,]\\d+)*';
const START = '(?<![A-Za-z0-9.])';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* Longest first, so "GHz" is tried before "g". Nothing listed matches nothing. */
const alternation = (list) => (list.length ? [...list].sort((a, b) => b.length - a.length).map(esc).join('|') : '(?!)');

/* English and numeric runs that flip inside Arabic text. When matches
   overlap, the longest wins; on a tie, the earlier rule. */
const buildRules = (units, names) => {
  const UNIT = `${SP}?(?:${alternation(units)})(?![A-Za-z])`;
  return [
    // Trademarked chipset & material strings
    /Qualcomm®? Snapdragon[®™]? \d+(?: Elite| Gen \d+)(?: Mobile Platform)?(?: for Galaxy)?/g,
    /Corning® Gorilla® (?:Armor\d*|Glass Victus®\+?)/g,
    /(?:Advanced )?Arm(?:o|ou)r Aluminium(?: \d+)?/g,
    /Armor FlexHinge/g,

    // Display tech
    /Dynamic AMOLED \d+X/g,
    /\b(?:QHD\+|FHD\+|HD\+|4K|8K)(?![A-Za-z0-9])/g,

    // Dimensions & resolutions:  (2520 × 1080) | 143.2 × 158.4 × 4.2 mm | 4x5
    new RegExp(`\\(\\s*\\d+(?:\\.\\d+)?(?:\\s*[×x]\\s*\\d+(?:\\.\\d+)?)+(?:${UNIT})?\\s*\\)`, 'g'),
    new RegExp(`${START}\\d+(?:\\.\\d+)?(?:\\s*[×x]\\s*\\d+(?:\\.\\d+)?)+(?:${UNIT})?${SUP}`, 'g'),

    // Ranges, optionally with a unit or %:  1-120Hz | 10 – 20 % | 2024-2025
    new RegExp(`${START}${NUM}${SP}?[-–]${SP}?${NUM}(?:${UNIT}|${SP}?%)?${SUP}`, 'gi'),

    // Values joined by "/", ending in a unit:  256/512 GB | 128/256/512 GB | 8 GB/12 GB
    // One run - a mark between them would show 256/512 GB as 512 GB/256.
    new RegExp(`${START}${NUM}(?:${UNIT})?(?:${SP}?\\/${SP}?${NUM}(?:${UNIT})?)*${SP}?\\/${SP}?${NUM}${UNIT}${SUP}`, 'gi'),

    // Value + unit (+ optional superscript footnote)
    new RegExp(`${START}${NUM}${UNIT}${SUP}`, 'gi'),

    // Percentages (keeps any space the author typed)
    new RegExp(`${START}[+-]?${NUM}${SP}?%${SUP}`, 'g'),

    // Multipliers: 2x | 100x
    new RegExp(`${START}\\d+(?:\\.\\d+)?[x×](?![A-Za-z0-9])${SUP}`, 'g'),

    // Number followed by an English word: 1,299 SAR | 8 Elite | 3 Pro
    new RegExp(`${START}${NUM}${SP}?[A-Za-z]+(?:${SP}[A-Za-z]+)*${SUP}`, 'g'),

    // Ratings
    /\bIP\d{2}\b/g,

    // Model names ending in +
    /\bGalaxy [A-Za-z0-9 ]*\d+\+/g,
    /\b[A-Z][A-Za-z]*\d+\+/g,

    // English text inside parentheses: (RAM) | (AI) | (Game Mode)
    /\((?=[^)]*[A-Za-z])[A-Za-z0-9 .,&+\-\/®™]+\)/g,

    // Standalone English feature names
    new RegExp(`\\b(?:${alternation(names)})[¹²³⁴⁵⁶⁷⁸⁹⁰*]*`, 'g'),

    // microSD
    /\bmicroSD\b/g,

    // Any English word chain ending in ®, ™, + or a footnote: Samsung Health™ | Wi-Fi 7¹
    /(?<![A-Za-z0-9])[A-Za-z0-9](?:[A-Za-z0-9.\-]|[ \u00A0](?=[A-Za-z0-9]))*(?:[®™+]|[¹²³⁴⁵⁶⁷⁸⁹⁰])+/g
  ];
};

const cache = new Map();

/**
 * The rules, built from Settings: `arabicUnits` and `arabicNames`, each a
 * comma-separated list. One that is empty or missing is the built-in list.
 * Built once per pair of lists, so the worker and the panel - handed the same
 * settings - always run exactly the same rules.
 */
export function rulesFor(settings) {
  const units = parseList(settings?.arabicUnits);
  const names = parseList(settings?.arabicNames);
  const u = units.length ? units : DEFAULT_UNITS;
  const n = names.length ? names : DEFAULT_NAMES;
  const key = `${u.join('|')}\n${n.join('|')}`;
  if (!cache.has(key)) cache.set(key, buildRules(u, n));
  return cache.get(key);
}

const DEFAULT_RULES = rulesFor(null);

/** Arabic letters, in any of Unicode's Arabic blocks. A value without one is never touched. */
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
export const hasArabic = (s) => typeof s === 'string' && ARABIC.test(s);

// Invisible direction controls, taken out before our own marks go in.
const CONTROL_CHARS = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069\u200B\uFEFF]/g;

// What those controls look like after an encoding accident or HTML escaping.
const BROKEN_MARKS = [
  /â€[Ž\u008F\u008B‹ª«¬\u00AD®]/g, // UTF-8 bytes read as Windows-1252
  /â\u0081[¦§¨©]/g,
  /Øœ/g,
  /ï»¿/g,
  /&(?:lrm|rlm|zwsp);/gi,
  /&#(?:8206|8207|1564|820[2-6]|823[0-3]|8203|65279);/g,
  /&#x0*(?:200[BEF]|61C|202[A-E]|206[6-9]|FEFF);/gi
];

/** Every mark (real, escaped or broken) taken out, and how many there were. */
export function stripMarks(s) {
  let removed = 0;
  let out = String(s);
  for (const re of BROKEN_MARKS) {
    out = out.replace(re, () => {
      removed++;
      return '';
    });
  }
  const before = out.length;
  out = out.replace(CONTROL_CHARS, '');
  removed += before - out.length;
  return { text: out, removed };
}

export const removeMarks = (s) => stripMarks(s).text;

/** The runs to protect: [[start, end], ...], sorted, not overlapping, touching ones merged. */
function findRuns(view, rules) {
  const candidates = [];
  rules.forEach((re, priority) => {
    re.lastIndex = 0;
    for (const m of view.matchAll(re)) {
      if (m[0]) candidates.push({ start: m.index, end: m.index + m[0].length, priority });
    }
  });
  candidates.sort((a, b) => b.end - b.start - (a.end - a.start) || a.priority - b.priority || a.start - b.start);

  const taken = new Uint8Array(view.length);
  const runs = [];
  for (const c of candidates) {
    let free = true;
    for (let i = c.start; i < c.end; i++) {
      if (taken[i]) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    taken.fill(1, c.start, c.end);
    runs.push([c.start, c.end]);
  }
  runs.sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last[1] === r[0]) last[1] = r[1];
    else merged.push(r);
  }
  return merged;
}

/** Entities are opaque to the rules, except &nbsp;, which counts as a space. */
function buildView(chunk, isHtml) {
  if (!isHtml) {
    const pos = Array.from({ length: chunk.length + 1 }, (_, i) => i);
    return { view: chunk, pos };
  }
  let view = '';
  const pos = [];
  const re = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;
  let i = 0;
  for (const m of chunk.matchAll(re)) {
    for (; i < m.index; i++) {
      view += chunk[i];
      pos.push(i);
    }
    view += /^&(?:nbsp|#160|#xa0);$/i.test(m[0]) ? '\u00A0' : '\uFFFC';
    pos.push(m.index);
    i = m.index + m[0].length;
  }
  for (; i < chunk.length; i++) {
    view += chunk[i];
    pos.push(i);
  }
  pos.push(chunk.length);
  return { view, pos };
}

/**
 * The runs in a text that need a mark, each with where its marks go:
 * { start, end, lead, trail, period, closer }. `lead` is an LRM at the start;
 * `trail` an LRM at the end, with an RLM after a full stop that follows
 * (`period`); `closer` an RLM at the end of the last run ("RLM closer").
 *
 * With `minimal` ("Fewest marks", the default) a side that already reads
 * LTR gets no mark; without it, both sides of every run do.
 */
function planFor(view, rules, { minimal = true, rlmCloser = false } = {}) {
  const plan = [];
  const runs = findRuns(view, rules);
  runs.forEach(([start, end], k) => {
    const text = view.slice(start, end);
    /* A run that starts with a Latin letter is already LTR at its start;
       one that ends in a letter, a digit or digit+% already ends LTR.
       Those sides need no mark - every one skipped is one less invisible
       character to break an exact search in Excel. */
    const lead = !minimal || !/^[A-Za-z]/.test(text);
    const trail = !minimal || !/(?:[A-Za-z0-9¹²³⁴⁵⁶⁷⁸⁹⁰]|\d%)$/.test(text);
    const last = rlmCloser && k === runs.length - 1;
    if (!lead && !trail && !last) return;
    const period = trail && view[end] === '.' && !/[A-Za-z0-9]/.test(view[end + 1] || '');
    plan.push({ start, end, lead, trail, period, closer: last && !(trail && period) });
  });
  return plan;
}

/** Where a plain text flips: the runs that need a mark, as planFor gives them. `rules` from rulesFor. */
export const flipRuns = (text, rules = DEFAULT_RULES) => planFor(removeMarks(text), rules);

/**
 * The runs of a text as it stands - its LRM/RLM marks kept - at their places
 * in it: the same runs the fixer finds, for drawing the text as it is today.
 */
export function runsAsIs(text, rules = DEFAULT_RULES) {
  const at = [];
  let plain = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === LRM || text[i] === RLM) continue;
    at.push(i);
    plain += text[i];
  }
  return planFor(plain, rules).map((r) => ({ ...r, start: at[r.start], end: at[r.end - 1] + 1 }));
}

/* ------------------------------------------------- how the page shows it */

/* Unicode bidi classes, enough for page copy: no embeddings or isolates. */
function bidiClass(ch) {
  const c = ch.codePointAt(0);
  if (ch === LRM) return 'L';
  if (ch === RLM) return 'R';
  if (c === 0x061c) return 'AL';
  if ((c >= 0x30 && c <= 0x39) || c === 0xb2 || c === 0xb3 || c === 0xb9 || c === 0x2070 || (c >= 0x2074 && c <= 0x2079)) return 'EN';
  if ((c >= 0x0660 && c <= 0x0669) || c === 0x066b || c === 0x066c) return 'AN';
  if (c === 0x066a) return 'ET';
  if (c === 0x060c) return 'CS';
  if ((c >= 0x064b && c <= 0x065f) || c === 0x0670 || (c >= 0x06d6 && c <= 0x06ed)) return 'NSM';
  if ((c >= 0x0600 && c <= 0x08ff) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) return 'AL';
  if (c >= 0x0590 && c <= 0x05ff) return 'R';
  if (ch === '+' || ch === '-' || ch === '\u2212') return 'ES';
  if (/[#$%°¢£¥€\u2030-\u2034]/.test(ch)) return 'ET';
  if (/[,.\/:\u00A0]/.test(ch)) return 'CS';
  if (/\s/.test(ch)) return 'WS';
  if (/\p{L}/u.test(ch)) return 'L';
  if (/\p{M}/u.test(ch)) return 'NSM';
  return 'ON';
}

/* Each character's level in a right-to-left paragraph: 1 laid out right to left, 2 left to right. */
function bidiLevels(text) {
  const t = text.split('').map(bidiClass);
  const n = t.length;
  for (let i = 0; i < n; i++) if (t[i] === 'NSM') t[i] = i ? t[i - 1] : 'R';
  let strong = 'R';
  for (let i = 0; i < n; i++) {
    if (t[i] === 'L' || t[i] === 'R' || t[i] === 'AL') strong = t[i];
    else if (t[i] === 'EN' && strong === 'AL') t[i] = 'AN';
  }
  for (let i = 0; i < n; i++) if (t[i] === 'AL') t[i] = 'R';
  for (let i = 1; i < n - 1; i++) {
    if ((t[i] === 'ES' || t[i] === 'CS') && t[i - 1] === 'EN' && t[i + 1] === 'EN') t[i] = 'EN';
    else if (t[i] === 'CS' && t[i - 1] === 'AN' && t[i + 1] === 'AN') t[i] = 'AN';
  }
  for (let i = 0; i < n; i++) {
    if (t[i] !== 'ET') continue;
    let j = i;
    while (j < n && t[j] === 'ET') j++;
    if ((i > 0 && t[i - 1] === 'EN') || (j < n && t[j] === 'EN')) for (let k = i; k < j; k++) t[k] = 'EN';
    i = j - 1;
  }
  for (let i = 0; i < n; i++) if (t[i] === 'ES' || t[i] === 'ET' || t[i] === 'CS') t[i] = 'ON';
  strong = 'R';
  for (let i = 0; i < n; i++) {
    if (t[i] === 'L' || t[i] === 'R') strong = t[i];
    else if (t[i] === 'EN' && strong === 'L') t[i] = 'L';
  }
  const side = (x) => (x === 'EN' || x === 'AN' ? 'R' : x);
  for (let i = 0; i < n; i++) {
    if (t[i] !== 'WS' && t[i] !== 'ON') continue;
    let j = i;
    while (j < n && (t[j] === 'WS' || t[j] === 'ON')) j++;
    const before = i ? side(t[i - 1]) : 'R';
    const after = j < n ? side(t[j]) : 'R';
    for (let k = i; k < j; k++) t[k] = before === after ? before : 'R';
    i = j - 1;
  }
  return t.map((x) => (x === 'R' ? 1 : 2));
}

const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' };

/**
 * Does text[start, end) read on the page as it is written - one block, left
 * to right, in a right-to-left paragraph? A bracket laid out right to left is
 * drawn mirrored, so (RAM) still reads (RAM) without any mark.
 */
function readsRight(text, start, end) {
  const chars = text.split('');
  const lv = bidiLevels(text);
  const order = chars.map((_, i) => i);
  for (const level of [2, 1]) {
    for (let i = 0; i < order.length; ) {
      if (lv[order[i]] < level) {
        i++;
        continue;
      }
      let j = i;
      while (j < order.length && lv[order[j]] >= level) j++;
      order.splice(i, j - i, ...order.slice(i, j).reverse());
      i = j;
    }
  }
  const isMark = (k) => chars[k] === LRM || chars[k] === RLM;
  const shown = order.filter((k) => !isMark(k));
  const rank = new Map(shown.map((k, i) => [k, i]));
  const inRun = [];
  for (let k = start; k < end; k++) if (!isMark(k)) inRun.push(k);
  if (!inRun.length) return true;
  const ranks = inRun.map((k) => rank.get(k)).sort((a, b) => a - b);
  if (ranks[ranks.length - 1] - ranks[0] !== ranks.length - 1) return false;
  const seen = ranks.map((r) => {
    const k = shown[r];
    return lv[k] === 1 ? MIRROR[chars[k]] ?? chars[k] : chars[k];
  });
  return seen.join('') === inRun.map((k) => chars[k]).join('');
}

const MARK_ENTITY = /&(?:lrm|rlm|#820[67]|#x0*200[ef]);/gi;
const isLrmEntity = (m) => /^&(?:lrm|#8206|#x0*200e);$/i.test(m);

/**
 * The runs that flip on the page as a text stands - its marks, real or
 * written as entities, kept. Each run the fixer would hold is laid out as a
 * browser lays out its paragraph (inline tags such as <sup> are one
 * paragraph with the text around them); only one that does not read as it is
 * written is listed. A run that already shows right needs nothing.
 */
function flipsNow(s, rules) {
  const isHtml = HAS_TAG.test(s);
  const flips = [];
  let para = '';
  let runs = [];
  const close = () => {
    for (const r of runs) {
      let { start, end } = r;
      let text = para;
      if (!isHtml) {
        // Plain text keeps its lines; in HTML a line break is only a space.
        const from = para.lastIndexOf('\n', start - 1) + 1;
        const to = para.indexOf('\n', end);
        text = para.slice(from, to < 0 ? para.length : to);
        start -= from;
        end -= from;
      }
      if (!readsRight(text, start, end)) flips.push(r.text);
    }
    para = '';
    runs = [];
  };
  let rawUntil = null;
  (isHtml ? s.split(SPLIT_TAGS) : [s]).forEach((part, idx) => {
    if (isHtml && idx % 2 === 1) {
      if (rawUntil && part.toLowerCase().startsWith(rawUntil)) rawUntil = null;
      else if (!rawUntil && RAW_TAG.test(part)) rawUntil = '</' + part.match(RAW_TAG)[1].toLowerCase();
      if (BLOCK_TAG.test(part)) close();
      return;
    }
    if (rawUntil || !part) return;
    const marked = isHtml ? part.replace(MARK_ENTITY, (m) => (isLrmEntity(m) ? LRM : RLM)) : part;
    const view = buildView(marked, isHtml).view.replace(/\r/g, isHtml ? ' ' : '');
    const off = para.length;
    for (const r of runsAsIs(view, rules)) {
      runs.push({ start: off + r.start, end: off + r.end, text: view.slice(r.start, r.end).replace(/[\u200E\u200F]/g, '').replace(/\u00A0/g, ' ') });
    }
    para += isHtml ? view.replace(/\n/g, ' ') : view;
  });
  close();
  return flips;
}

/* Marks broken by an encoding accident - "â€Ž" - which show on the page as junk. */
const JUNK_MARKS = BROKEN_MARKS.slice(0, 4);
const junkIn = (s) => JUNK_MARKS.reduce((n, re) => n + (s.match(re) || []).length, 0);

const RAW_TAG = /^<(script|style)\b/i;
const BLOCK_TAG = /^<\/?(?:p|div|li|ul|ol|h[1-6]|td|th|tr|table|br|dt|dd|dl|blockquote|section|article|header|footer)\b/i;
const HAS_TAG = /<\/?[A-Za-z][^>]*>/;
const SPLIT_TAGS = /(<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|<![^>]*>)/g;

const toEntities = (s) => s.replace(/\u200E/g, '&lrm;').replace(/\u200F/g, '&rlm;');

/**
 * Static: a text or a fragment of HTML with its runs marked. Tags, comments
 * and what is inside <script> and <style> are passed through as they are.
 *
 * Options, all the Flipping Converter's, with its defaults:
 *   rules        from rulesFor - the lists in Settings
 *   minimal      "Fewest marks": only the side of a run that would flip (true)
 *   rlmLineStart an RLM at the start of every line (false)
 *   rlmCloser    an RLM after the last run (false)
 *   format       'chars' - invisible characters - or 'entities' (&lrm;),
 *                which only an HTML source takes
 *
 * Returns { output, runs, marks, removed, isHtml, format, parts }. `parts` is
 * the source split as it was worked on, for drawing: { tag: true, text } for a
 * tag, otherwise { tag: false, text, raw, runs, ins } - its runs as
 * [start, end] in `text`, and `ins` the marks put in, [[index, marks]] in
 * order, always as characters. `raw` is the inside of a <script> or <style>.
 */
export function convert(input, opts = {}) {
  const { rules = DEFAULT_RULES, minimal = true, rlmLineStart = false, rlmCloser = false, format = 'chars' } = opts;
  const cleaned = stripMarks(input);
  const src = cleaned.text;
  const isHtml = HAS_TAG.test(src);
  const useEntities = isHtml && format === 'entities';
  const pieces = isHtml ? src.split(SPLIT_TAGS) : [src];

  const runTexts = [];
  const parts = [];
  let marks = 0;
  let atLineStart = true;
  let rawUntil = null;

  const out = pieces
    .map((part, idx) => {
      if (isHtml && idx % 2 === 1) {
        if (rawUntil && part.toLowerCase().startsWith(rawUntil)) rawUntil = null;
        else if (!rawUntil && RAW_TAG.test(part)) rawUntil = '</' + part.match(RAW_TAG)[1].toLowerCase();
        if (BLOCK_TAG.test(part)) atLineStart = true;
        parts.push({ tag: true, text: part });
        return part;
      }
      if (rawUntil || !part) {
        parts.push({ tag: false, text: part, raw: !!rawUntil, runs: [], ins: [] });
        return part;
      }

      const { view, pos } = buildView(part, isHtml);
      const ins = new Map();
      const add = (at, ch, front = false) => {
        const cur = ins.get(at) || '';
        ins.set(at, front ? ch + cur : cur + ch);
        marks++;
      };

      const runs = [];
      for (const { start: s, end: e, lead, trail, period, closer } of planFor(view, rules, { minimal, rlmCloser })) {
        runTexts.push(view.slice(s, e).replace(/\u00A0/g, ' '));
        runs.push([pos[s], pos[e]]);
        if (lead) add(pos[s], LRM);
        if (trail) {
          add(pos[e], LRM);
          // A full stop straight after the run stays on the Arabic side.
          if (period) add(pos[e + 1], RLM);
        }
        if (closer) add(pos[e], RLM);
      }

      if (rlmLineStart) {
        const lineStart = /(^|\n)([ \t]*)(?=[^\s])/g;
        for (const m of view.matchAll(lineStart)) {
          if (m[1] === '' && !atLineStart) continue;
          add(pos[m.index + m[1].length + m[2].length], RLM, true);
        }
      }
      if (/\S/.test(view)) atLineStart = /\n\s*$/.test(view);

      let res = '';
      for (let i = 0; i <= part.length; i++) {
        if (ins.has(i)) res += useEntities ? toEntities(ins.get(i)) : ins.get(i);
        if (i < part.length) res += part[i];
      }
      parts.push({ tag: false, text: part, raw: false, runs, ins: [...ins].sort((a, b) => a[0] - b[0]) });
      return res;
    })
    .join('');

  return {
    output: out,
    runs: runTexts,
    marks,
    removed: cleaned.removed,
    isHtml,
    format: useEntities ? 'entities' : 'chars',
    parts
  };
}

/* ------------------------------------------------- PDP specifications */

/* Every LTR value with a number in it is wrapped as &lrm;value&lrm;:
     1080 x 2340 (FHD+)  ->  &lrm;1080 x 2340 (FHD+)&lrm;
   A value runs from its first to its last Latin letter or digit, stopping at
   Arabic text, a tab or a line break, plus attached symbols like % + ) ®. */
const PDP_STRONG = /[A-Za-z0-9\u00B2\u00B3\u00B9\u2070-\u2079]/;
const PDP_STOP = /[\n\r\t\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
const PDP_TRAIL = /^[%+®™*)\]°″'"]$/;
const PDP_LEAD = /^[(\[+\-$€£]$/;
const PDP_LRM = '&lrm;';

function wrapNumberValues(text, isHtml, found) {
  // Units: single characters, or whole HTML entities (opaque, neutral).
  const units = [];
  const entity = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/iy;
  for (let i = 0; i < text.length; ) {
    entity.lastIndex = i;
    const m = isHtml && text[i] === '&' && entity.exec(text);
    const len = m ? m[0].length : 1;
    units.push({ at: i, ch: m ? '\uFFFC' : text[i] });
    i += len;
  }
  const n = units.length;
  const depth = (a, b) => {
    let d = 0;
    for (let k = a; k < b; k++) d += units[k].ch === '(' ? 1 : units[k].ch === ')' ? -1 : 0;
    return d;
  };

  const ins = new Map();
  const runs = [];
  for (let i = 0; i < n; ) {
    if (!PDP_STRONG.test(units[i].ch)) {
      i++;
      continue;
    }
    let a = i;
    let last = i;
    let k = i + 1;
    for (; k < n && !PDP_STOP.test(units[k].ch); k++) {
      if (PDP_STRONG.test(units[k].ch)) last = k;
    }
    let b = last + 1;
    while (b < n && PDP_TRAIL.test(units[b].ch)) {
      if (units[b].ch === ')' && depth(a, b) <= 0 && !(a > 0 && units[a - 1].ch === '(')) break;
      b++;
    }
    if (a > 0 && PDP_LEAD.test(units[a - 1].ch) && (units[a - 1].ch !== '(' || depth(a, b) < 0)) a--;

    const start = units[a].at;
    const end = b < n ? units[b].at : text.length;
    const value = text.slice(start, end);
    if (/[0-9]/.test(value)) {
      found.push(value);
      runs.push([start, end]);
      ins.set(start, (ins.get(start) || '') + LRM);
      ins.set(end, (ins.get(end) || '') + LRM);
    }
    i = b;
  }

  let out = '';
  for (let i = 0; i <= text.length; i++) {
    if (ins.has(i)) out += PDP_LRM.repeat(ins.get(i).length);
    if (i < text.length) out += text[i];
  }
  return { text: out, runs, ins: [...ins].sort((a, b) => a[0] - b[0]) };
}

/**
 * PDP: specifications, every value with a number wrapped as &lrm;value&lrm;.
 * Returns { output, runs, marks, removed, isHtml, parts }, `parts` as convert gives them.
 */
export function convertPdp(input) {
  const cleaned = stripMarks(input);
  const src = cleaned.text;
  const isHtml = HAS_TAG.test(src);
  const found = [];
  const parts = [];
  const pieces = isHtml ? src.split(SPLIT_TAGS) : [src];
  const output = pieces
    .map((part, i) => {
      if (isHtml && i % 2) {
        parts.push({ tag: true, text: part });
        return part;
      }
      const r = wrapNumberValues(part, isHtml, found);
      parts.push({ tag: false, text: part, raw: false, runs: r.runs, ins: r.ins });
      return r.text;
    })
    .join('');
  return { output, runs: [...new Set(found)], marks: found.length * 2, removed: cleaned.removed, isHtml, parts };
}

/* ------------------------------------------------------ commas to dots */

/**
 * Every "," in the content turned into "." - never inside a tag, so markup
 * like style="a, b" cannot break. `keep` is the commas to leave as they are,
 * by their index in content order. Returns { text, count, found }: `found` is
 * every comma with a little context on each side, for the list that lets one
 * be kept.
 */
/** How much text each side of a comma `found` carries, for the list that shows it. */
export const COMMA_CONTEXT = 14;

export function commasToDots(input, keep = new Set()) {
  const found = [];
  let index = 0;
  let count = 0;
  const swap = (s) =>
    s.replace(/,/g, (m, off, str) => {
      const i = index++;
      found.push({
        index: i,
        left: str.slice(Math.max(0, off - COMMA_CONTEXT), off).split(/[\n,]/).pop(),
        right: str.slice(off + 1, off + 1 + COMMA_CONTEXT).split(/[\n,]/)[0]
      });
      if (keep.has(i)) return ',';
      count++;
      return '.';
    });
  const text = HAS_TAG.test(input)
    ? input
        .split(SPLIT_TAGS)
        .map((part, i) => (i % 2 ? part : swap(part)))
        .join('')
    : swap(input);
  return { text, count, found };
}

/* A comma between digits is a decimal comma - 1,5 → 1.5. It is a thousands
   separator instead, and stays, only inside a number written in thousands: a
   first group of one to three digits not starting with 0, then groups of
   exactly three - 1,299 SAR, 12,345,678, 1,299.50. So 0,125 and 1234,567,
   which no one writes in thousands, are decimals: 0.125 and 1234.567. */
const DECIMAL_COMMA = /(?<=\d)(?:(?!,\d{3}(?!\d))|(?<!(?<![\d,])[1-9]\d{0,2}(?:,\d{3})*)),(?=\d)/g;

/** Text with its decimal commas turned to dots. `at` is where each was, in `text` - one character each, so the same in both. */
export function decimalCommas(text) {
  const at = [];
  const out = String(text).replace(DECIMAL_COMMA, (m, off) => {
    at.push(off);
    return '.';
  });
  return { text: out, count: at.length, at };
}

/** HTML with the decimal commas in its text turned to dots - never in a tag, a script or a style. */
function decimalCommasHtml(html, t) {
  let raw = false;
  return html
    .split(SPLIT_TAGS)
    .map((part, i) => {
      if (i % 2) {
        if (RAW_TAG.test(part)) raw = true;
        else if (/^<\/(?:script|style)\b/i.test(part)) raw = false;
        return part;
      }
      if (raw) return part;
      const r = decimalCommas(part);
      t.commas += r.count;
      return r.text;
    })
    .join('');
}

/* ------------------------------------------------------------- scripts */

const SCRIPT_BLOCK = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi;
/* A mark straight after an unescaped backslash would become part of the
   escape - "\" + LRM - and change what the string holds. */
const MARK_AFTER_ESCAPE = /(?:^|[^\\])(?:\\\\)*\\[\u200E\u200F]/;

const tally = (rules, commas = false) => ({ rules, commasOn: commas, runs: [], now: [], marks: 0, removed: 0, skipped: 0, commas: 0 });
const addTo = (t, r) => {
  t.runs.push(...r.runs);
  t.marks += r.marks;
  t.removed += r.removed;
};

/** One string literal's contents, or left as it is when a mark would land in an escape. */
function fixLiteral(body, t) {
  if (!hasArabic(body)) return body;
  const r = convert(body, { rules: t.rules });
  if (MARK_AFTER_ESCAPE.test(r.output)) {
    t.skipped++;
    return body;
  }
  t.now.push(...flipsNow(body, t.rules));
  addTo(t, r);
  return r.output;
}

/** JavaScript, with marks put only inside its quoted strings (see eachString). */
const fixScriptCode = (js, t) => eachString(js, (body) => fixLiteral(body, t));

/** The strings of a script that hold Arabic: the texts its fix works on, for the review to show. */
export function scriptTexts(js) {
  const texts = [];
  eachString(String(js ?? ''), (body) => {
    if (hasArabic(body)) texts.push(body);
    return body;
  });
  return texts;
}

/**
 * JavaScript with each quoted string's contents replaced by `onString` -
 * never the code around them, never a comment. In a template literal, what
 * is inside ${...} is code and is left alone.
 */
function eachString(js, onString) {
  let out = '';
  let i = 0;
  while (i < js.length) {
    const c = js[i];
    if (c === '/' && js[i + 1] === '/') {
      const nl = js.indexOf('\n', i);
      const end = nl < 0 ? js.length : nl;
      out += js.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && js[i + 1] === '*') {
      const close = js.indexOf('*/', i + 2);
      const end = close < 0 ? js.length : close + 2;
      out += js.slice(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < js.length && js[j] !== c) {
        if (js[j] === '\\') j++;
        else if (c !== '`' && js[j] === '\n') break;
        j++;
      }
      const body = js.slice(i + 1, j);
      const fixed =
        c === '`'
          ? body
              .split(/(\$\{[^}]*\})/)
              .map((piece, k) => (k % 2 ? piece : onString(piece)))
              .join('')
          : onString(body);
      out += c + fixed + (j < js.length ? js[j] : '');
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** HTML whose inline <script> blocks are fixed as code, and the rest as text. */
function fixHtmlWithScripts(html, t, all = false) {
  let out = '';
  let last = 0;
  const text = (s) => {
    if (!all && !hasArabic(s)) return s;
    t.now.push(...flipsNow(s, t.rules));
    if (t.commasOn) s = decimalCommasHtml(s, t);
    const r = convert(s, { rules: t.rules });
    addTo(t, r);
    return r.output;
  };
  for (const m of html.matchAll(SCRIPT_BLOCK)) {
    out += text(html.slice(last, m.index)) + m[1] + fixScriptCode(m[2], t) + m[3];
    last = m.index + m[0].length;
  }
  return out + text(html.slice(last));
}

/* -------------------------------------------------------------- values */

/**
 * A property's value fixed, whole: a string or a multi-value array. `script`
 * is a field that holds code - a Static Content block's Footer - which only
 * has marks put inside its strings. A value with no Arabic in it comes back
 * exactly as it was - unless `all`, for a field on an Arabic page, which
 * flips with no Arabic of its own. Strings in code still need Arabic either
 * way. `rules` from rulesFor - the lists in Settings. `commas` turns the
 * decimal commas in its text to dots (see decimalCommas) - never in code.
 *
 * Returns { value, changed, runs, flips, junk, marks, removed, skipped, commas }:
 * `runs` every run the fixed value holds, `flips` only those that flip on
 * the page now, `junk` the marks broken by encoding that show as junk.
 */
export function fixValue(value, { script = false, rules = DEFAULT_RULES, all = false, commas = false } = {}) {
  const t = tally(rules, commas && !script);
  const one = (s) => {
    if (typeof s !== 'string' || !(all || hasArabic(s))) return s;
    if (script && !/<script\b/i.test(s)) return fixScriptCode(s, t);
    return fixHtmlWithScripts(s, t, all);
  };
  const out = Array.isArray(value) ? value.map(one) : one(value);
  const changed = JSON.stringify(out) !== JSON.stringify(value);
  const junk = [].concat(value).reduce((n, s) => n + (typeof s === 'string' ? junkIn(s) : 0), 0);
  return {
    value: out,
    changed,
    runs: [...new Set(t.runs)],
    flips: [...new Set(t.now)],
    junk,
    marks: t.marks,
    removed: t.removed,
    skipped: t.skipped,
    commas: t.commas
  };
}
