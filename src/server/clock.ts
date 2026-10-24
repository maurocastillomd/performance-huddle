/**
 * A single source of "now" so the demo can be seeded relative to today
 * while tests pin an exact instant.
 */
export interface Clock {
  now(): Date;
  /** Local calendar date, YYYY-MM-DD. */
  today(): string;
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function systemClock(): Clock {
  return { now: () => new Date(), today: () => isoDate(new Date()) };
}

export function fixedClock(instant: Date): Clock {
  return { now: () => new Date(instant.getTime()), today: () => isoDate(instant) };
}

/** Adds whole days to a YYYY-MM-DD date without crossing into timezone maths. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return isoDate(dt);
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86_400_000);
}

/** Minutes since midnight for an HH:MM string. */
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}
