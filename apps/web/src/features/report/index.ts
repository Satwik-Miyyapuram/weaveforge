/**
 * Public API of the report feature module (web half). Other modules and the app
 * shell import from here only — never from internal paths.
 */
export { ReportScreen } from "./ui/report-screen";
export { ReportOverleafScreen } from "./ui/report-overleaf-screen";
export { OverleafProjectTab, overleafSidebarRows } from "./ui/overleaf-sidebar";
export { SIGN_IN_ROW as OVERLEAF_SIGN_IN_ROW, type OverleafTreeRow } from "./lib/overleaf-tree-rows";
/** Same pair for report sections — see the papers index. */
export { ReportSectionMarkdown } from "./ui/report-section-markdown";
export { reportImageMarkdown } from "./lib/report-images-md";
