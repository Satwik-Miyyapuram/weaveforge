# AI and MCP Research Assistant Plan

**Status:** MCP implementation is complete. Follow-up encryption UX now uses
remembered browser-device secrets plus a user-held recovery code. CI/PR remain
release tasks; in-app answer UI remains deliberately deferred.
**Owner:** WeaveForge  
**Last updated:** 2026-07-15

## 0. Implementation status snapshot

The MCP implementation is complete on branch `mcp/ai-research-assistant`.
It includes the model-agnostic core contracts, fail-closed access policy,
opt-in Settings surface, encrypted browser relay, bounded local retrieval,
Codex plugin, encrypted proposal/audit storage, review UI, and browser-local
approval executors. The plugin exposes live reads plus draft-only proposal
tools. No MCP tool can directly mutate WeaveForge or Zotero data.

Sessions are browser-local and end on lock, sign-out, revocation, or expiry.
The dedicated relay token is revocable and persists independently, so a new
browser approval does not require creating another token. The remaining live
test work is listed explicitly in section 19.5.

### Key delivery commits

| Commit | Delivered |
|---|---|
| `f0a0cf6` | AI resource, capability, grant, source-link, and model-neutral conversation contracts; central access policy |
| `21ca943` | Default-off AI access settings, category/proposal switches, persistence migration, and Settings UI |
| `84147c6` | Grounded read-only query use-case with authorized source excerpts |
| `efa623d` | Pending/confirmed append-only paper-note proposal flow |
| `9874074` | Codex-first, provider-neutral model adapter router |
| `073c5f3` | Internal transport-neutral AI tool registry |
| `0ac7f46` | Renumbered AI settings migration to `0068` after resolving the existing `0056` collision |
| `1226f74` | Removed third-party credential proxy routes |
| `3b6ee34` | Encrypted AI proposal review UI and audit records |
| `2ca4878` | Browser-local proposal executors after user approval |
| `3827e69` | Routed every live MCP write tool through encrypted proposals |

The repository now also contains the `weaveforge-research` Codex plugin.
It supplies researcher-facing safety guidance, a validated marketplace entry,
and a dependency-free MCP client exposing the approved live tool surface.

The branch also contains responsive Git, report-outline, and reading-list UI
fixes made while validating the surrounding product. Dummy test accounts were
used only as user-provided testing context and are not stored in the repository.

### Current verification

- TypeScript typecheck passes.
- Core test suite passes with 317 tests.
- Web test suite passes with 95 tests.
- Overleaf parser benchmark passes at approximately 1.1 ms per parse for a
  250-file graph and approximately 16 ms for a 19 MB source snapshot.
- SOLID and DRY boundary checks pass.
- Plugin MCP tool-list handshake passes.
- Authenticated live-relay and sign-out tests remain dependent on configured
  E2E accounts and remote CI. Overleaf browser privacy tests are now present in
  `apps/web/e2e/overleaf-isolation.spec.ts` and are similarly environment-gated.

### Product direction now in force

- **AI surface:** Codex is the only initial AI interface. There will be no
  in-app chat, model SDK, browser provider key, or application model proxy.
  A remote MCP service is the product integration boundary; the Codex plugin is
  its installation and safety-guidance layer.
- **Disclosure posture:** no model receives research content before the user
  authorises a paired, unlocked browser session. The service receives only
  selected, locally retrieved excerpts and tool results; raw chat transcripts
  are not persisted by default.
- **Persistence/RLS design:** any saved workspace, source selection, proposal,
  or audit payload will be encrypted in a `content_enc` envelope under the
  project/user key. Server-visible rows are limited to IDs, owner/project IDs,
  encryption epoch, timestamps, and ciphertext. RLS is owner/project scoped,
  enabled on every exposed table, and uses `TO authenticated` plus
  `(select auth.uid())` ownership predicates for select/insert/update/delete.
  No AI table will expose decrypted content, keys, or reusable capabilities.
- **Zotero credentials:** reusable provider credentials are stored in a
  client-side encrypted envelope bound to the owning user. Legacy plaintext
  fields are migrated and cleared after the next unlocked Settings read. AI
  Zotero imports are encrypted proposals and reach Zotero only after user
  approval in the unlocked browser.

## 1. Purpose

Build a source-grounded research assistant for WeaveForge. It helps a researcher work with the papers, Zotero annotations, and notes they explicitly choose, then turns its output into reviewable additions to the workspace.

The initial experience is a Codex plugin backed by a remote Model Context
Protocol (MCP) service. Codex provides the conversational interface; Thesis
Tracker provides narrowly authorised tools and user-confirmed proposals. The
same service can later support other compatible clients, but Codex is the first
target.

This feature must preserve the product's existing end-to-end encryption (E2EE) model: ciphertext is stored by the backend, while decryption happens only in an unlocked client.

## 2. Product statement

