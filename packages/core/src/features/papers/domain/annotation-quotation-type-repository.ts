import type {
  AnnotationQuotationType,
  SaveAnnotationQuotationTypeInput,
} from "./annotation-quotation-type.js";

export interface IAnnotationQuotationTypeRepository {
  save(input: SaveAnnotationQuotationTypeInput): Promise<AnnotationQuotationType>;
  remove(paperId: string, annotationKey: string): Promise<void>;
  listForPaper(paperId: string): Promise<AnnotationQuotationType[]>;
}
