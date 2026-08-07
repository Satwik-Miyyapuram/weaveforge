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
export function readFrontmatter(content: string): ParsedDocument {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, FrontmatterValue> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const entry = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!entry) continue;
    frontmatter[entry[1]!] = parseValue(entry[2] ?? "");
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
