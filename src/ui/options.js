/**
 * The settings page.
 *
 * Every setting the engine reads is here, under the heading of the tool that
 * reads it. Nothing is invented: each one is a key the workers ask for, and
 * the wording says what it does rather than naming the key.
 *
 * The copy deck field lists and the team defaults save themselves; everything
 * else waits for Save, because a half-typed path should not reach a run.
 */

import { LOCALE_OWNED, loadSettings, saveSettings } from '../core/protocol.js';
import { THEMES, applyTheme, watchTheme } from './theme.js';
import { KEEP_NODES } from '../core/diff.js';
import { SYSTEM_PROPS } from '../core/rewrite.js';
import { PAGE_METADATA } from '../features/page-transfer/worker.js';
import { applyTeamDefaults, exportTeamDefaults } from '../core/team-defaults.js';
import { FIELD_GROUPS } from '../features/copy-deck/core.js';
import { pdTemplates } from '../features/copy-deck/pd.js';
import { DEFAULT_NAMES, DEFAULT_UNITS, parseList } from '../features/arabic-fixer/bidi.js';
import { chooseField, forgetField, loadFields, onFieldsChanged, regroupField } from '../features/copy-deck/fields.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let settings;

/* ------------------------------------------------------------- controls */

/** A labelled text box inside a card. */
function field(key, labelText, hint, { placeholder = '', number = false, min = 1, max = 10 } = {}) {
  const wrap = el('div', 'field');
  wrap.append(el('div', 'field-label', labelText));
  const input = el('input');
  input.type = number ? 'number' : 'text';
  if (number) {
    input.min = String(min);
    input.max = String(max);
  }
  input.id = `set-${key}`;
  input.spellcheck = false;
  input.placeholder = placeholder;
  input.value = settings[key] ?? '';
  input.setAttribute('aria-label', labelText);
  wrap.append(input);
  if (hint) wrap.append(el('div', 'field-hint', hint));
  return wrap;
}

/**
 * Names the code decides for itself, shown rather than left to be guessed at.
 *
 * Read-only on purpose. A copy with `jcr:uuid` or `jcr:primaryType` carried
 * across is not a page, so these are not a preference; the editable field
 * above each block is where anything else goes. Shown so that "it did not
 * copy that property" has an answer on this page instead of in the source.
 */
function fixedList(labelText, hint, names) {
  const wrap = el('div', 'field');
  wrap.append(el('div', 'field-label', labelText));
  const chips = el('div', 'chips');
  for (const n of names) chips.append(el('code', 'chip', n));
  wrap.append(chips);
  if (hint) wrap.append(el('div', 'field-hint', hint));
  return wrap;
}

/** A tick box with its own explanation. */
function check(key, title, hint) {
  const wrap = el('label', 'check-row');
  const box = el('input');
  box.type = 'checkbox';
  box.id = `set-${key}`;
  box.checked = settings[key] === true;
  box.setAttribute('aria-label', title);
  const text = el('div', 'check-text');
  text.append(el('div', 'check-title', title));
  if (hint) text.append(el('div', 'check-hint', hint));
  wrap.append(box, text);
  return wrap;
}

/** A comma-separated list, shown as the built-in one while nothing else is stored. */
function listField(key, labelText, hint, defaults) {
  const wrap = field(key, labelText, hint);
  wrap.querySelector('input').value = parseList(settings[key]).join(', ') || defaults.join(', ');
  return wrap;
}

/* Stored empty while it is the built-in list, so a later change to that list reaches it. */
const listValue = (key, defaults) => {
  const list = parseList(val(key));
  return !list.length || list.join('|') === defaults.join('|') ? '' : list.join(', ');
};

const val = (key) => $(`set-${key}`)?.value ?? '';
const ticked = (key) => $(`set-${key}`)?.checked === true;

