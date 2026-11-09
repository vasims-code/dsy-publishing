/**
 * Which tabs are AEM author instances, and whether you are signed in to one.
 *
 * No DOM. The sign-in check is used from two places - the content script,
 * same-origin inside the instance's own tab, and the side panel for an
 * instance with no tab open - so it takes the origin and credentials mode
 * rather than assuming either.
 */

/* Paths only an AEM author serves: the editor, the consoles, the login page,
 * CRXDE and the Felix console. A page under /content counts only with its
 * .html extension, which is how AEM addresses one. */
const AEM_PATH = new RegExp(
  '^/(?:' +
    [
      'editor\\.html/',
      '(?:sites|assets|projects|screens|experience-fragments|forms)\\.html(?:/|$)',
      'aem/',
      'libs/',
      'mnt/overlay/',
      'crx/',
      'system/console',
      'cf$',
      '(?:siteadmin|damadmin|miscadmin|useradmin)(?:$|[/#.])',
      'content/.+\\.html$'
    ].join('|') +
    ')'
);

/* "p6-eu-author.samsung.com", "author-p123-e456.adobeaemcloud.com": author as
 * a whole label or dash-separated part of one, not inside a longer word. */
const AUTHOR_HOST = /(?:^|[.-])author(?:[.-]|$)/i;

/**
 * Does this tab look like an AEM author instance? Asked before offering to
 * enable a site, so a tab on Jira or a mail client is never offered. The
 * extension cannot look inside a site until it is allowed, so the URL is all
 * there is to go on. Not the tab title: a Jira ticket called "AEM-123" would
 * pass any title test worth having.
 */
export function looksLikeAem(url) {
  let u;
  try {
    u = url instanceof URL ? url : new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  return (
    AEM_PATH.test(u.pathname) ||
    AUTHOR_HOST.test(u.hostname) ||
    /\.adobeaemcloud\.com$/i.test(u.hostname)
  );
}

/**
 * Sign-in states, and whether a run can be pointed at an instance in each.
 *
 *   in           signed in - the only state a run is sure to work in
 *   out          not signed in: a redirect, 401/403, a login page or "anonymous"
 *   notaem       no currentuser servlet, so not an AEM instance
 *   unreachable  no answer at all - offline, off the VPN, timed out
 *   unknown      an answer that says neither; left to the run to report
 *   ungranted    Chrome has not granted the origin
 *   checking     not asked yet
 */
export const SESSION = {
  IN: 'in',
  OUT: 'out',
  NOT_AEM: 'notaem',
  UNREACHABLE: 'unreachable',
  UNKNOWN: 'unknown',
  UNGRANTED: 'ungranted',
  CHECKING: 'checking'
};

/** An instance a run can be pointed at. Anything the check could not decide stays pickable. */
export const pickable = (s) =>
  !s || s.state === SESSION.IN || s.state === SESSION.UNKNOWN || s.state === SESSION.CHECKING;

/** Why an instance cannot be picked, short enough to sit after its name in a list. */
export function sessionNote(s) {
  switch (s?.state) {
    case SESSION.OUT:
      return 'not signed in';
    case SESSION.NOT_AEM:
      return 'not an AEM instance';
    case SESSION.UNREACHABLE:
      return 'can’t reach';
    case SESSION.UNGRANTED:
      return 'permission needed';
    case SESSION.CHECKING:
      return 'checking…';
    default:
      return '';
  }
}

/**
 * What an answer from /libs/granite/security/currentuser.json says about the
 * session. `redirected` is a redirect the request was not allowed to follow:
 * a signed-in user gets the JSON directly, so any redirect - to the login page,
 * or to a single sign-on provider - means not signed in.
 */
export function sessionFrom({ status, redirected = false, text = '' }) {
  if (redirected || status === 401 || status === 403) return { state: SESSION.OUT };
  if (status === 404) return { state: SESSION.NOT_AEM };
  if (status < 200 || status >= 300) return { state: SESSION.UNKNOWN, status };

  let me;
  try {
    me = JSON.parse(text);
  } catch {
    // A 200 that is not JSON is the login page, served in place.
    return { state: SESSION.OUT };
  }
  const id = me?.authorizableId;
  if (!id) return { state: SESSION.UNKNOWN, status };
  if (id === 'anonymous') return { state: SESSION.OUT };
  return { state: SESSION.IN, user: id };
}

/**
 * Ask an instance who is signed in. `origin` is '' from inside the instance's
 * own tab. Read-only: one GET, redirects not followed.
 */
export async function readSession(origin = '', { credentials = 'same-origin', timeout = 8000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(`${origin}/libs/granite/security/currentuser.json`, {
      credentials,
      cache: 'no-store',
      redirect: 'manual',
      headers: { Accept: 'application/json' },
      signal: ctl.signal
    });
    const redirected = res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
    return sessionFrom({ status: res.status, redirected, text: redirected ? '' : await res.text() });
  } catch (e) {
    return { state: SESSION.UNREACHABLE, error: e?.name === 'AbortError' ? 'timed out' : e?.message };
  } finally {
    clearTimeout(timer);
  }
}
