import type { Hono } from "hono";
import { serveAudio } from "./audio";
import type { DeepgramTts } from "../tts/deepgram";
import { padWavSilence } from "../tts/wav";

export function registerTtsRoutes(app: Hono, tts: DeepgramTts): void {
  app.get("/tts", c => handleTtsRequest(c.req.query("text") ?? "", tts));
}

async function handleTtsRequest(rawText: string, tts: DeepgramTts): Promise<Response> {
  const text = rawText.trim();
  if (!text) {
    return Response.json({ error: "Missing text query parameter." }, { status: 400 });
  }

  if (text.length > 1_000) {
    return Response.json({ error: "Text is too long." }, { status: 413 });
  }

  if (!tts.enabled) {
    if (isDemoGreeting(text)) {
      console.log("[ctl] TTS fallback audio used: DEEPGRAM_API_KEY is not set");
      return serveAudio("hello.wav");
    }
    return Response.json({ error: "DEEPGRAM_API_KEY is not set." }, { status: 503 });
  }

  try {
    console.log("[ctl] TTS requesting Deepgram audio");
    const audio = await tts.synthesize(text);
    const body = await new Response(audio.body).arrayBuffer();
    const paddedBody = maybePadAudio(body, audio.contentType);
    console.log(
      `[ctl] TTS served by ${audio.provider} content_type=${audio.contentType} bytes=${paddedBody.byteLength}`,
    );
    return new Response(paddedBody, {
      headers: {
        "Content-Type": audio.contentType,
        "Cache-Control": "no-store",
        "X-Alfred-TTS-Provider": audio.provider,
      },
    });
  } catch (error) {
    console.error("[ctl] Deepgram TTS failed", error);
    if (isDemoGreeting(text)) {
      console.log("[ctl] TTS fallback audio used after Deepgram failure");
      return serveAudio("hello.wav");
    }
    return Response.json({ error: "TTS failed." }, { status: 502 });
  }
}

function maybePadAudio(body: ArrayBuffer, contentType: string): ArrayBuffer {
  if (!contentType.includes("wav")) return body;
  return padWavSilence(body, { leadingMs: 200, trailingMs: 250 });
}

function isDemoGreeting(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return (
    normalized === "hello" ||
    normalized === "hello i m alfred and i m ready to help"
  );
}
