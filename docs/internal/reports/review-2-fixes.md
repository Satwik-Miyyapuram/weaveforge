# Review-2 remediation log

What was changed on branch `fix/review-2-findings` in response to
[code-and-design-review-2.md](code-and-design-review-2.md), why, and how each
change was verified.

This file is the record of work, not a second copy of the review. The review
states what was wrong; this states what was done about it, and — where it
matters more — what was checked and found **not** to be wrong.

## Method

Every finding was re-read in the code before being changed. A finding that did
not reproduce was left alone and is recorded as such; a proposed fix that looked
wrong was replaced with a better one and the difference is noted. Findings that
could not be settled without a live system are marked unverified rather than
claimed.

## Status

Legend: **Fixed** · **Refuted** (checked, not a defect) · **Partial** ·
**Deferred** (with reason) · **New** (found while fixing).

| Area | Findings |
| --- | --- |
| **Database, RLS, data integrity** | A1 Fixed · A2 Fixed · A3 Fixed · A4 Fixed · A5 Fixed · A6 Fixed · A7 Fixed · **New: `revoke … from public` does not revoke `anon`** Fixed — a wider hole than A1, found while verifying it |
| **Android TWA** | E1 Fixed · E2 Fixed · E3 Fixed · E4 Fixed (residual documented) · E5 Fixed · E6 Fixed as far as is reasonable · E7 three of four fixed, `checkReleaseBuilds` **Deferred** (see §2) |
| **Desktop** | D1 Fixed · D2 Fixed · D3 Fixed · D4 Fixed · D5 Fixed (one claim unverifiable here) · D6 Fixed · D7 Fixed · D8 Fixed, **design corrected** — the finding's premise was wrong · D9 Fixed · D10 Fixed · D11 Fixed |
| **Web API** | B1 Fixed · B2 Fixed · B3 **Partial** (cap and caching yes; rate limiting deliberately not) · B4 Fixed · B5–B12 Fixed · B13 Fixed |
| **Web frontend** | C1 Fixed · C2 Fixed · C3 Fixed · C4 Fixed · C5 Fixed · C6 Fixed · C7 Fixed · C8 Fixed · C9 Fixed · C10 Fixed · C11 Fixed · C12 Fixed · C13 Fixed · C14 Fixed · C15 Fixed |
| **Core & Python SDK** | F1 Fixed · F2 Fixed · F3 Fixed · F4 **Partial** (core half done; real adapters need app-side wiring) · F5 Fixed · F6 Fixed, including the tree generic the core pass left open · F7 Fixed · F8 Fixed · F9 Fixed (limitation documented) · F10 Fixed · F11 **Deferred** (design written down) |
| **Tooling & CI** | G1 Fixed (and two bugs in the fix itself) · G2 **Partial** (PyPI publisher pinned to a verified SHA; six `actions/*` refs remain major tags) · G3 Fixed · G4 Fixed · G5 Fixed · G6 Fixed · G7 Fixed · G8 Fixed · G9 Fixed · G10 Fixed · G11 Fixed |

Refuted rather than fixed: **`androix.browser.trusted.*`** is the key the library
actually reads, not a typo; **"every UPDATE policy needs `WITH CHECK`"** is not a
security invariant; **D8's** premise — that the server can stop reading an upload
and still deliver its answer — is impossible. All three are in §9 with the
reasoning.

Defects found that the review did not report, all fixed: the `anon` grant hole
(§1); the D8 regression, and the fact that the 413 test had been validated on a
harness incapable of seeing it (§3); the `fetch-url` 401→500 and the `A4` test
that had never executed (§4); the live note-body wipe, the empty-body workspace
index, and the orphaned-files paper delete (§5); and two bugs in the G1 fix
itself — `--files-from`, which ripgrep does not have, and a comment terminator
hidden inside a glob literal (§7).

---

## 1. Database, RLS and data integrity

### A1 — `sync_prepare()` executable by clients · Fixed

`supabase/migrations/0118_sync_change_feed.sql` defines `sync_prepare()` as
`security definer` with a body of `alter table` / `create index` /
`create trigger` / full-table `update` over every table in `sync_tables`. No
migration ever revoked its `EXECUTE` grant: `0081`, the migration whose whole job
was removing that grant from internal definer functions, was written from a
hand-maintained list that predates `0118`.

Fixed in `supabase/migrations/0123_function_execute_grants.sql`, which also drops
the dead `get_public_keys()` (A6) — one file for one subject, since both are
function-level EXECUTE grants. The function
keeps working for the deployer — migrations run as the object owner, and the
owner retains `EXECUTE` regardless — so `0120`'s call and a future
`sync_tables` insert are unaffected.

**Verified.** Against the real migrations on an in-process Postgres:

```
PROBE sync_prepare: acl={postgres=X/postgres,service_role=X/postgres}
      public=false anon=false auth=false svc=true
```

### A2 — `blob_objects` path not bound to its owner · Fixed

`unique (bucket, path)` is global, while the write policies bound only
`user_id = auth.uid()`. The path is not opaque data: it is the key
`storage.objects` is addressed by, and the layout is `{ownerId}/{resourceId}/…`.
So any tenant could insert a row claiming another tenant's future key space and
permanently block that tenant's own registry insert.

Fixed in `supabase/migrations/0124_blob_objects_path_owner.sql`.

### A3 — metric points writable into another user's experiment · Fixed

Both metric stores bound an insert to the *row's* `user_id` and nothing else,
while SELECT on the same tables is widened by
`shared_to_me('experiment', experiment_id)`. A collaborator could therefore
append fabricated points to an owner's curve, and the owner's charts would show
them as their own results.

Fixed in `supabase/migrations/0126_experiment_metric_write_ownership.sql`,
covering both the row store and the chunk archive, including the write path that
travels through the compatibility view's `INSTEAD OF` trigger.

### A4 — re-running `0114` reverts `0115` · Fixed

`0114`'s conversion guard closes before its view and trigger section, so a
re-run reinstalls the row-only view and the pre-chunk triggers, making archived
points invisible. Fixed directly in the migration so a re-run is genuinely
idempotent.

### A5 — `updated_at` declared but never maintained · Fixed

Five tables declare the column and no trigger maintains it, so the value is
whatever the client last sent. Fixed in
`supabase/migrations/0128_updated_at_triggers.sql`, which attaches the existing
`set_updated_at()` function.

### A6 — `get_public_keys()` outlived the table it reads · Fixed

`0037` created it; `0099` dropped the whole client-E2EE schema including
`user_keys`, and left the function behind. `0081` revoked the *default* PUBLIC
grant, which is why the leftover looked handled — the direct grant to
`authenticated` from `0037` survives a `revoke … from public`. Calling it raises
`relation "user_keys" does not exist`.

