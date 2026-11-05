// Soil health: pH suitability for the planned crops, lime/sulfur amounts,
// nutrient advice from a basic soil test, and compost quantities.
import type { Bed, NutrientLevel, Site, SoilTest, SoilType } from './types.ts';
import { PLANT_BY_ID, type PlantType } from './plants.ts';

export function latestSoilTest(bed: Bed): SoilTest | undefined {
  return [...(bed.soilTests ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0];
}

function seasonCrops(bed: Bed, season: number): PlantType[] {
  const ids = new Set(bed.plantings.filter((p) => p.season === season || (PLANT_BY_ID[p.plantId]?.perennial && !p.removedOn)).map((p) => p.plantId));
  return [...ids].map((id) => PLANT_BY_ID[id]).filter(Boolean);
}

/** pH that suits the most crops; the overlap of their ranges if there is one. */
export function targetPh(crops: PlantType[]): { lo: number; hi: number; target: number } | null {
  if (!crops.length) return null;
  const lo = Math.max(...crops.map((c) => c.ph[0]));
  const hi = Math.min(...crops.map((c) => c.ph[1]));
  if (lo <= hi) return { lo, hi, target: Math.round(((lo + hi) / 2) * 10) / 10 };
  const mids = crops.map((c) => (c.ph[0] + c.ph[1]) / 2).sort((a, b) => a - b);
  const m = mids[Math.floor(mids.length / 2)];
  return { lo: m - 0.3, hi: m + 0.3, target: Math.round(m * 10) / 10 };
}

// Pounds per 100 sq ft to move pH by one unit (extension rules of thumb, top 6–8").
const LIME_PER_UNIT: Record<SoilType, number> = { sand: 3, 'sandy-loam': 4.5, loam: 6, 'clay-loam': 7.5, clay: 8.5, 'raised-mix': 5 };
const SULFUR_PER_UNIT: Record<SoilType, number> = { sand: 1, 'sandy-loam': 1.25, loam: 1.5, 'clay-loam': 2, clay: 2.5, 'raised-mix': 1.5 };
const MAX_LIME = 5;
const MAX_SULFUR = 2;

export interface Amendment {
  product: 'lime' | 'sulfur';
  lbTotal: number;
  lbPer100SqFt: number;
  applications: number;
  note: string;
}

export function phAmendment(bed: Bed, from: number, to: number): Amendment | null {
  const delta = to - from;
  if (Math.abs(delta) < 0.25) return null;
  const area = bed.widthFt * bed.lengthFt;
  if (delta > 0) {
    const per100 = LIME_PER_UNIT[bed.soil] * delta;
    const apps = Math.ceil(per100 / MAX_LIME);
    return {
      product: 'lime', lbPer100SqFt: per100, lbTotal: (per100 * area) / 100, applications: apps,
      note: `Garden lime (calcitic; dolomitic if magnesium is low)${apps > 1 ? `, split into ${apps} applications months apart` : ''}. Work into the top few inches; it takes 2–6 months to act — fall is ideal.`,
    };
  }
  const per100 = SULFUR_PER_UNIT[bed.soil] * -delta;
  const apps = Math.ceil(per100 / MAX_SULFUR);
  return {
    product: 'sulfur', lbPer100SqFt: per100, lbTotal: (per100 * area) / 100, applications: apps,
    note: `Elemental sulfur${apps > 1 ? `, split into ${apps} applications at least 2 months apart` : ''}. Soil microbes convert it slowly in warm, moist soil; re-test before adding more.`,
  };
}

export interface SoilAdvice {
  level: 'good' | 'info' | 'warn';
  message: string;
}

const LV: Record<NutrientLevel, number> = { low: 0, medium: 1, high: 2, 'very-high': 3 };

export function soilAdvice(bed: Bed, _site: Site, season: number): { test?: SoilTest; target: ReturnType<typeof targetPh>; amendment: Amendment | null; advice: SoilAdvice[]; offPh: PlantType[] } {
  const test = latestSoilTest(bed);
  const crops = seasonCrops(bed, season);
  const target = targetPh(crops);
  const advice: SoilAdvice[] = [];
  let amendment: Amendment | null = null;
  const offPh: PlantType[] = [];
  if (!test) {
    advice.push({ level: 'info', message: 'No soil test yet. A basic pH + nutrient test (extension lab or kit) every 2–3 years prevents most feeding mistakes.' });
    return { test, target, amendment, advice, offPh };
  }
  const ageYears = (Date.now() - new Date(test.date).getTime()) / (365 * 86400000);
  if (ageYears > 3) advice.push({ level: 'info', message: `Soil test is ${Math.floor(ageYears)} years old — time to re-test.` });
  for (const c of crops) if (test.ph < c.ph[0] - 0.2 || test.ph > c.ph[1] + 0.2) offPh.push(c);
  if (target) {
    if (test.ph < target.lo - 0.1 || test.ph > target.hi + 0.1) amendment = phAmendment(bed, test.ph, target.target);
    if (!offPh.length) advice.push({ level: 'good', message: `pH ${test.ph} suits everything planned (${target.lo.toFixed(1)}–${target.hi.toFixed(1)}).` });
    else advice.push({ level: 'warn', message: `pH ${test.ph} is outside the preferred range for ${offPh.map((c) => `${c.name} (${c.ph[0]}–${c.ph[1]})`).join(', ')}.` });
  }
  const heavy = crops.filter((c) => c.feeder === 'heavy').map((c) => c.name);
  if (test.n && LV[test.n] <= 1 && heavy.length)
    advice.push({ level: 'warn', message: `Nitrogen is ${test.n} and you're growing heavy feeders (${heavy.slice(0, 4).join(', ')}): work in 1" of compost plus a nitrogen source (feather/blood meal, ~1 lb per 100 sq ft) before planting, and side-dress mid-season.` });
  if (test.p === 'low') advice.push({ level: 'warn', message: 'Phosphorus is low: add bone meal or rock phosphate (~2 lb per 100 sq ft) — important for roots and fruiting.' });
  if (test.p === 'very-high') advice.push({ level: 'info', message: 'Phosphorus is very high: skip manure and P-containing fertilizers; use low-P compost or leaf mold.' });
  if (test.k === 'low') advice.push({ level: 'warn', message: 'Potassium is low: add sulfate of potash (~0.5 lb per 100 sq ft) or greensand — supports fruit quality and disease resistance.' });
  if (test.organicMatterPct != null) {
    const minOm = bed.soil === 'raised-mix' ? 8 : 4;
    if (test.organicMatterPct < minOm) advice.push({ level: 'warn', message: `Organic matter ${test.organicMatterPct}% is low for ${bed.soil === 'raised-mix' ? 'a raised bed' : 'garden soil'} (aim ≥ ${minOm}%): top-dress with 1–2" of compost each season.` });
    else advice.push({ level: 'good', message: `Organic matter ${test.organicMatterPct}% is healthy.` });
  }
  return { test, target, amendment, advice, offPh };
}

/** Cubic feet (and 1-cu-ft bags) of compost for a top-dressing of `inches` over the bed. */
export function compostNeeded(bed: Bed, inches = 1) {
  const cuft = (bed.widthFt * bed.lengthFt * inches) / 12;
  return { cuft, bags: Math.ceil(cuft), cuyd: cuft / 27 };
}

/** Volume to fill a new bed with Mel's-mix style blend (1/3 compost, 1/3 peat or coir, 1/3 coarse vermiculite). */
export function bedFillMix(bed: Bed) {
  const cuft = (bed.widthFt * bed.lengthFt * bed.soilDepthIn) / 12;
  return { cuft, each: cuft / 3 };
}
