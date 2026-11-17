/**
 * With no project open, the account button sits in the page header's action
 * row (Home, and the account screens), not in a bar of its own above it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { setContainerForTests } from "@/bootstrap";
import { PageHeaderAccount, ScreenHead } from "../screen-head";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

const ACCOUNT = <button id="account-button">Account</button>;

function headerWith(account: boolean, title: string) {
  setContainerForTests({ integrationConfig: { gitRead: [] } } as never);
  try {
    const head = (
      <ScreenHead title={title}>
        <button>Load demo workspace</button>
        <button className="wf-primary">New project</button>
      </ScreenHead>
    );
    return renderToStaticMarkup(
      account ? <PageHeaderAccount.Provider value={ACCOUNT}>{head}</PageHeaderAccount.Provider> : head,
    );
  } finally {
    setContainerForTests(null);
  }
}

/** The markup of the header's action row, from its opening tag to the end of the header. */
function actionRow(html: string): string {
  const start = html.indexOf('class="screen-actions"');
  const end = html.indexOf("</header>");
  assert.ok(start > 0 && end > start, "the header has an action row");
  return html.slice(start, end);
}

test("on Home the account button renders in the page header's action row, after New project", () => {
  const html = headerWith(true, "Home");
  const row = actionRow(html);
  assert.match(row, /id="account-button"/);
  assert.ok(row.indexOf("New project") < row.indexOf("account-button"), "the account button follows New project");
  assert.equal(html.match(/id="account-button"/g)?.length, 1);
});

test("the account button draws no row of its own above the screen head", () => {
  const html = headerWith(true, "Home");
  const headRow = html.indexOf('class="head-row"');
  const account = html.indexOf("account-button");
  assert.ok(headRow >= 0, "the screen head has its head row");
  // Inside the head row, after the title. A separate row above the head would put the account
  // before the head row, or outside the header, and fail one of these.
  assert.ok(html.indexOf("<h1") < account, "the header row opens with the title, not the account");
  assert.ok(account > headRow, "the account button sits inside the head row");
  assert.ok(account < html.indexOf("</header>"), "the account button sits inside the page header");
  assert.doesNotMatch(html.slice(0, headRow), /project-picker-bar/, "no account bar is drawn above the head row");
});

test("another account screen (Settings) gets the same action-row placement", () => {
  const html = headerWith(true, "Settings");
  assert.match(actionRow(html), /id="account-button"/);
});

test("a project page renders no account button in its header", () => {
  const html = headerWith(false, "Library");
  assert.doesNotMatch(html, /account-button/);
});

test("the project picker no longer draws a separate top bar for the account", () => {
  const shell = src("app/app-shell.tsx");
  assert.doesNotMatch(shell, /project-picker-bar/);
  // The page-header renders are handed to the header's account slot, so they cannot draw above it.
  const rendered = shell.match(/<HeaderActions \/>/g)?.length ?? 0;
  // The project-less slot also carries the git sync dot, so it is a fragment.
  const handed =
    shell.match(/<PageHeaderAccount\.Provider value=\{(?:<HeaderActions \/>|<><GitSyncDot \/><HeaderActions \/><\/>)\}>/g)?.length ?? 0;
  assert.equal(handed, 2, "both page-header account slots hand HeaderActions to the header");
  // The one left over is the mobile-only brand bar, gated off the desktop breakpoint.
  assert.equal(rendered - handed, 1, "only the mobile brand bar renders HeaderActions outside the header");
  assert.match(shell, /breakpoint !== "desktop"[\s\S]{0,200}<HeaderActions \/>/);
  assert.match(src("components/screen-head.tsx"), /project-picker-bar desktop-only/);
});