Fixed by `drop function if exists public.get_public_keys(uuid[])` in
`supabase/migrations/0123_function_execute_grants.sql`. Callers were checked
across the whole repository first — only `0037` (the definition), `0079`/`0081`
(the grant hardenings) and the migrations README mention it, and nothing in
`apps/`, `packages/`, `python/` or `scripts/` calls it.

### A7 — no index on `experiment_metric_chunks.user_id` · Fixed

`0114` gave the row store an index for exactly this purpose and `0115` did not
give the archive table the same one, so every policy evaluation against the
large half of the series is a sequential scan. Fixed in
`supabase/migrations/0127_experiment_metric_chunks_user_idx.sql`.

### New — `revoke … from public` does not revoke `anon` · Fixed

**Found while verifying A1, and broader than A1.** Supabase grants `EXECUTE` on
new functions to `anon`, `authenticated` and `service_role` through
`alter default privileges`. `REVOKE ALL … FROM PUBLIC` removes only the `PUBLIC`
pseudo-role entry, so every migration in this repository that hardened a
function with that idiom — `0079`, `0081`, `0114`, `0116`, `0117` — left the
explicit `anon` grant in place.

Proved directly rather than inferred, against the real bootstrap:

```
zz_probe_default anon:  as-created                = true
                        after revoke-from-public  = true    ← the idiom, doing nothing
                        after revoke-from-anon    = false
```

PostgREST exposes every function in `public` at `POST /rest/v1/rpc/<name>` and
`anon` holds the anon key, so "anon-executable" means "callable by anyone who has
loaded the site". Seven `security definer` functions were reachable.
`resolve_share_link()` is deliberately public — `0081` says so by name, because a
share link is opened by someone with no account, and `check_share_link_rate`
bounds it. The other six were not:

| Function | Introduced | What anon could do |
| --- | --- | --- |
| `ensure_user_provisioned()` | `0117` | Nothing — `auth.uid()` is null, so it raises. A write path whose only guard is an exception it happens to raise. |
| `ensure_auth_user_row()` | `0117` | Nothing on Supabase (a no-op stub), but it writes `auth.users` on self-hosted Postgres. |
| `experiment_metric_name_id(text)` | `0114` | Insert arbitrary strings into the shared `experiment_metric_names` dictionary. |
| `purge_ai_mcp_relay_requests()` | `0116` | Force a sweep of *every* user's dead relay envelopes at will — it is definer precisely so one user's poll can sweep another's. |
| `record_blob_access(text, text)` | `0125` | Nothing — `user_id = auth.uid()` matches no rows for anon. |
| `record_blob_access_many(text, text[])` | `0125` | Nothing, same predicate. |

Fixed in `supabase/migrations/0130_revoke_anon_from_internal_definers.sql`.

**The last two rows are the interesting ones, and they are why the fix was
measured rather than read.** `record_blob_access` looked identical to
`purge_ai_mcp_relay_requests` in the migration text — same
`revoke … from public`, same grant to `authenticated` — yet one was already
closed and the other open, because `0125` happened to name `anon` as well. The
catalogs said so; the migration text did not. `0130` therefore carries only the
four functions that were still open and records why it does not repeat `0125`'s
two.

### The durable fix — a schema-invariant test · Added

Revoking six functions fixes today. The reason the bug survived four migrations
is that nothing asserted the *privilege* — only that the right-looking statement
was present, which it was, and which was not the same thing.

Added `apps/web/src/backend/test/schema-invariants.rls.integration.ts`, which
asserts against `pg_class`/`pg_proc` on the real migrations:

1. Every table in `public` has RLS enabled, with a documented allowlist for the
   seven device-only tables from `supabase/migrations-local` (one machine, one
   user, no second tenant to isolate).
2. Every RLS-enabled table has at least one policy — RLS-on-but-policyless
   denies everything, which is a silently broken feature rather than a leak.
3. Every `security definer` function pins `search_path`.
4. **No `security definer` function is anon-executable outside a documented
   allowlist.** This is the one that would have caught all six.

Both allowlists fail when they stop being needed, so they cannot rot — the same
trick `check-hygiene.mjs` uses for `OVERSIZED_ALLOWED`. Each query asserts a
minimum row count first, because a query that returns nothing would otherwise
satisfy "everything is fine" without inspecting anything; `verify-migration.mjs`
makes the same point about its probe users.

**Negative-controlled.** With the four revokes in `0130` commented out, the test
fails and names exactly those four functions — and does *not* name the two
`0125` covers, which is how the redundancy above was discovered.

`apps/web/scripts/run-integration-tests.mjs` now also walks `src/backend`, so a
schema-wide assertion can live beside the test database it uses instead of being
filed inside whichever feature sorted first.

**One correction to the review's own proposed invariants.** The review suggested
asserting "every INSERT/UPDATE policy declares a `WITH CHECK`". That is not a
security invariant: PostgreSQL reuses the `USING` expression as the check when
`WITH CHECK` is omitted, so such a policy is not a hole. Asserting it would fail
on correct policies and teach the next reader to add a redundant clause to
satisfy a test. The test asserts the INSERT case (where the clause is mandatory
anyway) and leaves UPDATE/ALL alone, with the reasoning recorded in the file.

---

## 2. Android TWA and release CI

### E1 — the entire Android source tree was gitignored · Fixed

`git ls-files apps/web/twa` returned two files — the README and the manifest —
while the release workflow claimed to build "from the committed Bubblewrap
project". The ignore rule excluded `app/` rather than `app/build/`, so the
manifest, the three Java classes, every resource, both Gradle files and the
wrapper existed only on one machine. Bubblewrap's `update` deletes `app/` and
`build.gradle` before regenerating, so any hand edit was destroyed on the next
release.

Fixed in `.gitignore`: only output is ignored now (`app/build/`, `build/`,
`.gradle/`, `*.apk`, `*.apk.idsig`, `*.aab`, `manifest-checksum.txt`,
`store_icon.png`), plus the keystore. 39 source files became addable.

Two further defects fell out of doing this:

- **`*.aab` had no ignore rule at all.** `app-release-bundle.aab` — the one
  artifact the Play path exists to produce — was the only build output that
  could have been committed by accident.
- **`gradlew` needs its executable bit recorded.** This checkout has
  `core.filemode=false`, so a newly added `gradlew` lands as mode `100644`.
  Bubblewrap invokes it as `./gradlew` on Linux, where that is
  `Permission denied`. The fix is `git update-index --chmod=+x`, not a `chmod`
  bolted into CI, and the consistency step now asserts the bit name-checks the
  exact command (skipped on Windows, where the bit is meaningless).
- **The line endings had nothing pinning them.** Added a `.gitattributes`
  covering exactly the two files whose bytes another platform executes —
  `gradlew text eol=lf` and `gradlew.bat text eol=crlf` — plus the wrapper jar as
  `binary`, since Bubblewrap requires it byte-identical to its template. It
  deliberately does *not* start with `* text=auto`: a repo-wide renormalisation
  would rewrite every blob in the tree and bury the next real change under a
  whole-repository diff.

