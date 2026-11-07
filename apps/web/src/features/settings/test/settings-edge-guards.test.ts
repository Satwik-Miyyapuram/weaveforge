// Guards three settings edge cases: double submit (in-flight ref in useSubmit),
// a failed bibliography collection save (must revert the select and show the error),
// and the AI access modal (Cancel must restore the settings snapshot, not keep edits).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("useSubmit ignores a second submit while the first is in flight", () => {
  const src = readFileSync(new URL("../../../lib/hooks/use-submit.ts", import.meta.url), "utf8");
  assert.match(src, /if \(busyRef\.current\) return false;/);
  assert.match(src, /busyRef\.current = true;/);
  assert.match(src, /finally \{\s*busyRef\.current = false;/);
});

test("saveCollection reverts the select and shows the error when the save fails", () => {
  const src = readFileSync(new URL("../ui/settings-screen.tsx", import.meta.url), "utf8");
  assert.match(
    src,
    /async function saveCollection\(key: string\) \{\s*const previous = projectCollection;[\s\S]*?catch \(err\) \{\s*(?:\/\/.*\n\s*)?setProjectCollection\(previous\);\s*setError\(formatError\(err\)\);/,
  );
});

test("AI access modal Cancel and Escape restore the settings snapshot taken on open", () => {
  const src = readFileSync(new URL("../ui/settings-screen.tsx", import.meta.url), "utf8");
  assert.match(src, /const aiAccessSnapshot = useRef<UserSettings \| null>\(null\);/);
  assert.match(src, /function openAiAccess\(\) \{\s*aiAccessSnapshot\.current = settings;/);
  assert.match(
    src,
    /function cancelAiAccess\(\) \{\s*if \(aiAccessSnapshot\.current\) setSettings\(aiAccessSnapshot\.current\);\s*setAiAccessOpen\(false\);/,
  );
  assert.match(src, /onClick=\{\(\) => openAiAccess\(\)\}/);
  assert.match(src, /onClose=\{\(\) => !busy && cancelAiAccess\(\)\}/);
  assert.match(src, /variant="cancel" onClick=\{\(\) => cancelAiAccess\(\)\}/);
});
