/**
 * Procedural pixel art. Everything the world is made of is drawn here into
 * offscreen canvases at 1:1 pixel scale, then blitted by the renderer and
 * upscaled with nearest-neighbour so it stays crisp at every zoom level.
 *
 * No external assets: sprites are generated from the season palette at load,
 * which is also what lets autumn and winter recolour the whole map for free.
 */

import { hash2 } from '../core/util';
import type { BuildingId, PropId, Season, TerrainId } from '../types';
import { HALF_H, HALF_W } from '../world/iso';
import { BLOSSOM, FLOWER_COLORS, FOLIAGE, TRUNK, shade, terrainRamp } from './palette';

export function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Single pixel. All art is composed from these so nothing is ever antialiased. */
function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, w = 1, h = 1): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

/** Soft contact shadow so props sit on the ground instead of floating over it. */
function groundShadow(ctx: CanvasRenderingContext2D, cx: number, baseY: number, width: number): void {
  const rows = [
    { dy: -2, w: width * 0.62, a: 0.1 },
    { dy: -1, w: width, a: 0.16 },
    { dy: 0, w: width * 0.82, a: 0.13 },
  ];
  for (const r of rows) {
    ctx.fillStyle = `rgba(28,22,14,${r.a})`;
    ctx.fillRect(Math.round(cx - r.w / 2), Math.round(baseY + r.dy), Math.round(r.w), 1);
  }
}

