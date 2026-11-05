# 🌱 Jardin

Garden planning and maintenance for people who want more than a pretty grid. Jardin:

- models sunlight in 3D across your whole property and finds the best spot for a bed,
- plans square-foot beds,
- simulates crop growth and soil water from real weather,
- drives your irrigation through Home Assistant.

## Features

**Today** (home screen): one ranked list of what the garden needs from you today, and the same list goes to your phone each morning through Home Assistant. Items appear only when relevant:
- **Frost tonight/tomorrow** for tender crops actually in the ground, with how to protect them; heat waves for crops that bolt.
- **Watering** per bed from the water model and live soil sensors, with a one-tap *Water N min* button. "Rain is coming" replaces watering when the forecast will do the job.
- **Ready to harvest**, judged from weather-driven growth rather than seed-packet days, with quick harvest logging.
- **Due tasks**: start seeds, harden off, prep squares between successions, sow/transplant, side-dress heavy feeders. One tap marks them done.
- **Pest & disease alerts** for the crops you're growing (see Health).
- **Soil jobs** before the season: lime/sulfur amounts, soil-test reminders. Crops still in their planting window but not yet in your plan.

**Beds**: square-foot planning across time.
- Every planting occupies its squares for a date range, so a square can hold spring lettuce → summer beans → fall spinach. Scrub through the season to see the bed on any date.
- Click a square with a plant selected and Jardin schedules it into the first free slot in that crop's planting window. It won't let a tender crop go in too late to mature before frost.
- **What can follow**: for any square, the crops that fit the remaining season, ranked for rotation (different family, legumes after heavy feeders).
- **Crop rotation** across years: warns when nightshades, brassicas, alliums or cucurbits return to the same squares within their 2–3-year rotation interval.
- Companion conflicts only between crops growing at the same time. Squares too shady for the crop (from the sun model). Tall crops shading shorter sun-lovers.
- **Soil**: record soil tests (pH, organic matter, N-P-K). Get pH fit for the planned crops, exact lime/sulfur pounds for the bed by soil type (split into safe doses), nutrient advice and compost quantities.
- Planted/pulled dates, harvest logging and expected yield per bed.

