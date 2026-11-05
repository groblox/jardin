import { describe, it, expect } from 'vitest';
import { simulateWater, recommend, tawMm, minutesForDepth, depthForMinutes, sensorToFraction } from '../src/core/water.ts';
import { simulateGrowth, developmentRate } from '../src/core/growth.ts';
import { plantNow, planningYear, seasonFor } from '../src/core/schedule.ts';
import { gardenTasks } from '../src/core/tasks.ts';
import { bedWarnings } from '../src/core/bed.ts';
import { scheduleSlot } from '../src/core/succession.ts';
import { estimateFrostDates } from '../src/core/weather.ts';
import { newBed, sampleGarden } from '../src/core/defaults.ts';
import { getPlant } from '../src/core/plants.ts';
import type { DailyWeather } from '../src/core/types.ts';
import { addDays, isoDate } from '../src/core/util.ts';

function weather(start: string, n: number, f: (i: number) => Partial<DailyWeather>): DailyWeather[] {
  const s = new Date(start + 'T12:00:00');
  return Array.from({ length: n }, (_, i) => ({
    date: isoDate(addDays(s, i)), tMaxC: 28, tMinC: 16, precipMm: 0, et0Mm: 5, forecast: false, ...f(i),
  }));
}

describe('water balance', () => {
  const plantings = Array.from({ length: 32 }, (_, i) => ({ id: 'p' + i, plantId: 'tomato', col: i % 4, row: Math.floor(i / 4), method: 'transplant' as const, plantedOn: '2024-05-01', season: 2024 }));
  const bed = newBed({ widthFt: 4, lengthFt: 8, plantings });

  it('dries out without rain and recommends watering', () => {
    const w = weather('2024-07-01', 10, () => ({}));
    const sim = simulateWater(bed, w, [], { startAvailable: 1 });
    expect(sim.days[9].depletion).toBeGreaterThan(sim.days[0].depletion);
    const rec = recommend(bed, sim, '2024-07-10');
    expect(rec.action).toBe('water-now');
    expect(rec.minutes).toBeGreaterThan(0);
  });

  it('irrigation and rain refill the root zone', () => {
    const w = weather('2024-07-01', 6, (i) => ({ precipMm: i === 3 ? 80 : 0 }));
    const sim = simulateWater(bed, w, [], { startAvailable: 0.5 });
    expect(sim.days[3].depletion).toBe(0);
    expect(sim.days[3].drainage).toBeGreaterThan(0);
  });

  it('sensor reading overrides the modelled state', () => {
    const w = weather('2024-07-01', 3, () => ({}));
    const sim = simulateWater(bed, w, [], { sensor: { date: '2024-07-02', fraction: 0.25 } });
    expect(sim.days[1].available).toBeCloseTo(0.25, 2);
  });

  it('runtime and depth are inverses', () => {
    expect(depthForMinutes(bed, minutesForDepth(bed, 12))).toBeCloseTo(12, 5);
    expect(tawMm(bed)).toBeGreaterThan(30);
    expect(sensorToFraction(bed, 35)).toBeCloseTo(0.5, 2);
  });
});

describe('growth', () => {
  it('warm weather speeds tomatoes, cold stalls them', () => {
    const t = getPlant('tomato');
    expect(developmentRate(t, 18, 30)).toBeGreaterThan(developmentRate(t, 5, 15));
    expect(developmentRate(t, 2, 8)).toBeLessThan(0.1);
  });

  it('predicts maturity and flags frost in the forecast', () => {
    const w = weather('2024-05-01', 90, (i) => ({ forecast: i > 80, tMinC: i === 85 ? -1 : 16 }));
    const r = simulateGrowth({ id: 'a', plantId: 'tomato', col: 0, row: 0, method: 'transplant', plantedOn: '2024-05-01', season: 2024 }, w, { today: '2024-07-20' })!;
    expect(r.maturityDate).toBeDefined();
    expect(r.progress).toBeGreaterThan(0.8);
    expect(r.warnings.some((x) => x.kind === 'frost')).toBe(true);
  });
});

