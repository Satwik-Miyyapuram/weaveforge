/**
 * Reading a `.bib` well enough to ask questions about it — pure, no I/O.
 *
 * This is deliberately not a BibTeX implementation. It never re-renders an
 * entry and never resolves a macro, so the hard parts of the format — string
 * concatenation, `@preamble`, accent commands — do not need to be right, only
 * survivable. What it has to get right is the shape: which entries exist, what
 * they are called, which fields they carry, and where in which file to find
 * them, because every one of those is something a person will be asked to go
 * and fix.
 *
 * Anything it cannot make sense of becomes a warning rather than an exception.
 * A bibliography with one broken entry in it is exactly the bibliography
 * somebody needs this to read.
 */

import type { LatexSourceFile } from "./latex-section-tree.js";

export interface BibEntry {
  /** Lower-cased entry type: `article`, `inproceedings`, `misc`. */
  type: string;
  key: string;
  /** Field names lower-cased; values are the literal text, braces stripped. */
  fields: Record<string, string>;
  file: string;
  /** 1-based line of the `@`. */
  line: number;
}

export interface BibWarning {
  file: string;
  line: number;
  message: string;
}

export interface BibParseResult {
  entries: BibEntry[];
  warnings: BibWarning[];
}

/** Entry types that declare no reference and are skipped without comment. */
const NOT_REFERENCES = new Set(["comment", "preamble", "string"]);

/** A position in one file that knows which line it is on. */
class Cursor {
  pos = 0;
  private line = 1;

  constructor(readonly text: string) {}

  /** Move to `next`, counting the lines crossed on the way. */
  moveTo(next: number): void {
    const from = Math.min(this.pos, next);
    const to = Math.max(this.pos, next);
    if (next >= this.pos) {
      for (let i = from; i < to; i += 1) if (this.text[i] === "\n") this.line += 1;
    } else {
      for (let i = from; i < to; i += 1) if (this.text[i] === "\n") this.line -= 1;
    }
    this.pos = next;
  }

  get lineNumber(): number {
    return this.line;
  }

  skipSpace(): void {
    let i = this.pos;
    while (i < this.text.length && /\s/.test(this.text[i] as string)) i += 1;
    this.moveTo(i);
  }
}

/**
 * The index just past the `}` closing the brace at `open`, or -1 when the file
 * ends first. Quoted strings are not special here: BibTeX counts braces inside
 * quotes too, and an entry whose braces do not balance is broken either way.
 */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Strip one layer of `{}` or `""` from a field value and collapse whitespace. */
function unwrap(value: string): string {
  let text = value.trim();
  while (
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith('"') && text.endsWith('"'))
  ) {
    const inner = text.slice(1, -1);
    // Only strip when the wrapper is a single pair: `{a} and {b}` is not wrapped.
    if (text.startsWith("{") && matchBrace(text, 0) !== text.length) break;
    text = inner.trim();
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Split an entry body into `name = value` pairs.
 *
 * Commas inside braces or quotes do not separate fields, which is the only
 * reason this is not `body.split(",")`.
 */
function splitFields(body: string): { name: string; value: string }[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === '"' && depth === 0) quoted = !quoted;
    else if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === "," && depth === 0 && !quoted) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));

  const fields: { name: string; value: string }[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim().toLowerCase();
    if (!name || !/^[a-z][a-z0-9_:.-]*$/.test(name)) continue;
    fields.push({ name, value: unwrap(part.slice(eq + 1)) });
  }
  return fields;
}

function parseOne(file: string, cursor: Cursor, result: BibParseResult): boolean {
  const { text } = cursor;
  const at = text.indexOf("@", cursor.pos);
  if (at < 0) {
    cursor.moveTo(text.length);
    return false;
  }
  cursor.moveTo(at);
  const line = cursor.lineNumber;

  const open = text.indexOf("{", at);
  const typeMatch = /^@\s*([A-Za-z]+)\s*$/.exec(open < 0 ? "" : text.slice(at, open));
  if (open < 0 || !typeMatch) {
    cursor.moveTo(at + 1);
    return true;
  }
  const type = (typeMatch[1] as string).toLowerCase();

  const close = matchBrace(text, open);
  if (close < 0) {
    result.warnings.push({ file, line, message: `@${type} is never closed — a '}' is missing.` });
    cursor.moveTo(text.length);
    return false;
  }
  cursor.moveTo(close);
  if (NOT_REFERENCES.has(type)) return true;

  const inner = text.slice(open + 1, close - 1);
  const comma = inner.indexOf(",");
  const key = (comma < 0 ? inner : inner.slice(0, comma)).trim();
  if (!key) {
    result.warnings.push({ file, line, message: `@${type} has no citation key.` });
    return true;
  }

  const fields: Record<string, string> = {};
  for (const field of splitFields(comma < 0 ? "" : inner.slice(comma + 1))) {
    if (field.name in fields) {
      result.warnings.push({
        file,
        line,
        message: `${key} names '${field.name}' twice; the later one is used.`,
      });
    }
    fields[field.name] = field.value;
  }
  result.entries.push({ type, key, fields, file, line });
  return true;
}

/** Read every `.bib` among these files. Non-`.bib` files are ignored. */
export function parseBibEntries(files: readonly LatexSourceFile[]): BibParseResult {
  const result: BibParseResult = { entries: [], warnings: [] };
  for (const file of files) {
    if (!file.path.toLowerCase().endsWith(".bib")) continue;
    const cursor = new Cursor(file.content);
    while (parseOne(file.path, cursor, result)) {
      /* until the file runs out */
    }
  }
  return result;
}
