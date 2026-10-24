/**
 * Whether each PDF page sits beside a blank page to write on.
 *
 * Per user, in `localStorage` like the reader's other switches. On unless
 * turned off: the reader writes beside the paper by default.
 */

import { readStored, writeStored } from "@/lib/safe-storage";

const WRITING_PAGE_KEY = "weaveforge.reader.writingPage";

export function readWritingPage(): boolean {
  return readStored(WRITING_PAGE_KEY) !== "0";
}

/** Private mode or blocked storage: the setting lasts for this visit. */
export function writeWritingPage(on: boolean): void {
  writeStored(WRITING_PAGE_KEY, on ? "1" : "0");
}