/** Half-width of a 32×16 diamond at row y (0..15). */
function diamondRow(y: number): { x0: number; width: number } {
  const k = y < HALF_H ? y : HALF_H * 2 - 1 - y;
  const width = (k + 1) * 4;
  return { x0: HALF_W - width / 2, width };
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

const TERRAIN_VARIANTS = 4;

export type TerrainSheet = Record<TerrainId, HTMLCanvasElement[]>;

const TERRAIN_IDS: TerrainId[] = ['water', 'shallow', 'sand', 'grass', 'meadow', 'forest', 'rocky'];

export function bakeTerrain(season: Season): TerrainSheet {
  const sheet = {} as TerrainSheet;
  for (const id of TERRAIN_IDS) {
    sheet[id] = [];
    for (let v = 0; v < TERRAIN_VARIANTS; v++) sheet[id].push(bakeTile(season, id, v));
  }
  return sheet;
}

function bakeTile(season: Season, id: TerrainId, variant: number): HTMLCanvasElement {
  const c = mkCanvas(HALF_W * 2, HALF_H * 2);
  const ctx = ctxOf(c);
  const [base, light, dark, speck] = terrainRamp(season, id).c;

  for (let y = 0; y < HALF_H * 2; y++) {
    const { x0, width } = diamondRow(y);
    // Top half catches light, bottom half falls into shade.
    const rowColor = y < 3 ? light : y > HALF_H * 2 - 4 ? dark : base;
    px(ctx, x0, y, rowColor, width, 1);
  }

  // Texture. Deliberately sparse — a busy ground plane is exhausting to look at.
  const density = id === 'rocky' ? 14 : 9;
  for (let i = 0; i < density; i++) {
    const h = hash2(i * 31 + variant * 7, i * 17 + variant * 3, 991);
    const y = Math.floor(h * HALF_H * 2);
    const { x0, width } = diamondRow(y);
    if (width < 6) continue;
    const h2 = hash2(i * 13 + variant, i * 29 + variant * 5, 313);
    const x = Math.floor(x0 + 1 + h2 * (width - 2));
    px(ctx, x, y, h2 > 0.5 ? speck : dark);
  }

  if (id === 'water' || id === 'shallow') {
    // A couple of glints, offset per variant so the surface reads as moving.
    for (let i = 0; i < 3; i++) {
      const y = 4 + ((i * 3 + variant * 2) % 8);
      const { x0, width } = diamondRow(y);
      const x = Math.floor(x0 + width * (0.3 + ((i + variant) % 3) * 0.2));
      px(ctx, x, y, light, 3, 1);
    }
  }

  return c;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PropSprite {
  canvas: HTMLCanvasElement;
  /** Offset from the tile centre to the sprite's top-left. */
  ox: number;
  oy: number;
}

export type PropSheet = Record<PropId, PropSprite[]>;

const PROP_IDS: PropId[] = ['tree', 'stump', 'boulder', 'pebbles', 'bush', 'flowers', 'reeds', 'lilypad'];

export function bakeProps(season: Season): PropSheet {
  const sheet = {} as PropSheet;
  for (const id of PROP_IDS) {
    sheet[id] = [];
    for (let v = 0; v < 4; v++) sheet[id].push(bakeProp(season, id, v));
  }
  return sheet;
}

function bakeProp(season: Season, id: PropId, v: number): PropSprite {
  switch (id) {
    case 'tree':
      return bakeTree(season, v);
    case 'stump':
      return bakeStump(v);
    case 'boulder':
      return bakeBoulder(v, false);
    case 'pebbles':
      return bakeBoulder(v, true);
    case 'bush':
      return bakeBush(season, v);
    case 'flowers':
      return bakeFlowers(season, v);
    case 'reeds':
      return bakeReeds(season, v);
    case 'lilypad':
      return bakeLilypad(season, v);
  }
}

function bakeTree(season: Season, v: number): PropSprite {
  // Variant 2 is a conifer. Mixing silhouettes stops woodland reading as a
  // field of identical blobs, which is the fastest way to make a map tiring.
  if (v === 2) return bakeConifer(season);

  const [mid, light, dark] = FOLIAGE[season];
  const blossom = BLOSSOM[season];
  const tall = v === 0;
  const w = 22;
  const h = tall ? 34 : 28;
  const c = mkCanvas(w, h);
  const ctx = ctxOf(c);

  const cx = w / 2;
  const trunkTop = h - (tall ? 12 : 10);

  groundShadow(ctx, cx, h - 3, 13);

  px(ctx, cx - 2, trunkTop, TRUNK[2], 1, h - trunkTop - 2);
  px(ctx, cx - 1, trunkTop, TRUNK[0], 2, h - trunkTop - 2);
  px(ctx, cx + 1, trunkTop, TRUNK[1], 1, h - trunkTop - 3);

  const blobs = tall
    ? [
        { cy: trunkTop - 2, r: 8 },
        { cy: trunkTop - 9, r: 6.5 },
        { cy: trunkTop - 15, r: 4.5 },
      ]
    : v === 1
      ? [
          { cy: trunkTop - 2, r: 8.5 },
          { cy: trunkTop - 8, r: 6 },
        ]
      : [
          // Broad and low, like an old orchard tree.
          { cy: trunkTop - 1, r: 9.5 },
          { cy: trunkTop - 6, r: 6.5 },
        ];

  for (const b of blobs) {
    for (let y = -Math.ceil(b.r); y <= Math.ceil(b.r); y++) {
      const span = Math.sqrt(Math.max(0, b.r * b.r - y * y));
      const x0 = Math.round(cx - span);
      const x1 = Math.round(cx + span);
      const yy = Math.round(b.cy + y * 0.78);
      if (yy < 0 || yy >= h) continue;
      const shade = y < -b.r * 0.35 ? light : y > b.r * 0.35 ? dark : mid;
      px(ctx, x0, yy, shade, Math.max(1, x1 - x0), 1);
    }
  }

  // Knock out edge pixels so the silhouette isn't a smooth oval.
  for (let i = 0; i < 12; i++) {
    const a = hash2(i * 7 + v, i * 13, 77) * Math.PI * 2;
    const b = blobs[i % blobs.length];
    const x = Math.round(cx + Math.cos(a) * b.r);
    const y = Math.round(b.cy + Math.sin(a) * b.r * 0.78);
    if (x >= 0 && x < w && y >= 0 && y < h) ctx.clearRect(x, y, 1, 1);
  }

  for (let i = 0; i < 7; i++) {
    const hx = hash2(i * 5 + v * 3, i, 41);
    const hy = hash2(i, i * 11 + v, 43);
    const b = blobs[i % blobs.length];
    const x = Math.round(cx - b.r * 0.6 + hx * b.r * 1.2);
    const y = Math.round(b.cy - b.r * 0.6 + hy * b.r);
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    px(ctx, x, y, i % 3 === 0 && blossom ? blossom : light);
  }

  return { canvas: c, ox: -cx, oy: -(h - 3) };
}

/** Conifers keep their colour all year, so they anchor the palette in autumn. */
function bakeConifer(season: Season): PropSprite {
  const winter = season === 'winter';
  const mid = winter ? '#5e7a68' : '#3f6b42';
  const light = winter ? '#7d9a88' : '#4f8250';
  const dark = winter ? '#425a4c' : '#2c4d2f';
  const w = 20;
  const h = 36;
  const c = mkCanvas(w, h);
  const ctx = ctxOf(c);
  const cx = w / 2;

  groundShadow(ctx, cx, h - 3, 11);
  px(ctx, cx - 1, h - 9, TRUNK[2], 2, 6);

  // Three stacked skirts, each a little narrower than the one below.
  const tiers = [
    { y: h - 8, r: 8.5 },
    { y: h - 15, r: 7 },
    { y: h - 22, r: 5.2 },
    { y: h - 28, r: 3.2 },
  ];
  for (const t of tiers) {
    for (let row = 0; row < 8; row++) {
      const k = 1 - row / 8;
      const span = t.r * k;
      const yy = t.y - row;
      if (yy < 0 || yy >= h) continue;
      const col = row > 5 ? light : row < 2 ? dark : mid;
      px(ctx, Math.round(cx - span), yy, col, Math.max(1, Math.round(span * 2)), 1);
    }
  }
  px(ctx, cx, h - 32, light, 1, 3);
  if (winter) {
    for (const t of tiers) px(ctx, cx - t.r * 0.5, t.y - 6, '#e8eef0', Math.max(1, Math.round(t.r)), 1);
  }
  return { canvas: c, ox: -cx, oy: -(h - 3) };
}

function bakeStump(v: number): PropSprite {
  const c = mkCanvas(10, 8);
  const ctx = ctxOf(c);
  px(ctx, 2, 3, TRUNK[2], 6, 4);
  px(ctx, 2, 2, TRUNK[0], 6, 2);
  px(ctx, 3, 2, '#8d6743', 4, 1);
  if (v % 2 === 0) px(ctx, 7, 4, '#4f7d38', 2, 2);
  return { canvas: c, ox: -5, oy: -6 };
}

function bakeBoulder(v: number, small: boolean): PropSprite {
  const w = small ? 14 : 20;
  const h = small ? 9 : 16;
  const c = mkCanvas(w, h);
  const ctx = ctxOf(c);
  const base = '#8e8f8a';
  const light = '#a9aaa4';
  const dark = '#6a6b67';

  if (small) {
    // Scattered rubble left behind by a worked-out boulder.
    const spots = [
      [2, 5, 4, 2],
      [7, 4, 3, 2],
      [4, 2, 3, 2],
      [10, 6, 3, 2],
    ];
    for (let i = 0; i < spots.length; i++) {
      const [x, y, sw, sh] = spots[i];
      px(ctx, x + (v % 2), y, i % 2 ? base : dark, sw, sh);
      px(ctx, x + (v % 2), y, light, sw - 1, 1);
    }
  } else {
    const cx = w / 2;
    const cy = h - 4;
    groundShadow(ctx, cx, h - 2, 15);
    for (let y = -9; y <= 3; y++) {
      const r = 8 - Math.abs(y) * 0.32;
      const span = Math.sqrt(Math.max(0, r * r - y * y * 0.7));
      const yy = Math.round(cy + y * 0.85);
      if (yy < 0 || yy >= h) continue;
      const col = y < -4 ? light : y > 0 ? dark : base;
      px(ctx, Math.round(cx - span), yy, col, Math.max(1, Math.round(span * 2)), 1);
    }
    px(ctx, cx - 3 + (v % 3), cy - 6, light, 3, 1);
    px(ctx, cx + 1, cy - 2, dark, 2, 1);
  }
  return { canvas: c, ox: -w / 2, oy: -(h - 2) };
}

function bakeBush(season: Season, v: number): PropSprite {
  const [mid, light, dark] = FOLIAGE[season];
  const c = mkCanvas(16, 12);
  const ctx = ctxOf(c);
  const cx = 8;
  const cy = 8;
  groundShadow(ctx, cx, 10, 11);
  for (let y = -6; y <= 2; y++) {
    const r = 6.5;
    const span = Math.sqrt(Math.max(0, r * r - y * y)) * 1.05;
    const yy = cy + y;
    if (yy < 0 || yy >= 12) continue;
    px(ctx, Math.round(cx - span), yy, y < -3 ? light : y > 0 ? dark : mid, Math.max(1, Math.round(span * 2)), 1);
  }
  const berry = BLOSSOM[season];
  if (berry && v % 2 === 0) {
    px(ctx, cx - 3, cy - 3, berry);
    px(ctx, cx + 2, cy - 1, berry);
  }
  return { canvas: c, ox: -cx, oy: -10 };
}

function bakeFlowers(season: Season, v: number): PropSprite {
  const colors = FLOWER_COLORS[season];
  const [mid, , dark] = FOLIAGE[season];
  const c = mkCanvas(16, 10);
  const ctx = ctxOf(c);
  for (let i = 0; i < 5; i++) {
    const x = 2 + Math.floor(hash2(i * 3 + v, i, 17) * 12);
    const y = 4 + Math.floor(hash2(i, i * 5 + v, 19) * 4);
    px(ctx, x, y, i % 2 ? mid : dark, 1, 3);
    px(ctx, x, y - 1, colors[Math.floor(hash2(i * 7, v, 23) * colors.length)]);
  }
  return { canvas: c, ox: -8, oy: -8 };
}

function bakeReeds(season: Season, v: number): PropSprite {
  const [mid, light, dark] = FOLIAGE[season];
  const c = mkCanvas(14, 14);
  const ctx = ctxOf(c);
  for (let i = 0; i < 6; i++) {
    const x = 2 + Math.floor(hash2(i * 5 + v, i, 29) * 10);
    const hgt = 5 + Math.floor(hash2(i, i * 3 + v, 31) * 6);
    px(ctx, x, 12 - hgt, i % 3 === 0 ? light : i % 3 === 1 ? mid : dark, 1, hgt);
    if (i % 2 === 0) px(ctx, x, 12 - hgt - 1, '#8a6b3a', 1, 2);
  }
  return { canvas: c, ox: -7, oy: -12 };
}

function bakeLilypad(season: Season, v: number): PropSprite {
  const [mid, light] = FOLIAGE[season];
  const c = mkCanvas(14, 8);
  const ctx = ctxOf(c);
  for (let i = 0; i < 2 + (v % 2); i++) {
    const cx = 3 + i * 4;
    const cy = 3 + ((i * 2 + v) % 3);
    for (let y = -1; y <= 1; y++) {
      const span = y === 0 ? 3 : 2;
      px(ctx, cx - span, cy + y, y < 0 ? light : mid, span * 2, 1);
    }
    if (i === 0 && season !== 'winter') px(ctx, cx, cy - 2, '#f0e6f2');
  }
  return { canvas: c, ox: -7, oy: -5 };
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export interface BuildingSprite {
  canvas: HTMLCanvasElement;
  /** How far above the footprint's top corner the sprite starts. */
  rise: number;
  /** Horizontal padding, so roof overhangs are not clipped. */
  padX: number;
  /**
   * Glass lit from inside after dark. `dy` carries each column's step down the
   * wall, so whatever fills these panes is sheared the same way the art is —
   * a plain rectangle would sit askew on the frame.
   */
  windows: { x: number; y: number; w: number; h: number; dy: number[] }[];
  /** Where a moving part attaches, in sprite-local pixels (windmill sails). */
  anchor: { x: number; y: number } | null;
}

const buildingCache = new Map<string, BuildingSprite>();
const PAD = 7;

export function clearBuildingCache(): void {
  buildingCache.clear();
}

export function getBuildingSprite(
  def: BuildingId,
  w: number,
  h: number,
  level: number,
  season: Season,
  seed: number,
  stage: 'ghost' | 'site' | 'done',
): BuildingSprite {
  const key = `${def}|${level}|${season}|${seed % 4}|${stage}`;
  let s = buildingCache.get(key);
  if (!s) {
    s = drawBuilding(def, w, h, level, season, seed, stage);
    buildingCache.set(key, s);
  }
  return s;
}

type Pt = { x: number; y: number };

/**
 * Fills a convex polygon column by column. Working in whole columns keeps every
 * edge a hard pixel step, which is what makes the art read as pixel art rather
 * than as antialiased vector shapes.
 */
function fillPoly(ctx: CanvasRenderingContext2D, pts: Pt[], color: string): void {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
  }
  ctx.fillStyle = color;
  for (let x = Math.round(minX); x <= Math.round(maxX); x++) {
    let top = Infinity;
    let bot = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const lo = Math.min(a.x, b.x);
      const hi = Math.max(a.x, b.x);
      if (x + 0.5 < lo || x + 0.5 > hi) continue;
      const t = Math.abs(b.x - a.x) < 0.0001 ? 0 : (x + 0.5 - a.x) / (b.x - a.x);
      const y = a.y + (b.y - a.y) * t;
      top = Math.min(top, y);
      bot = Math.max(bot, y);
      if (Math.abs(b.x - a.x) < 0.0001) {
        top = Math.min(top, Math.min(a.y, b.y));
        bot = Math.max(bot, Math.max(a.y, b.y));
      }
    }
    if (top === Infinity) continue;
    const y0 = Math.round(top);
    const height = Math.round(bot) - y0;
    if (height > 0) ctx.fillRect(x, y0, 1, height);
  }
}

/** One-pixel line, used for shingle courses and ridge caps. */
function line(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, color: string): void {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.fillStyle = color;
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    ctx.fillRect(Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t), 1, 1);
  }
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The four screen-space corners of a footprint diamond at a given height. */
function diamond(ox: number, baseY: number, w: number, h: number, inset: number, lift: number) {
  const dw = (w + h) * HALF_W - inset * 2;
  const dh = (w + h) * HALF_H - inset;
  const x0 = ox + inset;
  const y = baseY - lift;
  return {
    dw,
    dh,
    L: { x: x0, y: y - dh / 2 },
    N: { x: x0 + dw / 2, y: y - dh },
    R: { x: x0 + dw, y: y - dh / 2 },
    S: { x: x0 + dw / 2, y },
  };
}

