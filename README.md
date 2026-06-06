# Alfred

Alfred is a live meeting participant. The current control plane lives in `ctl/`
and uses Recall.ai to send a bot into a meeting.

## Monorepo

Alfred is a Bun workspace monorepo:

- `ctl/`: meeting control plane, Recall.ai integration, media pages, STT/TTS.
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
export DEEPGRAM_API_KEY=...
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
- `ALFRED_STT_PROVIDER`: `deepgram` or `recall`; defaults to `deepgram` when `DEEPGRAM_API_KEY` is set, otherwise `recall`.
- `DEEPGRAM_API_KEY`: enables Deepgram live STT and streaming TTS for Alfred speech output.
- `DEEPGRAM_TTS_MODEL`: Deepgram Aura voice model, default `aura-2-draco-en`.
- `DEEPGRAM_TTS_SAMPLE_RATE`: Deepgram TTS sample rate, default `24000`.
- `DEEPGRAM_TTS_TIMEOUT_MS`: Deepgram TTS request timeout, default `10000`.
- `DEEPGRAM_STT_MODEL`: Deepgram live STT model, default `nova-3`.
- `DEEPGRAM_STT_ENDPOINTING_MS`: Deepgram pause duration for `speech_final`, default `100`.
- `DEEPGRAM_STT_WAKE_ON_INTERIM`: set `0` to ignore interim transcripts for wake-word detection.

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

## Transcription

When `ALFRED_STT_PROVIDER=deepgram`, the bot enables Recall's
`audio_mixed_raw` stream and sends raw 16 kHz mono PCM audio to `/ws/recall`.
ctl forwards those buffers to Deepgram live STT with interim results enabled.
This is the fastest wake-word path.

When `ALFRED_STT_PROVIDER=recall`, the demo uses Recall.ai low-latency
real-time transcription and sends transcript callbacks to `/webhooks/recall` by
default. Set `ALFRED_REALTIME_DELIVERY=websocket` or `both` to have Recall
connect to `/ws/recall` as well.

If Alfred hears `hello alfred`, the ctl server sends a speech command to the
Output Media webpage. When `DEEPGRAM_API_KEY` is set, ctl opens Deepgram's
streaming Speak websocket, sends the response text, and forwards raw PCM chunks
to `/ws/media`. The media page schedules those chunks with Web Audio so playback
can begin before the full utterance is generated.

If Alfred hears `start screenshare`, ctl calls Recall.ai's runtime Output Media
endpoint for the active bot and starts `/media/screen` as a screenshare. The
screen-share page is static and does not connect to `/ws/media` or play audio;
audio output stays on the camera media page.

There is no REST TTS output route. Alfred's spoken responses use Deepgram's
streaming Speak websocket and are forwarded to the media page over `/ws/media`
as raw PCM chunks.

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
