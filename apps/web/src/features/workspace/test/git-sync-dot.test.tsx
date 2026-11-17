import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { DetailHeaderExtras, DetailHeaderExtrasContext } from "@/components/detail-header-extras";
import { GitSyncDotView, syncDot } from "../ui/git-sync-dot";

const time = (at: number) => `T${at}`;

test("each state reads as a tone, a short word and a full label", () => {
  assert.equal(syncDot({ kind: "off" }, time), null);
  assert.deepEqual(syncDot({ kind: "idle", syncedAt: 5, pulled: false }, time), {
    tone: "good",
    text: "Synced T5",
    label: "Git sync: synced at T5.",
  });
  assert.deepEqual(syncDot({ kind: "idle", syncedAt: 5, pulled: true }, time), {
    tone: "good",
    text: "Synced T5 · pulled changes",
    label: "Git sync: synced at T5, and changes came in.",
  });
  assert.deepEqual(syncDot({ kind: "syncing" }, time), { tone: "info", text: "Syncing…", label: "Git sync: syncing." });
  assert.deepEqual(syncDot({ kind: "offline" }, time), {
    tone: "muted",
    text: "Offline",
    label: "Git sync: offline. It syncs when you are back online.",
  });
  assert.deepEqual(syncDot({ kind: "error", message: "network down", retryAt: 9 }, time), {
    tone: "danger",
    text: "Sync failed",
    label: "Git sync failed: network down Next try at T9.",
  });
});

test("off paints nothing", () => {
  assert.equal(renderToStaticMarkup(<GitSyncDotView state={{ kind: "off" }} onRetry={() => {}} time={time} />), "");
});

test("a synced dot is a labelled status with no button", () => {
  const html = renderToStaticMarkup(<GitSyncDotView state={{ kind: "idle", syncedAt: 5, pulled: false }} onRetry={() => {}} time={time} />);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-label="Git sync: synced at T5\."/);
  assert.match(html, /data-tone="good"/);
  assert.match(html, />Synced T5</);
  assert.doesNotMatch(html, /<button/);
});

test("syncing and offline say so", () => {
  assert.match(renderToStaticMarkup(<GitSyncDotView state={{ kind: "syncing" }} onRetry={() => {}} time={time} />), /data-tone="info".*Syncing…/);
  assert.match(renderToStaticMarkup(<GitSyncDotView state={{ kind: "offline" }} onRetry={() => {}} time={time} />), /data-tone="muted".*Offline/);
});

test("a failure carries its message as the tooltip and offers Retry", () => {
  const html = renderToStaticMarkup(
    <GitSyncDotView state={{ kind: "error", message: "Pull first.", retryAt: 9 }} onRetry={() => {}} time={time} />,
  );
  assert.match(html, /data-tone="danger"/);
  assert.match(html, /title="Git sync failed: Pull first\. Next try at T9\."/);
  assert.match(html, /<button[^>]*>Retry<\/button>/);
});

test("the app shell mounts the dot on every screen, not the document status bar", () => {
  const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const mount = /<GitSyncDot \/>/;
  assert.doesNotMatch(src("../../editor-workspace/ui/status-bar.tsx"), /GitSyncDot/);
  // The sidebar's foot on desktop.
  assert.match(src("../../../app/tabbar.tsx"), mount);
  // The phone's top bar.
  const shell = src("../../../app/app-shell.tsx");
  assert.match(shell, /<div className="brand-right">\s*<GitSyncDot \/>/);
});

test("a phone's detail view shows the dot in its own header, given from the app shell", () => {
  const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  // The shell hands the dot down on the phone only; the sidebar has it on a desktop.
  const shell = src("../../../app/app-shell.tsx");
  assert.match(shell, /<DetailHeaderExtrasContext value=\{breakpoint !== "desktop" \? <GitSyncDot \/> : null\}>/);
  // Each detail view's header renders what it was given, without importing the workspace feature.
  for (const rel of [
    "../../papers/ui/paper-note.tsx",
    "../../vault/ui/vault-screen/page-editor.tsx",
    "../../experiments/ui/experiment-detail-screen.tsx",
  ]) {
    const file = src(rel);
    assert.match(file, /<div className="record-actions">\s*<DetailHeaderExtras \/>/, rel);
    assert.doesNotMatch(file, /features\/workspace\/ui/, rel);
  }
});

test("the detail header extras render what the shell gave, and nothing without it", () => {
  assert.equal(renderToStaticMarkup(<DetailHeaderExtras />), "");
  const html = renderToStaticMarkup(
    <DetailHeaderExtrasContext value={<span data-dot="yes" />}>
      <DetailHeaderExtras />
    </DetailHeaderExtrasContext>,
  );
  assert.equal(html, '<span data-dot="yes"></span>');
});
