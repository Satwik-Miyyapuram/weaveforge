import type { ICitationAlertTrackRepository } from "../features/relations/domain/citation-alert-track-repository.js";
import type {
  CitationAlertTrack,
  NewCitationAlertTrackInput,
} from "../features/relations/domain/citation-alert-track.js";

/**
 * In-memory citation-alert tracks. Scoped to one user + project like the
 * Supabase adapter.
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
    return [...this.store.values()]
      .filter((t) => this.key(t.paperId) === `${this.userId}|${this.projectId}|${t.paperId}`)
      .map((t) => ({ ...t, seenCitingIds: [...t.seenCitingIds] }));
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
