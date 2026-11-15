/** What decides whether the reader shows its side column (open or folded to a rail). */
export interface SidePanelInputs {
  /** Pages in the loaded document; 0 until it loads. */
  numPages: number;
  /** Annotations listed in the side panel. */
  annotations: number;
  /** The reader can add annotations to a saved paper. */
  canCreate: boolean;
}

/**
 * The side column takes width from the page, so it is decided before the first
 * paint: once the document is loaded it stays. The outline and the reference
 * list come later and must not add it, or the fit-width page jumps narrower;
 * each tab shows its own empty state instead.
 */
export function hasSidePanel({ numPages, annotations, canCreate }: SidePanelInputs): boolean {
  return numPages > 0 || annotations > 0 || canCreate;
}
