/**
 * A PhD student's dashboard read "Student snapshot: Test Professor B": the
 * visible team holds the reader's own supervisor too, and "everyone but me"
 * counted them as a student (design D22, DA-129, D-05). Students are the
 * people below the reader in the supervisor tree, and the UI never says
 * "supervisee".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Member } from "@weaveforge/core";
import { studentsOf } from "../application/students-of";

const prof: Member = { id: "prof", role: "professor", fullName: "Test Professor B" };
const phd: Member = { id: "phd", role: "phd", supervisorId: "prof", fullName: "PhD" };
const ms: Member = { id: "ms", role: "masters", supervisorId: "phd", fullName: "MSc" };
const otherMs: Member = { id: "ms2", role: "masters", supervisorId: "prof", fullName: "MSc 2" };
const team = [prof, phd, ms, otherMs];

test("a PhD student's students are below them, not their supervisor", () => {
  assert.deepEqual(studentsOf("phd", team).map((m) => m.id), ["ms"]);
});

test("a professor's students include everyone below, at any depth", () => {
  assert.deepEqual(studentsOf("prof", team).map((m) => m.id), ["phd", "ms", "ms2"]);
});

test("a reader with nobody below has no students", () => {
  assert.deepEqual(studentsOf("ms", team), []);
  assert.deepEqual(studentsOf(undefined, team), []);
});

test("the dashboard and Supervision use the tree, and say student", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
  for (const screen of ["dashboard/ui/dashboard-screen.tsx", "org/ui/supervision-screen.tsx"]) {
    assert.match(read(screen), /studentsOf\(profile\?\.id, team\)/, screen);
  }
  const cards = read("dashboard/ui/cards/card-renderers.tsx");
  assert.doesNotMatch(cards, /Select a supervisee|"Select supervisee"/);
  assert.match(cards, /Select a student\./);
  assert.match(cards, /aria-label="Select student"/);
});
