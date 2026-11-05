// Plant library for square-foot gardening. Values are typical home-garden figures;
// days to maturity count from direct sowing, or from transplanting for transplanted crops.

export type SunNeed = 'full' | 'partial' | 'shade';
export type Season = 'cool' | 'warm';

export interface PlantType {
  id: string;
  name: string;
  icon: string;
  family: string;
  /** Plants per 1×1 ft square (for span = 1). */
  perSquare: number;
  /** Squares per side the plant occupies (2 → 2×2 ft for one plant). */
  span: 1 | 2 | 3;
  sun: SunNeed;
  minSunHours: number;
  idealSunHours: number;
  season: Season;
  frost: 'tender' | 'half-hardy' | 'hardy';
  daysToMaturity: number;
  /** Days of harvest after first maturity. */
  harvestDays: number;
  /** Weeks before last frost to start indoors (undefined = don't start indoors). */
  startIndoorsWeeks?: number;
  /** Weeks relative to last frost to transplant out (negative = before). */
  transplantWeeks?: number;
  /** Direct-sow window, weeks relative to last frost. */
  directSow?: [number, number];
  /** Can be sown for a fall crop: weeks before first frost. */
  fallSowWeeks?: number;
  /** Succession interval in days for continuous harvest. */
  successionDays?: number;
  baseTempC: number;
  optTempC: number;
  maxTempC: number;
  /** Bolts / quality drops in heat. */
  boltsInHeat?: boolean;
  /** FAO-56 crop coefficients: initial, mid-season, late. */
  kc: [number, number, number];
  rootDepthIn: number;
  heightFt: number;
  companions: string[];
  avoid: string[];
  notes?: string;
  /** Nutrient demand; legumes fix their own nitrogen. */
  feeder: Feeder;
  /** Preferred soil pH range. */
  ph: [number, number];
  /** Typical harvest per square foot occupied, lb (home-garden, SFG spacing). */
  yieldLbPerSqFt: number;
  /** Stays in the bed year to year until removed. */
  perennial?: boolean;
}

export type Feeder = 'heavy' | 'medium' | 'light' | 'fixer';

type BaseFields = Omit<PlantType, 'feeder' | 'ph' | 'yieldLbPerSqFt' | 'perennial'>;
const p = (x: BaseFields) => x as PlantType;

