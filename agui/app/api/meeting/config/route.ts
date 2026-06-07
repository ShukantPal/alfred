import { setCtlBaseUrl, getNotesWsUrl } from "@/lib/meetingConfig";

export const dynamic = "force-dynamic";

// ctl POSTs its public base URL here so the screenshare page can open the notes WS.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const ctlBaseUrl =
    body && typeof body === "object" && "ctlBaseUrl" in body
      ? (body as { ctlBaseUrl?: unknown }).ctlBaseUrl
      : undefined;
  if (typeof ctlBaseUrl !== "string" || !ctlBaseUrl.trim()) {
    return Response.json({ error: "ctlBaseUrl is required" }, { status: 400 });
  }

  setCtlBaseUrl(ctlBaseUrl);
  return Response.json({ ok: true, notesWsUrl: getNotesWsUrl() });
}

// The screenshare page reads this to learn where to open the live notes WebSocket.
// `notesWsUrl` is null until ctl completes its handshake, in which case the page
// stays on polling only.
export async function GET() {
  return Response.json(
    { notesWsUrl: getNotesWsUrl() ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
