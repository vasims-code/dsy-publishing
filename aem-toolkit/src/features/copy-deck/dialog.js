/**
 * What a component's dialog says about its fields, read from /apps, so the copy
 * deck knows a setting from a text instead of guessing from the value.
 *
 * A Touch UI dialog is a tree of Granite UI nodes. Each input has a `name`
 * ("./headlineText") and a resource type that says what kind of input it is: a
 * text field, a text area or a rich-text editor is where an author types words;
 * a select, a switch, a button group, a path picker or an image is a setting.
 * The English the analytics read is typed into text fields too, but Samsung's
 * dialogs say so - "Text for Analytics (English)", with a pattern that allows
 * nothing but English - and that is never translated. Nor is code typed into a
 * text area labelled for it: a Static Content block's "Footer (JavaScript)".
 *
 * Names are relative to the component's node. A named container ("./column",
 * then "item1") puts what is inside it under that path; a composite multifield
 * ("./list") puts each of its items under it as item0, item1… - "list/*" here.
 * Includes point at other nodes, often several deep (the Showcase Card's fields
 * are four includes down); they are read and followed.
 *
 * Reads only. A dialog that cannot be read is simply not known, and the copy
 * deck goes by the values, as it always has.
 */

const TEXT_TYPES = new Set(['textfield', 'textarea', 'richtext']);
const SETTING_TYPES = new Set([
  'select',
  'checkbox',
  'switch',
  'radiogroup',
  'radio',
  'buttongroup',
  'pathfield',
  'pathbrowser',
  'fileupload',
  'datepicker',
  'numberfield',
  'colorfield',
  'hidden',
  'autocomplete',
  'tagfield',
  'tags',
  'userpicker',
  'password'
]);

/** Children that are not part of the form: options lists, data, the multifield's template (read on its own). */
const NOT_FORM = new Set(['granite:data', 'datasource', 'granite:rendercondition', 'rendercondition', 'field']);

/** Where an include's node is attached once read. */
const INCLUDED = 'aemt:included';

/** Which answer wins when one property appears twice: never translate English-only or code, never miss a text. */
const RANK = { setting: 1, text: 2, analytics: 3, code: 3 };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const typeOf = (n) => String(n?.['sling:resourceType'] || '').split('/').pop();

