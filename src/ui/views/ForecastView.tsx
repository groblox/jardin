import { useMemo } from 'react';
import { useGarden } from '../store.tsx';
import { WEATHER_CODES } from '../../core/weather.ts';
import { gdd, simulateGrowth } from '../../core/growth.ts';
import { daySamples, pointDay } from '../../core/shade.ts';
import { cToF, fmtDate, mmToIn, parseIso } from '../../core/util.ts';
import { Chart } from '../components/Chart.tsx';
import { Status } from '../components/Field.tsx';
import { rampCss, DLI_SCALE_MAX } from '../sunColors.ts';
import { PLANT_BY_ID } from '../../core/plants.ts';

export function ForecastView() {
  const { garden, weather, weatherError, refreshWeather } = useGarden();
  const site = garden.site;

  const forecast = useMemo(() => (weather ? weather.daily.filter((d) => d.date >= weather.today) : []), [weather]);

  const alerts = useMemo(() => {
    if (!weather) return [];
    const out: { date: string; level: 'warn' | 'bad'; message: string }[] = [];
    for (const bed of garden.beds)
      for (const pl of bed.plantings) {
        if (!pl.plantedOn) continue;
        const r = simulateGrowth(pl, weather.daily, { today: weather.today, sunHours: bed.analysis?.sunHours, horizonDays: 16 });
        r?.warnings.forEach((w) => out.push({ date: w.date, level: w.level, message: `${bed.name}: ${w.message}` }));
      }
    // Collapse duplicates (same message & date).
    const seen = new Set<string>();
    return out.filter((a) => (seen.has(a.date + a.message) ? false : (seen.add(a.date + a.message), true))).sort((a, b) => a.date.localeCompare(b.date));
  }, [garden.beds, weather]);

  const bedLight = useMemo(() => {
    const days = forecast.slice(0, 7);
    return garden.beds.map((bed) => ({
      bed,
      days: days.map((d) => {
        const date = parseIso(d.date);
        const clearMJ = daySamples(site, date, 15).reduce((s, x) => s + (x.dni * x.sinEl + x.dhi) * x.dtH * 3600, 0) / 1e6;
        const clearness = d.radiationMJ != null && clearMJ > 0 ? Math.min(1.1, Math.max(0.05, d.radiationMJ / clearMJ)) : 1;
        const p = pointDay(site, bed.x + bed.widthFt / 2, bed.y + bed.lengthFt / 2, bed.heightFt, date, 15);
        const sunFrac = d.sunshineH != null && p.daylightH ? Math.min(1, d.sunshineH / p.daylightH) : clearness;
        return { date: d.date, dli: p.dli * clearness, sun: p.sunHours * sunFrac };
      }),
    }));
  }, [garden.beds, forecast, site]);

  if (weatherError) return <div className="view"><Status tone="critical">Weather unavailable: {weatherError}</Status> <button onClick={refreshWeather}>Retry</button></div>;
  if (!weather) return <div className="view"><p className="muted">Loading forecast…</p></div>;

  const frostDays = forecast.filter((d) => d.tMinC <= 0);
  const labels = forecast.map((d) => fmtDate(d.date, { weekday: 'short', day: 'numeric' }));

  return (
    <div className="view forecast-view">
      <div className="row between wrap gap">
        <h2>16-day garden forecast</h2>
        <span className="muted small">Open-Meteo · {weather.timezone} · updated {new Date(weather.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} <button className="link" onClick={refreshWeather}>refresh</button></span>
      </div>

      {(alerts.length > 0 || frostDays.length > 0) && (
        <section className="card">
          <h3>Alerts</h3>
          <ul className="warnings">
            {frostDays.length > 0 && <li><Status tone="critical">Frost forecast on {frostDays.map((d) => fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })).join(', ')} (low {cToF(Math.min(...frostDays.map((d) => d.tMinC))).toFixed(0)}°F)</Status></li>}
            {alerts.slice(0, 12).map((a, i) => <li key={i}><Status tone={a.level === 'bad' ? 'critical' : 'warning'}>{fmtDate(a.date, { weekday: 'short', month: 'short', day: 'numeric' })} — {a.message}</Status></li>)}
          </ul>
        </section>
      )}

      <section className="card">
        <Chart
          ariaLabel="Forecast high and low temperatures"
          title="Temperature, °F"
          labels={labels}
          formatLabel={(_, i) => fmtDate(forecast[i].date, { weekday: 'long', month: 'short', day: 'numeric' })}
          series={[
            { id: 'hi', label: 'High', color: 'var(--series-2)', kind: 'line', values: forecast.map((d) => cToF(d.tMaxC)) },
            { id: 'lo', label: 'Low', color: 'var(--series-1)', kind: 'line', values: forecast.map((d) => cToF(d.tMinC)) },
          ]}
          refLines={[{ y: 32, label: 'Frost 32°F' }]}
          format={(v) => `${v.toFixed(0)}°`}
        />
        <Chart
          ariaLabel="Forecast rain and evapotranspiration"
          title="Water: expected rain vs. reference evapotranspiration (ET₀), inches"
          labels={labels}
          formatLabel={(_, i) => fmtDate(forecast[i].date, { weekday: 'long', month: 'short', day: 'numeric' })}
          series={[
            { id: 'rain', label: 'Rain', color: 'var(--series-1)', kind: 'bar', values: forecast.map((d) => mmToIn(d.precipMm)) },
            { id: 'et0', label: 'ET₀ (evaporative demand)', color: 'var(--series-2)', kind: 'bar', values: forecast.map((d) => mmToIn(d.et0Mm)) },
          ]}
          format={(v) => `${v.toFixed(2)}"`}
          height={170}
        />
      </section>

      <section className="card">
        <h3>Daily detail</h3>
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Day</th><th>Sky</th><th>High / Low</th><th>Rain</th><th>ET₀</th><th>Sunshine</th><th>GDD (50°F)</th></tr></thead>
            <tbody>
              {forecast.map((d) => {
                const wc = WEATHER_CODES[d.weatherCode ?? -1];
                return (
                  <tr key={d.date}>
                    <td className="tabular">{fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td>{wc ? <><span aria-hidden="true">{wc[1]}</span> {wc[0]}</> : '—'}</td>
                    <td className="tabular">{cToF(d.tMaxC).toFixed(0)}° / {cToF(d.tMinC).toFixed(0)}° {d.tMinC <= 0 && <Status tone="critical">frost</Status>}</td>
                    <td className="tabular">{mmToIn(d.precipMm).toFixed(2)}"{d.precipProb != null ? ` · ${d.precipProb}%` : ''}</td>
                    <td className="tabular">{mmToIn(d.et0Mm).toFixed(2)}"</td>
                    <td className="tabular">{d.sunshineH != null ? `${d.sunshineH.toFixed(1)} h` : '—'}</td>
                    <td className="tabular">{(gdd(d) * 1.8).toFixed(0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {bedLight.length > 0 && (
        <section className="card">
          <h3>Sunlight forecast by bed</h3>
          <p className="muted small">Each bed’s modelled shading for that date, scaled by forecast cloudiness. Values: daily light integral (mol/m²/day) and direct-sun hours.</p>
          <div className="table-scroll">
            <table className="table heat">
              <thead><tr><th>Bed</th>{bedLight[0].days.map((d) => <th key={d.date}>{fmtDate(d.date, { weekday: 'short', day: 'numeric' })}</th>)}</tr></thead>
              <tbody>
                {bedLight.map(({ bed, days }) => (
                  <tr key={bed.id}>
                    <td>{bed.name}<div className="muted small">{[...new Set(bed.plantings.map((p) => PLANT_BY_ID[p.plantId]?.icon))].join('')}</div></td>
                    {days.map((d) => (
                      <td key={d.date} style={{ background: rampCss(d.dli / DLI_SCALE_MAX) }} className="tabular">
                        <b>{d.dli.toFixed(0)}</b>
                        <div className="small">{d.sun.toFixed(1)}h</div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
