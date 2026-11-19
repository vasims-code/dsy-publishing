# Digital Samsung Yard For Publishing

A Chrome side-panel extension for AEM authoring. This folder is a **new UI**
over the engine of the existing extension at `D:\chrome-extensions\aem-toolkit`.

The old extension works; its look did not. So the logic was carried across
untouched and only what you see was rebuilt.

```
engine, copied from the old extension   15,073 lines   src/core, src/features, src/background, src/content
UI, written for this folder              6,300 lines   src/ui
```

`tools/check.py` compares the engine against the old extension file by file.
Most files are byte-identical. The ones that differ are listed in
`CHANGED_ON_PURPOSE` in `check.py`, each with its reason - see *Deliberate
engine change* and *What the break test of 3 November changed* below.

---

## Trying it

### In Chrome

```bash
python tools/build-zip.py 1.0.1
```

Writes `D:\dsy-1.0.1.zip`, then install that at `chrome://extensions`. Or use
**Load unpacked** on this folder - but note Chrome refuses any file or folder
whose name starts with `_`.

Editing files here changes nothing Chrome runs until you reinstall. The card
at `chrome://extensions` should read **Digital Samsung Yard For Publishing** and
the version you built.

The extension has **its own Chrome storage**, separate from the old one, so on
first run there are no instances and no settings. Open an AEM author tab and
press **Allow this site**, then set the Backup and Copy a page options in
Settings to match what you had.

### In a browser, without Chrome

```bash
python preview/serve.py . 8800
```

| Page | What it is |
|---|---|
| `http://127.0.0.1:8800/preview/home.html` | the panel, driven by stubbed AEM answers |
| `http://127.0.0.1:8800/preview/options.html` | the settings page |
| `http://127.0.0.1:8800/preview/test.html` | the tests |

The server sends `no-store`. Without that the browser keeps an old copy of a
module after an edit, and a stale copy looks exactly like a bug in the new
code. If a change still does not show, serve on a different port - the module
map is per origin.

---

## Checking it

```bash
python tools/check.py                              # parses, CSS, engine untouched
# then open http://127.0.0.1:8800/preview/test.html
```

`preview/tests.js` drives the real screen modules against stubbed workers and
looks at what they drew: **75 tests**, covering the happy path of all five
tools, the empty and refused cases, the confirmations a worker will not write
without, and a sweep for `undefined` in rendered text, unlabelled controls and
a read screen that claims to write.

Waits in the tests are conditions, never a fixed delay. A test that passes on
a fast run and fails on a slow one says nothing about the code.

---

## How it is put together

```
manifest.json          MV3. Side panel -> src/ui/panel.html, options -> src/ui/options.html
src/background/        service worker: injects the content script on demand
src/content/           runs inside the AEM page; one run at a time per tab
src/core/              AEM client, paths, diff, link rewriting, settings, protocol
src/features/<id>/     meta.js (the schema) + worker.js (the AEM work)
src/ui/                everything you see
preview/               stubs, the harness and the tests. Not shipped.
tools/                 build-zip.py, check.py. Not shipped.
```

### The UI layer

| File | What it does |
|---|---|
| `tokens.css` | every colour, corner and height. Change the look here. |
| `panel.css` | the design's shapes as classes |
| `panel.html` / `panel.js` | the shell: which tab, which instance, which tool |
| `tools.js` | the five tools the home screen offers, and the features behind each |
| `parts.js` | step bar, connection pill, notice, counts, label/value rows, footer |
| `tree.js` | the repository tree, drawn the way CRXDE draws it |
| `run.js` | one request to a tab; `tabFor` finds or opens a tab on another instance |
| `transfer.js` | the one flow the panel drives itself, across two tabs |
| `icons.js` | icon paths |
| `screens/*.js` | one file per tool |
| `options.html` / `options.js` | the settings page |

### Seven tools over twelve features

`tools.js` is where that mapping lives. Three tools ask one more question
before they start, so the home screen stays seven rows long:

| Tool | Features | The extra question |
|---|---|---|
| Copy a page | `page-upsert`, `page-transfer` | This server, or another one |
| Copy a component | `component-copy` | |
| Backup | `page-copy` | |
| Copy deck | `copy-deck`, `copy-deck-import` | Export, or import |
| Links | `broken-links`, `link-fixer`, `site-code-fixer`, `image-site-fixer` | Which of the four |
| Arabic flipping fixer | `arabic-fixer` | |
| Versions | `page-versions` | |

