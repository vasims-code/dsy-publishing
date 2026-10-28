/**
 * Shared description of the page-versions feature. The worker owns the
 * behaviour; the panel module draws the list and holds the version picked.
 *
 * Its own feature, on purpose: nothing here is part of a backup or a sync. It
 * reads a page's version history straight from the repository - so versions a
 * customised UI does not show are still listed - and restores or creates a
 * version.
 */

export default {
  id: 'page-versions',
  title: 'Versions',
  icon: 'history',
  // Hidden until "Show the Versions feature" is ticked in settings.
  enabledBy: 'featureVersions',
  summary: 'See every saved version of a page. Restore one, or create a new one.',

  callout: {
    title: 'What this does',
    items: [
      ['history', 'Lists every version saved for the page, read straight from the repository.'],
      ['sync', 'Restore: the page content goes back to the version you pick.'],
      ['layers', 'Create: saves the current content as a new version, with your message.']
    ],
    note:
      'Restore and Create work only on backup pages (under /india/backup/); any page can be listed. ' +
      'Child pages are never changed. A restore saves the current content as a version first only when that is ticked in settings.'
  },

  description:
    'Reads the page’s version history from /jcr:system/jcr:versionStorage, so it lists ' +
    'versions even where the Timeline does not show them. Pick one and restore it: the ' +
    'page’s content is put back to that version. You can also save the current content as ' +
    'a new version with your own message. Only this ' +
    'page’s content ever changes - never its child pages - and every action is read back ' +
    'afterwards to check it landed.',

  fields: [
    {
      name: 'page',
      label: 'Page',
      type: 'path',
      placeholder: '/content/samsung/lb/air-conditioners/wall-mount',
      required: true,
      prefill: 'currentPage',
      hint: 'Filled in from the page open in this tab. Change it to look at another page.'
    }
  ],

  /* The review screen shows the page, not a source and a destination. */
  banner: (p) => [{ label: 'Page', path: p.page }],

  flow: {
    analyze: { action: 'list', label: 'Show versions', busy: 'Reading versions…' },
    commit: {
      action: 'restore',
      label: 'Restore selected version',
      busy: 'Working…',
      back: 'Change page',
      question: 'Pick a version above to restore it.'
    },
    done: {
      title: 'Done',
      again: 'Show versions again',
      // Same page, fresh list: the restore just added a version to it.
      keepValues: true
    }
  }
};
