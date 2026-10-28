/**
 * Shared description of the copy-deck feature. The worker reads the page; the
 * panel module shows what it found, lets the operator pick which groups go on
 * the sheet, and writes the CSV.
 */

export default {
  id: 'copy-deck',
  title: 'Copy deck',
  icon: 'globe',
  summary: 'Export this page’s copy as a sheet for translators.',

  callout: {
    title: 'What this does',
    items: [
      ['page', 'Reads the copy authored on the page - not the rendered page, so no popups or carousel buttons.'],
      ['info', 'A product page (PD) is the exception: its text comes from PIM, so it is read from the page as rendered.'],
      ['layers', 'One row per text, with its section and field. Pick the groups you want on the sheet.'],
      ['lock', 'Reads only. Nothing on the page changes.']
    ],
    note:
      'Translators fill in the last column, Translation. Every row keeps a key back to the property it came from, ' +
      'so the translations can be put back in the right place - leave the Key and Check columns as they are.'
  },

  description:
    'Reads the page’s jcr:content tree and lists every translatable property - headlines, body copy, ' +
    'buttons, link titles, image alt text, disclaimers, page title and SEO fields - in the order the page ' +
    'shows them. English-only analytics values are never included. Line breaks stay inside their cell, and ' +
    'rich text is shown as AEM stores it - every tag and link written out - for the translation team to ' +
    'translate in place. A text used in several places is one row, its translation going to all of them. ' +
    'The components’ dialogs are read too, so a setting is never mistaken for text, and a text field’s length ' +
    'limit goes in the Notes. Text in a Static Content block is listed too, marked to be applied by hand; its ' +
    'script and style sheet (Footer, Header) are code, and never on the sheet. A field ' +
    'that looks like text but is not on the sheet - a new component, a new property - is listed with its value, ' +
    'to add to the sheet or ignore; the choice is kept in Settings. The download is an Excel ' +
    'workbook: sized, wrapped columns, a frozen header, every cell text so Excel changes nothing, the ' +
    'Translation column tinted, and a How to translate tab. It ends with a row that lets an import notice a ' +
    'sheet that came back short. A plain CSV is there too. A product page (made from the page-standard-pd ' +
    'template) holds almost nothing in AEM - its name, gallery, highlights, features and specs come from PIM - so ' +
    'it is read from the page as rendered: each text once, named by where it is on the page and the PIM feature it ' +
    'belongs to, with prices, options, reviews and support left off. A sibling SKU takes only its gallery and ' +
    'specs. Its translations go into PIM, so that sheet cannot be imported.',

  fields: [
    {
      name: 'page',
      label: 'Page',
      type: 'path',
      placeholder: '/content/samsung/za/tvs',
      required: true,
      prefill: 'currentPage',
      hint: 'Filled in from the page open in this tab.'
    }
  ],

  banner: (p) => [{ label: 'Page', path: p.page }],

  flow: {
    analyze: { action: 'read', label: 'Read the copy', busy: 'Reading the page…' },
    commit: {
      action: 'download',
      label: 'Download Excel',
      busy: 'Preparing…',
      back: 'Change page',
      question: 'Download the copy deck?'
    },
    done: {
      title: 'Copy deck downloaded',
      again: 'Read the page again',
      keepValues: true
    }
  }
};
