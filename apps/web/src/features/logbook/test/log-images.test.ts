/**
 * Dropping or pasting an image into a log entry (design D19, S-16): the
 * workspace, paper note and report took images and the logbook did not, so a
 * screenshot of a result had nowhere to go. Log entries now store theirs in a
 * `log-images` bucket and reference them as `logimg:` the way a report section
 * uses `reportimg:`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { before } from "node:test";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";
import { LOG_IMAGE_PREFIX } from "../lib/log-image-ref";
import { LogbookFacade } from "@/container/facades/logbook";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");

before(async () => {
  await loadTestCore();
});

test("a log image is written and read back as a logimg: reference", () => {
  assert.equal(LOG_IMAGE_PREFIX, "logimg:");
  const md = readyCore().markdownImage(`${LOG_IMAGE_PREFIX}u1/e1/a.webp`, "plot");
  assert.equal(md, "![plot](logimg:u1/e1/a.webp)");
  assert.deepEqual(readyCore().imagePathsInBody(`Ran it.\n\n${md}\n\n${md}\n![x](reportimg:u/s/b.png)`, LOG_IMAGE_PREFIX), ["u1/e1/a.webp"]);
});

test("the blob routes accept the log-images bucket", () => {
  assert.ok(readyCore().blobStorageBuckets().includes("log-images"));
});

test("the logbook facade stores an image under the entry", async () => {
  const calls: unknown[] = [];
  const images = {
    upload: async (owner: string, blob: Blob, ext: string) => {
      calls.push([owner, blob.size, ext]);
      return `u1/${owner}/x.${ext}`;
    },
    fetchBlobs: async () => new Map<string, Blob>(),
  };
  const facade = new LogbookFacade({ images } as unknown as ConstructorParameters<typeof LogbookFacade>[0]);
  assert.equal(await facade.uploadImage("e1", new Blob(["ab"]), "webp"), "u1/e1/x.webp");
  assert.deepEqual(calls, [["e1", 2, "webp"]]);
});

test("the new-entry field and the edit editor both take images", () => {
  const field = read("components/markdown/markdown-field-editor.tsx");
  assert.match(field, /imagePaste\?: ImagePasteConfig/, "MarkdownField takes the paste config");
  assert.match(field, /markdownEditorExtensions\(\{[^}]*imagePaste/s, "and hands it to the editor stack");

  const add = read("features/logbook/ui/add-log-entry-form.tsx");
  assert.match(add, /imagePaste=\{/);
  assert.match(add, /logImageUpload\(/);

  const screen = read("features/logbook/ui/logbook-screen.tsx");
  assert.match(screen, /imagePaste: /, "the edit editor's stack carries the paste config");
  assert.match(screen, /logImageUpload\(entry\.id/, "an edited entry keeps its images under its own id");
});

test("a log card shows the images it references", () => {
  const screen = read("features/logbook/ui/logbook-screen.tsx");
  assert.match(screen, /<LogMarkdown className="log-body"/);
  assert.doesNotMatch(screen, /<Markdown className="log-body"/);
});
