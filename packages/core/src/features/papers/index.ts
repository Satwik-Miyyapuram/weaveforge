/**
 * Public API of the papers module (core half).
 *
 * Other modules and the app import the papers feature ONLY through this file —
 * never by reaching into internal paths. This keeps coupling at the contract.
 */

export * from "./domain/paper.js";
export * from "./domain/paper-repository.js";
export * from "./domain/annotation-pin.js";
export * from "./domain/annotation-pin-repository.js";
export * from "./domain/annotation-quotation-type.js";
export * from "./domain/annotation-quotation-type-repository.js";
export * from "./domain/paper-field.js";
export * from "./domain/paper-field-repository.js";
export * from "./application/metadata-source.js";
export * from "./application/add-paper.use-case.js";
export * from "./application/update-paper.use-case.js";
export * from "./application/manage-paper-fields.use-case.js";
export * from "./application/compute-rollup.js";
