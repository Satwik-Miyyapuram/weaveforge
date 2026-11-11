import type {
  Experiment,
  ExperimentFilter,
  ExperimentPatch,
  IExperimentRepository,
  IMetricRepository,
  MetricBudget,
  MetricPoint,
} from "../features/experiments/domain/parts.js";
import type {
  ILibraryPinRepository,
  LibraryPin,
  NewLibraryPinInput,
} from "../features/library/domain/parts.js";
import type {
  ILogEntryRepository,
  LogEntry,
  LogEntryFilter,
} from "../features/logbook/domain/parts.js";
import type { IMemberRepository, Member } from "../features/org/domain/parts.js";
import type {
  CitationAlertTrack,
  ICitationAlertTrackRepository,
  IPaperRelationRepository,
  NewCitationAlertTrackInput,
  PaperRelation,
  PaperRelationFilter,
  RelationType,
} from "../features/relations/domain/parts.js";
import type { ICommentRepository } from "../features/sharing/domain/parts.js";
import type {
  AnnotationPin,
  AnnotationQuotationType,
  IAnnotationPinRepository,
  IAnnotationQuotationTypeRepository,
  ILabSnapshotRepository,
  IPaperFieldRepository,
  LabSnapshot,
  PaperFieldDef,
  PaperFieldValue,
  PublishLabSnapshotInput,
  SaveAnnotationPinInput,
  SaveAnnotationQuotationTypeInput,
  SetPaperFieldValueInput,
} from "../index.js";
import type { Comment, NewCommentInput, ShareableType } from "../shared/core-contract.js";
import { ValidationError } from "../shared/errors.js";
import { rust } from "../shared/rust.js";
import type { BlobObjectRecord, IBlobRegistry, RegisterBlobInput } from "../storage/parts.js";

// --- in-memory-annotation-pin-repository ---
export class InMemoryAnnotationPinRepository implements IAnnotationPinRepository {
  private readonly items = new Map<string, AnnotationPin>();
  private seq = 0;

  async save(input: SaveAnnotationPinInput): Promise<AnnotationPin> {
    const mapKey = `${input.paperId}:${input.annotationKey}`;
    const previous = this.items.get(mapKey);
    const pin: AnnotationPin = {
      id: previous?.id ?? `annotation-pin-${++this.seq}`,
      ...input,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
    };
    this.items.set(mapKey, pin);
    return structuredClone(pin);
  }

  async remove(paperId: string, annotationKey: string): Promise<void> {
    this.items.delete(`${paperId}:${annotationKey}`);
  }

  async listForProject(): Promise<AnnotationPin[]> {
    return [...this.items.values()].map((item) => structuredClone(item));
  }

  async listForPaper(paperId: string): Promise<AnnotationPin[]> {
    return (await this.listForProject()).filter((pin) => pin.paperId === paperId);
  }

  async listForSection(reportSectionId: string): Promise<AnnotationPin[]> {
    return (await this.listForProject()).filter(
      (pin) => pin.reportSectionId === reportSectionId,
    );
  }
}

