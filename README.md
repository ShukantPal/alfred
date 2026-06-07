# Alfred

Alfred is a live meeting participant. The current control plane lives in `ctl/`
and uses Recall.ai to send a bot into a meeting.

## Monorepo

Alfred is a Bun workspace monorepo:

- `ctl/`: meeting control plane, Recall.ai integration, media pages, and OpenAI Realtime voice.
- `agent/`: Talon bootstrap/configuration for Alfred's company-memory delegate.

Use the root `bun.lock` as the only lockfile. Do not run package-manager installs
inside workspace packages.

## Demo

Install dependencies:

```sh
bun install
```

Alfred does not require `cloudflared` on your system `PATH`. Tunnel startup
looks for a binary in this order:

1. `CLOUDFLARED_BIN`
2. `./.tools/cloudflared`
3. `../Take3/.tools/cloudflared`

Or set `ALFRED_PUBLIC_BASE_URL` to an existing public HTTPS URL that forwards to
the ctl server.

Run the demo:

```sh
export RECALL_API_KEY=...
export OPENAI_API_KEY=...
export ALFRED_VOICE_PROVIDER=openai-realtime
bun run demo <meeting-link>
```

The demo starts a local ctl server, creates a Cloudflare quick tunnel, prints the
public webhook URL, and creates a Recall bot for the meeting.

Cloudflare quick tunnels are persistent across demo restarts. Alfred stores
tunnel state and logs under `.tools/`, reuses a live tunnel when possible, and
leaves the tunnel process running when the demo exits.

Stop persistent tunnels:

```sh
bun run demo:stop-tunnels
```

## Agent

The live meeting path no longer uses a bespoke WebSocket harness. OpenAI
Realtime delegates company-context questions through ctl's
`delegate_to_company_agent` tool, and that tool uses `agent/` to create or reuse
a meeting-scoped Talon session. `agent/` attaches a built-in stdio
company-memory MCP server to Talon by default, so the demo does not need a
separate MCP port. `TALON_COMPANY_MCP_URL` or `REDIS_MCP_URL` can still override
that with an external HTTP MCP endpoint.

Run agent commands from the repo root:

```sh
bun run agent:dev    # start/configure a local Talon node
bun run agent:demo   # one-shot Talon delegation demo
bun run agent:test   # ask the Talon delegate directly from the agent layer
bun run agent:check  # typecheck the Talon bootstrap package
```

You can also run the workspace scripts directly:

```sh
bun run --cwd agent dev
```

## Environment

