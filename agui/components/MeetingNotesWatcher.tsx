"use client";

import { useEffect } from "react";
import type { TranscriptUtterance } from "@/lib/meetingNotes";
import { useMeetingNotes } from "@/components/MeetingNotesProvider";

// How often the screenshare surface polls for new transcript utterances.
const POLL_MS = 1_000;

// The screenshare surface is rendered into the meeting by Recall via a Cloudflare
// tunnel. SSE/EventSource gets buffered by the tunnel and never reaches Recall's
// browser, so we poll a plain JSON endpoint (request/response sails through the
// tunnel) and render every new final utterance straight to the panel.
export function MeetingNotesWatcher() {
  const { addNote } = useMeetingNotes();

  useEffect(() => {
    let cursor = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch(`/api/meeting/transcript?poll=1&after=${cursor}`, {
          cache: "no-store",
        });
        if (response.ok) {
          const data = (await response.json()) as {
            seq: number;
            utterances: TranscriptUtterance[];
          };
          for (const utterance of data.utterances) {
            addNote({ text: utterance.text, speaker: utterance.speaker });
          }
          if (typeof data.seq === "number") cursor = data.seq;
        }
      } catch (error) {
        console.error("[agui] transcript poll failed", error);
      } finally {
        if (!stopped) timer = setTimeout(poll, POLL_MS);
      }
    };

    void poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [addNote]);

  return null;
}
