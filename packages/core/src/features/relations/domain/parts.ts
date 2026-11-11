import { WeaveForgeError } from "../../../shared/errors.js";
import type {
  Identifiable,
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/parts.js";
import { DEFAULT_GRAPH_SETTINGS, type GraphViewSettings } from "./graph-view-settings.js";
import type { PaperRelation, PaperRelationFilter, RelationType } from "./paper-relation.js";

// --- citation-alert-track ---
/** Project-scoped citation alert for one library paper. */
export interface CitationAlertTrack extends Identifiable {
  id: string;
  paperId: string;
  trackedAt: string;
  /** Null until the first successful poll after tracking starts. */
  lastCheckedAt?: string;
  /** Stable Semantic Scholar (or other source) citing-paper ids already seen. */
  seenCitingIds: string[];
}

export interface NewCitationAlertTrackInput {
  paperId: string;
  seenCitingIds?: string[];
  lastCheckedAt?: string;
}

export class CitationAlertTrackError extends WeaveForgeError {
  constructor(message: string) {
    super(message);
    this.name = "CitationAlertTrackError";
  }
}

// --- citation-alert-track-repository ---
export interface ICitationAlertTrackRepository {
  track(input: NewCitationAlertTrackInput): Promise<CitationAlertTrack>;
  untrack(paperId: string): Promise<void>;
  listForProject(): Promise<CitationAlertTrack[]>;
  getByPaperId(paperId: string): Promise<CitationAlertTrack | null>;
  save(track: CitationAlertTrack): Promise<void>;
}

// --- graph-persisted-state ---
/** Types for graph-persisted-state. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
export interface GraphPinnedPosition {
  x: number;
  y: number;
}

/** Per-project graph UI state synced across devices (stored on the project row). */
export interface GraphPersistedState {
  settings: GraphViewSettings;
  selectedLists: string[];
  selectedTags: string[];
  localSeed: string | null;
  localDepth: number;
  pinned: Record<string, GraphPinnedPosition>;
}

// --- graph-persisted-defaults ---
/** The graph state a project starts with. */
export const DEFAULT_GRAPH_PERSISTED_STATE: GraphPersistedState = {
  settings: DEFAULT_GRAPH_SETTINGS,
  selectedLists: [],
  selectedTags: [],
  localSeed: null,
  localDepth: 2,
  pinned: {},
};

// --- graph-settings-repository ---
/** Per-project graph view preferences (stored on the project row). */
export interface IGraphSettingsRepository {
  get(projectId: string): Promise<GraphPersistedState | null>;
  save(projectId: string, state: GraphPersistedState): Promise<void>;
}

// --- paper-relation-repository ---
/**
 * Repository contract for paper relations (graph edges).
 *
 * Defined in the domain layer (DIP). Adds graph-shaped reads on top of the
 * generic read/write contract. Every implementation passes the shared contract
 * suite (Liskov).
 */
export interface IPaperRelationRepository
  extends IReadableRepository<PaperRelation, PaperRelationFilter>,
    IWritableRepository<PaperRelation> {
  /** Every edge (the full graph). */
  getGraph(): Promise<PaperRelation[]>;
  /** All edges touching a paper, in either direction. */
  relationsFor(paperId: string): Promise<PaperRelation[]>;
  /** Dedupe lookup for a specific directed, typed edge. */
  findEdge(
    fromPaper: string,
    toPaper: string,
    relation: RelationType,
  ): Promise<PaperRelation | null>;
}
