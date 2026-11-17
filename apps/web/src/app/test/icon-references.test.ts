/**
 * Every icon a manifest, page, shell or store listing points at must exist on
 * disk. A renamed or deleted raster otherwise fails silently: the browser or
 * the store just shows a blank icon. This reads each reference from its source
 * file and fails with the full list of missing paths.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../../../", import.meta.url));
const repoRoot = path.resolve(webRoot, "../..");
const publicDir = path.join(webRoot, "public");
const read = (abs: string) => readFileSync(abs, "utf8");
const rel = (abs: string) => path.relative(repoRoot, abs).split(path.sep).join("/");

type Ref = { from: string; target: string };
const refs: Ref[] = [];
const add = (from: string, target: string) => refs.push({ from, target });

// Origin-relative URLs ("/icons/x.png") resolve against apps/web/public.
const addPublic = (from: string, url: string) => add(from, path.join(publicDir, url.replace(/^\//, "")));

// Web app manifest and the TWA copy of it.
const manifest = path.join(publicDir, "manifest.webmanifest");
for (const icon of JSON.parse(read(manifest)).icons as { src: string }[]) addPublic(rel(manifest), icon.src);
const twaManifest = path.join(webRoot, "twa/app/src/main/res/raw/web_app_manifest.json");
for (const icon of JSON.parse(read(twaManifest)).icons as { src: string }[]) addPublic(rel(twaManifest), icon.src);

// TWA store listing URLs point at the deployed origin, so map them to public/.
const twaConfig = path.join(webRoot, "twa/twa-manifest.json");
const twaJson = JSON.parse(read(twaConfig)) as Record<string, string>;
for (const key of ["iconUrl", "maskableIconUrl"]) {
  const url = new URL(twaJson[key] ?? "");
  addPublic(rel(twaConfig), url.pathname);
}

// Page metadata and the offline page.
const layout = path.join(webRoot, "src/app/layout.tsx");
for (const m of read(layout).matchAll(/"(\/icons\/[^"]+)"/g)) addPublic(rel(layout), m[1] ?? "");
const offline = path.join(publicDir, "offline.html");
for (const m of read(offline).matchAll(/"(\/icons\/[^"]+)"/g)) addPublic(rel(offline), m[1] ?? "");

// Service-worker precache list, written relative to public/.
const nextConfig = path.join(webRoot, "next.config.mjs");
for (const m of read(nextConfig).matchAll(/"(icons\/[^"]+)"/g)) addPublic(rel(nextConfig), `/${m[1]}`);

// Desktop shell, relative to apps/shell.
const tauri = path.join(repoRoot, "apps/shell/tauri.conf.json");
const tauriIcons = (JSON.parse(read(tauri)).bundle as { icon: string[] }).icon;
for (const icon of tauriIcons) add(rel(tauri), path.join(repoRoot, "apps/shell", icon));

// iOS asset catalogue: filenames are relative to the appiconset folder.
const iosSet = path.join(repoRoot, "apps/ios/WeaveForge/Assets.xcassets/AppIcon.appiconset");
const iosContents = path.join(iosSet, "Contents.json");
for (const img of JSON.parse(read(iosContents)).images as { filename?: string }[]) {
  if (img.filename) add(rel(iosContents), path.join(iosSet, img.filename));
}

// Android: every @mipmap/ and @drawable/ the manifests use needs a file in some
// density folder of the module's res directory.
for (const appModule of ["apps/android/app", "apps/web/twa/app"]) {
  const manifestPath = path.join(repoRoot, appModule, "src/main/AndroidManifest.xml");
  const res = path.join(repoRoot, appModule, "src/main/res");
  for (const m of read(manifestPath).matchAll(/@(mipmap|drawable)\/([A-Za-z0-9_]+)/g)) {
    const [, kind, name] = m;
    const folders = readdirSync(res).filter((d) => d.startsWith(`${kind}-`));
    const hit = folders
      .flatMap((d) => readdirSync(path.join(res, d)).map((f) => path.join(res, d, f)))
      .find((f) => path.basename(f, path.extname(f)) === name);
    // Unresolved names keep a non-existent target so the assert below reports them.
    add(rel(manifestPath), hit ?? path.join(res, `${kind}-*`, `${name}`));
  }
}

test("every referenced icon exists on disk", () => {
  assert.ok(refs.length >= 15, `expected at least 15 icon references, found ${refs.length}`);
  const missing = refs.filter((r) => !existsSync(r.target));
  assert.deepEqual(
    missing.map((r) => `${r.from} -> ${rel(r.target)}`),
    [],
    "referenced icons missing on disk",
  );
});
