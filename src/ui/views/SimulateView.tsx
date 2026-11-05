import { useState } from 'react';
import { useGarden } from '../store.tsx';
import { api } from '../api.ts';
import { simulateSeason, type SeasonSim } from '../../core/simulate.ts';
import { planningYear } from '../../core/schedule.ts';
import { PLANT_BY_ID } from '../../core/plants.ts';
import { addDays, fmtDate, isoDate } from '../../core/util.ts';
import { Chart, Stat } from '../components/Chart.tsx';
import { Status } from '../components/Field.tsx';

export function SimulateView() {
  const { garden, server, selectedBedId, setSelectedBedId } = useGarden();
  const lastYear = new Date().getFullYear() - 1;
  const [year, setYear] = useState(lastYear);
  const [result, setResult] = useState<SeasonSim | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bed = garden.beds.find((b) => b.id === selectedBedId) ?? garden.beds[0];

  const run = async () => {
    if (!bed) return;
    setBusy(true);
    setErr(null);
    try {
      // Fetch the reference year plus a margin for crops that straddle the new year.
      const latest = isoDate(addDays(new Date(), -7)); // the archive lags a few days
      const wanted = `${year + 1}-06-30`;
      const days = await api.archive(server, garden.site.lat, garden.site.lon, `${year}-01-01`, wanted < latest ? wanted : latest);
      setResult(simulateSeason(garden, bed, days, year, planningYear(garden.site, new Date())));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!bed) return <div className="view empty"><p>Add a bed to simulate.</p></div>;

  return (
    <div className="view">
      <section className="card">
        <h2>Season simulation</h2>
        <p className="muted">Replays a real past year of weather at your location against a bed’s {planningYear(garden.site, new Date())} plan (including successions): when each crop would be ready, how often it would have been hit by frost or heat, and how much irrigation it would have needed.</p>
        <div className="row gap wrap">
          <label className="row gap">Bed
            <select value={bed.id} onChange={(e) => { setSelectedBedId(e.target.value); setResult(null); }}>
              {garden.beds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="row gap">Weather year
            <select value={year} onChange={(e) => setYear(+e.target.value)}>
              {Array.from({ length: 15 }, (_, i) => lastYear - i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <button className="primary" onClick={run} disabled={busy}>{busy ? 'Simulating…' : 'Run simulation'}</button>
        </div>
        {err && <Status tone="critical">{err}</Status>}
      </section>

      {result && (
        <>
          <section className="card">
            <div className="stats">
              <Stat label="Irrigation needed" value={`${result.irrigationGal.toFixed(0)} gal`} sub={`${result.irrigationEvents} waterings`} />
              <Stat label="Effective rain" value={`${result.rainIn.toFixed(1)}"`} />
              <Stat label="Crop water use" value={`${result.useIn.toFixed(1)}"`} />
              <Stat label="Crops reaching harvest" value={`${result.crops.filter((c) => c.maturity).length} / ${result.crops.length}`} />
            </div>
            <Chart
              ariaLabel="Weekly water budget"
              title={`Weekly water budget in ${result.year}, inches`}
              labels={result.weeks.map((w) => fmtDate(w.start, { month: 'short', day: 'numeric' }))}
              formatLabel={(_, i) => `Week of ${fmtDate(result.weeks[i].start, { month: 'long', day: 'numeric' })}`}
              series={[
                { id: 'rain', label: 'Rain', color: 'var(--series-1)', kind: 'bar', stack: 'in', values: result.weeks.map((w) => w.rainIn) },
                { id: 'irr', label: 'Irrigation needed', color: 'var(--series-3)', kind: 'bar', stack: 'in', values: result.weeks.map((w) => w.irrigationIn) },
                { id: 'use', label: 'Crop water use', color: 'var(--series-2)', kind: 'line', values: result.weeks.map((w) => w.useIn) },
              ]}
              format={(v) => `${v.toFixed(2)}"`}
            />
          </section>
          <section className="card">
            <h3>Crops</h3>
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>Crop</th><th>Planted</th><th>Ready</th><th>Days</th><th>Harvest ends</th><th>Frost days</th><th>Heat days</th><th>Sun</th></tr></thead>
                <tbody>
                  {result.crops.map((c) => {
                    const p = PLANT_BY_ID[c.plantId];
                    return (
                      <tr key={c.plantingId}>
                        <td><span aria-hidden="true">{p.icon}</span> {p.name}</td>
                        <td className="tabular">{fmtDate(c.plantedOn)}</td>
                        <td className="tabular">{c.maturity ? fmtDate(c.maturity) : <Status tone="warning">not reached</Status>}</td>
                        <td className="tabular">{c.daysToHarvest ?? '—'} <span className="muted small">(cat. {p.daysToMaturity})</span></td>
                        <td className="tabular">{c.harvestEnd ? fmtDate(c.harvestEnd) : '—'}</td>
                        <td className="tabular">{c.frostDays > 0 ? <Status tone="critical">{c.frostDays}</Status> : 0}</td>
                        <td className="tabular">{c.heatDays > 0 ? <Status tone="warning">{c.heatDays}</Status> : 0}</td>
                        <td>{c.sunHours != null ? <Status tone={c.sunOk ? 'good' : 'critical'}>{c.sunHours.toFixed(1)}h / {p.minSunHours}h</Status> : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">Frost days count nights at or below the crop’s damage threshold while it’s in the ground — move planting later (or protect) if they’re non-zero.</p>
          </section>
        </>
      )}
    </div>
  );
}
