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
credentials are present and the configured command is executable. Slack
auto-attaches when auth is present, and GitHub is available as an opt-in remote
HTTP MCP for real workspace/repo context.

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
- `TALON_GRPC_PORT`: local Talon gRPC port used by ctl/agent, default `53100`.
- `TALON_UI_PORT`: local Talon UI/REST port, default `53101`.
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
- `TALON_SLACK_MCP_ENABLED`: optional Slack MCP override. Slack auto-attaches when auth is present; set `false`, `0`, or `off` to force-disable it.
- `TALON_SLACK_MCP_NAME`: Slack MCP server name in Talon, default `slack`.
- `TALON_SLACK_MCP_URL`: Slack MCP Streamable HTTP endpoint, default `https://mcp.slack.com/mcp`.
- `TALON_SLACK_MCP_AUTH_TOKEN`: bearer token for Slack MCP. If this is an `xoxb-...` bot token and the target is Slack's hosted MCP URL, Alfred routes it to the local bot-token MCP instead.
- `SLACK_BOT_TOKEN` / `TALON_SLACK_BOT_TOKEN`: Slack bot token for Alfred's local read-only Slack MCP.
- `TALON_SLACK_BOT_MCP_COMMAND`: command for Alfred's local Slack bot MCP, default is the current Bun executable.
- `TALON_SLACK_BOT_MCP_ARGS_JSON`: JSON string array of local Slack bot MCP command args, default points at `agent/src/slack-mcp.ts`.
- `TALON_SLACK_MCP_HEADERS_JSON`: optional JSON object of Slack MCP headers.
- `TALON_GITHUB_MCP_ENABLED`: enable official remote GitHub MCP auto-attach, default `false`.
- `TALON_GITHUB_MCP_NAME`: GitHub MCP server name in Talon, default `github`.
- `TALON_GITHUB_MCP_URL`: GitHub remote MCP endpoint, default `https://api.githubcopilot.com/mcp/`.
- `TALON_GITHUB_MCP_AUTH_TOKEN`: bearer token for GitHub MCP. Falls back to `GITHUB_PERSONAL_ACCESS_TOKEN` or `GITHUB_PAT`.
- `TALON_GITHUB_MCP_READ_ONLY`: add the GitHub MCP read-only header, default `true`.
- `TALON_GITHUB_MCP_TOOLSETS`: optional comma-separated GitHub MCP toolsets, for example `issues,pull_requests,repos`.
- `TALON_GITHUB_MCP_TOOLS`: optional comma-separated GitHub MCP tools.
- `TALON_GITHUB_MCP_EXCLUDE_TOOLS`: optional comma-separated GitHub MCP tools to exclude.
- `TALON_GITHUB_MCP_HEADERS_JSON`: optional JSON object of GitHub MCP headers.
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

### Slack MCP

Slack MCP auto-attaches when Slack auth is present because it can expose real
Slack workspace history and can offer write-capable tools. For a real meeting
demo, use only a consented demo workspace or an internal workspace where admins
have explicitly approved the MCP client/app.

There are two Slack paths:

- Hosted Slack MCP: user OAuth through `https://mcp.slack.com/mcp`.
- Local Alfred Slack bot MCP: stdio MCP in `agent/src/slack-mcp.ts` using a
  normal Slack bot token.

For the hackathon demo, the bot-token path is usually simpler:

```bash
SLACK_BOT_TOKEN=xoxb-...
```

or:

```bash
TALON_SLACK_BOT_TOKEN=xoxb-...
```

The local bot MCP exposes read-only tools:

- `slack_auth_test`
- `slack_list_channels`
- `slack_read_channel`
- `slack_read_thread`
- `slack_search_recent_messages`
- `slack_find_users`

Bot-token limitations: this is not Slack global search. The bot can only list
and read conversations its token is allowed to access. For private channels, add
the bot to the channel. For useful read access, the Slack app should have scopes
such as `channels:read`, `channels:history`, `groups:read`, `groups:history`,
`mpim:history`, `im:history`, `users:read`, `users:read.email`, and
`files:read`, depending on what you want Alfred to inspect.

Alfred's current Talon integration registers MCPs by server ref. That path can
pass static headers to the remote MCP server, so it supports a pre-authorized
bearer/header setup:

```bash
TALON_SLACK_MCP_AUTH_TOKEN=...
```

or, if the gateway/client gives you complete headers:

```bash
TALON_SLACK_MCP_HEADERS_JSON='{"Authorization":"Bearer ..."}'
```

To force-disable Slack even when auth is present:

```bash
TALON_SLACK_MCP_ENABLED=false
```

