import { useMemo, useState } from 'react';
import { useGarden } from '../store.tsx';
import { diseaseRisks, pestRisks, wetnessByDay, PESTS, RISK_ORDER, type RiskItem } from '../../core/health.ts';
import { PLANT_BY_ID } from '../../core/plants.ts';
import { addDays, fmtDate, isoDate, parseIso, uid } from '../../core/util.ts';
import { Chart } from '../components/Chart.tsx';
import { Status } from '../components/Field.tsx';

const TONE = { high: 'critical', watch: 'warning', low: 'good' } as const;
const LABEL = { high: 'Act now', watch: 'Watch', low: 'Low' } as const;

export function HealthView() {
  const { garden, update, weather, seasonWeather } = useGarden();
  const [plantId, setPlantId] = useState('');
  const [kind, setKind] = useState<'pest' | 'disease' | 'treatment'>('treatment');
  const [text, setText] = useState('');

  const risks = useMemo(() => {
    if (!weather) return [] as RiskItem[];
    const p = seasonWeather ? pestRisks(garden, seasonWeather) : [];
    const d = diseaseRisks(garden, weather.hourly, weather.today);
    return [...d, ...p].sort((a, b) => RISK_ORDER[a.level] - RISK_ORDER[b.level]);
  }, [garden, weather, seasonWeather]);

  const wet = useMemo(() => {
    if (!weather?.hourly) return [];
    const from = isoDate(addDays(parseIso(weather.today), -10));
    const to = isoDate(addDays(parseIso(weather.today), 7));
    return wetnessByDay(weather.hourly).filter((d) => d.date >= from && d.date <= to);
  }, [weather]);

  if (!weather) return <div className="view"><p className="muted">Loading weather…</p></div>;
  const crops = [...new Set(garden.beds.flatMap((b) => b.plantings.map((p) => p.plantId)))];
  const log = [...garden.journal].filter((e) => ['pest', 'disease', 'treatment'].includes(e.kind)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  const fcFrom = wet.findIndex((d) => d.date > weather.today);

  return (
    <div className="view health-view">
      <div className="row between wrap gap">
        <h2>Plant health</h2>
        <span className="muted small">Pest timing from {seasonWeather ? `degree-days since ${fmtDate(seasonWeather.biofix, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'degree-days (loading year-to-date weather…)'} · disease pressure from hourly humidity & temperature</span>
      </div>
      <div className="health-layout">
        <div className="col">
          {risks.length === 0 && <section className="card"><p className="muted">No modelled pests or diseases for the crops in your current plan. Models cover tomatoes, potatoes, cucurbits, brassicas, alliums, beans, corn and basil.</p></section>}
          {risks.map((r) => (
            <section key={r.id} className={`card risk risk-${r.level}`}>
              <div className="row between wrap gap">
                <h3><span aria-hidden="true">{r.icon}</span> {r.name}</h3>
                <Status tone={TONE[r.level]}>{LABEL[r.level]}</Status>
              </div>
              <p><b>{r.headline}</b></p>
              <p className="small">{r.action}</p>
              {r.progress && <DdBar r={r} />}
              <p className="muted small">Affects: {r.crops.map((c) => `${PLANT_BY_ID[c]?.icon ?? ''} ${PLANT_BY_ID[c]?.name ?? c}`).join(', ')}{r.detail ? ` · ${r.detail}` : ''}</p>
            </section>
          ))}
        </div>
        <aside className="side-col">
          {wet.length > 0 && (
            <section className="card">
              <Chart
                ariaLabel="Leaf wetness hours per day"
                title="Leaf-wetness hours per day"
                labels={wet.map((d) => fmtDate(d.date, { month: 'numeric', day: 'numeric' }))}
                formatLabel={(_, i) => fmtDate(wet[i].date, { weekday: 'short', month: 'short', day: 'numeric' })}
                series={[{ id: 'wet', label: 'Wet hours', color: 'var(--series-1)', kind: 'bar', values: wet.map((d) => d.wetHours) }]}
                refLines={[{ y: 6, label: '6 h' }]}
                forecastFrom={fcFrom >= 0 ? fcFrom : undefined}
                format={(v) => `${v.toFixed(0)} h`}
                height={180}
              />
              <p className="muted small">Hours with humidity ≥ 90% or rain. Most leaf diseases need 6+ wet hours to infect.</p>
            </section>
          )}
          <section className="card">
            <h3>Log a sighting or treatment</h3>
            <p className="muted small">Logging a treatment on tomatoes resets the early-blight (TOMCAST) count.</p>
            <form className="col gap" onSubmit={(e) => {
              e.preventDefault();
              update((g) => ({ ...g, journal: [...g.journal, { id: uid('j'), date: weather.today, kind, plantId: plantId || undefined, text: text.trim() || undefined }] }));
              setText('');
            }}>
              <div className="row gap wrap">
                <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Type">
                  <option value="treatment">🧴 Treatment / spray</option>
                  <option value="pest">🐛 Pest seen</option>
                  <option value="disease">🍂 Disease seen</option>
                </select>
                <select value={plantId} onChange={(e) => setPlantId(e.target.value)} aria-label="Crop">
                  <option value="">All crops</option>
                  {crops.map((c) => <option key={c} value={c}>{PLANT_BY_ID[c]?.name}</option>)}
                </select>
              </div>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. copper spray; hornworm on tomato B2" aria-label="Details" />
              <button type="submit" className="primary">Log</button>
            </form>
            {log.length > 0 && (
              <ul className="journal-mini">
                {log.map((e) => <li key={e.id}><span className="muted small tabular">{fmtDate(e.date)}</span> {e.kind === 'treatment' ? '🧴' : e.kind === 'pest' ? '🐛' : '🍂'} {e.plantId ? PLANT_BY_ID[e.plantId]?.name + ': ' : ''}{e.text}</li>)}
              </ul>
            )}
          </section>
          <section className="card muted small">
            <p>Pests modelled: {PESTS.map((p) => p.name).join(', ')}. Degree-day thresholds are approximate figures from US extension services — use them to know when to start scouting and get covers on, not as guarantees.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function DdBar({ r }: { r: RiskItem }) {
  const model = PESTS.find((p) => p.id === r.id);
  if (!model || !r.progress) return null;
  const max = model.events[model.events.length - 1].dd * 1.4;
  return (
    <div className="ddbar" aria-label={`${Math.round(r.progress.dd)} degree-days accumulated`}>
      <div className="ddbar-track">
        <div className="ddbar-fill" style={{ width: `${Math.min(100, (r.progress.dd / max) * 100)}%` }} />
        {model.events.map((e) => (
          <span key={e.dd} className="ddbar-mark" style={{ left: `${(e.dd / max) * 100}%` }} title={`${e.dd} DD: ${e.label}`} />
        ))}
      </div>
      <div className="row between small muted tabular">
        <span>{Math.round(r.progress.dd)} DD{r.progress.dd > max ? ' (past the scale)' : ''} · base {r.progress.base}°F</span>
        <span>{model.events.map((e) => `${e.dd}: ${e.label}`).join(' · ')}</span>
      </div>
    </div>
  );
}
