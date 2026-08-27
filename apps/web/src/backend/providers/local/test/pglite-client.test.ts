import assert from "node:assert/strict";
import test from "node:test";
import { createLocalClient, type LocalQuery } from "../pglite-client";

/** Records what would have run, and answers with whatever the test supplies. */
function recorder(rows: unknown[] = []): { run: LocalQuery; seen: { sql: string; params: unknown[] }[] } {
  const seen: { sql: string; params: unknown[] }[] = [];
  const run: LocalQuery = async (sql, params) => {
    seen.push({ sql, params });
    return rows;
  };
  return { run, seen };
}

test("a filtered, ordered read compiles to one statement", async () => {
  const { run, seen } = recorder([{ id: "a" }]);
  const { data, error } = await createLocalClient(run)
    .from("papers")
    .select("id, title")
    .eq("project_id", "p1")
    .order("created_at", { ascending: false })
    .limit(10);

  assert.equal(error, null);
  assert.deepEqual(data, [{ id: "a" }]);
  assert.equal(
    seen[0]?.sql,
    'select "id", "title" from "papers" where "project_id" = $1 order by "created_at" desc limit 10',
  );
  assert.deepEqual(seen[0]?.params, ["p1"]);
});

test("an empty `in` asks for nothing rather than failing to parse", async () => {
  const { run, seen } = recorder();
  await createLocalClient(run).from("papers").select("*").in("id", []);
  assert.match(seen[0]?.sql ?? "", /where false$/);
});

test("upsert names its conflict and updates the rest", async () => {
  const { run, seen } = recorder([{ id: "1" }]);
  await createLocalClient(run)
    .from("tags")
    .upsert({ project_id: "p1", paper_id: "x", note: "hi" }, { onConflict: "project_id,paper_id" })
    .select("*");

  assert.equal(
    seen[0]?.sql,
    'insert into "tags" ("project_id", "paper_id", "note") values ($1, $2, $3) ' +
      'on conflict ("project_id", "paper_id") do update set "note" = excluded."note" returning *',
  );
});

test("an update books its own parameters before the filter does", async () => {
  const { run, seen } = recorder([]);
  await createLocalClient(run).from("papers").update({ title: "new" }).eq("id", "abc");
  assert.equal(seen[0]?.sql, 'update "papers" set "title" = $1 where "id" = $2');
  assert.deepEqual(seen[0]?.params, ["new", "abc"]);
});

test("`or` becomes one bracketed predicate", async () => {
  const { run, seen } = recorder();
  await createLocalClient(run).from("relations").select("*").or("from_paper.eq.p1,to_paper.eq.p1");
  assert.match(seen[0]?.sql ?? "", /where \("from_paper" = \$1 or "to_paper" = \$2\)$/);
});

test("`not(col, is, null)` keeps the null on the right side of `is not`", async () => {
  const { run, seen } = recorder();
  await createLocalClient(run).from("metrics").select("*").not("wall_time", "is", null);
  assert.match(seen[0]?.sql ?? "", /where "wall_time" is not null$/);
});

test("a head count answers with the number and no rows", async () => {
  const { run, seen } = recorder([{ count: 4 }]);
  const reply = await createLocalClient(run).from("pins").select("id", { count: "exact", head: true });
  assert.equal(reply.count, 4);
  assert.equal(reply.data, null);
  assert.match(seen[0]?.sql ?? "", /^select count\(\*\)::int as count from "pins"/);
});

test("single with no rows answers the way PostgREST does", async () => {
  const { run } = recorder([]);
  const missing = await createLocalClient(run).from("papers").select("*").eq("id", "nope").single();
  assert.equal(missing.error?.code, "PGRST116");

  const { run: empty } = recorder([]);
  const maybe = await createLocalClient(empty).from("papers").select("*").maybeSingle();
  assert.equal(maybe.error, null);
  assert.equal(maybe.data, null);
});

test("structured values travel as JSON, for the column to coerce", async () => {
  const { run, seen } = recorder([]);
  await createLocalClient(run).from("settings").insert({ user_id: "u", appearance: { theme: "dark" } });
  assert.deepEqual(seen[0]?.params, ["u", '{"theme":"dark"}']);
});

test("a name that is not a column is refused rather than interpolated", () => {
  const { run, seen } = recorder([]);
  assert.throws(
    () => createLocalClient(run).from("papers").select("*").eq("id; drop table papers", "x"),
    /Not a column name/,
  );
  assert.equal(seen.length, 0);
});

test("a function call goes through with named arguments", async () => {
  const { run, seen } = recorder([{ resolve_share_link: "ok" }]);
  const reply = await createLocalClient(run).rpc("resolve_share_link", { p_token: "t" });
  assert.equal(reply.data, "ok");
  assert.equal(seen[0]?.sql, 'select * from "resolve_share_link"("p_token" => $1)');
});
