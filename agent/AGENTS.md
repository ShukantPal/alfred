# Project Context — Meeting-Native Company Agent (WeaveHacks 4)

> This file is the source of truth for AI coding tools (Claude Code, Codex). Read it fully
> before generating or editing code. It describes the WHOLE system; the code in this package
> is only the `agent/` layer. Build the rest against the contract in `agent/src/protocol.ts`.

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
screen. Seed data for exactly this is in `agent/src/seed.ts`.

## Architecture (from the team whiteboard — do not deviate without flagging)
Three top-level layers. **All TypeScript.** ESM modules.

```
ctl/            Meeting control plane. Entry-point CLI: `npm run demo https://meet.google.com/XYZ`
                Owns meeting I/O via Recall.ai (audio in/out, screen share, video, recording).
                Owns STT (speech->text) and TTS (text->speech). Owns "address detection"
                (is the agent being spoken to?). Talks to agent/ over ONE WebSocket per meeting.

agent/          THIS PACKAGE. Owns MEMORY + HARNESS. Exposes RPCs over WebSocket:
                  in : sendMessage (text utterance), session (open/close)
                  out: agentMessage (streaming text), agentAction, agentTrace, agentError
                Live orchestrator agent that DELEGATES to subagents. No meeting/audio code here.

computer-use/   MCP server that lets the agent log into a URL and present it, then connects to
                ctl/ to screen-share it. Entry: `npm run demo-computer-use https://docs.google.com/XYZ`
                Use Browserbase for the browser. Record/pipe to Recall.ai.
```

Data/memory: **Redis** ("Redis Iris") — seeded with Slack/chat + Google Docs context, plus
per-meeting working memory. Vector search via RediSearch is the upgrade path (see below).

## Sponsor mapping (this hackathon — using these well wins prizes)
- **Weave (W&B)** — REQUIRED. Tracing/observability. Every agent + subagent node is a `weave.op`
  so the trace renders as the delegation tree. `weave.init(project)` at server startup. This is
  also the "harness sophistication" judging criterion made visible. Best Use of Weave: $1k.
- **Redis** — memory layer. Keep it central; upgrade `Memory.retrieve` to RediSearch KNN vector
  search to compete for Best Use of Redis (keyboards + credits + hoodies).
- **CopilotKit / AG-UI** — for the stretch-goal product UI (live agent UI in a frontend). Best
  Use of CopilotKit: AirPods Max.
- **Recall.ai** — meeting bot I/O (lives in ctl/ and computer-use/). Not a prize sponsor but the
  backbone of meeting join + screen share. (Judge from Daily/Pipecat is present — Pipecat is the
  natural choice if real-time voice turn-taking gets hard.)
- **OpenAI, Cursor** — general sponsors/credits.

## The contract between ctl/ and agent/ (READ `agent/src/protocol.ts`)
WebSocket + JSON. One socket per meeting. "RPC" = a typed envelope with a `correlationId` so a
streamed response matches its request.

Inbound (ctl/ -> agent/):
- `sendMessage { correlationId, meetingId, speaker{id,displayName}, text, ts, addressedToAgent }`
- `session { action: "open"|"close", meetingId, participants? }`

Outbound (agent/ -> ctl/):
- `agentMessage { correlationId, meetingId, delta, done }`  ← stream tokens; pipe delta to TTS/screen
- `agentAction  { ..., action: presentUrl|postSlack|createLinearIssue, requiresConfirmation }`
- `agentTrace   { ..., node, event:"start"|"finish", detail? }`  ← live delegation tree
- `agentError   { ..., message }`

KEY RULE: the agent only produces a turn when `addressedToAgent === true`. All other utterances
are logged to working memory but NOT answered, so the bot doesn't talk over human crosstalk.
ctl/ is responsible for setting `addressedToAgent` (wake word / direct-address detection).

## agent/ internals (this package)
- `src/protocol.ts` — the wire contract (zod-validated inbound, typed outbound). SOURCE OF TRUTH.
- `src/memory.ts`   — Redis memory: company context (ContextDoc with `owner`) + per-meeting turns.
                      Has an in-memory FALLBACK if Redis is unreachable (demo-safe; not for prod).
                      `retrieve()` is keyword-scored now — swap for RediSearch KNN to win Redis.
- `src/harness.ts`  — orchestrator -> subagents (docs/people/memory) -> synthesizer (streams out).
                      Orchestrator + subagents use a FAST model; synthesis uses a SMART model.
                      Every node is a weave.op.
- `src/llm.ts`      — LLM provider: ONE OpenAI-compatible client (W&B Inference or OpenAI),
                      wrapped with `weave.wrapOpenAI` so every chat call is traced from the start.
- `src/server.ts`   — WebSocket server exposing the RPCs; `weave.init` here.
- `src/seed.ts`     — seeds the holiday use case.
- `src/demo-client.ts` — simulates ctl/ to exercise the layer without meeting plumbing.

## LLM provider (OpenAI-compatible; W&B Inference default)
We use the OpenAI SDK against an OpenAI-compatible endpoint, switchable via `LLM_PROVIDER`:
- `wandb` (DEFAULT) — **W&B Inference** at `https://api.inference.wandb.ai/v1`. The SAME
  `WANDB_API_KEY` powers BOTH inference and Weave tracing — one key lights up everything.
