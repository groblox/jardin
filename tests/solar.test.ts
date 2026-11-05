import { describe, it, expect } from 'vitest';
import { sunPosition, sunTimes, clearSky } from '../src/core/solar.ts';

describe('sunPosition', () => {
  it('matches NOAA reference for Boulder at summer solstice noon', () => {
    // NOAA calculator: 2020-06-21 19:00 UTC, 40.0N 105.0W → el ≈ 73.4°, az ≈ 175°
    const p = sunPosition(new Date(Date.UTC(2020, 5, 21, 19, 0)), 40, -105);
    expect(p.elevation).toBeGreaterThan(72.5);
    expect(p.elevation).toBeLessThan(74);
    expect(p.azimuth).toBeGreaterThan(165);
    expect(p.azimuth).toBeLessThan(185);
  });

  it('rises roughly due east at the equinox', () => {
    const t = sunTimes(2024, 2, 20, 0, 0);
    const p = sunPosition(t.sunrise!, 0, 0);
    expect(Math.abs(p.azimuth - 90)).toBeLessThan(2);
    expect(Math.abs(t.dayLengthH - 12.1)).toBeLessThan(0.3);
  });

  it('gives longer days in summer than winter at 45N', () => {
    const summer = sunTimes(2024, 5, 21, 45, 0).dayLengthH;
    const winter = sunTimes(2024, 11, 21, 45, 0).dayLengthH;
    expect(summer).toBeGreaterThan(15);
    expect(winter).toBeLessThan(9);
  });

  it('southern hemisphere sun is in the north at noon', () => {
    const p = sunPosition(new Date(Date.UTC(2024, 5, 21, 2, 0)), -33.9, 151.2); // Sydney ~noon
    expect(p.azimuth < 30 || p.azimuth > 330).toBe(true);
  });

  it('clear sky irradiance is plausible', () => {
    expect(clearSky(90).ghi).toBeGreaterThan(900);
    expect(clearSky(90).ghi).toBeLessThan(1150);
    expect(clearSky(-5).ghi).toBe(0);
  });
});
