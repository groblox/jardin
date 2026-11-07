import type { Bed, BedIrrigation, Garden, NotifySettings } from './types.ts';
import { uid, parseIso, isoDate } from './util.ts';
import { planningYear } from './schedule.ts';
import { plantingInterval, scheduleSlot, seasonOfDate } from './succession.ts';
import { getPlant } from './plants.ts';

export const defaultIrrigation = (): BedIrrigation => ({
  sensorDry: 15,
  sensorWet: 55,
  flowGpm: 0.5,
  efficiency: 0.9,
  mode: 'suggest',
  windowStartHour: 5,
  windowEndHour: 9,
  maxMinutes: 30,
  rainSkipIn: 0.15,
});

export function newBed(partial: Partial<Bed> = {}): Bed {
  return {
    id: uid('bed'),
    name: 'New bed',
    x: 10,
    y: 10,
    widthFt: 4,
    lengthFt: 4,
    heightFt: 1,
    soilDepthIn: 12,
    soil: 'raised-mix',
    mulched: true,
    plantings: [],
    irrigation: defaultIrrigation(),
    ...partial,
  };
}

export const defaultNotify = (): NotifySettings => ({ dailyDigest: true, digestHour: 7, frostAlerts: true, publishSensors: true });

/** Bring older saved gardens up to the current shape. */
export function migrateGarden(g: Garden, today = new Date()): Garden {
  const plan = planningYear(g.site, today);
  return {
    ...g,
    journal: Array.isArray(g.journal) ? g.journal : [],
    seeds: Array.isArray(g.seeds) ? g.seeds : [],
    notify: { ...defaultNotify(), ...(g.notify ?? {}) },
    beds: g.beds.map((b) => ({
      ...b,
      soilTests: b.soilTests ?? [],
      plantings: b.plantings.map((pl) =>
        typeof pl.season === 'number' ? pl : { ...pl, season: pl.plantedOn ? seasonOfDate(g.site, parseIso(pl.plantedOn)) : plan },
      ),
    })),
  };
}

/** A sample suburban lot so the app is explorable before you draw your own. */
export function sampleGarden(today = new Date()): Garden {
  const g = sampleGardenRaw();
  const season = planningYear(g.site, today);
  // Plantings for the season being planned, plus last season's crops as rotation history.
  g.beds[0].plantings = g.beds[0].plantings.map((pl) => ({ ...pl, season }));
  g.beds[0].plantings.push(
    { id: 'h1', plantId: 'potato', col: 2, row: 6, method: 'direct', season: season - 1, plantedOn: `${season - 1}-04-05`, removedOn: `${season - 1}-08-01` },
    { id: 'h2', plantId: 'potato', col: 3, row: 6, method: 'direct', season: season - 1, plantedOn: `${season - 1}-04-05`, removedOn: `${season - 1}-08-01` },
    { id: 'h3', plantId: 'bean', col: 0, row: 0, method: 'direct', season: season - 1, plantedOn: `${season - 1}-05-10`, removedOn: `${season - 1}-08-15` },
  );
  // Summer beans succeed the spring lettuce in the same square.
  const bed = g.beds[0];
  const lettuce = bed.plantings.find((p) => p.id === 'p6')!;
  const slot = scheduleSlot({ ...bed, plantings: bed.plantings.filter((p) => p.id !== 'p11') }, g.site, getPlant('bean'), 'direct', 1, 2, season, { earliest: plantingInterval(lettuce, g.site).end });
  const bean = bed.plantings.find((p) => p.id === 'p11')!;
  if (slot.ok) bean.plannedOn = isoDate(slot.start);
  else bed.plantings = bed.plantings.filter((p) => p.id !== 'p11');
  // A second bed already in use this season, so the daily views have something to show.
  const cur = seasonOfDate(g.site, today);
  const ago = (n: number) => isoDate(new Date(today.getTime() - n * 86400000));
  g.beds.push(newBed({
    id: 'bed_sample2', name: 'Bed 2', x: 44, y: 30, widthFt: 4, lengthFt: 4, soil: 'raised-mix',
    plantings: [
      { id: 'f1', plantId: 'kale', col: 0, row: 0, method: 'transplant', season: cur, plantedOn: ago(70) },
      { id: 'f2', plantId: 'kale', col: 1, row: 0, method: 'transplant', season: cur, plantedOn: ago(70) },
      { id: 'f3', plantId: 'spinach', col: 2, row: 0, method: 'direct', season: cur, plantedOn: ago(45) },
      { id: 'f4', plantId: 'spinach', col: 3, row: 0, method: 'direct', season: cur, plantedOn: ago(45) },
      { id: 'f5', plantId: 'leaf-lettuce', col: 0, row: 1, method: 'direct', season: cur, plantedOn: ago(38) },
      { id: 'f6', plantId: 'radish', col: 1, row: 1, method: 'direct', season: cur, plantedOn: ago(30) },
      { id: 'f7', plantId: 'carrot', col: 2, row: 1, method: 'direct', season: cur, plantedOn: ago(80) },
      { id: 'f8', plantId: 'chive', col: 3, row: 3, method: 'transplant', season: cur - 1, plantedOn: `${cur - 1}-05-01` },
    ],
    irrigation: { ...defaultIrrigation(), valveEntity: 'switch.demo_bed_2_valve', moistureEntity: 'sensor.demo_bed_2_soil_moisture' },
  }));
  g.journal.push(
    { id: 'j1', date: ago(12), kind: 'harvest', bedId: 'bed_sample2', plantId: 'kale', plantingId: 'f1', qty: 0.75, unit: 'lb' },
    { id: 'j2', date: ago(5), kind: 'harvest', bedId: 'bed_sample2', plantId: 'radish', plantingId: 'f6', qty: 12, unit: 'count' },
    { id: 'j3', date: ago(9), kind: 'pest', bedId: 'bed_sample2', plantId: 'kale', text: 'Aphids on undersides of two kale leaves — hosed off' },
  );
  g.beds[0].soilTests = [{ date: `${season - 1}-09-15`, ph: 6.4, organicMatterPct: 7, n: 'medium', p: 'high', k: 'medium' }];
  // A few packets in the seed box so the shopping list shows have / old / need.
  g.seeds = [
    { id: 's1', plantId: 'tomato', variety: 'Sungold', year: season - 1, amount: 'half' },
    { id: 's2', plantId: 'carrot', variety: 'Nantes', year: season - 4, amount: 'low' },
    { id: 's3', plantId: 'bean', variety: 'Provider', year: season - 1, amount: 'full' },
    { id: 's4', plantId: 'lettuce', variety: 'Buttercrunch', year: season, amount: 'full' },
  ];
  return g;
}

