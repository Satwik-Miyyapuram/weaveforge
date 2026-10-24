import type { IPaperRepository } from "@weaveforge/core";
import { cacheRepo } from "@/lib/cache/cache-repo";

/**
 * What the read memo does with each repository method.
 *
 * A record over every method rather than two lists, so a method added to the
 * port does not compile until someone decides. A write left off the list
 * keeps the memo, and the next read paints the row as it was before.
 */
const PAPER_METHODS: Record<keyof IPaperRepository, "read" | "write" | "uncached"> = {
  getById: "read",
  list: "read",
  listSummaries: "uncached",
  findByArxivId: "uncached",
  findByDoi: "uncached",
  findByTitleKey: "uncached",
  findIdentityByArxivId: "uncached",
  findIdentityByDoi: "uncached",
  save: "write",
  delete: "write",
  setTags: "write",
  replaceSummary: "write",
};

function methods(kind: "read" | "write"): string[] {
  return Object.entries(PAPER_METHODS)
    .filter(([, value]) => value === kind)
    .map(([name]) => name);
}

/** The paper repository behind the project-scoped read memo. */
export function cachePaperRepository<R extends IPaperRepository>(inner: R, pid: () => string | null): R {
  return cacheRepo(inner, methods("read"), methods("write"), pid, { resourceType: "paper" });
}
