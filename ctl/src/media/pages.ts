import { join } from "node:path";

const cameraPagePath = join(process.cwd(), "ctl", "src", "media", "camera.html");
const screenPagePath = join(process.cwd(), "ctl", "src", "media", "screen.html");
const mediaAppPath = join(process.cwd(), "ctl", "src", "media", "app.ts");

export function cameraPage(): Response {
  return mediaShell(cameraPagePath);
}

export function screenPage(): Response {
  return mediaShell(screenPagePath);
}

export async function mediaAppBundle(): Promise<Response> {
  const result = await Bun.build({
    entrypoints: [mediaAppPath],
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
