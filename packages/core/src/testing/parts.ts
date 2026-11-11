import type {
  DashboardLayout,
  IDashboardLayoutRepository,
} from "../features/dashboard/domain/parts.js";
import type { IAccountProvisioner, Member, NewMemberInput } from "../features/org/domain/parts.js";
import type {
  IMilestoneRepository,
  Milestone,
  MilestoneFilter,
} from "../features/plan/domain/parts.js";
import type { IProjectRepository, Project } from "../features/projects/domain/parts.js";
import type {
  GraphPersistedState,
  IGraphSettingsRepository,
} from "../features/relations/domain/parts.js";
import type { ISettingsRepository, UserSettings } from "../features/settings/domain/parts.js";
import type { Clock, IdGenerator } from "../shared/parts.js";
import { rust } from "../shared/rust.js";
import type { WorkspaceSnapshot } from "../workspace/parts-2.js";
import type { InMemoryMemberRepository } from "./in-memory-a.js";

// --- fakes ---
/** A clock that never moves, so a test asserting on a timestamp has one to name. */
export function fixedClock(iso = "2026-06-24T12:00:00.000Z"): Clock {
  return { nowIso: () => iso };
}

/** Ids in order — `id-1`, `id-2` — so an assertion can name the row it means. */
export function seqIds(): IdGenerator {
  let n = 0;
  return { newId: () => `id-${++n}` };
}

// --- in-memory-account-provisioner ---
/**
 * In-memory {@link IAccountProvisioner} for tests. Mints an id, records the new
 * member in the paired repository, and returns it — no network, no auth. The
 * caller decides the supervisor (the use-case resolves it before calling here).
 */
export class InMemoryAccountProvisioner implements IAccountProvisioner {
  private seq = 0;
  constructor(
    private readonly members: InMemoryMemberRepository,
    private readonly supervisorFor: () => string | undefined = () => undefined,
  ) {}

  async createMember(input: NewMemberInput): Promise<Member> {
    const member: Member = {
      id: `user-${++this.seq}`,
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      supervisorId: input.supervisorId ?? this.supervisorFor(),
    };
    this.members.upsert(member);
    return member;
  }
}

// --- in-memory-dashboard-layout-repository ---
export class InMemoryDashboardLayoutRepository implements IDashboardLayoutRepository {
  private readonly layouts = new Map<string, DashboardLayout>();

  async get(projectId: string): Promise<DashboardLayout | null> {
    const layout = this.layouts.get(projectId);
    return layout ? structuredClone(layout) : null;
  }

  async save(projectId: string, layout: DashboardLayout): Promise<void> {
    this.layouts.set(projectId, structuredClone(layout));
  }
}

// --- in-memory-graph-settings-repository ---
export class InMemoryGraphSettingsRepository implements IGraphSettingsRepository {
  private readonly states = new Map<string, GraphPersistedState>();

  async get(projectId: string): Promise<GraphPersistedState | null> {
    const state = this.states.get(projectId);
    return state ? structuredClone(state) : null;
  }

  async save(projectId: string, state: GraphPersistedState): Promise<void> {
    this.states.set(projectId, structuredClone(state));
  }
}

// --- in-memory-milestone-repository ---
export class InMemoryMilestoneRepository implements IMilestoneRepository {
  private readonly store = new Map<string, Milestone>();
  async getById(id: string): Promise<Milestone | null> {
    return this.store.get(id) ?? null;
  }
  async list(filter?: MilestoneFilter): Promise<Milestone[]> {
    let items = [...this.store.values()];
    if (filter?.status) items = items.filter((m) => m.status === filter.status);
    if (filter?.titleContains) {
      const t = filter.titleContains.toLowerCase();
      items = items.filter((m) => m.title.toLowerCase().includes(t));
    }
    // Soonest target first; undated milestones sink to the end.
    return items.sort((a, b) =>
      (a.targetDate ?? "9999-99-99").localeCompare(b.targetDate ?? "9999-99-99"),
    );
  }
  async save(entity: Milestone): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }
  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

// --- in-memory-project-repository ---
export class InMemoryProjectRepository implements IProjectRepository {
  private readonly store = new Map<string, Project>();
  async getById(id: string): Promise<Project | null> {
    return this.store.get(id) ?? null;
  }
  async list(): Promise<Project[]> {
    return [...this.store.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async save(entity: Project): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }
  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

// --- in-memory-settings-repository ---
/** In-memory settings store for contract tests. Copies deeply, like a real store. */
export class InMemorySettingsRepository implements ISettingsRepository {
  private settings: UserSettings = structuredClone(rust().EMPTY_SETTINGS) as UserSettings;

  async get(): Promise<UserSettings> {
    return structuredClone(this.settings);
  }

  async getMetadata() {
    return {
      disclaimerAcceptedAt: this.settings.disclaimerAcceptedAt,
      disclaimerVersion: this.settings.disclaimerVersion,
      appearance: structuredClone(this.settings.appearance),
    };
  }

  async save(settings: UserSettings): Promise<void> {
    this.settings = structuredClone(settings);
  }

  async saveDisclaimer(acceptedAt: string, version: number): Promise<void> {
    this.settings = { ...this.settings, disclaimerAcceptedAt: acceptedAt, disclaimerVersion: version };
  }
}

// --- workspace-snapshot-fixture ---
/**
 * An empty snapshot with every collection present, for tests that care about
 * one collection and need the rest to exist.
 *
 * Shared because four suites had grown their own copy of this literal, and a
 * snapshot fixture is exactly the thing that goes stale in three places when a
 * collection is added to `WorkspaceSnapshot` in the fourth: the type error
 * lands in whichever file is compiled, and the others keep passing a snapshot
 * that no longer matches the shape.
 */
export function emptyWorkspaceSnapshot(
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot {
  return {
    papers: [],
    vaultPages: [],
    readingLists: [],
    readingListItems: [],
    reportSections: [],
    experiments: [],
    milestones: [],
    logEntries: [],
    relations: [],
    tags: [],
    readerAnnotations: [],
    collectedAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}
