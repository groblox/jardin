import { describe, it, expect } from 'vitest';
import { degreeDaysF, tomcastDsv, huttonDays, wetnessByDay, pestRisks, diseaseRisks } from '../src/core/health.ts';
import { newBed, sampleGarden } from '../src/core/defaults.ts';
import type { DailyWeather, Garden, HourlyWeather } from '../src/core/types.ts';
import { addDays, isoDate, fToC } from '../src/core/util.ts';

const day = (date: string, hiF: number, loF: number): DailyWeather => ({ date, tMaxC: fToC(hiF), tMinC: fToC(loF), precipMm: 0, et0Mm: 3, forecast: false });

function gardenWith(plants: string[], season: number): Garden {
  const g = sampleGarden(new Date(season, 5, 1));
  g.beds = [newBed({ plantings: plants.map((id, i) => ({ id: 'p' + i, plantId: id, col: i % 4, row: Math.floor(i / 4), method: 'transplant', season, plantedOn: `${season}-05-01` })) })];
  return g;
}

describe('degree days', () => {
  it('uses horizontal cutoffs', () => {
    expect(degreeDaysF(day('2025-06-01', 80, 60), 50)).toBeCloseTo(20, 5);
    expect(degreeDaysF(day('2025-06-01', 95, 70), 50, 86)).toBeCloseTo(28, 5);
    expect(degreeDaysF(day('2025-03-01', 45, 30), 50)).toBe(0);
  });

  it('squash vine borer goes high once 900 DD50 have accumulated', () => {
    const g = gardenWith(['zucchini'], 2025);
    const days: DailyWeather[] = [];
    for (let i = 0; i < 200; i++) days.push(day(isoDate(addDays(new Date(2025, 0, 1, 12), i)), 82, 62)); // 22 DD/day
    const before = pestRisks(g, { days: days.slice(0, 41), today: days[40].date }); // ~ 902? check level by index
    const r = pestRisks(g, { days, today: days[45].date }).find((x) => x.id === 'squash-vine-borer')!;
    expect(r.level).toBe('high');
    expect(r.progress!.dd).toBeGreaterThan(900);
    const early = pestRisks(g, { days, today: days[35].date }).find((x) => x.id === 'squash-vine-borer')!;
    expect(early.level).toBe('watch');
    expect(early.progress!.eta).toBeDefined();
    expect(before.length).toBeGreaterThan(0);
  });

  it('ignores pests with no host in the garden', () => {
    const g = gardenWith(['lettuce'], 2025);
    expect(pestRisks(g, { days: [day('2025-06-01', 80, 60)], today: '2025-06-01' })).toEqual([]);
  });
});

describe('disease models', () => {
  it('TOMCAST table', () => {
    expect(tomcastDsv(0, 20)).toBe(0);
    expect(tomcastDsv(10, 22)).toBe(2);
    expect(tomcastDsv(24, 22)).toBe(4);
    expect(tomcastDsv(24, 15)).toBe(3);
    expect(tomcastDsv(24, 10)).toBe(0);
  });

  function hourly(days: number, f: (d: number, h: number) => [number, number, number]): HourlyWeather {
    const h: HourlyWeather = { time: [], tempC: [], rh: [], precipMm: [] };
    for (let d = 0; d < days; d++)
      for (let hr = 0; hr < 24; hr++) {
        const [t, rh, p] = f(d, hr);
        h.time.push(`2025-07-${String(d + 1).padStart(2, '0')}T${String(hr).padStart(2, '0')}:00`);
        h.tempC.push(t);
        h.rh.push(rh);
        h.precipMm.push(p);
      }
    return h;
  }

  it('finds Hutton periods and flags late blight', () => {
    const h = hourly(10, (d, hr) => [d >= 4 && d <= 6 ? 16 : 8 + hr * 0.5, hr < 8 && d >= 4 && d <= 6 ? 95 : 70, 0]);
    const w = wetnessByDay(h);
    expect(huttonDays(w)).toEqual(['2025-07-06', '2025-07-07']);
    const g = gardenWith(['tomato'], 2025);
    const risks = diseaseRisks(g, h, '2025-07-05');
    expect(risks.find((r) => r.id === 'late-blight')!.level).toBe('high');
    expect(risks.find((r) => r.id === 'tomcast')).toBeDefined();
  });

  it('treatment resets the TOMCAST count', () => {
    const h = hourly(10, () => [22, 95, 0]); // wet all day, 22°C → 4 DSV/day
    const g = gardenWith(['tomato'], 2025);
    const before = diseaseRisks(g, h, '2025-07-08').find((r) => r.id === 'tomcast')!;
    expect(before.level).toBe('high');
    g.journal.push({ id: 'j', date: '2025-07-07', kind: 'treatment', plantId: 'tomato' });
    const after = diseaseRisks(g, h, '2025-07-08').find((r) => r.id === 'tomcast')!;
    expect(after.headline).toMatch(/since 2025-07-07/);
    expect(after.level).not.toBe('high');
  });
});
