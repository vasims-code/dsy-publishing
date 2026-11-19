/**
 * Links: the four tools that are all about the links on a page - and the
 * image paths, which are links into the DAM - behind one row on the home
 * screen.
 *
 *   Find broken links              broken-links       reads only
 *   Make links relative            link-fixer         writes
 *   Fix the site code in links     site-code-fixer    writes
 *   Fix the site code in images    image-site-fixer   uploads and writes
 *
 * Drawn the way Copy deck draws its two halves: a card each, and the screen
 * the card leads to is the tool's own, unchanged. Copy a page asks its
 * question as a segmented control instead, because both of its answers run
 * the same form; these four are four different flows, so each keeps its own
 * steps, its own footer and its own worker.
 *
 * Nothing of the work lives here. This file chooses, hands over, and gives
 * the way back.
 */

import { choice, label, whatHappens } from '../parts.js';
import * as brokenLinks from './broken-links.js';
import * as linkFixer from './link-fixer.js';
import * as siteCodeFixer from './site-code-fixer.js';
import * as imageSiteFixer from './image-site-fixer.js';

/* Each way in: the card that offers it, and the screen behind it. `does` is
   the same word the home screen uses, so a read stays a read all the way in. */
const WAYS = [
  {
    id: 'broken-links',
    mod: brokenLinks,
    icon: 'unlink',
    title: 'Find broken links',
    sub: 'Check every button and link on the page, and say which ones point at a page that is not there.',
    does: 'read',
    heading: 'Broken link finder'
  },
  {
    id: 'link-fixer',
    mod: linkFixer,
    icon: 'link',
    title: 'Make links relative',
    sub: 'Turn full addresses like https://www.samsung.com/uk/offers into the short form, /uk/offers.',
    does: 'write',
    heading: 'Relative link fixer'
  },
  {
    id: 'site-code-fixer',
    mod: siteCodeFixer,
    icon: 'globe',
    title: 'Fix the site code in links',
    sub: 'Find links that point into another country’s site and point them at this page’s own site.',
    does: 'write',
    heading: 'Site code link fixer'
  },
  {
    id: 'image-site-fixer',
    mod: imageSiteFixer,
    icon: 'image',
    title: 'Fix the site code in images',
    sub: 'Find images from another country’s DAM folder, upload them to this site’s folder and point the page at them.',
    does: 'write',
    heading: 'Image site code fixer'
  }
];

const wayOf = (id) => WAYS.find((w) => w.id === id) || null;

const TAG = {
  read: { tone: 'read', icon: 'eye', text: 'Reads only · nothing is written' },
  write: { tone: 'write', icon: 'pen', text: 'Changes AEM after you confirm' }
};

export async function render(ctx) {
  const own = ctx.own;
  /* One state per way in, kept apart so a scan of one is never read as the
     other's. All of it goes when the tool is left, with the rest of `own`. */
  if (!own.subs) own.subs = {};

  const goChoice = () => {
    /* A fresh start each time, as Copy deck does when its halves are swapped:
       coming back to a scan of a page you have since left is worse than
       scanning it again. */
    own.subs = {};
    own.way = null;
    ctx.render();
  };
  /* The panel's Back goes from a tool to these cards, and only from the
     cards to the home screen - the same as "All link tools". */
  own.onBack = () => {
    if (!own.way) return false;
    goChoice();
    return true;
  };

  const way = wayOf(own.way);
  if (!way) {
    drawChoice(ctx, (id) => {
      own.way = id;
      ctx.render();
    });
    return;
  }

  /* The way back goes in first, so it is there even if the screen below it
     throws - the shell draws the reason underneath, and this is still the way
     out of it. */
  ctx.view.append(label(way.heading, { text: 'All link tools', onClick: goChoice }));

  const sub = (own.subs[way.id] ||= {});
  await way.mod.render({ ...ctx, own: sub, back: goChoice });
}

/** The four cards, and what the tool is for underneath them. */
function drawChoice(ctx, pick) {
  const { view } = ctx;
  view.append(label('What do you want to do?'));
  view.append(
    ...WAYS.map((w) => choice(w.icon, w.title, w.sub, TAG[w.does], () => pick(w.id)))
  );
  view.append(
    ...whatHappens(
      [
        ['eye', 'Finding broken links only reads. The other three show you every change and wait for you to confirm.'],
        ['deck', 'All four read the page the way Copy deck does, so a link or image is listed under the component and field it sits in.'],
        ['deck', 'All four work on one page. Child pages are never touched.']
      ],
      'The same for all four'
    )
  );
}

/* Exported for the tests, which check the home screen and this screen agree
   on what each way in does. */
export const ways = () => WAYS.map(({ id, title, does }) => ({ id, title, does }));
