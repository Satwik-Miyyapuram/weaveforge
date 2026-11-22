/**
 * 0.9.8 no-account copy has no database, so getDataClient() throws there
 * (lib/parts.ts). Each runtime caller must either be unreachable in no-account
 * mode, or gate itself before it reaches getDataClient().
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

const NO_ACCOUNT_IMPORT = /import \{ isLocalMode \} from "@\/features\/auth\/infrastructure\/no-account-mode";/;

test("workspace folder sync skips the account tables in no-account mode", () => {
  const ws = src("features/workspace/application/workspace-folder.ts");
  assert.match(ws, NO_ACCOUNT_IMPORT);
  assert.match(
    ws,
    /const tableFiles = isLocalMode\(\) \? \{\} : syncTableFolderFiles\(await exportSyncTablesStable\(restTableReader\(getDataClient\(\)\)\)\);/,
  );
});

test("the folder restore refuses in no-account mode before it reaches getDataClient", () => {
  const ws = src("features/workspace/application/workspace-folder.ts");
  assert.match(
    ws,
    /async function liveImportSeams\(\): Promise<ImportSeams> \{\s*if \(isLocalMode\(\)\) throw new Error\("[^"]+"\);\s*const \[/,
  );
});
test("zotero collection listing returns no collections in no-account mode, before getDataClient", () => {
  const zotero = src("integrations/providers/zotero/bibliography-integration.ts");
  assert.match(zotero, NO_ACCOUNT_IMPORT);
  assert.match(
    zotero,
    /if \(!this\.deps\.fetchFn\) \{\s*(?:\/\/[^\n]*\n\s*)?if \(isLocalMode\(\)\) return \[\];\s*const \{ data: sessionData \} = await getDataClient\(\)/,
  );
});

test("the tiered blob store sends no token in no-account mode, so it fails as signed out", () => {
  const store = src("storage/providers/http/http-blob-store.ts");
  assert.match(store, NO_ACCOUNT_IMPORT);
  assert.match(
    store,
    /async function sessionAccessToken\(\): Promise<string \| null> \{\s*(?:\/\/[^\n]*\n\s*)?if \(isLocalMode\(\)\) return null;\s*const \{ data \} = await getDataClient\(\)/,
  );
});

test("org memberships keep their catch in no-account mode, so the getDataClient rejection never escapes", () => {
  // Labs stay null on a failed read. [] would let continueStandalone run, and it provisions an account.
  const startup = src("features/startup/startup-provider.tsx");
  assert.match(startup, /memberships\(\)\.catch\(loggedFallback\("Memberships", null\)\)/);
  const refresh = src("features/org/application/profile-refresh.ts");
  assert.match(refresh, /src\.fetchMemberships\(\)\.catch\(/);
  const org = src("features/org/infrastructure/parts.ts");
  assert.match(org, /await run\(orgSteps\(\)\);/);
  assert.match(org, /return \(await orgSteps\(userId\)\.memberships\(\)\)\.map\(toMembershipView\);/);
});
