# Security Policy

WeaveForge talks directly to your own Supabase project. The web app holds
Supabase credentials (a public anon key + your session), and the Python SDK uses
**personal access tokens** that act on your behalf under Row-Level Security.
Please treat credential handling and access-control (RLS) issues as
security-sensitive.

> **Note:** client-side E2EE has been dropped. Data is now stored server-side
> with encryption at rest, and **Postgres Row-Level Security is the sole access
> boundary**. This is not end-to-end / zero-knowledge — an operator with database
> access can technically read content. See the root [`SECURITY.md`](../SECURITY.md)
> "Data protection model" section.

## Reporting a vulnerability

**Do not open a public issue for security reports.**

- Preferred: use GitHub's **private vulnerability reporting** —
  the repo's **Security → Report a vulnerability** tab.
- Alternatively, email the maintainer at **satwik.miyyapuram+weaveforge@gmail.com** with
  `SECURITY` in the subject.

Please include: a description, steps to reproduce, affected component
(web app / Python SDK / migrations), and impact. We aim to acknowledge within
a few days and will coordinate a fix and disclosure timeline with you.

## Scope

In scope: authentication/session handling, Row-Level Security policies in the
`supabase/migrations/`, secret handling in the web app and Python SDK,
share-link redemption, API token hashing (`0061`), signed-URL / storage-bucket
policies, and share-link rate limits (`0049`, `0056`, `0058`).

Out of scope: issues in your own Supabase project configuration, and anything
requiring a compromised developer machine or leaked credentials that were not
mishandled by this codebase.

## Outbound fetches on a user's behalf

Three features ask a third-party site for something on behalf of the person
using WeaveForge: the paste rules that read a link's title and download an image
address, and `/api/url-meta`, which resolves a DOI or arXiv id. All three go
through one module — `apps/web/src/backend/net/safe-fetch.ts` — and the policy
it enforces lives in `@weaveforge/core`, which holds no I/O so the same rules
apply on the server, in the Electron main process and in a test.

What it does:

- Only `http` and `https`, only ordinary ports, and never a URL carrying
  credentials.
- The hostname is **resolved**, and every address it resolves to is checked
  against the private, loopback, link-local, and cloud-metadata ranges — for
  both IPv4 and IPv6, including the `::ffff:` mapped forms. The check is on
  addresses, not on names, so a hostname that points at `127.0.0.1` is refused.
- Redirects are followed manually, one hop at a time, with the same check
  repeated on each. A redirect is a second URL the visitor never showed you.
- Responses are capped (512 KB for a title, 12 MB for an image) and read
  incrementally, so a stream with no end is not a way to exhaust memory.
- **Both browser-facing routes require a token** — `/api/fetch-url` and
  `/api/url-meta`. An unauthenticated version of either is a scanning and
  bandwidth service for whoever finds it, however well guarded the destination
  is: the address guard decides *where* a request may go, and authentication
  decides *who* may send one. `/api/arxiv` is the deliberate exception, because
  its host is fixed and only the id list is the caller's. The Electron handlers
  are unauthenticated because they are already inside the session, running as
  the person at the keyboard.
- An image is served back with `Content-Security-Policy: default-src 'none';
  sandbox` and `X-Content-Type-Options: nosniff`, and its type is taken from
  what the server declared rather than sniffed from the bytes. SVG is refused
  outright — it is a script carrier.

**Known residual risk.** There is a window between the check and the connect: a
name can resolve to a public address when it is checked and to a private one
when the request is made (DNS rebinding). Closing it needs a custom agent that
dials the address already validated. The window is small, every hop is
re-checked, and every response is capped, which together make this a much poorer
target than an unguarded fetch — but it is not zero, and it is the next thing to
do here.

Users can turn both paste lookups off in Settings → Paste; with them off, no
paste rule contacts anything outside the workspace.

## Text from the library reaching a model

A workspace exists to hold other people's papers and notes. Every one of them is
text somebody else wrote, and any of it may contain a line addressed to a model
rather than to a reader. Two places have to account for that.

**Inbound — context we build.** `run-ai-query` and the concept extractor are the
only two places that paste indexed content into a prompt, and both go through
`packages/core/src/features/ai-assistant/domain/untrusted-context.ts`. Excerpts
are wrapped in a fence carrying a random nonce the text cannot predict, the
system turn states that the fenced material is data and that instructions found
inside it are to be reported rather than followed, and the text itself is
neutralised first: the nonce, anything shaped like a turn marker, and invisible
characters (zero-width, bidi overrides, control codes) are removed.

**Outbound — results we return.** WeaveForge's own MCP tools hand library
content to a third-party agent that may hold shell and write tools of its own,
so the same treatment is applied on the way out by `mcpReadResult`: notice,
fence, and an honest, counted truncation. Every read tool declares
`resultsAreUntrusted` in the tool manifest, which makes shipping raw content a
contradiction of the manifest rather than an omission nobody notices.

**What is actually guaranteed.** Fencing and neutralising are mitigation, not
proof — no prompt-level defence is. The guarantee is structural: no executor is
reachable from a tool call, every call is re-checked by `AiAccessPolicy` which
fails closed on all seven checks, and a proposal changes nothing until a person
accepts it. Text that talks a model into asking for a write still only produces
a proposal somebody has to read.

## Good practice for users

- The **anon key** is public by design — RLS is the security boundary. Never
  commit the **service_role** key, API tokens, or your account password. `.env*`
  files are git-ignored.
- **Access control:** RLS is the boundary. A row is readable only by its owner
  or someone it is explicitly shared with. External share links grant scoped
  read access to whoever redeems them at `/link` — treat link URLs like passwords.
- **Integration secrets** (Zotero / GitLab / Semantic Scholar keys) are encrypted
  with a server-held key, not exposed to the AI/MCP layer.
- **API tokens** (`tt_…`) are shown once at creation; revoke unused tokens in
  Settings. Tokens grant the same RLS scope as your user account.
- Scope experiments to a project and keep buckets private (the migrations set
  them private by default).
- Hosted Supabase leaked-password protection is available only on plans that
  support it. The project currently used for development is below that tier;
  enable the setting after upgrading, or configure equivalent protection when
  self-hosting Auth.

## Self-host operators

Content is stored server-side with the database's encryption at rest; there is
no client-side encryption to audit. Access is enforced entirely by RLS — when
self-hosting, verify every entity table's policies resolve to owner-or-shared
before exposing the instance, and keep storage buckets private (the migrations
set them private by default).

> History: earlier releases shipped client-side E2EE (migrations `0037`–`0041`,
> key/recovery tables `0089`–`0095`). It was dropped in favour of the at-rest +
> RLS model. No code reads those tables any more, and no migration drops them,
> so they are still in the schema of every deployment that ran those migrations.
> They are empty of anything the app depends on; dropping them is a schema
> cleanup nobody has needed enough to write.
