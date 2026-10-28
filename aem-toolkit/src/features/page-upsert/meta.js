/**
 * Shared description of the page-upsert feature. The worker owns the behaviour.
 *
 * One form, two outcomes: the destination page is created if it is not there,
 * and brought back into line with the source if it is. Which of those happens
 * is not a choice the operator makes - it is a fact about the repository - so
 * the panel reads it rather than asking.
 */

export default {
  id: 'page-upsert',
  title: 'Sync page',
  icon: 'sync',
  summary:
    'Copy a page from one locale to another. If the page already exists there, it is updated to match. ' +
    'Links are updated and images uploaded to the destination locale.',

  callout: {
    title: 'Re-pointed at the destination site',
    items: [
      ['link', 'Internal links'],
      ['globe', 'Canonical and hreflang URLs'],
      ['image', 'DAM references — missing assets are uploaded, so AEM and Dynamic Media process them'],
      ['page', 'Twitter handles, title endings and language — read from the destination site’s home page']
    ],
    note:
      'Not there yet: the page is created. Already there: it is updated to match this page - changed text, ' +
      'new components and their order are written, and what this page no longer has is removed (untick the box ' +
      'below to keep it). Text already translated on that page is overwritten too. From a shared site like ' +
      '/global, the review lets you keep its images and links instead of uploading and re-pointing them.'
  },

  description:
    'Enter both paths and analyze. If the destination does not exist it is created ' +
    'from the source; if it does, only the differences are written. Links, canonicals ' +
    'and DAM references are re-pointed at the destination site. Nothing is written ' +
    'until you review what it found and confirm.',

  fields: [
    {
      name: 'source',
      label: 'Source page',
      type: 'path',
      placeholder: '/content/samsung/ae/air-conditioners',
      required: true,
      prefill: 'currentPage',
      hint: 'The page to copy from. Child pages are never read or touched.'
    },
    {
      name: 'dest',
      label: 'Destination page',
      type: 'path',
      placeholder: '/content/samsung/lb/india/backup/air-conditioners',
      required: true,
      hint: 'Full destination path. Its parent must already exist.'
    },
    {
      name: 'srcSite',
      label: 'Source locale folder',
      type: 'path',
      advanced: true,
      placeholder: 'worked out from the path',
      hint:
        'The segment of the path that names the locale — the "uk" in ' +
        '/content/samsung/uk/… . It is read off the path for you, and the analysis ' +
        'header shows which one it used. Fill these in only when a locale is written as ' +
        'more than one segment, like "in/en", which cannot be told apart from a folder ' +
        'sitting inside a locale.'
    },
    {
      name: 'destSite',
      label: 'Destination locale folder',
      type: 'path',
      advanced: true,
      placeholder: 'worked out from the path'
    },
    {
      name: 'allowDeletes',
      label: 'Remove components and properties that no longer exist at the source',
      type: 'checkbox',
      default: true,
      hint:
        'A sync means the destination ends up matching the source, so this is on. ' +
        'Untick it to add and update only, leaving anything the source has since dropped.'
    }
  ],

  /**
   * A two-step flow: `analyze` reads and reports, `commit` writes. The panel
   * only offers commit once analyze has succeeded, and re-locks the form while
   * the analysis is on screen so the paths cannot drift from what was approved.
   */
  flow: {
    analyze: {
      action: 'analyze',
      label: 'Analyze',
      busy: 'Analyzing…'
    },
    commit: {
      action: 'run',
      label: 'Apply changes',
      busy: 'Applying…',
      question: 'Shall I apply these changes?',
      caption:
        'Only the changes listed above are written. With the backup box ticked, the page is ' +
        'backed up under india/backup first - if that fails, nothing is synced. No version is ' +
        'saved first unless you turn that on in settings.'
    },
    done: {
      title: 'Page synced',
      again: 'Sync another page'
    }
  }
};
