import type { Identifiable } from "../../../shared/repository.js";

/** Project-scoped placement of a Zotero annotation in a report section. */
export interface AnnotationPin extends Identifiable {
  id: string;
  paperId: string;
  annotationKey: string;
  reportSectionId: string;
  createdAt: string;
}

export interface SaveAnnotationPinInput {
  paperId: string;
  annotationKey: string;
  reportSectionId: string;
}
