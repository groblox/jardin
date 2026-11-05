// Shadow casting and sunlight accumulation over the property.
// Every obstacle is treated in 3D: buildings are vertical prisms, fences are thin walls,
// tree crowns are ellipsoids that let a fraction of light through (more when leafless).
import type { Obstacle, Site, Pt } from './types.ts';
import { sunPosition, clearSky, solarDayStart, PAR_PER_W } from './solar.ts';
import { DEG, addDays, monthDay, mod } from './util.ts';

export interface SunSample {
  t: number;
  az: number;
  el: number;
  /** Unit vector toward the sun in map coordinates (y down). */
  dx: number;
  dy: number;
  tanEl: number;
  cosEl: number;
  sinEl: number;
  dtH: number;
  dni: number;
  dhi: number;
}

export interface CompiledObstacle {
  o: Obstacle;
  /** Transmittance when the ray hits this obstacle (0 = opaque). */
  tau: number;
  /** Bounding box in feet, for quick rejection in point-inside tests. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EVERGREEN_TAU = 0.1;
const LEAF_ON_TAU = 0.2;
const LEAF_OFF_TAU = 0.65;

/** Whether deciduous trees carry leaves on `date` (frost-date based; handles southern hemisphere). */
export function leafOn(site: Site, date: Date): boolean {
  const y = date.getFullYear();
  for (const yy of [y - 1, y]) {
    const start = addDays(monthDay(yy, site.lastFrost), -14);
    let end = addDays(monthDay(yy, site.firstFrost), 21);
    if (end <= start) end = addDays(monthDay(yy + 1, site.firstFrost), 21);
    if (date >= start && date <= end) return true;
  }
  return false;
}

export function compileObstacles(site: Site, date: Date): CompiledObstacle[] {
  const leaves = leafOn(site, date);
  return site.obstacles.map((o) => {
    let tau = 0;
    let bb: [number, number, number, number];
    if (o.kind === 'building') {
      const xs = o.points.map((p) => p[0]);
      const ys = o.points.map((p) => p[1]);
      bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    } else if (o.kind === 'tree') {
      tau = o.deciduous ? (leaves ? LEAF_ON_TAU : LEAF_OFF_TAU) : EVERGREEN_TAU;
      bb = [o.x - o.canopyRadiusFt, o.y - o.canopyRadiusFt, o.x + o.canopyRadiusFt, o.y + o.canopyRadiusFt];
    } else {
      tau = o.transmittance;
      bb = [Math.min(o.x1, o.x2), Math.min(o.y1, o.y2), Math.max(o.x1, o.x2), Math.max(o.y1, o.y2)];
    }
    return { o, tau, minX: bb[0], minY: bb[1], maxX: bb[2], maxY: bb[3] };
  });
}

export function pointInPolygon(x: number, y: number, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance along ray (px,py)+t(dx,dy) to segment a-b, or -1. */
function raySegment(px: number, py: number, dx: number, dy: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax;
  const ey = by - ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return -1;
  const wx = ax - px;
  const wy = ay - py;
  const t = (wx * ey - wy * ex) / den;
  const u = (wx * dy - wy * dx) / den;
  return t > 1e-9 && u >= 0 && u <= 1 ? t : -1;
}

/** True if (x,y) sits on an obstacle footprint where nothing can be planted. */
export function isBlockedGround(x: number, y: number, obs: CompiledObstacle[]): boolean {
  for (const c of obs) {
    if (c.o.kind === 'building' && x >= c.minX && x <= c.maxX && y >= c.minY && y <= c.maxY && pointInPolygon(x, y, c.o.points)) return true;
    if (c.o.kind === 'tree' && Math.hypot(x - c.o.x, y - c.o.y) < Math.max(1, c.o.canopyRadiusFt * 0.15)) return true;
  }
  return false;
}

/** Fraction of the direct beam reaching (px,py) at height z0 (feet). */
export function transmission(px: number, py: number, z0: number, s: SunSample, obs: CompiledObstacle[]): number {
  if (s.el <= 0) return 0;
  let trans = 1;
  for (const c of obs) {
    const o = c.o;
    if (o.kind === 'building') {
      if (o.heightFt <= z0) continue;
      const pts = o.points;
      let dmin = Infinity;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const d = raySegment(px, py, s.dx, s.dy, pts[j][0], pts[j][1], pts[i][0], pts[i][1]);
        if (d > 0 && d < dmin) dmin = d;
      }
      if (dmin < Infinity) {
        // A ray that starts inside the footprint is "under the roof".
        if (px >= c.minX && px <= c.maxX && py >= c.minY && py <= c.maxY && pointInPolygon(px, py, pts)) return 0;
        if (z0 + dmin * s.tanEl < o.heightFt) return 0;
      }
    } else if (o.kind === 'fence') {
      if (o.heightFt <= z0) continue;
      const d = raySegment(px, py, s.dx, s.dy, o.x1, o.y1, o.x2, o.y2);
      if (d > 0 && z0 + d * s.tanEl < o.heightFt) {
        trans *= c.tau;
        if (trans === 0) return 0;
      }
    } else {
      const r = o.canopyRadiusFt;
      const a = Math.max(0.5, (o.heightFt - o.trunkHeightFt) / 2);
      const zc = o.trunkHeightFt + a;
      if (zc + a <= z0) continue;
      const ox = (px - o.x) / r;
      const oy = (py - o.y) / r;
      const oz = (z0 - zc) / a;
      const vx = (s.dx * s.cosEl) / r;
      const vy = (s.dy * s.cosEl) / r;
      const vz = s.sinEl / a;
      const A = vx * vx + vy * vy + vz * vz;
      const B = 2 * (ox * vx + oy * vy + oz * vz);
      const C = ox * ox + oy * oy + oz * oz - 1;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      const far = (-B + Math.sqrt(disc)) / (2 * A);
      if (far > 0) {
        trans *= c.tau;
        if (trans < 1e-4) return 0;
      }
    }
  }
  return trans;
}

export function sunSample(t: number, site: Site, dtH: number): SunSample {
  const p = sunPosition(new Date(t), site.lat, site.lon);
  const mb = (p.azimuth + site.northDeg) * DEG;
  const el = p.elevation;
  const cs = clearSky(el);
  return {
    t,
    az: p.azimuth,
    el,
    dx: Math.sin(mb),
    dy: -Math.cos(mb),
    tanEl: Math.tan(Math.max(el, 0.01) * DEG),
    cosEl: Math.cos(el * DEG),
    sinEl: Math.sin(Math.max(el, 0) * DEG),
    dtH,
    dni: cs.dni,
    dhi: cs.dhi,
  };
}

/** Daytime samples for a local calendar date. */
export function daySamples(site: Site, date: Date, stepMin = 10): SunSample[] {
  const start = solarDayStart(date.getFullYear(), date.getMonth(), date.getDate(), site.lon).getTime();
  const out: SunSample[] = [];
  const dt = stepMin * 60000;
  for (let t = start + dt / 2; t < start + 86400000; t += dt) {
    const s = sunSample(t, site, stepMin / 60);
    if (s.el > 0) out.push(s);
  }
  return out;
}

export interface SunMap {
  cols: number;
  rows: number;
  cellFt: number;
  /** Average hours of direct sun per day. */
  sunHours: Float32Array;
  /** Average clear-sky daily light integral, mol/m²/day. */
  dli: Float32Array;
  /** 1 where the ground is covered (building footprint, tree trunk). */
  blocked: Uint8Array;
  /** Hours the sun is above the horizon (averaged) — the unobstructed maximum. */
  maxSunHours: number;
  /** Clear-sky DLI on an unobstructed spot. */
  openDli: number;
  dates: string[];
}

export function chooseCellFt(site: Site, maxCells = 12000): number {
  const area = site.widthFt * site.depthFt;
  const raw = Math.sqrt(area / maxCells);
  for (const c of [0.5, 1, 2, 3, 4, 5, 10]) if (c >= raw) return c;
  return 10;
}

/** Accumulate sunlight over a set of calendar dates (averaged per day). */
export function computeSunMap(
  site: Site,
  dates: Date[],
  opts: { cellFt?: number; stepMin?: number; z0Ft?: number; onProgress?: (f: number) => void } = {},
): SunMap {
  const cellFt = opts.cellFt ?? chooseCellFt(site);
  const z0 = opts.z0Ft ?? 1;
  const cols = Math.max(1, Math.ceil(site.widthFt / cellFt));
  const rows = Math.max(1, Math.ceil(site.depthFt / cellFt));
  const n = cols * rows;
  const sunHours = new Float32Array(n);
  const energy = new Float32Array(n); // J/m² of PAR-equivalent global irradiance
  const blocked = new Uint8Array(n);
  let maxSun = 0;
  let openE = 0;

  const obs0 = compileObstacles(site, dates[0] ?? new Date());
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) blocked[r * cols + c] = isBlockedGround((c + 0.5) * cellFt, (r + 0.5) * cellFt, obs0) ? 1 : 0;