> WeaveForge's assistant works from the research material a user chooses to share. It is source-grounded, clearly identifies its sources, and never silently overwrites the user's work.

The assistant is not an autonomous agent with broad account access. It is a user-controlled research workspace.

## 3. Goals and non-goals

### Goals

- Let a user create an AI workspace containing an explicit selection of papers, paper notes, Zotero annotations/notes, reading lists, vault notes, experiments, milestones, and logbook entries.
- Answer questions using only the active workspace's selected sources and cite the corresponding WeaveForge/Zotero source.
- Retrieve source excerpts locally before sending the minimum relevant context to a configured model provider.
- Let the assistant propose structured actions that the user reviews before saving.
- Support append-only AI additions to paper notes. Existing paper-note text must never be replaced or deleted by the assistant.
- Support reviewed additions of papers to WeaveForge and Zotero collections.
- Establish the internal tool contracts and permission model that a future MCP adapter can safely expose.

### Non-goals for v1

- Report-section reading or writing. The report module is excluded until its writing experience exists.
- Storage, retrieval, or processing of PDFs in WeaveForge. PDFs are not stored by the product and may be moved/linked by ZotMoov.
- Editing Zotero highlights, existing annotations, existing Zotero notes, or PDFs.
- Whole-vault or whole-project access by default.
- Autonomous, background, scheduled, or silent writes.
- Deletes, moves, merges, permission changes, sharing changes, or account/security changes.
- Supplying database credentials, encryption keys, integration credentials, or raw database access to a model or MCP server.

## 3.1 Architectural rules: SOLID, DRY, and separation of concerns

This feature follows the repository's existing modular architecture. It is a vertical feature slice, not a collection of chat UI components that directly query storage or call provider SDKs.

### Separation of concerns

| Layer | Responsibilities | Must not do |
|---|---|---|
| Domain (`packages/core`) | Workspace/grant/proposal value objects, invariants, repository ports, approval rules | Import React, Supabase, OpenAI, MCP, or browser APIs |
| Application (`packages/core` and web feature application) | Create/revoke workspace, validate a source grant, validate/approve a proposal, compose use-cases | Decrypt directly, issue SQL, render UI, or call provider SDKs |
| Infrastructure (`apps/web`) | Encrypted persistence adapters, browser retrieval index, model-provider adapter, Zotero annotation adapter, future MCP transport | Decide business permissions independently of the domain policy |
| UI (`apps/web`) | Settings controls, source selection, chat display, citation links, proposal review | Query repositories, hold provider secrets, or commit writes directly |
| Composition root (`bootstrap.ts`) | Construct concrete adapters and inject them into feature facades | Contain business rules or UI state |

UI code calls only the `aiAssistant` facade. The facade delegates to use-cases; use-cases depend on ports. This preserves the existing `UI -> application -> domain -> interfaces <- infrastructure` dependency direction.

### SOLID rules

- **Single responsibility:** keep permission evaluation, source extraction, local retrieval, provider communication, proposal validation, approval, Zotero synchronization, and UI presentation as separate units.
- **Open/closed:** add a source type or model provider by implementing a registered adapter/port, rather than branching through the chat screen or editing every tool handler.
- **Liskov substitution:** in-memory workspace/proposal repositories and fake provider clients must satisfy the same contract tests as encrypted production adapters.
- **Interface segregation:** use narrow ports such as `IWorkspaceRepository`, `ISourceResolver`, `ILocalRetriever`, `IModelConversation`, `IProposalRepository`, `IZoteroAnnotationSource`, and `IAiSessionTransport`; do not create a catch-all `IAiService`.
- **Dependency inversion:** core use-cases depend on those ports, never concrete Supabase, OpenAI, MCP, IndexedDB, or Zotero clients. Concrete clients are wired only in the composition root.

### DRY rules

- There is exactly one `AiAccessPolicy` evaluator for Settings permissions, workspace source grants, lock state, expiry, and tool allow-lists. Every in-app tool and future MCP tool uses it.
- There is exactly one source-provenance model and citation renderer. Do not create separate citation formats for chat answers, note addenda, and Zotero imports.
- There is exactly one proposal lifecycle (`draft -> reviewed -> approved/rejected -> committed/conflicted`) and one review component family. Each proposal kind supplies its schema and preview data.
- Append-only paper-note logic lives in one `AppendPaperNoteUseCase`; neither the chat UI nor an MCP adapter may concatenate note text independently.
- Encryption/decryption continues through the existing encrypted repositories/entity encryptor. The assistant must not create a parallel cryptography or database-access path.
- Provider-specific request/response mapping stays behind `IModelConversation`; application prompts and tool schemas remain provider-neutral.

## 4. Existing constraints

### E2EE

WeaveForge encrypts the content of papers, vault pages, reading lists, log entries, experiments, and other entities. The server persists ciphertext and has no keyring capable of reading user content. The unlocked browser holds the in-memory keyring and already decrypts content through encrypted repository adapters.

