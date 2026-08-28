# Hosting and cost plan

## Product and licensing boundary

WeaveForge remains open-source under AGPL-3.0-only, across the entire
repository including the Python SDK and MCP plugin. Anyone may self-host the
application and its supporting services, subject to the licenses of those
services and their own infrastructure costs.

Because the licence is AGPL-3.0, any operator who modifies WeaveForge and makes
it available over a network must offer their users the corresponding source of
their modified version (AGPL-3.0 section 13). This applies to the hosted
WeaveForge instance as much as to anyone else's — we publish all of our source,
so we are compliant by default.

The hosted WeaveForge instance is a separate service. Its operator may:

- limit access to invited users or organisations;
- apply fair-use limits to storage, sync, MCP relay, and external integrations;
- require a hosted-service plan for infrastructure-heavy usage; and
- suspend or revoke hosted access for abuse, unpaid usage, or operational risk.

These hosted-service controls do not restrict the right to self-host the
open-source application.

## Planned hosted tiers

Pricing is intentionally a planning item, not an implemented billing feature.
The first hosted release should support:

| Tier | Intended use | Controls |
| --- | --- | --- |
| Personal/invite | Individual researchers and invited testers | Bounded storage, sync, MCP relay, and external-provider usage |
| Small lab | A research group using the hosted service | Member limits, shared storage limits, and fair-use integration quotas |
| Custom | Larger or institution-managed usage | Organisation agreement, support, backups, and capacity limits |

Exact prices and quotas should be chosen only after measuring storage, database,
relay, bandwidth, and provider costs. Do not promise unlimited hosted usage.

## Self-hosting

Self-hosting has no WeaveForge subscription fee. Operators provide and pay for
their own:

- compute and database;
- object storage and backups;
- email/auth infrastructure;
- domain, TLS, monitoring, and incident response; and
- external provider accounts such as Supabase, Zotero, Overleaf, or GitLab.

The self-hosted operator is responsible for security updates, RLS migrations,
credential encryption keys, backups, and uptime.

## Current implementation status

- Hosted billing and quota enforcement: planned.
- Hosted authentication and access restriction: available through deployment
  configuration and account management.
- Self-hosted web application: supported.
- Self-hosted Supabase/Postgres path: documented, with migration chain through
  0088.
- Leaked-password protection on hosted Supabase: requires a Supabase Pro-or-
  above plan; the current project plan rejected the setting change. This is a
  hosted-provider limitation, not an application bypass. Self-hosted operators
  should configure the equivalent Auth/GoTrue protection in their deployment.
