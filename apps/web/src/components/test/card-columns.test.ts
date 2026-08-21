/**
 * The dealing rule, pinned away from the component.
 *
 * The `hue` field is the part worth a test: Confetti's first release coloured
 * cards with `.card:nth-child(6n + k)`, which is correct for sibling cards and
 * useless here — `CardColumns` gives every card its own wrapper, so every card
 * was `:nth-child(1)` and a whole papers list rendered in one colour. The hue
 * now comes from the card's index in the flat list, before the deal scatters
 * that index across columns.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CARD_HUE_COUNT, dealColumns } from "../card-columns";

const key = (s: string) => s;

describe("dealColumns", () => {
  it("deals round-robin, so the first row reads across in sort order", () => {
    const columns = dealColumns(["a", "b", "c", "d", "e"], 3, key);
    assert.deepEqual(
      columns.map((c) => c.map((d) => d.item)),
      [["a", "d"], ["b", "e"], ["c"]],
    );
  });

  it("numbers hues by flat position, not by position within a column", () => {
    const columns = dealColumns(["a", "b", "c", "d"], 2, key);
    // a=1 c=3 down the first column, b=2 d=4 down the second: were the hue
    // taken from the card's place in its own column, both columns would read
    // 1, 2 and every row would be a matching pair.
    assert.deepEqual(
      columns.map((c) => c.map((d) => d.hue)),
      [
        [1, 3],
        [2, 4],
      ],
    );
  });

  it("wraps the hue after a full rotation", () => {
    const items = Array.from({ length: CARD_HUE_COUNT + 2 }, (_, i) => `i${i}`);
    const [only] = dealColumns(items, 1, key);
    assert.deepEqual(
      only!.map((d) => d.hue),
      [1, 2, 3, 4, 5, 6, 1, 2],
    );
  });

  it("deals nothing before the container has been measured", () => {
    assert.deepEqual(dealColumns(["a", "b"], 0, key), []);
  });
});
