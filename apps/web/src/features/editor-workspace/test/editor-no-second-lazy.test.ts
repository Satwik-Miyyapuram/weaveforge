/**
 * The workspace screen is loaded on demand. If the editor inside it sat behind
 * a second `dynamic()`, a restored note tab showed "Loading editor…" and waited
 * for React's Suspense reveal (about 300 ms) after the screen had arrived: cold
 * /workspace in WeaveForge Dev went from ~750 ms to ~1000 ms busy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("the document host takes the editor without its lazy boundary", () => {
  const host = read("../ui/document-host.tsx");
  assert.match(host, /import \{ CollabBodyHost \} from "@\/features\/collab\/eager";/);
  assert.doesNotMatch(host, /import \{[^}]*\bCollabBodyHost\b[^}]*\} from "@\/features\/collab";/);
  assert.match(read("../../collab/eager.ts"), /export \{ CollabBodyHost \} from "\.\/ui\/collab-body-host";/);
});

test("every importer of the document host is itself lazy", () => {
  assert.match(read("../ui/workspace-host.tsx"), /dynamic\(\s*\(\) => import\("\.\/workspace-screen"\)/);
  assert.match(read("../../../components/document-body.tsx"), /dynamic\([\s\S]*?import\("@\/features\/editor-workspace\/ui\/document-host"\)/);
});
