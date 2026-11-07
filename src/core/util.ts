export const DEG = Math.PI / 180;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const mod = (a: number, n: number) => ((a % n) + n) % n;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const cToF = (c: number) => c * 1.8 + 32;
export const fToC = (f: number) => (f - 32) / 1.8;
export const mmToIn = (mm: number) => mm / 25.4;
export const inToMm = (inch: number) => inch * 25.4;
/** One inch of water over one square foot, in US gallons. */
export const GAL_PER_IN_SQFT = 0.623;

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

/** YYYY-MM-DD for a Date in local time. */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Calendar date (YYYY-MM-DD) of an ISO timestamp in the garden's time zone, given its UTC offset.
 * Without an offset, falls back to the runtime's zone (fine in a browser at home, wrong on a UTC server).
 */
export function localDateOf(iso: string, utcOffsetSeconds?: number): string {
  const t = Date.parse(iso);
  if (utcOffsetSeconds == null || !Number.isFinite(utcOffsetSeconds)) return isoDate(new Date(t));
  return new Date(t + utcOffsetSeconds * 1000).toISOString().slice(0, 10);
}

/** Parse YYYY-MM-DD as local noon (avoids DST/UTC edge flips). */
export function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Date in `year` for an "MM-DD" string. */
export function monthDay(year: number, md: string): Date {
  const [m, d] = md.split('-').map(Number);
  return new Date(year, m - 1, d, 12);
}

export function fmtDate(d: Date | string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  const date = typeof d === 'string' ? parseIso(d) : d;
  return date.toLocaleDateString(undefined, opts);
}
