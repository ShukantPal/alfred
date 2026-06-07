# agent/ — Alfred Talon Delegate

`agent/` configures Alfred's Talon-backed company-memory delegate. It no longer
owns a bespoke planner, subagent fanout harness, Redis store, or WebSocket RPC
server.

`ctl/` still owns meeting I/O and OpenAI Realtime voice. When the Realtime model
calls `delegate_to_company_agent`, ctl uses this package to create or reuse a
meeting-scoped Talon session. Talon owns the delegated agent runtime. Company
memory is attached by default through a local stdio MCP server in `agent/`, so no
port is needed. `TALON_COMPANY_MCP_URL` or `REDIS_MCP_URL` can still override it
with an external HTTP MCP endpoint. Google Workspace can also be attached through
`workspace-mcp` over stdio, but agent only registers it when Google OAuth
credentials are present and the configured command is executable.

**For AI coding tools and full system context, read [AGENTS.md](../AGENTS.md).**

## Quick start
```bash
bun install
export OPENAI_API_KEY=...
bun run agent:dev
```

`agent:dev` starts a local Talon node, configures the `company-memory` agent, and
attaches the built-in stdio company-memory MCP server. `agent:demo` starts the
same Talon runtime, asks a sample question, prints the answer, and exits.

Use `agent:test` to exercise the same delegate path ctl uses:

```bash
bun run agent:test -- --question "Is the onboarding redesign safe to ship?"
bun run agent:test -- --meeting-id local-debug --repeat 3
bun run agent:test -- --interactive
```

## Environment

- `OPENAI_API_KEY`: required; used by default for the Talon OpenAI-compatible provider.
- `WANDB_API_KEY`: required; enables Weave tracing and is used for W&B Inference when `LLM_PROVIDER=wandb`.
- `WEAVE_PROJECT`: Weave project name, default `meeting-agent`.
- `LLM_PROVIDER`: `openai` or `wandb` for the Talon delegate provider config, default `openai`.
- `TALON_NAMESPACE`: Talon namespace, default `alfred`.
- `TALON_COMPANY_AGENT`: agent name, default `company-memory`.
- `TALON_PROVIDER_NAME`: provider key configured in Talon, default `openai`.
- `TALON_PROVIDER_BASE_URL`: OpenAI-compatible provider base URL; defaults to OpenAI or W&B Inference based on `LLM_PROVIDER`.
- `TALON_MODEL`: delegate model, default `gpt-4.1-mini` for OpenAI or `ibm-granite/granite-4.1-8b` for W&B Inference.
- `TALON_DATA_DIR`: persistent Talon control-plane data directory, default `.tools/talon/data`.
- `TALON_WORKSPACE_DIR`: Talon workspace directory, default `.tools/talon/workspace`.
- `TALON_JWT_SECRET`: required local Talon JWT secret.
- `TALON_JWT_TTL_SECONDS`: TTL for freshly minted Talon request JWTs, default `86400`. Alfred mints a new token for each Talon RPC.
- `TALON_COMPANY_MCP_NAME`: MCP server name in Talon, default `company-memory`.
- `TALON_COMPANY_MCP_URL`: optional HTTP MCP endpoint for Redis/company-memory tools. When unset, agent uses the built-in stdio MCP server.
- `REDIS_MCP_URL`: fallback HTTP MCP URL when `TALON_COMPANY_MCP_URL` is unset.
- `TALON_MEMORY_MCP_COMMAND`: command for the built-in stdio MCP server, default is the current Bun executable.
- `TALON_MEMORY_MCP_ARGS_JSON`: JSON string array of stdio MCP command args, default points at `agent/src/memory-mcp.ts`.
- `TALON_COMPANY_MCP_HEADERS_JSON`: optional JSON object of MCP headers.
- `TALON_WORKSPACE_MCP_ENABLED`: enable Google Workspace MCP auto-attach, default `true`. Set `false`, `0`, or `off` to disable.
- `TALON_WORKSPACE_MCP_NAME`: Google Workspace MCP server name in Talon, default `google-workspace`.
- `TALON_WORKSPACE_MCP_COMMAND`: stdio command for Google Workspace MCP, default `uvx`.
- `TALON_WORKSPACE_MCP_ARGS_JSON`: JSON string array of args, default `["workspace-mcp","--single-user","--tools","gmail","drive","docs","calendar","--read-only"]`.
- `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`: OAuth credentials that make the Google Workspace MCP authable.
- `FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY`: required by Workspace MCP for public OAuth 2.1/PKCE clients when `GOOGLE_OAUTH_CLIENT_SECRET` is omitted.
- `GOOGLE_CLIENT_SECRET_PATH`: path to a Google OAuth client secret file. If unset, agent also checks legacy `GOOGLE_CLIENT_SECRETS` and then `client_secret.json` at the repo root.
- `OAUTHLIB_INSECURE_TRANSPORT`: set `1` for local development OAuth callbacks over `http://`.
- `TALON_SEARCH_MCP_ENABLED`: enable DuckDuckGo web search MCP auto-attach, default `true`. Set `false`, `0`, or `off` to disable.
- `TALON_SEARCH_MCP_NAME`: DuckDuckGo search MCP server name in Talon, default `duckduckgo-search`.
- `TALON_SEARCH_MCP_COMMAND`: stdio command for DuckDuckGo search MCP, default `uvx`.
- `TALON_SEARCH_MCP_ARGS_JSON`: JSON string array of args, default `["duckduckgo-mcp-server"]`.
- `TALON_DELEGATE_TIMEOUT_MS`: delegation timeout, default `20000`.

