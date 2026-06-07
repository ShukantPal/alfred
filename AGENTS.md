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
- `CompanyDelegate.updateMeetingNotes({ meetingId, transcript })` runs a meeting-notes subagent
 (its own `weave.op` node, `alfred.talon.meetingNotes`) that summarizes the full retained meeting
 transcript into bullet points. ctl surfaces the returned bullets in the chat pane from the voice
 model's `show_meeting_notes` tool path.
- `CompanyDelegate.extractActionItems({ meetingId, transcript })` runs an end-of-meeting subagent
 (its own `weave.op` node, `alfred.talon.actionItems`) that transforms the full meeting transcript
 into structured `ActionItem[]` (`{ title, assignee, status }`). ctl retains the transcript and
 calls this from the voice model's `create_action_items` tool path, then POSTs the items to agui
 (`/api/meeting/tasks`) and surfaces them in the chat pane as a left-aligned bullet list.
- `CompanyDelegate.matchActionItemForRemoval({ meetingId, query, items })` runs a subagent
 (its own `weave.op` node, `alfred.talon.matchActionItem`) that resolves which existing item a
 spoken removal request refers to (handles paraphrase/synonyms) and returns the matching item id
 or null. ctl fetches the current items from agui, calls this from the `remove_action_item` tool
  path, then removes by id via `/api/meeting/tasks` (`{ op: "remove", id }`).
- `CompanyDelegate.buildVisual({ meetingId, question })` runs a subagent (its own `weave.op` node,
  `alfred.talon.buildVisual`) that retrieves the relevant company data via the general memory tools
  (`company_memory_search` / `company_memory_get`, which surface any doc's structured `data` payload)
  and **chooses the representation**, returning a `VisualSpec`
  (discriminated union: `pie | bar | line | table | text`). It is invoked from agui's CopilotKit
  Talon-bridge agent over ctl's `/api/visual` HTTP endpoint, not from a ctl voice tool directly (see
  "Voice-driven generative UI" below). `VisualSpec` is the ctl/agent contract type (mirrored in
  `agui/lib/visual.ts`).
- `CompanyDelegate.onToolUse(listener)` subscribes to MCP/tool usage during any delegated
  operation (deduped per op, fires as each tool resolves) and returns an unsubscribe function. ctl
  uses it to drive the live side-panel integration highlights (see "Side-panel highlight signals"
  below). Purely observational — it never gates the answer. This is the only non-request/response
  method on the contract.
- `CompanyDelegate.close()` stops the local Talon node.

KEY RULE: ctl decides when the voice model may respond. ctl performs wake-word/address detection
and the Realtime model only delegates after an addressed turn. agent/ is only called from the
voice model's `delegate_to_company_agent` tool path (company-memory Q&A), the
`show_meeting_notes` tool path (meeting notes), the `create_action_items` tool path
(end-of-meeting action items), or `buildVisual` (generative UI, reached via agui's bridge agent ->
ctl `/api/visual`).

The voice model can also edit the action-items list via the `add_action_item` and
`remove_action_item` tools. `add_action_item` is a deterministic ctl-side mutation (no Talon): ctl
POSTs `{ op: "add", item }` to agui's `/api/meeting/tasks`. `remove_action_item` is delegated: ctl
fetches the current items, asks the Talon `matchActionItemForRemoval` subagent which one the spoken
phrase means, then removes by id (`{ op: "remove", id }`). agui retains a lenient lexical
`{ op: "remove", title }` path as a fallback only.

## Screenshare chat mode (ctl -> agui `/api/meeting/chat`)
When the voice model calls `delegate_to_company_agent`, `show_meeting_notes`, or any action-item tool
(`create_action_items`, `add_action_item`, `remove_action_item`), ctl forwards the turn to the agui
screenshare surface so the main window transitions from the `AlfredLanding` view into a chat view
(user questions as right-aligned text bubbles, Alfred's spoken reply as a left-aligned animated
waveform, meeting notes as left-aligned text bullets, and action items as a left-aligned task list).
Chat forwarding is a
DETERMINISTIC side-effect of the already-delegated path, so it is a plain ctl-side POST and is NOT
wrapped in `weave.op` (no new reasoning beyond the delegate method itself). Mechanism:
- ctl emits `ChatMessageEvent`s via the `onChatMessage` callback on the Realtime voice client
  (`ctl/src/realtime/openai.ts`): on delegate it adds `{ op:"add", role:"user", kind:"text", text }`
  and `{ op:"add", id, role:"alfred", kind:"voice", status:"speaking" }`, then settles the waveform
  with `{ op:"update", id, status:"done" }` when the spoken answer's `response.done` fires.
  On meeting notes, ctl adds the user prompt and then an Alfred text bubble containing the updated
  bullet list. On action items, ctl adds the user prompt and then an Alfred text bubble containing
  the current task list (after create, add, or remove).
