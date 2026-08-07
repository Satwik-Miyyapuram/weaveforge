import type {
  CitationAlertTrack,
  ICitationAlertTrackRepository,
  ICurrentUserProvider,
  NewCitationAlertTrackInput,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "../pg-runner";

interface TrackRow {
  id: string;
  paper_id: string;
  tracked_at: string;
  last_checked_at: string | null;
  seen_citing_ids: string[] | null;
}

export class PostgresCitationAlertTrackRepository implements ICitationAlertTrackRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get projectId() {
    const id = this.ctx.projectId;
    if (!id) throw new Error("Select a project before managing citation alerts.");
    return id;
  }

  async track(input: NewCitationAlertTrackInput): Promise<CitationAlertTrack> {
    const userId = await this.session.requireUserId();
    const rows = await this.pg.query<TrackRow>(
      `insert into citation_alert_tracks
         (user_id, project_id, paper_id, seen_citing_ids, last_checked_at)
       values ($1, $2, $3, $4, $5)
       on conflict (project_id, paper_id)
       do update set
         seen_citing_ids = excluded.seen_citing_ids,
         last_checked_at = excluded.last_checked_at
       returning *`,
      [
        userId,
        this.projectId,
        input.paperId,
        input.seenCitingIds ?? [],
        input.lastCheckedAt ?? null,
      ],
    );
    return toDomain(rows[0]!);
  }

  async untrack(paperId: string): Promise<void> {
    await this.pg.query(
      `delete from citation_alert_tracks
       where user_id = auth.uid()
         and project_id = $1
         and paper_id = $2`,
      [this.projectId, paperId],
    );
  }

  async listForProject(): Promise<CitationAlertTrack[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    const rows = await this.pg.query<TrackRow>(
      `select * from citation_alert_tracks
       where user_id = auth.uid() and project_id = $1
       order by tracked_at desc`,
      [projectId],
    );
    return rows.map(toDomain);
  }

  async getByPaperId(paperId: string): Promise<CitationAlertTrack | null> {
    const projectId = this.ctx.projectId;
    if (!projectId) return null;
    const rows = await this.pg.query<TrackRow>(
      `select * from citation_alert_tracks
       where user_id = auth.uid()
         and project_id = $1
         and paper_id = $2
       limit 1`,
      [projectId, paperId],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async save(track: CitationAlertTrack): Promise<void> {
    await this.pg.query(
      `update citation_alert_tracks
       set last_checked_at = $2,
           seen_citing_ids = $3
       where id = $1
         and user_id = auth.uid()
         and project_id = $4`,
      [track.id, track.lastCheckedAt ?? null, track.seenCitingIds, this.projectId],
    );
  }
}

function toDomain(row: TrackRow): CitationAlertTrack {
  return {
    id: row.id,
    paperId: row.paper_id,
    trackedAt: row.tracked_at,
    lastCheckedAt: row.last_checked_at ?? undefined,
    seenCitingIds: row.seen_citing_ids ?? [],
  };
}
