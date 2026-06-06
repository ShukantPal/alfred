type MediaMode = "camera" | "screen";
type MediaCommand =
  | { type: "status"; message?: string }
  | { type: "say"; text?: string };

const mode = readMediaMode();
const speechQueue: string[] = [];
let isPlayingSpeech = false;
let currentObjectUrl: string | undefined;

document.title = mode === "camera" ? "Alfred" : "Alfred Control Plane";
document.documentElement.style.colorScheme = "dark";
document.head.appendChild(createStyle());

const root = requireElement("app");
root.replaceChildren(renderApp(mode));

const statusEl = requireElement("status");
const speechAudio = requireElement("speech-audio") as HTMLAudioElement;
const protocol = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${protocol}://${location.host}/ws/media`);

ws.addEventListener("open", () => {
  statusEl.textContent = "connected";
});

ws.addEventListener("message", event => {
  try {
    const payload = JSON.parse(String(event.data)) as MediaCommand;
    if (payload.type === "status" && payload.message) {
      statusEl.textContent = payload.message;
    }
    if (payload.type === "say" && payload.text) {
      enqueueSpeech(payload.text);
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

  const audio = document.createElement("audio");
  audio.id = "speech-audio";
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";

  const status = document.createElement("div");
  status.className = "status";
  const pulse = document.createElement("span");
  pulse.className = "pulse";
  const statusText = document.createElement("span");
  statusText.id = "status";
  statusText.textContent = "connected";
  status.append(pulse, statusText);

  fragment.append(main, audio, status);

  const container = document.createElement("div");
  container.append(fragment);
  return container;
}

function enqueueSpeech(text: string): void {
  const lastQueued = speechQueue[speechQueue.length - 1];
  if (lastQueued === text) return;
  speechQueue.push(text);
  void drainSpeechQueue();
}

async function drainSpeechQueue(): Promise<void> {
  if (isPlayingSpeech) return;
  isPlayingSpeech = true;

  try {
    while (speechQueue.length > 0) {
      const text = speechQueue.shift();
      if (text) await say(text);
    }
  } finally {
    isPlayingSpeech = false;
  }
}

async function say(text: string): Promise<void> {
  statusEl.textContent = text;
  const source = `/tts?text=${encodeURIComponent(text)}`;

  try {
    const response = await fetch(`${source}&t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`TTS request failed: ${response.status}`);
    const blob = await response.blob();
    await playBlob(blob);
  } catch (error) {
    console.error("Failed to fetch speech audio", error);
    try {
      const fallback = await fetch(`/audio/hello.wav?t=${Date.now()}`, {
        cache: "no-store",
      });
      await playBlob(await fallback.blob());
    } catch (fallbackError) {
      statusEl.textContent = "audio failed";
      console.error("Failed to play fallback speech audio", fallbackError);
    }
  }
}

async function playBlob(blob: Blob): Promise<void> {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }
  currentObjectUrl = URL.createObjectURL(blob);
  speechAudio.src = currentObjectUrl;
  speechAudio.volume = 1;
  speechAudio.onplaying = () => {
    statusEl.textContent = "speaking";
  };
  speechAudio.onended = () => {
    statusEl.textContent = "listening";
  };

  await new Promise<void>((resolve, reject) => {
    speechAudio.oncanplaythrough = () => resolve();
    speechAudio.onerror = () => reject(new Error("audio element failed to load"));
    speechAudio.load();
  });

  await speechAudio.play();
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
