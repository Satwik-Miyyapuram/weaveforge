/**
 * Whether each PDF page sits beside a blank page to write on.
 *
 * Per user, in `localStorage` like the reader's other switches. On unless
 * turned off: the reader writes beside the paper by default.
 */

const WRITING_PAGE_KEY = "weaveforge.reader.writingPage";

export function readWritingPage(): boolean {
  try {
    return window.localStorage.getItem(WRITING_PAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeWritingPage(on: boolean): void {
  try {
    window.localStorage.setItem(WRITING_PAGE_KEY, on ? "1" : "0");
  } catch {
    // Private mode or blocked storage: the setting lasts for this visit.
  }
}
