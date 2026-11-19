/**
 * Copy a component: one component of a page, into another page - on this
 * server, or from another one.
 *
 * Its own tool on the home screen, and its own feature (component-copy). The
 * screen is Copy a page's, drawn in its component form: the same review, the
 * same confirmation and the same result, because the plan behind it is the
 * same plan narrowed to one component (see features/page-upsert/component.js).
 * Two screens for one plan would drift apart the first time either changed.
 *
 * What differs is chosen in copy-page.js by `componentOnly`: the component and
 * place pickers in place of the whole-page removal box, and its own feature's
 * worker on this server. From another server it goes through the same two-tab
 * transfer as a page (ui/transfer.js), narrowed to the component at both ends.
 */

import * as copyPage from './copy-page.js';

export function render(ctx) {
  return copyPage.render({ ...ctx, componentOnly: true });
}
