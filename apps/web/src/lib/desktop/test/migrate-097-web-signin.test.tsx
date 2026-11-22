/**
 * The web upgrade starts when the user signs in after first paint: no runner while signed out,
 * then exactly one runner once the user is set.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { AuthContext } from "@/features/auth/ui/auth-provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Object.assign(globalThis, { React });

function authValue(user: { id: string } | null, loading = false) {
  return { user, loading } as never;
}

test("a user who signs in after first paint gets exactly one web runner", async () => {
  const { Migrate097Web } = await import("../migrate-097-web");
  let loads = 0;
  const load = async () => {
    loads += 1;
    return null;
  };
  const tree = (user: { id: string } | null) =>
    React.createElement(
      AuthContext.Provider,
      { value: authValue(user) },
      React.createElement(Migrate097Web, { load }, React.createElement("span", null, "app")),
    );

  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(tree(null));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  assert.equal(loads, 0, "signed out: no export runner is built");

  await act(async () => {
    renderer!.update(tree({ id: "user-1" }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  assert.equal(loads, 1, "signed in after first paint: the loader runs exactly once");

  await act(async () => {
    renderer!.update(tree({ id: "user-1" }));
  });
  assert.equal(loads, 1, "a re-render with the same user does not build another runner");
});