// Thermal-time growth simulation per planting: temperature- and light-driven development,
// predicted harvest dates, and weather risk warnings (frost, heat/bolting, cold stress).
import type { BedPlanting, DailyWeather } from './types.ts';
import { PLANT_BY_ID, type PlantType } from './plants.ts';
import { addDays, clamp, isoDate, parseIso } from './util.ts';
import { stageAt, type Stage } from './water.ts';

/**
 * Development rate relative to "catalogue conditions" (1.0 = one day of the
 * seed-packet days-to-maturity per calendar day).
 */
export function developmentRate(plant: PlantType, tMinC: number, tMaxC: number, lightFactor = 1): number {
  const t = (tMinC + tMaxC) / 2;
  const { baseTempC: b, optTempC: o, maxTempC: m } = plant;
  let r: number;
  if (t <= b) r = 0.05;
  else if (t <= o) r = Math.min(1.3, (t - b) / (0.7 * (o - b)));
  else r = clamp((1.3 * (m - t)) / (m - o), 0.05, 1.3);
  return r * (0.4 + 0.6 * clamp(lightFactor, 0.3, 1));
}

export function frostThresholdC(plant: PlantType): number {
  return plant.frost === 'tender' ? 1 : plant.frost === 'half-hardy' ? -2 : -7;
}

export interface GrowthWarning {
  date: string;
  level: 'warn' | 'bad';
  kind: 'frost' | 'heat' | 'cold';
  message: string;
}

export interface GrowthResult {
  plant: PlantType;
  planting: BedPlanting;
  progress: number;
  stage: Stage;
  maturityDate?: string;
  harvestEndDate?: string;
  warnings: GrowthWarning[];
  /** Daily progress series for charts. */
  series: { date: string; progress: number; forecast: boolean }[];
}

/**
 * Simulate a planting from its planting date through `horizonDays` days after today.
 * Days not covered by `weather` use `normals` (e.g. last year's weather keyed by MM-DD) if given,
 * otherwise progress at the catalogue rate.
 */
export function simulateGrowth(
  planting: BedPlanting,
  weather: DailyWeather[],
  opts: { today: string; sunHours?: number; normals?: Map<string, DailyWeather>; horizonDays?: number },
): GrowthResult | null {
  const plant = PLANT_BY_ID[planting.plantId];
  if (!plant) return null;
  const light = opts.sunHours == null ? 1 : opts.sunHours / plant.idealSunHours;
  const byDate = new Map(weather.map((w) => [w.date, w]));
  const warnings: GrowthWarning[] = [];
  const series: GrowthResult['series'] = [];
  const today = parseIso(opts.today);
  if (!planting.plantedOn) {
    return { plant, planting, progress: 0, stage: 'planned', warnings, series };
  }
  if (planting.removedOn && planting.removedOn <= opts.today) {
    return { plant, planting, progress: 1, stage: 'done', warnings, series };
  }
  const start = parseIso(planting.plantedOn);
  let progress = planting.method === 'transplant' ? 0.12 * plant.daysToMaturity : 0;
  const endFrac = 1 + plant.harvestDays / plant.daysToMaturity;
  let maturity: string | undefined;
  let harvestEnd: string | undefined;
  let progressToday = 0;
  const horizon = addDays(today, opts.horizonDays ?? 400);
  let heatDays = 0;
  for (let d = start; d <= horizon; d = addDays(d, 1)) {
    const key = isoDate(d);
    const w = byDate.get(key) ?? opts.normals?.get(key.slice(5));
    const rate = w ? developmentRate(plant, w.tMinC, w.tMaxC, light) : 0.4 + 0.6 * clamp(light, 0.3, 1);
    progress += rate;
    const frac = progress / plant.daysToMaturity;
    if (!maturity && frac >= 1) maturity = key;
    if (!harvestEnd && frac >= endFrac) harvestEnd = key;
    if (d <= today) progressToday = frac;
    const isForecast = d > today;
    series.push({ date: key, progress: frac, forecast: isForecast });

    const fc = byDate.get(key);
    if (fc && d >= today && frac < endFrac) {
      if (fc.tMinC <= frostThresholdC(plant))
        warnings.push({ date: key, level: 'bad', kind: 'frost', message: `Frost risk for ${plant.name} (low ${fc.tMinC.toFixed(0)}°C) — cover or harvest` });
      if (plant.boltsInHeat && fc.tMaxC > plant.maxTempC) {
        heatDays++;
        if (heatDays === 2) warnings.push({ date: key, level: 'warn', kind: 'heat', message: `Heat may make ${plant.name} bolt (high ${fc.tMaxC.toFixed(0)}°C) — shade cloth helps` });
      }
      if (plant.frost === 'tender' && fc.tMinC < plant.baseTempC - 3 && fc.tMinC > frostThresholdC(plant))
        warnings.push({ date: key, level: 'warn', kind: 'cold', message: `Chilly night for ${plant.name} (${fc.tMinC.toFixed(0)}°C) — growth will stall` });
    }
    if (harvestEnd && d > today) break;
  }
  const st = stageAt(plant, planting.plantedOn, planting.method, today, progressToday);
  return { plant, planting, progress: progressToday, stage: st.stage, maturityDate: maturity, harvestEndDate: harvestEnd, warnings, series };
}

/** Growing degree days (base 10°C) — common heat-unit tally for warm-season crops. */
export function gdd(w: DailyWeather, base = 10, cap = 30): number {
  const hi = Math.min(w.tMaxC, cap);
  const lo = Math.max(Math.min(w.tMinC, cap), base);
  return Math.max(0, (Math.max(hi, base) + lo) / 2 - base);
}
