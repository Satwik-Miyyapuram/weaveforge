import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { DesktopLocalApi } from "@/lib/desktop/desktop-bridge";
import { McpClients } from "../ui/mcp-clients";

const launch = { command: "C:\\Apps\\WeaveForge.exe", args: ["C:\\h\\.weaveforge\\mcp\\weaveforge-mcp.mjs"], env: { ELECTRON_RUN_AS_NODE: "1" } };
const off: DesktopLocalApi = {
  enabled: true,
  url: "http://127.0.0.1:27123",
  tokens: [],
  mcp: { connected: false, url: "http://127.0.0.1:27123/mcp", launch },
};
const on: DesktopLocalApi = {
  ...off,
  tokens: [
    {
      id: "t1",
      name: "AI clients",
      prefix: "wf_ab",
      permissions: ["mcp:read", "mcp:suggest", "experiments"],
      createdAt: "2026-10-01T10:00:00Z",
      expiresAt: null,
    },
  ],
  mcp: { ...off.mcp!, connected: true, tokenId: "t1" },
};

const render = (state: DesktopLocalApi, initialTab?: "codex") =>
  renderToStaticMarkup(createElement(McpClients, { state, onChange() {}, initialTab }));
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("McpClients", () => {
  it("not connected: one Connect, no client tabs", () => {
    const html = render(off);
    assert.match(html, /mcp-pill"[^>]*>Not connected</);
    assert.match(html, />Connect<\/button>/);
    assert.doesNotMatch(html, /role="tablist"/);
    assert.doesNotMatch(html, /Disconnect/);
  });

  it("connected: permission chips, token line, seven tabs, Claude Code commands", () => {
    const html = render(on);
    assert.match(html, /mcp-pill on"[^>]*>Connected</);
    assert.deepEqual([...html.matchAll(/<div class="mcp-perm">(.*?)<\/div>/g)].map((m) => text(m[1]!)), ["read & searchdraftsexperiments"]);
    assert.match(text(html), /Token “AI clients” · created .+ · last used never/);
    assert.match(html, />Disconnect</);
    assert.equal([...html.matchAll(/role="tab"/g)].length, 7);
    assert.match(html, /id="mcp-tab-claude-code"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="mcp-tab-claude-code"/);
    assert.match(text(html), /claude plugin install weaveforge-research@weaveforge/);
  });

  it("Codex tab shows the TOML with this machine's launch line", () => {
    const t = text(render(on, "codex"));
    assert.match(t, /\[mcp_servers\.weaveforge\]/);
    assert.ok(t.includes(`command = ${JSON.stringify(launch.command)}`));
  });

  it("connected but not serving: says why clients cannot reach it", () => {
    assert.doesNotMatch(render(on), /cannot reach/);
    assert.match(text(render({ ...on, enabled: false })), /MCP is not being served/);
    assert.match(text(render({ ...on, enabled: false, reason: "Another program is using port 27123." })), /Another program is using port 27123/);
  });

  it("renders nothing on shells without MCP", () => {
    assert.equal(render({ enabled: true, url: off.url }), "");
  });
});
