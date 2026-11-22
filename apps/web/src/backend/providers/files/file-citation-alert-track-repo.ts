/**
 * Citation alert watches from files (0.9.7). Personal data (`user_id`-owned in the
 * database), so it lives in the user's settings file under `citationAlerts.<paper id>`,
 * the same place as the other per-paper keys. Files mode has one local user and one
 * project, so `listForProject` returns every watch.
 */
import type { CitationAlertTrack, ICitationAlertTrackRepository, NewCitationAlertTrackInput } from "@weaveforge/core";
import type { SettingsSection } from "./file-tag-repo";

type Stored = { id: string; trackedAt: string; lastCheckedAt?: string; seenCitingIds: string[] };

function isStored(v: unknown): v is Stored {
  return v !== null && typeof v === "object" && typeof (v as Stored).id === "string";
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
  constructor(private readonly settings: SettingsSection) {}

  async track(input: NewCitationAlertTrackInput): Promise<CitationAlertTrack> {
    const existing = this.read(input.paperId);
    const now = new Date().toISOString();
    const stored: Stored = {
      id: existing?.id ?? crypto.randomUUID(),
      trackedAt: existing?.trackedAt ?? now,
      lastCheckedAt: input.lastCheckedAt ?? existing?.lastCheckedAt,
      seenCitingIds: [...(input.seenCitingIds ?? existing?.seenCitingIds ?? [])],
    };
    this.settings.set(["citationAlerts", input.paperId], stored);
    return toTrack(input.paperId, stored);
  }

  async untrack(paperId: string): Promise<void> {
    this.settings.set(["citationAlerts", paperId], undefined);
  }

  async listForProject(): Promise<CitationAlertTrack[]> {
    const all = this.settings.get(["citationAlerts"]);
    if (!all || typeof all !== "object") return [];
    return Object.entries(all as Record<string, unknown>)
      .filter((entry): entry is [string, Stored] => isStored(entry[1]))
      .map(([paperId, stored]) => toTrack(paperId, stored));
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
    this.settings.set(["citationAlerts", track.paperId], stored);
  }

  private read(paperId: string): Stored | null {
    const raw = this.settings.get(["citationAlerts", paperId]);
    return isStored(raw) ? raw : null;
  }
}
