# Working in this folder

Read `README.md` first - it has the architecture, how to run the preview and
the tests, and the rules this UI holds to. This file is the part that only
matters while changing things.

## What this is

A new UI over the engine of `D:\chrome-extensions\aem-toolkit`. The old
extension works and is still what the user runs for real jobs. Here, the
engine is copied and only `src/ui/` is new.

## Before you finish any change

```bash
python tools/check.py
DSY_DATA=<folder with src.json and dst.json> node tools/engine-test.mjs
python preview/serve.py . 8800     # then open /preview/test.html
```

`check.py` fails if an engine file drifts from the old extension. That is the
point: a change under `src/core/` or `src/features/` should be a decision you
can explain, never a slip. The files allowed to differ are listed in
`CHANGED_ON_PURPOSE` in `check.py`, each with its reason - add to it only
alongside the reason.

`preview/test.html` drives the real screen modules with every worker stubbed,
so it proves what a screen draws and never what a run does to a page.
`tools/engine-test.mjs` is the other half: no screens, the real worker, and an
in-memory AEM it reads and writes. It exists because a cross-server copy
emptied a real page on 2026-11-01 and nothing in the browser suite could have
caught it. Run it whenever you touch `src/core/diff.js`, `src/core/execute.js`
or a worker.

## Things that have already gone wrong here

Each of these cost a round trip with the user. Do not rediscover them.

- **`summarise` has no `settings`.** It takes what the plan needs as named
  arguments. Reaching for `settings` inside it throws at run time, and no
  browser test catches it because every worker there is stubbed -
  `tools/engine-test.mjs` does.
- **A 200 from Sling says nothing about the page.** An empty ChangeLog means
  it read no parameters and did nothing. Every content write now reads the
  page back (`confirmWritten`); do not replace that with a check on the
  response.
- **A copy emptied a real page.** On 2026-11-01 a cross-server copy left the
  destination's components standing with nothing in them. The plan that does
  that removes everything and writes nothing; two guards now refuse it
  (`assertHasContent` at the source read, `assertNotStripping` under every
  write). **The cause of the bad read is still not known.** If you find it,
  say so in `README.md` and keep both guards.

- **Editing files changes nothing Chrome runs.** Bump the manifest version and
  build a zip (`tools/build-zip.py`), or the user sees no change and says so.
- **Chrome refuses a file or folder whose name starts with `_`.** A folder
  called `_preview` blocks the whole extension from loading.
- **ES modules cache hard.** `preview/serve.py` sends `no-store`. If an edit
  still does not show, serve on a different port - the module map is per
  origin, and a hard reload in the pane does not always clear it.
- **A stale module looks exactly like a bug in new code.** Check what the
  server is actually serving before debugging the source.
- **`panel.html` is CRLF; everything else is LF.** A patch script that writes
  `\n` patterns will silently not match it.
- **Assert on every scripted replacement.** A `str.replace` that does not
  match fails silently, and the next symptom is far away from the cause.
- **Do not guess at AEM's behaviour.** Both wrong versions of the
  "changed since version" check came from assuming what AEM does on restore.
  Look for a function in the codebase that already answers the question -
  `confirmRestored` did.

## When a screen misbehaves

- A blank panel is usually the scroll position, not a render failure. Check
  `view.childElementCount` before assuming nothing drew.
- A screen's `render` is `async`, so a throw inside it arrives as a rejected
  promise. `drawTool` in `panel.js` catches both and shows the reason rather
  than leaving the panel blank.
- Tool state lives on the shell (`toolState`), not on the screen module, and
  is dropped when you leave a tool.

## Tests

`preview/tests.js` drives the real screen modules against stubbed workers with
`preview/harness.js`. Add a test for anything you fix.

- Wait with `H.until(condition)`, never `H.settle(ms)`, after anything that
  goes to a worker.
- Fixtures at the top of the file are shaped like the real worker results.
  If a shape is wrong the test proves nothing, so check it against the worker
  rather than inventing it.
- The last few tests are sweeps across every screen - `undefined` in rendered
  text, controls with no name for a screen reader, a read screen that claims
  to write. Keep them passing.

## The user's own constraints

- **Never change content on a real AEM author server while testing.**
  Read-only steps only; do not press anything that writes.
- Downloaded files are encrypted by the corporate DRM, so their bytes are not
  the file. Ask for pasted cells rather than reading a file from disk. The
  import screen handles this: `isDrmProtected` catches it by name.
- Leave work uncommitted until the user has tried it in Chrome themselves.

## Style

Match the surrounding code: hyphens rather than em dashes in source comments,
a comment that says *why* and not *what*, British-ish plain English in user
text. Tokens for every colour and length - no hex in `panel.css` outside
`tokens.css`.
