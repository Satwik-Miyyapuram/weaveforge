import { getContainer } from "@/bootstrap";
import { deferDelete } from "@/lib/toast";

/** The key a relation hides under while its Undo toast shows. */
export const relationKey = (id: string) => `relation:${id}`;

/**
 * Delete a relation from the side panel or the edge popover (rule D-07): the
 * edge leaves the graph at once, and the delete runs when the Undo toast
 * closes. `onDeleted` reloads the graph after the delete.
 */
export function removeRelationLater(
  id: string,
  onDeleted: () => void,
  remove: (id: string) => Promise<unknown> = (r) => getContainer().graph.removeRelation(r),
): void {
  deferDelete({
    keys: [relationKey(id)],
    message: "Relation deleted",
    commit: async () => {
      await remove(id);
      onDeleted();
    },
  });
}
