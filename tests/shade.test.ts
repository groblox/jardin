import { describe, it, expect } from 'vitest';
import { computeSunMap, pointDay, horizonProfile, leafOn } from '../src/core/shade.ts';
import { findBestPlacements, sampleMap } from '../src/core/placement.ts';
import type { Site } from '../src/core/types.ts';

const base: Site = {
  name: 't', lat: 40, lon: -75, widthFt: 60, depthFt: 60, northDeg: 0, lastFrost: '04-15', firstFrost: '10-20', obstacles: [],
};
const june = new Date(2024, 5, 21, 12);

describe('shading', () => {
  it('open ground gets all daylight hours', () => {
    const d = pointDay(base, 30, 30, 0, june);
    expect(d.sunHours).toBeGreaterThan(14.5);
    expect(d.dli).toBeGreaterThan(45);
  });

  it('a tall wall to the south shades the ground north of it', () => {
    const site: Site = { ...base, obstacles: [{ id: 'w', kind: 'building', name: 'wall', heightFt: 20, points: [[0, 40], [60, 40], [60, 45], [0, 45]] }] };
    const north = pointDay(site, 30, 35, 0, new Date(2024, 11, 21, 12)); // just north (y smaller) of wall, winter
    const south = pointDay(site, 30, 55, 0, new Date(2024, 11, 21, 12));
    expect(north.sunHours).toBeLessThan(0.5);
    expect(south.sunHours).toBeGreaterThan(8);
  });

  it('rotating the map moves the shadow', () => {
    // North points down the map: the wall now shades the cells *below* it.
    const site: Site = { ...base, northDeg: 180, obstacles: [{ id: 'w', kind: 'building', name: 'wall', heightFt: 20, points: [[0, 20], [60, 20], [60, 25], [0, 25]] }] };
    const below = pointDay(site, 30, 30, 0, new Date(2024, 11, 21, 12));
    expect(below.sunHours).toBeLessThan(0.5);
  });

  it('deciduous trees let more light through in winter', () => {
    const site: Site = { ...base, obstacles: [{ id: 't', kind: 'tree', name: 'oak', x: 30, y: 45, canopyRadiusFt: 10, heightFt: 40, trunkHeightFt: 8, deciduous: true }] };
    expect(leafOn(site, june)).toBe(true);
    expect(leafOn(site, new Date(2024, 0, 15))).toBe(false);
    const hz = horizonProfile(site, 30, 30, 0, june);
    const south = hz.find((h) => h.az === 180)!;
    expect(south.horizon).toBeGreaterThan(30);
    expect(hz.find((h) => h.az === 0)!.horizon).toBe(0);
  });

  it('placement prefers sunny ground away from the house', () => {
    const site: Site = { ...base, obstacles: [{ id: 'h', kind: 'building', name: 'house', heightFt: 25, points: [[0, 30], [60, 30], [60, 40], [0, 40]] }] };
    const map = computeSunMap(site, [june, new Date(2024, 8, 21, 12)], { cellFt: 2, stepMin: 20 });
    const best = findBestPlacements(map, { widthFt: 4, lengthFt: 8, count: 3 });
    expect(best.length).toBe(3);
    for (const b of best) expect(b.y + b.lengthFt <= 20 || b.y >= 40).toBe(true); // not in the house's shadow zone
    expect(sampleMap(map, 'sunHours', 30, 28)).toBeLessThan(best[0].meanSun);
  });
});
