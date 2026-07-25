import { test } from "node:test";
import assert from "node:assert/strict";
import type { Member } from "../features/org/domain/member.js";
import type { IMemberRepository } from "../features/org/domain/member-repository.js";

export function runMemberRepositoryContract(
  label: string,
  makeRepo: (seed: readonly Member[], currentId: string | null) => IMemberRepository,
): void {
  const prof: Member = { id: "prof", role: "professor", fullName: "Prof" };
  const phd: Member = { id: "phd", role: "phd", supervisorId: "prof", fullName: "PhD" };
  const masters: Member = { id: "ms", role: "masters", supervisorId: "phd", fullName: "MSc" };

  test(`[${label}] getMine returns the signed-in member`, async () => {
    const repo = makeRepo([prof, phd], "phd");
    const mine = await repo.getMine();
    assert.ok(mine);
    assert.equal(mine.id, "phd");
  });

  test(`[${label}] listTeam includes supervisees transitively`, async () => {
    const repo = makeRepo([prof, phd, masters], "prof");
    const team = await repo.listTeam();
    const ids = new Set(team.map((m) => m.id));
    assert.ok(ids.has("prof"));
    assert.ok(ids.has("phd"));
    assert.ok(ids.has("ms"));
  });

  test(`[${label}] listDirectory includes the whole lab`, async () => {
    const repo = makeRepo([prof, phd, masters], "phd");
    const dir = await repo.listDirectory();
    assert.equal(dir.length, 3);
  });

  test(`[${label}] listLab includes supervisors for org chart`, async () => {
    const repo = makeRepo([prof, phd, masters], "phd");
    const lab = await repo.listLab();
    const ids = new Set(lab.map((m) => m.id));
    assert.ok(ids.has("prof"));
    assert.ok(ids.has("phd"));
    assert.ok(ids.has("ms"));
  });
}
