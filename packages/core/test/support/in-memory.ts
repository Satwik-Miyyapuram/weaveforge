/**
 * In-memory repository fakes for core unit tests. Moved verbatim from
 * the retired `src/testing` (only the classes the surviving tests import).
 */
import type {
  Experiment,
  ExperimentFilter,
  ExperimentPatch,
  IExperimentRepository,
} from "../../src/features/experiments/domain/parts.js";
import type {
  ILibraryPinRepository,
  LibraryPin,
  NewLibraryPinInput,
} from "../../src/features/library/domain/parts.js";
import type {
  ILogEntryRepository,
  LogEntry,
  LogEntryFilter,
} from "../../src/features/logbook/domain/parts.js";
import type {
  CitationAlertTrack,
  ICitationAlertTrackRepository,
  IPaperRelationRepository,
  NewCitationAlertTrackInput,
  PaperRelation,
  PaperRelationFilter,
  RelationType,
} from "../../src/features/relations/domain/parts.js";
import type {
  AnnotationPin,
  AnnotationQuotationType,
  IAnnotationPinRepository,
  IAnnotationQuotationTypeRepository,
  IPaperFieldRepository,
  IReaderAnnotationSink,
  IReaderAnnotationSource,
  IReaderAnnotationSyncRecorder,
  NewReaderAnnotation,
  PaperFieldDef,
  PaperFieldValue,
  ReaderAnnotation,
  ReaderAnnotationPatch,
  ReaderAnnotationSyncRecord,
  SaveAnnotationPinInput,
  SaveAnnotationQuotationTypeInput,
  SetPaperFieldValueInput,
} from "../../src/index.js";
import type {
  IShareLinkRepository,
  NewShareInput,
  ResolvedShareLink,
  Share,
  ShareableType,
  ShareLink,
  ShareLinkSaveInput,
  VaultPage,
  VaultPageFilter,
  VaultPageSummary,
  VaultPageTreeNode,
} from "../../src/shared/core-contract.js";
import { rust } from "../../src/shared/rust.js";
import type {
  BlobObjectRecord,
  IBlobRegistry,
  RegisterBlobInput,
} from "../../src/storage/parts.js";
import type {
  IPaperRepository,
  Paper,
  PaperFilter,
  PaperIdentity,
  PaperSummary,
} from "../../src/features/papers/domain/parts.js";
import type {
  IReadingListItemRepository,
  IReadingListRepository,
  ReadingList,
  ReadingListFilter,
  ReadingListItem,
  ReadingListTreeNode,
} from "../../src/features/reading-lists/domain/parts.js";
import type {
  IReportSectionRepository,
  ReportSection,
  ReportSectionFilter,
  ReportSectionTreeNode,
} from "../../src/features/report/domain/parts.js";
import type { IShareRepository } from "../../src/features/sharing/domain/parts.js";
import type {
  IPaperTagRepository,
  ITagRepository,
  PaperTag,
  Tag,
  TagSource,
  TagWithPaperCount,
} from "../../src/features/tags/domain/parts.js";
import type {
  IVaultPageRepository,
} from "../../src/features/vault/domain/vault-page-repository.js";
import { ConflictError, NotFoundError } from "../../src/shared/errors.js";
import type {
  IMilestoneRepository,
  Milestone,
  MilestoneFilter,
} from "../../src/features/plan/domain/parts.js";

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

// --- in-memory-paper-repository ---
/**
 * In-memory implementation of IPaperRepository.
 *
 * Used by unit tests for the domain/application layers, and as the reference
 * against which the PostgREST implementation is checked for Liskov
 * substitutability via the shared contract test suite.
 */
export class InMemoryPaperRepository implements IPaperRepository {
  /**
   * Every paper goes in and comes out as a deep copy, as it would through a
   * database. Handing back the stored object let a caller change the library
   * without `save()`, and a test then passed for a reason the app does not share.
   */
  private readonly store = new Map<string, Paper>();

