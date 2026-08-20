import type {
  AnnotationQuotationType,
  IAnnotationQuotationTypeRepository,
  ICurrentUserProvider,
  QuotationType,
  SaveAnnotationQuotationTypeInput,
} from "@weaveforge/core";
import { isQuotationType } from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "../pg-runner";
import {
  type AnnotationQuotationTypeRow,
  toDomain,
} from "@/features/papers/infrastructure/annotation-quotation-type-rows";

export class PostgresAnnotationQuotationTypeRepository
  implements IAnnotationQuotationTypeRepository
{
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get projectId() {
    const id = this.ctx.projectId;
    if (!id) throw new Error("Select a project before managing quotation types.");
    return id;
  }

  async save(input: SaveAnnotationQuotationTypeInput): Promise<AnnotationQuotationType> {
    if (!isQuotationType(input.quotationType)) {
      throw new Error(`Invalid quotation type: ${input.quotationType}`);
    }
    const userId = await this.session.requireUserId();
    const rows = await this.pg.query<AnnotationQuotationTypeRow>(
      `insert into annotation_quotation_types
         (user_id, project_id, paper_id, annotation_key, quotation_type, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (project_id, paper_id, annotation_key)
       do update set quotation_type = excluded.quotation_type, updated_at = now()
       returning *`,
      [userId, this.projectId, input.paperId, input.annotationKey, input.quotationType],
    );
    return toDomain(rows[0]!);
  }

  async remove(paperId: string, annotationKey: string): Promise<void> {
    await this.pg.query(
      `delete from annotation_quotation_types
       where user_id = auth.uid() and project_id = $1
         and paper_id = $2 and annotation_key = $3`,
      [this.projectId, paperId, annotationKey],
    );
  }

  async listForPaper(paperId: string): Promise<AnnotationQuotationType[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    const rows = await this.pg.query<AnnotationQuotationTypeRow>(
      `select * from annotation_quotation_types
       where user_id = auth.uid() and project_id = $1 and paper_id = $2
       order by created_at asc`,
      [projectId, paperId],
    );
    return rows.map(toDomain);
  }
}

