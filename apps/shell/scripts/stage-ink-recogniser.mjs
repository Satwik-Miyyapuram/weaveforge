// Copies the Windows Ink helper into the Tauri stage so the installer ships it.
// Why: Tauri's resources map target/stage/native/ -> native/, and apps/shell/src/ink.rs
// (ink_recogniser_path) looks in <resources>/native/ink-recogniser/win-<arch>/ink-recogniser.exe.
// Usage: node apps/shell/scripts/stage-ink-recogniser.mjs <stage-dir> [--arch=x64|arm64]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ARCHES = ["x64", "arm64"];

/**
 * Copies `<nativeRoot>/ink-recogniser/win-<arch>/` to `<stageDir>/native/ink-recogniser/win-<arch>/`.
 * @param {string} nativeRoot the `apps/shell/native` directory
 * @param {string} stageDir the Tauri stage directory
 * @param {string} arch `x64` or `arm64`
 * @returns {string} the destination directory
 */
export function stageInkRecogniser(nativeRoot, stageDir, arch) {
  const src = inkSourceDir(nativeRoot, arch);
  const dest = path.join(stageDir, "native", "ink-recogniser", `win-${arch}`);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

/** Throws unless `<nativeRoot>/ink-recogniser/win-<arch>/ink-recogniser.exe` exists. */
function inkSourceDir(nativeRoot, arch) {
  const src = path.join(nativeRoot, "ink-recogniser", `win-${arch}`);
  if (!fs.existsSync(path.join(src, "ink-recogniser.exe"))) {
    throw new Error(`ink-recogniser.exe missing in ${src}; run build-ink-recogniser.mjs first`);
  }
  return src;
}

/**
 * The helpers an installer for `targetArch` must carry. An ARM64 installer also
 * carries the x64 helper: ink.rs (`ink_recogniser_path`) falls back to it when
 * the native one is absent, so both are required for it to ship usable.
 * @param {string} targetArch `x64` or `arm64`
 * @returns {string[]}
 */
export function inkArchesForBundle(targetArch) {
  return targetArch === "arm64" ? ["arm64", "x64"] : [targetArch];
}

/**
 * Stages every helper `inkArchesForBundle(targetArch)` names. Every source is
 * checked before anything is copied, so a missing fallback leaves no partial stage.
 * @returns {string[]} the destination directories
 */
export function stageInkForBundle(nativeRoot, stageDir, targetArch) {
  const arches = inkArchesForBundle(targetArch);
  for (const arch of arches) inkSourceDir(nativeRoot, arch);
  return arches.map((arch) => stageInkRecogniser(nativeRoot, stageDir, arch));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const archArg = args.find((a) => a.startsWith("--arch="));
  const arch = archArg ? archArg.slice("--arch=".length) : "x64";
  const stageDir = args.find((a) => !a.startsWith("--"));
  if (!stageDir) {
    console.error("usage: stage-ink-recogniser.mjs <stage-dir> [--arch=x64|arm64]");
    process.exit(1);
  }
  if (!ARCHES.includes(arch)) {
    console.error(`unsupported --arch=${arch}; expected x64 or arm64`);
    process.exit(1);
  }
  const nativeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "native");
  try {
    for (const dest of stageInkForBundle(nativeRoot, path.resolve(stageDir), arch)) {
      console.log(`staged ink recogniser -> ${dest}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