Copy a page asks its question as a segmented control, because both answers
fill in the same form. Copy deck and Links ask with a card each, because the
answers are different flows with their own steps, footers and workers -
`screens/links.js` chooses and hands over, and the screen behind each card is
the tool's own, unchanged. Links is marked *Reads + writes* on the home
screen: the broken link finder only reads, and its card says so.

The Site Code Link Fixer lists links in a page's content that point into
another site - `/ae_ar/...` on an `/sa` page - and re-points the ticked ones at
the page's own site, changing only the site code. A code counts as a site only
when AEM has a page at `/content/<brand>/<code>`, and each corrected link's page
is looked up first: one this site does not have is flagged and left unticked.
Page properties (canonical, hreflang) are not scanned.

The Image Site Code Fixer (`image-site-fixer`, 1.5.0) does the same for
images: it lists every image in the page's content that sits in another DAM
folder - `/content/dam/samsung/lb/...` or
`images.samsung.com/is/image/samsung/assets/lb/...` on an `/iq_ku` page - and
for the ticked ones uploads each to the page's own folder at the same path,
then re-points every reference in the form it was written. Upload, never a
repository copy: it is Copy a page's own `uploadAsset`, so Dynamic Media
processes the image and gives it its own address. An image gone from the
source DAM is taken from images.samsung.com; one that is already in the
folder is only re-pointed; one found nowhere has no box. Another site's
folder is ticked for you, a shared folder (`/global`) and an inherited
component are not. The page's DAM folder is the site code unless the form
names another (`/ae` for `/ae_ar`). Images are uploaded and found before any
property changes.
`tools/image-site-fixer-test.mjs` runs it against an in-memory AEM.

### Copy a component

Its own row on the home screen and its own feature, `component-copy`: one
component copied from a source page into a destination page that already
exists, above a component the author picks there (or at the end of a
container) - on this server, or from another one.

It is not a second copier. `component-copy`'s worker hands every action to
`page-upsert`, refusing any that does not name a component, and `buildPlan`
narrows its two trees with `src/features/page-upsert/component.js`: the
source becomes that component alone, already at its new place; the
destination is the page as it is. The rest of the plan is the page plan, so a
component gets exactly what a page gets - links and image references
re-pointed between sites (nothing rewritten on the same site), images the
destination's DAM lacks uploaded, the lock check, one write, and the
read-back. Removals are off: nothing on the destination is changed or removed,
and a name already taken there gets the next free one (`_copy`, `_copy_2`)
rather than overwriting it. The new node is placed with Sling's `:order`, so
its siblings do not move.

The screen is Copy a page's, drawn in its component form
(`screens/copy-component.js` passes `componentOnly`), so the review, the
confirmation and the result are the same ones. `tools/engine-test-copy-component.mjs`
runs the real workers against an in-memory AEM.

**From another server** the component goes through the two-tab transfer
(`ui/transfer.js`, `page-transfer`), narrowed at both ends with the same
`component.js`. Each tab lists its own page's components for the pickers
(`components`); the source tab reads and carries only the component and its
images (`readPage` with `component`); the destination plans against its page
as it is, with no pairing (`scopedPlan`): every node of the component is new,
placed with `:order`, removals off. The destination page must already exist
on that server. The engine test drives it between two in-memory servers.

## Deliberate engine change

`src/features/broken-links/worker.js`: images and files under `/content/dam/`
are never looked up. The finder is for links, and the old "check images too"
setting (`linkCheckAssets`) is gone with it, so an image is listed under its
component and marked *not checked*, the way a link to another site is. A scan
of a long page is that many fewer reads.

A lookup the server redirected is reported as where it went, not as *No
answer*. AEM answers the `.1.json` of a page whose redirect is set by sending
the request to the target, dropping the `.json` on the way, so what comes back
is the target's HTML - and `JSON.parse` failing on it used to read as
"answered with something other than JSON". Every retired page on a site
therefore sat under *Need a look*. `fetch` follows the whole chain, so the
status is already the end of it: a dead end comes back as the 404 it is, and
anything else landed on a page that renders. `verdict` turns it into the
`ok` + *Redirects* the screen already draws for a page with `redirectTarget`.

