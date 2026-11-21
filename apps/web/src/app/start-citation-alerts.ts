type Bootstrap = Pick<typeof import("@/bootstrap"), "ensureContainer" | "getContainer">;

/**
 * Starts the browser citation-alert check for `projectId` once the container is up.
 *
 * Any failure (a chunk that did not load, a container that did not start, the
 * check itself) is logged, never left as an unhandled rejection (F97-P2-22).
 */
export async function startCitationAlerts(
  projectId: string,
  cancelled: () => boolean,
  load: () => Promise<Bootstrap> = () => import("@/bootstrap"),
): Promise<void> {
  try {
    const { ensureContainer, getContainer } = await load();
    await ensureContainer();
    if (cancelled()) return;
    const container = getContainer();
    if (container.projects.context.projectId !== projectId) return;
    // At most once per tracked paper/day; the use-case also aborts writes if the project changes mid-poll.
    await container.papers.checkCitationAlerts();
  } catch (error) {
    console.warn("[citation-alerts] could not run:", error);
  }
}
