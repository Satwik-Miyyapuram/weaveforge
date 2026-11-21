// Every published port in the OCI compose file must bind to loopback only.
// Docker's published ports bypass ufw, so "5432:5432" is open to the internet
// unless the VCN security list blocks it. Remote access goes through ssh -L.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const compose = readFileSync(path.join(root, "infra/oci/docker-compose.yml"), "utf8").replace(/\r\n/g, "\n");

test("OCI compose publishes no service port on all interfaces", () => {
  const lines = compose.split("\n");
  const specs = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*ports:\s*$/.test(lines[i])) continue;
    // A ports list runs while lines are list items or comments.
    for (let j = i + 1; j < lines.length && /^\s*(-\s|#)/.test(lines[j]); j++) {
      if (/^\s*#/.test(lines[j])) continue;
      specs.push({ line: j + 1, spec: lines[j].replace(/^\s*-\s*/, "").replace(/["']/g, "").trim() });
    }
  }
  assert.ok(specs.length > 0, "found no ports lists; the parser no longer matches the file");
  const bad = specs.filter(s => !s.spec.startsWith("127.0.0.1:")).map(s => `line ${s.line}: ${s.spec}`);
  assert.deepEqual(bad, []);
});