Both are guarded by `tools/broken-links-test.mjs`, which runs the real `scan`
against a fake AEM. It exists because removing the setting left one use of its
variable behind, and every scan threw `checkAssets is not defined` while all 80
browser tests passed - the browser suite stubs the worker, so it could not have
seen it.

`src/features/page-versions/worker.js`, in the read-only `list` action:

- `listVersions` also returns the live page's `cq:lastModified` /
  `cq:lastModifiedBy`.
- `list` calls the existing `confirmRestored` and returns `drift`
  `{ changed, where }` - whether the page still holds the content of the
  version it sits on.

This is what lets the Versions screen say "The page no longer matches version
4". Two earlier attempts got it wrong, and both are worth remembering:

- Comparing timestamps **cannot work**. AEM writes a fresh `cq:lastModified`
  when it restores, so a page put back to version 1 looks edited the moment the
  restore finishes.
- Comparing content needs the right exclusions. `cq:name`, `cq:parentPath`,
  `cq:siblingOrder` and `cq:versionComment` live only on a frozen node, so
  comparing them reports four changes on every page that has ever been
  versioned. `confirmRestored` already handled all of this - the fix was to
  use it instead of writing a second, worse comparator beside it.

Since 3 November, page properties an author sets (tags, navigation title,
vanity path, redirect target and the like) count as drift too - they used to
be noted and ignored, so "Already on version 4" could hide them, and a restore
dropped them unseen. When the comparison cannot run (a page too big to read
whole, a 403), `drift` says `unknown` and the screen says it could not compare,
rather than claiming the page already holds the version.

---

## What the break test of 3 November changed

Every tool was pushed with hostile input against an in-memory AEM. What broke,
and the rule now in its place:

- **The strip guard no longer gives way to one small write.** Three or more
  components emptied need the removals box even when something else is
  written; nothing written at all is still always refused. Every component
  going, or three or more, needs the box too - not a share of the page.
- **The read-back looks at everything.** New components' properties, nodes
  that never appeared, and removals that did not happen all count. A write
  that only partly landed is a warning naming what did not hold, never "the
  destination now matches the source".
- **The removals box covers what is removed, not only its name**, so a
  colleague's edit between the review and the click is refused.
- **A backup that differs is saved as a version before it is overwritten.**
  It is the only copy; run twice on a damaged page, the old way made the damage
  the backup. That version is also what lets the strip guard pass a backup
  update with nobody on a review to confirm it.
- **A `.` or `..` in a path is refused everywhere** (`segs` in `paths.js`),
  because the browser resolves it and the check did not: a "backup page"
  path could restore a live one. The backup folder is one place - directly
  under the site root - for every tool.
- **A signed-out session is said as that.** AEM answers a sign-in page at 200;
  it used to read as "the page exists" and then as a cut-off read.
- **Copy deck import** refuses a Translation column that slipped a row,
  invisible text, number or date cells in an uploaded sheet and `data:` links;
  a request AEM never answered is put back with the rest.
- **The Link Fixer** no longer takes a bare host name in a title or alt text
  for a link, nor uses Copy a page's extra hosts; each pick is checked against
  a fresh scan before it is written.
- **A tool stays with the tab it read.** A write for a tab that has since
  moved to another server is refused in the panel and again in the page.
  Back is held while a write runs, so its result is never thrown away.

Not changed: a Double served as `2.0` still lands as a Long, and a Long over
2^53 loses precision on the way through - not a small change. The
cross-server copy (`transfer.js`) picks its own two tabs and is not pinned the
way the other tools are.

---

## Where it stands

**Built and checked in the preview:** all five tools, the settings page, 75
browser tests and the engine checks passing.

**Copy a page, across servers.** The page open in the tab is the one being
copied, so this tab's instance is the source and its path is the source path.
The destination instance is the one thing the panel cannot work out, so it is
left unchosen; the destination path is one tap away with *Use the same path as
the source*. Guessing either side of that pairing names a server the page was
never seen on.

