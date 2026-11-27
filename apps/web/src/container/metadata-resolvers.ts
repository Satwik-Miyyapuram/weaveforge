/** Paper metadata lookup: the import resolver and the reader's citation resolver. */
import type { IMetadataSource } from "@weaveforge/core";
import { MetadataResolver } from "@weaveforge/core";
import { SemanticScholarMetadataSource, UrlMetadataSource } from "@/features/papers/infrastructure/parts-2";
import { ArxivMetadataSource, CrossrefMetadataSource } from "@/features/papers/infrastructure/parts";
import { OpenAlexMetadataSource, type wireBackend } from "@/container/parts";
import { createCredentialReader } from "@/integrations/parts";
import { relayUrl } from "@/lib/parts";

export function createMetadataResolvers(
  manageSettings: ReturnType<typeof wireBackend>["manageSettings"],
  bibliographyMetadataSource?: IMetadataSource,
): { resolver: MetadataResolver; readerResolver: MetadataResolver } {
  // The key is read at call time: it is only decryptable after unlock.
  const semanticScholarSource = new SemanticScholarMetadataSource(undefined, undefined, () =>
    createCredentialReader(manageSettings)("semantic-scholar", "apiKey"),
  );
  const openAlexSource = new OpenAlexMetadataSource(undefined, undefined, undefined, () =>
    createCredentialReader(manageSettings)("semantic-scholar", "openAlexKey"),
  );

  const resolver = new MetadataResolver([
    new ArxivMetadataSource(undefined, relayUrl("/api/arxiv")),
    new CrossrefMetadataSource(),
    ...(bibliographyMetadataSource
      ? [bibliographyMetadataSource]
      : []),
    // Title-only lookups for the reader's citation popover. Semantic Scholar
    // first (its match endpoint is built for this), OpenAlex as the fallback.
    semanticScholarSource,
    openAlexSource,
    new UrlMetadataSource(),
  ], true); // A source that says no (Crossref on a DataCite DOI) falls through to the next.
  // The reader's citation lookup: Semantic Scholar is the first provider for
  // DOI, arXiv and title+author+year alike, with OpenAlex/Crossref behind it.
  // Desktop requests reach the API through #242's relay (see
  // `semanticScholarUrl`), not a second direct network path. Identifier refs
  // cascade so a DOI Semantic Scholar does not know still lands in Crossref.
  const readerResolver = new MetadataResolver(
    [semanticScholarSource, openAlexSource, new CrossrefMetadataSource(), new ArxivMetadataSource(undefined, relayUrl("/api/arxiv"))],
    true,
  );
  return { resolver, readerResolver };
}
