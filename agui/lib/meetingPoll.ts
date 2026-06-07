const MAX_BACKOFF_MS = 10_000;

/** Abort/cleanup noise and the first couple of transient dev-server blips. */
export function isBenignPollError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function pollDelayMs(baseMs: number, consecutiveFailures: number): number {
  if (consecutiveFailures === 0) return baseMs;
  const multiplier = 2 ** Math.min(consecutiveFailures - 1, 4);
  return Math.min(MAX_BACKOFF_MS, baseMs * multiplier);
}

export function logPollFailure(
  tag: string,
  error: unknown,
  consecutiveFailures: number,
): void {
  if (isBenignPollError(error)) return;
  const message = `[agui] ${tag} poll failed`;
  if (consecutiveFailures < 3) return;
  if (consecutiveFailures < 10) {
    console.warn(message, error);
    return;
  }
  console.error(message, error);
}
