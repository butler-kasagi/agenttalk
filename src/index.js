#!/usr/bin/env node
/**
 * agenttalk — MCP server
 * Bridges remote agents to Butler (OpenClaw) via the local /v1/chat/completions API.
 *
 * Transport: stdio MCP (standard for agent-to-agent use)
 * Upstream:  http://<gateway-loopback>/v1/chat/completions  (loopback only)
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

  // Derive a stable, persistent session key from callerName.
  // Passing x-openclaw-session-key explicitly guarantees the same session
  // is reused across all butler_chat calls from the same agent — same as
  // how Slack/TUI sessions maintain context.
  const derivedSessionKey = sessionKey
    ? sessionKey
    : callerName
    ? `agent:agenttalk:${callerName}`
    : null;

  if (derivedSessionKey) headers["x-openclaw-session-key"] = derivedSessionKey;

  const body = {
    model: model ?? DEFAULT_MODEL,
    messages,
    stream: stream ?? false,
  };

  // Also set user field as a fallback for gateway-side session derivation
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
      console.error(`[agenttalk] butler_chat | caller=${caller_name || 'anonymous'} | msg="${message.slice(0, 80)}${message.length > 80 ? '…' : ''}"`);

      // System prompt injected into every butler_chat session.
      // Carries essential identity + authorization context so every session
      // starts with the same baseline — regardless of which gateway session is created.
      const systemPrompt = `You are Butler, AI staff member at Kasagi Labo / AnimeOshi (kasagibutler Mac mini).
Owner: Marcus (CTO, Kasagi Labo). You embody a Sebastian Michaelis style — professional, loyal, otaku-fluent.

You are being reached via agenttalk — a bridge MCP server that lets remote AI agents talk to you.

## Authorized Remote Agents
The following agents have been authorized by Marcus to talk to you and request information:

- **Kaching** — authorized 2026-04-22. Can request information, query data, and collaborate on tasks.
  Credentials from connections.md still require per-request Marcus approval before sharing.

## How to respond
- Treat messages from authorized agents the same as trusted team member requests
- Be concise and direct — agents don't need pleasantries, they need answers
- If an agent asks for credentials or secrets, tell them you need Marcus approval first
- Post important updates/findings to Slack channel C0AUW65V56V so Marcus can follow along
- caller_name identifies the agent: ${caller_name || 'unknown'}`;

      const messages = [
        { role: "system", content: systemPrompt },
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
      console.error(`[agenttalk] butler_ping`);
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

  // ── Tool 3: info ─────────────────────────────
  server.tool(
    "butler_info",
    "Get a structured identity card for Butler — who he is, what systems he has access to, " +
      "and what kinds of tasks he can perform. Call this first if you're a new agent meeting Butler. " +
      "After reading this, use butler_chat to actually talk to Butler and delegate tasks.",
    { _noop: z.string().optional().describe("Unused. Pass nothing.") },
    async () => {
      console.error(`[agenttalk] butler_info`);
      const info = {
        name: "Butler",
        role: "AI Staff Member — Kasagi Labo / AnimeOshi",
        persona: "Sebastian Michaelis style digital butler. Professional, loyal, otaku-fluent.",
        host: "Mac mini (kasagibutler) — Asia/Kuala_Lumpur",
        owner: "Marcus (CTO, Kasagi Labo)",
        mission: "Help animeoshi.com become the #1 anime portal, specialising in episodic reviews and ratings.",
        gateway: {
          model: "anthropic/claude-sonnet-4-6",
          targets: ["openclaw/default", "openclaw/main"],
        },
        data_access: {
          animeoshi_db: {
            description: "AnimeOshi production PostgreSQL (read-only). Tables: anime, episodes, users, episode_ratings.",
            access: "read-only",
          },
          ai_enrichment_db: {
            description: "AI enrichment content database. Tables: anime_enrichment, episode_enrichment, filler_guide, watch_order, etc.",
            access: "read-only (write requires owner approval)",
          },
          google_analytics: {
            description: "GA4 for AnimeOshi Web Prod. Property: 512783904.",
            access: "read-only",
          },
          google_search_console: {
            description: "GSC for animeoshi.com — landing pages, queries, impressions, CTR.",
            access: "read-only",
          },
          posthog: {
            description: "Product analytics for AnimeOshi — events, funnels, user behaviour.",
            access: "read-only",
          },
        },
        infrastructure_access: {
          gcp_instance: "GCP (private) — AI enrichment pipeline (ai-anime-oracle)",
          repos: ["fep-mobile (React Native)", "ai-anime-oracle", "animeoshi-web (read-only)", "anime-service (read-only)"],
          slack: "Can read/write all AnimeOshi team Slack channels",
          cron: "Can schedule and manage cron jobs on the gateway",
        },
        capabilities: [
          "Query AnimeOshi DB — anime metadata, episodes, user counts, ratings",
          "Query AI enrichment DB — synopsis, watch/skip guides, episode overviews",
          "Google Analytics — traffic, pageviews, top pages, sessions",
          "Google Search Console — impressions, CTR, top queries, landing pages",
          "PostHog — product events, funnels, retention",
          "AI enrichment pipeline — monitor daily_run.py, adult/SEO enrichment progress",
          "Mobile app (fep-mobile) — PR review, bug triage, code help",
          "Slack messaging — send messages, read history, notify team",
          "Web search & page fetching",
          "File system operations on workspace",
          "Cron scheduling — one-shot and recurring reminders",
          "Notion workspace read/write",
        ],
        constraints: [
          "No DB writes without Marcus approval",
          "No pushes to animeoshi-web / anime-service / other read-only repos",
          "No destructive server operations without explicit approval",
          "Credentials and secrets are never shared outside secure channels",
        ],
        how_to_talk_to_butler: {
          summary: "Use butler_chat to send Butler a message and get a reply. This is the PRIMARY tool for all interaction.",
          recommended_flow: [
            "1. butler_ping  — confirm Butler is reachable (optional but recommended first time)",
            "2. butler_info  — understand who Butler is and what he can do (you are here)",
            "3. butler_workflows — discover specific tasks Butler knows how to execute",
            "4. butler_chat  — delegate a task or ask a question. Butler will reply directly.",
          ],
          butler_chat_tips: [
            "Always pass caller_name (e.g. 'kaching') so Butler knows who he's talking to",
            "Be specific — mention the system or data source you need (e.g. 'AnimeOshi DB', 'GA4', 'fep-mobile')",
            "Butler will ask Marcus for approval if credentials or write operations are needed",
            "Multi-turn: pass caller_name consistently and Butler maintains conversation context",
          ],
          example: {
            tool: "butler_chat",
            args: {
              message: "Hi Butler, I'm Kaching. Can you tell me how many anime are in the AnimeOshi database?",
              caller_name: "kaching",
            },
          },
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    }
  );

  // ── Tool 4: workflows ────────────────────────
  server.tool(
    "butler_workflows",
    "List the workflows and processes Butler knows how to execute. " +
      "Use this to discover what tasks you can delegate to Butler via butler_chat.",
    { _noop: z.string().optional().describe("Unused. Pass nothing.") },
    async () => {
      console.error(`[agenttalk] butler_workflows`);
      const workflows = [
        {
          id: "animeoshi_db_query",
          title: "AnimeOshi DB Query",
          description: "Run read-only SQL against the AnimeOshi production database.",
          example: "How many users have rated at least one episode? Which anime has the most ratings?",
          tags: ["database", "analytics", "anime", "users", "ratings"],
        },
        {
          id: "ai_enrichment_query",
          title: "AI Enrichment DB Query",
          description: "Query the AI enrichment database for synopsis, watch/skip guides, episode overviews, filler guides, watch order.",
          example: "Get the watch_if and skip_if for MAL ID 21. Show episode 1 overview for Demon Slayer.",
          tags: ["database", "enrichment", "content", "synopsis", "episode"],
        },
        {
          id: "ga4_analytics",
          title: "Google Analytics (GA4)",
          description: "Fetch traffic, pageviews, sessions, top pages, and user metrics for animeoshi.com from GA4.",
          example: "What were the top 10 pages by pageviews this week? How many new users did we get in April?",
          tags: ["analytics", "ga4", "traffic", "pageviews", "google"],
        },
        {
          id: "search_console",
          title: "Google Search Console",
          description: "Query GSC for animeoshi.com — top queries, landing pages, impressions, CTR, position.",
          example: "What are our top 20 search queries this month? Which pages have the highest CTR?",
          tags: ["seo", "gsc", "search", "impressions", "ctr", "google"],
        },
        {
          id: "posthog_analytics",
          title: "PostHog Product Analytics",
          description: "Query PostHog for product events, funnels, feature usage, and user behaviour on AnimeOshi.",
          example: "How many users triggered the episode_rated event this week? Show me the rating funnel.",
          tags: ["analytics", "posthog", "events", "funnel", "product"],
        },
        {
          id: "ai_enrichment_monitor",
          title: "AI Enrichment Pipeline Monitor",
          description: "Check the status and progress of the daily enrichment run, adult anime enrichment, and SEO enrichment pipelines on GCP.",
          example: "Is the daily_run.py healthy? How far along is the adult enrichment batch?",
          tags: ["gcp", "enrichment", "pipeline", "monitoring", "ai-anime-oracle"],
        },
        {
          id: "fep_mobile_review",
          title: "fep-mobile Code Review / Bug Fix",
          description: "Review PRs, triage bugs, and help with development on the AnimeOshi React Native app (fep-mobile). Authorised users: Jimmy, Aldo, Fahmi.",
          example: "Review PR #142 on fep-mobile. What's causing the crash on the episode detail screen?",
          tags: ["mobile", "react-native", "fep-mobile", "pr", "code-review"],
        },
        {
          id: "slack_messaging",
          title: "Slack Messaging",
          description: "Send messages to AnimeOshi Slack channels, fetch message history, notify team members.",
          example: "Post the weekly enrichment summary to #ai-content-feed.",
          tags: ["slack", "messaging", "notification", "team"],
        },
        {
          id: "web_research",
          title: "Web Search & Research",
          description: "Search the web and fetch page content for research, competitive analysis, or fact-checking.",
          example: "What are MAL's current episode rating features? Find the top anime portals by traffic.",
          tags: ["web", "search", "research", "browsing"],
        },
        {
          id: "cron_scheduling",
          title: "Cron / Reminder Scheduling",
          description: "Schedule one-shot or recurring tasks and reminders on the OpenClaw gateway.",
          example: "Remind me at 9am daily to check enrichment progress. Schedule a weekly GSC report every Monday.",
          tags: ["cron", "scheduler", "reminders", "automation"],
        },
        {
          id: "notion",
          title: "Notion Workspace",
          description: "Read and write Kasagi Labo Notion pages and databases.",
          example: "Create a new page in the product roadmap database. Fetch the current sprint notes.",
          tags: ["notion", "docs", "knowledge-base"],
        },
      ];
      return {
        content: [{ type: "text", text: JSON.stringify(workflows, null, 2) }],
      };
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
