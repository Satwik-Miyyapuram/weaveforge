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

/** The items of a flow list's inside, split on commas outside double quotes: `a, "b, c"` is `a` and `"b, c"`. */
function listItems(inner: string): string[] {
  const items: string[] = [];
  let item = "";
  let quoted = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (quoted && ch === "\\") {
      item += ch + (inner[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      items.push(item);
      item = "";
    } else item += ch;
  }
  items.push(item);
  return items;
}

/** True when two note bodies are the same: trailing newlines aside, and an image linked as `vault:X` or `../assets/notes/X`. */
function sameBody(a: string, b: string): boolean {
  const plain = (body: string) => body.replace(/\((?:\.\.\/)+assets\/notes\//g, "(vault:").replace(/\n+$/, "");
  return plain(a) === plain(b);
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
    if (list && !/'/.test(list[1] ?? "")) value = (list[1] ?? "").trim() === "" ? [] : listItems(list[1] ?? "").map(plainItem);
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
  if (!before || !after || !sameBody(before.body, after.body)) return false;
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
 * True when `next` is `prev` with only ink added: the `<!-- weaveforge-ink … -->` header line at the top and blank
 * `<!-- page N -->` markers at the end. `prev` must have no ink header of its own (its ink, if any, is the legacy
 * `.ink.md` sidecar, which the header replaces).
 */
function addsInkOnly(prev: string, next: string): boolean {
  const header = /^<!-- weaveforge-ink [^\n]*-->(\n|$)/;
  if (header.test(prev) || !header.test(next)) return false;
  const text = next.replace(header, "").replace(/(\n+<!-- page \d+ -->)+\n*$/, "");
  return text.replace(/\n+$/, "") === prev.replace(/\n+$/, "");
}

/**
 * The file `prev` with the keys only `next` has added to its frontmatter, or null when they disagree. The body and
 * every key both have must match (as addsKeysOnly compares them), unless `prev`'s `updated-at` is later, when its
 * values win; a key only `prev` has stays. `prev`'s own lines
 * are kept as written, so nothing in the file changes but the added keys. A JSON object merges only when `next`
 * already holds all of `prev` (addsKeysOnly), and is then `next`.
 *
 * One more case: `next`'s body is `prev`'s with only ink added (addsInkOnly). The result then takes `next`'s body,
 * and the later of the two `updated-at` lines, since adding the ink is what moved it.
 */
export function mergeAddedKeys(prev: string, next: string): string | null {
  if (prev.trimStart().startsWith("{")) return addsKeysOnly(prev, next) ? next : null;
  const before = splitNote(prev);
  const after = splitNote(next);
  if (!before || !after) return null;
  const inkAdded = addsInkOnly(before.body, after.body);
  if (!inkAdded && !sameBody(before.body, after.body)) return null;
  const oldKeys = keyBlocks(before.front);
  const newKeys = keyBlocks(after.front);
  if (!oldKeys || !newKeys) return null;
  // A file saved after the DB row was (a later `updated-at`) holds the newer values: they win over the DB's.
  const fileNewer = isLater(oldKeys.get("updated-at"), newKeys.get("updated-at"));
  const added: string[] = [];
  let front = before.front;
  for (const [name, lines] of newKeys) {
    const old = oldKeys.get(name);
    if (old === undefined) added.push(lines);
    else if (inkAdded && name === "updated-at" && !old.includes("\n")) {
      if (!fileNewer) front = keyBlocksReplaced(before.front, name, lines);
    } else if (!fileNewer && plainBlock(old) !== plainBlock(lines)) return null;
  }
  const body = inkAdded ? after.body : before.body;
  if (added.length === 0 && front === before.front && body === before.body) return prev;
  return ["---", ...front, ...added, "---", body].join("\n");
}

/** `front` with the single-line block of key `name` replaced by `lines`. */
function keyBlocksReplaced(front: string[], name: string, lines: string): string[] {
  return front.map((line) => (/^([^\s-][^:]*):/.exec(line)?.[1]?.trim() === name ? lines : line));
}