interface WallColors {
  left: string;
  right: string;
  top?: string;
}

/** Two visible wall faces of a box standing on the footprint. */
function isoWalls(
  ctx: CanvasRenderingContext2D,
  ox: number,
  baseY: number,
  w: number,
  h: number,
  height: number,
  col: WallColors,
  inset = 0,
): void {
  const g = diamond(ox, baseY, w, h, inset, 0);
  // Left face runs L → S, right face runs S → R.
  fillPoly(ctx, [g.L, g.S, { x: g.S.x, y: g.S.y - height }, { x: g.L.x, y: g.L.y - height }], col.left);
  fillPoly(ctx, [g.S, g.R, { x: g.R.x, y: g.R.y - height }, { x: g.S.x, y: g.S.y - height }], col.right);
  if (col.top) {
    const t = diamond(ox, baseY, w, h, inset, height);
    fillPoly(ctx, [t.L, t.N, t.R, t.S], col.top);
  }
  // A one-pixel darker seam down the near corner gives the box an edge.
  line(ctx, { x: g.S.x, y: g.S.y - height }, g.S, 'rgba(0,0,0,0.18)');
}

interface RoofColors {
  far: string;
  near: string;
  ridge: string;
  gable: string;
}

/**
 * A gable roof whose ridge runs along the grid's x axis. Both slopes are
 * visible from an isometric camera, which is what gives buildings a readable
 * silhouette instead of a flat lid.
 */
