# Jardin — Engineering Handoff

_Last updated: 2026-11-05 · Branch `claude/jardin-garden-app` (not yet merged to `main`)_

Jardin is a garden planning **and** maintenance app: 3D sun/shade analysis of a property, square-foot-gardening (SFG) bed planning with succession and rotation, weather-driven growth/water/pest/disease models, a daily agenda, and Home Assistant (HA) irrigation control and notifications.

This document is everything the next person (or session) needs to pick the work up without re-deriving it.

---

## 0. State at a glance

| | |
|---|---|
| Repo | `groblox/jardin` · work is on **`claude/jardin-garden-app`**; `main` only has the initial commit |
| Commits | `98b9b11` v1 planner · `26dc8ea` v2 maintenance features · (this handoff commit) |
| Size | ~8.5k lines TypeScript (core ≈ 3k, UI ≈ 4k, server ≈ 0.7k), 41 unit tests in 6 files |
| Health | `npm run typecheck` clean · `npm test` 41/41 pass · `npm run build` OK · fresh clone → `npm ci && npm run build && npm start` verified |
| Verified in browser | Every tab via Playwright (light, dark, 390 px phone), no console errors; underlay/measure/calibrate; undo/redo; manual watering |
| Verified against fake HA | valve on/off, auto-watering decision, notify digest, sensor publishing (see §3.4) |
| **Not** verified | A real Home Assistant; the Docker image; the HA add-on build/install; OSM/Overpass from a normal network |
| In-flight design | "Survey my yard" — auto-import trees/buildings + photo-based height measurement (§9.1). User asked whether to build steps 1 + 2; **no answer yet** |

---

## 1. Brief and user context

Original request (verbatim): _"Garden planning / maintenance app — simulations, HA integration w/ moisture and watering controls, comprehensive sunlight measurements for finding ideal place for bed on property and forecasts — similar to some square foot gardening apps."_

Follow-up direction: _"Really hammer hard until something worthwhile is produced. We want a tool to truly help plan and maintain a healthy garden."_

Latest direction: improve **sun & site capture** — upload a top-down satellite photo plus oblique views (~65° and ~35° tilt) and have the app pick out tree heights / crown sizes (§9.1).

User preferences / environment notes:
- Do **not** create Python virtualenvs or install Python into the project.
- The user runs Home Assistant and wants real moisture-sensor + valve control.
- The user tests by cloning the branch and running locally (instructions in §3).
- US-centric defaults (feet, °F, inches, US extension-service pest data). Sample site is Philadelphia (39.95, −75.16).

---

## 2. Feature inventory (what exists today)

Tabs (in order): **Today · Site & sun · Beds · Plan · Water · Health · Forecast · Simulate · Journal · Settings**.

