"use client";

import { useCallback, useState } from "react";
import type { Paper, ReportSectionTreeNode } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { ScreenLoading } from "@/components/screen-loading";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { emptyArray } from "@/lib/empty";
import type { ReportScreenData } from "@/features/report/application/load-report-screen.use-case";
import { LinkedOverleafReports } from "./linked-overleaf-reports";
import { ExportOverleafPackagePanel } from "./export-overleaf-package-panel";
import { ScreenHead } from "@/components/screen-head";
import { FormError } from "@/components/form-error";

/**
 * Overleaf tab — linked Overleaf projects + browser ZIP export.
 * Outline sections live on `/report` (Sections).
 */
export function ReportOverleafScreen() {
  /*
   * Full papers, not the summary projection.
   *
   * The export builds a biblatex file from each paper's `bibtex` (verbatim when
   * present) and, when it is not, from its `venue` to pick between `@article`,
   * `@inproceedings` and `@misc`. Neither field is on `PaperSummary`, so the
   * summary read `loadScreenData` returns would silently drop every venue — an
   * `@article` with no journal, which is the exact Overleaf warning the entry
   * shape exists to avoid. `listPapers` is the full read this needs; it is
   * already cached by the repository, and this tab exists to export the library.
   */
  const loadScreen = useCallback(async (): Promise<ReportScreenData & { papers: Paper[] }> => {
    const [data, papers] = await Promise.all([
      getContainer().report.loadScreenData(),
      getContainer().papers.listPapers().catch(() => [] as Paper[]),
    ]);
    return { ...data, papers };
  }, []);

  const { data, loading, error } = useScreenData("report-overleaf", loadScreen);
  const [exportOpen, setExportOpen] = useState(false);

  const tree = (data?.tree ?? emptyArray()) as readonly ReportSectionTreeNode[];
  const papers = data?.papers ?? emptyArray<Paper>();

  if (loading && !data) {
    return <ScreenLoading status="Loading Overleaf…" />;
  }

  return (
    <section className="screen report-overleaf-screen">
      <ScreenHead title="Overleaf">
        <button
          className="btn-primary"
          type="button"
          onClick={() => setExportOpen(true)}
        >
          Export LaTeX
        </button>
      </ScreenHead>

      {error && <FormError>{error}</FormError>}

      <ExportOverleafPackagePanel
        tree={tree}
        papers={papers}
        hideTrigger
        open={exportOpen}
        onOpenChange={setExportOpen}
      />

      <LinkedOverleafReports />
    </section>
  );
}
