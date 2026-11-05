// Research probe for the planned "survey my yard" import (see handoff.md §8.1).
// Reads a small window of the Meta/WRI global 1 m canopy-height map around a lat/lon using
// HTTP range requests only (no dependencies) and prints heights in metres.
//
//   node scripts/probe-canopy.ts 40.0379 -75.3410 [halfWindowPx=6]
//
// Format facts (verified 2026-11): one BigTIFF per zoom-9 Web-Mercator quadkey, 65536×65536 px,
// uint8 metres, deflate + horizontal predictor, RowsPerStrip = 1 (stripped, not tiled),
// StripOffsets at byte 524660, StripByteCounts at byte 372 (8-byte entries),
// ModelPixelScale at 1049016, ModelTiepoint at 1049040 (EPSG:3857). ~1.19 m/px in Mercator metres.
import { inflateSync } from 'node:zlib';

const BASE = 'https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/';

async function range(url: string, start: number, length: number): Promise<Buffer> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
  if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export function quadkey(lat: number, lon: number, z = 9): string {
  const s = Math.sin((lat * Math.PI) / 180);
  const x = Math.floor(((lon + 180) / 360) * 2 ** z);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z);
  let q = '';
  for (let i = z; i > 0; i--) {
    const m = 1 << (i - 1);
    q += String((x & m ? 1 : 0) + (y & m ? 2 : 0));
  }
  return q;
}

export async function canopyWindow(lat: number, lon: number, half: number) {
  const url = `${BASE}${quadkey(lat, lon)}.tif`;
  const scale = (await range(url, 1049016, 24)).readDoubleLE(0);
  const tie = await range(url, 1049040, 48);
  const tieX = tie.readDoubleLE(24);
  const tieY = tie.readDoubleLE(32);
  const R = 6378137;
  const mx = ((lon * Math.PI) / 180) * R;
  const my = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const col = Math.floor((mx - tieX) / scale);
  const row = Math.floor((tieY - my) / scale);
  const n = 2 * half + 1;
  const offs = await range(url, 524660 + 8 * (row - half), 8 * n);
  const cnts = await range(url, 372 + 8 * (row - half), 8 * n);
  const rows: number[][] = [];
  let bytes = 0;
  for (let k = 0; k < n; k++) {
    const off = Number(offs.readBigUInt64LE(8 * k));
    const cnt = Number(cnts.readBigUInt64LE(8 * k));
    bytes += cnt;
    const v = inflateSync(await range(url, off, cnt));
    for (let i = 1; i < v.length; i++) v[i] = (v[i] + v[i - 1]) & 255; // undo horizontal predictor
    rows.push([...v.subarray(col - half, col + half + 1)]);
  }
  // Ground resolution: Mercator metres shrink by cos(lat).
  return { url, row, col, metresPerPx: scale * Math.cos((lat * Math.PI) / 180), downloadedBytes: bytes, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [lat, lon, half] = [Number(process.argv[2] ?? 40.0379), Number(process.argv[3] ?? -75.341), Number(process.argv[4] ?? 6)];
  const w = await canopyWindow(lat, lon, half);
  console.log(`${w.url}\nrow ${w.row} col ${w.col} · ${w.metresPerPx.toFixed(2)} m/px ground · ${w.downloadedBytes} bytes of strips`);
  for (const r of w.rows) console.log(r.map((h) => String(h).padStart(2)).join(' '));
}
