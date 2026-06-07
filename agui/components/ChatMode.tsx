"use client";

import { useEffect, useMemo, useRef } from "react";
import type { ChatMessage } from "@/lib/chat";
import { useMeetingChat } from "@/components/ChatProvider";
import { useVisualAgent, type VisualItem } from "@/components/VisualAgentProvider";
import { VisualView } from "@/components/charts/VisualView";
import { ThinkingDots } from "@/components/ThinkingDots";
import { Waveform } from "@/components/Waveform";

// A chat entry is either a spoken/text bubble (from the ctl chat buffer) or an
// Alfred-chosen visualization (from the headless CopilotKit agent). Both are
// timestamped so they share one timeline.
type ChatEntry =
  | { kind: "message"; ts: number; message: ChatMessage }
  | { kind: "visual"; ts: number; visual: VisualItem };

// The screenshare main-window view once Alfred is asked a reasoning question.
// User questions sit on the right as text bubbles; Alfred's spoken replies sit on
// the left as an animated waveform. Alfred-chosen generative UI (charts/tables
// streamed from CopilotKit) appears as left-aligned cards. Messages and visuals
// share one timeline: newest content is at the bottom and older content scrolls up.
export function ChatMode() {
  const { messages } = useMeetingChat();
  const { visuals } = useVisualAgent();
  const listRef = useRef<HTMLOListElement | null>(null);

  const entries = useMemo<ChatEntry[]>(() => {
    const merged: ChatEntry[] = [
      ...messages.map(message => ({ kind: "message" as const, ts: message.ts, message })),
      ...visuals.map(visual => ({ kind: "visual" as const, ts: visual.ts, visual })),
    ];
    // Stable order by time so a newer message pushes earlier entries (incl. charts) up.
    return merged.sort((a, b) => a.ts - b.ts);
  }, [messages, visuals]);

  useEffect(() => {
    scrollChatToBottom(listRef.current, "smooth");
  }, [entries]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    let frame: number | undefined;
    const scrollToBottom = () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        scrollChatToBottom(list, "smooth");
      });
    };

    const observer = new ResizeObserver(() => {
      scrollToBottom();
    });
    const observeRows = () => {
      for (const child of list.children) {
        observer.observe(child);
      }
    };

    observeRows();
    const mutationObserver = new MutationObserver(() => {
      observeRows();
      scrollToBottom();
    });

    mutationObserver.observe(list, { childList: true, subtree: true });
    return () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      mutationObserver.disconnect();
      observer.disconnect();
    };
  }, []);

  return (
    <div className="chat-mode">
      <ol className="chat-mode__list" ref={listRef}>
        <li className="chat-mode__spacer" aria-hidden />
        {entries.map(entry =>
          entry.kind === "message" ? (
            <ChatBubble key={entry.message.id} message={entry.message} />
          ) : (
            <li key={entry.visual.id} className="chat-row chat-row--alfred">
              <VisualView spec={entry.visual.spec} />
            </li>
          ),
        )}
        <li className="chat-mode__anchor" aria-hidden />
      </ol>
    </div>
  );
}

function scrollChatToBottom(list: HTMLOListElement | null, behavior: ScrollBehavior) {
  if (!list) return;
  list.scrollTo({ top: list.scrollHeight, behavior });
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <li className={`chat-row chat-row--${isUser ? "user" : "alfred"}`}>
      <div className={`chat-bubble chat-bubble--${isUser ? "user" : "alfred"}`}>
        {message.kind === "voice" ? (
          message.status === "thinking" ? (
            <ThinkingDots />
          ) : (
            <Waveform speaking={message.status === "speaking"} />
          )
        ) : (
          <span className="chat-bubble__text">{message.text}</span>
        )}
      </div>
    </li>
  );
}
