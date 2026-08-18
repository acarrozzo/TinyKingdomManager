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

import {
  generateMap,
  campSuitable,
  fishSpotsInRange,
  nearWater,
  rockInRange,
  touchesRock,
  walkableFrom,
  MAP_W,
  MAP_H,
} from '../src/world/terrain';
import type { PropId, TerrainId, Tile } from '../src/types';

const TERRAINS: TerrainId[] = ['water', 'shallow', 'sand', 'grass', 'meadow', 'forest', 'rocky'];
const PROPS: PropId[] = ['tree', 'stump', 'boulder', 'pebbles', 'bush', 'flowers', 'reeds', 'lilypad'];

/** What the opening is owed, whatever the noise did. Mirrors `world/terrain.ts`. */
const WANT_TREES = 55;
const WANT_BOULDERS = 26;
/** Trees the founder can walk to, and how far counts as walking to one. */
const WANT_NEAR_TREES = 4;
const NEAR_TREE_RADIUS = 9;
/**
 * Legal three-by-three campsites within the radius. One would satisfy the code
 * and make a liar of the interface, which calls this a choice.
 */
const WANT_CAMPSITES = 6;
const NODE_RADIUS = 14;
const CAMP_RADIUS = 9;
/** The opening should still be a walk rather than a step. */
const MIN_ARRIVAL_DISTANCE = 6;
/**
 * Somewhere a quarry could actually go, and enough of them to be a choice.
 *
 * This one earns its place. Stone now comes from a quarry and from nowhere
 * else, the kingdom is allowed exactly one, and the quarry has to sit on or
 * against rocky ground — so a world whose rock is all on an islet across the
 * water, or all under the pond, is a world with no stone in it at all. That is
 * not a hard start, it is a kingdom that cannot pass its second commons.
 *
 * The measure is *rocky ground* rather than boulders, because that is what the
 * mine works: boulders are finite scenery now and a site with none of them left
 * is still a perfectly good mine. `WANT_QUARRY_ROCK` is well above the minimum
 * the placement rule enforces, since a site with a single rocky tile beside it
 * is legal but slow, and a choice between three slow sites is not a choice.
 */
const QUARRY_W = 2;
const QUARRY_H = 2;
const QUARRY_RANGE = 13;
const WANT_QUARRY_ROCK = 25;
const WANT_QUARRY_SITES = 3;
/**
 * Somewhere the one Fishing Hut could go, and enough of them to be a choice.
 *
 * The same argument as the quarry, one step gentler. Fishing is optional — a
 * kingdom can live entirely on bread — so an island with no good water is not
 * unplayable the way an island with no rock is. What it *is* is an island where
 * half of what the storehouse unlocked turns out to be a row that cannot be
 * used, and the player has no way of knowing that is the island's fault.
 *
 * The lake and the coast both count, deliberately, because the game counts them
 * both. What is asked for is a site with real water in reach rather than a
 * puddle: `WANT_HUT_SPOTS` is well above the placement rule's own minimum of
 * one, since a hut with a single promising tile is legal and dismal.
 */