Consequences:

1. A backend MCP service cannot safely query useful plaintext from Supabase/Postgres.
2. A model provider receives any content deliberately sent in a prompt; E2EE at rest does not protect that disclosure.
3. The browser must be the policy enforcement point for decryption, retrieval, and writes.
4. If the application is locked or the user session ends, access to E2EE content must end.

### Zotero and ZotMoov

Zotero is the authority for bibliographic items, user notes, and annotations. ZotMoov moves or links attachment files; WeaveForge does not ingest those PDFs. The assistant may use Zotero metadata, notes, and annotations only when those are synced or explicitly retrieved through a user-authorized Zotero integration.

The assistant must never read attachment paths, linked-file paths, or PDF bytes. It must not edit existing highlights or annotations. It may propose a new Zotero item for a user-selected collection after review.

### Credentials

Reusable third-party credentials such as the Zotero, GitLab, and Semantic
Scholar keys are stored in a client-side encrypted envelope bound to the
user's keyring. Legacy plaintext fields are migrated and cleared on the next
unlocked Settings read. Provider calls are made directly from the browser
where supported; credentials are never sent to the AI/MCP layer or included in
MCP relay payloads. The privacy disclaimer describes this boundary explicitly.

### Device and recovery unlock

- New accounts use a random browser-device secret for their encryption KEK; no
  Google ID, email address, or login password is used as encryption material.
- A remembered device can unlock after a normal sign-in without another
  encryption prompt. Cross-device encrypted transfer still requires the
  pending device-approval phase below.
- During first setup, users enable email recovery. The browser wraps the user
  master key under a fresh random link secret and sends that secret only in a
  one-time email recovery link. The server stores only the encrypted wrapper.
  An optional recovery passphrase and one-time recovery code remain available
  as fallbacks.
- Existing passphrase/login-password records remain supported for migration and
  are not silently changed. Legacy users can continue using the app while
  recovery setup is incomplete, with a persistent warning and a Settings action.
- Email recovery is the user-approved recovery authority. The email link is
  not used directly as cryptographic key material; it carries a random secret
  that unwraps the encrypted UMK only in the browser.

The browser/device recovery implementation is complete. Device secrets and
device IDs are kept in a dedicated browser store that normal sign-out does not
clear. Each browser has its own Argon2id-derived wrap in
`user_device_key_wraps`; revoking one device therefore does not invalidate the
others. A new browser generates a temporary X25519 keypair, creates a
short-lived transfer request, and stores only the private half locally. An
already-unlocked browser approves by sealing the UMK to the requester's public
key. The recipient opens it locally, creates its own device wrap, and then
unlocks normally on later sign-ins. Unconfirmed email accounts must complete
the existing one-time magic-link verification before requesting transfer.
Email is now the primary recovery path. Settings can rotate the email recovery
link and can also create or change the optional recovery passphrase.

### Pending device approval phase — complete

- [x] Create a short-lived encrypted device-transfer request.
- [x] Let a remembered device approve it and seal the user master key to the
  new device's public key.
- [x] Store only the opaque transfer envelope and metadata on the server.
- [x] Expire, reject, and revoke pending transfer requests through owner-scoped
  RLS updates; the browser rejects expired requests before opening them.
- [x] Enroll each recipient in an independent device-key wrap and preserve
  existing device wraps.
- [x] Add focused core coverage for independent-wrap revocation and sealed-box
  transfer completion.

## 5. Security architecture

### Principle

The model and MCP layer receive capability-limited results, not storage access.

```text
Model provider or external MCP client
        |
        | asks a narrow tool to search/read/propose
        v
MCP gateway / application orchestration (no decryption keys)
        |
        | routes a request for an active, paired session
        v
Unlocked WeaveForge browser
  - enforces the workspace source grant
  - decrypts allowed content locally
  - performs local retrieval
  - returns minimum excerpts
  - previews and commits approved writes through encrypted repositories
```

The model provider does receive the selected excerpts and the user's prompt. It does not receive an encryption key, raw database credentials, session cookies, or unrestricted resource IDs.

### Codex plugin and remote MCP service

The Codex plugin provides the installation surface, safe researcher workflow,
and default prompts. The remote MCP service must use a paired, unlocked
browser/device session:

```text
Codex/ChatGPT -> authenticated MCP gateway -> paired unlocked browser -> encrypted repositories
```

If no paired, unlocked session exists, tools must fail closed with: `Open WeaveForge and unlock encryption to access this workspace.` The gateway never falls back to direct database reads.

## 6. Consent and permissions

### Settings is the sole standing opt-in

Add **Settings → AI & MCP Access**. All switches are off by default. Enabling AI/MCP access requires explicit acceptance of a disclosure that selected plaintext may be sent to the chosen AI provider.

Settings grant category-level eligibility. They do not automatically share every item in the category.