- `openai` — OpenAI directly with `OPENAI_API_KEY`.
The client is wrapped with `weave.wrapOpenAI`, so each `chat.completions.create` is a Weave
span nested under its owning `weave.op` node (orchestrator/docs/people/synth). Weave from the
get-go — no extra instrumentation needed for LLM calls.

### Models (config, change freely — see `src/llm.ts`)
- wandb  → FAST `Qwen/Qwen3-30B-A3B-Instruct-2507` (orchestrator + spawned subagents),
           SMART `Qwen/Qwen3-235B-A22B-Instruct-2507` (synthesis + tool/action decisions)
- openai → FAST `gpt-4o-mini`, SMART `gpt-4o`
Both wandb models are *Instruct* (non-thinking) for low live-meeting latency and strong
tool-calling — the agent fans out to subagents and calls tools (Drive, present). Override any with
`FAST_MODEL` / `SMART_MODEL` / `LLM_BASE_URL`. If tool-calling proves flaky, swap SMART to
`nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8` (purpose-built agentic). Keep subagents on the
fast model — slow sequential calls compound into latency.

## Run (agent/ only)
```
cd agent
cp .env.example .env        # set WANDB_API_KEY (default provider); REDIS_URL optional (fallback)
npm install
npm run dev                 # start WebSocket server on ws://localhost:8787
npx tsx src/seed.ts         # seed company context (use real Redis so server shares the store)
npm run demo                # simulate ctl/: asks the holiday question, prints streamed answer + trace
```
Env: `WANDB_API_KEY` (default provider + Weave), or `OPENAI_API_KEY` with `LLM_PROVIDER=openai`;
plus optional `REDIS_URL`, `WEAVE_PROJECT`, `AGENT_PORT`. See `.env.example`.
NOTE: seed and server are separate processes — with the in-memory fallback the seed won't be
visible to the server. Run a real Redis (`docker run -p 6379:6379 redis`) so both share state.

## What to build next (priorities for the other layers / agents)
1. **ctl/** — Recall.ai bot join + STT + TTS + address detection; open one WS to agent/ per
   meeting; pipe `agentMessage.delta` to TTS and screen. Implement `agentAction` execution with
   a HUMAN CONFIRMATION step for anything side-effectful (present, Slack, Linear).
2. **computer-use/** — Browserbase MCP: log into a Google Doc URL, render/present it, hand the
   shareable view to ctl/. Triggered by an `agentAction { presentUrl }`.
3. **Redis upgrade** — embeddings + RediSearch FT.SEARCH KNN in `Memory.retrieve` (same interface).
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
- **Ground answers in retrieved context**; if context is missing, the agent says so rather than
  guessing (already enforced in the synthesizer system prompt).

## Conventions
- TypeScript, ESM (`"type": "module"`), Node 20+. Strict mode on.
- Validate all inbound frames with zod (see protocol.ts). Outbound frames are plain typed objects.
- Wrap every agent/subagent reasoning step in `weave.op` so it shows in the trace.
- Keep the protocol stable: if you change it, change `protocol.ts` and update this file in the same commit.
```
