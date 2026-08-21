# Developer Guide

WeaveForge is built using **SOLID** principles, emphasizing a clean, modular structure. The core domain (`@weaveforge/core`) is completely agnostic to UI and frameworks, while the web app (`apps/web`) acts as the presentation layer.

## Architecture

We use a feature-sliced modular pattern:
- **`apps/web/src/features/`**: The home for all UI features. Each folder represents an isolated domain (e.g., `papers`, `graph`, `logbook`).
- **`apps/web/src/registry.ts`**: Feature module registry. Call `buildModuleRegistry(integrationConfig)` for env-aware nav (e.g. hide Git when no git-read providers are enabled).
- **`apps/web/src/bootstrap.ts`**: Composition root — wires use-cases, integrations, and facades from `wireBackend()`.
- **`apps/web/src/container/facades/`**: UI entry points (`getContainer().papers`, `.plan`, …). UI must not reach into repositories directly.
- **`packages/core/`**: Shared interfaces, entities, and use cases.
- **`apps/web/src/backend/`**: Env-driven persistence + auth wiring (`wireBackend()`). Default: Supabase; see [`docs/backend.md`](backend.md).
- **`docs/integrations.md`**: Third-party providers (Zotero, GitLab, …).
- **`docs/extensions.md`**: Extension seams — integrations, modules, backend, Python sync; links to plugin backlog.
- **`docs/usage-cite-and-excerpts.md`**: User guide for cite/excerpts/Overleaf `\cite` / related papers.
- **`docs/competitive-scan.md`** + **`docs/plans/completed/competitive-scan-implementation-plan.md`**: product steal list + phased build plan.

## Adding a New Component or Feature

**Start here:** [`docs/extensions.md`](extensions.md) for the full touch-point checklist. Below is a minimal timer example.

To add a new feature (e.g., a "Timer" module):

1. **Create the Feature Folder**
   Create `apps/web/src/features/timer/`.

2. **Build the UI Component**
   Create `ui/timer-screen.tsx`:
   ```tsx
   "use client";
   import React, { useState } from "react";

   export function TimerScreen() {
     return (
       <div className="card">
         <h2>Focus Timer</h2>
         {/* UI logic */}
       </div>
     );
   }
   ```

3. **Export the Module Definition**
   Create `module.ts` in your feature folder to fulfill the `FeatureModule` contract:
   ```ts
   import type { FeatureModule } from "@weaveforge/core";

   export const timerModule: FeatureModule = {
     id: "timer",
     title: "Timer",
     navItems: [{ key: "timer", label: "Timer", path: "/timer", icon: "clock" }],
     routes: [{ path: "/timer", component: "timer/TimerPage" }],
   };
   ```

4. **Register the Module**
   Open `apps/web/src/registry.ts` and add your module to `ALL_MODULES`:
   ```ts
   import { timerModule } from "@/features/timer/module";

   const ALL_MODULES: readonly FeatureModule[] = [
     // ...
     timerModule,
   ];
   ```
   Nav items are built by `buildModuleRegistry()` — no edits to `tabbar.tsx` per feature.
   If the module belongs in a grouped sub-nav (Library, Plan, …), add its key to `buildNavGroupsFromItems()` in `registry.ts`.
   Create `apps/web/src/app/<path>/page.tsx` manually (Next.js App Router — not auto-wired from `FeatureModule.routes` yet).

5. **Wire domain logic**
   Add use-cases in `packages/core`, wire in `bootstrap.ts`, expose via a facade in `container/facades/`. See [`extensions.md`](extensions.md) §4.

## Adding or swapping an integration

Third-party services (Zotero, GitLab, Mattermost, Semantic Scholar, …) are wired through env-selected providers at the composition root. UI reads descriptors for Settings forms and calls facades for behavior.

**Full guide:** [`docs/integrations.md`](integrations.md)

Quick summary:
1. Implement the core port (`IBibliographyIntegration`, `ICitationSource`, etc.).
2. Add provider adapter under `apps/web/src/integrations/providers/<name>/`.
3. Register via integration **manifests** (`integrations/manifests/`) and `config.ts`; wire in `wire-integrations.ts` / `wire-citations.ts`.
4. Set `NEXT_PUBLIC_*_PROVIDER` env var for your deployment.

## Post-merge review checklist (SOLID / DRY)

When landing sharing, library, or org onboarding work, confirm:

