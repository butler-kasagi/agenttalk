#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, loadDotEnv, logConfigWarnings } from "./config.js";
import { startHttpServer } from "./http.js";
import { buildServer } from "./server.js";

loadDotEnv();

const mode = process.argv[2] ?? "stdio";
const config = loadConfig({ mode });
logConfigWarnings(config);

if (mode === "http") {
  const server = await startHttpServer(config);
  console.error(`[agenttalk] HTTP MCP listening on ${config.httpHost}:${server.port()}`);
  console.error(`[agenttalk] Butler gateway: ${config.gatewayUrl}${config.mockButler ? " (mock)" : ""}`);
  console.error(`[agenttalk] API key protection: ${config.apiKey ? "ON" : "OFF"}`);
} else if (mode === "stdio") {
  const server = buildServer({ config, runtime: { sessionCount: () => 0, port: () => null } });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[agenttalk] stdio MCP ready — Butler gateway: ${config.gatewayUrl}${config.mockButler ? " (mock)" : ""}`);
} else {
  console.error(`[agenttalk] unknown mode "${mode}". Use "stdio" or "http".`);
  process.exit(1);
}