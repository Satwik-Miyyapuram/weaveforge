/**
 * A conflict copy holds the DB version of a row, but under `conflictOf` instead of `id`, so files mode never
 * sees two files with the same id. These two functions convert a row file's text to that form and back.
 * JSON text renames the top-level key; markdown text renames the `id:` line of its leading frontmatter block.
 */

const FRONTMATTER_ID = /^id:/m;
const FRONTMATTER_CONFLICT_OF = /^conflictOf:/m;

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The leading `---` ... `---` frontmatter block, or null when the text has none. */
function frontmatter(text: string): { start: number; end: number } | null {
  if (!text.startsWith("---")) return null;
  const close = text.indexOf("\n---", 3);
  return close === -1 ? null : { start: 0, end: close };
}

/** The copy form of `text` for the row whose id is `id`. Text with no id line is returned unchanged. */
export function toConflictCopyText(text: string, id: string): string {
  const obj = parseObject(text);
  if (obj) {
    if (!("id" in obj)) return text;
    const { id: _dropped, ...rest } = obj;
    return JSON.stringify({ conflictOf: id, ...rest });
  }
  const block = frontmatter(text);
  if (!block) return text;
  const head = text.slice(block.start, block.end);
  return head.replace(FRONTMATTER_ID, "conflictOf:") + text.slice(block.end);
}

const FRONTMATTER_APP_ID = /^weaveforge-id:/m;

/**
 * The copy form of an app file (a note or paper): its frontmatter `weaveforge-id:` line becomes `conflictOf:`, so
 * the app never lists two files with one id. Other text, and bytes, are returned unchanged.
 */
export function toAppConflictCopy<T extends string | Uint8Array>(data: T): T {
  if (typeof data !== "string") return data;
  const block = frontmatter(data);
  if (!block) return data;
  const head = data.slice(block.start, block.end);
  return (head.replace(FRONTMATTER_APP_ID, "conflictOf:") + data.slice(block.end)) as T;
}

/** The row form of a conflict copy's text: `conflictOf` is read back as `id`, so the codec can decode it. */
export function fromConflictCopyText(text: string): string {
  const obj = parseObject(text);
  if (obj) {
    if (!("conflictOf" in obj)) return text;
    const { conflictOf, ...rest } = obj;
    return JSON.stringify({ id: conflictOf, ...rest });
  }
  const block = frontmatter(text);
  if (!block) return text;
  const head = text.slice(block.start, block.end);
  return head.replace(FRONTMATTER_CONFLICT_OF, "id:") + text.slice(block.end);
}
