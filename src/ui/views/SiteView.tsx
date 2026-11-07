import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bed, Obstacle, Pt } from '../../core/types.ts';
import { useGarden } from '../store.tsx';
import { useElementWidth, useThemeVersion } from '../hooks.ts';
import { chooseCellFt, horizonProfile, instantShade, pointDay, pointInPolygon, pointYear, sunCategory, daySamples, type SunPeriod } from '../../core/shade.ts';
import { findBestPlacements, sampleMap, type PlacementCandidate } from '../../core/placement.ts';
import { newBed } from '../../core/defaults.ts';
import { DEG, uid } from '../../core/util.ts';
import { fmtTime } from '../format.ts';
import { rampRGB, rampGradient, SUN_SCALE_MAX, DLI_SCALE_MAX, cssVar, rampCss, isDark } from '../sunColors.ts';
import { Field, NumberInput } from '../components/Field.tsx';
import { Chart, Stat } from '../components/Chart.tsx';
import { SunPath } from '../components/SunPath.tsx';

type Tool = 'select' | 'inspect' | 'bed' | 'building' | 'tree' | 'fence' | 'measure';
type Overlay = 'sun' | 'dli' | 'shadow' | 'none';
type Sel = { type: 'bed' | 'obstacle'; id: string } | null;

const TOOLS: { id: Tool; label: string; icon: string; hint: string }[] = [
  { id: 'select', label: 'Select', icon: '↖', hint: 'Click to select, drag to move' },
  { id: 'inspect', label: 'Inspect sun', icon: '☀', hint: 'Click any spot for its sun path, skyline and yearly light' },
  { id: 'bed', label: 'Bed', icon: '▦', hint: 'Drag to draw a bed (snaps to 1 ft)' },
  { id: 'building', label: 'Building', icon: '⌂', hint: 'Drag to draw a house, shed or wall' },
  { id: 'tree', label: 'Tree', icon: '🌳', hint: 'Click to place a tree' },
  { id: 'fence', label: 'Fence', icon: '┃', hint: 'Drag to draw a fence or hedge' },
  { id: 'measure', label: 'Measure', icon: '📏', hint: 'Drag to measure a distance — and to set the scale of a photo underlay' },
];

/** Load an image file, downscaled so the saved garden stays small. */
async function fileToDataUrl(file: File, maxPx = 2400): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function useImage(src?: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = src;
  }, [src]);
  return img;
}

const PERIODS: { id: SunPeriod; label: string }[] = [
  { id: 'season', label: 'Growing season (frost-free)' },
  { id: 'summer-solstice', label: 'Summer solstice' },
  { id: 'equinox', label: 'Equinox' },
  { id: 'winter-solstice', label: 'Winter solstice' },
  { id: 'year', label: 'Whole year' },
  { id: 'date', label: 'Specific date' },
];

function bbox(pts: Pt[]) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

function moveObstacle(o: Obstacle, dx: number, dy: number): Obstacle {
  if (o.kind === 'building') return { ...o, points: o.points.map(([x, y]) => [x + dx, y + dy] as Pt) };
  if (o.kind === 'tree') return { ...o, x: o.x + dx, y: o.y + dy };
  return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
}

function localOffsetSec(w: { utcOffsetSeconds: number } | null) {
  return w ? w.utcOffsetSeconds : -new Date().getTimezoneOffset() * 60;
}