/* ------------------------------------------------------------- origins */

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
    root.append(el('p', 'soon', 'No instances yet. Add one below, or use "Allow this site" in the side panel.'));
    return;
  }

  for (const origin of settings.origins) {
    /* Chrome throws on a pattern it cannot read - a bare host stored before
       team defaults were checked. One bad entry must not stop the list. */
    const granted = await Promise.resolve()
      .then(() => chrome.permissions.contains({ origins: [`${origin}/*`] }))
      .catch(() => false);

    const row = el('div', 'origin');
    row.append(el('span', 'host', origin));

    const state = el('span', 'state', granted ? 'allowed' : 'permission needed');
    state.dataset.granted = String(granted);
    row.append(state);

    if (!granted) {
      const grant = el('button', 'pill-btn', 'Grant');
      grant.type = 'button';
      grant.addEventListener('click', async () => {
        await chrome.permissions.request({ origins: [`${origin}/*`] });
        await renderOrigins();
      });
      row.append(grant);
    }

    const remove = el('button', 'pill-btn', 'Remove');
    remove.type = 'button';
    remove.dataset.tone = 'quiet';
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

/* ------------------------------------------------------------ appearance */

function renderTheme() {
  const box = $('theme-box');
  box.textContent = '';
  const now = settings.theme || 'system';
  for (const [id, text] of THEMES) {
    const b = el('button', 'segment', text);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(now === id));
    b.addEventListener('click', async () => {
      applyTheme(id);
      settings = await saveSettings({ theme: id });
      renderTheme();
    });
    box.append(b);
  }
}

/* ------------------------------------------------ product page templates */

function renderPdTemplates() {
  const root = $('pd-templates');
  root.textContent = '';
  for (const path of pdTemplates(settings.pdTemplates)) {
    const row = el('div', 'origin');
    row.append(el('span', 'host', path));
    const remove = el('button', 'pill-btn', 'Remove');
    remove.type = 'button';
    remove.dataset.tone = 'quiet';
    remove.addEventListener('click', async () => {
      const left = pdTemplates(settings.pdTemplates).filter((t) => t !== path);
      // The last one stays: with none, no page would be read as a product page.
      if (!left.length) {
        problem('Keep at least one template. Add the new one before removing this.');
        return;
      }
      settings = await saveSettings({ pdTemplates: left });
      problem('');
      renderPdTemplates();
    });
    row.append(remove);
    root.append(row);
  }
}

function problem(text) {
  const p = $('pd-template-problem');
  p.textContent = text;
  p.hidden = !text;
}

async function addPdTemplate() {
  const input = $('new-pd-template');
  const path = input.value.trim().replace(/\/+$/, '');
  if (!/^\/conf\/[^/]+\/.+/.test(path)) {
    problem('Give the full template path, starting /conf/ - for example /conf/consumer/settings/wcm/templates/page-standard-pd.');
    input.focus();
    return;
  }
  const now = pdTemplates(settings.pdTemplates);
  if (!now.includes(path)) settings = await saveSettings({ pdTemplates: [...now, path] });
  input.value = '';
  problem('');
  renderPdTemplates();
}

/* ------------------------------------------------------------- the rest */

