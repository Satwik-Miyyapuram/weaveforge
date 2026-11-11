/**
 * Sidecar command-line parsing (Rust `sidecar_args`), re-exported from feature-wrappers.ts.
 * Reading `process.argv` and resolving paths stay in apps/shell/sidecar/src/main.ts.
 */
export { parseSidecarArgs } from "../pkg/wf_wasm.js";

/** A successful parse. Paths are as given on the command line; absent options are `null`. */
export interface SidecarArgsPlan {
  kind: "ok";
  /** The `--data-dir` value. */
  dataDir: string;
  /** Every `--migrations` value, in order. */
  migrations: string[];
  /** The `--backups` value. */
  backupsDir: string;
  /** The `--migrate-from` value. */
  migrateFrom: string | null;
  /** The `--artifacts` value. */
  artifacts: string | null;
  /** The `--bridge` value. */
  bridge: string | null;
  /** The `--app-version` value. */
  appVersion: string | null;
  /** The `--home-variant` value. */
  homeVariant: string | null;
  /** True when `--no-local-api` was passed. */
  noLocalApi: boolean;
}

/** A failed parse. The message is printed after `weaveforge-sidecar: `. */
export interface SidecarArgsError {
  kind: "error";
  message: string;
}

export type SidecarArgsReply = SidecarArgsPlan | SidecarArgsError;
