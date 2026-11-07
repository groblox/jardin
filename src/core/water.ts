// Daily soil-water balance (FAO-56 single crop coefficient, root-zone depletion method).
import type { Bed, DailyWeather, IrrigationEvent, SoilType } from './types.ts';
import { PLANT_BY_ID, type PlantType } from './plants.ts';
import { clamp, lerp, parseIso, daysBetween, GAL_PER_IN_SQFT, mmToIn, localDateOf } from './util.ts';

export const SOILS: Record<SoilType, { label: string; fc: number; wp: number }> = {
  sand: { label: 'Sand', fc: 0.1, wp: 0.04 },
  'sandy-loam': { label: 'Sandy loam', fc: 0.18, wp: 0.08 },
  loam: { label: 'Loam', fc: 0.28, wp: 0.12 },
  'clay-loam': { label: 'Clay loam', fc: 0.34, wp: 0.18 },
  clay: { label: 'Clay', fc: 0.4, wp: 0.24 },
  'raised-mix': { label: 'Raised-bed mix (compost/peat/vermiculite)', fc: 0.38, wp: 0.12 },
};

/** Default fraction of available water that may be used before plants are stressed. */
export const MAD = 0.5;

/**
 * FAO-56 (Table 22) depletion fractions p: how much of the available water a crop can use
 * before it starts to suffer. Shallow-rooted greens are far less forgiving than squash.
 */
export const MAD_BY_PLANT: Record<string, number> = {
  tomato: 0.4, 'cherry-tomato': 0.4, pepper: 0.3, eggplant: 0.45, potato: 0.35, lettuce: 0.3, 'leaf-lettuce': 0.3,
  spinach: 0.2, kale: 0.45, chard: 0.45, broccoli: 0.45, cabbage: 0.45, cauliflower: 0.45, carrot: 0.35, beet: 0.5,
  radish: 0.3, turnip: 0.5, onion: 0.3, scallion: 0.3, garlic: 0.3, leek: 0.3, pea: 0.35, bean: 0.45, 'pole-bean': 0.45,
  cucumber: 0.5, zucchini: 0.5, 'winter-squash': 0.5, melon: 0.4, corn: 0.5, basil: 0.4, parsley: 0.4, cilantro: 0.4,
  dill: 0.4, chive: 0.3, mint: 0.4, thyme: 0.5, sage: 0.5, strawberry: 0.2, marigold: 0.5, nasturtium: 0.5, sunflower: 0.45,
};

function active(pl: Bed['plantings'][number], date: Date): boolean {
  if (!pl.plantedOn || parseIso(pl.plantedOn) > date) return false;
  return !(pl.removedOn && date >= parseIso(pl.removedOn));
}

/** The bed is watered as one zone, so the most drought-sensitive crop growing sets the refill point. */
export function bedMad(bed: Bed, date: Date): number {
  let m = Infinity;
  for (const pl of bed.plantings) if (PLANT_BY_ID[pl.plantId] && active(pl, date)) m = Math.min(m, MAD_BY_PLANT[pl.plantId] ?? MAD);
  return Number.isFinite(m) ? m : MAD;
}

/** Ground shaded by a crop's canopy, in squares: tall/trellised crops spread beyond their square. */
export function canopySquares(plant: PlantType): number {
  const base = plant.span * plant.span;
  return base * Math.min(2.5, 1 + 0.25 * Math.max(0, plant.heightFt - 1.5));
}

export type Stage = 'planned' | 'initial' | 'development' | 'mid' | 'late' | 'done';

export function stageAt(plant: PlantType, plantedOn: string | undefined, method: 'direct' | 'transplant', date: Date, progressOverride?: number) {
  if (!plantedOn) return { stage: 'planned' as Stage, frac: 0, kc: 0 };
  const days = daysBetween(parseIso(plantedOn), date);
  if (days < 0) return { stage: 'planned' as Stage, frac: 0, kc: 0 };
  const offset = method === 'transplant' ? 0.12 : 0;
  const frac = progressOverride ?? offset + days / plant.daysToMaturity;
  const [ki, km, ke] = plant.kc;
  const endFrac = 1 + plant.harvestDays / plant.daysToMaturity;
  let stage: Stage;
  let kc: number;
  if (frac < 0.2) [stage, kc] = ['initial', ki];
  else if (frac < 0.45) [stage, kc] = ['development', lerp(ki, km, (frac - 0.2) / 0.25)];
  else if (frac < 0.85) [stage, kc] = ['mid', km];
  else if (frac < endFrac || plant.perennial) [stage, kc] = ['late', lerp(km, ke, clamp((frac - 0.85) / (endFrac - 0.85), 0, 1))];
  else [stage, kc] = ['done', 0];
  return { stage, frac, kc };
}

