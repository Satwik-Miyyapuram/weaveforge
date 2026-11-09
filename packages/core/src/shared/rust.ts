/**
 * The Rust core, as packages/core sees it. This package cannot import the wasm
 * package, so the app registers the loaded module here (apps/web
 * `lib/rust-core.ts`), and core glue calls Rust through `rust()`.
 *
 * `RustCoreFns` lists only the functions core calls. Add a line when a core
 * file starts calling a new one: the app's `setRustCore(module)` call fails to
 * typecheck if the wasm module does not export it with that signature.
 */
import type { PaperRef } from "../features/papers/application/metadata-source.js";
import type { HashtagRef } from "../features/papers/domain/paper.js";
import type { PaperFieldKind, PaperFieldRollupConfig } from "../features/papers/domain/paper-field.js";
import type {
  EuropePmcAnswer,
  OpenAccessCandidate,
} from "../features/papers/application/open-access.js";

export interface RustCoreFns {
  normalizeDoi(doi?: string): string | undefined;
  // papers: open access
  resolveArxivId(arxivId: string | null | undefined, doi: string | null | undefined): string | undefined;
  cleanPmcid(id: string | null | undefined): string | undefined;
  knownCandidates(knownPdf: string | null | undefined, page: string | null | undefined): OpenAccessCandidate[];
  pmcCandidates(pmcid: string, license?: string): OpenAccessCandidate[];
  arxivCandidates(arxivId: string): OpenAccessCandidate[];
  parseOpenalex(body: unknown): OpenAccessCandidate[];
  parseUnpaywall(body: unknown): OpenAccessCandidate[];
  parseSemanticScholar(body: unknown): OpenAccessCandidate[];
  parseEuropePmc(body: unknown): EuropePmcAnswer;
  parseBiorxiv(body: unknown, server: string): OpenAccessCandidate[];
  parseDoaj(body: unknown): OpenAccessCandidate[];
  parseZenodo(body: unknown): OpenAccessCandidate[];
  parseHal(body: unknown): OpenAccessCandidate[];
  rankOpenAccessCandidates(candidates: readonly OpenAccessCandidate[]): OpenAccessCandidate[];
  // papers
  titleKey(title?: string | null): string | undefined;
  isPlaceholderTitle(title?: string | null): boolean;
  titleFromFileName(title: string): string;
  parsePaperRef(kind: PaperRef["kind"], value: string): PaperRef;
  normalizeTags(tags: string[]): string[];
  extractHashtagRefs(text?: string): HashtagRef[];
  extractHashtags(text?: string): string[];
  isEmptyPaperSummary(summary: string | null | undefined): boolean;
  isPaperFieldKind(value: string): value is PaperFieldKind;
  encodeRollupOptions(config: PaperFieldRollupConfig): string[];
  parseRollupOptions(options: readonly string[]): PaperFieldRollupConfig | null;
}

let core: RustCoreFns | null = null;

export function setRustCore(module: RustCoreFns): void {
  core = module;
}

export function rust(): RustCoreFns {
  if (!core) throw new Error("Rust core not registered yet: the app calls setRustCore() after loading it");
  return core;
}
