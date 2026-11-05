import { useGarden, type Tab } from './store.tsx';
import { SiteView } from './views/SiteView.tsx';
import { BedsView } from './views/BedsView.tsx';
import { PlanView } from './views/PlanView.tsx';
import { WaterView } from './views/WaterView.tsx';
import { ForecastView } from './views/ForecastView.tsx';
import { SimulateView } from './views/SimulateView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { cToF } from '../core/util.ts';
import { WEATHER_CODES } from '../core/weather.ts';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'site', label: 'Site & sun', icon: '☀️' },
  { id: 'beds', label: 'Beds', icon: '🟫' },
  { id: 'plan', label: 'Plan', icon: '🗓️' },
  { id: 'water', label: 'Water', icon: '💧' },
  { id: 'forecast', label: 'Forecast', icon: '🌦️' },
  { id: 'simulate', label: 'Simulate', icon: '🧪' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export function App() {
  const { ready, tab, setTab, garden, weather, saveState, server } = useGarden();
  const today = weather?.daily.find((d) => d.date === weather.today);
  const wc = today ? WEATHER_CODES[today.weatherCode ?? -1] : undefined;
  if (!ready) return <div className="boot">🌱 Loading Jardin…</div>;
  return (
    <div className="app">
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
          {today && (
            <span className="today-wx" title={wc?.[0]}>
              {wc?.[1]} {cToF(today.tMaxC).toFixed(0)}° / {cToF(today.tMinC).toFixed(0)}°
            </span>
          )}
          <span className={`save-state ${saveState}`} title={server ? 'Saved to server' : 'Saved in this browser'}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
          </span>
        </div>
      </header>
      <main>
        {tab === 'site' && <SiteView />}
        {tab === 'beds' && <BedsView />}
        {tab === 'plan' && <PlanView />}
        {tab === 'water' && <WaterView />}
        {tab === 'forecast' && <ForecastView />}
        {tab === 'simulate' && <SimulateView />}
        {tab === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
