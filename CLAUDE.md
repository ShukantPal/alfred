# CLAUDE.md

See [AGENTS.md](./AGENTS.md) for full project context — the monorepo architecture
(`ctl/`, `agent/`, `computer-use/`), the ctl↔agent contract, sponsor mapping, and
what to build next. That file is the source of truth for the whole system.

This file adds Claude Code–specific guidance for **ctl/** and **agui/** (the meeting
control plane and screenshare surface).

## What this is

Alfred is a live meeting participant: a Recall.ai bot is sent into a meeting, its
audio is transcribed, wake words trigger responses, and Alfred speaks/screenshares
back through Recall's Output Media (a webpage rendered as the bot's camera or screen).

The repo is several loosely-coupled subprojects, not a single app. **`ctl/` is the
meeting control plane** — start there for Recall/STT/TTS. **`agent/`** owns memory
and the delegation harness (see AGENTS.md). **`agui/`** is a Next.js + CopilotKit app
that `ctl` boots and tunnels to use as Alfred's screenshare surface. `meeting-bot/`
is an older standalone test harness.

## Top-level folders

- **`ctl/`** — Meeting control plane (`ctl/src/server.ts`): Recall transcripts/audio,
  wake-word logic, Deepgram STT/TTS, ctl↔agent WebSocket bridge, and fallback Output
  Media pages. Entry point: `bun run demo <meeting-link>` (from repo root). See
  `ctl/README.md` and **ctl architecture** below.
- **`agent/`** — Memory + harness WebSocket server. See AGENTS.md.
- **`agui/`** — Next.js 16 + CopilotKit (v2), independent `package.json` (npm, not Bun).
  Alfred's **screenshare surface** and **operator console**: `ctl` boots it and tunnels
  to it (see `ctl/src/agui.ts`). See **agui design** below.
- **`meeting-bot/`** — Standalone older test harness (npm + tsx). Dispatches a Recall
  bot rendering `../computer-use` (not in this repo). Does not share code with `ctl/`.
- **`.tools/`** — Runtime state (gitignored): persisted Cloudflare tunnel metadata
  (`alfred-tunnels.json`), tunnel/agui logs, and optionally a local `cloudflared`
  binary. Not source code.

Note: `secrets.txt` at the root is untracked and should never be committed (see
`.gitignore` for `.env`, `node_modules/`, `.tools/`, `*.log`, `agui/.next/`).

## Commands (repo root)

```sh
bun install                          # install ctl + agent workspace deps
bun run check                        # typecheck ctl and agent
bun run check:ctl
bun run check:agent
bun run demo <meeting-link>          # start ctl, tunnel, send Recall bot
bun run demo:stop-tunnels            # stop persistent Cloudflare quick tunnels
bun run agent:dev                    # start agent WebSocket server
bun run agent:seed                   # seed company context
bun run agent:demo                   # simulate ctl → agent without a meeting
```

Required env for `demo`: `RECALL_API_KEY`, and `DEEPGRAM_API_KEY` to enable Deepgram
STT/TTS. See root `README.md`, `ctl/README.md`, and `ctl/src/config.ts` for env vars.

`agui/` is a separate npm project (`cd agui && npm install`). The demo runner spawns
it when `ALFRED_AGUI_SCREENSHARE` is on (the default).

## agui design

`agui` has two routes with different audiences:

| Route | Audience | Purpose |
|-------|----------|---------|
| `/` | Operator (local browser) | Monitor the meeting and chat with Alfred |
| `/screenshare` | Recall (cloud browser → meeting video) | Full-frame workspace Alfred screenshares into the call |

### Layout

Both routes share the left **`AlfredSidePanel`** (`components/AlfredSidePanel.tsx`):

- Alfred branding and an activation hint ("Hey, Alfred")
- **`MeetingNotesPanel`** — running meeting notes with speaker + timestamp
- **`TasksPanel`** — action items with open/done status

The **screenshare route** adds a browser-style main area to the right:

- **`AppTabBar`** — tab strip for Alfred + future integrations (Slack, Google Docs,
  Slides, Sheets); tab definitions live in `lib/apps.ts`
- **`AppWorkspace`** — the Alfred home tab shows **`AlfredLanding`** (logo, wake-word
  tips, screenshare hint); other tabs show "Preview — integration coming soon"
  placeholders (URLs are defined in `lib/apps.ts` but not embedded yet)

The **operator console** (`app/page.tsx`) wraps content in **`CopilotKitShell`**
and adds a collapsible **`CopilotSidebar`** for chat. The screenshare route
deliberately has **no CopilotKit** — Recall renders it as video, not an interactive
chat surface.

### Mock vs live data

Meeting notes and tasks are **mocked** for now:

- `lib/mockMeetingNotes.ts` — sample running notes Alfred might capture
- `lib/mockTasks.ts` — sample action items with assignees

Both panels read directly from these mocks. **TODO:** replace with a live feed from
`ctl` as Alfred transcribes and extracts notes/tasks. The copilot does not yet receive
panel context via `useAgentContext`; wiring that up is part of the same integration
work.

### CopilotKit runtime

- Client: `@copilotkit/react-core/v2` via `CopilotKitShell` (`runtimeUrl="/api/copilotkit"`)
- Server: `app/api/copilotkit/[[...path]]/route.ts` — `BuiltInAgent` on `openai/gpt-4o`
- Requires `OPENAI_API_KEY` (see `agui/.env.local.example`); panels render without it

### Voice commands (ctl, not agui)

Wake-word handling lives in `ctl/src/transcript.ts`, not in the Next app:

- **`hello alfred`** — Alfred speaks a greeting (Deepgram TTS → `/ws/media`)
- **`start screenshare`** — ctl calls Recall's runtime Output Media API to show
  the screenshare URL (agui `/screenshare` when available, else `ctl` `/media/screen`)

The agui UI prompts users to say **"Hey, Alfred"** for activation; the ctl wake
word is still **`hello alfred`**. Keep these aligned if you change either side.

### How ctl boots agui

`startAguiScreenshareServer` (`ctl/src/agui.ts`):

1. If `ALFRED_AGUI_PUBLIC_BASE_URL` is set, skip spawning and use that URL
2. Otherwise probe for an existing Next dev server at the screenshare path; reuse
   if already running
3. Otherwise spawn `next dev` in `ALFRED_AGUI_DIR` (default `<cwd>/agui`), trying
   ports `ALFRED_AGUI_PORT` through `+9` if the default is busy
4. Open a **second persistent Cloudflare tunnel** named `agui` to the local server
5. Log Next output to `.tools/alfred-agui.log`

On demo shutdown, ctl stops the agui Next process it spawned (if any) but leaves
both tunnels running for reuse.

## ctl architecture

The data flow, end to end:

1. **`ctl/src/demo.ts`** orchestrates a run: reads config, starts the ctl server,
   starts a Cloudflare quick tunnel, builds the Create Bot payload, and calls Recall.
   When `ALFRED_AGUI_SCREENSHARE` is on (the default) it also starts the `agui` Next
   server and a second persistent tunnel named `agui` via `startAguiScreenshareServer`
   (`ctl/src/agui.ts`); if that fails it falls back to `ctl`'s `/media/screen`. It
   keeps the process alive and handles shutdown by asking Recall to `leave_call` and
   stopping the agui server (tunnels are left running for reuse).

2. **`ctl/src/server.ts`** owns the Bun server, WebSocket handling, and broadcast bus:
   - `/ws/recall` — inbound from Recall: PCM audio and/or transcript events
   - `/ws/media` — outbound to Output Media pages: JSON commands + PCM TTS chunks
   - `/ws/agent` — ctl↔agent bridge (see AGENTS.md for the protocol)

3. **`ctl/src/transcript.ts`** — wake-word brain with schema-tolerant parsing; matches
   `hello alfred` and `start screenshare` with a 5s dedupe window.

4. **Broadcast bus** — routes `say` to Deepgram streaming TTS → `/ws/media`;
   `start_screenshare` hits Recall's runtime Output Media endpoint.

5. **`ctl/src/media/`** — fallback camera/screen pages when agui is unavailable.
   `camera.html`/`camera.ts` and `screen.html`/`screen.ts`; `shared.ts` holds the
   `/ws/media` client + Web Audio playback. Audio output stays on the camera page;
   the screen page is static.

6. **`ctl/src/recall/`** — Recall.ai API glue. Screenshare renders the agui
   `/screenshare` URL when available, otherwise `ctl`'s `/media/screen`.

### Key behavioral switches (env → `ctl/src/config.ts`)

- `ALFRED_STT_PROVIDER` (`deepgram`|`recall`): defaults to `deepgram` when
  `DEEPGRAM_API_KEY` is set.
- `ALFRED_REALTIME_DELIVERY` (`webhook`|`websocket`|`both`)
- `ALFRED_OUTPUT_MEDIA` (`camera`|`screenshare`|`none`): join-time default; runtime
  "start screenshare" can switch later regardless.
- `ALFRED_PUBLIC_BASE_URL`: skip Cloudflare and use an existing public HTTPS URL.
- `ALFRED_AGUI_SCREENSHARE` (default `true`): use agui for screenshare; `false` →
  `/media/screen`.
- `ALFRED_AGUI_DIR`, `ALFRED_AGUI_PORT`, `ALFRED_AGUI_SCREENSHARE_PATH`,
  `ALFRED_AGUI_PUBLIC_BASE_URL`
- `OPENAI_API_KEY`: enables agui copilot chat (panels render without it)

### Conventions

- Runtime is **Bun** for ctl/agent; agui is npm + Next.js. TS is ESM, `strict`,
  `moduleResolution: Bundler`, targeting ES2022 with DOM libs in ctl.
- Defensive parsing of external payloads (Recall/Deepgram shapes vary).
- Raw PCM is never logged — only event name + byte counts.
- Cloudflare tunnels are **persistent** in `.tools/alfred-tunnels.json`; stop with
  `bun run demo:stop-tunnels`. `cloudflared` is resolved from `CLOUDFLARED_BIN`,
  then `./.tools/cloudflared`, then `../Take3/.tools/cloudflared`.
