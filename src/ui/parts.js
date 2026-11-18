/**
 * The pieces every tool screen is built from, exactly as the design draws
 * them: the step bar, the connection pill, a tone banner, the three counts,
 * a list of label-and-value rows, and the footer that says what pressing the
 * button will do.
 *
 * A tool composes these. None of them knows about AEM.
 */

import { icon } from './icons.js';

export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** Pick · Review · Confirm · Run · Result, with everything reached so far filled. */
export function stepBar(names, currentIndex) {
  const bar = el('div', 'steps');
  names.forEach((name, i) => {
    const step = el('div', 'step');
    if (i < currentIndex) step.dataset.state = 'past';
    else if (i === currentIndex) step.dataset.state = 'now';
    step.append(el('div', 'step-line'), el('div', 'step-name', name));
    bar.append(step);
  });
  return bar;
}

/** Which instance this screen would act on. Pressing it opens settings. */
export function connPill({ host, signedIn, note }) {
  const pill = el('button', 'conn-pill');
  pill.type = 'button';
  pill.dataset.tone = signedIn ? 'ok' : 'warn';
  pill.append(
    icon(signedIn ? 'check' : 'warn', 16, 2.2),
    el('span', 'conn-pill-host', host),
    el('span', 'conn-pill-state', signedIn ? 'Signed in' : note || 'Not signed in')
  );
  pill.addEventListener('click', () => chrome.runtime.openOptionsPage());
  return pill;
}

/**
 * The one thing this screen most needs to say. `read` is the blue
 * "nothing is written"; `write` is the amber promise that something will be.
 */
export function notice(tone, title, body, iconName) {
  const box = el('div', 'notice');
  box.dataset.tone = tone;
  box.append(icon(iconName || (tone === 'write' ? 'pen' : tone === 'warn' ? 'warn' : 'eye'), 20, 2));
  const text = el('div', 'notice-text');
  text.append(el('div', 'notice-title', title));
  if (body) text.append(el('div', 'notice-body', body));
  box.append(text);
  return box;
}

/** Three counts across: what will happen, what wants a look, what will not. */
export function counts(items) {
  const grid = el('div', 'counts');
  /* One or two tiles share the width rather than leaving empty columns. */
  if (items.length && items.length < 3) grid.style.gridTemplateColumns = `repeat(${items.length}, minmax(0, 1fr))`;
  for (const { n, label, tone } of items) {
    const tile = el('div', 'count');
    if (tone) tile.dataset.tone = tone;
    tile.append(el('div', 'count-n', String(n)), el('div', 'count-label', label));
    grid.append(tile);
  }
  return grid;
}

/** A heading over a card, with an optional action on the right. */
export function label(text, action) {
  const row = el('div', 'label');
  row.append(el('div', null, text));
  if (action) {
    const b = el('button', 'label-action', action.text);
    b.type = 'button';
    b.addEventListener('click', action.onClick);
    row.append(b);
  }
  return row;
}

/** One card holding rows; a row is whatever the tool builds. */
export function list(rows) {
  const box = el('div', 'list');
  for (const r of rows) box.append(r);
  return box;
}

/**
 * One way into a tool that has several, as a card of its own: what it is, and
 * what it does to AEM. The home screen stays one row a tool, and the question
 * of which way is asked here instead.
 */
export function choice(iconName, title, sub, tag, onClick) {
  const card = el('button', 'choice');
  card.type = 'button';
  const head = el('div', 'choice-head');
  const ic = el('div', 'choice-icon');
  ic.append(icon(iconName, 22, 1.9));
  const chev = el('span', 'choice-chev');
  chev.append(icon('next', 18, 2));
  head.append(ic, el('div', 'choice-title', title), chev);
  const chip = el('span', 'choice-chip');
  chip.dataset.tone = tag.tone;
  chip.append(icon(tag.icon, 13, 2.4), el('span', null, tag.text));
  const chipRow = el('div');
  chipRow.append(chip);
  card.append(head, el('div', 'choice-sub', sub), chipRow);
  card.addEventListener('click', onClick);
  return card;
}

/**
 * "What happens": a heading over one card, a row for each thing the tool will
 * and will not do, so an author knows before pressing anything. `rows` are
 * [icon name, plain sentence]. Returns the two nodes - spread them into
 * `view.append(...)`.
 */
export function whatHappens(rows, title = 'What happens') {
  const items = rows.map(([iconName, text]) => {
    const row = el('div', 'what-row');
    row.append(icon(iconName, 18, 1.9), el('div', null, text));
    return row;
  });
  return [label(title), list(items)];
}

/** A card with its own heading, as the design draws a section of a review. */
export function titled(text, rows) {
  const box = list(rows);
  box.prepend(el('div', 'list-title', text));
  return box;
}

/** A list drawn as the copy deck's cards are: 20px corners. */
export function cardOf(box) {
  box.classList.add('cd-card');
  return box;
}

