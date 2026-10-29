/**
 * The graph reads note tags through core's `extractHashtags` (26-14, 26-15,
 * xhelp-13): the tag list, a note's chips and a concept's related counts all
 * agree with the edges the graph draws.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHashtags } from "@weaveforge/core";
import { graphTagNames, noteTags, notesTagged, relatedConcepts } from "../application/graph-tags";

const note = (id: string, title: string, body: string) => ({ id, title, body });

test("a note's tags come from its title and body, through core", () => {
  const n = note("n1", "On #VAEs", "body #beta-VAE and #vaes again, `#code`");
  assert.deepEqual(noteTags(n), extractHashtags(`${n.title}\n${n.body}`));
  assert.deepEqual(noteTags(n), ["vaes", "beta-vae", "code"]);
});

test("graphTagNames: papers, notes and lists, sorted and unique", () => {
  const papers = [{ tags: ["ml", "vision"] }];
  const notes = [note("n1", "#Ünïcode", "#ml #ML #new")];
  const lists = [{ name: "Reading" }];
  assert.deepEqual(graphTagNames(papers, notes, lists, true), ["ml", "new", "reading", "vision", "ünïcode"]);
  assert.deepEqual(graphTagNames(papers, notes, lists, false), ["ml", "new", "vision", "ünïcode"]);
  assert.deepEqual(graphTagNames([], [], [], true), []);
});

test("relatedConcepts counts a tag once per note, title included", () => {
  const notes = [note("n1", "#extra", "#vae #other #other #OTHER"), note("n2", "", "#vae #other")];
  assert.deepEqual(relatedConcepts("vae", [], notes), [
    ["other", 2],
    ["extra", 1],
  ]);
});

test("relatedConcepts adds paper tags, skips the concept itself, keeps the top 12", () => {
  const papers = [{ tags: ["vae", "a"] }, { tags: ["a", "b"] }];
  assert.deepEqual(relatedConcepts("vae", papers, []), [
    ["a", 2],
    ["b", 1],
  ]);
  const many = [note("n", "", Array.from({ length: 20 }, (_, i) => `#t${i}`).join(" "))];
  assert.equal(relatedConcepts("x", [], many).length, 12);
  assert.deepEqual(relatedConcepts("x", [], []), []);
});

test("the tag filter matches whole tags, not prefixes (26-08)", () => {
  const notes = [note("a", "Ops", "about #mlops"), note("b", "ML", "about #ml today"), note("c", "None", "plain")];
  assert.deepEqual(notesTagged(notes, ["ml"]).map((n) => n.id), ["b"]);
  assert.deepEqual(notesTagged(notes, ["mlops", "ml"]).map((n) => n.id), ["a", "b"]);
  assert.deepEqual(notesTagged(notes, []).map((n) => n.id), ["a", "b", "c"]);
  assert.deepEqual(notesTagged(notes, ["m"]), []);
});
