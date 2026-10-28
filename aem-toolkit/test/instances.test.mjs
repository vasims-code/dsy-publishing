/* Which tabs count as AEM, and what a currentuser.json answer says about the session. */
import { pathToFileURL } from 'node:url';

const { looksLikeAem, sessionFrom, readSession, pickable, SESSION } = await import(
  pathToFileURL('D:/chrome-extensions/aem-toolkit/src/core/instances.js')
);

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};

/* ------------------------------------------------------------ AEM or not */

const AEM = [
  'https://p6-eu-author.samsung.com/editor.html/content/samsung/uk/guide/x.html',
  'https://p6-ap-author.samsung.com/sites.html/content/samsung/lb',
  'https://p6-ap-author.samsung.com/',
  'https://author-p123-e456.adobeaemcloud.com/ui#/aem/sites.html',
  'http://localhost:4502/libs/granite/core/content/login.html?resource=%2F',
  'http://localhost:4502/aem/start.html',
  'http://localhost:4502/crx/de/index.jsp',
  'http://localhost:4502/system/console/bundles',
  'http://localhost:4502/mnt/overlay/wcm/core/content/sites/properties.html?item=/content/x',
  'http://localhost:4502/content/samsung/uk/guide/x.html?wcmmode=disabled',
  'http://localhost:4502/assets.html/content/dam/samsung',
  'http://localhost:4502/cf#/content/samsung/uk.html',
  'http://localhost:4502/siteadmin#/content'
];
for (const u of AEM) check(`AEM: ${u}`, looksLikeAem(u), 'should look like AEM');

const NOT_AEM = [
  'https://samsung.atlassian.net/browse/AEM-123',
  'https://jira.example.com/secure/Dashboard.jspa',
  'https://confluence.example.com/display/AEM/Authoring+guide',
  'https://mail.google.com/mail/u/0/#inbox',
  'https://www.samsung.com/uk/smartphones/',
  'https://authorhouse.com/books',
  'https://example.com/content/',
  'https://example.com/libraries/x',
  'chrome://extensions/',
  'not a url'
];
for (const u of NOT_AEM) check(`not AEM: ${u}`, !looksLikeAem(u), 'should not look like AEM');

/* --------------------------------------------------------------- session */

const s = (r) => sessionFrom(r).state;
check('signed in', s({ status: 200, text: '{"authorizableId":"vshaik"}' }) === SESSION.IN);
check('...and says who', sessionFrom({ status: 200, text: '{"authorizableId":"vshaik"}' }).user === 'vshaik');
check('anonymous is signed out', s({ status: 200, text: '{"authorizableId":"anonymous"}' }) === SESSION.OUT);
check('a redirect is signed out (login page or SSO)', s({ status: 0, redirected: true }) === SESSION.OUT);
check('401 is signed out', s({ status: 401 }) === SESSION.OUT);
check('403 is signed out', s({ status: 403 }) === SESSION.OUT);
check('a login page served in place is signed out', s({ status: 200, text: '<!DOCTYPE html><html>' }) === SESSION.OUT);
check('404 is not an AEM instance', s({ status: 404 }) === SESSION.NOT_AEM);
check('a 500 says nothing either way', s({ status: 500 }) === SESSION.UNKNOWN);
check('JSON without a user says nothing either way', s({ status: 200, text: '{}' }) === SESSION.UNKNOWN);

check('signed in is pickable', pickable({ state: SESSION.IN }));
check('not yet checked is pickable', pickable(undefined) && pickable({ state: SESSION.CHECKING }));
check('undecided is pickable', pickable({ state: SESSION.UNKNOWN }));
for (const st of [SESSION.OUT, SESSION.NOT_AEM, SESSION.UNREACHABLE, SESSION.UNGRANTED]) {
  check(`${st} is not pickable`, !pickable({ state: st }));
}

/* ------------------------------------------------------ the request itself */

let seen;
globalThis.fetch = async (url, init) => {
  seen = { url, init };
  return { status: 0, type: 'opaqueredirect', text: async () => '' };
};
let r = await readSession('https://p6-ap-author.samsung.com', { credentials: 'include' });
check('asks currentuser.json on the instance', seen.url === 'https://p6-ap-author.samsung.com/libs/granite/security/currentuser.json', seen.url);
check('...with the cookie', seen.init.credentials === 'include');
check('...without following a redirect', seen.init.redirect === 'manual');
check('...and a redirect reads as signed out', r.state === SESSION.OUT, JSON.stringify(r));

r = await readSession('');
check('same-origin by default, for the content script', seen.url === '/libs/granite/security/currentuser.json' && seen.init.credentials === 'same-origin', JSON.stringify(seen));

globalThis.fetch = async () => {
  throw new TypeError('Failed to fetch');
};
r = await readSession('https://down.example.com');
check('no answer is unreachable', r.state === SESSION.UNREACHABLE, JSON.stringify(r));

globalThis.fetch = (url, init) =>
  new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
r = await readSession('https://slow.example.com', { timeout: 20 });
check('a hung request times out as unreachable', r.state === SESSION.UNREACHABLE && r.error === 'timed out', JSON.stringify(r));

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
