/* ============================================================================
 * AEM 6.5 - single-page copy with auto-created intermediate pages
 *
 * Paste into the browser devtools console on an AUTHENTICATED AEM AUTHOR tab
 * (the page editor is fine). Then:
 *
 *   await AEMCopy.plan('/content/samsung/levant/tvs/40-inch-tvs',
 *                      '/content/samsung/lb/tvs/40-inch-tvs');   // plan table
 *
 *   await AEMCopy.dryRun('/content/samsung/levant/tvs/40-inch-tvs',
 *                        '/content/samsung/lb/tvs/40-inch-tvs'); // simulate
 *
 *   await AEMCopy.run('/content/samsung/levant/tvs/40-inch-tvs',
 *                     '/content/samsung/lb/tvs/40-inch-tvs');    // execute
 *
 * plan() resolves the repository and prints the table. dryRun() does that and
 * then walks the execution path with every write stubbed out, so you see the
 * exact per-step log a real run would produce. Set CONFIG.DRY_RUN = true to
 * make plain run() calls simulate as well.
 *
 * RULES IMPLEMENTED
 *   - Leaf (requested) page ................. full content copy, SHALLOW:
 *                                             child pages are NOT copied.
 *   - Intermediate already in destination ... skipped, left untouched.
 *   - Intermediate missing, in source ....... created with the SOURCE page's
 *                                             template + title. Shell only,
 *                                             no content copied. If that
 *                                             template is not available at the
 *                                             destination it falls back to
 *                                             CONFIG.MARKETING_TEMPLATE.
 *   - Intermediate missing, not in source ... created with
 *                                             CONFIG.MARKETING_TEMPLATE.
 *   - Destination leaf already exists ....... ABORT, nothing written.
 *
 * FAILURE HANDLING
 *   Every write is retried at most once, after re-reading the repository so a
 *   half-succeeded command is never duplicated. This script never deletes
 *   anything: if a run stops part-way, the pages it already created are left
 *   in place and listed so they can be removed from the Sites console.
 * ==========================================================================*/
