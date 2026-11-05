// The daily agenda: everything the garden needs from you today, ranked.
// Shared by the Today view and the Home Assistant daily digest.
import type { Garden, IrrigationEvent, WeatherBundle } from './types.ts';
import { PLANT_BY_ID } from './plants.ts';
import { evaluateBed } from './water.ts';
import { gardenTasks, TASK_LABEL } from './tasks.ts';
import { planningYear, plantNow } from './schedule.ts';
import { seasonOfDate } from './succession.ts';
import { simulateGrowth, frostThresholdC } from './growth.ts';
import { diseaseRisks, pestRisks, type RiskItem, type SeasonDays } from './health.ts';
import { soilAdvice } from './soil.ts';
import { addDays, cToF, fmtDate, isoDate, mmToIn, parseIso } from './util.ts';

export type AgendaCategory = 'frost' | 'heat' | 'water' | 'task' | 'harvest' | 'pest' | 'disease' | 'soil' | 'plan';

export interface AgendaItem {
  id: string;
  /** 0 = urgent (act today), 1 = today, 2 = this week, 3 = when you can */
  priority: 0 | 1 | 2 | 3;
  category: AgendaCategory;
  icon: string;
  title: string;
  detail?: string;
  bedId?: string;
  plantingIds?: string[];
  /** Suggested one-tap action for the UI. */
  action?: { kind: 'water'; bedId: string; minutes: number } | { kind: 'planted'; plantingIds: string[] } | { kind: 'harvest'; plantingId: string; bedId: string } | { kind: 'log'; text: string; plantId?: string; bedId?: string; journalKind: 'fertilize' | 'amend' };
}

export interface AgendaInput {
  garden: Garden;
  weather: WeatherBundle;
  season?: SeasonDays;
  events: IrrigationEvent[];
  readings: Record<string, number | null | undefined>;
  activeRuns?: string[];
}

