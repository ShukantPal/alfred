import { connectMediaSocket, mountBaseStyles, requireElement } from "./shared";

document.title = "Alfred Control Plane";
mountBaseStyles();
document.head.appendChild(createScreenStyle());

const root = requireElement("app");
root.replaceChildren(renderScreenApp());

const statusEl = requireElement("status");
connectMediaSocket({
  onStatus(message) {
    statusEl.textContent = message;
  },
});

function renderScreenApp(): HTMLElement {
  const fragment = document.createDocumentFragment();

  const main = document.createElement("main");
  const mark = document.createElement("div");
  mark.className = "mark";
  mark.setAttribute("aria-hidden", "true");

  const heading = document.createElement("h1");
  heading.textContent = "Alfred Control Plane";

  const copy = document.createElement("p");
  copy.textContent = "Live meeting context will appear here";

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

function createScreenStyle(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = `
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
  `;
  return style;
}
