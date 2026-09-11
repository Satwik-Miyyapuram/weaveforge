/**
 * Public API of the report feature module (web half). Other modules and the app
 * shell import from here only — never from internal paths.
 */
export { ReportScreen } from "./ui/report-screen";
export { ReportOverleafScreen } from "./ui/report-overleaf-screen";
/** Same pair for report sections — see the papers index. */
export { ReportSectionMarkdown } from "./ui/report-section-markdown";
export { reportImageMarkdown } from "./lib/report-images-md";
