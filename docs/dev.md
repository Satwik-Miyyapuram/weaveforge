# Developer Guide

Thesis Tracker is built using **SOLID** principles, emphasizing a clean, modular structure. The core domain (`@thesis/core`) is completely agnostic to UI and frameworks, while the web app (`apps/web`) acts as the presentation layer.

## Architecture

We use a feature-sliced modular pattern:
- **`apps/web/src/features/`**: The home for all UI features. Each folder represents an isolated domain (e.g., `papers`, `graph`, `logbook`).
- **`apps/web/src/registry.ts`**: Feature module registry. Call `buildModuleRegistry(integrationConfig)` for env-aware nav (e.g. hide Git when no git-read providers are enabled).
- **`apps/web/src/bootstrap.ts`**: Composition root — wires use-cases, integrations, and facades from `wireBackend()`.
- **`apps/web/src/container/facades.ts`**: UI entry points (`getContainer().papers`, `.plan`, …). UI must not reach into repositories directly.
- **`packages/core/`**: Shared interfaces, entities, and use cases.
- **`apps/web/src/backend/`**: Env-driven persistence + auth wiring (`wireBackend()`). Default: Supabase; see [`docs/backend.md`](backend.md).
- **`docs/integrations.md`**: Third-party providers (Zotero, GitLab, …).
- **`docs/extensions.md`**: Extension seams — integrations, modules, backend, Python sync; links to plugin backlog.
- **`docs/usage-cite-and-excerpts.md`**: User guide for cite/excerpts/Overleaf `\cite` / related papers.
- **`docs/competitive-scan.md`** + **`docs/future-work/competitive-scan-implementation-plan.md`**: product steal list + phased build plan.

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
   import type { FeatureModule } from "@thesis/core";

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
   Add use-cases in `packages/core`, wire in `bootstrap.ts`, expose via a facade in `facades.ts`. See [`extensions.md`](extensions.md) §4.

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
| **Share matching** | Use `shareCoversResource` / `shareAllowsComment` from `@thesis/core` in use-cases — never in UI components. |
| **Library pins** | Writes go through `PinSharedResourceUseCase`; repos must pass `runLibraryPinRepositoryContract`. |
| **Screen data** | Multi-repo orchestration lives in `Load*ScreenUseCase` classes wired in `bootstrap.ts`, not in React screens. Pin merge uses `mergePinnedScreenData` from `@thesis/core`. |
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

## Merging to `main`

`main` is **protected**. Before a PR can merge:

| Required check | What it runs |
|----------------|--------------|
| **build-and-test** | `npm run build:core`, core + web tests, Supabase contract tests, typecheck, `check:solid`, `check:dry`, lint, Next.js build |
| **python-sdk** | ruff, mypy, pytest |

Rules: **pull request required** — direct pushes to `main` are blocked, **including for repo admins**. Branch must be up to date with `main`; required checks must pass; no force-push or branch deletion. Approving review count is **0** (solo maintainer can merge their own PR after CI).

**Releases:** Git tags / PyPI = Python SDK only. See [`docs/release.md`](release.md).

Repo admins can re-apply protection: `.github/scripts/apply-main-branch-protection.sh` (needs `gh` with admin scope).

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
