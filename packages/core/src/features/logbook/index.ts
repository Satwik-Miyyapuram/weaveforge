/**
 * Public API of the logbook module (core half).
 *
 * Other modules and the app import the logbook feature ONLY through this file —
 * never by reaching into internal paths. This keeps coupling at the contract.
 */

export * from "./domain/log-entry.js";
export * from "./domain/log-entry-repository.js";
export * from "./application/add-log-entry.use-case.js";
