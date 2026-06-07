export interface MeetingNote {
  id: string;
  /** One concise bullet summarizing a concluded topic. */
  text: string;
  /** Primary speaker for the topic, or "Alfred" when synthesized. */
  speaker: string;
  /** When the note was captured (ISO 8601). */
  capturedAt: string;
}

export interface TranscriptUtterance {
  text: string;
  speaker: string;
  ts: number;
}
