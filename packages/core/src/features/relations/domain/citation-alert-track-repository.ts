import type { CitationAlertTrack, NewCitationAlertTrackInput } from "./citation-alert-track.js";

export interface ICitationAlertTrackRepository {
  track(input: NewCitationAlertTrackInput): Promise<CitationAlertTrack>;
  untrack(paperId: string): Promise<void>;
  listForProject(): Promise<CitationAlertTrack[]>;
  getByPaperId(paperId: string): Promise<CitationAlertTrack | null>;
  save(track: CitationAlertTrack): Promise<void>;
}
