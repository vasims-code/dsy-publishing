import test from 'node:test';
import assert from 'node:assert/strict';

let sync, local, file;
globalThis.chrome = {
  runtime: { getURL: (p) => p },
  storage: {
    sync: { get: async (k) => Object.fromEntries([].concat(k).map((x) => [x, sync[x]]).filter(([, v]) => v !== undefined)), set: async (o) => Object.assign(sync, structuredClone(o)) },
    local: { get: async (k) => Object.fromEntries([].concat(k).map((x) => [x, local[x]]).filter(([, v]) => v !== undefined)), set: async (o) => Object.assign(local, o) }
  }
};
globalThis.fetch = async () => ({ ok: !!file, json: async () => file });

const { applyTeamDefaults } = await import('../src/core/team-defaults.js');
const S = 'aemt.settings', A = 'aemt.copyDeck.added';
const reset = () => { sync = {}; local = {}; file = { version: 1, settings: { marketing: 'X', origins: ['https://a'] }, copyDeckAdded: [{ component: 'cm-x', prop: 'title', group: 'copy' }], copyDeckIgnored: [] }; };

test('first install gets everything', async () => {
  reset();
  assert.equal(await applyTeamDefaults(), true);
  assert.equal(sync[S].marketing, 'X');
  assert.deepEqual(sync[S].origins, ['https://a']);
  assert.equal(sync[A].length, 1);
});

test('own settings win, lists merge, applied once', async () => {
  reset();
  sync[S] = { marketing: 'MINE', origins: ['https://b'], settingsVersion: 2 };
  await applyTeamDefaults();
  assert.equal(sync[S].marketing, 'MINE');
  assert.deepEqual(sync[S].origins, ['https://b', 'https://a']);
  sync[S].marketing = 'CHANGED';
  assert.equal(await applyTeamDefaults(), false);
  assert.equal(sync[S].marketing, 'CHANGED');
});

test('newer file version adds only new keys; reset overwrites', async () => {
  reset();
  await applyTeamDefaults();
  sync[S].marketing = 'MINE';
  file = { ...file, version: 2, settings: { marketing: 'X', newKey: 1 } };
  await applyTeamDefaults();
  assert.equal(sync[S].marketing, 'MINE');
  assert.equal(sync[S].newKey, 1);
  await applyTeamDefaults({ reset: true });
  assert.equal(sync[S].marketing, 'X');
});

test('no file does nothing', async () => {
  reset(); file = null;
  assert.equal(await applyTeamDefaults(), false);
});
