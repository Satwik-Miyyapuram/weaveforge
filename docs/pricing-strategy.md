# WeaveForge — hosted pricing strategy

**Date:** 2026-07-25
**Status:** Strategy. Supersedes the "Suggested launch tiers" table in `docs/plans/future/COMMERCIALIZATION_AND_COST_PLAN.md`; that document's cost analysis, OCI decision, and cost-control checklist remain authoritative.
**Implementation:** `docs/plans/future/billing-and-quota-plan.md`.

---

## 1. Position in one paragraph

WeaveForge stays open-source under AGPL-3.0-only and fully self-hostable, forever, with no feature held back. The copyleft is the point: anyone who takes WeaveForge and hosts a better version must publish their source, so the work flows back rather than away. The hosted service sells **operator cost and convenience** — capacity, sync frequency, relay time, backups, support — never the product's ideas. A researcher who self-hosts gets one hundred percent of the software. A researcher who pays gets someone else running Postgres at 2am. That boundary is the entire pricing model, and it must never blur: the moment a capability is hosted-only, the open-source promise is dead and the self-host community that gives an academic tool its credibility goes with it.

---

## 2. Market anchors (verified 2026-07-25)

What a researcher already pays, and therefore what feels normal:

| Tool | Price | Notes |
|------|-------|-------|
| **Obsidian Sync** | $4/mo annual, $5/mo monthly | **40% education discount** for students, faculty, nonprofit → ~$2.40/mo effective |
| **Obsidian Publish** | $8/mo annual per site | |
| **Obsidian Commercial** | $50/user/yr | |
| **Overleaf Student** | ~$8/mo list | Verified from Overleaf's own plans page |
| **Overleaf Standard** | ~$17–21/mo | |
| **Overleaf Pro** | ~$33–42/mo | |
| **Elicit Pro** | limits verified, price not | 20 extraction columns, 5,000-paper screening. Public price figures conflict across sources; do not cite until confirmed |
| **Zotero storage** | **unverified** | zotero.org returned 403 to automated fetch. Confirm manually before using as an anchor |

**Three readings.**

1. **The band is $4–10/month for individual academic tools.** Overleaf's ~$17–21 Standard is a manuscript-compilation tool people expense; a note/reference tool bought personally sits lower. Our existing €4.99 / €9.99 hypothesis is correctly placed. Keep it.
2. **Education discounting is table stakes.** Obsidian gives 40%. Overleaf runs a dedicated Student tier at roughly half Standard. A tool whose *entire audience* is students cannot charge a full commercial rate and call the discount a favour — so our Student tier is the headline price, not a concession.
3. **Regional pricing is established practice.** Overleaf's own page serves India at a **70% discount** in local currency. For a tool sold to PhD students globally, purchasing-power pricing is not a nice-to-have; it is the difference between a Global South researcher subscribing and pirating a self-host. Adopt it (§6).

---

## 3. What the PDF reader changes

`docs/plans/completed/pdf-viewer-plan.md` resolves PDF bytes through a six-step ladder — browser cache, Zotero storage, WebDAV, open-access URL, user URL, and only then an opt-in server bucket. **The default hosted install stores zero PDF bytes.**

This is a pricing advantage, and it should be exploited deliberately:

- **Paper counts can be generous** because a paper is a database row plus metadata, measured in kilobytes. Competitors who host PDFs must meter aggressively; we do not.
- **The storage tier is about images, figures, and experiment artifacts** — not literature. Say so on the pricing page. "2 GB" reads as stingy next to a cloud drive and generous next to what it actually has to hold.
- **Server-side PDF storage becomes a paid add-on**, not a base cost. Users who want us holding their PDFs are asking us to take on the expensive thing, and should pay for it separately.
- Storage tiering already exists (`BlobTier`, `computeBlobEvictionScore`, `tiered-blob-store.ts`) and PDFs are losslessly evictable — cold-tier them aggressively and re-resolve on miss.

Net effect: we can raise the free tier's paper limit well above ten without materially raising cost, which makes the free tier a genuine product demonstration rather than a wall.

---

## 4. What we charge for, and what we never charge for

**Charge for** — things that cost the operator money or scale with usage:

- Storage bytes (images, artifacts, opt-in PDFs) and egress
- Sync frequency and background job cadence
- MCP relay active hours
- Seats in a lab
- Backups, retention windows, support response times, invoicing and procurement

**Never charge for** — things that would corrupt the product:

- **Data export.** Full ZIP export (§6.18) stays on the free tier without limits. Holding a thesis hostage is unconscionable in this market and would be correctly savaged.
- **Privacy and security posture.** RLS, at-rest encryption, credential sealing, OTP account deletion. Selling safety as an upsell is an anti-pattern; it also makes the free tier a lesser-protected tier, which is indefensible for research data.
- **The proposal-only MCP safety model.** Approval gating at `/ai-review` is not a premium control. Metering relay *hours* is fine; metering *safety* is not.
- **Self-hosting.** No licence fee, no feature stripping, no "open core" holdbacks.
- **Reading your own data.** Over quota means no new writes, never no access.

---

## 5. Tier structure

Five tiers. The shape matters more than the exact numbers, which should move once real usage telemetry lands.

### Free — "enough to write a chapter"

Indefinite, not a trial. Thesis timelines run years; a 14-day trial is a category error here.

- 50 papers · 50 notes · 1 project · 250 MB assets
- Manual sync only
- MCP: trial guardrail (short session cap, low monthly tool-call ceiling)
- Full export, full privacy posture, all features present

Raised from the previous 10-paper proposal because §3 makes papers cheap. Fifty papers is a real pilot literature review, which is what converts.

### Student — **€4.99/mo, €49/yr** (headline price)

Requires academic email or manual verification.

- 1,000 papers · unlimited notes · 5 projects · 5 GB assets
- 6-hourly sync · 30 MCP relay hours/mo
- 3 Zotero libraries, 3 Overleaf reports

### Researcher — **€9.99/mo, €99/yr**

Postdocs, staff, unaffiliated researchers, anyone without an academic email.

- 5,000 papers · 25 projects · 25 GB assets
- Hourly sync · 200 MCP relay hours/mo
- 10 Zotero libraries, 10 Overleaf reports
- Priority support

### Lab — **€8/seat/mo, €80/seat/yr, minimum 3 seats**

The real revenue line. Academic buying decisions are made by whoever holds the grant, and a supervisor purchasing five seats is worth more than five students each deciding individually — and churns far less, because it is renewed on a grant cycle, not a whim.

- Everything in Researcher, per seat
- Pooled storage (seats × 25 GB) rather than per-seat silos
- Org features: invite codes, supervision tree, `/supervision`, shared dashboards (§5)
- **Invoicing and purchase orders** — see §7
- Admin console: seat management, usage, audit export

Per-seat is below the Researcher rate because seats arrive in bulk and support cost per seat falls.

### Institution — custom

Department or university licence. SSO, self-host support contract, DPA, security review, custom retention, named support. Priced per engagement.

---

## 6. Regional pricing

Overleaf discounts India by 70% on its own pricing page. Follow the precedent with a three-band model keyed on billing country:

| Band | Multiplier | Rationale |
|------|-----------:|-----------|
| A — high income (US, EU, UK, CA, AU, JP, SG…) | 1.0× | List price |
| B — upper-middle income | ~0.5× | |
| C — lower-middle and low income (IN, BR, ID, NG, PK, EG…) | ~0.3× | Matches Overleaf's India band |

Applied to Student and Researcher; Lab and Institution are negotiated anyway. Enforce on billing country from the payment method, not IP, and accept some leakage — a VPN user paying band C is strictly better than a VPN user not paying.

---

## 7. Academic procurement reality

This is where most SaaS pricing fails in academia, and it needs designing for from the start:

- **Universities pay by invoice, not card.** Lab and Institution need PO numbers, quotes before purchase, net-30/60 terms, and a real invoice PDF with a VAT/tax ID. A Stripe checkout link is not sufficient for a grant-funded purchase.
- **Budget cycles are annual and lumpy.** Annual billing is not just a churn tool here — it is how the money is actually released. Offer it prominently; consider multi-year for Institution.
- **Grant money expires.** A supervisor may need to spend by a fiscal deadline. Prepaid seat credits are worth supporting.
- **Students graduate.** Seat reassignment must be trivial, and a departing student needs their data to leave with them — export plus a downgrade path to Free that retains content read-only.
- **VAT/GST.** EU B2B reverse charge, and tax IDs captured at purchase. Stripe Tax handles most of this; it must be enabled before the first paid invoice, not after.

---

## 7.1 Comped and lifetime access

Some people should never pay: friends who tested it, the people who gave the feedback that shaped it, contributors, and researchers in places where even €4.99/mo is a real barrier. Redeemable codes grant a plan directly, with no card and no Stripe customer.

Mechanism is in `billing-and-quota-plan.md` §7.1. The commercial policy:

| Use | Grant | Cap |
|---|---|---|
| Friends, testers, contributors | Researcher, lifetime | Single-use per person, minted on request |
| Reviewers / conference workshops | Student, expires 6–12 months | Multi-use, always `valid_until` dated |
| Hardship / low-income regions | Student, lifetime | Case-by-case; no application form, no means test |
| Yourself and any alt accounts | Researcher, lifetime | — |