| Area | Rule |
|------|------|
| **Share matching** | Use `shareCoversResource` / `shareAllowsComment` from `@weaveforge/core` in use-cases — never in UI components. |
| **Library pins** | Writes go through `PinSharedResourceUseCase`; repos must pass `runLibraryPinRepositoryContract`. |
| **Screen data** | Multi-repo orchestration lives in `Load*ScreenUseCase` classes wired in `bootstrap.ts`, not in React screens. Pin merge uses `mergePinnedScreenData` from `@weaveforge/core`. |
| **Pinned owner labels** | Use `loadPinnedOwnerNames()` — do not duplicate `buildMemberNameMap` loops in screens. |
| **Duplicate copy** | Papers: `DuplicateSharedPaperUseCase` (core). Vault pages: `DuplicateSharedVaultPageUseCase` (web, asset re-upload). Both require an active share grant. |
| **Org API routes** | Shared helpers in `apps/web/src/app/api/org/_shared.ts`; code preview requires auth. |
| **Standalone onboarding** | Client calls `complete_org_setup()` RPC; `/api/org/standalone` is the JWT fallback only. |
| **Module barrels** | Import web library adapter via `@/features/library`, not deep infrastructure paths. |

## SOLID boundaries (enforced in CI)

`npm run check:solid` runs in the **build-and-test** CI job on every PR to `main`. The script fails on:

- Supabase imports under `features/**/ui/`
- Cross-feature imports from another feature's `ui/` folder (use the feature's public barrel, e.g. `@/features/sharing`)
- UI calling `getContainer().*Repository` directly (use facades)

`npm run check:dry` runs in the same job. It fails when UI screens duplicate patterns we centralised: share matching, pin merge, or pinned owner label loops.

UI talks to **`getContainer().<feature>`** facades only; repositories stay behind use-cases in `bootstrap.ts`.

## Source hygiene (enforced)

`npm run check:hygiene` (part of `check:boundaries`, so it runs in **build-and-test**)
enforces the rules below. Every one of them is here because the repo was bitten
by it once — the script is [`scripts/check-hygiene.mjs`](../scripts/check-hygiene.mjs),
and a rule change belongs in both places.

| Rule | Why | What the check does |
|------|-----|---------------------|
| **No literal control characters in source** | One literal control byte makes git classify the whole file as binary: it vanishes from `git grep` and its diffs stop rendering. Two files had gone invisible this way, both from a control-character range typed straight into a regex. | Scans every tracked text file for bytes below space (other than tab, newline, carriage return) and for DEL. Write them as escapes: `"\u0000"`, `/[\u0000-\u001f]/`. |
| **No source file over 800 lines** | Past that size a file is no longer one thing, and every reader pays to find the part they came for. | Fails on any `src/**` `.ts`/`.tsx` over the cap. A file that genuinely cannot be split goes in `OVERSIZED_ALLOWED` **with its reason**; the check also fails when an allowlisted file drops back under the cap, so the list cannot rot. |
| **Core tests mirror `src/`** | `packages/core/test/` was 132 flat files — finding an area's tests meant already knowing their names. | Fails on a test sitting directly in `test/`, and on a test folder with no matching folder under `packages/core/src/`. |
| **App tests live in a `test/` folder** | A test beside its subject is easy to find; a test loose in a feature folder is one more thing to skim past. | Fails on any `apps/*/src/**/*.test.ts(x)` not inside a `test/` directory. |
| **The MCP plugin server answers like a server** | It lives outside every workspace, so no unit test imports it and no typecheck sees it. Two protocol bugs shipped that way: an unimplemented method got no reply at all, and one unparseable stdin line killed the process mid-session. | [`check:mcp-plugin`](../scripts/check-mcp-plugin.mjs) spawns it, runs a real handshake, and asserts every `AI_TOOL_NAMES` tool is offered. |
| **Bounded arrays from request bodies** | Two routes took an array straight from the body and awaited a database round trip per element, so one request could buy unbounded work. | Fails on any `app/api/**/route.ts` that uses `Array.isArray` without comparing a `.length` against a cap. Name the cap as a constant and answer 400 above it — [`storage/signed-url-limits.ts`](../apps/web/src/storage/signed-url-limits.ts) is the pattern. |

Two more rules the checker cannot see, so they are on you:

- **A file that outgrows itself becomes a folder**, named for the pieces it
  splits into, with an `index.ts` re-exporting the entry point so importers do
  not change. `features/reader/ui/pdf-reader/` and `app/pitch/` are worked
  examples; see [`docs/DESIGN.md`](DESIGN.md) § 3.2.2.
- **A precondition shared by two routes lives in one `_shared.ts`.** Two copies
  of an auth check is a way for them to drift apart —
  [`api/account/delete-user/_shared.ts`](../apps/web/src/app/api/account/delete-user/_shared.ts)
  and [`api/sdk/_shared.ts`](../apps/web/src/app/api/sdk/_shared.ts).

## Dependencies that look unused

`@babel/runtime` used to be declared here with no importer, because the
`@uiw/codemirror-theme-*` packages `require("@babel/runtime/helpers/extends")`
without declaring it. Both are gone now — the editor themes fenced code from
the site's own CSS variables instead. The lesson outlived them: a dependency
removal cannot be trusted against a local build, because the package stays in
`node_modules` until the next install. Reinstall first, or let CI tell you.

## Testing hooks and providers

