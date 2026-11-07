// Server safety nets: corrupt files, garden backups, and valve runs that must never be left open.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newBed, sampleGarden } from '../src/core/defaults.ts';
import type { Garden } from '../src/core/types.ts';

let dir: string;
let store: typeof import('../server/store.ts');
let irr: typeof import('../server/irrigation.ts');
let ha: typeof import('../server/ha.ts');

const garden: Garden = {
  ...sampleGarden(new Date(2026, 6, 1)),
  beds: [newBed({ id: 'b1', name: 'Bed 1', irrigation: { ...newBed().irrigation, valveEntity: 'switch.demo_bed_1_valve' } }), newBed({ id: 'b2', name: 'No valve' })],
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jardin-test-'));
  process.env.DATA_DIR = dir;
  delete process.env.HA_URL;
  delete process.env.HA_TOKEN;
  delete process.env.SUPERVISOR_TOKEN;
  vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] });
  store = await import('../server/store.ts');
  ha = await import('../server/ha.ts');
  irr = await import('../server/irrigation.ts');
  await irr.initIrrigation(() => garden);
});

afterAll(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

describe('store', () => {
  it('moves a corrupt file aside instead of letting the next save overwrite it', async () => {
    await writeFile(join(dir, 'broken.json'), '{"beds": [');
    expect(await store.readJson('broken.json', { fallback: true })).toEqual({ fallback: true });
    const files = await readdir(dir);
    expect(files.some((f) => f.startsWith('broken.json.corrupt-'))).toBe(true);
    expect(files).not.toContain('broken.json');
  });

  it('snapshots garden.json, lists and reads backups, keeps the newest 20', async () => {
    expect(await store.snapshotGarden('daily')).toBeNull(); // nothing to back up yet
    await store.writeJson('garden.json', garden);
    const name = await store.snapshotGarden('daily');
    expect(name).toMatch(/^garden-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-daily\.json$/);
    const list = await store.listBackups();
    expect(list[0].reason).toBe('daily');
    expect(((await store.readBackup(name!)) as Garden).beds.length).toBe(2);
    await expect(store.readBackup('../garden.json')).rejects.toMatchObject({ status: 400 });
    // Fill past the limit with older-looking names and check pruning keeps 20.
    for (let i = 0; i < 25; i++) await writeFile(join(dir, 'backups', `garden-2020-01-${String(i + 1).padStart(2, '0')}-00-00-daily.json`), '{}');
    await store.snapshotGarden('big-change');
    const after = await store.listBackups();
    expect(after.length).toBe(20);
    expect(after[0].reason).toBe('big-change');
  });
});

describe('irrigation API safety', () => {
  const valveOn = async () => (await ha.getState('switch.demo_bed_1_valve'))?.state === 'on';

  it('rejects bad minutes without ever opening the valve', async () => {
    for (const bad of [undefined, 'abc', NaN, -5, 0, {}]) {
      await expect(irr.startRun('b1', bad)).rejects.toMatchObject({ status: 400 });
      expect(await valveOn()).toBe(false);
      expect(irr.irrigationState().active).toEqual([]);
    }
  });

  it('accepts numeric strings, records the run, and closes on stop', async () => {
    const run = await irr.startRun('b1', '2');
    expect(run.minutes).toBe(2);
    expect(await valveOn()).toBe(true);
    await expect(irr.startRun('b1', 1)).rejects.toMatchObject({ status: 409 });
    await irr.stopRun('b1');
    expect(await valveOn()).toBe(false);
    const ev = irr.irrigationState().events.at(-1)!;
    expect(ev.bedId).toBe('b1');
    expect(Number.isFinite(ev.depthMm)).toBe(true);
  });

  it('caps manual runs and validates the bed', async () => {
    const run = await irr.startRun('b1', 9999);
    expect(run.minutes).toBe(120);
    await irr.stopRun('b1');
    await expect(irr.startRun('nope', 5)).rejects.toMatchObject({ status: 404 });
    await expect(irr.startRun('b2', 5)).rejects.toMatchObject({ status: 400 });
  });

  it('hand-watering log needs real minutes', async () => {
    await expect(irr.logManual('b1', 'lots')).rejects.toMatchObject({ status: 400 });
    const n = irr.irrigationState().events.length;
    await irr.logManual('b1', 10, '  watering can  ');
    const ev = irr.irrigationState().events.at(-1)!;
    expect(irr.irrigationState().events.length).toBe(n + 1);
    expect(ev.note).toBe('watering can');
    expect(ev.depthMm).toBeGreaterThan(0);
  });
});
