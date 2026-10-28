/**
 * Everything that talks to AEM.
 *
 * Runs inside a content script, so requests are same-origin and carry the
 * author session cookie exactly as they would from the devtools console. That
 * keeps the extension out of the business of managing AEM credentials.
 */

import { norm, parentOf } from './paths.js';

export class AemAbort extends Error {
  constructor(message) {
    super(message);
    this.name = 'AemAbort';
    this.isAbort = true;
  }
}

export const abort = (msg) => new AemAbort(msg);

/**
 * What came back instead of a Sling answer, said so the operator knows what to
 * do. A sign-in page - AEM's own, or the SSO one it redirects to - means the
 * session ran out, though the tab still shows the editor it loaded earlier.
 */
export function notSlingMessage(res, doc, html) {
  const url = String(res.url || '');
  const signIn =
    /\/libs\/granite\/core\/content\/login|\/system\/sling\/login|j_security_check|saml|oauth|\/sso\b|signin|login/i.test(
      res.redirected ? url : ''
    ) ||
    !!doc.querySelector(
      'input[name="j_username"], input[name="j_password"], input[type="password"], input[name="SAMLRequest"], input[name="SAMLResponse"]'
    ) ||
    /<title>[^<]*(sign[\s-]?in|log[\s-]?in)[^<]*<\/title>/i.test(html);
  if (signIn) return 'Failed to connect to AEM: you have been signed out. Log in again in this tab, then try again.';

  const title = doc.querySelector('title')?.textContent?.trim() || doc.querySelector('h1')?.textContent?.trim() || '';
  const said = title ? ` It answered: "${title.slice(0, 120)}".` : '';
  return `Failed to connect to AEM: the server sent back an error page instead of saving (HTTP ${res.status}).${said} Reload the page and try again; if it keeps happening, check the VPN.`;
}

/**
 * How long a binary read or upload may go without progress before it is given
 * up, rather than left to hang. Measured from the last progress, not from the
 * start, so a large file on a slow line is not cut off while it is moving.
 * An object so a test can shorten them.
 */
export const LIMITS = {
  /** Nothing arriving while an asset is read. */
  readStallMs: 60_000,
  /** Nothing leaving while an asset is uploaded. */
  uploadStallMs: 60_000,
  /** Every byte sent, and still no answer from the server. */
  uploadAnswerMs: 180_000
};

/** Bytes as base64. Fed through in blocks: String.fromCharCode(...bytes)
 * overflows the argument limit on anything bigger than a small icon. */
export function toBase64(bytes) {
  let binary = '';
  const BLOCK = 0x8000;
  for (let i = 0; i < bytes.length; i += BLOCK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCK));
  }
  return btoa(binary);
}

export function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * A version label AEM will take: a JCR name, so no ':' (a namespace prefix),
 * none of / [ ] * | and no quotes or whitespace. "pre-sync 2026-09-27T10:12:33.123Z"
 * becomes "pre-sync-2026-09-27T10-12-33-123Z".
 */
