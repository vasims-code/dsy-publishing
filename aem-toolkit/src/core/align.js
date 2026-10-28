/**
 * Working out which component at the destination corresponds to which component
 * at the source. Pure - no network, no DOM.
 *
 * WHY THIS EXISTS
 *
 * A page that was copied keeps its node names, so source and destination line up
 * by path and nothing here is needed. A page that was authored separately does
 * not. Two real pages of the same content:
 *
 *   uk  pd_g_feature_benefit_2084490669   "1. Flexible hinges"
 *   lb  pd_g_feature_benefit_552501717    "1. Flexible hinges"
 *
 * Twenty components, every one with a counterpart, six sharing a node name. And
 * one of those six shares a NAME while being a different component - uk's
 * `cm_g_static_content` is an anchor-bar div, lb's is the page's FAQ schema.
 * Pairing by name there does not fail loudly; it quietly overwrites live
 * structured data with a spacer.
 *
 * So pairing is done on the one thing that is actually reliable: the order of
 * the components and what each one IS. Authors insert and remove, they rarely
 * reorder, which makes this a longest-common-subsequence problem - the same
 * shape as a text diff, and it inherits the property that matters: it will
 * happily report NO pair rather than invent a wrong one.
 *
 * The result is a proposal. It is never applied without being shown.
 */

/** A component's identity for matching purposes: what it is, not what it's called. */
export function kindOf(props) {
  return props?.['sling:resourceType'] || props?.['jcr:primaryType'] || '';
}

/**
 * Longest common subsequence over two sequences of kinds.
 * Returns index pairs [i, j] in ascending order.
 */
function lcsPairs(a, b) {
  const n = a.length;
  const m = b.length;

  // L[i][j] = length of the LCS of a[i..] and b[j..]
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }

  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Pair the children of one node.
 *
 * Names first: if every destination child name also exists at the source, the
 * page was copied and the names ARE the answer - no inference needed, and no
 * risk of an alignment second-guessing a perfectly good match.
 *
 * Otherwise fall back to sequence alignment on component kind.
 */
export function alignChildren(srcNames, destNames, srcTree, destTree, srcRel, destRel) {
  const pairs = [];
  const srcOnly = [];
  const destOnly = [];

  const destSet = new Set(destNames);
  const srcSet = new Set(srcNames);
  const namesAgree = destNames.every((n) => srcSet.has(n)) && srcNames.some((n) => destSet.has(n));

  if (namesAgree) {
    for (const name of srcNames) {
      if (destSet.has(name)) pairs.push({ src: name, dest: name, by: 'name' });
      else srcOnly.push(name);
    }
    for (const name of destNames) if (!srcSet.has(name)) destOnly.push(name);
    return { pairs, srcOnly, destOnly, method: 'name' };
  }

  const srcKinds = srcNames.map((n) => kindOf(srcTree[`${srcRel}/${n}`]));
  const destKinds = destNames.map((n) => kindOf(destTree[`${destRel}/${n}`]));

  const matched = lcsPairs(srcKinds, destKinds);
  const pairedSrc = new Set();
  const pairedDest = new Set();

  /* Where a kind appears more than once, order is the ONLY thing separating the
   * candidates - and order is exactly what a separately authored page may not
   * share. Reverse two components and the alignment pairs each with the wrong
   * one, correctly by its own rules and wrongly by any other measure. It cannot
   * tell; it can say which rows the question applies to. */
  const repeated = new Set(
    srcKinds.filter((k, i) => srcKinds.indexOf(k) !== i)
  );

  for (const [i, j] of matched) {
    pairs.push({
      src: srcNames[i],
      dest: destNames[j],
      by: 'sequence',
      kind: srcKinds[i],
      ambiguous: repeated.has(srcKinds[i])
    });
    pairedSrc.add(i);
    pairedDest.add(j);
  }
  srcNames.forEach((n, i) => { if (!pairedSrc.has(i)) srcOnly.push(n); });
  destNames.forEach((n, j) => { if (!pairedDest.has(j)) destOnly.push(n); });

  return { pairs, srcOnly, destOnly, method: 'sequence' };
}

