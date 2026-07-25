# Thesis Tracker — Design Document

**Status:** Draft v1 · **Owner:** Satwik · **Last updated:** 2026-07-12
**License:** AGPL-3.0-only (entire repository) · **Goal:** an open-source, reusable, modular tracker for a masters thesis on latent representation spaces.

This document defines the architecture and the **design principles the codebase must hold to**. Product scope and feature inventory live in the root [`README.md`](../README.md); this document covers *how the code is structured* so the system stays modular and extensible.

---

## 1. Design goals

1. **Modular above all.** Every tracked concern (papers, experiments, logbook, report, meetings) is a self-contained *feature module*. Adding a new module must not require editing existing ones.
2. **Reusable by others.** Clean seams, documented contracts, no hardcoded personal assumptions. Someone should be able to clone, configure, and run their own instance — or disable/replace a module — without surgery.
3. **SOLID throughout.** The five SOLID principles are the explicit rubric for every module boundary, interface, and dependency. Section 4 maps each principle to concrete rules for this codebase.
4. **Backend-agnostic where it counts.** Supabase is the chosen backend, but feature code never imports the Supabase SDK directly — it depends on repository interfaces. Swapping the data layer (e.g. to local SQLite for tests, or another Postgres host) must touch only the data layer.
5. **Two clients, one contract.** The PWA (TypeScript) and the Python CLI/SDK both operate on the same domain model and the same database. Shared concepts are defined once (the schema) and mirrored as typed models on each side.

---

## 2. Architectural overview

A layered, feature-modular architecture. Dependencies point **inward and downward only**: UI → application/services → domain → data-access interfaces. Concrete infrastructure (Supabase) is injected at the edges and depended on only through interfaces.

```
┌──────────────────────────────────────────────────────────────┐
│  PRESENTATION  (per-feature UI: routes, components, view-models)│
│  papers/  experiments/  logbook/  report/  vault/  sharing/       │
└───────────────┬────────────────────────────────────────────────┘
                │ depends on ↓ (interfaces, not implementations)
┌───────────────▼────────────────────────────────────────────────┐
│  APPLICATION / SERVICES  (use-cases per feature)               │
│  e.g. AddPaperFromArxiv, LinkPapers, LogDailyEntry             │
└───────────────┬────────────────────────────────────────────────┘
                │ depends on ↓
┌───────────────▼────────────────────────────────────────────────┐
│  DOMAIN  (entities, value objects, repository INTERFACES)      │
│  Paper, ReadingList, PaperRelation, Experiment, LogEntry...    │
│  IPaperRepository, IExperimentRepository, ...                  │
└───────────────┬────────────────────────────────────────────────┘
                │ implemented by ↓
┌───────────────▼────────────────────────────────────────────────┐
│  INFRASTRUCTURE  (adapters: Supabase repos, arXiv/Crossref,    │
│  auth, storage, realtime, offline cache)                       │
└──────────────────────────────────────────────────────────────┘
```

The key inversion: the **domain layer owns the repository interfaces**; the **infrastructure layer implements them**. Nothing in domain/application knows the word "Supabase."

---

## 3. Module structure

### 3.1 The "feature module" as the unit of modularity
Each tracked concern is a vertical slice with the same internal shape, so the codebase is predictable and a new module is a matter of copying the shape:

```
features/<feature>/
├── domain/          # entities + repository interface (pure, no I/O)
├── application/     # use-cases / services (orchestration, no SDK calls)
├── infrastructure/  # repository implementation (Supabase adapter)
├── ui/              # components, routes, view-models (web only)
└── index.ts         # the module's PUBLIC API — the only thing others import
```

**Rule:** a module exposes its capabilities *only* through `index.ts`. Cross-module access goes through that public surface, never by reaching into another module's internals. This keeps coupling at the interface, not the implementation.

### 3.2 Repository layout (monorepo)
```
thesis-tracker/
├── apps/
│   └── web/                      # Next.js PWA
│       └── src/features/<feature>/{domain,application,infrastructure,ui}
├── packages/
│   ├── core/                     # shared domain contracts + types (TS)
│   └── config/                   # shared lint/tsconfig
├── python/
│   └── thesis_tracker/           # CLI/SDK, same module shape
│       └── features/<feature>/{domain,application,infrastructure}
├── supabase/
│   └── migrations/               # the single source of truth for the schema
├── docs/
│   ├── DESIGN.md                 # this file
│   ├── CONTRIBUTING.md, CHANGELOG.md, SECURITY.md, …
│   └── dev.md, extensions.md, …
├── LICENSE                       # AGPL-3.0-only (entire repository)
├── NOTICE
└── README.md
```

