#!/usr/bin/env node
/**
 * The Android privilege posture, enforced instead of described.
 *
 * ## Why this gate exists
 *
 * The symptom that produced it is real and well known: with an accessibility
 * service and/or a device administrator enabled for some app, UPI and banking
 * apps refuse to open, refuse to draw their PIN pad, or show "for your security,
 * turn off screen overlay". It is **not** coming from this tree — the module
 * holds two Kotlin classes and one `INTERNET` permission — and that is exactly
 * why it needs a gate rather than a comment. The wrong attribution produces the
 * wrong fix: if the cause is assumed to be WeaveForge and the app is
 * "de-permissioned", nothing changes on the device and the payment app is still
 * broken. What this file protects is the other direction — that this app can
 * never *become* the cause.
 *
 * Android's own lint names untrusted content in a WebView that has a JS
 * interface as the most common WebView vulnerability, and Play policy treats a
 * restricted `Accessibility` declaration as a reviewed capability. Every one of
 * the capabilities below is a whole-device or per-window authority; the
 * asymmetry matters, because the damage lands on the *other* application.
 * A payment app under an overlay window or behind an accessibility service keeps
 * working perfectly while the payment app does not.
 *
 * ## What it checks
 *
 * 1. `AndroidManifest.xml` names no permission, service or receiver outside
 *    `ALLOWED_PERMISSIONS` / `ALLOWED_COMPONENTS`. The list is the *decision*:
 *    adding to it is a visible edit to this file, which is the point.
 * 2. The manifest declares no `android:permission` binding a component into a
 *    system service (the `BIND_*` family), and no `accessibility-service` meta.
 * 3. No Kotlin or Java source references a symbol that would *acquire* one of
 *    those capabilities. This is the half that catches the change that matters —
 *    the manifest entry and the code that uses it arrive together, but a stray
 *    `WindowManager.LayoutParams` or a `DevicePolicyManager` call is where an
 *    overlay or an admin action actually starts.
 *
 * Comments are stripped before either scan, so the long explanations in the
 * sources do not trip their own guard. A hit is reported with its file, line and
 * the exact token, and the failure message says what to do about it: this repo's
 * gates are instructions, not just verdicts.
 *
 * See also: WF-X01…WF-X08 in `docs/plans/current/audit_2.md` and the verdict
 * ledger in `docs/plans/current/audit_2_verification.md`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = path.join(root, "apps", "android");
const manifestPath = path.join(androidDir, "app", "src", "main", "AndroidManifest.xml");

/**
 * The permissions this app may hold, each with the reason it is acceptable.
 *
 * Anything not on this list fails. `INTERNET` is the entire native surface: the
 * shell is a WebView around the web app, and nothing else in the module reaches
 * the network.
 */
const ALLOWED_PERMISSIONS = new Map([
  ["android.permission.INTERNET", "the WebView loads the web app"],
]);

/** The components this app may declare, with the reason each is acceptable. */
const ALLOWED_COMPONENTS = new Map([
  ["activity", "the single launcher activity that hosts the WebView and the ink surface"],
]);

/**
 * Tokens that must never appear in a source file: the APIs that acquire a
 * device-wide or cross-application authority.
 *
 * Deliberately a substring list rather than a parse. `TYPE_APPLICATION_OVERLAY`
 * catches the window-type constant and the `TYPE_` family is not enumerated
 * because there are a dozen legacy aliases for the same window and naming them
 * all is how a list becomes wrong; the concrete modern spelling plus
 * `LayoutParams.TYPE_` covers the shapes an implementation actually uses.
 */
const FORBIDDEN_SOURCE_TOKENS = [
  "AccessibilityService",
  "accessibilityServiceInfo",
  "BIND_ACCESSIBILITY_SERVICE",
  "DeviceAdminReceiver",
  "DevicePolicyManager",
  "BIND_DEVICE_ADMIN",
  "SYSTEM_ALERT_WINDOW",
  "MANAGE_OVERLAY_PERMISSION",
  "canDrawOverlays",
  "TYPE_APPLICATION_OVERLAY",
  "LayoutParams.TYPE_",
  "MediaProjection",
  "createScreenCaptureIntent",
  "FOREGROUND_SERVICE",
  "RECEIVE_BOOT_COMPLETED",
  "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
];

