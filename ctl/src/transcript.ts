/** A single final meeting utterance, forwarded to agui for live meeting notes. */
export interface MeetingUtterance {
  text: string;
  speaker: string;
  ts: number;
}