// --- in-memory-annotation-quotation-type-repository ---
export class InMemoryAnnotationQuotationTypeRepository
  implements IAnnotationQuotationTypeRepository
{
  private readonly items = new Map<string, AnnotationQuotationType>();
  private seq = 0;

  async save(input: SaveAnnotationQuotationTypeInput): Promise<AnnotationQuotationType> {
    const mapKey = `${input.paperId}:${input.annotationKey}`;
    const previous = this.items.get(mapKey);
    const now = new Date().toISOString();
    const row: AnnotationQuotationType = {
      id: previous?.id ?? `quotation-type-${++this.seq}`,
      paperId: input.paperId,
      annotationKey: input.annotationKey,
      quotationType: input.quotationType,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.items.set(mapKey, row);
    return structuredClone(row);
  }

  async remove(paperId: string, annotationKey: string): Promise<void> {
    this.items.delete(`${paperId}:${annotationKey}`);
  }

  async listForPaper(paperId: string): Promise<AnnotationQuotationType[]> {
    return [...this.items.values()]
      .filter((row) => row.paperId === paperId)
      .map((row) => structuredClone(row));
  }
}

// --- in-memory-blob-registry ---
/** In-memory {@link IBlobRegistry} for unit tests. */
export class InMemoryBlobRegistry implements IBlobRegistry {
  private readonly rows = new Map<string, BlobObjectRecord>();

  private key(bucket: string, path: string): string {
    return `${bucket}\0${path}`;
  }

  async get(bucket: string, path: string): Promise<BlobObjectRecord | null> {
    const row = this.rows.get(this.key(bucket, path));
    return row ? { ...row } : null;
  }

  async register(input: RegisterBlobInput): Promise<void> {
    const k = this.key(input.bucket, input.path);
    const existing = this.rows.get(k);
    this.rows.set(k, {
      bucket: input.bucket,
      path: input.path,
      tier: input.tier ?? "hot",
      sizeBytes: input.sizeBytes,
      accessCount: existing?.accessCount ?? 0,
      lastAccessedAt: existing?.lastAccessedAt ?? null,
      priority: input.priority ?? 50,
      createdAt: existing?.createdAt ?? new Date(),
    });
  }

  async recordAccess(bucket: string, path: string): Promise<void> {
    const row = this.rows.get(this.key(bucket, path));
    if (!row) return;
    row.accessCount += 1;
    row.lastAccessedAt = new Date();
  }

  async remove(bucket: string, path: string): Promise<void> {
    this.rows.delete(this.key(bucket, path));
  }
}

// --- in-memory-citation-alert-track-repository ---
/**
 * In-memory citation-alert tracks. Scoped to one user + project like the
 * PostgREST adapter.
 */
export class InMemoryCitationAlertTrackRepository implements ICitationAlertTrackRepository {
  private readonly store = new Map<string, CitationAlertTrack>();
  private seq = 0;

  constructor(
    private userId: string = "me",
    private projectId: string = "proj-1",
  ) {}

  setScope(userId: string, projectId: string): void {
    this.userId = userId;
    this.projectId = projectId;
  }

  private key(paperId: string): string {
    return `${this.userId}|${this.projectId}|${paperId}`;
  }

  async track(input: NewCitationAlertTrackInput): Promise<CitationAlertTrack> {
    const key = this.key(input.paperId);
    const existing = this.store.get(key);
    const track: CitationAlertTrack = {
      id: existing?.id ?? `track-${++this.seq}`,
      paperId: input.paperId,
      trackedAt: existing?.trackedAt ?? new Date(this.seq).toISOString(),
      lastCheckedAt: input.lastCheckedAt ?? existing?.lastCheckedAt,
      seenCitingIds: input.seenCitingIds ?? existing?.seenCitingIds ?? [],
    };
    this.store.set(key, track);
    return { ...track, seenCitingIds: [...track.seenCitingIds] };
  }

  async untrack(paperId: string): Promise<void> {
    this.store.delete(this.key(paperId));
  }

  async listForProject(): Promise<CitationAlertTrack[]> {
    const prefix = `${this.userId}|${this.projectId}|`;
    return [...this.store]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, t]) => ({ ...t, seenCitingIds: [...t.seenCitingIds] }));
  }

  async getByPaperId(paperId: string): Promise<CitationAlertTrack | null> {
    const track = this.store.get(this.key(paperId));
    return track ? { ...track, seenCitingIds: [...track.seenCitingIds] } : null;
  }

  async save(track: CitationAlertTrack): Promise<void> {
    this.store.set(this.key(track.paperId), {
      ...track,
      seenCitingIds: [...track.seenCitingIds],
    });
  }
}

// --- in-memory-comment-repository ---
/** In-memory {@link ICommentRepository}. `currentId` = the comment author. */
export class InMemoryCommentRepository implements ICommentRepository {
  private readonly store = new Map<string, Comment>();
  private seq = 0;
  constructor(private currentId: string = "me") {}

