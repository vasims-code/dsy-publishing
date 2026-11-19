/**
 * Shared description of the image-site-fixer feature. The worker owns the
 * behaviour; the screen draws the images found and holds which are ticked.
 *
 * The site's rule for images: a page's images are in its own site's DAM
 * folder. On /iq_ku, /content/dam/samsung/iq_ku/... - never /lb/... . This
 * finds the ones that break it, uploads the ticked ones to the page's folder
 * and points the page at them.
 */

export default {
  id: 'image-site-fixer',
  title: 'Image Site Code Fixer',
  icon: 'image',
  summary: 'Find images from another site’s DAM folder, upload them to this site’s folder and point the page at them.',

  description:
    'Reads every component of the page and lists the images that sit in another DAM folder - /lb/… on an ' +
    '/iq_ku page - as DAM paths or images.samsung.com addresses. Tick the ones to fix: each is uploaded to the ' +
    'page’s own folder and every reference to it re-pointed. No version is saved; every property is read back afterwards.',

  fields: [
    {
      name: 'page',
      label: 'Page',
      type: 'path',
      placeholder: '/content/samsung/iq_ku/apps/samsung-health',
      required: true,
      prefill: 'currentPage',
      hint: 'Filled in from the page open in this tab. Change it to check another page.'
    },
    {
      name: 'damFolder',
      label: 'This site’s DAM folder',
      type: 'text',
      placeholder: 'the site code',
      required: false,
      hint: 'Leave empty to use the site code. Give it when the site keeps its images under another name.'
    }
  ],

  banner: (p) => [{ label: 'Page', path: p.page }],

  flow: {
    analyze: { action: 'scan', label: 'Scan this page', busy: 'Reading the page…' },
    commit: { action: 'fix', label: 'Fix ticked images', busy: 'Fixing…', back: 'Change page', question: 'Tick the images to fix.' },
    done: { title: 'Done', again: 'Scan again', keepValues: true }
  }
};
