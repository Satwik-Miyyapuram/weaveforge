/**
 * Public API of the report feature module (web half). Other modules and the app
 * shell import from here only — never from internal paths.
 */
export { reportModule } from "./module";
export { ReportScreen } from "./ui/report-screen";
export { ReportOverleafScreen } from "./ui/report-overleaf-screen";
export { AddSectionForm } from "./ui/add-section-form";
export { SupabaseReportSectionRepository } from "./infrastructure/supabase-report-section-repository";