**Dynamic Media.** Images are uploaded through DAM's own `createasset`, never
copied through the JCR - a copy carries the source's Scene7 metadata, never
reaches Scene7, and the published page shows nothing. An image gone from the
source DAM but still served by Dynamic Media is listed under *to do by hand*
with its live and staging delivery URLs (`core/dynamic-media.js`), because that
copy is the only place left to get it from.

An image can also be *named* by its delivery URL - a static content
component's `<picture>` writes `images.samsung.com/is/image/samsung/assets/lb/...`
rather than `/content/dam/samsung/lb/...`. Until 1.4.12 nothing read that as an
image, so a copy from /lb to /iq_ku uploaded none and left every URL naming /lb.
`damForm` now reads it as the DAM path it serves: the image is uploaded like
any other and the URL re-pointed at the destination site, staying a URL.
Not yet confirmed on a server: AEM's publish-with-references is not expected
to find these images, since it looks for `/content/dam` paths, so check they
are published before trusting the live page.

**The fault of 2026-11-01, and the two floors under it.** A cross-server copy
left the destination's components in place with every property gone - the page
structure was there and its content was not. Reproduced in
`tools/engine-test.mjs` against the real page JSON: a plan built from a source
tree that has the nodes but no properties removes 1,550 properties from 75
components and writes nothing anywhere, which is exactly the damage. **Why the
source read back that way is still not known.** Two guards now make that plan
unwritable:

- `assertHasContent` in `src/features/page-transfer/worker.js` refuses a source
  page of four or more components where not one holds a property of its own -
  at the read, before the other instance is told anything.
- `assertNotStripping` in `src/core/execute.js` refuses any write that would
  empty three or more components while writing nothing anywhere on the page.
  This one sits under *every* write feature, not just the transfer.

`node tools/engine-test.mjs` runs the real engine against an in-memory AEM and
checks that both guards fire and that an ordinary copy still writes everything.
It uses `tools/fixtures/` - the two real pages with every piece of copy
replaced, the shape and the resource types kept - or the real JSON if you set
`DSY_DATA` to a folder holding `src.json` and `dst.json`.

The direction runs again. The standing warning that used to be on the screen
was taken off on purpose; the two guards are what stop that plan now. Take a
backup you can reach and look at the page afterwards.

**A backup is not always possible.** `backupPathFor` refuses a page that is
already inside the backup folder, which is how the 1 November run wrote with no
backup at all. That used to pass in silence; `backupFirst` now says so.

**A site's home page backs up as `home`.** `/content/samsung/levant_ar` has
nothing after the site root to put under the folder, so its backup would have
been the backup folder itself - the page holding every other backup. It goes
to `/content/samsung/levant_ar/india/backup/home` instead (`HOME_BACKUP` in
`core/paths.js`). AEM's copy cannot rename, so that backup is made from the
home page's own template and then filled by the same sync plan an update
uses (`copyRenamed` in `page-copy/worker.js`), removals of what the template
put there included; every other backup is still an AEM copy. A real page
called `home` right under the site root is refused a backup, since it would
land on the same place. `tools/engine-test-home-backup.mjs` runs it.

**The activity log.** Every line a worker reports - what it read, wrote or
skipped - is kept by `src/ui/log.js` and shown under the run, folded away when
it went fine and open when it did not. The panel used to listen only for
progress steps and throw the rest away, so a run that skipped two images
because AEM answered 503 said so in a line nobody ever saw. `src/ui/panel.js`
puts the log at the bottom of any screen that did not place it itself, so no
reported line is ever unreachable.

**The biggest image a transfer carries.** `transferMaxImageMb` in Settings,
25 MB by default (1-256). Over it, the image is left where it is: the page
still goes across pointing at where it belongs, the image is listed under *to
do by hand*, and the run never stops for it. The limit is checked in the plan
- so the review names what will be left behind before anything is written -
and again in `readAsset`, in case the asset grew between the two. The log says
when the limit bites and that Settings is where to change it.

**Big images.** Two 68 MB images were given up on at 60s - the floor for "no
bytes have moved, so this is stuck". A large upload through a busy author
instance can sit with a full socket and report no progress for far longer than
that and still be alive, so `uploadWait` in `core/aem-client.js` now grows the
allowance with the size (60s + 3s per MB, capped at 10 minutes) and says how
far it got when it does give up. The review names any image over 30 MB and how
long it will be given. A failed upload has always been skipped and listed under
*to do by hand* rather than stopping the copy - but a run that then failed at
the page write lost that list, so `ui/transfer.js` attaches it to the error and
the failure screen shows it.

