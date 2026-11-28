/**
 * Generic note flows in a fresh, empty project, each one a bug the sweep missed once:
 * a new note opens and stays open, no false "no folder" toast, the first keystroke is
 * not kept aside as a "live copy", a new note takes ink at once and Ink mode survives its naming rename.
 */
import type { Page } from "@playwright/test";
import { expect, findNoteFile, nameNewNote, openProjectsScreen, openRoute, test } from "./dev-app";

// Selector sources (apps/web/src):
// - "New project" / "Create project" / "Delete project": features/projects/ui/projects-screen.tsx
// - "New note": features/vault/ui/vault-screen/vault-screen.tsx; title box "Note title": vault-screen/page-editor.tsx
// - Mode button "Ink", pen "Pen (P)", `.ink-canvas`: ink/ui/ink-bar.tsx, ink/ui/ink-page.tsx
// - Kept-text block heading: features/collab/domain/seed-document.ts KEPT_LIVE_TEXT_HEADING
// - "No folder" texts: backend/providers/files/no-account-fs.ts, workspace/application/workspace-folder.ts

const TOAST_BAD = /no folder|open a folder|reloaded|changed outside|conflict/i;
const KEPT = "Kept from this note's live copy";

async function logToasts(app: Page): Promise<void> {
  await app.evaluate(() => {
    const seen: string[] = ((window as any).__wfFlowToasts = []);
    new MutationObserver(() => {
      for (const el of document.querySelectorAll(".toast-message")) {
        const text = el.textContent ?? "";
        if (!seen.includes(text)) seen.push(text);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}

async function createProject(app: Page, name: string): Promise<void> {
  await openProjectsScreen(app);
  await app.getByRole("button", { name: "New project", exact: true }).first().click();
  await app.getByLabel("Name", { exact: true }).fill(name);
  await app.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(app.getByRole("button", { name: `Project: ${name}` })).toBeVisible({ timeout: 20_000 });
}

async function deleteProject(app: Page, name: string): Promise<void> {
  await openProjectsScreen(app);
  const row = app.getByRole("button", { name, exact: true });
  if ((await row.count()) === 0) return;
  await app.getByRole("button", { name: `More actions for ${name}`, exact: true }).click();
  await app.getByText("Delete project", { exact: true }).click();
  await app.getByLabel(/to confirm/).fill(name);
  await app.getByRole("button", { name: "Delete project", exact: true }).click();
  await expect(row).toHaveCount(0, { timeout: 20_000 });
}

/** Samples every 100 ms for `ms` and returns how often the open note's title box was gone. */
async function titleGoneCount(app: Page, ms: number): Promise<number> {
  return app.evaluate(async (ms) => {
    let gone = 0;
    for (const end = Date.now() + ms; Date.now() < end; ) {
      if (!document.querySelector('[aria-label="Note title"]')) gone++;
      await new Promise((r) => setTimeout(r, 100));
    }
    return gone;
  }, ms);
}

test.describe("flows", () => {
  test("a new note in an empty project opens, stays open and keeps the first keystroke", async ({ app }) => {
    const proj = `e2e-flow-${Date.now()}`;
    const note = `e2e-flow-note-${Date.now()}`;
    try {
      await createProject(app, proj);
      await openRoute(app, "/notes");
      await logToasts(app);
      await app.getByRole("button", { name: "New note", exact: true }).first().click();
      await nameNewNote(app, note);
      expect(await titleGoneCount(app, 4_000), "the open note flashed back to the list").toBe(0);

      const editor = app.locator(".record-doc .cm-content").first();
      await editor.click();
      await app.keyboard.type("first words", { delay: 30 });
      await app.waitForTimeout(3_000);
      const text = await editor.innerText();
      expect(text, "first keystroke went into a kept-text block").not.toContain(KEPT);
      expect(text).toContain("first words");
      const path = await findNoteFile(app, note);
      expect(path, `note ${note} not found in the vault`).toBeTruthy();
      const onDisk = await app.evaluate((p: string) => (window as any).weaveforge.readVaultFile(p), path as string);
      expect(onDisk).not.toContain(KEPT);

      const toasts: string[] = await app.evaluate(() => (window as any).__wfFlowToasts ?? []);
      expect(toasts.filter((t) => TOAST_BAD.test(t))).toEqual([]);
    } finally {
      await deleteProject(app, proj);
    }
  });

  test("a new note takes ink at once and Ink mode survives a rename", async ({ app }) => {
    const proj = `e2e-flow-${Date.now()}`;
    const note = `e2e-flow-ink-${Date.now()}`;
    try {
      await createProject(app, proj);
      await openRoute(app, "/notes");
      await app.getByRole("button", { name: "New note", exact: true }).first().click();
      await nameNewNote(app, note);
      await app.getByRole("button", { name: "Ink", exact: true }).click();
      await app.getByRole("button", { name: "Pen (P)" }).first().click();
      const canvas = app.locator(".ink-canvas").first();
      await expect(canvas).toBeVisible({ timeout: 20_000 });
      // A new note's ink must be ready within a second or two, and say so (aria-busy) until then.
      await expect(canvas).not.toHaveAttribute("aria-busy", "true", { timeout: 2_000 });
      // The rename nameNewNote started lands after the Ink click; Ink mode must survive it.
      // (An ink note's title is not editable on the Notes screen, so this is the rename to check.)
      await app.waitForTimeout(3_000);
      await expect(canvas, "Ink mode fell back to Text after a rename").toBeVisible();

      // Draw right away once ready: no stroke may be dropped after that.
      const box = await canvas.boundingBox();
      if (!box) throw new Error("ink canvas has no box");
      await app.mouse.move(box.x + box.width / 4, box.y + box.height / 3);
      await app.mouse.down();
      await app.mouse.move(box.x + box.width / 4 + 200, box.y + box.height / 3, { steps: 20 });
      await app.mouse.up();

      const path = await findNoteFile(app, note);
      expect(path, `note ${note} not found in the vault`).toBeTruthy();
      await expect
        .poll(
          () =>
            app.evaluate(async (note: string) => {
              // Same lookup as ink.spec: `<file name before the first dot>.….ink/` beside the note.
              const wf = (window as any).weaveforge;
              const dir = note.slice(0, Math.max(0, note.lastIndexOf("/")));
              const id = (note.split("/").pop() ?? "").split(".")[0];
              const list = (await wf.listVaultFiles(dir)) as { path: string; kind: string }[];
              const ink = list.find((e) => e.kind === "dir" && (e.path.split("/").pop() ?? "").startsWith(`${id}.`) && e.path.endsWith(".ink"));
              if (!ink) return false;
              return ((await wf.listVaultFiles(ink.path)) as { path: string }[]).some((e) => e.path.endsWith(".inkb"));
            }, path as string),
          { message: "the first stroke was not saved", timeout: 8_000 },
        )
        .toBe(true);
    } finally {
      await deleteProject(app, proj);
    }
  });
});
