/**
 * Copying one component instead of a whole page.
 *
 * Copy a page plans a page's whole jcr:content: read both trees, diff them,
 * rewrite links and image paths, upload what the destination's DAM lacks,
 * write it in one request and read it back. Copying a component is the same
 * work on a smaller tree, so it is done by the same plan - this module only
 * narrows what that plan sees:
 *
 *   the source       the chosen component and everything under it, moved to
 *                    where it will sit on the destination page
 *   the destination  the whole page, untouched, so nothing on it is changed
 *                    or removed and the new component is simply added
 *
 * The component always arrives as a new node, placed above the component an
 * author picked on the destination (or at the end of a container). If its
 * name is taken there, it gets the next free one - "_copy", "_copy_2" - so
 * an existing component is never overwritten by a component copy.
 *
 * Pure - no network, no DOM - so a test in Node runs exactly this.
 */

const parentRel = (rel) => rel.slice(0, rel.lastIndexOf('/'));
const nameOf = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
const under = (rel, top) => rel === top || rel.startsWith(`${top}/`);

/* A layout container: it holds components rather than being one an author
   would pick to copy on its own. Listed as a place to put one instead. */
const CONTAINER = /(^|\/)(responsivegrid|container|parsys)$/;
export const isContainer = (props) => CONTAINER.test(String(props?.['sling:resourceType'] || ''));

/**
 * The components of a page, in page order, as the picker lists them:
 * { rel, name, resourceType, type, headline, depth, container }. Read off a
 * page tree as readPageTree returns it ({ tree, order }, rels from '').
 * Only nodes with a sling:resourceType are components; the page's own root
 * container is where everything sits, not something to pick.
 */
export function listComponents({ tree, order }) {
  const out = [];
  const walk = (rel, depth) => {
    for (const name of order[rel] || []) {
      const child = `${rel}/${name}`;
      const props = tree[child];
      if (!props) continue;
      const rt = props['sling:resourceType'];
      if (rt && child !== '/root') {
        out.push({
          rel: child,
          name,
          resourceType: rt,
          type: String(rt).split('/').pop(),
          headline: headlineOf(tree, child),
          depth,
          container: isContainer(props)
        });
      }
      walk(child, rt && child !== '/root' ? depth + 1 : depth);
    }
  };
  walk('', 0);
  return out;
}

/* The words an author knows a component by: its headline, else the first
   headline below it - a feature benefit keeps its words in carousel1. */
const HEADLINE_PROPS = ['headlineText', 'desktopHeadlineText', 'subHeadlineText', 'subHeadLineText', 'title', 'jcr:title'];
function headlineOf(tree, top) {
  const rels = Object.keys(tree).filter((r) => under(r, top));
  for (const r of rels) {
    for (const p of HEADLINE_PROPS) {
      const v = tree[r]?.[p];
      if (typeof v !== 'string' || !v.trim()) continue;
      const t = v.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      if (t) return t.length > 60 ? `${t.slice(0, 59)}…` : t;
    }
  }
  return null;
}

/** The first name free in `taken`: the name itself, then name_copy, name_copy_2, … */
export function freeName(name, taken) {
  const has = new Set(taken);
  if (!has.has(name)) return name;
  if (!has.has(`${name}_copy`)) return `${name}_copy`;
  for (let i = 2; ; i++) if (!has.has(`${name}_copy_${i}`)) return `${name}_copy_${i}`;
}

/**
 * The plan's two trees for copying one component.
 *
 *   src     { tree, order } of the source page (readPageTree)
 *   dest    { tree, order } of the destination page
 *   from    the component's rel on the source page: "/root/responsivegrid/cm_x"
 *   before  the rel of the destination component it goes above, or
 *   into    the rel of a destination container it goes at the end of
 *
 * Returns { src, dest, info } where `src` holds only the component, already
 * at its new rel, and `dest` is the destination page as it is. `src.order`
 * also names the container's children in their new order, so the plan places
 * the new node with Sling's :order - nothing else in the container moves.
 * Anything that would put the copy somewhere it cannot go is refused.
 */
export function scopeToComponent({ src, dest, from, before = null, into = null }) {
  const at = String(from || '');
  if (!at || at === '/root' || !src.tree[at]) throw new Error(`The component to copy is not on the source page: ${at || '(none chosen)'}`);
  if (!src.tree[at]['sling:resourceType']) throw new Error(`${at} is not a component: it has no sling:resourceType.`);

  let container;
  let anchor = null;
  if (before) {
    if (!dest.tree[before] || before === '/root') throw new Error(`The component to put it above is not on the destination page: ${before}`);
    container = parentRel(before);
    anchor = nameOf(before);
  } else if (into) {
    if (!dest.tree[into]) throw new Error(`The container to put it in is not on the destination page: ${into}`);
    container = into;
  } else {
    throw new Error('Choose where on the destination page the component goes.');
  }

  const siblings = dest.order[container] || [];
  const name = freeName(nameOf(at), siblings);
  const to = `${container}/${name}`;

  /* Something to copy: a component with nothing of its own and nothing under
     it would arrive as an empty box, the same shape 1 November left behind. */
  const rels = Object.keys(src.tree).filter((r) => under(r, at));
  const own = (r) => Object.keys(src.tree[r]).filter((p) => !/^(jcr:primaryType|sling:resourceType|jcr:(created|lastModified)(By)?|cq:lastModified(By)?)$/.test(p));
  if (!rels.some((r) => own(r).length)) throw new Error(`${at} has no content of its own to copy.`);

  const tree = {};
  const order = {};
  for (const r of rels) {
    const moved = to + r.slice(at.length);
    tree[moved] = { ...src.tree[r] };
    order[moved] = [...(src.order[r] || [])];
  }
  /* The container's children as they will be: the destination's, with the
     new one in its place. Only for the :order index - the container itself
     is not in `tree`, so none of its own properties are planned. */
  const kids = [...siblings];
  const i = anchor ? kids.indexOf(anchor) : -1;
  kids.splice(i > -1 ? i : kids.length, 0, name);
  order[container] = kids;

  return {
    src: { tree, order },
    dest,
    info: {
      from: at,
      to,
      name,
      renamed: name !== nameOf(at),
      container,
      before: before || null,
      into: into || null,
      resourceType: src.tree[at]['sling:resourceType'],
      nodes: rels.length
    }
  };
}