  dates.forEach((date, di) => {
    const obs = compileObstacles(site, date);
    const samples = daySamples(site, date, opts.stepMin ?? 10);
    const dayDirect = new Float32Array(n);
    let dayMax = 0;
    for (const s of samples) {
      dayMax += s.dtH;
      const sec = s.dtH * 3600;
      openE += (s.dni * s.sinEl + s.dhi) * sec;
      const beam = s.dni * s.sinEl * sec;
      for (let r = 0; r < rows; r++) {
        const y = (r + 0.5) * cellFt;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (blocked[i]) continue;
          const tr = transmission((c + 0.5) * cellFt, y, z0, s, obs);
          if (tr > 0) {
            sunHours[i] += s.dtH * tr;
            dayDirect[i] += s.dtH * tr;
            energy[i] += beam * tr;
          }
        }
      }
    }
    // Diffuse light: approximate sky-view loss using how obstructed the cell was today.
    let dayDiffuse = 0;
    for (const s of samples) dayDiffuse += s.dhi * s.dtH * 3600;
    for (let i = 0; i < n; i++) {
      if (blocked[i]) continue;
      const openFrac = dayMax > 0 ? dayDirect[i] / dayMax : 0;
      energy[i] += dayDiffuse * (0.55 + 0.45 * openFrac);
    }
    maxSun += dayMax;
    opts.onProgress?.((di + 1) / dates.length);
  });

  const k = 1 / Math.max(1, dates.length);
  const dli = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    sunHours[i] *= k;
    dli[i] = (energy[i] * k * PAR_PER_W) / 1e6;
  }
  return {
    cols,
    rows,
    cellFt,
    sunHours,
    dli,
    blocked,
    maxSunHours: maxSun * k,
    openDli: (openE * k * PAR_PER_W) / 1e6,
    dates: dates.map((d) => d.toISOString().slice(0, 10)),
  };
}

