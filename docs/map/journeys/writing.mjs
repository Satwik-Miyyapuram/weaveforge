export default {
  id: "writing", name: "Writing", blurb: "Your report, Overleaf and the bibliography.",
  intro: "Write the report in WeaveForge or Overleaf, and export it with your papers as a bibliography.",
  stages: [
    { name: "Hand in", journeys: ["bibliography"] },
  ],
  journeys: [
    {
      id: "bibliography", name: "Export LaTeX with a bibliography",
      blurb: "Build an Overleaf package with a .bib file and download it as a ZIP.",
      outcome: "A ZIP with your report, figures and bibliography is on your disk.",
      help: null,
      steps: [
        { title: "Open export", text: "On the Overleaf tab, click **Export LaTeX**.", ui: "Export LaTeX", hops: [1] },
        { title: "Choose what to cite", text: "Set **Bibliography contains** to all papers or only cited ones.", ui: { verb: "Set", label: "Bibliography contains" }, hops: [2] },
        { title: "Download", text: "Click **Download ZIP**.", ui: "Download ZIP", hops: [3, 4, 5] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "ReportOverleafScreen Export LaTeX", path: "apps/web/src/features/report/ui/report-overleaf-screen.tsx", sym: "onClick={() => setExportOpen(true)}" },
        { n: 2, by: 1, layer: "ui", fn: "ExportOverleafPackagePanel.run", path: "apps/web/src/features/report/ui/export-overleaf-package-panel.tsx", sym: "onClick={() => void run()}" },
        { n: 3, by: 2, layer: "service", fn: "downloadOverleafExportPackage", path: "apps/web/src/features/overleaf/application/parts.ts", sym: "export async function downloadOverleafExportPackage(" },
        { n: 4, by: 3, layer: "service", fn: "buildOverleafExportPackage", path: "apps/web/src/features/overleaf/application/parts.ts", sym: "export function buildOverleafExportPackage(" },
        { n: 5, by: 3, layer: "service", fn: "ReportFacade.fetchImageBlobs", path: "apps/web/src/container/facades/report.ts", sym: "fetchImageBlobs(paths: readonly string[])" },
      ],
      debug: [
        { see: "ZIP is missing bibliography entries", check: 4 },
        { see: "Missing figure warning", check: 5 },
      ],
    },
  ],
};
