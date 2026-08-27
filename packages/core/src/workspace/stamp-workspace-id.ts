/**
 * Writing an id back into a file somebody wrote by hand.
 *
 * A note dropped into the folder as `notes/My idea.md` carries no
 * `weaveforge-id`, so importing it creates an entity. Nothing then connects the
 * two: the next mirror writes the entity out under its canonical name, the
 * hand-written file stays exactly where it was, and the import after that reads
 * it as another new note. One file becomes two, then four.
 *
 * Stamping the id into the file it came from is what closes that loop. From
 * then on the file *is* that entity, by the same rule every other file follows,
 * and the path it happens to sit at stops mattering.
 *
 * The stamp is deliberately minimal: an id line and nothing else. Rewriting the
 * frontmatter wholesale would reformat a file the user wrote, and a tool that
 * tidies your notes without being asked is a tool you stop leaving files for.
 */

/** The id line, spelled as the serializer spells it. */
const ID_KEY = "weaveforge-id";

/**
 * Add `weaveforge-id` to a file's frontmatter.
 *
 * Returns null when there is nothing to do — the file already claims an id —
 * so a caller can tell "stamped" from "left alone" without comparing text.
 */
export function stampWorkspaceId(content: string, id: string): string | null {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const fence = `---${newline}`;

  if (!content.startsWith(fence)) {
    // No frontmatter at all: give it one. The body follows a blank line, which
    // is what every parser here and in Obsidian expects.
    return `---${newline}${ID_KEY}: ${id}${newline}---${newline}${newline}${content}`;
  }

  const end = content.indexOf(`${newline}---`, fence.length - newline.length);
  if (end === -1) {
    // An opening fence with no closing one is not frontmatter, whatever it
    // looks like. Treat the whole file as body rather than guessing where the
    // block was meant to end.
    return `---${newline}${ID_KEY}: ${id}${newline}---${newline}${newline}${content}`;
  }

  const head = content.slice(fence.length, end + newline.length);
  if (new RegExp(`^${ID_KEY}\\s*:`, "m").test(head)) return null;

  return `${fence}${ID_KEY}: ${id}${newline}${content.slice(fence.length)}`;
}
