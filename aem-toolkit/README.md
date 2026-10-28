# DSY - Digital Samsung Yard

Formerly *AEM Toolkit*. The name and the icon changed in 0.15; nothing else
did. Since 0.18 its colours are the logo's: buttons, links, ticks and focus in
the logo's teal (`#0a716e`, darker `#065e5f` on hover; `#19b29d` on a dark
panel), a strip of the logo's gradient along the top of the panel, and the logo
beside the name on the home screen and the settings page. The folder (`aem-toolkit/`), the release zips (`aem-toolkit-<version>.zip`)
and the names it keeps settings under (`aemt.*`) stay as they were, so stored
author instances and copy deck fields carry over, and the DSY browser still
builds from `../aem-toolkit`.

**0.27.6 - full and relative links are the same link.** A text whose links
went from `/levant_ar/…` to `https://www.samsung.com/levant_ar/…` (or back)
after the export - Relative Link Fixer, Sync page, an author - is no longer
*changed after the export*: the page's links are compared as relative too. Same
words and same destinations import; a link to another page is still a change.

**0.27.5 - after Sync page, any two sites.** The 0.27.4 allowance is no
longer limited to one country's two languages: a sheet exported from any site
(`/uk`, `/levant`, `/de`) imports into the page Sync page copied to any other
(`/fr`, `/levant_ar`, `/at`), and links the translator left on the sheet's site
are re-pointed to the page's. Links to a third site stay as typed and flagged.

**0.27.4 - importing after Sync page.** The usual round trip - sheet exported
from `/levant`, page copied to `levant_ar` with Sync page, translation imported
there - no longer marks every text with a link as *changed after the export*:
Sync re-pointed those links, so the import points them back before comparing.
A real edit on the page is still caught, and a sheet of another country gets no
allowance. Links the translator left on `/levant` are re-pointed whether
relative or written out in full on www.samsung.com / shop.samsung.com.

**0.27.3 - sister-site links on import.** A translation that keeps a link to
the same country in the other language - `/levant/…` imported into a
`levant_ar` page, `/ae/…` into `ae_ar` - now has it re-pointed at this site
even when the page does not link there yet. It is listed under *Links made
this site's*, and a link the page did not have before still shows *Links
differ*, so it can be checked. Another country's links stay as typed.

**0.27.2 - the footer checks the session.** "Connected" now means signed in,
not only allowed. The panel reads the session (one GET, nothing written) when
it opens, when the tab changes, when you come back to it, every minute it is on
screen, and after a run fails. Signed out, the dot turns amber with *Failed to
connect, log in again*; host not answering, *Failed to connect, check the VPN*.

