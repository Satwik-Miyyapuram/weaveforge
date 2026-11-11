"use client";

import { useCallback, useEffect, useState } from "react";
import type { Paper, ReportSectionTreeNode } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { ScreenLoading } from "@/components/screen-loading";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { emptyArray } from "@/lib/parts";
import type { ReportScreenData } from "@/features/report/application/parts";
import { ExportOverleafPackagePanel } from "./export-overleaf-package-panel";
import { OverleafWorkspace } from "./overleaf-workspace";
import { canShowWorkshop } from "./use-workshop-session";
import { useProject } from "@/features/projects";
import { ScreenHead } from "@/components/screen-head";
import { FormError } from "@/components/form-error";
import { overleafPapers } from "./overleaf-papers";
import { Button } from "@/components/button";
import { isTauriShell } from "@/features/experiments/infrastructure/parts";

/**
 * Overleaf tab — one list of Overleaf projects (Write, PDF, Outline) + ZIP export.
 * Outline sections of this app's report live on `/report` (Sections).
 *
 * Sign-in needs the app's API routes, so a browser copy with no account only
 * gets Git links; the Tauri shell serves them itself (see `canShowWorkshop`).
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
  const { current } = useProject();
  // Decided after mount, so the server render and first paint agree.
  const [workshop, setWorkshop] = useState<{ shell: boolean } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const shell = isTauriShell();
    if (canShowWorkshop({ localMode: getContainer().auth.isLocalMode(), shell })) setWorkshop({ shell });
  }, []);

  const tree = data?.tree ?? emptyArray<ReportSectionTreeNode>();
  const papers = data?.papers ?? emptyArray<Paper>();

  if (loading && !data) {
    return <ScreenLoading status="Loading Overleaf…" />;
  }

  return (
    <section className="screen report-overleaf-screen">
      <ScreenHead title="Overleaf">
        <Button onClick={() => setExportOpen(true)} title="Download this project's report as an Overleaf ZIP">
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

      {mounted && (
        <OverleafWorkspace
          workshop={workshop !== null}
          inShell={workshop?.shell ?? false}
          projectId={current?.id ?? null}
          onExport={() => setExportOpen(true)}
        />
      )}
    </section>
  );
}
