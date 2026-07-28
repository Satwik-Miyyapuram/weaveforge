import type {
  AnnotationQuotationType,
  IAnnotationQuotationTypeRepository,
  SaveAnnotationQuotationTypeInput,
} from "../features/papers/index.js";

export class InMemoryAnnotationQuotationTypeRepository
  implements IAnnotationQuotationTypeRepository
{
  private readonly items = new Map<string, AnnotationQuotationType>();

  async save(input: SaveAnnotationQuotationTypeInput): Promise<AnnotationQuotationType> {
    const mapKey = `${input.paperId}:${input.annotationKey}`;
    const previous = this.items.get(mapKey);
    const now = new Date().toISOString();
    const row: AnnotationQuotationType = {
      id: previous?.id ?? `quotation-type-${this.items.size + 1}`,
      paperId: input.paperId,
      annotationKey: input.annotationKey,
      quotationType: input.quotationType,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.items.set(mapKey, row);
    return structuredClone(row);
  }

  async remove(paperId: string, annotationKey: string): Promise<void> {
    this.items.delete(`${paperId}:${annotationKey}`);
  }

  async listForPaper(paperId: string): Promise<AnnotationQuotationType[]> {
    return [...this.items.values()]
      .filter((row) => row.paperId === paperId)
      .map((row) => structuredClone(row));
  }
}
