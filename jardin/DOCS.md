# Jardin

Garden planning and irrigation, inside Home Assistant.

After starting the add-on, open **Garden** in the sidebar. Jardin talks to Home Assistant
through the Supervisor automatically, so there is no token to enter.

1. **Settings** — set your location (or "Use my current location") and frost dates
   ("Estimate from local weather history" looks at the last 10 years).
2. **Site & sun** — draw your house, trees and fences with their heights, and set where north is.
3. **Beds** — plan square-foot plantings; squares are tinted by modelled sun.
4. **Water** — pick each bed's soil-moisture sensor and valve entity, calibrate the sensor,
   set the bed's flow rate, and choose *Suggest* or *Automatic*.

Valves may be `switch.*`, `valve.*` or `input_boolean.*` entities. Jardin always closes a valve
at the end of a run and re-checks after restarts. As a belt-and-braces measure, also create an
HA automation that turns each valve off if it has been on longer than your max runtime.
