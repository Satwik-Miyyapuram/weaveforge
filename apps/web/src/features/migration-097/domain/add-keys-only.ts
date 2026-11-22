/** A note split at its frontmatter fences: the lines between them, and the body after the closing fence. */
type Note = { front: string[]; body: string };

function splitNote(text: string): Note | null {
  const lines = text.split("\n");
  if (lines[0] !== "---") return null;
  const close = lines.indexOf("---", 1);
  if (close < 0) return null;
  return { front: lines.slice(1, close), body: lines.slice(close + 1).join("\n") };
}

/**
 * The lines of each top-level key, in file order. A line indented, starting with `-`, or blank continues the key
 * above it. Null when a line comes before any key or a key repeats, so the caller refuses rather than guess.
 */
function keyBlocks(front: string[]): Map<string, string> | null {
  const blocks = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of front) {
    const key = /^([^\s-][^:]*):/.exec(line);
    if (key) {
      const name = key[1].trim();
      if (blocks.has(name)) return null;
      current = [line];
      blocks.set(name, current);
    } else if (current && (line.trim() === "" || /^\s/.test(line) || line.startsWith("-"))) {
      current.push(line);
    } else {
      return null;
    }
  }
  return new Map([...blocks].map(([name, lines]) => [name, lines.join("\n")]));
}

/**
 * True when `next` is `prev` plus added top-level frontmatter keys: the body is byte-identical, and every key `prev`
 * has keeps its exact lines. Anything else (a body edit, a changed key, a note with no frontmatter) is false.
 */
export function addsKeysOnly(prev: string, next: string): boolean {
  const before = splitNote(prev);
  const after = splitNote(next);
  if (!before || !after || before.body !== after.body) return false;
  const oldKeys = keyBlocks(before.front);
  const newKeys = keyBlocks(after.front);
  if (!oldKeys || !newKeys) return false;
  for (const [name, lines] of oldKeys) {
    if (newKeys.get(name) !== lines) return false;
  }
  return true;
}
