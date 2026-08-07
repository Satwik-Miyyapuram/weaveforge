# Licensing

**WeaveForge (WeaveForge) is licensed under AGPL-3.0-only. The entire repository. No exceptions.**

See [`LICENSE`](../LICENSE) for the full text and [`NOTICE`](../NOTICE) for attribution requirements.

## Scope

| Path | Licence |
|------|---------|
| `apps/web/` — web application | AGPL-3.0-only |
| `packages/core/` — domain layer | AGPL-3.0-only |
| `python/` — `weaveforge` SDK | AGPL-3.0-only |
| `plugins/weaveforge-research/` — Codex MCP plugin | AGPL-3.0-only |
| everything else | AGPL-3.0-only |

There are no permissive carve-outs and no dual licensing.

## Why AGPL

WeaveForge is open source for the researchers who use it. AGPL-3.0 is what keeps it that way.

Under a permissive licence (Apache-2.0, MIT), anyone may take this work, improve it privately, host it as a paid service, and never contribute anything back or credit the original. That is the outcome this licence exists to prevent.

Under AGPL-3.0 section 13, an operator who modifies WeaveForge and makes it available to users over a network **must offer those users the corresponding source of their modified version**. Improvements flow back. Attribution survives. Nobody takes this private.

The 3D printing slicer ecosystem is the worked example: PrusaSlicer is AGPL-3.0, so when a far larger hardware company built a commercial product on it, that product had to be published as AGPL too — and a community fork grew from it. Had PrusaSlicer been permissive, the derivative could have shipped closed and the original author would have received nothing back.

## What this means for you

**Using WeaveForge** — no obligations. Run it, self-host it, use it for your thesis. The licence asks nothing of users.

**Self-hosting unmodified** — no obligations beyond keeping the licence and notices intact.

**Self-hosting a modified version, accessible over a network** — you must offer your users the corresponding source of your version. Publishing your fork satisfies this.

**Building a derivative product** — it must also be AGPL-3.0, with source available to its network users, and attribution preserved.

**Contributing** — your contribution is licensed AGPL-3.0-only. See [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Hosted WeaveForge

The hosted service runs this same source. We publish everything, so section 13 is satisfied by default. Hosting is sold on operator cost — capacity, sync frequency, relay hours, backups, support — never on withheld features. See [`pricing-strategy.md`](pricing-strategy.md).

Self-hosting has no subscription fee and never will.

## Incoming third-party code

AGPL-3.0 can absorb permissively licensed components. Apache-2.0, MIT, and BSD dependencies are fine, and vendored ones must be recorded in [`NOTICE`](../NOTICE) with their upstream project and licence.

Components under licences incompatible with AGPL-3.0 may not be included. When in doubt, do not vendor it.

## History

The project was licensed Apache-2.0 from its first commit (2026-06-24) until 2026-07-25, during which time the repository was private and was never distributed to anyone. It was relicensed to AGPL-3.0-only before going public, by the sole copyright holder. No third-party contributions required relicensing consent — the one commit carrying another git identity (`c8781a4`) was the maintainer's own work committed on borrowed hardware, as recorded in [`CONTRIBUTORS.md`](../CONTRIBUTORS.md).

## The name

**Decision (2026-07-25): keep WeaveForge.** This is a personal open-source project, not a company, so it lives at `github.com/Satwik-Miyyapuram/weaveforge` rather than under an organisation. That is the normal shape for a project like this.

Name availability, checked 2026-07-25:

| Where | Status |
|-------|--------|
| npm `weaveforge` | free |
| PyPI `weaveforge` | free |
| GitHub org `weaveforge` | taken — unrelated dev team, dormant, 0 public repos. Not needed |
| `weaveforge.com` | parked, listed for sale |
| Software trademark | none found |

**No trademark is being registered.** For a non-commercial passion project the cost and the ongoing obligation to defend a mark are not justified. Authorship is carried by [`NOTICE`](../NOTICE) and [`CONTRIBUTORS.md`](../CONTRIBUTORS.md), which AGPL-3.0 requires derivatives to preserve — that is the protection that actually matters here.

Known unrelated uses of the name: `WEAVEFORGE LIMITED`, a UK property and investment company (register number 04598210); `WeaveFox`, an unrelated platform; `glyphweaveforge`, an unrelated Rust crate. None operate in research software, so confusion risk is low.

*Correction: an earlier draft recorded a tabletop RPG using the WeaveForge name. That came from an unreliable secondary source and does not hold up — direct searching finds only a game called* Weave. *Disregard it.*

The licence protects the code; it does not protect the name. A derivative must publish its source and preserve attribution, but nothing stops it choosing its own name — which is the expected and acceptable outcome for a fork.
