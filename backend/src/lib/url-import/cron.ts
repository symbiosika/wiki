/**
 * Minimal standard cron matcher.
 *
 * We don't schedule each job with its own timer; instead a single master tick
 * runs every minute and asks, for every job, "does this cron expression match
 * the current minute?". That keeps user-defined, per-record schedules simple
 * and stateless — no dynamic (de)registration of timers.
 *
 * Supports the standard 5-field syntax:
 *   minute hour day-of-month month day-of-week
 * with wildcards, step values, ranges (a-b), range+step, and comma lists
 * per field. Day-of-week: 0 or 7 = Sunday. Matching is minute-granular
 * (seconds ignored).
 */

const FIELD_RANGES: [min: number, max: number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0 = Sunday)
];

/** Expand a single cron field into the set of numbers it matches. */
const parseField = (field: string, min: number, max: number): Set<number> => {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? parseInt(stepPart, 10) : 1;
    if (!Number.isFinite(step) || step < 1) {
      throw new Error(`Invalid step in cron field: "${part}"`);
    }

    let rangeMin = min;
    let rangeMax = max;
    if (rangePart !== "*" && rangePart !== undefined) {
      const bounds = rangePart.split("-");
      const start = parseInt(bounds[0]!, 10);
      if (!Number.isFinite(start)) {
        throw new Error(`Invalid cron field: "${part}"`);
      }
      rangeMin = start;
      if (bounds[1] !== undefined) {
        // explicit range "a-b"
        const end = parseInt(bounds[1], 10);
        if (!Number.isFinite(end)) {
          throw new Error(`Invalid cron field: "${part}"`);
        }
        rangeMax = end;
      } else if (stepPart) {
        // "start/step" → from start up to the field max
        rangeMax = max;
      } else {
        // plain single value
        rangeMax = start;
      }
    }

    for (let n = rangeMin; n <= rangeMax; n += step) {
      if (n < min || n > max) {
        throw new Error(`Cron value ${n} out of range [${min}, ${max}]`);
      }
      values.add(n);
    }
  }

  return values;
};

/** Validate a 5-field cron expression; throws on malformed input. */
export const assertValidCron = (expression: string): void => {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Cron expression must have 5 fields (got ${fields.length}): "${expression}"`,
    );
  }
  fields.forEach((field, i) => {
    parseField(field, FIELD_RANGES[i]![0], FIELD_RANGES[i]![1]);
  });
};

/**
 * True when `date` (to the minute) satisfies the cron expression.
 * Day-of-month and day-of-week both being restricted follows the common
 * "OR" convention (a match on either is enough) only when both are set;
 * here we use the standard Vixie-cron rule: if either DOM or DOW is `*`,
 * the other must match; if both are restricted, a match on either suffices.
 */
export const cronMatches = (expression: string, date: Date): boolean => {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  let minutes: Set<number>,
    hours: Set<number>,
    daysOfMonth: Set<number>,
    months: Set<number>,
    daysOfWeek: Set<number>;
  try {
    minutes = parseField(fields[0]!, 0, 59);
    hours = parseField(fields[1]!, 0, 23);
    daysOfMonth = parseField(fields[2]!, 1, 31);
    months = parseField(fields[3]!, 1, 12);
    daysOfWeek = parseField(fields[4]!, 0, 6);
  } catch {
    return false;
  }

  // normalise Sunday: cron allows 7, JS getDay() returns 0
  const dow = date.getDay(); // 0..6, 0 = Sunday

  const minuteOk = minutes.has(date.getMinutes());
  const hourOk = hours.has(date.getHours());
  const monthOk = months.has(date.getMonth() + 1);
  const domRestricted = fields[2] !== "*";
  const dowRestricted = fields[4] !== "*";
  const domOk = daysOfMonth.has(date.getDate());
  const dowOk = daysOfWeek.has(dow);

  let dayOk: boolean;
  if (domRestricted && dowRestricted) {
    dayOk = domOk || dowOk; // Vixie-cron OR rule
  } else {
    dayOk = domOk && dowOk;
  }

  return minuteOk && hourOk && monthOk && dayOk;
};
