## What & why

<!-- What does this change and why? Link any issue: Closes #123 -->

## Component

- [ ] Web app (`apps/web`)
- [ ] Python SDK (`python/`)
- [ ] Core contracts (`packages/core`)
- [ ] Database / migrations (`supabase/`)
- [ ] Docs

## Checklist

- [ ] Follows the modular + SOLID structure in `docs/DESIGN.md`
      (domain/application don't import Supabase; wiring only in the composition root)
- [ ] New/changed repositories pass the shared **contract tests** (in-memory + Supabase)
- [ ] Tests added/updated and passing (`npm run test:core`, `pytest`)
- [ ] `npm run typecheck` / lint clean; Python `ruff` + `pytest` clean
- [ ] **`npm run check:solid`** — no Supabase in UI, no cross-feature ui imports, no repo in components
- [ ] **`npm run check:dry`** — no duplicated pin/share/owner-label patterns (use core helpers)
- [ ] No secrets (Supabase keys, tokens, passwords) in the diff
- [ ] Docs / README updated if behavior or setup changed

## SOLID checklist

- [ ] **No Supabase in UI** — no `@supabase/*` imports under `features/**/ui/**`
- [ ] **No cross-feature `ui/` imports** — import via feature `index.ts` or `@thesis/core`
- [ ] **New repo has contract test** — shared contract suite + in-memory test run
- [ ] **Business logic not in bootstrap/components** — rules in use-cases; bootstrap wires only

## DRY checklist

- [ ] **Share matching** — `shareCoversResource` / `shareAllowsComment` in use-cases only, not UI
- [ ] **Pinned owner names** — `loadPinnedOwnerNames()` in screens, not `buildMemberNameMap` loops
- [ ] **Pin merge** — `Load*ScreenUseCase` + `mergePinnedScreenData`, not inline in React
- [ ] **Screen data** — multi-repo loads in use-cases wired in `bootstrap.ts`, not in UI

## Environment (when touching dashboard, E2EE, or sharing)

- [ ] `supabase db push` applied on the target database (through latest migration)
- [ ] Dashboard loads with cards; crypto tables present if testing E2EE (`0037+`)
