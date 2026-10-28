/**
 * Where a DAM image is still served after it has left the DAM.
 *
 * Dynamic Media keeps its own copy of every image published through it. Delete
 * the asset in AEM and that copy can stay on Scene7 for a long time: the page
 * goes on showing the image, live and with wcmmode=disabled, while the path it
 * names is gone from the DAM. "Not in the source DAM" is then only half the
 * answer - the image is lost to AEM, not to the visitor, and the copy on the
 * delivery host is the one place left to get it back from.
 *
 * Samsung's delivery hosts map the DAM path one to one:
 *
 *   /content/dam/samsung/uk/f2607/a.png
 *   https://images.samsung.com/is/image/samsung/assets/uk/f2607/a.png
 *
 * Both hosts answer a plain 404 for an image they do not have, and send
 * Access-Control-Allow-Origin: *, so a HEAD from the author tab is enough.
 */

const DAM_ROOT = '/content/dam/samsung/';

export const DELIVERY_HOSTS = [
  { name: 'live', host: 'https://images.samsung.com' },
  { name: 'staging', host: 'https://stg-images.samsung.com' }
];

const TIMEOUT_MS = 10_000;

/** The delivery URL on each host, or [] for a path outside Samsung's DAM. */
export function deliveryUrls(damPath) {
  if (!damPath?.startsWith(DAM_ROOT)) return [];
  const rest = encodeURI(damPath.slice(DAM_ROOT.length));
  return DELIVERY_HOSTS.map((h) => ({ name: h.name, url: `${h.host}/is/image/samsung/assets/${rest}` }));
}

/**
 * Which delivery hosts still serve the image.
 *
 *   { checked: true,  found: [{ name, url }, ...] }   found may be empty
 *   { checked: false, found: [] }                     no host could be asked
 */
export async function findOnDelivery(damPath) {
  const urls = deliveryUrls(damPath);
  if (!urls.length) return { checked: false, found: [] };
  const states = await Promise.all(urls.map((u) => served(u.url)));
  return {
    checked: states.some((s) => s !== 'unknown'),
    found: urls.filter((_, i) => states[i] === 'yes')
  };
}

/** 'yes' | 'no' | 'unknown' - unknown is a host that could not be reached, not an image that is gone. */
async function served(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { method: 'HEAD', credentials: 'omit', cache: 'no-store', signal: ctl.signal });
    if (r.ok) return 'yes';
    return r.status === 404 || r.status === 410 ? 'no' : 'unknown';
  } catch {
    // A fetch the page will not allow can still be an image it will load.
    return loads(url);
  } finally {
    clearTimeout(timer);
  }
}

function loads(url) {
  if (typeof Image === 'undefined') return Promise.resolve('unknown');
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => done('unknown'), TIMEOUT_MS);
    function done(v) {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(v);
    }
    img.onload = () => done('yes');
    // An image that will not load cannot tell a 404 from a blocked request.
    img.onerror = () => done('unknown');
    img.src = url;
  });
}

/** The line to show for an image missing from the source DAM. */
export function missingReason(delivery, { copied = 'copied as it is' } = {}) {
  if (delivery?.found?.length) {
    return `not in the source DAM, but still served from ${delivery.found.map((f) => f.name).join(' and ')} ` +
      `Dynamic Media — the reference is ${copied}`;
  }
  if (delivery?.checked) {
    return `image not available — not in the source DAM, nor on Dynamic Media live or staging. The reference is ${copied}`;
  }
  return `not in the source DAM, so the reference is ${copied}`;
}
