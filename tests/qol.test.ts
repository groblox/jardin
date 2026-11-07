import { describe, it, expect } from 'vitest';
import { simulateWater } from '../src/core/water.ts';
import { bedWarnings, plantingsOutside } from '../src/core/bed.ts';
import { nextSuccession } from '../src/core/succession.ts';
import { seedNeeds, isSeedOld, expectedGermination, shoppingListText } from '../src/core/seeds.ts';
import { upcomingTasks } from '../src/core/today.ts';
import { migrateGarden, newBed, sampleGarden } from '../src/core/defaults.ts';
import { seasonFor } from '../src/core/schedule.ts';
import type { BedPlanting, DailyWeather, Garden } from '../src/core/types.ts';
import { addDays, isoDate, localDateOf } from '../src/core/util.ts';

const site = sampleGarden(new Date(2026, 0, 15)).site; // Philadelphia, last frost 04-15, first frost 10-25

function garden(beds: Garden['beds'], extra: Partial<Garden> = {}): Garden {
  return { version: 1, site, beds, journal: [], seeds: [], notify: { dailyDigest: false, digestHour: 7, frostAlerts: false, publishSensors: false }, updatedAt: '', ...extra };
}

describe('irrigation events use the garden time zone', () => {
  it('localDateOf shifts by the UTC offset', () => {
    expect(localDateOf('2026-07-10T01:30:00Z', -5 * 3600)).toBe('2026-07-09');
    expect(localDateOf('2026-07-10T01:30:00Z', 0)).toBe('2026-07-10');
    expect(localDateOf('2026-07-09T23:30:00Z', 2 * 3600)).toBe('2026-07-10');
  });

  it('an evening watering counts on the garden day it happened, even on a UTC server', () => {
    const bed = newBed({ id: 'b', widthFt: 4, lengthFt: 4, plantings: [{ id: 'p', plantId: 'tomato', col: 0, row: 0, method: 'transplant', season: 2026, plantedOn: '2026-05-01' }] });
    const w: DailyWeather[] = ['2026-07-09', '2026-07-10'].map((date) => ({ date, tMaxC: 30, tMinC: 18, precipMm: 0, et0Mm: 5, forecast: false }));
    // 8:30 pm Central (UTC−5 in summer) on July 9 is 01:30 UTC on July 10.
    const events = [{ id: 'e', bedId: 'b', start: '2026-07-10T01:30:00Z', minutes: 20, depthMm: 12, source: 'manual' as const }];
    const sim = simulateWater(bed, w, events, { utcOffsetSeconds: -5 * 3600, startAvailable: 0.5 });
    expect(sim.days[0].irrigation).toBe(12);
    expect(sim.days[1].irrigation).toBe(0);
  });

  it('ignores corrupt events instead of poisoning the balance with NaN', () => {
    const bed = newBed({ id: 'b' });
    const w: DailyWeather[] = [{ date: '2026-07-09', tMaxC: 30, tMinC: 18, precipMm: 0, et0Mm: 5, forecast: false }];
    const sim = simulateWater(bed, w, [{ id: 'e', bedId: 'b', start: '2026-07-09T12:00:00Z', minutes: NaN, depthMm: NaN, source: 'manual' }], { utcOffsetSeconds: 0 });
    expect(Number.isFinite(sim.days[0].depletion)).toBe(true);
  });
});

describe('bed resizing', () => {
  it('flags plantings that no longer fit instead of losing them', () => {
    const plantings: BedPlanting[] = [
      { id: 'a', plantId: 'tomato', col: 0, row: 0, method: 'transplant', season: 2026 },
      { id: 'b', plantId: 'carrot', col: 3, row: 3, method: 'direct', season: 2026 },
      { id: 'c', plantId: 'zucchini', col: 1, row: 1, method: 'transplant', season: 2026 }, // 2×2 → cols 1-2
    ];
    const bed = newBed({ widthFt: 2, lengthFt: 4, plantings });
    expect(plantingsOutside(bed).map((p) => p.id).sort()).toEqual(['b', 'c']);
    const w = bedWarnings(bed, site, undefined, 2026);
    expect(w.some((x) => x.level === 'bad' && /fall outside/.test(x.message))).toBe(true);
    expect(plantingsOutside({ ...bed, widthFt: 4 })).toEqual([]);
  });
});

describe('succession sowing', () => {
  it('schedules the next sowing in a nearby free square and extends the chain', () => {
    const first: BedPlanting = { id: 'l1', plantId: 'leaf-lettuce', col: 0, row: 0, method: 'direct', season: 2026, plannedOn: '2026-03-20' };
    let bed = newBed({ widthFt: 4, lengthFt: 4, plantings: [first] });
    const r1 = nextSuccession(bed, site, first);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(isoDate(r1.start)).toBe('2026-04-03'); // successionDays 14
    expect(Math.hypot(r1.col, r1.row)).toBe(1); // an adjacent square
    bed = { ...bed, plantings: [...bed.plantings, { id: 'l2', plantId: 'leaf-lettuce', col: r1.col, row: r1.row, method: 'direct', season: 2026, plannedOn: isoDate(r1.start) }] };
    const r2 = nextSuccession(bed, site, first);
    expect(r2.ok && isoDate(r2.start)).toBe('2026-04-17');
  });

  it('refuses for perennials', () => {
    const pl: BedPlanting = { id: 'c', plantId: 'chive', col: 0, row: 0, method: 'transplant', season: 2026 };
    expect(nextSuccession(newBed({ plantings: [pl] }), site, pl).ok).toBe(false);
  });
});

