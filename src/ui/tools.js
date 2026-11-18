/**
 * What the home screen offers.
 *
 * The home screen names six tools; the engine has ten features, because three
 * of the tools ask one more question before they start. "Copy a page" covers
 * copying within a server and from another one; "Copy deck" covers the export
 * and the import; "Links" covers the three tools that work on the links of a
 * page. The chooser screens hold that question, so the home screen stays one
 * row a tool however many features sit behind them.
 *
 * The order here is the order on the home screen - the user chose it.
 */

export const TOOLS = [
  {
    id: 'backup',
    icon: 'folder',
    title: 'Backup',
    summary: 'Copy this page into the backup folder',
    does: 'write',
    features: ['page-copy']
  },
  {
    id: 'copy-page',
    icon: 'transfer',
    title: 'Copy a page',
    summary: 'From this server or another one',
    does: 'write',
    features: ['page-upsert', 'page-transfer']
  },
  {
    id: 'copy-component',
    icon: 'copy',
    title: 'Copy a component',
    summary: 'Copy one component into another page',
    does: 'write',
    features: ['component-copy']
  },
  {
    id: 'links',
    icon: 'link',
    title: 'Links',
    summary: 'Find broken links, or fix how links are written',
    does: 'read-write',
    features: ['broken-links', 'link-fixer', 'site-code-fixer']
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
];

export const DOES_LABEL = { read: 'Reads only', write: 'Writes', 'read-write': 'Reads + writes' };

/** A tool is offered only while at least one feature behind it is on. */
export const visibleTools = (metaIds) =>
  TOOLS.filter((t) => t.features.some((f) => metaIds.includes(f)));
