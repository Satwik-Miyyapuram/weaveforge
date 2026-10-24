import type { AppLogInput } from "@/lib/error-report/app-log";

type Entry = { id: string; title: string };

export interface LinkTargets {
  /** Title/id pairs for `[[wikilink]]` resolution to papers. */
  paperEntries: Entry[];
  /** Title/id pairs for report section wikilinks. */
  sectionEntries: Entry[];
  /** Which targets failed to load, for the screen to say so; null when all loaded. */
  error: string | null;
}

/**
 * The vault's link targets. Each load may fail on its own; a failure is logged
 * and named rather than shown as an empty list, which made every link to a
 * paper look broken with no reason given (xlog-10).
 */
export async function loadLinkTargets(
  sources: {
    papers: () => Promise<{ papers: Entry[] }>;
    sections: () => Promise<{ flat: Entry[] }>;
  },
  log: (entry: AppLogInput) => void,
): Promise<LinkTargets> {
  const failed: string[] = [];
  const attempt = async <T>(what: string, load: () => Promise<T>): Promise<T | null> => {
    try {
      return await load();
    } catch (err) {
      failed.push(what);
      log({ level: "warn", source: "vault", message: `Could not load ${what} for note links`, detail: String(err) });
      return null;
    }
  };
  const [papersData, reportData] = await Promise.all([
    attempt("papers", sources.papers),
    attempt("report sections", sources.sections),
  ]);
  const entries = (rows: Entry[] | undefined) => (rows ?? []).map((r) => ({ id: r.id, title: r.title }));
  return {
    paperEntries: entries(papersData?.papers),
    sectionEntries: entries(reportData?.flat),
    error: failed.length
      ? `Links to ${failed.sort().join(" and ")} could not be loaded, so they may show as missing.`
      : null,
  };
}
