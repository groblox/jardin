import { useEffect, useRef, useState } from 'react';
import type { Garden, Site } from '../../core/types.ts';
import { useGarden } from '../store.tsx';
import { api, type HaStatus } from '../api.ts';
import { estimateFrostDates } from '../../core/weather.ts';
import { sampleGarden } from '../../core/defaults.ts';
import { sunTimes } from '../../core/solar.ts';
import { Field, NumberInput, Status } from '../components/Field.tsx';
import { fmtTime } from '../format.ts';

export function SettingsView() {
  const { garden, update, server, weather } = useGarden();
  const site = garden.site;
  const setSite = (patch: Partial<Site>) => update((g) => ({ ...g, site: { ...g.site, ...patch } }));
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [frostMsg, setFrostMsg] = useState<string | null>(null);
  const [frostBusy, setFrostBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const locate = () => {
    setGeoErr(null);
    navigator.geolocation?.getCurrentPosition(
      (p) => setSite({ lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) }),
      (e) => setGeoErr(e.message),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const estimateFrost = async () => {
    setFrostBusy(true);
    setFrostMsg(null);
    try {
      const y = new Date().getFullYear();
      const days = await api.archive(server, site.lat, site.lon, `${y - 10}-01-01`, `${y - 1}-12-31`);
      const f = estimateFrostDates(days, site.lat);
      if (!f) setFrostMsg('No frosts found in the last 10 years — frost-free climate? Set dates manually.');
      else {
        setSite({ lastFrost: f.lastFrost, firstFrost: f.firstFrost });
        setFrostMsg(`Median of ${f.years} years (night low ≤ 32°F at 2 m). Low spots and valleys can frost later — add a week of margin for tender crops.`);
      }
    } catch (e: any) {
      setFrostMsg(`Failed: ${e.message}`);
    } finally {
      setFrostBusy(false);
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(garden, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jardin-${site.name.replace(/\W+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (f: File) => {
    try {
      const g = JSON.parse(await f.text()) as Garden;
      if (g.version !== 1 || !g.site || !Array.isArray(g.beds)) throw new Error('Not a Jardin garden file');
      update(() => g);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const now = new Date();
  const st = sunTimes(now.getFullYear(), now.getMonth(), now.getDate(), site.lat, site.lon);
  const toMD = (v: string) => v.slice(5);
  const fromMD = (md: string) => `${now.getFullYear()}-${md}`;

  return (
    <div className="view settings-view">
      <section className="card">
        <h3>Location</h3>
        <div className="grid3">
          <Field label="Garden name"><input value={site.name} onChange={(e) => setSite({ name: e.target.value })} /></Field>
          <Field label="Latitude"><NumberInput value={site.lat} step={0.0001} min={-89} max={89} onChange={(v) => setSite({ lat: v })} /></Field>
          <Field label="Longitude"><NumberInput value={site.lon} step={0.0001} min={-180} max={180} onChange={(v) => setSite({ lon: v })} /></Field>
        </div>
        <button onClick={locate}>Use my current location</button>
        {geoErr && <Status tone="critical">{geoErr}</Status>}
        <p className="muted small">Today: sunrise {st.sunrise ? fmtTime(st.sunrise.getTime(), weather?.timezone) : '—'}, sunset {st.sunset ? fmtTime(st.sunset.getTime(), weather?.timezone) : '—'}{weather ? ` (${weather.timezone})` : ''}, {st.dayLengthH.toFixed(1)} h of daylight, noon sun {st.noonElevation.toFixed(0)}° high.</p>
      </section>

      <section className="card">
        <h3>Property</h3>
        <div className="grid3">
          <Field label="Width (left–right)"><NumberInput value={site.widthFt} min={10} max={1000} suffix="ft" onChange={(v) => setSite({ widthFt: v })} /></Field>
          <Field label="Depth (top–bottom)"><NumberInput value={site.depthFt} min={10} max={1000} suffix="ft" onChange={(v) => setSite({ depthFt: v })} /></Field>
          <Field label="North on the map" hint="Bearing clockwise from the top of the map where true north points. Use a phone compass standing at the property facing the map's 'up' direction, then enter 360 − heading.">
            <NumberInput value={site.northDeg} min={0} max={359} suffix="°" onChange={(v) => setSite({ northDeg: ((v % 360) + 360) % 360 })} />
            <input type="range" min={0} max={359} value={site.northDeg} onChange={(e) => setSite({ northDeg: +e.target.value })} aria-label="North bearing" />
          </Field>
        </div>
      </section>

      <section className="card">
        <h3>Frost dates</h3>
        <div className="grid3">
          <Field label="Average last spring frost"><input type="date" value={fromMD(site.lastFrost)} onChange={(e) => e.target.value && setSite({ lastFrost: toMD(e.target.value) })} /></Field>
          <Field label="Average first fall frost"><input type="date" value={fromMD(site.firstFrost)} onChange={(e) => e.target.value && setSite({ firstFrost: toMD(e.target.value) })} /></Field>
        </div>
        <button onClick={estimateFrost} disabled={frostBusy}>{frostBusy ? 'Analysing 10 years of weather…' : 'Estimate from local weather history'}</button>
        {frostMsg && <p className="small">{frostMsg}</p>}
      </section>

      <HaSection />

      <section className="card">
        <h3>Data</h3>
        <p className="muted small">{server ? 'Saved on the Jardin server (data/garden.json).' : 'Saved in this browser only. Run the server to share across devices.'}</p>
        <div className="row gap wrap">
          <button onClick={exportJson}>Export JSON</button>
          <button onClick={() => fileRef.current?.click()}>Import JSON</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          <button className="danger" onClick={() => confirm('Replace everything with the sample garden?') && update(() => sampleGarden())}>Reset to sample</button>
        </div>
      </section>
    </div>
  );
}

function HaSection() {
  const { server } = useGarden();
  const [status, setStatus] = useState<HaStatus | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (server) api.haStatus().then((s) => { setStatus(s); setUrl(s.url ?? ''); }, () => {});
  }, [server]);

  if (!server) {
    return (
      <section className="card">
        <h3>Home Assistant</h3>
        <Status tone="warning">The Home Assistant connection runs on the Jardin server. Start it with <code>npm start</code>, or install the Home Assistant add-on.</Status>
      </section>
    );
  }
  const save = async () => {
    setBusy(true);
    try {
      setStatus(await api.haConfig(url, token));
      setToken('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <h3>Home Assistant</h3>
      {status && (
        <p>
          {status.mode === 'demo' && <Status tone="info">Demo mode — simulated sensors (sensor.demo_bed_N_soil_moisture) and valves (switch.demo_bed_N_valve)</Status>}
          {status.mode === 'addon' && <Status tone={status.ok ? 'good' : 'critical'}>Running as an add-on {status.ok ? `· HA ${status.version}` : `· ${status.error}`}</Status>}
          {status.mode === 'manual' && <Status tone={status.ok ? 'good' : 'critical'}>{status.ok ? `Connected to ${status.url} · HA ${status.version}` : status.error}</Status>}
        </p>
      )}
      {status?.mode !== 'addon' && (
        <>
          <div className="grid2">
            <Field label="Home Assistant URL"><input value={url} placeholder="http://homeassistant.local:8123" onChange={(e) => setUrl(e.target.value)} /></Field>
            <Field label="Long-lived access token" hint="Profile → Security → Long-lived access tokens. Stored only on the Jardin server."><input type="password" value={token} placeholder={status?.mode === 'manual' ? '•••••• (saved)' : ''} onChange={(e) => setToken(e.target.value)} autoComplete="off" /></Field>
          </div>
          <button className="primary" onClick={save} disabled={busy || !url}>Save & test</button>
        </>
      )}
      <p className="muted small">Valves can be any <code>switch.*</code>, <code>valve.*</code> or <code>input_boolean.*</code>. Jardin always turns valves off at the end of a run, and again after a restart if a run was interrupted. As a second safety net, add an HA automation that turns each valve off after its max run time.</p>
    </section>
  );
}
