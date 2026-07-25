import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tag } from "../features/tags/domain/tag.js";
import type { ITagRepository, IPaperTagRepository } from "../features/tags/domain/tag-repository.js";

function sampleTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: overrides.id ?? "t1",
    name: overrides.name ?? "vae",
    color: overrides.color,
  };
}

/**
 * Contract suite for ITagRepository. `makePair` must return repos that share
 * the same in-memory link store when testing listWithCounts.
 */
export function runTagRepositoryContract(
  label: string,
  makePair: () => { tags: ITagRepository; paperTags: IPaperTagRepository },
): void {
  test(`[${label}] findByName returns null when absent`, async () => {
    const { tags } = makePair();
    assert.equal(await tags.findByName("missing"), null);
  });

  test(`[${label}] save then getById round-trips`, async () => {
    const { tags } = makePair();
    const tag = sampleTag();
    await tags.save(tag);
    assert.deepEqual(await tags.getById(tag.id), tag);
  });

  test(`[${label}] list returns sorted tags`, async () => {
    const { tags } = makePair();
    await tags.save(sampleTag({ id: "b", name: "beta" }));
    await tags.save(sampleTag({ id: "a", name: "alpha" }));
    const names = (await tags.list()).map((t) => t.name);
    assert.deepEqual(names, ["alpha", "beta"]);
  });

  test(`[${label}] listWithCounts reflects distinct papers per tag`, async () => {
    const { tags, paperTags } = makePair();
    const t1 = sampleTag({ id: "t1", name: "vae" });
    const t2 = sampleTag({ id: "t2", name: "gan" });
    await tags.save(t1);
    await tags.save(t2);
    await paperTags.link({ paperId: "p1", tagId: t1.id, source: "manual" });
    await paperTags.link({ paperId: "p2", tagId: t1.id, source: "manual" });
    await paperTags.link({ paperId: "p1", tagId: t2.id, source: "manual" });
    const counts = await tags.listWithCounts();
    const byName = new Map(counts.map((c) => [c.name, c.paperCount]));
    assert.equal(byName.get("vae"), 2);
    assert.equal(byName.get("gan"), 1);
  });
}
