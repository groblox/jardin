import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, name), 'utf8')) as T;
  } catch {
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