#### Read categories

- Paper metadata, abstracts, summaries, tags, and relations.
- Paper notes.
- Zotero notes and annotations.
- Reading lists and citation graph.
- Vault notes.
- Logbook entries.
- Experiments and milestones.

#### Proposal categories

- Append additions to paper notes.
- Create vault notes.
- Create logbook entries.
- Propose paper metadata/tags/relations.
- Propose reading-list changes.
- Propose milestones and experiment follow-ups.
- Propose Zotero imports.

There is no setting for report access in v1. There is no setting that permits destructive writes.

### Workspace source grant

Each chat belongs to an AI workspace. A user selects the actual resources to include, for example: eight papers, two paper notes, one reading list, and fourteen Zotero annotations. The workspace stores resource identifiers and permissions, never decrypted source content.

An active session grant is short-lived and contains:

```ts
type AiSessionGrant = {
  id: string;
  workspaceId: string;
  expiresAt: string;
  readable: Array<{ resourceType: ResourceType; resourceId: string }>;
  allowedTools: readonly AiToolName[];
  proposalCapabilities: readonly AiProposalKind[];
  requiresConfirmationForWrites: true;
};
```

The browser checks both the Settings category switch and the workspace grant before each read or proposal. Removing a source, disabling a category, locking encryption, signing out, revoking the workspace, or expiring the grant immediately denies new access.

### Active-access UI

The Settings screen must show active workspaces/sessions, their source counts, enabled capabilities, and expiry. It must provide **Revoke now** and **Disable all AI/MCP access** actions. Disabling all access revokes every active grant.

## 7. Access matrix

| Resource | Read | Write/propose | Hard limits |
|---|---|---|---|
| Papers | Selected metadata, abstract, summary, tags, relations, bibliographic data | Tags, summary, metadata, relation proposals | No PDF bytes or file paths; no unselected papers |
| Paper notes | Selected complete note | Append an AI addendum at bottom only | No replacement, deletion, or edits above the append boundary |
| Zotero annotations/notes | Selected synced annotation text, comments, and notes | None in v1 | No highlight/PDF/note edits; no attachment paths |
| Reading lists | Selected lists, items, and item notes | Propose memberships/new list | Confirmation required; no silent removal |
| Citation graph | Selected graph relations | Propose relation | Must include evidence/source links |
| Vault notes | Selected notes | Create note or propose an append if enabled | No overwrite or delete in v1 |
| Logbook | Selected entries | Create a new entry | No modifying/deleting prior entries in v1 |
| Experiments/milestones | Selected metadata, metrics, result notes, plans | Propose follow-up/updates | Confirmation required |
| Zotero library | Explicit search/import result only | Propose new items to chosen collection | User selects collection; no deletion or edit |
| Report | No access | No access | Deferred |

Never accessible: encryption keys, wrapped keys, passwords, API keys, OAuth/session tokens, Supabase/Postgres credentials, raw database rows, settings, sharing controls, audit logs, other users' unselected content, attachment/PDF paths, billing/deployment information, and deleted data.

## 8. Paper notes: append-only contract

Paper-note preservation is a hard invariant. The assistant cannot issue a generic `updatePaperNote` command. It may only create an append proposal against a known note revision.

```ts
type AppendPaperNoteProposal = {
  kind: "append_paper_note";
  paperId: string;
  expectedNoteRevision: string;
  markdown: string;
  sourceLinks: SourceLink[];
  generatedAt: string;
  modelLabel: string;
};
```

On approval, the browser verifies the revision and appends a clearly labelled immutable block:

```markdown
---

## AI addendum — 2026-07-14

<approved content>

Sources: [Paper A], [Zotero annotation: ABCD], [Vault note: Method ideas]
```

If the note changed since the proposal was made, show a conflict and require regeneration or user review. Do not attempt automatic merging. The user can edit the proposed text before approving it.

## 9. Zotero annotations and notes

### Sync model

Add a dedicated, opt-in Zotero annotation/note sync path. It retrieves only the annotation and note child items associated with papers the user selects or subscribes to. Store normalized annotation text and provenance in the encrypted paper-note/annotation feature data, not as plaintext server content.

Each normalized record should preserve:

- Zotero item key and parent-paper key.
- Annotation type and colour where available.
- Annotation comment and selected text.
- Page or location metadata where available.
- A stable deep link or Zotero reference.
- Source/update timestamps.

The source UI must say whether a claim came from paper metadata, a user paper note, a Zotero annotation, or a Zotero note.

### Write model

v1 permits only **new Zotero bibliographic items** after explicit review. It does not modify annotations, highlights, existing Zotero notes, or attachment files. A future version may create a separate Zotero child note, but only after a separate design and consent review.

## 10. Retrieval and grounding

### Retrieval strategy

