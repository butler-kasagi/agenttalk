import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseBool(value, defaultValue = false) {
  if (value == null || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parsePositiveInt(value, defaultValue) {
  const parsed = Number.parseInt(value ?? String(defaultValue), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

export function loadDotEnv(env = process.env) {
  try {
    const envPath = resolve(__dirname, "../.env");
    const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in env)) env[key] = val;
    }
  } catch {
    // .env not found — rely on environment variables
  }
}

export function loadConfig({ mode = "stdio", env = process.env } = {}) {
  const httpPort = parsePositiveInt(env.AGENTTALK_PORT, 3741);
  return {
    mode,
    gatewayUrl: env.BUTLER_GATEWAY_URL ?? "http://127.0.0.1:18789",
    gatewayPassword: env.BUTLER_GATEWAY_PASSWORD ?? "",
    defaultModel: env.BUTLER_MODEL ?? "openclaw/default",
    httpHost: env.AGENTTALK_HOST ?? "0.0.0.0",
    httpPort,
    apiKey: env.AGENTTALK_API_KEY ?? "",
    mockButler: parseBool(env.AGENTTALK_MOCK_BUTLER, false),
    debug: parseBool(env.AGENTTALK_DEBUG, false),
    timeoutMs: parsePositiveInt(env.BUTLER_TIMEOUT_MS, 60_000),
    sessionTtlMs: parsePositiveInt(env.AGENTTALK_SESSION_TTL_MS, 60 * 60_000),
    maxSessions: parsePositiveInt(env.AGENTTALK_MAX_SESSIONS, 250),
    startedAt: new Date(),
  };
}

export function configWarnings(config) {
  const warnings = [];
  if (config.mode === "http" && !config.apiKey) {
    warnings.push("HTTP API key protection is OFF. Set AGENTTALK_API_KEY for LAN/remote use.");
  }
  if (!config.mockButler && !config.gatewayPassword) {
    warnings.push("BUTLER_GATEWAY_PASSWORD is empty; real Butler calls will likely fail.");
  }
  if (config.httpPort === 0 && config.mode === "http") {
    warnings.push("AGENTTALK_PORT=0 selected an ephemeral port; useful for tests only.");
  }
  return warnings;
}

export function logConfigWarnings(config) {
  for (const warning of configWarnings(config)) {
    console.error(`[agenttalk] warning: ${warning}`);
  }
}