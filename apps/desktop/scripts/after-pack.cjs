/**
 * What runs between packing the app and making its installer, per platform.
 *
 * - Windows: `stamp-exe.cjs` puts the app's icon and name into the exe.
 * - macOS: an ad-hoc signature (`codesign --sign -`).
 *
 * The macOS build has no Apple Developer ID behind it — that costs a yearly
 * fee this project does not pay — so electron-builder's own signing is off
 * (`mac.identity: null`). But an app with *no* signature at all does not run
 * on Apple Silicon: packing rewrites Electron's Info.plist, which breaks the
 * signature Electron shipped with, and macOS then calls the app "damaged"
 * rather than offering to open it. An ad-hoc signature is free, needs no
 * certificate, and turns that into the ordinary first-launch prompt for an
 * app from an unidentified developer (System Settings → Privacy & Security →
 * Open Anyway). It proves nothing about who built the app, and is not
 * presented as if it did.
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const { Arch } = require("builder-util");
const stampExe = require("./stamp-exe.cjs").default;

const universalTarget = (context) =>
  [].concat(context.packager.config.mac?.target ?? []).some((t) => [].concat(t?.arch ?? []).includes("universal"));

exports.default = async function afterPack(context) {
  if (context.electronPlatformName === "win32") return stampExe(context);
  if (context.electronPlatformName !== "darwin") return;
  // Universal build: the x64 and arm64 halves are packed first and merged after;
  // signing a half makes their files differ and the merge refuses.
  if (context.arch !== Arch.universal && universalTarget(context)) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
};
