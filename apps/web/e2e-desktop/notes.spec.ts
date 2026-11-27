/** Notes in the running Dev app: typing survives autosave with no reload or conflict copy, and a deleted note stays deleted. */
import { expect, test } from "./dev-app";

// Selectors, all found in apps/web/src (no test ids exist for these):
// - "New note" button: components/button.tsx:63 sets aria-label from the IconButton label; used at features/editor-workspace/ui/explorer-panel.tsx:429.
// - Name input for a new note: features/editor-workspace/ui/explorer-glyphs.tsx:72-78 (class `explorer-inline-title`); Enter commits via lib/parts.ts isCommitEnter.
// - Explorer rows: features/editor-workspace/ui/explorer-panel.tsx:540 (role="treeitem", data-row-key).
// - Visible note editor: features/editor-workspace/ui/pane-view.tsx:325 (`.pane-document`, hidden when not shown); CodeMirror `.cm-content` (markdown/markdown-editor-extensions.ts:315).
// - Toasts: components/toast-host.tsx:19,23,31 (`.toast-region`, `.toast`, `.toast-message`).
// - Folder-change toast text: features/workspace/ui/folder-change-note.tsx:10 ("... reloaded.").

const TOAST_BAD = /reloaded|changed outside|conflict/i;

/** Waits for the open note's CodeMirror, then returns the visible one. */
function visibleEditor(app: import("@playwright/test").Page) {
  return app.locator(".pane-document:not([hidden]) .cm-content").first();
}

/** Creates a note in the explorer through the "New note" button and the name box. */
async function createNote(app: import("@playwright/test").Page, name: string) {
  await app.getByRole("button", { name: "New note", exact: true }).click();
  const input = app.locator("input.explorer-inline-title");
  await input.fill(name);
  await input.press("Enter");
  await expect(app.getByRole("treeitem").filter({ hasText: name }).first()).toBeVisible({ timeout: 15_000 });
}

test.describe("notes", () => {
  test("typing with autosave keeps the text, focus, and no reload or conflict copy", async ({ app }) => {
    const name = `e2e-typing-${Date.now()}`;
    await createNote(app, name);

    // Collect every toast that shows up while typing.
    await app.evaluate(() => {
      const seen: string[] = ((window as any).__e2eToasts = []);
      const scan = () => {
        for (const el of document.querySelectorAll(".toast-message")) seen.push(el.textContent ?? "");
      };
      new MutationObserver(scan).observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    const editor = visibleEditor(app);
    await editor.click();

    const bursts = [
      "The quick brown fox jumps over the lazy dog while the ",
      "autosave timer runs between each burst of typed words ",
      "so the note is written to disk in the middle of typing ",
      "and the editor must keep every single character in order ",
      "without reloading or making a conflict copy of the file.",
    ];
    const expected = bursts.join("");
    for (const burst of bursts) {
      await app.keyboard.type(burst, { delay: 15 });
      await app.waitForTimeout(1_500);
    }
    // Let the last autosave finish before reading back.
    await app.waitForTimeout(3_000);

    // Focus stays in the editor and the text matches exactly.
    const focusedInEditor = await app.evaluate(() => document.activeElement?.closest(".cm-content") !== null);
    expect(focusedInEditor).toBe(true);
    const text = await app.evaluate(() =>
      [...document.querySelectorAll(".pane-document:not([hidden]) .cm-line")].map((l) => l.textContent ?? "").join("\n"),
    );
    expect(text).toBe(expected);

    // No reload, conflict, or outside-change toast appeared.
    const toasts: string[] = await app.evaluate(() => (window as any).__e2eToasts ?? []);
    expect(toasts.filter((t) => TOAST_BAD.test(t))).toEqual([]);

    // The note's folder holds no conflict copy next to it.
    const folder = await app.evaluate(async (stem) => {
      const bridge = (window as any).weaveforge;
      const root = await bridge.listVaultFiles("");
      const hit = root.find((e: { path: string; kind: string }) => e.kind === "file" && e.path.includes(stem));
      if (!hit) return null;
      const i = hit.path.lastIndexOf("/");
      return i < 0 ? "" : hit.path.slice(0, i);
    }, name);
    expect(folder, "note file not found in the vault root listing").not.toBeNull();
    const siblings = await app.evaluate(async (dir) => {
      const list = await (window as any).weaveforge.listVaultFiles(dir);
      return list.map((e: { path: string }) => e.path);
    }, folder as string);
    expect(siblings.filter((p: string) => /conflict/i.test(p))).toEqual([]);

    // The note stays in the Dev workspace; its name carries the run time.
  });

  // The explorer has no delete action; the note editor's "Delete note"
  // (features/vault/ui/vault-screen/page-editor.tsx) deletes the file note, since files mode wires
  // container.vault to FileNoteRepository. Fill in the step against a live Dev, then drop fixme.
  test.fixme("a deleted note stays deleted after reload", async ({ app }) => {
    const name = `e2e-delete-${Date.now()}`;
    await createNote(app, name);
    // Delete step goes here once a UI action with a source selector exists.
    await app.reload();
    await app.waitForTimeout(5_000);
    await expect(app.getByRole("treeitem").filter({ hasText: name })).toHaveCount(0);
    const stillThere = await app.evaluate(async (stem) => {
      const root = await (window as any).weaveforge.listVaultFiles("");
      return root.some((e: { path: string }) => e.path.includes(stem));
    }, name);
    expect(stillThere).toBe(false);
  });
});
