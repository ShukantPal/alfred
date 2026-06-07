import { pushUtterance, utterancesSince, allUtterances } from "@/lib/transcriptHub";
import type { TranscriptUtterance } from "@/lib/meetingNotes";

export const dynamic = "force-dynamic";

function parseUtterance(body: unknown): TranscriptUtterance | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) return undefined;
  const speaker =
    typeof record.speaker === "string" && record.speaker.trim()
      ? record.speaker.trim()
      : "Participant";
  const ts = typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : Date.now();
  return { text, speaker, ts };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const utterance = parseUtterance(body);
  if (!utterance) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  pushUtterance(utterance);
  return Response.json({ ok: true });
}

// Buffer transport: plain JSON request/response. This backs both the live catch-up
// poll and the end-of-meeting transcript. Live deltas are also pushed over ctl's
// /ws/notes WebSocket for sub-second latency; polling stays as the reliable fallback
// (SSE was dropped because Cloudflare quick tunnels buffer text/event-stream).
//   ?after=<seq>  -> only utterances newer than the cursor (live catch-up)
//   ?full=1       -> the entire retained transcript (end-of-meeting summary)
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("full")) {
    const { seq, utterances } = allUtterances();
    return Response.json(
      { seq, utterances },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
  const { seq, utterances } = utterancesSince(Number.isFinite(after) ? after : 0);
  return Response.json(
    { seq, utterances },
    { headers: { "Cache-Control": "no-store" } },
  );
}
