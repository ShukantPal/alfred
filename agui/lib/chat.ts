export type ChatRole = "user" | "alfred";
export type ChatKind = "text" | "voice";
export type ChatStatus = "speaking" | "done";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** "text" renders the message body; "voice" renders an animated waveform. */
  kind: ChatKind;
  /** Present for text messages (e.g. the user's question). */
  text?: string;
  /** Voice messages animate while "speaking" and settle when "done". */
  status?: ChatStatus;
  /** When the message was created (epoch ms). */
  ts: number;
}

/**
 * ctl posts chat events as the delegate path runs. "add" introduces a bubble;
 * "update" mutates an existing one (e.g. flipping a voice bubble to "done").
 */
export type ChatEvent =
  | {
      op: "add";
      id?: string;
      role: ChatRole;
      kind: ChatKind;
      text?: string;
      status?: ChatStatus;
      ts?: number;
    }
  | {
      op: "update";
      id: string;
      text?: string;
      status?: ChatStatus;
    };