**Plan**
- Season timeline per planting (seedlings indoors → in the bed → harvest, with each crop's planting windows).
- Generated task list, including bed prep between successions and side-dressing.
- Weather-adjusted "growing now" progress, "plant now" suggestions, and expected harvest vs. logged harvest per crop.

**Health**
- **Pests timed by degree-days** since January 1, from local observed and forecast weather. Examples: cabbage/onion/seedcorn maggot flights, Colorado potato beetle, European corn borer, squash vine borer, Japanese beetle. Each gives the projected date of the next stage and what to do (row covers *before* the flight, etc.).
- **Disease pressure from hourly humidity & temperature**:
  - late blight (Hutton criteria),
  - early blight/Septoria (TOMCAST disease-severity values; logging a treatment resets the count),
  - powdery and downy mildew,
  - blossom-drop temperatures.
- Leaf-wetness chart, and a log of sightings and treatments.

**Journal**: harvests, observations, pests, treatments, feeding and amendments. Harvest totals and lb/sq ft vs. the plan's expected yield. CSV export.

**Site & sun**
- Draw your property: buildings (prisms), trees (ellipsoid crowns, deciduous or evergreen), fences and hedges, each with a real height. You can **trace over an aerial photo**: the measure tool sets its scale from any known length.
- NOAA sun positions. Every square foot is ray-cast against every obstacle, giving heatmaps of **direct-sun hours** or **clear-sky DLI** for the growing season, solstices, equinox, year or any date. Deciduous trees are leafless outside the frost-free season.
- **Shadows at time** (scrub date and time). **Inspect sun** at any spot: sun-path diagram with the obstruction skyline, a sun/shade strip through the day, and monthly sun vs. daylight.
- **Find the sunniest spot** for a new bed of any size.

**Water**
- FAO-56 daily root-zone water balance per bed:
  - crop coefficients by growth stage,
  - canopy spread of tall/trellised crops,
  - ET₀ and rain from Open-Meteo,
  - soil type and depth, mulch,
  - reduced evaporation in shade.
- The most drought-sensitive crop growing sets the refill point (FAO depletion fractions: spinach 20%, lettuce 30%, tomato 40%, squash 50%).
- **Home Assistant soil-moisture sensors**, calibrated dry/wet, override the modelled state.
- Recommendations in inches, gallons and valve minutes.
- Water now / stop / log hand-watering. **Automatic** mode waters inside a time window, skips for forecast rain, caps the runtime, and always closes valves (also after restarts).

**Forecast**
- 16-day table with frost and crop alerts.
- **Per-bed sunlight forecast**: each bed's own shading scaled by forecast cloudiness.

**Simulate**: replays any of the last 15 years of real weather against a bed's plan, including successions. Shows harvest dates vs. catalogue, frost/heat days per crop, and a weekly water budget with total irrigation.

**Home Assistant**
- Valves (`switch.*`, `valve.*`, `input_boolean.*`) and moisture sensors.
- Morning digest and afternoon frost alerts through any `notify.*` service (or a persistent notification).
- Publishes `sensor.jardin_<bed>_soil_water` (with recommendation, minutes and next-watering attributes) and `sensor.jardin_todo_today` for your dashboards and automations.
- Runs standalone, in Docker, or as an add-on in the sidebar.

**Settings**
- Location from GPS and map north.
- Frost dates **estimated from 10 years of local weather history**.
- Notifications. JSON import/export. Undo/redo everywhere (Ctrl+Z / Ctrl+Shift+Z).

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
  plants.ts      crop library (spacing, sun, timing, Kc, pH, feeder class, yield, companions)
  succession.ts  planting intervals, date-aware occupancy, slot scheduling, rotation, follow-ons
  bed.ts         companion/sun/height/rotation checks
  tasks.ts       season task list (seed starting → prep → sow → side-dress → harvest)
  soil.ts        pH fit, lime/sulfur calculator, nutrient & compost advice
  health.ts      degree-day pest models; Hutton, TOMCAST, mildew, blossom-drop risk
  today.ts       ranked daily agenda (UI + notification digest)
  journal.ts     harvest totals vs. expected yields
  water.ts       FAO-56 water balance, canopy cover, crop-specific refill points, sensors
  growth.ts      thermal-time development & weather risk alerts
  schedule.ts    frost-date seasons, planting timelines, "plant now"
  simulate.ts    whole-season replay against historical weather
  weather.ts     Open-Meteo forecast (daily + hourly), archive, year-to-date, frost dates
src/ui/        React UI (canvas map, SVG charts); sun maps computed in a Web Worker
server/        node:http API, JSON storage, Home Assistant client, irrigation controller,
               daily digest/frost notifications, HA sensor publishing
jardin/        Home Assistant add-on
```

## Model notes and limits

- Shading treats tree crowns as ellipsoids with fixed light transmission: about 20% in leaf, 65% leafless, 10% evergreen. It ignores terrain slope and reflected light.
- DLI uses a simple clear-sky model, so treat it as relative. The forecast view scales it by Open-Meteo's forecast radiation.
- The water balance treats each bed as one irrigation zone. Crops contribute by canopy area, empty squares count as bare or mulched soil, and root depth is capped by bed soil depth. Calibrated sensors are the best correction.
- Days-to-maturity are seed-catalogue figures. Development speeds up or slows down with temperature and light relative to typical conditions.
- Pest degree-day thresholds are approximate figures from US land-grant extension services and use a January 1 start, so treat them as "start scouting" prompts. Disease models estimate leaf wetness from hourly humidity ≥ 90% or rain rather than a leaf-wetness sensor.
- Yields are typical home-garden figures for SFG spacing, useful for planning quantities, not promises.