export function SiteView() {
  const { garden, update, sun, setSunPeriod, weather, setSelectedBedId, setTab } = useGarden();
  const site = garden.site;
  const [tool, setTool] = useState<Tool>('select');
  const [overlay, setOverlay] = useState<Overlay>('sun');
  const [sel, setSel] = useState<Sel>(null);
  const [inspect, setInspect] = useState<{ x: number; y: number } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [shadowDate, setShadowDate] = useState(today);
  const [shadowMin, setShadowMin] = useState(13 * 60);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [placeOpts, setPlaceOpts] = useState({ widthFt: 4, lengthFt: 8, targetHours: 6, count: 5 });
  const [candidates, setCandidates] = useState<PlacementCandidate[]>([]);
  const [measure, setMeasure] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const underlayImg = useImage(site.underlay?.dataUrl);
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ sel: NonNullable<Sel>; startX: number; startY: number; lastX: number; lastY: number } | null>(null);
  const themeV = useThemeVersion();

  const maxH = Math.max(320, window.innerHeight * 0.72);
  const scale = width ? Math.min(width / site.widthFt, maxH / site.depthFt) : 4;
  const cw = site.widthFt * scale;
  const ch = site.depthFt * scale;

  const shadowInstant = useMemo(() => {
    const [y, m, d] = shadowDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) + shadowMin * 60000 - localOffsetSec(weather) * 1000);
  }, [shadowDate, shadowMin, weather]);

  const shade = useMemo(() => (overlay === 'shadow' ? instantShade(site, shadowInstant, chooseCellFt(site, 6000)) : null), [overlay, site, shadowInstant]);

  // ---------- drawing ----------
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !width) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(ch * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, site.widthFt, site.depthFt);
    ctx.fillStyle = cssVar('--map-ground');
    ctx.fillRect(0, 0, site.widthFt, site.depthFt);
    const u = site.underlay;
    if (u && underlayImg) {
      ctx.globalAlpha = u.opacity;
      ctx.drawImage(underlayImg, u.x, u.y, u.widthFt, (u.widthFt * underlayImg.naturalHeight) / underlayImg.naturalWidth);
      ctx.globalAlpha = 1;
    }
    // With a photo underneath, keep the analysis overlay translucent so you can trace.
    const overlayAlpha = u && underlayImg ? 0.55 : 1;
    ctx.globalAlpha = overlayAlpha;

    // Overlay
    const paintGrid = (cols: number, rows: number, cell: number, color: (i: number) => [number, number, number, number]) => {
      const off = document.createElement('canvas');
      off.width = cols;
      off.height = rows;
      const octx = off.getContext('2d')!;
      const img = octx.createImageData(cols, rows);
      for (let i = 0; i < cols * rows; i++) {
        const [r, g, b, a] = color(i);
        img.data.set([r, g, b, a], i * 4);
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = cell > 1;
      ctx.drawImage(off, 0, 0, cols * cell, rows * cell);
    };
    const m = sun.map;
    if ((overlay === 'sun' || overlay === 'dli') && m) {
      paintGrid(m.cols, m.rows, m.cellFt, (i) => {
        if (m.blocked[i]) return [0, 0, 0, 0];
        const t = overlay === 'sun' ? m.sunHours[i] / SUN_SCALE_MAX : m.dli[i] / DLI_SCALE_MAX;
        return [...rampRGB(t), 255];
      });
    } else if (overlay === 'shadow' && shade) {
      const cell = chooseCellFt(site, 6000);
      const shadowRgb = cssVar('--map-shadow').match(/\d+/g)?.map(Number) ?? [40, 50, 60];
      const dark = isDark();
      paintGrid(shade.cols, shade.rows, cell, (i) => {
        const lit = shade.sample.el <= 0 ? 0 : shade.trans[i];
        // Dark theme: shadows can't darken an already-dark ground, so light the sunlit cells instead.
        if (dark) return [...rampRGB(lit * 0.6), 255];
        return [shadowRgb[0], shadowRgb[1], shadowRgb[2], Math.round((1 - lit) * 150)];
      });
    }

    ctx.globalAlpha = 1;
    // 10 ft grid
    ctx.strokeStyle = cssVar('--map-grid');
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    for (let x = 10; x < site.widthFt; x += 10) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, site.depthFt);
    }
    for (let y = 10; y < site.depthFt; y += 10) {
      ctx.moveTo(0, y);
      ctx.lineTo(site.widthFt, y);
    }
    ctx.stroke();

    const selColor = cssVar('--accent');
    const ink = cssVar('--text-primary');
    const font = (px: number) => `${px / scale}px system-ui, sans-serif`;

    for (const o of site.obstacles) {
      const isSel = sel?.type === 'obstacle' && sel.id === o.id;
      ctx.lineWidth = (isSel ? 3 : 1.5) / scale;
      ctx.strokeStyle = isSel ? selColor : cssVar('--obstacle-line');
      if (o.kind === 'building') {
        ctx.fillStyle = cssVar('--building');
        ctx.beginPath();
        o.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        const b = bbox(o.points);
        ctx.fillStyle = ink;
        ctx.font = font(12);
        ctx.textAlign = 'center';
        ctx.fillText(`${o.name} · ${o.heightFt} ft`, b.x + b.w / 2, b.y + b.h / 2);
      } else if (o.kind === 'tree') {
        ctx.fillStyle = o.deciduous ? cssVar('--tree-deciduous') : cssVar('--tree-evergreen');
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.canopyRadiusFt, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = cssVar('--trunk');
        ctx.beginPath();
        ctx.arc(o.x, o.y, Math.max(0.6, o.canopyRadiusFt * 0.08), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ink;
        ctx.font = font(11);
        ctx.textAlign = 'center';
        ctx.fillText(`${o.name} · ${o.heightFt} ft`, o.x, o.y + o.canopyRadiusFt + 12 / scale);
      } else {
        ctx.strokeStyle = isSel ? selColor : cssVar('--fence');
        ctx.lineWidth = (isSel ? 5 : 3.5) / scale;
        ctx.setLineDash(o.transmittance > 0 ? [4 / scale, 3 / scale] : []);
        ctx.beginPath();
        ctx.moveTo(o.x1, o.y1);
        ctx.lineTo(o.x2, o.y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    for (const b of garden.beds) {
      const isSel = sel?.type === 'bed' && sel.id === b.id;
      ctx.fillStyle = cssVar('--bed-fill');
      ctx.fillRect(b.x, b.y, b.widthFt, b.lengthFt);
      ctx.strokeStyle = cssVar('--surface-1');
      ctx.lineWidth = 5 / scale;
      ctx.strokeRect(b.x, b.y, b.widthFt, b.lengthFt);
      ctx.strokeStyle = isSel ? selColor : cssVar('--bed-line');
      ctx.lineWidth = (isSel ? 3 : 2.5) / scale;
      ctx.strokeRect(b.x, b.y, b.widthFt, b.lengthFt);
      if (scale * 1 > 6) {
        ctx.strokeStyle = cssVar('--bed-grid');
        ctx.lineWidth = 0.5 / scale;
        ctx.beginPath();
        for (let x = 1; x < b.widthFt; x++) {
          ctx.moveTo(b.x + x, b.y);
          ctx.lineTo(b.x + x, b.y + b.lengthFt);
        }
        for (let y = 1; y < b.lengthFt; y++) {
          ctx.moveTo(b.x, b.y + y);
          ctx.lineTo(b.x + b.widthFt, b.y + y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = ink;
      ctx.font = `600 ${font(12)}`;
      ctx.textAlign = 'center';
      ctx.fillText(b.name, b.x + b.widthFt / 2, b.y - 5 / scale);
    }

    candidates.forEach((c, i) => {
      ctx.strokeStyle = cssVar('--candidate');
      ctx.lineWidth = 2 / scale;
      ctx.setLineDash([5 / scale, 4 / scale]);
      ctx.strokeRect(c.x, c.y, c.widthFt, c.lengthFt);
      ctx.setLineDash([]);
      ctx.fillStyle = cssVar('--candidate');
      ctx.beginPath();
      ctx.arc(c.x + c.widthFt / 2, c.y + c.lengthFt / 2, 9 / scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${font(11)}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), c.x + c.widthFt / 2, c.y + c.lengthFt / 2 + 4 / scale);
    });

    if (draft) {
      ctx.strokeStyle = selColor;
      ctx.lineWidth = 2 / scale;
      ctx.setLineDash([4 / scale, 3 / scale]);
      if (tool === 'fence' || tool === 'measure') {
        ctx.beginPath();
        ctx.moveTo(draft.x0, draft.y0);
        ctx.lineTo(draft.x1, draft.y1);
        ctx.stroke();
      } else {
        ctx.strokeRect(Math.min(draft.x0, draft.x1), Math.min(draft.y0, draft.y1), Math.abs(draft.x1 - draft.x0), Math.abs(draft.y1 - draft.y0));
      }
      ctx.setLineDash([]);
    }

    const ml = draft && tool === 'measure' ? draft : measure;
    if (ml) {
      const d = Math.hypot(ml.x1 - ml.x0, ml.y1 - ml.y0);
      ctx.strokeStyle = cssVar('--candidate');
      ctx.lineWidth = 2.5 / scale;
      ctx.beginPath();
      ctx.moveTo(ml.x0, ml.y0);
      ctx.lineTo(ml.x1, ml.y1);
      ctx.stroke();
      for (const [px, py] of [[ml.x0, ml.y0], [ml.x1, ml.y1]]) {
        ctx.beginPath();
        ctx.arc(px, py, 4 / scale, 0, Math.PI * 2);
        ctx.fillStyle = cssVar('--candidate');
        ctx.fill();
      }
      ctx.font = `700 ${font(12)}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = cssVar('--surface-1');
      const tx = (ml.x0 + ml.x1) / 2;
      const ty = (ml.y0 + ml.y1) / 2 - 8 / scale;
      ctx.fillRect(tx - 28 / scale, ty - 12 / scale, 56 / scale, 16 / scale);
      ctx.fillStyle = ink;
      ctx.fillText(`${d.toFixed(1)} ft`, tx, ty);
    }

    if (inspect) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2 / scale;
      ctx.fillStyle = cssVar('--sun');
      ctx.beginPath();
      ctx.arc(inspect.x, inspect.y, 6 / scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // North arrow
    const ax = site.widthFt - 26 / scale;
    const ay = 30 / scale;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(site.northDeg * DEG);
    ctx.fillStyle = cssVar('--surface-1');
    ctx.beginPath();
    ctx.arc(0, 0, 18 / scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(0, -14 / scale);
    ctx.lineTo(6 / scale, 6 / scale);
    ctx.lineTo(0, 2 / scale);
    ctx.lineTo(-6 / scale, 6 / scale);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = ink;
    ctx.font = `700 ${font(11)}`;
    ctx.textAlign = 'center';
    ctx.fillText('N', ax + Math.sin(site.northDeg * DEG) * (26 / scale), ay - Math.cos(site.northDeg * DEG) * (26 / scale) + 4 / scale);

    // Sun direction in shadow mode
    if (overlay === 'shadow' && shade && shade.sample.el > 0) {
      const cx = site.widthFt / 2;
      const cy = site.depthFt / 2;
      const len = Math.min(site.widthFt, site.depthFt) * 0.46;
      ctx.fillStyle = cssVar('--sun');
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5 / scale;
      ctx.beginPath();
      ctx.arc(cx + shade.sample.dx * len, cy + shade.sample.dy * len, 10 / scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, [width, scale, cw, ch, site, garden.beds, sun.map, overlay, shade, sel, candidates, draft, inspect, tool, themeV, underlayImg, measure]);

  // ---------- interaction ----------
  const toFt = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const hitTest = (x: number, y: number): Sel => {
    for (const b of [...garden.beds].reverse()) if (x >= b.x && x <= b.x + b.widthFt && y >= b.y && y <= b.y + b.lengthFt) return { type: 'bed', id: b.id };
    const obs = [...site.obstacles].reverse();
    for (const o of obs) if (o.kind === 'fence' && segDist(x, y, o.x1, o.y1, o.x2, o.y2) < 1.5) return { type: 'obstacle', id: o.id };
    for (const o of obs) if (o.kind === 'tree' && Math.hypot(x - o.x, y - o.y) <= o.canopyRadiusFt) return { type: 'obstacle', id: o.id };
    for (const o of obs) if (o.kind === 'building' && pointInPolygon(x, y, o.points)) return { type: 'obstacle', id: o.id };
    return null;
  };

  const updateObstacle = (id: string, fn: (o: Obstacle) => Obstacle) =>
    update((g) => ({ ...g, site: { ...g.site, obstacles: g.site.obstacles.map((o) => (o.id === id ? fn(o) : o)) } }));
  const updateBed = (id: string, fn: (b: Bed) => Bed) => update((g) => ({ ...g, beds: g.beds.map((b) => (b.id === id ? fn(b) : b)) }));

  const onDown = (e: React.PointerEvent) => {
    const p = toFt(e);
    (e.target as Element).setPointerCapture(e.pointerId);
    if (tool === 'inspect') {
      setInspect(p);
      return;
    }
    if (tool === 'select') {
      const h = hitTest(p.x, p.y);
      setSel(h);
      if (h) drag.current = { sel: h, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y };
      return;
    }
    if (tool === 'tree') {
      const id = uid('tree');
      update((g) => ({ ...g, site: { ...g.site, obstacles: [...g.site.obstacles, { id, kind: 'tree', name: 'Tree', x: p.x, y: p.y, canopyRadiusFt: 8, heightFt: 25, trunkHeightFt: 6, deciduous: true }] } }));
      setSel({ type: 'obstacle', id });
      setTool('select');
      return;
    }
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const onMove = (e: React.PointerEvent) => {
    const p = toFt(e);
    if (draft) {
      setDraft({ ...draft, x1: p.x, y1: p.y });
      return;
    }
    const d = drag.current;
    if (!d) return;
    let dx = p.x - d.lastX;
    let dy = p.y - d.lastY;
    if (d.sel.type === 'bed') {
      // Snap beds to whole feet.
      const bed = garden.beds.find((b) => b.id === d.sel.id)!;
      const tx = Math.round(bed.x + dx);
      const ty = Math.round(bed.y + dy);
      dx = tx - bed.x;
      dy = ty - bed.y;
      if (!dx && !dy) return;
      updateBed(d.sel.id, (b) => ({ ...b, x: tx, y: ty }));
    } else {
      updateObstacle(d.sel.id, (o) => moveObstacle(o, dx, dy));
    }
    d.lastX += dx;
    d.lastY += dy;
  };

  const onUp = () => {
    drag.current = null;
    if (!draft) return;
    const x = Math.min(draft.x0, draft.x1);
    const y = Math.min(draft.y0, draft.y1);
    const w = Math.abs(draft.x1 - draft.x0);
    const h = Math.abs(draft.y1 - draft.y0);
    setDraft(null);
    if (tool === 'measure') {
      if (Math.hypot(w, h) >= 0.5) setMeasure(draft);
      return;
    }
    if (tool === 'building' && w >= 2 && h >= 2) {
      const id = uid('bld');
      update((g) => ({ ...g, site: { ...g.site, obstacles: [...g.site.obstacles, { id, kind: 'building', name: 'Building', heightFt: 12, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] }] } }));
      setSel({ type: 'obstacle', id });
    } else if (tool === 'fence' && Math.hypot(w, h) >= 2) {
      const id = uid('fence');
      update((g) => ({ ...g, site: { ...g.site, obstacles: [...g.site.obstacles, { id, kind: 'fence', name: 'Fence', x1: draft.x0, y1: draft.y0, x2: draft.x1, y2: draft.y1, heightFt: 6, transmittance: 0 }] } }));
      setSel({ type: 'obstacle', id });
    } else if (tool === 'bed') {
      const bw = w >= 2 ? Math.round(w) : 4;
      const bl = h >= 2 ? Math.round(h) : 8;
      const bed = newBed({ name: `Bed ${garden.beds.length + 1}`, x: Math.round(w >= 2 ? x : x - bw / 2), y: Math.round(h >= 2 ? y : y - bl / 2), widthFt: bw, lengthFt: bl });
      update((g) => ({ ...g, beds: [...g.beds, bed] }));
      setSel({ type: 'bed', id: bed.id });
    }
    setTool('select');
  };

  const deleteSel = () => {
    if (!sel) return;
    if (sel.type === 'bed' && !confirm('Delete this bed and its plantings?')) return;
    update((g) => (sel.type === 'bed' ? { ...g, beds: g.beds.filter((b) => b.id !== sel.id) } : { ...g, site: { ...g.site, obstacles: g.site.obstacles.filter((o) => o.id !== sel.id) } }));
    setSel(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) deleteSel();
      if (e.key === 'Escape') {
        setSel(null);
        setDraft(null);
        setTool('select');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const runPlacement = () => {
    if (!sun.season) return;
    setCandidates(findBestPlacements(sun.season, { ...placeOpts, existingBeds: garden.beds }));
  };

  const addCandidate = (c: PlacementCandidate) => {
    const bed = newBed({ name: `Bed ${garden.beds.length + 1}`, x: Math.round(c.x), y: Math.round(c.y), widthFt: c.widthFt, lengthFt: c.lengthFt });
    update((g) => ({ ...g, beds: [...g.beds, bed] }));
    setCandidates((cs) => cs.filter((x) => x !== c));
    setSel({ type: 'bed', id: bed.id });
  };

  const selObstacle = sel?.type === 'obstacle' ? site.obstacles.find((o) => o.id === sel.id) : undefined;
  const selBed = sel?.type === 'bed' ? garden.beds.find((b) => b.id === sel.id) : undefined;
  const fmtTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  return (
    <div className="view site-view">
      <div className="toolbar" role="toolbar" aria-label="Map tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool ${tool === t.id ? 'active' : ''}`} onClick={() => setTool(t.id)} title={t.hint} aria-pressed={tool === t.id}>
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
        <span className="toolbar-hint">{TOOLS.find((t) => t.id === tool)?.hint}</span>
      </div>

      <div className="site-layout">
        <div className="map-col">
          <div className="segmented" role="radiogroup" aria-label="Map overlay">
            {([['sun', 'Sun hours'], ['dli', 'Daily light (DLI)'], ['shadow', 'Shadows at time'], ['none', 'Plain']] as const).map(([id, label]) => (
              <button key={id} role="radio" aria-checked={overlay === id} className={overlay === id ? 'active' : ''} onClick={() => setOverlay(id)}>{label}</button>
            ))}
          </div>
          {(overlay === 'sun' || overlay === 'dli') && (
            <div className="row wrap gap">
              <select value={sun.period} onChange={(e) => setSunPeriod(e.target.value as SunPeriod)} aria-label="Analysis period">
                {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {sun.period === 'date' && <input type="date" value={sun.date} onChange={(e) => setSunPeriod('date', e.target.value)} />}
              {sun.computing && <span className="muted">Computing… {Math.round(sun.progress * 100)}%</span>}
              {!sun.computing && sun.map && <span className="muted">Open sky: {sun.map.maxSunHours.toFixed(1)} h of daylight/day avg</span>}
            </div>
          )}
          {overlay === 'shadow' && (
            <div className="row wrap gap">
              <input type="date" value={shadowDate} onChange={(e) => setShadowDate(e.target.value)} aria-label="Shadow date" />
              <input type="range" min={0} max={1439} step={5} value={shadowMin} onChange={(e) => setShadowMin(+e.target.value)} aria-label="Time of day" className="grow" />
              <span className="tabular">{fmtTime(shadowMin)}</span>
              {shade && <span className="muted">Sun {shade.sample.el > 0 ? `${shade.sample.el.toFixed(0)}° high, az ${shade.sample.az.toFixed(0)}°` : 'below horizon'}</span>}
            </div>
          )}
          <div ref={wrapRef} className="map-wrap">
            <canvas
              ref={canvasRef}
              style={{ width: cw, height: ch, cursor: tool === 'select' ? 'default' : 'crosshair', touchAction: 'none' }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              aria-label="Property map"
            />
          </div>
          {(overlay === 'sun' || overlay === 'dli') && (
            <div className="ramp-legend">
              <div className="ramp" style={{ background: rampGradient() }} />
              <div className="ramp-ticks tabular">
                {overlay === 'sun'
                  ? [0, 2, 4, 6, 8, 10, 12].map((h) => <span key={h}>{h}h</span>)
                  : [0, 10, 20, 30, 40, 50].map((h) => <span key={h}>{h}</span>)}
              </div>
              <div className="muted small">
                {overlay === 'sun'
                  ? 'Average hours of direct sun per day. Full sun ≥ 6h · part sun 4–6h · part shade 2–4h · shade < 2h.'
                  : 'Clear-sky daily light integral, mol/m²/day. Fruiting crops want 20–30+, leafy greens 12–17.'}
              </div>
            </div>
          )}
          <p className="muted small">Property {site.widthFt}×{site.depthFt} ft · grid lines every 10 ft · shading modelled from obstacle heights (trees lose leaves outside the frost-free season).</p>
        </div>

        <aside className="side-col">
          {selObstacle && (
            <section className="card">
              <h3>{selObstacle.kind === 'building' ? 'Building' : selObstacle.kind === 'tree' ? 'Tree' : 'Fence / hedge'}</h3>
              <ObstacleEditor o={selObstacle} onChange={(fn) => updateObstacle(selObstacle.id, fn)} />
              <button className="danger" onClick={deleteSel}>Delete</button>
            </section>
          )}
          {selBed && (
            <section className="card">
              <h3>{selBed.name}</h3>
              <div className="grid2">
                <Field label="Name"><input value={selBed.name} onChange={(e) => updateBed(selBed.id, (b) => ({ ...b, name: e.target.value }))} /></Field>
                <Field label="Raised height"><NumberInput value={selBed.heightFt} step={0.5} min={0} suffix="ft" onChange={(v) => updateBed(selBed.id, (b) => ({ ...b, heightFt: v }))} /></Field>
                <Field label="Width (E–W)"><NumberInput commitOnBlur value={selBed.widthFt} min={1} max={20} suffix="ft" onChange={(v) => updateBed(selBed.id, (b) => ({ ...b, widthFt: Math.round(v) }))} /></Field>
                <Field label="Length"><NumberInput commitOnBlur value={selBed.lengthFt} min={1} max={40} suffix="ft" onChange={(v) => updateBed(selBed.id, (b) => ({ ...b, lengthFt: Math.round(v) }))} /></Field>
              </div>
              {sun.season && (
                <p>Season sun: <b>{sampleBedSun(sun.season, selBed).toFixed(1)} h/day</b> — {sunCategory(sampleBedSun(sun.season, selBed)).label}</p>
              )}
              <div className="row gap">
                <button className="primary" onClick={() => { setSelectedBedId(selBed.id); setTab('beds'); }}>Plan plantings →</button>
                <button className="danger" onClick={deleteSel}>Delete</button>
              </div>
            </section>
          )}

          {inspect && <PointInspector x={inspect.x} y={inspect.y} onClose={() => setInspect(null)} />}

          {measure && (
            <MeasurePanel m={measure} onClose={() => setMeasure(null)} onCalibrate={(real) => {
              const u = site.underlay;
              if (!u) return;
              const measured = Math.hypot(measure.x1 - measure.x0, measure.y1 - measure.y0);
              const k = real / measured;
              // Scale the photo about the line's first point so that point stays put.
              update((g) => ({ ...g, site: { ...g.site, underlay: { ...u, widthFt: u.widthFt * k, x: measure.x0 - (measure.x0 - u.x) * k, y: measure.y0 - (measure.y0 - u.y) * k } } }));
              setMeasure({ x0: measure.x0, y0: measure.y0, x1: measure.x0 + (measure.x1 - measure.x0) * k, y1: measure.y0 + (measure.y1 - measure.y0) * k });
            }} hasUnderlay={!!site.underlay} />
          )}

          <UnderlayPanel />

          <section className="card">
            <h3>Find the sunniest spot for a bed</h3>
            <p className="muted small">Searches the whole property using growing-season sunlight, avoiding buildings, trunks and existing beds (2 ft paths).</p>
            <div className="grid2">
              <Field label="Width"><NumberInput value={placeOpts.widthFt} min={1} suffix="ft" onChange={(v) => setPlaceOpts({ ...placeOpts, widthFt: Math.round(v) })} /></Field>
              <Field label="Length"><NumberInput value={placeOpts.lengthFt} min={1} suffix="ft" onChange={(v) => setPlaceOpts({ ...placeOpts, lengthFt: Math.round(v) })} /></Field>
              <Field label="Target sun"><NumberInput value={placeOpts.targetHours} min={0} max={14} step={0.5} suffix="h" onChange={(v) => setPlaceOpts({ ...placeOpts, targetHours: v })} /></Field>
              <Field label="Results"><NumberInput value={placeOpts.count} min={1} max={10} onChange={(v) => setPlaceOpts({ ...placeOpts, count: Math.round(v) })} /></Field>
            </div>
            <button className="primary" onClick={runPlacement} disabled={!sun.season}>{sun.season ? 'Find best spots' : 'Analysing sunlight…'}</button>
            {candidates.length > 0 && (
              <ol className="candidates">
                {candidates.map((c, i) => (
                  <li key={i}>
                    <span className="badge-num">{i + 1}</span>
                    <div className="grow">
                      <b className="tabular">{c.meanSun.toFixed(1)} h</b> avg sun <span className="muted">(min {c.minSun.toFixed(1)} h)</span>
                      <div className="muted small">{c.widthFt}×{c.lengthFt} ft at ({c.x}, {c.y}) · {Math.round(c.fractionMeeting * 100)}% gets ≥ {placeOpts.targetHours}h · DLI {c.meanDli.toFixed(0)}</div>
                    </div>
                    <button onClick={() => addCandidate(c)}>Add bed</button>
                  </li>
                ))}
              </ol>
            )}
            {candidates.length > 0 && <button className="link" onClick={() => setCandidates([])}>Clear suggestions</button>}
          </section>

          {!sel && !inspect && (
            <section className="card muted">
              <p>Tip: draw your house, trees and fences with accurate <b>heights</b>, set the map's north in Settings, then use <b>Inspect sun</b> on candidate spots. Everything recalculates as you move things.</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function sampleBedSun(m: NonNullable<ReturnType<typeof useGarden>['sun']['season']>, b: Bed) {
  let s = 0;
  let n = 0;
  for (let y = b.y + 0.5; y < b.y + b.lengthFt; y++)
    for (let x = b.x + 0.5; x < b.x + b.widthFt; x++) {
      s += sampleMap(m, 'sunHours', x, y);
      n++;
    }
  return s / Math.max(1, n);
}

function ObstacleEditor({ o, onChange }: { o: Obstacle; onChange: (fn: (o: Obstacle) => Obstacle) => void }) {
  const set = <K extends string>(k: K, v: unknown) => onChange((x) => ({ ...x, [k]: v }) as Obstacle);
  return (
    <div className="grid2">
      <Field label="Name"><input value={o.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label="Height"><NumberInput value={o.heightFt} min={0.5} step={0.5} suffix="ft" onChange={(v) => set('heightFt', v)} /></Field>
      {o.kind === 'building' && (() => {
        const b = bbox(o.points);
        const rect = (x: number, y: number, w: number, h: number) => set('points', [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
        return (
          <>
            <Field label="Width"><NumberInput value={b.w} min={1} suffix="ft" onChange={(v) => rect(b.x, b.y, v, b.h)} /></Field>
            <Field label="Depth"><NumberInput value={b.h} min={1} suffix="ft" onChange={(v) => rect(b.x, b.y, b.w, v)} /></Field>
          </>
        );
      })()}
      {o.kind === 'tree' && (
        <>
          <Field label="Canopy radius"><NumberInput value={o.canopyRadiusFt} min={1} suffix="ft" onChange={(v) => set('canopyRadiusFt', v)} /></Field>
          <Field label="Lowest branches"><NumberInput value={o.trunkHeightFt} min={0} suffix="ft" onChange={(v) => set('trunkHeightFt', Math.min(v, o.heightFt - 1))} /></Field>
          <Field label="Type">
            <select value={o.deciduous ? 'd' : 'e'} onChange={(e) => set('deciduous', e.target.value === 'd')}>
              <option value="d">Deciduous (leafless in winter)</option>
              <option value="e">Evergreen</option>
            </select>
          </Field>
        </>
      )}
      {o.kind === 'fence' && (
        <Field label="Density">
          <select value={o.transmittance} onChange={(e) => set('transmittance', +e.target.value)}>
            <option value={0}>Solid (privacy fence, wall)</option>
            <option value={0.25}>Dense hedge / slatted</option>
            <option value={0.5}>Lattice / loose hedge</option>
            <option value={0.85}>Chain-link / wire</option>
          </select>
        </Field>
      )}
    </div>
  );
}

function PointInspector({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const { garden, sun, weather } = useGarden();
  const site = garden.site;
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const z0 = 1;
  const year = new Date().getFullYear();
  const d = useMemo(() => new Date(date + 'T12:00:00'), [date]);
  const south = site.lat < 0;

  const data = useMemo(() => {
    const day = pointDay(site, x, y, z0, d, 5);
    const months = pointYear(site, x, y, z0, year);
    const horizon = horizonProfile(site, x, y, z0, d);
    const path = (dt: Date) => daySamples(site, dt, 10).map((s) => ({ az: s.az, el: s.el, t: s.t }));
    const paths = [
      { id: 'date', label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), color: 'var(--series-1)', points: path(d) },
      { id: 'summer', label: 'Summer solstice', color: 'var(--series-2)', points: path(new Date(year, south ? 11 : 5, 21, 12)) },
      { id: 'equinox', label: 'Equinox', color: 'var(--series-3)', points: path(new Date(year, 2, 20, 12)) },
      { id: 'winter', label: 'Winter solstice', color: 'var(--series-4)', points: path(new Date(year, south ? 5 : 11, 21, 12)) },
    ];
    return { day, months, horizon, paths };
  }, [site, x, y, d, year, south]);

  const seasonSun = sun.season ? sampleMap(sun.season, 'sunHours', x, y) : null;
  const cat = sunCategory(seasonSun ?? data.day.sunHours);
  const first = data.day.samples[0];
  const last = data.day.samples[data.day.samples.length - 1];
  const fmt = (t: number) => fmtTime(t, weather?.timezone);
  const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  return (
    <section className="card inspector">
      <div className="row between">
        <h3>Sun at ({x.toFixed(0)}, {y.toFixed(0)}) ft</h3>
        <button className="link" onClick={onClose} aria-label="Close inspector">✕</button>
      </div>
      <div className="row gap wrap">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Inspect date" />
      </div>
      <div className="stats">
        <Stat label="Direct sun this day" value={`${data.day.sunHours.toFixed(1)} h`} sub={`of ${data.day.daylightH.toFixed(1)} h daylight`} />
        <Stat label="Growing-season avg" value={seasonSun != null ? `${seasonSun.toFixed(1)} h` : '…'} sub={cat.label} />
        <Stat label="Clear-sky DLI" value={data.day.dli.toFixed(0)} sub="mol/m²/day" />
      </div>
      {first && (
        <div className="daystrip" aria-label="Sun and shade through the day">
          <div className="daystrip-bar">
            {data.day.samples.map((s, i) => (
              <span key={i} style={{ background: rampCss(s.trans * 0.85) }} title={`${fmt(s.t)} — ${s.trans > 0.95 ? 'sun' : s.trans < 0.05 ? 'shade' : `${Math.round(s.trans * 100)}% sun`}`} />
            ))}
          </div>
          <div className="row between small muted tabular"><span>{fmt(first.t)}</span><span>Sun ▮ / shade ▯ through the day</span><span>{fmt(last.t)}</span></div>
        </div>
      )}
      <SunPath horizon={data.horizon} paths={data.paths} now={null} size={300} timeZone={weather?.timezone} />
      <Chart
        ariaLabel="Direct sun versus daylight by month"
        title="Direct sun vs. daylight, 21st of each month"
        labels={MONTHS}
        formatLabel={(_, i) => new Date(year, i, 1).toLocaleDateString(undefined, { month: 'long' })}
        series={[
          { id: 'day', label: 'Daylight', color: 'var(--series-neutral)', kind: 'bar', values: data.months.map((m) => m.daylightH) },
          { id: 'sun', label: 'Direct sun here', color: 'var(--series-2)', kind: 'bar', values: data.months.map((m) => m.sunHours) },
        ]}
        format={(v) => `${v.toFixed(1)}h`}
        refLines={[{ y: 6, label: 'Full sun 6h' }]}
        height={180}
      />
    </section>
  );
}

function MeasurePanel({ m, onClose, onCalibrate, hasUnderlay }: { m: { x0: number; y0: number; x1: number; y1: number }; onClose: () => void; onCalibrate: (realFt: number) => void; hasUnderlay: boolean }) {
  const d = Math.hypot(m.x1 - m.x0, m.y1 - m.y0);
  const [real, setReal] = useState(Math.round(d));
  return (
    <section className="card">
      <div className="row between"><h3>Measured {d.toFixed(1)} ft</h3><button className="link" onClick={onClose} aria-label="Close">✕</button></div>
      {hasUnderlay ? (
        <>
          <p className="small">If this line follows something you know the length of on the photo (a house wall, fence run, driveway), enter its real length to scale the photo:</p>
          <div className="row gap">
            <NumberInput value={real} min={0.5} step={0.5} suffix="ft" onChange={setReal} />
            <button className="primary" onClick={() => onCalibrate(real)}>Scale photo</button>
          </div>
        </>
      ) : <p className="muted small">Add a photo underlay below to trace your property at true scale.</p>}
    </section>
  );
}

function UnderlayPanel() {
  const { garden, update } = useGarden();
  const u = garden.site.underlay;
  const [busy, setBusy] = useState(false);
  const setU = (patch: Partial<NonNullable<typeof u>>) => u && update((g) => ({ ...g, site: { ...g.site, underlay: { ...u, ...patch } } }));
  return (
    <section className="card">
      <h3>Trace over an aerial photo</h3>
      {!u ? (
        <>
          <p className="muted small">Screenshot your yard from a satellite or plat map, add it here, then use <b>Measure</b> along a known length to set its scale. Draw buildings, trees and beds on top.</p>
          <label className="file-btn">
            <input type="file" accept="image/*" disabled={busy} onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              try {
                const dataUrl = await fileToDataUrl(f);
                update((g) => ({ ...g, site: { ...g.site, underlay: { dataUrl, x: 0, y: 0, widthFt: g.site.widthFt, opacity: 0.6 } } }));
              } finally {
                setBusy(false);
              }
            }} />
            <span>{busy ? 'Loading…' : 'Choose image…'}</span>
          </label>
        </>
      ) : (
        <>
          <div className="grid2">
            <Field label="Photo width"><NumberInput value={u.widthFt} min={5} step={1} suffix="ft" onChange={(v) => setU({ widthFt: v })} /></Field>
            <Field label="Opacity"><input type="range" min={0.1} max={1} step={0.05} value={u.opacity} onChange={(e) => setU({ opacity: +e.target.value })} /></Field>
            <Field label="Offset left"><NumberInput value={u.x} step={1} suffix="ft" onChange={(v) => setU({ x: v })} /></Field>
            <Field label="Offset top"><NumberInput value={u.y} step={1} suffix="ft" onChange={(v) => setU({ y: v })} /></Field>
          </div>
          <button className="danger" onClick={() => update((g) => ({ ...g, site: { ...g.site, underlay: undefined } }))}>Remove photo</button>
        </>
      )}
    </section>
  );
}
