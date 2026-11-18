/**
 * component-copy: one component of a page, copied into another page.
 *
 * Its own feature, with its own row on the home screen - but not its own
 * copier. The plan is Copy a page's (page-upsert's buildPlan), narrowed to
 * one component by ../page-upsert/component.js when `params.component` is
 * set. So a component gets exactly what a page gets: links and image
 * references re-pointed between sites, missing images uploaded, the lock
 * check, one write and the read-back. Two features copying the same content
 * by two sets of rules would drift apart; this keeps them one.
 *
 * What this file adds is the refusal: every action here is about a component,
 * so one sent without a component is refused rather than run as a page copy.
 */

import { abort } from '../../core/aem-client.js';
import { actions as page } from '../page-upsert/worker.js';

/** A component and a place for it, or a refusal - never a whole-page copy by omission. */
function needComponent(params) {
  const c = params?.component;
  if (!c || typeof c !== 'object' || !c.from) throw abort('Choose the component to copy.');
  if (!c.before && !c.into) throw abort('Choose where on the destination page the component goes.');
  return params;
}

export const actions = {
  /** Reads only. Both pages' components, in page order, for the two pickers. */
  components: (args) => page.components(args),

  /** Reads only. The review: what the component brings, and where it lands. */
  analyze: (args) => page.analyze({ ...args, params: needComponent(args.params) }),

  /** Writes. The plan is worked out again first, as a page copy's is. */
  run: (args) => page.run({ ...args, params: needComponent(args.params) })
};
