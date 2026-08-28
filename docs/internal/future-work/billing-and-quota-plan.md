# Billing, entitlements, and quota enforcement — implementation plan

**Date:** 2026-07-25
**Status:** Proposed.
**Strategy:** `docs/internal/strategy/pricing.md` — tiers, prices, and what may never be metered.

---

## 1. Design goal

Adding billing to a **new** feature must cost one registry entry and one wrap line in the composition root. No feature code changes. No `if (plan === "free")` anywhere in `features/*`.

This is achievable because the codebase already uses decorators over ports. `apps/web/src/storage/fetching-blob-store.ts` implements `IBlobFetcher` by wrapping an inner `IBlobStore`; `apps/web/src/storage/providers/tiered/tiered-blob-store.ts` does the same for tiering. Quota enforcement is the same shape, applied to repository ports.

**Non-negotiable:** the domain layer (`packages/core`) must not know that pricing exists. Entitlements enter as a port, exactly like storage or citations.

---

### 1.1 Built, but not shown

**The framework ships; the storefront does not.** Everything below — the
entitlements port, the decorators, the Postgres ceiling, the counting — is
worth building now, because retrofitting metering onto a sync protocol and a
repository layer that never had it is the expensive version of this work.

What is deliberately **absent from the UI** until the app is popular enough to
be worth monetizing: plan pickers, prices, upgrade prompts, payment forms,
"you are on the free plan" notices, and any copy that implies a paid tier
exists. Limits are enforced and explained; they are never an offer. Concretely:

- an entitlement lookup answers with a limit, never with a price,
- a refusal at the ceiling says what the limit is and what to delete, and does
  not link anywhere that sells anything,
- usage displays show usage, not a fraction of a plan the user could buy up
  from,
- no route, panel or dialog exists whose purpose is to take money.

Turning this on later is adding surfaces, not rewiring the enforcement — which
is the point of separating the two now. See
`docs/internal/plans/completed/offline-first-sync.md` **D2**, whose sync opt-in flow counts
what would be uploaded and shows the number without ever showing a price.

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

## 3.1 The local tier has no ceiling, and that is structural

`docs/internal/plans/completed/offline-first-sync.md` makes the desktop app independent: a
local Postgres, no account required. §2's two-layer argument is worth re-reading
with that in mind, because it resolves cleanly rather than breaking.

**The Postgres layer — the real ceiling — only exists on the server.** A local
database is the user's own machine; there is nothing to enforce and nothing that
would be legitimate to enforce. Trying to meter it would mean shipping quota
triggers in the local migrations, where the user can drop them, and where they
would be wrong anyway: local rows cost the operator nothing.

So the rule is one line, and it should be stated in the code that implements it:

> **Quota applies to rows the server holds. Local-only rows are unmetered and
> uncounted.**

What follows from it:

- **`IEntitlements` gains no local variant.** The local provider simply has no
  quota decorator in its composition root — the same mechanism §5's registry
  already uses to strip quota for self-host builds (§9). No new abstraction.
- **Usage is counted server-side**, from the synced rows, not client-side from
  the local database. A client count would drift the moment anything is local-only.
- **Over quota degrades sync, never the app.** The outbox pump stops draining
  and surfaces "sync paused — over quota"; local writes keep working and keep
  queueing. This is the offline-first form of the "no new writes, never no
  access" rule, and it is strictly kinder than the online version, because
  nothing is lost while paused.
- **Adoption on first sign-in must be quota-checked before it runs, not during.**
  A user with 4,000 local papers signing into a 1,000-paper tier must be told
  what will happen *before* a partial adoption leaves their library split across
  two owners. Check the count, offer the upgrade, then adopt in one pass.
- **Entitlements come from whichever server the device syncs with.** A
  self-hosted target has no quota decorator in its composition root — the same
  mechanism as §9 — so a reader running their own server is unmetered without a
  single conditional anywhere in the feature code. Ours is the default target
  (`docs/internal/strategy/pricing.md` §3.1).
- **A lapsed subscription reverts a device to local-only.** It does not lock,
  wipe, or read-only the local data. Anything else is unconscionable in this
  market — see `docs/internal/strategy/pricing.md` §3.1.

---

## 4. The decorator layer

### 4.1 Generic count-quota decorator

One decorator serves every count-limited entity. This is the piece that makes future features nearly free.

