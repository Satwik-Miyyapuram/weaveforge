import type { ReportSection } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { deferDelete, deletedMessage } from "@/lib/toast";

/** The key a section hides under while its Undo toast shows. */
export const sectionKey = (id: string) => `section:${id}`;

export type SectionRemover = (section: ReportSection) => Promise<unknown>;

/**
 * Delete a section and its subsections (rule D-07): it disappears at once, and
 * the delete runs when the Undo toast closes. `onDeleted` runs after the
 * delete, so the screen reloads; it must not close whatever is open by then.
 */
export function removeSectionLater(
  section: ReportSection,
  subsections: number,
  { onHidden, onDeleted }: { onHidden?: () => void; onDeleted: () => void },
  remove: SectionRemover = (s) => getContainer().report.removeSection(s),
): void {
  const name = deletedMessage(section.title, "Section");
  deferDelete({
    keys: [sectionKey(section.id)],
    message: subsections > 0 ? `${name} with ${subsections} subsection(s)` : name,
    commit: async () => {
      try {
        await remove(section);
      } finally {
        // Reload either way: one delete removes the subtree, and part may be gone.
        onDeleted();
      }
    },
  });
  onHidden?.();
}