**Rules that keep this from becoming a leak:**

- **Never publish a code anywhere public.** A lifetime code on a forum is unbounded free-tier-forever, and revoking it after the fact punishes honest redeemers. Hand them out one to one.
- **Always set `valid_until` on multi-use codes.** Codes without an expiry outlive the context you minted them for.
- **A lifetime grant is a promise.** Do not later convert comped users into a paid tier, or claw back the plan because the cost model changed. It is a small number of people; honouring it costs little and breaking it is the kind of thing people remember. If a future tier is genuinely unaffordable to give away, mint the *old* plan, do not downgrade an existing grant.
- **`note` is mandatory at mint.** Six months on, an untracked code is one you cannot decide whether to revoke.
- Comps are not a discount channel. Discounting is what §6 regional pricing and the 40% education discount are for — comps are for people you would feel bad charging.

Comped users still count in telemetry, and should be **excluded from conversion metrics** — they were never going to convert, and leaving them in makes the free-to-paid rate look worse than it is.

**Comped users are never shown pricing.** No price, no plan comparison, no upgrade prompt — they already hold the thing being sold, and an upgrade banner aimed at a friend on a lifetime grant is noise at best. Settings still shows *which* plan they hold and that it is complimentary; what is removed is the sell, not the information. Enforced by a single predicate (`billing-and-quota-plan.md` §9.2), not by remembering to hide each banner.

Pricing is also independently switchable per deployment: a self-hosted instance omits the billing module entirely, and a paid-for lab instance can keep quotas while hiding prices from users who have nothing to buy.

---

## 8. Anti-patterns to avoid

| Anti-pattern | Why it fails here |
|---|---|
| Metering "API calls" | A user cannot predict whether a paper import needs one metadata fallback or three. Sell product limits; keep rate limits internal and invisible |
| Charging per AI token | Users bring their own model via MCP. Their provider bill is theirs. Charging again for relay *usage* on top of relay *hours* would be double-dipping |
| Paywalling export | Thesis data hostage. Reputationally fatal in academia |
| Deleting data on downgrade or non-payment | Never. Read-only, retained, with a long grace window |
| A €1–2 tier | Payment fees and support burden consume it. The existing analysis is right — do not launch one |
| Open-core feature stripping | Kills the self-host community that gives the project credibility |
| Trial-limited free tier | Theses take years. An indefinite free tier is the acquisition channel |
| Hard cliffs at quota | Warn at 80%, soft-block new writes at 100%, never interrupt reading or an in-progress sync |
| Public or reusable lifetime codes | An unbounded free tier you cannot withdraw without punishing honest redeemers. One-to-one, and date every multi-use code (§7.1) |
| Revoking a lifetime grant | It was a promise made to a small number of people. Mint the old plan instead of downgrading an existing one |

---

## 9. Rollout

1. **Beta — free, invite-only.** Instrument everything: operation class, byte totals, relay hours. No content in telemetry (existing rule). Do not set final quotas from guesses.
2. **Publish quotas before charging.** Give existing users a long grandfather window.
3. **Ship Student and Researcher first.** Individual self-serve, card and Stripe Tax.
4. **Lab after invoicing exists.** Do not sell a seat you cannot invoice.
5. **Institution on request only** until there is a security-review pack and a DPA.

**Revisit trigger:** after 3 months of telemetry, or when storage or egress cost per active user exceeds 20% of the Student price.

---

## 10. Open items

- **Zotero storage pricing** — unverified (403 on automated fetch). Needed as an anchor for the opt-in PDF storage add-on price.
- **Elicit's public price points** — sources conflict; confirm from Elicit's own billing flow.
- **Cost per active user** — unmeasurable until beta telemetry exists. Every number above is a hypothesis until then.
- **Whether the opt-in PDF bucket is priced per-GB or bundled** into a higher storage tier. Leaning per-GB add-on, since it is the one genuinely expensive thing.

---

## 11. Related

- `docs/plans/future/COMMERCIALIZATION_AND_COST_PLAN.md` — cost drivers, OCI decision, pre-launch cost controls (still authoritative; its tier table is superseded by §5 here)
- `docs/plans/future/hosting-and-cost-plan.md` — licensing boundary between hosted and self-hosted
- `docs/plans/future/billing-and-quota-plan.md` — implementation
- `docs/plans/completed/pdf-viewer-plan.md` — the storage ladder that makes §3 possible
- `docs/plans/completed/modular-deployment-plan.md` — deploy-time feature stripping, used to remove billing entirely from self-host builds
