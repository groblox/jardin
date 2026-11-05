import { fetchForecast, fetchArchive } from '../src/core/weather.ts';
import type { DailyWeather, WeatherBundle } from '../src/core/types.ts';
import { readJson, writeJson } from './store.ts';

const forecastCache = new Map<string, { at: number; data: WeatherBundle }>();
const FORECAST_TTL = 60 * 60 * 1000;

const key = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

export async function getForecast(lat: number, lon: number): Promise<WeatherBundle> {
  const k = key(lat, lon);
  const hit = forecastCache.get(k);
  if (hit && Date.now() - hit.at < FORECAST_TTL) return hit.data;
  try {
    const data = await fetchForecast(lat, lon);
    forecastCache.set(k, { at: Date.now(), data });
    await writeJson('weather-cache.json', { key: k, at: Date.now(), data });
    return data;
  } catch (e) {
    // Serve stale data (memory, then disk) rather than failing the irrigation controller.
    if (hit) return hit.data;
    const disk = await readJson<{ key: string; data: WeatherBundle } | null>('weather-cache.json', null);
    if (disk?.key === k) return disk.data;
    throw e;
  }
}

export async function getArchive(lat: number, lon: number, start: string, end: string): Promise<DailyWeather[]> {
  const name = `archive-${key(lat, lon)}-${start}-${end}.json`.replace(/[^a-z0-9.,-]/gi, '_');
  const cached = await readJson<DailyWeather[] | null>(name, null);
  if (cached) return cached;
  const data = await fetchArchive(lat, lon, start, end);
  await writeJson(name, data);
  return data;
}