function gableRoof(
  ctx: CanvasRenderingContext2D,
  ox: number,
  baseY: number,
  w: number,
  h: number,
  wallH: number,
  roofH: number,
  ov: number,
  col: RoofColors,
): { apex: Pt; ridgeA: Pt; ridgeB: Pt } {
  const eavesY = baseY - wallH;
  const g = diamond(ox - ov, eavesY, w, h, 0, 0);
  // Widen by the overhang so the eaves stand proud of the walls.
  const dw = (w + h) * HALF_W + ov * 2;
  const dh = (w + h) * HALF_H + ov;
  const x0 = ox - ov;
  const L = { x: x0, y: eavesY - dh / 2 };
  const N = { x: x0 + dw / 2, y: eavesY - dh };
  const R = { x: x0 + dw, y: eavesY - dh / 2 };
  const S = { x: x0 + dw / 2, y: eavesY };
  void g;

  const A = { ...mid(L, N) };
  const B = { ...mid(R, S) };
  A.y -= roofH;
  B.y -= roofH;

  // Far slope, then the gable end, then the near slope on top.
  fillPoly(ctx, [N, R, B, A], col.far);
  fillPoly(ctx, [R, S, B], col.gable);
  fillPoly(ctx, [A, B, S, L], col.near);

  // Shingle courses running parallel to the ridge.
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    line(ctx, lerpPt(A, L, t), lerpPt(B, S, t), col.ridge);
    line(ctx, lerpPt(A, N, t), lerpPt(B, R, t), col.ridge);
  }
  // Ridge cap and eaves shadow.
  line(ctx, A, B, col.ridge);
  line(ctx, { x: A.x, y: A.y - 1 }, { x: B.x, y: B.y - 1 }, col.ridge);
  line(ctx, L, S, 'rgba(0,0,0,0.22)');
  line(ctx, S, R, 'rgba(0,0,0,0.22)');

  return { apex: mid(A, B), ridgeA: A, ridgeB: B };
}

/** Wall height, roof height and eaves overhang for each building and level. */
function shapeFor(def: BuildingId, level: number): { wall: number; roof: number; ov: number; extra: number } {
  const up = level > 1;
  switch (def) {
    case 'shelter':
      return { wall: up ? 21 : 17, roof: up ? 11 : 9, ov: 3, extra: 0 };
    case 'cottage':
      return { wall: up ? 28 : 23, roof: up ? 13 : 11, ov: 4, extra: 11 };
    case 'storehouse':
      return { wall: up ? 24 : 20, roof: up ? 11 : 9, ov: 4, extra: 0 };
    case 'lodge':
      return { wall: 19, roof: 10, ov: 4, extra: 0 };
    case 'quarry':
      return { wall: 6, roof: 7, ov: 3, extra: 16 };
    case 'farm':
      return { wall: 16, roof: 9, ov: 2, extra: 0 };
    case 'mill':
      return { wall: up ? 40 : 34, roof: 9, ov: 1, extra: 14 };
    case 'bakery':
      return { wall: up ? 25 : 21, roof: up ? 12 : 11, ov: 4, extra: 13 };
    case 'well':
      return { wall: 7, roof: 7, ov: 2, extra: 16 };
    case 'statue':
      return { wall: 5, roof: 0, ov: 0, extra: 22 };
    case 'lantern':
      return { wall: 0, roof: 0, ov: 0, extra: 22 };
    case 'campfire':
      return { wall: 0, roof: 0, ov: 0, extra: 16 };
    case 'chest':
      return { wall: 0, roof: 0, ov: 0, extra: 10 };
    case 'bench':
      return { wall: 0, roof: 0, ov: 0, extra: 13 };
    case 'sapling':
      return { wall: 0, roof: 0, ov: 0, extra: 18 };
    default:
      return { wall: 0, roof: 0, ov: 0, extra: 8 };
  }
}

function riseFor(def: BuildingId, level: number): number {
  const s = shapeFor(def, level);
  return s.wall + s.roof + s.ov + s.extra + 6;
}

/** Palette. Winter versions are the same materials under snow. */
function materials() {
  return {
    plankL: '#a97f4d',
    plankR: '#87643b',
    plankT: '#c39a63',
    plasterL: '#e6d8bc',
    plasterR: '#c4b192',
    stoneL: '#a3a29a',
    stoneR: '#83827c',
    stoneT: '#b6b5ac',
    door: '#5c3f28',
    window: '#3b3226',
  };
}

