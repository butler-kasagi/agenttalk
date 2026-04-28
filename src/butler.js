import { getDerivedSessionKey } from "./session.js";

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Gateway request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function callButler({ config, messages, model, stream, sessionKey, callerName, fetchImpl = fetch }) {
  const derivedSessionKey = getDerivedSessionKey({ sessionKey, callerName });
  const body = {
    model: model ?? config.defaultModel,
    messages,
    stream: stream ?? false,
  };

  if (callerName && !sessionKey) body.user = `agenttalk:${callerName}`;

  if (config.mockButler) {
    const last = messages.at(-1)?.content ?? "";
    return {
      content: `[mock Butler] Received: ${last}`,
      usage: { prompt_tokens: messages.length, completion_tokens: 6 },
      id: derivedSessionKey ?? "mock-session",
    };
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.gatewayPassword}`,
  };
  if (derivedSessionKey) headers["x-openclaw-session-key"] = derivedSessionKey;

  const res = await fetchWithTimeout(
    fetchImpl,
    `${config.gatewayUrl}/v1/chat/completions`,
    { method: "POST", headers, body: JSON.stringify(body) },
    config.timeoutMs
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gateway error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return {
    content: data?.choices?.[0]?.message?.content ?? "",
    usage: data?.usage ?? null,
    id: data?.id ?? null,
  };
}

export async function pingButler({ config, fetchImpl = fetch }) {
  const start = Date.now();
  if (config.mockButler) {
    return { ok: true, ms: 0, models: [config.defaultModel], mock: true };
  }

  try {
    const res = await fetchWithTimeout(
      fetchImpl,
      `${config.gatewayUrl}/v1/models`,
      { headers: { Authorization: `Bearer ${config.gatewayPassword}` } },
      config.timeoutMs
    );
    const ms = Date.now() - start;
    if (!res.ok) return { ok: false, ms, status: res.status, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, ms, models: data?.data?.map((m) => m.id) ?? [] };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err.message };
  }
}