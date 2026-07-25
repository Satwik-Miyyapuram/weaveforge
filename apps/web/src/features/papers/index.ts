/**
 * Public API of the papers feature module (web half). Other modules and the app
 * shell import from here only — never from internal paths.
 */
export { papersModule } from "./module";
export { PapersScreen } from "./ui/papers-list";
export { AddPaperForm } from "./ui/add-paper-form";
export { SupabasePaperRepository } from "./infrastructure/supabase-paper-repository";
export { ArxivMetadataSource } from "./infrastructure/arxiv-metadata-source";
