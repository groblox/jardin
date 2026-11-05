// Single-hue (amber) sequential ramp for sunlight magnitude. Lightest = least sun, so the
// near-zero end recedes into the surface; dark mode uses its own steps, not a flip.
const LIGHT = ['#f1ede4', '#f6dfaa', '#f2c35f', '#e49b24', '#c0700d', '#8a4c06'];
const DARK = ['#24221f', '#45361b', '#735214', '#a8740f', '#d99a1f', '#ffc95a'];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function rampRGB(t: number, dark = isDark()): [number, number, number] {
  const stops = (dark ? DARK : LIGHT).map(hex);
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  return [0, 1, 2].map((k) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f)) as [number, number, number];
}

export function rampCss(t: number, dark = isDark()): string {
  const [r, g, b] = rampRGB(t, dark);
  return `rgb(${r},${g},${b})`;
}

export function rampGradient(dark = isDark()): string {
  return `linear-gradient(90deg, ${(dark ? DARK : LIGHT).join(',')})`;
}

export const SUN_SCALE_MAX = 12; // hours
export const DLI_SCALE_MAX = 50; // mol/m²/day

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
