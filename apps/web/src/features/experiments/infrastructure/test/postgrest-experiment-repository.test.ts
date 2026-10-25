import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PostgrestExperimentRepository } from "../postgrest-experiment-repository";
import { createLocalClient, type LocalQuery } from "@/backend/providers/local/pglite-client";
import type { ProjectContext } from "@/lib/project-context";

/**
 * What an experiment edit sends (02-12).
 *
 * An edit used to upsert the whole row it had read a moment earlier, so two
 * edits in flight together each wrote back the other's field as it was. A
 * patch names only its own columns; the client is the real local one over a
 * recording `run`, so the statement checked is the one the app would send.
 */

function recorder() {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const run: LocalQuery = async (statement, bound) => {
    sql.push(statement);
    params.push(bound ?? []);
    return [] as never;
  };
  return { run, sql, params };
}

function repo(rec: ReturnType<typeof recorder>) {
  const ctx: ProjectContext = { projectId: "p1" };
  return new PostgrestExperimentRepository(
    createLocalClient(rec.run) as unknown as SupabaseClient,
    ctx,
  );
}

/** The column names a statement assigns, in order. */
function assigned(statement: string): string[] {
  const set = /\bset\b([\s\S]*?)\bwhere\b/i.exec(statement)?.[1] ?? "";
  return [...set.matchAll(/"([a-z_]+)"\s*=/g)].map((m) => m[1]!);
}

test("experiments: a patch updates only the columns it names, by id", async () => {
  const rec = recorder();
  await repo(rec).patch("exp-1", { status: "done", finishedAt: "2026-07-23T10:00:00.000Z" });

  assert.equal(rec.sql.length, 1);
  assert.match(rec.sql[0]!, /^update\b/i);
  assert.deepEqual(assigned(rec.sql[0]!).sort(), ["finished_at", "status"]);
  assert.match(rec.sql[0]!, /"id" = \$\d/);
  assert.ok(rec.params[0]!.includes("exp-1"));
  assert.doesNotMatch(rec.sql[0]!, /\b(name|metrics|result_note|created_at)\b/);
});

test("experiments: a field patched to undefined is written as null", async () => {
  const rec = recorder();
  await repo(rec).patch("exp-1", { resultNote: undefined });

  assert.deepEqual(assigned(rec.sql[0]!), ["result_note"]);
  assert.ok(rec.params[0]!.includes(null), "the clear reaches the column");
});

test("experiments: every camel-case field maps to its column", async () => {
  const rec = recorder();
  await repo(rec).patch("exp-1", {
    repoUrl: "u",
    commitSha: "c",
    runCommand: "r",
    startedAt: "s",
    relatedPaper: "p",
    artifacts: ["a"],
  });
  assert.deepEqual(assigned(rec.sql[0]!).sort(), [
    "artifacts",
    "commit_sha",
    "related_paper",
    "repo_url",
    "run_command",
    "started_at",
  ]);
});

test("experiments: an empty patch sends nothing", async () => {
  const rec = recorder();
  await repo(rec).patch("exp-1", {});
  assert.equal(rec.sql.length, 0);
});

/** A client whose every select returns these rows. */
function returning(found: Record<string, unknown>[]) {
  const run: LocalQuery = async () => found as never;
  return new PostgrestExperimentRepository(
    createLocalClient(run) as unknown as SupabaseClient,
    { projectId: "p1" },
  );
}

function expRow(id: string, name: string) {
  return {
    id, name, hypothesis: null, status: "planned", repo_url: null, commit_sha: null, branch: null,
    run_command: null, config: null, metrics: null, artifacts: null, result_note: null,
    started_at: null, finished_at: null, related_paper: null, created_at: "2026-01-01T00:00:00Z",
  };
}

test("experiments: nameContains keeps names containing it, ignoring case (35-19)", async () => {
  const found = [expRow("a", "VAE baseline"), expRow("b", "GAN sweep"), expRow("c", "beta-vae")];
  const names = (await returning(found).list({ nameContains: "vae" })).map((e) => e.name);
  assert.deepEqual(names, ["VAE baseline", "beta-vae"]);
});

test("experiments: no nameContains, or an empty one, keeps every row", async () => {
  const found = [expRow("a", "VAE baseline"), expRow("b", "GAN sweep")];
  assert.equal((await returning(found).list()).length, 2);
  assert.equal((await returning(found).list({ nameContains: "" })).length, 2);
});
