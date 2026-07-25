# Billing, entitlements, and quota enforcement — implementation plan

**Date:** 2026-07-25
**Status:** Proposed.
**Strategy:** `docs/pricing-strategy.md` — tiers, prices, and what may never be metered.

---

## 1. Design goal

Adding billing to a **new** feature must cost one registry entry and one wrap line in the composition root. No feature code changes. No `if (plan === "free")` anywhere in `features/*`.

This is achievable because the codebase already uses decorators over ports. `apps/web/src/storage/passthrough-blob-store.ts` implements `IEncryptedBlobStore` by wrapping an inner `IBlobStore`; `apps/web/src/storage/providers/tiered/tiered-blob-store.ts` does the same for tiering. Quota enforcement is the same shape, applied to repository ports.

**Non-negotiable:** the domain layer (`packages/core`) must not know that pricing exists. Entitlements enter as a port, exactly like storage or citations.

---

## 2. The problem that shapes the architecture

The brief's §2 splits the API surface deliberately:

| Surface | Used for |
|---------|----------|
| Next `/api/*` | server-key credentials, MCP/API tokens, blobs, org admin, Overleaf, SDK |
| **Supabase PostgREST + RLS** | **papers, vault, logbook, projects, sharing, comments** |

The browser talks **directly** to PostgREST for most product entities. A TypeScript decorator running in that same browser cannot stop anything — a user with their own anon key and a REST client bypasses every guard we write in the app layer.

**Therefore quota enforcement is two-layer, and the layers have different jobs:**

| Layer | Job | Bypassable? |
|-------|-----|-------------|
| **Decorator** (TypeScript, app layer) | UX: warnings at 80%, clear blocking errors, usage display, metering, soft-block before the write is attempted | Yes — by design; it is a UX layer |
| **Postgres** (trigger / RLS predicate / constraint) | The actual ceiling. Rejects the insert regardless of client | No |

Anyone who plans this as decorators alone ships a quota system that is defeated by `curl`. Anyone who plans it as Postgres alone ships one with unexplainable errors and no warning before the wall. Both are required.

---

## 3. Core ports

New, in `packages/core/src/billing/`. Pure TypeScript, no framework, no Supabase.

```ts
// plan.ts
export type PlanId = "free" | "student" | "researcher" | "lab" | "institution";

export type QuotaKey =
  | "papers" | "vaultPages" | "projects" | "reportSections"
  | "assetBytes" | "pdfBytes"
  | "zoteroLibraries" | "overleafReports"
  | "mcpRelayHours" | "syncIntervalMinutes";

export interface Entitlements {
  readonly plan: PlanId;
  readonly limits: Readonly<Record<QuotaKey, number>>;  // Infinity = unlimited
  readonly graceUntil?: Date;                            // past-due window
}

// ports.ts
export interface IEntitlementsProvider {
  current(): Promise<Entitlements>;
}

export interface IUsageMeter {
  read(key: QuotaKey): Promise<number>;
  /** Append-only. Counts and bytes only — never content. */
  record(key: QuotaKey, delta: number): Promise<void>;
}

export interface IQuotaPolicy {
  /** Throws QuotaExceededError when the write must not proceed. */
  assertAllows(key: QuotaKey, delta: number): Promise<void>;
  status(key: QuotaKey): Promise<QuotaStatus>;
}

export interface QuotaStatus {
  readonly key: QuotaKey;
  readonly used: number;
  readonly limit: number;
  readonly state: "ok" | "warning" | "exceeded";  // warning at >=80%
}
```

`QuotaExceededError` carries `{ key, used, limit, plan }` so the UI can render a specific, actionable message rather than a generic failure.

---

## 4. The decorator layer

### 4.1 Generic count-quota decorator

One decorator serves every count-limited entity. This is the piece that makes future features nearly free.

```ts
// apps/web/src/billing/quota-guarded-repository.ts
import type { IQuotaPolicy, QuotaKey } from "@thesis/core";

/** Minimal shape every create-capable repository already satisfies. */
interface Creatable<TInput, TOutput> {
  create(input: TInput): Promise<TOutput>;
}

export function withCreateQuota<TInput, TOutput, R extends Creatable<TInput, TOutput>>(
  inner: R,
  policy: IQuotaPolicy,
  key: QuotaKey,
): R {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop !== "create") return Reflect.get(target, prop, receiver);
      return async (input: TInput) => {
        await policy.assertAllows(key, 1);
        return (target as Creatable<TInput, TOutput>).create(input);
      };
    },
  }) as R;
}
```

A `Proxy` is used rather than a hand-written class per repository so that adding quota to a new entity does not require re-declaring its whole interface. Every non-`create` method passes through untouched, which keeps reads and deletes free — deletes must always work, including over quota.

