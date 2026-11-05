// Plant-health risk engine: insect pests timed by degree-days since the start of the year,
// and fungal/bacterial diseases driven by hourly humidity, leaf wetness and temperature.
// Thresholds are approximate figures published by US land-grant extension services; local
// timing varies, so the app frames them as "scout now" prompts rather than certainties.
import type { DailyWeather, Garden, HourlyWeather } from './types.ts';
import { PLANT_BY_ID } from './plants.ts';
import { cToF, addDays, isoDate, parseIso } from './util.ts';
import { lastTreatment } from './journal.ts';
import { seasonOfDate } from './succession.ts';
import { stageAt } from './water.ts';

export type RiskLevel = 'low' | 'watch' | 'high';

export interface RiskItem {
  id: string;
  kind: 'pest' | 'disease' | 'weather';
  name: string;
  icon: string;
  crops: string[];
  level: RiskLevel;
  headline: string;
  action: string;
  detail?: string;
  /** Degree-day progress for pests. */
  progress?: { dd: number; next?: number; nextLabel?: string; eta?: string; base: number };
}

// ---------------------------------------------------------------------------
// Degree days (°F, modified average method with horizontal cutoffs)
export function degreeDaysF(w: DailyWeather, baseF: number, upperF = 86): number {
  const hi = Math.min(cToF(w.tMaxC), upperF);
  const lo = Math.max(Math.min(cToF(w.tMinC), upperF), baseF);
  return Math.max(0, (Math.max(hi, baseF) + lo) / 2 - baseF);
}

export interface PestModel {
  id: string;
  name: string;
  icon: string;
  hosts: string[];
  baseF: number;
  events: { dd: number; label: string; action: string }[];
  /** How long after the last event the pest stays a concern, in DD. */
  activeDd: number;
  /** Advice once the modelled events have passed. */
  later?: string;
}

export const PESTS: PestModel[] = [
  {
    id: 'cabbage-maggot', name: 'Cabbage root maggot', icon: '🪰', baseF: 43, activeDd: 350,
    later: 'Later generations (late summer into fall) still attack fall-sown radishes, turnips and young brassicas — keep young sowings under insect netting.',
    hosts: ['cabbage', 'broccoli', 'cauliflower', 'kale', 'radish', 'turnip'],
    events: [
      { dd: 200, label: 'first flies emerging', action: 'Cover brassica transplants and radish/turnip sowings with insect netting or row cover now; collars around transplant stems help.' },
      { dd: 300, label: 'peak egg laying', action: 'Keep covers sealed; check stems at the soil line for white eggs.' },
    ],
  },
  {
    id: 'onion-maggot', name: 'Onion maggot', icon: '🪰', baseF: 40, activeDd: 400,
    later: 'A late-summer generation can tunnel into bulbs near harvest — lift onions promptly once tops fall and remove culls.',
    hosts: ['onion', 'scallion', 'leek'],
    events: [
      { dd: 250, label: 'first flies emerging', action: 'Cover onions with row cover; avoid planting into soil with fresh manure or rotting onion debris.' },
      { dd: 390, label: 'peak first flight', action: 'Keep covers on; pull and destroy wilting seedlings (maggots in the bulb).' },
    ],
  },
  {
    id: 'seedcorn-maggot', name: 'Seedcorn maggot', icon: '🪰', baseF: 39, activeDd: 200,
    hosts: ['bean', 'pole-bean', 'pea', 'corn', 'cucumber', 'melon'],
    events: [
      { dd: 200, label: 'first-generation flight peak', action: 'Wait for warm soil (60°F+) before sowing beans/corn so seeds sprout fast; avoid fresh manure.' },
      { dd: 600, label: 'second-generation flight', action: 'Re-sow gaps after the flight passes; warm soil keeps damage low.' },
    ],
  },
  {
    id: 'colorado-potato-beetle', name: 'Colorado potato beetle', icon: '🪲', baseF: 50, activeDd: 900,
    hosts: ['potato', 'eggplant', 'tomato'],
    events: [
      { dd: 185, label: 'overwintered beetles active, first egg masses', action: 'Check leaf undersides for orange egg clusters every few days and crush them; hand-pick adults. Row cover protects eggplant.' },
      { dd: 400, label: 'larvae feeding', action: 'Hand-pick larvae or use Bt-tenebrionis/spinosad while larvae are small.' },
    ],
  },
  {
    id: 'european-corn-borer', name: 'European corn borer', icon: '🐛', baseF: 50, activeDd: 500,
    hosts: ['corn', 'pepper'],
    events: [
      { dd: 375, label: 'first moths flying', action: 'Scout corn whorls and pepper fruit for shot-holes and frass.' },
      { dd: 550, label: 'peak egg laying', action: 'Treat infested whorls with Bt; destroy damaged pepper fruit.' },
    ],
  },
  {
    id: 'squash-vine-borer', name: 'Squash vine borer', icon: '🦋', baseF: 50, activeDd: 600,
    hosts: ['zucchini', 'winter-squash'],
    events: [
      { dd: 900, label: 'adult moths emerging', action: 'Cover squash until flowering (then hand-pollinate) or wrap the lower stems; watch for orange-and-black day-flying moths.' },
      { dd: 1000, label: 'peak egg laying', action: 'Check stem bases for tiny brown eggs and sawdust-like frass; slit stems to remove larvae, mound soil over the wound.' },
    ],
  },
  {
    id: 'japanese-beetle', name: 'Japanese beetle', icon: '🪲', baseF: 50, activeDd: 1000,
    hosts: ['bean', 'pole-bean', 'corn', 'basil'],
    events: [{ dd: 1000, label: 'adults emerging', action: 'Shake beetles into soapy water in the cool of the morning; skip pheromone traps near the garden (they attract more).' }],
  },
];

