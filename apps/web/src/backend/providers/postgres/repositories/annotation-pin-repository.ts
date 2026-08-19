import type {
  AnnotationPin,
  IAnnotationPinRepository,
  ICurrentUserProvider,
  SaveAnnotationPinInput,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "../pg-runner";
import {
  type AnnotationPinRow,
  toDomain,
} from "@/features/papers/infrastructure/annotation-pin-rows";

export class PostgresAnnotationPinRepository implements IAnnotationPinRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get projectId() {
    const id = this.ctx.projectId;
    if (!id) throw new Error("Select a project before managing annotation pins.");
    return id;
  }

  async save(input: SaveAnnotationPinInput): Promise<AnnotationPin> {
    const userId = await this.session.requireUserId();
    const rows = await this.pg.query<AnnotationPinRow>(
      `insert into annotation_pins
         (user_id, project_id, paper_id, annotation_key, report_section_id)
       values ($1, $2, $3, $4, $5)
       on conflict (project_id, paper_id, annotation_key)
       do update set report_section_id = excluded.report_section_id
       returning *`,
      [userId, this.projectId, input.paperId, input.annotationKey, input.reportSectionId],
    );
    return toDomain(rows[0]!);
  }

  async remove(paperId: string, annotationKey: string): Promise<void> {
    await this.pg.query(
      `delete from annotation_pins
       where user_id = auth.uid() and project_id = $1
         and paper_id = $2 and annotation_key = $3`,
      [this.projectId, paperId, annotationKey],
    );
  }

  listForProject(): Promise<AnnotationPin[]> {
    return this.list();
  }

  listForPaper(paperId: string): Promise<AnnotationPin[]> {
    return this.list("paper_id", paperId);
  }

  listForSection(reportSectionId: string): Promise<AnnotationPin[]> {
    return this.list("report_section_id", reportSectionId);
  }

  private async list(column?: "paper_id" | "report_section_id", value?: string) {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    const filter = column ? ` and ${column} = $2` : "";
    const rows = await this.pg.query<AnnotationPinRow>(
      `select * from annotation_pins
       where user_id = auth.uid() and project_id = $1${filter}
       order by created_at asc`,
      column ? [projectId, value] : [projectId],
    );
    return rows.map(toDomain);
  }
}

