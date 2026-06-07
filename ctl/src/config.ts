import { config as loadDotEnv } from "dotenv";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type RealtimeDelivery = "webhook" | "websocket" | "both";
export type OutputMediaMode = "camera" | "screenshare" | "none";
export type VoiceProvider = "openai-realtime";

export interface DemoConfig {
  meetingUrl: string;
  botName: string;
  ctlHost: string;
  ctlPort: number;
  recallApiKey: string;
  recallRegion: string;
  recallBotVariant: string;
  publicBaseUrl?: string;
  cloudflaredBin?: string;
  tunnelName: string;
  tunnelTimeoutMs: number;
  shutdownTimeoutMs: number;
  realtimeDelivery: RealtimeDelivery;
  outputMediaMode: OutputMediaMode;
  aguiScreenshare: boolean;
  aguiDir: string;
  aguiPort: number;
  aguiPublicBaseUrl?: string;
  aguiScreensharePath: string;
  voiceProvider: VoiceProvider;
}

export function readDemoConfig(argv: string[], env: NodeJS.ProcessEnv): DemoConfig {
  loadRepoEnv(env);

  const meetingUrl = argv[0];
  if (!meetingUrl) {
    throw new UsageError("Usage: bun run demo <meeting-link>");
  }

  const recallApiKey = env.RECALL_API_KEY ?? env.RECALLAI_API_KEY;
  if (!recallApiKey) {
    throw new UsageError(
      "Missing RECALL_API_KEY. Set it before running bun run demo <meeting-link>.",
    );
  }

  return {
    meetingUrl,
    botName: env.ALFRED_BOT_NAME ?? "Alfred",
    ctlHost: env.ALFRED_CTL_HOST ?? "127.0.0.1",
    ctlPort: readInteger(env.ALFRED_CTL_PORT, 4321),
    recallApiKey,
    recallRegion: env.RECALL_REGION ?? env.RECALLAI_REGION ?? "us-west-2",
    recallBotVariant: env.RECALL_BOT_VARIANT ?? "web_4_core",
    publicBaseUrl: normalizeBaseUrl(env.ALFRED_PUBLIC_BASE_URL),
    cloudflaredBin: env.CLOUDFLARED_BIN,
    tunnelName: env.ALFRED_TUNNEL_NAME ?? "ctl",
    tunnelTimeoutMs: readInteger(env.ALFRED_TUNNEL_TIMEOUT_MS, 30_000),
    shutdownTimeoutMs: readInteger(env.ALFRED_SHUTDOWN_TIMEOUT_MS, 10_000),
    realtimeDelivery: readRealtimeDelivery(env.ALFRED_REALTIME_DELIVERY),
    outputMediaMode: readOutputMediaMode(env.ALFRED_OUTPUT_MEDIA),
    aguiScreenshare: readBoolean(env.ALFRED_AGUI_SCREENSHARE, true),
    aguiDir: env.ALFRED_AGUI_DIR ?? join(resolveRepoRoot(), "agui"),
    aguiPort: readInteger(env.ALFRED_AGUI_PORT, 3000),
    aguiPublicBaseUrl: normalizeBaseUrl(env.ALFRED_AGUI_PUBLIC_BASE_URL),
    aguiScreensharePath: env.ALFRED_AGUI_SCREENSHARE_PATH ?? "/screenshare",
    voiceProvider: readVoiceProvider(env),
  };
}

export class UsageError extends Error {
  name = "UsageError";
}

function resolveRepoRoot(): string {
  const sourceDir = fileURLToPath(new URL(".", import.meta.url));
  return join(sourceDir, "..", "..");
}

export function loadRepoEnv(env: NodeJS.ProcessEnv = process.env): void {
  const repoEnvPath = join(resolveRepoRoot(), ".env");
  loadDotEnv({ path: repoEnvPath, processEnv: env, quiet: true });
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value !== "0" && value.toLowerCase() !== "false";
}

function readInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\/+$/, "");
}

function readRealtimeDelivery(value: string | undefined): RealtimeDelivery {
  if (value === "websocket" || value === "both") return value;
  return "webhook";
}

function readOutputMediaMode(value: string | undefined): OutputMediaMode {
  if (value === "screenshare" || value === "none") return value;
  return "camera";
}

function readVoiceProvider(env: NodeJS.ProcessEnv): VoiceProvider {
  if (env.ALFRED_VOICE_PROVIDER && env.ALFRED_VOICE_PROVIDER !== "openai-realtime") {
    console.warn("[ctl] ALFRED_VOICE_PROVIDER is ignored; ctl only supports openai-realtime");
  }
  return "openai-realtime";
}
