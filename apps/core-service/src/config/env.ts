export function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: "${value}" is not a positive integer`);
  }
  return parsed;
}

export function parseOptionalUrl(name: string, value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    new URL(value);
  } catch {
    throw new Error(`Invalid ${name}: "${value}" is not a valid URL`);
  }
  return value;
}
