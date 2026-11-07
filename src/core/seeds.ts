// Seed box and the season's seed / plant shopping list: how many seeds to sow or start indoors
// for the plan (allowing for germination and seed age), what to buy as plants or sets, and by when.
import type { Garden, SeedPacket } from './types.ts';
import { PLANT_BY_ID } from './plants.ts';
import { plantCount } from './bed.ts';
import { plantingStart } from './succession.ts';
import { addDays, isoDate } from './util.ts';

/** Typical germination of fresh seed (fraction). Planning figures, not guarantees. */
export const GERMINATION: Record<string, number> = {
  tomato: 0.85, 'cherry-tomato': 0.85, pepper: 0.75, eggplant: 0.7, lettuce: 0.8, 'leaf-lettuce': 0.8, spinach: 0.7,
  kale: 0.8, chard: 0.75, broccoli: 0.8, cabbage: 0.8, cauliflower: 0.75, carrot: 0.6, beet: 0.7, radish: 0.85,
  turnip: 0.8, onion: 0.7, scallion: 0.7, leek: 0.7, pea: 0.8, bean: 0.8, 'pole-bean': 0.8, cucumber: 0.85,
  zucchini: 0.85, 'winter-squash': 0.8, melon: 0.8, corn: 0.75, basil: 0.8, parsley: 0.6, cilantro: 0.7, dill: 0.6,
  chive: 0.65, mint: 0.6, thyme: 0.6, sage: 0.65, marigold: 0.75, nasturtium: 0.8, sunflower: 0.8,
};

/** Years seed typically stays viable when stored cool and dry. */
export const SEED_LIFE_YEARS: Record<string, number> = {
  tomato: 4, 'cherry-tomato': 4, pepper: 2, eggplant: 4, lettuce: 3, 'leaf-lettuce': 3, spinach: 2, kale: 4, chard: 4,
  broccoli: 3, cabbage: 4, cauliflower: 4, carrot: 3, beet: 4, radish: 4, turnip: 4, onion: 1, scallion: 1, leek: 2,
  pea: 3, bean: 3, 'pole-bean': 3, cucumber: 5, zucchini: 4, 'winter-squash': 4, melon: 5, corn: 2, basil: 5,
  parsley: 1, cilantro: 5, dill: 3, chive: 2, mint: 2, thyme: 3, sage: 3, marigold: 2, nasturtium: 5, sunflower: 5,
};

/** Crops normally planted from something other than seed. */
const PROPAGULE: Record<string, string> = {
  potato: 'seed potatoes (pieces with 2+ eyes)',
  garlic: 'cloves (from seed garlic, not the grocery store)',
  strawberry: 'plants or bare-root crowns',
  mint: 'a plant (mint rarely comes true from seed)',
};

/** Spares for thinning, damping-off and slugs. */
const SAFETY = 1.25;

export type SeedStatus = 'have' | 'old' | 'need' | 'buy';

export interface SeedNeed {
  plantId: string;
  how: 'start-indoors' | 'direct-sow' | 'buy-plants' | 'plant-sets';
  /** Plants that end up in the beds. */
  plants: number;
  plantings: number;
  /** Seeds to sow (start-indoors / direct-sow). */
  seeds?: number;
  /** Cells or pots to fill when starting indoors. */
  cells?: number;
  /** Have the seed or plants on hand by this date (the first start-indoors / sow / transplant date). */
  by: string;
  packets: SeedPacket[];
  status: SeedStatus;
  note?: string;
}

export function seedAge(p: SeedPacket, seasonYear: number): number | null {
  return p.year == null ? null : seasonYear - p.year;
}

/** Past its typical storage life for this season (worth a germination test before relying on it). */
export function isSeedOld(p: SeedPacket, seasonYear: number): boolean {
  const age = seedAge(p, seasonYear);
  return age != null && age > (SEED_LIFE_YEARS[p.plantId] ?? 3);
}

/** Expected germination for a packet in a season, allowing for age. */
export function expectedGermination(plantId: string, packet: SeedPacket | undefined, seasonYear: number): number {
  const g = GERMINATION[plantId] ?? 0.75;
  if (!packet) return g;
  const age = seedAge(packet, seasonYear);
  if (age == null) return g;
  const life = SEED_LIFE_YEARS[plantId] ?? 3;
  if (age > life) return g * 0.5;
  if (age === life) return g * 0.85;
  return g;
}

