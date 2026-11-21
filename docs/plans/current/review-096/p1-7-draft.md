# P1-7 draft: privacy copy after files-first (for the user to decide)

Status: **draft only**. Nothing in `apps/web/src/features/legal/privacy-disclaimer.ts`
has changed. Pick or edit the wording below, then the fix lands together with
its test (bottom of this file).

## What is wrong today

Since 0.9.5, notes and other workspace items are files in the workspace folder,
and those files sync to the user's own GitHub repository. The server keeps only
the items a user shares and the sync relay. The shipped copy says otherwise:

| Line | Constant | Problem |
| --- | --- | --- |
| 11 | `PRIVACY_DISCLAIMER_SUMMARY[0]` | "Your papers, notes, and files are stored on the server". They are not; they are files in the workspace. |
| 17 | `PRIVACY_DISCLAIMER_PARAGRAPHS[0]` | "Content is stored on the server with encryption at rest". The same claim. |
| 41 | `PRIVACY_LOCAL_PARAGRAPHS[0]` | "in a database on this computer". They are files in a folder. |
| 44 | `PRIVACY_LOCAL_PARAGRAPHS[3]` | Leaves GitHub out of the list of things that leave the machine. |

GitHub is not mentioned anywhere, even though it is now where a user's whole
workspace goes when sync is on.

## Proposed wording

### Line 11 (summary, first bullet)

> Your papers, notes and files are files in your workspace folder. If you connect
> GitHub, they sync to a GitHub repository you own, under GitHub's privacy
> policy. This server holds only the items you share and the sync relay. Whoever
> operates this instance can technically read those shared items.

### Line 17 (full text, first paragraph)

> WeaveForge keeps your papers, notes, experiments, logbook and settings as files
> in your workspace folder. If you turn on GitHub sync, those files are pushed to
> the GitHub repository you chose, and GitHub's privacy policy applies to them
> there. The WeaveForge server stores only the items you share with others and
> the relay that carries sync between your devices, encrypted at rest (the
> database and object storage's managed disk encryption). That data is readable
> by the server, so an operator with database access can technically read it.
> Paper PDFs are not stored by WeaveForge; Zotero and ZotMoov remain responsible
> for linked attachments.

### Line 41 (local mode, first paragraph)

> This copy has no account and no server. Your papers, notes, experiments,
> logbook, settings and files are files in your workspace folder on this
> computer, and nothing in the app sends them anywhere unless you turn on one of
> the things below. There is no operator who can read them, because there is
> nobody on the other end.

### Line 44 (local mode, what leaves the machine)

> Three things leave the machine when you ask them to: GitHub sync, which pushes
> your workspace files to the GitHub repository you chose; an AI provider you
> configure yourself; and an integration you connect (Zotero, GitLab and the
> rest). All are off until you turn them on, and each is then subject to that
> provider's own privacy policy. Signing in switches this copy to an account and
> a server, at which point the full privacy notice applies. Your workspace folder
> is left where it is.

## Decisions for you

1. **Scope.** The four lines above are the minimum. Paragraphs 18, 19 and 23
   still describe row-level security, queryable metadata columns and server
   image storage for *all* content. That is now true only for shared items.
   Rewrite those three too (recommended, since they make the same wrong claim
   more quietly), or ship the minimum now and do them in 1.0.0?
2. **"Encrypted at rest" for shared items.** Keep it only if the OCI volumes
   really are encrypted. The old copy claimed it; it was not re-checked for this
   draft.
3. **Line 42 backup text.** "the folder the app writes to can be backed up" is
   still true, but GitHub sync is now the backup. Add "or turn on GitHub sync"?

## Test that lands with the fix

New `apps/web/src/features/legal/test/privacy-disclaimer.test.ts`. It fails on
today's copy and passes on any wording above.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import * as legal from "../privacy-disclaimer";

const all = Object.values(legal)
  .flatMap(v => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []))
  .join("\n");

test("privacy copy does not claim user files are stored on the server", () => {
  assert.doesNotMatch(all, /papers, notes, and files are stored on the server/i);
});

test("privacy copy names GitHub as a place workspace files go", () => {
  assert.match(all, /GitHub/);
});
```
