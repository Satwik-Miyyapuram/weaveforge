import type { ReferenceLookupService, ResolvedReference } from "@/features/reader/application/reference-lookup";
import type { createReferenceActions } from "@/features/reader/application/reference-actions";
import type { ParsedReference } from "@weaveforge/core";

/**
 * What the reader's citation popover needs: a lookup that turns a parsed
 * bibliography entry into a record, and the actions the record offers.
 */
export class ReaderReferencesFacade {
  constructor(
    private readonly deps: {
      lookup: ReferenceLookupService;
      actions: ReturnType<typeof createReferenceActions>;
    },
  ) {}

  resolve(documentKey: string, entry: ParsedReference): Promise<ResolvedReference> {
    return this.deps.lookup.resolve(documentKey, entry);
  }

  get actions() {
    return this.deps.actions;
  }
}