/** Usable packets for a crop, freshest first. */
export function packetsFor(garden: Garden, plantId: string): SeedPacket[] {
  return (garden.seeds ?? [])
    .filter((p) => p.plantId === plantId && p.amount !== 'empty')
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

/**
 * What the season's plan still needs: everything planned but not yet in the ground, grouped by crop
 * and how it starts. Sorted by the date you need it.
 */
export function seedNeeds(garden: Garden, seasonYear: number): SeedNeed[] {
  const site = garden.site;
  const groups = new Map<string, SeedNeed>();
  for (const bed of garden.beds)
    for (const pl of bed.plantings) {
      const plant = PLANT_BY_ID[pl.plantId];
      if (!plant || pl.season !== seasonYear || pl.plantedOn || pl.removedOn) continue;
      const start = plantingStart(pl, site);
      let how: SeedNeed['how'];
      let by = start;
      if (PROPAGULE[plant.id]) how = plant.id === 'potato' || plant.id === 'garlic' ? 'plant-sets' : 'buy-plants';
      else if (pl.method === 'transplant' && plant.startIndoorsWeeks != null) {
        how = 'start-indoors';
        by = addDays(start, -Math.round((plant.startIndoorsWeeks + (plant.transplantWeeks ?? 0)) * 7));
      } else if (pl.method === 'transplant') how = 'buy-plants';
      else how = 'direct-sow';
      const key = `${plant.id}|${how}`;
      const n = plantCount(pl, plant);
      const g = groups.get(key);
      if (g) {
        g.plants += n;
        g.plantings++;
        if (isoDate(by) < g.by) g.by = isoDate(by);
      } else {
        groups.set(key, { plantId: plant.id, how, plants: n, plantings: 1, by: isoDate(by), packets: [], status: 'need' });
      }
    }

  const out = [...groups.values()];
  for (const need of out) {
    if (need.how === 'plant-sets' || need.how === 'buy-plants') {
      need.status = 'buy';
      need.note = PROPAGULE[need.plantId] ? `Plant ${PROPAGULE[need.plantId]}` : 'Buy transplants (no indoor start planned)';
      continue;
    }
    need.packets = packetsFor(garden, need.plantId);
    const best = need.packets[0];
    const germ = expectedGermination(need.plantId, best, seasonYear);
    need.seeds = Math.ceil((need.plants / germ) * SAFETY);
    if (need.how === 'start-indoors') need.cells = Math.ceil(need.plants * SAFETY);
    if (!best) need.status = 'need';
    else if (isSeedOld(best, seasonYear)) {
      need.status = 'old';
      need.note = `Packet from ${best.year} is past the usual ${SEED_LIFE_YEARS[need.plantId] ?? 3}-year life — test 10 seeds on a damp paper towel, or buy fresh`;
    } else need.status = 'have';
  }
  return out.sort((a, b) => a.by.localeCompare(b.by) || (PLANT_BY_ID[a.plantId]?.name ?? '').localeCompare(PLANT_BY_ID[b.plantId]?.name ?? ''));
}

export const HOW_LABEL: Record<SeedNeed['how'], string> = {
  'start-indoors': 'Start indoors',
  'direct-sow': 'Sow in bed',
  'buy-plants': 'Buy plants',
  'plant-sets': 'Plant sets',
};

/** Plain-text shopping list (for copying into a note or seed order). */
export function shoppingListText(needs: SeedNeed[], seasonYear: number): string {
  const lines = [`Jardin — seeds & plants for ${seasonYear}`];
  const toBuy = needs.filter((n) => n.status !== 'have');
  for (const n of toBuy) {
    const p = PLANT_BY_ID[n.plantId];
    const qty = n.how === 'start-indoors' || n.how === 'direct-sow' ? `${n.seeds} seeds` : `${n.plants} ${n.how === 'plant-sets' ? 'sets' : 'plants'}`;
    lines.push(`- ${p?.name ?? n.plantId}: ${qty} (${HOW_LABEL[n.how].toLowerCase()} by ${n.by})${n.status === 'old' ? ' — replace old packet' : ''}`);
  }
  if (!toBuy.length) lines.push('Everything in the plan is covered by your seed box.');
  return lines.join('\n');
}