- `ctl/src/server.ts` forwards each event over the `/ws/notes` WebSocket (`{ type:"chat", event }`)
  for instant rendering and POSTs it to agui's `/api/meeting/chat` (the source of truth for catch-up
  polling), mirroring the transcript/tasks transport.
- agui buffers events in `agui/lib/chatHub.ts`, exposes them at `/api/meeting/chat`
  (`?after=<seq>` / `?full=1`), and renders via `ChatProvider` (derives `mode: "landing" | "chat"`),
  `ChatWatcher`, and `ChatMode`. Chat is in-memory only, like the transcript and tasks buffers.

## Side-panel highlight signals (ctl -> agui `/ws/notes`, transient)
The screenshare left panel (`agui/components/AlfredSidePanel.tsx`) is a compact index, not a live
content dump: single lines for **Meeting Notes** and **Action Items**, then one row per supported
integration (**Redis**/company-memory, **DuckDuckGo**, **Google Docs/Sheets/Slides/Drive**). One or
more rows light up (bold + drop shadow) when Alfred touches them — multiple at once when a single
answer spans several sources — and all rows reset on the next user prompt. This is a transient, ws-only side-effect (like `agui_run`) — there is no
catch-up buffer because the highlight state is inherently live and reset every turn. It is NOT a
`weave.op` (no new reasoning). Mechanism:
- Vocabulary lives in `ctl/src/panel.ts` (`PanelTarget`, `PanelSignalEvent` = `{op:"clear"}` |
  `{op:"highlight", target}`) and is mirrored in `agui/lib/panel.ts`.
- ctl broadcasts `{ type:"panel", event }` over `/ws/notes` via `broadcastPanelToNotes`
  (`ctl/src/server.ts`). Triggers: `onPanelSignal` on the Realtime client emits `clear` at the start
 of each addressed turn and `highlight target:"notes"` on `delegate_to_company_agent` and
 `show_meeting_notes`; the action-item handlers emit `highlight target:"tasks"`; and
 `delegate.onToolUse` maps each MCP tool
  name to integration rows via `panelTargetsForTool` and emits `highlight` for each.
- agui consumes the frames in `ChatWatcher` (`type:"panel"`) and stores the lit set in
  `PanelSignalProvider` (`usePanelSignals`), which `AlfredSidePanel` reads. `clear` empties the set.

## Voice-driven generative UI (CopilotKit/AG-UI, headless)
When a participant asks Alfred to show/visualize/chart company data, Alfred renders an
Alfred-decided chart/table on the screenshare through **real CopilotKit/AG-UI**, re-skinned to match
ChatMode. Talon stays the only brain; CopilotKit is a pure render client. Flow:
- The Realtime model calls the delegated `render_visual` voice tool
  (`ctl/src/realtime/openai.ts`). ctl shows the user's request + an Alfred voice bubble (same chat
  transport as delegate), then ctl broadcasts `{ type: "agui_run", question }` over `/ws/notes`
  (`ctl/src/server.ts` `broadcastAguiRun`). This trigger is ws-only (transient); the spoken answer
  still flows on the Realtime path.
- The screenshare is wrapped headless in `<CopilotKit runtimeUrl="/api/copilotkit">`
  (`agui/app/screenshare/page.tsx`). `ChatWatcher` listens for `agui_run` and calls
  `VisualAgentProvider.ask(question)`, which runs the `alfred-visual` agent programmatically via
  `copilotkit.runAgent()` (the participant never types).