- **Today** — ranked agenda (urgent / today / this week / when you can): frost & heat, watering (one-tap valve run), weather-adjusted harvest readiness, due tasks (one-tap complete), pest & disease alerts, soil jobs, "in season to plant now". Bed cards with soil-water meters. Quick journal note.
- **Site & sun** — canvas map editor (buildings = prisms, trees = ellipsoid crowns, fences/hedges = thin walls with transmittance, beds). Overlays: sun-hours heatmap, clear-sky DLI heatmap, live shadows at a date/time, plain. Periods: frost-free season, solstices, equinox, whole year, a date. **Inspect sun** at any point (sun-path polar plot with obstruction skyline, day sun/shade strip, monthly sun vs. daylight). **Find best spots** for a bed of W×L. **Aerial photo underlay** + **Measure** tool that rescales the photo from a known length.
- **Beds** — time-aware SFG grid: season selector + date scrubber; plantings occupy squares for intervals; clicking a square with a plant brush auto-schedules into the next free slot in that crop's planting window; square history; "plant after this" suggestions; per-bed season strip (mini Gantt); checks (companions active together, sun vs. need, tall-crop shading, rotation); planting panel (planned/planted/pulled dates, count, harvest logging); bed panel (dims, soil, mulch, summary, expected yield, soil tests with pH/lime/sulfur/compost advice).
- **Plan** — season Gantt (indoors → in bed → harvest, plus planting-window underlines), task list (start indoors, harden off, prep squares, sow/transplant, side-dress, harvest) with Done actions, "growing now" table, "plant now", expected vs. logged harvest.
- **Water** — per-bed FAO-56 water balance (30 days back + 16 forecast), sensor history, recommendation (inches / gallons / minutes), Water now / Stop / Log hand watering, mode off/suggest/auto, HA entity pickers, sensor dry/wet calibration, flow/efficiency/window/max-run/rain-skip.
- **Health** — degree-day pest timing with projected dates; disease pressure (late blight, TOMCAST early blight/Septoria, powdery & downy mildew, blossom drop); leaf-wetness chart; log sightings/treatments (a tomato treatment resets TOMCAST).
- **Forecast** — 16-day table + temperature & water charts, frost/crop alerts, **per-bed sunlight forecast** (bed's modelled shading × forecast cloudiness).
- **Simulate** — replay any of the last 15 years of archived weather against a bed's plan (incl. successions): harvest dates, frost/heat days, weekly water budget, total irrigation.
- **Journal** — harvest/note/pest/disease/treatment/fertilize/amend/sow entries, filters, harvest totals vs. expected (lb), CSV export.
- **Settings** — location (GPS), property size, map north, frost dates (+ estimate from 10 years of history), HA connection, notifications/sensor publishing, JSON import/export/reset.
- Global: undo/redo (buttons + Ctrl/Cmd+Z, Ctrl+Shift+Z/Ctrl+Y), autosave, light/dark themes, phone layout.

---

## 3. Running, testing, verifying

### 3.1 Requirements
Node **≥ 22.18** (the server runs `.ts` directly via Node's built-in type stripping). No runtime npm dependencies on the server.

### 3.2 Commands
```bash
git clone --branch claude/jardin-garden-app https://github.com/groblox/jardin.git && cd jardin
npm install
npm run build && npm start        # http://localhost:8787  (data in ./data)
npm run dev:server                # API on :8787 with --watch
npm run dev                       # Vite UI on :5173, proxies /api → :8787
npm test                          # vitest, 41 tests
npm run typecheck                 # tsc --noEmit (TypeScript 7)
```
Env vars: `PORT` (8787), `DATA_DIR` (./data), `HA_URL`, `HA_TOKEN`, `SUPERVISOR_TOKEN` (set automatically inside an HA add-on).

### 3.3 Modes
- **Server mode** (normal): UI detects `/api/health`, stores data on the server.
- **Static mode**: `dist/` served anywhere without the server → data in `localStorage` (`jardin.garden.v1`), weather straight from Open-Meteo, HA/valves unavailable.
- **HA demo mode**: server with no HA configured → simulated `sensor.demo_bed_N_soil_moisture` + `switch.demo_bed_N_valve` (N = 1..4), notifications logged to stdout.

### 3.4 Testing the HA integration without HA
```bash
node scripts/fake-ha.ts                                   # fake HA REST on :8123, token "testtoken"
HA_URL=http://localhost:8123 HA_TOKEN=testtoken PORT=8788 DATA_DIR=/tmp/jt node server/index.ts
curl localhost:8788/api/ha/status                         # → mode "manual", ok
curl -XPOST localhost:8788/api/irrigation/<bedId>/run -d '{"minutes":0.5}'
curl -XPOST localhost:8788/api/notify/test
curl localhost:8123/__log                                 # every request Jardin made to "HA"
```
Point a bed at `sensor.bed_moisture` / `switch.bed_valve` (Water tab or edit `garden.json`). Auto mode is evaluated 10 s after start and every 5 min; the watering window is local time and **end-exclusive** — use a window that contains "now".

### 3.5 Visual verification recipe (what was used)
Playwright is pre-installed in the cloud sandbox; ESM scripts must load it via `createRequire(import.meta.url)('playwright')`. Pattern: start server with a fresh `DATA_DIR`, open `http://localhost:8787/`, wait ~5 s (weather + sun worker), click tabs by role (`getByRole('tab', { name, exact: true })`), screenshot full page, collect `pageerror`/console errors. Phone check: viewport 390×844, assert `document.documentElement.scrollWidth === 390`.

### 3.6 Unit tests (tests/)
| File | Covers |
|---|---|
| `solar.test.ts` | NOAA sun position vs. reference, equinox sunrise azimuth, day length, southern hemisphere, clear-sky bounds |
| `shade.test.ts` | open ground sun hours/DLI, wall shadow, map rotation, deciduous leaf-on/off + skyline, placement avoids house shadow |
| `garden.test.ts` | water balance (drying, refill, drainage, sensor override, runtime↔depth), growth rates & frost warnings, tasks, plant-now, planning year, bed warnings, frost-date estimation, crop-specific refill points, canopy spread |
| `succession.test.ts` | slot scheduling after a crop, frost-bound refusal, fall window, date occupancy, removed crops stop using water, rotation, follow-ons, migration, soil advice/lime/sulfur/target pH |
| `health.test.ts` | degree-day cutoffs, squash-vine-borer stages & ETA, host filtering, TOMCAST table, Hutton periods, treatment reset |
| `today.test.ts` | agenda ordering (frost first), watering item, merged harvest items, digest, wet sensor suppresses watering |

---

## 4. Architecture

```
src/core/   Pure TypeScript domain logic — no DOM, no Node APIs. Imported by BOTH the UI and the server.
src/ui/     React 19 SPA (Vite 8). Canvas map, hand-rolled SVG charts, Web Worker for sun maps.
server/     node:http API (no framework, zero deps), JSON file storage, HA client, schedulers.
scripts/    Dev/research tools (fake HA, canopy-height probe).
jardin/     Home Assistant add-on (config.yaml, Dockerfile, DOCS.md).
tests/      Vitest unit tests for src/core.
```

Data flow:
```
UI (store.tsx) ──GET/PUT /api/garden──▶ server ─▶ data/garden.json
   │  weather/season-weather/archive ──▶ server caches ─▶ Open-Meteo
   │  ha/value, ha/history, irrigation/* ──▶ server ─▶ HA REST (or demo sim)
   └─ computes agenda, water sims, growth, health locally (same core code the server uses)
server timers: valve shut-off (15 s) · auto-watering (5 min) · agenda/digest/frost/publish (5 min)
```

Conventions:
- Imports use explicit `.ts` extensions; **erasable syntax only** (`erasableSyntaxOnly`: no enums, no parameter properties, no namespaces) so Node can strip types.
- Layout units are **feet** (map origin top-left, x right, y down). Physics is **metric** internally (mm, °C, MJ, mol); display is imperial (°F, inches, gallons).
- Dates are local `YYYY-MM-DD` strings; `parseIso` returns local noon to dodge DST edges. Weather "today" comes from Open-Meteo in the site's time zone.
- Vite `base: './'` and the client builds API URLs relative to `document.baseURI` (`api/...`) so HA ingress path prefixes work; the server strips everything before `/api/`.

---

## 5. Data model (`src/core/types.ts`)

```
Garden { version: 1, site, beds[], journal[], notify, updatedAt }
Site   { name, lat, lon, widthFt, depthFt, northDeg, lastFrost "MM-DD", firstFrost "MM-DD",
         obstacles[], underlay? { dataUrl, x, y, widthFt, opacity } }
Obstacle = building { points[[x,y]], heightFt }
         | tree     { x, y, canopyRadiusFt, heightFt, trunkHeightFt, deciduous }
         | fence    { x1,y1,x2,y2, heightFt, transmittance }
Bed    { id, name, x, y, widthFt, lengthFt, heightFt, soilDepthIn, soil, mulched,
         plantings[], irrigation, soilTests?[], analysis? { sunHours, maxSunHours, dli, computedAt } }
BedPlanting { id, plantId, col, row, season, plannedOn?, plantedOn?, removedOn?, method, count? }
BedIrrigation { valveEntity?, moistureEntity?, sensorDry, sensorWet, flowGpm, efficiency,
                mode off|suggest|auto, windowStartHour, windowEndHour (end-exclusive, may wrap), maxMinutes, rainSkipIn }
SoilTest { date, ph, organicMatterPct?, n?/p?/k? low|medium|high|very-high }
JournalEntry { id, date, kind, bedId?, plantingId?, plantId?, qty?, unit?, text? }
NotifySettings { service?, dailyDigest, digestHour, frostAlerts, publishSensors }
IrrigationEvent { id, bedId, start ISO, minutes, depthMm, source manual|auto, note? }   (server-owned)
WeatherBundle { lat, lon, timezone, utcOffsetSeconds, today, daily[], hourly?, fetchedAt }
```

- `season` = the year of the spring last frost the planting belongs to (garlic planted in fall S is still season S in the scheduler; its interval runs into S+1).
- `Bed.analysis` is written by the UI after the growing-season sun map is computed (with `history: false` so it doesn't pollute undo). The server uses it to scale ET for shaded beds.
- `migrateGarden()` (`core/defaults.ts`) upgrades older saves: adds `journal`, `notify`, `soilTests`, and assigns `season` from `plantedOn` (via `seasonOfDate`) or the planning year. Run on load in both UI and server, and on every `PUT /api/garden`.
- `sampleGarden(today)` builds a demo: 80×100 ft lot, house/garage/oak/spruce/fences, Bed 1 planned for the planning season (incl. lettuce→beans succession, eggplant after last year's potatoes for a rotation warning, a soil test), and Bed 2 with fall crops planted **relative to today** so the Today/Health tabs have content in any month.

---

## 6. Core modules — algorithms, constants, sources

### 6.1 `solar.ts`
NOAA/Meeus low-precision solar position (azimuth clockwise from north, refraction-corrected elevation). `sunTimes` scans the solar day at 2-min steps (robust at high latitude). Clear sky: Kasten–Young air mass, Meinel DNI = 1361·0.7^(AM^0.678), DHI = 0.1·DNI·max(sin el, 0.1) + 15·sin el. PAR ≈ 2.05 µmol/m²/s per W/m² global.

### 6.2 `shade.ts`
- Sun direction on the map: map bearing = azimuth + `northDeg`; unit vector (sin, −cos) because y is down.
- Ray tests from (x, y, z0 = 1 ft): building prism → first edge intersection distance d, blocked if z0 + d·tan(el) < height (or point inside footprint); fence segment → same with transmittance; tree crown → 3D ray vs. ellipsoid (radius r, half-height (H−trunk)/2), any forward hit multiplies by τ.
- τ: evergreen 0.10, deciduous in leaf 0.20, leafless 0.65. Leaf-on = lastFrost − 14 d … firstFrost + 21 d.
- `computeSunMap`: grid sized to ≤ ~12 000 cells (`chooseCellFt`), 10-min steps (15 when > 4 dates), averages direct sun hours and DLI (beam × τ + diffuse × (0.55 + 0.45·open fraction)). Growing-season period = 8 evenly spaced dates across the frost-free season. Runs in `ui/sun.worker.ts`.
- `horizonProfile`: per 3° azimuth, highest blocked elevation (1° steps). `pointDay`, `pointYear` for the inspector. `instantShade` for live shadows.

### 6.3 `placement.ts`
Summed-area tables over sun hours, DLI, "meets target", and blocked/occupied cells (existing beds + 2 ft clearance). Score = mean sun + 2 × fraction meeting target; greedy non-overlapping top-K; both orientations.

### 6.4 `plants.ts`
40 crops: SFG spacing (`perSquare`, `span` 1/2), sun min/ideal hours, season, frost class, DTM, harvest days, indoor-start/transplant/direct-sow/fall-sow offsets (weeks vs. frost dates), succession interval, base/opt/max temps, bolting, FAO Kc (ini/mid/end), root depth, height, companions/avoid, notes; plus `EXTRA` table: feeder class, pH range, yield lb/sq ft, perennial flag. `ROTATION_YEARS` by family (Solanaceae/Brassicaceae/Amaryllidaceae 3, Cucurbitaceae/Fabaceae/Apiaceae/Amaranthaceae 2, Asteraceae/Poaceae 1). Values are typical home-garden figures — reasonable, not authoritative.

### 6.5 `schedule.ts`, `succession.ts`, `tasks.ts`
- `seasonFor(site, year)` (first frost moved to next year if it precedes last frost → southern hemisphere works). `planningYear`: once this season's first frost has passed, plan next year.
- `plantTimeline` derives start-indoors / transplant / direct-sow window / fall sow / harvest from frost dates.
- **Intervals**: start = plantedOn ?? plannedOn ?? ideal start; end = removedOn ?? start + DTM (×0.88 for transplants) + harvestDays + 7 (cleanup); perennials effectively infinite.
- **`scheduleSlot`**: windows = transplant [T−7, T+21] / direct-sow window / fall [F−7, F+14]; earliest candidate ≥ `earliest`; skips past clashing intervals in any shared square; refuses if maturity > latest (tender FF−7 d, half-hardy FF+21, hardy FF+60) except overwintering crops (hardy & DTM > 150, i.e. garlic).
- **Rotation**: same family in shared squares in a previous season within `ROTATION_YEARS` → warn; same family twice in one season → info.
- **Follow-ons**: every crop that schedules after the last crop in the square; score = 10 − gap/7, −8 same family, +3 legume/light after heavy feeder, +3 heavy after legume.
- **Tasks**: per planting (merged across squares with identical kind/bed/crop/date): start indoors, harden off (−7 d), prep squares (when a previous crop in the same squares ends within 45 days before), sow/transplant, side-dress heavy feeders at 40% and 75% of DTM, harvest window, perennial spring care.

### 6.6 `water.ts` (FAO-56 single-coefficient, root-zone depletion)
- Soils (FC/WP volumetric): sand .10/.04, sandy-loam .18/.08, loam .28/.12, clay-loam .34/.18, clay .40/.24, raised-mix .38/.12.
- Root zone = clamp(max planted root depth or 8 in, 6, bed soil depth). TAW = (FC−WP)·depth.
- Bed Kc = canopy-area-weighted crop Kc (stage fractions: initial < 0.2, development < 0.45 linear, mid < 0.85, late) + bare soil 0.35 / mulched 0.15. **Canopy spread**: squares × min(2.5, 1 + 0.25·max(0, height−1.5 ft)), growing in from 10%→50% progress; total capped at bed area.
- **Refill point** = most drought-sensitive active crop's FAO p (`MAD_BY_PLANT`, e.g. spinach 0.20, lettuce 0.30, tomato 0.40, squash 0.50; default 0.5).
- Effective rain: < 1 mm → 0, else 90%; forecast rain × probability. ET scaled by 0.5 + 0.5·(bed sun / open sun).
- Sensor: fraction of available water = (reading − dry)/(wet − dry), clamped 0–1.2, overrides depletion on today's row; recommendation uses the sensor state directly when present.
- Recommendation: water-now when projected depletion ≥ RAW unless probability-weighted rain over today + next 2 days ≥ 70% of the need (→ rain-expected); else first forecast day crossing RAW (water-soon).
- Runtime minutes = inches × sq ft × 0.623 gal / gpm / efficiency.

### 6.7 `growth.ts`
Thermal-time rate vs. catalogue conditions: ≤ base → 0.05; base→opt: min(1.3, (T−base)/(0.7·(opt−base))); opt→max: declines to 0.05; × (0.4 + 0.6·clamp(sun/ideal, 0.3, 1)). Transplants start at 12% progress. Frost thresholds: tender 1 °C, half-hardy −2 °C, hardy −7 °C. Warnings: frost, heat bolting (2nd day > max), cold nights for tender crops. Beyond the forecast, optional `normals` (same MM-DD last year) else catalogue rate.

### 6.8 `health.ts`
- Degree days °F, modified average with 86 °F upper cutoff, from biofix Jan 1 (Jul 1 south of the equator).
- Pests (`PESTS`): cabbage maggot (base 43: 200 first flies, 300 peak eggs), onion maggot (40: 250, 390), seedcorn maggot (39: 200, 600), Colorado potato beetle (50: 185, 400), European corn borer (50: 375, 550), squash vine borer (50: 900, 1000), Japanese beetle (50: 1000). **High** while within an event…last event + `activeDd`; **watch** if next event projected within 14 days (forecast, then last year's weather as normals). Only pests whose hosts are in the current season's plan are shown. Thresholds are approximate US extension figures.
- Diseases from **hourly** forecast data (`wetnessByDay`: wet hour = RH ≥ 90% or precip ≥ 0.1 mm):
  - Late blight — Hutton criteria (2 consecutive days, min ≥ 10 °C and ≥ 6 h RH ≥ 90%), past 7 + next 7 days.
  - TOMCAST — daily DSV 0–4 from wet hours × mean wet temperature (standard table), accumulated since max(last treatment, first tomato planting, 21 days ago); high ≥ 15, watch ≥ 10 or forecast total ≥ 15.
  - Powdery mildew (cucurbits) heuristic: days with mean 20–30 °C, mean RH ≥ 50%, rain < 2 mm (≥ 8 high, ≥ 4 watch of the 14-day window).
  - Downy mildew (basil/cucumber/melon) heuristic: ≥ 6 wet hours at 12–23 °C (≥ 5 high, ≥ 2 watch).
  - Blossom drop for flowering tomato/pepper/eggplant/bean: min < 13 °C, max > 32 °C or min > 24 °C.

### 6.9 `soil.ts`
Target pH = intersection of planned crops' ranges (median of midpoints if none). Lime lb/100 sq ft per pH unit: sand 3, sandy-loam 4.5, loam 6, clay-loam 7.5, clay 8.5, raised-mix 5 (max 5 per application). Elemental sulfur: 1 / 1.25 / 1.5 / 2 / 2.5 / 1.5 (max 2 per application). N/P/K and organic-matter advice (OM target ≥ 8% raised beds, ≥ 4% in-ground). Compost top-dress volume; Mel's-mix fill volume.

### 6.10 `today.ts` (agenda engine — shared by UI and server digest)
Priority 0 frost (next 48 h, ≤ crop threshold + 1 °C, planted non-perennials) · 1/2 heat (≥ 32 °C within 3 days) · watering per bed (`evaluateBed`) · harvest-ready (growth sim; perennials only "as needed" in season) · due tasks (≤ 3 days ahead, ≤ 21 days overdue; side-dress/prep hidden once journaled) · pests/diseases (high = 1, watch = 2) · soil jobs (10 weeks before last frost, or after first frost) · plant-now opportunities. `agendaDigest` → notification title/body.

### 6.11 `weather.ts`
Open-Meteo forecast: daily (Tmax/Tmin/precip/precip-prob/ET₀/radiation/sunshine/weather code) + hourly (temp, RH, precip), `past_days=30`, `forecast_days=16`, `timezone=auto`. Archive API for history. `fetchSeasonWeather`: archive from biofix to today−6 + forecast, plus last year as normals. `estimateFrostDates`: median last spring / first fall ≤ 0 °C over the years supplied (hemisphere-aware).

### 6.12 `simulate.ts`, `journal.ts`, `bed.ts`, `defaults.ts`, `util.ts`
Season replay with ideal auto-irrigation (refill whenever the crop-specific refill point is crossed), yields vs. expected, companion/sun/height/rotation warnings, migrations/sample data, small date/unit helpers.

---

## 7. UI notes (`src/ui/`)

- `store.tsx` — single context: garden, autosave (700 ms debounce), server probe, weather (1 h server cache), season weather, sensor readings (60 s), irrigation status (15 s), sun maps (two workers: selected period + always-on growing season), bed `analysis` caching, tab persistence (`localStorage jardin.tab`), **undo/redo** (80 snapshots, edits within 700 ms coalesced; bookkeeping outside React updaters because StrictMode double-invokes them).
- `components/Chart.tsx` — generic SVG line/bar/stacked chart sized to its container (pixel-true text), hover crosshair + tooltip, legend for ≥ 2 series, reference lines, forecast band. `SunPath.tsx` — polar sun-path + skyline.
- Colours follow the dataviz skill's validated reference palette (`--series-1..4` in fixed order), reserved status colours always paired with an icon + label (`components/Field.tsx` `Status`), and a single-hue amber ramp for sunlight magnitude with separate light/dark steps (`sunColors.ts`). Canvas reads CSS tokens at draw time; `useThemeVersion` redraws on theme change.
- Views are self-contained files in `views/`. `SiteView.tsx` is the largest (canvas editor, tools, overlays, inspector, placement, measure, underlay).
- Timezone: clock times show in the garden's time zone (`format.ts fmtTime(t, weather.timezone)`).

---

## 8. Server (`server/`)

| Route | Purpose |
|---|---|
| `GET /api/health` | probe |
| `GET/PUT /api/garden` | load/save (validated, migrated) |
| `GET /api/weather?lat&lon` | forecast bundle (1 h memory cache + disk fallback when Open-Meteo fails) |
| `GET /api/season-weather?lat&lon` | YTD + forecast + normals (cached per day) |
| `GET /api/archive?lat&lon&start&end` | historical daily weather (disk-cached per range) |
| `GET /api/agenda` | server-computed agenda (same engine as UI) |
| `GET /api/notify/status`, `POST /api/notify/test` | digest status / send now |
| `GET /api/ha/status`, `PUT /api/ha/config` | mode/version; save URL + token (`data/secrets.json`) |
| `GET /api/ha/entities`, `/api/ha/history?entity&hours`, `/api/ha/value?entity` | entity pickers, sensor history, live value |
| `GET /api/irrigation`, `GET /api/irrigation/:bed/evaluate` | events/active runs/decisions; recommendation |
| `POST /api/irrigation/:bed/run {minutes}`, `/stop`, `/log {minutes,note}` | valve control and manual log |

- **HA client** (`ha.ts`): modes `addon` (Supervisor at `http://supervisor/core`), `manual` (URL + long-lived token), `demo` (simulated). Valves: `switch`/`input_boolean` → `turn_on/off`, `valve` → `open_valve/close_valve`. `callService`, `setState` (POST `/api/states/<id>`).
- **Irrigation controller** (`irrigation.ts`): active runs persisted in `data/irrigation.json`; shut-off enforced every 15 s and at start-up (a failed close is retried — the run stays active); manual runs capped at 120 min, auto at `maxMinutes`; auto mode runs once per local day inside the window, skips when not needed or when rain ≥ `rainSkipIn` is expected in ~24 h; decisions recorded per bed.
- **Agenda/notifications** (`agenda.ts`): every 5 min — digest once per day at `digestHour` (local), frost alert once per day after 15:00 when a frost item exists, publish `sensor.jardin_<bed-slug>_soil_water` (state %, attributes: recommendation, message, water_in, gallons, minutes, next_watering) and `sensor.jardin_todo_today` (count + item titles). No `notify.service` → `persistent_notification.create`.
- **Files in `DATA_DIR`**: `garden.json`, `irrigation.json`, `notify.json`, `secrets.json` (HA token), `weather-cache.json`, `archive-*.json`. Writes are atomic (tmp + rename) and serialised per file.
- Body limit 25 MB (photo underlays are stored as data URLs inside `garden.json`, downscaled to ≤ 2400 px JPEG on upload).

**Security:** the standalone server has **no authentication**. Anyone who can reach the port can read the garden and run valves. Keep it on a trusted LAN, bind behind a reverse proxy with auth, or use the HA add-on (ingress is authenticated by HA).

---

## 9. Roadmap

### 9.1 Next up: "Survey my yard" (designed, not built)

Goal: replace hand-drawing obstacles with (1) an automatic draft from open data and (2) photo-based height measurement — the user's idea of a top-down satellite photo plus ~65° and ~35° oblique views.

**Step 1 — Automatic draft**
1. **Georeference the map** (prerequisite gap): the site has a single lat/lon and `northDeg`, but map feet are not tied to geographic coordinates. Add `site.origin { lat, lon }` (map (0,0)) or define lat/lon as the map centre, and helpers `feetToLatLon` / `latLonToFeet` (local equirectangular is fine at yard scale; apply `northDeg` rotation). Let the user set it by clicking their property on the photo underlay or entering the address/GPS at a corner.
2. **Trees from the Meta/WRI global 1 m canopy height map** (verified reachable and decodable — `scripts/probe-canopy.ts`):
   - Tiles: `https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/<quadkey>.tif`, zoom-9 Web-Mercator quadkeys; index at `…/tiles.geojson`.
   - Format: BigTIFF, 65 536 × 65 536 px, **uint8 metres**, deflate + horizontal predictor, **RowsPerStrip = 1 (stripped)**; StripOffsets @ byte 524 660, StripByteCounts @ 372 (uint64 each); ModelPixelScale @ 1 049 016, ModelTiepoint @ 1 049 040 (EPSG:3857). ≈ 1.194 m/px in Mercator metres (≈ 0.91 m ground at 40° N). Reading N rows costs ≈ 13 KB per row; a yard plus ~30 m margin ≈ 150 rows ≈ 2 MB. Do this **server-side** (no CORS concerns, cache the window in `DATA_DIR`).
   - Crown extraction: 3×3 smooth → local maxima ≥ 3 m with height-scaled minimum separation → region-grow/watershed down to ~50% of the top or 2 m → crown radius = √(area/π), height = max, trunk/crown-base default 0.3 × height (editable), deciduous unknown → ask. Include trees **outside** the property boundary (neighbours' trees often cast the most shade); render them faded.
   - Caveats to surface: imagery ~2018–2020, typical error 2–3 m, tends to underestimate tall trees, buildings are not in the CHM.
3. **Buildings from OpenStreetMap** via Overpass: `[out:json];way["building"](around:R,lat,lon);out geom;` → footprints in local feet. Height from `height` or `building:levels` × ~10 ft + roof; otherwise default and mark "height unknown". Overpass was **not reachable from the cloud sandbox** (both overpass-api.de and kumi.systems returned nothing) — test from a normal network; consider a fallback endpoint list and caching.
4. Add `source: 'canopy-map' | 'osm' | 'photo' | 'manual'` and `confidence` to obstacles; show an "Imported — review heights" checklist.

**Step 2 — Heights from photos (single-view metrology)**
- **Shadow ratio** (one top-down photo, no date/time needed): user marks base → shadow tip for one object of known height and for each unknown object; h = h_ref × L_shadow / L_ref_shadow (same image, flat ground). Quick fallback.
- **Oblique views** (Google Earth 3D at any tilt; 35–65° works best):
  1. User clicks ≥ 4 ground-level correspondences between the top-down (already georeferenced to feet) and the oblique image (house corners at ground, driveway corners, bed corners). Solve the ground-plane homography H (normalised DLT; least squares + residuals when > 4).
  2. Recover the camera: assume principal point = image centre, square pixels, zero skew. With centred coordinates and columns a = h1, b = h2 of H: orthogonality gives f² = −(aₓbₓ + a_y b_y)/(a_z b_z); equal norms give f² = −(aₓ² + a_y² − bₓ² − b_y²)/(a_z² − b_z²) — use the better-conditioned one or average. Then K, r1 = K⁻¹h1/‖·‖, r2 = K⁻¹h2/‖·‖, r3 = r1 × r2 (sign so the camera is above ground), t = K⁻¹h3/λ, P = K[r1 r2 r3 t].
  3. Height: user clicks an object's base (→ ground X,Y via H⁻¹) and its top pixel u; solve Z from the two linear projection equations of P·[X, Y, Z, 1] ~ u (least squares). Crown base (lowest branches) the same way. Two oblique views → two estimates → show agreement.
  4. The tilt angle is not needed (it falls out of the solve). Warn when points are clustered or the tilt is near-vertical (tiny parallax). Google Earth UI overlays should be cropped.
- Fully automatic detection in obliques is not recommended (unreliable); top-down crown auto-detection by colour (excess-green 2G−R−B + texture) is a reasonable optional helper to seed tree positions.

**Step 3 — Ground truth (optional)**
- Phone clinometer: stand a measured distance from the trunk, aim along the phone edge at the top (DeviceOrientation); h = d·tan(θ) + eye height. iOS requires HTTPS + permission (works via HA ingress over HTTPS; not over plain LAN HTTP).
- Skyline sweep from a bed spot (compass + tilt) → measured horizon profile to compare with / correct the model (`horizonProfile`).

Open questions for the user: build steps 1 + 2 now? Can they provide top-down + 35°/65° screenshots of their yard (and their address/GPS) for testing?

### 9.2 Other worthwhile next steps (rough priority)
1. **Merge/PR to `main`** (the add-on Dockerfile clones `main` by default; repo must be public or reachable from the HA host). Then actually build the add-on and the Docker image; consider publishing an image to GHCR and using `image:` in `jardin/config.yaml`.
2. Run against the user's **real HA**; check `valve.*` domains, `input_boolean` helpers, `notify.mobile_app_*`, and published sensors on an HA dashboard.
3. **Server auth** for standalone mode (token or basic auth; at minimum bind-address option).
4. **Seed inventory & seed-starting quantities** (germination rate, seed age, cells to start = plants ÷ germination × safety).
5. **Validate sunlight with an HA illuminance sensor** (lux > ~20–30 klx ≈ direct sun) vs. the model at that spot.
6. Units toggle (metric), localisation of dates/numbers in notifications.
7. More pests/diseases and southern-hemisphere pest data; regional biofix options.
8. Per-square or per-crop watering zones (the model treats a bed as one zone).
9. Fruit trees/berries/perennial beds; cover crops between seasons.
10. Performance: sun-map worker recomputes on every site change — fine at ≤ 12k cells; consider incremental updates for large properties.

---

## 10. Known issues, limitations, gotchas

- **Models are planning aids, not truth**: catalogue DTMs, typical yields, extension pest thresholds, leaf wetness from RH ≥ 90%, clear-sky DLI. The README's "Model notes and limits" section says the same to users.
- **Water** is bed-averaged; calibrated sensors are the main correction. Sparse beds rarely need water — expected, not a bug (sample bed: 5 waterings/71 gal in 2025; fully planted tomato/pepper bed: 10 waterings/204 gal, ~23" crop use).
- **Sample data is date-relative** (Bed 2 planted N days ago, planning season = next season after first frost). Screens look different in different months — intentional.
- **Watering window end hour is exclusive** (0–24 allowed; windows may wrap past midnight).
- **Open-Meteo** rate-limits shared IPs (seen once in the sandbox). The server caches forecast 1 h and falls back to the last good copy; archive responses are cached on disk.
- **Sandbox network**: Overpass and USGS 3DEP (`elevation.nationalmap.gov`) were unreachable/502 from the cloud environment; S3 (canopy map) and Open-Meteo worked.
- **TypeScript 7** (native compiler) is used for type-checking; Vite/esbuild transpile for the UI; Node strips types for the server. Keep syntax erasable.
- Playwright in ESM scripts needs `createRequire` (see §3.5).
- Fixed during development (regression-tested): shared array mutation when merging tasks; wet sensor still recommending water; StrictMode double-invoked undo; perennials shown as overdue harvests; missing accessible names on icon-only phone tabs.

---

## 11. File map

```
src/core/  types · util · solar · shade · placement · plants · bed · succession · schedule · tasks
           water · growth · health · soil · today · journal · simulate · weather · defaults
src/ui/    main · App · store · api · hooks · format · sunColors · sun.worker · styles.css
           components/ Chart · SunPath · Field
           views/ Today · Site · Beds · Plan · Water · Health · Forecast · Simulate · Journal · Settings
server/    index (routes/static) · store (JSON files) · ha (client/demo) · weather (caches)
           irrigation (valves/auto) · agenda (digest/frost/publish)
scripts/   fake-ha.ts (fake HA REST) · probe-canopy.ts (1 m canopy-height window reader)
jardin/    HA add-on: config.yaml · Dockerfile · DOCS.md
tests/     solar · shade · garden · succession · health · today
Dockerfile · repository.yaml · README.md · handoff.md
```