1. The user submits a question within an active workspace.
2. The browser decrypts only the selected workspace resources.
3. The browser builds/searches a local index and selects relevant snippets.
4. The client sends the question, instructions, and selected snippets to the model provider.
5. The response contains source references using stable local source IDs.
6. The UI renders source chips that open the original WeaveForge entity or Zotero reference.

Do not upload an entire project or vault to a provider-hosted vector store in v1. A local browser index (IndexedDB) is the preferred privacy-preserving baseline. A later cloud-index option requires a separate explicit consent path because embeddings and chunks are external disclosures.

### Grounding rules

- State uncertainty when the selected sources do not support a claim.
- Never fabricate source citations.
- Distinguish source facts from model suggestions.
- Link each substantive answer section to at least one source where applicable.
- Do not assert that the model read a PDF when it used only metadata/annotations/notes.

## 11. Internal tool contracts

Tools are capability-scoped and return data only from the browser-authorized grant. Tool input and output schemas use stable resource IDs, never database access expressions.

### Read tools

```ts
search_workspace({ query, limit }): SourceSearchResult[]
get_source_excerpt({ sourceId, passageId }): SourceExcerpt
get_workspace_outline(): WorkspaceOutline
```

### Proposal tools

```ts
propose_append_paper_note({ paperId, markdown, sourceLinks }): AppendPaperNoteProposal
propose_create_vault_note({ title, markdown, sourceLinks }): CreateVaultNoteProposal
propose_create_log_entry({ entryDate, body, sourceLinks }): CreateLogEntryProposal
propose_paper_update({ paperId, patch, sourceLinks }): PaperUpdateProposal
propose_reading_list_change({ change, sourceLinks }): ReadingListProposal
propose_relation({ fromPaperId, toPaperId, relationType, rationale, sourceLinks }): RelationProposal
propose_zotero_import({ items, targetCollection }): ZoteroImportProposal
```

No tool performs a mutation directly. A separate browser-only approval/commit flow validates the proposal, shows the diff/preview, checks the latest entity revision, and uses existing encrypted feature facades to save.

## 12. UI plan

### Settings → AI & MCP Access

- Master switch, off by default.
- Provider/connection status and clear disclosure.
- Category-level read switches and proposal switches.
- Active workspace/session panel with revoke actions.
- Link to an audit/history view of approved actions.
- `Disable all AI/MCP access` emergency action.

### AI workspace

- Source picker grouped by papers, paper notes, Zotero annotations, lists, vault, experiments, plan, and logbook.
- Visible source count and category badges at all times.
- Per-chat disclosure of exactly what is shared with the configured provider.
- Chat transcript with source chips and an evidence panel.
- Action cards with review, editable draft, source links, approve, and reject.
- No report section in navigation or source picker for v1.

### Paper detail

- `Ask about this paper` adds only the current paper and permitted associated notes/annotations to a new workspace.
- `Add to paper note` always renders as an append proposal; it must show the exact block to be appended.

## 13. Data model and persistence

### New feature module

Create an `ai-assistant` feature module using the project convention:

```text
packages/core/src/features/ai-assistant/
  domain/          workspace, grants, proposals, audit contracts
  application/     create/revoke workspace, validate/approve proposal, append paper note
  index.ts

apps/web/src/features/ai-assistant/
  application/     local retrieval orchestration and source extraction
  infrastructure/  encrypted repositories, model-provider adapter, Zotero annotation sync, future MCP transport
  ui/              settings panels, workspace/chat, proposal review
  module.ts
```

The public module API exports only domain contracts and feature facades. Other features must not import `ai-assistant/infrastructure` or `ai-assistant/ui` internals.

### Persisted encrypted data

- AI workspace name and description, if saved.
- Resource selections and source provenance where those disclose sensitive context.
- Approved-action audit records and proposal payloads.
- Normalized Zotero annotation/note content.
- Optional local retrieval index in IndexedDB.

Persist only the minimum metadata needed to restore a workspace. Do not persist raw chat prompts/responses by default. If conversation history is added later, make it an explicit encrypted opt-in with retention controls.

### Server-visible metadata

Keep server-visible data limited to row IDs, ownership/project references needed for RLS, encrypted content envelopes, and minimal operational timestamps. Review every new table against the E2EE field-map model and RLS policies.

## 14. Implementation phases

### Phase 0 — foundations and decisions — complete

- [x] Confirm the initial model provider and data-retention posture.
- [x] Add the `ai-assistant` core domain module and public core export.
- [x] Define resource-type, source-link, workspace-grant, proposal, approval, and model-provider contracts.
- [x] Add encrypted persistence design and RLS plan for workspaces/audit records.
- [x] Resolve Zotero credential protection before enabling write-capable flows.
- [x] Add default-off AI access persistence metadata through migration `0068_user_settings_ai_access.sql`.

**Exit status:** typed contracts, a central policy, provider-neutral seams, an
encrypted-persistence/RLS design, a retained-content decision, and a hard
Zotero write boundary are in place. Actual encrypted workspace/audit storage
is intentionally delivered with proposal review so no unused plaintext path is
introduced early.

