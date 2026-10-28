import test from 'node:test';
import assert from 'node:assert/strict';
import { notSlingMessage } from '../src/core/aem-client.js';

// Just enough of a document: querySelector by the selectors the check uses.
const doc = (html) => ({
  querySelector: (sel) => {
    if (sel === 'title') { const m = html.match(/<title>([^<]*)<\/title>/i); return m && { textContent: m[1] }; }
    if (sel === 'h1') { const m = html.match(/<h1>([^<]*)<\/h1>/i); return m && { textContent: m[1] }; }
    return /type="password"|name="j_username"|name="SAMLRequest"/.test(html) ? {} : null;
  }
});
const say = (res, html) => notSlingMessage({ status: 200, url: '', redirected: false, ...res }, doc(html), html);

test('AEM login form', () => assert.match(say({}, '<form><input name="j_username"><input type="password"></form>'), /signed out. Log in again/));
test('SSO redirect', () => assert.match(say({ redirected: true, url: 'https://sso.samsung.com/saml/login' }, '<p>x</p>'), /signed out/));
test('SAML post-back page', () => assert.match(say({}, '<form><input name="SAMLRequest" type="hidden"></form>'), /signed out/));
test('error page names itself', () => {
  const m = say({ status: 502 }, '<title>502 Bad Gateway</title>');
  assert.match(m, /error page instead of saving \(HTTP 502\)/);
  assert.match(m, /"502 Bad Gateway"/);
});
