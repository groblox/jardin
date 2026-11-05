# 🌱 Jardin

Garden planning and maintenance for people who want more than a pretty grid. Jardin:

- models sunlight in 3D across your whole property and finds the best spot for a bed,
- plans square-foot beds,
- simulates crop growth and soil water from real weather,
- drives your irrigation through Home Assistant.

## Features

**Site & sun**
- Draw your property: buildings (prisms), trees (ellipsoid crowns, deciduous or evergreen), fences and hedges (solid or partly transparent), each with a real height.
- Sun position comes from the NOAA solar algorithm. Every square foot is ray-cast against every obstacle through the day.
  - Heatmaps of **direct-sun hours** or **clear-sky DLI** (mol/m²/day).
  - Periods: frost-free season, solstices, equinox, the whole year, or any date.
  - Deciduous trees let more light through when they are leafless, between your first and last frost.
- **Shadows at time**: scrub a date and time to watch shadows move.
- **Inspect sun** at any spot:
  - sun-path diagram with the obstruction skyline (like a Solar Pathfinder),
  - a sun/shade strip through the day,
  - month-by-month direct sun vs. daylight.
- **Find the sunniest spot**: searches every position (both orientations) for a bed of a given size, avoiding buildings and existing beds plus path clearance. Ranks by average sun and the share of the bed meeting your target.

**Beds (square-foot gardening)**
- 40 crops with SFG spacing (1/4/9/16 per square, or 2×2 for squash), sun needs, days to maturity, frost hardiness, crop coefficients, root depth, height and companions.
- Squares are tinted by modelled season sun. The planner checks:
  - plants placed where the sun is too low,
  - bad companion neighbours,
  - tall crops shading shorter sun-lovers (hemisphere-aware).

**Plan**
- Season timeline (start indoors → transplant/sow → harvest) from your frost dates.
- Task list, plus a "plant now" list.
- **Growing now**: thermal-time development driven by actual and forecast temperatures and each bed's light, so harvest estimates move with the weather. Frost, heat (bolting) and cold alerts.

**Water**
- FAO-56 daily root-zone water balance per bed:
  - crop coefficients by growth stage,
  - ET₀ from Open-Meteo,
  - effective rain, mulch, soil type and depth,
  - shade-reduced evaporation.
- Live **soil-moisture sensors** from Home Assistant, with dry/wet calibration, override the modelled state.
- Recommendations come in inches, gallons and **valve minutes** (from your measured flow rate). 30 days of history plus a 16-day forecast.
- **Water now / stop / log hand-watering**, and **automatic** mode:
  - runs once a day inside a watering window when the refill point is crossed,
  - skips when rain is expected,
  - capped at a max runtime,
  - valves always get closed, including after restarts.

**Forecast**
- 16-day table: temperatures, rain and its probability, ET₀, sunshine and GDD.
- Frost and crop alerts.
- **Per-bed sunlight forecast**: each bed's own shading for each date, scaled by forecast cloudiness.

**Simulate**
- Replays any of the last 15 years of real weather against a bed's plan:
  - harvest dates vs. catalogue days,
  - frost and heat days per crop,
  - weekly water budget and total irrigation needed.

**Settings**
- Location from GPS, map north bearing, and frost dates **estimated from 10 years of local weather history**.
- Home Assistant connection.
- JSON import/export.

## Running it

Requires Node.js ≥ 22.18. The server runs TypeScript directly and has no runtime dependencies.

```bash
npm install
npm run build
npm start            # http://localhost:8787
```

Development (two terminals):

```bash
npm run dev:server   # API on :8787, restarts on change
npm run dev          # Vite UI on :5173, proxies /api
npm test             # core model tests (vitest)
npm run typecheck
```

Without Home Assistant configured, the server runs in **demo mode**. It simulates moisture sensors and valves (`sensor.demo_bed_N_soil_moisture`, `switch.demo_bed_N_valve`), so you can try everything.

The UI also works as a purely static site (`dist/`) with no server. Data then lives in the browser and weather comes straight from Open-Meteo, but Home Assistant control needs the server.

### Connecting Home Assistant

- **Standalone server:** in Settings → Home Assistant, enter your HA URL and a long-lived access token. You can also set the `HA_URL` and `HA_TOKEN` environment variables. The token is stored only on the server, in `data/secrets.json`.
- **As an add-on:** add this repository in *Settings → Add-ons → Add-on store → ⋮ → Repositories*, then install **Jardin**. It appears in the sidebar via ingress and uses the Supervisor API automatically. See [`jardin/DOCS.md`](jardin/DOCS.md). The add-on image clones this repo at build time, so the repo must be reachable from your HA host.
- **Docker:** `docker build -t jardin . && docker run -p 8787:8787 -v jardin-data:/data -e HA_URL=… -e HA_TOKEN=… jardin`

Valves may be `switch.*`, `valve.*` or `input_boolean.*`.

## Layout

```
src/core/      pure, tested domain logic shared by UI and server
  solar.ts       sun position, sunrise/sunset, clear-sky irradiance
  shade.ts       3D shadow casting, sun-hour/DLI maps, skyline, point analysis
  placement.ts   best-bed-position search (summed-area tables)
  plants.ts      crop library
  bed.ts         square-foot occupancy, companion/sun/height checks
  water.ts       FAO-56 water balance, sensor assimilation, recommendations
  growth.ts      thermal-time development & weather risk alerts
  schedule.ts    frost-date calendar, tasks, "plant now"
  simulate.ts    whole-season replay against historical weather
  weather.ts     Open-Meteo forecast/archive client, frost-date estimation
src/ui/        React UI (canvas map, SVG charts); sun maps computed in a Web Worker
server/        node:http API, JSON storage, Home Assistant client, irrigation controller
jardin/        Home Assistant add-on
```

## Model notes and limits

- Shading treats tree crowns as ellipsoids with fixed light transmission: about 20% in leaf, 65% leafless, 10% evergreen. It ignores terrain slope and reflected light.
- DLI uses a simple clear-sky model, so treat it as relative. The forecast view scales it by Open-Meteo's forecast radiation.
- The water balance is bed-averaged: each planted square uses its crop's Kc, and empty squares count as bare or mulched soil. Root depth is capped by bed soil depth. Calibrated sensors are the best correction.
- Days-to-maturity are seed-catalogue figures. Development speeds up or slows down with temperature and light relative to typical conditions.
