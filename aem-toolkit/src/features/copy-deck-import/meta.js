/**
 * Shared description of the copy-deck-import feature: a translated copy deck,
 * checked against a page row by row, then written to it. The panel module
 * draws the paste area, the dry run and the write's steps; the worker reads,
 * plans and writes.
 *
 * Checking reads only. Writing happens only after the operator has read what
 * it will do, and writes exactly that - the worker plans again and refuses if
 * anything differs.
 */

export default {
  id: 'copy-deck-import',
  title: 'Import translation',
  icon: 'layers',
  summary: 'Check a translated copy deck against a page, then write it.',

  callout: {
    title: 'What this does',
    items: [
      ['copy', 'In Excel, press Ctrl+A then Ctrl+C on the translated sheet, and paste it here.'],
      ['page', 'Every row is checked against the page as it is now. You read what would change first.'],
      ['history', 'Writing sends the texts, then reads the page back to check every one.']
    ],
    note:
      'Nothing is written until you confirm, and nothing is ever published. Pasting works where the company DRM ' +
      'encrypts saved files; a file can be chosen instead where it does not. The page is the one the translation ' +
      'is for - usually the copy on the target site.'
  },

  description:
    'Reads the sheet by its headers, so moved or added columns do not matter, and checks each row: is the ' +
    'property still on this page, is its text still what was exported (the Check column), is the translation ' +
    'safe to store - no script or code that runs on a click, no characters lost to a wrong encoding, no Excel ' +
    'error values. Rich text is written as the translation team returned it, tags and links included; a link or a ' +
    'tag that differs from the source is pointed out, not blocked. (A sheet made before v3, with placeholders like ' +
    '<a1>, is checked as then: placeholders kept exactly, no new markup.) A row of a text used in several places holds every place in its Key cell, one per ' +
    'line, and its translation goes to all of them; on an older sheet, rows left blank as "Same as row N" take ' +
    'that row’s translation. The result groups the rows by the sheet’s sections, each with a tick: every text with ' +
    'its old and new value, and why anything is not written - checked for scripts, garbled characters and Excel ' +
    'errors. Only ticked sections are written. A Static Content block’s section starts unticked: ticked, DSY writes ' +
    'its new Body (HTML) and the strings of its script; unticked, the Body can be pasted by hand from its card. Its ' +
    'style sheet is never written. A sheet made by a newer ' +
    'DSY is refused. A field added to the copy deck ' +
    'is read from its row’s Key like any other, so no settings are needed here. Writing then plans again against the ' +
    'live page and stops if anything differs from what you read, stops on a lock held by someone else, writes ' +
    'the texts in one form request (each Static Content field in its own) and reads the page back to check. It never ' +
    'deletes a property, never saves a version and never publishes. A product page (PD), and a sheet ' +
    'exported from one, are refused: their text comes from PIM, and the translations are entered there.',

  fields: [
    {
      name: 'page',
      label: 'Page',
      type: 'path',
      placeholder: '/content/samsung/nl/tvs',
      required: true,
      prefill: 'currentPage',
      hint: 'Filled in from the page open in this tab - the page the translation is for.'
    },
    {
      name: 'sheet',
      label: 'Translated sheet',
      type: 'custom',
      required: true
    }
  ],

  banner: (p) => [{ label: 'Page', path: p.page }],

  flow: {
    analyze: { action: 'check', label: 'Check the translation', busy: 'Checking against the page…' },
    commit: {
      action: 'apply',
      label: 'Write the translations',
      busy: 'Writing…',
      back: 'Change the sheet or page',
      question: 'Write the translations to this page?'
    },
    done: {
      title: 'Translations written',
      again: 'Check again',
      keepValues: true
    }
  }
};
