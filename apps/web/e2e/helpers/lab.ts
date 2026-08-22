import { expect, type Page } from "@playwright/test";
import { appeared } from "./visible.js";

/**
 * A lab both e2e accounts belong to.
 *
 * The member-share spec needs the recipient to appear in the owner's people
 * picker, and `profiles_select_lab` only shows an account the people it shares
 * an organization with. Two accounts in no common lab therefore see a picker
 * that can never fill — a failure about a locator, caused by account history.
 *
 * So the spec builds the precondition instead of assuming it: the owner has a
 * lab and mints a code, the recipient redeems it. Both halves are idempotent —
 * an account already in a lab keeps the one it has.
 */

const LAB_NAME = "E2E Lab";
const HIDDEN_CODE = "•";

/** People and labs live in a Settings tab; the old /org path only redirects. */
async function openOrgTab(page: Page): Promise<void> {
  await page.goto("/settings#settings-org");
  // The code lookup and the join both call the server as this user, and a page
  // that has not finished restoring its session answers "Not authenticated" —
  // which reads in the dialog as a bad code. Wait for the signed-in shell.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  const tab = page.getByRole("tab", { name: "Org" });
  if (await appeared(tab, 20_000)) await tab.click();
}

/** The owner's lab, and a code someone can join it with. */
export async function mintLabCode(owner: Page): Promise<string> {
  await openOrgTab(owner);
  const another = owner.getByRole("button", { name: "Create / join another lab" });
  if (!(await appeared(another, 15_000))) {
    await owner.getByRole("button", { name: "Create or join" }).first().click();
    await owner.getByRole("button", { name: "Create a lab" }).click();
    await owner.getByPlaceholder("Smith Lab").fill(LAB_NAME);
    await owner.getByRole("button", { name: "Create", exact: true }).click();
  }

  // Codes are write-only: the panel shows one when it is minted, never after,
  // so revealing is a regeneration and the freshest code is the one to hand out.
  // A lab just created shows its codes once, in plain text. An existing lab
  // shows dots and a button, because a code is only readable when it is minted
  // — so ask for a fresh one rather than for the one already handed out.
  // The PhD code, not the masters one: a masters join has to name a PhD
  // supervisor who is already in the lab, and a lab whose only member is its
  // owner has none — the join would be refused for a person who cannot exist
  // yet. A PhD join takes the lab's single professor automatically.
  const row = owner.locator(".org-code-row").filter({ hasText: /^PhD/i }).first();
  await expect(row, "the lab has no invite codes to hand out").toBeVisible({ timeout: 20_000 });
  const reveal = row.getByRole("button", { name: /Reveal|Regenerate/i });
  if (await appeared(reveal, 5_000)) await reveal.click();
  const value = row.locator(".org-code-value, code").filter({ hasNotText: HIDDEN_CODE }).first();
  await expect(value, "no invite code was shown after minting one").toBeVisible({ timeout: 20_000 });
  return (await value.innerText()).trim();
}

/** Redeem a code, unless this account is already in a lab. */
export async function joinLab(recipient: Page, code: string): Promise<void> {
  await openOrgTab(recipient);
  if (await appeared(recipient.getByRole("button", { name: "Create / join another lab" }), 15_000)) {
    return;
  }
  await recipient.getByRole("button", { name: "Create or join" }).first().click();
  await recipient.getByRole("button", { name: "Join with code" }).click();
  const field = recipient.getByPlaceholder("ABC-DEF-GH2");
  await field.fill(code);

  // The lookup runs on blur and is what fills the supervisor pickers, and it
  // needs a session the page may still be restoring — the first attempt comes
  // back "Not authenticated". Blur again until it answers, rather than
  // submitting a form whose pickers were never populated.
  await expect(async () => {
    await field.fill(code);
    await field.blur();
    // The preview line, not the "Join code" label above it.
    await expect(recipient.locator("form.form-stack p.muted").first()).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 60_000 });

  // Whichever supervisor pickers the lab's roster produced — a lab with a
  // professor and a PhD in it asks for both, and the form refuses to submit
  // until each has an answer.
  const pickers = recipient.locator(".custom-select-button");
  for (let i = 0; i < (await pickers.count()); i += 1) {
    await pickers.nth(i).click();
    // The first row is the empty "Select…" placeholder, and choosing it looks
    // like a choice while sending nothing — which the server rejects as a
    // missing supervisor.
    await recipient
      .locator(".custom-select-item")
      .filter({ hasNotText: /^Select…$/ })
      .first()
      .click();
  }

  await recipient.getByRole("button", { name: "Join lab" }).click();
  await expect(
    recipient.getByRole("button", { name: "Create / join another lab" }),
    "the invite code was not accepted",
  ).toBeVisible({ timeout: 30_000 });
}

/** Both halves, in the order they have to happen. */
export async function ensureSharedLab(owner: Page, recipient: Page): Promise<void> {
  await joinLab(recipient, await mintLabCode(owner));
}