function sampleGardenRaw(): Garden {
  return {
    version: 1,
    journal: [],
    seeds: [],
    notify: defaultNotify(),
    updatedAt: new Date().toISOString(),
    site: {
      name: 'My yard',
      lat: 39.95,
      lon: -75.16,
      widthFt: 80,
      depthFt: 100,
      northDeg: 0,
      lastFrost: '04-15',
      firstFrost: '10-25',
      obstacles: [
        { id: 'house', kind: 'building', name: 'House', heightFt: 24, points: [[15, 62], [55, 62], [55, 92], [15, 92]] },
        { id: 'garage', kind: 'building', name: 'Garage', heightFt: 12, points: [[60, 70], [78, 70], [78, 92], [60, 92]] },
        { id: 'oak', kind: 'tree', name: 'Oak', x: 12, y: 18, canopyRadiusFt: 14, heightFt: 45, trunkHeightFt: 10, deciduous: true },
        { id: 'spruce', kind: 'tree', name: 'Spruce', x: 70, y: 12, canopyRadiusFt: 7, heightFt: 30, trunkHeightFt: 2, deciduous: false },
        { id: 'fence-w', kind: 'fence', name: 'West fence', x1: 0.5, y1: 0, x2: 0.5, y2: 100, heightFt: 6, transmittance: 0 },
        { id: 'fence-e', kind: 'fence', name: 'East fence', x1: 79.5, y1: 0, x2: 79.5, y2: 100, heightFt: 6, transmittance: 0 },
      ],
    },
    beds: [
      newBed({
        id: 'bed_sample1',
        name: 'Bed 1',
        x: 36,
        y: 30,
        widthFt: 4,
        lengthFt: 8,
        plantings: [
          { id: 'p1', plantId: 'tomato', col: 0, row: 0, method: 'transplant', season: 0 },
          { id: 'p2', plantId: 'tomato', col: 1, row: 0, method: 'transplant', season: 0 },
          { id: 'p3', plantId: 'basil', col: 2, row: 0, method: 'transplant', season: 0 },
          { id: 'p4', plantId: 'pepper', col: 3, row: 0, method: 'transplant', season: 0 },
          { id: 'p5', plantId: 'carrot', col: 0, row: 2, method: 'direct', season: 0 },
          { id: 'p6', plantId: 'lettuce', col: 1, row: 2, method: 'direct', season: 0 },
          { id: 'p7', plantId: 'radish', col: 2, row: 2, method: 'direct', season: 0 },
          { id: 'p8', plantId: 'bean', col: 3, row: 3, method: 'direct', season: 0 },
          { id: 'p9', plantId: 'eggplant', col: 2, row: 6, method: 'transplant', season: 0 },
          { id: 'p10', plantId: 'spinach', col: 0, row: 5, method: 'direct', season: 0 },
          { id: 'p11', plantId: 'bean', col: 1, row: 2, method: 'direct', season: 0, plannedOn: '' },
        ],
        irrigation: { ...defaultIrrigation(), valveEntity: 'switch.demo_bed_1_valve', moistureEntity: 'sensor.demo_bed_1_soil_moisture' },
      }),
    ],
  };
}
