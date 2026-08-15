/** Map generation and tile queries. */

import { RNG, fbm, hash2, clamp } from '../core/util';
import type { GameState, PropId, Tile, TerrainId } from '../types';
import { TERRAIN_SPEED } from '../sim/defs';

export const MAP_W = 40;
export const MAP_H = 40;

/** Tree/boulder yields and regrowth pacing, in game seconds. */
export const TREE_WOOD = 18;
export const BOULDER_STONE = 24;
export const TREE_REGROW = 60 * 60 * 1.2;
export const BOULDER_REGROW = 60 * 60 * 2.0;

export function idx(g: { w: number }, x: number, y: number): number {
  return y * g.w + x;
}

export function inBounds(g: { w: number; h: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.w && y < g.h;
}

export function tileAt(g: GameState, x: number, y: number): Tile | null {
  if (!inBounds(g, x, y)) return null;
  return g.tiles[y * g.w + x];
}

function blankTile(terrain: TerrainId): Tile {
  return {
    terrain,
    prop: null,
    variant: 0,
    amount: 0,
    regrow: 0,
    building: 0,
    blocked: false,
    plot: 0,
    claimed: 0,
  };
}

/**
 * Builds the starting island. The centre is a deliberate clearing so the founder
 * has somewhere obvious to begin; woodland, rock and water sit a short walk away.
 */
export function generateMap(seed: number): { tiles: Tile[]; w: number; h: number; start: { x: number; y: number } } {
  const r = new RNG(seed);
  const w = MAP_W;
  const h = MAP_H;
  const tiles: Tile[] = new Array(w * h);
  const cx = w / 2;
  const cy = h / 2;
  const salt = seed & 0xffff;

  // Pond centre, placed off to one side of the clearing.
  const pondAngle = r.range(0, Math.PI * 2);
  const pondX = cx + Math.cos(pondAngle) * 11;
  const pondY = cy + Math.sin(pondAngle) * 11;

  // Rocky outcrop on roughly the opposite side.
  const rockAngle = pondAngle + Math.PI + r.range(-0.7, 0.7);
  const rockX = cx + Math.cos(rockAngle) * 12;
  const rockY = cy + Math.sin(rockAngle) * 12;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / 9;
      const ny = y / 9;

      // Island falloff: distance from centre, softened by noise so the coast wanders.
      const dx = (x - cx) / (w / 2);
      const dy = (y - cy) / (h / 2);
      const edge = Math.sqrt(dx * dx + dy * dy);
      const coast = fbm(nx * 0.8, ny * 0.8, 3, salt + 11) * 0.22;
      const land = 1 - edge + coast - 0.12;

      let terrain: TerrainId;
      if (land < -0.06) terrain = 'water';
      else if (land < 0.02) terrain = 'shallow';
      else if (land < 0.08) terrain = 'sand';
      else {
        const forestN = fbm(nx * 1.3 + 40, ny * 1.3 - 20, 4, salt + 3);
        const meadowN = fbm(nx * 1.1 - 15, ny * 1.1 + 55, 3, salt + 7);
        const rockD = Math.sqrt((x - rockX) ** 2 + (y - rockY) ** 2);
        const clearD = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

        if (rockD < 5.5 + fbm(nx * 3, ny * 3, 2, salt + 31) * 3.5) terrain = 'rocky';
        else if (clearD < 5) terrain = 'grass';
        else if (forestN > 0.56) terrain = 'forest';
        else if (meadowN > 0.58) terrain = 'meadow';
        else terrain = 'grass';
      }

      // Pond carved into the land.
      const pondD = Math.sqrt((x - pondX) ** 2 + (y - pondY) ** 2);
      const pondR = 3.4 + fbm(nx * 4, ny * 4, 2, salt + 61) * 2.2;
      if (pondD < pondR - 0.9) terrain = 'water';
      else if (pondD < pondR + 0.5) terrain = 'shallow';
      else if (pondD < pondR + 1.4 && terrain !== 'water') terrain = 'sand';

      tiles[y * w + x] = blankTile(terrain);
    }
  }

  // Scatter props appropriate to each terrain.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tiles[y * w + x];
      const clearD = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const rr = hash2(x, y, salt + 101);
      let prop: PropId | null = null;

      if (t.terrain === 'forest') {
        if (rr < 0.62) prop = 'tree';
        else if (rr < 0.74) prop = 'bush';
      } else if (t.terrain === 'grass') {
        if (rr < 0.05 && clearD > 6) prop = 'tree';
        else if (rr < 0.1) prop = 'bush';
        else if (rr < 0.13) prop = 'flowers';
      } else if (t.terrain === 'meadow') {
        if (rr < 0.3) prop = 'flowers';
        else if (rr < 0.36) prop = 'bush';
      } else if (t.terrain === 'rocky') {
        if (rr < 0.42) prop = 'boulder';
        else if (rr < 0.56) prop = 'pebbles';
      } else if (t.terrain === 'shallow') {
        if (rr < 0.22) prop = 'reeds';
        else if (rr < 0.3) prop = 'lilypad';
      } else if (t.terrain === 'sand') {
        if (rr < 0.08) prop = 'reeds';
      }

      // Keep the founding clearing genuinely clear.
      if (clearD < 3.2) prop = null;

      t.prop = prop;
      t.variant = Math.floor(hash2(x, y, salt + 7) * 4);
      if (prop === 'tree') t.amount = TREE_WOOD;
      else if (prop === 'boulder') t.amount = BOULDER_STONE;
    }
  }

  // Guarantee a workable amount of nearby wood and stone regardless of noise luck.
  ensureNodes(tiles, w, h, cx, cy, 'tree', 55, r, salt);
  ensureNodes(tiles, w, h, cx, cy, 'boulder', 26, r, salt);

  const start = findStart(tiles, w, h, cx, cy);
  return { tiles, w, h, start };
}

