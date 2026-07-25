/**
 * Public API of the relations module (core half). Imported only through this
 * file — never by reaching into internal paths.
 */

export * from "./domain/paper-relation.js";
export * from "./domain/paper-relation-repository.js";
export * from "./domain/graph-view-settings.js";
export * from "./domain/graph-persisted-state.js";
export * from "./domain/graph-settings-repository.js";
export * from "./domain/citation-alert-track.js";
export * from "./domain/citation-alert-track-repository.js";
export * from "./application/citation-source.js";
export * from "./application/check-citation-alerts.use-case.js";
export * from "./application/manage-relations.use-case.js";
export { RemoveRelationUseCase } from "./application/remove-relation.use-case.js";