  async getById(id: string): Promise<Paper | null> {
    return copy(this.store.get(id));
  }

  /**
   * The card projection.
   *
   * This store holds whole papers and has no cheaper read, so it returns them —
   * which the type allows, because a `Paper` satisfies `PaperSummary`. What it
   * may not do is claim the caller can rely on the abstract: the return type
   * says otherwise, and that is the point of it being required rather than a
   * fallback each caller writes for itself.
   */
  async listSummaries(): Promise<PaperSummary[]> {
    return this.list();
  }

  async list(filter?: PaperFilter): Promise<Paper[]> {
    let items = [...this.store.values()];
    if (filter?.status) {
      items = items.filter((p) => p.status === filter.status);
    }
    if (filter?.titleContains) {
      const needle = filter.titleContains.toLowerCase();
      items = items.filter((p) => p.title.toLowerCase().includes(needle));
    }
    if (filter?.arxivId) {
      items = items.filter((p) => p.arxivId === filter.arxivId);
    }
    if (filter?.doi) {
      const d = rust().normalizeDoi(filter.doi);
      items = items.filter((p) => p.doi === d);
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => structuredClone(p));
  }

  async save(entity: Paper): Promise<void> {
    this.store.set(entity.id, structuredClone(entity));
  }

  async setTags(id: string, tags: string[], updatedAt: string): Promise<void> {
    const paper = this.store.get(id);
    if (paper) this.store.set(id, { ...paper, tags: [...tags], updatedAt });
  }

  async replaceSummary(
    id: string,
    expected: string | undefined,
    next: string,
    updatedAt: string,
  ): Promise<boolean> {
    const paper = this.store.get(id);
    // An empty summary is stored as none, the way the database column holds it.
    if (!paper || (paper.summary || undefined) !== (expected || undefined)) return false;
    this.store.set(id, { ...paper, summary: next || undefined, updatedAt });
    return true;
  }

