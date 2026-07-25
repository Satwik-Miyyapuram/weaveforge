import type { AnnotationPin, SaveAnnotationPinInput } from "./annotation-pin.js";

export interface IAnnotationPinRepository {
  save(input: SaveAnnotationPinInput): Promise<AnnotationPin>;
  remove(paperId: string, annotationKey: string): Promise<void>;
  listForProject(): Promise<AnnotationPin[]>;
  listForPaper(paperId: string): Promise<AnnotationPin[]>;
  listForSection(reportSectionId: string): Promise<AnnotationPin[]>;
}
