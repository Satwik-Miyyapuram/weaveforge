import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backlinksForAnnotation,
  findAnnotationBacklinks,
} from "../application/annotation-backlinks.js";

test("findAnnotationBacklinks links pins and vault mentions", () => {
  const hits = findAnnotationBacklinks({
    annotations: [
      { id: "local-1", zoteroKey: null, text: "unique quote here about methods" },
      { id: "z-1", zoteroKey: "ABCD", text: "other" },
    ],
    pins: [{ annotationKey: "local-1", reportSectionId: "sec-1", paperId: "p" }],
    sections: [{ id: "sec-1", title: "Methods" }],
    vaultPages: [
      { id: "n1", title: "Note", body: "See ABCD in the lit review." },
      { id: "n2", title: "Quote note", body: "unique quote here about methods was useful." },
    ],
  });
  assert.equal(hits.length, 2);
  const local = hits.find((h) => h.annotationId === "local-1")!;
  assert.deepEqual(local.targets.map((t) => t.kind).sort(), ["report_section", "vault_page"]);
  assert.equal(backlinksForAnnotation(hits, "z-1")[0]?.id, "n1");
});

test("findAnnotationBacklinks returns empty when nothing cites", () => {
  assert.deepEqual(
    findAnnotationBacklinks({
      annotations: [{ id: "a", zoteroKey: null, text: "short" }],
      pins: [],
      sections: [],
      vaultPages: [],
    }),
    [],
  );
});
