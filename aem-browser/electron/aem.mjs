/**
 * What the browser needs to know about AEM from a URL alone: which configured
 * server a tab is on, whether it looks like an author instance at all, and
 * which page it has open. The "looks like AEM" rule is the extension's own.
 */
import { looksLikeAem, sessionFrom, SESSION } from "../../aem-toolkit/src/core/instances.js";

export { looksLikeAem, SESSION };

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function originOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.origin : "";
  } catch {
    return "";
  }
}

/** A configured server's host may be typed with or without a scheme or a trailing slash. */
export function normalizeHost(h) {
  return String(h || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

export function serverFor(url, servers) {
  const host = hostOf(url);
  if (!host) return null;
  return servers.find((s) => normalizeHost(s.host) === host) || null;
}

export function serverOrigin(server) {
  const h = String(server.host || "").trim();
  return /^https?:\/\//i.test(h) ? new URL(h).origin : `https://${normalizeHost(h)}`;
}

/**
 * The repository path of the page a tab has open, or null.
 *   /editor.html/content/x/y.html        -> /content/x/y
 *   /content/x/y.html?wcmmode=disabled   -> /content/x/y
 *   /sites.html/content/x                -> /content/x
 *   /mnt/overlay/.../properties.html?item=/content/x -> /content/x
 */
export function pagePathFrom(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const item = u.searchParams.get("item");
  if (item && item.startsWith("/content/")) return item.replace(/\.html$/, "");

  const p = decodeURIComponent(u.pathname);
  const m =
    p.match(/^\/editor\.html(\/content\/.+?)(?:\.[a-z0-9-]+)*\.html$/i) ||
    p.match(/^\/(?:sites|assets)\.html(\/content\/.+?)\/?$/i) ||
    p.match(/^(\/content\/.+?)(?:\.[a-z0-9-]+)*\.html$/i);
  return m ? m[1] : null;
}

/**
 * Ask an instance who is signed in, with this browser's cookies. One GET, redirects not followed.
 * The query string is not optional: a dispatcher in front of the author servers keeps a cached copy
 * of currentuser.json - someone else's answer - and serves it to any request without a login cookie,
 * Cache-Control or not. A unique query string is never served from that cache.
 */
export async function readSession(ses, origin, timeout = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await ses.fetch(`${origin}/libs/granite/security/currentuser.json?_=${Date.now()}`, {
      credentials: "include",
      cache: "no-store",
      redirect: "manual",
      headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" },
      signal: ctl.signal,
    });
    const redirected = res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
    return sessionFrom({ status: res.status, redirected, text: redirected ? "" : await res.text() });
  } catch (e) {
    // Electron's fetch rejects a redirect it was told not to follow instead of returning it.
    // A redirect here is the way to a login page or single sign-on: not signed in.
    if (/redirect/i.test(e?.message || "")) return sessionFrom({ status: 302, redirected: true });
    return { state: SESSION.UNREACHABLE, error: e?.name === "AbortError" ? "timed out" : e?.message };
  } finally {
    clearTimeout(timer);
  }
}
