import type { Hono } from "hono";
import { cameraAppBundle, cameraPage, screenAppBundle, screenPage } from "../media/pages";

export function registerMediaRoutes(app: Hono): void {
  app.get("/media/camera", () => cameraPage());
  app.get("/media/screen", () => screenPage());
  app.get("/media/camera.js", () => cameraAppBundle());
  app.get("/media/screen.js", () => screenAppBundle());
}
