import type {
  IAccountProvisioner,
  IExperimentRepository,
  ILabSnapshotRepository,
  ILogEntryRepository,
  IMemberRepository,
  IMilestoneRepository,
  IReportSectionRepository,
  ISupervisionRepository,
  Member,
  NewMemberInput,
  Role,
} from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

/** A new member to invite: everything but a password, which they set from the email. */
export type NewMemberInvite = Omit<NewMemberInput, "password">;

/**
 * Stands in for the password the Rust validator still requires (at least 8 characters).
 * It is never sent: the relay invites the member. Drop it once wf-core stops asking.
 */
const INVITE_PLACEHOLDER_PASSWORD = "invite-placeholder";
export class OrgFacade {
  constructor(
    private readonly deps: {
      /** `assertCanCreate` is the Rust hierarchy gate over the signed-in member. */
      members: IMemberRepository & { assertCanCreate(role: string): Promise<void> };
      provisioner: IAccountProvisioner;
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

  /**
   * Create an account beneath the signed-in user. The member is invited by email and
   * sets their own password, so none is taken here. The Rust core validates the input
   * and the hierarchy gate runs first; the server route re-checks the same rule.
   */
  async createMember(input: NewMemberInvite): Promise<Member> {
    const normalized = typedCore().validateNewMember({ ...input, password: INVITE_PLACEHOLDER_PASSWORD });
    await this.deps.members.assertCanCreate(normalized.role);
    const { password: _placeholder, ...invite } = normalized;
    // The core types still list a password (wf-core follow-up); the invite carries none.
    return this.deps.provisioner.createMember({ ...invite, role: normalized.role as Role } as NewMemberInput);
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
      content: typedCore().buildLabSnapshotContent({ milestones, logs, experiments, report, aiAssisted }),
    });
  }

  removeLabSnapshot(id: string) {
    return this.deps.labSnapshots.remove(id);
  }
}
