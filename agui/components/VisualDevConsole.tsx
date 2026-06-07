"use client";

import { useEffect, useState } from "react";
import { useVisualAgent } from "@/components/VisualAgentProvider";

// Dev-only typed trigger for the generative UI, so charts can be exercised without
// the voice path. Hidden unless the page is opened with `?dev=1`, so it never shows
// in the screenshared meeting video.
export function VisualDevConsole() {
  const { ask } = useVisualAgent();
  const [enabled, setEnabled] = useState(false);
  const [value, setValue] = useState(
    "Diagram how Shukant connected CopilotKit and Recall",
  );

  useEffect(() => {
    setEnabled(new URLSearchParams(window.location.search).get("dev") === "1");
  }, []);

  if (!enabled) return null;

  const submit = () => {
    ask(value);
  };

  return (
    <div className="visual-dev-console">
      <input
        className="visual-dev-console__input"
        value={value}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter") submit();
        }}
        placeholder="Ask Alfred to visualize…"
      />
      <button type="button" className="visual-dev-console__button" onClick={submit}>
        Render
      </button>
    </div>
  );
}
