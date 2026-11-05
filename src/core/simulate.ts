// Whole-season "what if" simulation of a bed against a reference year of real weather:
// crop development & harvest dates, frost/heat exposure, and irrigation demand.
import type { Bed, DailyWeather, Garden } from './types.ts';
import { PLANT_BY_ID } from './plants.ts';
import { developmentRate, frostThresholdC } from './growth.ts';
import { plantTimeline, seasonFor } from './schedule.ts';
import { bedKc, etScaleFor, gallonsForDepth, MAD, tawMm } from './water.ts';
import { addDays, isoDate, mmToIn, parseIso } from './util.ts';

export interface CropSim {
  plantingId: string;
  plantId: string;
  plantedOn: string;
  maturity?: string;
  harvestEnd?: string;
  daysToHarvest?: number;
  frostDays: number;
  heatDays: number;
  sunHours?: number;
  sunOk: boolean;
}

export interface SeasonSim {
  year: number;
  crops: CropSim[];
  weeks: { start: string; rainIn: number; irrigationIn: number; useIn: number }[];
  irrigationEvents: number;
  irrigationGal: number;
  rainIn: number;
  useIn: number;
  stressDays: number;
}

export function simulateSeason(garden: Garden, bed: Bed, days: DailyWeather[], year: number): SeasonSim {
  const season = seasonFor(garden.site, year);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const crops: CropSim[] = [];

  const planted: Bed = {
    ...bed,
    plantings: bed.plantings.map((pl) => {
      const plant = PLANT_BY_ID[pl.plantId];
      let date: string;
      if (pl.plantedOn) date = `${year}-${pl.plantedOn.slice(5)}`;
      else {
        const t = plantTimeline(plant, season);
        const d = pl.method === 'transplant' ? t.transplant ?? t.directSow?.[0] : t.directSow?.[0] ?? t.transplant;
        date = isoDate(d ?? t.fallSow ?? season.lastFrost);
      }
      return { ...pl, plantedOn: date };
    }),
  };

  for (const pl of planted.plantings) {
    const plant = PLANT_BY_ID[pl.plantId];
    if (!plant) continue;
    const light = bed.analysis ? bed.analysis.sunHours / plant.idealSunHours : 1;
    let prog = pl.method === 'transplant' ? 0.12 * plant.daysToMaturity : 0;
    const endFrac = 1 + plant.harvestDays / plant.daysToMaturity;
    const r: CropSim = { plantingId: pl.id, plantId: plant.id, plantedOn: pl.plantedOn!, frostDays: 0, heatDays: 0, sunHours: bed.analysis?.sunHours, sunOk: !bed.analysis || bed.analysis.sunHours >= plant.minSunHours };
    const start = parseIso(pl.plantedOn!);
    for (let d = start, i = 0; i < 500; d = addDays(d, 1), i++) {
      const w = byDate.get(isoDate(d)) ?? byDate.get(`${year}-${isoDate(d).slice(5)}`);
      if (!w) break;
      prog += developmentRate(plant, w.tMinC, w.tMaxC, light);
      if (w.tMinC <= frostThresholdC(plant)) r.frostDays++;
      if (plant.boltsInHeat && w.tMaxC > plant.maxTempC) r.heatDays++;
      const frac = prog / plant.daysToMaturity;
      if (!r.maturity && frac >= 1) {
        r.maturity = isoDate(d);
        r.daysToHarvest = i + 1;
      }
      if (frac >= endFrac) {
        r.harvestEnd = isoDate(d);
        break;
      }
    }
    crops.push(r);
  }

  // Water balance with ideal automatic irrigation (refill whenever the refill point is crossed).
  const taw = tawMm(planted);
  const raw = MAD * taw;
  const scale = etScaleFor(bed);
  let D = 0.3 * taw;
  let events = 0;
  let irrTotal = 0;
  let rain = 0;
  let use = 0;
  let stress = 0;
  const weeks: SeasonSim['weeks'] = [];
  const s0 = addDays(season.lastFrost, -30);
  const s1 = addDays(season.firstFrost, 14);
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date)).filter((d) => d.date >= isoDate(s0) && d.date <= isoDate(s1));
  ordered.forEach((w, i) => {
    const etc = w.et0Mm * bedKc(planted, parseIso(w.date)) * scale;
    const eff = w.precipMm < 1 ? 0 : w.precipMm * 0.9;
    D = Math.max(0, D + etc - eff);
    let irr = 0;
    if (D > raw) {
      stress++;
      irr = D;
      D = 0;
      events++;
      irrTotal += irr;
    }
    D = Math.min(D, taw);
    rain += eff;
    use += etc;
    if (i % 7 === 0) weeks.push({ start: w.date, rainIn: 0, irrigationIn: 0, useIn: 0 });
    const wk = weeks[weeks.length - 1];
    wk.rainIn += mmToIn(eff);
    wk.irrigationIn += mmToIn(irr);
    wk.useIn += mmToIn(etc);
  });

  return {
    year, crops, weeks, irrigationEvents: events, irrigationGal: gallonsForDepth(bed, irrTotal),
    rainIn: mmToIn(rain), useIn: mmToIn(use), stressDays: stress,
  };
}