function ensureNodes(
  tiles: Tile[],
  w: number,
  h: number,
  cx: number,
  cy: number,
  prop: PropId,
  want: number,
  r: RNG,
  salt: number,
): void {
  const radius = 14;
  let count = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < radius && tiles[y * w + x].prop === prop) count++;
    }
  let guard = 0;
  while (count < want && guard++ < 4000) {
    const a = r.range(0, Math.PI * 2);
    const d = r.range(5, radius);
    const x = Math.round(cx + Math.cos(a) * d);
    const y = Math.round(cy + Math.sin(a) * d);
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
    const t = tiles[y * w + x];
    if (t.prop) continue;
    const ok = prop === 'tree' ? t.terrain === 'grass' || t.terrain === 'forest' || t.terrain === 'meadow' : t.terrain === 'rocky' || t.terrain === 'grass';
    if (!ok) continue;
    t.prop = prop;
    t.variant = Math.floor(hash2(x, y, salt + 7) * 4);
    t.amount = prop === 'tree' ? TREE_WOOD : BOULDER_STONE;
    count++;
  }
}

function findStart(tiles: Tile[], w: number, h: number, cx: number, cy: number): { x: number; y: number } {
  for (let radius = 0; radius < 12; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = Math.round(cx) + dx;
        const y = Math.round(cy) + dy;
        if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) continue;
        const t = tiles[y * w + x];
        if (t.terrain === 'grass' && !t.prop) return { x, y };
      }
    }
  }
  return { x: Math.round(cx), y: Math.round(cy) };
}

/** Movement multiplier for a tile, 0 when impassable. */
export function tileSpeed(g: GameState, x: number, y: number): number {
  const t = tileAt(g, x, y);
  if (!t) return 0;
  if (t.blocked) return 0;
  let s = TERRAIN_SPEED[t.terrain] ?? 1;
  if (s <= 0) return 0;
  if (t.prop === 'tree' || t.prop === 'boulder') s *= 0.55;
  else if (t.prop === 'bush') s *= 0.8;
  return s;
}

export function isWalkable(g: GameState, x: number, y: number): boolean {
  return tileSpeed(g, x, y) > 0;
}

/** Counts a prop type in a radius. Used by the wildlife habitat model. */
export function countProp(g: GameState, cx: number, cy: number, prop: PropId, radius: number): number {
  let n = 0;
  const r2 = radius * radius;
  const x0 = clamp(Math.floor(cx - radius), 0, g.w - 1);
  const x1 = clamp(Math.ceil(cx + radius), 0, g.w - 1);
  const y0 = clamp(Math.floor(cy - radius), 0, g.h - 1);
  const y1 = clamp(Math.ceil(cy + radius), 0, g.h - 1);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      if (g.tiles[y * g.w + x].prop === prop) n++;
    }
  return n;
}

/** Nearest tile carrying a live resource node of the given prop, within radius. */
export function findNode(
  g: GameState,
  cx: number,
  cy: number,
  prop: PropId,
  radius: number,
  skipClaimed = true,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  const x0 = clamp(Math.floor(cx - radius), 0, g.w - 1);
  const x1 = clamp(Math.ceil(cx + radius), 0, g.w - 1);
  const y0 = clamp(Math.floor(cy - radius), 0, g.h - 1);
  const y1 = clamp(Math.ceil(cy + radius), 0, g.h - 1);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const t = g.tiles[y * g.w + x];
      if (t.prop !== prop || t.amount <= 0) continue;
      if (skipClaimed && t.claimed) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  return best;
}

/** Advances node regrowth. Depleted trees leave stumps that quietly come back. */
export function updateTerrain(g: GameState, dt: number): void {
  // Sampled rather than exhaustive: the whole map every few seconds is plenty.
  const stride = 8;
  const offset = Math.floor(g.clock / 0.25) % stride;
  for (let i = offset; i < g.tiles.length; i += stride) {
    const t = g.tiles[i];
    if (t.regrow > 0) {
      t.regrow -= dt * stride;
      if (t.regrow <= 0) {
        t.regrow = 0;
        if (t.prop === 'stump') {
          t.prop = 'tree';
          t.amount = TREE_WOOD;
        } else if (t.prop === 'pebbles' && t.terrain === 'rocky') {
          t.prop = 'boulder';
          t.amount = BOULDER_STONE;
        }
      }
    }
  }
}
