import type { Hono } from "hono";
import { cameraPage, mediaAppBundle, screenPage } from "../media/pages";

export function registerMediaRoutes(app: Hono): void {
  app.get("/media/camera", () => cameraPage());
  app.get("/media/screen", () => screenPage());
  app.get("/media/app.js", () => mediaAppBundle());
}
