import { addMessage, updateMessage, messagesSince, allMessages } from "@/lib/chatHub";
import type { ChatEvent, ChatKind, ChatRole, ChatStatus } from "@/lib/chat";

export const dynamic = "force-dynamic";

function parseEvent(body: unknown): ChatEvent | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const op = record.op === "update" ? "update" : "add";

  if (op === "update") {
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) return undefined;
    return {
      op: "update",
      id,
      text: typeof record.text === "string" ? record.text : undefined,
      status: parseStatus(record.status),
    };
  }

  const role: ChatRole = record.role === "alfred" ? "alfred" : "user";
  const kind: ChatKind = record.kind === "voice" ? "voice" : "text";
  const text = typeof record.text === "string" ? record.text : undefined;
  if (kind === "text" && !(text && text.trim())) return undefined;
  return {
    op: "add",
    id: typeof record.id === "string" ? record.id : undefined,
    role,
    kind,
    text,
    status: parseStatus(record.status),
    ts: typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : undefined,
  };
}

function parseStatus(value: unknown): ChatStatus | undefined {
  if (value === "thinking" || value === "speaking" || value === "done") return value;
  return undefined;
}

// ctl POSTs chat events here as the delegate path runs; the screenshare ChatMode
// polls GET (and also receives /ws/notes pushes for sub-second latency).
//   { op: "add", role, kind, text?, status? }  -> append a bubble
//   { op: "update", id, text?, status? }        -> mutate an existing bubble
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const event = parseEvent(body);
  if (!event) {
    return Response.json({ error: "invalid chat event" }, { status: 400 });
  }

  if (event.op === "update") {
    const message = updateMessage(event.id, { text: event.text, status: event.status });
    if (!message) return Response.json({ error: "unknown message id" }, { status: 404 });
    return Response.json({ ok: true, message });
  }

  const message = addMessage({
    id: event.id,
    role: event.role,
    kind: event.kind,
    text: event.text,
    status: event.status,
    ts: event.ts,
  });
  return Response.json({ ok: true, message });
}

// Buffer transport: plain JSON request/response (no SSE — Cloudflare quick tunnels
// buffer text/event-stream). Live deltas also ride ctl's /ws/notes WebSocket.
//   ?after=<seq>  -> only messages newer than the cursor (live catch-up)
//   ?full=1       -> the entire chat history
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("full")) {
    const { seq, messages } = allMessages();
    return Response.json({ seq, messages }, { headers: { "Cache-Control": "no-store" } });
  }
  const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
  const { seq, messages } = messagesSince(Number.isFinite(after) ? after : 0);
  return Response.json({ seq, messages }, { headers: { "Cache-Control": "no-store" } });
}