export function buildAgenda({ garden, weather, season, events, readings, activeRuns = [] }: AgendaInput): AgendaItem[] {
  const items: AgendaItem[] = [];
  const todayIso = weather.today;
  const today = parseIso(todayIso);
  const cur = seasonOfDate(garden.site, today);
  const live = garden.beds.flatMap((b) => b.plantings.map((pl) => ({ bed: b, pl, plant: PLANT_BY_ID[pl.plantId] }))).filter((x) => x.plant && x.pl.plantedOn && !x.pl.removedOn && x.pl.plantedOn <= todayIso);

  // --- Frost & heat (next 48 h)
  const soon = weather.daily.filter((d) => d.date >= todayIso).slice(0, 2);
  for (const d of soon) {
    const atRisk = live.filter((x) => d.tMinC <= frostThresholdC(x.plant) + 1 && !x.plant.perennial);
    if (!atRisk.length) continue;
    const names = [...new Set(atRisk.map((x) => x.plant.name))];
    const when = d.date === todayIso ? 'tonight' : 'tomorrow night';
    items.push({
      id: `frost-${d.date}`, priority: 0, category: 'frost', icon: '🥶',
      title: `Frost risk ${when} — low ${cToF(d.tMinC).toFixed(0)}°F`,
      detail: `Cover or harvest: ${names.join(', ')}. Row cover or old sheets over hoops, weighted down; water the soil in the afternoon (moist soil holds heat). Remove covers in the morning.`,
    });
    break;
  }
  const hot = weather.daily.filter((d) => d.date >= todayIso).slice(0, 3).find((d) => d.tMaxC >= 32);
  if (hot) {
    const bolters = [...new Set(live.filter((x) => x.plant.boltsInHeat).map((x) => x.plant.name))];
    items.push({
      id: `heat-${hot.date}`, priority: bolters.length ? 1 : 2, category: 'heat', icon: '🥵',
      title: `Heat ${hot.date === todayIso ? 'today' : fmtDate(hot.date, { weekday: 'long' })} — high ${cToF(hot.tMaxC).toFixed(0)}°F`,
      detail: `${bolters.length ? `Shade-cloth ${bolters.join(', ')} to slow bolting. ` : ''}Water deeply in the early morning; mulch keeps roots cool. Harvest leafy greens before the heat.`,
    });
  }

  // --- Watering
  for (const bed of garden.beds) {
    if (bed.irrigation.mode === 'off') continue;
    if (!bed.plantings.some((p) => p.plantedOn && !p.removedOn)) continue;
    const ev = evaluateBed(bed, weather, events, readings[bed.id]);
    const r = ev.rec;
    if (activeRuns.includes(bed.id)) {
      items.push({ id: `water-${bed.id}`, priority: 3, category: 'water', icon: '💧', bedId: bed.id, title: `${bed.name} is being watered now` });
    } else if (r.action === 'water-now') {
      const auto = bed.irrigation.mode === 'auto' && bed.irrigation.valveEntity;
      items.push({
        id: `water-${bed.id}`, priority: 1, category: 'water', icon: '💧', bedId: bed.id,
        title: `Water ${bed.name}: ${mmToIn(r.depthMm).toFixed(2)}" (${r.gallons.toFixed(1)} gal${bed.irrigation.valveEntity ? `, ${r.minutes.toFixed(0)} min` : ''})`,
        detail: `${r.message}${ev.sensorFraction != null ? ` · sensor says ${Math.round(ev.sensorFraction * 100)}% of available water left` : ''}${auto ? ' · automatic watering will handle this in its window' : ''}`,
        action: bed.irrigation.valveEntity ? { kind: 'water', bedId: bed.id, minutes: Math.max(1, Math.round(r.minutes)) } : undefined,
      });
    } else if (r.action === 'rain-expected') {
      items.push({ id: `water-${bed.id}`, priority: 3, category: 'water', icon: '🌧️', bedId: bed.id, title: `${bed.name}: skip watering, rain is coming`, detail: r.message });
    } else if (r.action === 'water-soon' && r.date && r.date <= isoDate(addDays(today, 2))) {
      items.push({ id: `water-${bed.id}`, priority: 2, category: 'water', icon: '💧', bedId: bed.id, title: `${bed.name} will need water ${fmtDate(r.date, { weekday: 'long' })}`, detail: `About ${mmToIn(r.depthMm).toFixed(2)}" (${r.gallons.toFixed(1)} gal).` });
    }
  }

  // --- Harvest-ready (weather-adjusted)
  const lastFrostThisYear = parseIso(`${today.getFullYear()}-${garden.site.lastFrost}`);
  const firstFrostThisYear = parseIso(`${today.getFullYear()}-${garden.site.firstFrost}`);
  const inSeason = garden.site.lat >= 0 ? today >= lastFrostThisYear && today <= firstFrostThisYear : today >= lastFrostThisYear || today <= firstFrostThisYear;
  for (const x of live) {
    if (x.plant.yieldLbPerSqFt === 0) continue;
    if (x.plant.perennial) {
      // Perennials: a gentle reminder during the growing season only, never "overdue".
      if (inSeason && x.pl.plantedOn! <= isoDate(addDays(today, -x.plant.daysToMaturity)))
        items.push({ id: `harvest-${x.pl.id}`, priority: 3, category: 'harvest', icon: x.plant.icon, bedId: x.bed.id, plantingIds: [x.pl.id], title: `Harvest ${x.plant.name} in ${x.bed.name} as needed`, action: { kind: 'harvest', plantingId: x.pl.id, bedId: x.bed.id } });
      continue;
    }
    const g = simulateGrowth(x.pl, weather.daily, { today: todayIso, sunHours: x.bed.analysis?.sunHours });
    if (!g || !g.maturityDate || g.maturityDate > todayIso) continue;
    const late = g.harvestEndDate && g.harvestEndDate < todayIso;
    items.push({
      id: `harvest-${x.pl.id}`, priority: late ? 1 : 2, category: 'harvest', icon: x.plant.icon, bedId: x.bed.id, plantingIds: [x.pl.id],
      title: late ? `${x.plant.name} in ${x.bed.name} is past its harvest window` : `Harvest ${x.plant.name} in ${x.bed.name}`,
      detail: late ? 'Pick what’s left and pull the plants to free the square for the next crop.' : `Ready since ${fmtDate(g.maturityDate)}${g.harvestEndDate ? `, keeps going until ~${fmtDate(g.harvestEndDate)}` : ''}. Regular picking keeps plants producing.`,
      action: { kind: 'harvest', plantingId: x.pl.id, bedId: x.bed.id },
    });
  }
  // Merge harvest items of the same crop & bed.
  const merged = new Map<string, AgendaItem>();
  for (const it of items.filter((i) => i.category === 'harvest')) {
    const k = it.title;
    const m = merged.get(k);
    if (m) m.plantingIds!.push(...(it.plantingIds ?? []));
    else merged.set(k, it);
  }
  const nonHarvest = items.filter((i) => i.category !== 'harvest');
  items.length = 0;
  items.push(...nonHarvest, ...merged.values());

  // --- Scheduled tasks (sow, transplant, start indoors, prep, side-dress)
  const years = [...new Set([cur, planningYear(garden.site, today)])];
  const horizon = isoDate(addDays(today, 3));
  const recentJournal = (title: string, date: string) => garden.journal.some((e) => e.text === title && e.date >= isoDate(addDays(parseIso(date), -14)));
  for (const y of years)
    for (const t of gardenTasks(garden, y)) {
      if (t.done || t.kind === 'harvest' || t.date > horizon) continue;
      if ((t.endDate ?? t.date) < isoDate(addDays(today, -21))) continue;
      if ((t.kind === 'side-dress' || t.kind === 'prep' || t.kind === 'perennial-care') && recentJournal(t.title, t.date)) continue;
      const plantingDone = (t.kind === 'transplant' || t.kind === 'direct-sow');
      const overdue = t.date < todayIso;
      items.push({
        id: `task-${t.kind}-${t.plantingIds[0]}-${t.date}`,
        priority: overdue || t.date === todayIso ? 1 : 2,
        category: 'task', icon: PLANT_BY_ID[t.plantId]?.icon ?? '•', bedId: t.bedId, plantingIds: t.plantingIds,
        title: `${TASK_LABEL[t.kind]}: ${t.title}${t.plantingIds.length > 1 ? ` (${t.plantingIds.length} squares)` : ''}`,
        detail: `${overdue ? `Was due ${fmtDate(t.date)}. ` : t.date === todayIso ? 'Due today. ' : `Due ${fmtDate(t.date, { weekday: 'long', month: 'short', day: 'numeric' })}. `}${t.detail ?? ''}`,
        action: plantingDone ? { kind: 'planted', plantingIds: t.plantingIds } : t.kind === 'side-dress' || t.kind === 'prep' || t.kind === 'perennial-care' ? { kind: 'log', text: t.title, plantId: t.plantId, bedId: t.bedId, journalKind: t.kind === 'side-dress' ? 'fertilize' : 'amend' } : undefined,
      });
    }

  // --- Pests & diseases
  const risks: RiskItem[] = [...(season ? pestRisks(garden, season) : []), ...diseaseRisks(garden, weather.hourly, todayIso)];
  for (const r of risks) {
    if (r.level === 'low') continue;
    items.push({
      id: `risk-${r.id}`, priority: r.level === 'high' ? 1 : 2, category: r.kind === 'pest' ? 'pest' : 'disease', icon: r.icon,
      title: `${r.name}: ${r.headline}`,
      detail: `${r.action} (${r.crops.map((c) => PLANT_BY_ID[c]?.name ?? c).join(', ')})`,
    });
  }

  // --- Soil (season prep: within 10 weeks before last frost, or in fall)
  const lf = parseIso(`${planningYear(garden.site, today)}-${garden.site.lastFrost}`);
  const prepTime = today >= addDays(lf, -70) && today <= lf;
  const fall = today >= parseIso(`${today.getFullYear()}-${garden.site.firstFrost}`);
  if (prepTime || fall) {
    const y = planningYear(garden.site, today);
    for (const bed of garden.beds) {
      const s = soilAdvice(bed, garden.site, y);
      if (s.amendment)
        items.push({
          id: `soil-${bed.id}`, priority: 3, category: 'soil', icon: '🪣', bedId: bed.id,
          title: `${bed.name}: ${s.amendment.product === 'lime' ? 'lime' : 'sulfur'} to bring pH ${s.test?.ph} → ${s.target?.target}`,
          detail: `${s.amendment.lbTotal.toFixed(1)} lb for this bed. ${s.amendment.note}`,
          action: { kind: 'log', text: `Applied ${s.amendment.product} to ${bed.name}`, bedId: bed.id, journalKind: 'amend' },
        });
      else if (!s.test)
        items.push({ id: `soiltest-${bed.id}`, priority: 3, category: 'soil', icon: '🧪', bedId: bed.id, title: `${bed.name}: get a soil test before the season`, detail: 'pH and N-P-K from an extension lab tell you exactly what to add.' });
    }
  }

  // --- What to sow/plant now that isn't in the plan yet
  const planned = new Set(garden.beds.flatMap((b) => b.plantings.filter((p) => p.season >= cur).map((p) => p.plantId)));
  const opportunities = plantNow(garden.site, today).filter((x) => !planned.has(x.plant.id) && x.action !== 'start-indoors');
  if (opportunities.length)
    items.push({
      id: 'plant-now', priority: 3, category: 'plan', icon: '🌱',
      title: `In season to plant now: ${opportunities.slice(0, 6).map((x) => x.plant.name).join(', ')}${opportunities.length > 6 ? '…' : ''}`,
      detail: 'Open Beds and click an empty square to schedule one.',
    });

  return items.sort((a, b) => a.priority - b.priority || order(a.category) - order(b.category));
}

const ORDER: AgendaCategory[] = ['frost', 'heat', 'water', 'harvest', 'task', 'disease', 'pest', 'soil', 'plan'];
const order = (c: AgendaCategory) => ORDER.indexOf(c);

/** Plain-text digest for notifications. */
export function agendaDigest(items: AgendaItem[], max = 8): { title: string; message: string } {
  const urgent = items.filter((i) => i.priority <= 1);
  const top = items.filter((i) => i.priority <= 2).slice(0, max);
  const title = urgent.length ? `🌱 Garden: ${urgent.length} thing${urgent.length > 1 ? 's' : ''} need you today` : '🌱 Garden: all good today';
  const message = top.length ? top.map((i) => `${i.icon} ${i.title}`).join('\n') : 'Nothing urgent. Enjoy the garden!';
  return { title, message };
}
