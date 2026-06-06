export interface RecallClientOptions {
  apiKey: string;
  region: string;
}

export class RecallClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: RecallClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = `https://${options.region}.recall.ai/api/v1`;
  }

  async createBot(payload: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/bot/`, {
      method: "POST",
      headers: {
        Authorization: normalizeAuthorizationHeader(this.apiKey),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Recall Create Bot failed: ${response.status} ${response.statusText}\n${body}`,
      );
    }

    return response.json();
  }

  async leaveBotCall(botId: string, timeoutMs: number): Promise<unknown> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/bot/${botId}/leave_call/`, {
        method: "POST",
        headers: {
          Authorization: normalizeAuthorizationHeader(this.apiKey),
          Accept: "application/json",
        },
        signal: abort.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Recall Leave Bot Call failed: ${response.status} ${response.statusText}\n${body}`,
        );
      }

      if (response.status === 204) return undefined;
      const body = await response.text();
      return body ? JSON.parse(body) : undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeAuthorizationHeader(apiKey: string): string {
  if (apiKey.includes(" ")) return apiKey;
  return `Token ${apiKey}`;
}
