import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Garden, WeatherBundle } from '../core/types.ts';
import { sampleGarden } from '../core/defaults.ts';
import { periodDates, type SunMap, type SunPeriod } from '../core/shade.ts';
import { api, probeServer, type IrrigationStatus } from './api.ts';

export type Tab = 'site' | 'beds' | 'plan' | 'water' | 'forecast' | 'simulate' | 'settings';

interface SunState {
  map: SunMap | null;
  period: SunPeriod;
  date: string;
  computing: boolean;
  progress: number;
  /** Separate, always-on growing-season map used for bed suitability. */
  season: SunMap | null;
}

interface Ctx {
  ready: boolean;
  server: boolean;
  garden: Garden;
  update: (fn: (g: Garden) => Garden) => void;
  weather: WeatherBundle | null;
  weatherError: string | null;
  refreshWeather: () => void;
  sun: SunState;
  setSunPeriod: (p: SunPeriod, date?: string) => void;
  irrigation: IrrigationStatus | null;
  refreshIrrigation: () => Promise<void>;
  tab: Tab;
  setTab: (t: Tab) => void;
  selectedBedId: string | null;
  setSelectedBedId: (id: string | null) => void;
  saveState: 'saved' | 'saving' | 'error';
}

const GardenCtx = createContext<Ctx | null>(null);

export function useGarden(): Ctx {
  const c = useContext(GardenCtx);
  if (!c) throw new Error('useGarden outside provider');
  return c;
}

function useSunWorker() {
  const workerRef = useRef<Worker | null>(null);
  const seq = useRef(0);
  const run = useCallback((site: Garden['site'], dates: Date[], onProgress: (f: number) => void): Promise<SunMap> => {
    workerRef.current?.terminate();
    const w = new Worker(new URL('./sun.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    const id = ++seq.current;
    return new Promise((resolve, reject) => {
      w.onmessage = (e) => {
        if (e.data.id !== id) return;
        if (e.data.progress != null) onProgress(e.data.progress);
        if (e.data.map) {
          resolve(e.data.map);
          w.terminate();
        }
      };
      w.onerror = (e) => reject(e);
      w.postMessage({ id, site, dates: dates.map((d) => d.toISOString()) });
    });
  }, []);
  return run;
}

export function GardenProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [server, setServer] = useState(false);
  const [garden, setGarden] = useState<Garden>(sampleGarden);
  const [weather, setWeather] = useState<WeatherBundle | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [irrigation, setIrrigation] = useState<IrrigationStatus | null>(null);
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      return (localStorage.getItem('jardin.tab') as Tab) || 'site';
    } catch {
      return 'site';
    }
  });
  const [selectedBedId, setSelectedBedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [sun, setSun] = useState<SunState>({ map: null, season: null, period: 'season', date: new Date().toISOString().slice(0, 10), computing: false, progress: 0 });
  const runSun = useSunWorker();
  const runSeason = useSunWorker();
  const dirty = useRef(false);

  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem('jardin.tab', t);
    } catch {
      /* ignore */
    }
  };

  // Boot: detect server, load data.
  useEffect(() => {
    (async () => {
      const s = await probeServer();
      setServer(s);
      try {
        const g = await api.loadGarden(s);
        if (g) setGarden(g);
      } catch (e) {
        console.error(e);
      }
      setReady(true);
    })();
  }, []);

  const update = useCallback((fn: (g: Garden) => Garden) => {
    dirty.current = true;
    setGarden((g) => fn(g));
  }, []);

  // Debounced save.
  useEffect(() => {
    if (!ready || !dirty.current) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      api.saveGarden(server, garden).then(
        () => setSaveState('saved'),
        () => setSaveState('error'),
      );
    }, 700);
    return () => clearTimeout(t);
  }, [garden, ready, server]);

  const refreshWeather = useCallback(() => {
    setWeatherError(null);
    api.weather(server, garden.site.lat, garden.site.lon).then(setWeather, (e) => setWeatherError(String(e.message ?? e)));
  }, [server, garden.site.lat, garden.site.lon]);

  useEffect(() => {
    if (ready) refreshWeather();
  }, [ready, refreshWeather]);

  const refreshIrrigation = useCallback(async () => {
    if (!server) return;
    try {
      setIrrigation(await api.irrigation());
    } catch {
      /* ignore */
    }
  }, [server]);

  useEffect(() => {
    if (!server) return;
    refreshIrrigation();
    const t = setInterval(refreshIrrigation, 15000);
    return () => clearInterval(t);
  }, [server, refreshIrrigation]);

  // Sun analysis: recompute when the site geometry or the chosen period changes.
  const siteKey = JSON.stringify(garden.site);
  const year = new Date().getFullYear();
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      setSun((s) => ({ ...s, computing: true, progress: 0 }));
      const dates = periodDates(garden.site, sun.period, year, new Date(sun.date + 'T12:00:00'));
      runSun(garden.site, dates, (f) => setSun((s) => ({ ...s, progress: f }))).then(
        (map) => setSun((s) => ({ ...s, map, computing: false, progress: 1 })),
        () => setSun((s) => ({ ...s, computing: false })),
      );
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, sun.period, sun.date, ready]);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      runSeason(garden.site, periodDates(garden.site, 'season', year), () => {}).then((season) => setSun((s) => ({ ...s, season })));
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, ready]);

  // Cache each bed's season sun exposure on the bed (used by the irrigation model on the server).
  const bedsKey = garden.beds.map((b) => `${b.id}:${b.x},${b.y},${b.widthFt},${b.lengthFt}`).join('|');
  useEffect(() => {
    const m = sun.season;
    if (!m) return;
    let changed = false;
    const beds = garden.beds.map((b) => {
      let sum = 0;
      let dli = 0;
      let n = 0;
      for (let y = b.y + 0.5; y < b.y + b.lengthFt; y += 1)
        for (let x = b.x + 0.5; x < b.x + b.widthFt; x += 1) {
          const c = Math.min(m.cols - 1, Math.max(0, Math.floor(x / m.cellFt)));
          const r = Math.min(m.rows - 1, Math.max(0, Math.floor(y / m.cellFt)));
          sum += m.sunHours[r * m.cols + c];
          dli += m.dli[r * m.cols + c];
          n++;
        }
      const a = { sunHours: sum / Math.max(1, n), maxSunHours: m.maxSunHours, dli: dli / Math.max(1, n), computedAt: new Date().toISOString() };
      if (!b.analysis || Math.abs(b.analysis.sunHours - a.sunHours) > 0.05 || Math.abs(b.analysis.maxSunHours - a.maxSunHours) > 0.05) {
        changed = true;
        return { ...b, analysis: a };
      }
      return b;
    });
    if (changed) update((g) => ({ ...g, beds: g.beds.map((b) => beds.find((x) => x.id === b.id) ?? b) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sun.season, bedsKey]);

  const setSunPeriod = useCallback((period: SunPeriod, date?: string) => setSun((s) => ({ ...s, period, date: date ?? s.date })), []);

  const value = useMemo<Ctx>(
    () => ({
      ready, server, garden, update, weather, weatherError, refreshWeather, sun, setSunPeriod, irrigation, refreshIrrigation,
      tab, setTab, selectedBedId, setSelectedBedId, saveState,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, server, garden, weather, weatherError, sun, irrigation, tab, selectedBedId, saveState, refreshWeather, refreshIrrigation],
  );
  return <GardenCtx.Provider value={value}>{children}</GardenCtx.Provider>;
}