const HUT_W = 2;
const HUT_H = 2;
const HUT_RANGE = 10;
const WANT_HUT_SPOTS = 4;
const WANT_HUT_SITES = 3;

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
  let counted = { tree: 0, boulder: 0 };
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

      const d = Math.hypot(x - cx, y - cy);
      if (d < NODE_RADIUS) {
        if (t.prop === 'tree') counted.tree++;
        else if (t.prop === 'boulder') counted.boulder++;
      }
    }

  // --- the resources the first hour needs ---
  if (counted.tree < WANT_TREES) bad.push(`${counted.tree} trees within ${NODE_RADIUS}, wanted ${WANT_TREES}`);
  if (counted.boulder < WANT_BOULDERS) bad.push(`${counted.boulder} boulders within ${NODE_RADIUS}, wanted ${WANT_BOULDERS}`);

  // --- somewhere to begin, and a choice of somewheres ---
  const s = m.start;
  if (!Number.isInteger(s.x) || !Number.isInteger(s.y)) bad.push(`start ${s.x},${s.y} is not a tile`);
  else if (s.x < 2 || s.y < 2 || s.x >= w - 2 || s.y >= h - 2) bad.push(`start ${s.x},${s.y} is out of bounds`);
  else {
    if (!campSuitable(tiles, w, h, s.x, s.y)) bad.push(`start ${s.x},${s.y} is not somewhere the game would let you camp`);
    if (Math.hypot(s.x - cx, s.y - cy) > CAMP_RADIUS) bad.push(`start ${s.x},${s.y} is outside the camp radius`);
  }
  if (countCampsites(tiles, w, h) < WANT_CAMPSITES) {
    bad.push(`${countCampsites(tiles, w, h)} legal campsites, wanted ${WANT_CAMPSITES}`);
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

  // The whole opening is one tree felled by hand, so the founder is owed trees
  // on their own side of the water.
  if (nearTrees(m, reach) < WANT_NEAR_TREES) {
    bad.push(`${nearTrees(m, reach)} trees within ${NEAR_TREE_RADIUS} of the start, wanted ${WANT_NEAR_TREES}`);
  }

  // Somewhere to put the one quarry the kingdom is allowed, on land the founder
  // can walk to, with a seam under it worth cutting into.
  const sites = quarrySites(m, reach);
  if (sites < WANT_QUARRY_SITES) {
    bad.push(
      `${sites} places a quarry could work from (touching rock, ${WANT_QUARRY_ROCK}+ rocky tiles within ${QUARRY_RANGE}), wanted ${WANT_QUARRY_SITES}`,
    );
  }

  // …and somewhere for the other half of the food chain, on the same land.
  const huts = hutSites(m, reach);
  if (huts < WANT_HUT_SITES) {
    bad.push(
      `${huts} places a fishing hut could work from (beside water, ${WANT_HUT_SPOTS}+ good spots within ${HUT_RANGE}), wanted ${WANT_HUT_SITES}`,
    );
  }

  return bad;
}

/**
 * Two-by-two footprints of buildable, reachable ground beside water with enough
 * worth casting into inside a hut's reach. Sampled on a stride for the same
 * reason the quarry is: neighbouring footprints see almost the same water.
 */
function hutSites(m: World, reach: Uint8Array): number {
  const { tiles, w, h } = m;
  let n = 0;
  for (let y = 1; y < h - HUT_H; y += 2)
    for (let x = 1; x < w - HUT_W; x += 2) {
      let ok = true;
      for (let dy = 0; dy < HUT_H && ok; dy++)
        for (let dx = 0; dx < HUT_W; dx++) {
          const t = tiles[(y + dy) * w + (x + dx)];
          if (t.terrain === 'water' || t.terrain === 'shallow' || reach[(y + dy) * w + (x + dx)] !== 1) ok = false;
        }
      if (!ok) continue;
      // The game's own placement rule first, exactly as with the quarry.
      if (!nearWater(m, x, y, HUT_W, HUT_H)) continue;
      const spots = fishSpotsInRange(m, x + (HUT_W - 1) / 2, y + (HUT_H - 1) / 2, HUT_RANGE);
      if (spots.good >= WANT_HUT_SPOTS) n++;
    }
  return n;
}

