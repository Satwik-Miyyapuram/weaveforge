import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AddPaperUseCase,
  UpdatePaperUseCase,
  PaperValidationError,
  countWords,
  imagesOf,
  type Paper,
  type IPaperRepository,
} from "../../../src/index.js";

class InMemoryPaperRepo implements IPaperRepository {
  readonly rows = new Map<string, Paper>();
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list() {
    return [...this.rows.values()];
  }
  async save(p: Paper) {
    this.rows.set(p.id, p);
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async findByArxivId() {
    return null;
  }
  async findByDoi() {
    return null;
  }
}

// The tag methods are exercised in manage-tags; here we only drive the paper
// mutations, so a throwing stub guards against accidental tag coupling.
const tagsStub = {} as unknown as ConstructorParameters<typeof UpdatePaperUseCase>[0]["tags"];

function makeSetup() {
  const repo = new InMemoryPaperRepo();
  const clock = { nowIso: () => "2026-07-23T12:00:00.000Z" };
  const add = new AddPaperUseCase({ repository: repo, clock: { nowIso: () => "2026-07-23T09:00:00.000Z" }, ids: { newId: () => "paper-1" } });
  const uc = new UpdatePaperUseCase({ repository: repo, tags: tagsStub, clock });
  return { repo, uc, add };
}

test("setStatus: validates and stamps updatedAt", async () => {
  const { uc, add } = makeSetup();
  const p = await add.addManual({ title: "P" });
  const updated = await uc.setStatus(p.id, "reading");
  assert.equal(updated.status, "reading");
  assert.equal(updated.updatedAt, "2026-07-23T12:00:00.000Z");
  await assert.rejects(uc.setStatus(p.id, "bogus" as never), /Unknown status/);
});

test("setRating: enforces the 1–5 range and allows clearing", async () => {
  const { uc, add } = makeSetup();
  const p = await add.addManual({ title: "P" });
  assert.equal((await uc.setRating(p.id, 4)).rating, 4);
  assert.equal((await uc.setRating(p.id, undefined)).rating, undefined);
  await assert.rejects(uc.setRating(p.id, 0), /between 1 and 5/);
  await assert.rejects(uc.setRating(p.id, 6), /between 1 and 5/);
});

test("setSummary: trims and drops an empty summary", async () => {
  const { uc, add } = makeSetup();
  const p = await add.addManual({ title: "P" });
  assert.equal((await uc.setSummary(p.id, "  key idea  ")).summary, "key idea");
  assert.equal((await uc.setSummary(p.id, "   ")).summary, undefined);
});

test("addImage / removeImage: maintain metadata.images and require a path", async () => {
  const { uc, add } = makeSetup();
  const p = await add.addManual({ title: "P" });
  const withImg = await uc.addImage(p.id, "  paper-1/fig1.png  ");
  assert.deepEqual(imagesOf(withImg), ["paper-1/fig1.png"]);
  const without = await uc.removeImage(p.id, "paper-1/fig1.png");
  assert.deepEqual(imagesOf(without), []);
  await assert.rejects(uc.addImage(p.id, "   "), /Image path is required/);
});

test("mutations throw for an unknown id; remove deletes", async () => {
  const { repo, uc, add } = makeSetup();
  await assert.rejects(uc.setStatus("nope", "read"), PaperValidationError);
  const p = await add.addManual({ title: "P" });
  await uc.remove(p.id);
  assert.equal(await repo.getById(p.id), null);
});

test("countWords: counts whitespace-separated words", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   "), 0);
  assert.equal(countWords("one two   three"), 3);
});
