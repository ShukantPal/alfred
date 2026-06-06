import { Bot, createElement } from "lucide";
import { connectMediaSocket, mountBaseStyles, requireElement } from "./shared";

let displayedLevel = 0;
let targetLevel = 0;
let waveformBars: HTMLElement[] = [];

document.title = "Alfred";
mountBaseStyles();
document.head.appendChild(createCameraStyle());

const root = requireElement("app");
root.replaceChildren(renderCameraApp());

waveformBars = [...document.querySelectorAll<HTMLElement>(".waveform-bar")];

connectMediaSocket({
  onStatus() {},
  onAudioLevel(level) {
    targetLevel = Math.max(0, Math.min(1, level));
  },
});

requestAnimationFrame(renderWaveform);

function renderCameraApp(): HTMLElement {
  const main = document.createElement("main");
  main.className = "camera-main";

  const iconWrap = document.createElement("div");
  iconWrap.className = "robot-icon";
  iconWrap.append(createElement(Bot, {
    width: 182,
    height: 182,
    "stroke-width": 1.7,
    "aria-hidden": "true",
  }));

  const waveform = document.createElement("div");
  waveform.className = "waveform";
  waveform.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 36; index += 1) {
    const bar = document.createElement("span");
    bar.className = "waveform-bar";
    bar.style.setProperty("--bar-scale", "0.16");
    waveform.append(bar);
  }

  main.append(iconWrap, waveform);
  return main;
}

function renderWaveform(): void {
  displayedLevel += (targetLevel - displayedLevel) * 0.2;
  targetLevel *= 0.9;

  const now = performance.now();
  for (let index = 0; index < waveformBars.length; index += 1) {
    const phase = index / Math.max(1, waveformBars.length - 1);
    const centerWeight = 1 - Math.abs(phase - 0.5) * 1.65;
    const ripple = 0.5 + Math.sin(now / 120 + index * 0.56) * 0.5;
    const scale = Math.max(
      0.12,
      Math.min(1, 0.12 + displayedLevel * (0.34 + centerWeight * 0.76 + ripple * 0.22)),
    );
    waveformBars[index].style.setProperty("--bar-scale", String(scale));
  }

  requestAnimationFrame(renderWaveform);
}

function createCameraStyle(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
    .camera-main {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      align-content: start;
      gap: 38px;
      padding: 230px 72px 72px;
    }

    body {
      background: #101418;
    }

    .robot-icon {
      width: 260px;
      height: 260px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      color: #f6f1e8;
      background: rgba(246, 241, 232, 0.08);
      border: 2px solid rgba(246, 241, 232, 0.25);
      box-shadow: 0 28px 70px rgba(0, 0, 0, 0.26);
    }

    .robot-icon svg {
      display: block;
    }

    .waveform {
      width: 520px;
      height: 96px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .waveform-bar {
      width: 8px;
      height: 86px;
      border-radius: 999px;
      background: linear-gradient(180deg, #64e1aa, #2da487);
      transform: scaleY(var(--bar-scale));
      transform-origin: center;
      transition: transform 90ms linear;
      opacity: 0.9;
    }
  `;
  return style;
}
