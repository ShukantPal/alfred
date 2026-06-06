import { z } from "zod";

/**
 * Wire protocol between the meeting control plane (ctl/) and the agent layer (agent/).
 *
 * One bidirectional WebSocket per meeting. ctl/ sends Inbound frames; agent/ replies
 * with a stream of Outbound frames. Every frame is JSON. "RPC" here = a typed request
 * envelope with a correlationId so streamed responses can be matched to their request.
 *
 * This is the single source of truth for the contract. ctl/ imports these types.
 */

// ---------- ctl/ -> agent/ (inbound to the agent) ----------

/** A transcribed utterance from the meeting (the board's "send message in text" RPC). */
export const SendMessageFrame = z.object({
  type: z.literal("sendMessage"),
  correlationId: z.string(),
  meetingId: z.string(),
  /** Who spoke. Lets the harness attribute and address the right person. */
  speaker: z.object({
    id: z.string(),
    displayName: z.string(),
  }),
  text: z.string(),
  /** Epoch ms when the utterance completed, for ordering. */
  ts: z.number(),
  /** Was the agent directly addressed? ctl/ sets this from wake-word/address detection. */
  addressedToAgent: z.boolean().default(false),
});

/** Session lifecycle so the agent can load/seed memory for a meeting. */
export const SessionFrame = z.object({
  type: z.literal("session"),
  action: z.enum(["open", "close"]),
  meetingId: z.string(),
  /** Optional roster so the harness knows who is present (and who is absent). */
  participants: z
    .array(z.object({ id: z.string(), displayName: z.string() }))
    .optional(),
});

export const InboundFrame = z.discriminatedUnion("type", [
  SendMessageFrame,
  SessionFrame,
]);
export type InboundFrame = z.infer<typeof InboundFrame>;

// ---------- agent/ -> ctl/ (outbound from the agent) ----------

/**
 * Streaming text out (the board's "streaming output messages in text" RPC).
 * ctl/ pipes `delta` to TTS / on-screen as it arrives; `done` marks end of turn.
 */
export interface AgentMessageFrame {
  type: "agentMessage";
  correlationId: string;
  meetingId: string;
  /** Incremental token chunk. Empty string allowed on the final `done` frame. */
  delta: string;
  done: boolean;
}

/**
 * A side-effect the agent wants ctl/ to perform in the meeting, e.g. present a doc
 * (board: computer-use MCP) or post to Slack/Linear. ctl/ owns execution + consent.
 */
export interface AgentActionFrame {
  type: "agentAction";
  correlationId: string;
  meetingId: string;
  action:
    | { kind: "presentUrl"; url: string; title: string }
    | { kind: "postSlack"; channel: string; text: string }
    | { kind: "createLinearIssue"; title: string; description: string };
  /** Actions with side effects require explicit human confirmation in ctl/. */
  requiresConfirmation: boolean;
}

/** Surfaces the subagent delegation tree to ctl/ for the live UI + maps to Weave spans. */
export interface AgentTraceFrame {
  type: "agentTrace";
  correlationId: string;
  meetingId: string;
  node: string; // e.g. "orchestrator" | "memory" | "docs" | "people"
  event: "start" | "finish";
  detail?: string;
}

export interface AgentErrorFrame {
  type: "agentError";
  correlationId: string;
  meetingId: string;
  message: string;
}

export type OutboundFrame =
  | AgentMessageFrame
  | AgentActionFrame
  | AgentTraceFrame
  | AgentErrorFrame;
