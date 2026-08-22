import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { Member } from "@weaveforge/core";
import { MemberPicker } from "../ui/member-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderText(members: Member[]): string {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(createElement(MemberPicker, { members, selected: [], onToggle: () => {} }));
  });
  return JSON.stringify(renderer!.toJSON());
}

test("MemberPicker: an empty directory is not a search that missed", () => {
  const text = renderText([]);
  assert.match(text, /Nobody else is in your lab yet/);
  assert.doesNotMatch(text, /No people match/);
});

test("MemberPicker: a lab-mate is listed, and the wording changes back", () => {
  const member = { id: "u1", fullName: "Ada", email: "ada@example.com", role: "phd" } as Member;
  const text = renderText([member]);
  assert.match(text, /Ada/);
  assert.doesNotMatch(text, /Nobody else is in your lab yet/);
});
