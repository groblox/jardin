// Shared domain model. Layout units are feet (square-foot gardening grid);
// physics (water, temperature, radiation) is metric internally and converted for display.

export type SoilType = 'sand' | 'sandy-loam' | 'loam' | 'clay-loam' | 'clay' | 'raised-mix';

/** Map coordinates: x grows right, y grows down, in feet from the top-left corner of the property. */
export type Pt = [number, number];

interface ObstacleBase {
  id: string;
  name: string;
}

/** A vertical prism (house, garage, shed, wall block). */
export interface BuildingObstacle extends ObstacleBase {
  kind: 'building';
  points: Pt[];
  heightFt: number;
}

/** Tree crown modelled as an ellipsoid between trunk height and total height. */
export interface TreeObstacle extends ObstacleBase {
  kind: 'tree';
  x: number;
  y: number;
  canopyRadiusFt: number;
  heightFt: number;
  trunkHeightFt: number;
  deciduous: boolean;
}

/** A thin vertical barrier: fence, hedge, trellis. transmittance 0 = solid. */
export interface FenceObstacle extends ObstacleBase {
  kind: 'fence';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  heightFt: number;
  transmittance: number;
}

export type Obstacle = BuildingObstacle | TreeObstacle | FenceObstacle;

export interface Site {
  name: string;
  lat: number;
  lon: number;
  /** Property extent in feet. */
  widthFt: number;
  depthFt: number;
  /** Map bearing (degrees clockwise from "up" on the map) where true north points. */
  northDeg: number;
  /** Average last spring / first fall frost, "MM-DD". */
  lastFrost: string;
  firstFrost: string;
  obstacles: Obstacle[];
  /** Aerial photo / plan drawn under the map for tracing. */
  underlay?: { dataUrl: string; x: number; y: number; widthFt: number; opacity: number };
}

export interface BedPlanting {
  id: string;
  plantId: string;
  col: number;
  row: number;
  /** Season (year of the spring last frost) this planting belongs to. */
  season: number;
  /** Planned date it goes into the bed (sow or transplant). */
  plannedOn?: string;
  /** ISO date (YYYY-MM-DD) actually seeded or transplanted into the bed. */
  plantedOn?: string;
  /** Date the crop was pulled; frees the square. */
  removedOn?: string;
  method: 'direct' | 'transplant';
  /** Overrides the plant's default plants-per-square. */
  count?: number;
}

export type NutrientLevel = 'low' | 'medium' | 'high' | 'very-high';

export interface SoilTest {
  date: string;
  ph: number;
  organicMatterPct?: number;
  n?: NutrientLevel;
  p?: NutrientLevel;
  k?: NutrientLevel;
}

export type IrrigationMode = 'off' | 'suggest' | 'auto';

export interface BedIrrigation {
  /** HA entity that opens water to this bed: switch.*, valve.* or input_boolean.* */
  valveEntity?: string;
  /** HA soil moisture sensor (%), e.g. sensor.bed1_soil_moisture */
  moistureEntity?: string;
  /** Raw sensor reading when soil is at wilting point / bone dry. */
  sensorDry: number;
  /** Raw sensor reading right after a thorough watering (field capacity). */
  sensorWet: number;
  /** Emitter flow for the whole bed, US gallons per minute. */
  flowGpm: number;
  /** Fraction of applied water that reaches the root zone (drip ≈ 0.9, spray ≈ 0.7). */
  efficiency: number;
  mode: IrrigationMode;
  /** Local hours during which automatic watering may start. */
  windowStartHour: number;
  windowEndHour: number;
  maxMinutes: number;
  /** Skip automatic watering when this much rain (inches) is expected in the next 24h. */
  rainSkipIn: number;
}

export interface Bed {
  id: string;
  name: string;
  x: number;
  y: number;
  widthFt: number;
  lengthFt: number;
  /** Raised-bed height; used as the height at which sunlight is evaluated. */
  heightFt: number;
  soilDepthIn: number;
  soil: SoilType;
  mulched: boolean;
  plantings: BedPlanting[];
  irrigation: BedIrrigation;
  soilTests?: SoilTest[];
  /** Cached result of the latest growing-season sun analysis for this bed's footprint. */
  analysis?: { sunHours: number; maxSunHours: number; dli: number; computedAt: string };
}

export type JournalKind = 'harvest' | 'note' | 'pest' | 'disease' | 'treatment' | 'fertilize' | 'amend' | 'sow' | 'other';

export interface JournalEntry {
  id: string;
  date: string;
  kind: JournalKind;
  bedId?: string;
  plantingId?: string;
  plantId?: string;
  /** Harvest quantity. */
  qty?: number;
  unit?: 'lb' | 'oz' | 'kg' | 'g' | 'count' | 'bunch';
  text?: string;
}

export interface NotifySettings {
  /** HA notify service, e.g. "notify.mobile_app_pixel_8". */
  service?: string;
  dailyDigest: boolean;
  digestHour: number;
  frostAlerts: boolean;
  /** Publish per-bed sensors (soil water, next watering) into Home Assistant. */
  publishSensors: boolean;
}

export interface Garden {
  version: 1;
  site: Site;
  beds: Bed[];
  journal: JournalEntry[];
  notify: NotifySettings;
  updatedAt: string;
}

export interface IrrigationEvent {
  id: string;
  bedId: string;
  /** ISO timestamp */
  start: string;
  minutes: number;
  /** Net depth delivered to the root zone, mm. */
  depthMm: number;
  source: 'manual' | 'auto';
  note?: string;
}

export interface DailyWeather {
  date: string; // YYYY-MM-DD local
  tMaxC: number;
  tMinC: number;
  precipMm: number;
  precipProb?: number;
  et0Mm: number;
  radiationMJ?: number;
  sunshineH?: number;
  weatherCode?: number;
  forecast: boolean;
}

export interface HourlyWeather {
  /** Local time "YYYY-MM-DDTHH:00" */
  time: string[];
  tempC: number[];
  rh: number[];
  precipMm: number[];
}

export interface WeatherBundle {
  lat: number;
  lon: number;
  timezone: string;
  utcOffsetSeconds: number;
  today: string;
  daily: DailyWeather[];
  hourly?: HourlyWeather;
  fetchedAt: string;
}
