import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  appendCardPair,
  compactLayoutVertical,
  defaultLayout,
  finalizeDashboardLayout,
  normalizeSmLayout,
  parseDashboardLayout,
  studentDefaultLg,
  studentDefaultSm,
  mergeSupervisorCardsIfMissing,
  syncDashboardLayouts,
  mergeRglPositions,
  lgLayoutNeedsRepair,
} from "../application/dashboard-layout";

describe("compactLayoutVertical", () => {
  it("removes vertical gaps", () => {
    const items = studentDefaultLg().map((it) =>
      it.id === "plan" ? { ...it, x: 6, y: 8 } : it,
    );
    const compacted = compactLayoutVertical(items, 12);
    const plan = compacted.find((it) => it.id === "plan");
    assert.ok(plan);
    assert.ok(plan.y < 8);
  });
});

describe("normalizeSmLayout", () => {
  it("keeps half-width tiles in a 2-column grid", () => {
    const layout = normalizeSmLayout(studentDefaultSm());
    const reading = layout.find((it) => it.id === "reading");
    const report = layout.find((it) => it.id === "report");
    assert.equal(reading?.w, 2);
    assert.equal(report?.w, 2);
    assert.equal(reading?.x, 0);
    assert.equal(report?.x, 2);
    assert.equal(reading?.y, 0);
    assert.equal(report?.y, 0);
  });

  it("packs cards upward after edits", () => {
    const layout = normalizeSmLayout(
      studentDefaultSm().map((it) => ({ ...it, y: it.y + 20 })),
    );
    assert.equal(layout[0]?.y, 0);
  });

  it("reflows when a card expands to full width", () => {
    const layout = normalizeSmLayout(
      studentDefaultSm().map((it) =>
        it.id === "reading" ? { ...it, w: 4, x: 0, y: 0 } : { ...it, x: 2, y: 0 },
      ),
    );
    const report = layout.find((it) => it.id === "report");
    assert.ok(report);
    assert.ok(report.y >= 2);
  });
});

describe("finalizeDashboardLayout", () => {
  it("does not leave mobile cards at huge y offsets", () => {
    const layout = finalizeDashboardLayout({
      lg: studentDefaultLg(),
      sm: studentDefaultSm().map((it) => ({ ...it, y: it.y + 999 })),
    });
    const maxY = layout.sm.reduce((m, it) => Math.max(m, it.y + it.h), 0);
    assert.ok(maxY < 30);
  });

  it("restores desktop widths when lg layout has mobile-sized cards", () => {
    const layout = finalizeDashboardLayout({
      lg: studentDefaultLg().map((it) => ({ ...it, w: 2, x: it.id === "report" ? 2 : 0 })),
      sm: studentDefaultSm(),
    });
    const reading = layout.lg.find((it) => it.id === "reading");
    assert.ok(reading);
    assert.ok(reading.w >= 3);
  });
});

describe("appendCardPair", () => {
  it("uses the same id on lg and sm", () => {
    const base = defaultLayout(false);
    const next = appendCardPair(base, "top-tags");
    const lgNew = next.lg.find((c) => !base.lg.some((b) => b.id === c.id));
    const smNew = next.sm.find((c) => !base.sm.some((b) => b.id === c.id));
    assert.ok(lgNew);
    assert.ok(smNew);
    assert.equal(lgNew.id, smNew.id);
    assert.equal(lgNew.type, "top-tags");
    assert.equal(smNew.type, "top-tags");
  });
});

describe("syncDashboardLayouts", () => {
  it("repairs orphan sm ids from lg", () => {
    const base = defaultLayout(false);
    const orphanSm = base.sm.filter((c) => c.id !== "reading");
    const synced = syncDashboardLayouts({ lg: base.lg, sm: orphanSm });
    const lgIds = new Set(synced.lg.map((c) => c.id));
    const smIds = new Set(synced.sm.map((c) => c.id));
    assert.equal(lgIds.size, smIds.size);
    for (const id of lgIds) {
      assert.ok(smIds.has(id));
    }
  });

  it("is idempotent after finalize", () => {
    const base = defaultLayout(false);
    const drifted = appendCardPair(base, "top-tags");
    const once = finalizeDashboardLayout(syncDashboardLayouts(drifted));
    const twice = finalizeDashboardLayout(syncDashboardLayouts(once));
    assert.equal(
      once.lg.map((c) => `${c.id}:${c.x},${c.y},${c.w},${c.h}`).join("|"),
      twice.lg.map((c) => `${c.id}:${c.x},${c.y},${c.w},${c.h}`).join("|"),
    );
    assert.equal(
      once.sm.map((c) => `${c.id}:${c.x},${c.y},${c.w},${c.h}`).join("|"),
      twice.sm.map((c) => `${c.id}:${c.x},${c.y},${c.w},${c.h}`).join("|"),
    );
  });
});

describe("mergeSupervisorCardsIfMissing", () => {
  it("adds supervisor cards without removing student cards", () => {
    const student = defaultLayout(false);
    const merged = mergeSupervisorCardsIfMissing(student);
    const types = new Set(merged.lg.map((c) => c.type));
    assert.ok(types.has("reading-progress"));
    assert.ok(types.has("team-roster"));
    assert.ok(types.has("team-attention"));
    assert.ok(types.has("supervisee-snapshot"));
  });

  it("does not duplicate supervisor cards on second merge", () => {
    const student = defaultLayout(false);
    const once = mergeSupervisorCardsIfMissing(student);
    const twice = mergeSupervisorCardsIfMissing(once);
    for (const type of ["team-roster", "team-attention", "supervisee-snapshot"] as const) {
      assert.equal(twice.lg.filter((c) => c.type === type).length, 1);
    }
  });
});

describe("parseDashboardLayout", () => {
  it("returns null for invalid payloads", () => {
    assert.equal(parseDashboardLayout(null), null);
    assert.equal(parseDashboardLayout({ lg: [] }), null);
    assert.equal(parseDashboardLayout({ lg: [{ id: "x", type: "not-a-type", x: 0, y: 0, w: 1, h: 1 }], sm: [] }), null);
  });

  it("parses valid layout", () => {
    const parsed = parseDashboardLayout({
      lg: studentDefaultLg(),
      sm: studentDefaultSm(),
    });
    assert.ok(parsed);
    assert.equal(parsed.lg.length, studentDefaultLg().length);
  });

  it("parses empty layout", () => {
    const parsed = parseDashboardLayout({ lg: [], sm: [] });
    assert.ok(parsed);
    assert.equal(parsed.lg.length, 0);
    assert.equal(parsed.sm.length, 0);
  });
});

describe("mergeRglPositions", () => {
  it("merges react-grid-layout positions into items", () => {
    const items = studentDefaultLg();
    const reading = items.find((it) => it.id === "reading");
    assert.ok(reading);
    const merged = mergeRglPositions(items, [{ i: "reading", x: 3, y: 1, w: 3, h: 2 }], 12);
    const next = merged.find((it) => it.id === "reading");
    assert.equal(next?.x, 3);
    assert.equal(next?.y, 1);
  });
});

describe("lgLayoutNeedsRepair", () => {
  it("detects desktop cards below min width", () => {
    const items = studentDefaultLg().map((it) =>
      it.id === "reading" ? { ...it, w: 1 } : it,
    );
    assert.ok(lgLayoutNeedsRepair(items));
  });
});
