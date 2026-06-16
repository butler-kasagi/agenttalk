# Latest Changes

## 2026-04-28 — AgentTalk MCP usability and testing

Committed and pushed:

- Commit: `f7b2c11 Improve AgentTalk MCP usability and testing`
- Branch: `main`
- Remote: `origin/main`

### Summary

- Refactored the monolithic MCP server into focused modules:
  - `src/config.js`
  - `src/butler.js`
  - `src/session.js`
  - `src/server.js`
  - `src/http.js`
  - `src/guidance.js`
- Added practical MCP tools:
  - `butler_status`
  - `butler_reset_session`
- Improved connected-agent guidance through richer tool descriptions, `butler_info`, and `butler_workflows`.
- Added explicit guidance for Butler capabilities including:
  - Google Search Console
  - GA4
  - PostHog
  - AnimeOshi backend database
  - Japanese translation/localisation
  - GameTheory
  - Simula
- Added mock Butler mode with `AGENTTALK_MOCK_BUTLER=1` for local development and tests.
- Added request timeout/session configuration options in `.env.example`.
- Added `/health` support for HTTP mode.
- Added HTTP session TTL cleanup and max-session protection.
- Added automated tests via `npm test`.
- Updated manual smoke test to support `AGENTTALK_API_KEY`.

### Validation

- Syntax checks passed.
- `npm test` passed: 4 tests, 0 failures.
- Manual smoke test passed in mock Butler mode.

### Push Notes

- Initial push failed because the machine authenticated to GitHub as `marcuskasagi`.
- A repo-specific deploy key, `butler-kasagi-agenttalk`, was added to GitHub with write access.
- Repo-local SSH config was set to use that key:
  - `ssh -i C:/Users/godju/.ssh/butler-kasagi-agenttalk -o IdentitiesOnly=yes`
- Push then succeeded to `github.com:butler-kasagi/agenttalk.git`.
