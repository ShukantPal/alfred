# agent/ — Meeting-Native Company Agent (memory + harness)

The `agent/` layer for the WeaveHacks 4 project: a bot that joins company meetings, holds
company-wide context, and answers you live — e.g. when the person who knows the answer is on
holiday, ask the agent instead.

This package owns **memory (Redis)** and the **harness** (a live orchestrator that delegates to
subagents). It exposes RPCs over a WebSocket that the meeting control plane (`ctl/`) connects to.
It contains no meeting/audio code — that lives in `ctl/`.

**For AI coding tools and full system context, read [AGENTS.md](./AGENTS.md).**

## Quick start
```bash
cp .env.example .env          # set WANDB_API_KEY — powers W&B Inference + Weave (REDIS_URL optional; in-memory fallback if absent)
npm install
docker run -p 6379:6379 redis # recommended so seed + server share state
npm run dev                   # WebSocket server on ws://localhost:8787
npx tsx src/seed.ts           # seed the "Priya is on PTO" company context
npm run demo                  # simulate ctl/: ask the holiday question; see streamed answer + trace
```

## The contract (what `ctl/` codes against)
`src/protocol.ts` is the single source of truth. WebSocket + JSON, one socket per meeting.
- ctl/ -> agent/: `sendMessage`, `session`
- agent/ -> ctl/: `agentMessage` (streaming), `agentAction`, `agentTrace`, `agentError`
- The agent answers only when `addressedToAgent === true`.

## Files
| File | Role |
|---|---|
| `src/protocol.ts` | Typed RPC wire contract (source of truth) |
| `src/llm.ts` | OpenAI-compatible client (W&B Inference / OpenAI), Weave-wrapped |
| `src/memory.ts` | Redis memory + retrieval (in-memory fallback included) |
| `src/harness.ts` | Orchestrator → subagents → streaming synthesizer (Weave-traced) |
| `src/server.ts` | WebSocket server; `weave.init` |
| `src/seed.ts` | Seeds the holiday use case |
| `src/demo-client.ts` | Simulates ctl/ end-to-end |

## Sponsor hooks
Weave (every node is a `weave.op` → trace = delegation tree), Redis (memory; upgrade `retrieve`
to RediSearch KNN), CopilotKit (stretch UI via `agentTrace`). See AGENTS.md for the full mapping.
