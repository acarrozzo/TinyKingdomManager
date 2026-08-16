/**
 * World-generation harness. Generates thousands of islands and checks that each
 * one is a kingdom somebody could actually start on.
 *
 *   npx tsx scripts/worldcheck.ts [seeds] [firstSeed]
 *
 * The point is the seeds nobody would ever think to try. Map generation leans on
 * random scatter with a give-up guard, and a guard that gives up is not a
 * guarantee: somewhere in the space there is a seed whose noise came out badly
 * and whose founder walks up a beach to an island with no firewood on it. This
 * finds that seed, or says there isn't one.
 *
 * It prints the failing seed and exits non-zero, so the failure is reproducible:
 * `npx tsx scripts/worldcheck.ts 1 <seed>` runs just that world again.
 */

import { generateMap, campSuitable, walkableFrom, MAP_W, MAP_H } from '../src/world/terrain';
import type { PropId, TerrainId, Tile } from '../src/types';

const TERRAINS: TerrainId[] = ['water', 'shallow', 'sand', 'grass', 'meadow', 'forest', 'rocky'];
const PROPS: PropId[] = ['tree', 'stump', 'boulder', 'pebbles', 'branches', 'bush', 'flowers', 'reeds', 'lilypad'];

/** What the opening is owed, whatever the noise did. Mirrors `world/terrain.ts`. */
const WANT_TREES = 55;
const WANT_BOULDERS = 26;
const WANT_DEADFALL = 6;
const REACHABLE_DEADFALL = 2;
const NODE_RADIUS = 14;
const CAMP_RADIUS = 9;
/** The opening should still be a walk rather than a step. */
const MIN_ARRIVAL_DISTANCE = 6;

const count = Number(process.argv[2] ?? 10000);
const first = Number(process.argv[3] ?? 1);
/**
 * Regenerating every world twice doubles the run for one invariant. A slice is
 * enough: determinism is a property of the code, not of a particular seed, so if
 * it is broken this will see it long before the slice runs out.
 */
const DETERMINISM_EVERY = 25;

type World = ReturnType<typeof generateMap>;

/** Every failed invariant for one seed, so one run reports the whole picture. */
function check(seed: number, m: World): string[] {
  const { tiles, w, h } = m;
  const bad: string[] = [];
  const cx = w / 2;
  const cy = h / 2;
  const at = (x: number, y: number): Tile => tiles[y * w + x];

  if (w !== MAP_W || h !== MAP_H) bad.push(`map is ${w}×${h}, expected ${MAP_W}×${MAP_H}`);
  if (tiles.length !== w * h) bad.push(`tile array is ${tiles.length}, expected ${w * h}`);

  // --- every tile is a tile the renderer and the pathfinder can read ---
  let counted = { tree: 0, boulder: 0, branches: 0 };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = at(x, y);
      if (!t) {
        bad.push(`tile ${x},${y} is missing`);
        continue;
      }
      if (!TERRAINS.includes(t.terrain)) bad.push(`tile ${x},${y} has terrain "${t.terrain}"`);
      if (t.prop !== null && !PROPS.includes(t.prop)) bad.push(`tile ${x},${y} has prop "${t.prop}"`);
      if (!Number.isInteger(t.variant) || t.variant < 0 || t.variant > 3) bad.push(`tile ${x},${y} variant ${t.variant}`);
      if (!Number.isFinite(t.amount) || t.amount < 0) bad.push(`tile ${x},${y} amount ${t.amount}`);
      if (t.building !== 0 || t.blocked || t.plot !== 0) bad.push(`tile ${x},${y} starts occupied`);

      // Bounds safety, for the passes that choose a tile rather than sweep the
      // map: deadfall, the guarantees and both founding locations all clamp to
      // the inner rectangle, and a pile on the outer ring means one of them
      // stopped doing that. The terrain scatter is not held to this — a lone
      // tree on a corner of coastline is just what the coast noise did.
      const onRim = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (onRim && t.prop === 'branches') bad.push(`deadfall on the map edge at ${x},${y}`);

      const d = Math.hypot(x - cx, y - cy);
      if (t.prop === 'branches') counted.branches++;
      if (d < NODE_RADIUS) {
        if (t.prop === 'tree') counted.tree++;
        else if (t.prop === 'boulder') counted.boulder++;
      }
    }

  // --- the resources the first hour needs ---
  if (counted.tree < WANT_TREES) bad.push(`${counted.tree} trees within ${NODE_RADIUS}, wanted ${WANT_TREES}`);
  if (counted.boulder < WANT_BOULDERS) bad.push(`${counted.boulder} boulders within ${NODE_RADIUS}, wanted ${WANT_BOULDERS}`);
  if (counted.branches !== WANT_DEADFALL) bad.push(`${counted.branches} deadfall piles, wanted exactly ${WANT_DEADFALL}`);

  // --- somewhere to begin ---
  const s = m.start;
  if (!Number.isInteger(s.x) || !Number.isInteger(s.y)) bad.push(`start ${s.x},${s.y} is not a tile`);
  else if (s.x < 1 || s.y < 1 || s.x >= w - 1 || s.y >= h - 1) bad.push(`start ${s.x},${s.y} is out of bounds`);
  else {
    if (!campSuitable(tiles, w, h, s.x, s.y)) bad.push(`start ${s.x},${s.y} is not somewhere the game would let you camp`);
    if (Math.hypot(s.x - cx, s.y - cy) > CAMP_RADIUS) bad.push(`start ${s.x},${s.y} is outside the camp radius`);
  }

  // --- and everything else on the same piece of land as it ---
  const reach = walkableFrom(tiles, w, h, s.x, s.y);
  if (reach[s.y * w + s.x] !== 1) {
    bad.push(`start ${s.x},${s.y} is not walkable`);
    return bad; // nothing below means anything without it
  }

  const a = m.arrival;
  if (!Number.isInteger(a.x) || !Number.isInteger(a.y)) bad.push(`arrival ${a.x},${a.y} is not a tile`);
  else if (a.x < 1 || a.y < 1 || a.x >= w - 1 || a.y >= h - 1) bad.push(`arrival ${a.x},${a.y} is out of bounds`);
  else {
    const t = at(a.x, a.y);
    if (t.terrain === 'water' || t.terrain === 'shallow') bad.push(`arrival ${a.x},${a.y} is in the sea`);
    if (reach[a.y * w + a.x] !== 1) bad.push(`arrival ${a.x},${a.y} cannot walk to the campsite`);
    if (Math.hypot(a.x - cx, a.y - cy) < MIN_ARRIVAL_DISTANCE) bad.push(`arrival ${a.x},${a.y} is already at the middle`);
  }

  let reachableDeadfall = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (at(x, y).prop === 'branches' && reach[y * w + x] === 1) reachableDeadfall++;
  if (reachableDeadfall < REACHABLE_DEADFALL) {
    bad.push(`${reachableDeadfall} deadfall piles the founder can walk to, wanted ${REACHABLE_DEADFALL}`);
  }

  return bad;
}

