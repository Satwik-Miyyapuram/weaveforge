/**
 * What the app itself last wrote to each folder path, so the folder watcher can tell
 * its own write echoing back from somebody else's edit. Text is kept as a short hash;
 * a binary write is remembered by path only. Bounded: the oldest path goes first.
 */
const MAX_PATHS = 2000;
const BINARY = "binary";
const written = new Map<string, string>();

function hash(text: string): string {
  // FNV-1a, 32-bit, plus the length: enough to tell an echo from an edit.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}:${(h >>> 0).toString(16)}`;
}

export function recordOwnWrite(path: string, data: Uint8Array | string): void {
  written.delete(path);
  written.set(path, typeof data === "string" ? hash(data) : BINARY);
  if (written.size > MAX_PATHS) written.delete(written.keys().next().value as string);
}

/** Whether `text` at `path` is what the app last wrote there. */
export function isOwnWrite(path: string, text: string): boolean {
  const seen = written.get(path);
  return seen === BINARY || (seen !== undefined && seen === hash(text));
}

export function forgetOwnWrites(): void {
  written.clear();
}
