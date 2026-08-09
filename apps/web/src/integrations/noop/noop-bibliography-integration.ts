import type {
  BibliographyAnnotation,
  BibliographyCollection,
  BibliographySyncResult,
  IBibliographyIntegration,
  Paper,
} from "@weaveforge/core";

/** Disabled bibliography provider — safe no-ops for local-only deployments. */
export class NoopBibliographyIntegration implements IBibliographyIntegration {
  readonly providerId = "none";

  async syncLibrary(): Promise<BibliographySyncResult> {
    return { pushed: 0, pulled: 0, deletedLocal: 0 };
  }

  async pullAnnotations(): Promise<Map<string, BibliographyAnnotation[]>> {
    return new Map();
  }

  async pushPaper(_paper: Paper): Promise<string | undefined> {
    return undefined;
  }

  async removeRemotePaper(_remoteKey: string): Promise<void> {
    /* no remote library */
  }

  async listCollections(
    _credentials?: import("@weaveforge/core").BibliographyCredentials,
  ): Promise<BibliographyCollection[]> {
    return [];
  }
}
