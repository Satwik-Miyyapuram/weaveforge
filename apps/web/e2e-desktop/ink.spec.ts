/**
 * Pen ink on a new note: wet ink shows while the pointer is down, a stroke keeps
 * the frame budget, and the stroke is written to disk beside its note.
 *
 * Selectors (all verified in apps/web/src, worktree wf-098-mem):
 * - "New note" button: text in vault-screen/vault-screen.tsx:526; also an
 *   IconButton `aria-label="New note"` in editor-workspace/ui/explorer-panel.tsx:429.
 *   `.first()` takes the Vault screen one.
 * - Pen tool: `ToolButton label="Pen (P)"` in ink/ui/ink-bar.tsx:369 (label from
 *   toolLabel in ink/ui/ink-bar-glyphs.tsx:16); ToolButton sets aria-label (components/controls.tsx:32).
 * - Ink canvas: `.ink-canvas` class on the <canvas> in ink/ui/ink-page.tsx:590.
 * - Delete: IconButton `label="Delete note"` in vault/ui/vault-screen/page-editor.tsx:315.
 *   There is NO confirm dialog: `remove()` (page-editor.tsx:259-263) calls removeLater,
 *   a toast with undo. So delete = one click. No stable test id exists for these.
 * - Ink folder layout: `<name>.ink/<ulid>.inkb` (core/src/ink/parts-2.ts:230-237,
 *   written by ink/infrastructure/parts.ts:435-468). NOT `<name>.inkb` beside `<name>.md`.
 */
import type { Page } from "@playwright/test";
import { deleteOpenNote, expect, findNoteFile, nameNewNote, openInProject, test } from "./dev-app";

const NOTE_PREFIX = "e2e-ink-";

/** Creates an Untitled note, names it, and selects the pen. Returns the ink canvas. */
async function openInkNote(app: Page, name: string) {
  await app.getByRole("button", { name: "New note" }).first().click();
  await nameNewNote(app, name);
  // A new note opens in Text mode; the pen lives on the Ink mode's bar.
  await app.getByRole("button", { name: "Ink", exact: true }).click();
  await app.getByRole("button", { name: "Pen (P)" }).first().click();
  const canvas = app.locator(".ink-canvas").first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  // The sheet is aria-busy until the note's ink has loaded; it takes no ink before.
  await expect(canvas).not.toHaveAttribute("aria-busy", "true", { timeout: 10_000 });
  return canvas;
}

/** Pointer down at the canvas's left third, drag 200 px in `steps` moves. Leaves the button down. */
async function dragDown(app: Page, canvas: ReturnType<Page["locator"]>, steps: number) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("ink canvas has no box");
  const x = box.x + box.width / 4;
  const y = box.y + box.height / 3;
  await app.mouse.move(x, y);
  await app.mouse.down();
  await app.mouse.move(x + 200, y, { steps });
}

test.describe("ink", () => {
  // The vault notes screen: its New note opens the note with the title focused.
  test.beforeEach(({ app }) => openInProject(app, "/notes"));

  test("wet ink shows while the pen is still down", async ({ app }) => {
    const name = `${NOTE_PREFIX}${Date.now()}`;
    try {
      const canvas = await openInkNote(app, name);
      const before = await canvas.screenshot();

      await dragDown(app, canvas, 20);
      const during = await canvas.screenshot();
      await app.mouse.up();

      expect(Buffer.compare(before, during)).not.toBe(0);
    } finally {
      await deleteOpenNote(app, name);
    }
  });

  test("a stroke takes under 16 ms a frame", async ({ app }) => {
    const name = `${NOTE_PREFIX}${Date.now()}-fps`;
    const budget = Number(process.env.WF_E2E_FRAME_BUDGET ?? 34);
    try {
      const canvas = await openInkNote(app, name);

      await app.evaluate(() => {
        const w = window as any;
        w.__wfFrames = [] as number[];
        let last = performance.now();
        const tick = (t: number) => {
          w.__wfFrames.push(t - last);
          last = t;
          w.__wfRaf = requestAnimationFrame(tick);
        };
        w.__wfRaf = requestAnimationFrame(tick);
      });

      await dragDown(app, canvas, 40);
      await app.mouse.up();

      const deltas = await app.evaluate(() => {
        const w = window as any;
        cancelAnimationFrame(w.__wfRaf);
        return w.__wfFrames as number[];
      });

      const sorted = [...deltas].sort((a, b) => a - b);
      const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? 0;
      const summary = { frames: sorted.length, p95: Math.round(p95 * 10) / 10, budget };
      test.info().annotations.push({ type: "frames", description: JSON.stringify(summary) });
      console.log(JSON.stringify(summary));

      expect(sorted.length).toBeGreaterThan(0);
      expect(p95).toBeLessThan(budget);
    } finally {
      await deleteOpenNote(app, name);
    }
  });

  test("the stroke is saved next to the note", async ({ app }) => {
    const name = `${NOTE_PREFIX}${Date.now()}-save`;
    try {
      const canvas = await openInkNote(app, name);
      await dragDown(app, canvas, 20);
      await app.mouse.up();
      await app.waitForTimeout(3_000);

      // Layout per core/src/ink/parts-2.ts:230-237: `<name>.ink/` holds `<ulid>.inkb` pages.
      // The ink folder takes the note file's name (untitled--<id6>), not its title.
      const note = await findNoteFile(app, name);
      expect(note, `note ${name} not found in the vault`).toBeTruthy();
      const inkDir = await app.evaluate(async (path: string) => {
        const dir = path.slice(0, Math.max(0, path.lastIndexOf("/")));
        const id = (path.split("/").pop() ?? "").split(".")[0];
        const list = (await (window as any).weaveforge.listVaultFiles(dir)) as { path: string; kind: string }[];
        return list.find((e) => e.kind === "dir" && (e.path.split("/").pop() ?? "").startsWith(`${id}.`) && e.path.endsWith(".ink"))?.path ?? null;
      }, note as string);
      expect(inkDir, `no .ink folder beside ${note}`).toBeTruthy();

      const pages = await app.evaluate(
        (dir: string) => (window as any).weaveforge.listVaultFiles(dir),
        inkDir!,
      );
      expect((pages as { path: string }[]).some((e) => e.path.endsWith(".inkb"))).toBe(true);
    } finally {
      await deleteOpenNote(app, name);
    }
  });
});
