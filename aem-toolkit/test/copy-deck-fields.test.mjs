/* The added and ignored copy deck fields, as they are kept: in chrome.storage.sync,
 * two items of their own, stored short. The storage here answers late, the way
 * sync storage does, so two changes close together really do overlap.
 */
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/';

let items = {};
let quota = Infinity;
const changes = [];
globalThis.chrome = {
  storage: {
    sync: {
      async get(keys) {
        await new Promise((r) => setTimeout(r, 5));
        return Object.fromEntries([].concat(keys).filter((k) => k in items).map((k) => [k, structuredClone(items[k])]));
      },
      async set(next) {
        await new Promise((r) => setTimeout(r, 5));
        for (const [k, v] of Object.entries(next)) {
          if (JSON.stringify(v).length + k.length > quota) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
        }
        const c = {};
        for (const [k, v] of Object.entries(next)) {
          c[k] = { oldValue: items[k], newValue: v };
          items[k] = structuredClone(v);
        }
        for (const l of changes) l(c, 'sync');
      }
    },
    onChanged: { addListener: (l) => changes.push(l) }
  }
};

const fields = await import(pathToFileURL(base + 'src/features/copy-deck/fields.js'));

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};
const reset = () => {
  items = {};
  quota = Infinity;
};

const CARD = { component: 'cm-g-promo-banner', prop: 'cardTitle', group: 'cta' };

console.log('--- keeping the choices --------------------------------------------');

check('nothing stored is nothing chosen', JSON.stringify(await fields.loadFields()) === JSON.stringify({ add: [], ignore: [] }), '');
{
  const after = await fields.chooseField('add', CARD);
  check('a field added is kept, with its group', JSON.stringify(after.add) === JSON.stringify([CARD]) && after.ignore.length === 0, JSON.stringify(after));
  check(
    '...stored short, under its own key, apart from the settings',
    JSON.stringify(items[fields.FIELD_KEYS.add]) === JSON.stringify([{ c: 'cm-g-promo-banner', p: 'cardTitle', g: 'cta' }]) && !('aemt.settings' in items),
    JSON.stringify(items)
  );
  check('...and read back the same', JSON.stringify(await fields.loadFields()) === JSON.stringify(after), '');
}
{
  const after = await fields.chooseField('ignore', { ...CARD, group: 'copy' });
  check('ignoring an added field takes it out of the added list', after.add.length === 0 && JSON.stringify(after.ignore) === JSON.stringify([{ component: CARD.component, prop: CARD.prop }]), JSON.stringify(after));
  check('...and an ignored one keeps no group', JSON.stringify(items[fields.FIELD_KEYS.ignore]) === JSON.stringify([{ c: 'cm-g-promo-banner', p: 'cardTitle' }]), JSON.stringify(items[fields.FIELD_KEYS.ignore]));
}
{
  const back = await fields.forgetField(CARD);
  check('forgetting a field takes it out of both lists - back on the list to decide', back.add.length === 0 && back.ignore.length === 0, JSON.stringify(back));
}
{
  await fields.chooseField('add', CARD);
  const after = await fields.regroupField(CARD, 'copy');
  check('an added field can change group', after.add[0].group === 'copy', JSON.stringify(after));
}

{
  reset();
  await fields.chooseField('add', { component: 'samsung/components/content/consumer/global/common/cm-g-promo-banner/', prop: 'cardTitle', group: 'cta' });
  const now = await fields.chooseField('add', CARD);
  check(
    'a full resource type is saved as the component name, so choosing the same field again replaces it',
    now.add.length === 1 && now.add[0].component === 'cm-g-promo-banner' && items[fields.FIELD_KEYS.add][0].c === 'cm-g-promo-banner',
    JSON.stringify(items[fields.FIELD_KEYS.add])
  );
}

console.log('\n--- what is refused -------------------------------------------------');

