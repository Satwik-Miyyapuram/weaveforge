import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MCP_CLIENT_TABS,
  claudeCodeCommands,
  codexToml,
  geminiInstall,
  mcpServersJson,
  vscodeJson,
} from "../ui/mcp-client-config";

const launch = {
  command: "C:\\Users\\Ada Lovelace\\AppData\\Local\\Programs\\WeaveForge\\WeaveForge.exe",
  args: ["C:\\Users\\Ada Lovelace\\.weaveforge\\mcp-dev\\weaveforge-mcp.mjs"],
  env: { ELECTRON_RUN_AS_NODE: "1", WEAVEFORGE_MCP_FILE: "C:\\Users\\Ada Lovelace\\.weaveforge\\mcp-dev.json" },
};

describe("mcp client config", () => {
  it("lists the seven clients in the mock's order", () => {
    assert.deepEqual(
      MCP_CLIENT_TABS.map((t) => t.label),
      ["Claude Code", "Claude Desktop", "Codex", "Gemini CLI", "Cursor", "VS Code", "Other"],
    );
  });

  it("Codex TOML keeps Windows backslashes and spaces intact", () => {
    const toml = codexToml(launch);
    assert.match(toml, /^\[mcp_servers\.weaveforge\]$/m);
    // A TOML basic string decodes like JSON, so each value reads back exactly.
    const value = (key: string) => JSON.parse(toml.match(new RegExp(`^${key} = (".*")$`, "m"))![1]!);
    assert.equal(value("command"), launch.command);
    assert.deepEqual(JSON.parse(toml.match(/^args = (\[.*\])$/m)![1]!), launch.args);
    assert.match(toml, /env = \{ ELECTRON_RUN_AS_NODE = "1", WEAVEFORGE_MCP_FILE = ".*mcp-dev\.json" \}/);
  });

  it("the JSON shapes round-trip to the launch line", () => {
    assert.deepEqual(JSON.parse(mcpServersJson(launch)).mcpServers.weaveforge, launch);
    assert.deepEqual(JSON.parse(vscodeJson(launch)).servers.weaveforge, { type: "stdio", ...launch });
  });

  it("plugin installs point at this repository", () => {
    assert.equal(
      claudeCodeCommands(),
      "claude plugin marketplace add Satwik-Miyyapuram/weaveforge\nclaude plugin install weaveforge-research@weaveforge",
    );
    assert.equal(geminiInstall(), "gemini extensions install https://github.com/Satwik-Miyyapuram/weaveforge");
  });
});
