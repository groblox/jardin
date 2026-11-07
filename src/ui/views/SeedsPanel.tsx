import { useMemo, useState } from 'react';
import type { SeedPacket } from '../../core/types.ts';
import { useGarden } from '../store.tsx';
import { HOW_LABEL, SEED_LIFE_YEARS, isSeedOld, seedNeeds, shoppingListText, type SeedNeed } from '../../core/seeds.ts';
import { PLANTS, PLANT_BY_ID } from '../../core/plants.ts';
import { fmtDate, uid } from '../../core/util.ts';
import { Field, NumberInput, Status } from '../components/Field.tsx';

const STATUS: Record<SeedNeed['status'], { tone: 'good' | 'warning' | 'critical' | 'info'; label: string }> = {
  have: { tone: 'good', label: 'In seed box' },
  old: { tone: 'warning', label: 'Old seed' },
  need: { tone: 'critical', label: 'Need seed' },
  buy: { tone: 'info', label: 'Buy' },
};

const AMOUNTS: NonNullable<SeedPacket['amount']>[] = ['full', 'half', 'low', 'empty'];

/** What the season's plan needs (seeds to sow or start, plants and sets to buy), checked against the seed box. */
export function SeedsPanel({ year }: { year: number }) {
  const { garden, update } = useGarden();
  const needs = useMemo(() => seedNeeds(garden, year), [garden, year]);
  const [copied, setCopied] = useState(false);
  const [adding, setAddingState] = useState<Partial<SeedPacket> | null>(null);
  const [boxOpen, setBoxOpen] = useState(false);
  const setAdding = (a: Partial<SeedPacket> | null) => {
    setAddingState(a);
    if (a) setBoxOpen(true);
  };

  const copy = async () => {
    const text = shoppingListText(needs, year);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      prompt('Copy the list:', text);
    }
  };
  const short = needs.filter((n) => n.status !== 'have').length;

  return (
    <section className="card seeds-panel">
      <div className="row between wrap gap">
        <h3>Seeds & plants for {year}</h3>
        <span className="row gap no-print">
          <button className="small" onClick={copy} disabled={!needs.length}>{copied ? 'Copied ✓' : 'Copy shopping list'}</button>
        </span>
      </div>
      {!needs.length ? (
        <p className="muted">Everything planned for {year} is already in the ground — or nothing is planned yet. Plan crops in Beds to build the list.</p>
      ) : (
        <>
          <p className="muted small">
            Quantities cover the planned squares plus ~25% spares, adjusted for typical germination and the age of your seed. {short ? `${short} item${short > 1 ? 's' : ''} to buy or check.` : 'Your seed box covers everything.'}
          </p>
          <div className="table-scroll">
            <table className="table seeds-table">
              <thead>
                <tr><th>Crop</th><th>How</th><th className="num">Plants</th><th className="num">Sow</th><th>By</th><th>Seed box</th></tr>
              </thead>
              <tbody>
                {needs.map((n) => {
                  const p = PLANT_BY_ID[n.plantId];
                  const st = STATUS[n.status];
                  const pk = n.packets[0];
                  return (
                    <tr key={n.plantId + n.how}>
                      <td><span aria-hidden="true">{p?.icon}</span> {p?.name}</td>
                      <td className="nowrap">{HOW_LABEL[n.how]}</td>
                      <td className="num tabular">{n.plants}</td>
                      <td className="num tabular">{n.seeds != null ? `${n.seeds} seeds${n.cells ? ` · ${n.cells} cells` : ''}` : '—'}</td>
                      <td className="tabular nowrap">{fmtDate(n.by)}</td>
                      <td>
                        <Status tone={st.tone}>{st.label}{pk && n.status !== 'buy' ? ` · ${pk.variety ? pk.variety + ' ' : ''}${pk.year ?? ''}` : ''}</Status>
                        {n.note && <span className="muted small block">{n.note}</span>}
                        {(n.status === 'need' || n.status === 'old') && (
                          <button className="link small no-print" onClick={() => setAdding({ plantId: n.plantId, year, amount: 'full' })}>+ Add packet</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <details className="seed-box" open={boxOpen} onToggle={(e) => setBoxOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Seed box <span className="muted small">({(garden.seeds ?? []).filter((s) => s.amount !== 'empty').length} packets)</span></summary>
        <ul className="packet-list">
          {[...(garden.seeds ?? [])]
            .sort((a, b) => (PLANT_BY_ID[a.plantId]?.name ?? '').localeCompare(PLANT_BY_ID[b.plantId]?.name ?? '') || (b.year ?? 0) - (a.year ?? 0))
            .map((s) => {
              const p = PLANT_BY_ID[s.plantId];
              const old = isSeedOld(s, year);
              return (
                <li key={s.id} className={s.amount === 'empty' ? 'empty' : ''}>
                  <span aria-hidden="true">{p?.icon}</span>
                  <span className="grow">
                    {p?.name ?? s.plantId}{s.variety ? ` · ${s.variety}` : ''} <span className="muted small">{s.year ?? 'year?'}</span>
                    {old && <span className="small"> <Status tone="warning">past {SEED_LIFE_YEARS[s.plantId] ?? 3}-yr life</Status></span>}
                  </span>
                  <select value={s.amount ?? 'full'} aria-label={`Amount left of ${p?.name}`} onChange={(e) => update((g) => ({ ...g, seeds: (g.seeds ?? []).map((x) => (x.id === s.id ? { ...x, amount: e.target.value as SeedPacket['amount'] } : x)) }))}>
                    {AMOUNTS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <button className="link small no-print" aria-label={`Remove ${p?.name} packet`} onClick={() => update((g) => ({ ...g, seeds: (g.seeds ?? []).filter((x) => x.id !== s.id) }))}>✕</button>
                </li>
              );
            })}
        </ul>
        {adding ? (
          <div className="card inset no-print">
            <div className="grid2">
              <Field label="Crop">
                <select value={adding.plantId ?? ''} onChange={(e) => setAdding({ ...adding, plantId: e.target.value })}>
                  <option value="">Choose…</option>
                  {PLANTS.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
                </select>
              </Field>
              <Field label="Variety"><input value={adding.variety ?? ''} placeholder="e.g. Sungold" onChange={(e) => setAdding({ ...adding, variety: e.target.value })} /></Field>
              <Field label="Packed for (year)"><NumberInput value={adding.year ?? year} min={1990} max={year + 1} onChange={(v) => setAdding({ ...adding, year: Math.round(v) })} /></Field>
              <Field label="Amount">
                <select value={adding.amount ?? 'full'} onChange={(e) => setAdding({ ...adding, amount: e.target.value as SeedPacket['amount'] })}>
                  {AMOUNTS.filter((a) => a !== 'empty').map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
            </div>
            <div className="row gap">
              <button className="primary" disabled={!adding.plantId} onClick={() => {
                const pk: SeedPacket = { id: uid('seed'), plantId: adding.plantId!, variety: adding.variety?.trim() || undefined, year: adding.year ?? year, amount: adding.amount ?? 'full' };
                update((g) => ({ ...g, seeds: [...(g.seeds ?? []), pk] }));
                setAdding(null);
              }}>Add packet</button>
              <button onClick={() => setAdding(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="small no-print" onClick={() => setAdding({ year, amount: 'full' })}>+ Add a seed packet</button>
        )}
      </details>
    </section>
  );
}