function drawBuilding(
  def: BuildingId,
  w: number,
  h: number,
  level: number,
  season: Season,
  seed: number,
  stage: 'ghost' | 'site' | 'done',
): BuildingSprite {
  const spanW = (w + h) * HALF_W;
  const spanH = (w + h) * HALF_H;
  const rise = riseFor(def, level);
  const c = mkCanvas(spanW + PAD * 2, spanH + rise);
  const ctx = ctxOf(c);
  const baseY = spanH + rise;
  const ox = PAD;
  const windows: BuildingSprite['windows'] = [];
  const anchor: { x: number; y: number }[] = [];

  if (stage === 'ghost') {
    drawFootprint(ctx, ox, baseY, w, h, 'rgba(255,240,200,0.35)', 'rgba(255,240,200,0.8)');
    return { canvas: c, rise, padX: PAD, windows, anchor: null };
  }
  if (stage === 'site') {
    drawSite(ctx, ox, baseY, w, h, rise, seed);
    return { canvas: c, rise, padX: PAD, windows, anchor: null };
  }
  drawFinished(ctx, ox, baseY, w, h, def, level, season, seed, windows, anchor);
  return { canvas: c, rise, padX: PAD, windows, anchor: anchor[0] ?? null };
}

function drawFootprint(
  ctx: CanvasRenderingContext2D,
  ox: number,
  baseY: number,
  w: number,
  h: number,
  fill: string,
  edge: string,
): void {
  const g = diamond(ox, baseY, w, h, 0, 0);
  fillPoly(ctx, [g.L, g.N, g.R, g.S], fill);
  line(ctx, g.L, g.N, edge);
  line(ctx, g.N, g.R, edge);
  line(ctx, g.R, g.S, edge);
  line(ctx, g.S, g.L, edge);
}

/** A construction site: levelled ground, corner posts and a stack of materials. */
function drawSite(
  ctx: CanvasRenderingContext2D,
  ox: number,
  baseY: number,
  w: number,
  h: number,
  rise: number,
  seed: number,
): void {
  drawFootprint(ctx, ox, baseY, w, h, '#8a7350', '#6a5539');
  const g = diamond(ox, baseY, w, h, 2, 0);
  const postH = Math.max(9, Math.min(rise - 8, 18));

  for (const p of [g.L, g.N, g.R, g.S]) {
    px(ctx, p.x - 1, p.y - postH, '#8a6a42', 2, postH);
    px(ctx, p.x - 1, p.y - postH, '#a5824f', 1, postH);
  }
  // Rails between the posts, a little way up.
  const railY = -Math.round(postH * 0.72);
  line(ctx, { x: g.L.x, y: g.L.y + railY }, { x: g.S.x, y: g.S.y + railY }, '#98764a');
  line(ctx, { x: g.S.x, y: g.S.y + railY }, { x: g.R.x, y: g.R.y + railY }, '#98764a');
  line(ctx, { x: g.L.x, y: g.L.y + railY + 1 }, { x: g.S.x, y: g.S.y + railY + 1 }, '#7a5d38');
  line(ctx, { x: g.S.x, y: g.S.y + railY + 1 }, { x: g.R.x, y: g.R.y + railY + 1 }, '#7a5d38');

  // A pile of timber on site.
  const px0 = g.S.x - 6 + (seed % 3);
  px(ctx, px0, baseY - 7, '#8d673c', 11, 3);
  px(ctx, px0 + 1, baseY - 9, '#a97f4d', 9, 2);
  px(ctx, px0 + 2, baseY - 11, '#c39a63', 7, 2);
}