/** Transmission grid at one instant — used to draw live shadows. */
export function instantShade(site: Site, t: Date, cellFt: number, z0 = 1): { cols: number; rows: number; trans: Float32Array; sample: SunSample } {
  const cols = Math.max(1, Math.ceil(site.widthFt / cellFt));
  const rows = Math.max(1, Math.ceil(site.depthFt / cellFt));
  const obs = compileObstacles(site, t);
  const s = sunSample(t.getTime(), site, 0);
  const trans = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) trans[r * cols + c] = transmission((c + 0.5) * cellFt, (r + 0.5) * cellFt, z0, s, obs);
  return { cols, rows, trans, sample: s };
}

export interface PointDay {
  samples: { t: number; az: number; el: number; trans: number }[];
  sunHours: number;
  daylightH: number;
  dli: number;
}

export function pointDay(site: Site, x: number, y: number, z0: number, date: Date, stepMin = 10): PointDay {
  const obs = compileObstacles(site, date);
  const samples = daySamples(site, date, stepMin);
  let sun = 0;
  let e = 0;
  let diffuse = 0;
  const out = samples.map((s) => {
    const tr = transmission(x, y, z0, s, obs);
    sun += s.dtH * tr;
    e += s.dni * s.sinEl * tr * s.dtH * 3600;
    diffuse += s.dhi * s.dtH * 3600;
    return { t: s.t, az: s.az, el: s.el, trans: tr };
  });
  const daylight = samples.length * (stepMin / 60);
  e += diffuse * (0.55 + 0.45 * (daylight ? sun / daylight : 0));
  return { samples: out, sunHours: sun, daylightH: daylight, dli: (e * PAR_PER_W) / 1e6 };
}