function renderSettings() {
  $('versions-box').replaceChildren(
    check(
      'versionsSaveBeforeRestore',
      'When restoring, save the current content as a version first',
      'Keeps a way back from a restore. Off by default, so a restore adds no version of its own.'
    )
  );

  $('backup-box').replaceChildren(
    field(
      'backupFolder',
      'Backup folder',
      'Inserted directly under the site root: /content/samsung/levant/tvs is backed up to /content/samsung/levant/india/backup/tvs.',
      { placeholder: 'india/backup' }
    ),
    field(
      'marketingTemplate',
      'Template for pages with no source counterpart',
      'Used for inserted path segments that do not exist in the source.'
    ),
    field('rootDepth', 'Site root depth', 'How many leading path segments must already exist. 3 means /content/<brand>/<locale> is never created by DSY.', {
      number: true
    }),
    check('verifyShallow', 'After copying, check that no child pages came across')
  );

  $('upsert-box').replaceChildren(
    field(
      'upsertHosts',
      'Extra hosts to rewrite',
      'Comma separated. www.samsung.com is always included. A canonical pointing at a host that is not listed is reported but left alone.',
      { placeholder: 'cdn.example.com, author.example.com' }
    ),
    field(
      'upsertKeepAtDest',
      'Destination properties never overwritten',
      'Comma separated. These belong to the destination, not the source — hreflangGroup is the usual one.'
    ),
    field(
      'upsertSharedSites',
      'Sites whose images and links can be kept',
      'Comma separated. A page copied from one of these shows two tick boxes on the review: untick them to keep pointing at that site’s images or links instead of uploading and re-pointing them.',
      { placeholder: 'global' }
    ),
    field(
      'upsertKeepNodes',
      'Destination components never overwritten',
      'Comma separated node names. The component equivalent of the properties above - cq:LiveSyncConfig and cq:annotations are always kept.'
    ),
    fixedList(
      'Never copied, whatever is set above',
      'Written by AEM itself, or meaningless at a new location: version and lock state, who ' +
        'changed the page and when, and the replication and rollout dates.',
      SYSTEM_PROPS
    ),
    fixedList(
      'Always kept as the destination has them',
      'What belongs to the destination locale rather than to the page. Added to whatever is ' +
        'listed above.',
      LOCALE_OWNED
    ),
    fixedList(
      'Components always kept',
      'Added to whatever is listed above. MSM’s live-copy configuration and the page’s ' +
        'annotations belong to the destination page, not to the source.',
      KEEP_NODES
    ),
    check('upsertCopyAssets', 'Upload referenced DAM assets that are missing at the destination'),
    check('upsertOverwriteAssets', 'Upload again, over assets that are already at the destination'),
    check('upsertReorder', 'Fix component order to match the source'),
    check(
      'upsertVersionFirst',
      'Version a backup page before writing to it',
      'Only pages under the backup folder. Versions can only be restored on those, so a version ' +
        'taken anywhere else is a restore point this extension cannot use.'
    ),
    check('upsertStripReplication', 'Clear inherited replication state on a newly created page'),
    check('upsertRewriteShop', 'Rewrite shop.samsung.com links too')
  );

  $('transfer-box').replaceChildren(
    field(
      'transferPreserve',
      'Also keep as it is at the destination',
      'Comma separated, added to the list below. Anything else this locale owns and maintains ' +
        'itself.',
      { placeholder: 'pageTrackDepth2, hreflangGroup' }
    ),
    field(
      'transferMaxImageMb',
      'Biggest image to carry, in MB',
      'An image over this is left where it is and listed to do by hand - the page still goes across ' +
        'pointing at where the image belongs. Large uploads are what AEM refuses, and a refused one ' +
        'costs the whole wait before the run gives up on it. 256 at most; a content package is the ' +
        'right tool above that.',
      { number: true, min: 1, max: 256, placeholder: '25' }
    ),
    fixedList(
      'Kept as the destination has them, always',
      'A locale’s own wording and its own place in its site cannot be worked out from ' +
        'another locale’s. A page being created has nothing to keep, so it gets the ' +
        'source’s as a starting point to edit. Everything under "Copy a page" applies here ' +
        'too — the same engine does the writing.',
      [...PAGE_METADATA, ...LOCALE_OWNED]
    ),
    check('transferCopyAssets', 'Upload referenced images that are not at the destination yet'),
    check('transferOverwriteAssets', 'Re-upload images that are already there')
  );

  $('arabic-box').replaceChildren(
    listField(
      'arabicUnits',
      'Units',
      'Comma separated, capitals ignored. A number and one of these are kept together as one run, with or ' +
        'without a space - 256GB, 5000 mAh, (2520 × 1080 mm). A unit made of letters is caught even when it is ' +
        'not listed; add units written with symbols, such as °C or µm.',
      DEFAULT_UNITS
    ),
    listField(
      'arabicNames',
      'Feature names',
      'Comma separated, written exactly as on the page. Each is kept as one run wherever it stands in Arabic ' +
        'text, so a footnote mark after it - Audio Eraser* - stays on its side.',
      DEFAULT_NAMES
    )
  );

  $('links-box').replaceChildren(
    field(
      'linkSiteHosts',
      'Hosts that are this site',
      'Comma separated. A full address on one of these hosts - https://www.samsung.com/sa_en/… - is read ' +
        'as a link into this content tree and checked on author. www.samsung.com and every author instance ' +
        'above are always included. Any other host is listed as external and never asked.',
      { placeholder: 'shop.samsung.com, uat.samsung.com' }
    )
  );
}

