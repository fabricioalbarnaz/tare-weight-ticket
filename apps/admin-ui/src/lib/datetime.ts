/** Converts an ISO timestamp to the value a `datetime-local` input expects (local time, no seconds). */
export function toDateTimeInputValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Converts a `datetime-local` input value (local time) back to an ISO timestamp. */
export function fromDateTimeInputValue(value: string): string {
  return new Date(value).toISOString();
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function formatWeight(kg: number | null): string {
  if (kg === null) return '—';
  return `${kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}
