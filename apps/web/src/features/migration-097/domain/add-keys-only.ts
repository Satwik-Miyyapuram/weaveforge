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
      const name = (key[1] ?? "").trim();
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

/** A value with every scalar as its text, so `8`, `"8"` and `8` written plain compare equal. */
function scalarsAsText(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scalarsAsText);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scalarsAsText(v)]));
  }
  return String(value);
}

/** One flow-list item or plain value: a quoted one is read as JSON, anything else as its trimmed text. */
function plainItem(text: string): unknown {
  const item = text.trim();
  if (!item.startsWith('"')) return item;
  try {
    return JSON.parse(item);
  } catch {
    return item;
  }
}

/**
 * A single-line key block read as its value, so quoting and list spacing are not changes: `a: x`, `a: "x"`, and
 * `t: [x, y]`, `t: ["x", "y"]`, `t: ["x","y"]` compare equal. A multi-line block stays its exact text.
 */
function plainBlock(block: string): string {
  const m = /^([^:]*):[ \t]*(.*?)[ \t]*$/.exec(block);
  if (!m || block.includes("\n")) return block;
  const raw = m[2] ?? "";
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    const list = /^\[(.*)\]$/.exec(raw);
    if (list && !/["']/.test(list[1] ?? "")) value = (list[1] ?? "").trim() === "" ? [] : (list[1] ?? "").split(",").map(plainItem);
    else value = plainItem(raw);
  }
  const key = m[1] ?? "";
  // A tag holds no spaces in a file (Obsidian reads `#a b` as `#a`), so `a b` and `a-b` are the same tag.
  if (key.trim() === "tags" && Array.isArray(value)) value = value.map((tag) => String(tag).replace(/ /g, "-"));
  return `${key}: ${JSON.stringify(scalarsAsText(value))}`;
}

/** True when every value in `prev` is in `next` unchanged: objects may gain keys at any depth, nothing else may change. */
function jsonSubset(prev: unknown, next: unknown): boolean {
  if (prev === null || typeof prev !== "object" || Array.isArray(prev)) {
    return JSON.stringify(prev) === JSON.stringify(next);
  }
  if (next === null || typeof next !== "object" || Array.isArray(next)) return false;
  const after = next as Record<string, unknown>;
  return Object.entries(prev).every(([key, value]) => key in after && jsonSubset(value, after[key]));
}

function parseJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
}

/**
 * True when `next` is `prev` plus added keys. For a note: the body is the same (a final newline aside), and every
 * top-level frontmatter key `prev` has keeps its value (quoting a single-line value is not a change). For a JSON
 * object: every value `prev` has is unchanged, objects only gaining keys. Anything else (a body edit, a changed or
 * removed key, a note with no frontmatter) is false.
 */
export function addsKeysOnly(prev: string, next: string): boolean {
  if (prev.trimStart().startsWith("{")) {
    const before = parseJson(prev);
    const after = parseJson(next);
    return before !== null && after !== null && jsonSubset(before.value, after.value);
  }
  const before = splitNote(prev);
  const after = splitNote(next);
  if (!before || !after || before.body.replace(/\n$/, "") !== after.body.replace(/\n$/, "")) return false;
  const oldKeys = keyBlocks(before.front);
  const newKeys = keyBlocks(after.front);
  if (!oldKeys || !newKeys) return false;
  for (const [name, lines] of oldKeys) {
    const added = newKeys.get(name);
    if (added === undefined || plainBlock(added) !== plainBlock(lines)) return false;
  }
  return true;
}

/** True when both blocks are `updated-at` timestamps and `prev`'s is strictly later. */
function isLater(prev: string | undefined, next: string | undefined): boolean {
  const time = (block: string | undefined) => {
    const parsed = block === undefined ? null : parseJson(plainBlock(block).replace(/^[^:]*:\s*/, ""));
    const value = typeof parsed?.value === "string" ? Date.parse(parsed.value) : NaN;
    return Number.isNaN(value) ? null : value;
  };
  const a = time(prev);
  const b = time(next);
  return a !== null && b !== null && a > b;
}

/**
 * The file `prev` with the keys only `next` has added to its frontmatter, or null when they disagree. The body and
 * every key both have must match (as addsKeysOnly compares them), unless `prev`'s `updated-at` is later, when its
 * values win; a key only `prev` has stays. `prev`'s own lines
 * are kept as written, so nothing in the file changes but the added keys. A JSON object merges only when `next`
 * already holds all of `prev` (addsKeysOnly), and is then `next`.
 */
export function mergeAddedKeys(prev: string, next: string): string | null {
  if (prev.trimStart().startsWith("{")) return addsKeysOnly(prev, next) ? next : null;
  const before = splitNote(prev);
  const after = splitNote(next);
  if (!before || !after || before.body.replace(/\n$/, "") !== after.body.replace(/\n$/, "")) return null;
  const oldKeys = keyBlocks(before.front);
  const newKeys = keyBlocks(after.front);
  if (!oldKeys || !newKeys) return null;
  // A file saved after the DB row was (a later `updated-at`) holds the newer values: they win over the DB's.
  const fileNewer = isLater(oldKeys.get("updated-at"), newKeys.get("updated-at"));
  const added: string[] = [];
  for (const [name, lines] of newKeys) {
    const old = oldKeys.get(name);
    if (old === undefined) added.push(lines);
    else if (!fileNewer && plainBlock(old) !== plainBlock(lines)) return null;
  }
  if (added.length === 0) return prev;
  return ["---", ...before.front, ...added, "---", before.body].join("\n");
}
