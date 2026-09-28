import { buildLabSnapshotContent } from "@weaveforge/core";
import type {
  CreateMemberUseCase,
  IExperimentRepository,
  ILabSnapshotRepository,
  ILogEntryRepository,
  IMemberRepository,
  IMilestoneRepository,
  IReportSectionRepository,
  Member,
} from "@weaveforge/core";
import type { ISupervisionRepository } from "@weaveforge/core";

export class OrgFacade {
  constructor(
    private readonly deps: {
      members: IMemberRepository;
      createMember: CreateMemberUseCase;
      supervision: ISupervisionRepository;
      labSnapshots: ILabSnapshotRepository;
      milestones: IMilestoneRepository;
      logs: ILogEntryRepository;
      experiments: IExperimentRepository;
      reportSections: IReportSectionRepository;
      /** Accepted AI suggestions in the active project; absent where there is no audit trail. */
      countAiAccepted?: () => Promise<number>;
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
    const [milestones, logs, experiments, report, aiAssisted] = await Promise.all([
      this.deps.milestones.list(),
      this.deps.logs.list(),
      this.deps.experiments.list(),
      this.deps.reportSections.list(),
      // A missing count must not block publishing the rest.
      this.deps.countAiAccepted?.().catch(() => undefined),
    ]);
    return this.deps.labSnapshots.publish({
      title: input.title,
      note: input.note,
      content: buildLabSnapshotContent({ milestones, logs, experiments, report, aiAssisted }),
    });
  }

  removeLabSnapshot(id: string) {
    return this.deps.labSnapshots.remove(id);
  }
}