for (const prop of ['sling:resourceType', 'jcr:primaryType', 'headlineEngText', 'textForAnalytics']) {
  let error = null;
  try {
    await fields.chooseField('add', { component: 'x', prop, group: 'copy' });
  } catch (e) {
    error = e.message;
  }
  check(`${prop} is refused, and says why`, /can never go on the sheet/.test(String(error)), String(error));
}
{
  let error = null;
  try {
    await fields.chooseField('add', { component: ' ', prop: 'cardTitle' });
  } catch (e) {
    error = e.message;
  }
  check('a field needs a component and a property', /both a component and a property/.test(String(error)), String(error));
}
{
  // A Static Content block's script and style sheet: code, whatever words are in it - by name or by full resource type.
  reset();
  const refused = [];
  for (const [component, prop] of [
    ['cm-g-static-content', 'footerInclude'],
    ['samsung/components/content/consumer/global/common/cm-g-static-content', 'headerInclude']
  ]) {
    try {
      await fields.chooseField('add', { component, prop, group: 'copy' });
    } catch (e) {
      refused.push(e.message);
    }
  }
  check(
    'a Static Content block’s Footer or Header is refused in settings, and says it is code',
    refused.length === 2 && refused.every((m) => /can never go on the sheet: it is a Static Content block’s script or style sheet/.test(m)) && !items[fields.FIELD_KEYS.add],
    JSON.stringify(refused)
  );
  const any = await fields.chooseField('add', { component: '*', prop: 'footerInclude', group: 'copy' });
  check('...but not for every component: elsewhere a field of that name may be copy', any.add.some((f) => f.component === '*' && f.prop === 'footerInclude'), JSON.stringify(any.add));
  items[fields.FIELD_KEYS.add] = [{ c: 'cm-g-static-content', p: 'footerInclude', g: 'copy' }, { c: 'x', p: 'a', g: 'copy' }];
  const now = await fields.loadFields();
  check('one added before the change is dropped on the way in, like any field that may never go on the sheet', JSON.stringify(now.add) === JSON.stringify([{ component: 'x', prop: 'a', group: 'copy' }]), JSON.stringify(now.add));
}
{
  reset();
  quota = 80; // room for one added field, not two
  await fields.chooseField('add', CARD);
  let error = null;
  try {
    await fields.chooseField('add', { component: 'cm-g-other-component', prop: 'someLongPropertyName', group: 'copy' });
  } catch (e) {
    error = e.message;
  }
  check('a full list says so, and where to make room', /list of fields is full.*Settings/.test(String(error)), String(error));
  quota = Infinity;
  check('...and the next change still goes through', (await fields.chooseField('ignore', { component: 'y', prop: 'z' })).ignore.length === 1, '');
}

console.log('\n--- two changes close together -------------------------------------');

{
  reset();
  const all = await Promise.all([
    fields.chooseField('add', CARD),
    fields.chooseField('ignore', { component: 'cm-g-promo-banner', prop: 'ctaLabel' }),
    fields.chooseField('add', { component: 'page-pcd', prop: 'productGroupCodeName', group: 'page' }),
    fields.chooseField('ignore', { component: '*', prop: 'badgeLabel' })
  ]);
  const now = await fields.loadFields();
  check('four clicks in a row all land - none undoes another', now.add.length === 2 && now.ignore.length === 2, JSON.stringify(now));
  check('...and the last answer holds every one', JSON.stringify(all[3]) === JSON.stringify(now), JSON.stringify(all[3]));
}
{
  let heard = null;
  fields.onFieldsChanged((f) => (heard = f));
  await fields.chooseField('ignore', { component: 'x', prop: 'y' });
  await new Promise((r) => setTimeout(r, 30));
  check('a change is heard - by the panel, by the settings page', heard?.ignore.some((f) => f.prop === 'y'), JSON.stringify(heard));
}
{
  items[fields.FIELD_KEYS.add] = [{ c: 'x', p: 'a', g: 'nope' }, { c: 'x', p: 'sling:resourceType', g: 'copy' }, { junk: true }];
  const now = await fields.loadFields();
  check('what is stored is checked on the way in: a bad group becomes "copy", the rest is dropped', JSON.stringify(now.add) === JSON.stringify([{ component: 'x', prop: 'a', group: 'copy' }]), JSON.stringify(now.add));
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