/** Directories that are build output or tooling, never a source of truth. */
const SKIP_DIRS = new Set(["build", ".gradle", ".idea", "gradle", "wrapper"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(kt|java|xml)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Strip comments, leaving line structure intact.
 *
 * Line numbers are the whole value of a failure message here, so the newlines
 * inside a removed block comment are kept. `//` removal is skipped on a line
 * whose first non-space run looks like a URL scheme (`https://…` inside a string
 * literal) — the sources carry no such literal today, but a naive strip would
 * silently truncate one, and a gate that edits the evidence is worse than one
 * that reports a false positive.
 */
function withoutComments(source) {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
  return noBlocks
    .split("\n")
    .map((line) => {
      if (/^\s*https?:\/\//.test(line)) return line;
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

const problems = [];

function fail(message) {
  problems.push(message);
}

// --------------------------------------------------------- 1. the manifest

let manifest;
try {
  manifest = withoutComments(readFileSync(manifestPath, "utf8"));
} catch (err) {
  console.error(`check:android-permissions — cannot read ${manifestPath}: ${err.message}`);
  process.exit(1);
}

const declarers = [
  ...manifest.matchAll(/<uses-permission[^>]*android:name\s*=\s*"([^"]+)"/g),
].map((m) => m[1]);
for (const permission of declarers) {
  if (!ALLOWED_PERMISSIONS.has(permission)) {
    fail(
      `AndroidManifest.xml declares <uses-permission android:name="${permission}" />, which is not on the allow-list.`,
    );
  }
}

const components = [...manifest.matchAll(/<(activity|service|receiver|provider)\b([^>]*)>/g)];
for (const [, kind, attrs] of components) {
  if (!ALLOWED_COMPONENTS.has(kind)) {
    fail(
      `AndroidManifest.xml declares a <${kind}> component. Only ${[...ALLOWED_COMPONENTS.keys()].join(", ")} may exist in this module.`,
    );
  }
  const binding = /android:permission\s*=\s*"([^"]+)"/.exec(attrs ?? "");
  if (binding) {
    fail(
      `AndroidManifest.xml binds <${kind}> to android:permission="${binding[1]}". A BIND_* permission is how an app is granted system-wide authority.`,
    );
  }
}

for (const token of FORBIDDEN_SOURCE_TOKENS) {
  if (manifest.includes(token)) {
    fail(`AndroidManifest.xml mentions "${token}".`);
  }
}

// ----------------------------------------------------------- 2. the sources

for (const file of walk(androidDir)) {
  if (path.resolve(file) === path.resolve(manifestPath)) continue;
  const relative = path.relative(root, file).split(path.sep).join("/");
  const lines = withoutComments(readFileSync(file, "utf8")).split("\n");
  lines.forEach((line, index) => {
    for (const token of FORBIDDEN_SOURCE_TOKENS) {
      if (line.includes(token)) {
        fail(`${relative}:${index + 1} uses "${token}": ${line.trim()}`);
      }
    }
  });
}

// --------------------------------------------------------------- 3. verdict

if (problems.length > 0) {
  console.error("check:android-permissions failed.\n");
  for (const problem of problems) console.error(`  • ${problem}`);
  console.error(
    [
      "",
      "This gate exists because the reported symptom — banking and UPI apps refusing to",
      "open, or refusing to draw a PIN pad — has been attributed to this app more than",
      "once, and it is not the cause. See WF-X01 in docs/plans/current/audit_2.md.",
      "",
      "If the change above is genuinely intended, the containment rules are:",
      "  • an accessibility service denies the payment packages on the FIRST line of",
      "    onAccessibilityEvent, sets no key-filter or interactive-window flag, and never",
      "    keeps the accessibility node tree (WF-X03);",
      "  • device admin is not added at all — notes are protected with the platform",
      "    keystore, which is the whole requirement (WF-X04);",
      "  • the ink surface never becomes a system overlay; if a floating surface is ever",
      "    required it must be FLAG_NOT_TOUCHABLE and removed in onPause (WF-X02);",
      "  • screen capture targets the ink surface, never the display (WF-X05).",
      "",
      "Then add the capability to ALLOWED_PERMISSIONS or ALLOWED_COMPONENTS in",
      "scripts/check-android-permissions.mjs with its reason, so the decision is recorded",
      "in the diff that makes it.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `check:android-permissions passed (${declarers.length} permission(s), ${components.length} component(s), ${FORBIDDEN_SOURCE_TOKENS.length} tokens).`,
);
