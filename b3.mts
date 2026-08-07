import { searchRevision } from "@weaveforge/core";
import { buildSearchIndex, miniSearchIndexFactory } from "./apps/web/src/features/search/infrastructure/minisearch-index";
let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const W = "attention transformer gradient latent corpus baseline ablation inference".split(" ");
const words = (n: number) => Array.from({ length: n }, () => W[Math.floor(rnd() * W.length)]).join(" ");
const ms = (f: () => unknown) => { const t = performance.now(); f(); return performance.now() - t; };

console.log("build (tokenize) vs loadJSON (rehydrate)");
for (const n of [1_000, 5_000, 15_000]) {
  const docs = Array.from({ length: n }, (_, i) => ({
    id: `d${i}`, kind: "note" as const, entityId: `${i}`, title: `Doc ${i}`, aliases: [], headings: [],
    tags: [], path: "", body: words(400), updatedAt: "2026-02-01T00:00:00.000Z", href: "/x", degree: 0,
  }));
  const rev = searchRevision(docs);
  let index!: ReturnType<typeof buildSearchIndex>;
  const build = ms(() => { index = buildSearchIndex(docs, rev, undefined); });
  const json = index.serialize();
  const load = ms(() => miniSearchIndexFactory.load(json, rev));
  console.log(`  ${n.toLocaleString()}\tbuild ${build.toFixed(0)} ms\tloadJSON ${load.toFixed(0)} ms\t${(build / load).toFixed(1)}x`);
}
