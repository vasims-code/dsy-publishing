/**
 * "Fields not on the sheet": every field that reads like words but that no rule
 * puts on the sheet - one entry per component and property - with what it says,
 * and two answers: add it (in a group) or ignore it. Either is kept in settings,
 * where it can be taken back.
 *
 * The rules go by property name, so this is where a new component, or a new
 * field on an old one, shows up instead of its text going missing without a word.
 */

import { FIELD_GROUPS } from './core.js';

export const NEW_FIELDS_TITLE = 'Fields not on the sheet';

const NOTE =
  'These look like text, but Copy Deck does not put them on the sheet yet. Add puts the field on the sheet - for ' +
  'this component, on every page, from now on. Ignore stops showing it. Both are saved in Settings, under Copy ' +
  'deck fields, where you can take them back.';

/**
 * Appends nothing when the list is empty. `onChoose(kind, field)` saves the
 * choice ('add' with field.group, or 'ignore') and redraws; a rejection is
 * shown on the entry.
 */
export function renderNewFields(parent, fields, { el, onChoose }) {
  if (!fields?.length) return;

  const d = el('details', 'detail import-section new-fields');
  d.dataset.tone = 'change';
  d.open = true;
  const sum = el('summary');
  sum.append(el('span', 'detail-mark', '?'), el('span', 'detail-title', NEW_FIELDS_TITLE), el('span', 'detail-count', String(fields.length)));
  d.append(sum, el('p', 'detail-note', NOTE));

  const list = el('ol', 'import-rows');
  for (const f of fields) {
    const li = el('li', 'import-row new-field');
    li.title = f.key;
    li.dataset.field = `${f.component}@${f.prop}`;

    const head = el('div', 'import-row-head');
    head.append(el('span', 'deck-field', f.componentLabel), el('span', 'deck-tag', f.component));
    const where = el('div', 'new-field-where');
    where.append(el('span', 'new-field-prop', f.prop));
    // A text field in the component's dialog: its label, as the author sees it, and the length it is meant for.
    const context = [f.label && `“${f.label}” in the dialog`, f.where && `in ${f.where}`, f.count > 1 && `${f.count} places`]
      .filter(Boolean)
      .join(' · ');
    if (context) where.append(el('span', 'new-field-context', context));
    if (f.limit) where.append(el('span', 'new-field-context', `Length: ${f.limit}`));

    const value = el('div', 'new-field-value', f.text);

    const actions = el('div', 'new-field-actions');
    const group = el('select', 'new-field-group');
    group.setAttribute('aria-label', `Group for ${f.prop}`);
    for (const g of FIELD_GROUPS) {
      const o = el('option', null, g.label);
      o.value = g.id;
      o.selected = g.id === f.group;
      group.append(o);
    }
    const add = el('button', 'btn', 'Add');
    add.type = 'button';
    add.dataset.tone = 'secondary';
    const ignore = el('button', 'link-btn', 'Ignore');
    ignore.type = 'button';
    const problem = el('div', 'new-field-problem');
    problem.hidden = true;
    actions.append(group, add, ignore);

    const choose = async (kind) => {
      for (const c of [group, add, ignore]) c.disabled = true;
      problem.hidden = true;
      try {
        await onChoose(kind, { component: f.component, prop: f.prop, group: group.value });
        // Saved, but nothing on screen had to change: this entry was not drawn again, so it is still
        // the one clicked - its controls come back rather than staying greyed out for good.
        if (li.isConnected) for (const c of [group, add, ignore]) c.disabled = false;
      } catch (e) {
        /* Another choice may have drawn the list again meanwhile: the refusal goes on
         * this field's entry as it is on screen now, not on the one that was clicked. */
        const now = li.isConnected
          ? li
          : [...document.querySelectorAll('.new-field')].find((x) => x.dataset.field === li.dataset.field);
        if (!now) return;
        const said = now.querySelector('.new-field-problem');
        said.textContent = e.message;
        said.hidden = false;
        for (const c of now.querySelectorAll('select, button')) c.disabled = false;
      }
    };
    add.addEventListener('click', () => choose('add'));
    ignore.addEventListener('click', () => choose('ignore'));

    li.append(head, where, value, actions, problem);
    list.append(li);
  }
  d.append(list);
  parent.append(d);
}
