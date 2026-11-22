import type { FileSink } from "../domain/ports";

/**
 * The path of the single device report (report-<deviceId>.json) a run wrote. Throws when the sink holds no
 * device report or more than one, so a test that expects one writer fails loudly on two.
 */
export async function onlyReportPath(sink: Pick<FileSink, "list">): Promise<string> {
  const paths = (await sink.list()).filter((p) => /\/report-[^/]+\.json$/.test(p));
  if (paths.length !== 1) throw new Error(`expected one device report, found ${paths.length}: ${paths.join(", ")}`);
  return paths[0];
}
