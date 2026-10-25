import { test } from "node:test";
import assert from "node:assert/strict";
import { act, create, type ReactTestInstance } from "react-test-renderer";

import { SharedPaperAnnotations } from "../ui/shared-item-renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const prefix = "The same opening words for both";

test("two samples that share an opening both render without a key clash (33-22)", () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    let r: ReturnType<typeof create>;
    act(() => {
      r = create(
        <SharedPaperAnnotations
          metadata={{
            annotations: [
              { text: `${prefix}, then one ending`, tags: [] },
              { text: `${prefix}, then another`, tags: [] },
            ],
          }}
        />,
      );
    });
    const samples = r!.root.findAll((n: ReactTestInstance) => n.type === "p");
    assert.equal(samples.length, 2);
    assert.deepEqual(errors.filter((e) => /same key/i.test(e)), []);
  } finally {
    console.error = original;
  }
});
