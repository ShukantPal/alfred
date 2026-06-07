import type { TranscriptUtterance } from "@/lib/meetingNotes";

interface Entry {
  seq: number;
  utterance: TranscriptUtterance;
}

const entries: Entry[] = [];
let seq = 0;

// Retain the entire meeting so the full transcript is always available (live and
// at the end). Cap is a generous memory guard, not a feature limit: ~20k
// utterances covers many hours of speech before the oldest lines roll off.
const MAX_UTTERANCES = 20_000;

export function pushUtterance(utterance: TranscriptUtterance): void {
  seq += 1;
  entries.push({ seq, utterance });
  if (entries.length > MAX_UTTERANCES) {
    entries.splice(0, entries.length - MAX_UTTERANCES);
  }
}

/**
 * Returns utterances captured after the given sequence cursor, with the new
 * cursor. Backs the live polling transport (robust through Cloudflare, unlike SSE).
 */
export function utterancesSince(after: number): {
  seq: number;
  utterances: TranscriptUtterance[];
} {
  const fresh = entries.filter(entry => entry.seq > after);
  return { seq, utterances: fresh.map(entry => entry.utterance) };
}

/** Returns the entire retained transcript — used for the end-of-meeting dump. */
export function allUtterances(): {
  seq: number;
  utterances: TranscriptUtterance[];
} {
  return { seq, utterances: entries.map(entry => entry.utterance) };
}
