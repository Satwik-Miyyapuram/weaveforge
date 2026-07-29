import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

/**
 * Live checks for `reader_annotations` (migration 0110). Two things unit tests
 * cannot prove: that the deployed schema matches what the repositories write,
 * and that RLS actually isolates one researcher's annotations from another's.
 */

function env(...names: string[]): string | undefined {
  return names.map((name) => process.env[name]).find(Boolean);
}

test("reader_annotations enforces per-user RLS and accepts the repository's shape", async (t) => {
  const url = env("THESIS_TRACKER_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const key = env(
    "THESIS_TRACKER_SUPABASE_ANON_KEY",
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
  const emailA = env("THESIS_TRACKER_EMAIL", "TT_A_EMAIL", "TEST_ACCOUNT_EMAIL_PRIMARY");
  const emailB = env("THESIS_TRACKER_B_EMAIL", "TT_B_EMAIL", "TEST_ACCOUNT_EMAIL_SECONDARY");
  const passwordA = env(
    "THESIS_TRACKER_PASSWORD",
    "TT_A_PASSWORD",
    "E2E_TEST_PASSWORD",
    "TEST_ACCOUNT_PASSWORD",
  );
  const passwordB = env(
    "THESIS_TRACKER_B_PASSWORD",
    "TT_B_PASSWORD",
    "E2E_TEST_PASSWORD",
    "TEST_ACCOUNT_PASSWORD",
  );
  if (!url || !key || !emailA || !emailB || !passwordA || !passwordB) {
    t.diagnostic("Skipping — configure Supabase URL/key and two disposable test users");
    return;
  }

  const makeClient = () =>
    createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = makeClient();
  const other = makeClient();
  assert.ifError((await owner.auth.signInWithPassword({ email: emailA, password: passwordA })).error);
  assert.ifError((await other.auth.signInWithPassword({ email: emailB, password: passwordB })).error);

  // The table is project- and paper-scoped by foreign key, so borrow a real
  // paper the owner can already see rather than inventing unreferenced ids.
  const { data: paper, error: paperError } = await owner
    .from("papers")
    .select("id, project_id")
    .limit(1)
    .maybeSingle();
  assert.ifError(paperError);
  if (!paper) {
    t.diagnostic("Skipping — the primary test account has no papers to anchor an annotation to");
    await owner.auth.signOut();
    await other.auth.signOut();
    return;
  }

  const anchor = {
    zoteroPosition: { pageIndex: 3, rects: [[72, 700, 172, 712]] },
    locus: { quote: { type: "TextQuoteSelector", exact: "integration probe" } },
  };

  // Exactly the payload SupabaseReaderAnnotationRepository.create builds.
  const { data: created, error: createError } = await owner
    .from("reader_annotations")
    .insert({
      project_id: paper.project_id,
      paper_id: paper.id,
      origin: "local",
      type: "highlight",
      color: "#ffd400",
      text: "integration probe",
      comment: "",
      tags: [],
      anchor,
      page_index: 3,
      sort_index: "00003|000000|00080",
      sync_state: "local",
    })
    .select("*")
    .single();
  assert.ifError(createError);
  assert.ok(created?.id, "insert must succeed with the shape the repository writes");

  try {
    // user_id defaults to auth.uid() — the repository relies on the column
    // existing, but the default is what makes the RLS check pass on insert.
    assert.ok(created.user_id, "user_id must be populated by its default");
    assert.deepEqual(created.anchor, anchor, "jsonb anchor round-trips unchanged");
    assert.equal(created.sync_state, "local");
    assert.deepEqual(created.tags, []);

    // Every Zotero type must be storable; a CHECK that rejects one would only
    // surface when a user drew it.
    for (const type of ["underline", "note", "image", "ink", "text"]) {
      const { data: typed, error: typeError } = await owner
        .from("reader_annotations")
        .insert({
          project_id: paper.project_id,
          paper_id: paper.id,
          type,
          anchor: {},
          page_index: 0,
        })
        .select("id")
        .single();
      assert.ifError(typeError);
      await owner.from("reader_annotations").delete().eq("id", typed!.id);
    }

    // `strikeout` is not a Zotero type and the CHECK must refuse it.
    const { error: badTypeError } = await owner.from("reader_annotations").insert({
      project_id: paper.project_id,
      paper_id: paper.id,
      type: "strikeout",
      anchor: {},
      page_index: 0,
    });
    assert.ok(badTypeError, "the type CHECK must reject a non-Zotero type");

    // An unknown sync_state must be refused too — R5 reads this column.
    const { error: badSyncError } = await owner.from("reader_annotations").insert({
      project_id: paper.project_id,
      paper_id: paper.id,
      type: "highlight",
      anchor: {},
      page_index: 0,
      sync_state: "totally-made-up",
    });
    assert.ok(badSyncError, "the sync_state CHECK must reject an unknown state");

    // The updated_at trigger must fire, or R5 cannot tell what changed.
    const before = created.updated_at;
    await new Promise((r) => setTimeout(r, 1100));
    const { data: touched, error: touchError } = await owner
      .from("reader_annotations")
      .update({ comment: "edited" })
      .eq("id", created.id)
      .select("updated_at")
      .single();
    assert.ifError(touchError);
    assert.notEqual(touched!.updated_at, before, "reader_annotations_set_updated_at must fire");

    // RLS: the other user must not see, edit, or delete this row.
    const { data: foreignRead, error: foreignReadError } = await other
      .from("reader_annotations")
      .select("id")
      .eq("id", created.id);
    assert.ifError(foreignReadError);
    assert.deepEqual(foreignRead, [], "annotations must not leak across users");

    const { data: foreignUpdate, error: foreignUpdateError } = await other
      .from("reader_annotations")
      .update({ comment: "tampered" })
      .eq("id", created.id)
      .select("id");
    assert.ifError(foreignUpdateError);
    assert.deepEqual(foreignUpdate, [], "a foreign user must not edit someone's annotation");

    const { data: foreignDelete, error: foreignDeleteError } = await other
      .from("reader_annotations")
      .delete()
      .eq("id", created.id)
      .select("id");
    assert.ifError(foreignDeleteError);
    assert.deepEqual(foreignDelete, [], "a foreign user must not delete someone's annotation");

    // And the row is still there and unmodified after all that.
    const { data: survivor, error: survivorError } = await owner
      .from("reader_annotations")
      .select("id, comment")
      .eq("id", created.id)
      .single();
    assert.ifError(survivorError);
    assert.equal(survivor!.comment, "edited");
  } finally {
    await owner.from("reader_annotations").delete().eq("id", created.id);
    await owner.auth.signOut();
    await other.auth.signOut();
  }
});
