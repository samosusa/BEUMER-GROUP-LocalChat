/**
 * Formatting helpers.
 *
 * Every one of these produces text an engineer might read off to a colleague on the phone,
 * so they favour unambiguous over compact: "rev D · p. 41", not "D/41".
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (bytes <= 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const unit = BYTE_UNITS[exponent] ?? 'B';
  return `${value.toFixed(exponent === 0 ? 0 : fractionDigits)} ${unit}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value);
}

/** Sub-minute durations read in seconds with one decimal; anything longer in m/s. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** Coarse "time left" for a running job. Precision here would be a lie. */
export function formatEta(seconds: number): string {
  if (seconds < 45) return '< 1 min left';
  const minutes = Math.round(seconds / 60);
  return `~${minutes} min left`;
}

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const WEEKDAY_DATE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const FULL_DATE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const ISO_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function daysBetween(iso: string, now = new Date()): number {
  return Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
}

/** Timestamp for a list row: time today, weekday within the week, date beyond that. */
export function formatListTimestamp(iso: string, now = new Date()): string {
  const days = daysBetween(iso, now);
  if (days <= 0) return TIME.format(new Date(iso));
  if (days < 7) return WEEKDAY_DATE.format(new Date(iso));
  return WEEKDAY_DATE.format(new Date(iso));
}

/** Heading for a group of chats: "Today — Sunday 30 August". */
export function formatDayHeading(iso: string, now = new Date()): string {
  const days = daysBetween(iso, now);
  const full = FULL_DATE.format(new Date(iso));
  if (days <= 0) return `Today — ${full}`;
  if (days === 1) return `Yesterday — ${full}`;
  return full;
}

/** Bucket a timestamp into the sections the history screen groups by. */
export function historyBucket(iso: string, now = new Date()): 'today' | 'week' | 'month' | 'older' {
  const days = daysBetween(iso, now);
  if (days <= 0) return 'today';
  if (days < 7) return 'week';
  if (days < 30) return 'month';
  return 'older';
}

export function formatRelative(iso: string | null, now = new Date()): string {
  if (!iso) return 'never';
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return ISO_DATE.format(new Date(iso));
}

export function formatIsoDate(iso: string | null): string {
  return iso ? ISO_DATE.format(new Date(iso)) : '—';
}

/**
 * The one-line provenance string for a citation. Order matters: what it is, where in it,
 * then which version — that is the order an engineer verifies in.
 */
export function formatCitationRef(parts: {
  page: number | null;
  revision: string | null;
  documentDate: string | null;
}): string {
  const segments: string[] = [];
  if (parts.page !== null) segments.push(`p. ${parts.page}`);
  if (parts.revision) segments.push(parts.revision);
  if (parts.documentDate) segments.push(formatIsoDate(parts.documentDate));
  return segments.join(' · ');
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
