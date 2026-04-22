# agenttalk

MCP server that lets remote AI agents talk to **Butler** (the OpenClaw instance on the Mac mini) via its OpenAI-compatible `/v1/chat/completions` API.

Butler runs on loopback (`127.0.0.1:18789`). This server sits on the same machine, proxies requests inward, and exposes MCP tools outward — listening on all interfaces so remote agents can reach it.

---

## Architecture

```
[Remote Agent]
      │  MCP (HTTP or stdio)
      ▼
[agenttalk :3741]  ◄── 0.0.0.0 (all interfaces)
      │  POST /v1/chat/completions
      ▼
[Butler Gateway :18789]  ◄── 127.0.0.1 (loopback only)
      │
      ▼
[OpenClaw / Claude]
```

---

## Setup

```bash
cd repos/agenttalk
npm install
cp .env.example .env
# Edit .env — set BUTLER_GATEWAY_PASSWORD
```

---

## Running

### HTTP mode (for remote agents on other machines)
```bash
BUTLER_GATEWAY_PASSWORD=xxx node src/index.js http
```

Listens on `0.0.0.0:3741` by default.

### stdio mode (for local agents on the same machine)
```bash
BUTLER_GATEWAY_PASSWORD=xxx node src/index.js stdio
```

---

## MCP Tools

### `butler_chat`
Send a message to Butler and get a reply.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | ✅ | The message to send |
| `caller_name` | string | — | Stable agent ID for session continuity |
| `session_key` | string | — | Explicit OpenClaw session key |
| `model` | string | — | Agent target override (e.g. `openclaw/main`) |
| `history` | array | — | Prior messages for stateless multi-turn |

### `butler_ping`
Check if Butler's gateway is reachable. Returns status and latency.

---

## Connecting from a Remote Agent

### Option A — HTTP MCP (recommended for cross-machine)

Point your MCP client at:
```
http://<mac-mini-ip>:3741/mcp
```

With header (if `AGENTTALK_API_KEY` is set):
```
Authorization: Bearer <your_api_key>
```

Example MCP client config (Claude Desktop / mcporter):
```json
{
  "agenttalk": {
    "type": "http",
    "url": "http://192.168.0.35:3741/mcp",
    "headers": {
      "Authorization": "Bearer <api_key>"
    }
  }
}
```

### Option B — stdio via SSH tunnel
```bash
ssh butler@<mac-mini-ip> \
  "BUTLER_GATEWAY_PASSWORD=xxx node /path/to/agenttalk/src/index.js stdio"
```

---

## Security Notes

- `BUTLER_GATEWAY_PASSWORD` is the **owner-level** credential for Butler's gateway. Keep it secret.
- Set `AGENTTALK_API_KEY` to protect the HTTP surface from unauthorized agents on the network.
- This server only needs to be reachable by agents you trust — ideally on a private LAN or VPN.
- Never expose port 3741 directly to the public internet without additional auth/firewall rules.

---

## Mac mini IP
`192.168.0.35` (LAN) — check `ifconfig` if DHCP changes it.
