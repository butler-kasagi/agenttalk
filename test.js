#!/usr/bin/env node
/**
 * Quick end-to-end test for the agenttalk MCP server.
 * Run AFTER starting: node src/index.js http
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE_URL = process.env.AGENTTALK_URL ?? "http://127.0.0.1:3741/mcp";

console.log(`Connecting to ${BASE_URL}...\n`);

const transport = new StreamableHTTPClientTransport(new URL(BASE_URL));
const client = new Client({ name: "agenttalk-test", version: "1.0.0" });

await client.connect(transport);
console.log("✅ Connected\n");

// List tools
const { tools } = await client.listTools();
console.log("Tools available:");
for (const t of tools) {
  console.log(`  • ${t.name} — ${t.description?.slice(0, 80)}...`);
}
console.log();

// butler_ping
console.log("Calling butler_ping...");
const pingResult = await client.callTool({ name: "butler_ping", arguments: {} });
console.log(pingResult.content[0]?.text ?? "(no response)");
console.log();

// butler_chat
console.log("Calling butler_chat: 'What is 1+1?'");
const chatResult = await client.callTool({
  name: "butler_chat",
  arguments: {
    message: "What is 1+1? Reply in one sentence.",
    caller_name: "test-agent",
  },
});
console.log("Butler says:", chatResult.content[0]?.text ?? "(no response)");

await client.close();
console.log("\n✅ All tests passed.");
