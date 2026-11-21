/**
 * True while `paperId` is still the paper on screen. Taken when async work
 * starts and checked after each await, so a late answer for one paper never
 * lands in the next one's view (P2-167). A late answer after going back to the
 * same paper is that paper's own, so it is let through.
 */
export function paperGuard(ref: { readonly current: string | null }, paperId: string): () => boolean {
  return () => ref.current === paperId;
}
