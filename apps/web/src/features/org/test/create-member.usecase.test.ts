import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";

import assert from "node:assert/strict";

import { MemberPermissionError, MemberValidationError, type Member } from "@weaveforge/core";

import { CreateMemberUseCase } from "@weaveforge/core";

import { InMemoryMemberRepository } from "@weaveforge/core/testing";

import { InMemoryAccountProvisioner } from "@weaveforge/core/testing";
import { typedCore } from "@/lib/rust-core";



const prof: Member = { id: "prof", role: "professor" };

const phd: Member = { id: "phd", role: "phd", supervisorId: "prof" };

const msc: Member = { id: "msc", role: "masters", supervisorId: "phd" };

const otherProf: Member = { id: "prof2", role: "professor" };

const otherMsc: Member = { id: "msc2", role: "masters", supervisorId: "prof2" };



before(async () => { await loadTestCore(); });

test("creatableRoles: each role can create only strictly-lower ranks", () => {

  assert.deepEqual(typedCore().creatableRoles("professor"), ["phd", "masters"]);

  assert.deepEqual(typedCore().creatableRoles("phd"), ["masters"]);

  assert.deepEqual(typedCore().creatableRoles("masters"), []);

});



test("canCreateRole enforces the hierarchy", () => {

  assert.equal(typedCore().canCreateRole("professor", "phd"), true);

  assert.equal(typedCore().canCreateRole("professor", "professor"), false);

  assert.equal(typedCore().canCreateRole("phd", "masters"), true);

  assert.equal(typedCore().canCreateRole("phd", "phd"), false);

  assert.equal(typedCore().canCreateRole("masters", "masters"), false);

});






test("filterTeamMembers: standalone user sees only themselves", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const solo = typedCore().filterTeamMembers("msc2", all, { inLab: false });

  assert.deepEqual(solo.map((m) => m.id), ["msc2"]);

});



test("resolveDisplayRole: not in lab shows standalone even when profile says masters", () => {

  assert.equal(typedCore().resolveDisplayRole("masters", { inLab: false }), "standalone");

  assert.equal(typedCore().resolveDisplayRole("masters", { inLab: true }), "masters");

  assert.equal(typedCore().resolveDisplayRole("professor", { inLab: false, ownsOrg: true }), "professor");

});



test("needsStandaloneRoleSync detects stale masters without lab", () => {

  assert.equal(
    typedCore().needsStandaloneRoleSync(
      { role: "masters", orgSetupComplete: true },
      [],
      false,
    ),
    true,
  );

  assert.equal(
    typedCore().needsStandaloneRoleSync(
      { role: "standalone", orgSetupComplete: true },
      [],
      false,
    ),
    false,
  );

});


test("filterTeamMembers: in-lab scopes to org members", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const orgOnly = new Set(["prof", "phd", "msc"]);

  const team = typedCore().filterTeamMembers("prof", all, { inLab: true, orgMemberIds: orgOnly });

  assert.deepEqual([...team.map((m) => m.id)].sort(), ["msc", "phd", "prof"]);

});



test("filterTeamMembers: in-lab phd sees subtree only, not supervisor", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const orgOnly = new Set(["prof", "phd", "msc"]);

  const team = typedCore().filterTeamMembers("phd", all, { inLab: true, orgMemberIds: orgOnly });

  assert.deepEqual([...team.map((m) => m.id)].sort(), ["msc", "phd"]);

});



test("filterLabMembers: in-lab includes supervisors and full org roster", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const orgOnly = new Set(["prof", "phd", "msc"]);

  const lab = typedCore().filterLabMembers("phd", all, { inLab: true, orgMemberIds: orgOnly });

  assert.deepEqual([...lab.map((m) => m.id)].sort(), ["msc", "phd", "prof"]);

});



test("filterLabMembers: standalone user sees only themselves", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const solo = typedCore().filterLabMembers("msc2", all, { inLab: false });

  assert.deepEqual(solo.map((m) => m.id), ["msc2"]);

});



test("filterLabMembers: excludes other-lab members when org scoped", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const orgOnly = new Set(["prof", "phd", "msc"]);

  const lab = typedCore().filterLabMembers("phd", all, { inLab: true, orgMemberIds: orgOnly });

  assert.deepEqual([...lab.map((m) => m.id)].sort(), ["msc", "phd", "prof"]);

  assert.ok(!lab.some((m) => m.id === "prof2" || m.id === "msc2"));

});



test("filterLabMembers: fail closed when inLab but orgMemberIds empty", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const lab = typedCore().filterLabMembers("phd", all, { inLab: true, orgMemberIds: new Set() });

  assert.deepEqual(lab.map((m) => m.id), ["phd"]);

});



test("filterTeamMembers: fail closed when inLab but orgMemberIds empty", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const team = typedCore().filterTeamMembers("phd", all, { inLab: true, orgMemberIds: new Set() });

  assert.deepEqual(team.map((m) => m.id), ["phd"]);

});



test("resolveSupervisorId always assigns the creator as supervisor", () => {

  assert.equal(typedCore().resolveSupervisorId(prof.id), "prof");

  assert.equal(typedCore().resolveSupervisorId(phd.id), "phd");

});



function setup(current: Member | null, seed: Member[]) {

  const members = new InMemoryMemberRepository(current?.id ?? null, seed);

  const provisioner = new InMemoryAccountProvisioner(members, () => current?.id);

  const useCase = new CreateMemberUseCase({ members, provisioner });

  return { members, useCase };

}



test("professor can create a phd account", async () => {

  const { useCase, members } = setup(prof, [prof]);

  const created = await useCase.create({ email: "New@Uni.edu", password: "supersecret", role: "phd" });

  assert.equal(created.role, "phd");

  assert.equal(created.email, "new@uni.edu"); // normalized

  assert.equal(created.supervisorId, "prof");

  assert.equal((await members.listTeam()).length, 2);

});



test("phd cannot create a professor", async () => {

  const { useCase } = setup(phd, [prof, phd]);

  await assert.rejects(

    () => useCase.create({ email: "x@uni.edu", password: "supersecret", role: "professor" }),

    MemberPermissionError,

  );

});



test("a non-member cannot create accounts", async () => {

  const { useCase } = setup(null, [prof]);

  await assert.rejects(

    () => useCase.create({ email: "x@uni.edu", password: "supersecret", role: "masters" }),

    MemberPermissionError,

  );

});



test("create validates password length", async () => {

  const { useCase } = setup(prof, [prof]);

  await assert.rejects(

    () => useCase.create({ email: "x@uni.edu", password: "short", role: "phd" }),

    MemberValidationError,

  );

});

