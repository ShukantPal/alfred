# Project Context — Meeting-Native Company Agent (WeaveHacks 4)

> This file is the source of truth for AI coding tools (Claude Code, Codex). Read it fully
> before generating or editing code. It describes the WHOLE monorepo and the ctl/agent
> contract in `agent/src/types.ts`.

## What we are building (one line)
A bot that joins a company's meetings, holds company-wide context (Google Drive docs, Slack,
projects), converses by voice in real time, and can present/build/visualize company documents
on screen — so when the person who knows something is unavailable (e.g. on holiday), you can
spin up a meeting with the agent and ask it instead.

## Canonical use case (build and demo around this)
A user needs to ask a colleague (Priya) whether the onboarding redesign is safe to ship to
prod. Priya is on PTO. Instead of waiting, the user asks the agent in a live meeting. The agent
retrieves Priya's owned docs/Slack from memory, finds the blocking note ("don't ship until the
empty-workspace race is fixed"), and answers directly — then can present the relevant doc on
screen. Seed data for exactly this is in `agent/src/company-memory.ts`.

## Architecture (from the team whiteboard — do not deviate without flagging)
Three top-level layers. **All TypeScript.** ESM modules.

```
ctl/            Meeting control plane. Entry-point CLI: `bun run demo https://meet.google.com/XYZ`
                Owns meeting I/O via Recall.ai (audio in/out, screen share, video, recording).
                Owns OpenAI Realtime voice, wake-word/address detection, and side-effect tools.
                When the voice model calls `delegate_to_company_agent`, ctl invokes agent/ as a
                TypeScript library.

agent/          Owns company-memory delegation through a local Talon runtime. It configures a
                Talon agent, attaches MCP servers, creates/reuses a Talon session per meeting,
                streams the Talon response, and returns text to ctl. No meeting/audio code here.

computer-use/   MCP server that lets the agent log into a URL and present it, then connects to
                ctl/ to screen-share it. Entry: `bun run demo-computer-use https://docs.google.com/XYZ`
                Use Browserbase for the browser. Record/pipe to Recall.ai.
```

Data/memory: the current demo uses `agent/src/memory-mcp.ts` over stdio with seeded mock company
context. Redis remains the intended production memory layer via an external company-memory MCP
(`TALON_COMPANY_MCP_URL` or `REDIS_MCP_URL`).

## Sponsor mapping (this hackathon — using these well wins prizes)
- **Weave (W&B)** — REQUIRED. Tracing/observability. Every agent + subagent node is a `weave.op`
  so the trace renders as the delegation tree. `weave.init(project)` at server startup. This is
  also the "harness sophistication" judging criterion made visible. Best Use of Weave: $1k.
- **Redis** — production memory layer. Keep the MCP boundary central; migrate the current seeded
  stdio MCP to a Redis-backed MCP and then upgrade retrieval to RediSearch KNN.
- **CopilotKit / AG-UI** — for the stretch-goal product UI (live agent UI in a frontend). Best
  Use of CopilotKit: AirPods Max.
- **Recall.ai** — meeting bot I/O (lives in ctl/ and computer-use/). Not a prize sponsor but the
  backbone of meeting join + screen share. (Judge from Daily/Pipecat is present — Pipecat is the
  natural choice if real-time voice turn-taking gets hard.)
- **OpenAI, Cursor** — general sponsors/credits.

## The contract between ctl/ and agent/ (READ `agent/src/types.ts`)
`agent/` exports a TypeScript library used by ctl:

- `createTalonCompanyDelegateFromEnv(process.env)` creates a `CompanyDelegate`.
- `CompanyDelegate.ready()` starts Talon, configures the namespace/agent, and attaches MCPs.
- `CompanyDelegate.ask({ meetingId, speaker, question })` sends one delegated question to a
  meeting-scoped Talon session and returns the answer text.
- `CompanyDelegate.close()` stops the local Talon node.

KEY RULE: ctl decides when the voice model may respond. ctl performs wake-word/address detection
and the Realtime model only delegates after an addressed turn. agent/ is only called from the
voice model's `delegate_to_company_agent` tool path.

## agent/ internals
- `agent/src/types.ts`          — delegate interface used by ctl.
- `agent/src/talon.ts`          — starts Talon, configures provider, namespace, MCPs, agent, sessions.
- `agent/src/memory-mcp.ts`     — built-in stdio MCP server for seeded company memory.
- `agent/src/company-memory.ts` — seeded holiday/onboarding context used by the MCP server.
- `agent/src/observability.ts`  — Weave initialization.
- `agent/src/server.ts`         — long-running Talon bootstrap process for debugging.
- `agent/src/demo-client.ts`    — one-shot Talon delegation demo.
- `agent/src/test-agent.ts`     — CLI entrypoint for testing the delegate.

## LLM provider (OpenAI-compatible)
Talon is configured with one OpenAI-compatible provider, switchable via `LLM_PROVIDER`:
- `openai` (DEFAULT) — OpenAI directly with `OPENAI_API_KEY`.
- `wandb` — W&B Inference at `https://api.inference.wandb.ai/v1` with `WANDB_API_KEY`.

