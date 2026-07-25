import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { bootstrapSession } from "./helpers/auth.js";
import { e2eEnabled, e2eUserA } from "./helpers/env.js";
import { ensurePaperExists } from "./helpers/papers.js";

// The Supabase auth storage state alone cannot restore the session-only
// encryption key. Begin clean and run the real login/unlock flow per test.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("AI & MCP access", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (!e2eEnabled()) testInfo.skip(true, "Set THESIS_TRACKER_* env vars for both users");
    const user = e2eUserA();
    await bootstrapSession(page, user.email, user.password);
  });

  test("requires an explicit opt-in and exposes scoped connection controls", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: /AI assistant access/i }).click();

    await expect(page.getByRole("heading", { name: "AI & MCP access" })).toBeVisible();
    const toggle = page.getByRole("switch", { name: "Enable AI assistant access" });
    if (await toggle.getAttribute("aria-checked") === "false") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await expect(page.getByRole("heading", { name: "Allow reading" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Allow proposals" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create MCP token" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start access for 0 sources" })).toBeDisabled();

    await page.getByRole("button", { name: "Save AI access" }).click();
    await expect(page.getByRole("heading", { name: "AI & MCP access" })).not.toBeVisible();
    await expect(page.locator(".ai-access-launcher .status")).toHaveText("Enabled");
  });

  test("executes an approved encrypted relay read and stops after revocation", async ({ page, request }) => {
    const browserRelayResponses: string[] = [];
    const browserRelayClaimCounts: number[] = [];
    const browserRelayPatchStatuses: string[] = [];
    const browserRelaySessions = new Set<string>();
    let browserRelayToken: string | null = null;
    page.on("request", (browserRequest) => {
      if (!browserRequest.url().includes("/api/mcp/relay/browser")) return;
      const session = new URL(browserRequest.url()).searchParams.get("sessionId");
      if (session) browserRelaySessions.add(session);
      browserRelayToken = browserRequest.headers()["authorization"]?.replace(/^Bearer\s+/i, "") ?? null;
    });
    page.on("response", async (response) => {
      if (response.url().includes("/api/mcp/relay/browser")) {
        browserRelayResponses.push(String(response.status()));
        const payload = await response.json().catch(() => null) as { requests?: unknown[] } | null;
        browserRelayClaimCounts.push(payload?.requests?.length ?? -1);
      }
      if (response.url().endsWith("/api/mcp/relay") && response.request().method() === "PATCH") browserRelayPatchStatuses.push(String(response.status()));
    });
    await ensurePaperExists(page, "E2E MCP Privacy Test Paper");
    await page.goto("/settings");
    await page.getByRole("button", { name: /AI assistant access/i }).click();

    const accessToggle = page.getByRole("switch", { name: "Enable AI assistant access" });
    if (await accessToggle.getAttribute("aria-checked") === "false") await accessToggle.click();
    const metadata = page.getByRole("checkbox", { name: "Paper metadata and links" }).first();
    if (!(await metadata.isChecked())) await metadata.check();
    await page.getByLabel("Source access mode").click();
    await page.getByRole("option", { name: "All enabled categories" }).click();

    const start = page.getByRole("button", { name: /^Start access for \d+ source/ });
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.click();
    const connection = page.locator(".ai-connection-details");
    await expect(connection).toBeVisible();

    const sessionValue = connection.locator(".ai-connection-value").filter({ hasText: "Session ID" });
    const sessionId = await sessionValue.locator("code").innerText();
    const secretValue = connection.locator(".ai-connection-value").filter({ hasText: "Pairing secret" });
    const secret = await readPersistedSecret(page, sessionId);
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secret).toHaveLength(64);
    expect(await secretValue.innerText()).not.toContain(secret);
    await expect(secretValue).toContainText("••••");
    expect(await page.evaluate(() => sessionStorage.getItem("tt:mcp:sessions-wrapped") ?? "")).not.toContain(secret);
    await expect.poll(() => browserRelayToken, { timeout: 10_000 }).not.toBeNull();
    await expect.poll(() => browserRelaySessions.has(sessionId), { timeout: 10_000 }).toBe(true);

    const first = await request.post("/api/mcp/relay", {
      headers: { Authorization: `Bearer ${browserRelayToken}` },
      data: { sessionId, envelope: seal(secret, { tool: "get_workspace_outline", arguments: {} }) },
    });
    expect(first.status()).toBe(201);
    const id = (await first.json() as { request: { id: string } }).request.id;
    const completed = await waitForRelay(request, browserRelayToken!, id, browserRelayResponses, sessionId, browserRelaySessions, browserRelayClaimCounts, browserRelayPatchStatuses);
    expect(completed.status).toBe("complete");
    expect(open(secret, completed.response_enc!)).toEqual(expect.any(Array));

    await page.getByRole("button", { name: "Revoke now" }).first().click();
    const afterRevoke = await request.post("/api/mcp/relay", {
      headers: { Authorization: `Bearer ${browserRelayToken}` },
      data: { sessionId, envelope: seal(secret, { tool: "get_workspace_outline", arguments: {} }) },
    });
    expect(afterRevoke.status()).toBe(201);
    const revokedId = (await afterRevoke.json() as { request: { id: string } }).request.id;
    await page.waitForTimeout(2_500);
    const pending = await request.get(`/api/mcp/relay?id=${encodeURIComponent(revokedId)}`, { headers: { Authorization: `Bearer ${browserRelayToken}` } });
    expect((await pending.json() as { request: { status: string } }).request.status).toBe("pending");
  });

  test("stops a live relay when the user signs out", async ({ page, request }) => {
    await ensurePaperExists(page, "E2E MCP Privacy Test Paper");
    await page.goto("/settings");
    await page.getByRole("button", { name: /AI assistant access/i }).click();
    const accessToggle = page.getByRole("switch", { name: "Enable AI assistant access" });
    if (await accessToggle.getAttribute("aria-checked") === "false") await accessToggle.click();
    const metadata = page.getByRole("checkbox", { name: "Paper metadata and links" }).first();
    if (!(await metadata.isChecked())) await metadata.check();
    await page.getByLabel("Source access mode").click();
    await page.getByRole("option", { name: "All enabled categories" }).click();
    const start = page.getByRole("button", { name: /^Start access for \d+ source/ });
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.click();
    const connection = page.locator(".ai-connection-details");
    await expect(connection).toBeVisible();
    const sessionValue = connection.locator(".ai-connection-value").filter({ hasText: "Session ID" });
    const sessionId = await sessionValue.locator("code").innerText();
    const secretValue = connection.locator(".ai-connection-value").filter({ hasText: "Pairing secret" });
    const secret = await readPersistedSecret(page, sessionId);
    const accessToken = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) => candidate.includes("auth-token"));
      const value = key ? JSON.parse(localStorage.getItem(key) ?? "null") as { access_token?: string } | null : null;
      return value?.access_token ?? null;
    });
    expect(accessToken).toBeTruthy();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "AI & MCP access" })).not.toBeVisible();
    await page.locator("button.signout").click();
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible({ timeout: 30_000 });
    const afterSignOut = await request.post("/api/mcp/relay", {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { sessionId, envelope: seal(secret, { tool: "get_workspace_outline", arguments: {} }) },
    });
    if (afterSignOut.status() === 201) {
      const id = (await afterSignOut.json() as { request: { id: string } }).request.id;
      await page.waitForTimeout(2_500);
      const poll = await request.get(`/api/mcp/relay?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      expect((await poll.json() as { request: { status: string } }).request.status).toBe("pending");
    } else {
      expect(afterSignOut.status()).toBe(401);
    }
  });
});

type Envelope = { iv: string; ciphertext: string };
function key(secret: string) { return pbkdf2Sync(secret, "thesis-tracker-mcp-v1", 100_000, 32, "sha256"); }
function seal(secret: string, value: unknown): Envelope { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(secret), iv); const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]); return { iv: iv.toString("base64"), ciphertext: Buffer.concat([data, cipher.getAuthTag()]).toString("base64") }; }
function open(secret: string, envelope: Envelope): unknown { const raw = Buffer.from(envelope.ciphertext, "base64"); const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(envelope.iv, "base64")); decipher.setAuthTag(raw.subarray(-16)); return JSON.parse(Buffer.concat([decipher.update(raw.subarray(0, -16)), decipher.final()]).toString("utf8")); }
async function waitForRelay(request: import("@playwright/test").APIRequestContext, token: string, id: string, browserRelayResponses: readonly string[] = [], sessionId?: string, browserRelaySessions: ReadonlySet<string> = new Set(), browserRelayClaimCounts: readonly number[] = [], browserRelayPatchStatuses: readonly string[] = []): Promise<{ status: string; response_enc?: Envelope }> { let lastStatus = "unknown"; for (let attempt = 0; attempt < 60; attempt++) { const response = await request.get(`/api/mcp/relay?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } }); const payload = await response.json() as { request: { status: string; response_enc?: Envelope } }; lastStatus = payload.request.status; if (lastStatus === "complete") return payload.request; await new Promise((resolve) => setTimeout(resolve, 500)); } const manualClaim = sessionId ? await request.get(`/api/mcp/relay/browser?sessionId=${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${token}` } }) : null; const claimed = manualClaim ? (await manualClaim.json() as { requests?: unknown[] }).requests?.length ?? 0 : 0; throw new Error(`Timed out waiting for the browser relay response (request: ${lastStatus}; browser sessions: ${[...browserRelaySessions].join(", ") || "none"}; poll responses: ${browserRelayResponses.join(", ") || "none"}; poll claim counts: ${browserRelayClaimCounts.join(", ") || "none"}; PATCH statuses: ${browserRelayPatchStatuses.join(", ") || "none"}; manual claims: ${claimed}).`); }

