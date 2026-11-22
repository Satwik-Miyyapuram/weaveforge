/**
 * Reading-list membership kept in a paper's or note's own frontmatter (0.9.7 L3).
 * `lists: ["[[L]]"]` names each list the file is in, and `list-notes: {"[[L]]": "…"}`
 * holds the reader's note for that list. Both are one line of JSON (valid YAML flow).
 * Every other line of the file is kept byte for byte. A file with no frontmatter gets
 * a block in front of its body when it joins a list. A value that is not readable is
 * never overwritten: a write throws instead.
 */

const FRONT = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

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

/** The lines of a top-level key: its own line and the indented lines under it. */
function keyExtent(lines: readonly string[], key: string): { start: number; end: number } | null {
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && /^\s/.test(lines[end]!)) end += 1;
  return { start, end };
}

function setLine(lines: string[], key: string, value: string | null): void {
  const at = keyExtent(lines, key);
  const replacement = value === null ? [] : [`${key}: ${value}`];
  if (at) lines.splice(at.start, at.end - at.start, ...replacement);
  else lines.push(...replacement);
}

const UNREADABLE = Symbol("unreadable");

/** The key's value as JSON: undefined when absent, UNREADABLE when it is not one line of JSON. */
function jsonAt(lines: readonly string[], key: string): unknown {
  const at = keyExtent(lines, key);
  if (!at) return undefined;
  const raw = lines.slice(at.start, at.end).join("\n").slice(key.length + 1).trim();
  try {
    return JSON.parse(raw);
  } catch {
    return UNREADABLE;
  }
}

function isStrings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isStringMap(v: unknown): v is Record<string, string> {
  return v !== null && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
}

/** The fields, and the keys whose value could not be read (those read as empty). */
function readFields(lines: readonly string[]): { fields: MemberFields; unreadable: string[] } {
  const unreadable: string[] = [];
  const rawLists = jsonAt(lines, "lists");
  const rawNotes = jsonAt(lines, "list-notes");
  const lists = rawLists === undefined ? [] : isStrings(rawLists) ? rawLists : (unreadable.push("lists"), []);
  const listNotes =
    rawNotes === undefined ? {} : isStringMap(rawNotes) ? rawNotes : (unreadable.push("list-notes"), {});
  return { fields: { lists, listNotes }, unreadable };
}

function refuseIfUnreadable(unreadable: readonly string[]): void {
  if (unreadable.length) {
    throw new Error(`The ${unreadable.join(" and ")} frontmatter is not readable; membership not changed.`);
  }
}

/** The lists a paper or note is in, and its note for each. Unreadable values read as none. */
export function readMemberFields(text: string): MemberFields {
  const f = splitFront(text);
  return f ? readFields(f.lines).fields : { lists: [], listNotes: {} };
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
  setLine(lines, "lists", JSON.stringify(lists));
  setLine(lines, "list-notes", Object.keys(listNotes).length ? JSON.stringify(listNotes) : null);
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
  setLine(lines, "lists", lists.length ? JSON.stringify(lists) : null);
  setLine(lines, "list-notes", Object.keys(listNotes).length ? JSON.stringify(listNotes) : null);
  return render(f, lines);
}

/** Drops top-level frontmatter keys (for the legacy list keys); the rest is kept byte for byte. */
export function dropFrontmatterKeys(text: string, keys: readonly string[]): string {
  const f = splitFront(text);
  if (!f) return text;
  const lines = [...f.lines];
  for (const key of keys) setLine(lines, key, null);
  return render(f, lines);
}
