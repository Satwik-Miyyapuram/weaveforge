/**
 * The settings rail promised things the build did not have: "Cloud, Zotero,
 * calendar" in a Dev copy with no Zotero, and "Account and lab" in a copy whose
 * account panel says labs live on the web app. Each group's label and hint now
 * name only the tabs that are shown (design D21, DA-136).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { railGroupText } from "../ui/rail-group-text";

const sync = {
  label: "Sync and integrations",
  hints: [["sync", "cloud"], ["integrations", ""], ["calendar", "calendar"]] as const,
};
const account = {
  label: "Account and lab",
  labelWithout: { tab: "org", label: "Account" },
  hints: [["account", "profile, password"], ["org", "lab"], ["tokens", "tokens"]] as const,
};

test("the sync hint names the integrations this build has, and no others", () => {
  const all = new Set(["sync", "integrations", "calendar"]);
  assert.equal(railGroupText(sync, all, ["Zotero"]).hint, "Cloud, Zotero, calendar");
  assert.equal(railGroupText(sync, all, ["Zotero", "Semantic Scholar"]).hint, "Cloud, Zotero, Semantic Scholar, calendar");
  assert.equal(railGroupText(sync, new Set(["sync", "calendar"]), []).hint, "Cloud, calendar");
  assert.equal(railGroupText(sync, new Set(["calendar"]), []).hint, "Calendar", "the first word is capitalised");
});

test("a group drops the word for a tab it does not show", () => {
  assert.deepEqual(railGroupText(account, new Set(["account", "org", "tokens"]), []), {
    label: "Account and lab",
    hint: "Profile, password, lab, tokens",
  });
  assert.deepEqual(railGroupText(account, new Set(["account", "tokens"]), []), {
    label: "Account",
    hint: "Profile, password, tokens",
  });
});

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

test("the rail takes its words from the shown tabs", () => {
  const screen = read("ui/settings-screen.tsx");
  assert.doesNotMatch(screen, /hint: "Cloud, Zotero, calendar"/);
  assert.match(screen, /railGroupText\(g, visible, userIntegrations\.map\(\(d\) => d\.title\)\)/);
});

test("the account panel links to the web app and copies the whole Account ID", () => {
  const panel = read("ui/account-info-panel.tsx");
  assert.match(panel, /<a href=\{WEB_APP_URL\} target="_blank" rel="noreferrer">web app<\/a>/);
  assert.match(panel, /navigator\.clipboard\.writeText\(user\.id\)/);
  assert.match(panel, /aria-label="Copy Account ID"/);
});

test("a group's sub-tabs read from the left, like the group above them", () => {
  // A catalogue tab is a block button, so the browser centres its text and
  // justify-content does nothing; text-align is what moves it.
  const css = read("../../app/styles/privacy.css");
  const rule = css.match(/\n\.settings-rail-tabs > \.wf-tab \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /text-align:\s*start/);
});