**Verified independently** of the delegate's report: `git check-ignore` confirms
the manifest, both Gradle files and `gradlew` are no longer ignored, while
`android-keystore.jks`, `manifest-checksum.txt`, `app-release-signed.apk` and
`app/build/**` still are. 40 paths under `apps/web/twa` are now stageable.

### E2 — the assetlinks gate checked half the link · Fixed

The gate grepped for the fingerprint and never compared `package_name`, so an
app-id mismatch passed while the TWA shipped unverified — the exact failure the
step exists to prevent. It now parses the file and asserts the package (read out
of `app/build.gradle`, not hardcoded), the fingerprint within that package's
entry, and the `handle_all_urls` relation, with distinct errors for a missing
file, invalid JSON, an empty array, a wrong package, a missing fingerprint and a
wrong relation.

**Verified** by extracting the embedded script verbatim and running one positive
and five negative cases; all five negatives exit non-zero with the intended
message.

### E3 — tracked manifest and Gradle drifted · Fixed

Three fields disagreed: `themeColor` (`#F6F4EF` vs `#000000`),
`enableNotifications` (`true` vs `false`) and `orientation` (`any` vs
`default`). Every other field was compared and already agreed. The drift was
being masked because `bubblewrap update` regenerated the project on every CI
run; with the project now committed, a consistency step asserts the two sources
agree and fails on seeded drift.

### E4 — the Play path invalidates the committed fingerprint · Fixed, residual noted

Play re-signs the AAB, so the upload certificate's fingerprint alone cannot
verify the installed app. `assetlinks.json` now carries a second, obviously
placeholder entry (`REPLACE_WITH_PLAY_APP_SIGNING_CERT_SHA256` — not valid hex,
so it cannot be mistaken for or pass as a real fingerprint), CI warns while it is
present, and the README gives the exact route to the real value (Play Console →
Release → Setup → App integrity → App signing key certificate). The README also
notes that `keytool -printcert -jarfile` reads the *upload* signature, not the
app-signing one — a trap the previous instructions walked into.

**Residual:** a placeholder statement is deployed. Per statement-matching rules
it should be inert, but that was not testable from here; deleting the second
entry is a one-line reversal if zero risk is preferred.

### E5 — unpinned CLI regenerating the committed project · Fixed

`npm install -g @bubblewrap/cli` had no version, and `update` rebuilt the
Android project from the CLI's bundled template — so `compileSdk`, `targetSdk`,
the Android Gradle Plugin version and the wrapper came from whatever CLI was
current. Pinned to `@bubblewrap/cli@1.24.1`, evidenced rather than guessed: the
committed project's `targetSdkVersion 35` (1.25.0's template moved to 36),
`compileSdkVersion 36`, AGP `8.9.1`, Gradle `8.11.1`, a byte-identical wrapper
properties file and a wrapper jar matching the template's size.

The build no longer runs `update`. It writes the checksum Bubblewrap itself
would compute — which is what answers the "regenerate?" prompt that has no stdin
— and builds the committed tree. The consistency step now provides the guarantee
`update` used to provide for free. A no-op `--skipPwaValidation` flag was removed
rather than kept, since it implied a validation had been disabled.

### E6 — tag builds not reproducible · Fixed as far as is reasonable

The manifest points `iconUrl`, `maskableIconUrl` and `webManifestUrl` at the live
site, and Bubblewrap fetches them at build time. A pre-build step now asserts the
icons are PNG, square and at least 512×512, that the web manifest parses and
still advertises both basenames the manifest names, and records each asset's
SHA-256 in the job summary so two builds of one tag can be compared. Run against
the live site from here: `icon-512.png` 512×512, `maskable-512.png` 512×512, all
assertions passing.

The residual is documented rather than papered over: the committed mipmaps were
produced by that download, so the APK is not byte-reproducible and an icon change
on the deployed site does not reach the APK until someone regenerates and
commits.

### G2 — mutable action ref on the PyPI publisher · Fixed in part

`pypa/gh-action-pypi-publish@release/v1` is now pinned to a verified commit SHA
with the version in a trailing comment. The SHA was confirmed against the GitHub
API as both the tip of `release/v1` and the target of annotated tag `v1.14.2`.
Least-privilege `permissions:` blocks were added where missing, and the two
existing ones were kept and commented as the minimum each job needs.

**Not done:** the six first-party `actions/*` refs remain major tags
(`actions/checkout@v4` and friends). Each needs its own verified SHA, which was
outside the scope of this pass. No SHA was invented.

### E7 — the remaining low-priority Android items

Three of the four were fixed here; the fourth is deferred deliberately.

- **`allowBackup` is now `false`.** A TWA owns no user data — the session, cache
  and storage all live in Chrome's profile, which this app can neither back up nor
  should try to. The attribute is not derived from `twa-manifest.json` and the
  consistency check does not compare it, so a note in the manifest records that
  Bubblewrap's template would turn it back on and why it is off.
- **`.explorer-start-note` is visible on a touch screen.** It was revealed by
  `:hover` and `:focus-within`, and a finger does neither until it has already
  tapped, so on touch the control was present, tappable and invisible. A
  `@media (hover: none)` override now shows it permanently, which is what the
  sibling control in `lists.css` already did.
- **`.header-overflow-btn` uses `var(--touch-min)`** rather than a literal 40px,
  so the one control that opens the entire account menu is no longer the smallest
  target in the bar on a phone.

**Deferred:** `lintOptions { checkReleaseBuilds false }` still disables lint on
release builds. Turning it on is a one-word change, but it can fail the build on
any lint error and there is no way to run a Gradle build in this environment to
find out — a fix that might break the release pipeline and cannot be verified is
worse than the gap it closes. The manifest-vs-Gradle drift class it would have
caught is now covered by the consistency step added for E3, so the specific risk
the finding named is handled another way. Worth revisiting from a machine with the
Android SDK.

---

## 3. Desktop (Windows / Electron)

### D1 — unsigned build installed updates silently · Fixed

The build is not code-signed, and that weakness was already documented in
`auto-update.ts` rather than hidden — but the code did the opposite of what the
documentation implied was safe: `autoDownload` *and* `autoInstallOnAppQuit` were
both true, so a downloaded update installed itself on quit with no user action.
The only integrity check is a SHA-512 served from the same GitHub release, so
silent code execution sat one TLS or account compromise away on every installed
machine.

`autoInstallOnAppQuit` is now `false`. The background download and the
check-for-updates schedule are unchanged; what changed is that installing costs a
click, which is the only thing bounding an unsigned build. The SECURITY comment
now states the weaker-but-honest guarantee instead of describing the old one.

The dialog was injected (`ask`) so the consent logic is testable at all — seven
tests cover yes-installs, later-does-not-and-is-not-remembered, a throwing
prompt, and the disabled path.

