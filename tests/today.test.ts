import { describe, it, expect } from 'vitest';
import { buildAgenda, agendaDigest } from '../src/core/today.ts';
import { newBed, sampleGarden } from '../src/core/defaults.ts';
import type { DailyWeather, WeatherBundle } from '../src/core/types.ts';
import { addDays, isoDate } from '../src/core/util.ts';

function weather(today: string, f: (i: number) => Partial<DailyWeather>): WeatherBundle {
  const start = addDays(new Date(today + 'T12:00:00'), -30);
  const daily = Array.from({ length: 46 }, (_, i) => {
    const date = isoDate(addDays(start, i));
    return { date, tMaxC: 28, tMinC: 16, precipMm: 0, et0Mm: 6, forecast: date > today, ...f(i) };
  });
  return { lat: 40, lon: -75, timezone: 'UTC', utcOffsetSeconds: 0, today, daily, fetchedAt: '' };
}

describe('agenda', () => {
  const g = sampleGarden(new Date(2025, 4, 1));
  g.beds = [newBed({ id: 'b', name: 'Bed A', widthFt: 4, lengthFt: 4, plantings: Array.from({ length: 16 }, (_, i) => ({
    id: 'p' + i, plantId: i < 8 ? 'tomato' : 'radish', col: i % 4, row: Math.floor(i / 4), method: i < 8 ? 'transplant' as const : 'direct' as const, season: 2025, plantedOn: '2025-05-01',
  })) })];

  it('puts frost first, then watering, and finds ready radishes', () => {
    const w = weather('2025-06-10', (i) => ({ tMinC: i === 30 ? -0.5 : 16 }));
    const items = buildAgenda({ garden: g, weather: w, events: [], readings: { b: 18 } });
    expect(items[0].category).toBe('frost');
    expect(items[0].priority).toBe(0);
    const water = items.find((i) => i.category === 'water')!;
    expect(water.priority).toBe(1);
    expect(water.title).toMatch(/Water Bed A/);
    const radish = items.find((i) => i.category === 'harvest' && /Radish/.test(i.title))!;
    expect(radish.plantingIds!.length).toBe(8); // merged squares
    const d = agendaDigest(items);
    expect(d.title).toMatch(/need you today/);
  });

  it('suppresses watering when the sensor says the soil is wet', () => {
    const w = weather('2025-06-10', () => ({}));
    const items = buildAgenda({ garden: g, weather: w, events: [], readings: { b: 55 } });
    expect(items.find((i) => i.category === 'water' && i.priority === 1)).toBeUndefined();
  });
});
