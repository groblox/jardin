// Garden task list for a season, derived from each planting's interval:
// seed starting, hardening off, bed prep between successions, sowing/transplanting,
// side-dressing heavy feeders, and harvest windows.
import type { Garden } from './types.ts';
import { PLANT_BY_ID } from './plants.ts';
import { seasonFor } from './schedule.ts';
import { cellsOf, plantingInterval } from './succession.ts';
import { addDays, isoDate } from './util.ts';

export type TaskKind = 'start-indoors' | 'harden-off' | 'prep' | 'transplant' | 'direct-sow' | 'side-dress' | 'harvest' | 'perennial-care';

export interface Task {
  date: string;
  endDate?: string;
  kind: TaskKind;
  title: string;
  detail?: string;
  bedId?: string;
  plantingIds: string[];
  plantId: string;
  /** Already done (planted / removed). */
  done?: boolean;
}

export const TASK_LABEL: Record<TaskKind, string> = {
  'start-indoors': 'Start indoors', 'harden-off': 'Harden off', prep: 'Prep squares', transplant: 'Transplant',
  'direct-sow': 'Sow', 'side-dress': 'Feed', harvest: 'Harvest', 'perennial-care': 'Care',
};

export function gardenTasks(garden: Garden, year: number): Task[] {
  const site = garden.site;
  const season = seasonFor(site, year);
  const from = addDays(season.lastFrost, -150);
  const to = addDays(season.firstFrost, 120);
  const tasks: Task[] = [];
  const key = new Map<string, Task>();
  const add = (t: Task) => {
    // Merge identical tasks for several squares of the same crop on the same date.
    const k = `${t.kind}|${t.bedId}|${t.plantId}|${t.date}`;
    const prev = key.get(k);
    if (prev) {
      prev.plantingIds.push(...t.plantingIds);
      prev.done = prev.done && t.done;
      return;
    }
    const own = { ...t, plantingIds: [...t.plantingIds] };
    key.set(k, own);
    tasks.push(own);
  };

  for (const bed of garden.beds) {
    for (const pl of bed.plantings) {
      const plant = PLANT_BY_ID[pl.plantId];
      if (!plant) continue;
      const iv = plantingInterval(pl, site);
      if (iv.end < from || iv.start > to) continue;
      const base = { bedId: bed.id, plantingIds: [pl.id], plantId: plant.id };
      const where = ` in ${bed.name}`;
      const planted = !!pl.plantedOn;
      const start = iv.start;

      if (plant.perennial && pl.season < year) {
        add({ ...base, kind: 'perennial-care', date: isoDate(addDays(season.lastFrost, -21)), title: `Spring care for ${plant.name}${where}`, detail: 'Cut back dead growth, top-dress with compost, divide if crowded.' });
        continue;
      }
      if (pl.season !== year && !(planted && !pl.removedOn && iv.end >= season.lastFrost)) continue;

      if (pl.method === 'transplant' && plant.startIndoorsWeeks != null) {
        const indoorWeeks = plant.startIndoorsWeeks + (plant.transplantWeeks ?? 0);
        add({ ...base, kind: 'start-indoors', date: isoDate(addDays(start, -Math.round(indoorWeeks * 7))), title: `Start ${plant.name} seeds indoors`, done: planted });
        add({ ...base, kind: 'harden-off', date: isoDate(addDays(start, -7)), title: `Harden off ${plant.name} seedlings`, detail: 'A few hours outside, increasing daily over a week.', done: planted });
      }

      // A previous crop in the same squares that ends just before this one → prep task.
      const prev = bed.plantings
        .filter((o) => o.id !== pl.id && PLANT_BY_ID[o.plantId] && cellsOf(o).some(([c, r]) => cellsOf(pl).some(([c2, r2]) => c === c2 && r === r2)))
        .map((o) => ({ o, iv: plantingInterval(o, site) }))
        .filter((x) => x.iv.end <= addDays(start, 1) && x.iv.end >= addDays(start, -45))
        .sort((a, b) => b.iv.end.getTime() - a.iv.end.getTime())[0];
      if (prev) {
        const pp = PLANT_BY_ID[prev.o.plantId];
        add({ ...base, kind: 'prep', date: isoDate(addDays(start, -3)), title: `Clear ${pp.name} and refresh squares for ${plant.name}${where}`, detail: 'Pull spent plants (compost healthy ones), add a trowel of compost per square, water in.', done: planted });
      }

      add({ ...base, kind: pl.method === 'transplant' ? 'transplant' : 'direct-sow', date: isoDate(start), title: `${pl.method === 'transplant' ? 'Transplant' : 'Sow'} ${plant.name}${where}`, done: planted });

      if (plant.feeder === 'heavy' && !plant.perennial) {
        const dtm = plant.daysToMaturity * (pl.method === 'transplant' ? 0.88 : 1);
        for (const f of [0.4, 0.75]) {
          add({ ...base, kind: 'side-dress', date: isoDate(addDays(start, Math.round(dtm * f))), title: `Side-dress ${plant.name}${where}`, detail: 'Scratch in ½" of compost or a balanced organic fertilizer around the plants, then water.', done: !!pl.removedOn });
        }
      }

      if (!plant.perennial || pl.season === year) {
        const h0 = addDays(start, Math.round(plant.daysToMaturity * (pl.method === 'transplant' ? 0.88 : 1)));
        add({ ...base, kind: 'harvest', date: isoDate(h0), endDate: isoDate(addDays(h0, plant.harvestDays)), title: `Harvest ${plant.name}${where}`, done: !!pl.removedOn });
      }
    }
  }
  return tasks.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
