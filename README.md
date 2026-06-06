# Alfred

Alfred is a live meeting participant. The current control plane lives in `ctl/`
and uses Recall.ai to send a bot into a meeting.

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
- `ALFRED_STT_PROVIDER`: `deepgram` or `recall`; defaults to `deepgram` when `DEEPGRAM_API_KEY` is set, otherwise `recall`.
- `DEEPGRAM_API_KEY`: enables Deepgram REST TTS for Alfred speech output.
- `DEEPGRAM_TTS_MODEL`: Deepgram Aura voice model, default `aura-2-draco-en`.
- `DEEPGRAM_TTS_ENCODING`: Deepgram TTS encoding, default `linear16`.
- `DEEPGRAM_TTS_CONTAINER`: Deepgram TTS container, default `wav`.
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
- `GET /media/app.js`
- `GET /tts?text=Hello.%20I'm%20Alfred%20and%20I'm%20ready%20to%20help!`

`/media/camera` serves `ctl/src/media/camera.html`, and `/media/screen` serves
`ctl/src/media/screen.html`. The UI and audio player are implemented in
`ctl/src/media/app.ts` and bundled by Bun at `/media/app.js`.

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
Output Media webpage. The webpage plays
`/tts?text=Hello.%20I'm%20Alfred%20and%20I'm%20ready%20to%20help!`, which uses
Deepgram REST TTS when `DEEPGRAM_API_KEY` is set. If Deepgram is not configured
or the request fails for the demo greeting, ctl falls back to `/audio/hello.wav`.
Deepgram output is requested as uncompressed WAV and padded with short
leading/trailing silence to reduce capture artifacts in Recall Output Media.
The media page fetches the generated audio into a blob and waits until the
browser can play through it before starting playback; this avoids clipping that
can happen when assigning a streaming URL directly to an audio element.

Raw audio websocket payloads are not logged. ctl logs only the realtime event
name and decoded byte count for `audio_mixed_raw.data`.

## Shutdown

When the demo receives `SIGINT` or `SIGTERM`, it calls Recall.ai's
`leave_call` endpoint for the created bot before stopping the local ctl server.
Persistent Cloudflare tunnels are still left running for reuse; stop them with
`bun run demo:stop-tunnels`.
