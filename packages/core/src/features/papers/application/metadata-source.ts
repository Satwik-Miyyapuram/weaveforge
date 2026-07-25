/**
 * Paper metadata source contract + resolver.
 *
 * Each external source (arXiv, Crossref, Semantic Scholar, Zotero) implements
 * `IMetadataSource`. The resolver delegates to the first source that supports a
 * given reference. Adding a new source means adding a class — never editing the
 * resolver or the use-case (Open/Closed Principle).
 */

import type { NewPaperInput } from "../domain/paper.js";

export type PaperRef =
  | { kind: "arxiv"; value: string }
  | { kind: "doi"; value: string }
  | { kind: "zotero"; value: string }
  | { kind: "url"; value: string };

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

export class MetadataResolutionError extends Error {
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
    const source = this.sources.find((s) => s.supports(ref));
    if (!source) {
      throw new MetadataResolutionError(
        `No metadata source supports reference of kind "${ref.kind}".`,
      );
    }
    return source.fetch(ref);
  }
}
