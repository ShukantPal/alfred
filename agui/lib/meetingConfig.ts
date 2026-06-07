// Runtime handshake from ctl. ctl POSTs its public base URL here on startup so the
// screenshare page can derive the notes WebSocket endpoint (ctl, not agui, hosts the
// WS — Next route handlers can't upgrade connections). Module-level state is fine:
// there is a single ctl <-> agui pair per demo process.

let ctlBaseUrl: string | undefined =
  process.env.ALFRED_CTL_PUBLIC_BASE_URL?.trim().replace(/\/$/, "") || undefined;

export function setCtlBaseUrl(url: string | undefined): void {
  const trimmed = url?.trim().replace(/\/$/, "");
  ctlBaseUrl = trimmed || undefined;
}

/** ctl's public URL converted to a ws(s):// notes endpoint, or undefined if unset. */
export function getNotesWsUrl(): string | undefined {
  if (!ctlBaseUrl) return undefined;
  return `${ctlBaseUrl.replace(/^http/, "ws")}/ws/notes`;
}

/** ctl's public HTTP base URL (for server-side calls like the visual delegate). */
export function getCtlBaseUrl(): string | undefined {
  return ctlBaseUrl;
}