**0.27.1 - clearer "not a Sling response".** When a write comes back as a
page that is not Sling's answer, the panel now says which: *Failed to connect
to AEM: you have been signed out. Log in again in this tab, then try again.*
for a sign-in page (AEM's, or the SSO one), or *...the server sent back an
error page...* with that page's title. "Connected" at the bottom only means
the host is allowed; it does not check the session.

**0.27.0 - team defaults.** `default-settings.json` in the extension folder is
applied once per `version`: on a first install everything in it is taken; on
later versions only settings the person does not have yet are added, and lists
(author instances, copy deck fields) are merged. Their own changes are never
overwritten. Settings > Team defaults saves your current setup as that file and
has a *Reset to team defaults* button (the only thing that overwrites).

A Chrome extension for operations on AEM 6.5 author instances, run from a side
panel next to the page you're working on. The panel opens on the page in the
current tab and offers these features, one card each:

| Tab | Does |
|---|---|
| **Backup** | Copies a page into the backup folder on the same server, creating any missing pages on the way — or updates the backup if it is already there |
| **Sync page** | Copies a page from one locale to another on the same server. If the page already exists there, it is updated to match — including overwriting text already translated there. Links and canonicals are updated, and images copied, to the destination locale. Twitter handles, title endings and language are set to the destination site's, read from its home page |
| **From another server** | Brings a page across between two author instances, re-pointing links, uploading images and setting the destination site's Twitter handles and title endings |
| **Versions** | Lists every saved version of a page, read straight from the repository — and restores one, or creates a new one |
| **Copy deck** | Exports the page's copy as an Excel sheet for translators, each text once, rich text as stored — a product page's from the page as rendered, since its copy comes from PIM. Reads only |
| **Import translation** | Checks a translated copy deck against a page, row by row, shows exactly what would be written — then writes it |
| **Relative Link Fixer** | Finds links in the page content authored as full URLs — `https://www.samsung.com/uk/…` — and makes the ones you tick relative: `/uk/…`. Page properties are not checked |

Nothing is written until you have read what the run intends to do and confirmed
it. The structure is built so more features can be added without touching the
shell.

## Install

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this `aem-toolkit` folder
3. Open your AEM author instance, click the toolbar icon to open the side panel
4. The panel will say the origin isn't enabled — click **Allow this site**

Only a tab that looks like an AEM author instance is offered **Allow this
site**: one on the editor, a console, the login page, CRXDE or the Felix
console, or on a host with `author` in its name. The extension cannot look
inside a site before it is allowed, so the URL is all it goes on. Any other
tab — Jira, mail — is treated as no AEM tab at all. An instance at an address
that does not look like one is added under **Author instances** in settings.

No build step. Load it and it runs.

## How it talks to AEM

The extension injects a content script into the author tab and makes its
requests from there. That means every call is same-origin and carries your
existing author session — exactly the position the devtools console is in.
The extension never sees or stores AEM credentials.

Origins are granted one at a time. Nothing is requested at install.

The one request the panel makes itself is the sign-in check behind the
instance pickers, for an instance with no tab open: a GET to
`/libs/granite/security/currentuser.json`, redirects not followed, nothing
written. Chrome sends that instance's cookie with it because the origin is
granted. An instance with a tab open is asked from inside that tab instead.

## Features

### Page copy — *Backup* in the panel

Copies a page into the backup folder on the same server, creating any missing
pages on the way to it. Child pages are not copied and internal links are not
rewritten. If the backup is already there, it is updated instead.

**The destination is not typed.** It is the source path with the backup folder
(`india/backup` by default, set in settings) inserted directly under the site
root. The form shows it as you type the source, and the worker derives it again
for itself, ignoring whatever the panel sends:

```
/content/samsung/levant/home-appliances/buying-guide/microwaves
/content/samsung/levant/india/backup/home-appliances/buying-guide/microwaves
```

A source that is already inside the backup folder, or is the site root itself,
is refused.

| Path segment | What happens |
|---|---|
| The requested (leaf) page | Full content copy. `shallow=true` — **child pages are not copied** |
| Intermediate already in the destination | Skipped, untouched |
| Intermediate missing, present in the source | Created with the **source page's template and title**. Shell only |
| Intermediate missing, absent from the source | Created with the configured marketing template |
| Destination leaf already exists | **Updated.** Only the differences are written — see below |
| Something other than a page at the destination | **Abort.** Nothing is written |

"Present in the source" is decided by right-aligning the two paths from the leaf
backwards. The matching suffix gives each intermediate its source counterpart;
anything above it was inserted. Each counterpart is then confirmed with a live
read, so the repository decides, not the name match.

```
src  /content/samsung/levant/              home-appliances/buying-guide/microwaves
dst  /content/samsung/levant/india/backup/ home-appliances/buying-guide/microwaves
                            └─ inserted ─┘ └──────────── aligned ────────────────┘
                            marketing tpl        source templates
```

#### Updating an existing backup

When the backup page is already there, the analysis says so and the confirm
button becomes **Update the backup**. The update is the *Page sync* engine
applied to the one page: changed and added properties and components are
written, what the source has dropped is removed (with the live re-check and the
25% mass-removal confirmation), and component order is restored. Source and backup
are on the same site, so nothing is re-pointed.

**Images are not checked** for a backup. The backup uses the same DAM as the
source, so every image is always already there. Skipping the check saves two
requests per image, means an image your account cannot read never blocks the
update, and means a property that points at a missing image is still copied
exactly as the source has it.

**The backup page is not versioned** before an update, whatever the *Page sync*
setting says. The backup is itself the copy.

**A backup that already matches the source** is reported as **Already up to
date**, its node is tagged **UP TO DATE**, and the button reads **Nothing to
update** and cannot be pressed. "Matches" means the same components, in the same
order, with the same property values. Values AEM changes on its own — created
and modified dates, publish information, any other date — and `hreflangGroup`
are not compared. If the source page is at AEM's JSON size limit, the message
says that components removed from the original could not be checked.

The reordering option is the *Page sync* one in settings.

### Page sync

Makes the destination page match the source. If the destination isn't there it
is created; if it is, only the differences are written. Which of those happens
is read from the repository, not asked.

**The destination's backup comes first.** Before anything is written to a
destination page that already exists, its backup — the same path with the
backup folder inserted under the site root, `/content/samsung/levant/india/backup/…`
— is checked, the way the *Backup* tab checks it:

| The backup | The review says | Ticked (the default) |
|---|---|---|
| Not there | *There is no backup at …* | **Take a backup first** — the *Backup* tab's copy, before the sync |
| Not identical to the page | *… is not the same as this page: N properties and N components differ* | **Update the backup first** — the *Backup* tab's update, before the sync |
| Identical | *… matches this page - nothing to do* | — |

Identical means what the *Backup* tab's update means: every property and
component the same, the properties every copy changes (`cq:lastModified`,
`jcr:uuid`, the replication dates, who changed it) left out. Unticked, the
sync goes ahead without one. **A backup that fails stops the run: nothing is
written to the page.** A page the sync is creating has nothing to back up; a
global page, or a page that is itself inside the backup folder, gets none and
the review says why.

Along the way every reference to the source site is re-pointed at the
destination site. The two site tokens are read off the paths you give it —
`uk`→`lb`, `se`→`no`, `ae`→`levant`, either direction, and a different brand
root works the same way. Nothing is hardcoded to a particular locale.

Here is `ae`→`lb`, but substitute any pair:

| Where | Before | After |
|---|---|---|
| Authored link | `/content/samsung/ae/...` | `/content/samsung/lb/...` |
| Canonical / hreflang | `https://www.samsung.com/ae/...` | `.../lb/...` |
| Site-relative, inside rich text | `/ae/offers` | `/lb/offers` |
| Asset reference | `/content/dam/samsung/ae/...` | `/content/dam/samsung/lb/...` |

Referenced DAM assets that aren't at the destination are **uploaded** there,
with their folders — each file read from the source and handed to DAM's own
upload, as a person uploading it would. That way AEM processes every one as a
new asset: renditions, and on a Dynamic Media instance the push to Scene7. A
repository copy would not be — it carries the source's Scene7 details, never
reaches Scene7, and the image shows in edit mode but not on the published page
(or with `wcmmode=disabled`), which shows images from Scene7. The file arrives
unchanged; its metadata (title, description, tags) does not. An upload that
fails stops the run before the page is re-pointed at it; run it again and the
images already uploaded are not uploaded twice. When source and destination are
on the **same** site there is nothing to re-point, and it becomes a pure
structural sync.

**From a shared site** — `/global` by default, set under *Sites whose images
and links can be kept* in settings — the review offers two tick boxes, both
ticked to start with:

| Tick box | Under | Unticked |
|---|---|---|
| *Create new images in /&lt;site&gt; and point these paths at them* | Image paths updated | No image is uploaded and no DAM folder made; every image path — Dynamic Media share images included — keeps pointing at the shared site's images |
| *Update links to point at /&lt;site&gt;* | Links updated | Every link keeps pointing at the shared site |

Changing a box reviews the page again with it, so the plan's counts — images
to upload, properties to write — are what the run will do, and the write plans
once more with the same choice before writing anything. What is kept is not
listed under *Still pointing at /&lt;site&gt;*: it points there on purpose. The
choice is per run: new paths start with both ticked. Offered only when the page
has image paths or links pointing at the shared site; a site not on the list
never gets them, whatever is asked.

**Links to other sites.** A page can link to a third site — a `/global` page
to `https://www.samsung.com/uk/tvs/all-tvs/`, say. Those sites are found on the
page, not listed anywhere: each one it links to gets a table of its own on the
review, *Links to /uk*, with every distinct link and how often it is used, and a
tick box — *Update these links to point at /&lt;destination&gt;* — **ticked** to
start with: those links point at the destination and are listed under *Links
updated*. Untick it and the page is reviewed again with that site's links left
as they are. Only a link written out
in full is found and re-pointed — a URL on a listed host
(`www.samsung.com/uk/…`) or a `/content/samsung/uk/…` path, in any property,
rich text and static HTML included, `/content/samsung/uk.html` and a link
inside another link's query too; a bare `/uk/…` inside text is too easily
something else, and the other site's images are left alone. A token is only
taken for a site once AEM confirms it: `/content/samsung/<token>` must be a
page — which is what keeps `www.samsung.com/semiconductor/…` or `/aemapi/…`
from being re-pointed, with no list of sites anywhere. The source and
destination sites are never "other", nor is part of one (`/in` when the
destination locale is `in/en`), and a site the page does not link to is never
re-pointed, whatever is asked. The count leaves out properties the run never
writes — kept at the destination, or dates.

**Site values.** A few page properties name the site, not the page:
`twitterSite`, `twitterCreator`, the ending of `ogTitle` and `twitterTitle`
("| Samsung Lebanon") and `jcr:language`. None of them follows from the path —
`/levant` is `@SamsungLEVANT`, "Samsung Jordan" and `en-JO` — so they are read
from each site's home page, `/content/samsung/<site>/jcr:content`, and no site
is written down anywhere:

| Property | Becomes |
|---|---|
| `twitterSite`, `twitterCreator` | The destination home page's value |
| `ogTitle`, `twitterTitle` | The source site's ending swapped for the destination's: "Air Conditioners \| Samsung Lebanon" → "Air Conditioners \| Samsung Jordan". A site's ending is its home page's share title minus its own title. A title ending any other way is left as it is |
| `jcr:language` | The destination home page's — only when the source page has one, since it normally lives on the home page alone |

Only properties the source page has are set; none is added, and the
description, keywords and title itself are copy, not site values. The review
shows them in their own table, *Site values*, with a tick box — *Set these page
properties to the /&lt;site&gt; site's values* — ticked to start with. Unticked,
an existing page keeps what it has (the source's values are not written over it
either) and a new page keeps the source's values from the copy; changing the box
reviews the page again. Anything the run could not work out — a home page
missing or unreadable, a home page without a handle, a title with some other
ending — is listed under the table, in the log and on the done screen, to fix by
hand: nothing is guessed. The done screen lists the values that went in. Pages
on the same site, and pages with none of these properties, have no box.

Scope is one page: `<source>/jcr:content` and the nodes under it. Child pages
are `cq:Page` nodes, which never appear in that subtree, so nothing below the
page can be read, copied or removed.

| Difference | What happens |
|---|---|
| Property changed at source | Updated, rewritten |
| Property added at source | Added |
| Property/component **removed** at source | Removed — see below |
| Component added at source | Created, at the source's position in the order |
| Component order differs | Re-ordered to match the source |
| `jcr:primaryType` differs | **Not changed.** Reported for review |
| Property listed in *never overwrite* | Left alone (`hreflangGroup` by default) |
| Site value — Twitter handle, title ending, language | Set to the destination site's, from its home page — see *Site values* above |
| Asset deleted from the source DAM, still on Dynamic Media | Uploaded from the Dynamic Media copy (`images.samsung.com`), full size, to where it belongs |
| Asset missing from the source DAM and from Dynamic Media | The property is still written, pointing where the asset belongs; listed under the plan to add by hand |
| Date-valued property | Skipped, so a Date never becomes a String |

No version is saved before a sync unless **Create a version of an existing
destination page before writing** is ticked in settings. It is off by default,
and settings saved before this change were turned off once.

AEM answers "OK" to a version request whether or not a version was made, so the
answer is not trusted. The page's `jcr:content/jcr:baseVersion` is read before
and after: if it did not move, there is no restore point, and the run stops
before anything is written. The version label is made safe for AEM first — a
label is a JCR name, and the `:` in a timestamp is not allowed in one.

#### Removals

A sync means the destination ends up matching the source, so components and
properties the source no longer has are removed. The tick box on the form turns
that off for a run if you want add-and-update only.

What makes this safe is not hesitancy about the intent but three checks on the
**evidence**, because every dangerous removal comes from a bad read rather than
a bad decision:

- **The source tree must be whole.** AEM caps `.infinity.json` at
  `json.maximumresults` (1000 by default) and a page over that comes back
  truncated. A short tree makes everything missing from it look deleted. A
  parse failure aborts; a tree at the limit turns removals off and says so.
- **Every removal is re-checked live.** Immediately before it goes, the node or
  property is read from the source again. If it's actually there, the removal is
  skipped and reported — the scanned tree was wrong, not the page.
- **A mass removal waits for you.** More than a quarter of the destination's
  components looks like a different page, not drift. The button stays off until
  you tick **These are the right pages — remove … anyway**, and the run checks
  that box again: if the page has changed since and there is more to remove than
  you confirmed, it refuses.

A 403 is never read as "not there". Anything unreadable stops the run, because
guessing either way is how content gets removed or links get left behind.

#### Page properties of a page that is already there

An existing destination page's own properties — titles, descriptions,
keywords, the Twitter and OG fields, the language — are often put right by hand
after an earlier run. So when a run would change any of them, the review names
them beside the button, and **Apply waits** until you tick *I have checked the
N page properties — update them*. Every page property counts, not only the SEO
and social ones; components on the page do not. The run checks the box again:
a page property that would change and was not on the list you confirmed — the
page changed between the review and the click — is refused, before anything,
the version included, is written.

A page being created asks nothing: there is nothing on it yet. Neither does a
run whose page properties all stay as they are, nor the Backup tab, whose
backup is meant to match its source exactly. *From another server* asks the
same, and checks before any version, folder or image is written.

### From another server

Brings a page across between two AEM author instances you're signed into.
A destination page that already exists is backed up first on the destination
instance, as *Page sync* does it (see *The destination's backup comes first*
there): the same tick box on the review, taken before the first write, and a
backup that fails stops the transfer with nothing written.
**Both instances are dropdowns** — source and destination — so the panel works
from any tab, including one that isn't an AEM instance. Each instance needs a
tab open, or one is opened in the background. Created at the destination if it
isn't there yet; updated if it is.

- **The two lists never name the same server.** Picking, in one list, the
  server the other has swaps the two — so a transfer is reversed with one pick.
  **Swap source and destination**, between the two halves of the form, reverses
  the whole run: instances, pages and locale folders.
- **An instance you are not signed in to is listed but greyed out**, marked
  *not signed in*, with a line under the lists saying where to sign in. The
  same goes for one that cannot be reached (*can't reach*) or does not answer
  like AEM. Each instance is checked when the form opens, when you switch tabs
  and when you come back to the panel, so signing in elsewhere and returning
  is enough. Analyze checks again before reading anything, and stops with
  *You are not signed in to …* rather than a login page read as content.
- With only one instance enabled, the form says to add the second. Links, canonicals and DAM
references are re-pointed at this site, and referenced images are uploaded.

No CORS configuration and no cookie changes are needed on either instance,
because **nothing makes a cross-origin request**. The extension runs its own
content script in a tab on each server — each half same-origin with its own
session and its own CSRF token — and carries the page tree and each image
between them:

```
tab on the source          side panel            tab on this server
─────────────────          ──────────            ──────────────────
read jcr:content     ──▶   hold + plan    ──▶    createPage / version
list image refs            pair components       write components
read one image       ──▶   carry bytes    ──▶    upload it
```

**Every image the page references is carried across**, wherever it lives in the
DAM. The other instance is a different repository, so an asset under
`/content/dam/…/global/` is no more likely to be there than one under the
site's own folder.

Where each image lands comes from the same rewrite that moves the reference
pointing at it, which is what stops the two drifting apart:

| Reference | Lands at |
|---|---|
| `/content/dam/samsung/uk/guide/x.png` | `/content/dam/samsung/lb/guide/x.png` — moves with the site token |
| `/content/dam/samsung/global/logo.png` | same path — the reference isn't rewritten either |

Folders are created wherever they're needed, not only under the destination
site's DAM folder. Images already present are skipped.

They go across one at a time, each in pieces of 8MB as base64: a piece is read
on the source and handed over before the next is fetched, and the image is
uploaded once, whole, when its last piece arrives. No message carries more than
a piece, so a 60MB image goes the same way as a 60KB one. The review shows each
image's size, and the total to upload.

The step shows which phase each image is in — *carrying 56 MB of 61 MB*, then
*uploading 61 MB — 40%* — so a slow upload is never mistaken for a stuck one.

**Nothing about one image stops the transfer.** Whatever goes wrong with an
image, it is skipped, the run moves on to the next one, and the page is written
as usual — already pointing at the path the image belongs at. When the run
finishes, the done screen lists every image **to do by hand**, in three groups,
because they are different jobs:

- **Put in place by hand** — the image exists, and was not carried. Each shows
  where it is on the source, where to put it (the page already points there),
  and why it was skipped.
- **Not in the DAM, still on Dynamic Media** — the image was deleted from the
  source DAM and Dynamic Media still serves its copy, but carrying that copy
  failed. Each shows the live (`images.samsung.com`) and staging
  (`stg-images.samsung.com`) URL that still answers. Download the image from a
  link and upload it to the DAM path shown; the page already points there.
- **Image not available** — not in the source DAM and not on either Dynamic
  Media host, so there was nothing to carry. The page still points at the path
  shown, the same as the source does; add the image there, or fix the reference.

**Images deleted from the source DAM.** Dynamic Media keeps its own copy of an
image after the asset is deleted in AEM, so the source page can go on showing
it. When the source page is read, each image missing from its DAM is looked up
on both delivery hosts: `/content/dam/samsung/<path>` →
`https://images.samsung.com/is/image/samsung/assets/<path>` (and the same on
`stg-images`). One that is found is **carried from Dynamic Media**, at full
size, and uploaded to where it belongs like any other image. The Images table
shows it with *Dynamic Media* as its origin. If neither host can be reached, it
is listed as plain "not in the source DAM".

The reference to a missing image is always written, rewritten like any other.
Before 0.23.7 it was left out, so a sync onto an existing page kept the
destination's **old** image next to the new text and links.

**Sync page** does the same from 0.23.8: an asset deleted from the source DAM
is uploaded from Dynamic Media, and the reference to one missing everywhere is
still written. One difference: Sync page stops when an upload fails, so a
Dynamic Media copy that cannot be read stops the run before the page is
re-pointed, with the URL in the message.

**Copy list** copies it as tab-separated rows — to do, source, destination,
live URL, staging URL, why — to paste into Excel or hand on. What puts an image on the list:

| | Known |
|---|---|
| Over 256MB — holding it in two tabs at once is the wrong tool | Before the run: its size is read from the original rendition. Otherwise as soon as reading passes 256MB |
| Unreadable on the source, or cannot be checked here (403) | Before the run. Listed as a 403, never as missing |
| Not in the source DAM, nor on Dynamic Media | Before the run. Its reference is still written, pointing where it belongs |
| From Dynamic Media, but reading it fails | During the run. Listed with its Dynamic Media links |
| Reading it stalls — nothing arrives for 60 seconds | During the run |
| The upload fails (HTTP 413, 500, a dropped connection) | During the run |
| The upload stalls — nothing sent for 60 seconds | During the run |
| Every byte is sent, but the server does not answer within 3 minutes | During the run. The image is looked for first: if it arrived anyway, it counts as uploaded |

Ones known before the run are also on the review screen, below the plan, in the
same groups, and counted in its header.

#### Component pairing

This is the part worth understanding, because it is the difference between a
transfer and a wreck.

A page copied within one server keeps its node names. **A page authored
separately on another server does not.** On a real UK/LB pair: 20 components,
every one with a counterpart, only 6 sharing a node name. And one of those 6
shares a name while being a *different component* — UK's `cm_g_static_content`
is a spacer div, LB's is the page's FAQ schema. Matching those by name doesn't
fail loudly; it replaces live structured data with a spacer.

So components are paired on what is actually reliable — their order and their
`sling:resourceType` — using longest-common-subsequence, the same algorithm a
text diff uses. On that real pair it recovers all 20 pairs and correctly
identifies the 5 components UK has that LB lacks. It inherits the property that
matters: it reports **no** pair rather than inventing a wrong one.

The proposal is shown before anything is written, with the inferred rows
highlighted. A component being added whose name is already taken here by a
*different* component is given a free name rather than landing on top of it.

**The limitation, stated plainly.** Pairing uses order and type. If the
destination page has been **re-ordered** relative to the source, it will match
in sequence — correct by its own rules, wrong by any other measure. It cannot
tell. What it can do is say which rows the question applies to, so rows whose
component type appears **more than once on the page** are marked `‼`: for those,
order is the only thing separating the candidates. Types that appear once are
never marked, so the flag stays worth reading.

On your UK/LB pair that covers the eight `pd-g-feature-benefit` components and
the `cm-g-text-block`s — the alignment gets them all right because the two pages
are in the same order, but the marker is the signal to actually read the table
before confirming.

#### Page metadata

`ogTitle`, `twitterSite`, the page description and the rest of the social and
SEO block are **never overwritten where this page already has them** — "|
Samsung UK" has no mechanical translation into its Lebanese equivalent. A page
being *created* has nothing to keep, so it gets the source values as a starting
point to edit. Add anything else this locale owns in settings.

This applies to the **page's own properties only**. The list contains names like
`description`, `jcr:title` and `keywords`, which are also perfectly ordinary
component property names — applied everywhere, "preserve the page description"
would quietly freeze the body copy of every text component on the page.

Paths and URLs are a different matter and *are* synced, because they can be
derived: a canonical of `…/uk/…` becomes `…/lb/…` correctly.

The site values — Twitter handles, title endings, language — are worked out as
on Sync page (see *Site values* there), with the source's home page read on the
source instance and this site's on this one. Two differences follow from the
list above. `ogTitle` and `twitterTitle` stay on it, so a title this page
already has is never replaced; a page being created, or one without that title,
gets the swapped ending. `twitterSite` and `twitterCreator` are kept only while
this site's home page does not name its own: once it does, an old handle left by
an earlier transfer is put right. A handle listed under preserve in settings is
kept regardless.

#### What stops a bad run

| | |
|---|---|
| Template or component not deployed here | **Blocks.** The page would be created and render empty |
| An image unreadable on either side (403) | **Does not block.** Skipped and listed to do by hand — as a 403, not as missing |
| Source page over AEM's JSON limit | **Aborts.** Never plan against a partial tree |
| Removing over 25% of this page's components | **Waits for you.** Check the pairing, then tick **These are the right pages — remove … anyway**. Checked again before any folder, image or page is written |
| Changing page properties of a page already here | **Waits for you.** Tick **I have checked the N page properties — update them**; the run refuses any it would change that were not on that list. A page the transfer creates asks nothing |
| Source page missing, or destination parent missing | **Aborts** before this instance is touched |

An existing destination page is versioned before anything is written.

**If a run stops part-way**, the step it stopped on is marked ✗ and the button
becomes **Analyze again** rather than the run itself. Part of it may already be
written — the page created, some images uploaded — so the plan on screen is out
of date. A fresh analysis shows where things stand: the page as *already here*,
the uploaded images as *already here*, and only what is left to do.

### Versions

Restore and Create run only on a **backup page** - one under the backup folder (`/india/backup/` by default, from settings). Any page can be listed. A restore saves no new version first unless **When restoring, save the current content as a version first** is ticked in settings (off by default).

**Hidden until you turn it on:** tick **Show the Versions feature** under
*Features* in settings, and its card appears on the home screen straight away.

A feature of its own — nothing in it is part of a backup or a sync. It lists a
page's versions, and above the list you choose what to do: **Restore** or
**Create**. The button always names exactly what it will do.

**Where the list comes from.** Not the Timeline or any other UI, which a
customised author instance can stop showing versions in. The versions are read
from the repository: a page's versions belong to its `jcr:content`, whose
`jcr:uuid` names its version history. Oak files that history at

```
/jcr:system/jcr:versionStorage/<uuid 1-2>/<uuid 3-4>/<uuid 5-6>/<uuid>
```

If it isn't there, QueryBuilder is asked for the `nt:versionHistory` whose
`jcr:versionableUuid` is that uuid, so a history filed elsewhere is still
found. A version store your account cannot read is reported as a 403, never as
"no versions".

Each version shows when it was saved, which one is **current**, its labels,
its title and comment, and who last edited the content in it. Newest first.

**Version numbers.** The repository names versions itself and cannot rename
them, and after a restore its names branch: `1.0.1.0`, `1.0.0.0.0`. So each
version is shown with a plain number by age — **Version 1** is the oldest, the
highest is the newest — and buttons and messages use it. The real name is shown
small underneath (*AEM version 1.0.1.1*) to match against CRXDE, and it is what
every request uses. Because the plain numbers are counted from the list, they
shift if an old version is purged; a comment the extension saves names the AEM
version, which never shifts.

**Restoring.** Pick a version and the button names it — *Restore version 1.1*.
The run:

1. looks the version up again, so it must still belong to this page;
2. saves the current content as a new version (the tick box, on by default),
   so the restore itself can be undone — checked the same way as every version
   the extension makes;
3. restores the version with `/bin/wcmcommand` `cmd=restoreVersion`;
4. reads the page back and compares its whole `jcr:content` with the version's
   frozen copy, component by component and property by property. Properties
   AEM and the repository keep up on their own are left out — above all
   `cq:lastModified`, which a restore moves to "now" because a restore is an
   edit. Any real difference fails the run, names the first one, and lists
   every one under **Activity**.

The comparison leaves out AEM's own bookkeeping: every `jcr:` property except
`jcr:title` and `jcr:description`, the `cq:version…` and `cq:last…` records,
and the fields AEM writes into a version only, so a deleted page can go back in
its place (`cq:siblingOrder`, `cq:parentPath`, `cq:name`, `cq:childrenOrder`).

Only **content** can fail the check: any component, and the page's title and
description. Any other property on the page itself is where AEM and
customisations keep their own records, so a difference there is listed under
**Activity** as a note, never a failure. Every difference is shown with both
values, so it can be judged.

**Deleting a single version is not offered.** AEM 6.5 has no request for it:
the WCM commands cannot, a Sling POST cannot remove a version, and the JCR
remoting servlet answers 501.

**Creating.** Write a message and press **Create version**. The page's current
content is saved as a new version with the message as its comment, checked the
same way as every version the extension makes, then found in the history.

Only the page's own content changes — child pages are never touched.
**Show versions again** reloads the list for the same page.

### Copy deck

Exports the copy on a page as a sheet for translators. **Reads only.**

The rows come from the page's authored content — `<page>/jcr:content.infinity.json`
— not from the rendered page. That is what makes the sheet usable in both
directions: every row names the node and property its text came from, so a
translation can later be put back in exactly that place, and nothing a template
or script renders around the content (the location popup, carousel buttons,
stock-alert dialogs, global banners) ever reaches a translator.

| Column | Holds |
|---|---|
| A · Section | The component, numbered in page order, with its headline: `08 · Feature Benefit Full Bleed · Micro RGB`. A Static Content block goes by its own number among the page's blocks and its first heading: `Static content 5 of 8 · Made to support your everyday wellness` — it takes none of the components' numbers, so they run on without a gap |
| B · Field | Where in the component: `Item 2 › Button text`, `Image alt (mobile)` — one line per place for a text used in several |
| C · Notes | Places, line breaks, HTML to keep complete, the length the page is made for, text not shown on the page |
| D · Key | `root/responsivegrid/pd_g_feature_benefit_1828229403/list/item1@text` — the node, relative to `jcr:content`, and the property. `.@ogTitle` is the page's own. A text of static HTML adds its shape: `…/cm_g_static_content__1495926445@bodyHtml#hb11688fa`. One line per place |
| E · Check | A fingerprint of the stored value, so an import can tell whether the page changed since the export — for static HTML, of the text and how many places it is in: `h32bdf8c6/2`. One line per place, in the Key's order |
| F · Source text | The text as the translator should read it — see below |
| G · Translation | Empty. The translator fills it in |

Context comes first and the text last, so the source and its translation sit
side by side at the end. An import finds columns by their header, not their
position.

The last row is `#END`/`#meta`: the page path, the row count and a checksum of
the keys, so a sheet that comes back short — a filter left on, a paste that
stopped at a blank row — can be noticed.

**What becomes a row** is a list of property names, not a guess: headlines,
sub-headlines, descriptions, button and link text, link titles, image alt
text, disclaimers, and on the page itself the title and the SEO and social
fields — plus any field added from the list below. Never exported: system
properties, paths, settings, the English-only values analytics reads
(`engText`, `headlineEngText`, `linkEng`, `headlineTextEng`, `*Analytics`,
`textForAnalytics2`) — translating those would quietly break reporting in every
locale — and the page's social settings that look like words (`twitterCard`
holds *Summary*, `ogType` *website*).

**The components' dialogs.** Each export also reads the dialog of every
component on the page from `/apps` — merged with what it inherits, as the
editor opens it (`/mnt/override/apps/<type>/cq:dialog`), falling back to
`/apps` and `/libs` — and follows its includes, however deep: the Showcase
Card's fields are four includes down, under `datasources/dialog-items`. The
dialog says what each field is, so it is not guessed from the value:

| The dialog's input | What the copy deck makes of it |
|---|---|
| Select, switch, checkbox, radio, button group, path picker, image, date, number, colour, hidden — or a disabled text field | A setting: never offered, whatever it holds (`textAlign` *Center*, an image's file name) |
| A text field labelled *(English)* or *Analytics*, or with a pattern that lets only English through | English for analytics: never on the sheet, even if added (`textForAnalytics2`, `linkEng`) |
| A text area labelled *(CSS)* or *(JavaScript)* | Code: never offered, never on the sheet, even if added (a Static Content block's *Header (CSS)* and *Footer (JavaScript)*) |
| Text field, text area, rich text | Text: offered with the **label** the author sees (*Desktop Text*) and the **length** the page is made for (*Recommend to enter up to 30 characters and 2 lines*, a `maxlength`) — which goes in the sheet's Notes as *Length: …* |
| No dialog, or a field it does not have | Judged by its value, as below |

Names map to the stored nodes: a named container (`./column`, then `item1`)
puts its fields under that path; a composite multifield (`./list`) under each of
its items (`list/item0`, `list/item1`…). Each node is read once per export, a
component's fields are remembered in the tab for half an hour, and a dialog
that cannot be read — missing, not allowed, too big, a loop of includes — is
simply not known. A dialog never takes a row off the sheet that the rules put
there; it decides what is offered and how it is labelled. The import does not
read dialogs: the sheet's Keys say where each translation goes.

**Fields not on the sheet — add or ignore.** The rules go by property name,
so a new component, or a new field on an old one, would lose its text from the
sheet without anyone noticing. Instead, every field that reads like words but
is not on the sheet is listed at the top of the review screen: the component,
the property, where it was first seen (`list/item0`), how many places, and
what it says — one entry per component and property, however often it occurs —
and, when the component's dialog has the field as a text field, its label there
(*“Desktop Text” in the dialog*) and its length. A field the dialog has as a
setting, as English for analytics or as code is not listed at all. Nor is a
Static Content block's `headerInclude` or `footerInclude`, whatever its dialog
says: they read like words, but they are code (see *Static Content blocks*
below) — nor a `bodyHtml`, read as static HTML wherever it is. Beside each, a
group (a guess to start from: *Buttons & link text* for `ctaLabel`, *Page title &
SEO* for a page property) and two answers:

| | |
|---|---|
| **Add** | The field goes on the sheet at once — for that component, on every page, from now on — in the group chosen. Its rows are marked *added* in the preview |
| **Ignore** | It is not shown again. Nothing goes on the sheet |

A field is a component **and** a property (`cm-g-promo-banner` · `cardTitle`),
because the same name can be copy in one component and a setting in another.
For the page's own properties the component is the page's (`page-pcd`,
`page-standard-pd`), so a PD page's `marketingName` is decided once for every
PD page. The page is not read again: the worker hands the panel the tree it
read, and the sheet is rebuilt from it.

Both answers are kept in **Settings → Copy deck fields**, which lists what was
added (with its group, to change) and what was ignored, each with *Remove* —
removing one puts the field back on the list. A field can be added or ignored
there by hand too, and `*` as the component means every component. The lists
are saved in Chrome's sync storage, each under a key of its own (sync storage
allows 8 KB an item); a full list says so and asks for entries to be removed.
Where a rule already knows a property, the rule still decides; an added field
never reaches the layout containers between components; a value of an added
field that is a path or a link (`www.samsung.com/za`, `#specs`) never goes on
the sheet; and a system property or an analytics value can never be added —
the import would write it. A full resource type pasted as the component is
taken as its last part. For one component, its own choice beats one made for
`*`: ignore `cm-g-badge` · `title` and an Add of `*` · `title` leaves it out.
Ignore hides a field from the list; a field the built-in rules put on the sheet
stays there — leave its group out with the tick boxes instead.

"Reads like words" is deliberately wider than the rules, because a text left
off costs more than a setting shown once and ignored. A single word counts
when it reads as one (`Buy`, `OLED`, `Wi-Fi`, `Free*`, `QLED®`, `(New)`, any
word in another script), so
do `jcr:title`, `jcr:description` and `cq:panelTitle` (AEM's own Title, Teaser
and Tabs keep their words there), names that sound like settings
(`sectionHeading`), text in brackets (`[Exclusive] Save R2 000`), `Tel: 0860 …`,
and markup whose only words are an image's `alt`. Not counted: settings'
values (`large`, `headlineOnly`, `h2`, `bg-white`, `_self`), class lists,
repository paths (spaces and all), links, flags (`true`, `TRUE`, `Yes`, `Y`),
locales (`en-ZA`), JSON, dates, colours, and short codes, prices and sizes on
their own (`QN90F`, `R999`, `55"`) — those are the known gaps.

**How text is shown: as it is stored.** Rich text keeps every tag, written
out in full — `<u><a href="https://www.samsung.com/levant/tablets/all-tablets/">Samsung tablets</a></u> offer…`
— and the translation team translates the words in place, including those in
a link's `title` or an image's `alt`, and looks after the HTML. Its Notes say
*HTML - translate the words, and any title or alt text; keep every tag
complete*. A value whose only words are in its tags — an image and its alt —
is a row like any other. A stored line break becomes a line break inside the
cell; surrounding spaces are trimmed and the stored value is kept exactly. A
field with no words in it — an empty rich-text field is stored as
`<p>&nbsp;</p>` — is not a row.

Sheets made before v3 showed rich text differently, and still import: a tag
with attributes was a numbered placeholder — `<a href="…">here</a>` was
`<a1>here</a1>` — rebuilt from AEM on import, and the words inside it (a
`title`, an `alt`) had rows of their own (`…@description~a1.title`). The import
knows which kind of sheet it has from its `#END` row (*copy deck v3*), or, if
that row is gone, from each row's Source cell.

**Each text once.** The same words in several places — the page title, the
banner headline and both its image alts; a meta, Open Graph and Twitter
description; *Learn more* on six buttons — are **one row**, where the text is
first seen. Its Field cell lists every place, one per line (with the section,
when the places are in more than one); its Key and Check cells hold one line
per place, in the same order; its Notes say *Used in 4 places - one translation
for all of them*. On import the one translation goes to every place. A place
that needs other words is changed in AEM afterwards. Static content merges the
same way — across blocks, and with the page's other rows: *Learn more* in a
showcase script and twice in a tabbed block is one row, put in by hand where
it is static. A row takes at most 100 places, so a Key cell stays far inside
Excel's limit. A sheet exported before
(copy deck v1: one row per place, repeats marked *Same as row N*) still imports.

The review screen shows the page as it is, not the sheet: every place under
its own section, in page order, so a banner headline the same as the page title
still shows in its component. The number beside each is the Excel row it lands
on — places that share a row share a number. The first place of a repeated
text says *also in 3 more places*; each of the others, *same Excel row as Page
title*. The counts above it, and the download button, count the sheet's rows;
the repeats and the static content applied by hand count places — a row of
static content can be several places of its block, and each counts, in a
section's count and in **Activity** too.
Each section folds like an accordion — its title, and how many places it has —
and all start closed, so a long page reads as a list of its sections; *Expand
all* / *Collapse all* sits above them. A section you open stays open while you
tick groups or add and ignore fields, and every section starts closed again
when the page is read again.

**Search** — the box beside *Expand all* — is for checking, before the sheet
goes out, that a text on the page is on it. Typing keeps only the places that
have the text: their sections open, the others hide, each section says *3 of
138*, and the words found are marked. A search reads text as a visitor does —
tags left out, so `Galaxy <sup>1</sup>` is found as *Galaxy 1*, codes like
`&nbsp;` read — and ignores case, the kind of quote (*We’ve* finds *We've*)
and line breaks; a link's address is found too. Above the sections it says how
many places have the text and, when that is not every place the page has it,
where the rest are: *left off the sheet* in a group not ticked or as text not
shown on the page, or *in “Fields not on the sheet”* — add it there. Found
nowhere, it says the text must come from somewhere this sheet does not cover:
a content or experience fragment, the header and footer, PIM, a script.
Clearing the box brings back every place, and the sections as they were; the
search stays while groups are ticked, and is cleared when the page is read
again.

**Groups.** The review screen has a tick box per group — page title & SEO,
headlines & body copy, buttons & link text, image alt text, link titles,
disclaimers, breadcrumb, static HTML — with counts. Ticking one changes the
sheet at once, without reading the page again, and the choice is remembered.

**Not shown on the page** — video captions on a block that shows an image,
switched-off items, a common disclaimer no component uses — is left off unless
you tick *Also include text not shown on the page*.

**Static Content blocks** hold raw HTML, put on the page as it stands, so
their text is put in by hand: by the web team, never by the import. Their
*Body (HTML)* is read the way a translator needs it — **whole sentences**, one
row per text, never cut: the words of a `p`, a heading, a `li`, a button, a
`dt` or `dd`, or loose text, with their inline tags (`a`, `span`, `br`,
`strong`, `sup`…) kept in the cell, each shown with its `href` and `class`
only — `Made to support your<br><span class="header-highlight">everyday wellness</span>`.
Line breaks and indentation read as one space; a no-break space shows as
`&nbsp;`; an icon `<img>` between words stays in the sentence as `<img>`.
Two links side by side with nothing but space between them are two buttons,
a text each (*View all 75'' TVs*, *Learn more*); so are the parts of a run
that is no words as a whole but whose parts each read as words — the two ends
of a scale, *1.1m* and *2.5m*.
The words of an attribute a visitor reads or hears are rows of their own —
`alt`, `title`, `aria-label`, `aria-description`, `placeholder`, a
button's `value`, and of `data-*` only `data-tooltip`, `data-title`,
`data-label`, `data-caption` and `data-text` (a script may match on any
other) — a link's `title` inside a sentence too. Never a row: `<style>`, a
`<script>` in the Body, SVG, templates, ids, classes, links, images — with one
exception, structured data.

**Structured data (JSON-LD).** A `<script type="application/ld+json">` in the
Body is read as JSON, and the values search engines show are rows of their
own, in the same group: a video's `name` and `description`, an article's
`headline`, a question's and an answer's `text` — the keys `name`,
`description`, `headline`, `alternativeHeadline`, `caption`, `text`,
`abstract`, `articleBody`, `reviewBody`, `disambiguatingDescription`,
`slogan`, `award`. The keys themselves, `@context`, `@type`, URLs, dates,
durations and counts are never rows. The Field says *Search engine data
(VideoObject name)* and the Notes that it is not shown on the page. On import
each translation goes back into its own value, written as JSON — quotes,
backslashes and line breaks escaped, every `<` as `\u003c` so nothing can close
the script — and the prepared Body is checked to still read as JSON, with the
same keys in the same shape and only the planned values changed. A translation
with markup in it is sent back, as for any static text. A script that is not
valid JSON gives no rows: it is code, and stays a developer's.

The words
a script or a style of the Body shows a visitor — a slider's *View all 98''
TVs or larger*, a style's `content: "or more"` — stay as they are, and
**Activity** names them for a developer: *Left in English in Static content 1
of 1 · …: "98" TVs or larger", "or more" - a script or a style in the block
shows them, and they are not on the sheet. A developer changes them.* Empty
slots, links, images and a left-or-right layout are collected, and the
import's cards show them (see *The hand-offs* under *Import translation*).

The Field says where a visitor sees the text — `Tab "Active" › Card "Galaxy
Fit3" › Details overlay › Spec label` — and the Notes what to know: the tag
rule (*Keep every tag. You may move a tag to suit your word order, but not into
or out of another tag. A <br> may move or go, never be added. Do not change
link addresses*), *Words only - no markup*, *Hidden until the visitor clicks
the "Active" tab*, a short label's length, numbers and units, colour names (a
tooltip only on a colour dot: *Shown when the visitor points at a colour dot*;
any other is *Shown when the visitor points at it*), a handle to keep. A note
about only some of a row's places says how many: *Hidden until the visitor
clicks the "Active" tab (2 of the 3 places)*. The Key is the text's
**shape** — its words and its tags' names: one Key covers every place of the
text in its block ("Grey", a colour's name
and its tooltip), and it outlives a link pointed elsewhere, a re-indent or a
change to the block's CSS. The same words twice in a block with another link
or class would need one Key for two texts: neither goes on the sheet, and
**Activity** names them — *Not on this sheet: … the same words with a
different link or style, which the sheet cannot tell apart. Translate them by
hand in the block.* So is a text longer than an Excel cell holds (32,767
characters — a terms block of sentences joined by `<br>`, say), rather than
the whole sheet refused for it: *Not on this sheet: a text of 42,487
characters in … - too long for one Excel cell. Translate it by hand in the
block.* The import lists both under *On the page, but not in the sheet*. A
`bodyHtml` on the page's own `jcr:content` is read the same way: never offered
as a field to add, never ordinary copy.

A block's other two fields, *Header (CSS)* (`headerInclude`) and *Footer
(JavaScript)* (`footerInclude`), are its style sheet and its script. They are
never offered, never on the sheet as a whole — not even where they were added
before — and never written by the import: one wrong quote in a script blanks
the block. Changing them is a developer's job. Settings refuses to add them,
and drops one added before. What a visitor reads in the script is on the
sheet, though, for the developer to put in: a string at a spot that shows it —
a tile's `title`, `text` or `bgAlt`, a text node, an `aria-label` the
script sets — keyed `…@footerInclude#h…`, its Field the line (*Footer script,
line 75 › Tile "Energy Score" › Title* — the name in the code added where it
says more: *Image alt text (bgAlt)*); a sentence the script builds
from a choice, `${open ? "Close" : "Open"} showcase container`, as the two
whole sentences it makes. A block with no text in its Body is named after its
script: *Static content 3 of 8 · Showcase (script) · Energy Score*. The import
reads no dialogs, so it knows these two fields by name: a text area of another
component labelled *(CSS)* or *(JavaScript)* is kept off the sheet by its
label, but a sheet made by hand could still name it.

**Fix before translating.** A script's data is often copied from another page
and never changed. The export looks for that in the Footer's tiles (data
objects with a title each, at least three, no two titled alike) and says it
in **Activity** and as a note on the rows it is about: a long text, or list of
texts, the same on every tile (*All 6 tiles have the same bentoAlt: "Circle to
Search with Google", "Battery 4400 milliamp-hours", … - each tile should have
its own.*); an id the same on every tile (*All 6 tiles have the same popupId,
"learn-fold6" - each tile should open its own.*); a link empty on one tile
while the others have one (*Tile "Mindfulness" has an empty cta - the other
tiles have a link.*). It stays quiet unless it is sure: tiles that differ, or
fewer than three, say nothing.

**The file for translators is an Excel workbook.** *Download Excel* writes an
`.xlsx` built in `xlsx.js` - no library, a stored zip of a few XML parts:

| | |
|---|---|
| Columns | Sized for what they hold, text wrapped; Excel fits each row's height to it |
| Header | Bold on blue, frozen, with filters. The cursor opens in the first Translation cell |
| Translation | Tinted yellow - the one column to fill in |
| Section, Field, Notes, Key, Check | **Hidden**, not removed - the import needs them and nobody edits what they cannot see. Unhide them in Excel to read the Field or Notes. Key and Check are grey |
| Every cell | Text-formatted, including the empty ones translators type into, so `1/2` never becomes a date and `0800` keeps its zero |
| Second tab | *How to translate*: what to fill in, what to keep, what not to touch |

A CSV cannot carry any of that, and it opens in a single column wherever
Windows lists with `;` - most of Europe - which is why it is not the default.
*Download CSV* is still there for tools that want one: UTF-8 with a BOM, every
cell quoted, CRLF between records, a leading `= + - @` defused with an
apostrophe. *Copy for Excel* puts the sheet on the clipboard as an HTML table
marked text-only, so pasting it into an empty sheet changes nothing. A cell
longer than Excel holds (32,767 characters, counting the apostrophe that
defuses a leading `=`) is refused by all three — the workbook, the CSV and the
clipboard — with the same message under **Activity** (*Cell F12 is longer than
Excel allows (40039 characters).*), and nothing is saved or copied: Excel
would cut it short, or call the file damaged. The CSV and copy buttons say it
too, the reason on hover; clicking again does not add a second alert.

**A page too large** for one `.infinity.json` — AEM answers 300, or cuts the
output off at `json.maximumresults` — is read a level at a time instead, so it
arrives whole rather than short. A child that cannot be read stops the run.

#### Product pages (PD)

A page made from the `page-standard-pd` template holds almost nothing in AEM.
Its `jcr:content` is a handful of page properties and an empty layout; the
product name, gallery, highlights, features and specs come from PIM when the
page is served — and are translated in PIM, not in AEM. Read from
`jcr:content`, such a page gives a sheet of three rows.

So a product page is read **as rendered** instead: `<page>.html?wcmmode=disabled`,
the page as a visitor gets it, fetched from the author tab like every other
read. It is recognised by its template (`…/templates/page-standard-pd`, under
any `/conf`) or its resource type, and nothing about it is asked.

| On the sheet | From |
|---|---|
| Page title & SEO | `<title>`, the meta description, Open Graph and Twitter titles and descriptions |
| Product name | The page's headline |
| Gallery image titles | Each gallery image's title (`data-type-headline`), and its alt text where that differs |
| Highlights | The highlights at the top of the features |
| Features | Each feature block, as a section named after its headline: headline, sub-headline, description, buttons |
| Feature image alt text | Every image in the highlights and features — once, however many times it is rendered (desktop, mobile, preview) |
| Feature video descriptions | Each video's description (the `title` in its `data-video-data`), which screen readers announce — a row even when the video's poster alt is a placeholder like "alt text"; one row with a poster alt in the same words |
| Footnotes & disclaimers | The numbered footnotes under the features, and the disclaimers with them |
| Specs | Each spec **value**, named by its group and spec — `Video › Viewing Angle`. The spec names are PIM's own attribute labels and are not rows |
| Other text on the page | A part of the page this does not know — so a new component's text is never lost without a word |

**Left off**, and listed on the review screen as left off, with why: the
buying tool (prices, sizes, offers, services — the shop's, not PIM's), the page
navigation, reviews, support and downloads, the *Buy direct* benefits, the
breadcrumb, popups. So is text a visitor never reads: screen-reader text,
carousel controls (*Previous*, *Indicator 3*), and template placeholders
(`{{price.text}}`). A text with no letters in it (`75"`), or a code on its own
(`QN75QN80HAFXZC`, `TM2280A`, `30W`), is not a row either: it is the same in
every language.

**Each text once.** The same words are rendered in many places — an alt for
desktop and for mobile, the product name four times, `Yes` for forty specs. The
sheet has each text once, where it is first seen in the groups ticked; its
notes name the other places — *Also used as: Open Graph description*, *Also
in section 10, 41*. One translation covers every place. The review screen still
shows every place under its own section — a highlight that is also a feature's
headline is in both — with the Excel row it is on: *also in N more places* on
the first, *same Excel row as …* on the others.

**Notes for whoever enters the translations in PIM:** each row of a feature
says which **PIM feature** it belongs to (*PIM feature 167448823*), read from
the feature's own images; a sentence that carries a footnote says so (*Has
footnote 3*) — the marker itself is taken out of the sentence; a `{size}` in a
title is to keep as written. A `<br>` stays a line break inside the cell.

