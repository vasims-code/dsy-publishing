/* Stored settings and the one-time updates applied to them. */
import { pathToFileURL } from 'node:url';

let store = {};
globalThis.chrome = {
  storage: {
    sync: {
      get: async (k) => ({ [k]: store[k] }),
      set: async (o) => Object.assign(store, JSON.parse(JSON.stringify(o)))
    }
  }
};

const { loadSettings, STORAGE_KEY } = await import(
  pathToFileURL('D:/chrome-extensions/aem-toolkit/src/core/protocol.js')
);

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};

store = {};
let s = await loadSettings();
check('a new install does not version before a sync', s.upsertVersionFirst === false, JSON.stringify(s));
check('a new install hides the Versions feature', s.featureVersions === false, JSON.stringify(s));

store = { [STORAGE_KEY]: { origins: ['https://a'], upsertVersionFirst: true } };
s = await loadSettings();
check('settings saved before the change are turned off once', s.upsertVersionFirst === false, JSON.stringify(s));
check('...and the rest of them are kept', s.origins[0] === 'https://a', JSON.stringify(s));
check('...and Versions stays hidden for them too', s.featureVersions === false, JSON.stringify(s));
check('...and the update is recorded', store[STORAGE_KEY].settingsVersion === 2, JSON.stringify(store));

store[STORAGE_KEY].upsertVersionFirst = true;
s = await loadSettings();
check('turning it back on afterwards sticks', s.upsertVersionFirst === true, JSON.stringify(s));

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