async function readPersistedSecret(page: import("@playwright/test").Page, sessionId: string): Promise<string> {
  await expect.poll(
    () => page.evaluate(() => Boolean(sessionStorage.getItem("tt:mcp:sessions-wrapped"))),
    { timeout: 10_000 },
  ).toBe(true);
  return page.evaluate(async (id) => {
    const raw = sessionStorage.getItem("tt:mcp:sessions-wrapped");
    if (!raw) throw new Error("Missing encrypted MCP session record.");
    const record = JSON.parse(raw) as { iv: string; ct: string };
    const bytes = (base64: string) => Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("tt-mcp-wrapkey", 1);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const key = await new Promise<CryptoKey>((resolve, reject) => {
      const get = db.transaction("keys", "readonly").objectStore("keys").get("session-wrap-key");
      get.onsuccess = () => resolve(get.result as CryptoKey);
      get.onerror = () => reject(get.error);
    });
    db.close();
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(record.iv) }, key, bytes(record.ct));
    const sessions = JSON.parse(new TextDecoder().decode(plain)) as Array<{ session: { grant: { id: string } }; secret: string }>;
    const secret = sessions.find((item) => item.session.grant.id === id)?.secret;
    if (!secret) throw new Error("Missing pairing secret for active MCP session.");
    return secret;
  }, sessionId);
}
