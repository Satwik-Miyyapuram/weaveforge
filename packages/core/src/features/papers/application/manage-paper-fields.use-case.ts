/**
 * Project-scoped custom fields on papers: define / rename / set value.
 *
 * Rename only changes the definition name — values stay keyed by field id.
 */

import type { IdGenerator } from "../../../shared/clock.js";
import {
  encodeRollupOptions,
  isPaperFieldKind,
  PaperFieldValidationError,
  type NewPaperFieldDefInput,
  type PaperFieldDef,
  type PaperFieldKind,
  type PaperFieldValue,
  type PaperFieldValueData,
} from "../domain/paper-field.js";
import type { IPaperFieldRepository } from "../domain/paper-field-repository.js";

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
    if (!isPaperFieldKind(input.kind)) {
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
    await this.deps.fields.deleteDef(fieldId);
  }

  async setValue(
    paperId: string,
    fieldId: string,
    raw: PaperFieldValueData | null,
  ): Promise<PaperFieldValue | null> {
    if (!paperId) throw new PaperFieldValidationError("paperId is required.");
    const def = await this.requireDef(fieldId);
    if (def.kind === "rollup") {
      throw new PaperFieldValidationError("Rollup fields are computed and read-only.");
    }
    if (raw == null || isEmptyValue(raw)) {
      await this.deps.fields.removeValue(paperId, fieldId);
      return null;
    }
    const value = coerceValue(def.kind, raw);
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
  return raw.trim().replace(/\s+/g, " ");
}

function normalizeOptions(
  kind: PaperFieldKind,
  raw: string[] | undefined,
  rollup?: NewPaperFieldDefInput["rollup"],
): string[] {
  if (kind === "rollup") {
    if (!rollup) return [];
    return encodeRollupOptions(rollup);
  }
  if (kind !== "select" && kind !== "multi_select") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw ?? []) {
    const t = item.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function isEmptyValue(raw: PaperFieldValueData | null): boolean {
  if (raw == null) return true;
  if (typeof raw === "string") return raw.trim() === "";
  if (Array.isArray(raw)) return raw.length === 0;
  return false;
}

function coerceValue(kind: PaperFieldKind, raw: PaperFieldValueData): PaperFieldValueData {
  switch (kind) {
    case "text":
    case "select": {
      if (typeof raw !== "string") {
        throw new PaperFieldValidationError(`Field kind "${kind}" expects a string.`);
      }
      const trimmed = raw.trim();
      if (!trimmed) throw new PaperFieldValidationError("Value is required.");
      return trimmed;
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) {
        throw new PaperFieldValidationError("Value must be a finite number.");
      }
      return n;
    }
    case "multi_select":
    case "relation": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) {
        throw new PaperFieldValidationError(`${kind} expects a string array.`);
      }
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of raw) {
        const t = item.trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
      return out;
    }
    case "rollup":
      throw new PaperFieldValidationError("Rollup fields are computed and read-only.");
  }
}
