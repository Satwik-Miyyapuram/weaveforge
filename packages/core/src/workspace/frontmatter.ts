/**
 * YAML-ish frontmatter for workspace files.
 *
 * Deliberately a mini-parser rather than a YAML library, matching the existing
 * `stripFrontmatter` in the vault domain. The folder is user-editable and can
 * come from anywhere, so the parser's narrowness is a feature: it has no
 * deserialization surface to attack, and it cannot be talked into constructing
 * objects. It handles exactly what this format emits — scalars and flow lists.
 */

export type FrontmatterValue = string | number | boolean | string[];

export interface ParsedDocument {
  frontmatter: Record<string, FrontmatterValue>;
  body: string;
}

/** Quote when a value could otherwise be misread as a list, number, or bool. */
function quoteScalar(value: string): string {
  if (value === "") return '""';
  if (/^[\w./@+-]+$/.test(value) && !/^(true|false|null|~)$/i.test(value) && !/^-?\d/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function renderValue(value: FrontmatterValue): string {
  if (Array.isArray(value)) return `[${value.map((v) => quoteScalar(String(v))).join(", ")}]`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return quoteScalar(value);
}

/**
 * Serialize frontmatter + body. Keys are emitted in the order given so
 * re-serializing an unchanged workspace produces byte-identical files and git
 * diffs stay meaningful.
 */
export function writeFrontmatter(
  frontmatter: Record<string, FrontmatterValue | undefined>,
  body: string,
): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    lines.push(`${key}: ${renderValue(value)}`);
  }
  lines.push("---", "");
  return `${lines.join("\n")}${body}`;
}

function unquote(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  // Single quotes are never written here, but they are ordinary YAML and an
  // outside editor may have written them. In single-quoted YAML the only
  // escape is a doubled quote.
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function parseValue(raw: string): FrontmatterValue {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    // Split on commas outside quotes so `["a, b", c]` stays two entries.
    const out: string[] = [];
    let buffer = "";
    let quoted = false;
    for (let i = 0; i < inner.length; i += 1) {
      const char = inner[i]!;
      if (char === '"' && inner[i - 1] !== "\\") quoted = !quoted;
      if (char === "," && !quoted) {
        out.push(unquote(buffer));
        buffer = "";
        continue;
      }
      buffer += char;
    }
    if (buffer.trim()) out.push(unquote(buffer));
    return out.filter((entry) => entry.length > 0);
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  return unquote(trimmed);
}

/**
 * Split a file into frontmatter and body. A file without frontmatter is all
 * body — hand-created files must not be rejected, only treated as new.
 */
const KEY_LINE = /^([A-Za-z0-9_-]+):\s*(.*)$/;
const BLOCK_ITEM = /^\s+-\s*(.*)$/;

/** How far a line is indented, for deciding what belongs to the key above it. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

export function readFrontmatter(content: string): ParsedDocument {
  const match = /^\ufeff?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, FrontmatterValue> = {};
  const lines = match[1]!.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    // Only a top-level key starts an entry. Anything indented is either
    // consumed below as a block list or belongs to a nested map we skip.
    if (indentOf(line) > 0) continue;
    const entry = KEY_LINE.exec(line);
    if (!entry) continue;
    const key = entry[1]!;
    const inline = entry[2] ?? "";

    if (inline.trim()) {
      frontmatter[key] = parseValue(inline);
      continue;
    }

    // An empty value means the value is on the lines below: a block list,
    // which every outside editor writes by default and which we understand,
    // or a nested map, which we do not model. Both are consumed either way —
    // the difference is that a map leaves no key behind rather than a
    // misleading empty string.
    const items: string[] = [];
    let cursor = i;
    let nested = false;
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j]!;
      if (!next.trim()) continue;
      if (indentOf(next) === 0) break;
      cursor = j;
      const item = BLOCK_ITEM.exec(next);
      if (!item) {
        nested = true;
        continue;
      }
      const value = unquote(item[1] ?? "");
      if (value) items.push(value);
    }

    if (nested) {
      // Skip it entirely: a half-read map is worse than an absent key.
    } else if (cursor > i) {
      frontmatter[key] = items;
    } else {
      frontmatter[key] = "";
    }
    i = cursor;
  }

  return { frontmatter, body: content.slice(match[0].length) };
}

/** Read a frontmatter field as a string, whatever scalar type it parsed as. */
export function frontmatterString(
  frontmatter: Record<string, FrontmatterValue>,
  key: string,
): string | undefined {
  const value = frontmatter[key];
  if (value === undefined || Array.isArray(value)) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

export function frontmatterList(
  frontmatter: Record<string, FrontmatterValue>,
  key: string,
): string[] {
  const value = frontmatter[key];
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}
