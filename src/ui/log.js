/**
 * The activity log: every line a run reports, kept and shown.
 *
 * Each worker reports as it goes - what it read, what it wrote, what it
 * skipped and why. The panel used to listen only for the progress steps and
 * throw the rest away, so a run that went wrong left nothing behind to read:
 * one error sentence and no account of what had happened before it. A copy
 * that skipped two images because AEM answered 503 said so in a line nobody
 * ever saw.
 *
 * So the lines are collected here, shown under the run, and copyable in one
 * tap - because the next thing anyone does with them is paste them to
 * somebody else.
 */

import { button, el } from './parts.js';

/** Worst first, so a log can be read from the top. */
const RANK = { fail: 0, warn: 1, skip: 2, ok: 3, info: 4 };

/** How a run's lines are collected. `onReport` goes straight to `run.js`. */
export function makeLog(redraw) {
  const lines = [];
  return {
    lines,
    add(level, text) {
      if (!text) return;
      lines.push({ level, text: String(text), at: Date.now() });
      redraw?.();
    },
    clear() {
      lines.length = 0;
    },
    /**
     * A report from a worker. The progress steps ride on the same channel as
     * `data` messages and are drawn elsewhere, so they are left alone here.
     */
    onReport(msg) {
      if (!msg || msg.level === 'data') return;
      this.add(msg.level || 'info', msg.message);
    }
  };
}

/** The log as text, for the clipboard - newest last, as it happened. */
export const logText = (lines) => lines.map((l) => `${l.level.toUpperCase()}  ${l.text}`).join('\n');

/**
 * The log, folded away. `open` when the run did not end well: that is when
 * someone wants it, and making them find it first is one step too many.
 */
export function logBox(lines, { open = false, title = 'Activity log' } = {}) {
  const box = el('details', 'detail log-box');
  if (open) box.open = true;

  const sum = el('summary');
  sum.append(el('span', 'detail-title', title), el('span', 'detail-count', String(lines.length)));
  box.append(sum);

  if (!lines.length) {
    box.append(el('div', 'log-empty', 'Nothing has been reported yet.'));
    return box;
  }

  const body = el('div', 'log-lines');
  for (const line of lines) {
    const row = el('div', 'log-line');
    row.dataset.level = line.level;
    row.append(el('span', 'log-level', line.level), el('span', 'log-text', line.text));
    body.append(row);
  }
  box.append(body);

  const copy = button('Copy the log', 'ghost', async (e) => {
    const b = e.currentTarget;
    const was = b.textContent;
    try {
      await navigator.clipboard.writeText(logText(lines));
      b.textContent = 'Copied';
    } catch {
      b.textContent = 'Could not copy';
    }
    setTimeout(() => {
      b.textContent = was;
    }, 1500);
  });
  copy.classList.add('log-copy');
  box.append(copy);
  return box;
}

/** The worst thing in the log, for a one-line summary beside the heading. */
export function worst(lines) {
  if (!lines.length) return null;
  return [...lines].sort((a, b) => (RANK[a.level] ?? 9) - (RANK[b.level] ?? 9))[0];
}
