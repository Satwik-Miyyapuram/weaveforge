import type { FileCodec, Row } from "./ports";

/** JSON with object keys sorted, so two rows compare by value, not by key order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/** The text after a note's closing `---`, or the whole text when it has no frontmatter. */
function bodyOf(text: string): string {
  const m = /^---\n[\s\S]*?\n---\n?/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/**
 * For a user's file the text merge could not take (another layout, e.g. a 0.9.5 experiment with `## Hypothesis`
 * sections), the file with the DB row written over it, or null. It is written only when nothing is lost: the
 * codec reads every value the file holds equal to the DB row's, and every body line of the file is still in the
 * result or in one of those values. The file's own keys stay (the codec keeps keys it does not own).
 */
export function codecResolver(codec: FileCodec, kind: string, path: string, row: Row): ((fileText: string) => string | null) | undefined {
  const over = codec.toFileOver;
  if (!over) return undefined;
  return (fileText) => {
    const fileRow = codec.toRow(kind, path, fileText);
    if (!fileRow || String(fileRow.id) !== String(row.id)) return null;
    let next: string;
    try {
      next = over.call(codec, kind, fileText, row);
    } catch {
      return null;
    }
    const nextRow = codec.toRow(kind, path, next);
    if (!nextRow) return null;
    for (const [key, value] of Object.entries(fileRow)) {
      if (canonical(value) !== canonical(nextRow[key])) return null;
    }
    const values = Object.values(fileRow).filter((v): v is string => typeof v === "string");
    for (const line of bodyOf(fileText).split("\n")) {
      const t = line.trim();
      if (t === "" || /^## (Hypothesis|Result)$/.test(t)) continue;
      if (!next.includes(t) && !values.some((v) => v.includes(t))) return null;
    }
    return next;
  };
}
