# Plans

Implementation and strategy plans, sorted by lifecycle.

| Folder | Meaning |
|--------|---------|
| [`future/`](future/) | Proposed, not started |
| [`completed/`](completed/) | Delivered or archived (kept for history and cross-links) |

Nothing is in flight on this board today: `future/` holds proposals and
`completed/` holds what landed. A plan that starts being built creates
`working/`, and moves to `completed/` when it lands. Proposals that are not yet plans live in
[`../future-work/`](../../future-work/).

An earlier `current/` folder held copies of two plans that had already been
finished and archived under `completed/`; the copies were older than the
archived versions and nothing linked to them, so they are gone.

## Completed

| Plan | Notes |
|------|-------|
| [`migration-plan.md`](completed/migration-plan.md) | Self-host Postgres + tiered blobs. Phases 0–2 delivered; 3–6 documented but **not provisioned** — see [`../self-host-roadmap.md`](../strategy/self-host-roadmap.md) |
| [`modular-deployment-plan.md`](completed/modular-deployment-plan.md) | Feature/integration allowlists |
| [`pdf-viewer-plan.md`](completed/pdf-viewer-plan.md) | Phase D provenance reader record; superseded by the reader plan |
| [`COMMERCIALIZATION_AND_COST_PLAN.md`](completed/COMMERCIALIZATION_AND_COST_PLAN.md) | Cost drivers and OCI guidance; its tier table is superseded by [`../strategy/pricing.md`](../strategy/pricing.md), which also holds the hosted vs self-host licensing boundary (§12) |
| [`offline-first-sync.md`](completed/offline-first-sync.md) | Offline-first desktop and sync — data-kind classification, three-way merge, conflict policy. **Delivered** |

## Elsewhere

- **Billing / pricing** — [`../future-work/billing-and-quota-plan.md`](../future-work/billing-and-quota-plan.md)
  (entitlements and metering, status: proposed). Strategy lives in
  [`../strategy/pricing.md`](../strategy/pricing.md).
- Other non-plan notes — [`../future-work/`](../../future-work/) (backlog, overnight queue, handoffs).

## Future

| Plan | Notes |
|------|-------|
| [`live-vault-folder.md`](future/live-vault-folder.md) | Two-way folder sync on desktop — wires up `FsPort`/`GitPort`/`deserializeWorkspace`, which today have no callers. Makes the workspace folder openable as an Obsidian vault. Proposal |

