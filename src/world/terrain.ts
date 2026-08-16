/** Map generation and tile queries. */

import { RNG, fbm, hash2, clamp, mix32 } from '../core/util';
import type { GameState, PropId, Tile, TerrainId } from '../types';
import { TERRAIN_SPEED } from '../sim/defs';

export const MAP_W = 40;
export const MAP_H = 40;

/** Tree/boulder yields and regrowth pacing, in game seconds. */
export const TREE_WOOD = 18;
export const BOULDER_STONE = 24;
export const TREE_REGROW = 60 * 60 * 1.2;
export const BOULDER_REGROW = 60 * 60 * 2.0;

/**
 * How far from the middle of the island the centre of the Base Camp may be, in
 * tiles. The rule lives here rather than with the founding sequence because map
 * generation has to guarantee that a legal campsite exists at all — a whole
 * three-by-three of it — and that there are trees a founder standing on one
 * could actually walk to. `campProblem` in `sim/founding.ts` owns the *wording*
 * the player reads; this owns the shape.
 */
export const CAMP_RADIUS = 9;

/** Half-width of the camp: the footprint is CAMP_SPAN×CAMP_SPAN around its centre. */
export const CAMP_HALF = 1;
export const CAMP_SPAN = CAMP_HALF * 2 + 1;

/** Trees and boulders the middle of the island owes the player, whatever the noise did. */
const WANT_TREES = 55;
const WANT_BOULDERS = 26;
/** Radius the two counts above are measured over. */
const NODE_RADIUS = 14;
/**
 * The opening is one tree, felled by hand, for one full load of twelve. So the
 * founder is owed trees they can genuinely walk to from where they camp —
 * enough that felling one, or siting the camp on top of another, still leaves
 * the kingdom a first morning's work.
 */
const WANT_NEAR_TREES = 4;
const NEAR_TREE_RADIUS = 9;
/**
 * Ground at the very middle that is kept open whatever the noise did, so there
 * is always somewhere — several somewheres — a three-by-three camp will sit.
 * Comfortably wider than the camp itself: a clearing exactly one camp across
 * would offer the player a single legal tile and call it a choice.
 */
const CLEARING_RADIUS = 3.6;

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
 * One stable salt per noise layer, derived from the whole seed.
 *
 * This used to be `seed & 0xffff` shared by every layer with a small constant
 * added — which threw away sixteen bits of whatever number the player typed and
 * left 65,536 distinguishable islands however large the seed space looked, with
 * the layers of one island only ever a few steps apart in the hash. Each layer
 * now gets its own full 32-bit word, so the space of worlds is the space of
 * seeds. Same seed, same island, as before.
 */
function saltsFor(seed: number) {
  return {
    coast: mix32(seed ^ 0x1b873593),
    forest: mix32(seed ^ 0xcc9e2d51),
    meadow: mix32(seed ^ 0x85ebca6b),
    rock: mix32(seed ^ 0xc2b2ae35),
    pond: mix32(seed ^ 0x27d4eb2f),
    props: mix32(seed ^ 0x165667b1),
    variant: mix32(seed ^ 0x9e3779b1),
  };
}

/**
 * Builds the starting island. The centre is a deliberate clearing so the founder
 * has somewhere obvious to begin; woodland, rock and water sit a short walk away.
 * `start` is that clearing and `arrival` is the beach the founder walks up from,
 * which is deliberately on the far side of a walk rather than next to it.
 *
 * Everything the opening depends on is guaranteed rather than hoped for: the
 * random passes are followed by deterministic top-ups, so a seed whose noise
 * happened to come out badly still gets its wood, its stone, room for a camp,
 * trees within a walk of it, and a beach that connects to the middle of the
 * island on foot.
 */
