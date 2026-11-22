import type { FileCodec, Row } from "../domain/ports";

/** The slice of the wf-wasm module this codec needs. Structural, so tests can fake it. */
export type EntityCore = {
  entityRowFromFile(kind: string, text: string): Row | null | undefined;
  entityFileFromRow(kind: string, existing: string | undefined, row: Row): string;
  entityPath(kind: string, row: Row, projectRoot?: string): string;
};

/** Contract kind (LANES.md) -> wf-core EntityKind. Only these have a codec today. */
const ENTITY_KIND: Record<string, string> = {
  logEntries: "log_entry",
  experiments: "experiment",
  reportSections: "report_section",
  readingLists: "reading_list",
};

/**
 * FileCodec backed by the wf-wasm entity codecs, so the exporter writes the
 * same bytes the app writes. Kinds without a codec report `supports() === false`.
 */
export function wasmFileCodec(core: EntityCore, projectRoot = ""): FileCodec {
  return {
    supports: (kind) => kind in ENTITY_KIND,
    toFile(kind, row) {
      const entity = ENTITY_KIND[kind];
      if (!entity) throw new Error(`no wf-wasm codec for ${kind}`);
      return {
        path: core.entityPath(entity, row, projectRoot),
        text: core.entityFileFromRow(entity, undefined, row),
      };
    },
    toRow(kind, _path, text) {
      const entity = ENTITY_KIND[kind];
      if (!entity) return null;
      return core.entityRowFromFile(entity, text) ?? null;
    },
  };
}
