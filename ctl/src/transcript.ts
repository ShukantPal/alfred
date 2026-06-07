/** A single final meeting utterance retained by ctl for transcript-derived features. */
export interface MeetingUtterance {
  text: string;
  speaker: string;
  ts: number;
}
