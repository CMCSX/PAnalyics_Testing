/**
 * Date helper functions for PayAnalytics.
 */

/**
 * Formats a date string from YYYY-MM-DD to MM-DD-YYYY for display purposes.
 * If the string does not match YYYY-MM-DD, it is returned as-is.
 */
export function formatDisplayDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const trimmed = dateStr.trim();
  // Match YYYY-MM-DD
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, y, m, d] = match;
    return `${m}-${d}-${y}`;
  }
  return dateStr;
}
