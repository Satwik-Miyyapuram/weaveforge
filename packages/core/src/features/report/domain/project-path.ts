/** Types for project-path. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface ProjectPathFns {
  /**
 * A path inside a report project, written the one way: `/` separators, no `.`
 * parts, `..` folded in. Returns null for a path that climbs out of the project.
 */
  normalizeProjectPath(path: string): string | null;
}
