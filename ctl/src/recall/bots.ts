import type { OutputMediaMode, RealtimeDelivery } from "../config";

export interface BuildCreateBotPayloadOptions {
  meetingUrl: string;
  botName: string;
  botVariant: string;
  publicBaseUrl: string;
  realtimeDelivery: RealtimeDelivery;
  outputMediaMode: OutputMediaMode;
  enableDeepgramStt: boolean;
  /** Overrides the screenshare webpage URL (e.g. the agui surface). */
  screenshareUrl?: string;
}

export function buildCreateBotPayload(options: BuildCreateBotPayloadOptions): object {
  const payload: Record<string, unknown> = {
    meeting_url: options.meetingUrl,
    bot_name: options.botName,
    variant: {
      zoom: options.botVariant,
      google_meet: options.botVariant,
      microsoft_teams: options.botVariant,
    },
    metadata: {
      app: "alfred",
      public_base_url: options.publicBaseUrl,
      created_by: "alfred-ctl-demo",
      created_at: new Date().toISOString(),
    },
    recording_config: {
      transcript: {
        provider: {
          recallai_streaming: {
            mode: "prioritize_low_latency",
            language_code: "en",
          },
        },
      },
      realtime_endpoints: buildRealtimeEndpoints(
        options.publicBaseUrl,
        options.realtimeDelivery,
        options.enableDeepgramStt,
      ),
    },
  };

  if (options.enableDeepgramStt) {
    (payload.recording_config as Record<string, unknown>).audio_mixed_raw = {};
  }

  const outputMedia = buildOutputMedia(
    options.publicBaseUrl,
    options.outputMediaMode,
    options.screenshareUrl,
  );
  if (outputMedia) {
    payload.output_media = outputMedia;
  }

  return payload;
}

export function buildScreenshareOutputMedia(publicBaseUrl: string): object {
  return buildOutputMedia(publicBaseUrl, "screenshare") ?? {};
}

/** Builds a screenshare output_media payload that renders an explicit webpage URL. */
export function buildWebpageScreenshareOutputMedia(url: string): object {
  return { screenshare: { kind: "webpage", config: { url } } };
}

function buildRealtimeEndpoints(
  publicBaseUrl: string,
  delivery: RealtimeDelivery,
  enableDeepgramStt: boolean,
): object[] {
  const transcriptAndParticipantEvents = [
    "transcript.data",
    "transcript.partial_data",
    "participant_events.join",
    "participant_events.leave",
    "participant_events.speech_on",
    "participant_events.speech_off",
    "participant_events.chat_message",
  ];

  const endpoints: object[] = [];

  if (delivery === "webhook" || delivery === "both") {
    endpoints.push({
      type: "webhook",
      url: `${publicBaseUrl}/webhooks/recall`,
      events: transcriptAndParticipantEvents,
    });
  }

  const websocketEvents = [
    ...(delivery === "websocket" || delivery === "both"
      ? transcriptAndParticipantEvents
      : []),
    ...(enableDeepgramStt ? ["audio_mixed_raw.data"] : []),
  ];

  if (websocketEvents.length > 0) {
    endpoints.push({
      type: "websocket",
      url: toWebSocketUrl(`${publicBaseUrl}/ws/recall`),
      events: websocketEvents,
    });
  }

  return endpoints;
}

function buildOutputMedia(
  publicBaseUrl: string,
  mode: OutputMediaMode,
  screenshareUrl?: string,
): object | undefined {
  if (mode === "none") return undefined;

  if (mode === "screenshare") {
    const url = screenshareUrl ?? `${publicBaseUrl}/media/screen`;
    return { screenshare: { kind: "webpage", config: { url } } };
  }

  return {
    camera: {
      kind: "webpage",
      config: {
        url: `${publicBaseUrl}/media/camera`,
      },
    },
  };
}

function toWebSocketUrl(url: string): string {
  if (url.startsWith("https://")) return `wss://${url.slice("https://".length)}`;
  if (url.startsWith("http://")) return `ws://${url.slice("http://".length)}`;
  return url;
}