export function bedAreaSqFt(bed: Bed) {
  return bed.widthFt * bed.lengthFt;
}

/** Effective root-zone depth (inches), limited by bed soil depth. */
export function rootZoneIn(bed: Bed): number {
  let maxRoot = 0;
  for (const pl of bed.plantings) {
    const p = PLANT_BY_ID[pl.plantId];
    if (p && pl.plantedOn && !pl.removedOn) maxRoot = Math.max(maxRoot, p.rootDepthIn);
  }
  return clamp(maxRoot || 8, 6, Math.max(6, bed.soilDepthIn));
}

/** Total available water in the root zone, mm. */
export function tawMm(bed: Bed): number {
  const s = SOILS[bed.soil];
  return (s.fc - s.wp) * rootZoneIn(bed) * 25.4;
}

/** Area-weighted crop coefficient for the whole bed (bare/mulched soil for empty squares). */
export function bedKc(bed: Bed, date: Date): number {
  const area = Math.max(1, Math.round(bed.widthFt) * Math.round(bed.lengthFt));
  const bare = bed.mulched ? 0.15 : 0.35;
  let covered = 0;
  let sum = 0;
  for (const pl of bed.plantings) {
    const p = PLANT_BY_ID[pl.plantId];
    if (!p) continue;
    if (pl.removedOn && date >= parseIso(pl.removedOn)) continue;
    const st = stageAt(p, pl.plantedOn, pl.method, date);
    if (st.stage === 'planned' || st.stage === 'done') continue;
    // Canopy grows from its own square(s) toward full spread by mid-season.
    const grow = Math.min(1, Math.max(0, (st.frac - 0.1) / 0.4));
    const sq = p.span * p.span + (canopySquares(p) - p.span * p.span) * grow;
    covered += sq;
    sum += Math.max(st.kc, bare) * sq;
  }
  if (covered > area) {
    // Overlapping canopies can't shade more ground than the bed has.
    sum *= area / covered;
    covered = area;
  }
  return (sum + Math.max(0, area - covered) * bare) / area;
}

export function minutesForDepth(bed: Bed, depthMm: number): number {
  const gal = mmToIn(depthMm) * bedAreaSqFt(bed) * GAL_PER_IN_SQFT;
  return gal / Math.max(0.01, bed.irrigation.flowGpm) / clamp(bed.irrigation.efficiency, 0.1, 1);
}

export function depthForMinutes(bed: Bed, minutes: number): number {
  const gal = minutes * bed.irrigation.flowGpm * clamp(bed.irrigation.efficiency, 0.1, 1);
  return (gal / GAL_PER_IN_SQFT / Math.max(0.1, bedAreaSqFt(bed))) * 25.4;
}

export function gallonsForDepth(bed: Bed, depthMm: number): number {
  return mmToIn(depthMm) * bedAreaSqFt(bed) * GAL_PER_IN_SQFT;
}

/** Convert a raw moisture reading into fraction of available water (1 = field capacity). */
export function sensorToFraction(bed: Bed, reading: number): number {
  const { sensorDry, sensorWet } = bed.irrigation;
  if (sensorWet === sensorDry) return 0.5;
  return clamp((reading - sensorDry) / (sensorWet - sensorDry), 0, 1.2);
}

export interface WaterDay {
  date: string;
  forecast: boolean;
  et0: number;
  kc: number;
  etc: number;
  rain: number;
  effRain: number;
  irrigation: number;
  /** End-of-day root-zone depletion, mm. */
  depletion: number;
  /** End-of-day fraction of available water remaining (1 = full). */
  available: number;
  drainage: number;
  stress: boolean;
  sensor?: boolean;
}

export interface WaterRecommendation {
  action: 'water-now' | 'water-soon' | 'ok' | 'rain-expected';
  date?: string;
  depthMm: number;
  gallons: number;
  minutes: number;
  message: string;
}

export interface WaterSimOptions {
  /** Scale ET by relative light (shaded beds dry slower). 1 = open sky. */
  etScale?: number;
  /** Assimilated soil moisture: available-water fraction measured on a date. */
  sensor?: { date: string; fraction: number };
  startAvailable?: number;
  today?: string;
  /** The garden's UTC offset, so irrigation timestamps land on the garden's calendar day. */
  utcOffsetSeconds?: number;
}

