# AEM 6.5 — single-page copy with auto-created intermediates

`aem-page-copy.js` copies **one** AEM page from a source path to a destination path,
creating any missing ancestor pages on the way.

## Use

1. Open an AEM **author** tab and log in. It must be sitting on a real author page
   (the page editor is fine) — not `about:blank`, or the Sling Referrer Filter
   rejects every POST with a misleading 403.
2. Open devtools → Console, paste the whole of `aem-page-copy.js`, press Enter.
3. Then:

```js
// 1. see what it would do — reads only, writes nothing
await AEMCopy.plan('/content/samsung/levant/tvs/40-inch-tvs',
                   '/content/samsung/lb/tvs/40-inch-tvs');

// 2. walk the full execution path with every write stubbed out
await AEMCopy.dryRun('/content/samsung/levant/tvs/40-inch-tvs',
                     '/content/samsung/lb/tvs/40-inch-tvs');

// 3. do it
await AEMCopy.run('/content/samsung/levant/tvs/40-inch-tvs',
                  '/content/samsung/lb/tvs/40-inch-tvs');
```

## Rules

| Path segment | What happens |
|---|---|
| The requested (leaf) page | Full content copy. `shallow=true` — **child pages are not copied** |
| Intermediate already in the destination | Skipped, left completely untouched |
| Intermediate missing, present in the source | Created with the **source page's template and title**. Shell only — no content |
| Intermediate missing, absent from the source | Created with `CONFIG.MARKETING_TEMPLATE` |
| Destination leaf already exists | **Abort.** Nothing is written |

"Present in the source" is decided by right-aligning the two paths segment by
segment from the leaf backwards. The matching suffix gives each intermediate its
source counterpart; anything above that suffix is a newly-inserted segment. Every
counterpart is then confirmed with a live read, so the repository has the final
say, not the name match.

```
src  /content/samsung/levant/              home-appliances/buying-guide/microwaves
dst  /content/samsung/levant/india/backup/ home-appliances/buying-guide/microwaves
                            └─ inserted ─┘ └──────────── aligned ────────────────┘
                              page-marketing      source templates
```

## Config

```js
AEMCopy.config.MARKETING_TEMPLATE  // '/conf/consumer/settings/wcm/templates/page-marketing'
AEMCopy.config.ROOT_DEPTH          // 3 — /content/<brand>/<locale> must already exist
AEMCopy.config.DRY_RUN             // true makes plain run() simulate
AEMCopy.config.VERIFY_SHALLOW      // assert no child pages came across
AEMCopy.config.CHECK_TEMPLATE_AVAILABILITY
```

## Safety behaviour

- **Nothing is ever deleted.** If a run stops part-way, the pages it already
  created are left in place and listed so you can remove them yourself.
- **Every write is verified.** AEM auto-renames on collision and still returns
  HTTP 200, so the returned path is compared against the intended path and the
  run aborts on any mismatch rather than building on a wrong path.
- **Aborts before writing** if: the destination leaf exists; the destination
  leaf name differs from the source leaf name (AEM's copy cannot rename); a
  site-root segment above `ROOT_DEPTH` is missing; or anything on the path is
  unreadable (403), since "forbidden" and "absent" must not be conflated.
- **Retries once.** A failed create is re-read first — so a half-succeeded
  command is never duplicated — then retried, falling back to the marketing
  template if the source template was the problem.

## Things to know before running it

1. **MSM live copies.** If the destination sits inside a live copy, a plain copy
   has no `cq:LiveRelationship`, so the next rollout renames it aside and the
   page disappears from that path. The script detects this and **aborts**; pass
   `{ force: true }` to override once you've decided it's fine.
2. **`shallow` defaults to false.** Omitting it deep-copies the whole subtree —
   the opposite of what's wanted. It is always sent explicitly, and the result
   is verified by counting child pages at the destination afterwards.
3. **The copy inherits the source's replication properties.** A page that has
   never been published will show as *Published* in the Sites console, with the
   source's date. The script warns when this happens. It is not live.
4. **Template policy is only advisory.** Whether `cq:allowedTemplates` and a
   template's `allowedPaths` are enforced by `PageManager.create` — as opposed to
   only filtering the template picker in the UI — could not be confirmed for 6.5.
   The script therefore downgrades to the marketing template **only** on positive
   evidence of a block, reports when it couldn't verify, and otherwise lets AEM
   decide. Worth settling with one throwaway page in a scratch path first.
5. **Internal links are not rewritten.** Links inside the copied page still point
   at the original targets.
6. **A narrow race remains.** The "destination is free" check and the copy are two
   requests; another author writing to the same branch in between cannot be
   caught by the pre-check. The post-write path comparison is what catches it.

## Scope

AEM 6.5 on-premise/AMS, author instance, one page per run. Not AEM as a Cloud
Service — `/bin/wcmcommand` behaves differently there.
