// Writes one text file into the open Overleaf project through the IDE's
// forward, the way Overleaf's own upload dialog does.
import assert from "node:assert/strict";
import test from "node:test";
import type { ForwardRequest, ForwardResponse } from "@overleaf-ide";
import { rootFolderIdOf, uploadOverleafText } from "../infrastructure/overleaf-upload";

const json = (status: number, body: unknown): ForwardResponse => ({
  status,
  headers: { "content-type": "application/json" },
  body: new TextEncoder().encode(JSON.stringify(body)),
});

test("posts a multipart upload to the project's root folder", async () => {
  const sent: ForwardRequest[] = [];
  const result = await uploadOverleafText(
    async (req) => {
      sent.push(req);
      return json(200, { success: true, entity_id: "d1", entity_type: "doc" });
    },
    { projectId: "p1", folderId: "f1", name: "weaveforge.bib", text: "@article{a,\n}\n" },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(sent.length, 1);
  const req = sent[0]!;
  assert.equal(req.method, "POST");
  assert.equal(req.url, "/project/p1/upload?folder_id=f1");
  assert.match(req.headers["content-type"] ?? "", /^multipart\/form-data; boundary=/);
  const body = new TextDecoder().decode(req.body!);
  assert.match(body, /name="qqfile"; filename="weaveforge.bib"/);
  assert.match(body, /name="name"\r\n\r\nweaveforge.bib\r\n/);
  assert.ok(body.includes("@article{a,\n}\n"));
});

test("a refused upload says why", async () => {
  const result = await uploadOverleafText(async () => json(422, { success: false, error: "invalid_filename" }), {
    projectId: "p1",
    folderId: "f1",
    name: "weaveforge.bib",
    text: "",
  });
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.message : "", /invalid_filename/);
});

test("a dropped connection is an error, not a throw", async () => {
  const result = await uploadOverleafText(
    async () => {
      throw new Error("offline");
    },
    { projectId: "p1", folderId: "f1", name: "weaveforge.bib", text: "" },
  );
  assert.equal(result.ok, false);
});

test("the root folder comes from Overleaf's join answer", () => {
  assert.equal(rootFolderIdOf([{ project: { rootFolder: [{ _id: "r1" }] }, permissionsLevel: "owner" }]), "r1");
  assert.equal(rootFolderIdOf([null, { project: { rootFolder: [{ _id: "r2" }] } }]), "r2");
  assert.equal(rootFolderIdOf([{ project: {} }]), null);
  assert.equal(rootFolderIdOf([]), null);
});

test("a read-only join gives no folder to write to", () => {
  assert.equal(rootFolderIdOf([{ project: { rootFolder: [{ _id: "r1" }] }, permissionsLevel: "readOnly" }]), null);
});
