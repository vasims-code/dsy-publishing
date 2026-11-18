/**
 * Shared description of the component-copy feature. The worker owns the
 * behaviour; the panel screen draws the form, the review and the result.
 *
 * One component of a page, copied into another page that already exists -
 * with the rules a page copy follows: links and image references re-pointed
 * between sites, images the destination's DAM lacks uploaded. Nothing else
 * on the destination page is changed.
 */

export default {
  id: 'component-copy',
  title: 'Copy a component',
  icon: 'copy',
  summary: 'Copy one component into another page. Links and images follow the destination site.',

  description:
    'Pick a component on the source page and where it goes on the destination - above another component, ' +
    'or at the end of a container. Between two sites its links and image references are re-pointed and ' +
    'missing images uploaded; on the same site it is copied as it is. Nothing is written until you review ' +
    'what it found and confirm.',

  fields: [
    {
      name: 'source',
      label: 'Source page',
      type: 'path',
      placeholder: '/content/samsung/uk/offers/spring-sale',
      required: true,
      prefill: 'currentPage',
      hint: 'Filled in from the page open in this tab.'
    },
    {
      name: 'dest',
      label: 'Destination page',
      type: 'path',
      placeholder: '/content/samsung/lb/offers/spring-sale',
      required: true,
      hint: 'The page the component is added to. It must already exist.'
    }
  ],

  banner: (p) => [
    { label: 'From', path: p.source },
    { label: 'To', path: p.dest }
  ],

  flow: {
    analyze: { action: 'analyze', label: 'Analyze', busy: 'Reading both pages…' },
    commit: { action: 'run', label: 'Copy component', busy: 'Copying…', back: 'Change pages', question: 'Copy this component?' },
    done: { title: 'Component copied', again: 'Copy another', keepValues: true }
  }
};
