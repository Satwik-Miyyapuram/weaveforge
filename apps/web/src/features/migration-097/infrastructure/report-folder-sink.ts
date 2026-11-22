import type { WorkspaceStat } from "@weaveforge/core";
import type { FileSink } from "../domain/ports.ts";
import { REPORT_DIR } from "../domain/report";

/** The two calls of a workspace folder that a report check needs. */
type ReportFolder = {
  list(dir: string): Promise<readonly WorkspaceStat[]>;
  readText(path: string): Promise<string>;
};

/**
 * Presents a workspace's migration report folder as the FileSink that readMigrationRuns reads. list() returns
 * the full path of each file directly under REPORT_DIR (no folders, no nested files); readText() reads by that
 * path. A missing folder lists nothing, the same as an empty one.
 */
export function reportFolderSink(folder: ReportFolder): Pick<FileSink, "list" | "readText"> {
  return {
    async list() {
      return (await folder.list(REPORT_DIR)).filter((stat) => stat.kind === "file").map((stat) => stat.path);
    },
    readText: (path) => folder.readText(path),
  };
}