### Phase 1 — settings and source selection — complete

- [x] Build Settings → AI & MCP Access, defaulting all permissions to off.
- [x] Implement master opt-in, category switches, and proposal capability switches.
- [x] Add revoke-all action, active-session display, and locked-state UI feedback.
- [x] Implement source picker and short-lived in-memory session grants.
- [x] Define and enforce a reusable source/category/tool/grant policy guard in core.
- [x] Add unit tests for master, disclosure, encryption, expiry, source, category, tool, and proposal denial paths.

**Exit status:** users explicitly select sources from permitted categories,
start a 30-minute browser-local grant, see the source count and expiry, and
can revoke one or all sessions. New reads/proposals fail closed when the
session expires, the selected category is disabled, encryption is locked, or
the source was not selected.

### Phase 2 — Codex plugin — complete

- [x] Add a repository-packaged `weaveforge-research` Codex plugin.
- [x] Add an installable marketplace entry and validate its manifest structure.
- [x] Add E2EE-aware read, write, and prompt-injection guidance.
- [x] Kept the MCP list empty until the secure endpoint existed; Phase 3 now
  replaces that placeholder with the live tool surface.

**Exit status:** Codex has a safe, installable WeaveForge research workflow;
it makes no false claim of data access before user authorisation.

### Phase 3 — paired read-only MCP service — implementation complete

- [x] Implement the provider-neutral grounded query orchestration port and use-case.
- [x] Reject unauthorized sources before invoking a source reader or model adapter.
- [x] Pair Codex to a visible, unlocked browser session through an encrypted relay and relay-only token (OAuth/device authorisation remains deferred).
- [x] Implement browser-side source extraction for papers, paper notes, reading lists, vault notes, experiments, plan, and logbook.
- [x] Build a local bounded lexical retrieval selector with source provenance.
- [x] Expose `search_workspace`, `get_source_excerpt`, and `get_workspace_outline` through the local Codex MCP client and encrypted browser relay.
- [x] Add an active-source/grant indicator and an immediate revoke path.

**Exit status:** local source extraction, bounded retrieval, the plugin, and
the encrypted browser relay are implemented. Release evidence is covered by
the browser-approved relay read/revocation tests in 19.5.

### Phase 4 — paper notes and safe proposals — complete

- [x] Implement the `propose_append_paper_note` core use-case and pending proposal model.
- [x] Enforce append-only behavior through a dedicated paper-note appender port; existing text is preserved.
- [x] Add the proposal review UI and browser-only approval flow.
- [x] Add expected-note-revision checking and conflict handling.
- [x] Add proposal cards for vault-note and logbook creation.
- [x] Add encrypted proposal/audit schema, browser repository/UI wiring, and
  immutable audit records.
- [x] Add tests proving existing note text cannot be changed by an AI proposal.

**Exit status:** every AI-originated change is an encrypted pending proposal.
Only an explicit user approval invokes a browser-local application writer.

### Phase 5 — Zotero annotations and imports — implementation complete

- [x] Add opt-in Zotero note/annotation retrieval and encrypted normalization
  in encrypted paper metadata. Stable Zotero item keys distinguish child notes
  from PDF annotations; Zotero note HTML is converted to plain text locally.
- [x] Expose selected synced annotations and notes as separate browser-local
  AI source options. No PDF bytes, attachment paths, or credentials enter the
  source extraction path.
- [x] Add reviewed Zotero import proposals to the project's selected collection.
- [x] Keep annotation/note editing and PDF access out of scope.
- Deferred: show annotation provenance and source links in a future answer UI.

**Exit:** users can ground MCP reads in selected Zotero annotations and add
reviewed new bibliographic items. An in-app answer UI is deliberately deferred.

### Phase 6 — later product work (deferred; not part of the current release)

- [x] Proposal flows for reading lists, citation relations, milestones, and experiment follow-ups.
- Workspace templates, encrypted conversation history, and local retrieval
  performance work are later product enhancements, not MCP release blockers.

### Cross-cutting model/provider status

- [x] Keep the core independent of provider SDKs.
- [x] Register `codex` as the preferred provider path, with fallback adapter IDs for OpenAI, Anthropic, Google, Ollama, and custom providers.
- [x] Select Codex via remote MCP as the only initial production path.
- [x] Document Codex/client disclosure behaviour and explicit opt-in before
  external plaintext transmission.

## 15. Testing and security acceptance criteria

### Historical acceptance checklist — superseded by sections 19–20

The following early checklist predated the encrypted relay and proposal
architecture. Completed evidence is recorded in the current release gate
(19.5) and privacy gate (20); it is retained here as design history rather
than as an active list of blockers.

