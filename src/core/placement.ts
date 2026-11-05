// Find the sunniest spots on the property for a new bed of a given size.
import type { Bed } from './types.ts';
import type { SunMap } from './shade.ts';

export interface PlacementCandidate {
  x: number;
  y: number;
  widthFt: number;
  lengthFt: number;
  meanSun: number;
  minSun: number;
  /** Fraction of the bed getting at least `targetHours`. */
  fractionMeeting: number;
  meanDli: number;
  score: number;
}

export interface PlacementOptions {
  widthFt: number;
  lengthFt: number;
  /** Also try the bed rotated 90°. */
  allowRotate?: boolean;
  /** Clearance kept around existing beds (paths). */
  clearanceFt?: number;
  targetHours?: number;
  count?: number;
  existingBeds?: Bed[];
}

function sat(values: ArrayLike<number>, cols: number, rows: number): Float64Array {
  const s = new Float64Array((cols + 1) * (rows + 1));
  for (let r = 0; r < rows; r++) {
    let rowSum = 0;
    for (let c = 0; c < cols; c++) {
      rowSum += values[r * cols + c];
      s[(r + 1) * (cols + 1) + c + 1] = s[r * (cols + 1) + c + 1] + rowSum;
    }
  }
  return s;
}

const rect = (s: Float64Array, cols: number, c0: number, r0: number, w: number, h: number) => {
  const W = cols + 1;
  return s[(r0 + h) * W + c0 + w] - s[r0 * W + c0 + w] - s[(r0 + h) * W + c0] + s[r0 * W + c0];
};

export function findBestPlacements(map: SunMap, o: PlacementOptions): PlacementCandidate[] {
  const { cols, rows, cellFt } = map;
  const target = o.targetHours ?? 6;
  const clear = o.clearanceFt ?? 2;
  const n = cols * rows;
  const bad = new Float32Array(n);
  for (let i = 0; i < n; i++) bad[i] = map.blocked[i];
  for (const b of o.existingBeds ?? []) {
    const c0 = Math.max(0, Math.floor((b.x - clear) / cellFt));
    const r0 = Math.max(0, Math.floor((b.y - clear) / cellFt));
    const c1 = Math.min(cols, Math.ceil((b.x + b.widthFt + clear) / cellFt));
    const r1 = Math.min(rows, Math.ceil((b.y + b.lengthFt + clear) / cellFt));
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) bad[r * cols + c] = 1;
  }
  const meet = new Float32Array(n);
  for (let i = 0; i < n; i++) meet[i] = map.sunHours[i] >= target ? 1 : 0;
  const sSun = sat(map.sunHours, cols, rows);
  const sDli = sat(map.dli, cols, rows);
  const sBad = sat(bad, cols, rows);
  const sMeet = sat(meet, cols, rows);

  const shapes: [number, number][] = [[o.widthFt, o.lengthFt]];
  if (o.allowRotate !== false && o.widthFt !== o.lengthFt) shapes.push([o.lengthFt, o.widthFt]);

  const all: PlacementCandidate[] = [];
  for (const [wFt, lFt] of shapes) {
    const w = Math.max(1, Math.round(wFt / cellFt));
    const h = Math.max(1, Math.round(lFt / cellFt));
    if (w > cols || h > rows) continue;
    const area = w * h;
    for (let r = 0; r + h <= rows; r++) {
      for (let c = 0; c + w <= cols; c++) {
        if (rect(sBad, cols, c, r, w, h) > 0) continue;
        const meanSun = rect(sSun, cols, c, r, w, h) / area;
        const frac = rect(sMeet, cols, c, r, w, h) / area;
        all.push({
          x: c * cellFt,
          y: r * cellFt,
          widthFt: wFt,
          lengthFt: lFt,
          meanSun,
          minSun: 0,
          fractionMeeting: frac,
          meanDli: rect(sDli, cols, c, r, w, h) / area,
          score: meanSun + 2 * frac,
        });
      }
    }
  }
  all.sort((a, b) => b.score - a.score);

  // Greedy non-overlapping selection with clearance.
  const picked: PlacementCandidate[] = [];
  const overlaps = (a: PlacementCandidate, b: PlacementCandidate) =>
    a.x < b.x + b.widthFt + clear && b.x < a.x + a.widthFt + clear && a.y < b.y + b.lengthFt + clear && b.y < a.y + a.lengthFt + clear;
  for (const cand of all) {
    if (picked.length >= (o.count ?? 5)) break;
    if (picked.some((p) => overlaps(p, cand))) continue;
    picked.push(cand);
  }
  for (const p of picked) {
    let min = Infinity;
    const c0 = Math.round(p.x / cellFt);
    const r0 = Math.round(p.y / cellFt);
    const w = Math.max(1, Math.round(p.widthFt / cellFt));
    const h = Math.max(1, Math.round(p.lengthFt / cellFt));
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) min = Math.min(min, map.sunHours[r * cols + c]);
    p.minSun = min;
  }
  return picked;
}

/** Sample the sun map at a point (feet). */
export function sampleMap(map: SunMap, field: 'sunHours' | 'dli', x: number, y: number): number {
  const c = Math.min(map.cols - 1, Math.max(0, Math.floor(x / map.cellFt)));
  const r = Math.min(map.rows - 1, Math.max(0, Math.floor(y / map.cellFt)));
  return map[field][r * map.cols + c];
}
