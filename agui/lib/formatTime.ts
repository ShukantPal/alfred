/** Stable UTC formatting for SSR — avoids locale/timezone hydration mismatches. */
export function formatMeetingTime(iso: string): string {
  const date = new Date(iso);
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, "0")} ${period}`;
}
