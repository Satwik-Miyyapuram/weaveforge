import type { LogEntry, Member, Milestone, ISupervisionRepository } from "@weaveforge/core";

export async function fetchSuperviseeMilestonesAndLogs(
  repo: ISupervisionRepository,
  supervisees: readonly Member[],
): Promise<{
  milestonesByMember: Map<string, Milestone[]>;
  logsByMember: Map<string, LogEntry[]>;
  error: unknown | null;
}> {
  // Two queries for the whole team, not two per supervisee: a supervisor with
  // six students was making twelve.
  const ids = supervisees.map((member) => member.id);
  const [milestones, logs] = await Promise.allSettled([
    repo.listMilestonesFor(ids),
    repo.listLogsFor(ids),
  ]);
  const failure = [milestones, logs].find((r) => r.status === "rejected");
  return {
    milestonesByMember: milestones.status === "fulfilled" ? milestones.value : new Map(),
    logsByMember: logs.status === "fulfilled" ? logs.value : new Map(),
    error: failure?.status === "rejected" ? failure.reason : null,
  };
}
