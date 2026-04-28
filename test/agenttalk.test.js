import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { callButler, pingButler } from "../src/butler.js";
import { loadConfig } from "../src/config.js";
import { startHttpServer } from "../src/http.js";
import { clearSessionOverrides, getDerivedSessionKey, resetCallerSession } from "../src/session.js";

function mockConfig(mode = "stdio") {
  return loadConfig({
    mode,
    env: {
      AGENTTALK_HOST: "127.0.0.1",
      AGENTTALK_PORT: "0",
      AGENTTALK_API_KEY: "testkey",
      AGENTTALK_MOCK_BUTLER: "1",
      BUTLER_GATEWAY_PASSWORD: "dummy",
      BUTLER_MODEL: "openclaw/default",
    },
  });
}

test("caller session reset changes derived key", () => {
  clearSessionOverrides();
  assert.equal(getDerivedSessionKey({ callerName: "agent-a" }), "agent:agenttalk:agent-a");
  const reset = resetCallerSession({ callerName: "agent-a", sessionKey: "custom-session" });
  assert.equal(reset.sessionKey, "custom-session");
  assert.equal(getDerivedSessionKey({ callerName: "agent-a" }), "custom-session");
});

test("mock Butler mode supports ping and chat", async () => {
  const config = mockConfig();
  const ping = await pingButler({ config });
  assert.equal(ping.ok, true);
  assert.equal(ping.mock, true);

  const chat = await callButler({
    config,
    messages: [{ role: "user", content: "hello" }],
    callerName: "tester",
  });
  assert.match(chat.content, /\[mock Butler\] Received: hello/);
  assert.equal(chat.id, "agent:agenttalk:tester");
});

test("HTTP MCP exposes practical tools and enforces API key", async () => {
  const config = mockConfig("http");
  const httpServer = await startHttpServer(config);
  const baseUrl = `http://127.0.0.1:${httpServer.port()}`;

  try {
    const unauthorized = await fetch(`${baseUrl}/health`);
    assert.equal(unauthorized.status, 401);

    const health = await fetch(`${baseUrl}/health`, { headers: { Authorization: "Bearer testkey" } });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer testkey" } },
    });
    const client = new Client({ name: "agenttalk-http-test", version: "1.0.0" });
    await client.connect(transport);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    assert.deepEqual(names.sort(), ["butler_chat", "butler_info", "butler_ping", "butler_reset_session", "butler_status", "butler_workflows"].sort());

    const status = await client.callTool({ name: "butler_status", arguments: { deep: true } });
    const statusJson = JSON.parse(status.content[0].text);
    assert.equal(statusJson.gateway.reachable, true);
    assert.equal(statusJson.mock_butler, true);

    const reset = await client.callTool({ name: "butler_reset_session", arguments: { caller_name: "agent-http", session_key: "fresh" } });
    assert.equal(JSON.parse(reset.content[0].text).sessionKey, "fresh");

    const chat = await client.callTool({ name: "butler_chat", arguments: { caller_name: "agent-http", message: "Use GSC to find opportunities" } });
    assert.match(chat.content[0].text, /mock Butler/);
    await client.close();
  } finally {
    await httpServer.close();
  }
});

test("stdio MCP starts in mock mode", async () => {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["src/index.js", "stdio"],
    cwd: process.cwd(),
    env: { ...process.env, AGENTTALK_MOCK_BUTLER: "1", BUTLER_GATEWAY_PASSWORD: "dummy" },
    stderr: "pipe",
  });
  const client = new Client({ name: "agenttalk-stdio-test", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.ok(tools.some((tool) => tool.name === "butler_status"));
  const info = await client.callTool({ name: "butler_info", arguments: {} });
  assert.match(info.content[0].text, /Japanese translation/);
  await client.close();
});