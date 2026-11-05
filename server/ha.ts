// Home Assistant REST client. Three modes:
//  - addon:  running as a Home Assistant add-on (SUPERVISOR_TOKEN is injected)
//  - manual: URL + long-lived access token saved from the Settings page or env vars
//  - demo:   no HA configured — simulated moisture sensors and valves so the app is usable
import { readJson, writeJson } from './store.ts';

export interface HaEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed?: string;
}

export interface HaConfig {
  url?: string;
  token?: string;
}

export type HaMode = 'addon' | 'manual' | 'demo';

let cfg: HaConfig = {};

export async function loadHaConfig() {
  const saved = await readJson<HaConfig>('secrets.json', {});
  cfg = { url: process.env.HA_URL ?? saved.url, token: process.env.HA_TOKEN ?? saved.token };
}

export async function saveHaConfig(next: HaConfig) {
  cfg = { url: next.url?.replace(/\/+$/, ''), token: next.token || cfg.token };
  await writeJson('secrets.json', cfg);
}

export function haMode(): HaMode {
  if (process.env.SUPERVISOR_TOKEN) return 'addon';
  if (cfg.url && cfg.token) return 'manual';
  return 'demo';
}

function endpoint(): { base: string; token: string } {
  if (process.env.SUPERVISOR_TOKEN) return { base: 'http://supervisor/core', token: process.env.SUPERVISOR_TOKEN };
  return { base: cfg.url!, token: cfg.token! };
}

async function ha(path: string, init: RequestInit = {}): Promise<any> {
  const { base, token } = endpoint();
  const res = await fetch(`${base}/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Home Assistant ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---------- demo simulation ----------
const demo = new Map<string, { value: number; on: boolean; updated: number }>();
const demoHistory = new Map<string, { t: number; v: number }[]>();

function demoState(id: string) {
  if (!demo.has(id)) demo.set(id, { value: id.startsWith('sensor.') ? 38 + Math.random() * 6 : 0, on: false, updated: Date.now() });
  const s = demo.get(id)!;
  const now = Date.now();
  if (id.startsWith('sensor.')) {
    const hours = (now - s.updated) / 3600000;
    const valve = id.replace('sensor.', 'switch.').replace('_soil_moisture', '_valve');
    const watering = demo.get(valve)?.on;
    s.value = watering ? Math.min(58, s.value + hours * 60 * 1.5) : Math.max(8, s.value - hours * 0.35);
    const hist = demoHistory.get(id) ?? [];
    if (!hist.length || now - hist[hist.length - 1].t > 600000) hist.push({ t: now, v: s.value });
    demoHistory.set(id, hist.slice(-2000));
  }
  s.updated = now;
  return s;
}

function demoEntity(id: string): HaEntity {
  const s = demoState(id);
  const isSensor = id.startsWith('sensor.');
  return {
    entity_id: id,
    state: isSensor ? s.value.toFixed(1) : s.on ? 'on' : 'off',
    attributes: isSensor
      ? { unit_of_measurement: '%', device_class: 'moisture', friendly_name: id.split('.')[1].replace(/_/g, ' ') }
      : { friendly_name: id.split('.')[1].replace(/_/g, ' ') },
    last_changed: new Date(s.updated).toISOString(),
  };
}

const DEMO_IDS = [1, 2, 3, 4].flatMap((n) => [`sensor.demo_bed_${n}_soil_moisture`, `switch.demo_bed_${n}_valve`]);
for (const id of DEMO_IDS.filter((i) => i.startsWith('sensor.'))) {
  // Seed a week of declining history with a watering bump.
  const now = Date.now();
  const pts: { t: number; v: number }[] = [];
  let v = 50;
  for (let h = 168; h >= 0; h -= 1) {
    v = h === 80 ? 54 : Math.max(10, v - 0.12 - Math.random() * 0.08);
    pts.push({ t: now - h * 3600000, v });
  }
  demoHistory.set(id, pts);
  demo.set(id, { value: v, on: false, updated: now });
}

// ---------- public API ----------
export async function getStates(): Promise<HaEntity[]> {
  if (haMode() === 'demo') return DEMO_IDS.map(demoEntity);
  return ha('/states');
}

export async function getState(id: string): Promise<HaEntity | null> {
  if (haMode() === 'demo') return DEMO_IDS.includes(id) || id.startsWith('sensor.demo') || id.startsWith('switch.demo') ? demoEntity(id) : null;
  try {
    return await ha(`/states/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function readNumber(id: string | undefined): Promise<number | null> {
  if (!id) return null;
  const s = await getState(id);
  const v = s ? parseFloat(s.state) : NaN;
  return Number.isFinite(v) ? v : null;
}

export async function setSwitch(id: string, on: boolean): Promise<void> {
  if (haMode() === 'demo') {
    demoState(id).on = on;
    return;
  }
  const domain = id.split('.')[0];
  const service =
    domain === 'valve' ? (on ? 'open_valve' : 'close_valve') : on ? 'turn_on' : 'turn_off';
  await ha(`/services/${domain}/${service}`, { method: 'POST', body: JSON.stringify({ entity_id: id }) });
}

export async function history(id: string, hours: number): Promise<{ t: number; v: number }[]> {
  if (haMode() === 'demo') {
    demoState(id);
    const since = Date.now() - hours * 3600000;
    return (demoHistory.get(id) ?? []).filter((p) => p.t >= since);
  }
  const start = new Date(Date.now() - hours * 3600000).toISOString();
  const data = await ha(`/history/period/${start}?filter_entity_id=${encodeURIComponent(id)}&minimal_response&no_attributes`);
  const series = (data?.[0] ?? []) as { state: string; last_changed: string }[];
  return series
    .map((p) => ({ t: Date.parse(p.last_changed), v: parseFloat(p.state) }))
    .filter((p) => Number.isFinite(p.v));
}

export async function haStatus() {
  const mode = haMode();
  let ok = true;
  let error: string | undefined;
  let version: string | undefined;
  if (mode !== 'demo') {
    try {
      const c = await ha('/config');
      version = c?.version;
    } catch (e: any) {
      ok = false;
      error = e.message;
    }
  }
  return { mode, ok, error, version, url: mode === 'manual' ? cfg.url : undefined };
}

/** Call any Home Assistant service (no-op that logs in demo mode). */
export async function callService(domain: string, service: string, data: Record<string, unknown>): Promise<void> {
  if (haMode() === 'demo') {
    console.log(`[demo] ${domain}.${service}`, JSON.stringify(data).slice(0, 300));
    return;
  }
  await ha(`/services/${domain}/${service}`, { method: 'POST', body: JSON.stringify(data) });
}

/** Create/update a state in Home Assistant (shows up as an entity until HA restarts; we re-publish regularly). */
export async function setState(entityId: string, state: string | number, attributes: Record<string, unknown>): Promise<void> {
  if (haMode() === 'demo') return;
  await ha(`/states/${entityId}`, { method: 'POST', body: JSON.stringify({ state: String(state), attributes }) });
}
