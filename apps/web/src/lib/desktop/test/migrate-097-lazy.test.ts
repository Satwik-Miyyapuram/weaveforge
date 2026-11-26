/**
 * The 0.9.7 exporter (migration writers, file repositories, the Postgres and
 * PostgREST sources) runs once per folder, so it must not ship in the shell
 * every route loads. The layout mounts the gate through a lazy boundary, and
 * the sign-in screens reach the desktop exporter through a dynamic import.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");
const staticImports = (source: string) => [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1] ?? "");

test("the root layout does not import the 0.9.7 gate statically", () => {
  const imports = staticImports(read("app/layout.tsx"));
  assert.equal(imports.includes("@/lib/desktop/migrate-097-web"), false);
  assert.ok(imports.includes("@/lib/desktop/migrate-097-lazy"), "the layout mounts the lazy boundary");
});

test("the lazy boundary loads the web gate with next/dynamic", () => {
  const source = read("lib/desktop/migrate-097-lazy.tsx");
  assert.equal(staticImports(source).some((path) => path.includes("migrate-097-web")), false);
  assert.match(source, /dynamic\(\(\) => import\("\.\/migrate-097-web"\)/);
});

test("the sign-in screens and the gate reach the desktop exporter only through a dynamic import", () => {
  for (const rel of ["features/auth/ui/login-screen.tsx", "features/auth/ui/privacy-disclaimer-gate.tsx", "lib/desktop/migrate-097-gate.tsx", "lib/desktop/desktop-run-export.ts"]) {
    const imports = staticImports(read(rel));
    assert.equal(imports.some((path) => path.endsWith("migrate-097-desktop")), false, `${rel} imports the exporter statically`);
  }
  for (const rel of ["features/auth/ui/login-screen.tsx", "features/auth/ui/privacy-disclaimer-gate.tsx"]) {
    assert.equal(staticImports(read(rel)).some((path) => path.endsWith("migrate-097-gate")), false, `${rel} imports the gate`);
  }
});

test("desktopRunExport loads the exporter only when it runs", async () => {
  const { desktopRunExport } = await import("../desktop-run-export");
  assert.equal(desktopRunExport(null), null);
  assert.equal(typeof desktopRunExport({} as never), "function");
});

test("the app container loads the desktop file backend only inside the shell", () => {
  const source = read("create-app-container.ts");
  assert.equal(staticImports(source).includes("@/container/desktop-file-backend"), false);
  assert.match(source, /await import\("@\/container\/desktop-file-backend"\)/);
});
