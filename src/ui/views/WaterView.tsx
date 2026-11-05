import { useEffect, useMemo, useState } from 'react';
import type { Bed, BedIrrigation, IrrigationMode } from '../../core/types.ts';
import { useGarden } from '../store.tsx';
import { api, type HaEntityLite } from '../api.ts';
import { evaluateBed, gallonsForDepth, MAD } from '../../core/water.ts';
import { fmtDate, mmToIn } from '../../core/util.ts';
import { Chart, Meter, Stat } from '../components/Chart.tsx';
import { Field, NumberInput, Status } from '../components/Field.tsx';

function useReading(server: boolean, entity?: string) {
  const [v, setV] = useState<number | null>(null);
  useEffect(() => {
    if (!server || !entity) {
      setV(null);
      return;
    }
    let live = true;
    const load = () => api.value(entity).then((r) => live && setV(r.value), () => live && setV(null));
    load();
    const t = setInterval(load, 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [server, entity]);
  return v;
}

export function WaterView() {
  const { garden, selectedBedId, setSelectedBedId, server } = useGarden();
  const bed = garden.beds.find((b) => b.id === selectedBedId) ?? garden.beds[0];
  const [entities, setEntities] = useState<HaEntityLite[]>([]);
  useEffect(() => {
    if (server) api.entities().then(setEntities, () => setEntities([]));
  }, [server]);

  if (!bed) return <div className="view empty"><p>Add a bed first.</p></div>;
  return (
    <div className="view water-view">
      {!server && (
        <div className="banner"><Status tone="warning">Running without the Jardin server — the water model works, but Home Assistant sensors and valves need the server (<code>npm start</code> or the HA add-on).</Status></div>
      )}
      <div className="bed-tabs" role="tablist" aria-label="Beds">
        {garden.beds.map((b) => (
          <BedTab key={b.id} bed={b} active={b.id === bed.id} onClick={() => setSelectedBedId(b.id)} />
        ))}
      </div>
      <BedWater key={bed.id} bed={bed} entities={entities} />
    </div>
  );
}

function BedTab({ bed, active, onClick }: { bed: Bed; active: boolean; onClick: () => void }) {
  const { weather, irrigation, server } = useGarden();
  const reading = useReading(server, bed.irrigation.moistureEntity);
  const ev = weather ? evaluateBed(bed, weather, irrigation?.events ?? [], reading) : null;
  const watering = irrigation?.active.some((r) => r.bedId === bed.id);
  const tone = !ev ? 'info' : ev.rec.action === 'water-now' ? 'critical' : ev.rec.action === 'water-soon' ? 'warning' : 'good';
  return (
    <button role="tab" aria-selected={active} className={active ? 'active' : ''} onClick={onClick}>
      {bed.name}{' '}
      {watering ? <Status tone="info">watering</Status> : ev && <Status tone={tone}>{ev.rec.action === 'water-now' ? 'dry' : ev.rec.action === 'water-soon' ? 'soon' : 'ok'}</Status>}
    </button>
  );
}

function BedWater({ bed, entities }: { bed: Bed; entities: HaEntityLite[] }) {
  const { garden, update, weather, irrigation, refreshIrrigation, server } = useGarden();
  const reading = useReading(server, bed.irrigation.moistureEntity);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<{ t: number; v: number }[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (server && bed.irrigation.moistureEntity) api.history(bed.irrigation.moistureEntity, 24 * 7).then(setHistory, () => setHistory([]));
  }, [server, bed.irrigation.moistureEntity]);

  const ev = useMemo(() => (weather ? evaluateBed(bed, weather, irrigation?.events ?? [], reading) : null), [bed, weather, irrigation, reading]);
  const setIrr = (patch: Partial<BedIrrigation>) => update((g) => ({ ...g, beds: g.beds.map((b) => (b.id === bed.id ? { ...b, irrigation: { ...b.irrigation, ...patch } } : b)) }));
  const active = irrigation?.active.find((r) => r.bedId === bed.id);
  const decision = irrigation?.decisions[bed.id];
  const events = (irrigation?.events ?? []).filter((e) => e.bedId === bed.id).slice(-12).reverse();
  const area = bed.widthFt * bed.lengthFt;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await refreshIrrigation();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!weather || !ev) return <p className="muted">Loading weather…</p>;
  const days = ev.sim.days;
  const todayIdx = days.findIndex((d) => d.date === weather.today);
  const fcFrom = days.findIndex((d) => d.forecast);
  const labels = days.map((d) => fmtDate(d.date, { month: 'numeric', day: 'numeric' }));
  const todayDay = days[todayIdx] ?? days[days.length - 1];
  const rec = ev.rec;
  const recTone = rec.action === 'water-now' ? 'critical' : rec.action === 'water-soon' ? 'warning' : rec.action === 'rain-expected' ? 'info' : 'good';
  const runMin = minutes ?? Math.max(1, Math.round(rec.minutes || 10));
  const remaining = active ? Math.max(0, (Date.parse(active.endsAt) - now) / 1000) : 0;

  return (
    <div className="water-layout">
      <div>
        <section className="card">
          <div className="row between wrap gap">
            <h3>{bed.name} · {area} sq ft</h3>
            <Status tone={recTone}>{rec.message}</Status>
          </div>
          <div className="stats">
            <Stat label="Soil water available" value={`${Math.round(todayDay.available * 100)}%`} sub={ev.sensorFraction != null ? `sensor ${reading?.toFixed(1)}% → calibrated` : 'modelled (no sensor)'} />
            <Stat label="Root zone holds" value={`${mmToIn(ev.sim.taw).toFixed(2)}"`} sub={`refill below ${Math.round((1 - MAD) * 100)}%`} />
            <Stat label="Today's use (ETc)" value={`${mmToIn(todayDay.etc).toFixed(2)}"`} sub={`${gallonsForDepth(bed, todayDay.etc).toFixed(1)} gal`} />
            <Stat label={rec.action === 'water-now' ? 'Water now' : 'Next watering'} value={rec.depthMm > 0 ? `${mmToIn(rec.depthMm).toFixed(2)}"` : '—'} sub={rec.depthMm > 0 ? `${rec.gallons.toFixed(1)} gal · ${rec.minutes.toFixed(0)} min${rec.date ? ' · ~' + fmtDate(rec.date) : ''}` : 'not needed'} />
          </div>
          <Meter value={todayDay.available} tone={todayDay.available < 1 - MAD ? 'critical' : todayDay.available < 0.65 ? 'warning' : 'good'} label="Soil water available" />
        </section>

        <section className="card">
          <Chart
            ariaLabel="Root-zone water available over time"
            title="Soil water available — past 30 days and 16-day forecast"
            labels={labels}
            formatLabel={(_, i) => fmtDate(days[i].date, { weekday: 'short', month: 'short', day: 'numeric' })}
            series={[{ id: 'avail', label: 'Available water', color: 'var(--series-1)', kind: 'line', values: days.map((d) => d.available * 100) }]}
            refLines={[{ y: (1 - MAD) * 100, label: 'Refill point' }]}
            forecastFrom={fcFrom >= 0 ? fcFrom : undefined}
            yMin={0}
            yMax={100}
            format={(v) => `${v.toFixed(0)}%`}
          />
          <Chart
            ariaLabel="Daily water in and out"
            title="Daily water in (rain, irrigation) and out (crop use), inches"
            labels={labels}
            formatLabel={(_, i) => fmtDate(days[i].date, { weekday: 'short', month: 'short', day: 'numeric' })}
            series={[
              { id: 'rain', label: 'Effective rain', color: 'var(--series-1)', kind: 'bar', stack: 'in', values: days.map((d) => mmToIn(d.effRain)) },
              { id: 'irr', label: 'Irrigation', color: 'var(--series-3)', kind: 'bar', stack: 'in', values: days.map((d) => mmToIn(d.irrigation)) },
              { id: 'etc', label: 'Crop water use', color: 'var(--series-2)', kind: 'bar', stack: 'out', values: days.map((d) => -mmToIn(d.etc)) },
            ]}
            forecastFrom={fcFrom >= 0 ? fcFrom : undefined}
            format={(v) => `${v.toFixed(2)}"`}
            height={170}
          />
          {history.length > 1 && (
            <Chart
              ariaLabel="Soil moisture sensor history"
              title={`Sensor history — ${bed.irrigation.moistureEntity} (raw %)`}
              labels={history.map((p) => new Date(p.t).toLocaleDateString(undefined, { weekday: 'short' }))}
              formatLabel={(_, i) => new Date(history[i].t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
              series={[{ id: 'm', label: 'Moisture', color: 'var(--series-1)', kind: 'line', values: history.map((p) => p.v) }]}
              refLines={[{ y: bed.irrigation.sensorDry, label: 'Dry' }, { y: bed.irrigation.sensorWet, label: 'Wet' }]}
              format={(v) => `${v.toFixed(0)}%`}
              height={160}
            />
          )}
        </section>

        <section className="card">
          <h3>Watering log</h3>
          {events.length === 0 ? <p className="muted">No watering recorded yet.</p> : (
            <table className="table">
              <thead><tr><th>When</th><th>Minutes</th><th>Depth</th><th>Source</th><th>Note</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="tabular">{new Date(e.start).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="tabular">{e.minutes}</td>
                    <td className="tabular">{mmToIn(e.depthMm).toFixed(2)}"</td>
                    <td>{e.source}</td>
                    <td className="muted">{e.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <aside className="side-col">
        <section className="card">
          <h3>Control</h3>
          {active ? (
            <>
              <Status tone="info">Watering — {Math.floor(remaining / 60)}:{String(Math.floor(remaining % 60)).padStart(2, '0')} left ({active.source})</Status>
              <button className="danger" disabled={busy} onClick={() => act(() => api.stop(bed.id))}>Stop now</button>
            </>
          ) : (
            <>
              <div className="row gap">
                <NumberInput value={runMin} min={1} max={120} suffix="min" onChange={(v) => setMinutes(v)} />
                <button className="primary" disabled={!server || !bed.irrigation.valveEntity || busy} onClick={() => act(() => api.run(bed.id, runMin))}>Water now</button>
              </div>
              <p className="muted small">≈ {(runMin * bed.irrigation.flowGpm).toFixed(1)} gal · {mmToIn(((runMin * bed.irrigation.flowGpm * bed.irrigation.efficiency) / 0.623 / area) * 25.4).toFixed(2)}" to the root zone</p>
              <button disabled={!server || busy} onClick={() => act(() => api.log(bed.id, runMin, 'hand watered'))}>Log hand watering ({runMin} min equivalent)</button>
            </>
          )}
          {err && <Status tone="critical">{err}</Status>}
          {!bed.irrigation.valveEntity && <p className="muted small">Choose a valve entity below to enable control.</p>}
          <Field label="Mode" hint={bed.irrigation.mode === 'auto' ? `Waters automatically between ${bed.irrigation.windowStartHour}:00 and ${bed.irrigation.windowEndHour}:00 when the model says the root zone has passed the refill point, unless rain is expected.` : bed.irrigation.mode === 'suggest' ? 'Shows recommendations only.' : 'No recommendations or automation.'}>
            <select value={bed.irrigation.mode} onChange={(e) => setIrr({ mode: e.target.value as IrrigationMode })}>
              <option value="off">Off</option>
              <option value="suggest">Suggest only</option>
              <option value="auto">Automatic</option>
            </select>
          </Field>
          {decision && <p className="small">Last automatic check {new Date(decision.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}: <b>{decision.action}</b> — {decision.message}</p>}
        </section>

        <section className="card">
          <h3>Home Assistant</h3>
          <datalist id="ha-sensors">{entities.filter((e) => e.id.startsWith('sensor.')).map((e) => <option key={e.id} value={e.id}>{e.name} ({e.state}{e.unit ?? ''})</option>)}</datalist>
          <datalist id="ha-valves">{entities.filter((e) => /^(switch|valve|input_boolean)\./.test(e.id)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</datalist>
          <Field label="Soil moisture sensor"><input list="ha-sensors" value={bed.irrigation.moistureEntity ?? ''} placeholder="sensor.bed_1_soil_moisture" onChange={(e) => setIrr({ moistureEntity: e.target.value || undefined })} /></Field>
          <Field label="Valve / switch"><input list="ha-valves" value={bed.irrigation.valveEntity ?? ''} placeholder="switch.bed_1_valve" onChange={(e) => setIrr({ valveEntity: e.target.value || undefined })} /></Field>
          <h4>Sensor calibration</h4>
          <p className="muted small">Cheap capacitive sensors read “%” that isn’t true water content. Record a reading when the bed is dry enough that plants droop, and one an hour after a deep soak.</p>
          <div className="grid2">
            <Field label="Dry reading"><NumberInput value={bed.irrigation.sensorDry} onChange={(v) => setIrr({ sensorDry: v })} /></Field>
            <Field label="Wet reading"><NumberInput value={bed.irrigation.sensorWet} onChange={(v) => setIrr({ sensorWet: v })} /></Field>
          </div>
          {reading != null && (
            <div className="row gap wrap small">
              <span>Current: <b className="tabular">{reading.toFixed(1)}</b></span>
              <button className="small" onClick={() => setIrr({ sensorDry: +reading.toFixed(1) })}>Use as dry</button>
              <button className="small" onClick={() => setIrr({ sensorWet: +reading.toFixed(1) })}>Use as wet</button>
            </div>
          )}
          <h4>System</h4>
          <div className="grid2">
            <Field label="Flow (whole bed)"><NumberInput value={bed.irrigation.flowGpm} step={0.05} min={0.01} suffix="gal/min" onChange={(v) => setIrr({ flowGpm: v })} /></Field>
            <Field label="Efficiency"><NumberInput value={bed.irrigation.efficiency} step={0.05} min={0.1} max={1} onChange={(v) => setIrr({ efficiency: v })} /></Field>
            <Field label="Window start"><NumberInput value={bed.irrigation.windowStartHour} min={0} max={23} suffix="h" onChange={(v) => setIrr({ windowStartHour: Math.round(v) })} /></Field>
            <Field label="Window end"><NumberInput value={bed.irrigation.windowEndHour} min={0} max={23} suffix="h" onChange={(v) => setIrr({ windowEndHour: Math.round(v) })} /></Field>
            <Field label="Max run"><NumberInput value={bed.irrigation.maxMinutes} min={1} max={120} suffix="min" onChange={(v) => setIrr({ maxMinutes: v })} /></Field>
            <Field label="Skip if rain ≥"><NumberInput value={bed.irrigation.rainSkipIn} step={0.05} min={0} suffix="in" onChange={(v) => setIrr({ rainSkipIn: v })} /></Field>
          </div>
          <p className="muted small">Drip: 0.5 gph emitters at 12" spacing on a 4×8 bed ≈ 0.27 gal/min. Measure by running into a bucket for a minute.</p>
          <p className="muted small">{garden.site.name} · weather from Open-Meteo ({weather.timezone}).</p>
        </section>
      </aside>
    </div>
  );
}