**Representative or sibling SKU.** A switch above the groups: a
**representative SKU** sheet has every group; a **sibling SKU** — the same
model in another size or colour — shares its features with the representative
one, so its sheet has only its **gallery and specs**. The switch only ticks
groups; they can still be ticked by hand. Every product page read starts as a
representative SKU, so a sibling's choice never carries over to the next page
and leaves its features off without a word.

The workbook is the same, with a *How to translate* tab of its own (each text
once, keep `{size}`, the translations go into PIM), and its `#END` row says the
sheet is a product page's. Keys read `pd:07.3` — section 7, its third row — and
the import refuses them: see below. There are no fields to add on a product
page; the list is for authored components.

The SPUB Swiss Army Knife popup has a copy deck of its own, read from the open
page in the browser, with the same PD / representative / sibling split; the PD
sheet here covers the same copy (checked on a real page: everything it lists
but carousel buttons and a stray popup), names where each text is, and leaves
the shop, the reviews and the controls out. An earlier SPUB build carried a copy
of `core.js` and `xlsx.js` from here; adding fields, product pages and writing
translations back are built here only.

### Import translation

The translated copy deck comes back and is checked against a page — usually
the copy of the page on the target site. **Checking reads only**: it works out
what a write would do, property by property. Writing happens only once you have
read that and confirmed — see *Writing* below.

