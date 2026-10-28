import { loadSettings, saveSettings } from '../core/protocol.js';
import { applyTeamDefaults, exportTeamDefaults } from '../core/team-defaults.js';
import { FIELD_GROUPS } from '../features/copy-deck/core.js';
import { chooseField, forgetField, loadFields, onFieldsChanged, regroupField } from '../features/copy-deck/fields.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let settings;

/* --------------------------------------------------------------- origins */

function normaliseOrigin(raw) {
  let v = String(raw || '').trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

async function renderOrigins() {
  const root = $('origins');
  root.textContent = '';

  if (!settings.origins.length) {
    root.append(el('p', 'note', 'No instances yet. Add one below, or use "Allow this site" in the side panel.'));
    return;
  }

  for (const origin of settings.origins) {
    const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] });

    const row = el('div', 'origin-row');
    row.append(el('span', 'grow', origin));

    const state = el('span', 'state', granted ? 'allowed' : 'permission needed');
    state.dataset.granted = String(granted);
    row.append(state);

    if (!granted) {
      const grant = el('button', null, 'Grant');
      grant.type = 'button';
      grant.addEventListener('click', async () => {
        await chrome.permissions.request({ origins: [`${origin}/*`] });
        await renderOrigins();
      });
      row.append(grant);
    }

    const remove = el('button', null, 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      // Drop the host permission too - leaving it granted for an origin the
      // extension no longer lists is access nobody asked for.
      await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => {});
      settings = await saveSettings({ origins: settings.origins.filter((o) => o !== origin) });
      await renderOrigins();
    });
    row.append(remove);

    root.append(row);
  }
}

async function addOrigin() {
  const input = $('new-origin');
  const origin = normaliseOrigin(input.value);
  if (!origin) {
    input.focus();
    return;
  }
  if (!settings.origins.includes(origin)) {
    settings = await saveSettings({ origins: [...settings.origins, origin] });
  }
  await chrome.permissions.request({ origins: [`${origin}/*`] });
  input.value = '';
  await renderOrigins();
}

/* -------------------------------------------------------------- settings */

function renderSettings() {
  $('feature-versions').checked = settings.featureVersions === true;
  $('versions-save-first').checked = settings.versionsSaveBeforeRestore === true;
  $('backupfolder').value = settings.backupFolder;
  $('marketing').value = settings.marketingTemplate;
  $('rootdepth').value = settings.rootDepth;
  $('verifyshallow').checked = settings.verifyShallow;

  $('upsert-hosts').value = settings.upsertHosts;
  $('upsert-keep').value = settings.upsertKeepAtDest;
  $('upsert-shared').value = settings.upsertSharedSites;
  $('upsert-assets').checked = settings.upsertCopyAssets;
  $('upsert-overwrite').checked = settings.upsertOverwriteAssets;
  $('upsert-reorder').checked = settings.upsertReorder;
  $('upsert-version').checked = settings.upsertVersionFirst;
  $('upsert-strip').checked = settings.upsertStripReplication;
  $('upsert-shop').checked = settings.upsertRewriteShop;

  $('transfer-preserve').value = settings.transferPreserve;
  $('transfer-assets').checked = settings.transferCopyAssets;
  $('transfer-overwrite').checked = settings.transferOverwriteAssets;
}

async function save() {
  const depth = parseInt($('rootdepth').value, 10);
  // Stored as bare segments, so "/india/backup/" and "india/backup" are the same folder.
  const folder = $('backupfolder').value.split('/').map((s) => s.trim()).filter(Boolean).join('/');
  settings = await saveSettings({
    featureVersions: $('feature-versions').checked,
    versionsSaveBeforeRestore: $('versions-save-first').checked,
    backupFolder: folder || settings.backupFolder,
    marketingTemplate: $('marketing').value.trim(),
    rootDepth: Number.isFinite(depth) && depth > 0 ? depth : settings.rootDepth,
    verifyShallow: $('verifyshallow').checked,

    upsertHosts: $('upsert-hosts').value.trim(),
    upsertKeepAtDest: $('upsert-keep').value.trim(),
    upsertSharedSites: $('upsert-shared').value.trim(),
    upsertCopyAssets: $('upsert-assets').checked,
    upsertOverwriteAssets: $('upsert-overwrite').checked,
    upsertReorder: $('upsert-reorder').checked,
    upsertVersionFirst: $('upsert-version').checked,
    upsertStripReplication: $('upsert-strip').checked,
    upsertRewriteShop: $('upsert-shop').checked,

    transferPreserve: $('transfer-preserve').value.trim(),
    transferCopyAssets: $('transfer-assets').checked,
    transferOverwriteAssets: $('transfer-overwrite').checked
  });
  renderSettings();

  const saved = $('saved');
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 1600);
}