For repositories needing more than `create` guarded, write an explicit class decorator in the same directory. The Proxy is the default, not the only option.

### 4.2 Byte-quota decorator over `IBlobStore`

Explicit class, mirroring `PassthroughBlobStore`:

```ts
// apps/web/src/billing/metered-blob-store.ts
export class MeteredBlobStore implements IBlobStore {
  constructor(
    private readonly inner: IBlobStore,
    private readonly policy: IQuotaPolicy,
    private readonly meter: IUsageMeter,
    private readonly keyForBucket: (bucket: string) => QuotaKey,
  ) {}

  async upload(bucket: string, path: string, blob: Blob, contentType?: string) {
    const key = this.keyForBucket(bucket);
    await this.policy.assertAllows(key, blob.size);
    await this.inner.upload(bucket, path, blob, contentType);
    await this.meter.record(key, blob.size);
  }

  async remove(bucket: string, path: string) {
    const size = await this.sizeOf(bucket, path);
    await this.inner.remove(bucket, path);
    await this.meter.record(this.keyForBucket(bucket), -size);
  }

  signedUrls(bucket: string, paths: string[], ttl: number) {
    return this.inner.signedUrls(bucket, paths, ttl);   // reads always free
  }
  // …remaining methods delegate unchanged
}
```

`keyForBucket` routes `paper-pdfs` to `pdfBytes` and everything else to `assetBytes`, so the paid PDF add-on from the strategy doc §3 meters separately with no extra plumbing.

### 4.3 Composition order

```
MeteredBlobStore → TieredBlobStore → PassthroughBlobStore → SupabaseBlobStore
```

Quota outermost, so a rejected upload never reaches tiering or the network.

---

## 5. The quota registry — the extensibility mechanism

A single declarative table. Adding a feature means adding a row.

```ts
// packages/core/src/billing/quota-registry.ts
export const QUOTA_REGISTRY = {
  papers:          { unit: "count", table: "papers",          label: "Papers" },
  vaultPages:      { unit: "count", table: "vault_pages",     label: "Notes" },
  projects:        { unit: "count", table: "projects",        label: "Projects" },
  reportSections:  { unit: "count", table: "report_sections", label: "Report sections" },
  assetBytes:      { unit: "bytes", table: "blob_objects",    label: "Storage" },
  pdfBytes:        { unit: "bytes", table: "blob_objects",    label: "PDF storage" },
  // add new resources here
} as const satisfies Record<QuotaKey, QuotaResource>;

export const PLAN_LIMITS: Record<PlanId, Record<QuotaKey, number>> = { /* per strategy §5 */ };
```

The registry is the single source of truth for three consumers: the decorators, the Settings usage screen (which renders every entry automatically), and the migration generator that emits the Postgres triggers in §6. One row keeps all three in step.

---

## 6. The Postgres layer — the real ceiling

Because the browser writes directly via PostgREST, hard limits live in the database.

```sql
-- supabase/migrations/01xx_quota_enforcement.sql
create table plan_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free',
  limits jsonb not null default '{}'::jsonb,
  grace_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table plan_entitlements enable row level security;
-- readable by owner; writable only by service role (Stripe webhook)

create or replace function enforce_row_quota() returns trigger
language plpgsql security definer as $$
declare
  lim  int;
  used int;
begin
  select coalesce((limits ->> tg_argv[0])::int, 2147483647)
    into lim from plan_entitlements where user_id = auth.uid();
  if lim is null then return new; end if;

  execute format('select count(*) from %I where user_id = $1', tg_table_name)
    into used using auth.uid();

  if used >= lim then
    raise exception 'QUOTA_EXCEEDED:%:%:%', tg_argv[0], used, lim
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger papers_quota before insert on papers
  for each row execute function enforce_row_quota('papers');
```

Notes:

- The structured `QUOTA_EXCEEDED:key:used:limit` message lets the client map a raw PostgREST error back to the same UI the decorator would have shown.
- `security definer` is required to read `plan_entitlements` under the caller's RLS.
- Byte quotas trigger on `blob_objects` inserts, summing `size_bytes` for the owner.
- Counting on every insert is acceptable at these volumes; if `papers` grows past ~10k rows per user, switch to a maintained counter table updated by the same trigger.
- **Self-host:** the migration ships but `plan_entitlements` is empty, and an absent row means unlimited. Self-hosted deployments are never quota-limited. This is a correctness requirement, not a convenience.

---

## 7. Subscription state

