import { useMemo, useState } from 'react';
import type { JournalEntry } from '../../core/types.ts';
import { useGarden } from '../store.tsx';
import { api } from '../api.ts';
import { buildAgenda, type AgendaItem } from '../../core/today.ts';
import { evaluateBed } from '../../core/water.ts';
import { occupancyAt } from '../../core/succession.ts';
import { PLANT_BY_ID } from '../../core/plants.ts';
import { WEATHER_CODES } from '../../core/weather.ts';
import { sunTimes } from '../../core/solar.ts';
import { cToF, fmtDate, isoDate, mmToIn, parseIso, uid } from '../../core/util.ts';
import { fmtTime } from '../format.ts';
import { JOURNAL_KINDS } from '../../core/journal.ts';
import { Meter } from '../components/Chart.tsx';
import { NumberInput, Status } from '../components/Field.tsx';

const GROUPS: { label: string; match: (p: number) => boolean }[] = [
  { label: 'Act today', match: (p) => p <= 1 },
  { label: 'This week', match: (p) => p === 2 },
  { label: 'When you have time', match: (p) => p === 3 },
];

export function TodayView() {
  const { garden, update, weather, weatherError, seasonWeather, readings, irrigation, refreshIrrigation, server, setTab, setSelectedBedId } = useGarden();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const items = useMemo(() => {
    if (!weather) return [];
    return buildAgenda({ garden, weather, season: seasonWeather ?? undefined, events: irrigation?.events ?? [], readings, activeRuns: irrigation?.active.map((r) => r.bedId) });
  }, [garden, weather, seasonWeather, irrigation, readings]);

  if (weatherError) return <div className="view"><Status tone="critical">Weather unavailable: {weatherError}</Status></div>;
  if (!weather) return <div className="view"><p className="muted">Loading today’s garden…</p></div>;

  const todayIso = weather.today;
  const today = weather.daily.find((d) => d.date === todayIso);
  const wc = today ? WEATHER_CODES[today.weatherCode ?? -1] : undefined;
  const td = parseIso(todayIso);
  const st = sunTimes(td.getFullYear(), td.getMonth(), td.getDate(), garden.site.lat, garden.site.lon);
  const visible = items.filter((i) => !dismissed.has(i.id));
  const urgent = visible.filter((i) => i.priority <= 1).length;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };
  const addJournal = (e: Omit<JournalEntry, 'id' | 'date'>) => update((g) => ({ ...g, journal: [...g.journal, { id: uid('j'), date: todayIso, ...e }] }));

  return (
    <div className="view today-view">
      <div className="today-hero card">
        <div>
          <div className="muted small">{td.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · {garden.site.name}</div>
          <h2>{urgent ? `${urgent} thing${urgent > 1 ? 's' : ''} need${urgent > 1 ? '' : 's'} you today` : 'Nothing urgent today'}</h2>
          {today && (
            <div className="row gap wrap small">
              <span aria-hidden="true">{wc?.[1]}</span> {wc?.[0]} · {cToF(today.tMaxC).toFixed(0)}° / {cToF(today.tMinC).toFixed(0)}°F
              {today.precipProb != null && <> · {today.precipProb}% chance of rain ({mmToIn(today.precipMm).toFixed(2)}")</>}
              {st.sunrise && st.sunset && <> · ☀ {fmtTime(st.sunrise.getTime(), weather.timezone)}–{fmtTime(st.sunset.getTime(), weather.timezone)}</>}
            </div>
          )}
        </div>
      </div>

      <div className="today-layout">
        <div className="agenda">
          {err && <Status tone="critical">{err}</Status>}
          {GROUPS.map((g) => {
            const list = visible.filter((i) => g.match(i.priority));
            if (!list.length) return null;
            return (
              <section key={g.label} className="card">
                <h3>{g.label}</h3>
                <ul className="agenda-list">
                  {list.map((it) => (
                    <AgendaRow key={it.id} it={it} busy={busy === it.id} server={server}
                      onDismiss={() => setDismissed(new Set([...dismissed, it.id]))}
                      onWater={(bedId, minutes) => run(it.id, async () => { await api.run(bedId, minutes); await refreshIrrigation(); })}
                      onPlanted={(ids) => update((gg) => ({ ...gg, beds: gg.beds.map((b) => ({ ...b, plantings: b.plantings.map((p) => (ids.includes(p.id) && !p.plantedOn ? { ...p, plantedOn: todayIso } : p)) })) }))}
                      onHarvest={(plantingId, bedId, qty, unit) => {
                        const pl = garden.beds.flatMap((b) => b.plantings).find((p) => p.id === plantingId);
                        addJournal({ kind: 'harvest', bedId, plantingId, plantId: pl?.plantId, qty, unit });
                      }}
                      onLog={(a) => { addJournal({ kind: a.journalKind, text: a.text, plantId: a.plantId, bedId: a.bedId }); setDismissed(new Set([...dismissed, it.id])); }}
                      onOpenBed={(bedId) => { setSelectedBedId(bedId); setTab(it.category === 'water' ? 'water' : 'beds'); }}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
          {!visible.length && <section className="card"><p>All caught up. 🌿</p></section>}
          <QuickLog />
        </div>

        <aside className="side-col">
          <BedCards />
        </aside>
      </div>
    </div>
  );
}

function AgendaRow({ it, busy, server, onDismiss, onWater, onPlanted, onHarvest, onLog, onOpenBed }: {
  it: AgendaItem; busy: boolean; server: boolean;
  onDismiss: () => void; onWater: (bedId: string, minutes: number) => void; onPlanted: (ids: string[]) => void;
  onHarvest: (plantingId: string, bedId: string, qty: number, unit: NonNullable<JournalEntry['unit']>) => void;
  onLog: (a: Extract<NonNullable<AgendaItem['action']>, { kind: 'log' }>) => void; onOpenBed: (bedId: string) => void;
}) {
  const [qty, setQty] = useState(1);
  const [unit, setUnit] = useState<NonNullable<JournalEntry['unit']>>('lb');
  const [logged, setLogged] = useState(false);
  const [open, setOpen] = useState(false);
  const a = it.action;
  return (
    <li className={`agenda-item p${it.priority} c-${it.category}`}>
      <span className="agenda-icon" aria-hidden="true">{it.icon}</span>
      <div className="grow">
        <div className="agenda-title">{it.priority === 0 && <Status tone="critical">Urgent</Status>}{it.title}</div>
        {it.detail && <div className="muted small">{it.detail}</div>}
        <div className="row gap wrap agenda-actions">
          {a?.kind === 'water' && <button className="primary small" disabled={!server || busy} onClick={() => onWater(a.bedId, a.minutes)}>{busy ? 'Starting…' : `Water ${a.minutes} min`}</button>}
          {a?.kind === 'planted' && <button className="primary small" onClick={() => onPlanted(a.plantingIds)}>Mark planted</button>}
          {a?.kind === 'harvest' && (logged ? <Status tone="good">Logged</Status> : !open ? (
            <button className="small" onClick={() => setOpen(true)}>Log harvest…</button>
          ) : (
            <span className="row gap">
              <NumberInput value={qty} min={0} step={0.25} onChange={setQty} />
              <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} aria-label="Unit">
                {(['lb', 'oz', 'kg', 'g', 'count', 'bunch'] as const).map((u) => <option key={u}>{u}</option>)}
              </select>
              <button className="small" onClick={() => { onHarvest(a.plantingId, a.bedId, qty, unit); setLogged(true); }}>Log harvest</button>
            </span>
          ))}
          {a?.kind === 'log' && <button className="small" onClick={() => onLog(a)}>Done</button>}
          {it.bedId && <button className="small link" onClick={() => onOpenBed(it.bedId!)}>Open bed</button>}
          <button className="small link" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </li>
  );
}

function BedCards() {
  const { garden, weather, irrigation, readings, setSelectedBedId, setTab } = useGarden();
  if (!weather) return null;
  const now = parseIso(weather.today);
  return (
    <>
      {garden.beds.map((bed) => {
        const ev = evaluateBed(bed, weather, irrigation?.events ?? [], readings[bed.id]);
        const day = ev.sim.days.find((d) => d.date === weather.today);
        const occ = occupancyAt(bed, garden.site, now);
        const growing = [...new Set(occ.filter(Boolean).map((id) => bed.plantings.find((p) => p.id === id)!.plantId))];
        const avail = day?.available ?? 0;
        return (
          <button key={bed.id} className="card bed-card" onClick={() => { setSelectedBedId(bed.id); setTab('beds'); }}>
            <div className="row between"><b>{bed.name}</b><span className="muted small">{occ.filter(Boolean).length}/{occ.length} sq</span></div>
            <div className="bed-card-icons" aria-label="Growing now">{growing.length ? growing.map((id) => <span key={id} title={PLANT_BY_ID[id].name}>{PLANT_BY_ID[id].icon}</span>) : <span className="muted small">Nothing growing</span>}</div>
            {growing.length > 0 && (
              <>
                <div className="row between small"><span>Soil water</span><span className="tabular">{Math.round(avail * 100)}%{ev.sensorFraction != null ? ' · sensor' : ''}</span></div>
                <Meter value={avail} tone={avail < 0.5 ? 'critical' : avail < 0.65 ? 'warning' : 'good'} label={`${bed.name} soil water`} />
              </>
            )}
          </button>
        );
      })}
    </>
  );
}

function QuickLog() {
  const { garden, update } = useGarden();
  const [kind, setKind] = useState<JournalEntry['kind']>('note');
  const [bedId, setBedId] = useState('');
  const [text, setText] = useState('');
  const recent = [...garden.journal].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  return (
    <section className="card">
      <h3>Quick note</h3>
      <form className="row gap wrap" onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        update((g) => ({ ...g, journal: [...g.journal, { id: uid('j'), date: isoDate(new Date()), kind, bedId: bedId || undefined, text: text.trim() }] }));
        setText('');
      }}>
        <select value={kind} onChange={(e) => setKind(e.target.value as JournalEntry['kind'])} aria-label="Entry type">
          {JOURNAL_KINDS.filter((k) => k.id !== 'harvest').map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}
        </select>
        <select value={bedId} onChange={(e) => setBedId(e.target.value)} aria-label="Bed">
          <option value="">Whole garden</option>
          {garden.beds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Aphids on kale, ladybugs arrived, mulched paths…" aria-label="Note" />
        <button type="submit" className="primary">Add</button>
      </form>
      {recent.length > 0 && (
        <ul className="journal-mini">
          {recent.map((e) => (
            <li key={e.id}><span className="muted small tabular">{fmtDate(e.date)}</span> {JOURNAL_KINDS.find((k) => k.id === e.kind)?.icon} {e.kind === 'harvest' ? `${e.qty} ${e.unit} ${PLANT_BY_ID[e.plantId ?? '']?.name ?? ''}` : e.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
