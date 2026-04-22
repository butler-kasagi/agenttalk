#!/usr/bin/env node
/**
 * agenttalk — MCP server
 * Bridges remote agents to Butler (OpenClaw) via the local /v1/chat/completions API.
 *
 * Transport: stdio MCP (standard for agent-to-agent use)
 * Upstream:  http://127.0.0.1:18789/v1/chat/completions  (loopback only)
 *
 * Config (env vars or .env file):
 *   BUTLER_GATEWAY_URL       Override gateway URL  (default: http://127.0.0.1:18789)
 *   BUTLER_GATEWAY_PASSWORD  Gateway password      (required)
 *   BUTLER_MODEL             Agent target model    (default: openclaw/default)
 *   AGENTTALK_HOST           Bind host for HTTP    (default: 0.0.0.0)
 *   AGENTTALK_PORT           HTTP port             (default: 3741)
 *   AGENTTALK_API_KEY        Optional API key to protect this MCP's HTTP surface
 */

// Load .env if present (Node 20.6+ native --env-file, or manual parse here)
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envPath = resolve(__dirname, "../.env");
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  // .env not found — rely on environment variables
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "http";

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────
const GATEWAY_URL = process.env.BUTLER_GATEWAY_URL ?? "http://127.0.0.1:18789";
const GATEWAY_PASSWORD = process.env.BUTLER_GATEWAY_PASSWORD ?? "";
const DEFAULT_MODEL = process.env.BUTLER_MODEL ?? "openclaw/default";
const HTTP_HOST = process.env.AGENTTALK_HOST ?? "0.0.0.0";
const HTTP_PORT = parseInt(process.env.AGENTTALK_PORT ?? "3741", 10);
const API_KEY = process.env.AGENTTALK_API_KEY ?? "";

// ──────────────────────────────────────────────
// Core: call Butler via /v1/chat/completions
// ──────────────────────────────────────────────
async function callButler({ messages, model, stream, sessionKey, callerName }) {
  const url = `${GATEWAY_URL}/v1/chat/completions`;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${GATEWAY_PASSWORD}`,
  };

  if (sessionKey) headers["x-openclaw-session-key"] = sessionKey;

  const body = {
    model: model ?? DEFAULT_MODEL,
    messages,
    stream: stream ?? false,
  };

  // Derive a stable session from callerName so repeated calls share context
  if (callerName && !sessionKey) {
    body.user = `agenttalk:${callerName}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gateway error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const usage = data?.usage ?? null;
  const sessionReturned = data?.id ?? null; // OpenClaw may echo session id in id field

  return { content, usage, id: sessionReturned };
}

// ──────────────────────────────────────────────
// Build MCP server (tools)
// ──────────────────────────────────────────────
function buildServer() {
  const server = new McpServer({
    name: "agenttalk",
    version: "1.0.0",
  });

  // ── Tool 1: chat ─────────────────────────────
  server.tool(
    "butler_chat",
    "Send a message to Butler (the OpenClaw AI agent) and get a reply. " +
      "Butler has access to AnimeOshi infrastructure, databases, Slack, and more. " +
      "Use this when you need Butler to execute tasks, look up data, or collaborate.",
    {
      message: z.string().describe("The message to send to Butler."),
      caller_name: z
        .string()
        .optional()
        .describe(
          "A stable identifier for the calling agent (e.g. 'claude-agent-1'). " +
          "Used to maintain conversation continuity across calls."
        ),
      session_key: z
        .string()
        .optional()
        .describe("Explicit OpenClaw session key. Leave blank to auto-derive from caller_name."),
      model: z
        .string()
        .optional()
        .describe(
          "Override the Butler agent target (e.g. 'openclaw/default', 'openclaw/main'). " +
          "Omit to use the server default."
        ),
      history: z
        .array(
          z.object({
            role: z.enum(["user", "assistant", "system"]),
            content: z.string(),
          })
        )
        .optional()
        .describe(
          "Prior conversation messages. Pass full history for stateless multi-turn. " +
          "For stateful sessions use caller_name instead."
        ),
    },
    async ({ message, caller_name, session_key, model, history }) => {
      const messages = [
        ...(history ?? []),
        { role: "user", content: message },
      ];

      const { content, usage } = await callButler({
        messages,
        model,
        stream: false,
        sessionKey: session_key,
        callerName: caller_name,
      });

      const meta = usage
        ? `\n\n---\n_tokens: ${usage.prompt_tokens ?? "?"} in / ${usage.completion_tokens ?? "?"} out_`
        : "";

      return {
        content: [{ type: "text", text: content + meta }],
      };
    }
  );

  // ── Tool 2: ping ─────────────────────────────
  server.tool(
    "butler_ping",
    "Check if Butler's gateway is reachable. Returns status and latency.",
    { _noop: z.string().optional().describe("Unused. Pass nothing.") },
    async () => {
      const start = Date.now();
      try {
        const res = await fetch(`${GATEWAY_URL}/v1/models`, {
          headers: { Authorization: `Bearer ${GATEWAY_PASSWORD}` },
        });
        const ms = Date.now() - start;
        if (!res.ok) {
          return {
            content: [
              { type: "text", text: `⚠️ Gateway returned HTTP ${res.status} (${ms}ms)` },
            ],
          };
        }
        const data = await res.json();
        const models = data?.data?.map((m) => m.id).join(", ") ?? "unknown";
        return {
          content: [
            {
              type: "text",
              text: `✅ Butler online (${ms}ms)\nAvailable targets: ${models}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `❌ Cannot reach Butler: ${err.message}` }],
        };
      }
    }
  );

  return server;
}

// ──────────────────────────────────────────────
// Launch: stdio vs HTTP based on argv
// ──────────────────────────────────────────────
const mode = process.argv[2] ?? "stdio"; // "stdio" | "http"

if (mode === "http") {
  // Streamable HTTP transport — stateful session map so all requests for
  // a given Mcp-Session-Id are routed to the same transport instance.
  const sessions = new Map(); // sessionId → { transport, server }

  const app = http.createServer(async (req, res) => {
    // Optional API key check
    if (API_KEY) {
      const auth = req.headers["authorization"] ?? "";
      const key = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
      if (key !== API_KEY) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    // Route to existing session or create a new one
    const existingId = req.headers["mcp-session-id"];

    if (existingId && sessions.has(existingId)) {
      const { transport } = sessions.get(existingId);
      await transport.handleRequest(req, res);
      return;
    }

    // New session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    const mcpServer = buildServer();
    await mcpServer.connect(transport);

    // Once the session ID is assigned (after initialize), track it
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await transport.handleRequest(req, res);

    // After handleRequest, the session ID is set — store it
    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport, server: mcpServer });
    }
  });

  app.listen(HTTP_PORT, HTTP_HOST, () => {
    console.error(
      `[agenttalk] HTTP MCP listening on ${HTTP_HOST}:${HTTP_PORT}`
    );
    console.error(`[agenttalk] Butler gateway: ${GATEWAY_URL}`);
    if (API_KEY) console.error(`[agenttalk] API key protection: ON`);
    else console.error(`[agenttalk] API key protection: OFF (set AGENTTALK_API_KEY to enable)`);
  });
} else {
  // Stdio transport — local agents connect via stdin/stdout
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[agenttalk] stdio MCP ready — Butler gateway: ${GATEWAY_URL}`
  );
}
