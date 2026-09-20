import type {
  ManagePaperFieldsUseCase,
  PaperFieldKind,
  PaperFieldRollupAgg,
  PaperFieldValueData,
} from "@weaveforge/core";

/**
 * Custom paper fields: definitions, and the values papers carry for them.
 *
 * Split out of `PapersFacade`, which had grown to 39 public members and 16
 * constructor dependencies across four unrelated concerns. This is the cleanest
 * of the four: eight methods over one collaborator, and the only facade method
 * group that is about the *schema* of the library rather than its contents.
 *
 * The methods are pass-throughs, deliberately. The rules live in
 * `ManagePaperFieldsUseCase` — a field a rollup depends on cannot be removed,
 * options are tokens rather than labels — and a facade that re-implemented any
 * of them would be a second place to get them wrong.
 */
export class PaperFieldsFacade {
  constructor(
    private readonly deps: {
      paperFields: ManagePaperFieldsUseCase;
    },
  ) {}

  listPaperFieldDefs() {
    return this.deps.paperFields.listDefs();
  }

  listPaperFieldValuesForPaper(paperId: string) {
    return this.deps.paperFields.listValuesForPaper(paperId);
  }

  listPaperFieldValuesForProject() {
    return this.deps.paperFields.listValuesForProject();
  }

  definePaperField(input: {
    name: string;
    kind: PaperFieldKind;
    options?: string[];
    rollup?: {
      relationFieldId: string;
      agg: PaperFieldRollupAgg;
      sourceFieldId?: string;
    };
  }) {
    return this.deps.paperFields.define(input);
  }

  renamePaperField(fieldId: string, name: string) {
    return this.deps.paperFields.rename(fieldId, name);
  }

  updatePaperFieldOptions(fieldId: string, options: string[]) {
    return this.deps.paperFields.updateOptions(fieldId, options);
  }

  removePaperField(fieldId: string) {
    return this.deps.paperFields.remove(fieldId);
  }

  setPaperFieldValue(
    paperId: string,
    fieldId: string,
    value: PaperFieldValueData | null,
  ) {
    return this.deps.paperFields.setValue(paperId, fieldId, value);
  }
}
