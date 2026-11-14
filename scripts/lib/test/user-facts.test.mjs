import assert from "node:assert/strict";
import { test } from "node:test";

import { cardDefs, rustConst, themeLabels } from "../user-facts.mjs";

test("rustConst reads a numeric const, pub or not", () => {
  const src = "const A: f64 = 0.25;\npub const B_LIMIT: usize = 2_000;\n";
  assert.equal(rustConst(src, "A"), 0.25);
  assert.equal(rustConst(src, "B_LIMIT"), 2000);
});

test("rustConst throws when the const is gone, so a rename breaks the docs build", () => {
  assert.throws(() => rustConst("const A: f64 = 1.0;", "B"), /B/);
});

test("cardDefs reads id, name and group in order, and marks the supervisor-only ones", () => {
  const src = `
pub static CARD_REGISTRY: [CardDef; 3] = [
    stat(
        "reading-progress",
        "Reading progress",
        "Progress",
        &["papers"],
    ),
    with_fit(&card(
        "recent-log",
        "Recent log",
        "Activity",
        &["log"],
        PANEL,
    )),
    with_fit(&for_phd(&card(
        "team-roster",
        "Team roster",
        "Team",
        &["supervision"],
        TALL_PANEL,
    ))),
];
`;
  assert.deepEqual(cardDefs(src), [
    { id: "reading-progress", name: "Reading progress", group: "Progress", supervisor: false },
    { id: "recent-log", name: "Recent log", group: "Activity", supervisor: false },
    { id: "team-roster", name: "Team roster", group: "Team", supervisor: true },
  ]);
});

test("cardDefs skips mentions of CARD_REGISTRY before the static itself", () => {
  const src = `//! Ported from the \`CARD_REGISTRY\` data.
const OTHER: [u8; 1] = [
    1,
];
pub static CARD_REGISTRY: [CardDef; 1] = [
    stat("plan-progress", "Plan progress", "Progress", &["plan"]),
];
`;
  assert.deepEqual(cardDefs(src), [
    { id: "plan-progress", name: "Plan progress", group: "Progress", supervisor: false },
  ]);
});

test("cardDefs throws when the registry is missing or empty", () => {
  assert.throws(() => cardDefs("nothing here"), /CARD_REGISTRY/);
  assert.throws(() => cardDefs("pub static CARD_REGISTRY: [CardDef; 0] = [\n];"), /CARD_REGISTRY/);
});

test("themeLabels reads one option list's labels", () => {
  const src = `
export const LIGHT_THEME_OPTIONS: ReadonlyArray<{ id: LightThemeId; label: string }> = [
  { id: "brutal", label: "Poster" },
  { id: "light", label: "Paper" },
];
export const DARK_THEME_OPTIONS: ReadonlyArray<{ id: DarkThemeId; label: string }> = [
  { id: "dark", label: "Slate" },
];
`;
  assert.deepEqual(themeLabels(src, "LIGHT_THEME_OPTIONS"), ["Poster", "Paper"]);
  assert.deepEqual(themeLabels(src, "DARK_THEME_OPTIONS"), ["Slate"]);
  assert.throws(() => themeLabels(src, "OTHER_OPTIONS"), /OTHER_OPTIONS/);
});
