// Planting calendar from frost dates, maintenance task list, and "what can I plant now".
import type { Garden, Site } from './types.ts';
import { PLANTS, PLANT_BY_ID, type PlantType } from './plants.ts';
import { addDays, isoDate, monthDay, parseIso } from './util.ts';

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

export type TaskKind = 'start-indoors' | 'harden-off' | 'transplant' | 'direct-sow' | 'succession' | 'harvest' | 'fall-sow';

export interface Task {
  date: string;
  endDate?: string;
  kind: TaskKind;
  title: string;
  bedId?: string;
  plantingId?: string;
  plantId: string;
}

export function gardenTasks(garden: Garden, year: number): Task[] {
  const season = seasonFor(garden.site, year);
  const tasks: Task[] = [];
  for (const bed of garden.beds) {
    const seenPlant = new Set<string>();
    for (const pl of bed.plantings) {
      const plant = PLANT_BY_ID[pl.plantId];
      if (!plant) continue;
      const base = { bedId: bed.id, plantingId: pl.id, plantId: plant.id };
      const where = ` in ${bed.name}`;
      if (pl.plantedOn) {
        const planted = parseIso(pl.plantedOn);
        const offset = pl.method === 'transplant' ? 0.88 : 1;
        const h0 = addDays(planted, Math.round(plant.daysToMaturity * offset));
        tasks.push({ ...base, kind: 'harvest', date: isoDate(h0), endDate: isoDate(addDays(h0, plant.harvestDays)), title: `Harvest ${plant.name}${where}` });
        if (plant.successionDays && !seenPlant.has(plant.id)) {
          tasks.push({ ...base, kind: 'succession', date: isoDate(addDays(planted, plant.successionDays)), title: `Succession-sow ${plant.name}${where}` });
        }
        seenPlant.add(plant.id);
        continue;
      }
      if (seenPlant.has(plant.id)) continue; // one set of tasks per crop per bed
      seenPlant.add(plant.id);
      const t = plantTimeline(plant, season);
      if (pl.method === 'transplant' && t.transplant) {
        if (t.startIndoors) tasks.push({ ...base, kind: 'start-indoors', date: isoDate(t.startIndoors), title: `Start ${plant.name} seeds indoors` });
        if (t.hardenOff) tasks.push({ ...base, kind: 'harden-off', date: isoDate(t.hardenOff), title: `Harden off ${plant.name} seedlings` });
        tasks.push({ ...base, kind: 'transplant', date: isoDate(t.transplant), title: `Transplant ${plant.name}${where}` });
      } else if (t.directSow) {
        tasks.push({ ...base, kind: 'direct-sow', date: isoDate(t.directSow[0]), endDate: isoDate(t.directSow[1]), title: `Sow ${plant.name}${where}` });
      } else if (t.fallSow) {
        tasks.push({ ...base, kind: 'fall-sow', date: isoDate(t.fallSow), title: `Plant ${plant.name}${where} (fall)` });
      } else if (t.transplant) {
        tasks.push({ ...base, kind: 'transplant', date: isoDate(t.transplant), title: `Plant ${plant.name}${where}` });
      }
      tasks.push({ ...base, kind: 'harvest', date: isoDate(t.harvest[0]), endDate: isoDate(t.harvest[1]), title: `Harvest ${plant.name}${where}` });
    }
  }
  return tasks.sort((a, b) => a.date.localeCompare(b.date));
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
