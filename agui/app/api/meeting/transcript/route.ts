import {
  pushUtterance,
  recentUtterances,
  subscribeUtterances,
  utterancesSince,
} from "@/lib/transcriptHub";
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

export async function GET(request: Request) {
  const url = new URL(request.url);

  // Polling transport: plain JSON request/response. Unlike SSE, this streams
  // reliably through Cloudflare tunnels, so it's what the Recall-rendered
  // screenshare surface uses. `?after=<seq>` returns only newer utterances.
  if (url.searchParams.has("poll")) {
    const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
    const { seq, utterances } = utterancesSince(Number.isFinite(after) ? after : 0);
    return Response.json(
      { seq, utterances },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      for (const utterance of recentUtterances()) {
        send("utterance", utterance);
      }

      unsubscribe = subscribeUtterances(utterance => send("utterance", utterance));

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe?.();
        controller.close();
      });
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
