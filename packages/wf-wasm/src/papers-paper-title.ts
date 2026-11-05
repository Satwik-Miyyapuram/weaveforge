/**
 * Paper-title helpers (Rust `papers::paper_title`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/papers/domain/paper-title.ts.
 */
import {
  isPlaceholderTitle as rawIsPlaceholderTitle,
  titleFromFileName as rawTitleFromFileName,
  titleKey as rawTitleKey,
} from "../pkg/wf_wasm.js";

/** Whether a title is a placeholder rather than a paper's title. */
export function isPlaceholderTitle(title: string | null | undefined): boolean {
  return rawIsPlaceholderTitle(title ?? undefined);
}

/** The title inside a reference-manager filename, or the input unchanged. */
export function titleFromFileName(title: string): string {
  return rawTitleFromFileName(title);
}

/** A title reduced to its match key, or null when too short or a placeholder. */
export function titleKey(title: string | null | undefined): string | null {
  return rawTitleKey(title ?? undefined) ?? null;
}
