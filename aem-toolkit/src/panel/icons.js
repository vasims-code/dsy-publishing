/**
 * Inline icons for the panel. Stroke-only, 24px grid, drawn in currentColor so
 * they follow the text colour and the dark theme without any extra rules.
 *
 * Inline rather than an icon font or image files: the panel has no build step,
 * and an SVG string is the smallest thing that renders crisply at every size.
 */

const PATHS = {
  back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  gear:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  sync:
    '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>',
  server:
    '<rect x="3" y="4" width="13" height="6" rx="2"/><rect x="3" y="14" width="13" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/><path d="M19 14h3m0 0-2-2m2 2-2 2"/>',
  page: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  alert: '<path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  swap: '<path d="M7 20V4"/><path d="m3 8 4-4 4 4"/><path d="M17 4v16"/><path d="m21 16-4 4-4-4"/>',
  tab: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 4v5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'
};

/** An inline SVG element. Decorative by default - the text next to it carries the meaning. */
export function icon(name, size = 18, cls = 'icon') {
  const wrap = document.createElement('span');
  wrap.className = cls === 'icon' ? cls : `icon ${cls}`;
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML =
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || PATHS.page}</svg>`;
  return wrap;
}

/**
 * The "site not enabled" illustration: a plug inside a shield. Two-tone, from
 * the theme's accent tokens, so it sits in both light and dark mode.
 */
export function shieldArt() {
  const wrap = document.createElement('div');
  wrap.className = 'empty-art';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `
<svg width="112" height="120" viewBox="0 0 112 120" fill="none">
  <path d="M56 6 98 22v32c0 28-18 50-42 60C32 104 14 82 14 54V22z"
        fill="var(--accent-soft)" stroke="var(--accent-line)" stroke-width="3" stroke-linejoin="round"/>
  <path d="M56 6v108C32 104 14 82 14 54V22z" fill="var(--accent-softer)"/>
  <path d="M46 34v12M66 34v12" stroke="var(--accent-line)" stroke-width="4" stroke-linecap="round"/>
  <rect x="38" y="44" width="36" height="18" rx="5" fill="var(--bg)" stroke="var(--accent-line)" stroke-width="3"/>
  <path d="M50 62v6a6 6 0 0 0 12 0v-6" stroke="var(--accent-line)" stroke-width="3"/>
  <path d="M56 74v18c0 6 8 6 12 2" stroke="var(--accent-line)" stroke-width="3" stroke-linecap="round"/>
  <path d="m58 47-4 7h5l-4 7" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
  return wrap;
}