/** Sun hours at a point on the 21st of each month. */
export function pointYear(site: Site, x: number, y: number, z0: number, year: number) {
  return Array.from({ length: 12 }, (_, m) => {
    const d = pointDay(site, x, y, z0, new Date(year, m, 21, 12), 15);
    return { month: m, sunHours: d.sunHours, daylightH: d.daylightH, dli: d.dli };
  });
}

/**
 * Obstruction "skyline" seen from a point: for each true azimuth, the highest
 * elevation angle at which something blocks the sun (like a Solar Pathfinder).
 */
export function horizonProfile(site: Site, x: number, y: number, z0: number, date: Date, azStep = 3) {
  const obs = compileObstacles(site, date);
  const out: { az: number; horizon: number; tau: number }[] = [];
  for (let az = 0; az < 360; az += azStep) {
    const mb = mod(az + site.northDeg, 360) * DEG;
    let horizon = 0;
    let tau = 1;
    for (let el = 0.5; el < 90; el += 1) {
      const s: SunSample = {
        t: 0, az, el, dx: Math.sin(mb), dy: -Math.cos(mb), tanEl: Math.tan(el * DEG),
        cosEl: Math.cos(el * DEG), sinEl: Math.sin(el * DEG), dtH: 0, dni: 0, dhi: 0,
      };
      const tr = transmission(x, y, z0, s, obs);
      if (tr < 0.99) {
        horizon = el + 0.5;
        tau = Math.min(tau, tr);
      }
    }
    out.push({ az, horizon, tau });
  }
  return out;
}

/** Evenly spaced dates through the frost-free season (wraps the new year in the southern hemisphere). */
export function growingSeasonDates(site: Site, year: number, count = 8): Date[] {
  const start = monthDay(year, site.lastFrost);
  let end = monthDay(year, site.firstFrost);
  if (end <= start) end = monthDay(year + 1, site.firstFrost);
  const span = end.getTime() - start.getTime();
  return Array.from({ length: count }, (_, i) => new Date(start.getTime() + (span * (i + 0.5)) / count));
}

export type SunPeriod = 'season' | 'summer-solstice' | 'equinox' | 'winter-solstice' | 'year' | 'date';

export function periodDates(site: Site, period: SunPeriod, year: number, date?: Date): Date[] {
  const south = site.lat < 0;
  switch (period) {
    case 'season':
      return growingSeasonDates(site, year, 8);
    case 'summer-solstice':
      return [new Date(year, south ? 11 : 5, 21, 12)];
    case 'winter-solstice':
      return [new Date(year, south ? 5 : 11, 21, 12)];
    case 'equinox':
      return [new Date(year, 2, 20, 12)];
    case 'year':
      return Array.from({ length: 12 }, (_, m) => new Date(year, m, 21, 12));
    case 'date':
      return [date ?? new Date()];
  }
}

export function sunCategory(hours: number): { label: string; color: string } {
  if (hours >= 8) return { label: 'Full sun (8h+)', color: '#f59e0b' };
  if (hours >= 6) return { label: 'Full sun (6–8h)', color: '#fbbf24' };
  if (hours >= 4) return { label: 'Part sun (4–6h)', color: '#a3c46c' };
  if (hours >= 2) return { label: 'Part shade (2–4h)', color: '#5b8f6b' };
  return { label: 'Shade (<2h)', color: '#3f5560' };
}
