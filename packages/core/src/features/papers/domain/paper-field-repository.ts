import type {
  PaperFieldDef,
  PaperFieldValue,
  SetPaperFieldValueInput,
} from "./paper-field.js";

/**
 * Project-scoped custom field defs + values. Implementations are scoped to the
 * current user/project the same way as annotation pins.
 */
export interface IPaperFieldRepository {
  listDefs(): Promise<PaperFieldDef[]>;
  saveDef(def: PaperFieldDef): Promise<void>;
  deleteDef(id: string): Promise<void>;

  listValuesForPaper(paperId: string): Promise<PaperFieldValue[]>;
  listValuesForProject(): Promise<PaperFieldValue[]>;
  /** Upsert by (paperId, fieldId); preserves id on update. */
  setValue(input: SetPaperFieldValueInput): Promise<PaperFieldValue>;
  removeValue(paperId: string, fieldId: string): Promise<void>;
}
