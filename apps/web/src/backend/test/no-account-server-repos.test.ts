/**
 * 0.9.8: a no-account copy has no session, so every org-server read of members or
 * comments came back 401 and filled the log. These stand-ins answer without a request.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ICommentRepository } from "@weaveforge/core";
import { NoAccountCommentRepository, NoAccountMemberRepository } from "../providers/files/no-account-server-repos";

test("no-account members: no profile, no team, no lab, and creating a member needs an account", async () => {
  const members = new NoAccountMemberRepository();
  assert.equal(await members.getMine(), null);
  assert.deepEqual(await members.listTeam(), []);
  assert.deepEqual(await members.listLab(), []);
  assert.deepEqual(await members.listDirectory(), []);
  await assert.rejects(members.assertCanCreate("phd"), /account/);
});

test("no-account comments: none to list, and writing one needs an account", async () => {
  const comments: ICommentRepository = new NoAccountCommentRepository();
  assert.deepEqual(await comments.list("vault_page", "x"), []);
  await assert.rejects(comments.add({ resourceType: "vault_page", resourceId: "x", body: "hi" }), /account/);
  await assert.rejects(comments.remove("c1"), /account/);
  await assert.rejects(comments.setResolved("c1", true), /account/);
});

test("the no-account backend wires both stand-ins over the server ones", () => {
  const wiring = readFileSync(fileURLToPath(new URL("../../container/no-account-file-backend.ts", import.meta.url)), "utf8");
  assert.match(wiring, /memberRepository: new NoAccountMemberRepository\(\)/);
  assert.match(wiring, /commentRepository: new NoAccountCommentRepository\(\)/);
});