export function generateMap(seed: number): {
  tiles: Tile[];
  w: number;
  h: number;
  start: { x: number; y: number };
  arrival: { x: number; y: number };
} {
  const r = new RNG(seed);
  const w = MAP_W;
  const h = MAP_H;
  const tiles: Tile[] = new Array(w * h);
  const cx = w / 2;
  const cy = h / 2;
  const S = saltsFor(seed);

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
      const coast = fbm(nx * 0.8, ny * 0.8, 3, S.coast) * 0.22;
      const land = 1 - edge + coast - 0.12;

      let terrain: TerrainId;
      if (land < -0.06) terrain = 'water';
      else if (land < 0.02) terrain = 'shallow';
      else if (land < 0.08) terrain = 'sand';
      else {
        const forestN = fbm(nx * 1.3 + 40, ny * 1.3 - 20, 4, S.forest);
        const meadowN = fbm(nx * 1.1 - 15, ny * 1.1 + 55, 3, S.meadow);
        const rockD = Math.sqrt((x - rockX) ** 2 + (y - rockY) ** 2);
        const clearD = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

        if (rockD < 5.5 + fbm(nx * 3, ny * 3, 2, S.rock) * 3.5) terrain = 'rocky';
        else if (clearD < 5) terrain = 'grass';
        else if (forestN > 0.56) terrain = 'forest';
        else if (meadowN > 0.58) terrain = 'meadow';
        else terrain = 'grass';
      }

      // Pond carved into the land.
      const pondD = Math.sqrt((x - pondX) ** 2 + (y - pondY) ** 2);
      const pondR = 3.4 + fbm(nx * 4, ny * 4, 2, S.pond) * 2.2;
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
      const rr = hash2(x, y, S.props);
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
      t.variant = Math.floor(hash2(x, y, S.variant) * 4);
      if (prop === 'tree') t.amount = TREE_WOOD;
      else if (prop === 'boulder') t.amount = BOULDER_STONE;
    }
  }

  // Open ground at the middle, before anything is counted or placed: the camp
  // needs nine tiles of it and the player needs a choice of where to put them.
  ensureClearing(tiles, w, h, cx, cy);

  // Guarantee a workable amount of nearby wood and stone regardless of noise luck.
  ensureNodes(tiles, w, h, cx, cy, 'tree', WANT_TREES, r, S.variant);
  ensureNodes(tiles, w, h, cx, cy, 'boulder', WANT_BOULDERS, r, S.variant);

  // The campsite has to exist before the first tree can be checked against it:
  // "reachable" means reachable by somebody standing where the kingdom begins.
  const start = findStart(tiles, w, h, cx, cy);
  const reach = walkableFrom(tiles, w, h, start.x, start.y);
  ensureNearTrees(tiles, w, h, start, reach, S.variant);

  return { tiles, w, h, start, arrival: findArrival(tiles, w, h, cx, cy, r, reach) };
}

/**
 * Whether a tile is somewhere a kingdom could begin — meaning the centre of a
 * three-by-three all nine of whose tiles will do. This is the geometry behind
 * `campProblem`, with none of its wording; kept in step with that function by
 * hand, because separating the rule from the sentence the player reads is worth
 * the duplication.
 *
 * Props are not disqualifying. Placing the camp clears whatever was standing on
 * those nine tiles, which is the honest reading of "somewhere to make camp": a
 * clearing is something you make, not something you have to find.
 */
export function campSuitable(tiles: Tile[], w: number, h: number, x: number, y: number): boolean {
  if (x - CAMP_HALF < 1 || y - CAMP_HALF < 1 || x + CAMP_HALF >= w - 1 || y + CAMP_HALF >= h - 1) return false;
  for (let dy = -CAMP_HALF; dy <= CAMP_HALF; dy++)
    for (let dx = -CAMP_HALF; dx <= CAMP_HALF; dx++) {
      const t = tiles[(y + dy) * w + (x + dx)];
      if (t.terrain !== 'grass' && t.terrain !== 'meadow') return false;
      if (t.building) return false;
    }
  return Math.hypot(x - w / 2, y - h / 2) <= CAMP_RADIUS;
}

/**
 * Open ground at the middle of the island, whatever the coast, the rock and the
 * pond noise decided between them. Run after all three so nothing can carve it
 * back out again: the rocky outcrop sits twelve tiles away but can spread nine,
 * and a camp is nine tiles that all have to be grass at once.
 */
function ensureClearing(tiles: Tile[], w: number, h: number, cx: number, cy: number): void {
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (Math.hypot(x - cx, y - cy) >= CLEARING_RADIUS) continue;
      const t = tiles[y * w + x];
      if (t.terrain !== 'grass' && t.terrain !== 'meadow') t.terrain = 'grass';
    }
}

/**
 * Every tile walkable from a starting tile, as a flat boolean map. Generation
 * uses it to keep the beach, the campsite and the first tree on the same
 * piece of land; a lake between the founder and their firewood is not a
 * difficulty to overcome, it is a kingdom that cannot start.
 *
 * Deliberately the loosest possible notion of walkable — terrain only, since at
 * generation time nothing is built and every land prop can be walked around.
 */
export function walkableFrom(tiles: Tile[], w: number, h: number, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  const passable = (x: number, y: number) => (TERRAIN_SPEED[tiles[y * w + x].terrain] ?? 0) > 0;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || !passable(sx, sy)) return seen;

  const queue: number[] = [sy * w + sx];
  seen[sy * w + sx] = 1;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (seen[j] || !passable(nx, ny)) continue;
        seen[j] = 1;
        queue.push(j);
      }
  }
  return seen;
}

