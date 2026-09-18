import type { ReferenceLookupService, ResolvedReference } from "@/features/reader/application/reference-lookup";
import type { createReferenceActions } from "@/features/reader/application/reference-actions";
import type { ParsedReference, ReadingList } from "@weaveforge/core";

/**
 * What the reader's citation popover needs: a lookup that turns a parsed
 * bibliography entry into a record, and the actions the record offers.
 * Reading lists are read here too, so the "Add to list" picker does not need a
 * second facade.
 */
export class ReaderReferencesFacade {
  constructor(
    private readonly deps: {
      lookup: ReferenceLookupService;
      actions: ReturnType<typeof createReferenceActions>;
      listReadingLists: () => Promise<ReadingList[]>;
    },
  ) {}

  resolve(documentKey: string, entry: ParsedReference): Promise<ResolvedReference> {
    return this.deps.lookup.resolve(documentKey, entry);
  }

  get actions() {
    return this.deps.actions;
  }

  readingLists(): Promise<ReadingList[]> {
    return this.deps.listReadingLists();
  }
}
