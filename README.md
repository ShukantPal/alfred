# Alfred

Alfred is a live meeting participant. The current control plane lives in `ctl/`
and uses Recall.ai to send a bot into a meeting.

## Monorepo

Alfred is a Bun workspace monorepo:

- `ctl/`: meeting control plane, Recall.ai integration, media pages, and OpenAI Realtime voice.
- `agent/`: company memory and agent harness exposed over WebSocket.

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

Run agent commands from the repo root:

```sh
bun run agent:dev    # WebSocket server on ws://localhost:8787
bun run agent:seed   # seed company context
bun run agent:demo   # simulate ctl/ against the agent server
bun run agent:test   # run agent tests
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
- `OPENAI_REALTIME_VOICE`: OpenAI Realtime voice, default `marin`.
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

`agent/` is not the primary responder. ctl exposes it to the Realtime model as a
`delegate_to_company_agent` function tool, so the voice model can ask the
company-memory harness for seeded docs/Slack/project context and then speak the
result itself.

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
