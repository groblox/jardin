// Open-Meteo client (free, no key): forecast with recent past, historical archive,
// and frost-date estimation from history.
import type { DailyWeather, WeatherBundle } from './types.ts';
import { isoDate, parseIso, addDays } from './util.ts';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const DAILY = 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,shortwave_radiation_sum,sunshine_duration,weather_code';
const ARCHIVE_DAILY = 'temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,shortwave_radiation_sum,sunshine_duration';

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

function parseDaily(json: any, today: string): DailyWeather[] {
  const d = json.daily;
  if (!d?.time) throw new Error(json.reason ?? 'Malformed weather response');
  return d.time.map((date: string, i: number) => ({
    date,
    tMaxC: d.temperature_2m_max[i] ?? NaN,
    tMinC: d.temperature_2m_min[i] ?? NaN,
    precipMm: d.precipitation_sum[i] ?? 0,
    precipProb: d.precipitation_probability_max?.[i] ?? undefined,
    et0Mm: d.et0_fao_evapotranspiration[i] ?? 0,
    radiationMJ: d.shortwave_radiation_sum?.[i] ?? undefined,
    sunshineH: d.sunshine_duration?.[i] != null ? d.sunshine_duration[i] / 3600 : undefined,
    weatherCode: d.weather_code?.[i] ?? undefined,
    forecast: date > today,
  })).filter((w: DailyWeather) => Number.isFinite(w.tMaxC) && Number.isFinite(w.tMinC));
}

export async function fetchForecast(lat: number, lon: number, fetchFn: Fetch = fetch as any, pastDays = 30): Promise<WeatherBundle> {
  const url = `${FORECAST}?latitude=${lat}&longitude=${lon}&daily=${DAILY}&past_days=${pastDays}&forecast_days=16&timezone=auto`;
  const res = await fetchFn(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.reason ?? `Weather request failed (${res.status})`);
  const offset = json.utc_offset_seconds ?? 0;
  const today = new Date(Date.now() + offset * 1000).toISOString().slice(0, 10);
  return {
    lat, lon, timezone: json.timezone ?? 'UTC', utcOffsetSeconds: offset, today,
    daily: parseDaily(json, today), fetchedAt: new Date().toISOString(),
  };
}

export async function fetchArchive(lat: number, lon: number, start: string, end: string, fetchFn: Fetch = fetch as any): Promise<DailyWeather[]> {
  const url = `${ARCHIVE}?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&daily=${ARCHIVE_DAILY}&timezone=auto`;
  const res = await fetchFn(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.reason ?? `Archive request failed (${res.status})`);
  return parseDaily(json, '9999-12-31').map((w) => ({ ...w, forecast: false }));
}

/** Map MM-DD → weather from a reference year, used as "normals" beyond the forecast horizon. */
export function normalsFrom(days: DailyWeather[]): Map<string, DailyWeather> {
  return new Map(days.map((d) => [d.date.slice(5), d]));
}

/**
 * Median last spring frost and first fall frost (min ≤ 0°C) over the given history.
 * Works in either hemisphere by splitting each year at mid-winter.
 */
export function estimateFrostDates(days: DailyWeather[], lat: number, thresholdC = 0): { lastFrost: string; firstFrost: string; years: number } | null {
  const south = lat < 0;
  // A "season year" runs mid-winter → mid-winter: Jan→Dec (north) or Jul→Jun (south).
  const bySeason = new Map<number, DailyWeather[]>();
  for (const d of days) {
    const dt = parseIso(d.date);
    const sy = south ? (dt.getMonth() >= 6 ? dt.getFullYear() : dt.getFullYear() - 1) : dt.getFullYear();
    if (!bySeason.has(sy)) bySeason.set(sy, []);
    bySeason.get(sy)!.push(d);
  }
  const springs: number[] = [];
  const falls: number[] = [];
  for (const [sy, list] of bySeason) {
    if (list.length < 300) continue;
    const start = south ? new Date(sy, 6, 1, 12) : new Date(sy, 0, 1, 12);
    const mid = addDays(start, 182);
    let last: Date | null = null;
    let first: Date | null = null;
    for (const d of list) {
      if (d.tMinC > thresholdC) continue;
      const dt = parseIso(d.date);
      if (dt < mid) last = dt;
      else if (!first) first = dt;
    }
    const doy = (d: Date) => (d.getTime() - start.getTime()) / 86400000;
    if (last) springs.push(doy(last));
    if (first) falls.push(doy(first));
    void sy;
  }
  if (!springs.length || !falls.length) return null;
  const median = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const ref = south ? new Date(2001, 6, 1, 12) : new Date(2001, 0, 1, 12);
  const md = (n: number) => isoDate(addDays(ref, Math.round(n))).slice(5);
  return { lastFrost: md(median(springs)), firstFrost: md(median(falls)), years: Math.min(springs.length, falls.length) };
}

export const WEATHER_CODES: Record<number, [string, string]> = {
  0: ['Clear', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Rime fog', '🌫️'], 51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
  56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'], 61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'], 71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'],
  77: ['Snow grains', '🌨️'], 80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'], 85: ['Snow showers', '🌨️'],
  86: ['Snow showers', '❄️'], 95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm, hail', '⛈️'], 99: ['Thunderstorm, hail', '⛈️'],
};
