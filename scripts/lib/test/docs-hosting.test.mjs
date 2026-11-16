// Guards the OCI config that serves docs.weaveforge.org (:8082) and the demo it
// frames (demo.weaveforge.org, :8081). Reads the files; starts nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const siteBlock = (caddy, port) => {
  const match = new RegExp(`^:${port} \\{\\n([\\s\\S]*?)^\\}`, "m").exec(caddy);
  assert.ok(match, `Caddyfile has no :${port} site block`);
  return match[1];
};

test("Caddy serves the docs site on :8082 from /srv/docs, with clean URLs", () => {
  const block = siteBlock(read("infra/oci/Caddyfile"), 8082);
  assert.match(block, /^\s*root \* \/srv\/docs$/m);
  assert.match(block, /^\s*try_files \{path\} \{path\}\.html \{path\}\/index\.html$/m);
  assert.match(block, /^\s*file_server$/m);
  assert.match(block, /^\s*encode zstd gzip$/m);
});

test("the demo on :8081 allows framing only from docs.weaveforge.org", () => {
  const block = siteBlock(read("infra/oci/Caddyfile"), 8081);
  assert.match(block, /Content-Security-Policy "frame-ancestors https:\/\/docs\.weaveforge\.org"/);
});

test("the demo's bridge and data are not cached as immutable", () => {
  const block = siteBlock(read("infra/oci/Caddyfile"), 8081);
  const immutable = /@immutable path ([^\n]+)/.exec(block)?.[1] ?? "";
  assert.match(immutable, /\/_next\/static\/\*/);
  assert.doesNotMatch(immutable, /\/_demo\//, "/_demo/ files are not content-hashed");
});

test("compose publishes :8082 on loopback and mounts the docs copy", () => {
  const compose = read("infra/oci/docker-compose.yml");
  assert.match(compose, /- "127\.0\.0\.1:8082:8082"/);
  assert.match(compose, /- \.\/docs-site:\/srv\/docs:ro/);
  assert.match(compose, /- \.\/demo-site:\/srv\/demo:ro/);
  const published = [...compose.matchAll(/- "([^"]+:\d+:\d+)"/g)].map((m) => m[1]);
  for (const port of published) assert.match(port, /^127\.0\.0\.1:/, `${port} is not loopback-only`);
});
