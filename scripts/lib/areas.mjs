/**
 * One row of the code map: where it is, what it is for, and how it is measured.
 *
 * `unit` is either lines of code or a file tally, because for two of these the
 * honest unit is files — a migration is a step in a sequence whether it is four
 * lines or four hundred, and so is a page of documentation.
 */
export const AREAS = [
  { dir: "packages/core", unit: "lines", what: "Domain and application logic shared by every surface" },
  { dir: "apps/web", unit: "lines", what: "The app itself: screens, features, API routes, backend wiring" },
  { dir: "apps/desktop", unit: "lines", what: "The Electron shell — what only an installed app can do" },
  { dir: "apps/pitch", unit: "lines", what: "The public site and this documentation" },
  { dir: "python/weaveforge", unit: "lines", what: "The SDK training scripts import" },
  { dir: "python/tests", unit: "lines", what: "Its tests" },
  { dir: "supabase/migrations", unit: "files", what: "The schema, as an ordered sequence" },
  { dir: "docs", unit: "files", what: "Documentation, this page included" },
];
