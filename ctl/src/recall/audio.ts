export function extractRecallMixedAudio(payload: unknown): Uint8Array | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const event = "event" in payload ? String(payload.event) : "";
  if (event !== "audio_mixed_raw.data") return undefined;

  const encoded = findBufferString(payload);
  if (!encoded) return undefined;
  return Buffer.from(encoded, "base64");
}

function findBufferString(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findBufferString(item);
      if (found) return found;
    }
    return undefined;
  }

  if ("buffer" in payload && typeof payload.buffer === "string") {
    return payload.buffer;
  }

  for (const value of Object.values(payload)) {
    const found = findBufferString(value);
    if (found) return found;
  }

  return undefined;
}
