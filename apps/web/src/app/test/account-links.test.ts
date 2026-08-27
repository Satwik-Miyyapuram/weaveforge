/**
 * What the sidebar's account block contains — and, mostly, what it does not.
 * Both of the absences here were bugs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountLinks, type AccountLinksInput } from "../account-links";

const base: AccountLinksInput = { canSupervise: false, hasProject: true, pendingProposals: 0 };
const ids = (input: Partial<AccountLinksInput> = {}) =>
  accountLinks({ ...base, ...input }).map((l) => l.id);

test("sidebar: there is no GitHub link", () => {
  // A link to the source repository is not something anyone needs from inside
  // the app, and it cost a permanent row in the most visible chrome there is.
  for (const input of [
    {},
    { canSupervise: true },
    { hasProject: false },
    { pendingProposals: 3 },
  ]) {
    const links = accountLinks({ ...base, ...input });
    assert.ok(
      !links.some((l) => /github/i.test(l.label) || /github\.com/i.test(l.href ?? "")),
      `GitHub reappeared with ${JSON.stringify(input)}`,
    );
  }
});

test("sidebar: documentation is always reachable", () => {
  // Deliberately not tucked inside Settings — someone looking for the docs is
  // usually already stuck.
  const docs = accountLinks(base).find((l) => l.id === "docs");
  assert.ok(docs, "the docs link must be present");
  assert.match(docs.href ?? "", /^https:\/\/www\.weaveforge\.org\/docs\//);
  assert.equal(docs.external, true, "external links open in a new tab");
});

test("sidebar: no second Projects control while the switcher is showing", () => {
  // The project chip sits directly above this and its menu already offers
  // "New / all projects" — two controls, two shapes, one action.
  assert.ok(!ids({ hasProject: true }).includes("projects"));
});

test("sidebar: Projects is the escape hatch when the switcher hides", () => {
  // With no project selected the switcher renders nothing, and this is the only
  // way back to the picker from /settings, /shared or /supervision.
  assert.ok(ids({ hasProject: false }).includes("projects"));
});

test("sidebar: Sign out is always present, and always last", () => {
  for (const input of [
    {},
    { canSupervise: true },
    { hasProject: false },
    { pendingProposals: 9 },
    { canSupervise: true, hasProject: false, pendingProposals: 2 },
  ]) {
    const list = ids(input);
    assert.equal(
      list.at(-1),
      "signout",
      `Sign out must be last, got ${JSON.stringify(list)}`,
    );
  }
});

test("sidebar: the block stays short", () => {
  // It went off the bottom of the viewport once. The layout now scrolls the
  // nav links rather than the account block, but the block earning its place
  // is the other half of that fix — so this is a budget, not a coincidence.
  const busiest = accountLinks({ canSupervise: true, hasProject: false, pendingProposals: 4 });
  assert.ok(busiest.length <= 7, `account block grew to ${busiest.length} entries`);
  assert.equal(accountLinks(base).length, 4, "the ordinary case is four entries");
});

test("sidebar: Supervise is hidden from Master's students", () => {
  assert.ok(!ids({ canSupervise: false }).includes("supervise"));
  assert.ok(ids({ canSupervise: true }).includes("supervise"));
});

test("sidebar: Review AI appears only when something is pending, with its count", () => {
  assert.ok(!ids({ pendingProposals: 0 }).includes("ai-review"));
  const link = accountLinks({ ...base, pendingProposals: 5 }).find((l) => l.id === "ai-review");
  assert.equal(link?.badge, 5);
});

test("sidebar: every navigating entry has a destination", () => {
  // `projects` and `signout` run actions; everything else must go somewhere,
  // or it renders as a dead link.
  for (const link of accountLinks({ canSupervise: true, hasProject: false, pendingProposals: 1 })) {
    if (link.id === "projects" || link.id === "signout" || link.id === "signin") {
      assert.equal(link.href, undefined, `${link.id} should act, not navigate`);
    } else {
      assert.ok(link.href, `${link.id} has no href`);
    }
  }
});


test("sidebar: a copy with no account is offered the way in, not a way out", () => {
  // "Sign out" of what? There is no session to end, and the entry is the one
  // place a reader would look for the account they have not made yet.
  const offline = ids({ local: true });
  assert.ok(offline.includes("signin"), "offline mode offers Sign in");
  assert.ok(!offline.includes("signout"), "offline mode does not offer Sign out");
  assert.ok(ids({ local: false }).includes("signout"));
});


test("sidebar: a copy with no account is not sent to routes it does not ship", () => {
  // The desktop bundle holds `/supervision` and `/shared` aside, so linking to
  // them offline is a 404 the router also prefetches.
  const offline = ids({ local: true, canSupervise: true });
  assert.ok(!offline.includes("supervise"));
  assert.ok(!offline.includes("shared"));
  const online = ids({ local: false, canSupervise: true });
  assert.ok(online.includes("supervise"));
  assert.ok(online.includes("shared"));
});
