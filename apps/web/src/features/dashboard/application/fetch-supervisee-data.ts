import type { LogEntry, Member, Milestone, ISupervisionRepository } from "@weaveforge/core";

export async function fetchSuperviseeMilestonesAndLogs(
  repo: ISupervisionRepository,
  supervisees: readonly Member[],
): Promise<{
  milestonesByMember: Map<string, Milestone[]>;
  logsByMember: Map<string, LogEntry[]>;
  error: unknown | null;
}> {
  const milestonesByMember = new Map<string, Milestone[]>();
  const logsByMember = new Map<string, LogEntry[]>();

  // Two queries for the whole team when the repository can do it, instead of
  // two per supervisee. A supervisor with six students was making twelve.
  if (repo.listMilestonesFor && repo.listLogsFor) {
    const ids = supervisees.map((member) => member.id);
    const [milestones, logs] = await Promise.allSettled([
      repo.listMilestonesFor(ids),
      repo.listLogsFor(ids),
    ]);
    const failure = [milestones, logs].find((r) => r.status === "rejected");
    return {
      milestonesByMember: milestones.status === "fulfilled" ? milestones.value : milestonesByMember,
      logsByMember: logs.status === "fulfilled" ? logs.value : logsByMember,
      error: failure?.status === "rejected" ? failure.reason : null,
    };
  }

  const pairs = await Promise.allSettled(
    supervisees.map(async (m) => {
      const [milestones, logs] = await Promise.all([
        repo.listMilestones(m.id),
        repo.listLogs(m.id),
      ]);
      return [m.id, milestones, logs] as const;
    }),
  );
  const fail = pairs.find((r) => r.status === "rejected");
  for (const result of pairs) {
    if (result.status !== "fulfilled") continue;
    const [id, milestones, logs] = result.value;
    milestonesByMember.set(id, milestones);
    logsByMember.set(id, logs);
  }
  return {
    milestonesByMember,
    logsByMember,
    error: fail?.status === "rejected" ? fail.reason : null,
  };
}