- [x] A disabled master switch denies every AI/MCP tool.
- [x] A disabled category denies the relevant source type even if it is selected in a workspace.
- [x] An unselected resource cannot be read by ID guessing.
- [x] A locked keyring denies all encrypted-content reads.
- [x] An expired grant denies reads and proposals.
- Future hardening: add a persisted-grant revocation contract test when grants
  move beyond the current browser-local session model.
- Future hardening: broaden schema-fuzz tests for unexpected proposal payloads.
- [x] Paper-note additions preserve all prior text and append only new content.
- [x] A changed note revision produces a conflict rather than an automatic merge.
- Future hardening: add optional attribution labels and a negative Zotero
  edit/delete contract test.

### Future hardening and UX validation (not current release blockers)

- SQL ciphertext inspection for encrypted workspace/proposal/audit rows.
- Broader RLS coverage for every AI table, beyond the relay cross-user test.
- Mocked external-provider disclosure tests (the current release uses MCP,
  not an in-app provider call).
- Answer-UI source-link authorization tests when that UI is introduced.

### Ongoing security audit backlog (not a claim that these are incomplete)

- [x] No direct model/MCP access to Supabase/Postgres or storage buckets; the gateway fails closed until pairing.
- Periodically re-audit browser bundles for provider keys and service-role keys.
- Re-audit every new AI table for RLS and ownership checks.
- Keep future server-side model proxy work out of scope unless it has its own
  authenticated size/rate-limit design.
- Re-audit application logging, disclosure text, and credential isolation with
  every new provider or proposal kind.

## 16. Build Week demonstration path

The smallest compelling demonstrator is:

1. User enables AI/MCP access in Settings and selects **Papers**, **Paper notes**, and **Zotero annotations**.
2. User creates a “Chapter 2 literature review” workspace containing several papers and annotations.
3. Assistant compares the methods and limitations with visible evidence links.
4. User asks for a synthesis; assistant proposes an **append-only paper-note addendum**.
5. User reviews and approves the exact addition.
6. User asks for suggested related papers; assistant produces a reviewable Zotero import proposal.

This demonstrates a real research workflow, E2EE-aware access control, model/tool grounding, and safe user-controlled actions without claiming PDF access or broad autonomous authority.

## 17. Future design questions (not release blockers)

The release decisions are resolved: Codex is the initial client, source access
is opt-in and browser-approved, credentials are client-encrypted, and all AI
writes are proposals. Future work may evaluate local-model privacy mode,
retrieval performance at very large library sizes, richer Zotero deep links,
and optional attribution labels for approved additions.

## 18. Definition of done for v1

v1 is complete when an opted-in user can select a bounded set of papers, paper notes, and synced Zotero annotations; ask a grounded question; inspect citations; review an append-only paper-note addition; and approve it while the server continues to store only ciphertext. The user can view/revoke access at any time, no existing content is silently changed, and no PDF, key, credential, or unselected resource is exposed.

## 19. Live MCP delivery plan (current)

The remaining work is intentionally split so that no server ever receives a
decrypted workspace source, a Zotero credential, or the pairing secret.

### 19.1 Encrypted relay contract — implementation complete

- [x] Add a short-lived, owner-scoped relay queue for opaque encrypted MCP
  requests and responses.
- [x] Authenticate the Codex-side client with a dedicated, revocable relay-only MCP token.
- [x] Encrypt relay payloads between the local client and browser with a pairing secret.
- [x] Apply owner scoping, expiry, request-size limits, and revoke/clear behaviour.
- [x] Atomically claim relay requests so two browser tabs cannot process the same request.

### 19.2 Browser pairing and execution — implementation complete; live test pending

- [x] Add an AI & MCP modal action to start a live connection from the current
  selected-source session.
- [x] Show masked session ID and pairing-secret copy controls.
- [x] Poll only the owning user's opaque relay requests while encryption is
  unlocked, decrypt them locally, execute the existing `AiAssistantFacade`,
  and return an encrypted response.
- [x] Stop relays on revoke and clear local device data; expired grants are dropped on restore.
- [x] Verify lock and sign-out stop every persisted relay in a browser integration test.

### 19.2a Independent token and session lifetimes — complete

- [x] Issue a dedicated relay-only MCP token with no independent expiry; it is manually revocable.
- [x] An expired, locked, or closed browser session requires only a fresh browser approval, not a replacement token.
- [x] Offer an opt-in remembered pairing secret, encrypted in user Settings; it is never stored on the server in plaintext.
- [x] Add MCP-token management/revocation to the AI & MCP UI.

### 19.2b Dynamic source inclusion — complete

- [x] Add an off-by-default per-category setting to include sources created
  after a live session starts.
- [x] Re-evaluate category permission and the dynamic-source setting for every
  relay request. Never dynamically include PDFs, report content, credentials,
  settings, or disabled categories.

### 19.3 Live tool surface — complete