export function simulateWater(bed: Bed, weather: DailyWeather[], events: IrrigationEvent[], opts: WaterSimOptions = {}) {
  const taw = tawMm(bed);
  const raw = bedMad(bed, opts.today ? parseIso(opts.today) : new Date()) * taw;
  const etScale = opts.etScale ?? 1;
  const irrByDate = new Map<string, number>();
  for (const e of events) {
    if (e.bedId !== bed.id || !Number.isFinite(e.depthMm)) continue;
    const d = localDateOf(e.start, opts.utcOffsetSeconds);
    irrByDate.set(d, (irrByDate.get(d) ?? 0) + e.depthMm);
  }
  let D = (1 - (opts.startAvailable ?? 0.7)) * taw;
  const days: WaterDay[] = [];
  for (const w of weather) {
    const date = parseIso(w.date);
    const kc = bedKc(bed, date);
    const etc = w.et0Mm * kc * etScale;
    const rainExp = w.forecast && w.precipProb != null ? w.precipMm * (w.precipProb / 100) : w.precipMm;
    const effRain = rainExp < 1 ? 0 : rainExp * 0.9;
    const irr = irrByDate.get(w.date) ?? 0;
    let next = D + etc - effRain - irr;
    let drainage = 0;
    if (next < 0) {
      drainage = -next;
      next = 0;
    }
    D = clamp(next, 0, taw);
    let sensor = false;
    if (opts.sensor && opts.sensor.date === w.date) {
      D = clamp((1 - opts.sensor.fraction) * taw, 0, taw);
      sensor = true;
    }
    days.push({
      date: w.date, forecast: w.forecast, et0: w.et0Mm, kc, etc, rain: w.precipMm, effRain, irrigation: irr,
      depletion: D, available: 1 - D / taw, drainage, stress: D > bedMad(bed, date) * taw, sensor,
    });
  }
  return { taw, raw, days };
}

export function recommend(bed: Bed, sim: ReturnType<typeof simulateWater>, today: string): WaterRecommendation {
  const idx = sim.days.findIndex((d) => d.date === today);
  const todayDay = idx >= 0 ? sim.days[idx] : sim.days[sim.days.length - 1];
  const mk = (action: WaterRecommendation['action'], depth: number, message: string, date?: string): WaterRecommendation => ({
    action, date, depthMm: depth, gallons: gallonsForDepth(bed, depth), minutes: minutesForDepth(bed, depth), message,
  });
  if (!todayDay) return mk('ok', 0, 'No weather data yet');
  // Use start-of-day depletion: yesterday's end + today's demand (watering in the morning).
  // A live sensor reading today is the truth; otherwise project from yesterday's end-of-day state.
  const prev = idx > 0 ? sim.days[idx - 1].depletion : todayDay.depletion;
  const projected = todayDay.sensor ? todayDay.depletion : Math.min(sim.taw, prev + todayDay.etc);
  // Rain expected today or in the next two days (probability-weighted) can stand in for watering.
  const rainNext = sim.days.slice(Math.max(0, idx), idx + 3).reduce((s, d) => s + d.effRain, 0);
  if (projected >= sim.raw) {
    if (rainNext >= projected * 0.7) return mk('rain-expected', 0, `Soil is dry but ~${mmToIn(rainNext).toFixed(2)}" of rain is expected — hold off`);
    return mk('water-now', projected, `Root zone is ${Math.round((projected / sim.taw) * 100)}% depleted — water today`);
  }
  const future = sim.days.slice(idx + 1).find((d) => d.depletion >= sim.raw);
  if (future) return mk('water-soon', future.depletion, `Next watering needed around ${future.date}`, future.date);
  return mk('ok', 0, 'Soil moisture is fine for the forecast period');
}

/** ET scaling for a bed from its cached sun analysis: shaded beds lose less water. */
export function etScaleFor(bed: Bed): number {
  const a = bed.analysis;
  if (!a || !a.maxSunHours) return 1;
  return 0.5 + 0.5 * clamp(a.sunHours / a.maxSunHours, 0, 1);
}

/** One-stop evaluation shared by the UI and the irrigation controller. */
export function evaluateBed(
  bed: Bed,
  weather: { daily: DailyWeather[]; today: string; utcOffsetSeconds?: number },
  events: IrrigationEvent[],
  reading?: number | null,
) {
  const sensorFraction = reading != null && Number.isFinite(reading) ? sensorToFraction(bed, reading) : undefined;
  const sim = simulateWater(bed, weather.daily, events, {
    today: weather.today,
    utcOffsetSeconds: weather.utcOffsetSeconds,
    etScale: etScaleFor(bed),
    sensor: sensorFraction != null ? { date: weather.today, fraction: sensorFraction } : undefined,
  });
  const rec = recommend(bed, sim, weather.today);
  return { sim, rec, sensorFraction };
}
