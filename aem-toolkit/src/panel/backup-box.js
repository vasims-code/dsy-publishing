/**
 * The review's box on the destination's backup, for Sync page and From another
 * server: the page is about to be written, and its backup under india/backup
 * is missing or not the same as it. Ticked, the backup is taken (or brought up
 * to date) before anything is written to the page; a backup that fails stops
 * the run. Unticked, the run goes ahead without one.
 *
 * `data.backup` is the worker's backupState. The choice is the caller's to keep
 * and send as `backupFirst`; it changes no other part of the plan, so the page
 * is not reviewed again when it changes.
 */
export function renderBackupBox(parent, data, { el, checked, onChange }) {
  const b = data.backup;
  if (!b) return;

  const d = el('details', 'detail');
  d.open = true;
  d.dataset.choice = 'backup';
  const needed = b.state === 'missing' || b.state === 'differs';
  d.dataset.tone = needed ? 'warn' : 'info';
  const sum = el('summary');
  sum.append(el('span', 'detail-mark', needed ? '!' : '•'), el('span', 'detail-title', 'Backup of the destination'));
  d.append(sum);

  const said = {
    missing: `There is no backup at ${b.backup}.`,
    differs: `The backup at ${b.backup} is not the same as this page: ${b.differences?.properties ?? 0} propert${b.differences?.properties === 1 ? 'y' : 'ies'} and ${b.differences?.components ?? 0} component${b.differences?.components === 1 ? '' : 's'} differ.`,
    same: `The backup at ${b.backup} matches this page - nothing to do.`,
    unavailable: `No backup can be taken: ${b.reason}`
  }[b.state];
  d.append(el('p', 'detail-note', said));

  if (needed) {
    const box = el('label', 'check detail-choice');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    box.append(input, el('span', null, b.state === 'missing' ? 'Take a backup first' : 'Update the backup first'));
    sum.after(box);
    d.append(el('p', 'detail-note', 'Taken before anything is written to the page. If it fails, nothing is synced.'));
    if (b.reason) d.append(el('p', 'detail-note', `It may not go through: ${b.reason}`));
  }
  parent.append(d);
}
