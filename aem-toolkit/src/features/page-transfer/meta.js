/**
 * Shared description of the page-transfer feature.
 *
 * The destination is always the server whose tab the panel is attached to, the
 * same as every other feature. The source is a second author instance you are
 * also signed into - picked from the instances you have already enabled, so the
 * feature can never reach an origin you have not granted.
 */

export default {
  id: 'page-transfer',
  title: 'From another server',
  icon: 'server',
  summary: 'Bring a page across from another author instance.',

  callout: {
    title: 'Re-pointed at the destination',
    items: [
      ['link', 'Internal links'],
      ['globe', 'Canonical URLs'],
      ['image', 'DAM image references'],
      ['page', 'Twitter handles, title endings and language — read from the destination site’s home page']
    ],
    note:
      'Images are uploaded, not linked. Page metadata already set at the destination is kept, ' +
      'apart from the Twitter handles once the destination home page names its own.'
  },

  /* Both instances are named on the form, so this feature works from any tab -
   * including one that is not an AEM instance at all. */
  requiresCurrentTab: false,

  /* "Swap source and destination" trades each pair, so the same transfer can
   * be run back the other way. */
  swap: [
    ['sourceOrigin', 'destOrigin'],
    ['source', 'dest'],
    ['srcSite', 'destSite']
  ],

  description:
    'Pick both instances and both paths, from any tab. Then analyze. The page is read from one and ' +
    'written to the other — links, canonicals and DAM references re-pointed at the ' +
    'destination site, and referenced images uploaded. Nothing is written until you ' +
    'review what it found and confirm.',

  fields: [
    {
      name: 'sourceOrigin',
      label: 'Source instance',
      type: 'origin',
      required: true,
      hint: 'Where the page is read from. Add instances in settings.'
    },
    {
      name: 'source',
      label: 'Source page',
      type: 'path',
      placeholder: '/content/samsung/uk/mobile-phone-buying-guide/samsung-fold-vs-flip',
      required: true,
      hint: 'The page to read, on that instance. Child pages are never touched.'
    },
    {
      name: 'destOrigin',
      label: 'Destination instance',
      type: 'origin',
      default: 'current',
      required: true,
      hint: 'Where the page is written. Both instances need a tab open, or one is opened for you.'
    },
    {
      name: 'dest',
      label: 'Destination page',
      type: 'path',
      placeholder: '/content/samsung/lb/mobile-phone-buying-guide/samsung-fold-vs-flip',
      required: true,
      hint: 'Where it goes on the destination instance. Created if it is not there yet.'
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
      label: 'Remove components that no longer exist at the source',
      type: 'checkbox',
      default: true,
      hint: 'Untick to add and update only.'
    }
  ],

  /**
   * Both steps are driven by the feature's own panel module rather than the
   * shell's single request, because each one has to talk to two tabs in turn.
   */
  flow: {
    analyze: { action: 'analyze', label: 'Analyze', busy: 'Reading the source…' },
    commit: {
      action: 'apply',
      label: 'Transfer',
      busy: 'Transferring…',
      question: 'Shall I transfer this page?',
      caption:
        'With the backup box ticked, an existing page is backed up under india/backup first - ' +
        'if that fails, nothing is transferred. An existing destination page is versioned first. Page metadata already set ' +
        'here is left alone for you to edit, apart from the site values listed above.'
    },
    done: { title: 'Page transferred', again: 'Transfer another page' }
  }
};