  async findByTitleKey(key: string): Promise<Paper | null> {
    for (const p of this.store.values()) {
      if (rust().titleKey(p.title) === key) return structuredClone(p);
    }
    return null;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async findByArxivId(arxivId: string): Promise<Paper | null> {
    for (const p of this.store.values()) {
      if (p.arxivId === arxivId) return structuredClone(p);
    }
    return null;
  }

  async findByDoi(doi: string): Promise<Paper | null> {
    const target = rust().normalizeDoi(doi);
    for (const p of this.store.values()) {
      if (p.doi === target) return structuredClone(p);
    }
    return null;
  }

  /**
   * The narrow lookup, derived from the rows this store already holds.
   *
   * A real adapter answers this with three columns; here the row *is* in memory,
   * so there is nothing to save — but the type still narrows, which is what keeps
   * a caller from quietly starting to read the abstract.
   */
  async findIdentityByArxivId(arxivId: string): Promise<PaperIdentity | null> {
    const paper = await this.findByArxivId(arxivId);
    return paper ? identityOf(paper) : null;
  }

  async findIdentityByDoi(doi: string): Promise<PaperIdentity | null> {
    const paper = await this.findByDoi(doi);
    return paper ? identityOf(paper) : null;
  }
}

function copy(paper: Paper | undefined): Paper | null {
  return paper ? structuredClone(paper) : null;
}

function identityOf(paper: Paper): PaperIdentity {
  return { id: paper.id, title: paper.title, status: paper.status };
}

// --- in-memory-reader-annotation-repository ---
/** Combined source+sink for tests and local-only composition. */
export class InMemoryReaderAnnotationRepository
  implements IReaderAnnotationSource, IReaderAnnotationSink, IReaderAnnotationSyncRecorder
{
  private readonly items = new Map<string, ReaderAnnotation & { paperId: string }>();
  private seq = 0;

  async list(paperId: string): Promise<ReaderAnnotation[]> {
    return [...this.items.values()]
      .filter((row) => row.paperId === paperId)
      .sort((a, b) => a.sortIndex.localeCompare(b.sortIndex))
      .map(({ paperId: _p, ...ann }) => structuredClone(ann));
  }

  async create(paperId: string, draft: NewReaderAnnotation): Promise<ReaderAnnotation> {
    if (!rust().isReaderAnnotationType(draft.type)) {
      throw new Error(`Invalid annotation type: ${draft.type}`);
    }
    // The id is the table's primary key, so reusing a live one fails the insert.
    if (draft.id !== undefined && this.items.has(draft.id)) {
      throw new ConflictError(`Annotation ${draft.id} already exists`);
    }
    const now = new Date().toISOString();
    this.seq += 1;
    const pageIndex = draft.pageIndex;
    const sortIndex =
      draft.sortIndex?.trim() ||
      rust().buildAnnotationSortIndex(pageIndex, 0, 0);
    const row: ReaderAnnotation & { paperId: string } = {
      id: draft.id ?? `local-ann-${this.seq}`,
      origin: "local",
      zoteroKey: null,
      type: draft.type,
      color: draft.color.trim() || "#ffd400",
      text: draft.text?.trim() ?? "",
      comment: draft.comment?.trim() ?? "",
      tags: [...(draft.tags ?? [])],
      anchor: structuredClone(draft.anchor),
      sortIndex,
      createdAt: now,
      updatedAt: now,
      syncState: "local",
      paperId,
    };
    this.items.set(row.id, row);
    const { paperId: _p, ...ann } = row;
    return structuredClone(ann);
  }

  async update(id: string, patch: ReaderAnnotationPatch): Promise<ReaderAnnotation> {
    const existing = this.items.get(id);
    if (!existing) throw new NotFoundError("Annotation not found");
    const now = new Date().toISOString();
    const next: ReaderAnnotation & { paperId: string } = {
      ...existing,
      color: patch.color !== undefined ? patch.color.trim() || "#ffd400" : existing.color,
      text: patch.text !== undefined ? patch.text.trim() : existing.text,
      comment: patch.comment !== undefined ? patch.comment.trim() : existing.comment,
      tags: patch.tags ? [...patch.tags] : existing.tags,
      anchor: patch.anchor ? structuredClone(patch.anchor) : existing.anchor,
      sortIndex: patch.sortIndex?.trim() || existing.sortIndex,
      syncState: "pending",
      updatedAt: now,
    };
    this.items.set(id, next);
    const { paperId: _p, ...ann } = next;
    return structuredClone(ann);
  }

  async recordZoteroSync(id: string, record: ReaderAnnotationSyncRecord): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) throw new NotFoundError("Annotation not found");
    this.items.set(id, { ...existing, ...record, zoteroVersion: record.zoteroVersion ?? undefined });
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
}

// --- in-memory-reading-list-repository ---
/**
 * In-memory implementations of the reading-list repositories.
 *
 * Reference implementations for tests and the Liskov substitutability contract.
 */
export class InMemoryReadingListRepository implements IReadingListRepository {
  private readonly store = new Map<string, ReadingList>();

  async getById(id: string): Promise<ReadingList | null> {
    return this.store.get(id) ?? null;
  }

  async list(filter?: ReadingListFilter): Promise<ReadingList[]> {
    let items = [...this.store.values()];
    if (filter?.parentId !== undefined) {
      const target = filter.parentId ?? undefined;
      items = items.filter((l) => (l.parentId ?? undefined) === target);
    }
    if (filter?.nameContains) {
      const needle = filter.nameContains.toLowerCase();
      items = items.filter((l) => l.name.toLowerCase().includes(needle));
    }
    return items.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
  }

  async getTree(): Promise<ReadingListTreeNode[]> {
    return rust().buildListTree([...this.store.values()]);
  }

