# WeaveForge commercialization and cost plan

## Recommendation in one sentence

Start with OCI hosting for the web/runtime layer, keep Supabase for Auth,
Postgres, RLS, and encrypted metadata while the product is small, and charge
for capacity and integrations rather than for ordinary database requests.

## What creates external work

WeaveForge is primarily a self-hostable research workspace (data stored with
at-rest encryption, access gated by Postgres RLS). A normal
session does not call an AI provider. Codex or another MCP client supplies the
model, and the browser relay supplies only the sources the user explicitly
allowed.

The main request classes are:

| Flow | Typical external work | Cost driver |
| --- | --- | --- |
| First page load | Auth/session, profile/settings, project, key-wrap and dashboard reads | Database round trips and latency |
| Ordinary edits | One entity write plus encrypted key/index/cache writes as needed | Database writes |
| Paper import | One metadata provider request; fallback providers may add one or two more; then local save | Provider rate limits |
| Zotero sync | Paginated library/annotation requests and local reconciliation | Zotero API limits and sync frequency |
| Overleaf refresh | Token-authenticated project/file requests and local TeX parsing | Overleaf/API traffic, not AI cost |
| Image upload/view | Object upload and signed URL/egress | Storage and bandwidth |
| MCP read | Usually a session/grant check, source query, and encrypted browser-side read; one model turn may request several tools | Database traffic and relay duration |
| Email auth/recovery | One auth email per sign-in, reset, or recovery request | Transactional email volume |

These are planning ranges, not billing guarantees. The application should add
instrumentation for operation name, latency, response size, and provider—not
content—before setting hard quotas.

## Quotas to enforce

Do not sell “API calls” as the primary unit. A user cannot predict whether a
paper import needs one metadata fallback or three. Use understandable product
limits and keep internal safeguards separately:

### Suggested launch tiers

| Limit | Free | WeaveForge Student | WeaveForge Plus |
| --- | ---: | ---: | ---: |
| Price | €0 | €4.99/month | €9.99/month |
| Papers | 10 | 250 | 2,000 |
| Paper notes | 10 | 250 | 2,000 |
| Vault/logbook notes | 10 | 250 | 2,000 |
| Images | 10 | 250 | 2,000 |
| Image storage | 50 MB | 2 GB | 20 GB |
| Reports/projects | 1 | 5 | 25 |
| Zotero libraries | 1, read/sync | 3, read/write proposals | 10, read/write proposals |
| Overleaf reports | 1 | 3 | 10 |
| MCP sessions | Disabled or trial-only | 30 active hours/month | 200 active hours/month |
| MCP tool calls | 50/month trial guardrail | 2,000/month | 20,000/month |
| Sync frequency | Manual | Every 6 hours | Every hour |

The exact free limits can start smaller during the beta, but ten papers is a
better product demonstration than five: a researcher can build a meaningful
miniature literature set without immediately hitting a wall. A five-paper
limit is acceptable for an invite-only prototype, not for public discovery.

MCP limits should be presented as a safety/capacity allowance, not as a claim
that the user is being charged per model token. If the user connects their own
model provider, their model-provider bill remains theirs.

## Why these prices are reasonable

The recommended paid floor is €4.99/month for students and €9.99/month for
regular individual use. The lower tier is intentionally accessible while the
upper tier provides enough margin for storage, email, support, payment fees,
and users who sync more often.

At a €4.99 price, a typical card transaction leaves roughly €4.54 before tax
and other costs when using the commonly published US Stripe card rate of 2.9%
plus $0.30; local payment methods, currency conversion, VAT, and tax can
change this. Annual plans can reduce churn and the fixed per-transaction fee:
offer €49/year for Student and €99/year for Plus after the beta.

Do not launch a €1–€2 monthly plan. The fixed payment fee, support burden, and
refunds consume too much of each small payment. Keep the free plan useful and
make the first paid tier clearly about capacity and integrations.

## OCI deployment decision

OCI is viable, especially for the app/runtime layer:

1. Use an OCI ARM VM or Always Free resources for the Next.js app, reverse
   proxy, background sync worker, and monitoring during beta.
2. Keep Supabase as the managed Auth/Postgres/RLS/storage dependency initially.
   Supabase’s current Pro plan starts at $25/month and includes usage quotas,
   backups, and support features that are valuable for a paid service.
3. Put encrypted image/blob storage behind a quota and monitor egress. Large
   PDF/image traffic is more likely to become a cost problem than ordinary
   SQL request counts.
4. Add a paid OCI instance, backups, and a second deployment only after usage
   justifies it. Always Free capacity is useful for a beta, but it is not an
   availability guarantee and is subject to home-region capacity and tenancy
   limits.
5. Consider self-hosting Postgres/Supabase-compatible services on OCI only
   when the operational savings exceed the cost of backups, patching, RLS
   auditing, observability, incident response, and recovery testing. This is a
   separate hosting product, not a default launch configuration.

This split is also commercially useful: “hosted WeaveForge” can be paid, while
the open-source deployment can let technical users bring their own OCI/VPS,
database, storage, email, and model provider.

## Cost controls required before public launch

- Per-user and per-IP rate limits for sign-in, recovery, metadata imports, and
  MCP relay requests.
- Quotas enforced server-side for counts, bytes, sync jobs, and active relay
  time; client-only checks are not sufficient.
- A hard monthly spend cap and alerts for database, storage, egress, email,
  and provider calls.
- Provider backoff, pagination, caching, and deduplication for Zotero,
  Semantic Scholar, Crossref, arXiv, and Overleaf.
- No plaintext content in usage telemetry. Record operation class and byte or
  count totals only.
- Graceful quota behavior: stop new imports/syncs, retain existing data, and
  never delete encrypted user content because a quota was reached.
- Stripe webhook handling for subscription state, grace periods, cancellation,
  refunds, and tax status. Never trust a browser success redirect as payment
  proof.

## Sources checked

- [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/) — Always Free
  resources and the time-limited promotional credit.
- [OCI Free Tier documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)
  — current tenancy, home-region, and post-trial constraints.
- [Supabase pricing](https://supabase.com/pricing) — Free and Pro database,
  storage, egress, and compute allowances.
- [Resend pricing](https://resend.com/pricing) — transactional email quotas and
  paid overage model.
- [Stripe pricing](https://stripe.com/pricing) — published card processing
  rates; actual fees depend on country, method, currency, and tax.

## Decision

Use €4.99/month Student and €9.99/month Plus as the initial pricing hypothesis,
with a useful ten-paper free tier. Run the beta with OCI for the app and
Supabase for managed data/auth. Revisit limits after collecting anonymized
operation and byte metrics from real usage; do not commit to self-hosting the
database until those measurements show a clear financial advantage.
