/**
 * Reading-list membership kept in a paper's or note's own frontmatter (0.9.7 L3).
 * `lists: ["[[L]]"]` names each list the file is in, and `list-notes: {"[[L]]": "…"}`
 * holds the reader's note for that list. Both are one line of JSON (valid YAML flow).
 * Every other line of the file is kept byte for byte. A file with no frontmatter gets
 * a block in front of its body when it joins a list. Both keys also read as YAML blocks (a
 * sequence for `lists`, a mapping for `list-notes`, plain scalars allowed), and a rewrite keeps
 * the style the key already has. A value that is not readable is never read as empty or
 * overwritten: reads and writes both throw.
 */

const FRONT = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/** A membership value that cannot be read; the file is left as it is. */
export class UnreadableFrontmatter extends Error {}

export interface MemberFields {
  lists: string[];
  listNotes: Record<string, string>;
}

interface Front {
  /** `---` plus the file's line end. */
  open: string;
  lines: string[];
  /** The closing `---` line, with its line end. */
  close: string;
  body: string;
}

function splitFront(text: string): Front | null {
  const m = FRONT.exec(text);
  if (!m) return null;
  return {
    open: text.startsWith("---\r\n") ? "---\r\n" : "---\n",
    lines: m[1] === undefined ? [] : m[1].split(/\r?\n/),
    close: m[0].slice(m[0].lastIndexOf("---")),
    body: text.slice(m[0].length),
  };
}

function render(f: Front, lines: readonly string[]): string {
  const eol = f.open.endsWith("\r\n") ? "\r\n" : "\n";
  return f.open + lines.map((line) => line + eol).join("") + f.close + f.body;
}

/** The lines of a top-level key: its own line, then the indented lines and the `- ` items under it (YAML allows items at the key's column). */
function keyExtent(lines: readonly string[], key: string): { start: number; end: number } | null {
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && /^(\s|-(\s|$))/.test(lines[end]!)) end += 1;
  return { start, end };
}

function setLine(lines: string[], key: string, value: string | null): void {
  const at = keyExtent(lines, key);
  const replacement = value === null ? [] : [`${key}: ${value}`];
  if (at) lines.splice(at.start, at.end - at.start, ...replacement);
  else lines.push(...replacement);
}

const UNREADABLE = Symbol("unreadable");

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return UNREADABLE;
  }
}

const LITERAL = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/;

/**
 * A scalar: a double- or single-quoted one, with an optional trailing comment; a quoted one that does not
 * parse is unreadable. An unquoted number, bool or null parses as JSON, as before (so a block item of one
 * is refused, not read as link text). Otherwise it is its own text: a list item drops a `#` comment only
 * after a closing `]]` (`- [[L]] # note`, never inside `[[My #x note]]`); a note value keeps its text whole.
 */
function scalarAt(raw: string, listItem: boolean): unknown {
  const dq = /^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(raw);
  if (dq) return parseJson(dq[1]!);
  const sq = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(raw);
  if (sq) return sq[1]!.replace(/''/g, "'");
  if (raw.startsWith('"') || raw.startsWith("'")) return UNREADABLE;
  if (LITERAL.test(raw)) return JSON.parse(raw);
  if (!listItem) return raw.trim();
  return (/^(.*\]\])\s+#.*$/.exec(raw)?.[1] ?? raw).trim();
}

const ITEM = /^\s*-\s+(.*)$/;
const PAIR = /^\s+("(?:[^"\\]|\\.)*"|[^\s"'-].*?)\s*:\s+(.*)$/;

interface BlockItem {
  line: string;
  /** The item's string, or the mapping's key. */
  id: string;
  /** The item's string, or the mapping's value. */
  value: string;
}

/** A YAML block: a sequence of strings (`- …`) or a mapping of strings (`key: value`, Obsidian's list-notes). */
interface Block {
  kind: "seq" | "map";
  items: BlockItem[];
}

/** The block's items, or null when any line is neither a string item nor a string mapping pair. */
function parseBlock(body: readonly string[]): Block | null {
  if (body.every((line) => ITEM.test(line))) {
    const items: BlockItem[] = [];
    for (const line of body) {
      const value = scalarAt(ITEM.exec(line)![1]!.trim(), true);
      if (typeof value !== "string") return null;
      items.push({ line, id: value, value });
    }
    return { kind: "seq", items };
  }
  if (body.every((line) => PAIR.test(line))) {
    const items: BlockItem[] = [];
    for (const line of body) {
      const [, rawKey, rawValue] = PAIR.exec(line)!;
      const id = rawKey!.startsWith('"') ? parseJson(rawKey!) : rawKey!;
      const value = scalarAt(rawValue!.trim(), false);
      if (typeof id !== "string" || typeof value !== "string") return null;
      items.push({ line, id, value });
    }
    return { kind: "map", items };
  }
  return null;
}

/**
 * The key's value: undefined when absent, null for an empty `key:`, UNREADABLE when it is neither
 * one line of JSON (flow form) nor a YAML block (see parseBlock).
 */
function valueAt(lines: readonly string[], key: string): unknown {
  const at = keyExtent(lines, key);
  if (!at) return undefined;
  const first = lines[at.start]!.slice(key.length + 1).trim();
  if (first !== "") return parseJson(first);
  const body = lines.slice(at.start + 1, at.end);
  if (body.length === 0) return null;
  const block = parseBlock(body);
  if (!block) return UNREADABLE;
  return block.kind === "seq"
    ? block.items.map((item) => item.value)
    : Object.fromEntries(block.items.map((item) => [item.id, item.value]));
}

