import assert from "node:assert/strict";
import { before, test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadTestCore } from "@/lib/test/load-test-core";
import { firstRunQuestion } from "../application/workspace-setup";
import { WorkspaceSetupView, answerFirstRun } from "../ui/workspace-setup-dialog";

before(async () => {
  await loadTestCore();
});

test("the question is due only when the shell says so, and says where Skip goes", async () => {
  assert.equal(await firstRunQuestion(null), null);
  assert.equal(await firstRunQuestion({}), null);
  assert.deepEqual(
    await firstRunQuestion({
      workspaceSetup: async () => ({ needed: true, defaultFolder: "C:\\Users\\me\\Documents" }),
    }),
    { defaultFolder: "C:\\Users\\me\\Documents" },
  );
  assert.equal(
    await firstRunQuestion({ workspaceSetup: async () => ({ needed: false, defaultFolder: "x" }) }),
    null,
  );
});

test("a failed setup read asks nothing, so a broken shell never blocks the app", async () => {
  assert.equal(
    await firstRunQuestion({
      workspaceSetup: async () => {
        throw new Error("shell gone");
      },
    }),
    null,
  );
});

test("the question offers Choose folder and Skip, with Skip's folder named and no fixed path", () => {
  const html = renderToStaticMarkup(
    createElement(WorkspaceSetupView, {
      defaultFolder: "D:\\Docs",
      busy: false,
      error: null,
      onChoose: () => {},
      onSkip: () => {},
    }),
  );
  assert.match(html, /Choose folder…/);
  assert.match(html, />Skip</);
  assert.match(html, /Skip uses D:\\Docs/);
  assert.equal(html.includes("Documents\\WeaveForge"), false);
  assert.doesNotMatch(html, /role="alert"/);
});

test("without a Documents folder there is no Skip, no fixed path, and a failure is announced inline", () => {
  const html = renderToStaticMarkup(
    createElement(WorkspaceSetupView, {
      defaultFolder: null,
      busy: false,
      error: "That folder is inside the WeaveForge app folder. Pick a folder outside the app.",
      onChoose: () => {},
      onSkip: () => {},
    }),
  );
  assert.doesNotMatch(html, />Skip</);
  assert.equal(html.includes("Documents\\WeaveForge"), false);
  assert.match(html, /role="alert"/);
  assert.match(html, /inside the WeaveForge app folder/);
});

test("Choose is the focused default, stays enabled while busy, and its body is announced", () => {
  const idle = renderToStaticMarkup(
    createElement(WorkspaceSetupView, { defaultFolder: "D:\\Docs", busy: false, error: null, onChoose: () => {}, onSkip: () => {} }),
  );
  const choose = idle.match(/<button[^>]*>Choose folder…<\/button>/)?.[0] ?? "";
  assert.match(choose, /data-autofocus/);
  assert.match(choose, /aria-describedby="workspace-setup-body"/);
  assert.match(idle, /id="workspace-setup-body"/);
  assert.match(idle, /aria-live="polite"/);

  const busy = renderToStaticMarkup(
    createElement(WorkspaceSetupView, { defaultFolder: "D:\\Docs", busy: true, error: null, onChoose: () => {}, onSkip: () => {} }),
  );
  const chosen = busy.match(/<button[^>]*>Choosing…<\/button>/)?.[0] ?? "";
  assert.ok(chosen, "the busy button is still labelled Choosing…");
  assert.match(chosen, /aria-busy="true"/);
  assert.doesNotMatch(chosen, /disabled/);
  assert.match(busy, /aria-live="polite"[^>]*>Choosing…|>Choosing…</);
});

test("a folder that was connected with a warning stays on the question until Continue", () => {
  const html = renderToStaticMarkup(
    createElement(WorkspaceSetupView, {
      defaultFolder: "D:\\Docs",
      busy: false,
      error: null,
      notice: "The folder is not watched for changes.",
      onChoose: () => {},
      onSkip: () => {},
      onContinue: () => {},
    }),
  );
  assert.match(html, /The folder is not watched for changes\./);
  assert.match(html, />Continue</);
  assert.doesNotMatch(html, />Choose folder…</);
});

test("answering: a cancelled dialog keeps the question, a clean answer closes it, a warned one stays to show it", async () => {
  assert.deepEqual(await answerFirstRun(async () => false), { closed: false, warnings: [] });
  assert.deepEqual(await answerFirstRun(async () => ({ warnings: [] })), { closed: true, warnings: [] });
  assert.deepEqual(await answerFirstRun(async () => ({ warnings: ["not watched"] })), {
    closed: false,
    warnings: ["not watched"],
  });
});