Slack's official endpoint is `https://mcp.slack.com/mcp`; override it only if
you put a Slack MCP gateway/proxy in front of the official endpoint:

```bash
TALON_SLACK_MCP_URL=https://your-slack-mcp-gateway.example.com/mcp
```

Important auth note: Slack's direct hosted setup in IDEs uses interactive OAuth
metadata (`CLIENT_ID`) and a connect button. This repo does not yet wire that
OAuth flow into Talon. To use Slack's hosted OAuth flow directly from Alfred,
move Slack from the current server-ref path to a Talon MCP auth-broker binding
and verify the callback/cache behavior before the demo.

Do not use a normal Slack bot token (`xoxb-...`) against
`https://mcp.slack.com/mcp`. Slack's hosted MCP endpoint returns
`invalid_token_type` for bot tokens. Alfred detects that combination and routes
to the local bot-token MCP instead.

Until that auth-broker path is implemented, the practical options are:

- Use the local bot-token MCP with `SLACK_BOT_TOKEN` / `TALON_SLACK_BOT_TOKEN`.
- Use a pre-authorized bearer/header path if Slack or an internal gateway gives
  you one.
- Run an internal Slack MCP gateway that handles Slack OAuth outside Alfred and
  exposes a bearer-protected MCP endpoint to Talon.
- Keep Slack facts in the seeded `company-memory` MCP for the stage demo.

Alfred's delegate prompt forbids Slack side effects such as sending messages,
creating channels, adding reactions, or modifying canvases. Still keep Slack
app scopes and admin approval as narrow as possible.

After configuring env, start the agent and confirm Slack is attached:

```bash
bun run agent:dev
```

Look for a line like:

```text
[agent] MCP slack stdio -> /path/to/bun /path/to/agent/src/slack-mcp.ts
```

Then test a Slack-specific question:

```bash
bun run agent:test -- --question "Search Slack for Priya's latest onboarding redesign blocker"
```

If Slack does not attach, check that `TALON_SLACK_MCP_AUTH_TOKEN` or
`SLACK_BOT_TOKEN` / `TALON_SLACK_BOT_TOKEN` / `TALON_SLACK_MCP_HEADERS_JSON` is
present and that `TALON_SLACK_MCP_ENABLED` is not set to `false`, `0`, or `off`.

### GitHub MCP

GitHub MCP is also opt-in and defaults to read-only mode:

```bash
TALON_GITHUB_MCP_ENABLED=true
TALON_GITHUB_MCP_AUTH_TOKEN=...
TALON_GITHUB_MCP_TOOLSETS=issues,pull_requests,repos
```

The default endpoint is GitHub's hosted MCP server at
`https://api.githubcopilot.com/mcp/`. `TALON_GITHUB_MCP_READ_ONLY=true` adds
`X-MCP-Readonly: true`, which disables write tools even when broader toolsets are
requested.

Create a token with the minimum access needed for the repositories in the demo.
For fine-grained tokens, grant repository access only to the demo repo(s), then
enable read permissions for the areas you need, such as repository contents,
issues, pull requests, metadata, Actions, and security events. For classic PATs,
use the smallest scopes that still expose the needed repo, issue, and PR data.

You can provide the token through any of these env vars:

```bash
TALON_GITHUB_MCP_AUTH_TOKEN=...
# or
GITHUB_PERSONAL_ACCESS_TOKEN=...
# or
GITHUB_PAT=...
```

Keep read-only mode on for the meeting agent:

```bash
TALON_GITHUB_MCP_READ_ONLY=true
```

Optionally restrict the visible tool surface:

```bash
TALON_GITHUB_MCP_TOOLSETS=issues,pull_requests,repos
TALON_GITHUB_MCP_EXCLUDE_TOOLS=create_issue,create_pull_request,merge_pull_request
```

If you need to pass headers directly, use JSON:

```bash
TALON_GITHUB_MCP_HEADERS_JSON='{"Authorization":"Bearer github_pat_...","X-MCP-Readonly":"true","X-MCP-Toolsets":"issues,pull_requests,repos"}'
```

Start the agent and confirm GitHub is attached:

```bash
bun run agent:dev
```

Look for:

```text
[agent] MCP github http -> https://api.githubcopilot.com/mcp/
```

Then test a repo-specific question:

```bash
bun run agent:test -- --question "Check GitHub issues and PRs for blockers to shipping the onboarding redesign"
```

If GitHub is skipped, set one of the token env vars above. If the MCP attaches
but a tool fails, check that the token has repo access and the required read
permissions for the requested issue, PR, file, Actions, or advisory data.

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
