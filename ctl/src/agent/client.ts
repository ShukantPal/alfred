/**
 * Client for the agent/ layer. ctl/ owns the meeting; agent/ owns memory + harness.
 *
 * Wire contract SOURCE OF TRUTH: agent/src/protocol.ts. It is mirrored here as plain
 * TypeScript types (no zod) so ctl/ (Bun) stays decoupled from agent/ (npm). One WebSocket
 * per meeting: ctl/ sends `sendMessage`, agent/ streams `agentMessage` deltas back.
 */

export interface AgentSpeaker {
  id: string;
  displayName: string;
}

/** Callbacks for one streamed answer. onDelta fires per token chunk; onDone ends the turn. */
export interface AgentSink {
  onDelta(delta: string): void;
  onDone(): void;
  onError(message: string): void;
  onTrace?(node: string, event: "start" | "finish", detail?: string): void;
}

export interface AgentClientOptions {
  url: string;
  meetingId: string;
}

export interface AgentClient {
  ask(question: string, speaker: AgentSpeaker, sink: AgentSink): void;
  close(): void;
}

/** Subset of agent/ -> ctl/ outbound frames we consume (see agent/src/protocol.ts). */
interface OutboundFrame {
  type: string;
  correlationId?: string;
  delta?: string;
  done?: boolean;
  message?: string;
  node?: string;
  event?: "start" | "finish";
  detail?: string;
}

export function createAgentClient(options: AgentClientOptions): AgentClient {
  const { url, meetingId } = options;
  const pending = new Map<string, AgentSink>();
  let socket: WebSocket | null = null;

  const connect = (): WebSocket => {
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      return socket;
    }

    const ws = new WebSocket(url);
    socket = ws;

    ws.addEventListener("open", () => {
      console.log(`[ctl] agent connected ${url}`);
      ws.send(JSON.stringify({ type: "session", action: "open", meetingId }));
    });
    ws.addEventListener("message", event => {
      const frame = parseFrame(event.data);
      if (frame) dispatch(frame);
    });
    ws.addEventListener("close", () => {
      console.log("[ctl] agent disconnected");
      if (socket === ws) socket = null;
      // Fail any in-flight asks so the responder never gets stuck "busy".
      for (const [id, sink] of pending) {
        sink.onError("agent connection closed");
        pending.delete(id);
      }
    });
    ws.addEventListener("error", () => console.error("[ctl] agent socket error"));

    return ws;
  };

  const dispatch = (frame: OutboundFrame): void => {
    const id = frame.correlationId;
    const sink = id ? pending.get(id) : undefined;

    switch (frame.type) {
      case "agentMessage":
        if (!sink || !id) return;
        if (frame.delta) sink.onDelta(frame.delta);
        if (frame.done) {
          sink.onDone();
          pending.delete(id);
        }
        return;
      case "agentTrace":
        sink?.onTrace?.(frame.node ?? "?", frame.event ?? "start", frame.detail);
        return;
      case "agentError":
        if (sink && id) {
          sink.onError(frame.message ?? "agent error");
          pending.delete(id);
        }
        return;
    }
  };

  return {
    ask(question, speaker, sink) {
      const ws = connect();
      const correlationId = crypto.randomUUID();
      pending.set(correlationId, sink);

      const payload = JSON.stringify({
        type: "sendMessage",
        correlationId,
        meetingId,
        speaker,
        text: question,
        ts: Date.now(),
        addressedToAgent: true,
      });

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      } else {
        ws.addEventListener("open", () => ws.send(payload), { once: true });
      }
    },
    close() {
      socket?.close();
      socket = null;
    },
  };
}

function parseFrame(data: unknown): OutboundFrame | undefined {
  try {
    const text =
      typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
      return parsed as OutboundFrame;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
