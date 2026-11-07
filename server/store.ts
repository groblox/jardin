import { mkdir, readFile, writeFile, rename, readdir, stat, unlink, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const BACKUP_DIR = () => join(DATA_DIR, 'backups');

/**
 * Read a JSON file from DATA_DIR. A missing file returns `fallback`. A file that exists but
 * can't be parsed is moved aside (`<name>.corrupt-<time>`) rather than silently replaced on the
 * next write, so nothing is lost; the fallback is returned.
 */
export async function readJson<T>(name: string, fallback: T): Promise<T> {
  const path = join(DATA_DIR, name);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return fallback;
  }
  try {
    return JSON.parse(text) as T;
  } catch (e: any) {
    const aside = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    console.error(`⚠️  ${name} is not valid JSON (${e.message}). Moved it to ${aside} and starting from defaults.`);
    await rename(path, aside).catch(() => {});
    return fallback;
  }
}

const writing = new Map<string, Promise<void>>();

/** Atomic write (tmp + rename), serialised per file. */
export async function writeJson(name: string, value: unknown): Promise<void> {
  const prev = writing.get(name) ?? Promise.resolve();
  const next = prev.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = join(DATA_DIR, `.${name}.tmp`);
    await writeFile(tmp, JSON.stringify(value, null, 2));
    await rename(tmp, join(DATA_DIR, name));
  });
  writing.set(name, next.catch(() => {}));
  return next;
}

// ---------- garden backups ----------

export interface BackupInfo {
  name: string;
  /** When the snapshot was taken (ISO). */
  at: string;
  reason: 'daily' | 'big-change' | 'restore';
  bytes: number;
}

const KEEP = 20;
const stamp = (d: Date) => d.toISOString().slice(0, 16).replace(/[:T]/g, '-');

/** Snapshot the current garden.json into backups/ (if it exists). */
export async function snapshotGarden(reason: BackupInfo['reason']): Promise<string | null> {
  const src = join(DATA_DIR, 'garden.json');
  try {
    await stat(src);
  } catch {
    return null;
  }
  await mkdir(BACKUP_DIR(), { recursive: true });
  const name = `garden-${stamp(new Date())}-${reason}.json`;
  await copyFile(src, join(BACKUP_DIR(), name));
  await pruneBackups();
  return name;
}

async function pruneBackups() {
  const files = (await readdir(BACKUP_DIR()).catch(() => [] as string[])).filter((f) => /^garden-.*\.json$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) await unlink(join(BACKUP_DIR(), f)).catch(() => {});
}

export async function listBackups(): Promise<BackupInfo[]> {
  const files = (await readdir(BACKUP_DIR()).catch(() => [] as string[])).filter((f) => /^garden-.*\.json$/.test(f));
  const out: BackupInfo[] = [];
  for (const name of files) {
    const m = name.match(/^garden-(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-([a-z-]+)\.json$/);
    if (!m) continue;
    const s = await stat(join(BACKUP_DIR(), name)).catch(() => null);
    out.push({ name, at: `${m[1]}T${m[2]}:${m[3]}:00Z`, reason: m[4] as BackupInfo['reason'], bytes: s?.size ?? 0 });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export async function readBackup(name: string): Promise<unknown> {
  if (!/^garden-[\w-]+\.json$/.test(name)) throw Object.assign(new Error('Bad backup name'), { status: 400 });
  try {
    return JSON.parse(await readFile(join(BACKUP_DIR(), name), 'utf8'));
  } catch {
    throw Object.assign(new Error('Backup not found'), { status: 404 });
  }
}
