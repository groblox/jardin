// Jardin server: JSON API + static UI. Zero runtime dependencies (node:http).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import type { Garden } from '../src/core/types.ts';
import { sampleGarden } from '../src/core/defaults.ts';
import { readJson, writeJson } from './store.ts';
import { loadHaConfig, saveHaConfig, haStatus, getStates, history, readNumber } from './ha.ts';
import { getForecast, getArchive } from './weather.ts';
import { initIrrigation, irrigationState, startRun, stopRun, logManual, evaluate } from './irrigation.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = join(process.cwd(), 'dist');

let garden: Garden = await readJson<Garden>('garden.json', sampleGarden());
await loadHaConfig();
await initIrrigation(() => garden);

type Handler = (req: IncomingMessage, url: URL, params: string[]) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp('^' + path.replace(/:[a-z]+/gi, '([^/]+)') + '$'), h]);

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 5_000_000) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

const num = (u: URL, k: string) => {
  const v = Number(u.searchParams.get(k));
  if (!Number.isFinite(v)) throw Object.assign(new Error(`Missing ${k}`), { status: 400 });
  return v;
};

route('GET', '/api/health', async () => ({ ok: true }));
route('GET', '/api/garden', async () => garden);
route('PUT', '/api/garden', async (req) => {
  const g = await body(req);
  if (g?.version !== 1 || !g.site || !Array.isArray(g.beds)) throw Object.assign(new Error('Invalid garden'), { status: 400 });
  garden = { ...g, updatedAt: new Date().toISOString() };
  await writeJson('garden.json', garden);
  return { ok: true, updatedAt: garden.updatedAt };
});

route('GET', '/api/weather', async (_r, u) => getForecast(num(u, 'lat'), num(u, 'lon')));
route('GET', '/api/archive', async (_r, u) => {
  const start = u.searchParams.get('start') ?? '';
  const end = u.searchParams.get('end') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw Object.assign(new Error('Bad dates'), { status: 400 });
  return getArchive(num(u, 'lat'), num(u, 'lon'), start, end);
});

route('GET', '/api/ha/status', async () => haStatus());
route('PUT', '/api/ha/config', async (req) => {
  const b = await body(req);
  await saveHaConfig({ url: b.url, token: b.token });
  return haStatus();
});
route('GET', '/api/ha/entities', async () =>
  (await getStates())
    .filter((e) => /^(sensor|switch|valve|input_boolean|binary_sensor)\./.test(e.entity_id))
    .map((e) => ({
      id: e.entity_id,
      name: e.attributes.friendly_name ?? e.entity_id,
      state: e.state,
      unit: e.attributes.unit_of_measurement,
      deviceClass: e.attributes.device_class,
    })),
);
route('GET', '/api/ha/history', async (_r, u) => history(u.searchParams.get('entity') ?? '', Math.min(24 * 30, num(u, 'hours'))));
route('GET', '/api/ha/value', async (_r, u) => ({ value: await readNumber(u.searchParams.get('entity') ?? undefined) }));

route('GET', '/api/irrigation', async () => irrigationState());
route('GET', '/api/irrigation/:bed/evaluate', async (_r, _u, [id]) => {
  const bed = garden.beds.find((b) => b.id === id);
  if (!bed) throw Object.assign(new Error('Unknown bed'), { status: 404 });
  const ev = await evaluate(bed);
  return { rec: ev.rec, reading: ev.reading, sensorFraction: ev.sensorFraction, taw: ev.sim.taw, raw: ev.sim.raw };
});
route('POST', '/api/irrigation/:bed/run', async (req, _u, [id]) => startRun(id, Number((await body(req)).minutes)));
route('POST', '/api/irrigation/:bed/stop', async (_r, _u, [id]) => (await stopRun(id), irrigationState()));
route('POST', '/api/irrigation/:bed/log', async (req, _u, [id]) => {
  const b = await body(req);
  await logManual(id, Number(b.minutes), b.note);
  return irrigationState();
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

async function serveStatic(pathname: string, res: ServerResponse) {
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, safe);
  try {
    if (!(await stat(file)).isFile()) throw 0;
  } catch {
    file = join(DIST, 'index.html');
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('UI not built — run `npm run build`, or use `npm run dev` for development.');
  }
}

createServer(async (req, res) => {
  // Home Assistant ingress serves us under a path prefix; strip anything before /api/.
  const url = new URL(req.url ?? '/', 'http://localhost');
  const apiIdx = url.pathname.indexOf('/api/');
  const path = apiIdx >= 0 ? url.pathname.slice(apiIdx) : url.pathname;
  if (!path.startsWith('/api/')) return serveStatic(path, res);
  for (const [method, re, h] of routes) {
    const m = path.match(re);
    if (!m || method !== req.method) continue;
    try {
      const out = await h(req, url, m.slice(1).map(decodeURIComponent));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e: any) {
      res.writeHead(e.status ?? 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message ?? String(e) }));
    }
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}).listen(PORT, () => console.log(`Jardin listening on http://localhost:${PORT}`));
