/// <reference lib="webworker" />
import { computeSunMap } from '../core/shade.ts';
import type { Site } from '../core/types.ts';

self.onmessage = (e: MessageEvent<{ id: number; site: Site; dates: string[]; cellFt?: number }>) => {
  const { id, site, dates, cellFt } = e.data;
  const map = computeSunMap(site, dates.map((d) => new Date(d)), {
    cellFt,
    stepMin: dates.length > 4 ? 15 : 10,
    onProgress: (f) => (self as unknown as Worker).postMessage({ id, progress: f }),
  });
  (self as unknown as Worker).postMessage({ id, map }, [map.sunHours.buffer, map.dli.buffer, map.blocked.buffer] as any);
};
