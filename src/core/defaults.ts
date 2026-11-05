import type { Bed, BedIrrigation, Garden } from './types.ts';
import { uid } from './util.ts';

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

/** A sample suburban lot so the app is explorable before you draw your own. */
export function sampleGarden(): Garden {
  return {
    version: 1,
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
          { id: 'p1', plantId: 'tomato', col: 0, row: 0, method: 'transplant' },
          { id: 'p2', plantId: 'tomato', col: 1, row: 0, method: 'transplant' },
          { id: 'p3', plantId: 'basil', col: 2, row: 0, method: 'transplant' },
          { id: 'p4', plantId: 'pepper', col: 3, row: 0, method: 'transplant' },
          { id: 'p5', plantId: 'carrot', col: 0, row: 2, method: 'direct' },
          { id: 'p6', plantId: 'lettuce', col: 1, row: 2, method: 'direct' },
          { id: 'p7', plantId: 'radish', col: 2, row: 2, method: 'direct' },
          { id: 'p8', plantId: 'bean', col: 3, row: 3, method: 'direct' },
        ],
        irrigation: { ...defaultIrrigation(), valveEntity: 'switch.demo_bed_1_valve', moistureEntity: 'sensor.demo_bed_1_soil_moisture' },
      }),
    ],
  };
}
