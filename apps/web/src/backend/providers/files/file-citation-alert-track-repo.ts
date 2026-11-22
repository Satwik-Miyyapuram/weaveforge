/**
 * Citation alert watches from files (0.9.7). Personal data (`user_id`-owned in the
 * database), so it lives in the user's settings file under `citationAlerts.<paper id>`,
 * the same place as the other per-paper keys. Files mode has one local user and one
 * project, so `listForProject` returns every watch.
 */
import type { CitationAlertTrack, ICitationAlertTrackRepository, NewCitationAlertTrackInput } from "@weaveforge/core";
import type { SettingsSection } from "./file-tag-repo";

type Stored = { id: string; trackedAt: string; lastCheckedAt?: string; seenCitingIds: string[] };

export type CitationAlertTrackFailure = { paperId: string; error: string };

function storedProblem(v: unknown): string | null {
  if (v === null || typeof v !== "object") return "entry is not an object";
  const s = v as Partial<Record<keyof Stored, unknown>>;
  if (typeof s.id !== "string") return "id is not a string";
  if (typeof s.trackedAt !== "string") return "trackedAt is not a string";
  if (!Array.isArray(s.seenCitingIds) || !s.seenCitingIds.every((id) => typeof id === "string")) {
    return "seenCitingIds is not a string[]";
  }
  return null;
}

function toTrack(paperId: string, stored: Stored): CitationAlertTrack {
  return {
    id: stored.id,
    paperId,
    trackedAt: stored.trackedAt,
    lastCheckedAt: stored.lastCheckedAt,
    seenCitingIds: [...stored.seenCitingIds],
  };
}

export class FileCitationAlertTrackRepository implements ICitationAlertTrackRepository {
  private readonly failureByPaper = new Map<string, string>();

  constructor(private readonly settings: SettingsSection) {}

  /** Malformed stored watches seen so far, one per paper. They are skipped, never thrown. */
  async failures(): Promise<CitationAlertTrackFailure[]> {
    return [...this.failureByPaper].map(([paperId, error]) => ({ paperId, error }));
  }

  async track(input: NewCitationAlertTrackInput): Promise<CitationAlertTrack> {
    const existing = this.read(input.paperId);
    const now = new Date().toISOString();
    const stored: Stored = {
      id: existing?.id ?? crypto.randomUUID(),
      trackedAt: existing?.trackedAt ?? now,
      lastCheckedAt: input.lastCheckedAt ?? existing?.lastCheckedAt,
      seenCitingIds: [...(input.seenCitingIds ?? existing?.seenCitingIds ?? [])],
    };
    await this.settings.set(["citationAlerts", input.paperId], stored);
    return toTrack(input.paperId, stored);
  }

  async untrack(paperId: string): Promise<void> {
    await this.settings.set(["citationAlerts", paperId], undefined);
  }

  async listForProject(): Promise<CitationAlertTrack[]> {
    const all = this.settings.get(["citationAlerts"]);
    if (!all || typeof all !== "object") return [];
    return Object.entries(all as Record<string, unknown>)
      .filter(([paperId, raw]) => this.check(paperId, raw))
      .map(([paperId, raw]) => toTrack(paperId, raw as Stored));
  }

  async getByPaperId(paperId: string): Promise<CitationAlertTrack | null> {
    const stored = this.read(paperId);
    return stored ? toTrack(paperId, stored) : null;
  }

  async save(track: CitationAlertTrack): Promise<void> {
    const stored: Stored = {
      id: track.id,
      trackedAt: track.trackedAt,
      lastCheckedAt: track.lastCheckedAt,
      seenCitingIds: [...track.seenCitingIds],
    };
    await this.settings.set(["citationAlerts", track.paperId], stored);
  }

  private read(paperId: string): Stored | null {
    const raw = this.settings.get(["citationAlerts", paperId]);
    return this.check(paperId, raw) ? (raw as Stored) : null;
  }

  private check(paperId: string, raw: unknown): boolean {
    const problem = storedProblem(raw);
    if (problem === null) {
      this.failureByPaper.delete(paperId);
      return true;
    }
    this.failureByPaper.set(paperId, problem);
    return false;
  }
}
