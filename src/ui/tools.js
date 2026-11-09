/**
 * What the home screen offers.
 *
 * The home screen names seven tools; the engine has nine features, because two
 * of the tools ask one more question before they start. "Copy a page" covers
 * copying within a server and from another one; "Copy deck" covers the export
 * and the import. The chooser screens hold that question, so the home screen
 * stays one row a tool however many features sit behind them.
 */

export const TOOLS = [
  {
    id: 'copy-page',
    icon: 'transfer',
    title: 'Copy a page',
    summary: 'From this server or another one',
    does: 'write',
    features: ['page-upsert', 'page-transfer']
  },
  {
    id: 'backup',
    icon: 'folder',
    title: 'Backup',
    summary: 'Copy this page into the backup folder',
    does: 'write',
    features: ['page-copy']
  },
  {
    id: 'copy-deck',
    icon: 'deck',
    title: 'Copy deck',
    summary: 'Export page text, import translations',
    does: 'read-write',
    features: ['copy-deck', 'copy-deck-import']
  },
  {
    id: 'link-fixer',
    icon: 'link',
    title: 'Relative Link Fixer',
    summary: 'Turn full samsung.com links into relative links',
    does: 'write',
    features: ['link-fixer']
  },
  {
    id: 'arabic-fixer',
    icon: 'bidi',
    title: 'Arabic flipping fixer',
    summary: 'Fix English and numbers that flip in Arabic text',
    does: 'write',
    features: ['arabic-fixer']
  },
  {
    id: 'versions',
    icon: 'history',
    title: 'Versions',
    summary: 'Saved versions of a backup page — restore one',
    does: 'write',
    features: ['page-versions']
  },
  {
    id: 'broken-links',
    icon: 'unlink',
    title: 'Broken Link Finder',
    summary: 'Find CTAs and links missing on author',
    does: 'read',
    features: ['broken-links']
  }
];

export const DOES_LABEL = { read: 'Reads only', write: 'Writes', 'read-write': 'Reads + writes' };

/** A tool is offered only while at least one feature behind it is on. */
export const visibleTools = (metaIds) =>
  TOOLS.filter((t) => t.features.some((f) => metaIds.includes(f)));