/**
 * Walk both trees together, pairing children at every level.
 *
 * Produces a map from DESTINATION rel to SOURCE rel. Relabelling the destination
 * tree through that map puts both trees in the same coordinates, after which an
 * ordinary path-keyed diff is correct again - which is the point: the alignment
 * is the only new idea, and everything downstream of it stays as it was.
 */
export function alignTrees(srcTree, srcOrder, destTree, destOrder) {
  const destToSrc = new Map([['', '']]);
  const srcToDest = new Map([['', '']]);
  const decisions = [];
  const addedAtSource = [];
  const missingAtSource = [];
  const renamedOnArrival = [];

  const walk = (srcRel, destRel) => {
    const srcNames = srcOrder[srcRel] || [];
    const destNames = destOrder[destRel] || [];
    if (!srcNames.length && !destNames.length) return;

    const r = alignChildren(srcNames, destNames, srcTree, destTree, srcRel, destRel);

    if (r.method === 'sequence' && (r.pairs.length || r.destOnly.length)) {
      decisions.push({
        parent: srcRel || '(page)',
        method: r.method,
        paired: r.pairs.length,
        renamed: r.pairs.filter((p) => p.src !== p.dest).length,
        ambiguous: r.pairs.filter((p) => p.ambiguous).length,
        pairs: r.pairs.map((p) => ({
          src: p.src, dest: p.dest, kind: p.kind,
          renamed: p.src !== p.dest, ambiguous: !!p.ambiguous
        }))
      });
    }

    for (const p of r.pairs) {
      const s = `${srcRel}/${p.src}`;
      const d = `${destRel}/${p.dest}`;
      destToSrc.set(d, s);
      srcToDest.set(s, d);
      walk(s, d);
    }

    /* A component with no counterpart has to be created, and the obvious place
     * is a node of the same name. That name may already be taken here by a
     * DIFFERENT component - uk's `cm_g_static_content` is a spacer, lb's is the
     * page's FAQ schema, and they are not each other. Writing the newcomer at
     * its source name would land on top of a node that is already paired with
     * something else, so a free name is found instead. */
    const taken = new Set(destNames);
    for (const n of r.srcOnly) {
      const s = `${srcRel}/${n}`;
      addedAtSource.push(s);

      let name = n;
      if (taken.has(name)) {
        let i = 1;
        while (taken.has(`${n}_${i}`)) i++;
        name = `${n}_${i}`;
        renamedOnArrival.push({ source: s, destination: `${destRel}/${name}`, clashedWith: n });
      }
      taken.add(name);
      srcToDest.set(s, `${destRel}/${name}`);
    }

    for (const n of r.destOnly) missingAtSource.push(`${destRel}/${n}`);
  };

  walk('', '');
  return { destToSrc, srcToDest, decisions, addedAtSource, missingAtSource, renamedOnArrival };
}

/**
 * Rewrite the destination tree into source coordinates.
 *
 * Anything with no source counterpart keeps its own rel, so it still shows up in
 * the diff as "not at the source" and the delete path sees it normally.
 */
export function relabel(destTree, destOrder, destToSrc) {
  const tree = {};
  const order = {};

  for (const rel of Object.keys(destTree)) {
    const to = destToSrc.get(rel) ?? rel;
    tree[to] = destTree[rel];

    // Child names have to move with the node they hang off.
    order[to] = (destOrder[rel] || []).map((name) => {
      const childTo = destToSrc.get(`${rel}/${name}`);
      return childTo ? childTo.slice(childTo.lastIndexOf('/') + 1) : name;
    });
  }

  return { tree, order };
}

/**
 * Where a write aimed at a source path must actually land.
 *
 * Nodes inside a component that was matched under a different name are not in
 * the map themselves - there is no reason to align a component's own internals
 * - so the nearest mapped ancestor is found and the remainder of the path hung
 * off it. Without that, a child of a renamed component would be written beside
 * the component instead of inside it.
 */
export function destResolver(srcToDest) {
  return (srcRel) => {
    if (srcToDest.has(srcRel)) return srcToDest.get(srcRel);

    let rel = srcRel;
    let tail = '';
    while (rel) {
      const cut = rel.lastIndexOf('/');
      tail = rel.slice(cut) + tail;
      rel = rel.slice(0, cut);
      if (srcToDest.has(rel)) return srcToDest.get(rel) + tail;
    }
    return srcRel;
  };
}
