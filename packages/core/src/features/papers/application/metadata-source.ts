/**
 * Paper metadata source contract + resolver.
 *
 * Each external source (arXiv, Crossref, Semantic Scholar, Zotero) implements
 * `IMetadataSource`. The resolver delegates to the first source that supports a
 * given reference. Adding a new source means adding a class — never editing the
 * resolver or the use-case (Open/Closed Principle).
 */

import type { NewPaperInput } from "../domain/paper.js";
import { WeaveForgeError } from "../../../shared/errors.js";

export type PaperRef =
  | { kind: "arxiv"; value: string }
  | { kind: "doi"; value: string }
  | { kind: "zotero"; value: string }
  | { kind: "url"; value: string }
  | { kind: "bibliographic"; value: string; hints?: { title?: string; year?: number; firstAuthor?: string } };

/** Metadata returned by a source, shaped to feed `createPaper`. */
export type PaperMetadata = NewPaperInput;

export interface IMetadataSource {
  /** Stable id, e.g. "arxiv". */
  readonly id: string;
  /** Whether this source can resolve the given reference. */
  supports(ref: PaperRef): boolean;
  /** Fetch and normalize metadata for the reference. */
  fetch(ref: PaperRef): Promise<PaperMetadata>;
}

export class MetadataResolutionError extends WeaveForgeError {
  constructor(message: string) {
    super(message);
    this.name = "MetadataResolutionError";
  }
}

export class MetadataResolver {
  private readonly sources: readonly IMetadataSource[];

  constructor(sources: readonly IMetadataSource[]) {
    this.sources = sources;
  }

  async resolve(ref: PaperRef): Promise<PaperMetadata> {
    const { metadata } = await this.resolveWithSource(ref);
    return metadata;
  }

  /**
   * Resolution with the answering source's id. Identifier refs keep their
   * original semantics (first supporting source, errors surface); a
   * bibliographic search tries each provider in order — S2, then OpenAlex —
   * and only fails when no provider matches.
   */
  async resolveWithSource(ref: PaperRef): Promise<{ metadata: PaperMetadata; sourceId: string }> {
    const sources = this.sources.filter((s) => s.supports(ref));
    if (!sources.length) {
      throw new MetadataResolutionError(
        `No metadata source supports reference of kind "${ref.kind}".`,
      );
    }
    if (ref.kind !== "bibliographic") {
      const source = sources[0]!;
      return { metadata: await source.fetch(ref), sourceId: source.id };
    }
    for (const source of sources) {
      try {
        return { metadata: await source.fetch(ref), sourceId: source.id };
      } catch {
        /* try the next search provider */
      }
    }
    throw new MetadataResolutionError("No bibliographic metadata match found.");
  }
}