```ts
// apps/web/src/billing/quota-guarded-repository.ts
import type { IQuotaPolicy, QuotaKey } from "@weaveforge/core";

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

Explicit class, mirroring `FetchingBlobStore`:

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
MeteredBlobStore → TieredBlobStore → FetchingBlobStore → SupabaseBlobStore
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

## 7.1 Comped access — lifetime codes for friends, reviewers, and contributors

**Goal.** Hand someone a string; they paste it once and hold a plan forever, with no card, no Stripe customer, and no monthly job that could silently expire them.

### The invariant this must not break

§7 says the Stripe webhook is the **only** writer to `plan_entitlements`. A comp grant appears to violate that, and if it wrote the same row, the next `customer.subscription.updated` would erase the grant.

**Resolution: comps never share a row with Stripe.** `plan_entitlements` gains a `source` column (`'stripe' | 'comp'`), with the primary key becoming `(user_id, source)`. The webhook still owns every `source='stripe'` row exclusively. Redemption only ever writes `source='comp'`. Neither writer can see or clobber the other.

`IEntitlementsProvider` then resolves a user's effective limits by taking the **most generous** live row per quota key. Consequences that fall out for free, rather than needing special cases:

- A comped friend who later subscribes gets whichever is better; cancelling drops them back to the comp, not to Free.
- A lapsed Stripe row expires on its own without touching the comp.
- Revoking a comp cannot strip a paying customer.

### Schema

```sql
-- Codes are secrets: hashed at rest, plaintext shown once at mint time.
create table access_codes (
  id               uuid primary key default gen_random_uuid(),
  code_hash        bytea not null,
  code_prefix      text not null,           -- display only, e.g. "WF-LIFE-3K2…"
  plan             text not null,           -- 'student' | 'researcher' | 'lab'
  lifetime         boolean not null default true,
  grant_until      timestamptz,             -- null + lifetime => never expires
  max_redemptions  integer not null default 1 check (max_redemptions > 0),
  redeemed_count   integer not null default 0,
  valid_until      timestamptz,             -- code stops working (≠ grant length)
  revoked_at       timestamptz,
  note             text,                    -- "chetan, beta feedback"
  created_at       timestamptz not null default now()
);
create unique index access_codes_code_hash_idx on access_codes (code_hash);

