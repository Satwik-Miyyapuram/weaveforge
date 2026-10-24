/**
 * The lab switcher (B62).
 *
 * - 32-29: a failed switch says so instead of leaving an unhandled rejection.
 * - 32-30: the menu closes on Escape or a click away, not only on mouse-leave.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { Member, OrgMembershipView } from "@weaveforge/core";
import { OrgSwitcherView } from "@/features/org/ui/org-switcher";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Listener = (event: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
(globalThis as { document?: unknown }).document = {
  addEventListener: (type: string, fn: Listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: Listener) => listeners.get(type)?.delete(fn),
  body: {},
};

function fire(type: string, event: unknown) {
  for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
}

const LABS: OrgMembershipView[] = [
  { orgId: "a", orgName: "Lab A", role: "professor", joinSource: "create" },
  { orgId: "b", orgName: "Lab B", role: "phd", joinSource: "invite" },
];

function render(switchOrg: (id: string) => Promise<void>): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      createElement(OrgSwitcherView, {
        profile: { id: "m1" } as unknown as Member,
        memberships: LABS,
        activeOrgId: "a",
        switchOrg,
      }),
    );
  });
  return r;
}

const chip = (r: ReactTestRenderer) => r.root.findByProps({ "aria-label": "Switch lab" });
const isOpen = (r: ReactTestRenderer) => chip(r).props["aria-expanded"] === true;

function openMenu(r: ReactTestRenderer) {
  act(() => chip(r).props.onClick());
  assert.equal(isOpen(r), true);
}

function itemFor(r: ReactTestRenderer, name: string) {
  return r.root.findAll((n) => n.type === "button" && String(n.props.className).includes("proj-menu-item"))
    .find((n) => n.findAll((c) => c.children.includes(name)).length > 0)!;
}

test("a failed switch shows the reason and keeps the menu open (32-29)", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const r = render(() => Promise.reject(new Error("network down")));
    openMenu(r);
    await act(async () => {
      itemFor(r, "Lab B").props.onClick();
      await new Promise((res) => setTimeout(res, 5));
    });
    const alert = r.root.findByProps({ role: "alert" });
    assert.match(String(alert.children.join("")), /network down/);
    assert.equal(isOpen(r), true);
    assert.equal(itemFor(r, "Lab B").props.disabled, false, "busy is cleared");
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a successful switch closes the menu and shows no error", async () => {
  const picked: string[] = [];
  const r = render(async (id) => void picked.push(id));
  openMenu(r);
  await act(async () => {
    itemFor(r, "Lab B").props.onClick();
  });
  assert.deepEqual(picked, ["b"]);
  assert.equal(isOpen(r), false);
  assert.equal(r.root.findAllByProps({ role: "alert" }).length, 0);
});

test("picking the active lab does not call switch", async () => {
  const picked: string[] = [];
  const r = render(async (id) => void picked.push(id));
  openMenu(r);
  await act(async () => {
    itemFor(r, "Lab A").props.onClick();
  });
  assert.deepEqual(picked, []);
});

test("Escape closes the menu (32-30)", () => {
  const r = render(async () => {});
  openMenu(r);
  act(() => fire("keydown", { key: "Escape", stopPropagation() {} }));
  assert.equal(isOpen(r), false);
});

test("a click away closes the menu (32-30)", () => {
  const r = render(async () => {});
  openMenu(r);
  act(() => fire("mousedown", { target: {} }));
  assert.equal(isOpen(r), false);
});

test("closing the menu removes its document listeners", () => {
  const r = render(async () => {});
  openMenu(r);
  act(() => fire("keydown", { key: "Escape", stopPropagation() {} }));
  assert.equal(listeners.get("keydown")?.size ?? 0, 0);
  assert.equal(listeners.get("mousedown")?.size ?? 0, 0);
});
