export interface MeetingNote {
  id: string;
  /** Note body text. */
  text: string;
  /** Who contributed this note. */
  speaker: string;
  /** When the note was captured (ISO 8601). */
  capturedAt: string;
}

// Mock running meeting notes. This will be replaced by a live feed from the ctl
// control plane as Alfred transcribes and summarizes the meeting.
export const mockMeetingNotes: MeetingNote[] = [
  {
    id: "n_006",
    text: "Client wants the OAuth patch shipped before end of sprint; auth rewrite deferred to Q3.",
    speaker: "Alfred",
    capturedAt: "2026-06-06T17:44:02Z",
  },
  {
    id: "n_005",
    text: "Priya asked for a summary of action items — tracking deployment runbook and timezone follow-up.",
    speaker: "Alfred",
    capturedAt: "2026-06-06T17:42:15Z",
  },
  {
    id: "n_004",
    text: "14 story points remain across 5 open tickets.",
    speaker: "Alfred",
    capturedAt: "2026-06-06T17:31:10Z",
  },
  {
    id: "n_003",
    text: "Marcus confirmed the client is in CET (UTC+1).",
    speaker: "Alfred",
    capturedAt: "2026-06-06T17:39:00Z",
  },
  {
    id: "n_002",
    text: "Platform team (Sam) owns the deployment runbook.",
    speaker: "Alfred",
    capturedAt: "2026-06-06T17:15:20Z",
  },
  {
    id: "n_001",
    text: "Meeting started — Alfred is transcribing live.",
    speaker: "Alfred",
    capturedAt: "2026-06-06T17:02:55Z",
  },
];
