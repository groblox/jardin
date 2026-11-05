import { describe, it, expect } from 'vitest';
import { scheduleSlot, occupancyAt, plantingInterval, rotationIssues, followOns, squareHistory } from '../src/core/succession.ts';
import { newBed, sampleGarden, migrateGarden } from '../src/core/defaults.ts';
import { getPlant } from '../src/core/plants.ts';
import { bedKc } from '../src/core/water.ts';
import type { BedPlanting } from '../src/core/types.ts';

const site = sampleGarden(new Date(2025, 0, 10)).site; // last frost 04-15, first frost 10-25

describe('succession', () => {
  it('schedules beans after spring lettuce in the same square', () => {
    const lettuce: BedPlanting = { id: 'l', plantId: 'lettuce', col: 0, row: 0, method: 'direct', season: 2025 };
    const bed = newBed({ plantings: [lettuce] });
    const lettuceEnd = plantingInterval(lettuce, site).end;
    const r = scheduleSlot(bed, site, getPlant('bean'), 'direct', 0, 0, 2025);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.start.getTime()).toBeGreaterThanOrEqual(lettuceEnd.getTime());
  });

  it('refuses a tender crop that could not mature before frost', () => {
    const tomato: BedPlanting = { id: 't', plantId: 'tomato', col: 0, row: 0, method: 'transplant', season: 2025 };
    const bed = newBed({ plantings: [tomato] });
    const r = scheduleSlot(bed, site, getPlant('pepper'), 'transplant', 0, 0, 2025);
    expect(r.ok).toBe(false);
  });

  it('allows a fall crop of spinach after summer beans', () => {
    const bean: BedPlanting = { id: 'b', plantId: 'bean', col: 0, row: 0, method: 'direct', season: 2025, plannedOn: '2025-05-20' };
    const bed = newBed({ plantings: [bean] });
    const r = scheduleSlot(bed, site, getPlant('spinach'), 'direct', 0, 0, 2025, { earliest: new Date(2025, 6, 1) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.start.getMonth()).toBeGreaterThanOrEqual(7); // fall window (Aug/Sep)
  });

  it('occupancy depends on the date', () => {
    const bed = newBed({ plantings: [
      { id: 'l', plantId: 'radish', col: 0, row: 0, method: 'direct', season: 2025, plannedOn: '2025-03-20' },
      { id: 'b', plantId: 'bean', col: 0, row: 0, method: 'direct', season: 2025, plannedOn: '2025-05-15' },
    ] });
    expect(occupancyAt(bed, site, new Date(2025, 3, 1))[0]).toBe('l');
    expect(occupancyAt(bed, site, new Date(2025, 5, 15))[0]).toBe('b');
    expect(occupancyAt(bed, site, new Date(2025, 0, 15))[0]).toBe(null);
    expect(squareHistory(bed, site, 0, 0).map((x) => x.pl.id)).toEqual(['l', 'b']);
  });

  it('removed crops stop using water', () => {
    const bed = newBed({ plantings: [{ id: 't', plantId: 'tomato', col: 0, row: 0, method: 'transplant', season: 2025, plantedOn: '2025-05-01', removedOn: '2025-07-01' }] });
    expect(bedKc(bed, new Date(2025, 5, 20))).toBeGreaterThan(bedKc(bed, new Date(2025, 6, 10)));
  });
});

describe('rotation', () => {
  it('flags nightshades in the same squares within 3 years', () => {
    const bed = newBed({ plantings: [
      { id: 'old', plantId: 'potato', col: 1, row: 1, method: 'direct', season: 2024, plantedOn: '2024-04-01', removedOn: '2024-08-01' },
      { id: 'new', plantId: 'tomato', col: 1, row: 1, method: 'transplant', season: 2025 },
      { id: 'ok', plantId: 'tomato', col: 3, row: 3, method: 'transplant', season: 2025 },
    ] });
    const issues = rotationIssues(bed, site, 2025);
    expect(issues.map((i) => i.plantingId)).toEqual(['new']);
    expect(issues[0].message).toMatch(/2024/);
  });

  it('suggests a legume after a heavy feeder', () => {
    const tomato: BedPlanting = { id: 't', plantId: 'radish', col: 0, row: 0, method: 'direct', season: 2025 };
    const bed = newBed({ plantings: [tomato] });
    const sug = followOns(bed, site, tomato);
    expect(sug.length).toBeGreaterThan(3);
    expect(sug.every((s) => s.plant.id !== 'radish')).toBe(true);
    expect(sug[0].start >= plantingInterval(tomato, site).end).toBe(true);
  });

  it('migrates old plantings into seasons', () => {
    const g = sampleGarden(new Date(2025, 0, 10));
    const old = { ...g, beds: g.beds.map((b) => ({ ...b, plantings: b.plantings.map(({ season: _s, ...rest }) => ({ ...rest })) })) } as any;
    delete old.journal;
    const m = migrateGarden(old, new Date(2025, 0, 10));
    expect(m.journal).toEqual([]);
    expect(m.beds[0].plantings.find((p) => p.id === 'h1')!.season).toBe(2024);
    expect(m.beds[0].plantings.find((p) => p.id === 'p1')!.season).toBe(2025);
  });
});

import { soilAdvice, phAmendment, targetPh } from '../src/core/soil.ts';
describe('soil', () => {
  it('recommends lime for acidic soil under brassicas', () => {
    const bed = newBed({ soil: 'loam', widthFt: 10, lengthFt: 10, plantings: [{ id: 'c', plantId: 'cabbage', col: 0, row: 0, method: 'transplant', season: 2025 }],
      soilTests: [{ date: '2024-10-01', ph: 5.4, n: 'low' }] });
    const a = soilAdvice(bed, site, 2025);
    expect(a.offPh.map((c) => c.id)).toEqual(['cabbage']);
    expect(a.amendment?.product).toBe('lime');
    expect(a.amendment!.lbTotal).toBeGreaterThan(5);
    expect(a.advice.some((x) => /Nitrogen/.test(x.message))).toBe(true);
  });
  it('sulfur lowers pH and ranges intersect', () => {
    expect(phAmendment(newBed({ soil: 'sand' }), 7.5, 6.5)?.product).toBe('sulfur');
    expect(targetPh([getPlant('tomato'), getPlant('carrot')])!.target).toBeCloseTo(6.4, 1);
  });
});