export const safeLabel = (label) =>
  String(label || 'version')
    .replace(/[:/[\]*|'"\s.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

export class AemClient {
  constructor({ report } = {}) {
    this.report = report || (() => {});
    this._csrf = null;
    // Starts from the clock, not 0: the dispatcher caches by URL, so a read in
    // one run must never repeat a URL from an earlier run - a write's read-back
    // would get the page as it was before the write.
    this._ck = Date.now();
    this._probes = new Map();
  }

  resetCaches() {
    this._csrf = null;
    this._probes.clear();
  }

  _encPath(p) {
    return encodeURI(norm(p)).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }

  /** Sent when the instance issues one. Instances without CSRF ignore it. */
  async csrfToken() {
    if (this._csrf) return this._csrf;
    try {
      const res = await fetch('/libs/granite/csrf/token.json', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) return null;
      this._csrf = (await res.json())?.token || null;
      return this._csrf;
    } catch {
      return null;
    }
  }

  /* -------------------------------------------------------------- writes */

  /**
   * /bin/wcmcommand answers with a Sling HtmlResponse and HTTP 200 even when
   * the command failed, so the real outcome is in <div id="Status">. A MISSING
   * Status means this is not a Sling response at all - an error page, a login
   * redirect - and the HTTP status on its own would lie.
   */
  async postForm(url, params) {
    const pairs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
    return this.postPairs(url, pairs);
  }

  /**
   * The same POST, but as ordered pairs rather than an object, because a
   * multi-value property is expressed by repeating the parameter name - which
   * an object cannot say.
   */
  async postPairs(url, pairs, { retried = false, multipart = false } = {}) {
    /* Multipart for a large write: a form-encoded body is capped by the
     * server's form-size limit (200 KB on a default Jetty), and one page of
     * Thai or Arabic, percent-encoded, can pass it. Same pairs, same answer. */
    const body = multipart ? new FormData() : new URLSearchParams();
    body.append('_charset_', 'utf-8');
    for (const [k, v] of pairs) {
      if (v !== undefined && v !== null) body.append(k, String(v));
    }

    const token = await this.csrfToken();
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        ...(multipart ? {} : { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }),
        ...(token ? { 'CSRF-Token': token } : {})
      },
      body: multipart ? body : body.toString()
    });

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const pick = (id) => doc.getElementById(id)?.textContent?.trim() || '';

    const status = pick('Status');
    if (!/^\d+$/.test(status)) {
      this._csrf = null;
      // A long run can outlive its CSRF token. That is worth one silent retry
      // with a fresh one before deciding the session is gone.
      if (res.status === 403 && !retried && token) {
        return this.postPairs(url, pairs, { retried: true, multipart });
      }
      throw abort(
        res.status === 403
          ? 'Rejected with 403. The tab must be on a real AEM author page, with a valid session.'
          : notSlingMessage(res, doc, html)
      );
    }

    const code = parseInt(status, 10);
    return {
      success: res.status >= 200 && res.status < 300 && code >= 200 && code < 300,
      http: res.status,
      effective: code,
      message: pick('Message'),
      // Location may carry .html; Path is the raw JCR path.
      resultPath: (pick('Path') || pick('Location')).replace(/\.html$/, ''),
      // Sling's own list of what it changed: null when the answer has none, [] when it changed nothing.
      changes: doc.getElementById('ChangeLog')
        ? doc.getElementById('ChangeLog').textContent.match(/\b(modified|created|deleted|moved|copied|ordered)\(/g) || []
        : null
    };
  }

  createPage({ parentPath, label, title, template }) {
    return this.postForm('/bin/wcmcommand', { cmd: 'createPage', parentPath, label, title, template });
  }

  copyPage({ srcPath, destPath }) {
    return this.postForm('/bin/wcmcommand', {
      cmd: 'copyPage',
      srcPath,
      destParentPath: parentOf(destPath),
      destName: destPath.split('/').pop(),
      // Must be the string "true". This parameter DEFAULTS TO FALSE, and false
      // means a deep copy of the whole subtree.
      shallow: 'true'
    });
  }

  createVersion({ path, label, comment }) {
    return this.postForm('/bin/wcmcommand', { cmd: 'createVersion', path, label, comment });
  }

  /**
   * Put a page's content back to one of its versions. `id` is the version
   * node's jcr:uuid, as read from the page's version history.
   */
  restoreVersion({ path, id }) {
    return this.postForm('/bin/wcmcommand', { cmd: 'restoreVersion', path, id });
  }

  /**
   * A GET that must answer with JSON - QueryBuilder, for one. null on 404;
   * a 403 or anything that is not JSON stops the run, because reading an empty
   * answer into it would be guessing.
   */
  async getJson(url, what) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (res.status === 404) return null;
    if (res.status === 403) throw abort(`Cannot read ${what} (403). Your account may not have access.`);
    if (!res.ok) throw abort(`Unexpected HTTP ${res.status} while reading ${what}`);
    try {
      return JSON.parse(await res.text());
    } catch {
      throw abort(`${what} did not return JSON. The session may have expired - log in again and retry.`);
    }
  }

  /**
   * Save a version of a page, and prove it was saved.
   *
   * createVersion answers 200 whether or not a version came of it, so the
   * answer is not the evidence. The page's jcr:content is: every version moves
   * its jcr:baseVersion to the new one. Read before and after; if it did not
   * move, there is no restore point, and the caller must not write as if there
   * were one.
   *
   * The label is made safe first. A version label is a JCR name, and a raw ISO
   * timestamp carries ':' - which in a JCR name means a namespace prefix.
   */
  async versionPage({ path, label, comment }) {
    const content = `${norm(path)}/jcr:content`;
    const baseOf = (props) => props?.['jcr:baseVersion'] || null;

    const before = baseOf(await this.readProps(content));
    // No label is fine: a version needs none, and labels must be unique.
    const r = await this.createVersion({ path, label: label ? safeLabel(label) : undefined, comment });
    if (!r.success) return r;

    const after = baseOf(await this.readProps(content));
    if (!after || after === before) {
      return {
        ...r,
        success: false,
        message:
          `AEM answered ${r.effective}${r.message ? ` ("${r.message}")` : ''}, but no new version ` +
          `exists on ${norm(path)} - its jcr:baseVersion did not change`
      };
    }
    return { ...r, version: after };
  }

  /** Sling POST to a node: property writes, @Delete, @TypeHint, :order. */
  writeNode(path, pairs) {
    return this.postPairs(this._encPath(path), pairs);
  }

  /**
   * Many nodes in one Sling POST: names relative to `path` ("./root/x/text").
   * Sling saves the whole request once, so it lands entirely or not at all -
   * which is what keeps a failed write from leaving a page half changed.
   */
  writeTree(path, pairs) {
    return this.postPairs(this._encPath(path), pairs, { multipart: true });
  }

  /** The signed-in user's id, or null where the instance does not say. */
  async currentUser() {
    const me = await this.getJson('/libs/granite/security/currentuser.json', 'the signed-in user');
    return me?.authorizableId || null;
  }

  /** Sling copy. `dest` is the full destination path, including the new name. */
  copyNode({ src, dest, replace = false }) {
    const pairs = [[':operation', 'copy'], [':dest', dest]];
    if (replace) pairs.push([':replace', 'true']);
    return this.postPairs(this._encPath(src), pairs);
  }

  deleteNode(path) {
    return this.postPairs(this._encPath(path), [[':operation', 'delete']]);
  }

  /** Position a node among its siblings. In AEM that IS component order. */
  orderNode(path, index) {
    return this.postPairs(this._encPath(path), [[':order', String(index)]]);
  }

  /**
   * Multipart POST, for the one thing that cannot be form-encoded: a binary.
   *
   * `.createasset.html` is what the Assets UI itself posts to, which makes it
   * the most widely available way in on 6.5. It answers with a rendered HTML
   * page rather than a Sling HtmlResponse, so there is no Status div to read -
   * the caller confirms the asset by reading the path back.
   *
   * Sent with XMLHttpRequest rather than fetch, because only XHR reports upload
   * progress - which is what tells a slow upload from a stuck one. No progress
   * for LIMITS.uploadStallMs gives up; so does no answer LIMITS.uploadAnswerMs
   * after the last byte, and that error carries `unanswered`, because the
   * asset may have arrived all the same.
   */
  async postMultipart(url, parts, { onProgress } = {}) {
    const fd = new FormData();
    fd.append('_charset_', 'utf-8');
    for (const [k, v, filename] of parts) {
      if (filename) fd.append(k, v, filename);
      else fd.append(k, v);
    }

    const token = await this.csrfToken();
    const status = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let timer;
      const fail = (err) => {
        clearTimeout(timer);
        reject(err);
      };
      const giveUpAfter = (ms, err) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          xhr.abort();
          reject(err);
        }, ms);
      };
      const stalled = () =>
        giveUpAfter(LIMITS.uploadStallMs, abort(`The upload stalled: nothing was sent for ${LIMITS.uploadStallMs / 1000}s.`));

      xhr.open('POST', url);
      if (token) xhr.setRequestHeader('CSRF-Token', token);
      xhr.upload.onprogress = (e) => {
        stalled();
        onProgress?.(e.loaded, e.total);
      };
      xhr.upload.onload = () =>
        giveUpAfter(
          LIMITS.uploadAnswerMs,
          Object.assign(abort(`Every byte was sent, but the server did not answer within ${LIMITS.uploadAnswerMs / 1000}s.`), {
            unanswered: true
          })
        );
      xhr.onload = () => {
        clearTimeout(timer);
        resolve(xhr.status);
      };
      xhr.onerror = () => fail(abort('The connection was dropped during the upload.'));
      stalled();
      xhr.send(fd);
    });

    if (status === 403) {
      this._csrf = null;
      throw abort(`Upload rejected with 403 at ${url}. The session may have expired.`);
    }
    if (status === 413) throw abort('The server refused the upload as too large (HTTP 413).');
    if (status < 200 || status >= 300) throw abort(`Upload failed with HTTP ${status} at ${url}`);
    return { http: status };
  }

  /**
   * An asset's bytes. The caller hands them across in pieces, as base64,
   * because they have to cross chrome.runtime messages to reach the other
   * server's tab, and those carry JSON - a Blob does not survive the trip. It
   * costs a third more bytes than the binary; in exchange the transfer needs no
   * cross-origin request, so neither AEM needs a CORS policy and neither login
   * cookie needs to be readable from the other origin.
   *
   * Over `max` bytes, `tooLarge` comes back instead - said by Content-Length
   * before the body is read where the instance gives one, and otherwise as
   * soon as the count passes it. Nothing arriving for LIMITS.readStallMs
   * gives up rather than waiting for ever.
   *
   * `url` reads the same image from a public delivery host instead - Dynamic
   * Media, for one deleted from the DAM - without this instance's cookies.
   */
  async readBytes(path, { max = Infinity, url = null } = {}) {
    const ctl = new AbortController();
    let timer;
    const alive = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ctl.abort(), LIMITS.readStallMs);
    };

    try {
      alive();
      const res = await fetch(url || this._encPath(path), {
        credentials: url ? 'omit' : 'same-origin', cache: 'no-store', signal: ctl.signal
      });
      if (res.status === 404) throw abort(`Asset not found: ${path}`);
      if (res.status === 403) throw abort(`Cannot read asset (403): ${path}`);
      if (!res.ok) throw abort(`HTTP ${res.status} reading asset ${path}`);
      const mime = res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';

      const declared = parseInt(res.headers.get('content-length'), 10);
      if (declared > max) {
        ctl.abort();
        return { tooLarge: true, size: declared };
      }

      if (!res.body?.getReader) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        return bytes.length > max ? { tooLarge: true, size: bytes.length } : { bytes, mime };
      }

      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        alive();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) {
          ctl.abort();
          return { tooLarge: true, size };
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        bytes.set(c, at);
        at += c.length;
      }
      return { bytes, mime };
    } catch (e) {
      if (e?.name === 'AbortError') {
        throw abort(`Reading it stalled: nothing arrived for ${LIMITS.readStallMs / 1000}s.`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * An asset's size in bytes, without reading it. Sling's JSON gives a binary
   * property as its length (":jcr:data"), so the original rendition says it.
   * Null when the instance does not - the transfer then finds out as it reads.
   */
  async assetSize(path) {
    try {
      const { json } = await this.readJson(`${norm(path)}/jcr:content/renditions/original/jcr:content`, 0);
      const n = json?.[':jcr:data'];
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  /** Bytes, in the pieces they arrived in, handed to DAM as a new asset. */
  async createAsset({ folder, fileName, parts, base64, mime, onProgress }) {
    const blob = new Blob(parts || [fromBase64(base64)], { type: mime || 'application/octet-stream' });
    return this.postMultipart(
      `${this._encPath(folder)}.createasset.html`,
      [
        ['fileName', fileName],
        ['file', blob, fileName]
      ],
      { onProgress }
    );
  }

  createFolder(path, primaryType) {
    return this.postPairs(this._encPath(path), [
      ['jcr:primaryType', primaryType],
      ['./jcr:content/jcr:primaryType', 'nt:unstructured'],
      ['./jcr:content/jcr:title', path.split('/').pop()]
    ]);
  }

  /* --------------------------------------------------------------- reads */

  async readJson(path, depth) {
    const res = await fetch(`${this._encPath(path)}.${depth}.json?ck=${++this._ck}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });

    if (res.status === 404) return { status: 404, json: null };
    if (res.status === 403) return { status: 403, json: null };
    if (!res.ok) throw abort(`Unexpected HTTP ${res.status} while reading ${path}`);

    try {
      return { status: 200, json: JSON.parse(await res.text()) };
    } catch {
      // A 200 that is not JSON is a login page or an error page, never a node.
      throw abort(`${path} did not return JSON. The session may have expired - log in again and retry.`);
    }
  }

  /**
   * One read answers: does anything exist here, what node type is it, and if it
   * is a page, its template and title. Depth 1 also lists child nodes, which is
   * what the shallow-copy check counts.
   */
  async inspect(path) {
    const { status, json } = await this.readJson(path, 1);

    if (status === 404) return { path: norm(path), exists: false, forbidden: false };

    // 403 means "something is here that you may not read" - a different answer
    // from "nothing is here". Conflating them would let the planner try to
    // create a page on top of an existing one.
    if (status === 403) return { path: norm(path), exists: null, forbidden: true };

    const content = json['jcr:content'] || null;

    return {
      path: norm(path),
      exists: true,
      forbidden: false,
      primaryType: json['jcr:primaryType'] || '(unknown)',
      isPage: json['jcr:primaryType'] === 'cq:Page',
      content,
      template: content?.['cq:template'] || null,
      title: content?.['jcr:title'] || null,
      childPages: Object.keys(json).filter(
        (k) => k !== 'jcr:content' && json[k]?.['jcr:primaryType'] === 'cq:Page'
      )
    };
  }

  /**
   * Does anything exist here? Three answers, not two.
   *
   * 403 is NOT 'no'. Treating it as absence is how a permissions problem turns
   * into "that asset is missing" and, downstream, into content silently left
   * unrewritten or deleted. Callers must handle 'forbidden' explicitly.
   */
  async probe(path, { timeout } = {}) {
    const key = norm(path);
    if (this._probes.has(key)) return this._probes.get(key);

    let answer;
    const res = await fetch(`${this._encPath(path)}.1.json?ck=${++this._ck}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {})
    }).catch(() => null);

    if (!res) answer = 'error';
    else if (res.ok) answer = 'yes';
    else if (res.status === 404) answer = 'no';
    else if (res.status === 403) answer = 'forbidden';
    else answer = 'error';

    this._probes.set(key, answer);
    return answer;
  }

  forgetProbe(path) {
    this._probes.delete(norm(path));
  }

  /**
   * A whole jcr:content subtree in one request.
   *
   * AEM caps .infinity.json at `json.maximumresults` (1000 by default) and the
   * output simply stops, so a page bigger than that comes back as invalid JSON.
   * That has to be reported as truncation, not as a dead session: a caller that
   * mistakes a short tree for the real one will conclude that everything
   * missing from it was deleted at the source.
   */
  async readTree(path) {
    const res = await fetch(`${this._encPath(path)}.infinity.json?ck=${++this._ck}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });

    if (res.status === 404) return null;
    if (res.status === 403) {
      throw abort(`Cannot read ${path} (403). Your account may not read that subtree.`);
    }
    if (!res.ok) throw abort(`Unexpected HTTP ${res.status} while reading ${path}`);

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw abort(
        `${path}.infinity.json did not parse (${text.length} bytes). This is almost certainly ` +
          "AEM's json.maximumresults limit truncating a large page. Refusing to plan against a " +
          'partial tree.'
      );
    }
  }

  /**
   * A whole subtree, however big.
   *
   * One .infinity.json when AEM will serve it. When it will not - a 300 listing
   * smaller depths, or output cut off at json.maximumresults - the node is read
   * at depth 1 and each child is read the same way, so a large page arrives
   * whole instead of being refused or, worse, accepted short. A child that
   * cannot be read stops the run rather than being left out.
   */
  async readTreeWhole(path) {
    const res = await fetch(`${this._encPath(path)}.infinity.json?ck=${++this._ck}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });

    if (res.status === 404) return null;
    if (res.status === 403) throw abort(`Cannot read ${path} (403). Your account may not read that subtree.`);
    if (res.ok) {
      try {
        return JSON.parse(await res.text());
      } catch {
        // Cut off at the limit - or a login page, which the depth-1 read below
        // will say plainly.
      }
    } else if (res.status !== 300) {
      throw abort(`Unexpected HTTP ${res.status} while reading ${path}`);
    }

    const { status, json } = await this.readJson(path, 1);
    if (status !== 200) throw abort(`Cannot read ${path} (HTTP ${status}).`);
    for (const [name, child] of Object.entries(json)) {
      if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
      const whole = await this.readTreeWhole(`${norm(path)}/${name}`);
      if (!whole) throw abort(`${norm(path)}/${name} was listed but could not be read.`);
      json[name] = whole;
    }
    return json;
  }

  /**
   * A page as a visitor gets it: rendered, with no editor around it. For what
   * AEM does not hold itself - a product page's copy comes from PIM as the page
   * is rendered. null when there is no such page.
   */
  async readRendered(path) {
    const res = await fetch(`${this._encPath(path)}.html?wcmmode=disabled&ck=${++this._ck}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'text/html' }
    });
    if (res.status === 404) return null;
    if (res.status === 403) throw abort(`Cannot open ${path}.html (403). Your account may not read that page.`);
    if (!res.ok) throw abort(`Unexpected HTTP ${res.status} while opening ${path}.html`);
    return res.text();
  }

  /** A node's own properties, no children. Used to re-check the source live. */
  async readProps(path) {
    const { status, json } = await this.readJson(path, 0);
    return status === 200 ? json : null;
  }

  assertReadable(info, label) {
    if (info.forbidden) {
      throw abort(
        `Cannot read the ${label} at ${info.path} (403). Something exists there that your account ` +
          'may not read, so there is no safe way to tell whether it needs creating.'
      );
    }
  }
}
