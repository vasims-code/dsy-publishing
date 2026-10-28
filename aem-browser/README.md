# DSY — Digital Samsung Yard

The Samsung Publishing team's browser. A desktop browser (Electron, so Chromium inside) for AEM authors, with the AEM
Toolkit built in as a side panel. The interface is the design made in Emergent
(the project export is in `D:\spub-main`), connected to real tabs and to the
extension's engine. Emergent's mock screens and sample data are not used.

## Install

Run `releaseDSY-Setup-<version>.exe`. It installs for the current user
only (no admin rights needed) into `%LOCALAPPDATA%ProgramsDSY`, with a
Start menu entry and a desktop shortcut. Uninstall from Windows Settings → Apps.

The installer is **not code-signed**, so Windows SmartScreen says "Windows protected your
PC": choose *More info* → *Run anyway*. Signing it with a company certificate removes that.

Sign-ins, open tabs, settings and recent pages are kept in `%APPDATA%DSY` — shared
by the installed app and a development run.

Before 0.3.0 the browser was called "AEM Toolkit Browser". On its first start DSY copies
that folder into its own (marked by `carried-over.txt`), and its installer keeps the same
app id, so it replaces the old app rather than installing beside it.

## Develop

```bash
npm install
npm start          # build, then open the browser
npm run dist       # build, then make the installer in release/
```

`npm run build` makes `dist/`: the main process (with the toolkit modules it uses bundled
in), the tab engine, the preload and the interface. After changing the extension in
`../aem-toolkit`, build again — the browser takes its code from there at build time.
`npm run icon` remakes `build/icon.png` (and the new tab page's copy) from
`build/icon-source.jpg`, the AI-made original: it cuts the teal tile out of its backdrop
onto transparency.

## Status

| | |
|---|---|
| Tabs (drag to reorder), address bar, back/forward/reload, find, zoom, print, right-click menus | Working |
| Sign-in through WDS, status per author server, kept between restarts | Working |
| New tab page: author servers and recent pages | Working |
| Toolkit panel: all six tools, on the extension's own engine | Working — read-only steps tested on both servers; write steps not yet tried here |
| Settings: author servers, sign-in page, appearance (light / dark / match Windows), tools, every toolkit setting | Working |

## How the toolkit runs

Nothing of the extension is copied: the browser builds from `../aem-toolkit/src`.

- **In the tab** — `scripts/build-engine.mjs` bundles the extension's content runtime
  and the six feature workers into `dist/engine.js`. `electron/engine.mjs` injects it
  into an isolated world of the author tab (same origin and cookies as the page, none of
  its scripts) and sends each command there; progress reports are drained from a queue
  in that world a few times a second.
- **In the panel** — `renderer/src/engine/store.js` is the extension's `panel.js` flow
  (analyze → review → run → done) without its DOM. The forms come from each feature's
  `meta.js`; what a feature draws itself (trees, tables, the version list, the copy
  deck preview, the import's paste box) is its own `panel.js`, drawn into `.tk`
  containers and styled by `toolkit.css` — the extension's stylesheet, generated at
  build time, scoped and coloured with the browser's design tokens.
- **Settings** — the toolkit's settings and the copy deck's field lists are kept in
  `storage.json` through a `chrome.storage.sync` stand-in, so the extension's code
  reads and writes them unchanged. The author servers are the browser's.

The tab a run talks to is fixed when it is analyzed, so a review and its write always
go to the same tab.

## Layout

```
electron/
  main.mjs         window, shortcuts, menus, sign-in checks, IPC
  tabs.mjs         one WebContentsView per web tab, laid over the page area
  aem.mjs          which server a URL is on, the page it shows, who is signed in
  engine.mjs       injects and runs the toolkit engine in author tabs
  cookies.mjs      session cookies kept across restarts (DPAPI-encrypted)
  store.mjs        settings / recent pages / open tabs as JSON files
  preload-ui.cjs   the interface's window.browser API
renderer/          the interface (React + Tailwind), built by Vite
build/             icon-source.jpg (the original) and icon.png (scripts/icon-from-image.mjs)
engine/            the tab-side entry for dist/engine.js
scripts/           build-engine.mjs: dist/main.mjs, dist/engine.js, toolkit.css
release/           the installer (npm run dist)
```

The web page is a native view drawn on top of the interface, so nothing in the
interface can overlap the page area: menus there are native menus, and the find
bar is a row of its own.

## Keyboard

Ctrl+T new tab · Ctrl+Shift+T reopen closed · Ctrl+W close · Ctrl+Tab / Ctrl+1…9
switch · Ctrl+L / Alt+D address bar · Ctrl+R / F5 reload · Alt+←/→ back/forward ·
Ctrl+F find · Ctrl+= / Ctrl+- / Ctrl+0 zoom · Ctrl+P print · F12 developer tools ·
F11 full screen · Ctrl+, settings

Typing a `/content/...` path in the address bar while on an author server opens
that page in the editor there.

## Things to know

- **The sign-in check adds a unique query string.** The dispatcher in front of
  the author servers serves a cached `currentuser.json` — naming another user —
  to anyone without a login cookie, whatever the request's Cache-Control says.
- **Session cookies are kept between restarts**, encrypted with DPAPI, the way Chrome
  keeps them with "Continue where you left off": WDS and the AEM login token are session
  cookies, so without this every start meant signing in again.
- **Tabs a page opens use Chromium's own new web contents** (`createWindow`), not
  a fresh load of the URL: the WDS → AEM hand-over posts the user's details to a
  new tab and fails with "Invalid email format" if the post body is dropped.
