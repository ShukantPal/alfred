export type RealtimeDelivery = "webhook" | "websocket" | "both";
export type OutputMediaMode = "camera" | "screenshare" | "none";
export type SttProvider = "recall" | "deepgram";

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
  sttProvider: SttProvider;
}

export function readDemoConfig(argv: string[], env: NodeJS.ProcessEnv): DemoConfig {
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
    sttProvider: readSttProvider(env),
  };
}

export class UsageError extends Error {
  name = "UsageError";
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

function readSttProvider(env: NodeJS.ProcessEnv): SttProvider {
  if (env.ALFRED_STT_PROVIDER === "recall") return "recall";
  if (env.ALFRED_STT_PROVIDER === "deepgram") return "deepgram";
  return env.DEEPGRAM_API_KEY ? "deepgram" : "recall";
}