### D2 — no IPC sender validation · Fixed, and the review's suggested fix was wrong

All 25 `ipcMain` registrations took `_event` and discarded the sender, so the
only thing confining a bridge that includes raw SQL (`dbQuery`), vault
read/write, secret writes and `localApiSet` was the navigation guard.

A shared `registerGuardedIpc(allowedOrigin, ipc)` wrapper now validates
`event.senderFrame.url` before every handler runs.

**The review's suggested implementation would have broken the packaged app, and
the agent caught it.** The review said to compare `origin === APP_ORIGIN`. In
Node, `new URL("app://weaveforge/x").origin` is the string `"null"`, because
`app://` is a non-special scheme — while the renderer's frame reports
`app://weaveforge`, since `main.ts` registers the scheme as `standard`. A literal
origin comparison would therefore have refused **every legitimate call** in the
shipped desktop app. The comparison is now on protocol/hostname/effective port,
and `main.ts`'s existing `will-navigate` guard uses the same helper, so there is
one answer to "is this the app" rather than two that disagree.

Two more details the review did not anticipate: `handle` refusals become the
caller's rejection, but `on` refusals must log and skip — throwing inside an
event listener is an unhandled error in the main process.

### D3 — loopback API advertised `null` origin · Fixed

`access-control-allow-origin: "null"` *permits* opaque-origin readers, which is
the opposite of what the comment above it claimed. Removed entirely: the clients
are local processes, which do not consult CORS.

### D4 — a failed open leaked the database engine · Fixed

`local-db-host.ts` used `this.opening` as both the lock and the only reference to
a successfully opened PGlite instance. If a migration threw after `open()`
succeeded, the catch cleared the reference without closing, so the next query
opened a *second* engine on the same data directory. The client is now closed
before the field is cleared, and a close racing a failed open cannot throw on the
way out.

### D5 — `tectonic` could never return a PDF · Fixed, one claim unverified

`argsFor` passed `--print`, sending the PDF to stdout, while the result was read
from a `.pdf` file tectonic never wrote — so `ok` was always false on a
tectonic-only machine, and the promisified `execFile` UTF-8-decoded binary stdout
into the log. On machines that also have `latexmk` this was invisible, because
`latexmk` is probed first.

`--print` is gone. **Unverified:** tectonic is not installed here and web search
was unavailable in this session, so the fix is confirmed by code reasoning and an
argument-vector test, not by a real compile. Also left alone deliberately: a
pre-existing stem bug where `entry.replace(/\.tex$/i, "")` yields `main.ltx.pdf`
for an `.ltx` entry — it affects `latexmk` and `pdflatex` identically, so it is
not a regression, but it is a real bug.

### D6 — quit could hang · Fixed

`will-quit` called `event.preventDefault()` and only reached `app.exit(0)` in a
`.finally()`, so a hanging database close left an invisible process holding the
single-instance lock and later launches silently quit. Now a bounded
`runBoundedQuit({cleanup, exit})` with a 3 s fallback, armed before cleanup
starts and cancelled on the normal path, with `exit` guaranteed to fire once.

### D7 — unserialised read-modify-write on the stores · Fixed

Both stores did read-modify-write with no serialisation, and the temp filename
varied only by pid — constant within one process — so concurrent writes could
clobber each other's draft. A per-store promise chain now serialises the cycle
(a failed write does not poison it), and the temp name is
`pid.counter.randomhex.tmp`. Tests cover three concurrent writes all landing and
no draft left behind.

### D8 — oversized upload drain · Not fixed as proposed; disagreed with measurements

The review asked for the server to stop reading and end the connection promptly
once a body is refused. The agent implemented exactly that and **measured it
breaking the 413**, precisely as the old comment in the file warned. On raw TCP
against Node 24:

| Approach | Bytes the client receives |
| --- | --- |
| Answer, then `req.destroy()` on `res.once("finish")` | **0** |
| Answer, then destroy after 50 ms / 250 ms | **0** |
| Pause the request instead of destroying it | **0** |
| Read and drop to the end (the existing behaviour) | `HTTP/1.1 413 Payload Too Large` |

The reset does not race the reply — it erases it, by wiping the client's receive
buffer. So "stop reading promptly" and "the caller is told 413" are mutually
exclusive, and the review's premise was wrong.

What shipped in the end: the drain is kept but **bounded by time**
(`MAX_REFUSAL_DRAIN_MS = 30_000`), the buffer is released the moment the body is
refused, and the 413 is written from the `end` handler. The measurements are
recorded in the file so nobody re-attempts the impossible version.

**A regression in this fix, caught by running the suite instead of trusting the
report.** The first version also moved the 413 write from `end` up into the
refusal handler, on the reasoning that the caller should be told as soon as there
is something to tell them. That breaks the same case for the same reason:
answering while the request body is still arriving makes Node destroy the socket
once the reply flushes, because it cannot reuse a connection carrying unread
request bytes, and the reset wipes the reply out of the client's receive buffer.
The visible symptom was the *existing* test failing:

```
actual:   'threw: read ECONNRESET'
expected: 413
```

The delegate had reported that test as still passing and covering the 413; it
had not been able to execute it (sandbox `EPERM`) and had validated on an
ephemeral-port harness that sent the whole body at once — where the refusal and
the end of the request coincide, so the early write makes no observable
difference. The repository's own test sends the second half of a 9 MiB body
100 ms after the first, precisely so the refusal lands mid-upload, which is the
only arrangement that distinguishes the two.

The 413 write was moved back to `end`. Desktop suite: **189 passing, 0 failing**
(147 pre-existing, 42 new). Recorded here because "verified on a harness I wrote"
and "verified by the suite that ships" are not the same claim, and the difference
was a real regression.

**CI note:** `local-api-server.test.ts` binds hardcoded port 27123 and calls
`t.skip` when it is busy, so on a machine running the installed app it passes
without asserting anything. Worth making port-parameterised — it is now the only
test standing behind the refusal path.

### D9 — wildcard CORS and redirect-following upstream fetch · Fixed

`access-control-allow-origin: *` removed from every response (the renderer
fetches `app://models/...` same-origin, where CORS is not consulted). Redirects
are now walked by hand with `redirect: "manual"` and a three-hop cap, refusing
any hop that leaves the upstream host — seven tests, including one asserting the
second host is never contacted.

### D10 — no byte cap on vault read/write · Fixed

`MAX_VAULT_BYTES` (8 MiB) with the read refusing on `stat` *before* reading —
the read is what costs the heap — and the write measuring the encoded length
before touching disk.

### D11 — the desktop suite gates nothing · Fixed

No workflow ran `npm run test:desktop`; `check:all` includes it but CI does not
run `check:all`. **147 tests across 6 suites pass in ~14 s** and now run on every
PR. See §7.

---

## 4. Web API

