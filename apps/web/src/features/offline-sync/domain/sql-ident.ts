/** A Postgres identifier in double quotes, any embedded quote doubled. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
