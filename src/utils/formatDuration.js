/** One year in seconds (365 days). Matches form default waiting time. */
export const SECONDS_PER_YEAR = 31536000;

/**
 * Format a duration in seconds as a short two-part string.
 * Units: s, m, h, d, y (year = 365 days).
 */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds)));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s < SECONDS_PER_YEAR) {
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  }
  return `${Math.floor(s / SECONDS_PER_YEAR)}y ${Math.floor((s % SECONDS_PER_YEAR) / 86400)}d`;
}
