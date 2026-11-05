// Irrigation controller: manual runs with guaranteed shut-off, and automatic watering
// driven by the shared water-balance model + live soil moisture readings.
import type { Bed, Garden, IrrigationEvent } from '../src/core/types.ts';
import { evaluateBed, depthForMinutes } from '../src/core/water.ts';
import { mmToIn, uid } from '../src/core/util.ts';
import { readJson, writeJson } from './store.ts';
import { readNumber, setSwitch } from './ha.ts';
import { getForecast } from './weather.ts';

export interface ActiveRun {
  bedId: string;
  entity: string;
  start: string;
  endsAt: string;
  minutes: number;
  source: 'manual' | 'auto';
}

export interface Decision {
  bedId: string;
  at: string;
  action: 'watered' | 'skipped' | 'not-needed' | 'error';
  message: string;
}

interface IrrigationState {
  events: IrrigationEvent[];
  active: ActiveRun[];
  decisions: Record<string, Decision>;
  lastAutoDate: Record<string, string>;
}

const MAX_MANUAL_MIN = 120;
let state: IrrigationState = { events: [], active: [], decisions: {}, lastAutoDate: {} };
let getGarden: () => Garden;

const save = () => writeJson('irrigation.json', state);

export async function initIrrigation(gardenGetter: () => Garden) {
  getGarden = gardenGetter;
  state = { ...state, ...(await readJson<IrrigationState>('irrigation.json', state)) };
  // Anything left "on" from before a restart: close it now if overdue.
  await enforceShutoff();
  setInterval(() => enforceShutoff().catch(console.error), 15000);
  setInterval(() => autoTick().catch(console.error), 5 * 60000);
  setTimeout(() => autoTick().catch(console.error), 10000);
}

export function irrigationState() {
  return { events: state.events.slice(-500), active: state.active, decisions: state.decisions };
}

async function enforceShutoff() {
  const now = Date.now();
  const due = state.active.filter((r) => Date.parse(r.endsAt) <= now);
  for (const run of due) await finishRun(run, Date.parse(run.endsAt));
}

async function finishRun(run: ActiveRun, endMs: number, note?: string) {
  try {
    await setSwitch(run.entity, false);
  } catch (e: any) {
    console.error(`Failed to close ${run.entity}: ${e.message} — will retry`);
    return; // keep it active so the shut-off is retried
  }
  state.active = state.active.filter((r) => r !== run);
  const bed = getGarden().beds.find((b) => b.id === run.bedId);
  const minutes = Math.max(0, (endMs - Date.parse(run.start)) / 60000);
  state.events.push({
    id: uid('irr'),
    bedId: run.bedId,
    start: run.start,
    minutes: Math.round(minutes * 10) / 10,
    depthMm: bed ? depthForMinutes(bed, minutes) : 0,
    source: run.source,
    note,
  });
  await save();
}

export async function startRun(bedId: string, minutes: number, source: 'manual' | 'auto' = 'manual') {
  const bed = getGarden().beds.find((b) => b.id === bedId);
  if (!bed) throw new Error('Unknown bed');
  const entity = bed.irrigation.valveEntity;
  if (!entity) throw new Error('No valve entity configured for this bed');
  if (state.active.some((r) => r.bedId === bedId)) throw new Error('Already watering');
  const mins = Math.min(source === 'auto' ? bed.irrigation.maxMinutes : MAX_MANUAL_MIN, Math.max(0.5, minutes));
  await setSwitch(entity, true);
  const start = new Date();
  const run: ActiveRun = { bedId, entity, start: start.toISOString(), endsAt: new Date(start.getTime() + mins * 60000).toISOString(), minutes: mins, source };
  state.active.push(run);
  await save();
  setTimeout(() => enforceShutoff().catch(console.error), mins * 60000 + 500);
  return run;
}

export async function stopRun(bedId: string) {
  const run = state.active.find((r) => r.bedId === bedId);
  if (run) await finishRun(run, Date.now(), 'stopped early');
}

export async function logManual(bedId: string, minutes: number, note?: string) {
  const bed = getGarden().beds.find((b) => b.id === bedId);
  if (!bed) throw new Error('Unknown bed');
  state.events.push({ id: uid('irr'), bedId, start: new Date().toISOString(), minutes, depthMm: depthForMinutes(bed, minutes), source: 'manual', note: note ?? 'logged by hand' });
  await save();
}

export async function evaluate(bed: Bed) {
  const g = getGarden();
  const weather = await getForecast(g.site.lat, g.site.lon);
  const reading = await readNumber(bed.irrigation.moistureEntity);
  return { ...evaluateBed(bed, weather, state.events, reading), reading, weather };
}

async function autoTick() {
  const g = getGarden();
  for (const bed of g.beds) {
    if (bed.irrigation.mode !== 'auto' || !bed.irrigation.valveEntity) continue;
    if (state.active.some((r) => r.bedId === bed.id)) continue;
    let ev: Awaited<ReturnType<typeof evaluate>>;
    try {
      ev = await evaluate(bed);
    } catch (e: any) {
      state.decisions[bed.id] = { bedId: bed.id, at: new Date().toISOString(), action: 'error', message: e.message };
      continue;
    }
    const localNow = new Date(Date.now() + ev.weather.utcOffsetSeconds * 1000);
    const hour = localNow.getUTCHours();
    const today = ev.weather.today;
    const { windowStartHour: ws, windowEndHour: we } = bed.irrigation;
    const inWindow = ws <= we ? hour >= ws && hour < we : hour >= ws || hour < we;
    if (!inWindow || state.lastAutoDate[bed.id] === today) continue;
    state.lastAutoDate[bed.id] = today;
    const decide = (action: Decision['action'], message: string) =>
      (state.decisions[bed.id] = { bedId: bed.id, at: new Date().toISOString(), action, message });

    const next24 = ev.weather.daily.filter((d) => d.date >= today).slice(0, 2);
    const rainIn = mmToIn(next24.reduce((s, d) => s + d.precipMm * ((d.precipProb ?? 100) / 100), 0));
    if (ev.rec.action !== 'water-now') {
      decide('not-needed', ev.rec.message);
    } else if (rainIn >= bed.irrigation.rainSkipIn) {
      decide('skipped', `Dry, but ${rainIn.toFixed(2)}" of rain expected — skipping`);
    } else if (ev.rec.minutes < 1) {
      decide('not-needed', 'Calculated runtime under a minute');
    } else {
      try {
        const run = await startRun(bed.id, ev.rec.minutes, 'auto');
        decide('watered', `Watering ${run.minutes.toFixed(0)} min (${mmToIn(ev.rec.depthMm).toFixed(2)}" needed). ${ev.rec.message}`);
      } catch (e: any) {
        decide('error', e.message);
      }
    }
    await save();
  }
}
