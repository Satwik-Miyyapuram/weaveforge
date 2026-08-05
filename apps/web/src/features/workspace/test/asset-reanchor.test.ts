import assert from "node:assert/strict";
import test from "node:test";
import { fromRelativeBlobLinks, toRelativeBlobLinks } from "@thesis/core";
import {
  assetExtension,
  assetMimeType,
  ownedAssetFolderPaths,
  planAssetReanchor,
} from "@/features/workspace/application/asset-reanchor";

const OWN = "user-1/page-1/a1b2.png";
const OTHER = "user-2/page-9/secret.png";

function bodyWith(storagePath: string): string {
  return `Before\n\n![shot](vault:${storagePath})\n\nAfter`;
}

test("a body exported and read back resolves to the same storage path", () => {
  const original = bodyWith(OWN);
  const { body: onDisk } = toRelativeBlobLinks(original, "notes/Method.md");
  assert.ok(onDisk.includes("../assets/notes/"), "export writes a relative link");

  const owned = ownedAssetFolderPaths([original]);
  const plan = planAssetReanchor(onDisk, owned, new Set());
  assert.equal(plan.keep.length, 1);
  assert.equal(plan.upload.length, 0);
  assert.equal(plan.unresolved.length, 0);

  const restored = fromRelativeBlobLinks(onDisk, {
    resolve: (_scope, path) => (plan.keep.some((ref) => ref.storagePath === path) ? path : null),
  });
  assert.equal(restored, original, "the round trip is lossless");
});

test("a path the workspace does not own is never honoured as written", () => {
  const { body: onDisk } = toRelativeBlobLinks(bodyWith(OTHER), "notes/Method.md");
  const owned = ownedAssetFolderPaths([bodyWith(OWN)]);

  const plan = planAssetReanchor(onDisk, owned, new Set());
  assert.equal(plan.keep.length, 0, "claiming another user's path resolves nothing");
  assert.equal(plan.upload.length, 0);
  assert.equal(plan.unresolved.length, 1);
  assert.match(plan.unresolved[0]!.folderPath, /user-2/);
});

test("a file that came with the import is re-anchored under this user", () => {
  const { body: onDisk } = toRelativeBlobLinks(bodyWith(OTHER), "notes/Method.md");
  const available = new Set([`assets/notes/${OTHER}`]);

  const plan = planAssetReanchor(onDisk, new Set(), available);
  assert.equal(plan.upload.length, 1, "the bytes are present, so it is uploadable");
  assert.equal(plan.upload[0]!.storagePath, OTHER);
  assert.equal(plan.keep.length, 0, "the claimed path is still not honoured as written");
});

test("paper and report assets are never uploaded, only recognised", () => {
  const paperBody = "![fig](paperimg:user-1/paper-1/fig.png)";
  const { body: onDisk } = toRelativeBlobLinks(paperBody, "papers/x.md");

  const withBytes = planAssetReanchor(onDisk, new Set(), new Set(["assets/papers/user-1/paper-1/fig.png"]));
  assert.equal(withBytes.upload.length, 0, "no vault page to file a paper image under");
  assert.equal(withBytes.unresolved.length, 1);

  const owned = ownedAssetFolderPaths([paperBody]);
  const roundTrip = planAssetReanchor(onDisk, owned, new Set());
  assert.equal(roundTrip.keep.length, 1, "but the workspace's own paper image survives");
});

test("a reference repeated in one body is planned once", () => {
  const body = `${bodyWith(OWN)}\n${bodyWith(OWN)}`;
  const { body: onDisk } = toRelativeBlobLinks(body, "notes/Method.md");
  const plan = planAssetReanchor(onDisk, ownedAssetFolderPaths([body]), new Set());
  assert.equal(plan.keep.length, 1);
});

test("svg and unknown extensions are stored as bytes, not as a scripting context", () => {
  assert.equal(assetMimeType("svg"), "application/octet-stream");
  assert.equal(assetMimeType("html"), "application/octet-stream");
  assert.equal(assetMimeType("png"), "image/png");
  assert.equal(assetMimeType("jpeg"), "image/jpeg");
});

test("extensions come from the filename, not from a dot elsewhere in the path", () => {
  assert.equal(assetExtension("user-1/page-1/a.PNG"), "png");
  assert.equal(assetExtension("user.1/page-1/noext"), "png");
  assert.equal(assetExtension("a/b/.hidden"), "png");
});
