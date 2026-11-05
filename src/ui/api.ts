import type { Garden, IrrigationEvent, WeatherBundle, DailyWeather } from '../core/types.ts';
import { fetchForecast, fetchArchive, fetchSeasonWeather, type SeasonWeather } from '../core/weather.ts';

const apiUrl = (p: string) => new URL('api/' + p, document.baseURI).toString();

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface HaStatus {
  mode: 'addon' | 'manual' | 'demo';
  ok: boolean;
  error?: string;
  version?: string;
  url?: string;
}

export interface HaEntityLite {
  id: string;
  name: string;
  state: string;
  unit?: string;
  deviceClass?: string;
}

export interface ActiveRun {
  bedId: string;
  entity: string;
  start: string;
  endsAt: string;
  minutes: number;
  source: 'manual' | 'auto';
}

export interface IrrigationStatus {
  events: IrrigationEvent[];
  active: ActiveRun[];
  decisions: Record<string, { bedId: string; at: string; action: string; message: string }>;
}

const LS_KEY = 'jardin.garden.v1';

export async function probeServer(): Promise<boolean> {
  try {
    const r = await fetch(apiUrl('health'), { signal: AbortSignal.timeout(3000) });
    return r.ok && (await r.json()).ok === true;
  } catch {
    return false;
  }
}

export const api = {
  async loadGarden(server: boolean): Promise<Garden | null> {
    if (server) return j<Garden>('garden');
    try {
      const s = localStorage.getItem(LS_KEY);
      return s ? (JSON.parse(s) as Garden) : null;
    } catch {
      return null;
    }
  },
  async saveGarden(server: boolean, g: Garden): Promise<void> {
    if (server) {
      await j('garden', { method: 'PUT', body: JSON.stringify(g) });
      return;
    }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(g));
    } catch {
      /* storage unavailable */
    }
  },
  weather(server: boolean, lat: number, lon: number): Promise<WeatherBundle> {
    return server ? j(`weather?lat=${lat}&lon=${lon}`) : fetchForecast(lat, lon);
  },
  archive(server: boolean, lat: number, lon: number, start: string, end: string): Promise<DailyWeather[]> {
    return server ? j(`archive?lat=${lat}&lon=${lon}&start=${start}&end=${end}`) : fetchArchive(lat, lon, start, end);
  },
  async seasonWeather(server: boolean, lat: number, lon: number, forecast: WeatherBundle): Promise<SeasonWeather> {
    return server ? j(`season-weather?lat=${lat}&lon=${lon}`) : fetchSeasonWeather(lat, lon, forecast);
  },
  notifyStatus: () => j<{ lastDigest?: string; lastFrost?: string; lastPublish?: string; lastError?: string; mode: string; sent: { at: string; title: string; message: string }[] }>('notify/status'),
  notifyTest: () => j<{ title: string; message: string }>('notify/test', { method: 'POST' }),
  haStatus: () => j<HaStatus>('ha/status'),
  haConfig: (url: string, token: string) => j<HaStatus>('ha/config', { method: 'PUT', body: JSON.stringify({ url, token }) }),
  entities: () => j<HaEntityLite[]>('ha/entities'),
  history: (entity: string, hours: number) => j<{ t: number; v: number }[]>(`ha/history?entity=${encodeURIComponent(entity)}&hours=${hours}`),
  value: (entity: string) => j<{ value: number | null }>(`ha/value?entity=${encodeURIComponent(entity)}`),
  irrigation: () => j<IrrigationStatus>('irrigation'),
  run: (bedId: string, minutes: number) => j<ActiveRun>(`irrigation/${bedId}/run`, { method: 'POST', body: JSON.stringify({ minutes }) }),
  stop: (bedId: string) => j<IrrigationStatus>(`irrigation/${bedId}/stop`, { method: 'POST' }),
  log: (bedId: string, minutes: number, note?: string) => j<IrrigationStatus>(`irrigation/${bedId}/log`, { method: 'POST', body: JSON.stringify({ minutes, note }) }),
};
