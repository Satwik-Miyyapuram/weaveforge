import type { PaperStatus } from "./paper.js";

/**
 * The little a citation link needs to know about a paper in the library.
 *
 * Three fields, and each has a reader: `id` to link to, `title` to show, and
 * `status` to say whether the reader has read it. Nothing else is read by either
 * caller, which is the point — `findByDoi` and `findByArxivId` answer with a
 * whole `Paper`, so a citation lookup transferred the abstract, the bibtex and
 * the metadata bag of every reference it matched.
 *
 * It is the same lesson as `listSummaries`, in a different caller: a projection
 * typed as a full entity is a lie that costs columns, and a caller that only
 * needs an id should not be handed one.
 */
export interface PaperIdentity {
  id: string;
  title: string;
  status: PaperStatus;
}

/**
 * Looking a paper up by the identifier a citation carries.
 *
 * A port of its own rather than two more methods on `IPaperRepository` because
 * its callers do not have a repository: the citation linker and the reader's
 * reference panel want to know whether a DOI is in the library and what it looks
 * like, and nothing else. Depending on the narrow port is what keeps them from
 * growing a use for `list()` or `save()`.
 */
export interface IPaperIdentityLookup {
  findIdentityByArxivId(arxivId: string): Promise<PaperIdentity | null>;
  findIdentityByDoi(doi: string): Promise<PaperIdentity | null>;
}
