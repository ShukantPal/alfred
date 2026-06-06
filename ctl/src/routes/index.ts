import { Hono } from "hono";
import { registerAudioRoutes } from "./audio";
import { registerMediaRoutes } from "./media";
import { registerTtsRoutes } from "./tts";
import { registerWebhookRoutes } from "./webhooks";
import type { DeepgramTts } from "../tts/deepgram";

interface CreateRouterOptions {
  tts: DeepgramTts;
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
        helloAudio: "/audio/hello.wav",
        tts: "/tts?text=Hello.%20I'm%20Alfred%20and%20I'm%20ready%20to%20help!",
      },
    }),
  );

  app.get("/health", c => c.json({ ok: true, service: "alfred-ctl" }));
  registerMediaRoutes(app);
  registerAudioRoutes(app);
  registerTtsRoutes(app, options.tts);
  registerWebhookRoutes(app, options.onRecallWebhook);

  return app;
}