/** Ground a given node type is willing to sit on. */
function nodeGround(prop: PropId, terrain: TerrainId): boolean {
  if (prop === 'tree') return terrain === 'grass' || terrain === 'forest' || terrain === 'meadow';
  return terrain === 'rocky' || terrain === 'grass';
}

/** Puts a node down and gives it its cosmetic variant. */
function placeNode(tiles: Tile[], w: number, x: number, y: number, prop: PropId, salt: number): void {
  const t = tiles[y * w + x];
  t.prop = prop;
  t.variant = Math.floor(hash2(x, y, salt) * 4);
  t.amount = prop === 'tree' ? TREE_WOOD : prop === 'boulder' ? BOULDER_STONE : 0;
}

/**
 * Every tile a node of this kind could occupy, nearest the middle first.
 *
 * This is the deterministic half of every guarantee below: the random scatter
 * gets first refusal, and whatever it failed to place is placed from this list
 * instead. A guard that gives up after so many darts is not a guarantee, and
 * the seeds where it gave up were exactly the seeds where the kingdom then had
 * no firewood.
 */
function candidateTiles(
  tiles: Tile[],
  w: number,
  h: number,
  cx: number,
  cy: number,
  prop: PropId,
  minD: number,
  maxD: number,
): { x: number; y: number; d: number }[] {
  const out: { x: number; y: number; d: number }[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const t = tiles[y * w + x];
      if (t.prop || t.building) continue;
      if (!nodeGround(prop, t.terrain)) continue;
      // Half-open at the top, matching how `countProps` measures the same band.
      // A tile at exactly the radius is placeable but uncountable, so a fill
      // that used it would report success one node short of the guarantee.
      const d = Math.hypot(x - cx, y - cy);
      if (d < minD || d >= maxD) continue;
      out.push({ x, y, d });
    }
  // Ties broken by position so the order never depends on scan luck.
  out.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  return out;
}

function countProps(tiles: Tile[], w: number, h: number, cx: number, cy: number, prop: PropId, radius: number): number {
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (tiles[y * w + x].prop === prop && Math.hypot(x - cx, y - cy) < radius) n++;
  return n;
}

/**
 * Trees the founder can genuinely get to. The whole opening is one tree, felled
 * by hand for one load of twelve, so a campsite with its nearest wood across a
 * pond is not a hard start — it is a kingdom that cannot begin.
 *
 * Counted from where the kingdom starts rather than from the middle of the
 * island, and only trees on the same piece of land: `ensureNodes` already put
 * fifty-five within fourteen tiles of the centre, and on a bad seed every one
 * of them can be on the far shore of the pond.
 */
function ensureNearTrees(
  tiles: Tile[],
  w: number,
  h: number,
  start: { x: number; y: number },
  reach: Uint8Array,
  salt: number,
): void {
  let count = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (tiles[y * w + x].prop !== 'tree' || reach[y * w + x] !== 1) continue;
      if (Math.hypot(x - start.x, y - start.y) < NEAR_TREE_RADIUS) count++;
    }
  if (count >= WANT_NEAR_TREES) return;

  // Nearest first, and never inside the camp's own footprint: a tree the
  // founding is about to clear away is not a tree they can fell.
  for (const c of candidateTiles(tiles, w, h, start.x, start.y, 'tree', CAMP_HALF + 1.5, NEAR_TREE_RADIUS)) {
    if (count >= WANT_NEAR_TREES) break;
    if (reach[c.y * w + c.x] !== 1) continue;
    placeNode(tiles, w, c.x, c.y, 'tree', salt);
    count++;
  }
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
  let count = countProps(tiles, w, h, cx, cy, prop, NODE_RADIUS);
  let guard = 0;
  while (count < want && guard++ < 4000) {
    const a = r.range(0, Math.PI * 2);
    const d = r.range(5, NODE_RADIUS);
    const x = Math.round(cx + Math.cos(a) * d);
    const y = Math.round(cy + Math.sin(a) * d);
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
    // Rounding to a tile can carry a dart thrown just inside the radius to a
    // tile just outside it. Placing there is fine; counting it is not, since
    // the count is what the guarantee is measured against.
    if (Math.hypot(x - cx, y - cy) >= NODE_RADIUS) continue;
    const t = tiles[y * w + x];
    if (t.prop) continue;
    if (!nodeGround(prop, t.terrain)) continue;
    placeNode(tiles, w, x, y, prop, salt);
    count++;
  }
  if (count >= want) return;

  // The darts ran out of luck — usually a seed with very little of the right
  // ground near the middle. Fill the rest from the outside in, keeping clear of
  // the founding clearing exactly as the random pass does.
  for (const c of candidateTiles(tiles, w, h, cx, cy, prop, 5, NODE_RADIUS)) {
    if (count >= want) break;
    placeNode(tiles, w, c.x, c.y, prop, salt);
    count++;
  }
}

