// Square-foot bed helpers: placement checks and planting warnings (time-aware).
import type { Bed, BedPlanting, Site } from './types.ts';
import { PLANT_BY_ID, type PlantType } from './plants.ts';
import { DEG } from './util.ts';
import { cellsOf, occupancyAt, plantingInterval, rotationIssues } from './succession.ts';

export function plantingCells(pl: BedPlanting, _plant?: PlantType): [number, number][] {
  return cellsOf(pl);
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

const activeTogether = (a: BedPlanting, b: BedPlanting, site: Site) => {
  const x = plantingInterval(a, site);
  const y = plantingInterval(b, site);
  return x.start < y.end && y.start < x.end;
};

/** Plantings whose squares no longer fit inside the bed (e.g. after the bed was made smaller). */
export function plantingsOutside(bed: Bed): BedPlanting[] {
  const w = Math.round(bed.widthFt);
  const h = Math.round(bed.lengthFt);
  return bed.plantings.filter((pl) => PLANT_BY_ID[pl.plantId] && cellsOf(pl).some(([c, r]) => c < 0 || r < 0 || c >= w || r >= h));
}

/**
 * Checks for a season's plantings: companions that grow side by side at the same time,
 * squares too shady for the crop, tall crops shading sun-lovers, and crop rotation.
 */
export function bedWarnings(bed: Bed, site: Site, sunAt?: (col: number, row: number) => number, season?: number): Warning[] {
  const out: Warning[] = [];
  const list = bed.plantings.filter((p) => PLANT_BY_ID[p.plantId] && (season == null || p.season === season));
  const [sx, sy] = shadowDirection(site);
  const outside = plantingsOutside(bed).filter((p) => season == null || p.season === season);
  if (outside.length) {
    const names = [...new Set(outside.map((p) => PLANT_BY_ID[p.plantId].name))].join(', ');
    out.push({ level: 'bad', message: `${outside.length} planting${outside.length > 1 ? 's' : ''} (${names}) fall outside the ${Math.round(bed.widthFt)}×${Math.round(bed.lengthFt)} ft bed — enlarge it again or remove them` });
  }

  for (const pl of list) {
    const plant = PLANT_BY_ID[pl.plantId];
    const cells = cellsOf(pl);

    for (const other of list) {
      if (other.id <= pl.id) continue;
      const op = PLANT_BY_ID[other.plantId];
      if (!plant.avoid.includes(op.id) && !op.avoid.includes(plant.id)) continue;
      const adjacent = cells.some(([c, r]) => cellsOf(other).some(([c2, r2]) => Math.abs(c - c2) <= 1 && Math.abs(r - r2) <= 1));
      if (adjacent && activeTogether(pl, other, site))
        out.push({ plantingId: pl.id, level: 'warn', message: `${plant.name} and ${op.name} are poor companions side by side` });
    }

    if (sunAt) {
      const sun = cells.reduce((s, [c, r]) => s + sunAt(c, r), 0) / cells.length;
      if (sun < plant.minSunHours)
        out.push({ plantingId: pl.id, level: 'bad', message: `${plant.name} needs ${plant.minSunHours}h+ sun; this square gets ~${sun.toFixed(1)}h` });
      else if (sun < plant.idealSunHours - 1)
        out.push({ plantingId: pl.id, level: 'info', message: `${plant.name} would prefer ${plant.idealSunHours}h; gets ~${sun.toFixed(1)}h` });
    }

    if (plant.heightFt >= 4) {
      const shaded = new Set<string>();
      for (const other of list) {
        if (other.id === pl.id) continue;
        const op = PLANT_BY_ID[other.plantId];
        if (op.heightFt >= plant.heightFt * 0.6 || op.sun === 'shade' || !activeTogether(pl, other, site)) continue;
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
  for (const r of rotationIssues(bed, site, season)) out.push({ plantingId: r.plantingId, level: r.level, message: r.message });
  return out;
}

export function bedSummary(bed: Bed, site: Site, season: number, date: Date) {
  const counts = new Map<string, number>();
  for (const pl of bed.plantings) {
    const plant = PLANT_BY_ID[pl.plantId];
    if (!plant || pl.season !== season) continue;
    counts.set(plant.id, (counts.get(plant.id) ?? 0) + plantCount(pl, plant));
  }
  const occ = occupancyAt(bed, site, date);
  const used = occ.filter(Boolean).length;
  const area = Math.round(bed.widthFt) * Math.round(bed.lengthFt);
  let expectedLb = 0;
  for (const pl of bed.plantings) {
    const plant = PLANT_BY_ID[pl.plantId];
    if (plant && pl.season === season) expectedLb += plant.yieldLbPerSqFt * plant.span * plant.span;
  }
  return { area, used, free: area - used, counts, expectedLb };
}