(function () {
  'use strict';

  var CONFIG = {
    // Template for inserted segments that have no counterpart in the source.
    MARKETING_TEMPLATE: '/conf/consumer/settings/wcm/templates/page-marketing',

    // The first N segments of the destination are treated as the site root and
    // must already exist. Guards against a typo creating pages at /content or
    // /content/samsung. 3 == /content/<brand>/<locale>.
    ROOT_DEPTH: 3,

    // After copying, assert the destination leaf really has no child pages.
    VERIFY_SHALLOW: true,

    // Resolve cq:allowedTemplates / allowedPaths while planning, so a source
    // template that AEM would reject is swapped out before anything is written.
    CHECK_TEMPLATE_AVAILABILITY: true,

    // Global safety switch: when true, run() simulates instead of writing.
    // Per-call run(src, dest, { dryRun: ... }) overrides it either way.
    DRY_RUN: false,

    WCM_COMMAND: '/bin/wcmcommand',
    CSRF_ENDPOINT: '/libs/granite/csrf/token.json'
  };

  /* ---------------------------------------------------------------- utils */

  function segs(p) { return String(p || '').split('/').filter(Boolean); }
  function norm(p) { return '/' + segs(p).join('/'); }
  function nameOf(p) { var s = segs(p); return s[s.length - 1] || ''; }
  function parentOf(p) { var s = segs(p); return '/' + s.slice(0, -1).join('/'); }

  function toArray(v) {
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v.slice() : [v];
  }

  function humanize(name) {
    return String(name)
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // AEM compares these patterns with String#matches, which is a full match.
  function matchesAny(patterns, value) {
    for (var i = 0; i < patterns.length; i++) {
      try {
        if (new RegExp('^(?:' + patterns[i] + ')$').test(value)) return true;
      } catch (e) { /* an unparseable pattern simply does not match */ }
    }
    return false;
  }

  var CSS = {
    head: 'color:#fff;background:#1473e6;padding:2px 8px;border-radius:3px;font-weight:600',
    ok: 'color:#2d9d78;font-weight:600',
    skip: 'color:#8e8e8e',
    warn: 'color:#e68619;font-weight:600',
    err: 'color:#d7373f;font-weight:600',
    mono: 'font-family:monospace'
  };
  function banner(t) { console.log('%c' + t, CSS.head); }
  function ok(m) { console.log('%c  OK  %c ' + m, CSS.ok, ''); }
  function skip(m) { console.log('%c SKIP %c ' + m, CSS.skip, CSS.skip); }
  function warn(m) { console.log('%c WARN %c ' + m, CSS.warn, ''); }
  function fail(m) { console.log('%c FAIL %c ' + m, CSS.err, ''); }

  function Abort(msg) { var e = new Error(msg); e.__aemAbort = true; return e; }

  /* ----------------------------------------------------------------- http */

  var _csrf = null;
  var _ck = 0;

  function encPath(p) {
    return encodeURI(norm(p)).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }

  async function csrfToken() {
    if (_csrf) return _csrf;
    try {
      var res = await fetch(CONFIG.CSRF_ENDPOINT, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) {
        warn('CSRF token endpoint returned ' + res.status + ' - continuing without a token.');
        return null;
      }
      var j = await res.json();
      _csrf = (j && j.token) ? j.token : null;
      if (!_csrf) warn('CSRF endpoint returned no token field - continuing without a token.');
      return _csrf;
    } catch (e) {
      warn('Could not fetch CSRF token (' + e.message + ') - continuing without a token.');
      return null;
    }
  }

  function looksLikeLogin(res, text) {
    if (res.redirected && /\/libs\/granite\/core\/content\/login/.test(res.url)) return true;
    return /id="username"[\s\S]{0,400}id="password"/i.test(text || '');
  }

  // Sling HtmlResponse shape:
  //   <div id="Status">200</div>
  //   <div id="Message">...</div>
  //   <div id="Path">/content/...</div>
  //   <div id="Location">/content/...</div>
  function parseHtmlResponse(text) {
    var out = { statusCode: null, message: '', path: '', location: '', title: '' };
    try {
      var doc = new DOMParser().parseFromString(text, 'text/html');
      var pick = function (id) {
        var el = doc.getElementById(id);
        return el ? (el.textContent || '').trim() : '';
      };
      // Sling emits exactly: Status, Message, Path, Location, ParentLocation,
      // Referer, ChangeLog. There is no StatusCode element - do not invent a
      // fallback, because a missing Status is how we detect a non-Sling reply.
      var sc = pick('Status');
      out.statusCode = /^\d+$/.test(sc) ? parseInt(sc, 10) : null;
      out.message = pick('Message');
      out.path = pick('Path');
      out.location = pick('Location');
      var t = doc.querySelector('title');
      out.title = t ? (t.textContent || '').trim() : '';
    } catch (e) { /* leave defaults */ }
    return out;
  }

  async function doPost(url, params, token) {
    var body = new URLSearchParams();
    body.set('_charset_', 'utf-8');
    Object.keys(params).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null) body.set(k, String(params[k]));
    });

    var headers = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
    if (token) headers['CSRF-Token'] = token;

    var res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: headers,
      body: body.toString()
    });
    return { res: res, text: await res.text() };
  }

  async function postForm(url, params) {
    var token = await csrfToken();
    var r = await doPost(url, params, token);

    // Granite CSRF tokens expire (~10 min). One refresh-and-retry on a 403 is
    // worth doing before giving up - but only once, and only for 403.
    if (r.res.status === 403) {
      _csrf = null;
      var fresh = await csrfToken();
      if (fresh && fresh !== token) r = await doPost(url, params, fresh);
    }

    var res = r.res, text = r.text;

    if (looksLikeLogin(res, text)) {
      throw Abort('Your AEM session has expired - the server returned a login page. Log in again and re-run.');
    }

    // A 403 is either the CSRF filter or the Sling Referrer Filter, and the two
    // are indistinguishable apart from the body. Referer/Origin are forbidden
    // header names, so the referrer case cannot be fixed from JS - only by
    // running from a real author page.
    if (res.status === 403) {
      _csrf = null;
      throw Abort(/referr?er/i.test(text)
        ? 'Rejected by the Sling Referrer Filter (403). Run this from a tab sitting on a real AEM\n' +
          '         author page - not about:blank and not a blank devtools tab.'
        : 'Rejected by the CSRF filter (403), even after refreshing the token. Reload the AEM page\n' +
          '         and re-run. Behind a dispatcher, CSRF-Token must be listed under /clientheaders.');
    }

    var parsed = parseHtmlResponse(text);

    // Sling's HtmlResponse always carries a #Status div. Its absence means this
    // is not an HtmlResponse at all - an AEM error page, a dispatcher
    // ErrorDocument, a redirect - and res.status on its own would lie to us.
    if (parsed.statusCode == null) {
      throw Abort(
        'The server did not return a Sling HtmlResponse (HTTP ' + res.status + ').' +
        (parsed.title ? ' Page title: "' + parsed.title + '".' : '') + '\n' +
        '         /bin/wcmcommand may be blocked or filtered on this instance.');
    }

    parsed.http = res.status;
    parsed.effective = parsed.statusCode;
    parsed.success = (res.status >= 200 && res.status < 300) &&
                     (parsed.statusCode >= 200 && parsed.statusCode < 300);
    parsed.raw = text;
    // Location can carry an .html extension; Path is the raw JCR path.
    parsed.resultPath = (parsed.path || parsed.location || '').replace(/\.html$/, '');
    return parsed;
  }

  function serverMessage(r) {
    return r.message || r.title || '(no message returned)';
  }

  /* ------------------------------------------------------------ aem reads */

  // One GET answers: does it exist, what node type is it, and (if a page) its
  // template, title and cq:allowedTemplates. Depth 1 also pulls in child
  // nodes, which we reuse for the shallow-copy assertion.
  async function inspect(path) {
    var url = encPath(path) + '.1.json?ck=' + (++_ck);
    var res = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });

    if (res.status === 404) return { path: norm(path), exists: false, forbidden: false };

    // 403 means "there is something here that you may not read", which is a
    // different answer from "nothing is here". Conflating the two would make
    // the planner try to create a page over the top of an existing one.
    if (res.status === 403) return { path: norm(path), exists: null, forbidden: true };

    if (!res.ok) throw Abort('Unexpected HTTP ' + res.status + ' while reading ' + path);

    var text = await res.text();
    if (looksLikeLogin(res, text)) {
      throw Abort('Your AEM session has expired - the server returned a login page. Log in again and re-run.');
    }

    // A 200 that is not JSON is a login page or an error page, never a node.
    var ctype = res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
    if (ctype && !/json/i.test(ctype)) {
      throw Abort('Reading ' + path + ' returned ' + ctype + ' instead of JSON.\n' +
        '         Either the session has expired or the Sling default GET servlet is disabled here.');
    }

    var json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw Abort('Could not parse JSON for ' + path + '. Is the Sling default GET servlet enabled here?');
    }

    var content = json['jcr:content'] || null;
    var childPages = Object.keys(json).filter(function (k) {
      var v = json[k];
      return k !== 'jcr:content' && v && typeof v === 'object' && v['jcr:primaryType'] === 'cq:Page';
    });

    return {
      path: norm(path),
      exists: true,
      forbidden: false,
      primaryType: json['jcr:primaryType'] || '(unknown)',
      isPage: json['jcr:primaryType'] === 'cq:Page',
      content: content,
      template: content ? (content['cq:template'] || null) : null,
      title: content ? (content['jcr:title'] || null) : null,
      allowedTemplates: toArray(content && content['cq:allowedTemplates']),
      allowedPaths: toArray(content && content.allowedPaths),
      childPages: childPages
    };
  }

  function assertReadable(info, label) {
    if (info.forbidden) {
      throw Abort(
        'Cannot read the ' + label + ' at ' + info.path + ' - the server returned 403.\n' +
        '         Something exists there that your account may not read, so there is no safe way\n' +
        '         to tell whether it needs creating. Ask for read access and re-run.'
      );
    }
  }

  /* ------------------------------------------- template availability */

  var _tplCache = {};
  var _allowedCache = {};

  function resetCaches() {
    _tplCache = {};
    _allowedCache = {};
  }

  async function templateInfo(templatePath) {
    var key = norm(templatePath);
    if (_tplCache[key]) return _tplCache[key];
    var info = await inspect(key);
    _tplCache[key] = {
      path: key,
      exists: info.exists === true,
      forbidden: !!info.forbidden,
      allowedPaths: info.allowedPaths || []
    };
    return _tplCache[key];
  }

  // Nearest ancestor (starting at the parent itself) carrying
  // cq:allowedTemplates. Per Adobe's template-availability rules that list
  // takes precedence over the template's own allowedPaths.
  async function nearestAllowedTemplates(parentPath) {
    var key = norm(parentPath);
    if (Object.prototype.hasOwnProperty.call(_allowedCache, key)) return _allowedCache[key];

    var s = segs(key);
    var found = null;
    for (var i = s.length; i > 0 && !found; i--) {
      var p = '/' + s.slice(0, i).join('/');
      var info = await inspect(p);
      if (info.exists !== true) continue;
      if (info.allowedTemplates.length) found = { path: p, patterns: info.allowedTemplates };
    }
    _allowedCache[key] = found;
    return found;
  }

  // Errs on the side of "allowed": a false negative here silently downgrades a
  // page to the marketing template, while a false positive is caught at write
  // time and retried with the fallback.
  // Returns { allowed, certain, reason }. `certain` is what matters: only a
  // definite policy match may change the template the planner chose. If the
  // template cannot be read - /conf closed to this user, JSON rendering off,
  // a dangling cq:template - we say so and keep the source's template anyway,
  // because AEM is the real authority and createShell already retries with the
  // marketing template if the server actually refuses.
  async function templateAvailability(templatePath, destPath) {
    if (!templatePath) return { allowed: false, certain: true, reason: 'the source page has no cq:template' };

    var parentPath = parentOf(destPath);
    var tpl = await templateInfo(templatePath);

    if (tpl.forbidden) {
      return { allowed: true, certain: false, reason: 'template is not readable (403), so policy cannot be checked' };
    }
    if (!tpl.exists) {
      return { allowed: true, certain: false, reason: 'template not readable at ' + templatePath + ', so policy cannot be checked' };
    }

    var restriction = await nearestAllowedTemplates(parentPath);
    if (restriction) {
      return matchesAny(restriction.patterns, tpl.path)
        ? { allowed: true, certain: true, reason: 'allowed by cq:allowedTemplates on ' + restriction.path }
        : { allowed: false, certain: true, reason: 'blocked by cq:allowedTemplates on ' + restriction.path };
    }

    if (!tpl.allowedPaths.length) {
      return { allowed: true, certain: true, reason: 'no cq:allowedTemplates and no allowedPaths, so unrestricted' };
    }
    return (matchesAny(tpl.allowedPaths, parentPath) || matchesAny(tpl.allowedPaths, norm(destPath)))
      ? { allowed: true, certain: true, reason: 'matches the template allowedPaths' }
      : { allowed: false, certain: true, reason: 'allowedPaths on the template does not match ' + parentPath };
  }

  // cq:LiveSyncConfig sits under jcr:content, so depth 1 cannot see it and
  // would cheerfully report "no live copy" for a page inside one.
  async function msmInfo(path) {
    var out = { path: norm(path), liveSync: false, mixins: [] };
    try {
      var res = await fetch(encPath(path) + '.2.json?ck=' + (++_ck), {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) return out;
      var ctype = res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
      if (ctype && !/json/i.test(ctype)) return out;
      var json = JSON.parse(await res.text());
      var c = json['jcr:content'];
      if (!c) return out;
      out.mixins = toArray(c['jcr:mixinTypes']).filter(function (m) { return /LiveRelationship|LiveSync/.test(m); });
      out.liveSync = Object.keys(c).some(function (k) {
        return /^cq:LiveSyncConfig/.test(k) || (c[k] && typeof c[k] === 'object' &&
          /cq:LiveSyncConfig/.test(String(c[k]['jcr:primaryType'] || '')));
      });
    } catch (e) { /* MSM detection is advisory - never fail the run on it */ }
    return out;
  }

  async function msmPreflight(source, destAncestors) {
    var hits = [];
    var probes = [source].concat(destAncestors);
    for (var i = 0; i < probes.length; i++) {
      var m = await msmInfo(probes[i]);
      if (m.liveSync || m.mixins.length) {
        hits.push({
          path: m.path,
          role: probes[i] === source ? 'source page' : 'destination ancestor',
          detail: (m.liveSync ? 'cq:LiveSyncConfig' : '') +
                  (m.liveSync && m.mixins.length ? ' + ' : '') + m.mixins.join(', ')
        });
      }
    }
    return hits;
  }

  /* ------------------------------------------------------------- planning */

  // Right-align the two paths segment by segment, from the leaf backwards.
  // The matching suffix tells us which destination segments have a source
  // counterpart; everything above it is a newly inserted segment.
  //
  //   src  /content/samsung/levant/       home-appliances/buying-guide/microwaves
  //   dst  /content/samsung/levant/india/backup/home-appliances/buying-guide/microwaves
  //                                 ^^^^^^^^^^^ inserted  ^^^^^^^^^^^^^^^^^^^^^^ aligned
  function align(source, dest) {
    var s = segs(source), d = segs(dest);
    var k = 0;
    while (k < s.length && k < d.length && s[s.length - 1 - k] === d[d.length - 1 - k]) k++;

    var steps = d.map(function (name, i) {
      var offsetFromEnd = d.length - i;            // 1 == leaf
      var aligned = offsetFromEnd <= k;
      var srcIdx = s.length - offsetFromEnd;
      return {
        name: name,
        destPath: '/' + d.slice(0, i + 1).join('/'),
        isLeaf: i === d.length - 1,
        withinRoot: i < CONFIG.ROOT_DEPTH,
        aligned: aligned,
        sourceCandidate: (aligned && srcIdx >= 0) ? '/' + s.slice(0, srcIdx + 1).join('/') : null
      };
    });

    return { commonSuffix: k, steps: steps };
  }

  async function buildPlan(source, dest) {
    resetCaches();
    source = norm(source);
    dest = norm(dest);

    if (!/^\/content\//.test(source)) throw Abort('Source must be under /content : ' + source);
    if (!/^\/content\//.test(dest)) throw Abort('Destination must be under /content : ' + dest);
    if (source === dest) throw Abort('Source and destination are the same path.');
    if (segs(dest).length <= CONFIG.ROOT_DEPTH) {
      throw Abort('Destination is at or above the site root (depth ' + CONFIG.ROOT_DEPTH + '). Refusing.');
    }
    if (nameOf(source) !== nameOf(dest)) {
      throw Abort(
        'Destination page name "' + nameOf(dest) + '" differs from source page name "' + nameOf(source) +
        '". AEM copy cannot rename in place - use the same leaf name.'
      );
    }

    // --- source must be a real page --------------------------------------
    var srcInfo = await inspect(source);
    assertReadable(srcInfo, 'source page');
    if (!srcInfo.exists) throw Abort('Source page does not exist: ' + source);
    if (!srcInfo.isPage) throw Abort('Source is not a cq:Page (it is ' + srcInfo.primaryType + '): ' + source);

    // --- destination leaf must NOT already exist -------------------------
    var destInfo = await inspect(dest);
    assertReadable(destInfo, 'destination page');
    if (destInfo.exists) {
      throw Abort(
        'Destination page already exists: ' + dest + ' (' + destInfo.primaryType + ').\n' +
        '         Nothing has been written. Delete or rename it first if you intend to replace it.'
      );
    }

    var a = align(source, dest);
    var actions = [];

    for (var i = 0; i < a.steps.length; i++) {
      var st = a.steps[i];

      if (st.isLeaf) {
        actions.push({
          kind: 'copy',
          destPath: st.destPath,
          sourcePath: source,
          template: srcInfo.template,
          title: srcInfo.title || humanize(st.name)
        });
        continue;
      }

      var info = await inspect(st.destPath);
      assertReadable(info, 'intermediate page');

      if (info.exists) {
        // Site-root segments are expected to exist and are often folders
        // (/content itself is typically sling:OrderedFolder). Not noteworthy.
        if (st.withinRoot) {
          actions.push({ kind: 'skip-root', destPath: st.destPath, primaryType: info.primaryType });
        } else {
          actions.push(info.isPage
            ? { kind: 'skip', destPath: st.destPath, template: info.template }
            : { kind: 'skip-nonpage', destPath: st.destPath, primaryType: info.primaryType });
        }
        continue;
      }

      // Missing. Anything inside the root guard is a hard stop.
      if (st.withinRoot) {
        throw Abort(
          'Site root segment does not exist: ' + st.destPath + '\n' +
          '         Refusing to create pages above depth ' + CONFIG.ROOT_DEPTH + '. Check the destination path.'
        );
      }

      // Does it have a counterpart in the source? Name alignment picks the
      // candidate; the repository gets the final say.
      var srcCounterpart = null;
      if (st.sourceCandidate) {
        var ci = await inspect(st.sourceCandidate);
        if (ci.forbidden) {
          warn('Cannot read the source counterpart ' + st.sourceCandidate + ' (403), so ' +
            st.destPath + ' will use ' + CONFIG.MARKETING_TEMPLATE + '.');
        } else if (ci.exists && ci.isPage && ci.template) {
          srcCounterpart = ci;
        }
      }

      var action = {
        kind: 'create',
        destPath: st.destPath,
        template: CONFIG.MARKETING_TEMPLATE,
        fallbackTemplate: null,
        title: humanize(st.name),
        from: null,
        reason: 'not in source -> marketing template'
      };

      if (srcCounterpart) {
        action.template = srcCounterpart.template;
        action.title = srcCounterpart.title || humanize(st.name);
        action.from = srcCounterpart.path;
        action.reason = 'template from ' + srcCounterpart.path;
        action.fallbackTemplate = CONFIG.MARKETING_TEMPLATE;

        if (CONFIG.CHECK_TEMPLATE_AVAILABILITY) {
          var av = await templateAvailability(srcCounterpart.template, st.destPath);
          if (!av.allowed && av.certain) {
            warn('Source template ' + srcCounterpart.template + ' is blocked at ' + st.destPath);
            warn('       ' + av.reason + ' - falling back to ' + CONFIG.MARKETING_TEMPLATE + '.');
            action.template = CONFIG.MARKETING_TEMPLATE;
            action.fallbackTemplate = null;
            action.reason = 'source template blocked -> marketing template';
          } else if (!av.certain) {
            // Keep the source template. Saying nothing here would be worse than
            // saying "unverified": the run still does the right thing.
            action.unverified = av.reason;
          }
        }
      }

      if (CONFIG.CHECK_TEMPLATE_AVAILABILITY && action.template === CONFIG.MARKETING_TEMPLATE) {
        var mv = await templateAvailability(CONFIG.MARKETING_TEMPLATE, st.destPath);
        if (!mv.allowed && mv.certain) {
          warn('The marketing template is blocked at ' + st.destPath + ' (' + mv.reason + ').');
          warn('       It will still be attempted - AEM has the final say.');
        } else if (!mv.certain) {
          action.unverified = mv.reason;
        }
      }

      actions.push(action);
    }

    var destAncestors = actions
      .filter(function (x) { return x.kind === 'skip' || x.kind === 'skip-nonpage'; })
      .map(function (x) { return x.destPath; });

    return {
      source: source,
      dest: dest,
      commonSuffix: a.commonSuffix,
      actions: actions,
      msm: await msmPreflight(source, destAncestors)
    };
  }

  function renderUnverified(p) {
    var un = p.actions.filter(function (a) { return a.unverified; });
    if (!un.length) return;
    warn('Template policy could not be verified for ' + un.length + ' page(s) - ' + un[0].unverified + '.');
    console.log('%c       The planned templates are used as-is and AEM decides; if it refuses, the', CSS.skip);
    console.log('%c       script retries that page once with ' + CONFIG.MARKETING_TEMPLATE + '.', CSS.skip);
  }

  function renderMsm(p) {
    if (!p.msm || !p.msm.length) return false;
    warn('Multi Site Manager is involved in this copy:');
    p.msm.forEach(function (h) {
      console.log('%c         ' + h.role + '  ' + h.path + '   [' + h.detail + ']', CSS.mono);
    });
    console.log('%c       A plain copy into a live copy has no cq:LiveRelationship, so the next', CSS.skip);
    console.log('%c       rollout renames it aside and the page disappears from this path. If the', CSS.skip);
    console.log('%c       SOURCE carries live-sync config, the copy clones that relationship too.', CSS.skip);
    return true;
  }

  function renderPlan(p) {
    banner('PLAN   ' + p.source + '   ->   ' + p.dest);
    // Site-root segments are noise in the table - they always exist.
    console.table(p.actions.filter(function (a) { return a.kind !== 'skip-root'; }).map(function (a) {
      return {
        action: a.kind,
        path: a.destPath,
        template: a.template || '',
        title: a.title || '',
        note: a.reason ||
          (a.kind === 'skip' ? 'already exists' :
            a.kind === 'skip-nonpage' ? 'exists as ' + a.primaryType :
              a.kind === 'copy' ? 'full content, no child pages' : '')
      };
    }));
    renderUnverified(p);
    var n = function (kind) { return p.actions.filter(function (a) { return a.kind === kind; }).length; };
    console.log('  ' + n('create') + ' to create, 1 to copy, ' +
      (n('skip') + n('skip-nonpage')) + ' existing skipped (' + n('skip-root') + ' site-root segments verified).');
  }

  /* ------------------------------------------------------------ execution */

  // Set for the duration of a simulated run. The executors below stub out
  // their POST and nothing else, so planning, path checks, abort conditions
  // and log output all follow the real code path.
  var _dry = false;

  function simulatedResponse(destPath) {
    return {
      statusCode: 200, http: 200, effective: 200, success: true,
      message: '(dry run - not sent)', path: norm(destPath), location: '',
      title: '', raw: '', resultPath: norm(destPath)
    };
  }

  function did(pastTense, futureTense) {
    return _dry ? futureTense : pastTense;
  }

  function templateHint(destPath, template) {
    return '         Template: ' + template + '\n' +
      '         Common cause: cq:allowedTemplates on an ancestor of ' + parentOf(destPath) + ', or the\n' +
      '         template\'s own jcr:content/allowedPaths regex not matching that path.';
  }

  function attemptCreate(destPath, template, title) {
    if (_dry) return Promise.resolve(simulatedResponse(destPath));
    return postForm(CONFIG.WCM_COMMAND, {
      cmd: 'createPage',
      parentPath: parentOf(destPath),
      label: nameOf(destPath),
      title: title,
      template: template
    });
  }

  function attemptCopy(sourcePath, destPath) {
    if (_dry) return Promise.resolve(simulatedResponse(destPath));
    return postForm(CONFIG.WCM_COMMAND, {
      cmd: 'copyPage',
      srcPath: sourcePath,
      destParentPath: parentOf(destPath),
      destName: nameOf(destPath),
      // Must be the string "true". The parameter DEFAULTS TO FALSE, and false
      // means a deep copy of the entire subtree - the opposite of the ask.
      shallow: 'true'
    });
  }

  async function createShell(a) {
    var used = a.template;
    var r = await attemptCreate(a.destPath, used, a.title);

    if (!r.success) {
      // Re-read before retrying: the command may have half-succeeded, or
      // someone else may have created the page in the meantime.
      var now = await inspect(a.destPath);
      assertReadable(now, 'destination page');
      if (now.exists) {
        warn('createPage reported a failure but ' + a.destPath + ' now exists' +
          (now.template ? ' with template ' + now.template : '') + ' - leaving it as it is.');
        return now;
      }

      var retryTemplate = (a.fallbackTemplate && a.fallbackTemplate !== used) ? a.fallbackTemplate : used;
      warn('createPage failed for ' + a.destPath + ' - ' + serverMessage(r));
      warn('       Retrying once with ' + retryTemplate + '.');

      used = retryTemplate;
      r = await attemptCreate(a.destPath, used, a.title);

      if (!r.success) {
        throw Abort(
          'createPage failed twice for ' + a.destPath + '  [HTTP ' + r.http + ' / status ' + r.effective + ']\n' +
          '         ' + serverMessage(r) + '\n' +
          templateHint(a.destPath, used)
        );
      }
    }

    // AEM sanitises and uniquifies node names. If it did either, every deeper
    // path in the plan is now wrong - stop rather than build on a bad guess.
    if (r.resultPath && norm(r.resultPath) !== norm(a.destPath)) {
      throw Abort(
        'AEM created the page at ' + r.resultPath + ' but the plan expected ' + a.destPath + '.\n' +
        '         Aborting so the remaining steps do not target the wrong path.'
      );
    }

    ok(did('created      ', 'would create ') + a.destPath + '   [' + used + ']');
    return r;
  }

  async function copyLeaf(a) {
    var r = await attemptCopy(a.sourcePath, a.destPath);

    if (!r.success) {
      // A blind retry after a partial success would land as "<name>-1", so ask
      // the repository what actually happened first.
      var now = await inspect(a.destPath);
      assertReadable(now, 'destination page');
      if (now.exists) {
        throw Abort(
          'copyPage reported a failure but ' + a.destPath + ' now exists.\n' +
          '         ' + serverMessage(r) + '\n' +
          '         Not retrying - a second copy would land as "' + nameOf(a.destPath) + '-1".\n' +
          '         Open the page and check whether its content came across in full.'
        );
      }

      warn('copyPage failed - ' + serverMessage(r) + '. Retrying once.');
      r = await attemptCopy(a.sourcePath, a.destPath);

      if (!r.success) {
        throw Abort(
          'copyPage failed twice: ' + a.sourcePath + ' -> ' + a.destPath +
          '  [HTTP ' + r.http + ' / status ' + r.effective + ']\n' +
          '         ' + serverMessage(r)
        );
      }
    }

    if (r.resultPath && norm(r.resultPath) !== norm(a.destPath)) {
      throw Abort(
        'Copy landed at ' + r.resultPath + ' instead of ' + a.destPath + '.\n' +
        '         AEM auto-renames on collision - check the destination parent for an existing page.'
      );
    }

    ok(did('copied       ', 'would copy   ') + a.sourcePath + '  ->  ' + a.destPath);
    return r;
  }

  async function verifyResult(a) {
    var info = await inspect(a.destPath);
    assertReadable(info, 'copied page');
    if (!info.exists) {
      throw Abort('Post-copy check: ' + a.destPath + ' does not exist. The copy reported success but wrote nothing.');
    }
    if (!info.isPage) {
      throw Abort('Post-copy check: ' + a.destPath + ' is ' + info.primaryType + ', not a cq:Page.');
    }
    if (!info.template) {
      warn('Copied page has no cq:template - open it in the editor and check: ' + a.destPath);
    }

    // copyPage carries the source's replication properties across, so a page
    // that has never been published shows as Published in the Sites console.
    if (info.content && info.content['cq:lastReplicated']) {
      warn('Copied page inherited the source\'s replication status - the Sites console will show it');
      warn('       as published (' + info.content['cq:lastReplicated'] + '). It is NOT live at the new path.');
    }

    if (CONFIG.VERIFY_SHALLOW && info.childPages.length) {
      warn('shallow=true did not hold - ' + info.childPages.length + ' child page(s) came across too:');
      info.childPages.forEach(function (c) { console.log('         ' + a.destPath + '/' + c); });
      console.log('%c       Remove them from the Sites console if they are not wanted.', CSS.skip);
    }
    return info;
  }

  /* --------------------------------------------------------------- public */

  function reportLeftovers(created) {
    if (_dry) {
      console.log('%c  Dry run - nothing was written, so there is nothing to clean up.', CSS.skip);
      return;
    }
    if (!created.length) {
      console.log('%c  Nothing was written before the failure.', CSS.skip);
      return;
    }
    warn('These intermediate pages were created before the failure and are still in place:');
    created.forEach(function (c) { console.log('%c         ' + c, CSS.mono); });
    console.log('%c       This script never deletes - remove them from the Sites console if unwanted,', CSS.skip);
    console.log('%c       or fix the cause and re-run: the existing ones will simply be skipped.', CSS.skip);
  }

  async function plan(source, dest) {
    try {
      var p = await buildPlan(source, dest);
      renderPlan(p);
      renderMsm(p);
      console.log('%c  Plan only - nothing was written.', CSS.skip);
      console.log('%c  AEMCopy.dryRun(...) to simulate the run, AEMCopy.run(...) to execute.', CSS.skip);
      return p;
    } catch (e) {
      if (e.__aemAbort) { fail(e.message); return null; }
      throw e;
    }
  }

  async function run(source, dest, opts) {
    opts = opts || {};
    _dry = (opts.dryRun !== undefined) ? !!opts.dryRun : !!CONFIG.DRY_RUN;

    try {
      var p;
      try {
        p = await buildPlan(source, dest);
      } catch (e) {
        if (e.__aemAbort) { fail('ABORTED - ' + e.message); return null; }
        throw e;
      }

      renderPlan(p);

      // MSM is the one failure here that is both silent and destructive, so it
      // stops a real run until the operator says otherwise. Dry runs still show
      // it but carry on, since they write nothing.
      var msmFound = renderMsm(p);
      if (msmFound && !_dry && !opts.force) {
        fail('ABORTED - the copy involves an MSM live copy (see above). Nothing was written.');
        console.log('       If that is expected, re-run with:');
        console.log('%c       await AEMCopy.run(\'' + p.source + '\', \'' + p.dest + '\', { force: true })', CSS.mono);
        return null;
      }
      if (msmFound && opts.force) warn('Proceeding anyway because force:true was passed.');

      banner(_dry ? 'DRY RUN - simulating, no writes will be sent' : 'EXECUTING');

      var created = [];
      try {
        for (var i = 0; i < p.actions.length; i++) {
          var a = p.actions[i];
          if (a.kind === 'skip-root') { continue; }
          if (a.kind === 'skip') { skip('exists       ' + a.destPath); continue; }
          if (a.kind === 'skip-nonpage') { warn('exists as ' + a.primaryType + ', left alone: ' + a.destPath); continue; }
          if (a.kind === 'create') { await createShell(a); created.push(a.destPath); continue; }
          if (a.kind === 'copy') {
            await copyLeaf(a);
            // Nothing was written, so there is nothing to read back.
            if (!_dry) await verifyResult(a);
            continue;
          }
        }
      } catch (e) {
        if (e.__aemAbort) {
          fail('ABORTED - ' + e.message);
          reportLeftovers(created);
          return null;
        }
        throw e;
      }

      if (_dry) {
        banner('DRY RUN COMPLETE - nothing was written');
        console.log('  ' + created.length + ' page(s) would be created, then ' + p.source + ' would be copied.');
        console.log('  Execute for real with:');
        console.log('%c  await AEMCopy.run(\'' + p.source + '\', \'' + p.dest + '\')', CSS.mono);
        if (CONFIG.DRY_RUN && opts.dryRun === undefined) {
          warn('CONFIG.DRY_RUN is true, so plain run() calls will keep simulating.');
          warn('       Set AEMCopy.config.DRY_RUN = false to arm the script.');
        }
        return p;
      }

      banner('DONE');
      console.log('  ' + p.dest);
      console.log('  Open: ' + location.origin + '/editor.html' + p.dest + '.html');
      return p;
    } finally {
      // Never leave the flag set: a later run() must not silently no-op.
      _dry = false;
    }
  }

  function dryRun(source, dest) {
    return run(source, dest, { dryRun: true });
  }

  window.AEMCopy = {
    plan: plan,
    dryRun: dryRun,
    run: run,
    inspect: inspect,
    templateAvailability: templateAvailability,
    config: CONFIG
  };

  banner('AEMCopy ready');
  console.log('  AEMCopy.plan(source, dest)     resolve and print the plan table');
  console.log('  AEMCopy.dryRun(source, dest)   simulate the whole run, no writes');
  console.log('  AEMCopy.run(source, dest)      execute');
  console.log('  AEMCopy.config                 MARKETING_TEMPLATE / ROOT_DEPTH / DRY_RUN');
  console.log('%c  This script only creates and copies - it never deletes anything.', CSS.skip);
})();