/**
 * The clearing the founder is walking towards, and the fallback campsite. It has
 * to satisfy the same rule the player's own click does, or the opening can offer
 * a place the game will then refuse.
 */
function findStart(tiles: Tile[], w: number, h: number, cx: number, cy: number): { x: number; y: number } {
  for (let radius = 0; radius <= CAMP_RADIUS; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = Math.round(cx) + dx;
        const y = Math.round(cy) + dy;
        if (campSuitable(tiles, w, h, x, y)) return { x, y };
      }
    }
  }
  // Nothing within the radius passed, which `ensureClearing` should make
  // impossible. Clear the nine tiles at the middle rather than hand back
  // somewhere the player would then be told they cannot camp.
  const x = clamp(Math.round(cx), 1 + CAMP_HALF, w - 2 - CAMP_HALF);
  const y = clamp(Math.round(cy), 1 + CAMP_HALF, h - 2 - CAMP_HALF);
  for (let dy = -CAMP_HALF; dy <= CAMP_HALF; dy++)
    for (let dx = -CAMP_HALF; dx <= CAMP_HALF; dx++) {
      const t = tiles[(y + dy) * w + (x + dx)];
      t.terrain = 'grass';
      t.prop = null;
      t.amount = 0;
    }
  return { x, y };
}

/**
 * Somewhere on the shore to walk up from. Picks a bearing, marches out to the
 * water and comes back to the last dry tile, so the founder starts with the sea
 * behind them and the whole island in front.
 *
 * `reach` is the land the campsite sits on. A beach on an offshore sandbar
 * looks perfectly good from here and leaves the founder unable to walk inland,
 * so every candidate is checked against it — and the fallback is the nearest
 * reachable tile rather than the middle of the map.
 */
function findArrival(
  tiles: Tile[],
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: RNG,
  reach: Uint8Array,
): { x: number; y: number } {
  const ok = (x: number, y: number) => reach[y * w + x] === 1;

  for (let attempt = 0; attempt < 60; attempt++) {
    const a = r.range(0, Math.PI * 2);
    let last: { x: number; y: number } | null = null;
    for (let d = 6; d < Math.max(w, h); d++) {
      const x = Math.round(cx + Math.cos(a) * d);
      const y = Math.round(cy + Math.sin(a) * d);
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) break;
      const t = tiles[y * w + x];
      if (t.terrain === 'water' || t.terrain === 'shallow') break;
      if (!ok(x, y)) break;
      // Prefer standing on the sand itself; failing that, whatever dry ground
      // the coast last offered.
      last = { x, y };
      if (t.terrain === 'sand' && d > 10) return { x, y };
    }
    if (last && Math.hypot(last.x - cx, last.y - cy) > 9) return last;
  }

  // No bearing gave a proper beach. Take the reachable tile furthest out that
  // still leaves a walk worth making, so the opening is still a walk.
  let best: { x: number; y: number } | null = null;
  let bestD = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (!ok(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  return best ?? { x: Math.round(cx), y: Math.round(cy) };
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

/**
 * Nearest tile carrying a live resource node of the given prop, within radius.
 *
 * Genuinely within it. The box is only how the scan is bounded; the distance
 * test is what decides, and it used to be missing — which made a lodge's
 * "thirteen tiles" a *square* thirteen tiles across the middle and eighteen at
 * the corners. That was invisible while nothing drew the range. Now that the
 * player is shown a ring before they commit to a spot, the ring and the reach
 * have to be the same shape or the picture is a lie.
 */
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
  const maxD = radius * radius;
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
      if (d > maxD || d >= bestD) continue;
      bestD = d;
      best = { x, y };
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
        } else if (t.prop === 'pebbles') {
          // Anywhere, not only on rocky ground. Rubble with a timer on it is
          // rubble left by a worked-out boulder, wherever that boulder happened
          // to stand — and generation scatters plenty of them onto grass. The
          // old terrain test quietly made those a one-off, which was survivable
          // while stone could be picked up by hand and is not now that the
          // quarry is the only source there is.
          t.prop = 'boulder';
          t.amount = BOULDER_STONE;
        }
      }
    }
  }
}
