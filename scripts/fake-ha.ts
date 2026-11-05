// Minimal fake Home Assistant REST API for testing Jardin's HA integration without a real HA.
//
//   node scripts/fake-ha.ts                       # listens on :8123, token "testtoken"
//   HA_URL=http://localhost:8123 HA_TOKEN=testtoken PORT=8788 DATA_DIR=/tmp/jardin-test node server/index.ts
//   curl -H 'Authorization: Bearer testtoken' localhost:8123/__log   # every request Jardin made
//
// Entities: sensor.bed_moisture (22.5 %) and switch.bed_valve. Point a bed's irrigation at them.
import { createServer } from 'node:http';

const TOKEN = process.env.FAKE_HA_TOKEN ?? 'testtoken';
const log: string[] = [];
const states: Record<string, { entity_id: string; state: string; attributes: Record<string, unknown> }> = {
  'sensor.bed_moisture': { entity_id: 'sensor.bed_moisture', state: '22.5', attributes: { unit_of_measurement: '%', device_class: 'moisture', friendly_name: 'Bed moisture' } },
  'switch.bed_valve': { entity_id: 'switch.bed_valve', state: 'off', attributes: { friendly_name: 'Bed valve' } },
};

createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/__log') return res.end(JSON.stringify(log, null, 2));
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401);
    return res.end('{"message":"unauthorized"}');
  }
  log.push(`${new Date().toISOString()} ${req.method} ${req.url} ${body}`);
  if (req.url === '/api/config') return res.end(JSON.stringify({ version: 'fake-2026.11' }));
  if (req.url === '/api/states') return res.end(JSON.stringify(Object.values(states)));
  const st = req.url?.match(/^\/api\/states\/(.+)$/);
  if (st && req.method === 'GET') {
    if (states[st[1]]) return res.end(JSON.stringify(states[st[1]]));
    res.writeHead(404);
    return res.end('{}');
  }
  if (st && req.method === 'POST') {
    states[st[1]] = { entity_id: st[1], ...JSON.parse(body) };
    return res.end(JSON.stringify(states[st[1]]));
  }
  const svc = req.url?.match(/^\/api\/services\/(\w+)\/(\w+)$/);
  if (svc) {
    const id = JSON.parse(body || '{}').entity_id as string | undefined;
    if (id && states[id] && /turn_on|open_valve/.test(svc[2])) states[id].state = 'on';
    if (id && states[id] && /turn_off|close_valve/.test(svc[2])) states[id].state = 'off';
    return res.end('[]');
  }
  if (req.url?.startsWith('/api/history/period/')) return res.end('[[]]');
  res.writeHead(404);
  res.end('{}');
}).listen(Number(process.env.FAKE_HA_PORT ?? 8123), () => console.log('Fake Home Assistant on :' + (process.env.FAKE_HA_PORT ?? 8123)));
