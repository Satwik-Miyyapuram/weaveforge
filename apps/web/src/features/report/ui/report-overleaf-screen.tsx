"use client";

import { useCallback, useEffect, useState } from "react";
import type { Paper, ReportSectionTreeNode } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { ScreenLoading } from "@/components/screen-loading";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { emptyArray } from "@/lib/empty";
import type { ReportScreenData } from "@/features/report/application/load-report-screen.use-case";
import { LinkedOverleafReports } from "./linked-overleaf-reports";
import { ExportOverleafPackagePanel } from "./export-overleaf-package-panel";
import { WorkshopPanel, canShowWorkshop } from "./workshop-panel";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { ScreenHead } from "@/components/screen-head";
import { FormError } from "@/components/form-error";
import { overleafPapers } from "./overleaf-papers";
import { Button } from "@/components/button";

/**
 * Overleaf tab — linked Overleaf projects + browser ZIP export.
 * Outline sections live on `/report` (Sections).
 *
 * The Workshop panel (sign in, pick a project, see the compiled PDF) needs the
 * app's API routes, so neither a copy with no account nor the desktop shell
 * shows it (see `canShowWorkshop`).
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
  const loadScreen = useCallback(async (): Promise<
    ReportScreenData & { papers: Paper[]; papersError: string | null }
  > => {
    const [data, library] = await Promise.all([
      getContainer().report.loadScreenData(),
      overleafPapers(() => getContainer().papers.listPapers()),
    ]);
    return { ...data, ...library };
  }, []);

  const { data, loading, error } = useScreenData("report-overleaf", loadScreen);
  const [exportOpen, setExportOpen] = useState(false);
  // Decided after mount: the server render has no window, so no desktop bridge to see.
  const [workshop, setWorkshop] = useState(false);
  useEffect(() => {
    setWorkshop(canShowWorkshop({ localMode: getContainer().auth.isLocalMode(), inDesktopShell: desktop() !== null }));
  }, []);

  const tree = data?.tree ?? emptyArray<ReportSectionTreeNode>();
  const papers = data?.papers ?? emptyArray<Paper>();

  if (loading && !data) {
    return <ScreenLoading status="Loading Overleaf…" />;
  }

  return (
    <section className="screen report-overleaf-screen">
      <ScreenHead title="Overleaf">
        <Button
          variant="primary"
         
          onClick={() => setExportOpen(true)}
        >
          Export for Overleaf
        </Button>
      </ScreenHead>

      {error && <FormError>{error}</FormError>}
      {data?.papersError && <FormError>{data.papersError}</FormError>}

      <ExportOverleafPackagePanel
        tree={tree}
        papers={papers}
        hideTrigger
        open={exportOpen}
        onOpenChange={setExportOpen}
      />

      <LinkedOverleafReports />

      {workshop && <WorkshopPanel />}
    </section>
  );
}