- `RECALL_API_KEY`: Recall.ai API key.
- `RECALL_REGION`: Recall region, default `us-west-2`.
- `RECALL_BOT_VARIANT`: Recall bot instance variant, default `web_4_core`.
- `ALFRED_BOT_NAME`: bot display name, default `Alfred`.
- `ALFRED_CTL_HOST`: local server host, default `127.0.0.1`.
- `ALFRED_CTL_PORT`: local server port, default `4321`.
- `ALFRED_PUBLIC_BASE_URL`: skip Cloudflare startup and use this public URL.
- `CLOUDFLARED_BIN`: explicit path to `cloudflared`.
- `ALFRED_TUNNEL_NAME`: persisted tunnel name, default `ctl`.
- `ALFRED_SHUTDOWN_TIMEOUT_MS`: timeout for asking Recall to remove the bot, default `10000`.
- `ALFRED_REALTIME_DELIVERY`: `webhook`, `websocket`, or `both`; default `webhook`.
- `ALFRED_OUTPUT_MEDIA`: `camera`, `screenshare`, or `none`; default `camera`.
- `ALFRED_AGUI_SCREENSHARE`: render the `agui` CopilotKit panels as Alfred's screenshare; default `true`. Set `0`/`false` to fall back to `ctl`'s `/media/screen`.
- `ALFRED_AGUI_DIR`: path to the `agui` Next app; default `<cwd>/agui`.
- `ALFRED_AGUI_PORT`: local port for the `agui` Next server; default `3000`.
- `ALFRED_AGUI_PUBLIC_BASE_URL`: skip starting/tunneling `agui` and use this public URL (run `agui` yourself).
- `ALFRED_AGUI_SCREENSHARE_PATH`: route Recall renders for the screenshare; default `/screenshare`.
- `ALFRED_VOICE_PROVIDER`: only `openai-realtime` is supported.
- `OPENAI_API_KEY`: enables OpenAI Realtime voice.
- `OPENAI_REALTIME_MODEL`: OpenAI Realtime model, default `gpt-realtime-2`.
- `OPENAI_REALTIME_VOICE`: OpenAI Realtime voice, default `cedar`.
- `OPENAI_REALTIME_REASONING_EFFORT`: Realtime reasoning effort, default `low`.
- `OPENAI_REALTIME_TRANSCRIPTION_MODEL`: Realtime input transcription model for wake-word gating, default `gpt-4o-transcribe`.
- `ALFRED_WAKE_WORD`: word required before ctl triggers a Realtime model response, default `alfred`.
- `OPENAI_REALTIME_NOISE_REDUCTION`: input noise reduction, `near_field`, `far_field`, or `none`; default `near_field`.
- `OPENAI_REALTIME_VAD_TYPE`: `semantic_vad` or `server_vad`; default `semantic_vad`.
- `OPENAI_REALTIME_VAD_THRESHOLD`: server VAD activation threshold, default `0.7`; higher values require louder speech and can help in noisy rooms.
- `OPENAI_REALTIME_VAD_SILENCE_MS`: server VAD silence duration, default `700`.
- `OPENAI_REALTIME_VAD_PREFIX_PADDING_MS`: server VAD prefix padding, default `300`.
- `OPENAI_REALTIME_SEMANTIC_VAD_EAGERNESS`: semantic VAD eagerness, `low`, `medium`, `high`, or `auto`; default `medium`.
- `OPENAI_REALTIME_INPUT_SAMPLE_RATE`: Recall raw audio sample rate, default `16000`.
- `OPENAI_REALTIME_OUTPUT_SAMPLE_RATE`: PCM playback sample rate for Realtime output, default `24000`.
- `OPENAI_REALTIME_INSTRUCTIONS`: override Alfred's realtime system instructions.
- `WANDB_API_KEY`: required; enables Weave tracing for Alfred's Talon delegate ops and is used for W&B Inference when `LLM_PROVIDER=wandb`.
- `WEAVE_PROJECT`: Weave project name, default `meeting-agent`.
- `LLM_PROVIDER`: `openai` or `wandb` for the Talon delegate provider config, default `openai`.
- `TALON_NAMESPACE`: Talon namespace for delegated company-memory sessions, default `alfred`.
- `TALON_COMPANY_AGENT`: Talon agent name used by `delegate_to_company_agent`, default `company-memory`.
- `TALON_PROVIDER_NAME`: provider key configured in Talon, default `openai`.
- `TALON_PROVIDER_BASE_URL`: OpenAI-compatible provider base URL; defaults to OpenAI or W&B Inference based on `LLM_PROVIDER`.
- `TALON_MODEL`: model used by the Talon delegate, default `gpt-4.1-mini` for OpenAI or `ibm-granite/granite-4.1-8b` for W&B Inference.
- `TALON_DATA_DIR`: persistent Talon control-plane data directory, default `.tools/talon/data`.
- `TALON_WORKSPACE_DIR`: Talon workspace directory, default `.tools/talon/workspace`.
- `TALON_JWT_SECRET`: required JWT secret for the local Talon node.
- `TALON_JWT_TTL_SECONDS`: TTL for freshly minted Talon request JWTs, default `86400`. ctl mints a new token for each Talon RPC.
- `TALON_COMPANY_MCP_NAME`: MCP server name configured in Talon, default `company-memory`.
- `TALON_COMPANY_MCP_URL`: optional HTTP MCP endpoint for Redis/company-memory tools. When unset, agent uses its built-in stdio MCP server. `REDIS_MCP_URL` is also accepted.
- `TALON_MEMORY_MCP_COMMAND`: command for the built-in stdio MCP server, default is the current Bun executable.
- `TALON_MEMORY_MCP_ARGS_JSON`: JSON string array of stdio MCP command args, default points at `agent/src/memory-mcp.ts`.
- `TALON_COMPANY_MCP_HEADERS_JSON`: optional JSON object of headers for the company-memory MCP endpoint.
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
- `TALON_DELEGATE_TIMEOUT_MS`: timeout for a Talon delegation call, default `20000`.

