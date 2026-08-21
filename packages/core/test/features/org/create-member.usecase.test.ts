import { test } from "node:test";

import assert from "node:assert/strict";

import {

  canCreateRole,

  creatableRoles,

  accessibleMemberIds,

  filterTeamMembers,

  filterLabMembers,

  resolveSupervisorId,

  resolveDisplayRole,

  needsStandaloneRoleSync,

  MemberPermissionError,

  MemberValidationError,

  type Member,

} from "../../../src/features/org/domain/member.js";

import { CreateMemberUseCase } from "../../../src/features/org/application/create-member.use-case.js";

import { InMemoryMemberRepository } from "../../../src/testing/in-memory-member-repository.js";

import { InMemoryAccountProvisioner } from "../../../src/testing/in-memory-account-provisioner.js";



const prof: Member = { id: "prof", role: "professor" };

const phd: Member = { id: "phd", role: "phd", supervisorId: "prof" };

const msc: Member = { id: "msc", role: "masters", supervisorId: "phd" };

const otherProf: Member = { id: "prof2", role: "professor" };

const otherMsc: Member = { id: "msc2", role: "masters", supervisorId: "prof2" };



test("creatableRoles: each role can create only strictly-lower ranks", () => {

  assert.deepEqual(creatableRoles("professor"), ["phd", "masters"]);

  assert.deepEqual(creatableRoles("phd"), ["masters"]);

  assert.deepEqual(creatableRoles("masters"), []);

});



test("canCreateRole enforces the hierarchy", () => {

  assert.equal(canCreateRole("professor", "phd"), true);

  assert.equal(canCreateRole("professor", "professor"), false);

  assert.equal(canCreateRole("phd", "masters"), true);

  assert.equal(canCreateRole("phd", "phd"), false);

  assert.equal(canCreateRole("masters", "masters"), false);

});



test("accessibleMemberIds returns the viewer's whole subtree", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const profSees = accessibleMemberIds("prof", all);

  assert.deepEqual([...profSees].sort(), ["msc", "phd", "prof"]);

  const phdSees = accessibleMemberIds("phd", all);

  assert.deepEqual([...phdSees].sort(), ["msc", "phd"]);

  const mscSees = accessibleMemberIds("msc", all);

  assert.deepEqual([...mscSees], ["msc"]);

});



test("filterTeamMembers: standalone user sees only themselves", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const solo = filterTeamMembers("msc2", all, { inLab: false });

  assert.deepEqual(solo.map((m) => m.id), ["msc2"]);

});



test("resolveDisplayRole: not in lab shows standalone even when profile says masters", () => {

  assert.equal(resolveDisplayRole("masters", { inLab: false }), "standalone");

  assert.equal(resolveDisplayRole("masters", { inLab: true }), "masters");

  assert.equal(resolveDisplayRole("professor", { inLab: false, ownsOrg: true }), "professor");

});



test("needsStandaloneRoleSync detects stale masters without lab", () => {

  assert.equal(
    needsStandaloneRoleSync(
      { role: "masters", orgSetupComplete: true },
      [],
      false,
    ),
    true,
  );

  assert.equal(
    needsStandaloneRoleSync(
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

  const team = filterTeamMembers("prof", all, { inLab: true, orgMemberIds: orgOnly });

  assert.deepEqual([...team.map((m) => m.id)].sort(), ["msc", "phd", "prof"]);

});



test("filterTeamMembers: in-lab phd sees subtree only, not supervisor", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const orgOnly = new Set(["prof", "phd", "msc"]);

  const team = filterTeamMembers("phd", all, { inLab: true, orgMemberIds: orgOnly });

  assert.deepEqual([...team.map((m) => m.id)].sort(), ["msc", "phd"]);

});



test("filterLabMembers: in-lab includes supervisors and full org roster", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const orgOnly = new Set(["prof", "phd", "msc"]);

  const lab = filterLabMembers("phd", all, { inLab: true, orgMemberIds: orgOnly });

  assert.deepEqual([...lab.map((m) => m.id)].sort(), ["msc", "phd", "prof"]);

});



test("filterLabMembers: standalone user sees only themselves", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const solo = filterLabMembers("msc2", all, { inLab: false });

  assert.deepEqual(solo.map((m) => m.id), ["msc2"]);

});



test("filterLabMembers: excludes other-lab members when org scoped", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const orgOnly = new Set(["prof", "phd", "msc"]);

  const lab = filterLabMembers("phd", all, { inLab: true, orgMemberIds: orgOnly });

  assert.deepEqual([...lab.map((m) => m.id)].sort(), ["msc", "phd", "prof"]);

  assert.ok(!lab.some((m) => m.id === "prof2" || m.id === "msc2"));

});



test("filterLabMembers: fail closed when inLab but orgMemberIds empty", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const lab = filterLabMembers("phd", all, { inLab: true, orgMemberIds: new Set() });

  assert.deepEqual(lab.map((m) => m.id), ["phd"]);

});



test("filterTeamMembers: fail closed when inLab but orgMemberIds empty", () => {

  const all = [prof, phd, msc, otherProf, otherMsc];

  const team = filterTeamMembers("phd", all, { inLab: true, orgMemberIds: new Set() });

  assert.deepEqual(team.map((m) => m.id), ["phd"]);

});



test("resolveSupervisorId always assigns the creator as supervisor", () => {

  assert.equal(resolveSupervisorId(prof, { email: "a@b.c", password: "12345678", role: "phd", supervisorId: "someone" }), "prof");

  assert.equal(resolveSupervisorId(phd, { email: "a@b.c", password: "12345678", role: "masters" }), "phd");

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