/** A cheap order-sensitive digest of everything generation decided. */
function digest(m: World): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h = Math.imul(h ^ (v | 0), 16777619);
  };
  for (const t of m.tiles) {
    mix(TERRAINS.indexOf(t.terrain));
    mix(t.prop ? PROPS.indexOf(t.prop) + 1 : 0);
    mix(t.variant);
    mix(t.amount);
  }
  mix(m.start.x);
  mix(m.start.y);
  mix(m.arrival.x);
  mix(m.arrival.y);
  return h >>> 0;
}

function fail(seed: number, problems: string[]): never {
  console.error(`\n✗ seed ${seed}`);
  for (const p of problems) console.error(`    ${p}`);
  console.error(`\nReproduce with: npx tsx scripts/worldcheck.ts 1 ${seed}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------

console.log(`Checking ${count} worlds from seed ${first}…`);
const started = Date.now();

// Counts worth seeing even when everything passes: an island that only ever
// scrapes the minimum is one bad tuning change away from failing.
const stats = { trees: [Infinity, 0], boulders: [Infinity, 0], reachable: [Infinity, 0], deadfallD: [Infinity, 0] };

for (let i = 0; i < count; i++) {
  const seed = first + i;
  const m = generateMap(seed);

  const problems = check(seed, m);
  if (problems.length) fail(seed, problems);

  if (i % DETERMINISM_EVERY === 0) {
    const again = generateMap(seed);
    if (digest(m) !== digest(again)) fail(seed, ['the same seed generated two different worlds']);
    // And a neighbouring seed must not: the salts are derived per seed, so
    // adjacent seeds sharing a world would mean the derivation collapsed.
    if (digest(m) === digest(generateMap(seed + 1))) fail(seed, [`seed ${seed} and ${seed + 1} generated the same world`]);
  }

  const cx = m.w / 2;
  const cy = m.h / 2;
  const reach = walkableFrom(m.tiles, m.w, m.h, m.start.x, m.start.y);
  let trees = 0;
  let boulders = 0;
  let reachable = 0;
  let nearestDeadfall = Infinity;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      const t = m.tiles[y * m.w + x];
      const d = Math.hypot(x - cx, y - cy);
      if (d < NODE_RADIUS && t.prop === 'tree') trees++;
      if (d < NODE_RADIUS && t.prop === 'boulder') boulders++;
      if (t.prop === 'branches' && reach[y * m.w + x] === 1) {
        reachable++;
        nearestDeadfall = Math.min(nearestDeadfall, Math.hypot(x - m.start.x, y - m.start.y));
      }
    }
  const note = (slot: number[], v: number) => {
    slot[0] = Math.min(slot[0], v);
    slot[1] = Math.max(slot[1], v);
  };
  note(stats.trees, trees);
  note(stats.boulders, boulders);
  note(stats.reachable, reachable);
  note(stats.deadfallD, nearestDeadfall);

  if (i > 0 && i % 2000 === 0) console.log(`  …${i}`);
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n✓ ${count} worlds, all sound (${secs}s)`);
console.log(`  trees within ${NODE_RADIUS}        ${stats.trees[0]}–${stats.trees[1]}`);
console.log(`  boulders within ${NODE_RADIUS}     ${stats.boulders[0]}–${stats.boulders[1]}`);
console.log(`  deadfall the founder can reach  ${stats.reachable[0]}–${stats.reachable[1]} of ${WANT_DEADFALL}`);
console.log(`  walk to the nearest pile        ${stats.deadfallD[0].toFixed(1)}–${stats.deadfallD[1].toFixed(1)} tiles`);
