import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callButler, pingButler } from "./butler.js";
import { buildButlerInfo, buildWorkflows } from "./guidance.js";
import { getSessionOverrideStats, resetCallerSession } from "./session.js";

function jsonText(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function statusPayload({ config, runtime, gateway }) {
  return {
    service: "agenttalk",
    mode: config.mode,
    uptime_seconds: Math.round(process.uptime()),
    node: process.version,
    mock_butler: config.mockButler,
    gateway: {
      url: config.gatewayUrl,
      default_model: config.defaultModel,
      timeout_ms: config.timeoutMs,
      reachable: gateway?.ok ?? null,
      latency_ms: gateway?.ms ?? null,
      models: gateway?.models ?? [],
      error: gateway?.error ?? null,
    },
    http: {
      host: config.httpHost,
      port: runtime?.port?.() ?? config.httpPort,
      api_key_protection: Boolean(config.apiKey),
      active_mcp_sessions: runtime?.sessionCount?.() ?? 0,
      session_ttl_ms: config.sessionTtlMs,
      max_sessions: config.maxSessions,
    },
    caller_sessions: getSessionOverrideStats(),
  };
}

export function buildServer({ config, runtime = {} }) {
  const server = new McpServer({ name: "agenttalk", version: "1.0.0" });

  server.tool(
    "butler_chat",
    "Delegate a task or question to Butler. Always pass caller_name for memory. For operational work, send one concrete step at a time and confirm Butler's result before the next step; avoid large multi-step blocking prompts. Mention desired source/tool explicitly: GA4, GSC, PostHog, AnimeOshi backend DB, Japanese translation, GameTheory, or Simula.",
    {
      message: z.string().describe("Specific request for Butler. Include date ranges, data sources, output format, and approval constraints when relevant."),
      caller_name: z.string().optional().describe("Stable caller identity used for persistent Butler context, e.g. 'claude-agent-1'."),
      session_key: z.string().optional().describe("Explicit OpenClaw session key. Overrides caller_name-derived continuity."),
      model: z.string().optional().describe("Override target model/agent, e.g. openclaw/default or openclaw/main."),
      history: z.array(z.object({ role: z.enum(["user", "assistant", "system"]), content: z.string() })).optional(),
    },
    async ({ message, caller_name, session_key, model, history }) => {
      const preview = config.debug ? ` | msg="${message.slice(0, 80)}${message.length > 80 ? "…" : ""}"` : "";
      console.error(`[agenttalk] butler_chat | caller=${caller_name || "anonymous"}${preview}`);
      const messages = [...(history ?? []), { role: "user", content: message }];
      const { content, usage } = await callButler({ config, messages, model, stream: false, sessionKey: session_key, callerName: caller_name });
      const meta = usage ? `\n\n---\n_tokens: ${usage.prompt_tokens ?? "?"} in / ${usage.completion_tokens ?? "?"} out_` : "";
      return { content: [{ type: "text", text: content + meta }] };
    }
  );

  server.tool("butler_ping", "Check only Butler gateway reachability and latency.", { _noop: z.string().optional() }, async () => {
    console.error("[agenttalk] butler_ping");
    const result = await pingButler({ config });
    if (!result.ok) return { content: [{ type: "text", text: `❌ Cannot reach Butler: ${result.error}` }] };
    return { content: [{ type: "text", text: `✅ Butler online (${result.ms}ms)\nAvailable targets: ${(result.models ?? []).join(", ") || "unknown"}` }] };
  });

  server.tool("butler_status", "Operational status for AgentTalk plus optional Butler gateway health. Call this before important delegations.", {
    deep: z.boolean().optional().describe("If true, ping Butler gateway too. Default: true."),
  }, async ({ deep = true }) => {
    console.error("[agenttalk] butler_status");
    const gateway = deep ? await pingButler({ config }) : null;
    return jsonText(statusPayload({ config, runtime, gateway }));
  });

  server.tool("butler_reset_session", "Start a fresh persistent Butler context for a caller_name. Does not delete old gateway state; future calls use a new session key.", {
    caller_name: z.string().describe("Stable caller identity whose derived Butler session should be reset."),
    session_key: z.string().optional().describe("Optional explicit new session key. Omit to generate one."),
  }, async ({ caller_name, session_key }) => {
    console.error(`[agenttalk] butler_reset_session | caller=${caller_name}`);
    const reset = resetCallerSession({ callerName: caller_name, sessionKey: session_key });
    return jsonText({ ok: true, ...reset, note: "Future butler_chat calls with this caller_name will use this session key unless session_key is explicitly supplied." });
  });

  server.tool("butler_info", "Read this first: identity, capabilities, constraints, and prompt patterns for using Butler effectively.", { _noop: z.string().optional() }, async () => jsonText(buildButlerInfo(config)));

  server.tool("butler_workflows", "Discover concrete workflows Butler can execute, including analytics, backend DB, Japanese translation, GameTheory, and Simula.", { _noop: z.string().optional() }, async () => jsonText(buildWorkflows()));

  return server;
}