- [x] Implement `tools/list`, `search_workspace`, `get_source_excerpt`, and
  `get_workspace_outline` as live read-only MCP operations.
- [x] Return only the already-granted sources and bounded excerpts, preserving
  source IDs and provenance.
- [x] Implement a review-only Zotero import draft tool; it never reads
  credentials or mutates Zotero directly.
- [x] Implement the remaining proposal tools as draft-only responses; no tool
  may mutate a paper, Zotero, a list, or a note directly.

### 19.4 Codex plugin client — complete

- [x] Add a dependency-free stdio MCP client to the Codex plugin.
- [x] Encrypt relay payloads end-to-end between the local client and unlocked
  browser using the pairing secret; the web server stores opaque envelopes.
- [x] Add configuration instructions and cache-busted plugin update/reinstall
  flow.

### 19.5 Verification and release gate — implementation complete; CI/PR remain

- [x] Unit-test session grants, policy re-checking, bounded retrieval, proposal
  confirmation rules, and browser-relay lifecycle cleanup.
- [x] Add a browser E2E opt-in/settings flow (runs when local test-account
  variables are configured).
- [x] Integration-test an authenticated browser-approved read request and
  revocation path against the live relay.
- [x] Verify Supabase RLS and that relay rows cannot be read or updated across users.
- [x] Run core/web checks, production build, boundary checks, and plugin validation.
- [ ] Run CI and open a PR.

The remaining release action is operational rather than feature work: run the
full CI suite and open the PR after the final local verification pass.

### Deferred after live reads

- [x] Annotation provenance/source links are included in every browser retrieval
  result as stable same-origin links, including Zotero annotation anchors.
- [x] Reviewed Zotero import proposals to the project's chosen collection.
- [x] Proposal review UI backed by encrypted proposal/audit rows.

## 20. Privacy hardening gate and reusable proposal architecture

No new AI approval executor may ship until it passes this gate: a user-held
third-party credential must not be forwarded to the WeaveForge server in a
request header or body. Credentials remain encrypted at rest and are decrypted
only in the unlocked browser (or a future local connector).

### 20.1 Credential transport audit — complete (self-hosted CORS required)

| Integration | Current transport | Required outcome |
| --- | --- | --- |
| Zotero approved item write | Browser → Zotero directly | Complete; server does not see the key or item payload. |
| Zotero sync, metadata, annotations, collections | Browser → Zotero directly | Complete; reads, writes, and collection discovery never send the key to WeaveForge. |
| Semantic Scholar | Browser → Semantic Scholar directly | Complete. |
| GitHub/GitLab reads and GitLab log sync | Browser → provider directly | Complete. GitHub supports browser CORS; GitLab instances must expose the required API CORS headers. No proxy fallback exists. |
| Mattermost notifications | Browser → Mattermost directly | Complete. Self-hosted servers must allow the WeaveForge origin through `AllowCorsFrom`; otherwise use a future local connector. |

### 20.2 Proposal platform (provider-neutral)

Build one encrypted proposal platform rather than a separate flow per resource.

- `ProposalCommand`: the only MCP write surface. It validates the active grant,
  serialises a typed draft, and stores an encrypted pending proposal. It cannot
  call a normal application write API.
- `ProposalStore`: encrypted pending/accepted/rejected/conflicted records plus
  immutable encrypted audit entries. The server can index owner, project,
  status, kind, and timestamps but cannot inspect payloads or evidence.
- `ProposalExecutor` registry: one executor per proposal kind. It owns
  validate-before-approve, revision/conflict checks, and the final local write.
  Existing app commands (append paper note, create vault note, write Zotero
  item, add milestone follow-up) are invoked only here.
- `ReviewFacade`: provides pending count, list/decrypt, accept, reject, and
  `approveSafeBatch`. Batch approval is restricted to independent additions;
  conflicts and replacements always need individual review.
- Header notification: shown only when the pending count is non-zero and opens
  one mobile/desktop review route. It contains no proposal plaintext.

### 20.3 Delivery order

- [x] Make Zotero item writes browser-direct and verify the provider CORS policy.
- [x] Migrate the remaining Zotero reads/sync paths off the credential proxy.
- [x] Add encrypted `ProposalStore` adapters for `ai_proposals` and
  `ai_audit_records`.
- [x] Add a provider-neutral `ProposalCommand` as the sole live MCP write
  surface; it creates encrypted pending drafts and cannot call app write APIs.
- [x] Add the generic review route, pending badge, individual review, rejection,
  and safe batch approval for independent append-only proposals.
- [x] Implement `ProposalExecutor`s for append-only paper notes, vault notes,
  log entries, Zotero imports, reading-list additions, graph relations, paper
  metadata changes, milestone follow-ups, and experiment follow-ups.
- [x] Audit and migrate GitHub/GitLab/Mattermost credential transport. Provider
  actions must fail closed when browser CORS is not configured; they may never
  reintroduce a server credential relay.
