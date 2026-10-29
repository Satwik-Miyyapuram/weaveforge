/**
 * A connection row that was not set up said "Not set" in a status pill, so the
 * reader saw a state where they needed an action; and GitHub and GitLab, which
 * do the same thing in the Git tab, were described in different words
 * (design D21, DA-139).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectionState } from "../connection-state";
import { githubGitReadManifest, gitlabGitReadManifest } from "@/integrations/manifests/git-read";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

test("a connected row shows its state; one not set up offers the action", () => {
  assert.equal(renderToStaticMarkup(<ConnectionState connected />), '<span class="status status-done">Connected</span>');
  const setup = renderToStaticMarkup(<ConnectionState connected={false} />);
  assert.match(setup, /^<span class="connection-setup">Set up<\/span>$/);
  // A span, since the whole row is already a button.
  assert.doesNotMatch(setup, /<button/);
});

test("both connection lists use it, and nothing says Not set", () => {
  for (const file of ["features/sync/ui/sync-settings.tsx", "features/settings/ui/settings-screen.tsx"]) {
    const src = read(file);
    assert.doesNotMatch(src, /"Not set"/, file);
    assert.match(src, /<ConnectionState connected=\{connected\} \/>/, file);
  }
});

test("GitHub and GitLab read the Git tab and say so in the same words", () => {
  const github = githubGitReadManifest.projectDescriptors[0]!;
  const gitlab = gitlabGitReadManifest.projectDescriptors[0]!;
  assert.equal(github.title, "GitHub — Git tab");
  assert.equal(gitlab.title, "GitLab — Git tab");
  assert.equal(github.description, gitlab.description);
  assert.equal(github.description, "Read commits and branches in the Git tab to track experiments.");
});
