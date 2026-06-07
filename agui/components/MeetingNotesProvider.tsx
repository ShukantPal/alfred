"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MeetingNote } from "@/lib/meetingNotes";

interface MeetingNotesContextValue {
  notes: MeetingNote[];
  addNote(input: { text: string; speaker?: string }): MeetingNote;
}

const MeetingNotesContext = createContext<MeetingNotesContextValue | null>(null);

export function useMeetingNotes(): MeetingNotesContextValue {
  const value = useContext(MeetingNotesContext);
  if (!value) {
    throw new Error("useMeetingNotes must be used within MeetingNotesProvider");
  }
  return value;
}

export function MeetingNotesProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const bootstrappedRef = useRef(false);

  const addNote = useCallback((input: { text: string; speaker?: string }) => {
    const text = input.text.trim();
    const note: MeetingNote = {
      id: `n_${crypto.randomUUID().slice(0, 8)}`,
      text,
      speaker: input.speaker?.trim() || "Alfred",
      capturedAt: new Date().toISOString(),
    };
    setNotes(current => [note, ...current]);
    return note;
  }, []);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    addNote({
      text: "Meeting started — Alfred is transcribing live.",
      speaker: "Alfred",
    });
  }, [addNote]);

  const value = useMemo(() => ({ notes, addNote }), [notes, addNote]);

  return (
    <MeetingNotesContext.Provider value={value}>{children}</MeetingNotesContext.Provider>
  );
}