**A write is looked at, not assumed - whether it failed or "succeeded".**
"Saved" used to mean "AEM answered 200 with a Sling status in the 200s", which
is a statement about the request, not about the page. `executeDiff` now reads
the page back after every content write (`confirmWritten`) and reports how many
properties actually hold their new value; none holding is an error, not
"Done.". It also reports Sling's own ChangeLog count, because a 200 with an
empty ChangeLog is a write that was accepted and did nothing. On a failure it
reads the page back too, rather than claiming nothing changed.

`tools/engine-test.mjs` applies the writes it is given, so a copy can be read
back and compared with the source - the one thing the browser suite, where
every worker is stubbed, can never say.

**How a site's titles end.** A home page does not state its ending, and more
than one reading of it is possible. Samsung's UK home page is called "Samsung
UK" and shares as "Samsung UK | Home Appliances | TV", so "its share title
minus its own name" reads the ending as " | Home Appliances | TV" - while every
content page on that site ends " | Samsung UK". `titleEndings` in
`core/site-values.js` now offers the readings instead of picking one, and
`siteValues` takes the one the page being copied actually bears out, then reads
the destination's ending by the same rule. The readings include `name-first` -
the first segment of the home page's share title, moved to the end - because
Samsung's home pages are titled "Samsung" and share as "Samsung UK | Home
Appliances | TV" while their content pages end " | Samsung UK". A page that ends in none of them is
still left exactly as it is, with a note. (The "last segment" reading also had
a regex that let a bar through as its own `\S`, so it matched two segments as
one; fixed.)

**A write AEM accepts and acts on none of.** On 2026-11-02 a 1,616-parameter
page write came back HTTP 200, Sling status 200, and an **empty ChangeLog** -
Sling had read no parameters at all out of the body. `writeTree` sends
multipart, because a form-encoded body meets the server's form size limit on a
big page; something between the browser and Sling was not passing that body on.
`postPairs` now retries once form-encoded whenever a multipart write comes back
with an empty ChangeLog, and says in the log which encoding did the work.
`confirmWritten` sits under it either way.

**The page-properties box is a choice, not a gate.** It used to refuse the
whole run unless ticked, which made a locale's own `canonical` and
`redirectTarget` a reason not to copy the page at all. Unticked now means
*keep the destination's own page properties* (`keepPageProps` in
`core/diff.js`) and copy everything else; ticked overwrites them. A property
the destination does not have still gets the source's either way - an empty
field is not something anyone chose to keep. Removals still hold the run:
losing components is not a thing to decide by leaving a box alone.

One trap in that: unticked, the plan preserves those properties, so they stop
appearing as changes - and the box offering to overwrite them would vanish,
leaving no way to turn it on. `diff` marks a property held back *by the box*
(`why: 'box'`), and `metadataFor` builds the list from both what would change
and what the box is holding.

**What is ignored is on the settings page, not only in the code.** Settings
shows, read-only, the three lists the engine decides for itself: the system
properties never copied (`SYSTEM_PROPS`), the components always kept
(`KEEP_NODES`), and the page metadata kept as the destination has it
(`PAGE_METADATA`). `LOCALE_OWNED` in `core/protocol.js` - `localContent` and
`publishedDateByWorkflow` - joins the kept list on both the same-server and
the cross-server copy: they say where a page sits in its own locale and when
it went live there, so carrying the source's across is always wrong. They are
not offered by the review's page-properties box, so ticking it does not
overwrite them.

**Not done:**

- **Nothing has run against a real AEM server.** Every walkthrough used stubs.
  The riskiest parts are the parameters each screen builds for a worker, and
  the piece-by-piece image carrying in a transfer.
- **No zip is built.** Run `tools/build-zip.py` when you want one.
- Settings do not carry over from the old extension - Chrome storage is per
  extension ID.
- `upsertKeepNodes` is now editable in Settings. It was read by both copy
  workers but was never on the old options page, so it has always been empty.
  New behaviour, not a port.

**The design** these screens were built from:
<https://claude.ai/artifact/RexucH7YaaDp8cd74f74wc>
