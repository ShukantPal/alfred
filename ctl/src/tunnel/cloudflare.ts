import { spawn } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export interface CloudflareTunnel {
  publicBaseUrl: string;
  pid: number;
  reused: boolean;
  logPath: string;
  stop(): void;
}

interface StartCloudflareTunnelOptions {
  bin?: string;
  name: string;
  localBaseUrl: string;
  timeoutMs: number;
}

interface TunnelState {
  version: 1;
  updatedAt?: string;
  tunnels: Record<string, TunnelEntry | undefined>;
}

interface TunnelEntry {
  name: string;
  targetUrl: string;
  pid: number;
  url: string;
  logPath: string;
  startedAt: string;
}

const TRY_CLOUDFLARE_URL = /https:\/\/[^\s|]+\.trycloudflare\.com/;
const root = process.cwd();
const toolsDir = join(root, ".tools");
const tunnelStatePath = join(toolsDir, "alfred-tunnels.json");

export async function startCloudflareTunnel(
  options: StartCloudflareTunnelOptions,
): Promise<CloudflareTunnel> {
  mkdirSync(toolsDir, { recursive: true });

  const state = readTunnelState();
  const existing = state.tunnels?.[options.name];
  if (
    existing?.targetUrl === options.localBaseUrl &&
    existing.url &&
    isProcessAlive(existing.pid)
  ) {
    console.log(
      `[cloudflared] reusing ${options.name} tunnel ${existing.url} (pid ${existing.pid})`,
    );
    return {
      publicBaseUrl: existing.url,
      pid: existing.pid,
      reused: true,
      logPath: existing.logPath,
      stop() {
        // Persistent tunnels are stopped explicitly with bun run demo:stop-tunnels.
      },
    };
  }

  if (existing?.pid && isProcessAlive(existing.pid)) {
    console.log(
      `[cloudflared] stopping stale ${options.name} tunnel for ${existing.targetUrl}`,
    );
    try {
      process.kill(existing.pid, "SIGTERM");
    } catch {
      // The process can disappear between liveness check and kill.
    }
  }

  const cloudflaredPath = resolveCloudflared(options.bin);
  const logPath = join(toolsDir, `alfred-${options.name}-tunnel.log`);
  writeFileSync(logPath, "");
  const out = openSync(logPath, "a");
  const child = spawn(cloudflaredPath, ["tunnel", "--url", options.localBaseUrl], {
    cwd: root,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  closeSync(out);

  if (!child.pid) {
    throw new Error("cloudflared did not produce a process id.");
  }

  const next: TunnelEntry = {
    name: options.name,
    targetUrl: options.localBaseUrl,
    pid: child.pid,
    url: "",
    logPath,
    startedAt: new Date().toISOString(),
  };
  writeTunnelEntry(options.name, next);

  const url = await waitForTunnelUrl(options.name, logPath, child.pid, options.timeoutMs);
  const ready = { ...next, url };
  writeTunnelEntry(options.name, ready);
  console.log(`[cloudflared] started ${options.name} tunnel ${url} (pid ${child.pid})`);

  return {
    publicBaseUrl: url,
    pid: child.pid,
    reused: false,
    logPath,
    stop() {
      // Persistent tunnels are stopped explicitly with bun run demo:stop-tunnels.
    },
  };
}

export function stopPersistentTunnels(): void {
  const state = readTunnelState();
  const entries = Object.values(state.tunnels || {});
  if (!entries.length) {
    console.log("[cloudflared] no persistent tunnels recorded.");
    return;
  }

  for (const entry of entries) {
    if (!entry?.pid || !isProcessAlive(entry.pid)) {
      console.log(`[cloudflared] ${entry?.name || "unknown"} tunnel is not running.`);
      continue;
    }

    process.kill(entry.pid, "SIGTERM");
    console.log(
      `[cloudflared] stopped ${entry.name} tunnel ${entry.url || ""} (pid ${entry.pid})`,
    );
  }

  writeFileSync(
    tunnelStatePath,
    `${JSON.stringify(
      { version: 1, tunnels: {}, updatedAt: new Date().toISOString() },
      null,
      2,
    )}\n`,
  );
}

function resolveCloudflared(configured?: string): string {
  const candidates = [
    configured,
    join(toolsDir, "cloudflared"),
    join(root, "..", "Take3", ".tools", "cloudflared"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      "Could not find a local cloudflared binary.",
      "Expected one of:",
      ...candidates.map(candidate => `  - ${candidate}`),
      "Set CLOUDFLARED_BIN to an explicit binary path if needed.",
    ].join("\n"),
  );
}

async function waitForTunnelUrl(
  name: string,
  logPath: string,
  pid: number,
  timeoutMs: number,
): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      throw new Error(`${name} tunnel exited before publishing a URL. See ${logPath}`);
    }

    const text = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
    const tunnelUrl = text.match(TRY_CLOUDFLARE_URL)?.[0];
    if (tunnelUrl) {
      return tunnelUrl.replace(/\/+$/, "");
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${name} tunnel URL. See ${logPath}`);
}

function readTunnelState(): TunnelState {
  return readJson(tunnelStatePath, { version: 1, tunnels: {} });
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeTunnelEntry(name: string, entry: TunnelEntry): void {
  const state = readTunnelState();
  state.version = 1;
  state.updatedAt = new Date().toISOString();
  state.tunnels = { ...(state.tunnels || {}), [name]: entry };
  writeFileSync(tunnelStatePath, `${JSON.stringify(state, null, 2)}\n`);
}

function isExecutable(path: string | undefined): path is string {
  if (!path) return false;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number | undefined): pid is number {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
