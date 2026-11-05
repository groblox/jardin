// Server-side daily agenda: notifications (digest + frost alerts) through a Home Assistant
// notify service, and Jardin sensors published into Home Assistant.
import type { Garden } from '../src/core/types.ts';
import { buildAgenda, agendaDigest, type AgendaItem } from '../src/core/today.ts';
import { evaluateBed } from '../src/core/water.ts';
import { mmToIn } from '../src/core/util.ts';
import { getForecast, getSeasonWeather } from './weather.ts';
import { callService, haMode, readNumber, setState } from './ha.ts';
import { irrigationState } from './irrigation.ts';
import { readJson, writeJson } from './store.ts';

interface NotifyState {
  lastDigest?: string;
  lastFrost?: string;
  lastPublish?: string;
  lastError?: string;
  sent: { at: string; title: string; message: string }[];
}

let st: NotifyState = { sent: [] };
let getGarden: () => Garden;

export async function initAgenda(gardenGetter: () => Garden) {
  getGarden = gardenGetter;
  st = { ...st, ...(await readJson<NotifyState>('notify.json', st)) };
  setInterval(() => tick().catch((e) => (st.lastError = String(e?.message ?? e))), 5 * 60000);
  setTimeout(() => tick().catch((e) => (st.lastError = String(e?.message ?? e))), 15000);
}

export function notifyStatus() {
  return { ...st, sent: st.sent.slice(-10), mode: haMode() };
}

export async function computeAgenda(): Promise<{ items: AgendaItem[]; today: string; utcOffsetSeconds: number }> {
  const g = getGarden();
  const weather = await getForecast(g.site.lat, g.site.lon);
  let season;
  try {
    season = await getSeasonWeather(g.site.lat, g.site.lon);
  } catch {
    season = undefined;
  }
  const readings: Record<string, number | null> = {};
  for (const b of g.beds) readings[b.id] = await readNumber(b.irrigation.moistureEntity).catch(() => null);
  const irr = irrigationState();
  const items = buildAgenda({ garden: g, weather, season, events: irr.events, readings, activeRuns: irr.active.map((r) => r.bedId) });
  return { items, today: weather.today, utcOffsetSeconds: weather.utcOffsetSeconds };
}

async function send(title: string, message: string) {
  const svc = getGarden().notify.service?.trim();
  if (!svc) {
    // Fall back to a persistent notification in the HA UI.
    await callService('persistent_notification', 'create', { title, message, notification_id: 'jardin_digest' });
  } else {
    const [domain, service] = svc.includes('.') ? svc.split('.', 2) : ['notify', svc];
    await callService(domain, service, { title, message });
  }
  st.sent.push({ at: new Date().toISOString(), title, message });
  st.sent = st.sent.slice(-50);
}

export async function sendDigestNow() {
  const { items } = await computeAgenda();
  const d = agendaDigest(items);
  await send(d.title, d.message);
  await writeJson('notify.json', st);
  return d;
}

async function tick() {
  const g = getGarden();
  const { items, today, utcOffsetSeconds } = await computeAgenda();
  const hour = new Date(Date.now() + utcOffsetSeconds * 1000).getUTCHours();

  if (g.notify.dailyDigest && hour >= g.notify.digestHour && st.lastDigest !== today) {
    const d = agendaDigest(items);
    await send(d.title, d.message);
    st.lastDigest = today;
  }
  const frost = items.find((i) => i.category === 'frost');
  if (g.notify.frostAlerts && frost && hour >= 15 && st.lastFrost !== today) {
    await send(`🥶 ${frost.title}`, frost.detail ?? '');
    st.lastFrost = today;
  }
  if (g.notify.publishSensors && haMode() !== 'demo') await publish(g, items);
  st.lastError = undefined;
  await writeJson('notify.json', st);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'bed';

async function publish(g: Garden, items: AgendaItem[]) {
  const weather = await getForecast(g.site.lat, g.site.lon);
  const irr = irrigationState();
  for (const bed of g.beds) {
    const reading = await readNumber(bed.irrigation.moistureEntity).catch(() => null);
    const ev = evaluateBed(bed, weather, irr.events, reading);
    const day = ev.sim.days.find((d) => d.date === weather.today) ?? ev.sim.days[ev.sim.days.length - 1];
    await setState(`sensor.jardin_${slug(bed.name)}_soil_water`, Math.round((day?.available ?? 0) * 100), {
      unit_of_measurement: '%', friendly_name: `${bed.name} soil water (Jardin)`, icon: 'mdi:water-percent', state_class: 'measurement',
      recommendation: ev.rec.action, message: ev.rec.message, water_in: +mmToIn(ev.rec.depthMm).toFixed(2), gallons: +ev.rec.gallons.toFixed(1),
      minutes: Math.round(ev.rec.minutes), next_watering: ev.rec.date ?? (ev.rec.action === 'water-now' ? weather.today : null),
    });
  }
  const urgent = items.filter((i) => i.priority <= 1);
  await setState('sensor.jardin_todo_today', urgent.length, {
    friendly_name: 'Garden to-dos today (Jardin)', icon: 'mdi:sprout', items: urgent.map((i) => i.title), all: items.slice(0, 20).map((i) => i.title),
  });
  st.lastPublish = new Date().toISOString();
}