/** The best water any single legal hut site can reach. Reported, not asserted. */
function bestHut(m: World, reach: Uint8Array): number {
  const { tiles, w, h } = m;
  let best = 0;
  for (let y = 1; y < h - HUT_H; y += 2)
    for (let x = 1; x < w - HUT_W; x += 2) {
      let ok = true;
      for (let dy = 0; dy < HUT_H && ok; dy++)
        for (let dx = 0; dx < HUT_W; dx++) {
          const t = tiles[(y + dy) * w + (x + dx)];
          if (t.terrain === 'water' || t.terrain === 'shallow' || reach[(y + dy) * w + (x + dx)] !== 1) ok = false;
        }
      if (!ok || !nearWater(m, x, y, HUT_W, HUT_H)) continue;
      best = Math.max(best, fishSpotsInRange(m, x + (HUT_W - 1) / 2, y + (HUT_H - 1) / 2, HUT_RANGE).good);
    }
  return best;
}

/**
 * The inland water: everything wet a flood fill from the border cannot reach.
 * Reported rather than asserted, because a lake that has met the sea and become
 * a bay is still perfectly good fishing — but it is worth knowing how often the
 * island ends up without a lake in it at all.
 */
function lakeSize(m: World): number {
  const { tiles, w, h } = m;
  const wet = (i: number) => tiles[i].terrain === 'water' || tiles[i].terrain === 'shallow';
  const sea = new Uint8Array(w * h);
  const queue: number[] = [];
  const push = (i: number) => {
    if (!sea[i] && wet(i)) {
      sea[i] = 1;
      queue.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k];
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        push(ny * w + nx);
      }
  }
  let n = 0;
  for (let i = 0; i < w * h; i++) if (!sea[i] && wet(i)) n++;
  return n;
}

/**
 * Two-by-two footprints of buildable, reachable ground that touch rock and have
 * a worthwhile seam inside a quarry's range. Sampled on a stride rather than
 * every tile: neighbouring footprints see almost the same ground, so checking
 * each one costs a great deal and says almost nothing new — and it is the
 * difference between "somewhere" and "nowhere" that this is for.
 */
function quarrySites(m: World, reach: Uint8Array): number {
  const { tiles, w, h } = m;
  let n = 0;
  for (let y = 1; y < h - QUARRY_H; y += 2)
    for (let x = 1; x < w - QUARRY_W; x += 2) {
      let ok = true;
      for (let dy = 0; dy < QUARRY_H && ok; dy++)
        for (let dx = 0; dx < QUARRY_W; dx++) {
          const t = tiles[(y + dy) * w + (x + dx)];
          if (t.terrain === 'water' || t.terrain === 'shallow' || reach[(y + dy) * w + (x + dx)] !== 1) ok = false;
        }
      if (!ok) continue;
      // The placement rule the game itself enforces comes first: on the rock or
      // right against it. A seam thirteen tiles away is no use if the building
      // may not stand here.
      if (!touchesRock(m, x, y, QUARRY_W, QUARRY_H)) continue;
      if (rockNear(m, x + (QUARRY_W - 1) / 2, y + (QUARRY_H - 1) / 2) >= WANT_QUARRY_ROCK) n++;
    }
  return n;
}

/** The best seam any single legal quarry site can reach. Reported, not asserted. */
function bestQuarry(m: World, reach: Uint8Array): number {
  const { tiles, w, h } = m;
  let best = 0;
  for (let y = 1; y < h - QUARRY_H; y += 2)
    for (let x = 1; x < w - QUARRY_W; x += 2) {
      let ok = true;
      for (let dy = 0; dy < QUARRY_H && ok; dy++)
        for (let dx = 0; dx < QUARRY_W; dx++) {
          const t = tiles[(y + dy) * w + (x + dx)];
          if (t.terrain === 'water' || t.terrain === 'shallow' || reach[(y + dy) * w + (x + dx)] !== 1) ok = false;
        }
      if (ok && touchesRock(m, x, y, QUARRY_W, QUARRY_H)) {
        best = Math.max(best, rockNear(m, x + (QUARRY_W - 1) / 2, y + (QUARRY_H - 1) / 2));
      }
    }
  return best;
}

/** Rocky ground within a quarry's reach of a point, measured as the game does. */
function rockNear(m: World, cx: number, cy: number): number {
  return rockInRange(m, cx, cy, QUARRY_RANGE);
}

