import type {
  ICurrentUserProvider,
  IPaperFieldRepository,
  PaperFieldDef,
  PaperFieldKind,
  PaperFieldValue,
  PaperFieldValueData,
  SetPaperFieldValueInput,
} from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "../pg-runner";

interface DefRow {
  id: string;
  name: string;
  kind: string;
  options: unknown;
  sort_order: number;
}

interface ValueRow {
  id: string;
  paper_id: string;
  field_id: string;
  value: unknown;
}

export class PostgresPaperFieldRepository implements IPaperFieldRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get projectId() {
    const id = this.ctx.projectId;
    if (!id) throw new Error("Select a project before managing paper fields.");
    return id;
  }

  async listDefs(): Promise<PaperFieldDef[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    const rows = await this.pg.query<DefRow>(
      `select id, name, kind, options, sort_order from paper_field_defs
       where user_id = auth.uid() and project_id = $1
       order by sort_order asc, name asc`,
      [projectId],
    );
    return rows.map(toDef);
  }

  async saveDef(def: PaperFieldDef): Promise<void> {
    const userId = await this.session.requireUserId();
    await this.pg.query(
      `insert into paper_field_defs
         (id, user_id, project_id, name, kind, options, sort_order)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7)
       on conflict (id) do update set
         name = excluded.name,
         kind = excluded.kind,
         options = excluded.options,
         sort_order = excluded.sort_order`,
      [
        def.id,
        userId,
        this.projectId,
        def.name,
        def.kind,
        JSON.stringify(def.options),
        def.sortOrder,
      ],
    );
  }

  async deleteDef(id: string): Promise<void> {
    await this.pg.query(
      `delete from paper_field_defs
       where user_id = auth.uid() and project_id = $1 and id = $2`,
      [this.projectId, id],
    );
  }

  listValuesForPaper(paperId: string): Promise<PaperFieldValue[]> {
    return this.listValues(paperId);
  }

  listValuesForProject(): Promise<PaperFieldValue[]> {
    return this.listValues();
  }

  async setValue(input: SetPaperFieldValueInput): Promise<PaperFieldValue> {
    const userId = await this.session.requireUserId();
    const rows = await this.pg.query<ValueRow>(
      `insert into paper_field_values
         (user_id, project_id, paper_id, field_id, value)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (project_id, paper_id, field_id)
       do update set value = excluded.value
       returning id, paper_id, field_id, value`,
      [
        userId,
        this.projectId,
        input.paperId,
        input.fieldId,
        JSON.stringify(input.value),
      ],
    );
    return toValue(rows[0]!);
  }

  async removeValue(paperId: string, fieldId: string): Promise<void> {
    await this.pg.query(
      `delete from paper_field_values
       where user_id = auth.uid() and project_id = $1
         and paper_id = $2 and field_id = $3`,
      [this.projectId, paperId, fieldId],
    );
  }

  private async listValues(paperId?: string): Promise<PaperFieldValue[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    const filter = paperId ? " and paper_id = $2" : "";
    const rows = await this.pg.query<ValueRow>(
      `select id, paper_id, field_id, value from paper_field_values
       where user_id = auth.uid() and project_id = $1${filter}
       order by paper_id, field_id`,
      paperId ? [projectId, paperId] : [projectId],
    );
    return rows.map(toValue);
  }
}

function toDef(row: DefRow): PaperFieldDef {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as PaperFieldKind,
    options: asStringArray(row.options),
    sortOrder: row.sort_order,
  };
}

function toValue(row: ValueRow): PaperFieldValue {
  return {
    id: row.id,
    paperId: row.paper_id,
    fieldId: row.field_id,
    value: asValueData(row.value),
  };
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

function asValueData(raw: unknown): PaperFieldValueData {
  if (typeof raw === "string" || typeof raw === "number") return raw;
  if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) return raw;
  throw new Error("Invalid paper field value payload.");
}