/** "./column/item1" is ['column', 'item1']; null for what is not a property ("./x@Delete", ":operation", "_charset_"). */
function nameSegments(name) {
  if (typeof name !== 'string' || name.includes('@') || name.startsWith(':') || name === '_charset_') return null;
  const segs = name
    .replace(/^\.\//, '')
    .split('/')
    .filter((s) => s && s !== '.');
  return segs.length ? segs : null;
}

/** "Text for Analytics (English)", or a pattern that lets nothing but English through. */
function englishOnly(n) {
  if (!isObj(n)) return false;
  if (/\(english\)|analytic/i.test(`${n.fieldLabel || ''} ${n.emptyText || ''}`)) return true;
  const pattern = n['granite:data']?.pattern;
  return typeof pattern === 'string' && /A-Za-z/.test(pattern) && !/\\p\{|\\u|[^\x00-\x7f]/.test(pattern);
}

/** A text area for code, as its label says: "Header (CSS)", "Footer (JavaScript)" - a developer's, never a translator's. */
const isCode = (type, label) => type === 'textarea' && /\((css|javascript)\)$/i.test(label);

/** The length an author is told to keep to: "Recommend to enter up to 30 characters and 2 lines", a maxlength. */
function limitOf(n) {
  const said = [n.bottomDiscription, n.fieldDescription]
    .filter((s) => typeof s === 'string' && /character|byte|\blines?\b/i.test(s))
    .map((s) => s.replace(/\s+/g, ' ').trim());
  const max = Number(n.maxlength);
  if (max > 0 && !said.some((s) => s.includes(String(max)))) said.push(`at most ${max} characters`);
  return said.join('; ');
}

/**
 * The fields of a dialog whose includes have been read (see readDialogs): each
 * { path, prop, kind, label, hint } - kind 'text', 'setting', 'analytics' or 'code';
 * path relative to the component's node, '*' for any one item of a list.
 */
export function dialogFields(dialog) {
  const found = new Map();
  const put = (segs, kind, label = '', hint = '') => {
    const prop = segs.at(-1);
    const path = segs.slice(0, -1).join('/');
    const id = `${path}@${prop}`;
    const had = found.get(id);
    if (had && RANK[had.kind] >= RANK[kind]) return;
    found.set(id, { path, prop, kind, label: kind === 'setting' ? '' : label, hint: kind === 'text' ? hint : '' });
  };

  const input = (n, prefix, owner) => {
    const type = typeOf(n);
    if (type === 'fileupload') {
      for (const name of [n.name, n.fileReferenceParameter, n.fileNameParameter]) {
        const segs = nameSegments(name);
        if (segs) put([...prefix, ...segs], 'setting');
      }
      return;
    }
    const segs = nameSegments(n.name);
    if (!segs) return;
    const at = [...prefix, ...segs];
    if (TEXT_TYPES.has(type)) {
      const label = String(n.fieldLabel || owner?.fieldLabel || n.emptyText || '').trim();
      if (englishOnly(n) || englishOnly(owner)) put(at, 'analytics', label);
      else if (isCode(type, label)) put(at, 'code', label);
      else if (n.disabled === true || n.disabled === 'true') put(at, 'setting');
      else put(at, 'text', label, limitOf(n));
    } else if (SETTING_TYPES.has(type)) {
      put(at, 'setting');
    }
  };

  const children = (n, prefix, depth) => {
    for (const [k, c] of Object.entries(n)) if (isObj(c) && !NOT_FORM.has(k) && k !== INCLUDED) walk(c, prefix, depth + 1);
  };

  const walk = (n, prefix, depth) => {
    if (!isObj(n) || depth > 60) return;
    const type = typeOf(n);
    if (type === 'include') {
      if (isObj(n[INCLUDED])) walk(n[INCLUDED], prefix, depth + 1);
      return;
    }
    if (type === 'multifield') {
      const f = n.field;
      if (!isObj(f)) return;
      const segs = nameSegments(f.name);
      // A composite multifield stores each item as a node of its own; a plain one, one property with many values.
      if (segs && (n.composite === true || n.composite === 'true' || !(TEXT_TYPES.has(typeOf(f)) || SETTING_TYPES.has(typeOf(f))))) {
        children(f, [...prefix, ...segs, '*'], depth);
      } else {
        input(f, prefix, n);
      }
      return;
    }
    if (type === 'named-container') {
      const segs = nameSegments(n.name);
      children(n, segs ? [...prefix, ...segs] : prefix, depth);
      return;
    }
    if (n.name !== undefined) input(n, prefix, null);
    children(n, prefix, depth);
  };

  walk(dialog, [], 0);
  return [...found.values()];
}

/* ------------------------------------------------------------------ reads */

/** How long a component's fields are remembered in this tab. Dialogs change with a deployment, not between two exports. */
const KEEP_MS = 30 * 60 * 1000;
const remembered = new Map();

/** Forget every dialog read so far - for a test, or a deployment just made. */
export function forgetDialogs() {
  remembered.clear();
}

/** The places a component's dialog can be: merged with what it inherits first, as the editor opens it. */
function dialogPaths(type) {
  if (type.startsWith('/')) return [`/mnt/override${type}/cq:dialog`, `${type}/cq:dialog`];
  return [`/mnt/override/apps/${type}/cq:dialog`, `/apps/${type}/cq:dialog`, `/libs/${type}/cq:dialog`];
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

/**
 * The dialogs of these component types, as fields: { [resourceType]: fields }.
 * Every read goes through `client.readJson`; a node that cannot be read - not
 * there, not allowed, not JSON, too big - is left out, never a reason to stop.
 * Within one call each node is read once, so a fieldset eight cards include is
 * one request.
 */
export async function readDialogs(client, types, { concurrency = 4 } = {}) {
  const origin = globalThis.location?.origin || '';
  const nodes = new Map();
  const read = (path) => {
    if (!nodes.has(path)) {
      nodes.set(
        path,
        client
          .readJson(path, 'infinity')
          .then(({ status, json }) => (status === 200 && isObj(json) ? json : null))
          .catch(() => null)
      );
    }
    return nodes.get(path);
  };

  /* Includes, followed. A node several includes share is followed once; one that
   * leads back to itself is not followed again, and no dialog may take more than
   * 150 of them - a loop or a runaway is a dialog left partly unknown, nothing worse. */
  const resolved = new WeakSet();
  const resolve = async (node, stack, budget) => {
    if (resolved.has(node)) return;
    resolved.add(node);
    const includes = [];
    const find = (n, depth) => {
      if (!isObj(n) || depth > 60) return;
      if (typeOf(n) === 'include' && typeof n.path === 'string' && n.path) includes.push(n);
      else for (const [k, c] of Object.entries(n)) if (isObj(c) && k !== INCLUDED && k !== 'granite:data') find(c, depth + 1);
    };
    find(node, 0);
    await Promise.all(
      includes.map(async (inc) => {
        const path = inc.path.startsWith('/') ? inc.path : `/apps/${inc.path}`;
        if (stack.includes(path) || stack.length > 12 || budget.left-- <= 0) return;
        const target = await read(path);
        if (!target) return;
        inc[INCLUDED] = target;
        await resolve(target, [...stack, path], budget);
      })
    );
  };

  const dialogs = {};
  let unread = 0;
  await pool(types, concurrency, async (type) => {
    const key = `${origin}|${type}`;
    const kept = remembered.get(key);
    if (kept && Date.now() - kept.at < KEEP_MS) {
      if (kept.fields.length) dialogs[type] = kept.fields;
      return;
    }
    for (const path of dialogPaths(type)) {
      const dialog = await read(path);
      if (!dialog) continue;
      await resolve(dialog, [path], { left: 150 });
      const fields = dialogFields(dialog);
      remembered.set(key, { at: Date.now(), fields });
      if (fields.length) dialogs[type] = fields;
      return;
    }
    unread++;
  });
  return { dialogs, read: Object.keys(dialogs).length, unread };
}
