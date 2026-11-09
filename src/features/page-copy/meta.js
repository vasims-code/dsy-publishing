/**
 * Shared description of the page-copy feature: what the panel needs to draw the
 * form and drive the two-step flow. The worker owns the behaviour.
 */

import { backupPathFor, globalBackupPathFor, isGlobalPage, typedBackupPath } from '../../core/paths.js';

export default {
  id: 'page-copy',
  title: 'Backup',
  icon: 'copy',
  summary: 'Copy this page into the backup folder, or bring its backup up to date.',

  /* The info box on the form: what the run will and will not do, one line each. */
  callout: {
    title: 'What happens',
    items: [
      ['folder', 'Goes into the backup folder. Missing pages on the way are created empty.'],
      ['page', 'Only this page is copied — child pages are not.'],
      ['link', 'Internal links stay exactly as they are.'],
      ['history', 'If a backup already exists, only the differences are written.']
    ]
  },

  /* What it does, not how to operate it. What is not obvious is where the
   * backup goes, that intermediates get created, that child pages do not come
   * across, and that an existing backup is updated rather than replaced. */
  description:
    'Copies a page into the backup folder on this same server. The destination is worked ' +
    'out from the source path. A global page goes into the backup folder of the site you type, ' +
    'with /global/hq/vd dropped from its path. Any pages missing along the way are created first, as empty ' +
    'shells. The page itself comes across with all of its content, but NOT its child pages, ' +
    'and the links inside it are left exactly as they are. If the backup already exists, ' +
    'the analysis offers to update it instead: only what differs from the source is written. ' +
    'The backup page is not versioned. If it already matches the source, nothing is written.',

  fields: [
    {
      name: 'source',
      label: 'Source page',
      type: 'path',
      placeholder: '/content/samsung/levant/home-appliances/buying-guide/microwaves',
      required: true,
      prefill: 'currentPage',
      /* Only a page that has a backup location. A page already inside the
       * backup folder - the backup just opened from the done screen, say - is
       * left out rather than offered and then refused. */
      prefillIf: (path, settings) => {
        try {
          backupPathFor(path, settings.rootDepth, settings.backupFolder);
          return true;
        } catch {
          return false;
        }
      },
      hint: 'Filled in from the page open in this tab. Change it to back up a different page.'
    },
    {
      /* A global page has no backup folder of its own: it goes into the backup
       * folder of the site typed here. Only shown for a global page. */
      name: 'targetSite',
      label: 'Target site',
      type: 'text',
      placeholder: 'levant',
      showIf: ({ source }, settings) => isGlobalPage(source, settings.rootDepth),
      hint: 'A global page is backed up into another site\'s backup folder. Type just the site name, e.g. levant.'
    },
    {
      name: 'dest',
      label: 'Destination page',
      type: 'derived',
      placeholder: 'Filled in from the source page',
      /* Shown, not typed: the worker derives the same path again and ignores
       * whatever the panel sends, so what is displayed is what gets written. */
      derive: ({ source, targetSite }, settings) => {
        if (!source) return '';
        if (!isGlobalPage(source, settings.rootDepth)) {
          return backupPathFor(source, settings.rootDepth, settings.backupFolder);
        }
        return targetSite ? globalBackupPathFor(source, targetSite, settings.rootDepth, settings.backupFolder) : '';
      },
      /* The pencil, for a global page only: typed in full instead - starting
       * from what was derived - and checked by the worker, which uses it only
       * for a global page. `editDest` says which one the run uses. */
      editableIf: ({ source }, settings) => isGlobalPage(source, settings.rootDepth),
      editFlag: 'editDest',
      editablePlaceholder: '/content/samsung/levant/india/backup/tvs/tv-buying-guide/tv-comparison-guide',
      check: ({ source, dest }, settings) => typedBackupPath(source, dest, settings.rootDepth, settings.backupFolder),
      hint: ({ source, editDest }, settings) => {
        if (!isGlobalPage(source, settings.rootDepth)) {
          return 'The source path with the backup folder inserted under the site root. Change the folder in settings.';
        }
        return editDest === 'true'
          ? 'Typed by hand: it must be inside a site\'s backup folder and end in the same page name. ' +
              'Tick to finish; the undo button goes back to the path worked out for you.'
          : 'The target site\'s backup folder, then the source path without /global/hq/vd. ' +
              'Use the pencil if this backup needs a different path.';
      }
    }
  ],

  /**
   * A two-step flow: `analyze` reads and reports, `commit` writes. The panel
   * only offers commit once analyze has succeeded, and re-locks the form while
   * the analysis is on screen so the paths cannot drift from what was approved.
   */
  flow: {
    analyze: {
      action: 'analyze',
      label: 'Analyze paths',
      busy: 'Analyzing…'
    },
    commit: {
      action: 'run',
      label: 'Create the backup',
      busy: 'Copying…',
      question: 'Shall I create this backup?',
      caption: 'This creates the pages listed above and copies the requested page into place.'
    },
    /* Picked by the analysis (its `variant`), replacing the commit wording
     * above - the button has to say which of the two things it will do. */
    variants: {
      update: {
        label: 'Update the backup',
        busy: 'Updating…',
        question: 'The backup already exists. Shall I update its content?',
        caption:
          'Only the differences listed above are written. The backup page is not versioned ' +
          'first, so the content it has now is replaced.'
      },
      /* The backup already matches the source: there is nothing to run, and the
       * button says so rather than offering to do nothing. */
      current: {
        label: 'Nothing to update',
        question: 'The backup already matches the source.',
        caption: 'Nothing will be written.',
        disabled: true
      }
    },
    done: { title: 'Backup ready', again: 'Back up another page' }
  }
};
