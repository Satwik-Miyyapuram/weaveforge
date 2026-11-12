import assert from "node:assert/strict";
import { test } from "node:test";

import { REMOTE_COMMAND, buildSql, extractSection } from "../../publish-release-notice.mjs";

const CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "- pending",
  "",
  "## [0.9.0] - 2026-11-01",
  "",
  "### Desktop",
  "- new thing",
  "",
  "## [0.8.14] - 2026-10-16",
  "",
  "- last one",
  "",
].join("\n");

test("extractSection returns the middle section up to the next heading", () => {
  assert.equal(extractSection(CHANGELOG, "0.9.0"), "### Desktop\n- new thing");
});

test("extractSection returns the last section to end of file", () => {
  assert.equal(extractSection(CHANGELOG, "0.8.14"), "- last one");
});

test("extractSection accepts a heading with a date suffix", () => {
  assert.equal(extractSection("## [1.0.0] - 2026-01-01\n\nbody\n", "1.0.0"), "body");
});

test("extractSection throws when the version is missing or the section is empty", () => {
  assert.throws(() => extractSection(CHANGELOG, "9.9.9"), /no section for 9\.9\.9/);
  assert.throws(() => extractSection("## [1.0.0]\n\n## [0.9.0]\n", "1.0.0"), /is empty/);
});

test("buildSql produces the exact upsert with dollar quoting", () => {
  assert.equal(
    buildSql("1.2.3", "WeaveForge 1.2.3", "- a"),
    "insert into release_notices (version, title, body) values ($wfnote$1.2.3$wfnote$, $wfnote$WeaveForge 1.2.3$wfnote$, $wfnote$- a$wfnote$) on conflict (version) do update set title = excluded.title, body = excluded.body, published_at = now();\n",
  );
});

test("buildSql refuses a body that contains the dollar-quote tag", () => {
  assert.throws(() => buildSql("1.2.3", "t", "x $wfnote$ y"), /cannot dollar-quote/);
});

test("buildSql refuses a malformed version", () => {
  assert.throws(() => buildSql("v1.2.3", "t", "b"), /invalid version/);
  assert.throws(() => buildSql("1.2", "t", "b"), /invalid version/);
  assert.doesNotThrow(() => buildSql("1.2.3-rc.1", "t", "b"));
});

test("REMOTE_COMMAND keeps the container variables unexpanded", () => {
  assert.equal(
    REMOTE_COMMAND,
    'docker exec -i weaveforge-postgres sh -c "psql -1 -v ON_ERROR_STOP=1 -U \\${POSTGRES_USER} -d \\${POSTGRES_DB}"',
  );
});
