// Solar position (NOAA / Meeus low-precision algorithm, accurate to ~0.01° for 1900–2100)
// and a simple clear-sky irradiance model.
import { DEG, mod } from './util.ts';

export interface SunPos {
  /** Degrees clockwise from true north. */
  azimuth: number;
  /** Degrees above the horizon, refraction-corrected. */
  elevation: number;
  declination: number;
}

export function sunPosition(date: Date, lat: number, lon: number): SunPos {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * DEG;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const omega = (125.04 - 1934.136 * T) * DEG;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * DEG;
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * DEG;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));

  const y = Math.tan(eps / 2) ** 2;
  const L0r = L0 * DEG;
  const eqTime =
    (4 / DEG) *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr));

  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const tst = mod(utcMin + eqTime + 4 * lon, 1440);
  const H = (tst / 4 - 180) * DEG;
  const phi = lat * DEG;

  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  let elev = 90 - zenith / DEG;
  const az = mod(
    Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / DEG + 180,
    360,
  );

  // Atmospheric refraction (NOAA approximation).
  if (elev > -0.575 && elev <= 85) {
    const te = Math.tan(elev * DEG);
    const r =
      elev > 5
        ? 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5
        : 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
    elev += r / 3600;
  } else if (elev <= -0.575) {
    elev += -20.774 / Math.tan(elev * DEG) / 3600;
  }
  return { azimuth: az, elevation: elev, declination: decl / DEG };
}

/** Start of the local *solar* day (solar midnight) for a calendar date, as a UTC instant. */
export function solarDayStart(year: number, month0: number, day: number, lon: number): Date {
  return new Date(Date.UTC(year, month0, day) - (lon / 15) * 3600000);
}

export interface ClearSky {
  /** Direct normal irradiance, W/m² */
  dni: number;
  /** Diffuse horizontal irradiance, W/m² */
  dhi: number;
  /** Global horizontal irradiance, W/m² */
  ghi: number;
}

/** Meinel clear-sky model with Kasten–Young air mass. Crude but well-behaved; good for relative comparisons. */
export function clearSky(elevationDeg: number): ClearSky {
  if (elevationDeg <= 0) return { dni: 0, dhi: 0, ghi: 0 };
  const s = Math.sin(elevationDeg * DEG);
  const am = 1 / (s + 0.50572 * (elevationDeg + 6.07995) ** -1.6364);
  const dni = 1361 * 0.7 ** (am ** 0.678);
  const dhi = 0.1 * dni * Math.max(s, 0.1) + 15 * s;
  return { dni, dhi, ghi: dni * s + dhi };
}

/** µmol/m²/s of PAR per W/m² of global solar irradiance (≈45% PAR × 4.57 µmol/J). */
export const PAR_PER_W = 2.05;

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  solarNoon: Date;
  dayLengthH: number;
  noonElevation: number;
}

/** Sunrise/sunset by scanning the solar day (robust at high latitudes). */
export function sunTimes(year: number, month0: number, day: number, lat: number, lon: number): SunTimes {
  const start = solarDayStart(year, month0, day, lon).getTime();
  const step = 2 * 60000;
  let sunrise: Date | null = null;
  let sunset: Date | null = null;
  let up = 0;
  let best = -90;
  let noon = new Date(start + 12 * 3600000);
  let prev = sunPosition(new Date(start), lat, lon).elevation;
  for (let t = start + step; t <= start + 86400000; t += step) {
    const el = sunPosition(new Date(t), lat, lon).elevation;
    if (prev <= -0.833 && el > -0.833) sunrise = new Date(t - step * ((el + 0.833) / (el - prev)));
    if (prev > -0.833 && el <= -0.833) sunset = new Date(t - step * ((el + 0.833) / (el - prev)));
    if (el > -0.833) up += step;
    if (el > best) {
      best = el;
      noon = new Date(t);
    }
    prev = el;
  }
  return { sunrise, sunset, solarNoon: noon, dayLengthH: up / 3600000, noonElevation: best };
}