export const PLANTS: PlantType[] = [
  p({ id: 'tomato', name: 'Tomato', icon: '🍅', family: 'Solanaceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'tender', daysToMaturity: 70, harvestDays: 60, startIndoorsWeeks: 7, transplantWeeks: 2, baseTempC: 10, optTempC: 25, maxTempC: 35, kc: [0.6, 1.15, 0.8], rootDepthIn: 24, heightFt: 5, companions: ['basil', 'carrot', 'marigold', 'onion', 'parsley', 'lettuce'], avoid: ['potato', 'fennel', 'corn', 'cabbage', 'broccoli'], notes: 'Indeterminate varieties need a trellis; place on the north side of the bed.' }),
  p({ id: 'cherry-tomato', name: 'Cherry tomato', icon: '🍒', family: 'Solanaceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'tender', daysToMaturity: 60, harvestDays: 75, startIndoorsWeeks: 7, transplantWeeks: 2, baseTempC: 10, optTempC: 25, maxTempC: 35, kc: [0.6, 1.15, 0.8], rootDepthIn: 24, heightFt: 6, companions: ['basil', 'carrot', 'marigold', 'onion'], avoid: ['potato', 'fennel', 'corn'] }),
  p({ id: 'pepper', name: 'Pepper', icon: '🫑', family: 'Solanaceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'tender', daysToMaturity: 70, harvestDays: 60, startIndoorsWeeks: 9, transplantWeeks: 3, baseTempC: 12, optTempC: 26, maxTempC: 35, kc: [0.6, 1.05, 0.9], rootDepthIn: 18, heightFt: 2.5, companions: ['basil', 'onion', 'carrot', 'tomato'], avoid: ['fennel', 'bean'] }),
  p({ id: 'eggplant', name: 'Eggplant', icon: '🍆', family: 'Solanaceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'tender', daysToMaturity: 75, harvestDays: 50, startIndoorsWeeks: 9, transplantWeeks: 3, baseTempC: 13, optTempC: 27, maxTempC: 35, kc: [0.6, 1.05, 0.9], rootDepthIn: 18, heightFt: 3, companions: ['bean', 'pepper', 'marigold'], avoid: ['fennel'] }),
  p({ id: 'potato', name: 'Potato', icon: '🥔', family: 'Solanaceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'cool', frost: 'half-hardy', daysToMaturity: 90, harvestDays: 30, directSow: [-3, 2], baseTempC: 7, optTempC: 20, maxTempC: 29, kc: [0.5, 1.15, 0.75], rootDepthIn: 18, heightFt: 2.5, companions: ['bean', 'cabbage', 'marigold', 'pea'], avoid: ['tomato', 'cucumber', 'squash', 'sunflower'] }),
  p({ id: 'lettuce', name: 'Lettuce (head)', icon: '🥬', family: 'Asteraceae', perSquare: 4, span: 1, sun: 'partial', minSunHours: 4, idealSunHours: 6, season: 'cool', frost: 'half-hardy', daysToMaturity: 50, harvestDays: 21, startIndoorsWeeks: 6, transplantWeeks: -2, directSow: [-4, 4], fallSowWeeks: 8, successionDays: 14, baseTempC: 4, optTempC: 18, maxTempC: 27, boltsInHeat: true, kc: [0.7, 1.0, 0.95], rootDepthIn: 8, heightFt: 0.8, companions: ['carrot', 'radish', 'strawberry', 'onion', 'cucumber'], avoid: ['parsley'] }),
  p({ id: 'leaf-lettuce', name: 'Leaf lettuce', icon: '🥗', family: 'Asteraceae', perSquare: 4, span: 1, sun: 'partial', minSunHours: 3, idealSunHours: 6, season: 'cool', frost: 'half-hardy', daysToMaturity: 35, harvestDays: 35, directSow: [-4, 6], fallSowWeeks: 6, successionDays: 14, baseTempC: 4, optTempC: 18, maxTempC: 27, boltsInHeat: true, kc: [0.7, 1.0, 0.95], rootDepthIn: 8, heightFt: 0.6, companions: ['carrot', 'radish', 'onion'], avoid: [] }),
  p({ id: 'spinach', name: 'Spinach', icon: '🌿', family: 'Amaranthaceae', perSquare: 9, span: 1, sun: 'partial', minSunHours: 3, idealSunHours: 6, season: 'cool', frost: 'hardy', daysToMaturity: 40, harvestDays: 21, directSow: [-6, 2], fallSowWeeks: 6, successionDays: 14, baseTempC: 2, optTempC: 16, maxTempC: 24, boltsInHeat: true, kc: [0.7, 1.0, 0.95], rootDepthIn: 10, heightFt: 0.6, companions: ['strawberry', 'pea', 'radish'], avoid: [] }),
  p({ id: 'kale', name: 'Kale', icon: '🥬', family: 'Brassicaceae', perSquare: 1, span: 1, sun: 'partial', minSunHours: 4, idealSunHours: 6, season: 'cool', frost: 'hardy', daysToMaturity: 55, harvestDays: 90, startIndoorsWeeks: 6, transplantWeeks: -3, directSow: [-4, 2], fallSowWeeks: 10, baseTempC: 4, optTempC: 18, maxTempC: 28, kc: [0.7, 1.05, 0.95], rootDepthIn: 18, heightFt: 2, companions: ['onion', 'beet', 'dill', 'potato'], avoid: ['strawberry', 'tomato'] }),
  p({ id: 'chard', name: 'Swiss chard', icon: '🌱', family: 'Amaranthaceae', perSquare: 4, span: 1, sun: 'partial', minSunHours: 4, idealSunHours: 6, season: 'cool', frost: 'half-hardy', daysToMaturity: 55, harvestDays: 100, directSow: [-2, 4], fallSowWeeks: 10, baseTempC: 4, optTempC: 20, maxTempC: 30, kc: [0.7, 1.0, 0.9], rootDepthIn: 18, heightFt: 1.5, companions: ['bean', 'onion', 'cabbage'], avoid: [] }),
  p({ id: 'broccoli', name: 'Broccoli', icon: '🥦', family: 'Brassicaceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'cool', frost: 'hardy', daysToMaturity: 65, harvestDays: 21, startIndoorsWeeks: 7, transplantWeeks: -2, fallSowWeeks: 12, baseTempC: 4, optTempC: 18, maxTempC: 26, boltsInHeat: true, kc: [0.7, 1.05, 0.95], rootDepthIn: 18, heightFt: 2.5, companions: ['onion', 'dill', 'beet', 'potato', 'chamomile'], avoid: ['tomato', 'strawberry', 'pepper'] }),
  p({ id: 'cabbage', name: 'Cabbage', icon: '🥬', family: 'Brassicaceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'cool', frost: 'hardy', daysToMaturity: 70, harvestDays: 21, startIndoorsWeeks: 7, transplantWeeks: -2, fallSowWeeks: 12, baseTempC: 4, optTempC: 18, maxTempC: 26, kc: [0.7, 1.05, 0.95], rootDepthIn: 18, heightFt: 1.5, companions: ['onion', 'dill', 'celery', 'potato'], avoid: ['tomato', 'strawberry'] }),
  p({ id: 'cauliflower', name: 'Cauliflower', icon: '🥦', family: 'Brassicaceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'cool', frost: 'half-hardy', daysToMaturity: 70, harvestDays: 14, startIndoorsWeeks: 6, transplantWeeks: -1, fallSowWeeks: 12, baseTempC: 4, optTempC: 18, maxTempC: 25, boltsInHeat: true, kc: [0.7, 1.05, 0.95], rootDepthIn: 18, heightFt: 2, companions: ['onion', 'celery', 'bean'], avoid: ['tomato', 'strawberry'] }),
  p({ id: 'carrot', name: 'Carrot', icon: '🥕', family: 'Apiaceae', perSquare: 16, span: 1, sun: 'full', minSunHours: 5, idealSunHours: 8, season: 'cool', frost: 'half-hardy', daysToMaturity: 70, harvestDays: 30, directSow: [-3, 6], fallSowWeeks: 12, successionDays: 21, baseTempC: 4, optTempC: 18, maxTempC: 28, kc: [0.7, 1.05, 0.95], rootDepthIn: 12, heightFt: 1, companions: ['tomato', 'onion', 'lettuce', 'radish', 'pea', 'chive'], avoid: ['dill', 'fennel', 'parsnip'] }),
  p({ id: 'beet', name: 'Beet', icon: '🟣', family: 'Amaranthaceae', perSquare: 9, span: 1, sun: 'full', minSunHours: 5, idealSunHours: 8, season: 'cool', frost: 'half-hardy', daysToMaturity: 55, harvestDays: 21, directSow: [-3, 6], fallSowWeeks: 10, successionDays: 21, baseTempC: 4, optTempC: 18, maxTempC: 28, kc: [0.5, 1.05, 0.95], rootDepthIn: 12, heightFt: 1, companions: ['onion', 'lettuce', 'cabbage', 'kale'], avoid: ['bean'] }),
  p({ id: 'radish', name: 'Radish', icon: '🔴', family: 'Brassicaceae', perSquare: 16, span: 1, sun: 'partial', minSunHours: 4, idealSunHours: 6, season: 'cool', frost: 'hardy', daysToMaturity: 25, harvestDays: 10, directSow: [-5, 4], fallSowWeeks: 6, successionDays: 10, baseTempC: 4, optTempC: 18, maxTempC: 26, boltsInHeat: true, kc: [0.7, 0.9, 0.85], rootDepthIn: 6, heightFt: 0.5, companions: ['carrot', 'lettuce', 'pea', 'cucumber', 'spinach'], avoid: [] }),
  p({ id: 'turnip', name: 'Turnip', icon: '🧅', family: 'Brassicaceae', perSquare: 9, span: 1, sun: 'full', minSunHours: 5, idealSunHours: 6, season: 'cool', frost: 'hardy', daysToMaturity: 45, harvestDays: 21, directSow: [-4, 2], fallSowWeeks: 9, baseTempC: 4, optTempC: 18, maxTempC: 27, kc: [0.7, 1.05, 0.95], rootDepthIn: 12, heightFt: 1, companions: ['pea', 'onion'], avoid: ['potato'] }),
  p({ id: 'onion', name: 'Onion', icon: '🧅', family: 'Amaryllidaceae', perSquare: 16, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'cool', frost: 'hardy', daysToMaturity: 100, harvestDays: 21, startIndoorsWeeks: 10, transplantWeeks: -4, directSow: [-4, 0], baseTempC: 4, optTempC: 20, maxTempC: 30, kc: [0.7, 1.05, 0.75], rootDepthIn: 12, heightFt: 1.5, companions: ['carrot', 'tomato', 'lettuce', 'beet', 'cabbage', 'pepper'], avoid: ['bean', 'pea'] }),
  p({ id: 'scallion', name: 'Scallion', icon: '🌱', family: 'Amaryllidaceae', perSquare: 16, span: 1, sun: 'partial', minSunHours: 4, idealSunHours: 6, season: 'cool', frost: 'hardy', daysToMaturity: 60, harvestDays: 30, directSow: [-4, 8], fallSowWeeks: 8, successionDays: 21, baseTempC: 4, optTempC: 20, maxTempC: 30, kc: [0.7, 1.0, 1.0], rootDepthIn: 10, heightFt: 1, companions: ['carrot', 'tomato', 'lettuce'], avoid: ['bean', 'pea'] }),
  p({ id: 'garlic', name: 'Garlic', icon: '🧄', family: 'Amaryllidaceae', perSquare: 9, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'cool', frost: 'hardy', daysToMaturity: 240, harvestDays: 14, fallSowWeeks: -2, baseTempC: 0, optTempC: 18, maxTempC: 30, kc: [0.7, 1.0, 0.7], rootDepthIn: 12, heightFt: 1.5, companions: ['tomato', 'carrot', 'beet', 'strawberry'], avoid: ['bean', 'pea'], notes: 'Plant cloves in fall around first frost; harvest next summer.' }),
  p({ id: 'leek', name: 'Leek', icon: '🌱', family: 'Amaryllidaceae', perSquare: 9, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'cool', frost: 'hardy', daysToMaturity: 100, harvestDays: 60, startIndoorsWeeks: 10, transplantWeeks: -2, baseTempC: 4, optTempC: 20, maxTempC: 30, kc: [0.7, 1.0, 0.95], rootDepthIn: 12, heightFt: 1.5, companions: ['carrot', 'celery', 'onion'], avoid: ['bean', 'pea'] }),
  p({ id: 'pea', name: 'Pea', icon: '🫛', family: 'Fabaceae', perSquare: 8, span: 1, sun: 'full', minSunHours: 5, idealSunHours: 8, season: 'cool', frost: 'hardy', daysToMaturity: 60, harvestDays: 21, directSow: [-6, -1], fallSowWeeks: 10, baseTempC: 4, optTempC: 18, maxTempC: 27, kc: [0.5, 1.15, 1.1], rootDepthIn: 18, heightFt: 5, companions: ['carrot', 'radish', 'cucumber', 'bean', 'turnip', 'spinach'], avoid: ['onion', 'garlic', 'leek', 'scallion'], notes: 'Needs a trellis; tall — place on the north edge.' }),
  p({ id: 'bean', name: 'Bush bean', icon: '🫘', family: 'Fabaceae', perSquare: 9, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'tender', daysToMaturity: 55, harvestDays: 21, directSow: [1, 10], successionDays: 21, baseTempC: 10, optTempC: 24, maxTempC: 32, kc: [0.5, 1.05, 0.9], rootDepthIn: 18, heightFt: 1.5, companions: ['carrot', 'cucumber', 'potato', 'corn', 'squash', 'eggplant', 'chard'], avoid: ['onion', 'garlic', 'leek', 'scallion', 'pepper', 'beet', 'fennel'] }),
  p({ id: 'pole-bean', name: 'Pole bean', icon: '🫘', family: 'Fabaceae', perSquare: 8, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'tender', daysToMaturity: 65, harvestDays: 50, directSow: [1, 8], baseTempC: 10, optTempC: 24, maxTempC: 32, kc: [0.5, 1.05, 0.9], rootDepthIn: 18, heightFt: 7, companions: ['corn', 'squash', 'carrot', 'cucumber'], avoid: ['onion', 'garlic', 'beet', 'sunflower'], notes: 'Trellis on the north edge.' }),
  p({ id: 'cucumber', name: 'Cucumber (trellised)', icon: '🥒', family: 'Cucurbitaceae', perSquare: 2, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'tender', daysToMaturity: 55, harvestDays: 40, startIndoorsWeeks: 3, transplantWeeks: 2, directSow: [2, 8], baseTempC: 12, optTempC: 27, maxTempC: 35, kc: [0.6, 1.0, 0.75], rootDepthIn: 18, heightFt: 5, companions: ['bean', 'pea', 'radish', 'lettuce', 'dill', 'marigold'], avoid: ['potato', 'sage'] }),
  p({ id: 'zucchini', name: 'Zucchini', icon: '🥒', family: 'Cucurbitaceae', perSquare: 1, span: 2, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'tender', daysToMaturity: 50, harvestDays: 60, startIndoorsWeeks: 3, transplantWeeks: 2, directSow: [2, 6], baseTempC: 12, optTempC: 26, maxTempC: 35, kc: [0.5, 1.0, 0.8], rootDepthIn: 24, heightFt: 2.5, companions: ['bean', 'corn', 'nasturtium', 'radish'], avoid: ['potato'] }),
  p({ id: 'winter-squash', name: 'Winter squash', icon: '🎃', family: 'Cucurbitaceae', perSquare: 1, span: 2, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'tender', daysToMaturity: 95, harvestDays: 21, startIndoorsWeeks: 3, transplantWeeks: 2, directSow: [2, 5], baseTempC: 12, optTempC: 26, maxTempC: 35, kc: [0.5, 1.0, 0.8], rootDepthIn: 24, heightFt: 2, companions: ['corn', 'bean', 'nasturtium'], avoid: ['potato'] }),
  p({ id: 'melon', name: 'Melon (trellised)', icon: '🍈', family: 'Cucurbitaceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 7, idealSunHours: 9, season: 'warm', frost: 'tender', daysToMaturity: 80, harvestDays: 21, startIndoorsWeeks: 3, transplantWeeks: 2, directSow: [2, 5], baseTempC: 13, optTempC: 28, maxTempC: 36, kc: [0.5, 1.05, 0.75], rootDepthIn: 24, heightFt: 5, companions: ['corn', 'radish', 'nasturtium'], avoid: ['potato'] }),
  p({ id: 'corn', name: 'Sweet corn', icon: '🌽', family: 'Poaceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 8, idealSunHours: 10, season: 'warm', frost: 'tender', daysToMaturity: 75, harvestDays: 10, directSow: [1, 6], successionDays: 14, baseTempC: 10, optTempC: 28, maxTempC: 35, kc: [0.3, 1.2, 0.35], rootDepthIn: 30, heightFt: 7, companions: ['bean', 'pole-bean', 'squash', 'winter-squash', 'cucumber', 'melon'], avoid: ['tomato'], notes: 'Plant in blocks of at least 4×4 for pollination.' }),
  p({ id: 'basil', name: 'Basil', icon: '🌿', family: 'Lamiaceae', perSquare: 4, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'tender', daysToMaturity: 30, harvestDays: 90, startIndoorsWeeks: 6, transplantWeeks: 2, directSow: [2, 8], baseTempC: 12, optTempC: 27, maxTempC: 35, kc: [0.6, 1.0, 0.9], rootDepthIn: 12, heightFt: 1.5, companions: ['tomato', 'pepper', 'cherry-tomato'], avoid: ['sage'] }),
  p({ id: 'parsley', name: 'Parsley', icon: '🌿', family: 'Apiaceae', perSquare: 4, span: 1, sun: 'partial', minSunHours: 4, idealSunHours: 6, season: 'cool', frost: 'hardy', daysToMaturity: 70, harvestDays: 120, startIndoorsWeeks: 8, transplantWeeks: -1, directSow: [-3, 4], baseTempC: 4, optTempC: 20, maxTempC: 30, kc: [0.7, 1.0, 0.95], rootDepthIn: 12, heightFt: 1, companions: ['tomato', 'carrot', 'chive'], avoid: ['lettuce'] }),
  p({ id: 'cilantro', name: 'Cilantro', icon: '🌿', family: 'Apiaceae', perSquare: 9, span: 1, sun: 'partial', minSunHours: 4, idealSunHours: 6, season: 'cool', frost: 'half-hardy', daysToMaturity: 45, harvestDays: 21, directSow: [-2, 4], fallSowWeeks: 6, successionDays: 21, baseTempC: 4, optTempC: 18, maxTempC: 27, boltsInHeat: true, kc: [0.7, 1.0, 0.95], rootDepthIn: 10, heightFt: 1.5, companions: ['spinach', 'bean', 'pea'], avoid: ['fennel'] }),
  p({ id: 'dill', name: 'Dill', icon: '🌿', family: 'Apiaceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'half-hardy', daysToMaturity: 45, harvestDays: 40, directSow: [0, 8], baseTempC: 6, optTempC: 20, maxTempC: 30, kc: [0.7, 1.0, 0.95], rootDepthIn: 12, heightFt: 3, companions: ['cabbage', 'broccoli', 'cucumber', 'lettuce', 'onion'], avoid: ['carrot', 'tomato'] }),
  p({ id: 'chive', name: 'Chives', icon: '🌱', family: 'Amaryllidaceae', perSquare: 4, span: 1, sun: 'partial', minSunHours: 4, idealSunHours: 6, season: 'cool', frost: 'hardy', daysToMaturity: 75, harvestDays: 150, startIndoorsWeeks: 8, transplantWeeks: -2, directSow: [-4, 2], baseTempC: 4, optTempC: 20, maxTempC: 30, kc: [0.7, 1.0, 1.0], rootDepthIn: 10, heightFt: 1, companions: ['carrot', 'tomato', 'parsley'], avoid: ['bean', 'pea'] }),
  p({ id: 'mint', name: 'Mint (contained)', icon: '🌿', family: 'Lamiaceae', perSquare: 1, span: 1, sun: 'shade', minSunHours: 3, idealSunHours: 5, season: 'cool', frost: 'hardy', daysToMaturity: 60, harvestDays: 150, transplantWeeks: 0, baseTempC: 5, optTempC: 22, maxTempC: 32, kc: [0.7, 1.05, 1.0], rootDepthIn: 12, heightFt: 1.5, companions: ['cabbage', 'tomato'], avoid: [], notes: 'Spreads aggressively — grow in a buried pot.' }),
  p({ id: 'thyme', name: 'Thyme', icon: '🌿', family: 'Lamiaceae', perSquare: 4, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'hardy', daysToMaturity: 75, harvestDays: 150, startIndoorsWeeks: 8, transplantWeeks: 0, baseTempC: 6, optTempC: 22, maxTempC: 34, kc: [0.5, 0.8, 0.8], rootDepthIn: 10, heightFt: 0.8, companions: ['cabbage', 'tomato', 'strawberry'], avoid: [] }),
  p({ id: 'sage', name: 'Sage', icon: '🌿', family: 'Lamiaceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'hardy', daysToMaturity: 75, harvestDays: 150, startIndoorsWeeks: 8, transplantWeeks: 0, baseTempC: 6, optTempC: 22, maxTempC: 34, kc: [0.5, 0.8, 0.8], rootDepthIn: 12, heightFt: 2, companions: ['cabbage', 'carrot', 'rosemary'], avoid: ['cucumber', 'basil'] }),
  p({ id: 'strawberry', name: 'Strawberry', icon: '🍓', family: 'Rosaceae', perSquare: 4, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'cool', frost: 'hardy', daysToMaturity: 90, harvestDays: 30, transplantWeeks: -2, baseTempC: 5, optTempC: 20, maxTempC: 30, kc: [0.4, 0.85, 0.75], rootDepthIn: 12, heightFt: 0.7, companions: ['spinach', 'lettuce', 'bean', 'thyme', 'onion'], avoid: ['cabbage', 'broccoli', 'kale', 'cauliflower'] }),
  p({ id: 'marigold', name: 'Marigold', icon: '🌼', family: 'Asteraceae', perSquare: 4, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'tender', daysToMaturity: 50, harvestDays: 100, startIndoorsWeeks: 6, transplantWeeks: 1, directSow: [1, 6], baseTempC: 10, optTempC: 24, maxTempC: 35, kc: [0.6, 0.9, 0.8], rootDepthIn: 10, heightFt: 1, companions: ['tomato', 'pepper', 'cucumber', 'squash', 'bean'], avoid: [], notes: 'Pest-deterrent border plant.' }),
  p({ id: 'nasturtium', name: 'Nasturtium', icon: '🌺', family: 'Tropaeolaceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 6, idealSunHours: 8, season: 'warm', frost: 'tender', daysToMaturity: 50, harvestDays: 90, directSow: [1, 6], baseTempC: 10, optTempC: 22, maxTempC: 32, kc: [0.6, 0.9, 0.8], rootDepthIn: 10, heightFt: 1, companions: ['cucumber', 'squash', 'zucchini', 'winter-squash', 'tomato', 'melon'], avoid: [], notes: 'Trap crop for aphids.' }),
  p({ id: 'sunflower', name: 'Sunflower', icon: '🌻', family: 'Asteraceae', perSquare: 1, span: 1, sun: 'full', minSunHours: 8, idealSunHours: 10, season: 'warm', frost: 'tender', daysToMaturity: 80, harvestDays: 21, directSow: [1, 6], baseTempC: 8, optTempC: 25, maxTempC: 35, kc: [0.35, 1.1, 0.35], rootDepthIn: 30, heightFt: 8, companions: ['cucumber', 'corn'], avoid: ['potato', 'pole-bean'], notes: 'Very tall — will shade neighbours to the north.' }),
];

// feeder, pH range, yield (lb/sq ft), perennial
const EXTRA: Record<string, [Feeder, number, number, number, boolean?]> = {
  tomato: ['heavy', 6.0, 6.8, 6], 'cherry-tomato': ['heavy', 6.0, 6.8, 5], pepper: ['heavy', 6.0, 6.8, 2],
  eggplant: ['heavy', 5.5, 6.8, 3], potato: ['heavy', 5.0, 6.5, 2.5], lettuce: ['medium', 6.0, 7.0, 2],
  'leaf-lettuce': ['medium', 6.0, 7.0, 1], spinach: ['medium', 6.5, 7.5, 0.6], kale: ['heavy', 6.0, 7.5, 1.5],
  chard: ['medium', 6.0, 7.5, 2], broccoli: ['heavy', 6.0, 7.0, 0.75], cabbage: ['heavy', 6.0, 7.5, 3],
  cauliflower: ['heavy', 6.0, 7.0, 1.5], carrot: ['light', 6.0, 7.0, 1.5], beet: ['medium', 6.0, 7.5, 1.5],
  radish: ['light', 6.0, 7.0, 0.75], turnip: ['light', 6.0, 7.5, 2], onion: ['medium', 6.0, 7.0, 2.5],
  scallion: ['light', 6.0, 7.0, 1], garlic: ['medium', 6.0, 7.0, 1], leek: ['heavy', 6.0, 7.5, 2],
  pea: ['fixer', 6.0, 7.5, 0.5], bean: ['fixer', 6.0, 7.0, 1], 'pole-bean': ['fixer', 6.0, 7.0, 1.5],
  cucumber: ['heavy', 5.8, 7.0, 4], zucchini: ['heavy', 6.0, 7.0, 2], 'winter-squash': ['heavy', 6.0, 7.0, 1.5],
  melon: ['heavy', 6.0, 7.0, 3], corn: ['heavy', 5.8, 7.0, 0.6], basil: ['medium', 6.0, 7.5, 0.5],
  parsley: ['light', 6.0, 7.0, 0.5], cilantro: ['light', 6.2, 6.8, 0.3], dill: ['light', 5.8, 7.0, 0.2],
  chive: ['light', 6.0, 7.0, 0.3, true], mint: ['light', 6.0, 7.0, 0.5, true], thyme: ['light', 6.0, 8.0, 0.2, true],
  sage: ['light', 6.0, 7.0, 0.2, true], strawberry: ['medium', 5.5, 6.8, 0.5, true], marigold: ['light', 6.0, 7.0, 0],
  nasturtium: ['light', 6.0, 7.5, 0.1], sunflower: ['medium', 6.0, 7.5, 0.2],
};
for (const pl of PLANTS) {
  const e = EXTRA[pl.id];
  if (!e) throw new Error(`Missing plant extras for ${pl.id}`);
  pl.feeder = e[0];
  pl.ph = [e[1], e[2]];
  pl.yieldLbPerSqFt = e[3];
  if (e[4]) pl.perennial = true;
}

/** Years to wait before growing the same family in the same spot (soil-borne disease & pest build-up). */
export const ROTATION_YEARS: Record<string, number> = {
  Solanaceae: 3,
  Brassicaceae: 3,
  Cucurbitaceae: 2,
  Amaryllidaceae: 3,
  Fabaceae: 2,
  Apiaceae: 2,
  Amaranthaceae: 2,
  Asteraceae: 1,
  Poaceae: 1,
};

export const PLANT_BY_ID: Record<string, PlantType> = Object.fromEntries(PLANTS.map((x) => [x.id, x]));

export function getPlant(id: string): PlantType {
  const pl = PLANT_BY_ID[id];
  if (!pl) throw new Error(`Unknown plant ${id}`);
  return pl;
}
