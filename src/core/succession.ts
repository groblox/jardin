// Time-aware square-foot planning: each planting occupies its squares for an interval,
// so a square can carry spring lettuce → summer beans → fall spinach. Also crop rotation
// across seasons and "what can follow this crop" suggestions.
import type { Bed, BedPlanting, Site } from './types.ts';
import { PLANTS, PLANT_BY_ID, ROTATION_YEARS, type PlantType } from './plants.ts';
import { plantTimeline, seasonFor, type Season } from './schedule.ts';
import { addDays, isoDate, parseIso } from './util.ts';

export interface Interval {
  start: Date;
  end: Date;
  /** Start comes from the plan rather than an actual planting date. */
  planned: boolean;
}

const FAR = 3650;

/** Ideal start date for a crop in a season, by method. */
export function idealStart(plant: PlantType, method: BedPlanting['method'], season: Season): Date {
  const t = plantTimeline(plant, season);
  if (method === 'transplant') return t.transplant ?? t.directSow?.[0] ?? t.fallSow ?? season.lastFrost;
  return t.directSow?.[0] ?? t.transplant ?? t.fallSow ?? season.lastFrost;
}

/** Days from going into the bed until the square is free again. */
export function occupancyDays(plant: PlantType, method: BedPlanting['method']): number {
  if (plant.perennial) return FAR;
  const toHarvest = Math.round(plant.daysToMaturity * (method === 'transplant' ? 0.88 : 1));
  return toHarvest + plant.harvestDays + 7; // a week to clear and refresh the square
}

export function plantingStart(pl: BedPlanting, site: Site): Date {
  const plant = PLANT_BY_ID[pl.plantId];
  if (pl.plantedOn) return parseIso(pl.plantedOn);
  if (pl.plannedOn) return parseIso(pl.plannedOn);
  return idealStart(plant, pl.method, seasonFor(site, pl.season));
}

export function plantingInterval(pl: BedPlanting, site: Site): Interval {
  const plant = PLANT_BY_ID[pl.plantId];
  const start = plantingStart(pl, site);
  const end = pl.removedOn ? parseIso(pl.removedOn) : addDays(start, occupancyDays(plant, pl.method));
  return { start, end, planned: !pl.plantedOn };
}

export function cellsOf(pl: BedPlanting): [number, number][] {
  const span = PLANT_BY_ID[pl.plantId]?.span ?? 1;
  const out: [number, number][] = [];
  for (let r = 0; r < span; r++) for (let c = 0; c < span; c++) out.push([pl.col + c, pl.row + r]);
  return out;
}

const overlaps = (a: Interval, b: { start: Date; end: Date }) => a.start < b.end && b.start < a.end;
const sharesCell = (a: [number, number][], b: [number, number][]) => a.some(([c, r]) => b.some(([c2, r2]) => c === c2 && r === r2));

/** plantingId per cell at a given date (row-major, cols = widthFt). */
export function occupancyAt(bed: Bed, site: Site, date: Date): (string | null)[] {
  const w = Math.round(bed.widthFt);
  const h = Math.round(bed.lengthFt);
  const grid: (string | null)[] = new Array(w * h).fill(null);
  for (const pl of bed.plantings) {
    if (!PLANT_BY_ID[pl.plantId]) continue;
    const iv = plantingInterval(pl, site);
    if (date < iv.start || date >= iv.end) continue;
    for (const [c, r] of cellsOf(pl)) if (c < w && r < h) grid[r * w + c] = pl.id;
  }
  return grid;
}

/** Everything that has grown or will grow in one square, oldest first. */
export function squareHistory(bed: Bed, site: Site, col: number, row: number) {
  return bed.plantings
    .filter((pl) => PLANT_BY_ID[pl.plantId] && cellsOf(pl).some(([c, r]) => c === col && r === row))
    .map((pl) => ({ pl, plant: PLANT_BY_ID[pl.plantId], iv: plantingInterval(pl, site) }))
    .sort((a, b) => a.iv.start.getTime() - b.iv.start.getTime());
}

/** Date ranges in which the crop may go into the bed this season. */
export function plantingWindows(plant: PlantType, method: BedPlanting['method'], season: Season): [Date, Date][] {
  const t = plantTimeline(plant, season);
  const w: [Date, Date][] = [];
  if (method === 'transplant' && t.transplant) w.push([addDays(t.transplant, -7), addDays(t.transplant, 21)]);
  if (t.directSow) w.push([t.directSow[0], t.directSow[1]]);
  if (!w.length && t.transplant) w.push([addDays(t.transplant, -7), addDays(t.transplant, 21)]);
  if (t.fallSow) w.push([addDays(t.fallSow, -7), addDays(t.fallSow, 14)]);
  return w.sort((a, b) => a[0].getTime() - b[0].getTime());
}

/** Latest sensible maturity date for the crop's frost tolerance. */
function latestMaturity(plant: PlantType, season: Season): Date {
  const slack = plant.frost === 'tender' ? -7 : plant.frost === 'half-hardy' ? 21 : 60;
  return addDays(season.firstFrost, slack);
}

