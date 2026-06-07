"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ChatEvent, ChatMessage } from "@/lib/chat";

/** Single source of truth for what the screenshare main window shows. */
export type WorkspaceMode = "landing" | "chat";

interface ChatContextValue {
  messages: ChatMessage[];
  mode: WorkspaceMode;
  applyEvent(event: ChatEvent): void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useMeetingChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) {
    throw new Error("useMeetingChat must be used within ChatProvider");
  }
  return value;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Idempotent merge by id: the WS push and the catch-up poll both deliver the
  // same events, so add/update must be safe to apply more than once.
  const applyEvent = useCallback((event: ChatEvent) => {
    setMessages(current => {
      if (event.op === "update") {
        return current.map(message =>
          message.id === event.id
            ? {
                ...message,
                ...(typeof event.text === "string" ? { text: event.text } : {}),
                ...(event.status ? { status: event.status } : {}),
              }
            : message,
        );
      }

      const existingIndex = event.id
        ? current.findIndex(message => message.id === event.id)
        : -1;
      const incoming: ChatMessage = {
        id: event.id ?? `c_${crypto.randomUUID().slice(0, 8)}`,
        role: event.role,
        kind: event.kind,
        text: typeof event.text === "string" ? event.text : undefined,
        status: event.kind === "voice" ? (event.status ?? "speaking") : event.status,
        ts: typeof event.ts === "number" ? event.ts : Date.now(),
      };
      if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = { ...next[existingIndex], ...incoming };
        return next;
      }
      return [...current, incoming];
    });
  }, []);

  const value = useMemo<ChatContextValue>(
    () => ({
      messages,
      mode: messages.length > 0 ? "chat" : "landing",
      applyEvent,
    }),
    [messages, applyEvent],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