/* Out of range, or not a number at all, keeps what is stored rather than
   writing a limit nobody meant - an empty box is not "carry nothing". */
function maxImageMb() {
  const n = parseInt(val('transferMaxImageMb'), 10);
  return Number.isFinite(n) && n >= 1 && n <= 256 ? n : settings.transferMaxImageMb;
}

async function save() {
  const depth = parseInt(val('rootDepth'), 10);
  // Stored as bare segments, so "/india/backup/" and "india/backup" are one folder.
  const folder = val('backupFolder').split('/').map((s) => s.trim()).filter(Boolean).join('/');

  settings = await saveSettings({
    versionsSaveBeforeRestore: ticked('versionsSaveBeforeRestore'),

    backupFolder: folder || settings.backupFolder,
    marketingTemplate: val('marketingTemplate').trim(),
    rootDepth: Number.isFinite(depth) && depth > 0 ? depth : settings.rootDepth,
    verifyShallow: ticked('verifyShallow'),

    upsertHosts: val('upsertHosts').trim(),
    upsertKeepAtDest: val('upsertKeepAtDest').trim(),
    upsertSharedSites: val('upsertSharedSites').trim(),
    upsertKeepNodes: val('upsertKeepNodes').trim(),
    upsertCopyAssets: ticked('upsertCopyAssets'),
    upsertOverwriteAssets: ticked('upsertOverwriteAssets'),
    upsertReorder: ticked('upsertReorder'),
    upsertVersionFirst: ticked('upsertVersionFirst'),
    upsertStripReplication: ticked('upsertStripReplication'),
    upsertRewriteShop: ticked('upsertRewriteShop'),

    transferPreserve: val('transferPreserve').trim(),
    transferMaxImageMb: maxImageMb(),
    transferCopyAssets: ticked('transferCopyAssets'),
    transferOverwriteAssets: ticked('transferOverwriteAssets'),

    arabicUnits: listValue('arabicUnits', DEFAULT_UNITS),
    arabicNames: listValue('arabicNames', DEFAULT_NAMES),

    linkSiteHosts: val('linkSiteHosts').trim()
  });
  renderSettings();

  const saved = $('saved');
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 1600);
}

/* --------------------------------------------------- copy deck fields */

function groupSelect(value) {
  const s = el('select');
  for (const g of FIELD_GROUPS) {
    const o = el('option', null, g.label);
    o.value = g.id;
    o.selected = g.id === value;
    s.append(o);
  }
  return s;
}

function showFieldProblem(message) {
  const p = $('field-problem');
  p.textContent = message || '';
  p.hidden = !message;
}

