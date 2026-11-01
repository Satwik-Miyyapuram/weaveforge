import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { prepareDataDir } from "../src/local-db-prepare";

describe("prepareDataDir", () => {
  it("removes junk files and leaves every entry writable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wf-prep-"));
    try {
      const sub = path.join(root, "pg_tblspc");
      fs.mkdirSync(sub);
      fs.writeFileSync(path.join(root, "desktop.ini"), "");
      fs.writeFileSync(path.join(sub, "Thumbs.db"), "");
      fs.writeFileSync(path.join(root, "PG_VERSION"), "18");
      fs.chmodSync(path.join(root, "PG_VERSION"), 0o444);
      fs.chmodSync(sub, 0o555);

      prepareDataDir(root);

      assert.deepEqual(fs.readdirSync(root).sort(), ["PG_VERSION", "pg_tblspc"]);
      assert.deepEqual(fs.readdirSync(sub), []);
      for (const p of [root, sub, path.join(root, "PG_VERSION")]) {
        assert.ok(fs.statSync(p).mode & 0o200, `${p} writable`);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores a missing directory", () => {
    prepareDataDir(path.join(os.tmpdir(), "wf-prep-missing-" + Date.now()));
  });
});
