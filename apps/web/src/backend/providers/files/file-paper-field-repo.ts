/**
 * Custom paper fields from files (0.9.7 L3). Same contract as the `paper_fields`
 * repo; laws in test/file-paper-field-repo.test.ts.
 *
 * - Definitions live in `.weaveforge/settings.json` under `paperFields`:
 *   `{ "<field id>": { "name", "kind", "options", "sortOrder" } }`.
 * - A paper's values live in its `fields` frontmatter, keyed by field id:
 *   `fields: {"f1": "text", "f2": 4.5, "f3": ["nlp"]}`. A `relation` field names
 *   its papers by `[[link]]`, never by id.
 * - A value's id is `<paper id>:<field id>`: one value per paper and field.
 * - A value for a field that has no definition is not listed but stays in the file.
 */
import {
  NotFoundError,
  type IPaperFieldRepository,
  type IWorkspaceFs,
  type PaperFieldDef,
  type PaperFieldValue,
  type PaperFieldValueData,
  type SetPaperFieldValueInput,
} from "@weaveforge/core";
import type { FilePaperRepository } from "@/features/papers/infrastructure/file-paper-repository";
import type { ProjectRoot } from "./file-entity-store";
import type { SettingsSection } from "./file-tag-repo";
import { LinkIndex } from "./link-index";

const DEFS = "paperFields";

/** The slice of `FilePaperRepository` this needs. */
export type FieldedPapers = Pick<FilePaperRepository, "listExtras" | "updateExtras">;

function valueId(paperId: string, fieldId: string): string {
  return `${paperId}:${fieldId}`;
}

function isValue(v: unknown): v is PaperFieldValueData {
  return typeof v === "string" || typeof v === "number" || (Array.isArray(v) && v.every((x) => typeof x === "string"));
}

export class FilePaperFieldRepository implements IPaperFieldRepository {
  private readonly links: LinkIndex;

  constructor(
    private readonly papers: FieldedPapers,
    private readonly settings: SettingsSection,
    fs: IWorkspaceFs,
    root: ProjectRoot,
  ) {
    this.links = new LinkIndex(fs, root);
  }

  listDefs(): Promise<PaperFieldDef[]> {
    return Promise.resolve(
      [...this.defs().values()].sort((a, b) => a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    );
  }

  saveDef({ id, name, kind, options, sortOrder }: PaperFieldDef): Promise<void> {
    this.settings.set([DEFS, id], { name, kind, options: [...options], sortOrder });
    return Promise.resolve();
  }

  /** Drops the definition; papers keep their values in the file, unlisted. */
  deleteDef(id: string): Promise<void> {
    this.settings.set([DEFS, id], undefined);
    return Promise.resolve();
  }

  async listValuesForPaper(paperId: string): Promise<PaperFieldValue[]> {
    return (await this.listValuesForProject()).filter((v) => v.paperId === paperId);
  }

  async listValuesForProject(): Promise<PaperFieldValue[]> {
    const defs = this.defs();
    const out: PaperFieldValue[] = [];
    for (const { paperId, extras } of await this.papers.listExtras()) {
      for (const [fieldId, raw] of Object.entries(extras.fields)) {
        const def = defs.get(fieldId);
        if (!def || !isValue(raw)) continue;
        const value = def.kind === "relation" && Array.isArray(raw) ? await this.paperIds(raw) : raw;
        out.push({ id: valueId(paperId, fieldId), paperId, fieldId, value });
      }
    }
    return out;
  }

  async setValue({ paperId, fieldId, value }: SetPaperFieldValueInput): Promise<PaperFieldValue> {
    const def = this.defs().get(fieldId);
    if (!def) throw new NotFoundError(`No paper field with id "${fieldId}".`);
    const stored = def.kind === "relation" && Array.isArray(value) ? await this.linksFor(value) : value;
    const written = await this.papers.updateExtras(paperId, ({ fields }) => ({ fields: { ...fields, [fieldId]: stored } }));
    if (!written) throw new NotFoundError(`No paper with id "${paperId}".`);
    return { id: valueId(paperId, fieldId), paperId, fieldId, value: Array.isArray(value) ? [...value] : value };
  }

  async removeValue(paperId: string, fieldId: string): Promise<void> {
    await this.papers.updateExtras(paperId, ({ fields }) => {
      const { [fieldId]: _gone, ...rest } = fields;
      return { fields: rest };
    });
  }

  private defs(): Map<string, PaperFieldDef> {
    const raw = this.settings.get([DEFS]);
    const out = new Map<string, PaperFieldDef>();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [id, d] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
      if (!d || typeof d !== "object" || typeof d.name !== "string" || typeof d.kind !== "string") continue;
      out.set(id, {
        id,
        name: d.name,
        kind: d.kind as PaperFieldDef["kind"],
        options: Array.isArray(d.options) ? d.options.filter((o): o is string => typeof o === "string") : [],
        sortOrder: typeof d.sortOrder === "number" ? d.sortOrder : 0,
      });
    }
    return out;
  }

  /** Paper ids as `[[links]]`; an id with no file is kept as it is. */
  private async linksFor(ids: readonly string[]): Promise<string[]> {
    const out: string[] = [];
    for (const id of ids) out.push((await this.links.linkFor({ paperId: id })) ?? id);
    return out;
  }

  /** `[[links]]` (or bare ids) as paper ids; a link that resolves to nothing is dropped. */
  private async paperIds(links: readonly string[]): Promise<string[]> {
    const out: string[] = [];
    for (const link of links) {
      if (!link.startsWith("[[")) {
        out.push(link);
        continue;
      }
      const target = await this.links.resolve(link);
      if (target && "paperId" in target) out.push(target.paperId);
    }
    return out;
  }
}
