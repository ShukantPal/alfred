import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { startCloudflareTunnel } from "./tunnel/cloudflare";

export interface AguiScreenshareServer {
  /** Public base URL the agui app is reachable at. */
  publicBaseUrl: string;
  /** Local URL ctl uses to POST transcripts (same machine, no tunnel). */
  localBaseUrl: string;
  /** Full public URL Recall should render as the screenshare. */
  screenshareUrl: string;
  /** Stops the local Next server (the tunnel is left running for reuse). */
  stop(): void;
}

export interface StartAguiScreenshareOptions {
  aguiDir: string;
  port: number;
  screensharePath: string;
  /** If set, the operator runs agui themselves; skip spawning + tunneling. */
  publicBaseUrl?: string;
  cloudflaredBin?: string;
  tunnelName: string;
  tunnelTimeoutMs: number;
  env: NodeJS.ProcessEnv;
}

const READY_TIMEOUT_MS = 90_000;
const MAX_PORT_ATTEMPTS = 10;
const SPAWN_SETTLE_MS = 800;

export async function startAguiScreenshareServer(
  options: StartAguiScreenshareOptions,
): Promise<AguiScreenshareServer> {
  const path = options.screensharePath.startsWith("/")
    ? options.screensharePath
    : `/${options.screensharePath}`;

  // Operator-managed agui: just point at the URL they provided.
  if (options.publicBaseUrl) {
    const base = options.publicBaseUrl.replace(/\/$/, "");
    return {
      publicBaseUrl: base,
      localBaseUrl: base,
      screenshareUrl: `${base}${path}`,
      stop() {},
    };
  }

  const nextBin = join(options.aguiDir, "node_modules", ".bin", "next");
  if (!existsSync(nextBin)) {
    throw new Error(
      `agui is not installed. Expected ${nextBin}. Run "npm install" in ${options.aguiDir}.`,
    );
  }

  const toolsDir = join(process.cwd(), ".tools");
  mkdirSync(toolsDir, { recursive: true });
  const logPath = join(toolsDir, "alfred-agui.log");
  const out = openSync(logPath, "a");

  let child: ChildProcess | undefined;
  let spawned = false;
  let port = options.port;
  let localBaseUrl = `http://127.0.0.1:${port}`;
  const readyUrl = `${localBaseUrl}${path}`;

  const reusable =
    (await probeAgui(readyUrl)) && (await probeTranscriptRoute(localBaseUrl));
  if (reusable) {
    console.log(`[agui] reusing existing Next server at ${readyUrl}`);
  } else {
    if (await probeAgui(readyUrl)) {
      console.warn(
        `[agui] existing server at ${readyUrl} is missing the meeting-notes route; ` +
          "starting a fresh server (stop the stale dev server to free the default port).",
      );
    }
    const started = await spawnNextAndWait({
      nextBin,
      aguiDir: options.aguiDir,
      port: options.port,
      path,
      env: options.env,
      logPath,
      out,
    });
    child = started.child;
    port = started.port;
    localBaseUrl = started.localBaseUrl;
    spawned = true;
  }

  const stop = () => {
    if (!spawned || !child?.pid) return;
    stopChild(child);
  };

  try {
    const tunnel = await startCloudflareTunnel({
      bin: options.cloudflaredBin,
      name: options.tunnelName,
      localBaseUrl,
      timeoutMs: options.tunnelTimeoutMs,
    });

    return {
      publicBaseUrl: tunnel.publicBaseUrl,
      localBaseUrl,
      screenshareUrl: `${tunnel.publicBaseUrl}${path}`,
      stop,
    };
  } catch (error) {
    stop();
    throw error;
  }
}

async function probeAgui(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// A reused server is only useful if it serves the meeting-notes transcript route.
// Stale dev servers started before that route existed answer /screenshare with 200
// but 404 the transcript endpoint, silently dropping every forwarded utterance.
async function probeTranscriptRoute(localBaseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${localBaseUrl}/api/meeting/transcript`, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    return response.status !== 404;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function spawnNextAndWait(options: {
  nextBin: string;
  aguiDir: string;
  port: number;
  path: string;
  env: NodeJS.ProcessEnv;
  logPath: string;
  out: number;
}): Promise<{ child: ChildProcess; port: number; localBaseUrl: string }> {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset++) {
    const port = options.port + offset;
    const localBaseUrl = `http://127.0.0.1:${port}`;
    const url = `${localBaseUrl}${options.path}`;

    // `detached: true` makes the child its own process-group leader so we can reap
    // the whole tree on stop. `next dev` forks worker subprocesses that hold the
    // port; signalling only the parent PID leaves them (and the port) alive.
    const child = spawn(options.nextBin, ["dev", "-p", String(port)], {
      cwd: options.aguiDir,
      env: { ...options.env, PORT: String(port) },
      stdio: ["ignore", options.out, options.out],
      detached: true,
    });

    if (!child.pid) {
      continue;
    }

    await new Promise(resolve => setTimeout(resolve, SPAWN_SETTLE_MS));

    if (child.exitCode !== null) {
      continue;
    }

    try {
      await waitForAguiReady(url, child, options.logPath);
      if (offset > 0) {
        console.log(`[agui] started on port ${port} (${options.port} was unavailable)`);
      }
      return { child, port, localBaseUrl };
    } catch (error) {
      stopChild(child);
      if (child.exitCode !== null && offset < MAX_PORT_ATTEMPTS - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Could not start agui Next server on ports ${options.port}-${options.port + MAX_PORT_ATTEMPTS - 1}. ` +
      `Stop any process using those ports or set ALFRED_AGUI_PORT. See ${options.logPath}`,
  );
}

function stopChild(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  killProcessTree(pid, "SIGTERM");
  // next dev can ignore/slow-walk SIGTERM; force-kill the group shortly after.
  // unref so this timer never keeps ctl alive on its way out.
  setTimeout(() => killProcessTree(pid, "SIGKILL"), 2_000).unref();
}

// Signal the child's entire process group (negative pid). Falls back to the bare
// pid if the group is gone, e.g. the child was never detached.
function killProcessTree(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The process is already gone.
    }
  }
}

async function waitForAguiReady(
  url: string,
  child: ChildProcess,
  logPath: string,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(
        `agui Next server exited (code ${child.exitCode}) before becoming ready. See ${logPath}`,
      );
    }

    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) return;
    } catch {
      // Server not accepting connections yet.
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for agui at ${url}. See ${logPath}`);
}
