export type MediaCommand =
  | { type: "status"; message?: string }
  | { type: "audio_level"; level: number }
  | { type: "speak_stream_start"; id: string; text: string; sampleRate: number }
  | { type: "speak_stream_end"; id: string }
  | { type: "speak_stream_error"; id: string; message: string };

interface ActiveAudioStream {
  id: string;
  sampleRate: number;
  nextPlaybackTime: number;
}

interface MediaSocketHandlers {
  onStatus(message: string): void;
  onAudioLevel?(level: number): void;
}

let audioContext: AudioContext | undefined;
let activeStream: ActiveAudioStream | undefined;

export function connectMediaSocket(handlers: MediaSocketHandlers): WebSocket {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${location.host}/ws/media`);
  ws.binaryType = "arraybuffer";

  ws.addEventListener("open", () => {
    handlers.onStatus("connected");
  });

  ws.addEventListener("message", event => {
    if (event.data instanceof ArrayBuffer) {
      void handleStreamAudio(event.data);
      return;
    }

    try {
      const payload = JSON.parse(String(event.data)) as MediaCommand;
      if (payload.type === "status" && payload.message) {
        handlers.onStatus(payload.message);
      }
      if (payload.type === "audio_level") {
        handlers.onAudioLevel?.(payload.level);
      }
      if (payload.type === "speak_stream_start") {
        handlers.onStatus("speaking");
        void startAudioStream(payload);
      }
      if (payload.type === "speak_stream_end") {
        endAudioStream(payload.id, handlers.onStatus);
      }
      if (payload.type === "speak_stream_error") {
        endAudioStream(payload.id, handlers.onStatus);
        handlers.onStatus(payload.message);
      }
    } catch {
      handlers.onStatus(String(event.data));
    }
  });

  ws.addEventListener("close", () => {
    handlers.onStatus("offline");
  });

  return ws;
}

export function mountBaseStyles(): void {
  document.documentElement.style.colorScheme = "dark";
  document.head.appendChild(createBaseStyle());
}

export function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element;
}

async function startAudioStream(
  command: Extract<MediaCommand, { type: "speak_stream_start" }>,
): Promise<void> {
  audioContext ??= new AudioContext();
  await audioContext.resume();
  activeStream = {
    id: command.id,
    sampleRate: command.sampleRate,
    nextPlaybackTime: audioContext.currentTime + 0.14,
  };
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

function endAudioStream(id: string, onStatus: (message: string) => void): void {
  if (!activeStream || activeStream.id !== id) return;
  const remainingMs = audioContext
    ? Math.max(0, (activeStream.nextPlaybackTime - audioContext.currentTime) * 1000)
    : 0;
  activeStream = undefined;
  window.setTimeout(() => {
    if (!activeStream) {
      onStatus("listening");
    }
  }, remainingMs + 100);
}

function createBaseStyle(): HTMLStyleElement {
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