/** How many tiles the game would accept as the centre of a camp. */
function countCampsites(tiles: Tile[], w: number, h: number): number {
  const cx = w / 2;
  const cy = h / 2;
  let n = 0;
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      if (Math.hypot(x - cx, y - cy) > CAMP_RADIUS) continue;
      if (campSuitable(tiles, w, h, x, y)) n++;
    }
  return n;
}

/** Standing trees the founder could walk to from where the kingdom starts. */
function nearTrees(m: World, reach: Uint8Array): number {
  let n = 0;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      const t = m.tiles[y * m.w + x];
      if (t.prop !== 'tree' || reach[y * m.w + x] !== 1) continue;
      if (Math.hypot(x - m.start.x, y - m.start.y) < NEAR_TREE_RADIUS) n++;
    }
  return n;
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
const stats = {
  trees: [Infinity, 0],
  boulders: [Infinity, 0],
  near: [Infinity, 0],
  sites: [Infinity, 0],
  treeD: [Infinity, 0],
  quarry: [Infinity, 0],
  quarryBest: [Infinity, 0],
  hut: [Infinity, 0],
  hutBest: [Infinity, 0],
  lake: [Infinity, 0],
};
let bays = 0;

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
  let nearestTree = Infinity;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++) {
      const t = m.tiles[y * m.w + x];
      const d = Math.hypot(x - cx, y - cy);
      if (d < NODE_RADIUS && t.prop === 'tree') trees++;
      if (d < NODE_RADIUS && t.prop === 'boulder') boulders++;
      if (t.prop === 'tree' && reach[y * m.w + x] === 1) {
        nearestTree = Math.min(nearestTree, Math.hypot(x - m.start.x, y - m.start.y));
      }
    }
  const note = (slot: number[], v: number) => {
    slot[0] = Math.min(slot[0], v);
    slot[1] = Math.max(slot[1], v);
  };
  note(stats.trees, trees);
  note(stats.boulders, boulders);
  note(stats.near, nearTrees(m, reach));
  note(stats.sites, countCampsites(m.tiles, m.w, m.h));
  note(stats.treeD, nearestTree);
  note(stats.quarry, quarrySites(m, reach));
  note(stats.quarryBest, bestQuarry(m, reach));
  note(stats.hut, hutSites(m, reach));
  note(stats.hutBest, bestHut(m, reach));
  const lake = lakeSize(m);
  note(stats.lake, lake);
  if (lake < 20) bays++;

  if (i > 0 && i % 2000 === 0) console.log(`  …${i}`);
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n✓ ${count} worlds, all sound (${secs}s)`);
console.log(`  trees within ${NODE_RADIUS}        ${stats.trees[0]}–${stats.trees[1]}`);
console.log(`  boulders within ${NODE_RADIUS}     ${stats.boulders[0]}–${stats.boulders[1]}`);
console.log(`  campsites to choose between      ${stats.sites[0]}–${stats.sites[1]}`);
console.log(`  trees within ${NEAR_TREE_RADIUS} of the start   ${stats.near[0]}–${stats.near[1]}`);
console.log(`  walk to the nearest tree        ${stats.treeD[0].toFixed(1)}–${stats.treeD[1].toFixed(1)} tiles`);
console.log(`  places a quarry could work from ${stats.quarry[0]}–${stats.quarry[1]}`);
console.log(`  rock reachable from the best    ${stats.quarryBest[0]}–${stats.quarryBest[1]}`);
console.log(`  places a hut could work from    ${stats.hut[0]}–${stats.hut[1]}`);
console.log(`  good spots from the best        ${stats.hutBest[0]}–${stats.hutBest[1]}`);
console.log(`  inland lake                     ${stats.lake[0]}–${stats.lake[1]} tiles`);
console.log(`  islands whose lake met the sea  ${bays} of ${count}`);
