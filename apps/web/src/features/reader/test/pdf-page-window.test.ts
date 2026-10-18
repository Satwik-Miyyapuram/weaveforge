import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { idle, pagesToEvict } from "../ui/pdf-reader/pdf-page-window";

describe("pdf-page-window", () => {
  describe("pagesToEvict", () => {
    it("keeps pages within radius of ANY visible page", () => {
      const rendered = [1, 2, 5, 8, 10, 17, 20, 23, 25];
      const visible = [5, 20];
      const evicted = pagesToEvict(rendered, visible, 3);
      assert.deepEqual(evicted, [1, 10, 25]);
    });

    it("evicts far ones on both sides", () => {
      const rendered = [1, 6, 7, 10, 13, 14, 20];
      const visible = [10];
      const evicted = pagesToEvict(rendered, visible);
      assert.deepEqual(evicted, [1, 6, 14, 20]);
    });

    it("returns [] when visible is empty", () => {
      const rendered = [1, 2, 3, 4, 5];
      assert.deepEqual(pagesToEvict(rendered, []), []);
    });

    it("returns sorted output regardless of rendered input order", () => {
      const rendered = new Set([40, 2, 99, 1, 25, 10]);
      const visible = [25];
      const evicted = pagesToEvict(rendered, visible, 3);
      assert.deepEqual(evicted, [1, 2, 10, 40, 99]);
    });

    it("respects custom radius", () => {
      const rendered = [8, 9, 10, 11, 12];
      const visible = [10];
      assert.deepEqual(pagesToEvict(rendered, visible, 1), [8, 12]);
      assert.deepEqual(pagesToEvict(rendered, visible, 2), []);
    });
  });

  describe("idle", () => {
    it("resolves when neither scheduler nor requestIdleCallback exist (setTimeout fallback)", async () => {
      const originalScheduler = (globalThis as Record<string, unknown>).scheduler;
      const originalRequestIdleCallback = (globalThis as Record<string, unknown>).requestIdleCallback;
      try {
        delete (globalThis as Record<string, unknown>).scheduler;
        delete (globalThis as Record<string, unknown>).requestIdleCallback;

        let resolved = false;
        const promise = idle().then(() => {
          resolved = true;
        });
        assert.equal(resolved, false);
        await promise;
        assert.equal(resolved, true);
      } finally {
        if (originalScheduler !== undefined) {
          (globalThis as Record<string, unknown>).scheduler = originalScheduler;
        }
        if (originalRequestIdleCallback !== undefined) {
          (globalThis as Record<string, unknown>).requestIdleCallback = originalRequestIdleCallback;
        }
      }
    });
  });
});