- `alfred-visual` is a custom headless `AbstractAgent` (`agui/lib/talonVisualAgent.ts`) — a protocol
  bridge with **no LLM**. It POSTs the question to ctl's `/api/visual`, which runs
  `delegate.buildVisual` (the Talon `weave.op`), then emits AG-UI events: a `render_chart`
  `TOOL_CALL_*` carrying the `VisualSpec`, plus `RUN_FINISHED`. Registered in
  `agui/app/api/copilotkit/[[...path]]/route.ts` alongside the operator-console `default` agent.
- `VisualAgentProvider` reads the agent's `render_chart` tool calls and renders the `VisualSpec` via
  `agui/components/charts/VisualView.tsx` (Recharts) inside the existing ChatMode layout. A
  dev-only typed trigger (`VisualDevConsole`, shown with `?dev=1`) calls the same `ask` for testing.
- Decision: this **augments** the existing voice/waveform chat (kept as-is); CopilotKit only adds the
  generative visual. Full migration of the whole transcript onto `useAgent` is a noted follow-on.
- Seed data lives in `agent/src/company-memory.ts`: any memory doc may carry an optional structured
  `data` payload (exact numbers for charts/tables), surfaced by the general `company_memory_*` tools.
  No per-dataset tools — the whole memory corpus is the swap point for a real Sheets/Redis source.

## Voice tools: deterministic vs delegated (READ before adding a tool)
There are two layers of model. (1) The OpenAI Realtime voice model in `ctl/src/realtime/openai.ts`
always reasons and *picks* which tool to call. (2) What the tool then *does* is either deterministic
or delegated. Classify every new tool before building it:

- **Deterministic tool** — given its arguments, the effect is a fixed operation with no further
  reasoning (e.g. `add_action_item`, `start_screenshare`). Implement it as a plain ctl handler /
  HTTP call. Do NOT route it through Talon and do NOT wrap it in `weave.op` — there is no reasoning
  to observe.
- **Delegated tool** — its work *is* open-ended reasoning over fuzzy input such as a free-form
  question, a whole transcript, mapping a paraphrased phrase to an existing item, or deciding how to
  visualize data (e.g. `delegate_to_company_agent`, `show_meeting_notes`, `create_action_items`,
  `remove_action_item`, `render_visual`). This needs a second LLM, so it MUST go through a
  `CompanyDelegate` method in `agent/` (Talon), and that method MUST be wrapped in a `weave.op` so
  it shows in the Weave delegation tree. Talon is also where MCP tools (company-memory, Google
  Workspace, DuckDuckGo) are available. Note `render_visual` reaches Talon indirectly: the ctl tool
  triggers an agui CopilotKit run, and the agui bridge agent calls ctl `/api/visual` ->
  `buildVisual` (the `weave.op`).

Rule of thumb: if you would need an LLM to decide the *result*, it is delegated (Talon + Weave).
If the result is a mechanical mutation/side effect, it is deterministic (ctl only).

Steps to add a new voice tool:
1. Register it in `sendSessionUpdate()`'s `tools` array in `ctl/src/realtime/openai.ts` (name,
   description, JSON-schema parameters) and add a `case` in `handleFunctionCall`.
2. Add a matching `on<Tool>` callback to `OpenAIRealtimeVoiceOptions` (+ the private field and
   constructor assignment) and wire it from `ctl/src/server.ts`, where the orchestrator lives
   (it has `aguiBaseUrl`, `delegate`, the retained transcript, etc.).
3. Add a one-line behavior note to `defaultInstructions()` so the model knows when to call it.
4. Deterministic: implement the effect in ctl (often a POST to agui). Delegated: add the method to
   the `CompanyDelegate` contract in `agent/src/types.ts`, implement it in `agent/src/talon.ts`
   wrapped in a new `weave.op`, and update this file's contract section in the same commit.

## agent/ internals
- `agent/src/types.ts`          — delegate interface used by ctl (incl. `VisualSpec`/`buildVisual`).
- `agent/src/talon.ts`          — starts Talon, configures provider, namespace, MCPs, agent, sessions.
- `agent/src/memory-mcp.ts`     — built-in stdio MCP server for seeded company memory (general
  `company_memory_search` / `get` / `list`; `get`/`search` surface a doc's structured `data`).
- `agent/src/company-memory.ts` — seeded holiday/onboarding context + datasets (docs may carry an
  optional structured `data` payload, e.g. quarterly finances) used by the MCP server.
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
