// Square-foot bed helpers: occupancy, placement checks and planting warnings.
import type { Bed, BedPlanting, Site } from './types.ts';
import { PLANT_BY_ID, type PlantType } from './plants.ts';
import { DEG } from './util.ts';

export function plantingCells(pl: BedPlanting, plant: PlantType): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < plant.span; r++) for (let c = 0; c < plant.span; c++) out.push([pl.col + c, pl.row + r]);
  return out;
}

/** plantingId per cell, row-major (cols = widthFt). */
export function occupancy(bed: Bed): (string | null)[] {
  const w = Math.round(bed.widthFt);
  const h = Math.round(bed.lengthFt);
  const grid: (string | null)[] = new Array(w * h).fill(null);
  for (const pl of bed.plantings) {
    const plant = PLANT_BY_ID[pl.plantId];
    if (!plant) continue;
    for (const [c, r] of plantingCells(pl, plant)) if (c < w && r < h) grid[r * w + c] = pl.id;
  }
  return grid;
}

export function canPlace(bed: Bed, plant: PlantType, col: number, row: number, ignoreId?: string): boolean {
  const w = Math.round(bed.widthFt);
  const h = Math.round(bed.lengthFt);
  if (col < 0 || row < 0 || col + plant.span > w || row + plant.span > h) return false;
  const occ = occupancy(bed);
  for (let r = row; r < row + plant.span; r++)
    for (let c = col; c < col + plant.span; c++) {
      const id = occ[r * w + c];
      if (id && id !== ignoreId) return false;
    }
  return true;
}

export function plantCount(pl: BedPlanting, plant: PlantType): number {
  return pl.count ?? (plant.span === 1 ? plant.perSquare : 1);
}

export interface Warning {
  plantingId?: string;
  level: 'info' | 'warn' | 'bad';
  message: string;
}

/** Unit vector (map coords) pointing toward the pole the sun never shines from (north in the northern hemisphere). */
export function shadowDirection(site: Site): [number, number] {
  const b = (site.northDeg + (site.lat >= 0 ? 0 : 180)) * DEG;
  return [Math.sin(b), -Math.cos(b)];
}

export function bedWarnings(bed: Bed, site: Site, sunAt?: (col: number, row: number) => number): Warning[] {
  const out: Warning[] = [];
  const w = Math.round(bed.widthFt);
  const occ = occupancy(bed);
  const byId = new Map(bed.plantings.map((p) => [p.id, p]));
  const [sx, sy] = shadowDirection(site);

  for (const pl of bed.plantings) {
    const plant = PLANT_BY_ID[pl.plantId];
    if (!plant) continue;
    const cells = plantingCells(pl, plant);

    // Companion conflicts with any neighbour (8-neighbourhood).
    const seen = new Set<string>();
    for (const [c, r] of cells)
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          const rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= w || rr >= Math.round(bed.lengthFt)) continue;
          const nid = occ[rr * w + cc];
          if (!nid || nid === pl.id || seen.has(nid)) continue;
          seen.add(nid);
          const other = PLANT_BY_ID[byId.get(nid)!.plantId];
          if (plant.avoid.includes(other.id) && pl.id < nid)
            out.push({ plantingId: pl.id, level: 'warn', message: `${plant.name} and ${other.name} are poor companions` });
        }

    // Sunlight.
    if (sunAt) {
      const sun = cells.reduce((s, [c, r]) => s + sunAt(c, r), 0) / cells.length;
      if (sun < plant.minSunHours)
        out.push({ plantingId: pl.id, level: 'bad', message: `${plant.name} needs ${plant.minSunHours}h+ sun; this square gets ~${sun.toFixed(1)}h` });
      else if (sun < plant.idealSunHours - 1)
        out.push({ plantingId: pl.id, level: 'info', message: `${plant.name} would prefer ${plant.idealSunHours}h; gets ~${sun.toFixed(1)}h` });
    }

    // Tall plants casting shade on sun-lovers behind them.
    if (plant.heightFt >= 4) {
      const shaded = new Set<string>();
      for (const other of bed.plantings) {
        if (other.id === pl.id) continue;
        const op = PLANT_BY_ID[other.plantId];
        if (!op || op.heightFt >= plant.heightFt * 0.6 || op.sun === 'shade') continue;
        const dx = other.col - pl.col;
        const dy = other.row - pl.row;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist > 3) continue;
        if ((dx * sx + dy * sy) / dist > 0.7) shaded.add(op.name);
      }
      if (shaded.size)
        out.push({ plantingId: pl.id, level: 'warn', message: `Tall ${plant.name} will shade ${[...shaded].join(', ')} — move it to the ${site.lat >= 0 ? 'north' : 'south'} edge` });
    }
  }
  return out;
}

export function bedSummary(bed: Bed) {
  const counts = new Map<string, number>();
  let used = 0;
  for (const pl of bed.plantings) {
    const plant = PLANT_BY_ID[pl.plantId];
    if (!plant) continue;
    counts.set(plant.id, (counts.get(plant.id) ?? 0) + plantCount(pl, plant));
    used += plant.span * plant.span;
  }
  const area = Math.round(bed.widthFt) * Math.round(bed.lengthFt);
  return { area, used, free: area - used, counts };
}
