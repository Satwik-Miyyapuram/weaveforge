import type {
  IPaperFieldRepository,
  PaperFieldDef,
  PaperFieldValue,
  SetPaperFieldValueInput,
} from "../features/papers/index.js";

export class InMemoryPaperFieldRepository implements IPaperFieldRepository {
  private readonly defs = new Map<string, PaperFieldDef>();
  private readonly values = new Map<string, PaperFieldValue>();
  private valueSeq = 0;

  async listDefs(): Promise<PaperFieldDef[]> {
    return [...this.defs.values()]
      .map((d) => cloneDef(d))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async saveDef(def: PaperFieldDef): Promise<void> {
    this.defs.set(def.id, cloneDef(def));
  }

  async deleteDef(id: string): Promise<void> {
    this.defs.delete(id);
    for (const [key, value] of this.values) {
      if (value.fieldId === id) this.values.delete(key);
    }
  }

  async listValuesForPaper(paperId: string): Promise<PaperFieldValue[]> {
    return (await this.listValuesForProject()).filter((v) => v.paperId === paperId);
  }

  async listValuesForProject(): Promise<PaperFieldValue[]> {
    return [...this.values.values()].map(cloneValue);
  }

  async setValue(input: SetPaperFieldValueInput): Promise<PaperFieldValue> {
    const mapKey = `${input.paperId}:${input.fieldId}`;
    const previous = this.values.get(mapKey);
    const row: PaperFieldValue = {
      id: previous?.id ?? `paper-field-value-${++this.valueSeq}`,
      paperId: input.paperId,
      fieldId: input.fieldId,
      value: cloneData(input.value),
    };
    this.values.set(mapKey, row);
    return cloneValue(row);
  }

  async removeValue(paperId: string, fieldId: string): Promise<void> {
    this.values.delete(`${paperId}:${fieldId}`);
  }
}

function cloneDef(def: PaperFieldDef): PaperFieldDef {
  return { ...def, options: [...def.options] };
}

function cloneValue(value: PaperFieldValue): PaperFieldValue {
  return { ...value, value: cloneData(value.value) };
}

function cloneData<T extends PaperFieldValue["value"]>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T;
}
