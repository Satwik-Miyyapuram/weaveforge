/**
 * The upgrade screen's stopped view: the report file name hint, and the WebView message in place
 * of the generic line when the install id lock is unavailable. Rendered to markup, no DOM needed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WEBVIEW_UPDATE_MESSAGE } from "@/container/browser-install-id";
import { Migrate097UpgradeBody, upgradeReportFolder } from "../migrate-097-upgrade";

// The component file uses JSX without importing React; under node --test the transform is classic, so expose React first.
Object.assign(globalThis, { React });

const FOLDER = "C:\\Users\\me\\Documents\\WeaveForge";
const noop = () => {};

test("the stopped view names the per-device report file next to the folder", () => {
  const html = renderToStaticMarkup(
    <Migrate097UpgradeBody
      phase="stopped"
      progress={{}}
      reportFolder={upgradeReportFolder(FOLDER)}
      copied={false}
      onCopy={noop}
      onRetry={noop}
      onKeepOld={noop}
    />,
  );
  assert.match(html, /\(report-(&lt;|<)device(&gt;|>)\.json\)/);
});

test("a WebView lock failure shows its own message, not the generic line", () => {
  const html = renderToStaticMarkup(
    <Migrate097UpgradeBody
      phase="stopped"
      progress={{}}
      reportFolder={upgradeReportFolder(FOLDER)}
      failureMessage={WEBVIEW_UPDATE_MESSAGE}
      copied={false}
      onCopy={noop}
      onRetry={noop}
      onKeepOld={noop}
    />,
  );
  assert.ok(html.includes(WEBVIEW_UPDATE_MESSAGE), "the WebView message is shown");
  assert.doesNotMatch(html, /did not finish/, "the generic line is replaced");
});