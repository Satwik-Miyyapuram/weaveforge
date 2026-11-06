/**
 * Deletes an experiment, then the files it saved on this computer (desktop app only). The
 * experiment is gone either way, so a failed clean-up does not fail the delete.
 */
export async function removeExperiment(
  id: string,
  remove: (id: string) => Promise<void>,
  deleteLocalFiles?: (id: string) => Promise<void>,
): Promise<void> {
  await remove(id);
  await deleteLocalFiles?.(id).catch(() => undefined);
}