Google Workspace MCP is only registered when those auth credentials are present
and the configured stdio command is executable. Otherwise ctl/agent continues
with the built-in company-memory MCP only.

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

Then add these to `.env`:

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

Start Alfred or run `bun run agent:test -- --interactive`, then ask a Google
Workspace question. The first call may open the local Google OAuth consent flow.
After consent, `workspace-mcp` caches credentials locally and later demo runs
should reuse them.

## Control Plane Endpoints

- `GET /health`
- `POST /webhooks/recall`
- `WS /ws/recall`
- `GET /media/camera`
- `GET /media/screen`
- `GET /media/camera.js`
- `GET /media/screen.js`

`/media/camera` serves `ctl/src/media/camera.html`, and `/media/screen` serves
`ctl/src/media/screen.html`. The camera UI is implemented in
`ctl/src/media/camera.ts`, the screen-share UI is implemented in
`ctl/src/media/screen.ts`, and shared websocket/audio playback code lives in
`ctl/src/media/shared.ts`. Bun bundles them at `/media/camera.js` and
`/media/screen.js`.

HTTP routes use Hono. Routes are registered in `ctl/src/routes/index.ts` and
grouped by concern under `ctl/src/routes/`. `ctl/src/server.ts` owns server
lifecycle and websocket handling.

## Voice and Transcription

ctl uses OpenAI's Realtime API as the voice layer. The Recall bot enables
`audio_mixed_raw`, streams raw 16 kHz mono PCM audio to `/ws/recall`, and ctl
forwards those PCM chunks to an OpenAI Realtime WebSocket. ctl keeps Realtime
VAD enabled but disables automatic model responses; it only sends
`response.create` when the completed input transcript contains
`ALFRED_WAKE_WORD` (`alfred` by default). The model's PCM output is sent to
`/ws/media`, where the Output Media page plays it into the meeting.

`agent/` is not the primary responder. ctl exposes `delegate_to_company_agent`
to the Realtime model, and that function creates or reuses a meeting-scoped
Talon session. Talon owns the delegated agent runtime. The delegate gets company
memory from `agent/`'s built-in stdio MCP server by default; set
`TALON_COMPANY_MCP_URL` only when replacing it with an external HTTP
Redis/company-memory MCP server.

If Alfred hears `start screenshare`, ctl calls Recall.ai's runtime Output Media
endpoint for the active bot and starts `/media/screen` as a screenshare. The
screen-share page is static and does not connect to `/ws/media` or play audio;
audio output stays on the camera media page.

There is no REST audio output route. Alfred's spoken responses come directly
from OpenAI Realtime audio deltas and are forwarded to the media page over
`/ws/media` as raw PCM chunks. Recall transcript webhooks are ignored by ctl.

Raw audio websocket payloads are not logged. ctl logs only the realtime event
name and decoded byte count for `audio_mixed_raw.data`.

## Screenshare surface

When `ALFRED_AGUI_SCREENSHARE` is enabled (the default), `bun run demo` boots the
`agui` Next app and opens a second persistent Cloudflare tunnel named `agui` to
it. Whenever Alfred screenshares — either from `ALFRED_OUTPUT_MEDIA=screenshare`
at startup, or the runtime "start screenshare" trigger — Recall renders the
`agui` `/screenshare` route instead of `ctl`'s `/media/screen`. That surface
shows a top bar of app tabs (Docs, Slides, Sheets, etc.), a left sidebar split
between running meeting notes and tasks, and a main workspace for the selected
app. If `agui` fails to start, the demo logs the error and falls back to
`/media/screen`. The `agui` Next server is stopped on `Ctrl+C`; both tunnels
persist and are stopped with `bun run demo:stop-tunnels`.

## Shutdown

When the demo receives `SIGINT` or `SIGTERM`, it calls Recall.ai's
`leave_call` endpoint for the created bot before stopping the local ctl server.
Persistent Cloudflare tunnels are still left running for reuse; stop them with
`bun run demo:stop-tunnels`.
