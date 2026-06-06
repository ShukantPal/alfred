type MediaMode = "camera" | "screen";
type MediaCommand =
  | { type: "status"; message?: string }
  | { type: "speak_stream_start"; id: string; text: string; sampleRate: number }
  | { type: "speak_stream_end"; id: string }
  | { type: "speak_stream_error"; id: string; message: string };

interface ActiveAudioStream {
  id: string;
  sampleRate: number;
  nextPlaybackTime: number;
}

const mode = readMediaMode();
let audioContext: AudioContext | undefined;
let activeStream: ActiveAudioStream | undefined;

document.title = mode === "camera" ? "Alfred" : "Alfred Control Plane";
document.documentElement.style.colorScheme = "dark";
document.head.appendChild(createStyle());

const root = requireElement("app");
root.replaceChildren(renderApp(mode));

const statusEl = requireElement("status");
const protocol = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${protocol}://${location.host}/ws/media`);
ws.binaryType = "arraybuffer";

ws.addEventListener("open", () => {
  statusEl.textContent = "connected";
});

ws.addEventListener("message", event => {
  if (event.data instanceof ArrayBuffer) {
    void handleStreamAudio(event.data);
    return;
  }

  try {
    const payload = JSON.parse(String(event.data)) as MediaCommand;
    if (payload.type === "status" && payload.message) {
      statusEl.textContent = payload.message;
    }
    if (payload.type === "speak_stream_start") {
      void startAudioStream(payload);
    }
    if (payload.type === "speak_stream_end") {
      endAudioStream(payload.id);
    }
    if (payload.type === "speak_stream_error") {
      endAudioStream(payload.id);
      statusEl.textContent = payload.message;
    }
  } catch {
    statusEl.textContent = String(event.data);
  }
});

ws.addEventListener("close", () => {
  statusEl.textContent = "offline";
});

function readMediaMode(): MediaMode {
  return document.body.dataset.mediaMode === "screen" ? "screen" : "camera";
}

function renderApp(mediaMode: MediaMode): HTMLElement {
  const title = mediaMode === "camera" ? "Alfred" : "Alfred Control Plane";
  const subtitle =
    mediaMode === "camera"
      ? "Listening for the meeting"
      : "Live meeting context will appear here";

  const fragment = document.createDocumentFragment();

  const main = document.createElement("main");
  const mark = document.createElement("div");
  mark.className = "mark";
  mark.setAttribute("aria-hidden", "true");

  const heading = document.createElement("h1");
  heading.textContent = title;

  const copy = document.createElement("p");
  copy.textContent = subtitle;

  main.append(mark, heading, copy);

  const status = document.createElement("div");
  status.className = "status";
  const pulse = document.createElement("span");
  pulse.className = "pulse";
  const statusText = document.createElement("span");
  statusText.id = "status";
  statusText.textContent = "connected";
  status.append(pulse, statusText);

  fragment.append(main, status);

  const container = document.createElement("div");
  container.append(fragment);
  return container;
}

async function startAudioStream(command: Extract<MediaCommand, { type: "speak_stream_start" }>): Promise<void> {
  audioContext ??= new AudioContext();
  await audioContext.resume();
  activeStream = {
    id: command.id,
    sampleRate: command.sampleRate,
    nextPlaybackTime: audioContext.currentTime + 0.14,
  };
  statusEl.textContent = "speaking";
}

async function handleStreamAudio(buffer: ArrayBuffer): Promise<void> {
  if (!activeStream) return;
  audioContext ??= new AudioContext();
  await audioContext.resume();

  const pcm = new Int16Array(buffer.slice(0, buffer.byteLength - (buffer.byteLength % 2)));
  if (pcm.length === 0) return;

  const audioBuffer = audioContext.createBuffer(1, pcm.length, activeStream.sampleRate);
  const channel = audioBuffer.getChannelData(0);
  for (let index = 0; index < pcm.length; index += 1) {
    channel[index] = Math.max(-1, Math.min(1, pcm[index] / 32768));
  }

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);

  const startAt = Math.max(activeStream.nextPlaybackTime, audioContext.currentTime + 0.02);
  source.start(startAt);
  activeStream.nextPlaybackTime = startAt + audioBuffer.duration;
}

function endAudioStream(id: string): void {
  if (!activeStream || activeStream.id !== id) return;
  const remainingMs = audioContext
    ? Math.max(0, (activeStream.nextPlaybackTime - audioContext.currentTime) * 1000)
    : 0;
  activeStream = undefined;
  window.setTimeout(() => {
    if (!activeStream) {
      statusEl.textContent = "listening";
    }
  }, remainingMs + 100);
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element;
}

function createStyle(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    :root {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #101418;
      color: #f6f1e8;
    }

    * {
      box-sizing: border-box;
    }

    body {
      width: 1280px;
      height: 720px;
      margin: 0;
      overflow: hidden;
      background:
        linear-gradient(135deg, rgba(28, 111, 99, 0.35), transparent 42%),
        linear-gradient(315deg, rgba(184, 80, 66, 0.28), transparent 48%),
        #101418;
    }

    main {
      display: grid;
      grid-template-columns: 1fr;
      align-content: center;
      width: 100%;
      height: 100%;
      padding: 72px;
    }

    .mark {
      width: 92px;
      height: 92px;
      border: 2px solid rgba(246, 241, 232, 0.35);
      border-radius: 50%;
      display: grid;
      place-items: center;
      margin-bottom: 34px;
      background: rgba(246, 241, 232, 0.08);
    }

    .mark::before {
      content: "A";
      font-size: 46px;
      line-height: 1;
      font-weight: 700;
    }

    h1 {
      font-size: 88px;
      line-height: 0.95;
      margin: 0 0 24px;
      letter-spacing: 0;
    }

    p {
      max-width: 760px;
      margin: 0;
      color: rgba(246, 241, 232, 0.78);
      font-size: 30px;
      line-height: 1.25;
    }

    .status {
      position: fixed;
      left: 72px;
      bottom: 56px;
      display: flex;
      align-items: center;
      gap: 14px;
      color: rgba(246, 241, 232, 0.72);
      font-size: 22px;
    }

    .pulse {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #48d19b;
      box-shadow: 0 0 0 0 rgba(72, 209, 155, 0.7);
      animation: pulse 1.8s infinite;
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(72, 209, 155, 0.65); }
      70% { box-shadow: 0 0 0 22px rgba(72, 209, 155, 0); }
      100% { box-shadow: 0 0 0 0 rgba(72, 209, 155, 0); }
    }
  `;
  return style;
}
