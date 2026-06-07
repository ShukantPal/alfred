# Fan-out Delegation Harness — Design Spec

**Date:** 2026-06-06
**Layer:** historical `agent/` harness
**Status:** Superseded by Talon-backed Realtime delegation

## Goal

A live, interactive harness that, on each addressed utterance, **plans → fans out parallel
subagents that each "understand" one relevant document → synthesizes a streamed, grounded
answer**. Every node is a `weave.op`, so the Weave trace *is* the delegation tree. Optionally
emits `agentAction { presentUrl }` when present-mode is on.

This replaces the current fixed `orchestrate → docs → people → synth` flow with a true
parallel fan-out, and splits the monolithic `harness.ts` into focused modules.

## Decisions (from brainstorming)

- **Data source:** seed data now (Slack/chat + Google Docs in Redis); live Google Drive later
  behind the same `Memory` interface — no harness change required.
- **Topology:** parallel fan-out + synthesizer (planner spawns N subagents at once; a
  synthesizer merges). No critic co-agent yet (YAGNI; noted as future option).
- **Output:** BOTH text and present-on-screen, behind a runtime toggle (`presentMode`,
  default off). When on, the harness also emits `agentAction { presentUrl }` for the doc the
  planner selected.
- **Planner style:** planner-selected fan-out (an LLM picks the relevant subset of candidate
  docs + an optional present doc) rather than naive "one subagent per retrieved hit".

## Components (flat in `agent/src/`, matching existing layout)

| File | Responsibility | Model |
|---|---|---|
| `harness-types.ts` | `Plan`, `SubagentTask`, `Finding`, `PresentChoice` types | — |
| `planner.ts` | Given question + candidate catalog → choose docs to investigate (+ optional present doc). Pure `parsePlannerResponse` helper for testing | FAST |
| `subagent.ts` | One worker: extract a focused `Finding` from its assigned doc relative to the question | FAST |
| `synthesizer.ts` | Merge findings + recent turns → **stream** the answer as `agentMessage` deltas | SMART |
| `harness.ts` | `Harness` class: retrieve candidates → plan → parallel subagents (concurrency-capped) → synthesize; emits `agentTrace` per node; emits `agentAction` if present-mode | — |

`memory.ts` gains an optional `url` field on `ContextDoc` (needed for `presentUrl`; seed docs
get placeholder URLs, real Drive supplies real ones). `llm.ts` unchanged.

## Data flow

1. `server.ts` receives `sendMessage` (addressed) → `appendTurn` → `harness.handle()`.
2. **Retrieve** candidates: `memory.retrieve(text, 8)` → catalog of `ContextDoc`.
3. **Planner** (`trace planner`): FAST LLM selects `tasks: SubagentTask[]` (doc + focus angle)
   and optional `present: { docId }`. Fallback: top-N candidates if plan empty/invalid.
4. **Fan-out** (`trace subagent:<docId>` each): run subagents in parallel via
   `Promise.allSettled`, concurrency cap 5. Each returns a `Finding`; failures are dropped.
5. **Synthesize** (`trace synth`): SMART LLM streams the grounded answer → `agentMessage`
   deltas + final `done`.
6. If `presentMode && plan.present`: emit
   `agentAction { kind: "presentUrl", url, title }, requiresConfirmation: true`.

## Error handling / grounding

- No candidates retrieved → synthesizer states it lacks context (system prompt forbids guessing).
- Subagent failure → that finding dropped; others proceed.
- Planner parse failure → fallback to top-N candidates.
- Any unhandled error → `agentError` frame.
- Concurrency cap prevents API hammering and dead air.

## Testing (TDD)

- **Unit (vitest, mock LLM client + in-memory Memory):**
  - `parsePlannerResponse`: valid JSON, malformed JSON, ids not in catalog, present on/off.
  - `subagent`: returns a well-formed `Finding`; tolerates empty model output.
  - `harness.handle`: emits `planner`/`subagent:*`/`synth` traces, streams `agentMessage`
    deltas, and emits `agentAction` only when `presentMode` is on.
- **Integration:** extend `smoke.ts` to run the full fan-out against Redis Cloud seed data for
  two questions (holiday + brand deck), printing the delegation tree, the streamed answer, and
  any `agentAction`. This is the "workable demo".

## Seed data (board item 5)

Expand `seed-data.ts` to several Slack/chat threads and Google Docs across multiple owners, so
a single question pulls several docs → several parallel subagents. Add `url` to each doc.

## Future seams (not in this iteration)

- Live Google Drive loader writing `ContextDoc`s into `Memory` (same interface).
- Critic co-agent verifying groundedness before synthesis.
- RediSearch KNN vector retrieval (swap `Memory.retrieve` internals).
- Legacy `ctl/ ↔ agent/` wiring is superseded by Realtime tool calls into Talon-backed delegates.