  setCurrent(id: string): void {
    this.currentId = id;
  }

  async list(resourceType: string, resourceId: string): Promise<Comment[]> {
    return [...this.store.values()]
      .filter((c) => c.resourceType === resourceType && c.resourceId === resourceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => ({ ...c }));
  }

  async add(input: NewCommentInput): Promise<Comment> {
    // As the `comments_check_new` trigger: a reply answers a root comment on
    // the same resource, and sits on that root's anchor.
    if (input.parentId) {
      const parent = this.store.get(input.parentId);
      if (
        !parent ||
        parent.parentId !== null ||
        parent.resourceType !== input.resourceType ||
        parent.resourceId !== input.resourceId
      ) {
        throw new ValidationError("a reply answers a comment on the same resource");
      }
    }
    const comment: Comment = {
      id: `comment-${++this.seq}`,
      authorId: this.currentId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      body: input.body,
      anchor: input.parentId ? null : (input.anchor ?? null),
      parentId: input.parentId ?? null,
      resolvedAt: null,
      createdAt: new Date(this.seq).toISOString(),
    };
    this.store.set(comment.id, comment);
    return { ...comment };
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id);
    // Replies go with their root, as `on delete cascade` does.
    for (const [key, c] of this.store) if (c.parentId === id) this.store.delete(key);
  }

  async setResolved(id: string, resolved: boolean): Promise<string | null> {
    const c = this.store.get(id);
    if (!c) throw new Error("comment not found");
    if (c.parentId) throw new Error("resolve the thread, not a reply");
    c.resolvedAt = resolved ? new Date(++this.seq).toISOString() : null;
    return c.resolvedAt;
  }
}