export type ScheduleResult = { ok: true; start: Date; window: number } | { ok: false; reason: string };

/**
 * Find the earliest date ≥ `earliest` in one of the crop's planting windows when all of its
 * squares are free for the whole time it needs them.
 */
export function scheduleSlot(
  bed: Bed,
  site: Site,
  plant: PlantType,
  method: BedPlanting['method'],
  col: number,
  row: number,
  seasonYear: number,
  opts: { earliest?: Date; ignoreId?: string } = {},
): ScheduleResult {
  const w = Math.round(bed.widthFt);
  const h = Math.round(bed.lengthFt);
  if (col < 0 || row < 0 || col + plant.span > w || row + plant.span > h) return { ok: false, reason: `${plant.name} needs ${plant.span}×${plant.span} squares here` };
  const season = seasonFor(site, seasonYear);
  const cells: [number, number][] = [];
  for (let r = 0; r < plant.span; r++) for (let c = 0; c < plant.span; c++) cells.push([col + c, row + r]);
  const busy = bed.plantings
    .filter((pl) => pl.id !== opts.ignoreId && PLANT_BY_ID[pl.plantId] && sharesCell(cellsOf(pl), cells))
    .map((pl) => ({ ...plantingInterval(pl, site), name: PLANT_BY_ID[pl.plantId].name }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const dur = occupancyDays(plant, method);
  const toHarvest = Math.round(plant.daysToMaturity * (method === 'transplant' ? 0.88 : 1));
  // Garlic and similar overwinter on purpose; skip the "mature before frost" rule for them.
  const frostBound = !plant.perennial && !(plant.frost === 'hardy' && plant.daysToMaturity > 150);
  const windows = plantingWindows(plant, method, season);
  if (!windows.length) return { ok: false, reason: `No planting window for ${plant.name} with your frost dates` };
  let lastConflict: string | null = null;
  for (const [wi, [ws, we]] of windows.entries()) {
    let cand = opts.earliest && opts.earliest > ws ? opts.earliest : ws;
    for (let guard = 0; guard < 50 && cand <= we; guard++) {
      const iv = { start: cand, end: addDays(cand, dur) };
      const clash = busy.find((b) => overlaps(iv as Interval, b));
      if (clash) {
        lastConflict = `${clash.name} until ${isoDate(clash.end)}`;
        cand = clash.end > cand ? clash.end : addDays(cand, 1);
        continue;
      }
      if (frostBound && addDays(cand, toHarvest) > latestMaturity(plant, season) && wi === windows.length - 1) {
        return { ok: false, reason: `${plant.name} wouldn't mature before frost if planted ${isoDate(cand)}` };
      }
      if (frostBound && addDays(cand, toHarvest) > latestMaturity(plant, season)) break;
      return { ok: true, start: cand, window: wi };
    }
  }
  return { ok: false, reason: lastConflict ? `Square busy (${lastConflict}) through ${plant.name}'s planting windows` : `Past ${plant.name}'s planting windows for ${seasonYear}` };
}

export interface RotationIssue {
  plantingId: string;
  level: 'warn' | 'info';
  message: string;
}

/** Same-family crops in the same squares within the family's rotation interval. */
export function rotationIssues(bed: Bed, site: Site, season?: number): RotationIssue[] {
  const out: RotationIssue[] = [];
  for (const pl of bed.plantings) {
    if (season != null && pl.season !== season) continue;
    const plant = PLANT_BY_ID[pl.plantId];
    if (!plant) continue;
    const years = ROTATION_YEARS[plant.family] ?? 0;
    if (!years || plant.perennial) continue;
    const myStart = plantingInterval(pl, site).start;
    const cells = cellsOf(pl);
    let worst: { pl: BedPlanting; plant: PlantType } | null = null;
    let sameSeason: PlantType | null = null;
    for (const other of bed.plantings) {
      if (other.id === pl.id) continue;
      const op = PLANT_BY_ID[other.plantId];
      if (!op || op.family !== plant.family || !sharesCell(cellsOf(other), cells)) continue;
      const oStart = plantingInterval(other, site).start;
      if (oStart >= myStart) continue;
      if (other.season === pl.season) sameSeason = op;
      else if (pl.season - other.season < years && (!worst || other.season > worst.pl.season)) worst = { pl: other, plant: op };
    }
    if (worst)
      out.push({ plantingId: pl.id, level: 'warn', message: `${plant.name}: ${plant.family} (${worst.plant.name}) grew here in ${worst.pl.season} — wait ${years} years between ${familyName(plant.family)} to break disease cycles` });
    else if (sameSeason)
      out.push({ plantingId: pl.id, level: 'info', message: `${plant.name} follows ${sameSeason.name} (same family) in the same squares this season — refresh with compost` });
  }
  return out;
}

export function familyName(f: string): string {
  return (
    {
      Solanaceae: 'nightshades', Brassicaceae: 'brassicas', Cucurbitaceae: 'cucurbits', Amaryllidaceae: 'alliums',
      Fabaceae: 'legumes', Apiaceae: 'carrot-family crops', Amaranthaceae: 'beet/spinach-family crops', Asteraceae: 'lettuce-family crops',
      Poaceae: 'grasses', Lamiaceae: 'mints', Rosaceae: 'rose-family crops',
    } as Record<string, string>
  )[f] ?? f;
}

export interface FollowOn {
  plant: PlantType;
  method: BedPlanting['method'];
  start: Date;
  score: number;
  why: string;
}

/** Crops that can go into a planting's squares after it finishes, best first. */
export function followOns(bed: Bed, site: Site, pl: BedPlanting, limit = 8): FollowOn[] {
  const prev = PLANT_BY_ID[pl.plantId];
  if (!prev || prev.perennial) return [];
  const iv = plantingInterval(pl, site);
  const out: FollowOn[] = [];
  for (const plant of PLANTS) {
    if (plant.perennial || plant.span > prev.span || plant.yieldLbPerSqFt === 0) continue;
    for (const method of ['direct', 'transplant'] as const) {
      if (method === 'transplant' && plant.transplantWeeks == null) continue;
      if (method === 'direct' && !plant.directSow && plant.fallSowWeeks == null) continue;
      const res = scheduleSlot(bed, site, plant, method, pl.col, pl.row, pl.season, { earliest: iv.end });
      if (!res.ok) continue;
      const gap = (res.start.getTime() - iv.end.getTime()) / 86400000;
      let score = 10 - gap / 7;
      const why: string[] = [];
      if (plant.family === prev.family) score -= 8;
      else why.push('different family');
      if (prev.feeder === 'heavy' && (plant.feeder === 'fixer' || plant.feeder === 'light')) {
        score += 3;
        why.push(plant.feeder === 'fixer' ? 'legume rebuilds nitrogen after a heavy feeder' : 'light feeder after a heavy feeder');
      }
      if (prev.feeder === 'fixer' && plant.feeder === 'heavy') {
        score += 3;
        why.push('uses nitrogen left by the legume');
      }
      if (gap > 21) why.push(`${Math.round(gap)} days gap`);
      out.push({ plant, method, start: res.start, score, why: why.join(' · ') || 'fits the gap' });
      break;
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export type SuccessionResult = { ok: true; col: number; row: number; start: Date } | { ok: false; reason: string };

/**
 * Plan the next succession sowing of a crop: the same crop `successionDays` after the latest
 * planting in its chain (same crop, bed and season, starting no earlier than `pl`), in the free
 * square nearest to `pl`. Repeated calls extend the chain.
 */
export function nextSuccession(bed: Bed, site: Site, pl: BedPlanting): SuccessionResult {
  const plant = PLANT_BY_ID[pl.plantId];
  if (!plant) return { ok: false, reason: 'Unknown crop' };
  if (plant.perennial) return { ok: false, reason: `${plant.name} is perennial — no successions needed` };
  const gap = plant.successionDays ?? 14;
  const first = plantingStart(pl, site);
  const lastStart = bed.plantings
    .filter((p) => p.plantId === pl.plantId && p.season === pl.season)
    .map((p) => plantingStart(p, site))
    .filter((d) => d >= first)
    .reduce((a, b) => (b > a ? b : a), first);
  const earliest = addDays(lastStart, gap);
  const w = Math.round(bed.widthFt);
  const h = Math.round(bed.lengthFt);
  const squares: [number, number][] = [];
  for (let r = 0; r + plant.span <= h; r++) for (let c = 0; c + plant.span <= w; c++) squares.push([c, r]);
  squares.sort((a, b) => Math.hypot(a[0] - pl.col, a[1] - pl.row) - Math.hypot(b[0] - pl.col, b[1] - pl.row) || a[1] - b[1] || a[0] - b[0]);
  let best: { col: number; row: number; start: Date } | null = null;
  let lastReason = `No square is free for another ${plant.name} sowing`;
  for (const [c, r] of squares) {
    const res = scheduleSlot(bed, site, plant, pl.method, c, r, pl.season, { earliest });
    if (!res.ok) {
      lastReason = res.reason;
      continue;
    }
    // Close to the intended date wins outright; otherwise remember the earliest fallback.
    if (res.start.getTime() - earliest.getTime() <= 7 * 86400000) return { ok: true, col: c, row: r, start: res.start };
    if (!best || res.start < best.start) best = { col: c, row: r, start: res.start };
  }
  return best ? { ok: true, ...best } : { ok: false, reason: lastReason };
}

/** Which season a calendar date belongs to (the season whose spring precedes it). */
export function seasonOfDate(site: Site, d: Date): number {
  const y = d.getFullYear();
  return d >= addDays(seasonFor(site, y).lastFrost, -150) ? y : y - 1;
}
