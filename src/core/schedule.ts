// Planting calendar from frost dates, maintenance task list, and "what can I plant now".
import type { Site } from './types.ts';
import { PLANTS, type PlantType } from './plants.ts';
import { addDays, monthDay } from './util.ts';

export interface Season {
  year: number;
  lastFrost: Date;
  firstFrost: Date;
  frostFreeDays: number;
}

export function seasonFor(site: Site, year: number): Season {
  const lastFrost = monthDay(year, site.lastFrost);
  let firstFrost = monthDay(year, site.firstFrost);
  if (firstFrost <= lastFrost) firstFrost = monthDay(year + 1, site.firstFrost);
  return { year, lastFrost, firstFrost, frostFreeDays: Math.round((firstFrost.getTime() - lastFrost.getTime()) / 86400000) };
}

/** The season being planned: once this year's season is well over, plan next year. */
export function planningYear(site: Site, today: Date): number {
  const y = today.getFullYear();
  // Once the season's first frost has passed, the useful thing to plan is next season.
  if (today <= seasonFor(site, y - 1).firstFrost) return y - 1;
  return today > seasonFor(site, y).firstFrost ? y + 1 : y;
}

export interface Timeline {
  plant: PlantType;
  startIndoors?: Date;
  hardenOff?: Date;
  transplant?: Date;
  directSow?: [Date, Date];
  fallSow?: Date;
  harvest: [Date, Date];
}

const wk = (d: Date, weeks: number) => addDays(d, Math.round(weeks * 7));

export function plantTimeline(plant: PlantType, season: Season): Timeline {
  const t: Timeline = { plant, harvest: [season.lastFrost, season.lastFrost] };
  if (plant.startIndoorsWeeks != null) t.startIndoors = wk(season.lastFrost, -plant.startIndoorsWeeks);
  if (plant.transplantWeeks != null) {
    t.transplant = wk(season.lastFrost, plant.transplantWeeks);
    if (t.startIndoors) t.hardenOff = addDays(t.transplant, -7);
  }
  if (plant.directSow) t.directSow = [wk(season.lastFrost, plant.directSow[0]), wk(season.lastFrost, plant.directSow[1])];
  if (plant.fallSowWeeks != null) t.fallSow = wk(season.firstFrost, -plant.fallSowWeeks);
  const sow = t.transplant ?? t.directSow?.[0] ?? t.fallSow ?? season.lastFrost;
  const offset = t.transplant ? 0.88 : 1;
  const start = addDays(sow, Math.round(plant.daysToMaturity * offset));
  t.harvest = [start, addDays(start, plant.harvestDays)];
  return t;
}

export interface PlantNow {
  plant: PlantType;
  action: 'start-indoors' | 'transplant' | 'direct-sow' | 'fall-sow';
  until: Date;
}

/** Crops whose sowing/transplant window includes `today`. */
export function plantNow(site: Site, today: Date): PlantNow[] {
  const out: PlantNow[] = [];
  for (const year of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
    const season = seasonFor(site, year);
    for (const plant of PLANTS) {
      const t = plantTimeline(plant, season);
      const within = (a: Date, b: Date) => today >= a && today <= b;
      if (t.startIndoors && within(t.startIndoors, addDays(t.startIndoors, 14))) out.push({ plant, action: 'start-indoors', until: addDays(t.startIndoors, 14) });
      if (t.transplant && within(addDays(t.transplant, -7), addDays(t.transplant, 21))) out.push({ plant, action: 'transplant', until: addDays(t.transplant, 21) });
      if (t.directSow && within(t.directSow[0], t.directSow[1])) out.push({ plant, action: 'direct-sow', until: t.directSow[1] });
      if (t.fallSow && within(addDays(t.fallSow, -7), addDays(t.fallSow, 14))) out.push({ plant, action: 'fall-sow', until: addDays(t.fallSow, 14) });
    }
  }
  const seen = new Set<string>();
  return out.filter((x) => {
    const k = x.plant.id + x.action;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