describe('schedule', () => {
  const g = sampleGarden(new Date(2025, 0, 10));
  it('creates start-indoors before transplant for tomatoes', () => {
    const tasks = gardenTasks(g, 2025);
    const start = tasks.find((t) => t.kind === 'start-indoors' && t.plantId === 'tomato')!;
    const trans = tasks.find((t) => t.kind === 'transplant' && t.plantId === 'tomato')!;
    expect(start.date < trans.date).toBe(true);
    expect(trans.date).toBe('2025-04-29');
    expect(trans.plantingIds.length).toBe(2); // both tomato squares merged
    expect(tasks.some((t) => t.kind === 'side-dress' && t.plantId === 'tomato')).toBe(true);
    // Beans succeed lettuce → a prep task appears
    expect(tasks.some((t) => t.kind === 'prep' && t.plantId === 'bean')).toBe(true);
  });

  it('suggests peas in early spring', () => {
    const now = plantNow(g.site, new Date(2025, 2, 20));
    expect(now.some((x) => x.plant.id === 'pea' && x.action === 'direct-sow')).toBe(true);
  });

  it('plans next season after fall', () => {
    expect(planningYear(g.site, new Date(2026, 10, 30))).toBe(2027);
    expect(planningYear(g.site, new Date(2026, 10, 5))).toBe(2027);
    expect(planningYear(g.site, new Date(2026, 2, 1))).toBe(2026);
    expect(seasonFor(g.site, 2025).frostFreeDays).toBeGreaterThan(180);
  });
});

describe('bed', () => {
  it('detects overlaps, companions and tall-plant shading', () => {
    const bed = newBed({ widthFt: 4, lengthFt: 4, plantings: [
      { id: 'a', plantId: 'tomato', col: 1, row: 2, method: 'transplant', season: 2025 },
      { id: 'b', plantId: 'potato', col: 2, row: 2, method: 'direct', season: 2025 },
      { id: 'c', plantId: 'pepper', col: 1, row: 1, method: 'transplant', season: 2025 },
    ] });
    const site = sampleGarden().site;
    expect(scheduleSlot(bed, site, getPlant('zucchini'), 'transplant', 0, 0, 2025).ok).toBe(false);
    expect(scheduleSlot(bed, site, getPlant('zucchini'), 'transplant', 2, 0, 2025).ok).toBe(true);
    const w = bedWarnings(bed, site);
    expect(w.some((x) => x.message.includes('poor companions'))).toBe(true);
    expect(w.some((x) => x.message.includes('will shade'))).toBe(true);
  });
});

describe('frost estimation', () => {
  it('finds median last/first frost', () => {
    const days: DailyWeather[] = [];
    for (const y of [2021, 2022, 2023]) {
      for (let d = new Date(y, 0, 1, 12); d.getFullYear() === y; d = addDays(d, 1)) {
        const doy = (d.getTime() - new Date(y, 0, 1, 12).getTime()) / 86400000;
        const tMin = 3 - 15 * Math.cos(((doy - 15) / 365) * 2 * Math.PI);
        days.push({ date: isoDate(d), tMaxC: tMin + 10, tMinC: tMin, precipMm: 0, et0Mm: 2, forecast: false });
      }
    }
    const f = estimateFrostDates(days, 40)!;
    expect(f.years).toBe(3);
    expect(f.lastFrost.startsWith('04')).toBe(true);
    expect(f.firstFrost.startsWith('10') || f.firstFrost.startsWith('11')).toBe(true);
  });
});

import { bedMad, canopySquares, bedKc as kcOf } from '../src/core/water.ts';
describe('water realism', () => {
  it('most sensitive crop sets the refill point', () => {
    const bed = newBed({ plantings: [
      { id: 'a', plantId: 'zucchini', col: 0, row: 0, method: 'transplant', season: 2025, plantedOn: '2025-05-01' },
      { id: 'b', plantId: 'spinach', col: 3, row: 3, method: 'direct', season: 2025, plantedOn: '2025-05-01' },
    ] });
    expect(bedMad(bed, new Date(2025, 5, 1))).toBe(0.2);
    expect(bedMad(bed, new Date(2025, 3, 1))).toBe(0.5); // nothing planted yet → default
  });
  it('tall crops shade more than their square', () => {
    expect(canopySquares(getPlant('tomato'))).toBeGreaterThan(1.5);
    expect(canopySquares(getPlant('lettuce'))).toBe(1);
    const one = newBed({ widthFt: 2, lengthFt: 2, plantings: [{ id: 't', plantId: 'tomato', col: 0, row: 0, method: 'transplant', season: 2025, plantedOn: '2025-05-01' }] });
    const kc = kcOf(one, new Date(2025, 6, 15));
    expect(kc).toBeGreaterThan((1.15 + 3 * 0.15) / 4);
  });
});
