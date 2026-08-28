/**
 * Public API of the report module (core half).
 *
 * Other modules and the app import the report feature ONLY through this file —
 * never by reaching into internal paths. This keeps coupling at the contract.
 */

export * from "./domain/report-section.js";
export * from "./domain/latex-section-tree.js";
export * from "./domain/markdown-to-latex.js";
export * from "./domain/report-section-repository.js";
export * from "./domain/cite-key.js";
export * from "./domain/bib-entries.js";
export * from "./domain/bibliography-report.js";
export * from "./domain/prisma-figure.js";
export * from "./application/manage-report-section.use-case.js";