`OPENAI_API_KEY`, `WANDB_API_KEY`, and `TALON_JWT_SECRET` are required by the current setup.
Override the delegate model with `TALON_MODEL`; default is `gpt-4.1-mini` for OpenAI or
`ibm-granite/granite-4.1-8b` for W&B Inference.

Weave remains required instrumentation. `agent/src/talon.ts` wraps Talon startup, bootstrap, and
ask operations with `weave.op`, and `WEAVE_PROJECT` controls the project name.

## Run (agent/ only)
```
cp agent/.env.example agent/.env  # set OPENAI_API_KEY, WANDB_API_KEY, TALON_JWT_SECRET
bun install                 # run from repo root
bun run agent:dev           # start a local Talon node and keep it alive
bun run agent:demo          # asks the holiday question, prints the answer, exits
bun run agent:test -- --interactive
```
Env: see `agent/.env.example`.

MCPs:
- The built-in `company-memory` stdio MCP always attaches unless replaced by
  `TALON_COMPANY_MCP_URL` or `REDIS_MCP_URL`.
- Google Workspace MCP is optional and read-only by default. It is only attached when
  Google OAuth env credentials are set, or a client secret file exists via
  `GOOGLE_CLIENT_SECRET_PATH` / `GOOGLE_CLIENT_SECRETS` / repo-root `client_secret.json`, and the
  stdio command (`uvx` by default) is executable.
- DuckDuckGo search MCP is optional, no-auth, and read-only. It is attached with
  `uvx duckduckgo-mcp-server` by default when `uvx` is executable.

## What to build next (priorities for the other layers / agents)
1. **Google Workspace MCP validation** — complete OAuth setup and verify Talon can retrieve Gmail,
   Drive, Docs, and Calendar context through stdio tools.
2. **Redis upgrade** — replace the seeded company-memory stdio MCP with the Redis-backed MCP,
   then add embeddings + RediSearch KNN retrieval.
3. **computer-use/** — Browserbase MCP: log into a Google Doc URL, render/present it, hand the
   shareable view to ctl/. Triggered through a ctl-side voice tool with human confirmation.
4. **Proactive watcher (optional, on the whiteboard)** — an always-on subagent that monitors the
   transcript for factual errors / off-track / compliance and emits an agentAction (e.g. DM in
   Slack). This is a DIFFERENT trigger model from `addressedToAgent` — build as a separate watcher,
   do not entangle with the request/response path.
5. **CopilotKit UI** — stretch: live agent UI showing the delegation tree (consume agentTrace).

## Guardrails (state these in the pitch — judges reward it)
- **Consent**: a bot joining/recording a meeting and ingesting a colleague's Drive raises consent
  on two fronts (participants know a bot is listening; whose context is queryable by whom). For the
  demo, use the seeded mock data + a consented mock meeting and SAY SO on stage. Do not surface a
  real person's private docs live.
- **Side effects require confirmation**: never auto-send Slack/Linear/email or auto-present without
  the `requiresConfirmation` gate honored in ctl/.
- **Ground answers in retrieved context**; if context is missing, the delegate says so rather than
  guessing.

## Conventions
- TypeScript, ESM (`"type": "module"`), Node 20+. Strict mode on.
- Keep the ctl/agent interface stable in `agent/src/types.ts`; update this file in the same commit
  if that contract changes.
- Wrap Talon startup, bootstrap, and delegated ask operations in `weave.op` so they show in traces.