Google Workspace MCP is read-only by default and is skipped with a log message if
it is not authable. The built-in company-memory MCP still attaches because it
does not require external auth.

## MCP Auth

The built-in `company-memory` MCP needs no auth. It is a local stdio server with
seeded demo context. If `TALON_COMPANY_MCP_URL` or `REDIS_MCP_URL` is set, Talon
uses that external MCP instead; pass any required headers with
`TALON_COMPANY_MCP_HEADERS_JSON`.

The DuckDuckGo search MCP also needs no auth. It runs as `uvx
duckduckgo-mcp-server` by default and is attached whenever `uvx` is available.
Warm it before the demo with:

```bash
uvx duckduckgo-mcp-server --help
```

For the fastest Google Workspace demo, use a Google Cloud OAuth client of type
`Desktop application`, not `Web application`. Download its JSON and keep it out
of git:

```bash
mkdir -p .tools/google-workspace
mv ~/Downloads/client_secret_*.json .tools/google-workspace/client_secret.json
chmod 600 .tools/google-workspace/client_secret.json
```

Then add these to the repo root `.env`:

```bash
GOOGLE_CLIENT_SECRET_PATH=.tools/google-workspace/client_secret.json
OAUTHLIB_INSECURE_TRANSPORT=1
USER_GOOGLE_EMAIL=you@company.com
```

Install `uvx` if needed:

```bash
pip3 install --user uv
```

Warm the MCP package before the demo:

```bash
uvx workspace-mcp --help
```

`TALON_WORKSPACE_MCP_COMMAND` defaults to `uvx`. Only set it when `uvx` is
installed but not visible on the PATH inherited by Alfred.

To pre-login before a demo, start Workspace MCP once in HTTP mode from one
terminal:

```bash
set -a
source .env
set +a

uvx workspace-mcp \
  --single-user \
  --tools gmail drive docs calendar \
  --read-only \
  --transport streamable-http
```

Then run the auth tool from a second terminal:

```bash
uvx --from workspace-mcp workspace-cli call start_google_auth \
  user_google_email="$USER_GOOGLE_EMAIL" \
  service_name=gmail
```

Open the printed Google URL, approve the read-only scopes, and let it redirect
to `http://localhost:8000/oauth2callback`. Verify the cached login with:

```bash
uvx --from workspace-mcp workspace-cli call search_gmail_messages \
  user_google_email="$USER_GOOGLE_EMAIL" \
  query="newer_than:30d" \
  max_results=3
```

Credentials are cached under `~/.google_workspace_mcp/credentials`. Stop the
temporary HTTP MCP server after verification; Alfred uses the stdio MCP path
during the actual demo.

Run `bun run agent:test -- --interactive` and ask a Google Workspace question.
The first call may open the local Google OAuth consent flow. After consent,
`workspace-mcp` caches credentials locally and later demo runs should reuse them.

## Files
| File | Role |
|---|---|
| `src/talon.ts` | Starts Talon, configures MCP + agent, sends messages |
| `src/memory-mcp.ts` | Built-in stdio MCP server for seeded company memory |
| `src/company-memory.ts` | Seeded company context used by the MCP server |
| `src/types.ts` | Delegate interface used by ctl |
| `src/server.ts` | Long-running Talon bootstrap process |
| `src/demo-client.ts` | One-shot Talon delegation demo |
