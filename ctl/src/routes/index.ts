import { Hono } from "hono";
import { registerMediaRoutes } from "./media";
import { registerWebhookRoutes } from "./webhooks";

interface CreateRouterOptions {
  onRecallWebhook(payload: unknown): void;
}

export function createRouter(options: CreateRouterOptions): Hono {
  const app = new Hono();

  app.get("/", c =>
    c.json({
      ok: true,
      endpoints: {
        health: "/health",
        recallWebhook: "/webhooks/recall",
        recallWebSocket: "/ws/recall",
        mediaCamera: "/media/camera",
        mediaScreen: "/media/screen",
        mediaApp: "/media/app.js",
      },
    }),
  );

  app.get("/health", c => c.json({ ok: true, service: "alfred-ctl" }));
  registerMediaRoutes(app);
  registerWebhookRoutes(app, options.onRecallWebhook);

  return app;
}
