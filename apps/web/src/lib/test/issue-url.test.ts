import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REPORT_REPO, newIssueUrl, reportMarkdown } from "@/lib/error-report/issue-url";

test("newIssueUrl: prefills title, body and labels on the default repo", () => {
  const url = new URL(newIssueUrl({ title: "Papers failed", body: "boom" }));
  assert.equal(url.origin + url.pathname, `https://github.com/${DEFAULT_REPORT_REPO}/issues/new`);
  assert.equal(url.searchParams.get("title"), "[app] Papers failed");
  assert.equal(url.searchParams.get("body"), "boom");
  assert.equal(url.searchParams.get("labels"), "bug,from-app");
});

test("newIssueUrl: a long body is cut from the end to fit the address", () => {
  const body = "HEAD " + "é".repeat(20_000) + " TAIL";
  const url = newIssueUrl({ title: "t", body, repo: "o/r" });
  assert.ok(url.length <= 7_500, `length ${url.length}`);
  const sent = new URL(url).searchParams.get("body")!;
  assert.ok(sent.startsWith("HEAD "));
  assert.ok(!sent.includes("TAIL"));
  assert.match(sent, /cut to fit/);
});

test("reportMarkdown: sections appear only when there is something in them", () => {
  assert.equal(reportMarkdown({ detail: "x" }), "### What happened\n\nx");
  const full = reportMarkdown({ detail: "x", route: "/papers", version: "0.6.0", logs: "err" });
  assert.match(full, /Route: `\/papers` · Version: `0\.6\.0`/);
  assert.match(full, /```text\nerr\n```/);
});

test("reportMarkdown: the reader's steps and the page context are their own sections", () => {
  const body = reportMarkdown({
    detail: "boom",
    steps: "1. Opened it",
    route: "/experiments/",
    context: [["Screen", "Experiments › Metrics"], ["Platform", ""]],
  });
  assert.match(body, /### Steps to reproduce\n\n1\. Opened it/);
  assert.match(body, /Route: `\/experiments\/`\n- Screen: Experiments › Metrics/);
  assert.doesNotMatch(body, /Platform/);
});
