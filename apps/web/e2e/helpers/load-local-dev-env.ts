import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Load gitignored local app/test-account env files into process.env (no overwrite). */
export function loadLocalDevEnv(repoRoot?: string) {
  const root = repoRoot ?? resolve(process.cwd(), "../..");
  const paths = [
    resolve(root, "apps/web/.env.local"),
    resolve(root, ".env.local"),
    resolve(root, "local-dev/test-accounts.env"),
  ];
  let loaded = false;

  for (const path of paths) {
    if (!existsSync(path)) continue;
    loaded = true;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      const val = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (val === "") continue;
      if (!process.env[key]) process.env[key] = val;
    }
  }

  const pw = process.env.TEST_ACCOUNT_PASSWORD?.trim();
  if (pw) {
    if (!process.env.E2E_TEST_PASSWORD) process.env.E2E_TEST_PASSWORD = pw;
    if (!process.env.TT_A_PASSWORD) process.env.TT_A_PASSWORD = pw;
    if (!process.env.TT_B_PASSWORD) process.env.TT_B_PASSWORD = pw;
    if (!process.env.WEAVEFORGE_PASSWORD) process.env.WEAVEFORGE_PASSWORD = pw;
    if (!process.env.WEAVEFORGE_B_PASSWORD) process.env.WEAVEFORGE_B_PASSWORD = pw;
    if (!process.env.DEMO_CLIP_PASSWORD) process.env.DEMO_CLIP_PASSWORD = pw;
  }

  return loaded;
}