### B1 — an `mcp_relay` token authenticated every SDK route · Fixed

`resolve_api_token` filtered on expiry and never on `scopes`, while `0072`'s own
header states "Relay-only tokens cannot authenticate SDK routes" and its own
relay resolver does filter. MCP tokens are minted with `expires_at: null` and
handed to third-party MCP software, so that same token unlocked
`GET /api/settings/credentials` (the user's decrypted provider keys),
`/api/sdk/artifacts` and `/api/sdk/experiments`.

Fixed in **both** halves deliberately: `0129` adds `and 'sdk' = any(scopes)` to
the RPC, and `requireSdkUser`/`requireMcpRelayUser` read the scopes before any
JWT is minted. A `create or replace` swaps a function's whole body, so a future
edit dropping the predicate would re-open the seam silently — and the symptom is
"it just works, for the wrong caller", with no failing test.

### B2 — unbounded blob upload · Fixed, and the gate order was wrong

`await request.formData()` had no content-length check and no byte cap, and the
R2 store then did `new Uint8Array(await blob.arrayBuffer())` — the body buffered
twice, at a size the client chose. Fixed by mirroring the sibling artifact route:
a declared-length refusal before the parse, and a `file.size` re-check after it
for a chunked upload that declares nothing.

**The route also contradicted its own comment.** It documented
`provider → size → auth → parse` while the code authenticated first. The order now
matches the documentation, with the parse still last so an unauthenticated caller
cannot make the server buffer a body at all. That moved one existing test's
expectation from `400` to `401` — the test now asserts the property that actually
matters (an absent length is not treated as an oversized claim, proved by the
absence of a 413) rather than the code being bent to the old assertion.

### B3 — no rate limiting, open arxiv relay · Partial, deliberately

`id_list` is capped (4000 chars, 400 over) and the response is cacheable, so
per-request cost is bounded and repeats are discouraged.

Rate limiting itself was **not** built, and the reason is worth keeping: the
bucket key needs a caller identity, and on an unauthenticated route the only
candidate is `x-forwarded-for`, which the caller writes. The repository has no
trusted-proxy configuration anywhere. A limiter keyed on a header the caller
chooses is one the caller turns off — and reaching the RPC would also make an
unauthenticated route depend on the service-role key, so on a deployment without
one the limiter would have to fail open. The route header records the honest
state: a per-caller limit remains open and needs a trusted client identity plus a
fail-open/closed decision, in one place all outbound routes share.

### B4 — raw PostgREST text returned to clients · Fixed

`format-error.ts` now has two formatters, kept apart on purpose. `formatError` is
unchanged and stays the *display* formatter used by ~150 UI call sites, where
"permission denied for table user_settings" is correct to show its owner. New
`formatErrorForResponse` is the *wire* formatter: it logs server-side and returns
a safe message plus the SQLSTATE. Non-database errors pass through unchanged, so a
validation error and "Server is missing `SUPABASE_JWT_SECRET`" stay legible — the
SDK debuggability the finding asked to protect.

Two corrections to the finding itself:

- The `message — details — hint (code)` join is not where the leak was. That path
  is only reached by an error with no `message`; routes returned `error.message`,
  which for a PostgREST failure already *is* the raw Postgres text. The fix is the
  message, not the join.
- The missing-migration hint is kept, with the table name removed. It is the one
  case where generic wording is useless to the only person who can act, and every
  route reaching it has already required a bearer token.

A bug in the first attempt was caught before it landed: a digits-only SQLSTATE
regex rejected `XX000`, `P0001`, `HV000` and `0A000` — real database errors would
have passed through unsanitised, which is exactly the leak being fixed.

### B5–B12 · Fixed

- **B5** — `mcp/relay` and `mcp/relay/browser` check the declared length before
  `json()`, and validate `sessionId`/`id` as UUIDs. Order is auth → size → parse.
- **B6** — `pdf-proxy` gave the body stream a deadline, with the timer stopped on
  every exit path so none can outlive its response. Two mechanisms, because both
  are needed: aborting the controller tears the connection down, and racing the
  read is the only thing that interrupts a read already awaiting a body that never
  arrives.
- **B7** — `signed-urls` was ~600 PostgREST round trips at the 200-path cap plus a
  lost-update read-modify-write on `access_count`. Now one `in`-query read and one
  batched update, with the counter incremented in the database (`0125`).
- **B8** — org creation and joining were multi-table writes with no transaction,
  so a mid-flow failure left a member with no role or a lab with no owner. Both are
  now single `security definer` RPCs (`0125`), and `upsertMembership` was deleted
  rather than left unused, so there is exactly one way to write a membership.
  Domain logic (`resolveOrgJoinAssignment`) stays in TypeScript, with its tests.
- **B9** — a typed `BlobAccessError` carries its own status, so a malformed path is
  a 400 rather than a 500. The message-prefix checks stay as a fallback for plain
  `Error`s other layers throw, so nothing regresses to 500.
- **B10** — consolidated on `requireSdkUser`; the three bespoke auth variants are
  gone. This *is* a behaviour change, and it corrects the mismapping the finding
  described: a missing Supabase config used to answer `401 Not authenticated.` on
  the blob and fetch routes, telling an operator to sign in again for what is a
  deployment fault.
- **B11** — `use_count = use_count + 1` inside the function under the row lock,
  never a value computed from a read.
- **B12** — `resolveCaller` is wrapped, so an auth-service outage is a 503 rather
  than an unhandled 500, and a duplicate address is a 409. **Caveat:** the
  provisioner discards the provider's error `code`, so a duplicate can only be
  recognised by message match. Documented as the wrong long-term answer; the right
  fix is a typed error in `apps/web/src/backend/providers/supabase/admin-provisioner.ts`,
  which nobody owned in this pass.

### B13 — the route-test gate skipped routes · Fixed under G6

`check-api-route-tests.mjs` walked only `apps/web/src/app/api`, so
`app/.well-known/appspecific/com.chrome.devtools.json/route.ts` was never
counted. It now walks all of `apps/web/src/app` (35 handlers, was 34) and the
`.well-known` route is an explicit, commented allowlist entry rather than a
silently skipped directory.

### Two bugs found by running the API work

**A 401 became a 500, caught by the suite and not by review.** Consolidating
`fetch-url` onto `requireSdkUser` (B10) meant an unusable credential on a
deployment with no Supabase URL was answered `500` — building the client throws
before the token is examined — so "your credential is bad" was reported as "our
server is broken". `requireSdkUser` now rejects a credential that is neither an
API token nor JWT-shaped as a 401 *before* constructing a client. That cannot
reject a legitimate token: a Supabase access token is always a three-segment JWT,
and `tt_` tokens are handled by the branch above.

**A test that had never executed successfully.** The `A4` integration test
resolved the migrations directory with six `..` where seven were needed, so it
looked for `apps/supabase/migrations/...` and died with `ENOENT`. Fixed, and it
now replays `0114` statement by statement and asserts the chunk-aware view
survives.

---

## 5. Web frontend

### C1, C2 — the UI → facade boundary · Fixed

The dead `savePdfText` import in the reader is gone. The settings panels no longer
build bearer headers and call `fetch` themselves: `apiTokens` and `mcpTokens` live
on the settings facade, with the same verbs, bodies and user-visible messages.
`isLocalMode`/`setLocalMode` and the relay/BYOK calls go through the auth and
ai-assistant facades. Behaviour unchanged, and `check:solid` confirms zero
cross-feature `ui/` imports remain.

### C3–C14 · Fixed

- **C3** — object URLs created after cancellation are now revoked rather than
  stored. The existing tests resolved instantly, which is why the race was
  invisible; the new one uses a deferred fetcher, and it was confirmed to fail
  against the pre-fix code.
- **C4** — a shared `route-error.tsx` plus 11 per-segment boundaries (dashboard,
  papers, notes, lists, experiments, report, plan, settings, log, reader, graph).
  The copy is platform-neutral, the Android hint appears only on Android, a
  non-destructive "Reload this page" sits beside the destructive reset, and the
  reset is demoted to a labelled secondary card with a confirmation.
  `client-runtime-recovery.ts` itself was not touched.
- **C5** — 44 files / 52 async-failure sites converted to `FormError`, which is
  the component that exists to add `role="alert"`. The remaining raw `<p>`s are
  static copy and compile-diagnostic lists, deliberately.
- **C6** — `MultiSelect` has a real keyboard model (Enter/Space/arrows open;
  arrows/Home/End rove; Space/Enter toggle and keep the menu open; Escape closes
  and restores focus; Tab closes) and correct multi-select listbox ARIA. Props API
  unchanged, all 9 usages unaffected. Deliberately *not* rebuilt on `Popover`:
  that would restyle nine sites and turn a filter into a dialog.
- **C7** — hardcoded hex replaced with theme tokens, including the ~2.4:1 contrast
  case on the Amoled theme. Several latent bare-`var()` fallbacks were fixed in
  the same files, including an `--error` token that **no theme defines**.
  Deliberately left: the white PDF page, the collaborator-coloured caret tag, the
  rainbow heading palette, pitch alpha masks and the GitHub brand mark.
- **C8** — the experiments screen applies the `hasLiveRunning` guard it already
  computed, and the tooltip now states the real ~2-minute freshness window.
- **C9** — the page transition keys on the pathname, so its comment is true.
  Safe to remount: it wraps the route element inside `AppShell`, which Next
  already swaps on navigation, and the providers live above it.
- **C10** — the trigger is a `combobox` with `aria-controls`; the unsupported
  `aria-activedescendant`-on-a-button is gone.
- **C11** — the primary nav landmark is named and the menu toggle exposes its
  state.
- **C12** — the loading tips are `aria-hidden`, so the rotation is no longer a
  live-region mutation while the tips stay visible.
- **C13** — the pitch palette preview snapshots and restores the real preferences
  on unmount, the same way that file already handled the motion flag.
- **C14** — one `useNavGroups` hook replaces three render-time registry rebuilds.

### C15 — `pitch.module.css` · Fixed

1407 lines split into 7 named modules (palette, header, ground, outro, acts,
paper, compare), each imported by its own section. Verified mechanically: the
media-aware rule multiset is identical before and after (222 rules, 0 lost, 0
added), no duplicate class definitions, every `css.*` reference resolves within
its own module, and no element spans two modules.

### F6's real cost was here, and it was a live data-loss bug

The core half of F6 retyped `listSummaries` to return summaries. The UI did not
merely need widening — `PageEditor` initialises its draft with
`useState(page.body)`, so handing it a summary started the draft at `undefined`
and the first save would have written an empty body over a real note. The guard
that prevented it was a screen-level `if (existing?.body)` check covering only the
*hydration* path, not the render path.

The editor now renders only when the selected entry is genuinely hydrated
(`isHydratedPage`, which tests for the property rather than its value, so an
intentionally empty note still opens, and an empty note is not re-fetched
forever).

Three further real bugs surfaced from the same type change:

- **The editor workspace indexed every note with an empty body.**
  `vault.flat` holds summaries, so `page.body` there was always `undefined` —
  the note search in the workspace had been silently matching titles only.
- **Deleting a paper from a card could orphan its files and its Zotero item.**
  The delete needs `metadata.zoteroKey` and the image list, and it was being
  reached from a card that may hold a projection. It now re-reads the full row
  before deleting: one read per deliberate delete, not per card.
- **`PapersTable`/`PaperCard`** were widened only where they genuinely read
  summary fields, and `confirmRemovePaper`/`PaperCardThumbs` `in`-guard
  `metadata` rather than trusting it.

One site deliberately went the other way: the Overleaf export was *not* widened
to summaries. It builds biblatex from `bibtex` and `venue`, neither of which is on
`PaperSummary`, so a summary read would silently emit `@article` with no journal
for every entry — the exact warning that module exists to prevent. It loads full
papers instead.

---

## 6. Core domain and the Python SDK

### F1 — W&B wall clock was stringified · Fixed

`wandb.py` passed `str(wall)` where `wall` is epoch seconds, so
`normalize_wall_time`'s numeric branch was never reached and the value arrived at
a `timestamptz` column as `"1699999999.123456"` — the exact failure its docstring
described as prevented. The raw value now passes through, and the defensive
numeric-string branch added to `normalize_wall_time` accepts only 9–10 digit
epoch values, deliberately excluding `YYYYMMDD` and `YYYYMMDDHHMMSS`, which are
legitimately timestamps in another format. The test now asserts the resulting
`wall_time` parses as a timestamp; the old test checked only step and value, which
is why this shipped.

### F2 — the pruner crashed on its own target case · Fixed

`Math.max(...storedSteps)` overflowed the call stack at ~125k arguments, and the
pruning script selects every step of an over-budget series — so the series large
enough to need pruning was the one that crashed. Replaced with a loop. The spread
audit went further and fixed three more unbounded user-data spreads in core
(`search-tokenizer.ts`, `markdown-to-latex.ts` ×2), where `text` can be a whole
pasted PDF or file. Four remaining spreads were judged bounded and left, and named
in the report rather than silently kept.

### F3 — a crash path replaced the caller's exception · Fixed

`except BaseException: run.flush(); run.set_status("failed"); raise` — if the
server was unreachable the flush raised, the status was never recorded, the run
stayed `running`, and the training exception was lost. Status is now recorded
first, each step wrapped so it cannot replace the caller's error, and the original
exception propagates.

### F4 — contract suites not run against real adapters · Partial, honestly

`listSummaries` is now covered by the paper and vault contract suites, including
the case where an adapter does not implement it at all (asserted, not silently
skipped), and a new test asserts every exported contract runner is actually
called somewhere. The API adapters' `NotImplementedError`s became a typed
`MetricHistoryUnavailable` with a `capabilities()` flag, so a caller can ask
*before* calling.

The remaining half cannot be done from core: no endpoint exists to implement
`history()`/`list()` against (`/api/sdk/metrics` is POST-only, and
`/api/sdk/experiments` GET requires an `id`). Rather than invent one, the failure
is typed and documented. Running the real Supabase adapters through the contracts
needs an app-side suite — `packages/core` must not import `apps/**` — and is
recorded as a follow-up.

### F5 — error taxonomy · Fixed

One root (`WeaveForgeError`) with four branches and a single
`httpStatusForError`. All 24 previously-exported classes now extend a branch, with
every class name and explicit `this.name` kept, so no existing import, `catch` or
`instanceof` changes meaning — verified by a 20-entry table.

Not-found now throws `NotFoundError` at the seven cited sites plus four more with
the identical bug. The two org routes that mapped the *same* `OrgValidationError`
to `400` and `403` now both delegate to `httpStatusForError`, and the `403 if
OrgValidationError` special case is deleted.

The app-side file that still threw the wrong types was fixed here (§4 covers the
status corrections): `org-invite-service.ts` now throws `OrgNotFoundError` for a
lab that does not exist and `OrgPermissionError` for "not a member" and
"only the owner", so not-found is a 404 and permission is a 403 rather than both
being 400. Three further sites were genuine server faults mis-reported as bad
input — a non-retryable RPC failure and two exhausted code-collision retries —
and now throw plain `Error`, which maps to 500.

### F6 — summary projections · Fixed in core, and the cascade closed

`VaultPageSummary` (with **no** `body` field at all, which is what makes a card
edit unwritable) and `PaperSummary`; `mergePinnedScreenData<TSummary, TFull extends
TSummary>` so the merged list is typed as the projection — that type parameter is
the actual closure of the hole, because `[...owned, ...extras]` can no longer be
read as `Paper[]`.

The core agent explicitly scoped out the tree generic and left it documented as a
follow-up. **It was finished instead**, because leaving it would have left F6
half-done: `VaultPageTreeNode<P>` and `buildPageTree<P>` are now generic, `getTree`
returns `VaultPageTreeNode<VaultPageSummary>[]`, and the adapter's summary rows
are honest. The in-memory double that built `{...p, body: ""}` — part of why the
bug looked fine in tests — now builds a real projection.

### F7–F11 · Fixed, with two deliberate deferrals

- **F7** — `flush()` swaps the buffer under a `threading.Lock` and does the I/O
  outside it, so two threads crossing the threshold cannot double-send, a point
  logged mid-send is not dropped, and a failed batch is put back at the front in
  order. A background sender was **rejected**: it would have to take over the
  retry and back-pressure semantics `flush()`/`track()` promise, changing the
  public contract. Instead the *automatic* flush is bounded (10 s) while an
  explicit flush keeps the client's 60 s, and the residual synchronous wait is
  documented rather than hidden. The concurrency test was proved meaningful by
  re-running it against a reconstructed old `flush`: 408 points sent for 400
  expected, 8 duplicates.
- **F8** — `__enter__`/`__exit__`, and `track()` closes the connection **only when
  it opened it**, so a caller holding an injected container is unaffected.
- **F9** — Keras 3's contract was read before implementing: `on_train_end` runs
  only after the epoch loop in all three backends, there is no exception hook on
  `Callback` at all, and a callback-only fix is therefore impossible. A `close(exc)`
  counterpart to Lightning's `on_exception` was added, and the limitation is
  stated in the module docstring rather than papered over.
- **F10** — `computeRollup` indexes values once per call instead of scanning per
  lookup, with a test asserting equality against a naive-scan reference
  implementation of the old algorithm.
- **F11** — **deferred, with the design written down**: `unit-of-work.ts` defines
  `IUnitOfWork` and lays out the four-stage problem. Nothing imports it. The
  reasoning for not landing "an in-memory implementation plus one migrated use
  case" is that `mergeConcepts` cannot be made atomic through any port that exists
  today, so it would demonstrate nothing while implying a guarantee the shipped
  adapters cannot give.

Also fixed: the stale `finish()` docstring, `finishedAt` now clears when a run
leaves a terminal status (and is stamped when one is created directly as
terminal), and the `mypy` dual-import error — which had been tolerated as
"environment-specific" — is now `# type: ignore[assignment]` with an explanation,
so `mypy` is clean on all 49 files.

---

## 7. Tooling and CI

### G1 — the gates failed open · Fixed, and the fix had two bugs of its own

`check:solid` and `check:dry` searched through `execSync("rg …")` and read exit 1
as "no matches" — but on Windows a missing `rg` is *also* exit 1, so a machine
without ripgrep reported a pass having checked nothing. Two rules went further and
swallowed every error with a bare `catch { return []; }`.

The search now lives in one module (`scripts/lib/search.mjs`): ripgrep when it is
installed, the identical rules in Node when it is not, over the same list taken
from `git ls-files`, with one `assertPortablePattern` on the shared path so the two
cannot disagree about a pattern. Every blanket catch is gone, and a gate that
cannot run now exits non-zero.

**Two bugs in that fix, both found by running the gates rather than trusting the
report:**

1. The ripgrep path passed `--files-from -`. **ripgrep has no such flag**, so
   `check:solid` died with `unrecognized flag --files-from` the first time it ran
   against a real binary. The delegate could not execute the accelerator path in
   its sandbox and had verified only the Node fallback — the half that worked.
   Paths are now passed positionally in batches sized so a command line cannot
   overflow.
2. `check-dry.mjs` died with `ReferenceError: ui is not defined`. The cause is
   worth stating because no syntax check can see it: a doc comment containing a
   glob like the ui-directory pattern contains the comment terminator **inside
   itself**, which ends the comment early and leaves the rest of the line as code.
   Valid syntax, runtime crash. The whole repository was scanned for the same
   shape; this was the only instance.

Both scanners were then run over the same 495 files and agree:
`passed (495 files, ripgrep)` and
`passed (495 files, Node (ripgrep could not be started (ENOENT)))` — the
accelerator path, the fallback path, and the agreement between them, all
demonstrated rather than asserted.

### G3 — dependency scanning, and the conflict it exposed · Fixed

`.github/dependabot.yml` covers all five npm manifests (root, `apps/web`,
`apps/desktop`, `apps/pitch`, `packages/core`), pip for `python/`, and
`github-actions`, weekly with grouped patch/minor updates so majors arrive alone.
No CodeQL or `npm audit` step: an audit step fails unrelated PRs on a vulnerable
transitive dependency with no fix available, which is how such a step gets
disabled rather than acted on. No `CODEOWNERS` either — branch protection sets
`require_code_owner_reviews: false`, there is one maintainer and no team, so it
would only create review requirements nobody can satisfy.

**This exposed a conflict that had to be fixed with it.** Dependabot cannot write
a `Signed-off-by:` trailer, and `dco` is a required check, so every dependency PR
would have been permanently blocked — and the usual way out of that is to stop
running the check. Both DCO scripts now exempt bot commits, matched on GitHub's own
convention (`<name>[bot]@users.noreply.github.com`) rather than a list of accounts
that could be widened by mistake, since a person cannot register an address
containing `[bot]`. Applied to `check-dco.sh` **and** `check-dco.mjs` in the same
change, because a rule fixed in one copy and not the other is exactly how the two
drift apart.

### G4–G11 · Fixed

- **G4** — the seven gates are separate CI steps with an aggregate that fails the
  job if any did not pass, so a failure names itself instead of hiding behind the
  first one. A first draft used `${{ steps.check:solid.outcome }}`, which is
  invalid — `name` is not `id`, and ids cannot contain colons — so it would have
  expanded to empty strings and failed **every** run. Caught before it landed.
- **G5** — satisfied by the existing `test:integration:web` step, which now also
  runs the schema invariants (§1). The delegate deleted its own interim duplicate
  script and CI step rather than leave two.
- **G6** — the route gate walks all of `apps/web/src/app`, requires the test to
  contain a real `test(`/`it(` **and** to import the route, and handles the
  `.well-known` route with an explicit commented allowlist. Proved it can fire by
  gutting a test and by removing one.
- **G7** — the length-cap rule now requires a comparison against a caps-named
  constant or a non-zero literal, with comments stripped first, so
  `if (toInsert.length > 0)` no longer satisfies it. Probed over 11 cases.
- **G8** — the dead DRY rule now has a three-entry allowlist asserted against each
  file's contents, so it can fire *and* the allowlist cannot rot into a hole.
- **G9** — the cross-feature rule's scope is explicit: `app/` and `components/`
  sit above the features and import their `ui/` entry points by design, so those
  imports are permitted rather than missed. Widening it would have failed on ~19
  legitimate imports.
- **G10** — a fetch failure with a token present now exits 1; without a token it
  still skips, so local runs do not fail. Also fixed a `process.exit(1)` that tore
  the process down while undici's abort timer was pending, tripping a libuv
  assertion on Windows (exit `0xC0000409`).
- **G11** — `scripts/check-dco.mjs` mirrors the shell rule exactly, including the
  `+`-literal and merge-commit semantics, and CI runs both so a divergence goes
  red instead of quietly changing which sign-offs count. Verified against real
  commits; no-args exits 2 by design, because a gate that cannot tell what to look
  at must not pass.

### D11 — the desktop suite gated nothing · Fixed

No workflow ran `npm run test:desktop`. **189 tests across 6 suites pass in ~10 s**
and now run on every PR, next to the web tests.

---

## 8. Verification

Every gate and suite, run on this branch at the final revision.

| Check | Result |
| --- | --- |
| `npm run typecheck` | **Pass** — all four workspaces, exit 0 |
| `npm run check:solid` | **Pass** — 496 files via ripgrep; 496 files via the Node fallback |
| `npm run check:dry` | **Pass** — 496 files |
| `npm run check:api-route-tests` | **Pass** — 35 route handlers (was 34) |
| `npm run check:ui` | **Pass** |
| `npm run check:hygiene` | **Pass** |
| `npm run check:mcp-plugin` | **Pass** |
| `npm run check:docs` | **Pass** — regenerated for the new scripts and line counts |
| `npm run test:core` | **1068 pass**, 0 fail (was 1043) |
| `npm run test:web` | **1020 pass**, 0 fail (was 974) |
| `npm run test:desktop` | **189 pass**, 0 fail (was 147, and gated nothing) |
| `npm run test:integration:web` | **20 pass**, 0 fail (was 2) — includes the schema invariants |
| `pytest` | **76 pass**, 3 skipped (was 58, 2) |
| `ruff` / `mypy` | **Pass** — mypy clean on 49 files (was 1 error) |

The new tests are not decoration, and two were **negative-controlled**: the schema
invariants and the DCO bot exemption were each run with the fix reverted, watched
failing and naming the right things, and the fix restored.

### One transient observation, recorded rather than smoothed over

The first run of the core suite reported `1066 pass / 2 fail` while the web,
desktop and integration suites were running concurrently on the same machine. It
was not reproduced: the next run and three consecutive solo runs afterwards all
reported `1068 pass / 0 fail`, and no failing test name was captured because the
output was filtered to the summary lines.

That is most likely resource contention — four Node test runners in parallel on a
laptop — but "most likely" is not "verified", and a suite that fails once in five
runs is worth knowing about. It is recorded here so the next person who sees it
does not start from scratch, and so nobody reads the green line above as proof
that it never happened.

## 9. Deliberately not changed, and things checked that were not defects

Stated so the next reader does not re-litigate them.

- **`androix.browser.trusted.*` is not a typo.** It is the key
  `android-browser-helper` actually reads. The earlier review was wrong and the
  code was right — worth recording because it is an easy "fix" to make.
- **"Every UPDATE policy needs `WITH CHECK`" is not asserted.** PostgreSQL reuses
  the `USING` expression as the check when `WITH CHECK` is omitted, so such a
  policy is not a hole. Asserting it would fail correct policies and teach the next
  reader to add a redundant clause to satisfy a test. The reasoning is in the test
  file; the INSERT case is asserted, where the clause is mandatory anyway.
- **D8 — "stop reading and answer promptly" is impossible.** The review's premise
  was wrong. It was implemented, measured, found to erase the reply with a reset,
  and reverted in favour of a time-bounded drain. See §3.
- **B3 rate limiting** — deliberately not built, with the reason in §4.
- **The pitch site's `marked` output is not sanitised, and that is correct today.**
  The input is Markdown committed to this repository, rendered at build time in a
  static export — not user input, never fetched at runtime. It becomes a
  vulnerability only if docs are ever accepted from outside contributors.
- **`android-v*` tag numbering.** The existing tags showed the convention is
  `appVersionCode` (`android-v4` at code 4; next is `v6`), not the app version.
  Three places said otherwise; all three were corrected rather than changing the
  workflow to match the prose.
- **Four spread sites in core were left alone** after auditing all nine, because
  they are bounded by field counts, query terms, or the SDK's 20 000-point buffer
  cap. Named in the report rather than silently kept.
- **`ensureProfile`'s "User not found." stays a `ValidationError`.** It is genuinely
  ambiguous — a deleted account, or a missing profile row — and guessing a status
  for it would be worse than leaving it. Recorded as the one remaining
  less-than-ideal mapping in that service.
- **The generated architecture map's migration count.** The generator counts
  *tracked* files; the new migrations were untracked when it last ran, so it reads
  122. It self-corrects once they are staged, which is why the final `check:docs`
  run happens after staging.

