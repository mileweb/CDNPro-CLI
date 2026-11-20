/**
 * Date/time parsing shared by body validation, query/header validation, and
 * the `If-Unmodified-Since` header.
 */

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

const HTTP_DATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

/**
 * True for an RFC 3339 date-time with a mandatory timezone, seconds, and a
 * real calendar date. Fractional seconds are allowed. `T`/`Z` may be lower case.
 */
export function isRfc3339DateTime(value: string): boolean {
  const m = RFC3339.exec(value);
  if (!m) return false;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const offsetHour = m[7] ? Number(m[8]) : 0;
  const offsetMinute = m[7] ? Number(m[9]) : 0;

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 60) return false;
  if (offsetHour > 23 || offsetMinute > 59) return false;
  return true;
}

/** True for an IMF-fixdate (RFC 7231) HTTP-date, e.g. `Wed, 01 Jan 2026 00:00:00 GMT`. */
export function isHttpDate(value: string): boolean {
  if (!HTTP_DATE.test(value)) return false;
  const time = Date.parse(value);
  return !Number.isNaN(time) && new Date(time).toUTCString() === value;
}

/**
 * Normalize a date supplied for an HTTP header. HTTP-dates pass through;
 * RFC 3339 date-times are converted to the equivalent UTC HTTP-date.
 * Returns undefined when the value is neither.
 */
export function toHttpDate(value: string): string | undefined {
  const trimmed = value.trim();
  if (isHttpDate(trimmed)) return trimmed;
  if (isRfc3339DateTime(trimmed)) return new Date(trimmed).toUTCString();
  return undefined;
}
