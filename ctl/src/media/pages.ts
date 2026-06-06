import { join } from "node:path";
import { fileURLToPath } from "node:url";

const mediaDir = fileURLToPath(new URL(".", import.meta.url));
const cameraPagePath = join(mediaDir, "camera.html");
const screenPagePath = join(mediaDir, "screen.html");
const cameraAppPath = join(mediaDir, "camera.ts");
const screenAppPath = join(mediaDir, "screen.ts");

export function cameraPage(): Response {
  return mediaShell(cameraPagePath);
}

export function screenPage(): Response {
  return mediaShell(screenPagePath);
}

export async function cameraAppBundle(): Promise<Response> {
  return bundleBrowserApp(cameraAppPath);
}

export async function screenAppBundle(): Promise<Response> {
  return bundleBrowserApp(screenAppPath);
}

async function bundleBrowserApp(entrypoint: string): Promise<Response> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    format: "esm",
    minify: process.env.NODE_ENV === "production",
    target: "browser",
  });

  if (!result.success) {
    console.error("[ctl] media app bundle failed", result.logs);
    return new Response("Failed to bundle media app.", { status: 500 });
  }

  const output = result.outputs[0];
  return new Response(output, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function mediaShell(path: string): Response {
  return new Response(Bun.file(path), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
