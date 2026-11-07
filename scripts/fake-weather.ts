// Seed a Jardin DATA_DIR with synthetic forecast weather, for running the server where Open-Meteo is
// unreachable (sandboxes, offline demos). The server serves `weather-cache.json` when a live fetch
// fails. Year-to-date/archive weather (pest degree-days, Simulate, frost estimates) stays unavailable.
//
//   node scripts/fake-weather.ts /tmp/jardin-data                       # Philadelphia, today
//   node scripts/fake-weather.ts /tmp/jardin-data 39.95 -75.16 2027-03-01  # pick a "today"
//   DATA_DIR=/tmp/jardin-data node server/index.ts
//
// 30 past + 16 forecast days with a seasonal temperature curve, ~30% wet days, hourly temp/RH/rain,
// and a frost night tomorrow so frost alerts show up. Deterministic.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { DailyWeather, WeatherBundle } from '../src/core/types.ts';

const [dir, latS = '39.95', lonS = '-75.16', todayArg] = process.argv.slice(2);
if (!dir) {
  console.error('Usage: node scripts/fake-weather.ts <dataDir> [lat] [lon] [YYYY-MM-DD]');
  process.exit(1);
}
const lat = Number(latS);
const lon = Number(lonS);
const offset = -5 * 3600;
const today = todayArg ?? new Date(Date.now() + offset * 1000).toISOString().slice(0, 10);
const t0 = Date.parse(`${today}T12:00:00Z`);
const day = (n: number) => new Date(t0 + n * 86400000).toISOString().slice(0, 10);
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const daily: DailyWeather[] = [];
const hourly = { time: [] as string[], tempC: [] as number[], rh: [] as number[], precipMm: [] as number[] };
for (let i = -30; i < 16; i++) {
  const date = day(i);
  const doy = Math.floor((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${date.slice(0, 4)}-01-01T12:00:00Z`)) / 86400000);
  const base = 12.5 - 13 * Math.cos(((doy - 15) / 365) * 2 * Math.PI) * (lat >= 0 ? 1 : -1);
  const tMax = base + 5 + (rnd() - 0.5) * 6;
  const tMin = i === 1 ? -1.5 : base - 5 + (rnd() - 0.5) * 5;
  const wet = rnd() < 0.3;
  const precip = wet ? +(rnd() * 12).toFixed(1) : 0;
  daily.push({
    date, tMaxC: +tMax.toFixed(1), tMinC: +tMin.toFixed(1), precipMm: precip, precipProb: i > 0 ? (wet ? 70 : 10) : undefined,
    et0Mm: +Math.max(0.4, 0.18 * (tMax + 5)).toFixed(2), radiationMJ: +(8 + rnd() * 6).toFixed(1), sunshineH: +(4 + rnd() * 5).toFixed(1),
    weatherCode: wet ? 61 : [0, 1, 2, 3][Math.floor(rnd() * 4)], forecast: date > today,
  });
  for (let h = 0; h < 24; h++) {
    const f = (1 - Math.cos(((h - 4) / 24) * 2 * Math.PI)) / 2;
    hourly.time.push(`${date}T${String(h).padStart(2, '0')}:00`);
    hourly.tempC.push(+(tMin + (tMax - tMin) * f).toFixed(1));
    hourly.rh.push(Math.round(wet ? 85 + rnd() * 14 : 55 + (1 - f) * 35));
    hourly.precipMm.push(wet && h > 12 && h < 18 ? +(precip / 5).toFixed(2) : 0);
  }
}
const data: WeatherBundle = { lat, lon, timezone: 'America/New_York', utcOffsetSeconds: offset, today, daily, hourly, fetchedAt: new Date().toISOString() };
mkdirSync(dir, { recursive: true });
// Same key format as server/weather.ts (lat/lon to 2 decimals).
writeFileSync(`${dir}/weather-cache.json`, JSON.stringify({ key: `${lat.toFixed(2)},${lon.toFixed(2)}`, at: Date.now(), data }));
console.log(`Wrote ${dir}/weather-cache.json: ${daily.length} days around ${today} for ${lat}, ${lon}`);
