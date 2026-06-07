"use client";

import { useEffect, useRef } from "react";
import type { ChatEvent, ChatMessage } from "@/lib/chat";
import { logPollFailure, pollDelayMs } from "@/lib/meetingPoll";
import type { PanelSignalEvent } from "@/lib/panel";
import { useMeetingChat } from "@/components/ChatProvider";
import { usePanelSignals } from "@/components/PanelSignalProvider";
import { useVisualAgent } from "@/components/VisualAgentProvider";

// Safety-net poll interval; the /ws/notes WebSocket delivers events instantly and
// this poll guarantees catch-up / gap recovery (and is the sole transport if the WS
// can't connect). Same dual-transport model as MeetingNotesWatcher.
const POLL_MS = 700;
const WS_RETRY_MS = 3_000;

export function ChatWatcher() {
  const { applyEvent } = useMeetingChat();
  const { ask } = useVisualAgent();
  const { applySignal } = usePanelSignals();
  const applyEventRef = useRef(applyEvent);
  const askRef = useRef(ask);
  const applySignalRef = useRef(applySignal);
  applyEventRef.current = applyEvent;
  askRef.current = ask;
  applySignalRef.current = applySignal;

  useEffect(() => {
    let stopped = false;
    let cursor = 0;
    let pollFailures = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let wsRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | undefined;
    const pollAbort = new AbortController();

    const poll = async () => {
      try {
        const response = await fetch(`/api/meeting/chat?after=${cursor}`, {
          cache: "no-store",
          signal: pollAbort.signal,
        });
        if (response.ok) {
          const data = (await response.json()) as {
            seq: number;
            messages: ChatMessage[];
          };
          for (const message of data.messages) {
            applyEventRef.current({ op: "add", ...message });
          }
          if (typeof data.seq === "number") cursor = data.seq;
          pollFailures = 0;
        } else {
          pollFailures += 1;
        }
      } catch (error) {
        pollFailures += 1;
        logPollFailure("chat", error, pollFailures);
      } finally {
        if (!stopped) {
          pollTimer = setTimeout(poll, pollDelayMs(POLL_MS, pollFailures));
        }
      }
    };

    const connectWs = async () => {
      if (stopped) return;
      let notesWsUrl: string | null = null;
      try {
        const response = await fetch("/api/meeting/config", { cache: "no-store" });
        if (response.ok) {
          notesWsUrl = ((await response.json()) as { notesWsUrl: string | null })
            .notesWsUrl;
        }
      } catch {
        // ctl handshake not ready — polling keeps chat live; retry shortly.
      }

      if (stopped) return;
      if (!notesWsUrl) {
        wsRetryTimer = setTimeout(connectWs, WS_RETRY_MS);
        return;
      }

      try {
        ws = new WebSocket(notesWsUrl);
      } catch (error) {
        console.error("[agui] chat websocket failed to open", error);
        wsRetryTimer = setTimeout(connectWs, WS_RETRY_MS);
        return;
      }

      ws.onmessage = event => {
        try {
          const message = JSON.parse(event.data as string) as {
            type?: string;
            event?: ChatEvent | PanelSignalEvent;
            question?: string;
            afterTs?: number;
          };
          if (message.type === "chat" && message.event) {
            applyEventRef.current(message.event as ChatEvent);
          } else if (message.type === "panel" && message.event) {
            // Live left-panel highlight: clear (new prompt) or light up a row.
            applySignalRef.current(message.event as PanelSignalEvent);
          } else if (message.type === "agui_run" && typeof message.question === "string") {
            // Voice asked Alfred to visualize something: run the headless CopilotKit
            // agent programmatically (the participant never types). `afterTs` keeps
            // the chart after the user prompt + waveform in the shared timeline.
            const afterTs =
              typeof message.afterTs === "number" && Number.isFinite(message.afterTs)
                ? message.afterTs
                : undefined;
            askRef.current(message.question, afterTs);
          }
        } catch {
          // Ignore non-JSON / non-chat frames.
        }
      };
      const scheduleReconnect = () => {
        ws = undefined;
        if (!stopped) wsRetryTimer = setTimeout(connectWs, WS_RETRY_MS);
      };
      ws.onclose = scheduleReconnect;
      ws.onerror = () => ws?.close();
    };

    void poll();
    void connectWs();

    return () => {
      stopped = true;
      pollAbort.abort();
      if (pollTimer) clearTimeout(pollTimer);
      if (wsRetryTimer) clearTimeout(wsRetryTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, []);

  return null;
}
