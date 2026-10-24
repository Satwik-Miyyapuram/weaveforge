import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";

export type CreateNoteResult<P> = { ok: true; page: P } | { ok: false; error: string };

/**
 * Create a note titled by a search query. A failure comes back as a message to
 * show, and is logged; it never rejects, since the palette calls it unawaited.
 * Returns null for a blank query.
 */
export async function createNoteFromQuery<P>(
  query: string,
  add: (input: { title: string }) => Promise<P>,
): Promise<CreateNoteResult<P> | null> {
  const title = query.trim();
  if (!title) return null;
  try {
    return { ok: true, page: await add({ title }) };
  } catch (err) {
    const detail = formatError(err);
    logToApp({ level: "warn", source: "jump-to", message: "Creating a note from search failed.", detail });
    return { ok: false, error: `Could not create the note: ${detail}` };
  }
}