/** Grey placeholder rows, for the moment before the page has been read. */
export function skeleton(n) {
  const box = list([]);
  box.classList.add('cd-card');
  const widths = [[45, 70], [58, 61], [71, 52], [49, 68]];
  for (let i = 0; i < n; i++) {
    const [w1, w2] = widths[i % widths.length];
    const row = el('div', 'skel-row');
    row.setAttribute('aria-hidden', 'true');
    const lines = el('div', 'skel-lines');
    const l1 = el('div', 'skel-line');
    l1.style.width = `${w1}%`;
    const l2 = el('div', 'skel-line short');
    l2.style.width = `${w2}%`;
    lines.append(l1, l2);
    row.append(el('div', 'skel-box'), lines);
    box.append(row);
  }
  return box;
}

/** Label on the left, value on the right - the confirm screen's rows. */
export function kv(key, value, mono) {
  const row = el('div', 'kv');
  /* A repository path is long and the panel is 400px wide. Side by side it
     is squeezed into a narrow right-aligned column and breaks mid-word, so a
     path gets its own full-width line under its label instead. */
  if (mono) row.dataset.mono = 'true';
  const v = el('div', 'kv-value', mono ? '' : value);
  if (mono) {
    v.classList.add('mono');
    v.append(...pathParts(value));
  }
  row.append(el('div', 'kv-key', key), v);
  return row;
}

/**
 * A path with a break offered after each slash.
 *
 * Left to itself the browser breaks a long path wherever the line runs out,
 * which lands in the middle of a word - "backup/mo | bile-phone". A <wbr>
 * after every slash means it breaks where a reader would.
 */
export function pathParts(path) {
  const out = [];
  String(path ?? '')
    .split('/')
    .forEach((seg, i, all) => {
      out.push(document.createTextNode(i < all.length - 1 ? `${seg}/` : seg));
      if (i < all.length - 1) out.push(document.createElement('wbr'));
    });
  return out;
}

/** A row that opens the rest of a list. */
export function more(text, onClick) {
  const b = el('button', 'more', text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/**
 * The footer. The tag and the note say what the button will do before it is
 * pressed, which is the whole reason the footer is pinned.
 */
export function footerBar({ tag, note, buttons }) {
  const bits = [];
  if (tag || note) {
    const top = el('div', 'footer-top');
    if (tag) {
      const t = el('span', 'key-tag');
      t.dataset.kind = tag.kind;
      t.append(icon(tag.kind === 'write' ? 'pen' : 'eye', 13, 2.4), el('span', null, tag.text));
      top.append(t);
    } else {
      top.append(el('span'));
    }
    top.append(el('span', 'footer-note', note || ''));
    bits.push(top);
  }
  bits.push(...buttons);
  return bits;
}

/** A button for the footer. */
export function button(text, tone, onClick, { disabled, iconName } = {}) {
  const b = el('button', 'btn');
  b.type = 'button';
  b.dataset.tone = tone;
  b.disabled = !!disabled;
  if (iconName) b.append(icon(iconName, 18, 2.2));
  b.append(el('span', null, text));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** A spinner that sits inside a button while its work runs. */
export function busyButton(text) {
  const b = el('button', 'btn');
  b.type = 'button';
  b.dataset.tone = 'primary';
  b.disabled = true;
  b.append(spinner(), el('span', null, text));
  return b;
}

/**
 * One line of "What is happening", the same on every tool's run screen.
 *
 * A step that is running turns its icon into a spinner. A still picture of a
 * clock face cannot tell you whether the run is working or has hung, which is
 * the one question anyone watching this screen is asking - an upload of a
 * large image can hold a step for minutes with nothing else to show for it.
 */
export function runStep(st) {
  const row = el('div', 'run-step');
  const state = st.state || 'todo';
  row.dataset.state = state;
  row.append(
    state === 'running' ? spinner() : icon(state === 'done' ? 'check' : state === 'failed' ? 'warn' : 'history', 18, 2.2),
    el('span', 'run-step-name', st.name),
    el('span', 'run-step-note', st.note || '')
  );
  return row;
}

/** The first moments of a run, before any step has been named. */
export const startingStep = () => runStep({ name: 'Starting…', state: 'running' });

/** The turning circle itself. `aria-hidden`, because the row says the words. */
export function spinner(cls) {
  const s = el('span', `spinner${cls ? ` ${cls}` : ''}`);
  s.setAttribute('aria-hidden', 'true');
  return s;
}

/**
 * Back to the top of the panel.
 *
 * A step is left by pressing a button at the bottom, so without this the next
 * step arrives already scrolled past - often to empty space, because the new
 * screen is shorter than the one before it. Called on a change of step, never
 * on a redraw, so it never fights a scroll you are in the middle of.
 */
export function toTop() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

/**
 * Open a page in AEM.
 *
 * Most workers hand back a path - "/editor.html/content/...". A transfer
 * hands back a whole URL, because the page it wrote is on the instance it was
 * sent to rather than this tab's. Prefixing the origin either way produced
 * "https://host" + "https://host/editor.html/...".
 */
export function openInAem(origin, urlOrPath) {
  if (!urlOrPath) return;
  const url = /^https?:\/\//i.test(urlOrPath) ? urlOrPath : `${origin || ''}${urlOrPath}`;
  chrome.tabs.create({ url });
}
