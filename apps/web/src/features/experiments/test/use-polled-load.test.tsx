import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";
import { act, create } from "react-test-renderer";

import { usePolledLoad } from "../ui/use-polled-load";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Seen = ReturnType<typeof usePolledLoad<string>>;
type Out = { current: Seen | null; renders: number };

function Probe(props: { k: string; load: () => Promise<string>; pollMs: number | null; out: Out }) {
  props.out.renders += 1;
  props.out.current = usePolledLoad(props.k, props.load, props.pollMs);
  return null;
}

function tree(k: string, load: () => Promise<string>, out: Out, pollMs: number | null = null): ReactElement {
  return createElement(Probe, { k, load, pollMs, out });
}

const flush = () => act(async () => { await new Promise((r) => setImmediate(r)); });

test("a re-render with a fresh loader does not fetch again (35-04)", async () => {
  const out: Out = { current: null, renders: 0 };
  let calls = 0;
  const loader = () => async () => { calls += 1; return "x"; };

  let r!: ReturnType<typeof create>;
  await act(async () => { r = create(tree("a", loader(), out)); });
  await flush();
  await act(async () => { r.update(tree("a", loader(), out)); });
  await act(async () => { r.update(tree("a", loader(), out)); });
  await flush();
  assert.equal(calls, 1);
  assert.equal(out.current?.data, "x");
  await act(async () => { r.unmount(); });
});

test("the old key's late answer is ignored after the key changes (35-04)", async () => {
  const out: Out = { current: null, renders: 0 };
  let releaseA!: () => void;
  const loadA = () => new Promise<string>((resolve) => { releaseA = () => resolve("from-a"); });
  const loadB = async () => "from-b";

  let r!: ReturnType<typeof create>;
  await act(async () => { r = create(tree("a", loadA, out)); });
  await act(async () => { r.update(tree("b", loadB, out)); });
  await flush();
  assert.equal(out.current?.data, "from-b");
  releaseA();
  await flush();
  assert.equal(out.current?.data, "from-b", "key a's answer replaced key b's");
  await act(async () => { r.unmount(); });
});

test("a new key drops the old key's data until its own answer lands", async () => {
  const out: Out = { current: null, renders: 0 };
  let r!: ReturnType<typeof create>;
  await act(async () => { r = create(tree("a", async () => "from-a", out)); });
  await flush();
  assert.equal(out.current?.data, "from-a");
  await act(async () => { r.update(tree("b", () => new Promise<string>(() => {}), out)); });
  assert.equal(out.current?.data, null);
  await act(async () => { r.unmount(); });
});

test("a success after a failure clears the error (35-06)", async () => {
  const out: Out = { current: null, renders: 0 };
  let fail = true;
  const load = async () => {
    if (fail) throw Object.assign(new Error("down"), { code: "PGRST202" });
    return "back";
  };

  let r!: ReturnType<typeof create>;
  await act(async () => { r = create(tree("a", load, out, 20)); });
  await flush();
  assert.equal((out.current?.error as { code?: string } | null)?.code, "PGRST202");
  fail = false;
  await act(async () => { await new Promise((res) => setTimeout(res, 60)); });
  assert.equal(out.current?.error, null);
  assert.equal(out.current?.data, "back");
  await act(async () => { r.unmount(); });
});

test("polling uses the latest loader and stops on unmount", async () => {
  const out: Out = { current: null, renders: 0 };
  const seen: string[] = [];
  const loader = (tag: string) => async () => { seen.push(tag); return tag; };

  let r!: ReturnType<typeof create>;
  await act(async () => { r = create(tree("a", loader("first"), out, 20)); });
  await act(async () => { r.update(tree("a", loader("second"), out, 20)); });
  await act(async () => { await new Promise((res) => setTimeout(res, 50)); });
  assert.equal(seen[0], "first");
  assert.ok(seen.slice(1).length > 0 && seen.slice(1).every((t) => t === "second"), seen.join());
  await act(async () => { r.unmount(); });
  const after = seen.length;
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(seen.length, after, "it kept polling after unmount");
});

test("no polling when pollMs is null", async () => {
  const out: Out = { current: null, renders: 0 };
  let calls = 0;
  let r!: ReturnType<typeof create>;
  await act(async () => { r = create(tree("a", async () => { calls += 1; return "x"; }, out, null)); });
  await act(async () => { await new Promise((res) => setTimeout(res, 40)); });
  assert.equal(calls, 1);
  await act(async () => { r.unmount(); });
});
