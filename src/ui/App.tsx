import { useGarden, type Tab } from './store.tsx';
import { SiteView } from './views/SiteView.tsx';
import { TodayView } from './views/TodayView.tsx';
import { HealthView } from './views/HealthView.tsx';
import { JournalView } from './views/JournalView.tsx';
import { BedsView } from './views/BedsView.tsx';
import { PlanView } from './views/PlanView.tsx';
import { WaterView } from './views/WaterView.tsx';
import { ForecastView } from './views/ForecastView.tsx';
import { SimulateView } from './views/SimulateView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { cToF } from '../core/util.ts';
import { WEATHER_CODES } from '../core/weather.ts';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: '🏡' },
  { id: 'site', label: 'Site & sun', icon: '☀️' },
  { id: 'beds', label: 'Beds', icon: '🟫' },
  { id: 'plan', label: 'Plan', icon: '🗓️' },
  { id: 'water', label: 'Water', icon: '💧' },
  { id: 'health', label: 'Health', icon: '🐞' },
  { id: 'forecast', label: 'Forecast', icon: '🌦️' },
  { id: 'simulate', label: 'Simulate', icon: '🧪' },
  { id: 'journal', label: 'Journal', icon: '📓' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

const SAVE_LABEL = { saving: 'Saving…', error: 'Not saved — retrying', conflict: 'Not saved', saved: 'Saved' } as const;

export function App() {
  const { ready, tab, setTab, garden, weather, saveState, server, undo, redo, canUndo, canRedo, conflict, resolveConflict, notice, clearNotice } = useGarden();
  const today = weather?.daily.find((d) => d.date === weather.today);
  const wc = today ? WEATHER_CODES[today.weatherCode ?? -1] : undefined;
  if (!ready) return <div className="boot">🌱 Loading Jardin…</div>;
  return (
    <div className="app">
      <div className="sticky-top">
        <header className="topbar">
          <div className="brand">
            <span aria-hidden="true">🌱</span> Jardin <span className="muted">· {garden.site.name}</span>
          </div>
          <nav className="tabs" role="tablist" aria-label="Sections">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-label={t.label} title={t.label} aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
                <span aria-hidden="true">{t.icon}</span> <span className="tab-label">{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="topbar-right small">
            <span className="undo">
              <button className="small" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
              <button className="small" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
            </span>
            {today && (
              <span className="today-wx" title={wc?.[0]}>
                {wc?.[1]} {cToF(today.tMaxC).toFixed(0)}° / {cToF(today.tMinC).toFixed(0)}°
              </span>
            )}
            <span className={`save-state ${saveState}`} title={server ? 'Saved to server' : 'Saved in this browser'} role="status">
              {SAVE_LABEL[saveState]}
            </span>
          </div>
        </header>
        {conflict && (
          <div className="app-banner warning" role="alert">
            <span className="grow">
              <b>This garden was changed on another device</b> while you were editing here. Your latest changes are not saved yet.
            </span>
            <button className="primary small" onClick={() => resolveConflict('theirs')}>Load their version</button>
            <button className="small" onClick={() => { if (confirm('Overwrite the other device’s changes with yours?')) resolveConflict('mine'); }}>Keep mine</button>
          </div>
        )}
        {notice && !conflict && (
          <div className="app-banner" role="status">
            <span className="grow">{notice}</span>
            <button className="small link" onClick={clearNotice} aria-label="Dismiss">Dismiss</button>
          </div>
        )}
      </div>
      <main>
        {tab === 'today' && <TodayView />}
        {tab === 'site' && <SiteView />}
        {tab === 'beds' && <BedsView />}
        {tab === 'plan' && <PlanView />}
        {tab === 'water' && <WaterView />}
        {tab === 'forecast' && <ForecastView />}
        {tab === 'simulate' && <SimulateView />}
        {tab === 'health' && <HealthView />}
        {tab === 'journal' && <JournalView />}
        {tab === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