The web unit suite is `node:test` with no DOM. Hooks and context providers are
still testable: `renderHook` in
[`lib/test/react-harness.ts`](../apps/web/src/lib/test/react-harness.ts) renders
through `react-test-renderer`, which needs no browser environment.

```ts
const harness = await renderHook(() => useStartup(), undefined, {
  wrapper: (children) => <MyProvider>{children}</MyProvider>,
});
await harness.flush();          // let effects and their awaited work settle
assert.equal(harness.current.ready, true);
await harness.unmount();
```

Assert on the value the hook returns, not on markup — there is none.

Two things worth knowing before writing one:

- **Test files may be `.ts` or `.tsx`.** JSX in tests compiles through
  `tsconfig.test.json`, which switches to the automatic JSX runtime; the app's
  own `jsx: "preserve"` makes tsx fall back to the classic transform, and any
  component containing JSX then fails with "React is not defined".
- **`StrictMode` does not double-invoke effects here.** react-test-renderer
  does not reproduce react-dom's development behaviour, so wrapping a test in
  `StrictMode` to force a remount proves nothing — a test written that way
  passed against the very bug it was meant to catch. Drive the remount
  explicitly: mount, `unmount()`, mount again, holding any in-flight promise
  open across both.

Prefer moving a rule into a pure module and testing that; render only when the
thing under test *is* the React wiring.

## Schema and RLS tests

`npm run test:integration:web` runs the `*.integration.ts` files under
`apps/web/src/features`. They need no Supabase project, no accounts and no
secrets: [`backend/test/pg-test-db.ts`](../apps/web/src/backend/test/pg-test-db.ts)
starts an in-process Postgres (PGlite), applies every file in
`supabase/migrations` in order, and lets a test act as a user id:

```ts
const db = await testDb();
const owner = await db.createUser();
await db.as(owner).sql("insert into projects (name) values ('x')");
```

`db.as(uid)` runs as the `authenticated` role with `auth.uid()` answering that
id, which is what every policy is written against. It does **not** stand in for
Supabase auth itself — issuing and validating a JWT is GoTrue's job, and nothing
here tests it. Two consequences worth knowing:

- A migration that cannot apply to a clean database now fails a test rather than
  a deploy.
- Table privileges are granted to `anon`/`authenticated`/`service_role` up front,
  the way Supabase does, so a failing query means a policy refused it and not
  that a grant was missing.

These tests run in `check:all` and on every PR.

## Merging to `main`

`main` is **protected**. Before a PR can merge:

| Required check | What it runs |
|----------------|--------------|
| **build-and-test** | `npm run build:core`, core + web tests, schema and RLS tests, typecheck, `check:boundaries` (`check:solid`, `check:dry`, `check:api-route-tests`, `check:ui`, `check:hygiene`, `check:mcp-plugin`), lint, Next.js build, `check:deployment-surface` |
| **python-sdk** | ruff, mypy, pytest |
| **dco** | [`scripts/check-dco.sh`](../scripts/check-dco.sh) — every commit the PR adds carries a `Signed-off-by:` line naming its own author. Commit with `git commit -s`; sign off a branch already written with `git rebase --signoff origin/main`. Reads only what the PR adds, so the unsigned history before the check is not its business. |

Rules: **pull request required** — direct pushes to `main` are blocked, **including for repo admins**. Branch must be up to date with `main`; required checks must pass; no force-push or branch deletion. Approving review count is **0** (solo maintainer can merge their own PR after CI).

**Releases:** Git tags / PyPI = Python SDK only. See [`docs/release.md`](release.md).

Repo admins can re-apply protection: `.github/scripts/apply-main-branch-protection.sh` (needs `gh` with admin scope).

## State and data flow

Because data is heavily scoped to "Projects", we centralize project context but isolate feature data:

1. **Local State**: Use `useState` for simple UI toggles.
2. **Context Providers**: Feature-wide state is provided by Contexts. E.g., `project-provider.tsx` fetches and caches the active project, providing `current` and `projects` downstream without prop-drilling.
3. **Data Fetching**: UI calls `getContainer().<feature>` facades; facades delegate to use-cases wired in `bootstrap.ts`. Do not add ad-hoc `fetch` in components except for Next.js API routes consumed by infrastructure adapters.
4. **Caching & Optimistic Updates**:
   To ensure the UI feels instant:
   - Always perform optimistic updates before the network request finishes.
   - Maintain local arrays in state (`setPapers(prev => [...prev, newPaper])`).
   - Re-sync from the DB on focus or interval if multi-device sync is critical.
   
   If you need a more robust caching solution for a new feature, you can implement a standard cache invalidation pattern or introduce lightweight SWR hooks inside your feature, maintaining the rule that **features should not bleed their dependencies into the global scope**.

## Reusable UI Components

Use the components in `apps/web/src/components/` (like `<Select>`, `<Modal>`, etc) to ensure the UI remains visually consistent with the `docs/themes.md` design system. Avoid writing ad-hoc inline styles unless dealing with absolute edge-case positioning.
