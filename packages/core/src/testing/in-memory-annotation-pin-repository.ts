import type {
  AnnotationPin,
  IAnnotationPinRepository,
  SaveAnnotationPinInput,
} from "../features/papers/index.js";

export class InMemoryAnnotationPinRepository implements IAnnotationPinRepository {
  private readonly items = new Map<string, AnnotationPin>();

  async save(input: SaveAnnotationPinInput): Promise<AnnotationPin> {
    const mapKey = `${input.paperId}:${input.annotationKey}`;
    const previous = this.items.get(mapKey);
    const pin: AnnotationPin = {
      id: previous?.id ?? `annotation-pin-${this.items.size + 1}`,
      ...input,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
    };
    this.items.set(mapKey, pin);
    return structuredClone(pin);
  }

  async remove(paperId: string, annotationKey: string): Promise<void> {
    this.items.delete(`${paperId}:${annotationKey}`);
  }

  async listForProject(): Promise<AnnotationPin[]> {
    return [...this.items.values()].map((item) => structuredClone(item));
  }

  async listForPaper(paperId: string): Promise<AnnotationPin[]> {
    return (await this.listForProject()).filter((pin) => pin.paperId === paperId);
  }

  async listForSection(reportSectionId: string): Promise<AnnotationPin[]> {
    return (await this.listForProject()).filter(
      (pin) => pin.reportSectionId === reportSectionId,
    );
  }
}