function drawFinished(
  ctx: CanvasRenderingContext2D,
  ox: number,
  baseY: number,
  w: number,
  h: number,
  def: BuildingId,
  level: number,
  season: Season,
  seed: number,
  windows: BuildingSprite['windows'],
  anchor: { x: number; y: number }[],
): void {
  const M = materials();
  const snow = season === 'winter';
  const s = shapeFor(def, level);
  const g = diamond(ox, baseY, w, h, 0, 0);
  const bx = g.S.x;
  // Middle of the near-left face — the front, and where doors go. Everything
  // set into a wall is positioned off this and `wallTopY`, never off a fixed
  // screen row, because the face it sits on climbs away from the near corner.
  const front = Math.round((g.L.x + bx) / 2);

  // Roof palettes, whitened in winter.
  const thatch: RoofColors = snow
    ? { far: '#ded5c0', near: '#c8bfa8', ridge: '#a99d84', gable: '#b8934f' }
    : { far: '#d7ab5c', near: '#ab8340', ridge: '#7f5f2b', gable: '#c09455' };
  const tile: RoofColors = snow
    ? { far: '#d8c4b8', near: '#b08a7c', ridge: '#8d6558', gable: '#c4a189' }
    : { far: '#b56b4c', near: '#8f4f36', ridge: '#68372a', gable: '#c99a72' };
  const slate: RoofColors = snow
    ? { far: '#cdd2da', near: '#a3aab4', ridge: '#7d848e', gable: '#b6bcc4' }
    : { far: '#7b828e', near: '#5b626c', ridge: '#434952', gable: '#8b929c' };
  const moss: RoofColors = snow
    ? { far: '#cfd6c6', near: '#a7b09c', ridge: '#828b78', gable: '#b9c0ac' }
    : { far: '#7d9260', near: '#5e7147', ridge: '#465433', gable: '#8fa373' };

  switch (def) {
    case 'shelter': {
      isoWalls(ctx, ox, baseY, w, h, s.wall, { left: M.plankL, right: M.plankR }, 2);
      gableRoof(ctx, ox, baseY, w, h, s.wall, s.roof, s.ov, thatch);
      addDoor(ctx, bx, baseY, front, 7, s.wall - 2, M.door);
      addWindow(ctx, bx, baseY, front - 11, s.wall, 3, windows, M.window);
      if (level > 1) addWindow(ctx, bx, baseY, front + 9, s.wall, 3, windows, M.window);
      break;
    }
    case 'cottage': {
      isoWalls(ctx, ox, baseY, w, h, 5, { left: M.stoneL, right: M.stoneR }, 1);
      isoWalls(ctx, ox, baseY - 5, w, h, s.wall - 5, { left: M.plasterL, right: M.plasterR }, 2);
      const roof = gableRoof(ctx, ox, baseY, w, h, s.wall, s.roof, s.ov, tile);
      // Window, door, window along the front, and one on the gable end.
      addDoor(ctx, bx, baseY, front, 7, s.wall - 2, M.door);
      addWindow(ctx, bx, baseY, front - 11, s.wall, 4, windows, M.window);
      addWindow(ctx, bx, baseY, front + 9, s.wall, 4, windows, M.window);
      addWindow(ctx, bx, baseY, bx + 12, s.wall, 4, windows, M.window);
      chimney(ctx, roof.ridgeA.x + 5, roof.ridgeA.y - 1, 9, snow);
      break;
    }
    case 'storehouse': {
      isoWalls(ctx, ox, baseY, w, h, s.wall, { left: M.plankL, right: M.plankR }, 1);
      gableRoof(ctx, ox, baseY, w, h, s.wall, s.roof, s.ov, slate);
      // Big double doors across the front — the point of the building.
      addDoor(ctx, bx, baseY, front, 15, s.wall - 2, '#6b4a2c');
      // The gap where the two leaves meet, running down with the wall.
      px(ctx, front, wallFootY(bx, baseY, front) - s.wall + 3, '#4a3320', 1, s.wall - 4);
      crate(ctx, g.L.x + 1, g.L.y + 6, seed);
      if (level > 1) crate(ctx, g.R.x - 12, g.R.y + 7, seed + 1);
      break;
    }
    case 'lodge': {
      isoWalls(ctx, ox, baseY, w, h, s.wall, { left: '#8a6b41', right: '#6d5334' }, 2);
      gableRoof(ctx, ox, baseY, w, h, s.wall, s.roof, s.ov, moss);
      addDoor(ctx, bx, baseY, front, 7, s.wall - 2, M.door);
      // Log pile and an axe left in a stump.
      px(ctx, g.L.x + 2, g.L.y + 4, '#8a6b41', 9, 4);
      px(ctx, g.L.x + 2, g.L.y + 4, '#a5824f', 9, 1);
      px(ctx, g.L.x + 3, g.L.y + 1, '#8a6b41', 7, 3);
      px(ctx, g.R.x - 11, g.R.y + 5, '#6b4a2f', 6, 4);
      px(ctx, g.R.x - 9, g.R.y, '#8a8f96', 2, 5);
      px(ctx, g.R.x - 10, g.R.y - 1, '#c8ccd2', 4, 2);
      break;
    }
    case 'quarry': {
      isoWalls(ctx, ox, baseY, w, h, s.wall, { left: '#8b8a83', right: '#6e6d67', top: '#9e9d95' }, 1);
      // Lean-to over the working face, on four posts.
      const shelterY = baseY - s.wall - 14;
      for (const p of [g.L, g.R, g.N, g.S]) px(ctx, p.x - 1, p.y - s.wall - 14, '#8a6b41', 2, 14);
      gableRoof(ctx, ox, shelterY + s.wall, w, h, s.wall, s.roof, s.ov, slate);
      px(ctx, bx - 9, baseY - 8, '#a3a29a', 7, 6);
      px(ctx, bx - 9, baseY - 8, '#b6b5ac', 7, 1);
      px(ctx, bx + 1, baseY - 6, '#8b8a84', 6, 4);
      px(ctx, bx + 1, baseY - 6, '#9e9d95', 6, 1);
      break;
    }
    case 'farm': {
      // The barn sits on the back corner; the rest of the plot is worked ground.
      const barnBaseY = baseY - (w + h - 2) * HALF_H;
      const barnOx = ox + (h - 1) * HALF_W;
      isoWalls(ctx, barnOx, barnBaseY, 1, 1, s.wall, { left: '#a55f42', right: '#83492f' }, 0);
      gableRoof(ctx, barnOx, barnBaseY, 1, 1, s.wall, s.roof, s.ov, slate);
      const barnBx = barnOx + HALF_W;
      addDoor(ctx, barnBx, barnBaseY, barnBx - 8, 7, s.wall - 2, '#4f3520');
      // Low fence posts around the near edges of the plot.
      for (let i = 1; i < (w + h) * 2; i++) {
        const t = i / ((w + h) * 2);
        const a = lerpPt(g.L, g.S, t);
        const b = lerpPt(g.S, g.R, t);
        px(ctx, a.x, a.y - 4, '#9a7b52', 1, 4);
        px(ctx, b.x, b.y - 4, '#9a7b52', 1, 4);
      }
      break;
    }
    case 'mill': {
      isoWalls(ctx, ox, baseY, w, h, 6, { left: M.stoneL, right: M.stoneR }, 1);
      isoWalls(ctx, ox, baseY - 6, w, h, s.wall - 6, { left: '#dccdaf', right: '#b8a68a' }, 6);
      const roof = gableRoof(ctx, ox, baseY, w, h, s.wall, s.roof, s.ov, slate);
      // Stacked up the front of the tower, not wrapped round its corner.
      addWindow(ctx, bx, baseY, front, s.wall, 6, windows, M.window);
      addWindow(ctx, bx, baseY, front, s.wall, 18, windows, M.window);
      // Hub the sails turn on; the renderer draws the moving blades.
      const hub = { x: roof.apex.x, y: roof.apex.y - 3 };
      px(ctx, hub.x - 2, hub.y - 2, '#6b5334', 4, 4);
      anchor.push(hub);
      break;
    }
    case 'bakery': {
      isoWalls(ctx, ox, baseY, w, h, 4, { left: M.stoneL, right: M.stoneR }, 1);
      isoWalls(ctx, ox, baseY - 4, w, h, s.wall - 4, { left: '#ecdcbb', right: '#cbb894' }, 2);
      const roof = gableRoof(ctx, ox, baseY, w, h, s.wall, s.roof, s.ov, tile);
      addDoor(ctx, bx, baseY, front, 7, s.wall - 2, '#7a4f2c');
      addWindow(ctx, bx, baseY, front - 11, s.wall, 4, windows, M.window);
      addWindow(ctx, bx, baseY, bx + 12, s.wall, 4, windows, M.window);
      chimney(ctx, roof.ridgeA.x - 1, roof.ridgeA.y - 2, 12, snow);
      // A serving counter beside the door, awning above it, loaves out on the
      // shelf — all of it running with the wall rather than square to the
      // screen, and clear of the doorway so you can still read it as a door.
      for (let dx = 6; dx <= 15; dx++) {
        const ax = front + dx;
        const ay = wallTopY(bx, baseY, ax, s.wall) + 1;
        px(ctx, ax, ay, '#c9603f', 1, 2);
        px(ctx, ax, ay + 2, '#8e4630', 1, 1);
        px(ctx, ax, wallFootY(bx, baseY, ax) - 6, '#8a6b41', 1, 2);
      }
      px(ctx, front + 7, wallFootY(bx, baseY, front + 7) - 8, '#d09a5c', 4, 2);
      px(ctx, front + 12, wallFootY(bx, baseY, front + 12) - 8, '#c98a4b', 4, 2);
      break;
    }
    case 'well': {
      isoWalls(ctx, ox, baseY, w, h, s.wall, { left: M.stoneL, right: M.stoneR, top: '#3f6580' }, 4);
      px(ctx, bx - 8, baseY - 22, '#8a6b41', 2, 16);
      px(ctx, bx + 6, baseY - 22, '#8a6b41', 2, 16);
      gableRoof(ctx, ox, baseY - 22 + s.wall, w, h, s.wall, s.roof, s.ov, thatch);
      px(ctx, bx - 3, baseY - 17, '#6b4a2f', 7, 2);
      px(ctx, bx - 1, baseY - 15, '#4a4038', 1, 5);
      px(ctx, bx - 3, baseY - 10, '#7d5936', 4, 3);
      break;
    }
    case 'bench': {
      px(ctx, bx - 9, baseY - 5, '#8a6b41', 18, 2);
      px(ctx, bx - 9, baseY - 6, '#a5824f', 18, 1);
      px(ctx, bx - 8, baseY - 3, '#6b5334', 2, 3);
      px(ctx, bx + 6, baseY - 3, '#6b5334', 2, 3);
      px(ctx, bx - 9, baseY - 12, '#8a6b41', 18, 2);
      px(ctx, bx - 9, baseY - 13, '#a5824f', 18, 1);
      px(ctx, bx - 8, baseY - 12, '#6b5334', 1, 7);
      px(ctx, bx + 7, baseY - 12, '#6b5334', 1, 7);
      break;
    }
    case 'lantern': {
      px(ctx, bx - 1, baseY - 16, '#48413a', 2, 15);
      px(ctx, bx - 4, baseY - 22, '#5c5148', 8, 7);
      px(ctx, bx - 3, baseY - 21, '#ffd894', 6, 5);
      px(ctx, bx - 4, baseY - 24, '#6e6259', 8, 2);
      px(ctx, bx - 1, baseY - 26, '#6e6259', 2, 2);
      break;
    }
    case 'flowerbed': {
      px(ctx, bx - 9, baseY - 4, '#6b4a2f', 18, 4);
      px(ctx, bx - 9, baseY - 5, '#8a6b41', 18, 1);
      const colors = FLOWER_COLORS[season];
      for (let i = 0; i < 8; i++) {
        const fx = bx - 7 + i * 2;
        const fy = baseY - 6 - ((i + seed) % 3);
        px(ctx, fx, fy, '#5f8a3f', 1, 3);
        px(ctx, fx, fy - 1, colors[(i + seed) % colors.length]);
      }
      break;
    }
    case 'sapling': {
      px(ctx, bx - 1, baseY - 9, TRUNK[0], 2, 9);
      const [fol, light] = FOLIAGE[season];
      px(ctx, bx - 5, baseY - 15, fol, 10, 5);
      px(ctx, bx - 4, baseY - 18, fol, 8, 3);
      px(ctx, bx - 2, baseY - 17, light, 4, 1);
      break;
    }
    case 'statue': {
      isoWalls(ctx, ox, baseY, w, h, s.wall, { left: '#84837c', right: '#6a6963', top: '#9a9891' }, 4);
      px(ctx, bx - 3, baseY - 24, '#b6b5ac', 7, 19);
      px(ctx, bx - 3, baseY - 24, '#c8c7be', 3, 19);
      px(ctx, bx - 2, baseY - 27, '#a3a29a', 5, 4);
      px(ctx, bx - 5, baseY - 16, '#8f9c8a', 2, 3);
      break;
    }
    case 'chest': {
      // Low, wide and banded. It has to read as a chest at a glance next to a
      // 16px villager, so it stays well under head height — anything taller
      // starts looking like a little shed.
      const body = snow ? '#9c7748' : '#a37f4e';
      const lit = snow ? '#c6a06d' : '#c39a63';
      const dark = '#6b4a2f';
      const iron = '#5c5148';
      px(ctx, bx - 8, baseY - 2, 'rgba(24,20,14,0.18)', 16, 2);
      // Body.
      px(ctx, bx - 7, baseY - 9, body, 14, 7);
      px(ctx, bx - 7, baseY - 3, dark, 14, 1);
      // Domed lid, two steps so the curve reads without antialiasing.
      px(ctx, bx - 7, baseY - 12, body, 14, 3);
      px(ctx, bx - 6, baseY - 14, body, 12, 2);
      px(ctx, bx - 6, baseY - 14, snow ? '#e8e4dc' : lit, 12, 1);
      px(ctx, bx - 7, baseY - 10, dark, 14, 1);
      // Iron bands over lid and body, and a clasp at the front.
      px(ctx, bx - 5, baseY - 14, iron, 1, 11);
      px(ctx, bx + 4, baseY - 14, iron, 1, 11);
      px(ctx, bx - 1, baseY - 11, iron, 3, 4);
      px(ctx, bx - 1, baseY - 11, '#8a8078', 3, 1);
      break;
    }
    case 'campfire': {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        px(ctx, bx + Math.cos(a) * 9 - 1, baseY - 3 + Math.sin(a) * 4.5, i % 2 ? '#8b8a84' : '#a3a29a', 3, 2);
      }
      px(ctx, bx - 6, baseY - 6, '#6b4a2f', 12, 2);
      px(ctx, bx - 4, baseY - 8, '#7d5936', 9, 2);
      px(ctx, bx - 3, baseY - 13, '#e8763a', 6, 6);
      px(ctx, bx - 2, baseY - 16, '#f2a83c', 4, 5);
      px(ctx, bx - 1, baseY - 18, '#ffd25c', 2, 3);
      px(ctx, bx - 1, baseY - 11, '#ffe89a', 2, 3);
      break;
    }
  }
}