- **Stripe is the source of truth for payment; Postgres is the source of truth for entitlements.**
- `POST /api/billing/webhook` — verify signature, handle `checkout.session.completed`, `customer.subscription.updated|deleted`, `invoice.payment_failed`. Idempotent by event id (store processed ids). Never trust a browser success redirect.
- The webhook is the **only** writer to `plan_entitlements`, via service role.
- Past-due sets `grace_until = now() + 14 days`; entitlements stay at the paid tier until it passes, then fall back to Free **without deleting anything** — over-quota content becomes read-only, never removed.
- `/api/billing/portal` returns a Stripe Customer Portal session for self-serve changes.
- **Lab seats:** subscription quantity maps to seats; `org_memberships` consuming a seat is checked at invite-accept time. Seat reassignment must be O(1) for the admin — students graduate constantly.
- **Invoicing (strategy §7):** Stripe Invoicing with PO number as a custom field, net-30 terms, Stripe Tax enabled before the first paid invoice.

---

## 8. UX behaviour

- **80% warning** — inline banner on the relevant screen, not a modal.
- **100% soft block** — the create control disables with the reason and a specific upgrade link, before any request is sent.
- **Hard block** — PostgREST error parsed into the same component, so the two layers are visually indistinguishable to the user.
- **Never blocked:** reads, deletes, export, sharing revocation, account deletion.
- **Settings → Usage** renders every `QUOTA_REGISTRY` entry automatically. New feature, new row, appears with no UI work.
- Copy is capacity-framed — "You've used 1,000 of 1,000 papers" — never moralising.

---

## 9. Self-host stripping

Billing is a feature module in `thesis-tracker.config.ts`, following `docs/modular-deployment-plan.md`. With it disabled:

- Composition roots wire the plain repositories with no decorators
- `NullEntitlementsProvider` returns `Infinity` for every key
- Billing routes and the usage screen are stripped at build
- `plan_entitlements` stays empty; §6 triggers no-op

Verified by a build-profile test asserting the self-host bundle contains no Stripe code.

---

## 10. Phases

| Phase | Contents |
|-------|----------|
| **1 — Measure** | `IUsageMeter` + `usage_counters` table, wired read-only. No enforcement, no UI. Feeds the telemetry the strategy doc says must precede real quotas. |
| **2 — Entitlements** | `plan_entitlements`, `IEntitlementsProvider`, registry, `PLAN_LIMITS`. Everyone on Free with `Infinity` limits. Settings → Usage ships read-only. |
| **3 — Enforce** | Decorators wired in composition roots; Postgres triggers; warning and block UX. Grandfather existing users. |
| **4 — Charge** | Stripe checkout, webhook, portal, Stripe Tax. Student and Researcher only. |
| **5 — Lab** | Seats, invoicing, PO numbers, admin console, seat reassignment. |

Phases 1–2 are safe to ship at any time and are useful independently — usage visibility is a good feature even with no pricing.

---

## 11. Adding quota to a future feature

The acceptance test for this design. To meter a hypothetical `experiments` limit:

1. Add `"experiments"` to `QuotaKey`.
2. Add a `QUOTA_REGISTRY` row and a number in each `PLAN_LIMITS` entry.
3. In `wire-backend.ts`, change
   `experimentRepo` → `withCreateQuota(experimentRepo, policy, "experiments")`.
4. Add a trigger line to the quota migration.

Nothing in `features/experiments/` changes. The Settings usage screen picks it up from the registry. That is the whole cost.

---

## 12. Risks

| Risk | Mitigation |
|------|-----------|
| **Decorator-only enforcement is bypassable via PostgREST** | §6 Postgres triggers are mandatory, not optional. Treat a quota shipped without its trigger as unshipped |
| Quota logic leaks into feature code | Boundary lint: `features/*` may not import from `billing/*`. Enforced in CI alongside the existing SOLID/DRY lints |
| Self-host accidentally quota-limited | Absent entitlements row = unlimited; build-profile test asserts no Stripe in the self-host bundle |
| Trigger count queries slow at scale | Counter table behind the same trigger once per-user row counts justify it |
| Stripe webhook replay or reorder | Idempotency by event id; always reconcile against Stripe's object state, not the event payload's implied transition |
| Users losing access to their own data | Over quota is read-only and retained. Never delete. Export is never gated |
| Metering leaks content | `IUsageMeter` accepts a key and a number. No free-text parameter exists on the port, so it cannot be misused |

---

## 13. Related

- `docs/pricing-strategy.md` — tiers, prices, what may never be metered
- `docs/COMMERCIALIZATION_AND_COST_PLAN.md` — cost drivers and pre-launch cost controls
- `docs/modular-deployment-plan.md` — feature stripping
- `docs/future-work/pdf-viewer-plan.md` — `pdfBytes` as a separately metered, opt-in resource
- `apps/web/src/storage/passthrough-blob-store.ts`, `apps/web/src/storage/providers/tiered/tiered-blob-store.ts` — existing decorator precedent
