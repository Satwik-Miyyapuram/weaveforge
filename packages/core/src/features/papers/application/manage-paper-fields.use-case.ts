/**
 * Project-scoped custom fields on papers: define / rename / set value.
 *
 * Rename only changes the definition name — values stay keyed by field id.
 */

import type { IdGenerator } from "../../../shared/clock.js";
import { PaperFieldValidationError, type NewPaperFieldDefInput, type PaperFieldDef, type PaperFieldKind, type PaperFieldValue, type PaperFieldValueData } from "../domain/paper-field.js";
import type { IPaperFieldRepository } from "../domain/paper-field-repository.js";
import { rust } from "../../../shared/rust.js";

export interface ManagePaperFieldsDeps {
  fields: IPaperFieldRepository;
  ids: IdGenerator;
}

export class ManagePaperFieldsUseCase {
  constructor(private readonly deps: ManagePaperFieldsDeps) {}

  listDefs(): Promise<PaperFieldDef[]> {
    return this.deps.fields.listDefs();
  }

  listValuesForPaper(paperId: string): Promise<PaperFieldValue[]> {
    return this.deps.fields.listValuesForPaper(paperId);
  }

  listValuesForProject(): Promise<PaperFieldValue[]> {
    return this.deps.fields.listValuesForProject();
  }

  async define(input: NewPaperFieldDefInput): Promise<PaperFieldDef> {
    const name = normalizeName(input.name);
    if (!name) throw new PaperFieldValidationError("Field name is required.");
    if (!rust().isPaperFieldKind(input.kind)) {
      throw new PaperFieldValidationError(`Unknown field kind "${input.kind}".`);
    }
    if (input.kind === "rollup") {
      if (!input.rollup) {
        throw new PaperFieldValidationError("Rollup fields require a rollup config.");
      }
      await this.validateRollupConfig(input.rollup.relationFieldId, input.rollup.sourceFieldId);
    }
    const options = normalizeOptions(input.kind, input.options, input.rollup);
    const existing = await this.deps.fields.listDefs();
    if (existing.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
      throw new PaperFieldValidationError(`A field named "${name}" already exists.`);
    }
    const sortOrder =
      existing.length === 0 ? 0 : Math.max(...existing.map((d) => d.sortOrder)) + 1;
    const def: PaperFieldDef = {
      id: this.deps.ids.newId(),
      name,
      kind: input.kind,
      options,
      sortOrder,
    };
    await this.deps.fields.saveDef(def);
    return def;
  }

  async rename(fieldId: string, rawName: string): Promise<PaperFieldDef> {
    const name = normalizeName(rawName);
    if (!name) throw new PaperFieldValidationError("Field name is required.");
    const def = await this.requireDef(fieldId);
    const existing = await this.deps.fields.listDefs();
    if (
      existing.some(
        (d) => d.id !== fieldId && d.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new PaperFieldValidationError(`A field named "${name}" already exists.`);
    }
    const updated: PaperFieldDef = { ...def, name };
    await this.deps.fields.saveDef(updated);
    return updated;
  }

  async updateOptions(fieldId: string, rawOptions: string[]): Promise<PaperFieldDef> {
    const def = await this.requireDef(fieldId);
    if (def.kind !== "select" && def.kind !== "multi_select") {
      throw new PaperFieldValidationError("Only select fields have options.");
    }
    const updated: PaperFieldDef = {
      ...def,
      options: normalizeOptions(def.kind, rawOptions),
    };
    await this.deps.fields.saveDef(updated);
    return updated;
  }

  async remove(fieldId: string): Promise<void> {
    await this.requireDef(fieldId);
    // A rollup that reads this field would be left pointing at nothing, so the
    // user removes the rollup first. Values go with the def (repository/DB cascade).
    const readers = (await this.deps.fields.listDefs()).filter((d) => {
      if (d.kind !== "rollup") return false;
      const config = rust().parseRollupOptions(d.options);
      return config?.relationFieldId === fieldId || config?.sourceFieldId === fieldId;
    });
    if (readers.length > 0) {
      const names = readers.map((d) => `"${d.name}"`).join(", ");
      throw new PaperFieldValidationError(
        `This field is used by the rollup ${names}. Remove the rollup first.`,
      );
    }
    await this.deps.fields.deleteDef(fieldId);
  }

  async setValue(
    paperId: string,
    fieldId: string,
    raw: PaperFieldValueData | null,
  ): Promise<PaperFieldValue | null> {
    if (!paperId) throw new PaperFieldValidationError("paperId is required.");
    const def = await this.requireDef(fieldId);
    const value = checkedValue(def.kind, raw);
    if (value == null) {
      await this.deps.fields.removeValue(paperId, fieldId);
      return null;
    }
    return this.deps.fields.setValue({ paperId, fieldId, value });
  }

  private async requireDef(fieldId: string): Promise<PaperFieldDef> {
    const def = (await this.deps.fields.listDefs()).find((d) => d.id === fieldId);
    if (!def) throw new PaperFieldValidationError(`No field with id "${fieldId}".`);
    return def;
  }

  private async validateRollupConfig(
    relationFieldId: string,
    sourceFieldId?: string,
  ): Promise<void> {
    const defs = await this.deps.fields.listDefs();
    const relation = defs.find((d) => d.id === relationFieldId);
    if (!relation || relation.kind !== "relation") {
      throw new PaperFieldValidationError("Rollup must reference a relation field.");
    }
    if (!sourceFieldId) return;
    const source = defs.find((d) => d.id === sourceFieldId);
    if (!source || source.kind === "rollup" || source.kind === "relation") {
      throw new PaperFieldValidationError("Rollup source must be a value field.");
    }
  }
}

function normalizeName(raw: string): string {
  return rust().normalizeFieldName(raw);
}

function normalizeOptions(
  kind: PaperFieldKind,
  raw: string[] | undefined,
  rollup?: NewPaperFieldDefInput["rollup"],
): string[] {
  if (kind === "rollup") {
    if (!rollup) return [];
    return rust().encodeRollupOptions(rollup);
  }
  if (kind !== "select" && kind !== "multi_select") return [];
  return rust().normalizeSelectOptions(raw ?? []);
}

/** The checked value for `kind`, or null to clear it. Refusals become PaperFieldValidationError. */
function checkedValue(kind: PaperFieldKind, raw: PaperFieldValueData | null): PaperFieldValueData | null {
  const core = rust();
  try {
    return core.coercePaperFieldValue(kind, raw);
  } catch (error) {
    throw new PaperFieldValidationError(error instanceof Error ? error.message : String(error));
  }
}