function chimney(ctx: CanvasRenderingContext2D, x: number, y: number, height: number, snow: boolean): void {
  px(ctx, x, y - height, '#8a7a6a', 5, height + 2);
  px(ctx, x, y - height, snow ? '#e8e4dc' : '#a3937f', 5, 2);
  px(ctx, x + 1, y - height + 2, '#4a4038', 3, 1);
}

function crate(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number): void {
  px(ctx, x, y - 6, '#a37f4e', 8, 6);
  px(ctx, x, y - 6, '#c39a63', 8, 1);
  px(ctx, x, y - 4, '#8a6a42', 8, 1);
  if (seed % 2 === 0) {
    px(ctx, x + 1, y - 10, '#a37f4e', 6, 4);
    px(ctx, x + 1, y - 10, '#c39a63', 6, 1);
  }
}

/**
 * Where a wall's bottom edge sits in column `x`. Both near faces lie on the
 * same pair of lines through the near corner at the iso 2:1 slope, so one
 * formula covers either — and it samples the way `fillPoly` rasterises the
 * faces themselves, so anything standing on a wall lines up with it pixel for
 * pixel. The wall inset does not matter: an inset face is a shorter piece of
 * the same line.
 */
function wallFootY(bx: number, baseY: number, x: number): number {
  return Math.round(baseY - Math.abs(x + 0.5 - bx) / 2);
}