  async save(entity: ReadingList): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

export class InMemoryReadingListItemRepository
  implements IReadingListItemRepository
{
  private readonly store = new Map<string, ReadingListItem>();

  async listItems(listId: string): Promise<ReadingListItem[]> {
    return [...this.store.values()]
      .filter((i) => i.listId === listId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listItemsForLists(listIds: readonly string[]): Promise<ReadingListItem[]> {
    const set = new Set(listIds);
    return [...this.store.values()]
      .filter((i) => set.has(i.listId))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listsForPaper(paperId: string): Promise<ReadingListItem[]> {
    return [...this.store.values()].filter((i) => i.paperId === paperId);
  }

  async listsForNote(vaultPageId: string): Promise<ReadingListItem[]> {
    return [...this.store.values()].filter((i) => i.vaultPageId === vaultPageId);
  }

  async find(listId: string, paperId: string): Promise<ReadingListItem | null> {
    for (const i of this.store.values()) {
      if (i.listId === listId && i.paperId === paperId) return i;
    }
    return null;
  }

  async findNote(listId: string, vaultPageId: string): Promise<ReadingListItem | null> {
    for (const i of this.store.values()) {
      if (i.listId === listId && i.vaultPageId === vaultPageId) return i;
    }
    return null;
  }

  /**
   * An upsert on the id. A second row for the same (list, paper) or
   * (list, note) is rejected, as the table's unique constraints do.
   */
  async add(item: ReadingListItem): Promise<void> {
    const same = item.paperId
      ? await this.find(item.listId, item.paperId)
      : item.vaultPageId
        ? await this.findNote(item.listId, item.vaultPageId)
        : null;
    if (same && same.id !== item.id) {
      throw new ConflictError("This item is already in the reading list");
    }
    this.store.set(item.id, { ...item });
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id);
  }
}

// --- in-memory-report-section-repository ---
/**
 * In-memory implementation of IReportSectionRepository.
 *
 * Reference implementation for tests and the Liskov substitutability contract.
 */
export class InMemoryReportSectionRepository
  implements IReportSectionRepository
{
  private readonly store = new Map<string, ReportSection>();

  async getById(id: string): Promise<ReportSection | null> {
    return this.store.get(id) ?? null;
  }

  async list(filter?: ReportSectionFilter): Promise<ReportSection[]> {
    let items = [...this.store.values()];
    if (filter?.status) {
      items = items.filter((s) => s.status === filter.status);
    }
    if (filter?.parentId !== undefined) {
      const target = filter.parentId ?? undefined;
      items = items.filter((s) => (s.parentId ?? undefined) === target);
    }
    if (filter?.titleContains) {
      const needle = filter.titleContains.toLowerCase();
      items = items.filter((s) => s.title.toLowerCase().includes(needle));
    }
    return items.sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        (a.sectionNo ?? "").localeCompare(b.sectionNo ?? "") ||
        a.title.localeCompare(b.title),
    );
  }

  async getTree(): Promise<ReportSectionTreeNode[]> {
    return rust().buildSectionTree([...this.store.values()]);
  }

  async save(entity: ReportSection): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

// --- in-memory-share-link-repository ---
export class InMemoryShareLinkRepository implements IShareLinkRepository {
  private readonly rows = new Map<string, ShareLinkSaveInput & { createdAt: string }>();

  async getById(id: string): Promise<ShareLink | null> {
    const row = this.rows.get(id);
    return row ? this.toDomain(row) : null;
  }

  async listForResource(resourceType: ShareableType, resourceId: string): Promise<ShareLink[]> {
    return [...this.rows.values()]
      .filter((r) => r.resourceType === resourceType && r.resourceId === resourceId)
      .map((r) => this.toDomain(r));
  }

  async save(input: ShareLinkSaveInput): Promise<ShareLink> {
    const row = { ...input, createdAt: new Date().toISOString() };
    this.rows.set(input.id, row);
    return this.toDomain(row);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  /** Like the redeem_share_link RPC: unknown or expired links resolve to null. */
  async redeem(tokenHash: Uint8Array): Promise<ResolvedShareLink | null> {
    const row = this.findByHash(tokenHash);
    if (!row) return null;
    if (row.expiresAt !== null && Date.parse(row.expiresAt) <= Date.now()) return null;
    return this.toResolved(row);
  }

  private findByHash(tokenHash: Uint8Array) {
    const key = this.hashKey(tokenHash);
    return [...this.rows.values()].find((r) => this.hashKey(r.tokenHash) === key);
  }

  private hashKey(bytes: Uint8Array) {
    return [...bytes].join(",");
  }

  private toDomain(row: ShareLinkSaveInput & { createdAt: string }): ShareLink {
    return {
      id: row.id,
      ownerId: row.ownerId,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      access: row.access,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }

  private toResolved(row: ShareLinkSaveInput): ResolvedShareLink {
    return {
      id: row.id,
      ownerId: row.ownerId,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      access: row.access,
      dekWrap: row.dekWrap ?? null,
      dekEpoch: row.dekEpoch ?? null,
    };
  }
}

// --- in-memory-share-repository ---
/**
 * In-memory {@link IShareRepository}. A fixed `currentId` stands in for the
 * signed-in user (the DB uses auth.uid()). Grant is idempotent on
 * (owner, recipient, type, resource) — re-granting updates access, mirroring the
 * unique index + delete/insert the PostgREST adapter uses (LSP).
 */
export class InMemoryShareRepository implements IShareRepository {
  private readonly store = new Map<string, Share>();
  private seq = 0;
  constructor(private currentId: string = "me") {}

  setCurrent(id: string): void {
    this.currentId = id;
  }

  private key(ownerId: string, i: NewShareInput): string {
    return `${ownerId}|${i.recipientId}|${i.resourceType}|${i.resourceId ?? "*"}`;
  }

  async grant(input: NewShareInput): Promise<Share> {
    const owner = this.currentId;
    const key = this.key(owner, input);
    const existing = [...this.store.values()].find(
      (s) => this.key(s.ownerId, s) === key,
    );
    const share: Share = {
      id: existing?.id ?? `share-${++this.seq}`,
      ownerId: owner,
      recipientId: input.recipientId,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      access: input.access ?? "comment",
      createdAt: existing?.createdAt ?? new Date(this.seq).toISOString(),
    };
    this.store.set(share.id, share);
    return { ...share };
  }

  async revoke(id: string): Promise<void> {
    this.store.delete(id);
  }

  async listForResource(
    resourceType: ShareableType,
    resourceId: string | null,
  ): Promise<Share[]> {
    return [...this.store.values()]
      .filter(
        (s) =>
          s.ownerId === this.currentId &&
          s.resourceType === resourceType &&
          (s.resourceId ?? null) === (resourceId ?? null),
      )
      .map((s) => ({ ...s }));
  }

  async listSharedWithMe(resourceType?: ShareableType): Promise<Share[]> {
    return [...this.store.values()]
      .filter(
        (s) =>
          s.recipientId === this.currentId &&
          (resourceType ? s.resourceType === resourceType : true),
      )
      .map((s) => ({ ...s }));
  }
}

// --- in-memory-tag-repository ---
export class InMemoryTagRepository implements ITagRepository {
  constructor(private readonly paperTags?: IPaperTagRepository) {}

  async getById(id: string): Promise<Tag | null> {
    return this.store.get(id) ?? null;
  }

  async findByName(name: string): Promise<Tag | null> {
    for (const t of this.store.values()) {
      if (t.name === name) return t;
    }
    return null;
  }

  async list(): Promise<Tag[]> {
    return [...this.store.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listWithCounts(): Promise<TagWithPaperCount[]> {
    // Counting without the links would report every tag as unused.
    if (!this.paperTags) {
      throw new Error("InMemoryTagRepository needs paperTags to count papers");
    }
    const tags = await this.list();
    const links = await this.paperTags.listAll();
    const counts = new Map<string, Set<string>>();
    for (const l of links) {
      const set = counts.get(l.tagId) ?? new Set<string>();
      set.add(l.paperId);
      counts.set(l.tagId, set);
    }
    return tags.map((t) => ({
      ...t,
      paperCount: counts.get(t.id)?.size ?? 0,
    }));
  }

  async save(entity: Tag): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  private readonly store = new Map<string, Tag>();
}

export class InMemoryPaperTagRepository implements IPaperTagRepository {
  private readonly store = new Map<string, PaperTag>();

  private key(l: PaperTag) {
    return `${l.paperId}:${l.tagId}:${l.source}`;
  }

  async listForPaper(paperId: string): Promise<PaperTag[]> {
    return [...this.store.values()].filter((l) => l.paperId === paperId);
  }

  async listForTag(tagId: string): Promise<PaperTag[]> {
    return [...this.store.values()].filter((l) => l.tagId === tagId);
  }

  async listAll(): Promise<PaperTag[]> {
    return [...this.store.values()];
  }

  async link(link: PaperTag): Promise<void> {
    this.store.set(this.key(link), { ...link });
  }

  async unlink(paperId: string, tagId: string, source?: TagSource): Promise<void> {
    for (const [k, l] of this.store) {
      if (l.paperId === paperId && l.tagId === tagId && (source == null || l.source === source)) {
        this.store.delete(k);
      }
    }
  }

  async unlinkBySource(paperId: string, source: TagSource): Promise<void> {
    for (const [k, l] of this.store) {
      if (l.paperId === paperId && l.source === source) this.store.delete(k);
    }
  }

  async reconcile(paperId: string, links: PaperTag[], sources: readonly TagSource[]): Promise<void> {
    const src = new Set(sources);
    for (const [k, l] of [...this.store]) {
      if (l.paperId === paperId && src.has(l.source)) this.store.delete(k);
    }
    for (const l of links) this.store.set(this.key(l), { ...l });
  }
}

// --- in-memory-vault-page-repository ---
export class InMemoryVaultPageRepository implements IVaultPageRepository {
  private readonly store = new Map<string, VaultPage>();

  async getById(id: string): Promise<VaultPage | null> {
    return this.store.get(id) ?? null;
  }

  async titleTaken(title: string, exceptId?: string): Promise<boolean> {
    const key = rust().normalizeTitleKey(title);
    if (!key) return false;
    for (const p of this.store.values()) {
      if (p.id !== exceptId && rust().normalizeTitleKey(p.title) === key) return true;
    }
    return false;
  }

  async list(filter?: VaultPageFilter): Promise<VaultPage[]> {
    let items = [...this.store.values()];
    if (filter?.parentId !== undefined) {
      const target = filter.parentId ?? undefined;
      items = items.filter((p) => (p.parentId ?? undefined) === target);
    }
    if (filter?.query) {
      const needle = filter.query.toLowerCase();
      items = items.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          p.body.toLowerCase().includes(needle),
      );
    }
    return items.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
    );
  }

  /**
   * The card/tree projection, modelled honestly (review-2 F6): no `body` field
   * at all, exactly as the PostgREST adapter's reduced column list produces.
   * Spreading the full page and blanking `body` was the double that made the
   * real projection look like a full entity.
   */
  async listSummaries(): Promise<VaultPageSummary[]> {
    const items = await this.list();
    return items.map((p) => ({
      id: p.id,
      title: p.title,
      bodyPreview: rust().vaultBodyPreview(p.body),
      parentId: p.parentId,
      pinned: p.pinned,
      folder: p.folder,
      sortOrder: p.sortOrder,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  async getTree(): Promise<VaultPageTreeNode[]> {
    return rust().buildPageTree([...this.store.values()]) as VaultPageTreeNode[];
  }

  async save(entity: VaultPage): Promise<void> {
    this.store.set(entity.id, { ...entity });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
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
