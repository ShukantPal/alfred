import type { Hono } from "hono";

export function registerWebhookRoutes(
  app: Hono,
  onPayload: (payload: unknown) => void,
): void {
  app.post("/webhooks/recall", c => handleRecallWebhook(c.req.raw, onPayload));
}

async function handleRecallWebhook(
  request: Request,
  onPayload: (payload: unknown) => void,
): Promise<Response> {
  const body = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  let parsed: unknown = body;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Keep the raw body for debugging non-JSON callbacks.
  }

  console.log("[ctl] recall webhook", JSON.stringify({ headers, body: parsed }, null, 2));
  onPayload(parsed);
  return Response.json({ ok: true });
}
