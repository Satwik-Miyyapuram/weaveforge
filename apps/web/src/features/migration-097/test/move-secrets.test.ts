import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecretMover, type SecretsPort } from "../application/move-secrets";

function memoryPort(initial: Record<string, string>) {
  const source = new Map(Object.entries(initial));
  const target = new Map<string, string>();
  const copies: string[] = [];
  const port: SecretsPort = {
    list: async () => [...source.keys()],
    exists: async (id) => target.has(id),
    copy: async (id) => {
      copies.push(id);
      target.set(id, source.get(id) ?? "");
    },
  };
  return { port, source, target, copies };
}

test("move-secrets: copies each secret once and never deletes the old one", async () => {
  const { port, source, target, copies } = memoryPort({ k1: "v1", k2: "v2" });
  const move = createSecretMover(port);
  await move();
  await move(); // a re-run finds them already copied
  assert.deepEqual(copies, ["k1", "k2"]);
  assert.deepEqual([...source.keys()], ["k1", "k2"], "old secrets still present");
  assert.equal(target.get("k2"), "v2");
});

test("move-secrets: a port without a delete operation cannot remove a secret", () => {
  const { port } = memoryPort({ k1: "v1" });
  assert.equal("delete" in port, false);
  assert.equal("remove" in port, false);
});
