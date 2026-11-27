/**
 * Projects in the open workspace folder: rename moves the folder silently, deletes stay deleted,
 * the app starts without the 0.9.7 upgrade gate, and Settings shows the Workspace folder.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./dev-app";

// Selector sources (apps/web/src):
// - "New project" button: features/projects/ui/projects-screen.tsx:83
// - Name input, label "Name": features/projects/ui/projects-screen.tsx:104-105 (New) and :127-128 (Rename)
// - "Create project" / "Rename" submit: features/projects/ui/projects-screen.tsx:117 and :132
// - Project row button (accessible name = project name): features/projects/ui/projects-screen.tsx:166-168
// - Card menu trigger "More actions for <name>": components/entity-card-menu.tsx:66, CardMenu label
// - Menu items "Rename" / "Delete project": features/projects/ui/projects-screen.tsx:175, :179
// - Delete confirm input, label "Type <name> to confirm": components/confirm-dialog.tsx:61-72
// - Delete confirm button "Delete project": features/projects/ui/projects-screen.tsx:91 (confirmLabel)
// - Toasts: components/toast-host.tsx:19 (.toast-region, role="status") and :31 (.toast-message)
// - Account menu trigger, aria-label "Account": app/header-actions.tsx:192
// - Settings menu item text "Settings": app/header-actions.tsx:104 (TITLES)
// - Settings tab "Workspace": features/settings/ui/settings-screen.tsx:71, tab id :418 (#settings-tab-workspace)
// - Workspace panel, folder path: features/settings/ui/workspace-folder-panel.tsx:167-185 (.app-log-path > code)
// - "New note" button, text: features/vault/ui/vault-screen/vault-screen.tsx:526
// - Note card menu, "Delete note": features/vault/ui/vault-screen/note-card.tsx:98
// The project folder is `<slug>--<id6>`: features/projects/application/rename-project.ts:6-7,
// moved by features/workspace/application/parts.ts:216-219. The slug is not asserted; matching is by name.

const UPGRADE_GATE = /0\.9\.7|install gate|old database|Update to 0\.9\.7/i;

async function startToastLog(app: Page): Promise<void> {
  await app.evaluate(() => {
    const w = window as any;
    w.__wfToasts = [];
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const hits = node.matches(".toast-message") ? [node] : Array.from(node.querySelectorAll(".toast-message"));
          for (const el of hits) w.__wfToasts.push(el.textContent ?? "");
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

async function readToasts(app: Page): Promise<string[]> {
  return app.evaluate(() => ((window as any).__wfToasts ?? []) as string[]);
}

async function rootEntries(app: Page): Promise<string[]> {
  return app.evaluate(async () => {
    const list = await (window as any).weaveforge.listVaultFiles(null);
    return (list as { path: string }[]).map((e) => e.path);
  });
}

async function createProject(app: Page, name: string): Promise<void> {
  await app.getByRole("button", { name: "New project", exact: true }).first().click();
  await app.getByLabel("Name", { exact: true }).fill(name);
  await app.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(app.getByRole("button", { name, exact: true })).toBeVisible({ timeout: 20_000 });
}

async function deleteProject(app: Page, name: string): Promise<void> {
  const row = app.getByRole("button", { name, exact: true });
  if ((await row.count()) === 0) return;
  await app.getByRole("button", { name: `More actions for ${name}`, exact: true }).click();
  await app.getByText("Delete project", { exact: true }).click();
  await app.getByLabel(/to confirm/).fill(name);
  await app.getByRole("button", { name: "Delete project", exact: true }).click();
  await expect(row).toHaveCount(0, { timeout: 20_000 });
}

test.describe("projects", () => {
  test("renaming a project moves its folder without a toast", async ({ app }) => {
    const base = `e2e-proj-${Date.now()}`;
    const renamed = `${base}-renamed`;
    try {
      await createProject(app, base);
      const before = (await rootEntries(app)).filter((p) => p.includes(base) && !p.includes("renamed"));
      expect(before.length, "exactly one folder for the new project").toBe(1);

      await startToastLog(app);
      await app.getByRole("button", { name: `More actions for ${base}`, exact: true }).click();
      await app.getByText("Rename", { exact: true }).click();
      await app.getByLabel("Name", { exact: true }).fill(renamed);
      await app.getByRole("button", { name: "Rename", exact: true }).click();
      await expect(app.getByRole("button", { name: renamed, exact: true })).toBeVisible({ timeout: 20_000 });

      await app.waitForTimeout(5_000);
      const bad = /changed outside|reloaded|conflict|error/i;
      const toasts = await readToasts(app);
      expect(toasts.filter((t) => bad.test(t)), "toasts during and after rename").toEqual([]);

      const after = await rootEntries(app);
      expect(after.some((p) => p.includes(base) && !p.includes("renamed")), "old folder is gone").toBe(false);
      expect(after.some((p) => p.includes(renamed)), "new folder exists").toBe(true);
    } finally {
      await deleteProject(app, renamed);
      await deleteProject(app, base);
    }
  });

  test("nothing deleted comes back", async ({ app }) => {
    const proj = `e2e-proj-del-${Date.now()}`;
    const note = `e2e-note-${Date.now()}`;
    try {
      await createProject(app, proj);
      await app.getByRole("button", { name: proj, exact: true }).click();

      await app.getByRole("button", { name: "New note", exact: true }).first().click();
      // The new note opens with its title focused to type over (vault-screen.tsx:222).
      await app.keyboard.press("Control+A");
      await app.keyboard.type(note);
      await expect(app.getByText(note, { exact: true })).toHaveCount(1, { timeout: 20_000 });

      await app.getByRole("button", { name: `More actions for ${note}`, exact: true }).click();
      await app.getByText("Delete note", { exact: true }).click();

      // Deferred delete commits when its toast closes; auto-sync and the watcher run in this wait.
      await app.waitForTimeout(8_000);
      await app.reload();
      await app.waitForLoadState("load");
      await app.waitForTimeout(5_000);

      await expect(app.getByText(note, { exact: true }), "deleted note is not shown").toHaveCount(0);
      expect(await app.getByText(note, { exact: true }).count(), "no duplicate of the note").toBeLessThanOrEqual(1);
    } finally {
      await deleteProject(app, proj);
    }
  });

  test("no upgrade gate on start", async ({ app }) => {
    await app.reload();
    await app.waitForLoadState("load");
    await app.waitForTimeout(5_000);
    await expect(app.getByText(UPGRADE_GATE).filter({ visible: true })).toHaveCount(0);
  });

  test("Settings shows the Workspace panel", async ({ app }) => {
    await app.getByRole("button", { name: /^Account/ }).click();
    await app.getByText("Settings", { exact: true }).click();
    // The Workspace tab is only rendered once its settings group is open.
    await app.locator("#settings-tab-workspace").click();

    const panel = app.locator("#settings-workspace");
    await expect(panel.getByRole("heading", { name: "Workspace", exact: true })).toBeVisible();
    const path = panel.locator(".app-log-path code");
    await expect(path).toBeVisible();
    expect((await path.innerText()).trim().length, "folder path is non-empty").toBeGreaterThan(0);
  });
});