/** Both lists, as stored now. Every change is saved at once and redrawn from what was saved. */
function renderFields(fields) {
  const draw = (root, list, added) => {
    root.textContent = '';
    if (!list.length) {
      root.append(el('p', 'soon', added ? 'None yet. Add a field from the copy deck, or below.' : 'None.'));
      return;
    }
    for (const f of list) {
      const row = el('div', 'field-row');
      const name = el('span', 'name');
      name.append(el('span', null, `${f.component} · `), el('b', null, f.prop));
      row.append(name);

      if (added) {
        const group = groupSelect(f.group);
        group.setAttribute('aria-label', `Group for ${f.prop}`);
        group.addEventListener('change', () =>
          regroupField(f, group.value).then(renderFields, (e) => showFieldProblem(e.message))
        );
        row.append(group);
      }

      const remove = el('button', 'pill-btn', 'Remove');
      remove.type = 'button';
      remove.dataset.tone = 'quiet';
      remove.addEventListener('click', () =>
        forgetField(f).then(renderFields, (e) => showFieldProblem(e.message))
      );
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
    const fields = await chooseField(kind, {
      component: $('field-component').value,
      prop: $('field-prop').value,
      group: $('field-group').value
    });
    $('field-component').value = '';
    $('field-prop').value = '';
    renderFields(fields);
  } catch (e) {
    showFieldProblem(e.message);
  }
}

/* -------------------------------------------------------- team defaults */

function sayDefaults(text) {
  const n = $('defaults-msg');
  n.textContent = text;
  n.hidden = !text;
  if (text) setTimeout(() => (n.hidden = true), 4000);
}

/* ---------------------------------------------------------------- boot */

/** The installed version, from the manifest Chrome loaded - not a copy of it that could drift. */
function showVersion() {
  const version = globalThis.chrome?.runtime?.getManifest?.()?.version;
  if (!version) return;
  const badge = $('version');
  badge.textContent = `Version ${version}`;
  badge.title = 'The installed version of DSY';
  badge.hidden = false;
}

async function boot() {
  $('brand').append(icon('yard', 20, 2));
  showVersion();

  watchTheme();
  settings = await loadSettings();
  renderTheme();
  await renderOrigins();
  renderPdTemplates();
  renderSettings();

  $('add').addEventListener('click', addOrigin);
  $('add-pd-template').addEventListener('click', addPdTemplate);
  $('new-pd-template').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPdTemplate();
  });
  $('new-origin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addOrigin();
  });
  $('save').addEventListener('click', save);

  for (const g of FIELD_GROUPS) {
    const o = el('option', null, g.label);
    o.value = g.id;
    $('field-group').append(o);
  }
  $('field-group').value = 'copy';
  $('field-kind').addEventListener('change', () => {
    $('field-group').hidden = $('field-kind').value !== 'add';
  });
  $('field-add').addEventListener('click', addFieldByHand);
  renderFields(await loadFields());
  onFieldsChanged(renderFields);

  $('defaults-export').addEventListener('click', async () => {
    try {
      /* Built, then handed over twice: copied, because a downloaded file can be
         encrypted on its way to disk (NASCA) and pasting always works; and
         downloaded, for whoever can use the file as it is. */
      const text = JSON.stringify(await exportTeamDefaults(), null, 2) + '\n';
      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        // No clipboard here: the download alone.
      }
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'default-settings.json';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      sayDefaults(copied ? 'Copied to the clipboard, and downloaded as default-settings.json.' : 'default-settings.json downloaded.');
    } catch (e) {
      sayDefaults(e.message);
    }
  });
  $('defaults-reset').addEventListener('click', async () => {
    try {
      const applied = await applyTeamDefaults({ reset: true });
      settings = await loadSettings();
      await renderOrigins();
      renderSettings();
      renderFields(await loadFields());
      /* What the file held that Settings would not take is said, not dropped
         in silence - otherwise a team value that never arrives looks like a bug. */
      const dropped = applied?.dropped || [];
      sayDefaults(
        dropped.length
          ? `Settings put back to the team defaults. Left out, as Settings would not take them: ${dropped.join('; ')}.`
          : 'Settings put back to the team defaults.'
      );
    } catch (e) {
      sayDefaults(e.message);
    }
  });
}

boot();