/**
 * The block with the next value written into it: items that stay keep their original line, a
 * removed item's line goes, a new one is added under the same indent. Keeps the block's style.
 */
function rewriteBlock(block: Block, next: string[] | Record<string, string>, indent: string): string[] {
  const out: string[] = [];
  if (Array.isArray(next)) {
    const kept = new Set<string>();
    for (const item of block.items) {
      if (next.includes(item.id) && !kept.has(item.id)) {
        kept.add(item.id);
        out.push(item.line);
      }
    }
    for (const id of next) if (!kept.has(id)) out.push(`${indent}- ${JSON.stringify(id)}`);
    return out;
  }
  const seen = new Set<string>();
  for (const item of block.items) {
    if (!Object.hasOwn(next, item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    const value = next[item.id]!;
    out.push(value === item.value ? item.line : `${indent}${JSON.stringify(item.id)}: ${JSON.stringify(value)}`);
  }
  for (const [id, value] of Object.entries(next)) {
    if (!seen.has(id)) out.push(`${indent}${JSON.stringify(id)}: ${JSON.stringify(value)}`);
  }
  return out;
}

/** Writes a field in the style it already has: a block stays a block, anything else is one JSON line. An empty value removes the key. */
function setField(lines: string[], key: string, value: string[] | Record<string, string>): void {
  const empty = Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
  const at = keyExtent(lines, key);
  const isBlock = at !== null && lines[at.start]!.slice(key.length + 1).trim() === "" && at.end > at.start + 1;
  if (at && isBlock && !empty) {
    const body = lines.slice(at.start + 1, at.end);
    const block = parseBlock(body);
    if (!block || (block.kind === "seq") !== Array.isArray(value)) {
      throw new UnreadableFrontmatter(`The ${key} frontmatter is not readable; membership not changed.`);
    }
    lines.splice(at.start + 1, at.end - at.start - 1, ...rewriteBlock(block, value, /^\s*/.exec(body[0]!)![0]));
    return;
  }
  setLine(lines, key, empty ? null : JSON.stringify(value));
}

function isStrings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isStringMap(v: unknown): v is Record<string, string> {
  return v !== null && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
}

/** The fields, and the keys whose value could not be read. */
function readFields(lines: readonly string[]): { fields: MemberFields; unreadable: string[] } {
  const unreadable: string[] = [];
  const rawLists = valueAt(lines, "lists");
  const rawNotes = valueAt(lines, "list-notes");
  const lists =
    rawLists === undefined || rawLists === null ? [] : isStrings(rawLists) ? rawLists : (unreadable.push("lists"), []);
  const listNotes =
    rawNotes === undefined || rawNotes === null
      ? {}
      : isStringMap(rawNotes)
        ? rawNotes
        : (unreadable.push("list-notes"), {});
  return { fields: { lists, listNotes }, unreadable };
}

/** An unreadable value is never read as empty: reads and writes both throw, so nothing is lost. */
function refuseIfUnreadable(unreadable: readonly string[]): void {
  if (unreadable.length) {
    throw new UnreadableFrontmatter(`The ${unreadable.join(" and ")} frontmatter is not readable; membership not changed.`);
  }
}

/** The lists a paper or note is in, and its note for each. Throws when a value is not readable. */
export function readMemberFields(text: string): MemberFields {
  const f = splitFront(text);
  if (!f) return { lists: [], listNotes: {} };
  const { fields, unreadable } = readFields(f.lines);
  refuseIfUnreadable(unreadable);
  return fields;
}

/** Adds the list (idempotent) and sets its note; no note clears the list's note. */
export function addListMembership(text: string, link: string, note?: string): string {
  const f = splitFront(text) ?? { open: "---\n", lines: [], close: "---\n", body: text };
  const { fields, unreadable } = readFields(f.lines);
  refuseIfUnreadable(unreadable);
  const lists = fields.lists.includes(link) ? fields.lists : [...fields.lists, link];
  const listNotes = { ...fields.listNotes };
  if (note) listNotes[link] = note;
  else delete listNotes[link];
  const lines = [...f.lines];
  setField(lines, "lists", lists);
  setField(lines, "list-notes", listNotes);
  return render(f, lines);
}

/** Removes the list and its note; a key left empty is dropped. Text without the list is returned as it is. */
export function removeListMembership(text: string, link: string): string {
  const f = splitFront(text);
  if (!f) return text;
  const { fields, unreadable } = readFields(f.lines);
  refuseIfUnreadable(unreadable);
  if (!fields.lists.includes(link) && !Object.hasOwn(fields.listNotes, link)) return text;
  const lists = fields.lists.filter((l) => l !== link);
  const listNotes = { ...fields.listNotes };
  delete listNotes[link];
  const lines = [...f.lines];
  setField(lines, "lists", lists);
  setField(lines, "list-notes", listNotes);
  return render(f, lines);
}

/**
 * A list's `[[L]]`: its file's name minus `.md`. The basename keeps its `--<id>` suffix on
 * purpose: the link must match the file name exactly, and the suffix keeps two lists with the
 * same title apart.
 */
export function listLinkFor(path: string): string {
  return `[[${path.slice(path.lastIndexOf("/") + 1, -".md".length)}]]`;
}

/** Sets top-level keys to JSON values (null removes the key); every other line is kept byte for byte. */
export function setFrontmatterKeys(text: string, values: Record<string, unknown>): string {
  const f = splitFront(text);
  if (!f) return text;
  const lines = [...f.lines];
  for (const [key, value] of Object.entries(values)) {
    setLine(lines, key, value === null ? null : JSON.stringify(value));
  }
  return render(f, lines);
}
