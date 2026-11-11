/**
 * Public API of the papers module (core half).
 *
 * Other modules and the app import the papers feature ONLY through this file —
 * never by reaching into internal paths. This keeps coupling at the contract.
 */

export * from "./domain/paper.js";
export * from "./domain/parts.js";
export * from "./domain/parts.js";
export * from "./domain/parts.js";
export * from "./domain/parts.js";
export * from "./domain/parts.js";
export * from "./domain/parts.js";
export * from "./domain/paper-field.js";
export * from "./domain/parts.js";
export * from "./application/metadata-source.js";
export * from "./application/add-paper.use-case.js";
export * from "./application/update-paper.use-case.js";
export * from "./application/manage-paper-fields.use-case.js";
export * from "./application/push-paper-to-zotero.use-case.js";
export * from "./application/open-access.js";