/** The wall top in column `x`, which is the foot lifted by the wall height. */
function wallTopY(bx: number, baseY: number, x: number, wallH: number): number {
  return wallFootY(bx, baseY, x) - wallH;
}

/**
 * A door set into one wall face, centred on it, sheared to that face's slope.
 *
 * Doors used to be flat rectangles straddling the near corner, which folded a
 * single door over two walls at once and left its square foot hanging below a
 * base that slopes away in both directions. A door belongs on one face, and on
 * an isometric wall its jambs are the only vertical part of it: head and
 * threshold run with the wall. The near-left face gets the door because the
 * roof's near slope overhangs that side, so it sits under the eaves.
 */
function addDoor(
  ctx: CanvasRenderingContext2D,
  bx: number,
  baseY: number,
  cx: number,
  w: number,
  h: number,
  color: string,
): void {
  const half = w >> 1;
  const frame = shade(color, 0.55);
  for (let dx = -half; dx < w - half; dx++) {
    const x = cx + dx;
    const head = wallFootY(bx, baseY, x) - h;
    const jamb = dx === -half || dx === w - half - 1;
    // The jambs run full height; between them the frame is just the lintel.
    px(ctx, x, head, frame, 1, jamb ? h : 1);
    if (!jamb) px(ctx, x, head + 1, color, 1, h - 1);
  }
  const hx = cx + w - half - 3;
  px(ctx, hx, wallFootY(bx, baseY, hx) - Math.round(h * 0.45), '#d8b06a');
}

/**
 * A window set into a wall face, `drop` pixels below the wall top at its centre
 * column. Like a door it is a parallelogram, not a rectangle: each column steps
 * down with the face, so the frame lies in the wall instead of being pasted
 * across it at a screen-flat angle.
 */
function addWindow(
  ctx: CanvasRenderingContext2D,
  bx: number,
  baseY: number,
  cx: number,
  wallH: number,
  drop: number,
  windows: BuildingSprite['windows'],
  color: string,
): void {
  const top = wallTopY(bx, baseY, cx, wallH) + drop;
  const ref = wallFootY(bx, baseY, cx);
  const dy: number[] = [];
  for (let i = -1; i <= 5; i++) {
    const off = wallFootY(bx, baseY, cx + i) - ref;
    const y = top + off;
    if (i < 0 || i > 4) {
      px(ctx, cx + i, y - 1, '#8a7a62', 1, 6);
      continue;
    }
    px(ctx, cx + i, y - 1, '#8a7a62', 1, 1);
    px(ctx, cx + i, y, i === 2 ? '#8a7a62' : color, 1, 4);
    px(ctx, cx + i, y + 4, '#8a7a62', 1, 1);
    dy.push(off);
  }
  windows.push({ x: cx, y: top, w: 5, h: 4, dy });
}

// ---------------------------------------------------------------------------
// Crops
// ---------------------------------------------------------------------------

const cropCache = new Map<string, HTMLCanvasElement>();

/** Wheat plot at a given growth stage, 0 (bare earth) to 4 (ready). */
export function getCropSprite(stage: number, season: Season): HTMLCanvasElement {
  const key = `${stage}|${season}`;
  let c = cropCache.get(key);
  if (c) return c;
  c = mkCanvas(HALF_W * 2, HALF_H * 2 + 10);
  const ctx = ctxOf(c);
  const baseY = HALF_H * 2 + 10;

  // Tilled earth.
  for (let y = 0; y < HALF_H * 2; y++) {
    const { x0, width } = diamondRow(y);
    px(ctx, x0, baseY - HALF_H * 2 + y, y < 3 ? '#7d5f3f' : y > 12 ? '#5c4429' : '#6b4f33', width, 1);
  }
  for (let i = 0; i < 5; i++) {
    const y = 3 + i * 2;
    const { x0, width } = diamondRow(y);
    px(ctx, x0 + 2, baseY - HALF_H * 2 + y, '#5c4429', Math.max(1, width - 4), 1);
  }

  if (stage > 0) {
    const winter = season === 'winter';
    const green = winter ? '#8fa08c' : stage >= 3 ? '#c9a94e' : '#7fa34c';
    const tipCol = winter ? '#c8cfc6' : stage >= 3 ? '#e6c964' : '#96bb5c';
    const height = 2 + stage * 2;
    for (let i = 0; i < 9; i++) {
      const hx = hash2(i * 3, i, 55);
      const hy = hash2(i, i * 5, 57);
      const y = 3 + Math.floor(hy * 10);
      const { x0, width } = diamondRow(y);
      if (width < 8) continue;
      const x = Math.floor(x0 + 3 + hx * (width - 6));
      const yy = baseY - HALF_H * 2 + y;
      px(ctx, x, yy - height, green, 1, height);
      if (stage >= 3) px(ctx, x, yy - height - 1, tipCol, 1, 2);
    }
  }
  cropCache.set(key, c);
  return c;
}

export function clearCropCache(): void {
  cropCache.clear();
}
