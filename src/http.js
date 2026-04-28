import http from "http";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";

function isAuthorized(req, config) {
  if (!config.apiKey) return true;
  const auth = req.headers.authorization ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  return key === config.apiKey;
}

function writeJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

export async function startHttpServer(config) {
  const sessions = new Map();
  let app;

  const runtime = {
    sessionCount: () => sessions.size,
    port: () => app?.address()?.port ?? config.httpPort,
  };

  function cleanupSessions() {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastSeen > config.sessionTtlMs) {
        session.transport.close?.().catch?.(() => {});
        sessions.delete(id);
      }
    }
  }

  app = http.createServer(async (req, res) => {
    if (!isAuthorized(req, config)) return writeJson(res, 401, { error: "Unauthorized" });

    if (req.method === "GET" && req.url?.startsWith("/health")) {
      return writeJson(res, 200, {
        ok: true,
        service: "agenttalk",
        mode: "http",
        mock_butler: config.mockButler,
        active_mcp_sessions: sessions.size,
        uptime_seconds: Math.round(process.uptime()),
      });
    }

    try {
      const existingId = req.headers["mcp-session-id"];
      if (existingId && sessions.has(existingId)) {
        const session = sessions.get(existingId);
        session.lastSeen = Date.now();
        await session.transport.handleRequest(req, res);
        return;
      }

      if (sessions.size >= config.maxSessions) cleanupSessions();
      if (sessions.size >= config.maxSessions) {
        return writeJson(res, 503, { error: "Too many active MCP sessions" });
      }

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
      const mcpServer = buildServer({ config, runtime });
      await mcpServer.connect(transport);

      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };

      await transport.handleRequest(req, res);

      if (transport.sessionId) {
        sessions.set(transport.sessionId, {
          transport,
          server: mcpServer,
          createdAt: Date.now(),
          lastSeen: Date.now(),
        });
      }
    } catch (err) {
      console.error(`[agenttalk] HTTP error: ${err.stack || err.message}`);
      if (!res.headersSent) writeJson(res, 500, { error: err.message });
      else res.end();
    }
  });

  const cleanupTimer = setInterval(cleanupSessions, Math.min(config.sessionTtlMs, 60_000));
  cleanupTimer.unref?.();

  await new Promise((resolve) => app.listen(config.httpPort, config.httpHost, resolve));
  return {
    app,
    sessionCount: () => sessions.size,
    port: () => app.address()?.port ?? config.httpPort,
    close: () => new Promise((resolve, reject) => {
      clearInterval(cleanupTimer);
      for (const session of sessions.values()) session.transport.close?.().catch?.(() => {});
      app.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}