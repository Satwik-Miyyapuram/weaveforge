import type { Page } from "@playwright/test";

/**
 * The paper note is always open and saves itself: there is no "Edit note" or
 * "Save note" button. Its text editor is the CodeMirror inside
 * `.workspace-editor`.
 */
export function noteEditor(page: Page) {
  return page.locator(".workspace-editor .cm-content");
}

/** The note saves 1.5s after the last keystroke; wait past that and the write. */
export async function waitForNoteSave(page: Page) {
  await page.waitForTimeout(5_000);
}

/** "Refresh paper details" lives in the note bar's More menu. */
export async function refreshPaperDetails(page: Page) {
  await page.getByRole("button", { name: "More ink options" }).click();
  await page.getByRole("menuitem", { name: "Refresh paper details" }).click();
}

/** Turn on the rendered preview beside the text, where equations draw. */
export async function showNotePreview(page: Page) {
  const preview = page.getByRole("button", { name: "Preview", exact: true });
  if ((await preview.getAttribute("aria-pressed")) !== "true") await preview.click();
}
