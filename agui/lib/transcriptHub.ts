import type { TranscriptUtterance } from "@/lib/meetingNotes";

type Listener = (utterance: TranscriptUtterance) => void;

interface Entry {
  seq: number;
  utterance: TranscriptUtterance;
}

const entries: Entry[] = [];
const listeners = new Set<Listener>();
let seq = 0;

const MAX_UTTERANCES = 500;

export function pushUtterance(utterance: TranscriptUtterance): void {
  seq += 1;
  entries.push({ seq, utterance });
  if (entries.length > MAX_UTTERANCES) {
    entries.splice(0, entries.length - MAX_UTTERANCES);
  }
  for (const listener of listeners) {
    listener(utterance);
  }
}

export function subscribeUtterances(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recentUtterances(limit = 40): TranscriptUtterance[] {
  return entries.slice(-limit).map(entry => entry.utterance);
}

export function latestSeq(): number {
  return seq;
}

/**
 * Returns utterances captured after the given sequence cursor, with the new
 * cursor. Used by the polling transport (robust through Cloudflare, unlike SSE).
 */
export function utterancesSince(after: number): {
  seq: number;
  utterances: TranscriptUtterance[];
} {
  const fresh = entries.filter(entry => entry.seq > after);
  return { seq, utterances: fresh.map(entry => entry.utterance) };
}
