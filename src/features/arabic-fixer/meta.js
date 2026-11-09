/**
 * Shared description of the Arabic flipping fixer. The worker owns the
 * behaviour; the screen draws the fields found and holds which are ticked.
 *
 * In Arabic copy, an English or numeric run - 1-120Hz, (2520 × 1080),
 * Wi-Fi 7¹ - is laid out on the wrong side unless an invisible mark holds it.
 * This finds the fields where that happens and adds the marks to the ones you tick.
 */

export default {
  id: 'arabic-fixer',
  title: 'Arabic flipping fixer',
  icon: 'bidi',
  summary: 'Find Arabic text that flips and fix it with invisible LRM/RLM marks.',

  callout: {
    title: 'What this does',
    items: [
      ['deck', 'Reads the page’s copy the way Copy deck does - the same fields, the same added and ignored ones.'],
      ['bidi', 'Finds English and numbers that flip inside Arabic text: 1-120Hz, (2520 × 1080), Wi-Fi 7¹, 1,299 SAR.'],
      ['check', 'Adds invisible marks to the fields you tick, then reads the page back to check.'],
      ['pen', 'Or fixes text you paste - Static (text or HTML) or PDP (specifications) - to copy back by hand.']
    ],
    note:
      'Only Arabic pages are touched - there every field is checked, as a number like 12 MP F2.2 flips even with no Arabic beside it - ' +
      'and only invisible characters are added, plus a decimal comma turned to a dot (1,5 becomes 1.5 and 0,125 becomes 0.125; a price like 1,299 stays): the words stay as they are. ' +
      'A product page’s (PD) copy comes from PIM: paste its specifications into PDP to fix them.'
  },

  description:
    'Reads every copy field of the page, as Copy deck lists them, and finds Arabic text where an English or ' +
    'numeric run would flip. Tick the fields to fix: each gets invisible LRM/RLM marks around its runs, with ' +
    'old and broken marks taken out first. No version is saved; every property is read back afterwards. ' +
    'Text can also be pasted and fixed by hand, Static or PDP, as the Flipping Converter does.',

  fields: [
    {
      name: 'page',
      label: 'Page',
      type: 'path',
      placeholder: '/content/samsung/sa/smartphones/galaxy-s25-ultra',
      required: true,
      prefill: 'currentPage',
      hint: 'Filled in from the page open in this tab. Change it to check another page.'
    }
  ],

  banner: (p) => [{ label: 'Page', path: p.page }],

  flow: {
    analyze: { action: 'scan', label: 'Find flipping text', busy: 'Reading the page…' },
    commit: {
      action: 'fix',
      label: 'Fix ticked fields',
      busy: 'Fixing…',
      back: 'Change page',
      question: 'Tick the fields to fix.'
    },
    done: {
      title: 'Done',
      again: 'Scan again',
      keepValues: true
    }
  }
};
