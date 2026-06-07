import { readDemoConfig, UsageError } from "./config";
import { RecallClient } from "./recall/client";
import { buildCreateBotPayload, buildWebpageScreenshareOutputMedia } from "./recall/bots";
import { startCtlServer, type CtlServer } from "./server";
import { startCloudflareTunnel, type CloudflareTunnel } from "./tunnel/cloudflare";
import { startAguiScreenshareServer, type AguiScreenshareServer } from "./agui";

async function main() {
  const config = readDemoConfig(Bun.argv.slice(2), process.env);
  let ctlServer: CtlServer | undefined;
  let tunnel: CloudflareTunnel | undefined;
  let recall: RecallClient | undefined;
  let botId: string | undefined;
  let publicBaseUrl: string | undefined = config.publicBaseUrl;
  let agui: AguiScreenshareServer | undefined;
  let isShuttingDown = false;
  let isStartingScreenshare = false;

  const screenshareUrl = () =>
    agui?.screenshareUrl ?? (publicBaseUrl ? `${publicBaseUrl}/media/screen` : undefined);

  const startScreenshare = async () => {
    if (isStartingScreenshare) return;
    const target = screenshareUrl();
    if (!botId || !recall || !target) {
      console.warn("[demo] cannot start screenshare before the Recall bot is ready");
      ctlServer?.broadcast({
        type: "status",
        message: "screenshare unavailable until bot is ready",
      });
      return;
    }

    isStartingScreenshare = true;
    ctlServer?.broadcast({ type: "status", message: "starting screenshare" });

    try {
      await recall.startOutputMedia(botId, buildWebpageScreenshareOutputMedia(target));
      console.log(`[demo] Recall screenshare output media started: ${target}`);
      ctlServer?.broadcast({ type: "status", message: "screenshare started" });
    } catch (error) {
      console.error("[demo] failed to start Recall screenshare output media");
      console.error(error);
      ctlServer?.broadcast({ type: "status", message: "screenshare failed" });
    } finally {
      isStartingScreenshare = false;
    }
  };

  const cleanup = async () => {
    if (botId && recall) {
      console.log(`[demo] asking Recall bot ${botId} to leave the call`);
      try {
        await recall.leaveBotCall(botId, config.shutdownTimeoutMs);
        console.log(`[demo] Recall bot ${botId} leave_call accepted`);
      } catch (error) {
        console.error(`[demo] failed to remove Recall bot ${botId} from call`);
        console.error(error);
      } finally {
        botId = undefined;
      }
    }

    agui?.stop();
    tunnel?.stop();
    await ctlServer?.stop();
  };

  const shutdown = async () => {
    if (isShuttingDown) {
      console.warn("[demo] shutdown already in progress; waiting for Recall leave_call");
      return;
    }
    isShuttingDown = true;
    const forceExit = setTimeout(() => {
      console.warn("[demo] shutdown timed out; forcing exit");
      process.exit(130);
    }, config.shutdownTimeoutMs + 10_000);
    forceExit.unref();
    console.log("\n[demo] shutting down");
    try {
      await cleanup();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      clearTimeout(forceExit);
      console.error("[demo] shutdown failed");
      console.error(error);
      process.exit(1);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    ctlServer = startCtlServer(config.ctlHost, config.ctlPort, {
      onStartScreenshare() {
        return startScreenshare();
      },
    });
    console.log(`[demo] ctl server listening at ${ctlServer.localBaseUrl}`);

    if (!publicBaseUrl) {
      console.log("[demo] starting Cloudflare quick tunnel");
      tunnel = await startCloudflareTunnel({
        bin: config.cloudflaredBin,
        name: config.tunnelName,
        localBaseUrl: ctlServer.localBaseUrl,
        timeoutMs: config.tunnelTimeoutMs,
      });
      publicBaseUrl = tunnel.publicBaseUrl;
    }

    console.log(`[demo] public base URL: ${publicBaseUrl}`);
    console.log(`[demo] Recall webhook URL: ${publicBaseUrl}/webhooks/recall`);
    const mediaPath =
      config.outputMediaMode === "screenshare" ? "screen" : config.outputMediaMode;
    console.log(`[demo] media URL: ${publicBaseUrl}/media/${mediaPath}`);

    if (config.aguiScreenshare) {
      try {
        console.log("[demo] starting agui screenshare surface");
        agui = await startAguiScreenshareServer({
          aguiDir: config.aguiDir,
          port: config.aguiPort,
          screensharePath: config.aguiScreensharePath,
          publicBaseUrl: config.aguiPublicBaseUrl,
          cloudflaredBin: config.cloudflaredBin,
          tunnelName: "agui",
          tunnelTimeoutMs: config.tunnelTimeoutMs,
          env: process.env,
        });
        console.log(`[demo] agui screenshare URL: ${agui.screenshareUrl}`);
        ctlServer?.setAguiBaseUrl(agui.localBaseUrl);
      } catch (error) {
        console.error(
          "[demo] failed to start agui screenshare surface; falling back to ctl /media/screen",
        );
        console.error(error);
      }
    }

    ctlServer.broadcast({ type: "status", message: "joining meeting" });

    recall = new RecallClient({
      apiKey: config.recallApiKey,
      region: config.recallRegion,
    });

    const payload = buildCreateBotPayload({
      meetingUrl: config.meetingUrl,
      botName: config.botName,
      botVariant: config.recallBotVariant,
      publicBaseUrl,
      realtimeDelivery: config.realtimeDelivery,
      outputMediaMode: config.outputMediaMode,
      enableRawAudio: config.voiceProvider === "openai-realtime",
      enableTranscriptEvents: false,
      screenshareUrl: agui?.screenshareUrl,
    });

    console.log("[demo] creating Recall bot");
    const bot = await recall.createBot(payload);
    botId = readBotId(bot);
    console.log("[demo] Recall bot created");
    console.log(JSON.stringify(bot, null, 2));
    if (botId) {
      console.log(`[demo] Recall bot id: ${botId}`);
    } else {
      console.warn("[demo] Recall bot response did not include an id; shutdown cannot call leave_call.");
    }

    ctlServer.broadcast({ type: "status", message: "meeting bot created" });
    console.log("[demo] ctl is running. Press Ctrl+C to stop.");
    console.log("[demo] persistent tunnels remain running; use bun run demo:stop-tunnels to stop them.");

    await new Promise(() => {
      // Keep process alive for webhook, websocket, and output media traffic.
    });
  } catch (error) {
    await cleanup();
    throw error;
  }
}

main().catch(error => {
  if (error instanceof UsageError) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  console.error(error);
  process.exitCode = 1;
});

function readBotId(bot: unknown): string | undefined {
  if (!bot || typeof bot !== "object") return undefined;
  if ("id" in bot && typeof bot.id === "string") return bot.id;
  if ("bot" in bot && bot.bot && typeof bot.bot === "object") {
    const nested = bot.bot;
    if ("id" in nested && typeof nested.id === "string") return nested.id;
  }
  return undefined;
}
