import { randomUUID } from "crypto";

const callerSessionOverrides = new Map();

export function baseSessionKey(callerName) {
  return callerName ? `agent:agenttalk:${callerName}` : null;
}

export function getDerivedSessionKey({ sessionKey, callerName }) {
  if (sessionKey) return sessionKey;
  if (!callerName) return null;
  return callerSessionOverrides.get(callerName) ?? baseSessionKey(callerName);
}

export function resetCallerSession({ callerName, sessionKey }) {
  const caller = callerName?.trim();
  if (!caller) throw new Error("caller_name is required to reset a session");
  const nextKey = sessionKey?.trim() || `${baseSessionKey(caller)}:reset:${randomUUID()}`;
  callerSessionOverrides.set(caller, nextKey);
  return { callerName: caller, sessionKey: nextKey };
}

export function getSessionOverrideStats() {
  return {
    resetCallerCount: callerSessionOverrides.size,
    resetCallers: [...callerSessionOverrides.keys()].sort(),
  };
}

export function clearSessionOverrides() {
  callerSessionOverrides.clear();
}