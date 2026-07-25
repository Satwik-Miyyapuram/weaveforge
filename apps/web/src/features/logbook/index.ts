/**
 * Public API of the logbook feature module (web half). Other modules and the
 * app shell import from here only — never from internal paths.
 */
export { logbookModule } from "./module";
export { LogbookScreen } from "./ui/logbook-screen";
export { AddLogEntryForm } from "./ui/add-log-entry-form";
export { SupabaseLogEntryRepository } from "./infrastructure/supabase-log-entry-repository";
