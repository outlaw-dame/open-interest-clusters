interface ParsedRfc3339Timestamp {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  zone: string;
}

const STRICT_RFC3339_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function parseStrictRfc3339Timestamp(value: string): ParsedRfc3339Timestamp | null {
  const match = STRICT_RFC3339_TIMESTAMP_PATTERN.exec(value);
  if (match === null) return null;

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const hour = Number.parseInt(match[4] ?? "", 10);
  const minute = Number.parseInt(match[5] ?? "", 10);
  const second = Number.parseInt(match[6] ?? "", 10);
  const zone = match[8] ?? "";

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  if (zone !== "Z") {
    const offsetHour = Number.parseInt(zone.slice(1, 3), 10);
    const offsetMinute = Number.parseInt(zone.slice(4, 6), 10);
    if (offsetHour > 23 || offsetMinute > 59) return null;
  }

  return { year, month, day, hour, minute, second, zone };
}

export function normalizeStrictRfc3339Timestamp(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > 128) {
    throw new TypeError(message);
  }
  if (parseStrictRfc3339Timestamp(value) === null) throw new TypeError(message);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(message);
  return new Date(parsed).toISOString();
}
