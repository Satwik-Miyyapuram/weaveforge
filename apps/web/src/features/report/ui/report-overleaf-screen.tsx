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

/**
 * Overleaf tab — linked Overleaf projects + browser ZIP export.
 * Outline sections live on `/report` (Sections).
 */
export function ReportOverleafScreen() {
  const loadScreen = useCallback(async (): Promise<ReportScreenData & { papers: Paper[] }> => {
    const [data, papersData] = await Promise.all([
      getContainer().report.loadScreenData(),
      getContainer().papers.loadScreenData().catch(() => null),
    ]);
    return { ...data, papers: papersData?.papers ?? [] };
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

      {error && <p className="error">{error}</p>}

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