create table access_code_redemptions (
  id           uuid primary key default gen_random_uuid(),
  code_id      uuid not null references access_codes(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  redeemed_at  timestamptz not null default now(),
  unique (code_id, user_id)                 -- one redemption per person per code
);
```

Both tables have RLS enabled and **no `authenticated` policy at all** — a user must never enumerate codes or read another person's redemption. All access goes through the RPC below. `access_codes` is written only by the maintainer CLI using the service role.

### Redemption

`redeem_access_code(p_code_hash bytea)` — `security definer`, granted to `authenticated`, invoked by the redeeming user so `auth.uid()` is the grantee. It must, in one transaction:

1. `select … for update` the code row — the lock is what makes `max_redemptions` hold under concurrent redemption. Without it two people can both pass the check on the last slot.
2. Reject when `revoked_at is not null`, `valid_until < now()`, or `redeemed_count >= max_redemptions`.
3. Insert into `access_code_redemptions`; a unique violation means "already redeemed" — return that, do not double-count.
4. Increment `redeemed_count`.
5. Upsert `plan_entitlements (user_id, source='comp')` with the code's plan and `grant_until`.

Return a typed result (`ok` / `invalid` / `expired` / `exhausted` / `already_redeemed`) rather than raising, so the UI can say something specific.

**Codes are guessable, so treat redemption as an auth surface.** Mint with ≥128 bits of entropy from `crypto.randomBytes`, Crockford base32, formatted `WF-LIFE-XXXX-XXXX-XXXX`. Rate-limit redemption attempts per user and per IP, and return the *same* generic failure for "no such code" as for "revoked" — a distinguishable response turns the endpoint into an oracle. Never log the plaintext code.

### Where you set them

**Minting is maintainer-only and deliberately not in the app** — an admin UI is a second privileged write path to entitlements, and this needs to be reachable only by someone holding the service-role key.

```bash
node local-dev/mint-access-code.mjs --plan researcher --note "chetan, beta feedback"
node local-dev/mint-access-code.mjs --plan student --max 20 --valid-until 2027-01-01 --note "lab workshop"
node local-dev/list-access-codes.mjs          # prefixes, counts, notes — never plaintext
node local-dev/revoke-access-code.mjs WF-LIFE-3K2
```

The plaintext prints **once**, at mint. It is not recoverable — reissue instead. This mirrors `api_tokens` (§`0061`), which already establishes hash-at-rest + show-once in this codebase.

**Redeeming** is in the app: Settings → Plan → "Have a code?". One field, one button, an explicit success state naming the plan granted.

### Self-host

Comp codes are part of the billing module and strip with it (§9). With billing disabled, `NullEntitlementsProvider` already returns `Infinity` — a code would grant nothing over the default, so the tables and the RPC are simply not created.

---

## 8. UX behaviour

- **80% warning** — inline banner on the relevant screen, not a modal.
- **100% soft block** — the create control disables with the reason and a specific upgrade link, before any request is sent.
- **Hard block** — PostgREST error parsed into the same component, so the two layers are visually indistinguishable to the user.
- **Never blocked:** reads, deletes, export, sharing revocation, account deletion.
- **Settings → Usage** renders every `QUOTA_REGISTRY` entry automatically. New feature, new row, appears with no UI work.
- Copy is capacity-framed — "You've used 1,000 of 1,000 papers" — never moralising.
- **Every upgrade link in this section is behind `showPricing()` (§9.2).** With pricing off, or for a comped user, the same blocks render with the limit and no sell. Warnings and blocks are capacity information and always show; only the upgrade path is conditional.

---

## 9. Self-host stripping and the pricing flag

Billing is a feature module in `weaveforge.config.ts`, following `docs/internal/plans/completed/modular-deployment-plan.md`. With it disabled:

- Composition roots wire the plain repositories with no decorators
- `NullEntitlementsProvider` returns `Infinity` for every key
- Billing routes and the usage screen are stripped at build
- `plan_entitlements` stays empty; §6 triggers no-op

Verified by a build-profile test asserting the self-host bundle contains no Stripe code.

### 9.1 Two independent switches

"Is billing wired?" and "should this person be shown prices?" are different questions, and conflating them is how upgrade nags leak into a self-hosted instance.

```ts
// weaveforge.config.ts
builtins: { features: [...] },   // omit "billing" -> module absent entirely
billing: { pricingUi: false },   // module present, pricing surfaces hidden
```

| Switch | Effect |
|---|---|
| `"billing"` absent from `builtins.features` | Nothing exists — no routes, no Stripe code in the bundle, no tables, no quota. Self-host default. |
| `billing.pricingUi: false` | Quota and usage still work; every **price, plan comparison, and upgrade call-to-action** is gone. For a lab or institution running a paid-for instance where the individual user has nothing to buy. |

`pricingUi: false` must not degrade to a dead-end. When a limit is hit, the block copy states the limit and who to contact — never a price or a checkout link.

### 9.2 Comped users never see pricing

**Rule: anyone holding a live `source='comp'` entitlement sees no price, no plan comparison, and no upgrade prompt, anywhere.**

They already have the thing being sold. Showing a friend on a lifetime grant an "Upgrade to Researcher — €9.99/mo" banner is at best noise and at worst insulting.

This is one predicate, resolved server-side and exposed once:

```ts
/** True when price and upgrade surfaces may render for this viewer. */
function showPricing(cfg: BillingConfig, ent: Entitlements): boolean {
  if (!cfg.enabled || !cfg.pricingUi) return false;
  if (ent.source === "comp" && ent.isLive) return false;  // lifetime or dated
  return true;
}
```

Consumed by a single `<PricingGate>` / `useShowPricing()` so no screen re-derives it — the failure mode here is one forgotten call site, and centralising is the only real defence. **Settings → Plan** still renders for a comped user: it shows the plan they hold and where it came from ("Lifetime — complimentary"), with no price and no checkout. What they lose is the *sell*, not the information.

The predicate is false for comped users regardless of `pricingUi`, so a comped account on a commercial instance is covered without extra configuration.

An 80% usage warning is **not** a pricing surface and still shows — it is capacity information. Only the upgrade path attached to it is suppressed.

---

## 10. Phases

| Phase | Contents |
|-------|----------|
| **1 — Measure** | `IUsageMeter` + `usage_counters` table, wired read-only. No enforcement, no UI. Feeds the telemetry the strategy doc says must precede real quotas. |
| **2 — Entitlements** | `plan_entitlements`, `IEntitlementsProvider`, registry, `PLAN_LIMITS`. Everyone on Free with `Infinity` limits. Settings → Usage ships read-only. |
| **3 — Enforce** | Decorators wired in composition roots; Postgres triggers; warning and block UX. Grandfather existing users. |
| **4 — Charge** | Stripe checkout, webhook, portal, Stripe Tax. Student and Researcher only. |
| **4b — Comp codes** | §7.1. `access_codes` + redemptions + RPC, the mint/list/revoke CLI, and the Settings redeem field. |
| **5 — Lab** | Seats, invoicing, PO numbers, admin console, seat reassignment. |

**Comp codes ship with Phase 2, not Phase 4**, if you want them sooner — they depend on `plan_entitlements` and the `source` column, not on Stripe. Giving friends a lifetime plan is useful before anyone can pay. Adding `source` later means migrating live rows, so **put the `source` column in from the start of Phase 2** even if redemption comes later.

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

- `docs/internal/strategy/pricing.md` — tiers, prices, what may never be metered
- `docs/internal/plans/completed/COMMERCIALIZATION_AND_COST_PLAN.md` — cost drivers and pre-launch cost controls
- `docs/internal/plans/completed/modular-deployment-plan.md` — feature stripping
- `docs/internal/plans/completed/pdf-viewer-plan.md` — `pdfBytes` as a separately metered, opt-in resource
- `apps/web/src/storage/fetching-blob-store.ts`, `apps/web/src/storage/providers/tiered/tiered-blob-store.ts` — existing decorator precedent
