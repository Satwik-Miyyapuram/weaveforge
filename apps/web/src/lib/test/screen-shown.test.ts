/**
 * The `wf:screen:<name>:shown` timing marks a CDP script reads to time screens.
 *
 * Each mark comes with a measure of the same name, from the last navigation
 * start (or from the window's start on a cold launch), so a script can read
 * one number per screen without knowing how the app navigates.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";

import { ScreenActiveContext } from "@/lib/hooks/use-screen-active";
import { markNavStart, markScreenShown, onScreenShown, useScreenShown } from "@/lib/screen-shown";
import { renderHook } from "./react-harness.js";

const measures = (name: string) => performance.getEntriesByName(name, "measure");
const marks = (name: string) => performance.getEntriesByName(name, "mark");

function reset() {
  performance.clearMarks();
  performance.clearMeasures();
}

test("screen shown: a mark and a measure of the same name", () => {
  reset();
  markScreenShown("papers");
  assert.equal(marks("wf:screen:papers:shown").length, 1);
  assert.equal(measures("wf:screen:papers:shown").length, 1);
});

test("screen shown: measured from the last navigation start", () => {
  reset();
  markNavStart();
  const navAt = marks("wf:nav:start")[0]!.startTime;
  markScreenShown("lists");
  const [measure] = measures("wf:screen:lists:shown");
  assert.equal(measure!.startTime, navAt);
});

test("screen shown: a cold start, with no navigation, is measured from the window's start", () => {
  reset();
  markScreenShown("dashboard");
  assert.equal(measures("wf:screen:dashboard:shown")[0]!.startTime, 0);
});

test("screen shown: a navigation start is used once, not by the next screen too", () => {
  reset();
  markNavStart();
  markScreenShown("papers");
  markScreenShown("workspace");
  assert.equal(measures("wf:screen:workspace:shown")[0]!.startTime, 0);
});

test("screen shown: repeated marks keep only the newest, so the buffer stays small", () => {
  reset();
  for (let i = 0; i < 5; i += 1) {
    markNavStart();
    markScreenShown("papers");
  }
  assert.equal(marks("wf:screen:papers:shown").length, 1);
  assert.equal(measures("wf:screen:papers:shown").length, 1);
  assert.equal(marks("wf:nav:start").length, 0);
});

test("screen shown: subscribers hear each screen, and stop hearing once unsubscribed", () => {
  reset();
  const heard: string[] = [];
  const off = onScreenShown((name) => heard.push(name));
  markScreenShown("papers");
  off();
  markScreenShown("lists");
  assert.deepEqual(heard, ["papers"]);
});

test("screen shown: a subscriber that throws does not stop the mark or the others", () => {
  reset();
  const heard: string[] = [];
  const offA = onScreenShown(() => {
    throw new Error("boom");
  });
  const offB = onScreenShown((name) => heard.push(name));
  markScreenShown("graph");
  offA();
  offB();
  assert.deepEqual(heard, ["graph"]);
  assert.equal(marks("wf:screen:graph:shown").length, 1);
});

test("useScreenShown: marks once when ready, not on every render", async () => {
  reset();
  const heard: string[] = [];
  const off = onScreenShown((name) => heard.push(name));
  const harness = await renderHook((ready: boolean) => useScreenShown("papers", ready), false);
  assert.deepEqual(heard, [], "not ready yet");
  await harness.rerender(true);
  await harness.rerender(true);
  assert.deepEqual(heard, ["papers"]);
  await harness.unmount();
  off();
});

test("useScreenShown: a hidden screen does not mark; it marks again each time it is shown", async () => {
  reset();
  const heard: string[] = [];
  const off = onScreenShown((name) => heard.push(name));
  let active = false;
  const harness = await renderHook(() => useScreenShown("papers", true), undefined, {
    wrapper: (children: ReactNode) => createElement(ScreenActiveContext.Provider, { value: active }, children),
  });
  assert.deepEqual(heard, [], "hidden behind another screen");
  active = true;
  await harness.rerender(undefined);
  assert.deepEqual(heard, ["papers"]);
  active = false;
  await harness.rerender(undefined);
  active = true;
  await harness.rerender(undefined);
  assert.deepEqual(heard, ["papers", "papers"], "shown again after another screen");
  await harness.unmount();
  off();
});