### 3.3 The module registry (extensibility mechanism)
Modules register via an explicit descriptor array (auto-discovery is backlog). A module exports:

```ts
export interface FeatureModule {
  id: string;                       // "papers"
  title: string;                    // "Papers"
  icon: IconComponent;
  routes: RouteDef[];               // contributes its own routes
  navItems: NavItem[];              // contributes to the nav/tab bar
  migrations?: string[];            // declares its own DB migrations
}
```

The app shell collects descriptors from a registry array and builds navigation dynamically. Adding a module = create the folder + register in `registry.ts` + wire `bootstrap.ts` / facades (see [`extensions.md`](extensions.md)). Removing one = delete it. This is the Open/Closed principle made concrete (§4.2).

### 3.4 Cross-feature patterns (sharing + library)

**Sharing** (`packages/core/src/features/sharing/`) owns grants and comments. Pure helpers such as `shareCoversResource` and `shareAllowsComment` live in the domain layer so UI and use-cases do not duplicate share-matching logic.

**Library pins** (`packages/core/src/features/library/`) are a separate module: a recipient-side index of shared items they want in their project library. Pinning always goes through `PinSharedResourceUseCase`, which validates an active share before writing. The web adapter lives in `apps/web/src/features/library/` and is exported via that module's `index.ts`.

**Screen orchestration** belongs in application use-cases (e.g. `LoadPapersScreenUseCase`, `LoadSharedWithMeScreenUseCase`), not in React components. UI components hold view-state and call facades only.

**Library UX controls** (pin/unpin buttons, read-only badges) may live under `features/sharing/ui/` for now because they appear on shared cards; pin *persistence* stays in the library module and core use-case.

---

## 4. SOLID principles applied to this codebase

These are not abstract aspirations — each maps to enforceable rules and concrete examples here.

### 4.1 Single Responsibility Principle (SRP)
*A class/module changes for one reason only.*
- A **repository** only does persistence. A **service/use-case** only does orchestration. A **component** only does presentation. No component issues a Supabase query directly; no repository contains business rules.
- Example: importing a paper from arXiv splits into `ArxivMetadataClient` (fetch + parse arXiv), `AddPaperUseCase` (business rule: dedupe by arxiv_id, set defaults), `PaperRepository` (persist). Three reasons to change, three units.

### 4.2 Open/Closed Principle (OCP)
*Open for extension, closed for modification.*
- New features arrive as new modules via the **registry** (§3.3) — the shell is not modified.
- New paper-relation types (`extends`, `contradicts`, …) are data/enum values, not new branches in code.
- New metadata sources (arXiv, Crossref, Semantic Scholar, Zotero) implement a common `IMetadataSource` interface; adding one doesn't touch the import use-case.

### 4.3 Liskov Substitution Principle (LSP)
*Implementations must be substitutable for their interface.*
- Any `IPaperRepository` implementation (Supabase, in-memory for tests, SQLite for offline) must honor the same contract and invariants. Tests run against the in-memory implementation; production uses Supabase; behavior is identical from the caller's view.

### 4.4 Interface Segregation Principle (ISP)
*Many specific interfaces beat one fat interface.*
- Split capabilities: `IReadableRepository<T>` vs `IWritableRepository<T>`; a read-only graph view depends only on the read interface.
- Realtime, offline-cache, and storage are **separate** interfaces (`IRealtimeChannel`, `IOfflineCache`, `IFileStorage`), so a module uses only what it needs.

### 4.5 Dependency Inversion Principle (DIP)
*Depend on abstractions, not concretions.*
- Domain/application depend on interfaces defined in `domain/` and `backend/` (auth, session, blob). Concrete adapters are constructed at the composition root (`wireBackend()`, `bootstrap.ts`) and **injected**.
- A single **composition root** (`apps/web/src/bootstrap.ts`, `python/thesis_tracker/container.py`) is the only place that knows concrete implementations and wires them together. Everywhere else receives dependencies via constructor/params.

```ts
// domain (no SDK import anywhere here)
export interface IPaperRepository {
  getById(id: string): Promise<Paper | null>;
  list(filter?: PaperFilter): Promise<Paper[]>;
  save(paper: Paper): Promise<void>;
  delete(id: string): Promise<void>;
}

// infrastructure (the ONLY layer that imports supabase-js)
export class SupabasePaperRepository implements IPaperRepository { /* ... */ }

// composition root — the single wiring point
const paperRepo: IPaperRepository = new SupabasePaperRepository(supabase);
const addPaper = new AddPaperUseCase(paperRepo, arxivSource);
```

