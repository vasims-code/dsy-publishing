/**
 * Shared description of the broken-links feature. The worker owns the
 * behaviour; the panel screen draws what it finds.
 *
 * The question it answers: of every CTA, link and image on this page, which
 * ones point at something that is not on this author instance? Those are the
 * links QA will send back - found here first, before the page leaves the
 * author's hands.
 */

export default {
  id: 'broken-links',
  title: 'Broken Link Finder',
  icon: 'unlink',
  summary: 'Find CTAs and links that point at pages missing on author.',

  callout: {
    title: 'What this does',
    items: [
      ['link', 'Finds every CTA, link and image in the page content, and the canonical and redirect in its properties.'],
      ['search', 'Looks each one up on this author instance - a site-relative link such as /sa_en/offers/ under the content root.'],
      ['deck', 'Lists what it finds the way the copy deck does: the component as the editor names it, then the field.']
    ],
    note:
      'Nothing is written, and the live site is never asked. Links to other sites are listed but not checked: ' +
      'the question is whether the page exists on author.'
  },

  description:
    'Reads every component of the page and lists where each CTA, link and image points. Each page ' +
    'link is looked up on this author instance - a site-relative link such as /sa_en/offers/ is ' +
    'checked under the content root, /content/samsung/sa_en/offers. Nothing is written, and the ' +
    'live site is never asked.',

  flow: {
    analyze: { action: 'scan', label: 'Scan this page', busy: 'Reading the page…' }
  }
};
