"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/chat";
import { useMeetingChat } from "@/components/ChatProvider";
import { ThinkingDots } from "@/components/ThinkingDots";
import { Waveform } from "@/components/Waveform";

// The screenshare main-window view once Alfred is asked a reasoning question.
// User questions sit on the right as text bubbles; Alfred's spoken replies sit on
// the left as an animated waveform. Newest message is at the bottom and older
// messages scroll up.
export function ChatMode() {
  const { messages } = useMeetingChat();
  const endRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="chat-mode">
      <ol className="chat-mode__list">
        <li className="chat-mode__spacer" aria-hidden />
        {messages.map(message => (
          <ChatBubble key={message.id} message={message} />
        ))}
        <li ref={endRef} className="chat-mode__anchor" aria-hidden />
      </ol>
    </div>
  );
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
