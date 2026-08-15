/** A* over the tile grid, weighted by terrain speed so open ground beats scrub. */

import type { GameState } from '../types';
import { tileSpeed, inBounds } from './terrain';

/** Binary min-heap keyed by f-score, storing tile indices. */
class Heap {
  private items: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.items.length;
  }
  clear(): void {
    this.items.length = 0;
    this.keys.length = 0;
  }
  push(item: number, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      const n = this.items.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let s = i;
        if (l < n && this.keys[l] < this.keys[s]) s = l;
        if (r < n && this.keys[r] < this.keys[s]) s = r;
        if (s === i) break;
        this.swap(i, s);
        i = s;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

// Reused across calls so pathfinding allocates nothing in the steady state.
const heap = new Heap();
let gScore: Float32Array | null = null;
let cameFrom: Int32Array | null = null;
let visitMark: Int32Array | null = null;
let visitEpoch = 0;
let capacity = 0;

function ensureBuffers(n: number): void {
  if (capacity >= n && gScore) return;
  capacity = n;
  gScore = new Float32Array(n);
  cameFrom = new Int32Array(n);
  visitMark = new Int32Array(n);
  visitEpoch = 0;
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, 1.4142],
  [1, -1, 1.4142],
  [-1, 1, 1.4142],
  [-1, -1, 1.4142],
];

export interface PathOptions {
  /** Extra tiles treated as walkable even if blocked (e.g. the villager's own start tile). */
  allow?: Set<number>;
  /** Stop when any of these tiles is reached. */
  goals: { x: number; y: number }[];
  maxNodes?: number;
}

/**
 * Finds a path from (sx,sy) to the nearest goal.
 * Returns tile waypoints excluding the start tile, or null if unreachable.
 */
export function findPath(
  g: GameState,
  sx: number,
  sy: number,
  opts: PathOptions,
): { x: number; y: number }[] | null {
  const w = g.w;
  const h = g.h;
  const n = w * h;
  ensureBuffers(n);
  const gs = gScore!;
  const cf = cameFrom!;
  const vm = visitMark!;
  visitEpoch++;
  const epoch = visitEpoch;

  const goalSet = new Set<number>();
  let gx = 0;
  let gy = 0;
  for (const goal of opts.goals) {
    if (!inBounds(g, goal.x, goal.y)) continue;
    goalSet.add(goal.y * w + goal.x);
    gx += goal.x;
    gy += goal.y;
  }
  if (goalSet.size === 0) return null;
  gx /= goalSet.size;
  gy /= goalSet.size;

  const start = sy * w + sx;
  if (goalSet.has(start)) return [];

  heap.clear();
  gs[start] = 0;
  cf[start] = -1;
  vm[start] = epoch;
  heap.push(start, 0);

  const maxNodes = opts.maxNodes ?? 4000;
  let expanded = 0;
  let found = -1;

  while (heap.size > 0) {
    const cur = heap.pop();
    if (goalSet.has(cur)) {
      found = cur;
      break;
    }
    if (++expanded > maxNodes) break;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    const base = gs[cur];

    for (const [dx, dy, mul] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;

      let speed = tileSpeed(g, nx, ny);
      if (speed <= 0) {
        if (!goalSet.has(ni) && !(opts.allow && opts.allow.has(ni))) continue;
        speed = 0.6; // Reachable but awkward — used for door tiles under a building.
      }
      // Diagonals must not cut through a blocked corner.
      if (dx !== 0 && dy !== 0) {
        if (tileSpeed(g, cx + dx, cy) <= 0 && tileSpeed(g, cx, cy + dy) <= 0) continue;
      }

      const step = (mul / speed) * 1.0;
      const tentative = base + step;
      if (vm[ni] === epoch && gs[ni] <= tentative) continue;
      vm[ni] = epoch;
      gs[ni] = tentative;
      cf[ni] = cur;
      // Heuristic uses the best possible terrain speed so it stays admissible.
      const hCost = (Math.abs(nx - gx) + Math.abs(ny - gy)) * 0.5;
      heap.push(ni, tentative + hCost);
    }
  }

  if (found < 0) return null;

  const out: { x: number; y: number }[] = [];
  let cur = found;
  while (cur !== start && cur >= 0) {
    out.push({ x: cur % w, y: Math.floor(cur / w) });
    cur = cf[cur];
    if (out.length > n) break;
  }
  out.reverse();
  return out;
}

/** Walkable tiles orthogonally/diagonally touching a footprint — where villagers stand to work. */
export function footprintApproach(
  g: GameState,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let ty = y - 1; ty <= y + h; ty++) {
    for (let tx = x - 1; tx <= x + w; tx++) {
      const inside = tx >= x && tx < x + w && ty >= y && ty < y + h;
      if (inside) continue;
      if (!inBounds(g, tx, ty)) continue;
      if (tileSpeed(g, tx, ty) <= 0) continue;
      out.push({ x: tx, y: ty });
    }
  }
  return out;
}