---

## 5. Cross-cutting contracts

### 5.1 Data-access contracts
A generic base plus per-entity specializations (ISP-friendly):

```ts
interface IReadableRepository<T, F = unknown> {
  getById(id: string): Promise<T | null>;
  list(filter?: F): Promise<T[]>;
}
interface IWritableRepository<T> {
  save(entity: T): Promise<void>;
  delete(id: string): Promise<void>;
}
```

Specializations add only what's genuinely specific, e.g. `IReadingListRepository.getTree()` (recursive hierarchy) or `IPaperRelationRepository.getGraph()` (nodes + edges).

### 5.2 Metadata-source contract (for paper import)
```ts
interface IMetadataSource {
  readonly id: string;                 // "arxiv" | "crossref" | "semantic-scholar"
  supports(ref: PaperRef): boolean;    // can this source resolve this id?
  fetch(ref: PaperRef): Promise<PaperMetadata>;
}
```
A `MetadataResolver` holds a list of sources and delegates to the first that `supports()` the reference — adding Zotero later means adding a class, not editing the resolver (OCP).

Third-party **bibliography, citation, notification, and log-sync** providers follow the same pattern via ports in `packages/core/src/features/integrations/` and env-driven wiring in `apps/web/src/integrations/`. See [`integrations.md`](integrations.md).

### 5.3 Sync / realtime / offline contracts
Kept separate (ISP): `IRealtimeChannel` (subscribe to table changes), `IOfflineCache` (read-through cache + write outbox), `IFileStorage` (PDF blobs). A module opts into each independently. The offline strategy (last-write-wins on `updated_at`) lives behind `IOfflineCache` so it can evolve without touching features.

### 5.4 Keeping the two clients consistent
The Supabase migrations are the **single source of truth** for the schema. TypeScript types are generated from the live schema (`supabase gen types`); Python models mirror the same tables. Domain *behavior* (validation, dedupe rules) is duplicated intentionally per language but documented in one place (this doc + docstrings) so the contract is shared even though the runtime isn't.

---

## 6. Testing strategy (enables the modularity to hold)

- **Domain & application:** pure unit tests against **in-memory repositories** (LSP guarantees these stand in for real ones). Fast, no network.
- **Infrastructure:** integration tests against a local Supabase (or a disposable Postgres) verifying each repository honors its interface contract — a shared "contract test suite" run against *every* implementation of an interface.
- **Modules in isolation:** because cross-module access is only via `index.ts`, a module can be tested with the others mocked at that public surface.
- **PWA:** Lighthouse PWA audit in CI; component tests for view-models.

A module is "done" only when its contract tests pass against both the in-memory and the Supabase implementation.

---

## 7. Non-goals (for now)

To keep scope honest and the design from over-engineering:
- No custom backend server — Supabase is accessed directly through the repository adapters.
- No microservices; this is a modular monolith + a sibling Python package.
- No public plugin marketplace. An **internal** integration registry exists (`apps/web/src/integrations/`, env-driven provider selection) — see [`docs/integrations.md`](integrations.md) and [`docs/extensions.md`](extensions.md). External/third-party plugin loading is backlog.
- No native mobile app; PWA only (native wrapper via Capacitor remains a clean future option because the UI is already decoupled).

---

## 8. First implementation slice (what we build right after this doc)

Following the plan's P0/P1 but applying the structure above:

1. **Scaffold** the monorepo skeleton (§3.2): `apps/web`, `packages/core`, `python/`, `supabase/`.
2. **Establish the contracts** in `packages/core`: `IReadableRepository` / `IWritableRepository`, the `Paper` entity, `IPaperRepository`.
3. **Build the `papers` module end-to-end** as the reference implementation of the module shape (§3.1): domain → in-memory repo → Supabase repo (passing the same contract tests) → `AddPaperUseCase` → minimal UI list + add form.
4. **Stand up the composition root** wiring (§4.5) so DIP is real from day one.
5. Use `papers` as the template; subsequent modules (logbook, report, experiments, meetings) follow the identical shape.

This way the very first module sets the pattern every later one copies — which is the whole point of the modular + SOLID design.

---

## 9. Open questions / decisions to confirm

- Web framework: **Next.js** (assumed in plan) vs **SvelteKit** — both fit this architecture; confirm before scaffolding `apps/web`.
- Auto-discovery vs explicit registry array for modules (§3.3) — start explicit (simpler), revisit if it gets noisy.
- How much domain logic to duplicate in Python vs. expose via a thin shared API — current call: duplicate the small amount that exists, keep schema as the shared contract (§5.4).