**Getting the sheet in.** In Excel, Ctrl+A then Ctrl+C on the translated sheet,
then Ctrl+V into the paste box. Pasting is the way in on machines where the
company DRM encrypts saved files — it encrypts what Excel saves too, so such a
file's bytes are not the sheet. *Choose a file instead* reads an `.xlsx` or a
CSV where that is not the case, and says plainly when a file is DRM-encrypted.
Once a sheet is in, the same box says so — a tick, *Sheet pasted* (or the
file's name), the row counts and the page it was exported from, with *Choose
another file* and *Clear* inside it; a sheet it cannot use shows a warning
there instead. Under the box, a **Source and translation** fold lists every
row as read — its Excel row, section, source text
and translation, *Not translated* where the Translation cell is empty — to read
through before anything is checked against the page.

The sheet is read **by its headers**, not by position, so a column the
translator moved or added changes nothing. The exported header wins; an added
"Translation notes" or "Translation status" column is never read as the
translation, and two columns that could both be *Translation*, *Key* or *Check*
are refused rather than guessed between. Excel's clipboard quotes a cell only
when it holds a line break or a tab, so a translation that merely starts with a
quote keeps it.

**Each row, against the page as it is now:**

| Outcome | When |
|---|---|
| Ready to write | The text on the page is still what was exported (the Check column) and the translation is safe to store. A row of a text used in several places is checked place by place: one place changed on the page blocks that place only |
| Uses a repeat's translation | A v1 sheet's row left blank as *Same as row N*: takes that row's translation — only from a row whose text is unchanged |
| Apply by hand | Static HTML, a whole sentence per row, and a Static Content block's script strings (for a developer). Checked first for what no translation may hold — one the same as the source is *Same as the source*; an Excel error, garbled characters, a script or code that runs on a click, markup where the English has none is *Needs fixing* — then listed with its translation and its block, never written as a row (a Static Content block's whole Body (HTML) and Footer (JavaScript) are, only when the block's section is ticked — see *Ticking a Static Content block*). Listed with a *Check* line when the text is in fewer or more places than at the export (*"Buy now": 2 places at export, 1 now - look at the block.*), when a link or class in it changed on the page, or when a script's string holds its own quote or a backslash (*Has " in it: in the script it is written \" instead, or the script stops working. DSY does this when it writes the Footer.*) |
| Already translated / Same as the source | Nothing to change. For static HTML: the block has the translation already — pasted, so its English is gone. Looked for in every text of the block, the words of an attribute too, with the direction marks and curly quotes an Arabic cell puts inside a tag taken out first; in a script, in every string wherever it sits, so a built sentence a developer put in as two plain strings is found |
| Not translated | Blank — stays as it is. A changed Source cell with a blank Translation is pointed out: typed into the wrong column? |
| Page changed since export | The Check value no longer matches. Blocked: the translation may not fit any more. For static HTML: the block has the row's words more than once now, each with another link or style - or as a text too long for a cell - to translate by hand |
| Not on this page | The key is not on this page — removed, renamed, or the sheet is for another page |
| Not found in the block | Static HTML whose block holds neither the English nor the translation — the English was changed after the export, or an earlier sheet was pasted. To correct a pasted block: export the **translated** page again, correct that sheet, and import it |
| Needs fixing | A `<script>`, `<iframe>` or other embedded code the source does not have, code that runs on a click or a hover (`onclick=`, `onmouseover=`) or a `javascript:` link — however it is written: `<svg/onload=…>`, `&#106;avascript:`, a tab inside, behind a comment, or anywhere after a quote that may close the attribute it goes into (`aan" x=1 onmouseover=…`) — and into an attribute stored without quotes, anywhere at all (words that only look like it in plain text with no quote before them, *bestel online = 10% korting* or *= JavaScript:*, are fine — after an apostrophe in a word too, *l'offre online = …*, as an apostrophe closes no attribute in double quotes; but not where the text may go into one in single quotes: a piece of a sheet made before v4, or a static text in an attribute the page stores in single quotes); a tag hidden behind a direction mark (`<‏img onerror=…>`), read as the tag it becomes; markup in a plain field, or in a static row whose English has none — written as codes too (`&lt;img …&gt;`), which a script that puts a tooltip on the page reads as a tag; characters garbled by a wrong encoding; an Excel error value; Key and Check cells that no longer have one line per place; a row for a Static Content block's script or style sheet (`footerInclude`, `headerInclude`), in any form its Key takes but a string of the script's own (`…@footerInclude#h…`) — *A Static Content block’s Header (CSS) and Footer (JavaScript) are code: the import never writes them - a developer changes them by hand.* On a v4 sheet, a static text its block cannot take as translated: a tag added, left out or left open, moved into or out of another tag, two changed links that cannot be told apart, or a text whose own code DSY cannot read safely (a tag with a quote left open) (see *Each Static Content block, prepared to paste*). On a sheet made before v3: a placeholder lost, doubled, invented, or given attributes (`<a1 title=…>`), or new markup with attributes |
| Row repeated | The same key twice — only the first counts |

**The value that would be written** is the translation as the translation
team returned it, tags and links included, with the source's surrounding
spaces restored, every line break as CRLF — which is how the write stores it —
and, for a multi-value property, only the translated values replaced. The HTML
is theirs; what differs from the source is shown on the review screen as a
warning, never a block: *Links differ from the source* (another URL, or a link
left out), *Tags differ from the source*, *Not closed as often as opened:
`<a>`*. Read those before writing.

Two things are tidied before the checks, and each is said on its row:

- **Another site's links.** A link that is one of the page's own with another
  site's first folder — `/levant/…` in a translation for a page that links
  `/levant_ar/…`, as happens when the source text sent out came from the
  English page — is written as the page's own: *Links made this site's:
  /levant/… → /levant_ar/…*. Only a link the page already has is swapped; any
  other stays as typed, with *Links differ from the source*.
- **Spaces at the start of lines.** A line break typed in Excel as "line break,
  space" leaves the next line indented. Each line takes the source's own
  indent, line for line; a line left blank is emptied.

**A country other than the site's** is warned about, never changed. The site's
title ending is read from its home page (`/content/samsung/levant_ar`), as the
site values are. Where a translated Open Graph or Twitter title ends with other
words — *| Samsung الأردن* on a site whose titles end *| Samsung لبنان* — those
words are flagged in every page property that has them: the titles, the
descriptions, the keywords. A home page that cannot be read, or gives no
ending, means no check.

From a sheet made before v3, the value is built from the page instead: each
`<a1>` put back as the exact tag it stood for, a translated `title` or `alt`
written into that tag (an entity the translator kept, like `&trade;`, stays
one). A text and the `<a1>` title inside it are two rows but one write; a value
that still holds placeholder text after the tags are put back is refused.

**The review screen** looks like the copy deck's own: one fold per section of
the sheet — the page properties, each component, each *Static content 5 of 8 ·
…* block — in page order, closed to start with. Each fold's header has a
**tick**, the section's name and a count of the changes it would write.
Opened, each text shows its field, **Old** (the text on the page now) and
**New** (the translation). A text that will not be written stays in its
section with why, and nothing to tick: *Needs attention: …*, *Same as
English*, *Not translated*, *Not on this page*, *Already translated on the
page*.

**The ticks decide what is written.** Every section with something to write
is ticked to start with — except Static Content, which holds page code, and
says so once above the folds: *Static Content blocks hold page code. Tick them
to let DSY update them, then check those blocks on the page.* **Select all**
above the folds ticks or unticks every section (part-ticked when some are). A
tick only changes the counts and the Write button — *Write 30 texts and 7
Static Content blocks*, or *Nothing to write* — the page is not checked again,
and the folds stay open or closed as they were. A section with nothing to
write has no tick to give.

Beside Select all, **Find English still on the page** (see below). Text a
block has that is not on the sheet — English added or changed after the
export, or kept off the sheet by the export — is listed, folded, under *On the
page, but not in the sheet*; a translation from the sheet that is in the block
already is not.

**Each Static Content block, prepared to paste** (a sheet of v4). The check also builds, block by block, the block's
whole new *Body (HTML)*: the value the web team pastes over the old one with
Ctrl+A, Ctrl+V — or, only with the block's section ticked, what DSY writes itself. Each translation goes
where the reader found its text — by position, never by search, so *Active*
can never land in `class="tab active"` — and every place of a text gets it.
Everything else stays byte for byte: the code, the indentation, CRLF, and the
page's own tags. A tag in the translation is matched to the cell's by its
link and class, so two links whose words the translator swapped keep their own
words; the page's tag at that place is what is written, so a link re-pointed
on the page since the export keeps its new address, and a link the translator
changed keeps the page's, with a note. Excel's doubled quotes, curly quotes
and right-to-left marks inside a tag are repaired; marks outside it are kept.
A `<br>` or a `<wbr>` may move or go, never be added: the page's own, of the
kind the translator wrote, goes where it was written — a `</br>` too, which a
browser reads as a `<br>`. The words are escaped for where they go: between
tags a bare `&` and `<`; in an attribute both quotes and `>` as well, and an
attribute the page stored without quotes gets them; codes like `&nbsp;` stay
as written. A comment inside a sentence ends it, as one between sentences
does, so no cell shows it and it stays in the block as it is.

A text the block cannot take is **sent back** — its row moves to *Needs
fixing*, saying why, and stays English in every place, while the rest of the
block is still prepared: a tag added or left out, one opened and not closed,
moved into or out of another tag, given a handler such as `onclick`, two
changed links that cannot be told apart, markup where the English has none
(written as codes too: `&lt;img …&gt;`), or a sentence whose own code DSY
cannot read safely — a tag with a quote left open, which a browser may still
read as a tag.

The prepared value is checked three ways, and one that fails a check is never
offered: the bytes outside the placed texts are the old value's; at each place
the text reads as its translation (by position, so a one-word lowercase
*argent* is checked too, and a link's title inside a sentence wherever the
link went) — worked out from the translation itself, never from what was made
of it; and a second, different reader (`html.js`) sees the same elements, the
same attributes but the planned ones, the same script and style, and the same
text outside the planned sentences. Inside a sentence it takes the elements as
a set, so two links whose words were swapped pass, while a tag that came, went
or changed does not. `html.js` finds a tag with the same pattern as DSY's own
reader: it checks how the tags fit together, and a tag only a browser would
read is caught before, by the rule above. A block with nothing to paste, one
whose texts were all sent back, or one whose *Header (CSS)* holds HTML from an
earlier paste into the wrong tab, says so instead.

The plan lists each block with its node, its *Static content 5 of 8 · …*
label, its three fields as read, the prepared value or why there is none, each
text with its outcome (placed, sent back, already, not found…), the Body's
text that is not on the sheet, and — for a block with a script — a
**developer's list** for its *Footer (JavaScript)*: each line as it is and as
it becomes, the translation escaped for the string it goes into (the sheet's
`&nbsp;` becomes the no-break character itself; a quote, a backslash, a line
break, `</` and `<!--` are escaped). A sentence the script builds — `${open ?
"Close" : "Open"} showcase container` on lines 52 and 53 — is one item over
both lines: the template becomes a choice between the two whole sentences,
translated. A template that is not one choice — a choice inside a choice, say
— is listed for the developer to write.

**The prepared Footer (JavaScript).** For a ticked block DSY writes the
Footer too, made the same way: only the inside of each string the reader
found is replaced, by the translation escaped for that string's quote, and a
built sentence becomes the choice between the two translated sentences. Every
string not translated stays as it was. It is checked before it is offered —
never run (an extension may not run code from a page): read again with the
same tokenizer, the new script must have the old one's code exactly and the
same strings in the same order, only the strings put in changed, each reading
back as its translation, and none of them holding `</script` or `<!--`. A
Footer that fails, or has a built sentence that is not one choice, is not
written, and the block's fold says why (*Footer(Javascript) not written: …*);
its Body (HTML) can still be. The *Header (CSS)* is never written.

For **Check again** after the paste (read only) the same
module says where a block stands: *Pasted (done)*; done with only line endings
or indentation changed by the editor; *Not pasted yet*; pasted into
*Header(CSS)* or *Footer(Javascript)* by mistake, or either of them cleared,
with the fix; *This block holds the value of block 4*; *Cut short: only the
first 6,319 of 15,835 characters (ends at line 155)*; *Differs at line 347: now
"…", prepared "…"*; done with links or image paths changed after the paste;
done with CSS added to the Header, for the developer. Line endings and
indentation the editor changed never hide a value: another block's, the old
one, one cut short. A block DSY prepared no value for is never *Pasted*: it
says why there is nothing to paste, or — cleared, changed, holding another
block's value — how to put its old value back. It never says a plain *done*
while a text is sent back, not found, left without a translation on the
sheet, in fewer places than at the export, or not on the sheet. For the Footer
it counts the strings still in English, says whether the built sentence is
translated, and points out a `</script` in it.

**A Static Content block's fold.** Above its texts (Old/New, the script's
too), a card:

```
cm_g_static_content__1495926445 · first image: wellness-kv-mo-webp-v2.png · last changed by: <who>
After block 4 "Find your perfect companion" (pasted - now shows its translation) · before block 6 "Galaxy Buds" (not pasted)
32 texts to place · 0 same as English · 0 sent back · 0 not on the sheet
[Copy new Body(HTML)]  [Copy old Body(HTML)]  [Check again]
After pasting, look at: tab "Active", tab "Athlete", the overlay that opens on click
Check, not translate: 4 links to /levant/ · 3 images, 1 video
Developer: "ArrowRight" key handling · 1 <script> left unchanged
Status: Not pasted yet
```

Every block in the editor is called *RC01_Static Content*, so the fold and
the card give what finds it: the number, the heading and the neighbours **as
they show now** (English, or the translation once pasted), and the first
image's file name. A field DSY cannot write says why on the card
(*Body(HTML) not written: …*, *Footer(Javascript) not written: …*).

**Ticking a Static Content block.** Its fold's tick, off to start with, lets
the Write write the block's prepared *Body (HTML)* and *Footer (JavaScript)* —
each only when one was prepared and passed its checks — exactly as prepared,
CRLF and all, each in a request of its own, read back like every other
property. A text sent back stays as it is. Ticked, the card says *DSY will
write this block: Body(HTML) and Footer(Javascript)* (or just the one), and
**Copy new Body(HTML)** goes; **Copy old Body(HTML)** (the undo), **Copy old
Footer(Javascript)** and **Check again** stay. Then check those blocks on the
page.

**Pasting by hand instead** — for anyone who prefers it, leave the block
unticked. The steps are folded once above the folds (*To paste a block by
hand instead*), one block at a time:

1. Click **Copy new Body(HTML)**.
2. Open the block in AEM: click it, then **Configure** (the wrench).
3. The dialog opens on **Header(CSS)** — click the **Body(HTML)** tab. Never
   paste into Header(CSS) or Footer(Javascript).
4. Click inside the field. Press **Ctrl+A**, then **Ctrl+V**, then click **Done**.
5. Back in DSY, click **Check again**.
6. Preview the page: click the tabs and overlays the card lists.

(On the screen the steps are said in one line: in its section, click Copy new
Body(HTML), open the block in AEM (Configure), click the Body(HTML) tab, Ctrl+A,
Ctrl+V, Done, then Check again.)

**Copy new Body(HTML)** needs no page version: no version is saved or looked
for. The copy writes to the clipboard at once, inside
the click, and fills it when DSY has read the block again — so the browser
keeps the click's permission. If someone changed the block since the check,
the value is made again on what it holds now, and their change is kept. If the
block holds another block's value, is cut short, has HTML in Header(CSS), or
is pasted already, nothing is copied. A copy that worked says, until the next
copy: *Copied: block 5 of 8 · Made to support your everyday wellness · 15,835
characters - paste into THIS block*. Any copy that did not work says *Not
copied - do not paste*, in red, with why and what the clipboard still holds,
until it is dismissed.

**Copy old Body(HTML)** copies the block as DSY first read it — to undo one
block: paste it into the block the same way. **Check again** reads the block's
three fields and who changed it last — one read, nothing written — and shows
where it stands (see *Check again* above) with what to do.

A block's old value as first read and the value prepared for it are kept in
the browser (`chrome.storage.local`), per server, page, block and old value:
closing the panel loses nothing. The first old value is never replaced — checked again after the paste, the
block still copies back as it was before. Pages kept more than 30 days, and
the oldest once all of them pass 3 million characters, are dropped, far
inside the browser's 10 MB. A card's reads go to the tab and server that were
checked: from a panel now on another server, or a tab that moved to one, they
are refused with *This was checked on author.test, but the panel is now on
other.test. Go back to that tab, or check again here.* No new permission:
`storage` was in the manifest already.

**The hand-offs.** What a block needs from someone other than the web team is
on its card, folded, worked out by `hand-offs.js`. None of it writes to AEM.

- **Footer(Javascript), line by line.** For a block whose Footer has texts on
  the sheet (block 3, the showcase), folded: each line's number, the line now,
  and the same line with the translation in, already escaped — what DSY
  writes when the block is ticked, or what a developer puts in. A sentence the
  script builds becomes a choice between the two whole sentences. **Copy
  list** copies it as plain text; **Copy old Footer(Javascript)** copies the
  Footer as DSY first read it — the undo, written by DSY or by hand; **Check
  again** counts the English left (*0 of 26 still in English, built sentence
  translated, no </script*). It says: *After the change, open Preview. If the
  showcase area is empty, the script broke - paste the old Footer back at
  once.*
- **Developer** on every card: a left/right layout (`left: 32px`, `toLeft`,
  `rightFixed`), `"ArrowRight"`/`"ArrowLeft"` key handling, fonts that may have
  Latin letters only (`SamsungSharpSans`, `SamsungOne`), and scripts in the
  Body left unchanged.
- **Links to check.** Links that point at the sheet's site, found by page
  copy's rules (`rewrite.js`): block 2 has 1, block 3 has 5 in its Footer,
  block 5 has its own in the Body. Links to any third site are listed too, to
  check. A link to one product's page (`…-sm-r390nzaamea/buy/`) says *check
  this page exists on levant_ar*. The tick **Re-point links to levant_ar**
  re-points the Body's links inside the value Copy new copies, with page
  copy's rules, links only — images and DAM paths are never touched. The value
  is made again on the old one with the links re-pointed, and must pass the
  three checks again; one whose rules would touch a picture is refused.
  Unticked, the links stay as they are. The Footer's links are the developer's.
- **Images for the designer.** The block's pictures and videos, a desktop file
  and its mobile one together (*mep-kv-dt.jpg (desktop) + mep-kv-mo-v3.jpg
  (mobile)*), the script's pictures too. Check each for English words. New
  images are uploaded to DAM, never copied (Dynamic Media): change the path in
  the block before Copy new.

**Find English still on the page** is the final sweep, one button above the
folds, read only: the worker reads the page and plans it again with the same
sheet (GET requests only), and lists every text whose English is still on the
page, with where and why — *not written yet*, *not pasted yet*, *still in the
script - not written yet*, *no translation on the sheet*, *the sheet keeps the
English*, *not on the sheet*. A text can be ticked **kept on purpose**
("Galaxy Fit3", "@samsunglevant"); the marks last while the panel is open.

**Fields added to the copy deck** need nothing here. A row's Key names the
node and the property, so a row the rules do not know — a field added from
the export's list, on whoever's machine that was — is read from its Key: the
import finds the component at that node, treats the field as added for this
check, and the page is read again with it — the same way the export reads
it, so a row is accepted only where the export itself could have made it:
never a system property, an analytics value, a node the page does not have,
or a value that is a path or a link, judged value by value. Such a Key is
*Not on this page*, whatever its Check says or whatever else is on the sheet.
A Static Content block's script or style sheet is never read this way: its
row *Needs fixing*, and says the import never writes it.

Each row is shown under the **Section** it has on the sheet, so the review
reads like the Excel file in front of you, even where the page would number
its sections differently (rows left off the sheet can shift the numbers).
Static content is the exception: each place is shown under its block as this
page numbers it — *Static content 5 of 8 · …* — since a row merged from several
blocks, or with another component, names only the first on the sheet.

**The sheet as a whole:** a missing `#END` row, or a row count that does not
match it, means the paste may be short — a filter left on, hidden rows, a
paste that stopped at a blank row. Importing into the very page the sheet was
exported from is pointed out, and so is a sheet whose keys are mostly not on
the page. Text on the page that is not on the sheet is listed too.

A sheet whose `#END` row says a newer copy deck version than this DSY writes is
refused whole, before the page is read: *This sheet was made by a newer version
of DSY - update DSY, then import again.* A row read wrongly could be written
wrongly. Sheets of v1 to v3, with or without the `#END` row, import as before —
static HTML in the pieces they cut it into, keyed by position (`…@bodyHtml#03`),
with a word above the review: *Made by an older DSY - export again to get whole
sentences ready to paste.* DSY 0.18.1 refuses a v4 sheet whole, as above; an
older DSY reads its static Keys as *Not on this page*, and writes none of them.

**Product pages are refused**, before anything is read: a sheet exported from a
product page (its keys read `pd:…`), and any sheet checked against a product
page. Their copy comes from PIM — anything written to AEM would not be what the
page shows, and PIM would write over it — so their translations are entered in
PIM.

#### Writing

The button names what the ticked sections write — *Write 12 texts*, or *Write
30 texts and 7 Static Content blocks* with Static Content sections ticked, a
block's Body and Footer counted as one block — the question above it
names the page and the server, and the review screen lists the steps, which
tick through as the run goes:

| Step | What it does | If it fails |
|---|---|---|
| Check the page again | Reads the page and plans again, keeping only the sections ticked — the panel sends their ids. The writes must be **exactly** the ones ticked, on the **same server and page** — the panel sends their fingerprint, which covers the instance, the page path and the ids ticked, and sends it to the tab the check ran in | Stops. An author edited the page in between, the ticks sent are not the ones fingerprinted, or the panel is now on another instance: check again and read the new result |
| Check the page lock | A lock held by someone else is theirs to lift. A lock you hold is fine | Stops, nothing written |
| Write | Form-encoded Sling POSTs to `jcr:content`, names relative (`./root/…/headlineText`), each value typed (`String`, or `String[]` so a multi-value stays one): the texts in one request (more only past 150 KB), each Static Content block's Body and Footer in a request of its own. Not multipart: the Samsung authors answered a multipart write 200 OK and changed nothing. Every answer is logged under Activity with Sling's change count; a 201, another path, or no change stops the run. `cq:lastModified` and `cq:lastModifiedBy` are set so the page shows as modified | A failed request stops the run; Activity says how many requests were saved before it |
| Read the page back | Every written property is compared with what was sent | Names each one that differs, to check on the page |

Never done: deleting a property (Sling removes one posted empty, so an empty
value is refused before it could be sent), creating a node (every path comes
from the page just read), writing a row that was not *Ready* or *Uses a
repeat's translation*, writing anything of a section not ticked, writing
static HTML (`bodyHtml`) or a Static Content block's script (`footerInclude`)
— but a block's prepared Body (HTML) and Footer (JavaScript), when its
section is ticked — or a block's style sheet (`headerInclude`), ever — a last
check on the writes themselves refuses them whatever let a row through —
saving a version, or publishing. A Static Content block DSY wrote is undone
from its fold: **Copy old Body(HTML)** or **Copy old Footer(Javascript)**,
then paste it into the block.

### Relative Link Fixer

The site's rule: a link to one of its own pages is authored as a relative path,
never as a full URL.

```
wrong   https://www.samsung.com/uk/mobile-phone-buying-guide/best-smart-watch/
right   /uk/mobile-phone-buying-guide/best-smart-watch/
```

**Find full-URL links** reads the page's jcr:content whole and lists every link
to one of our hosts, one fold per component in page order, each with the path it
becomes. Reads only. Our hosts are `www.samsung.com`, `samsung.com`, this author
instance, the author instances in settings, and the extra site hosts listed
there. Anything else — YouTube, `shop.samsung.com`, `images.samsung.com` — stays
a full URL, since a relative path would point it at www.samsung.com.

A URL counts as a link only where a link is stored: the whole value of a field,
an attribute in markup (`href="…"`, escaped in JSON too), or a quoted string in
stored JSON. Text that only mentions `www.samsung.com/uk` is not changed. The
query and `#anchor` are kept; an author link through `/editor.html` loses the
editor. jcr:content's own properties and its `image` and `cq:*` children — the
page properties — are never looked at. Each fold is named as the editor names the component — the `jcr:title` of its definition under `/apps` (then `/libs`), "Text Block" rather than `cm-g-text-block` — with the node's own name beside it to tell two of a kind apart. A component in a live copy is marked: a
rollout puts the full URL back unless its inheritance is cancelled.

**Fix** writes only the ticked links. Each property is read again first and must
still hold exactly what the scan read, or nothing is written. No version is
saved. The properties go in form-encoded requests with their type kept, `cq:lastModified` is set, and every property is read back.
The done screen says how many full-URL links are still on the page.

### Site tokens

Both features read the site token off the paths: with the default site-root
depth of 3, it is the third segment. `/content/samsung/uk/…` → `/content/…/lb/…`
gives `uk` → `lb`; `/content/acme/se/…` → `/content/acme/no/…` gives `se` → `no`.
Direction, locale and brand are all just data.

A token is never confused with a longer one that starts the same way — `/in`
does not match inside `/india`, `/de` does not match inside `/denmark`.

If both paths are on the **same** site — `/content/samsung/levant/…` into
`/content/samsung/levant/india/backup/…` — there is nothing to re-point, so
rewriting switches off and it becomes a pure structural sync.

**The one case that cannot be derived** is a locale written as more than one
segment. `/content/samsung/in/en` and `/content/samsung/lb/india/backup` are the
same shape and mean different things: the first is one locale, the second is a
folder inside `lb` whose links should still point at `/lb`. No rule separates
them. So both features have optional **site token** fields — leave them blank
unless your locale is multi-segment, and check the tokens the analysis reports
in its header. If one token contains the other, the run is refused rather than
risking a rule matching what another rule just produced.

### What the analysis shows

Above the log, every run draws what it intends to do. The order is deliberate:
anything inferred comes first, because if the inference is wrong nothing below
it means anything.

1. **Counts** — mode, the site tokens it derived, properties, links, images.
   Links and images are shown **even at zero**: on a cross-site transfer, "no
   links to re-point" is something to notice rather than infer from a missing
   row.
2. **The component pairing**, when any of it was inferred rather than read off
   matching node names.
3. **The plan**, numbered in the order it will run. This doubles as the progress
   view — each step picks up a tick and a count while the run goes.
4. **The evidence**, as collapsible tables:

| Table | What it holds |
|---|---|
| Links re-pointed | Every **distinct** reference that changes, from → to, how many times it is used and which components it sits on |
| Images | Every DAM reference, where it lands, and whether it is being uploaded |
| Properties updated | Per node and property: the text and settings that change |
| Image paths updated | Properties that point at an image or another DAM asset — a DAM path, a Dynamic Media URL, a media file — and text whose only change is where its images point |
| Links updated | Properties that are a link — a page path, a URL, an anchor — and text whose only change is where its links point |
| Properties added / removed | Per node and property |
| Components added / removed / reordered | The node, and for a reorder the position it moves to |
| Site values | The Twitter handles, title endings and language set to the destination site's, where they were read, and anything left to fix by hand — with the tick box that leaves them alone |
| Metadata kept as it is | What was left for you to edit, and what the source had |
| Still pointing at /&lt;site&gt; | References the rules leave alone on purpose, plus unconfigured hosts |

Updated properties come in three tables because a cross-site run re-points
dozens of image paths and links that all look alike, and the few text and
setting changes between them are what someone actually reads for sense. A
value is an image path or a link when it is one before and after, or when its
only change is the site rewrite of the references inside it; a text that
changed otherwise stays under *Properties updated*, whatever links it holds.
A colour like `#ffffff` is a setting, not an anchor.

The *Links re-pointed* table (From another server) exists because even then a
rich-text blob with three links is one 2,000-character row you would have to
read. It breaks it into the forty characters that matter.

Tables hold JCR paths, and a path is only useful whole — `…/samsung/uk/mobi…`
and `…/samsung/lb/mobi…` are the two halves of a decision you cannot make from
the visible part. So columns get real widths and the table **scrolls sideways**
rather than being squeezed into the panel. Drag any column edge to resize it,
double-click the edge to fit the widest value, and the full value is always the
cell's tooltip.

### Component order

Child node order **is** component order in AEM, so it is treated as content
rather than presentation.

| | |
|---|---|
| Backup | `copyPage` copies the subtree; order comes from AEM untouched |
| Backup, update | Order is diffed and restored to match the source, as in a sync |
| Sync page, create | Same, then only properties are rewritten |
| Sync page, sync | Order is diffed and restored to match the source |
| From another server, create | `copyPage` cannot cross servers, so every node is written individually with `:order` — the order is built, not inherited |
| From another server, sync | Restored, and a component the source has **in the middle** lands in the middle rather than being appended |

Parents with an all-digit child name are skipped and reported, because JSON key
order is not dependable there.

### The panel

| Screen | Shows |
|---|---|
| Home | The page open in this tab, the features as cards, and the connection status |
| Not enabled | Why nothing can run on this site yet, and **Allow this site** |
| Form | The fields, and a short *what happens* box. Backup and Sync page prefill the source from the page in the tab; Versions, Copy deck and Import translation prefill the page. Import translation's form has the paste box |
| Review | The Source → Destination paths, then the analysis. Anything that removes content needs a tick box before the button unlocks; a run with a blocker cannot be started at all |
| Running | The plan as a stepper, with *n of m steps* and a progress bar in the header |
| Done | The result, **Open in the editor**, and a way to start another |

The action buttons and the connection status are always in the footer. Every
log line is kept under **Activity**, and a failure is also shown at the top.

### The flow

You're already logged into AEM in that tab; the extension uses that session and
never asks for credentials.

1. Open the side panel, pick the feature and fill in the form. *From another
   server* names both instances, so it works from any tab.
2. **Analyze** — reads only, on both instances. What it found is drawn above the
   log, as described in *What the analysis shows*. For **Backup** specifically,
   the destination is drawn the way CRXDE Lite draws the repository: the whole
   chain from `/`, one compact row per node with its type icon, and a tag for
   what happens to it:

   ```
   ▾ /
     ▾ content
       ▾ samsung
         ▾ lb
           ▾ india                    EXISTS
             ▾ backup                 NEW
               ▾ home-appliances      NEW
                   learn              COPY
   ```

   Hover a node for its full path; click it to copy the path.
3. Read it, then confirm — or go back and change the paths.

Nothing is written until step 3. Editing **any** field clears the analysis,
including the tick boxes, so what gets written is always what was approved.
Confirming re-runs the full analysis server-side before writing, in case
anything changed in between.

During the run the plan becomes the progress view — each step picks up a tick
and a running count, so you watch it fill in rather than reading a log beside
it.

## Layout

```
manifest.json
src/
  background/service-worker.js   side panel behaviour, on-demand injection
  content/
    content.js                   classic injection entry
    runtime.js                   command dispatch, progress reporting
  core/
    aem-client.js                all AEM HTTP: CSRF, wcmcommand, reads (whole trees too), Sling writes incl. multipart
    paths.js                     pure JCR path helpers
    align.js                     pure component pairing across two servers
    diff.js                      pure diff, shared by sync and transfer
    rewrite.js                   pure site-token rewriting + property typing
    protocol.js                  message contract + settings
  features/
    registry.js                  the feature list
    page-copy/
      meta.js                    form fields and buttons
      worker.js                  the operation itself
      panel.js                   tree renderer + live progress
    page-upsert/
      meta.js                    form fields and buttons
      worker.js                  create-or-sync, rewriting, assets
      panel.js                   plan renderer + live progress
    page-transfer/
      meta.js                    form fields and buttons
      worker.js                  runs in BOTH tabs; read there, write here
      panel.js                   two-tab orchestration + pairing review
    page-versions/
      meta.js                    form fields and buttons
      worker.js                  read the version store, restore, check
      panel.js                   the version list to pick from
    copy-deck/
      meta.js                    form fields and buttons
      core.js                    pure: rows from jcr:content, the sheet, CSV; the import plan
      xlsx.js                    pure: the sheet as a formatted .xlsx and back, no library
      worker.js                  read the page whole - or, for a product page, as rendered
      pd.js                      pure: a product page's rows from its rendered HTML; each text once; SKU presets
      html.js                    pure: HTML as a tree without a DOM, as forgiving as a browser
      static-content.js          pure: a Static Content block in whole sentences, every text with its place in the value; its script's strings; the new Body (HTML) to paste, checked three ways; the Footer's list for a developer; the status after a paste
      panel.js                   groups, SKU switch, preview, download, copy for Excel
      new-fields.js              the "Fields not on the sheet" list: add or ignore
      dialog.js                  the components' dialogs from /apps, includes followed: text, setting or analytics
      fields.js                  the added and ignored fields, in chrome.storage.sync (panel and settings)
    copy-deck-import/
      meta.js                    form fields and buttons
      worker.js                  read the target page, plan the import, write it; read one Static Content block; Find English still on the page, read only
      panel.js                   the paste area (a custom field), the review - a fold per section, its tick, Select all - the write steps
      paste-by-hand.js           a Static Content block's card in its fold: what a tick writes, copy new and old, check again, kept values; the hand-offs
      hand-offs.js               links to re-point or check, images, the developer's report, the list of English still on the page
    link-fixer/
      meta.js                    form fields and buttons
      links.js                   pure: full-URL links to our hosts in a value, what each becomes, the fix; a page's content scanned, page properties left out
      worker.js                  scan the page; fix the ticked links, checked before and after
      panel.js                   a fold per component, a tick per link, Select all, Save a version first
  options/                       author instances, per-feature settings
  panel/
    panel.html / panel.css       the side panel shell
    panel.js                     screens, form, flow, tab routing, feature hooks
    icons.js                     inline SVG icons and the empty-state artwork
    table.js                     resizable analysis tables, shared by features
icons/                           the DSY icon at 16/32/48/128 px, cut from its 1024 px artwork with the corners transparent
test/align.test.mjs              pairing, against the real UK/LB component trees
test/sites.test.mjs              token derivation across locales, brands, depths
test/page-copy.test.mjs          worker tests against a simulated AEM
test/page-transfer.test.mjs      the same, across two simulated instances
test/page-upsert.test.mjs        the same, for create-or-sync
test/page-versions.test.mjs      list, restore and create, against a simulated version store
test/settings.test.mjs           stored settings and their one-time updates
test/copy-deck.test.mjs          rows, text, CSV and workbook from a real page; fields to add or ignore; Static Content code never offered; script data to fix before translating, in Activity and on its rows, and no false alarm; over-long cells refused; reading a page too big for one request
test/copy-deck-fields.test.mjs   the added and ignored fields in sync storage: kept short, refused (Static Content code too), full, four clicks at once
test/copy-deck-panel.test.mjs    the copy deck's review screen drawn for real in a small DOM: Add, Ignore, a change from settings, another feature on screen, a product page's SKU switch, a refused CSV or copy, the import's review: a fold per section with Old/New, Static Content unticked to start, Select all and a tick changing only the counts and the button - nothing asked of the page, nothing drawn again - the write sending the ticked sections and their fingerprint; a block's card: counts and neighbours, copy new and old, Check again outcomes, kept values, another server refused; the Footer folded and its copies, links re-pointed only when ticked, images, Find English still on the page and its kept marks; no page checklist
test/copy-deck-dialog.test.mjs   the components' dialogs (Showcase Card, Feature Full Bleed, Static Content, page properties): includes followed, text / setting / analytics / code, labels and lengths on the sheet
test/copy-deck-import.test.mjs   the round trip: export, translate, paste the way Excel does, plan, write to a simulated Sling; Static Content unticked by default and written only when its section is ticked, Body and Footer exactly as prepared, the Footer's code token for token the old one's, quotes, backslashes and </script escaped, a Footer failing its check not written while its Body is, never a Header; refused once a block changed or the ticks differ from the fingerprint; no version saved; the cards' read-only actions and Find English still on the page, GET only; disguised scripts, and plain words that only look like them, after an apostrophe too; newer sheets refused
test/copy-deck-static.test.mjs   Static Content on a real page: whole sentences, tags shown with link and class, attributes and script strings as rows, blocks numbered and named, Keys that outlive edits, texts kept off the sheet, notes per place, the import's by-hand list - each place under its own block, what is there already (a built sentence as plain strings, an Arabic tag) - sheets made before v4; the hand-offs: links per block, re-pointing that keeps every picture and passes the checks again, images in pairs, the developer's report, what Find English still on the page lists before and after a paste
test/copy-deck-static-engine.test.mjs   the way back: each block's new Body (HTML) from the sheet, placed by position, the page's tags byte for byte, two links swapped, end to end, escaping by where the words go; texts sent back, the rest of the block placed all the same; the three checks, each catching a placing bug of its own, and a value that fails one never offered; the status after a paste, line endings changed or not, a block with nothing to paste; the Footer's list for a developer; the import carrying it block by block, writing it only when ticked
test/copy-deck-pd.test.mjs       a product page from its rendered HTML: the parser, what becomes a row and what is left off, the SKU sheets, the import refusing it
test/link-fixer.test.mjs         what counts as a full-URL link and what is left alone, what it becomes, only the ticked occurrence fixed, page properties never scanned, live copies marked
```

## Adding a feature

Create `src/features/<id>/` with `meta.js` (fields + flow), `worker.js`
(exports `actions`, gets an `AemClient` and a `report` function), and optionally
`panel.js` (a custom result renderer). Add the id to `FEATURE_IDS` in
`src/features/registry.js`. The panel grows a tab for it automatically; nothing
else needs editing.

A field the shell has no type for — a paste area, say — is `type: 'custom'`.
The shell gives it a label and a hidden input, and calls the feature panel's
`renderField(host, field, { el, icon, input, changed })` to draw the control.
The control keeps its value in `input.value` and calls `changed()` when it
changes, so collecting, requiring and clearing an analysis work as for any
other field.

## Tests

```bash
node test/align.test.mjs
node test/sites.test.mjs
node test/page-copy.test.mjs
node test/link-fixer.test.mjs
node test/page-transfer.test.mjs
node test/page-upsert.test.mjs
node test/page-versions.test.mjs
node test/settings.test.mjs
node test/copy-deck.test.mjs
node test/copy-deck-fields.test.mjs
node test/copy-deck-panel.test.mjs
node test/copy-deck-dialog.test.mjs
node test/copy-deck-import.test.mjs
node test/copy-deck-static.test.mjs
node test/copy-deck-static-engine.test.mjs
node test/copy-deck-pd.test.mjs
```

All of them run against the real worker modules and a simulated AEM 6.5
— the exact calls made for each scenario, and every abort path. No browser
needed, no dependencies.

The sync suite's simulated repository is a nested object, so child node order
survives and component ordering can actually be asserted. Its Sling stand-in
coerces property types the way Sling does, **including rejecting a bad
`@TypeHint`** — which is what makes "an array of doubles is not sent as
`Long[]`" a real test rather than a restatement of the code.

The transfer suite runs **two** simulated instances and drives them through the
real panel module, so the orchestration is under test and not just the workers.
The pairing suite uses the actual component sequence of a real UK/LB page pair.
The sites suite exists to stop a worked example turning into an assumption: it
runs the same rewrites over six locale pairs in both directions, a different
brand, and a deeper site root.

Both Sling stand-ins implement `:order` faithfully rather than logging it, which
is what makes the ordering claims above testable — including *a component added
mid-page lands mid-page*, the case where appending to the end is the easy wrong
answer. One test deliberately pins the **limitation**: a destination whose
components are re-ordered is mis-paired, and the assertion is that the run says
so rather than that it gets it right.

The copy deck suites use the real za/tvs `jcr:content`, trimmed to one of each
component, as their fixture; the Static Content suite the real
explore-samsung-health page's, trimmed to its 8 Static Content blocks. The
export suite checks every row rule, the text shown to translators, the CSV, the
clipboard table and the workbook — its zip, CRCs, styles and frozen header —
cell by cell. The import suite runs the real
round trip: export, fill in translations, hand the sheet over the way Excel's
clipboard does, plan against the page, then write. Its Sling stand-in reads a
multipart body **as the server receives it**, serialised and parsed, and keeps
Sling's sharp edges: a missing node is created, an empty single value deletes
the property, a rejected request changes nothing. That is what lets the suite
assert that a write never creates a node or deletes a property, that line
breaks land as reviewed, and that an approval from one server is refused on
another. An Excel-style workbook — deflated, shared strings, rich-text runs —
is built in the test to cover reading one back.

The product page suite uses the real ca QN80H page as served with
`wcmmode=disabled`, trimmed — no scripts, header, footer or all but one review,
and the attributes nothing reads taken out — and checked to give exactly the
rows the whole page gives. It pins what becomes a row and what is left off by
name (*Choose your size* never; *Wide Viewing Angle* as `Video › Viewing
Angle`), runs the worker against a simulated AEM that serves the page's node
and its HTML, and checks a login page served in its place stops the run.

## Things to know

- **`shallow` defaults to false in AEM.** Omitting it deep-copies the whole
  subtree. It's always sent explicitly, and the destination is re-read afterwards
  to confirm no child pages came across.
- **AEM auto-renames on collision and still returns HTTP 200**, with the real
  outcome inside the response body. Every write is checked against the path it
  was supposed to land on, and the run aborts on a mismatch.
- **Backup never deletes a page.** If a run stops part-way, the pages already
  created are listed and left in place. Updating an existing backup is a sync,
  so it does remove components and properties the source no longer has — only
  inside that backup's `jcr:content`, after versioning it.
- **Page sync does delete** — that is what makes it a sync. It only ever removes
  things *inside* the destination page's `jcr:content`, never a page, and every
  removal is re-checked against the live source first. See *Removals* above.
- **The copy inherits the source's replication properties**, so a page that was
  never published can show as *Published* in the Sites console. It is not live.
- **Page copy does not rewrite internal links.** Page sync and transfer do.
- **`copyPage` cannot cross servers**, so a transfer creates the page from its
  template and writes every node — there is no server-side copy to lean on.
- **Renditions do not come across.** The destination regenerates them via DAM
  Update Asset, asynchronously, so expect missing thumbnails for a short while.
- **Asset metadata does not ride along with the binary** — title, description
  and tags are not transferred, by Page sync or by From another server.
- **Page sync uploads images; before 0.9.5 it copied them in the repository.** A
  copy made by an earlier version shows in edit mode but not with
  `wcmmode=disabled` on a Dynamic Media instance. Delete it in Assets and run the
  sync again, or tick *Upload again, over assets that are already at the
  destination* in settings for one run.
- **A Double whose value is whole (`1.0`) reads back from `.json` as `1`** and is
  written as a Long. JSON cannot carry the distinction.
- **Component pairing assumes the destination has not been re-ordered.** Where a
  component type appears more than once, only order separates the candidates and
  those rows are marked `‼`. See *Component pairing*.
- **Images from another server are uploaded, not copied** — `:operation=copy` is server-local. One
  that cannot be carried (over 256MB, a 403, an upload that fails or never
  answers) is skipped and listed to do by hand; the page still points where it
  belongs.
- **Where the company DRM encrypts saved files, it encrypts what Excel saves
  too.** Such a file cannot be read by the extension; paste the sheet from
  Excel instead (Ctrl+A, Ctrl+C). The import says so when it meets one.
- **A translation import writes, but never publishes.** Review the page and
  publish it as usual. It saves no version.
- **Static HTML is not written by the import**, unless you tick a Static
  Content block's section on the review: then its prepared Body (HTML) — and
  Footer (JavaScript), when it passed its checks — are. Otherwise its text is
  on the sheet and on the review screen, for someone to paste or change in the
  component.
- **A Static Content block's Header (CSS) and Footer (JavaScript) are never on
  the sheet as a whole.** The Header is never written. The strings a visitor
  reads in the Footer — the explore-samsung-health showcase's tiles, say — are
  on it, one per row; with the block ticked DSY puts them in, strings only,
  else a developer does, line by line.
- **The copy deck knows fields by name.** A new component that uses the usual
  names (`headlineText`, `description`, `textForLinkAction1`…) works as it is.
  A field with a name of its own is listed under *Fields not on the sheet*, to
  add or ignore; the answer is kept in Settings and counts on every page. What
  it can still miss: short codes, prices and sizes on their own (`QN90F`,
  `R999`, `55"`), and lowercase single words (`more`), which read as settings.
- **An import needs no settings for added fields.** The Key on each row is
  enough, so a sheet exported with added fields imports on any machine.
- **A product page (PD) is read as rendered, and its sheet is export only.**
  Its copy comes from PIM, so it is read from `<page>.html?wcmmode=disabled`,
  and the translations are entered in PIM — the import refuses the sheet and
  the page. What it reads is the page as the author instance renders it: a
  feature PIM has not published to that instance is not on the sheet. Parts of
  the page are known by their classes (`pd-g-…`, `hdd02-gallery`,
  `pdd32-product-spec`). A component it does not know goes to *Other text on
  the page*; a known part it cannot find - the gallery, the features, the
  specs - is named in the Activity log, so a redesign is noticed rather than
  read short.
- **An import check belongs to one server and one page.** Switching the panel to
  another author instance between checking and writing refuses the write;
  check again there.
- **Every line break a translation writes is stored as CRLF**, because the write
  is multipart and multipart encodes line breaks that way. The review screen
  already shows the stored form.
- **Import translation has so far been tested against the simulated AEM only.**
  Run the first real import on a copy page, not a live locale page.
- **Both instances need a tab open** for a transfer, or one is opened in the
  background. Each half runs same-origin under its own session.
- Not tested against AEM as a Cloud Service — `/bin/wcmcommand` differs there.
