"use client";

import { useEffect, useRef } from "react";
import type { TranscriptUtterance } from "@/lib/meetingNotes";
import { logPollFailure, pollDelayMs } from "@/lib/meetingPoll";
import { useMeetingNotes } from "@/components/MeetingNotesProvider";

// Safety-net poll interval. The WebSocket below delivers utterances instantly; this
// poll guarantees completeness (catch-up + gap recovery) and is the sole transport
// if the WS can't connect.
const POLL_MS = 1_000;
// Backoff before retrying a dropped WebSocket.
const WS_RETRY_MS = 3_000;

// The screenshare surface is rendered into the meeting by Recall via a Cloudflare
// tunnel. Live updates ride two transports:
//   1. ctl's /ws/notes WebSocket — sub-second push for snappy rendering.
//   2. agui's transcript buffer poll — reliable catch-up + fallback (request/response
//      sails through the tunnel; SSE was dropped because the tunnel buffers it).
// Both feed the same dedup gate (keyed on ts+speaker+text), so double-delivery is
// harmless and the panel never shows duplicates or misses a line.
export function MeetingNotesWatcher() {
  const { addNote } = useMeetingNotes();
  const addNoteRef = useRef(addNote);
  addNoteRef.current = addNote;

  useEffect(() => {
    let stopped = false;
    let cursor = 0;
    let pollFailures = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let wsRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | undefined;
    const pollAbort = new AbortController();
    const seen = new Set<string>();

    const keyOf = (u: TranscriptUtterance) => `${u.ts}|${u.speaker}|${u.text}`;
    const handle = (u: TranscriptUtterance) => {
      if (!u.text) return;
      const key = keyOf(u);
      if (seen.has(key)) return;
      seen.add(key);
      addNoteRef.current({ text: u.text, speaker: u.speaker });
    };

    const poll = async () => {
      try {
        const response = await fetch(`/api/meeting/transcript?after=${cursor}`, {
          cache: "no-store",
          signal: pollAbort.signal,
        });
        if (response.ok) {
          const data = (await response.json()) as {
            seq: number;
            utterances: TranscriptUtterance[];
          };
          for (const utterance of data.utterances) handle(utterance);
          if (typeof data.seq === "number") cursor = data.seq;
          pollFailures = 0;
        } else {
          pollFailures += 1;
        }
      } catch (error) {
        pollFailures += 1;
        logPollFailure("transcript", error, pollFailures);
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
        // ctl handshake not ready — polling keeps the panel live; retry shortly.
      }

      if (stopped) return;
      if (!notesWsUrl) {
        wsRetryTimer = setTimeout(connectWs, WS_RETRY_MS);
        return;
      }

      try {
        ws = new WebSocket(notesWsUrl);
      } catch (error) {
        console.error("[agui] notes websocket failed to open", error);
        wsRetryTimer = setTimeout(connectWs, WS_RETRY_MS);
        return;
      }

      ws.onmessage = event => {
        try {
          const message = JSON.parse(event.data as string) as {
            type?: string;
            utterance?: TranscriptUtterance;
          };
          if (message.type === "utterance" && message.utterance) {
            handle(message.utterance);
          }
        } catch {
          // Ignore non-JSON frames.
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