/* ---------------------------------------------------- copy deck fields */

const groupSelect = (value) => {
  const s = el('select', 'new-field-group');
  for (const g of FIELD_GROUPS) {
    const o = el('option', null, g.label);
    o.value = g.id;
    o.selected = g.id === value;
    s.append(o);
  }
  return s;
};

function showFieldProblem(message) {
  const p = $('field-problem');
  p.textContent = message || '';
  p.hidden = !message;
}

/** Both lists, as stored now. Every change is saved at once, and redrawn from what was saved. */
function renderFields(fields) {
  const draw = (root, list, added) => {
    root.textContent = '';
    if (!list.length) {
      root.append(el('p', 'note', added ? 'None yet. Add a field from the copy deck, or below.' : 'None.'));
      return;
    }
    for (const f of list) {
      const row = el('div', 'origin-row field-row');
      const name = el('span', 'field-name');
      name.append(el('span', null, `${f.component} · `), el('b', null, f.prop));
      row.append(name);
      if (added) {
        const group = groupSelect(f.group);
        group.setAttribute('aria-label', `Group for ${f.prop}`);
        group.addEventListener('change', () => regroupField(f, group.value).then(renderFields, (e) => showFieldProblem(e.message)));
        row.append(group);
      }
      const remove = el('button', null, 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', () => forgetField(f).then(renderFields, (e) => showFieldProblem(e.message)));
      row.append(remove);
      root.append(row);
    }
  };
  draw($('fields-added'), fields.add, true);
  draw($('fields-ignored'), fields.ignore, false);
}

async function addFieldByHand() {
  showFieldProblem('');
  const kind = $('field-kind').value;
  try {
    renderFields(
      await chooseField(kind, { component: $('field-component').value, prop: $('field-prop').value, group: $('field-group').value })
    );
    $('field-component').value = '';
    $('field-prop').value = '';
  } catch (e) {
    showFieldProblem(e.message);
  }
}

/* ------------------------------------------------------------------ boot */

(async () => {
  settings = await loadSettings();
  renderSettings();
  await renderOrigins();

  for (const g of FIELD_GROUPS) {
    const o = el('option', null, g.label);
    o.value = g.id;
    $('field-group').append(o);
  }
  $('field-group').value = 'copy';
  $('field-kind').addEventListener('change', () => ($('field-group').hidden = $('field-kind').value !== 'add'));
  $('field-add').addEventListener('click', addFieldByHand);
  renderFields(await loadFields());
  // Added or ignored from the side panel while this page is open.
  onFieldsChanged(renderFields);

  $('add').addEventListener('click', addOrigin);
  $('new-origin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addOrigin();
  });
  $('save').addEventListener('click', save);

  const say = (t) => {
    $('defaults-msg').textContent = t;
    $('defaults-msg').hidden = false;
  };
  $('defaults-export').addEventListener('click', async () => {
    const json = JSON.stringify(await exportTeamDefaults(), null, 2);
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'default-settings.json';
    a.click();
    URL.revokeObjectURL(a.href);
    say('Saved. Put default-settings.json in the extension folder, next to manifest.json, then zip it.');
  });
  $('defaults-reset').addEventListener('click', async () => {
    if (!confirm('Put the settings and copy deck fields from the team defaults file back?')) return;
    const done = await applyTeamDefaults({ reset: true });
    if (!done) return say('This extension has no default-settings.json, so there is nothing to reset to.');
    settings = await loadSettings();
    renderSettings();
    await renderOrigins();
    renderFields(await loadFields());
    say('Team defaults applied.');
  });
})();