export interface SeasonDays {
  days: DailyWeather[];
  normals?: DailyWeather[];
  today: string;
}

function cumulative(days: DailyWeather[], baseF: number) {
  let s = 0;
  return days.map((d) => ({ date: d.date, dd: (s += degreeDaysF(d, baseF)) }));
}

/** Crops in (or headed for) the ground in the current season. */
export function activeCrops(garden: Garden, today: Date): Set<string> {
  const season = seasonOfDate(garden.site, today);
  const ids = new Set<string>();
  for (const b of garden.beds)
    for (const pl of b.plantings) {
      const p = PLANT_BY_ID[pl.plantId];
      if (!p || pl.removedOn) continue;
      if (pl.season === season || (p.perennial && pl.plantedOn)) ids.add(pl.plantId);
    }
  return ids;
}

export function pestRisks(garden: Garden, sw: SeasonDays): RiskItem[] {
  const crops = activeCrops(garden, parseIso(sw.today));
  const out: RiskItem[] = [];
  for (const m of PESTS) {
    const hosts = m.hosts.filter((h) => crops.has(h));
    if (!hosts.length) continue;
    const series = cumulative(sw.days, m.baseF);
    const todayIdx = series.findIndex((x) => x.date === sw.today);
    const now = todayIdx >= 0 ? series[todayIdx].dd : series[series.length - 1]?.dd ?? 0;
    const next = m.events.find((e) => e.dd > now);
    const passed = [...m.events].reverse().find((e) => e.dd <= now);
    // ETA: forecast first, then last year's weather as a stand-in for normal.
    let eta: string | undefined;
    if (next) {
      const hit = series.find((x) => x.dd >= next.dd && x.date > sw.today);
      if (hit) eta = hit.date;
      else if (sw.normals?.length) {
        let acc = series[series.length - 1]?.dd ?? now;
        const lastDate = series[series.length - 1]?.date ?? sw.today;
        for (const n of sw.normals) {
          const d = `${+n.date.slice(0, 4) + 1}${n.date.slice(4)}`;
          if (d <= lastDate) continue;
          acc += degreeDaysF(n, m.baseF);
          if (acc >= next.dd) {
            eta = d;
            break;
          }
        }
      }
    }
    const lastEvent = m.events[m.events.length - 1];
    const daysToNext = eta ? Math.round((parseIso(eta).getTime() - parseIso(sw.today).getTime()) / 86400000) : Infinity;
    let level: RiskLevel = 'low';
    let headline: string;
    let action: string;
    if (passed && now <= lastEvent.dd + m.activeDd) {
      level = 'high';
      headline = `${passed.label} (${Math.round(now)} of ${passed.dd} degree-days)`;
      action = passed.action;
    } else if (next && daysToNext <= 14) {
      level = 'watch';
      headline = `${next.label} expected around ${eta} (${Math.round(now)}/${next.dd} DD)`;
      action = next.action;
    } else if (next) {
      headline = `${next.label} at ~${next.dd} DD — now ${Math.round(now)}${eta ? `, est. ${eta}` : ''}`;
      action = next.action;
    } else {
      headline = m.later ? 'Spring flights have passed' : `Main activity has passed for this season`;
      action = m.later ?? 'Clean up crop debris after harvest to reduce overwintering.';
    }
    out.push({
      id: m.id, kind: 'pest', name: m.name, icon: m.icon, crops: hosts, level, headline, action,
      progress: { dd: now, next: next?.dd, nextLabel: next?.label, eta, base: m.baseF },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Diseases from hourly weather

interface DayWet {
  date: string;
  minC: number;
  maxC: number;
  humidHours: number; // RH ≥ 90%
  wetHours: number; // RH ≥ 90% or measurable rain
  wetMeanC: number;
  meanRh: number;
  rainMm: number;
}

export function wetnessByDay(h: HourlyWeather): DayWet[] {
  const by = new Map<string, number[]>();
  h.time.forEach((t, i) => {
    const d = t.slice(0, 10);
    if (!by.has(d)) by.set(d, []);
    by.get(d)!.push(i);
  });
  const out: DayWet[] = [];
  for (const [date, idx] of by) {
    if (idx.length < 20) continue;
    let humid = 0;
    let wet = 0;
    let wetT = 0;
    let rh = 0;
    let rain = 0;
    let minC = Infinity;
    let maxC = -Infinity;
    for (const i of idx) {
      const T = h.tempC[i];
      const R = h.rh[i];
      const P = h.precipMm[i] ?? 0;
      if (T == null || R == null) continue;
      minC = Math.min(minC, T);
      maxC = Math.max(maxC, T);
      rh += R;
      rain += P;
      if (R >= 90) humid++;
      if (R >= 90 || P >= 0.1) {
        wet++;
        wetT += T;
      }
    }
    out.push({ date, minC, maxC, humidHours: humid, wetHours: wet, wetMeanC: wet ? wetT / wet : NaN, meanRh: rh / idx.length, rainMm: rain });
  }
  return out;
}

/** TOMCAST disease severity value (0–4) from leaf-wetness hours and mean temperature during wetness. */
export function tomcastDsv(wetHours: number, meanC: number): number {
  if (!wetHours || !Number.isFinite(meanC) || meanC < 13 || meanC > 29) return 0;
  const T = Math.round(meanC);
  const steps = T <= 17 ? [6, 15, 20, Infinity] : T <= 20 ? [3, 8, 15, 22] : T <= 25 ? [2, 5, 12, 20] : [3, 8, 15, 22];
  let dsv = 0;
  for (const s of steps) if (wetHours > s) dsv++;
  return Math.min(dsv, T <= 17 ? 3 : 4);
}

/** Late blight "Hutton period": two consecutive days with min ≥ 10°C and ≥ 6 h of RH ≥ 90%. */
export function huttonDays(days: DayWet[]): string[] {
  const crit = days.map((d) => d.minC >= 10 && d.humidHours >= 6);
  const out: string[] = [];
  for (let i = 1; i < days.length; i++) if (crit[i] && crit[i - 1]) out.push(days[i].date);
  return out;
}

export function diseaseRisks(garden: Garden, hourly: HourlyWeather | undefined, today: string): RiskItem[] {
  if (!hourly) return [];
  const crops = activeCrops(garden, parseIso(today));
  const days = wetnessByDay(hourly);
  const past7 = isoDate(addDays(parseIso(today), -7));
  const next7 = isoDate(addDays(parseIso(today), 7));
  const recent = days.filter((d) => d.date >= past7 && d.date <= next7);
  const out: RiskItem[] = [];
  const has = (ids: string[]) => ids.filter((i) => crops.has(i));

  const lbHosts = has(['tomato', 'cherry-tomato', 'potato']);
  if (lbHosts.length) {
    const periods = huttonDays(recent);
    const future = periods.filter((d) => d >= today);
    out.push({
      id: 'late-blight', kind: 'disease', name: 'Late blight', icon: '🍂', crops: lbHosts,
      level: periods.length ? 'high' : recent.filter((d) => d.minC >= 10 && d.humidHours >= 6).length ? 'watch' : 'low',
      headline: periods.length
        ? `${periods.length} high-risk day${periods.length > 1 ? 's' : ''} (Hutton criteria) ${future.length ? `incl. ${future[0]} forecast` : 'in the past week'}`
        : 'No blight-favourable warm, humid spells this fortnight',
      action: periods.length
        ? 'Inspect tomato/potato leaves for greasy grey-green blotches with white fuzz underneath; remove and bag affected plants. Protectant copper or chlorothalonil only works before infection.'
        : 'Water at the soil, not the leaves, and keep good airflow.',
      detail: 'Two consecutive days with minimum ≥ 10 °C (50 °F) and at least 6 hours of humidity ≥ 90%.',
    });
  }

  const tcHosts = has(['tomato', 'cherry-tomato']);
  if (tcHosts.length) {
    const treated = lastTreatment(garden, tcHosts);
    const planted = garden.beds.flatMap((b) => b.plantings).filter((p) => tcHosts.includes(p.plantId) && p.plantedOn && !p.removedOn).map((p) => p.plantedOn!).sort()[0];
    const from = [treated, planted, isoDate(addDays(parseIso(today), -21))].filter(Boolean).sort().pop()!;
    let acc = 0;
    let fc = 0;
    for (const d of days) {
      if (d.date < from || d.date > next7) continue;
      const v = tomcastDsv(d.wetHours, d.wetMeanC);
      if (d.date <= today) acc += v;
      else fc += v;
    }
    const total = acc + fc;
    out.push({
      id: 'tomcast', kind: 'disease', name: 'Early blight & Septoria leaf spot', icon: '🍅', crops: tcHosts,
      level: acc >= 15 ? 'high' : total >= 15 || acc >= 10 ? 'watch' : 'low',
      headline: `${acc} disease-severity values since ${from}${fc ? ` (+${fc} forecast)` : ''}; action threshold ≈ 15`,
      action: acc >= 15 || total >= 15
        ? 'Remove spotted lower leaves, mulch to stop soil splash, and apply a protectant (copper, chlorothalonil or Bacillus subtilis) if spots are spreading. Log the treatment to reset the count.'
        : 'Keep lower leaves pruned 12" off the soil and mulch.',
      detail: 'TOMCAST model: leaf-wetness hours × temperature → daily severity values (0–4).',
    });
  }

  const pmHosts = has(['cucumber', 'zucchini', 'winter-squash', 'melon']);
  if (pmHosts.length) {
    const fav = recent.filter((d) => (d.minC + d.maxC) / 2 >= 20 && (d.minC + d.maxC) / 2 <= 30 && d.meanRh >= 50 && d.rainMm < 2).length;
    out.push({
      id: 'powdery-mildew', kind: 'disease', name: 'Powdery mildew (cucurbits)', icon: '🤍', crops: pmHosts,
      level: fav >= 8 ? 'high' : fav >= 4 ? 'watch' : 'low',
      headline: `${fav} of ${recent.length} days warm, humid and dry-leafed — conditions it loves`,
      action: fav >= 4
        ? 'Check leaf tops for white powdery spots; remove the worst leaves and spray potassium bicarbonate, sulfur (not above 90 °F) or diluted milk early. Resistant varieties help next year.'
        : 'Space plants for airflow; water at the base.',
    });
  }

  const dmHosts = has(['basil', 'cucumber', 'melon']);
  if (dmHosts.length) {
    const fav = recent.filter((d) => d.wetHours >= 6 && d.wetMeanC >= 12 && d.wetMeanC <= 23).length;
    out.push({
      id: 'downy-mildew', kind: 'disease', name: 'Downy mildew (basil, cucumber, melon)', icon: '💧', crops: dmHosts,
      level: fav >= 5 ? 'high' : fav >= 2 ? 'watch' : 'low',
      headline: `${fav} cool, wet nights/days with 6+ hours of leaf wetness this fortnight`,
      action: fav >= 2
        ? 'Look for yellowing between veins with grey-purple fuzz under leaves; pull infected basil immediately (it spreads by wind). Water in the morning only.'
        : 'Water early in the day so leaves dry before night.',
    });
  }

  // Blossom drop: tomatoes, peppers, eggplant, beans in flower.
  const flowering = new Set<string>();
  const td = parseIso(today);
  for (const b of garden.beds)
    for (const pl of b.plantings) {
      const p = PLANT_BY_ID[pl.plantId];
      if (!p || pl.removedOn || !['tomato', 'cherry-tomato', 'pepper', 'eggplant', 'bean', 'pole-bean'].includes(p.id)) continue;
      const st = stageAt(p, pl.plantedOn, pl.method, td);
      if (st.stage === 'mid' || st.stage === 'development') flowering.add(p.id);
    }
  if (flowering.size) {
    const bad = days.filter((d) => d.date >= today && d.date <= next7 && (d.minC < 13 || d.maxC > 32 || d.minC > 24));
    if (bad.length)
      out.push({
        id: 'blossom-drop', kind: 'weather', name: 'Blossom drop', icon: '🌼', crops: [...flowering],
        level: bad.length >= 3 ? 'watch' : 'low',
        headline: `${bad.length} forecast day${bad.length > 1 ? 's' : ''} with nights < 55 °F, nights > 75 °F or days > 90 °F`,
        action: 'Flowers set poorly in these temperatures — fruit set resumes when it moderates. Shade cloth in heat; keep watering even.',
      });
  }
  return out;
}

export const RISK_ORDER: Record<RiskLevel, number> = { high: 0, watch: 1, low: 2 };
