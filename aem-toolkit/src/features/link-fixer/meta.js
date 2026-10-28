/**
 * Shared description of the link-fixer feature. The worker owns the
 * behaviour; the panel module draws the links found and holds which are ticked.
 *
 * The site's rule: a link to one of its own pages is authored as a relative
 * path - /uk/mobile-phone-buying-guide/best-smart-watch/ - never as
 * https://www.samsung.com/uk/... . This finds the ones that break it and
 * rewrites the ones you tick.
 */

export default {
  id: 'link-fixer',
  title: 'Relative Link Fixer',
  icon: 'link',
  summary: 'Find links written as full samsung.com URLs and make them relative paths.',

  callout: {
    title: 'What this does',
    items: [
      ['link', 'Finds links in the page content written as https://www.samsung.com/… or an author-server URL.'],
      ['edit', 'Shows each one with the relative path it becomes: /uk/… instead of https://www.samsung.com/uk/….'],
      ['check', 'Fixes only the links you tick, then reads the page back to check.']
    ],
    note:
      'Page properties are not checked. Links to other sites (YouTube, shop.samsung.com, images.samsung.com) are left as full URLs. ' +
      'Text that only mentions www.samsung.com is not a link and is not changed.'
  },

  description:
    'Reads every component of the page and lists the links authored as full URLs to www.samsung.com, ' +
    'samsung.com, or one of your author instances - in link fields, in rich text, and in Static Content HTML. ' +
    'Tick the ones to fix: each becomes its relative path, with the query and #anchor kept. No version is ' +
    'saved; every property is read back afterwards.',

  fields: [
    {
      name: 'page',
      label: 'Page',
      type: 'path',
      placeholder: '/content/samsung/uk/mobile-phone-buying-guide/best-smart-watch',
      required: true,
      prefill: 'currentPage',
      hint: 'Filled in from the page open in this tab. Change it to check another page.'
    }
  ],

  banner: (p) => [{ label: 'Page', path: p.page }],

  flow: {
    analyze: { action: 'scan', label: 'Find full-URL links', busy: 'Reading the page…' },
    commit: {
      action: 'fix',
      label: 'Fix ticked links',
      busy: 'Fixing…',
      back: 'Change page',
      question: 'Tick the links to fix.'
    },
    done: {
      title: 'Done',
      again: 'Scan again',
      keepValues: true
    }
  }
};
