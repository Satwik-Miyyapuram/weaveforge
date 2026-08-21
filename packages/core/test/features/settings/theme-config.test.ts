import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseThemeConfig,
  normalizeThemeConfig,
  themeConfigTemplate,
  THEME_CONFIG_MAX_BYTES,
} from "../../../src/index.js";

function config(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, name: "T", mode: "dark", ...overrides });
}

test("accepts the shipped template", () => {
  const { config: parsed, errors } = parseThemeConfig(themeConfigTemplate());
  assert.deepEqual(errors, []);
  assert.ok(parsed);
  assert.equal(parsed.vars["--bg"], "#0b0d12");
  assert.equal(parsed.vars["--radius-chip"], "999px");
  assert.equal(parsed.reactiveMotion, true);
});

test("normalizes hex case and accepts numeric rgb()", () => {
  const { config: parsed } = parseThemeConfig(
    config({ colors: { bg: "#AABBCC", surface: "rgba(10, 20, 30, 0.5)" } }),
  );
  assert.equal(parsed?.vars["--bg"], "#aabbcc");
  assert.equal(parsed?.vars["--surface"], "rgba(10, 20, 30, 0.5)");
});

test("rejects a color carrying CSS syntax", () => {
  for (const hostile of [
    "red; background: url(https://evil.test/x)",
    "var(--accent)",
    "url(javascript:alert(1))",
    "#fff} .card { display: none",
    "expression(alert(1))",
  ]) {
    const { config: parsed, errors } = parseThemeConfig(config({ colors: { bg: hostile } }));
    assert.equal(parsed, null, `accepted hostile color: ${hostile}`);
    assert.match(errors[0], /^colors\.bg:/);
  }
});

test("rejects an unknown key rather than ignoring it", () => {
  assert.equal(parseThemeConfig(config({ colors: { nope: "#fff" } })).config, null);
  assert.equal(parseThemeConfig(config({ somethingElse: 1 })).config, null);
});

test("rejects a prototype-polluting payload", () => {
  const payload = '{"version":1,"colors":{"__proto__":{"polluted":true}}}';
  const { config: parsed, errors } = parseThemeConfig(payload);
  assert.equal(parsed, null);
  assert.match(errors[0], /reserved key/);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("rejects oversized input before parsing", () => {
  const huge = `{"version":1,"name":"${"a".repeat(THEME_CONFIG_MAX_BYTES)}"}`;
  const { config: parsed, errors } = parseThemeConfig(huge);
  assert.equal(parsed, null);
  assert.match(errors[0], /larger than/);
});

test("rejects non-JSON, arrays and empty input", () => {
  assert.equal(parseThemeConfig("not json").config, null);
  assert.equal(parseThemeConfig("[1,2,3]").config, null);
  assert.equal(parseThemeConfig("   ").config, null);
});

test("font stacks are re-quoted from the parsed family names", () => {
  const { config: parsed } = parseThemeConfig(
    config({ fonts: { sans: "  IBM Plex Sans , system-ui,sans-serif " } }),
  );
  assert.equal(parsed?.vars["--font-sans"], '"IBM Plex Sans", system-ui, sans-serif');
});

test("rejects a font stack that smuggles an import or too many families", () => {
  assert.equal(parseThemeConfig(config({ fonts: { sans: "@import url(x)" } })).config, null);
  assert.equal(parseThemeConfig(config({ fonts: { sans: "a,b,c,d,e,f" } })).config, null);
});

test("radius accepts bounded lengths and rejects the rest", () => {
  assert.equal(parseThemeConfig(config({ radius: { card: 12 } })).config?.vars["--radius-card"], "12px");
  assert.equal(parseThemeConfig(config({ radius: { card: "1.5rem" } })).config?.vars["--radius-card"], "1.5rem");
  assert.equal(parseThemeConfig(config({ radius: { card: "-4px" } })).config, null);
  assert.equal(parseThemeConfig(config({ radius: { card: "calc(1px + 2px)" } })).config, null);
});

test("motion scale is range-checked", () => {
  assert.equal(parseThemeConfig(config({ motion: { scale: 1.5 } })).config?.motionScale, 1.5);
  assert.equal(parseThemeConfig(config({ motion: { scale: 40 } })).config, null);
  assert.equal(parseThemeConfig(config({ motion: { reactive: "yes" } })).config, null);
});

test("surfaces defaults to borderless and only takes the two values", () => {
  assert.equal(parseThemeConfig(config()).config?.surfaces, "borderless");
  assert.equal(parseThemeConfig(config({ surfaces: "bordered" })).config?.surfaces, "bordered");
  assert.equal(parseThemeConfig(config({ surfaces: "none" })).config, null);
});

test("a wrong version is rejected outright", () => {
  assert.equal(parseThemeConfig(config({ version: 2 })).config, null);
});

test("stored configs are re-validated, not trusted", () => {
  const good = parseThemeConfig(themeConfigTemplate()).config;
  assert.ok(normalizeThemeConfig(good));
  assert.equal(
    normalizeThemeConfig({ ...good, vars: { "--bg": "red; content: url(x)" } }),
    null,
  );
  assert.equal(normalizeThemeConfig("nope"), null);
  assert.equal(normalizeThemeConfig(null), null);
});
