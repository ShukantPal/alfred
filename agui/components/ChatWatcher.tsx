"use client";

import { useEffect } from "react";
import type { ChatEvent, ChatMessage } from "@/lib/chat";
import { useMeetingChat } from "@/components/ChatProvider";

// Safety-net poll interval; the /ws/notes WebSocket delivers events instantly and
// this poll guarantees catch-up / gap recovery (and is the sole transport if the WS
// can't connect). Same dual-transport model as MeetingNotesWatcher.
const POLL_MS = 700;
const WS_RETRY_MS = 3_000;

export function ChatWatcher() {
  const { applyEvent } = useMeetingChat();

  useEffect(() => {
    let stopped = false;
    let cursor = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let wsRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | undefined;

    const poll = async () => {
      try {
        const response = await fetch(`/api/meeting/chat?after=${cursor}`, {
          cache: "no-store",
        });
        if (response.ok) {
          const data = (await response.json()) as {
            seq: number;
            messages: ChatMessage[];
          };
          for (const message of data.messages) {
            applyEvent({ op: "add", ...message });
          }
          if (typeof data.seq === "number") cursor = data.seq;
        }
      } catch (error) {
        console.error("[agui] chat poll failed", error);
      } finally {
        if (!stopped) pollTimer = setTimeout(poll, POLL_MS);
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
            event?: ChatEvent;
          };
          if (message.type === "chat" && message.event) {
            applyEvent(message.event);
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
      if (pollTimer) clearTimeout(pollTimer);
      if (wsRetryTimer) clearTimeout(wsRetryTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [applyEvent]);

  return null;
}
