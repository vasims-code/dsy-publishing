/**
 * The copy deck's added and ignored fields, kept with the other settings in
 * chrome.storage.sync - so they follow the operator to every signed-in browser.
 *
 * Two items of their own, not part of the settings object: sync storage allows
 * 8 KB an item, and a list that grows with every new component would push the
 * rest of the settings past it. Stored short ({ c, p, g }) for the same reason.
 * The side panel adds and ignores from the copy deck's list; the settings page
 * lists both, and removes and adds by hand.
 */

import { cleanFields, fieldAllowed, fieldComponent, fieldId, isCodeField } from './core.js';

export const FIELD_KEYS = { add: 'aemt.copyDeck.added', ignore: 'aemt.copyDeck.ignored' };

const pack = (f) => (f.group ? { c: f.component, p: f.prop, g: f.group } : { c: f.component, p: f.prop });
const unpack = (s) => ({ component: s?.c, prop: s?.p, group: s?.g });

/** { add: [{ component, prop, group }], ignore: [{ component, prop }] } */
export async function loadFields() {
  const got = await chrome.storage.sync.get([FIELD_KEYS.add, FIELD_KEYS.ignore]);
  return cleanFields({
    add: (got[FIELD_KEYS.add] || []).map(unpack),
    ignore: (got[FIELD_KEYS.ignore] || []).map(unpack)
  });
}

/**
 * One change at a time. Each reads the lists and writes them back, so two
 * clicks close together - Add on one field, Ignore on the next - would
 * otherwise both read the old lists, and the second write would undo the first.
 */
let queue = Promise.resolve();
const oneAtATime = (change) => {
  const run = queue.then(change, change);
  queue = run.catch(() => {});
  return run;
};

async function store(fields) {
  try {
    await chrome.storage.sync.set({ [FIELD_KEYS.add]: fields.add.map(pack), [FIELD_KEYS.ignore]: fields.ignore.map(pack) });
  } catch (e) {
    throw new Error(
      /QUOTA/i.test(e?.message || '')
        ? 'The list of fields is full. Remove some you no longer need in Settings, under Copy deck fields, then try again.'
        : `Could not save the field: ${e?.message || e}`
    );
  }
  return fields;
}

/**
 * Put a field on the sheet (`kind` 'add', with a group) or set it aside ('ignore').
 * A field is in one list at most: choosing one takes it out of the other.
 */
export async function chooseField(kind, field) {
  const f = { component: fieldComponent(field.component), prop: String(field.prop || '').trim() };
  if (kind === 'add') f.group = field.group;
  if (!f.component || !f.prop) throw new Error('Give both a component and a property.');
  if (!fieldAllowed(f.prop)) {
    throw new Error(`${f.prop} can never go on the sheet: it is a system property, or a value analytics reads in English.`);
  }
  if (isCodeField(f.component, f.prop)) {
    throw new Error(`${f.prop} can never go on the sheet: it is a Static Content block’s script or style sheet - code, not copy.`);
  }
  return oneAtATime(async () => {
    const now = await loadFields();
    const others = (list) => list.filter((x) => fieldId(x) !== fieldId(f));
    return cleanFields(
      await store({
        add: kind === 'add' ? [...others(now.add), f] : others(now.add),
        ignore: kind === 'ignore' ? [...others(now.ignore), f] : others(now.ignore)
      })
    );
  });
}

/** Take a field out of both lists: back to being offered on the list. */
export function forgetField(field) {
  return oneAtATime(async () => {
    const now = await loadFields();
    const keep = (list) => list.filter((x) => fieldId(x) !== fieldId(field));
    return cleanFields(await store({ add: keep(now.add), ignore: keep(now.ignore) }));
  });
}

/** Change which group an added field goes in. */
export function regroupField(field, group) {
  return oneAtATime(async () => {
    const now = await loadFields();
    return cleanFields(await store({ ...now, add: now.add.map((x) => (fieldId(x) === fieldId(field) ? { ...x, group } : x)) }));
  });
}

/** Calls back with the new lists whenever they change - from the panel, the settings page, another browser. */
export function onFieldsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes[FIELD_KEYS.add] || changes[FIELD_KEYS.ignore])) loadFields().then(callback, () => {});
  });
}
