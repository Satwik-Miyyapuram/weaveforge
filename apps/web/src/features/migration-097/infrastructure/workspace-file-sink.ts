import type { FileSink } from "../domain/ports";
import { workspaceFsAsSink, type SinkFs } from "./workspace-fs-sink";

/** The slice of BrowserWorkspaceFs (features/workspace/infrastructure/parts.ts) the sink uses. */
export type OpfsLike = SinkFs & { writeTextIf: NonNullable<SinkFs["writeTextIf"]> };

/**
 * The OPFS writer as the migration's FileSink. One adapter: this delegates to workspaceFsAsSink,
 * so both callers get the same path checks, parent folders and missing-file rules.
 */
export function workspaceFileSink(fs: OpfsLike): FileSink {
  return workspaceFsAsSink(fs);
}