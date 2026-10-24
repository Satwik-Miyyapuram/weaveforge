import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { INK_UNDERLAY, inkSheetRuleStyle, loadMathOrLog } from "../ui/ink-sheet-underlay";

describe("INK_UNDERLAY", () => {
  it("is page geometry: every length scales with the page, nothing is clamped", () => {
    // The font used to be `max(12, 15·scale)` px, so at fit-width the text was
    // 3 mm on the paper — a third the height of handwriting — and zoom did not
    // grow it. Now it is 0.1 mm units like the ink, so the two agree at any fit.
    for (const [a, b] of ([
      [0.2, 0.4],
      [0.4, 1],
      [1, 2.5],
    ] as const)) {
      for (const key of ["padY", "padX", "fontSize"] as const) {
        assert.ok(
          Math.abs(INK_UNDERLAY[key](b) / INK_UNDERLAY[key](a) - b / a) < 1e-9,
          `${key} must scale linearly from ${a} to ${b}`,
        );
      }
    }
  });

  it("sets 4.8 mm type on a 7.2 mm pitch, which is college-ruled paper", () => {
    assert.equal(INK_UNDERLAY.fontSize(1), 48);
    const pitch = INK_UNDERLAY.fontSize(1) * INK_UNDERLAY.lineHeight;
    assert.equal(pitch, 72);
    assert.equal(inkSheetRuleStyle(1)["--ink-rule"], `${pitch}px`);
    assert.equal(inkSheetRuleStyle(1)["--ink-rule-offset"], "120px");
  });
});

describe("loadMathOrLog (20-02)", () => {
  type Log = { level: string; source: string; message: string; detail?: string };
  async function withLog(run: () => Promise<void>): Promise<Log[]> {
    const logs: Log[] = [];
    const g = globalThis as { window?: unknown };
    const original = g.window;
    g.window = { weaveforge: { fetchTitle: () => Promise.resolve({}), reportAppLog: (e: Log) => void logs.push(e) } };
    try {
      await run();
    } finally {
      g.window = original;
    }
    return logs;
  }

  it("answers false and logs when the maths renderer will not load", async () => {
    let ok: boolean | null = null;
    const logs = await withLog(async () => {
      ok = await loadMathOrLog(() => Promise.reject(new Error("chunk 404")));
    });
    assert.equal(ok, false);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]!.source, "ink");
    assert.match(logs[0]!.detail ?? "", /chunk 404/);
  });

  it("answers true and logs nothing when it loads", async () => {
    let ok: boolean | null = null;
    const logs = await withLog(async () => {
      ok = await loadMathOrLog(() => Promise.resolve({}));
    });
    assert.equal(ok, true);
    assert.deepEqual(logs, []);
  });
});