describe('seed box and shopping list', () => {
  const plantings: BedPlanting[] = [
    { id: 't1', plantId: 'tomato', col: 0, row: 0, method: 'transplant', season: 2027 },
    { id: 't2', plantId: 'tomato', col: 1, row: 0, method: 'transplant', season: 2027 },
    { id: 'c1', plantId: 'carrot', col: 0, row: 1, method: 'direct', season: 2027 },
    { id: 'b1', plantId: 'bean', col: 1, row: 1, method: 'direct', season: 2027, plantedOn: '2027-05-01' }, // already in: not needed
    { id: 'po', plantId: 'potato', col: 2, row: 1, method: 'direct', season: 2027 },
    { id: 'pe', plantId: 'pepper', col: 3, row: 0, method: 'transplant', season: 2027 },
  ];
  const g = garden([newBed({ widthFt: 4, lengthFt: 4, plantings })], {
    seeds: [
      { id: 's1', plantId: 'tomato', year: 2026, amount: 'half' },
      { id: 's2', plantId: 'carrot', year: 2022, amount: 'low' },
      { id: 's3', plantId: 'pepper', year: 2026, amount: 'empty' },
    ],
  });
  const needs = seedNeeds(g, 2027);
  const by = (id: string) => needs.find((n) => n.plantId === id)!;

  it('classifies have / old / need / buy and skips crops already planted', () => {
    expect(by('tomato').status).toBe('have');
    expect(by('carrot').status).toBe('old');
    expect(by('pepper').status).toBe('need'); // the only packet is empty
    expect(by('potato').status).toBe('buy');
    expect(by('potato').how).toBe('plant-sets');
    expect(needs.find((n) => n.plantId === 'bean')).toBeUndefined();
  });

  it('counts seeds from plants, germination and seed age', () => {
    expect(by('tomato').plants).toBe(2);
    expect(by('tomato').seeds).toBe(3); // 2 / 0.85 × 1.25 = 2.9
    expect(by('tomato').cells).toBe(3);
    expect(by('carrot').plants).toBe(16);
    expect(by('carrot').seeds).toBe(67); // old seed: 16 / (0.6 × 0.5) × 1.25 = 66.7
  });

  it('dates indoor starts back from transplanting', () => {
    const s = seasonFor(site, 2027);
    // Tomato: transplant 2 weeks after last frost, started 7 weeks before last frost → 9 weeks indoors.
    expect(by('tomato').by).toBe(isoDate(addDays(s.lastFrost, 14 - 63)));
    expect(needs.map((n) => n.by)).toEqual([...needs.map((n) => n.by)].sort());
  });

  it('seed age helpers and text list', () => {
    expect(isSeedOld({ id: 'x', plantId: 'onion', year: 2025 }, 2027)).toBe(true);
    expect(isSeedOld({ id: 'x', plantId: 'cucumber', year: 2023 }, 2027)).toBe(false);
    expect(expectedGermination('onion', { id: 'x', plantId: 'onion', year: 2027 }, 2027)).toBe(0.7);
    const txt = shoppingListText(needs, 2027);
    expect(txt).toContain('Carrot: 67 seeds');
    expect(txt).not.toContain('Tomato'); // covered by the seed box
  });

  it('migration adds an empty seed box to older saves', () => {
    const old = { ...g } as Garden;
    delete old.seeds;
    expect(migrateGarden(old).seeds).toEqual([]);
  });
});

describe('two-week look-ahead', () => {
  it('lists tasks from day 4 to day 14, sorted, never overlapping the agenda', () => {
    const plantings: BedPlanting[] = [
      { id: 'a', plantId: 'pea', col: 0, row: 0, method: 'direct', season: 2026, plannedOn: '2026-03-12' },
      { id: 'b', plantId: 'spinach', col: 1, row: 0, method: 'direct', season: 2026, plannedOn: '2026-03-03' },
      { id: 'c', plantId: 'radish', col: 2, row: 0, method: 'direct', season: 2026, plannedOn: '2026-03-25' },
    ];
    const g = garden([newBed({ widthFt: 4, lengthFt: 4, plantings })]);
    const up = upcomingTasks(g, '2026-03-01');
    expect(up.map((t) => t.date)).toEqual(['2026-03-12']); // spinach (Mar 3) is in the agenda; radish is beyond 14 days
    expect(up[0].kind).toBe('direct-sow');
    const later = upcomingTasks(g, '2026-03-01', 30).map((t) => t.date);
    expect(later).toEqual([...later].sort());
    expect(later.every((d) => d >= '2026-03-05' && d <= '2026-03-31')).toBe(true);
  });

  it('hides side-dress tasks already logged in the journal', () => {
    const pl: BedPlanting = { id: 't', plantId: 'tomato', col: 0, row: 0, method: 'transplant', season: 2026, plantedOn: '2026-05-01' };
    const bed = newBed({ name: 'Bed 1', plantings: [pl] });
    const g = garden([bed]);
    const first = upcomingTasks(g, '2026-05-20').find((t) => t.kind === 'side-dress')!;
    expect(first).toBeTruthy();
    const logged = { ...g, journal: [{ id: 'j', date: '2026-05-22', kind: 'fertilize' as const, text: first.title }] };
    expect(upcomingTasks(logged, '2026-05-20').some((t) => t.kind === 'side-dress' && t.date === first.date)).toBe(false);
  });
});
