/**
 * L9: the owner-file bridge's decision rules, as pure functions. The digest log
 * is keyed by workspace-relative path (never by entity id), one list per path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LeaseHolder,
  TAKEOVER_AFTER_MS,
  WRITE_STOP_AFTER_FAILED_MS,
  conflictCopyPath,
  decidePulledText,
  digestsFor,
  flushBeforeClose,
  afterWriteBack,
} from "../infrastructure/owner-file-bridge";

// A stand-in digest: the bridge takes the digest function as a parameter.
const digest = (text: string) => `d:${text}`;

const save = (log: string[], text: string) => {
  log.push(digest(text));
};

test("old_save_pulled_late_not_reapplied", () => {
  const log: string[] = [];
  for (let i = 1; i <= 50; i++) save(log, `save ${i}`);
  const base = "save 50";
  const decision = decidePulledText({
    reads: ["save 3", "save 3"],
    listedByPull: true,
    digestLog: log,
    base,
    digest,
  });
  assert.deepEqual(decision, { action: "skip", reason: "digest-listed" });
});

test("ingested_edit_not_reapplied_on_second_device", () => {
  // Device A ingests an external edit and records it in the shared log.
  const log: string[] = [];
  const base = "original";
  const first = decidePulledText({
    reads: ["edited outside", "edited outside"],
    listedByPull: true,
    digestLog: log,
    base,
    digest,
  });
  assert.equal(first.action, "apply");
  if (first.action !== "apply") return;
  log.push(first.digest);

  // Device B pulls the same file: the digest is already in the log.
  const second = decidePulledText({
    reads: ["edited outside", "edited outside"],
    listedByPull: true,
    digestLog: log,
    base,
    digest,
  });
  assert.deepEqual(second, { action: "skip", reason: "digest-listed" });
});

test("changed_writeback_goes_through_read_side", () => {
  const seen: string[] = [];
  const outcome = afterWriteBack({ status: "changed", diskText: "disk text" }, (text) => {
    seen.push(text);
    return { action: "skip", reason: "unchanged" };
  });
  // The disk text went to the read side; nothing was overwritten.
  assert.deepEqual(seen, ["disk text"]);
  assert.deepEqual(outcome, { action: "skip", reason: "unchanged" });

  const written: string[] = [];
  const clean = afterWriteBack({ status: "written" }, (text) => {
    written.push(text);
    return { action: "skip", reason: "unchanged" };
  });
  assert.deepEqual(written, []);
  assert.deepEqual(clean, { action: "skip", reason: "unchanged" });
});

test("pull_batch_listed_digest_skipped", () => {
  const log = [digest("saved text")];
  const listed = decidePulledText({
    reads: ["saved text", "saved text"],
    listedByPull: true,
    digestLog: log,
    base: "older",
    digest,
  });
  assert.deepEqual(listed, { action: "skip", reason: "digest-listed" });

  // Same file, no digest-log entry: applied as an external edit.
  const unlogged = decidePulledText({
    reads: ["never saved", "never saved"],
    listedByPull: true,
    digestLog: log,
    base: "older",
    digest,
  });
  assert.equal(unlogged.action, "apply");
});

test("revert_to_older_digest_applied", () => {
  // The user reverts on disk to save #3's text. It is not a pull, so it is not
  // listed in pull-batch, and it differs from the base: the read side applies it.
  const log = [digest("save 3"), digest("save 4"), digest("save 5")];
  const decision = decidePulledText({
    reads: ["save 3", "save 3"],
    listedByPull: false,
    digestLog: log,
    base: "save 5",
    digest,
  });
  assert.equal(decision.action, "apply");
});

test("lease_holder_stops_after_60s_failed_renewal", () => {
  const holder = new LeaseHolder(0);
  // Renewals fail from t = 0 on.
  holder.renewal(0, false);
  assert.equal(holder.canWrite(WRITE_STOP_AFTER_FAILED_MS - 1), true);
  assert.equal(holder.canWrite(WRITE_STOP_AFTER_FAILED_MS), false);
  // The second desktop may take the lease only once the last good renewal is 90 s old.
  assert.equal(TAKEOVER_AFTER_MS, 90_000);
  assert.equal(LeaseHolder.canTakeOver(0, 89_999), false);
  assert.equal(LeaseHolder.canTakeOver(0, TAKEOVER_AFTER_MS), true);
});

test("unshare_while_unsaved_writes_final_text", async () => {
  const order: string[] = [];
  await flushBeforeClose("final edits", async (text) => {
    order.push(`write:${text}`);
  });
  order.push("close");
  assert.deepEqual(order, ["write:final edits", "close"]);

  const none: string[] = [];
  await flushBeforeClose(null, async (text) => {
    none.push(text);
  });
  assert.deepEqual(none, []);
});

test("absent_or_half_written_file_not_diffed", () => {
  const base = "line one\nline two\n";
  // Missing file.
  assert.deepEqual(
    decidePulledText({ reads: [null, null], listedByPull: false, digestLog: [], base, digest }),
    { action: "skip", reason: "not-diffed" },
  );
  // Empty file while the base has text.
  assert.deepEqual(
    decidePulledText({ reads: ["", ""], listedByPull: false, digestLog: [], base, digest }),
    { action: "skip", reason: "not-diffed" },
  );
  // Two reads disagree: the file is still being written.
  assert.deepEqual(
    decidePulledText({
      reads: ["line one\nlin", "line one\nline two\nthree\n"],
      listedByPull: false,
      digestLog: [],
      base,
      digest,
    }),
    { action: "skip", reason: "not-diffed" },
  );
});

test("half_document_delete_becomes_conflict_copy", () => {
  const base = "aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd";
  const decision = decidePulledText({
    reads: ["aaaaaaaaaa", "aaaaaaaaaa"],
    listedByPull: false,
    digestLog: [],
    base,
    digest,
  });
  assert.deepEqual(decision, { action: "conflict-copy", reason: "half-delete", digest: digest("aaaaaaaaaa") });
});

test("no_base_handover_conflict_copy", () => {
  const decision = decidePulledText({
    reads: ["someone's text", "someone's text"],
    listedByPull: false,
    digestLog: [],
    base: null,
    digest,
  });
  assert.deepEqual(decision, { action: "conflict-copy", reason: "no-base", digest: digest("someone's text") });
});

test("digest_log_unreadable_conflict_copy", () => {
  const decision = decidePulledText({
    reads: ["differs", "differs"],
    listedByPull: true,
    digestLog: null,
    base: "original text",
    digest,
  });
  assert.deepEqual(decision, { action: "conflict-copy", reason: "digest-log-unreadable", digest: digest("differs") });
});

test("digest log is keyed by workspace-relative path", () => {
  const log = new Map<string, string[]>([["notes/a.md", [digest("shared")]]]);
  assert.deepEqual(digestsFor(log, "notes/a.md"), [digest("shared")]);
  assert.deepEqual(digestsFor(log, "notes/b.md"), []);
});

test("conflict copy is named from the path, not an id", () => {
  assert.equal(
    conflictCopyPath("notes/day one.md", "2026-11-19T10-00-00"),
    "notes/day one (conflict 2026-11-19T10-00-00).md",
  );
});

test("conflict copy keeps compound extensions whole", () => {
  const stamp = "2026-11-19T10-00-00";
  assert.equal(
    conflictCopyPath("notes/day one.ink.md", stamp),
    `notes/day one (conflict ${stamp}).ink.md`,
  );
  assert.equal(
    conflictCopyPath("notes/x.annotations.json", stamp),
    `notes/x (conflict ${stamp}).annotations.json`,
  );
});

test("conflict copy ignores a dot in a folder name", () => {
  assert.equal(
    conflictCopyPath("my.notes/day one", "2026-11-19T10-00-00"),
    "my.notes/day one (conflict 2026-11-19T10-00-00)",
  );
});

test("conflict copy refuses a stamp Windows cannot use in a file name", () => {
  for (const stamp of ["2026:11:19", "a<b", "a>b", 'a"b', "a|b", "a?b", "a*b", "a/b", "a\\b", "a\u0001b", "", "stamp.", "stamp "]) {
    assert.throws(() => conflictCopyPath("notes/a.md", stamp), /stamp/, `stamp ${JSON.stringify(stamp)}`);
  }
});
