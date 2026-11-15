import assert from "node:assert/strict";
import test from "node:test";
import Uppy, { XHRUpload, getDroppedFiles } from "../uppy";

type Sent = { url: string; method: string; headers: Headers; form: FormData };

/** Swaps the global fetch for one that records each request and answers with `reply`. */
function withFetch(reply: (sent: Sent) => Response, run: (sent: Sent[]) => Promise<void>) {
  const sent: Sent[] = [];
  const own = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const s = { url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), form: init?.body as FormData };
    sent.push(s);
    return reply(s);
  }) as typeof fetch;
  return run(sent).finally(() => {
    globalThis.fetch = own;
  });
}

const ok = () => Response.json({ success: true, entity_id: "e1", entity_type: "file" });

function uploader(options: Record<string, unknown> = {}) {
  return new Uppy({ autoProceed: false, ...options }).use(XHRUpload, {
    endpoint: "/project/p1/upload?folder_id=root",
    headers: { "X-CSRF-TOKEN": undefined },
    fieldName: "qqfile",
  });
}

const png = () => new File([new Uint8Array([1, 2, 3])], "fig.png", { type: "image/png" });

test("constructing works and addFile keeps the file with its meta", () => {
  const uppy = uploader();
  const added: unknown[] = [];
  uppy.on("file-added", (f: unknown) => added.push(f));
  const id = uppy.addFile({ name: "fig.png", type: "image/png", data: png(), meta: { targetFolderId: "f2" } });
  const file = uppy.getFile(id);
  assert.equal(file.name, "fig.png");
  assert.equal(file.size, 3);
  assert.equal(file.meta.targetFolderId, "f2");
  assert.equal(file.meta.name, "fig.png");
  assert.equal(uppy.getFiles().length, 1);
  assert.equal(added.length, 1);
});

test("upload POSTs each file as multipart to its endpoint and reports success", () =>
  withFetch(ok, async (sent) => {
    const uppy = uploader();
    const events: string[] = [];
    let success: { body: { entity_type: string } } | undefined;
    uppy.on("upload", () => events.push("upload"));
    uppy.on("upload-success", (_f: unknown, res: typeof success) => {
      events.push("upload-success");
      success = res;
    });
    uppy.on("complete", () => events.push("complete"));
    const id = uppy.addFile({ name: "fig.png", type: "image/png", data: png(), meta: { relativePath: undefined } });
    uppy.setFileState(id, { xhrUpload: { endpoint: "/project/p1/upload?folder_id=f9" } });
    const result = await uppy.upload();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, "POST");
    assert.equal(sent[0].url, "/project/p1/upload?folder_id=f9");
    // No made-up CSRF header: the host signs the request in.
    assert.equal(sent[0].headers.has("x-csrf-token"), false);
    const part = sent[0].form.get("qqfile") as File;
    assert.equal(part.name, "fig.png");
    assert.equal(part.size, 3);
    assert.equal(sent[0].form.get("name"), "fig.png");
    assert.equal(sent[0].form.has("relativePath"), false);
    assert.equal(result.successful.length, 1);
    assert.equal(result.failed.length, 0);
    assert.equal(success?.body.entity_type, "file");
    assert.deepEqual(events, ["upload", "upload-success", "complete"]);
  }));

test("a failed answer fires upload-error with the status and body, and counts as failed", () =>
  withFetch(() => Response.json({ success: false, error: "invalid_filename" }, { status: 422 }), async () => {
    const uppy = uploader();
    let seen: { status: number; body: { error: string } } | undefined;
    uppy.on("upload-error", (_f: unknown, _e: unknown, res: typeof seen) => {
      seen = res;
    });
    uppy.addFile({ name: "fig.png", type: "image/png", data: png() });
    const result = await uppy.upload();
    assert.equal(seen?.status, 422);
    assert.equal(seen?.body.error, "invalid_filename");
    assert.equal(result.failed.length, 1);
    assert.equal(result.successful.length, 0);
  }));

test("a network failure is an upload-error, not a throw", () =>
  withFetch(() => {
    throw new TypeError("offline");
  }, async () => {
    const uppy = uploader();
    let errors = 0;
    uppy.on("upload-error", () => errors++);
    uppy.addFile({ name: "fig.png", type: "image/png", data: png() });
    const result = await uppy.upload();
    assert.equal(errors, 1);
    assert.equal(result.failed.length, 1);
  }));

test("onBeforeUpload returning false sends nothing and rejects", () =>
  withFetch(ok, async (sent) => {
    const uppy = uploader({ onBeforeUpload: () => false });
    uppy.addFile({ name: "fig.png", type: "image/png", data: png() });
    await assert.rejects(uppy.upload());
    assert.equal(sent.length, 0);
    // An overwrite turns the check off and the upload goes.
    uppy.setOptions({ onBeforeUpload: () => true });
    await uppy.upload();
    assert.equal(sent.length, 1);
  }));

test("files already sent are not sent again", () =>
  withFetch(ok, async (sent) => {
    const uppy = uploader();
    uppy.addFile({ name: "fig.png", type: "image/png", data: png() });
    await uppy.upload();
    await uppy.upload();
    assert.equal(sent.length, 1);
  }));

test("autoProceed uploads as soon as a file is added", () =>
  withFetch(ok, async (sent) => {
    const uppy = uploader({ autoProceed: true });
    const done = new Promise((resolve) => uppy.on("complete", resolve));
    uppy.addFile({ name: "fig.png", type: "image/png", data: png() });
    await done;
    assert.equal(sent.length, 1);
  }));

test("restrictions and onBeforeFileAdded refuse a file with restriction-failed", () => {
  const uppy = uploader({
    restrictions: { maxNumberOfFiles: 1, maxFileSize: 2, allowedFileTypes: ["image/*", ".pdf"] },
  });
  let failed = 0;
  uppy.on("restriction-failed", () => failed++);
  assert.throws(() => uppy.addFile({ name: "fig.png", type: "image/png", data: png() }), /exceeds/);
  const small = new File([new Uint8Array([1])], "a.txt", { type: "text/plain" });
  assert.throws(() => uppy.addFile({ name: "a.txt", type: "text/plain", data: small }), /type/);
  const fine = new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" });
  uppy.addFile({ name: "a.pdf", type: "application/pdf", data: fine });
  assert.throws(() => uppy.addFile({ name: "b.pdf", type: "application/pdf", data: fine }), /more than 1/);
  assert.equal(failed, 3);

  const picky = uploader({ onBeforeFileAdded: () => false });
  assert.throws(() => picky.addFile({ name: "a.pdf", type: "application/pdf", data: fine }));
  assert.equal(picky.getFiles().length, 0);
});

test("removeFile drops the file and says so", () => {
  const uppy = uploader();
  let removed = 0;
  uppy.on("file-removed", () => removed++);
  const id = uppy.addFile({ name: "fig.png", type: "image/png", data: png() });
  uppy.removeFile(id);
  assert.equal(uppy.getFiles().length, 0);
  assert.equal(removed, 1);
});

test("off stops a handler", () => {
  const uppy = uploader();
  let n = 0;
  const h = () => n++;
  uppy.on("file-added", h).off("file-added", h);
  uppy.addFile({ name: "fig.png", type: "image/png", data: png() });
  assert.equal(n, 0);
});

test("getDroppedFiles reads the dropped files", async () => {
  const files = await getDroppedFiles({ files: [png()] } as unknown as DataTransfer);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "fig.png");
});
