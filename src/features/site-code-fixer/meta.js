/**
 * Shared description of the site-code-fixer feature. The worker owns the
 * behaviour; the screen draws the links found and holds which are ticked.
 *
 * The site's rule: a page links into its own site. On /sa, a link to one of
 * its pages is /sa/smartphones/... - never /ae_ar/smartphones/... or
 * /levant/... . This finds the ones that break it and re-points the ones you
 * tick.
 */

export default {
  id: 'site-code-fixer',
  title: 'Site Code Link Fixer',
  icon: 'globe',
  summary: 'Find links that point into another site and point them at this page’s own site.',

  description:
    'Reads every component of the page and lists the links that point into another site - /ae_ar/… on an ' +
    '/sa page - in link fields, in rich text and in Static Content HTML. Tick the ones to fix: only the ' +
    'site code changes. No version is saved; every property is read back afterwards.',

  fields: [
    {
      name: 'page',
      label: 'Page',
      type: 'path',
      placeholder: '/content/samsung/sa/mobile-phone-buying-guide/is-a-foldable-phone-worth-it',
      required: true,
      prefill: 'currentPage',
      hint: 'Filled in from the page open in this tab. Change it to check another page.'
    }
  ],

  banner: (p) => [{ label: 'Page', path: p.page }],

  flow: {
    analyze: { action: 'scan', label: 'Scan this page', busy: 'Reading the page…' },
    commit: { action: 'fix', label: 'Fix ticked links', busy: 'Fixing…', back: 'Change page', question: 'Tick the links to fix.' },
    done: { title: 'Done', again: 'Scan again', keepValues: true }
  }
};