// --- in-memory-experiment-repository ---
export class InMemoryExperimentRepository implements IExperimentRepository {
  private readonly store = new Map<string, Experiment>();
  async getById(id: string): Promise<Experiment | null> {
    return this.store.get(id) ?? null;
  }
  async list(filter?: ExperimentFilter): Promise<Experiment[]> {
    let items = [...this.store.values()];
    if (filter?.status) items = items.filter((e) => e.status === filter.status);
    if (filter?.relatedPaper) items = items.filter((e) => e.relatedPaper === filter.relatedPaper);
    if (filter?.nameContains) {
      const n = filter.nameContains.toLowerCase();
      items = items.filter((e) => e.name.toLowerCase().includes(n));
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async save(entity: Experiment): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }
  async patch(id: string, fields: ExperimentPatch): Promise<void> {
    const current = this.store.get(id);
    if (current) this.store.set(id, { ...current, ...fields });
  }
  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

// --- in-memory-lab-snapshot-repository ---
export class InMemoryLabSnapshotRepository implements ILabSnapshotRepository {
  private readonly items = new Map<string, LabSnapshot & { ownerId: string }>();
  private seq = 0;
  private ownerId = "self";

  /** Test helper: change the synthetic current user / publish owner. */
  setOwnerId(ownerId: string) {
    this.ownerId = ownerId;
  }

  async publish(input: PublishLabSnapshotInput): Promise<LabSnapshot> {
    const now = new Date().toISOString();
    const snapshot: LabSnapshot & { ownerId: string } = {
      id: `lab-snapshot-${++this.seq}`,
      projectId: "project-1",
      title: input.title.trim(),
      note: input.note?.trim() || undefined,
      content: structuredClone(input.content),
      publishedAt: now,
      createdAt: now,
      ownerId: this.ownerId,
    };
    this.items.set(snapshot.id, snapshot);
    return structuredClone(toPublic(snapshot));
  }

  async remove(id: string): Promise<void> {
    const existing = this.items.get(id);
    if (existing && existing.ownerId === this.ownerId) this.items.delete(id);
  }

  async listMine(): Promise<LabSnapshot[]> {
    return [...this.items.values()]
      .filter((row) => row.ownerId === this.ownerId)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .map((row) => structuredClone(toPublic(row)));
  }

  async listForMember(memberId: string): Promise<LabSnapshot[]> {
    return [...this.items.values()]
      .filter((row) => row.ownerId === memberId)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .map((row) => structuredClone(toPublic(row)));
  }

  async getById(id: string): Promise<LabSnapshot | null> {
    const row = this.items.get(id);
    return row ? structuredClone(toPublic(row)) : null;
  }
}

function toPublic(row: LabSnapshot & { ownerId: string }): LabSnapshot {
  const { ownerId: _ownerId, ...publicRow } = row;
  return publicRow;
}

// --- in-memory-library-pin-repository ---
/**
 * In-memory {@link ILibraryPinRepository}. Scoped to one user + project, mirroring
 * the PostgREST adapter's project context.
 */
export class InMemoryLibraryPinRepository implements ILibraryPinRepository {
  private readonly store = new Map<string, LibraryPin>();
  private seq = 0;

  constructor(
    private userId: string = "me",
    private projectId: string = "proj-1",
  ) {}

  setScope(userId: string, projectId: string): void {
    this.userId = userId;
    this.projectId = projectId;
  }

  private key(resourceType: ShareableType, resourceId: string): string {
    return `${this.userId}|${this.projectId}|${resourceType}|${resourceId}`;
  }

  async pin(input: NewLibraryPinInput): Promise<LibraryPin> {
    const key = this.key(input.resourceType, input.resourceId);
    const existing = this.store.get(key);
    const pin: LibraryPin = {
      id: existing?.id ?? `pin-${++this.seq}`,
      userId: this.userId,
      projectId: this.projectId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ownerId: input.ownerId,
      createdAt: existing?.createdAt ?? new Date(this.seq).toISOString(),
    };
    this.store.set(key, pin);
    return { ...pin };
  }

  async unpin(resourceType: ShareableType, resourceId: string): Promise<void> {
    this.store.delete(this.key(resourceType, resourceId));
  }

  async listForProject(): Promise<LibraryPin[]> {
    return [...this.store.values()]
      .filter((p) => p.userId === this.userId && p.projectId === this.projectId)
      .map((p) => ({ ...p }));
  }

  async isPinned(resourceType: ShareableType, resourceId: string): Promise<boolean> {
    return this.store.has(this.key(resourceType, resourceId));
  }
}

// --- in-memory-log-entry-repository ---
/**
 * In-memory implementation of ILogEntryRepository.
 *
 * Used by unit tests for the domain/application layers, and as the reference
 * against which the PostgREST implementation is checked for Liskov
 * substitutability via the shared contract test suite.
 */
export class InMemoryLogEntryRepository implements ILogEntryRepository {
  private readonly store = new Map<string, LogEntry>();

  async getById(id: string): Promise<LogEntry | null> {
    return this.store.get(id) ?? null;
  }

  async list(filter?: LogEntryFilter): Promise<LogEntry[]> {
    let items = [...this.store.values()];
    if (filter?.kind) {
      items = items.filter((e) => e.kind === filter.kind);
    }
    if (filter?.dateFrom) {
      items = items.filter((e) => e.entryDate >= filter.dateFrom!);
    }
    if (filter?.dateTo) {
      items = items.filter((e) => e.entryDate <= filter.dateTo!);
    }
    if (filter?.bodyContains) {
      const needle = filter.bodyContains.toLowerCase();
      items = items.filter((e) => e.body.toLowerCase().includes(needle));
    }
    // Most recent first: by entryDate, then createdAt as tiebreaker.
    return items.sort(
      (a, b) =>
        b.entryDate.localeCompare(a.entryDate) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  }

  async save(entity: LogEntry): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

// --- in-memory-member-repository ---
/**
 * In-memory {@link IMemberRepository} for tests. A fixed `currentId` stands in
 * for the signed-in user; `listTeam` applies the same subtree-visibility rule
 * the SQL policy enforces in production (LSP: same observable behavior).
 */
export class InMemoryMemberRepository implements IMemberRepository {
  private readonly store = new Map<string, Member>();
  constructor(
    private currentId: string | null = null,
    seed: readonly Member[] = [],
  ) {
    for (const m of seed) this.store.set(m.id, { ...m });
  }

  setCurrent(id: string | null): void {
    this.currentId = id;
  }
  upsert(member: Member): void {
    this.store.set(member.id, { ...member });
  }

  async getMine(): Promise<Member | null> {
    if (!this.currentId) return null;
    return this.store.get(this.currentId) ?? null;
  }

  async listTeam(): Promise<Member[]> {
    return this.visible(rust().filterTeamMembers);
  }

  async listLab(): Promise<Member[]> {
    return this.visible(rust().filterLabMembers);
  }

  /** Every seeded member is in the lab, so visibility is the filter alone. */
  private visible(filter: ReturnType<typeof rust>["filterTeamMembers"]): Member[] {
    if (!this.currentId) return [];
    const all = [...this.store.values()];
    const orgMemberIds = new Set(all.map((m) => m.id));
    return this.byName(filter(this.currentId, all, { inLab: true, orgMemberIds }));
  }

  /** The whole seeded set stands in for "the lab" in tests. */
  async listDirectory(): Promise<Member[]> {
    if (!this.currentId) return [];
    return this.byName([...this.store.values()]);
  }

  private byName(members: Member[]): Member[] {
    return members.sort((a, b) =>
      (a.fullName ?? a.email ?? "").localeCompare(b.fullName ?? b.email ?? ""),
    );
  }
}

// --- in-memory-metric-repository ---
/**
 * In-memory IMetricRepository. History is returned ordered by metric then step,
 * matching the `experiment_metrics_series_idx` order the PostgREST adapter relies
 * on — so the shared contract suite passes against both (Liskov).
 */
export class InMemoryMetricRepository implements IMetricRepository {
  /** Keyed by (experiment, metric, step), the row table's primary key. */
  private readonly points = new Map<string, MetricPoint>();

  /** Last write wins per step, like the `experiment_metrics_insert` trigger. */
  async append(points: MetricPoint[]): Promise<void> {
    for (const p of points) {
      this.points.set(JSON.stringify([p.experimentId, p.metric, p.step]), { ...p });
    }
  }

  async history(
    experimentId: string,
    metric: string | undefined,
    budget: MetricBudget,
  ): Promise<MetricPoint[]> {
    const ordered = [...this.points.values()]
      .filter((p) => p.experimentId === experimentId)
      .filter((p) => (metric ? p.metric === metric : true))
      .sort((a, b) => (a.metric === b.metric ? a.step - b.step : a.metric.localeCompare(b.metric)))
      .map((p) => ({ ...p }));
    return reduceToBudget(ordered, budget.maxPoints);
  }

  async latestActivityAt(experimentIds: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const ids = new Set(experimentIds);
    for (const p of this.points.values()) {
      if (!ids.has(p.experimentId) || !p.wallTime) continue;
      const t = Date.parse(p.wallTime);
      if (!Number.isFinite(t)) continue;
      const prev = out.get(p.experimentId) ?? 0;
      if (t > prev) out.set(p.experimentId, t);
    }
    return out;
  }
}

/**
 * The same stride the SQL half applies, per series.
 *
 * Kept in step deliberately: the in-memory repository is what an offline build
 * runs against and what the contract suite checks, so a budget that reduced one
 * and not the other would be exactly the difference those tests exist to catch.
 * `points` is already ordered by metric then step, so a run of equal metric
 * names is one series.
 */
function reduceToBudget(points: MetricPoint[], maxPoints: number): MetricPoint[] {
  const budget = Math.max(2, maxPoints);
  const kept: MetricPoint[] = [];
  for (let start = 0; start < points.length; ) {
    let end = start;
    while (end < points.length && points[end]!.metric === points[start]!.metric) end += 1;
    const total = end - start;
    if (total <= budget) {
      kept.push(...points.slice(start, end));
    } else {
      const stride = Math.max(1, Math.ceil(total / budget));
      for (let index = start; index < end; index += 1) {
        const position = index - start + 1;
        // First, last, and every stride-th. The two endpoints are what a reader
        // takes for "when it started" and "where it ended up", so they survive
        // whatever the stride — the result may be a point or two over budget.
        if (position === 1 || position === total || (position - 1) % stride === 0) {
          kept.push(points[index]!);
        }
      }
    }
    start = end;
  }
  return kept;
}

// --- in-memory-paper-field-repository ---
export class InMemoryPaperFieldRepository implements IPaperFieldRepository {
  private readonly defs = new Map<string, PaperFieldDef>();
  private readonly values = new Map<string, PaperFieldValue>();
  private valueSeq = 0;

  async listDefs(): Promise<PaperFieldDef[]> {
    return [...this.defs.values()]
      .map((d) => cloneDef(d))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async saveDef(def: PaperFieldDef): Promise<void> {
    this.defs.set(def.id, cloneDef(def));
  }

  async deleteDef(id: string): Promise<void> {
    this.defs.delete(id);
    for (const [key, value] of this.values) {
      if (value.fieldId === id) this.values.delete(key);
    }
  }

  async listValuesForPaper(paperId: string): Promise<PaperFieldValue[]> {
    return (await this.listValuesForProject()).filter((v) => v.paperId === paperId);
  }

  async listValuesForProject(): Promise<PaperFieldValue[]> {
    return [...this.values.values()].map(cloneValue);
  }

  async setValue(input: SetPaperFieldValueInput): Promise<PaperFieldValue> {
    const mapKey = `${input.paperId}:${input.fieldId}`;
    const previous = this.values.get(mapKey);
    const row: PaperFieldValue = {
      id: previous?.id ?? `paper-field-value-${++this.valueSeq}`,
      paperId: input.paperId,
      fieldId: input.fieldId,
      value: cloneData(input.value),
    };
    this.values.set(mapKey, row);
    return cloneValue(row);
  }

  async removeValue(paperId: string, fieldId: string): Promise<void> {
    this.values.delete(`${paperId}:${fieldId}`);
  }
}

function cloneDef(def: PaperFieldDef): PaperFieldDef {
  return { ...def, options: [...def.options] };
}

function cloneValue(value: PaperFieldValue): PaperFieldValue {
  return { ...value, value: cloneData(value.value) };
}

function cloneData<T extends PaperFieldValue["value"]>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T;
}

// --- in-memory-paper-relation-repository ---
/**
 * In-memory implementation of IPaperRelationRepository.
 *
 * Reference implementation for tests and the Liskov substitutability contract.
 */
export class InMemoryPaperRelationRepository
  implements IPaperRelationRepository
{
  private readonly store = new Map<string, PaperRelation>();

  async getById(id: string): Promise<PaperRelation | null> {
    return this.store.get(id) ?? null;
  }

  async list(filter?: PaperRelationFilter): Promise<PaperRelation[]> {
    let items = [...this.store.values()];
    if (filter?.relation) items = items.filter((r) => r.relation === filter.relation);
    if (filter?.fromPaper) items = items.filter((r) => r.fromPaper === filter.fromPaper);
    if (filter?.toPaper) items = items.filter((r) => r.toPaper === filter.toPaper);
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getGraph(): Promise<PaperRelation[]> {
    return [...this.store.values()];
  }

  async relationsFor(paperId: string): Promise<PaperRelation[]> {
    return [...this.store.values()].filter(
      (r) => r.fromPaper === paperId || r.toPaper === paperId,
    );
  }

  async findEdge(
    fromPaper: string,
    toPaper: string,
    relation: RelationType,
  ): Promise<PaperRelation | null> {
    for (const r of this.store.values()) {
      if (r.fromPaper === fromPaper && r.toPaper === toPaper && r.relation === relation) {
        return r;
      }
    }
    return null;
  }

  async save(entity: PaperRelation): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
