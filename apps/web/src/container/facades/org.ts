import type { CreateMemberUseCase, ILogEntryRepository, IMemberRepository, Member } from "@weaveforge/core";
import type { ISupervisionRepository } from "@weaveforge/core";

export class OrgFacade {
  constructor(
    private readonly deps: {
      members: IMemberRepository;
      createMember: CreateMemberUseCase;
      supervision: ISupervisionRepository;
      labSnapshots: import("@weaveforge/core").ILabSnapshotRepository;
      milestones: import("@weaveforge/core").IMilestoneRepository;
      logs: import("@weaveforge/core").ILogEntryRepository;
    },
  ) {}

  loadProfile() {
    return this.deps.members.getMine().catch(() => null);
  }

  loadTeam() {
    return this.deps.members.listTeam().catch(() => [] as Member[]);
  }

  loadLab() {
    return this.deps.members.listLab().catch(() => [] as Member[]);
  }

  listDirectory() {
    return this.deps.members.listDirectory();
  }

  get createMember() {
    return this.deps.createMember;
  }

  loadSupervisee(memberId: string) {
    return Promise.all([
      this.deps.supervision.listMilestones(memberId),
      this.deps.supervision.listLogs(memberId),
      this.deps.labSnapshots.listForMember(memberId),
    ]);
  }

  listMyLabSnapshots() {
    return this.deps.labSnapshots.listMine();
  }

  async publishLabSnapshot(input: { title: string; note?: string }) {
    const [milestones, logs] = await Promise.all([
      this.deps.milestones.list(),
      this.deps.logs.list(),
    ]);
    return this.deps.labSnapshots.publish({
      title: input.title,
      note: input.note,
      content: {
        milestones: milestones.map((m) => ({
          id: m.id,
          title: m.title,
          description: m.description,
          status: m.status,
          targetDate: m.targetDate,
        })),
        logs: logs.map((l) => ({
          id: l.id,
          entryDate: l.entryDate,
          kind: l.kind,
          body: l.body,
        })),
      },
    });
  }

  removeLabSnapshot(id: string) {
    return this.deps.labSnapshots.remove(id);
  }
}
