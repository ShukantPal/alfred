import { join } from "node:path";
import type { Hono } from "hono";

export function registerAudioRoutes(app: Hono): void {
  app.get("/audio/hello.wav", () => serveAudio("hello.wav"));
}

export function serveAudio(filename: string): Response {
  const file = Bun.file(join(process.cwd(), "ctl", "assets", "audio", filename));
  return new Response(file, {
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
    },
  });
}
