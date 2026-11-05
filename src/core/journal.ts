// Garden journal helpers: harvest totals vs. expectations, and per-crop records.
import type { Garden, JournalEntry } from './types.ts';
import { PLANT_BY_ID } from './plants.ts';
import { seasonFor } from './schedule.ts';
import { addDays, isoDate } from './util.ts';

const TO_LB: Record<string, number> = { lb: 1, oz: 1 / 16, kg: 2.20462, g: 0.00220462 };

export function harvestLb(e: JournalEntry): number | null {
  if (e.kind !== 'harvest' || e.qty == null || !e.unit) return null;
  const f = TO_LB[e.unit];
  return f ? e.qty * f : null;
}

export interface CropYield {
  plantId: string;
  harvestedLb: number;
  harvestedCount: number;
  entries: number;
  squares: number;
  expectedLb: number;
}

/** Harvest totals per crop for a season's date range, with expected yield from the plan. */
export function seasonYields(garden: Garden, season: number): CropYield[] {
  const s = seasonFor(garden.site, season);
  const from = isoDate(addDays(s.lastFrost, -150));
  const to = isoDate(addDays(s.firstFrost, 150));
  const by = new Map<string, CropYield>();
  const get = (id: string) => {
    if (!by.has(id)) by.set(id, { plantId: id, harvestedLb: 0, harvestedCount: 0, entries: 0, squares: 0, expectedLb: 0 });
    return by.get(id)!;
  };
  for (const bed of garden.beds)
    for (const pl of bed.plantings) {
      const plant = PLANT_BY_ID[pl.plantId];
      if (!plant || pl.season !== season || plant.yieldLbPerSqFt === 0) continue;
      const y = get(plant.id);
      y.squares += plant.span * plant.span;
      y.expectedLb += plant.yieldLbPerSqFt * plant.span * plant.span;
    }
  for (const e of garden.journal) {
    if (e.kind !== 'harvest' || e.date < from || e.date > to) continue;
    const id = e.plantId ?? garden.beds.flatMap((b) => b.plantings).find((p) => p.id === e.plantingId)?.plantId;
    if (!id) continue;
    const y = get(id);
    y.entries++;
    const lb = harvestLb(e);
    if (lb != null) y.harvestedLb += lb;
    else if (e.qty) y.harvestedCount += e.qty;
  }
  return [...by.values()].sort((a, b) => b.harvestedLb - a.harvestedLb || b.expectedLb - a.expectedLb);
}

/** Most recent treatment date for a crop (resets disease-pressure accumulators). */
export function lastTreatment(garden: Garden, plantIds: string[]): string | undefined {
  return garden.journal
    .filter((e) => e.kind === 'treatment' && (!e.plantId || plantIds.includes(e.plantId)))
    .map((e) => e.date)
    .sort()
    .pop();
}

export const JOURNAL_KINDS: { id: JournalEntry['kind']; label: string; icon: string }[] = [
  { id: 'harvest', label: 'Harvest', icon: '🧺' },
  { id: 'note', label: 'Observation', icon: '📝' },
  { id: 'pest', label: 'Pest seen', icon: '🐛' },
  { id: 'disease', label: 'Disease seen', icon: '🍂' },
  { id: 'treatment', label: 'Treatment / spray', icon: '🧴' },
  { id: 'fertilize', label: 'Fed / side-dressed', icon: '🌾' },
  { id: 'amend', label: 'Soil amended', icon: '🪣' },
  { id: 'sow', label: 'Sowed / planted', icon: '🌱' },
  { id: 'other', label: 'Other', icon: '•' },
];
