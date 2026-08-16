/**
 * Headless simulation harness. Runs the kingdom without any rendering and
 * reports what actually happened, so the economy can be checked and balanced
 * without staring at the screen for an hour.
 *
 *   npx tsx scripts/simcheck.ts [gameMinutes] [seed]
 *
 * The seed is fixed by default so two runs are comparable — and, now that the
 * gameplay RNG starts from the world rather than the clock, genuinely identical.
 * Pass one to see whether a conclusion holds on a different island.
 */

import { newGame, assignJob, buildingById, makeBuilding, storageCapacity } from '../src/sim/state';
import { completeConstruction, updateVillagers } from '../src/sim/villager';
import { updateWildlife } from '../src/sim/wildlife';
import { updatePopulation } from '../src/sim/population';
import { availableToBuild, updateGoals } from '../src/sim/goals';
import { chooseCamp, suggestCamp } from '../src/sim/founding';
import { updateTerrain, tileAt } from '../src/world/terrain';
import { BUILDINGS, CARRY_CAPACITY, DAY_LENGTH, SPECIES, upgradeCostOf, upgradeReqsOf } from '../src/sim/defs';
import { rng } from '../src/core/util';
import type { Building, BuildingId, GameState } from '../src/types';
import { seasonForDay } from '../src/sim/state';
import { serialize } from '../src/save/save';
import { writeFileSync } from 'node:fs';

const minutes = Number(process.argv[2] ?? 90);
const g = newGame(Number(process.argv[3] ?? 12345));

function place(def: BuildingId, x: number, y: number): boolean {
  const d = BUILDINGS[def];
  for (let dy = 0; dy < d.h; dy++)
    for (let dx = 0; dx < d.w; dx++) {
      const t = tileAt(g, x + dx, y + dy);
      if (!t) return false;
      if (t.terrain === 'water' || t.terrain === 'shallow') return false;
      if (t.building || t.plot) return false;
    }
  const b = makeBuilding(g, def, x, y, rng);
  b.stage = 'building';
  g.buildings.push(b);
  for (let dy = 0; dy < d.h; dy++)
    for (let dx = 0; dx < d.w; dx++) {
      const t = tileAt(g, x + dx, y + dy)!;
      t.building = b.id;
      if (d.solid) t.blocked = true;
      t.prop = null;
      t.amount = 0;
    }
  if (d.labour <= 0 && Object.keys(d.cost).length === 0) completeConstruction(g, b);
  return true;
}

/** Finds somewhere the given footprint fits, spiralling out from the commons. */
function findSpot(def: BuildingId, near: { x: number; y: number }, minR = 3, maxR = 16): { x: number; y: number } | null {
  const d = BUILDINGS[def];
  for (let r = minR; r < maxR; r++) {
    for (let a = 0; a < 40; a++) {
      const ang = (a / 40) * Math.PI * 2;
      const x = Math.round(near.x + Math.cos(ang) * r);
      const y = Math.round(near.y + Math.sin(ang) * r);
      let ok = true;
      for (let dy = 0; dy < d.h && ok; dy++)
        for (let dx = 0; dx < d.w; dx++) {
          const t = tileAt(g, x + dx, y + dy);
          if (!t || t.building || t.plot || t.terrain === 'water' || t.terrain === 'shallow') {
            ok = false;
            break;
          }
        }
      if (ok) return { x, y };
    }
  }
  return null;
}

/** Plays the kingdom the way a player would, reacting to what it needs. */
function usedStorage(state: GameState): number {
  return ['wood', 'stone', 'wheat', 'flour', 'bread'].reduce((n, k) => n + state.stock[k as 'wood'], 0);
}

/** Starts an improvement on the least-improved building of a kind, if allowed. */
function improve(state: GameState, def: BuildingId): boolean {
  const d = BUILDINGS[def];
  const candidates = state.buildings
    .filter((b) => b.def === def && b.stage === 'done' && !b.upgrading && b.level < d.maxLevel)
    .sort((a, b) => a.level - b.level);
  for (const b of candidates) {
    // The commons asks for accomplishments as well as materials, and a player
    // cannot click past those either.
    if (upgradeReqsOf(def, b.level).some((r) => !r.met(state))) continue;
    const cost = upgradeCostOf(def, b.level);
    let afford = true;
    for (const k in cost) if (state.stock[k as 'wood'] < (cost[k as 'wood'] ?? 0)) afford = false;
    if (!afford) continue;
    b.upgrading = true;
    b.stage = 'building';
    b.labour = 0;
    b.delivered = {};
    return true;
  }
  return false;
}

function autoplay(state: GameState): void {
  // Founding asks the player for exactly one click: where to begin. Everything
  // after it — felling the tree, raising the camp — the founder does alone.
  if (state.founding.stage !== 'choosing' && state.founding.stage !== 'camp' && state.founding.stage !== 'done') return;
  if (state.founding.stage === 'choosing') {
    const spot = suggestCamp(state);
    chooseCamp(state, spot.x, spot.y);
    return;
  }

  const heart = state.buildings.find((b) => b.def === 'commons') ?? { x: state.founding.x, y: state.founding.y };
  const fire = { x: heart.x + 1, y: heart.y + 1 };
  const has = (def: BuildingId) => state.buildings.some((b) => b.def === def);
  const done = (def: BuildingId) => state.buildings.some((b) => b.def === def && b.stage === 'done');
  const building = state.buildings.some((b) => b.stage === 'building');
  if (building) return;

  const wants: BuildingId[] = [];
  if (!has('cabin')) wants.push('cabin');
  else if (!has('storehouse') && state.unlocked.has('storehouse')) wants.push('storehouse');
  else if (!has('lodge') && state.unlocked.has('lodge')) wants.push('lodge');
  else if (!has('quarry') && state.unlocked.has('quarry')) wants.push('quarry');
  else if (!has('farm') && state.unlocked.has('farm')) wants.push('farm');
  else if (!has('mill') && state.unlocked.has('mill')) wants.push('mill');
  else if (!has('bakery') && state.unlocked.has('bakery')) wants.push('bakery');
  else if (
    state.buildings.filter((b) => b.def === 'storehouse').length < 4 &&
    storageCapacity(state) > 0 &&
    usedStorage(state) > storageCapacity(state) * 0.8
  )
    wants.push('storehouse');
  else {
    const beds = state.buildings
      .filter((b) => b.stage === 'done' && BUILDINGS[b.def].housing)
      .reduce((n, b) => n + (BUILDINGS[b.def].housing![Math.min(b.level, BUILDINGS[b.def].housing!.length) - 1] ?? 0), 0);
    // Improve what stands before laying out more of it — that is what a player
    // does with a building that grows, and it is the only thing that exercises
    // the upgrade path at all.
    if (beds - state.villagers.length < 2 && !improve(state, 'cabin')) wants.push('cabin');
  }
  // Grow the commons whenever the kingdom has earned it. This is the spine of
  // the progression now, so the harness leans on it before anything else — a
  // run that never gets past a Base Camp is a run that never sees a storehouse.
  improve(state, 'commons');

  for (const def of wants) {
    // Play by the same rules the interface enforces: the menu opens a step at a
    // time, so the harness cannot reach for a storehouse before it is offered.
    if (!availableToBuild(state, def)) continue;
    const cost = BUILDINGS[def].cost;
    let afford = true;
    for (const k in cost) if (state.stock[k as 'wood'] < (cost[k as 'wood'] ?? 0)) afford = false;
    if (!afford) continue;
    // Woodcutters want trees; quarries want rock.
    let near = { x: fire.x, y: fire.y };
    if (def === 'lodge' || def === 'quarry') {
      const target = def === 'lodge' ? 'tree' : 'boulder';
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (let y = 0; y < state.h; y++)
        for (let x = 0; x < state.w; x++) {
          if (state.tiles[y * state.w + x].prop !== target) continue;
          const d = (x - fire.x) ** 2 + (y - fire.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { x, y };
          }
        }
      if (best) near = best;
    }
    // Lodges and quarries follow the resource; everything else wants elbow room
    // round the commons rather than crowding the ground people walk through.
    const minR = def === 'lodge' || def === 'quarry' ? 2 : 4;
    const spot = findSpot(def, near, minR);
    if (spot) place(def, spot.x, spot.y);
    break;
  }

  // Staff buildings the way a player would: food chain first, and never let a
  // single trade swallow every free pair of hands.
  const priority: BuildingId[] = ['bakery', 'mill', 'farm', 'lodge', 'quarry'];
  const softCap: Partial<Record<BuildingId, number>> = { lodge: 2, quarry: 2, farm: 2, mill: 1, bakery: 2 };

  for (const def of priority) {
    for (const b of state.buildings) {
      if (b.def !== def || b.stage !== 'done') continue;
      const d = BUILDINGS[b.def];
      if (!d.slots || !d.job) continue;
      const slots = Math.min(d.slots[Math.min(b.level, d.slots.length) - 1], softCap[def] ?? 99);
      while (b.workers.length < slots) {
        // Always keep a third of the kingdom free for hauling and building.
        const helpers = state.villagers.filter((v) => v.workplace === 0);
        if (helpers.length <= Math.max(1, Math.floor(state.villagers.length / 3))) {
          rebalance(state, priority);
          return;
        }
        if (!assignJob(state, helpers[0], b.id)) return;
      }
    }
  }
  rebalance(state, priority);
  void done;
}

/**
 * Moves one pair of hands from the least important staffed post to an empty
 * more important one. Without it the harness fills posts greedily in whatever
 * order they happened to be finished and never looks again — which is how a run
 * ends up with two woodcutters, two hundred flour and nobody at the ovens.
 * Nobody plays like that; a player seeing an idle bakery moves somebody to it.
 */
function rebalance(state: GameState, priority: BuildingId[]): void {
  const rank = (def: BuildingId) => priority.indexOf(def);
  for (const want of state.buildings) {
    if (want.stage !== 'done' || want.workers.length > 0) continue;
    if (!BUILDINGS[want.def].job || rank(want.def) < 0) continue;
    let donor: Building | null = null;
    for (const o of state.buildings) {
      if (o.stage !== 'done' || o.workers.length === 0) continue;
      if (rank(o.def) <= rank(want.def)) continue;
      if (!donor || rank(o.def) > rank(donor.def)) donor = o;
    }
    if (!donor) continue;
    const v = state.villagers.find((x) => x.id === donor!.workers[0]);
    // One move a tick, like somebody actually thinking about it.
    if (v && assignJob(state, v, want.id)) return;
  }
}

const DT = 0.1;
const totalSteps = Math.round((minutes * 60) / DT);
let autoplayTimer = 0;
const marks: string[] = [];
let lastPop = g.villagers.length;

for (let i = 0; i < totalSteps; i++) {
  g.clock += DT;
  g.dayT += DT / DAY_LENGTH;
  while (g.dayT >= 1) {
    g.dayT -= 1;
    g.day++;
    const s = seasonForDay(g.day);
    g.season = s.season;
    g.year = s.year;
  }
  updateVillagers(g, DT);
  updateWildlife(g, DT);
  updatePopulation(g, DT);
  updateTerrain(g, DT);

  if (i % 10 === 0) updateGoals(g);

  autoplayTimer -= DT;
  if (autoplayTimer <= 0) {
    autoplayTimer = 5;
    autoplay(g);
  }
  if (g.villagers.length !== lastPop) {
    marks.push(`  t+${((i * DT) / 60).toFixed(0)}m  population ${g.villagers.length}`);
    lastPop = g.villagers.length;
  }
}

// ---------------------------------------------------------------------------

const line = (s = '') => console.log(s);
line(`\n=== ${minutes} game-minutes simulated (${(minutes / 30).toFixed(1)} kingdom days) ===\n`);
line(`Day ${g.day}, ${g.season} of year ${g.year}   ·   population ${g.villagers.length}`);
line(`Storage ${Object.entries(g.stock).map(([k, v]) => `${k} ${Math.floor(v)}`).join('  ')}   (cap ${storageCapacity(g)})`);
line(`Stats: built ${g.stats.built}  harvested ${g.stats.harvested}  baked ${g.stats.baked}  arrivals ${g.stats.arrivals}`);

line('\nBuildings');
const byDef = new Map<string, { done: number; site: number; levels: number[] }>();
for (const b of g.buildings) {
  const e = byDef.get(b.def) ?? { done: 0, site: 0, levels: [] };
  if (b.stage === 'done') e.done++;
  else e.site++;
  if (b.level > 1) e.levels.push(b.level);
  byDef.set(b.def, e);
}
for (const [def, e] of byDef) {
  const improved = e.levels.length ? `, improved: ${e.levels.sort().map((l) => `L${l}`).join(' ')}` : '';
  line(`  ${def.padEnd(12)} ${e.done} built${e.site ? `, ${e.site} under construction` : ''}${improved}`);
}

line('\nPeople');
for (const v of g.villagers) {
  const xp = Object.entries(v.xp)
    .filter(([, x]) => (x ?? 0) > 0.5)
    .map(([j, x]) => `${j} ${Math.round(x ?? 0)}`)
    .join(', ');
  const home = buildingById(g, v.home);
  line(
    `  ${v.name.padEnd(22)} ${v.job.padEnd(12)} ${v.activity.padEnd(11)} home=${(home?.def ?? 'none').padEnd(11)} ${xp || '—'}`,
  );
}

line(`\nWildlife: ${g.animals.length} about, ${g.discovered.size} kinds discovered`);
for (const e of g.journal.filter((j) => j.icon === '🔭')) line(`  day ${String(e.day).padStart(2)}  ${e.text}`);

line('\nProduction posts');
for (const b of g.buildings) {
  const d = BUILDINGS[b.def];
  if (!d.slots || b.stage !== 'done') continue;
  const io = d.recipe
    ? `  in=${JSON.stringify(b.input)} out=${JSON.stringify(b.output)}`
    : '';
  line(`  ${b.def.padEnd(12)} workers ${b.workers.length}/${d.slots[Math.min(b.level, d.slots.length) - 1]}${io}`);
}

line('\nGoals');
for (const goal of g.goals) line(`  [${goal.done ? 'x' : ' '}] ${goal.title}`);

if (marks.length) {
  line('\nArrivals');
  for (const m of marks) line(m);
}

line('\nJournal');
for (const e of g.journal.slice(-14)) line(`  Y${e.year} ${e.season} d${e.day}  ${e.icon} ${e.text}`);

// Health checks that should never fail.
const problems: string[] = [];
for (const v of g.villagers) {
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) problems.push(`${v.name} has a broken position`);
  if (v.x < 0 || v.y < 0 || v.x >= g.w || v.y >= g.h) problems.push(`${v.name} walked off the map`);
}
// Nothing should ever be standing in a wall or out at sea. Spawning picks a
// tile off a coarse lattice and then jitters it, which is exactly where a
// creature ends up somewhere it could not have walked to.
for (const a of g.animals) {
  const def = SPECIES[a.species];
  const t = tileAt(g, Math.round(a.x), Math.round(a.y));
  if (!t) {
    problems.push(`a ${def.name.toLowerCase()} is off the map at ${a.x.toFixed(1)},${a.y.toFixed(1)}`);
    continue;
  }
  // `blocked` rather than `building`: the complaint is being inside a wall. A
  // rabbit standing in the commons or on a farm plot is standing in the open,
  // which is half of what those places are for.
  if (t.blocked) problems.push(`a ${def.name.toLowerCase()} is inside a building at ${Math.round(a.x)},${Math.round(a.y)}`);
  const swimmer = (def.habitat.water ?? 0) > 0 || (def.habitat.shallow ?? 0) > 0;
  if ((t.terrain === 'water' || t.terrain === 'shallow') && !swimmer) {
    problems.push(`a ${def.name.toLowerCase()} is in the ${t.terrain} at ${Math.round(a.x)},${Math.round(a.y)}`);
  }
}
for (const k in g.stock) {
  const val = g.stock[k as 'wood'];
  if (val < -0.001) problems.push(`negative ${k}: ${val}`);
  if (!Number.isFinite(val)) problems.push(`non-finite ${k}`);
}
const used = ['wood', 'stone', 'wheat', 'flour', 'bread'].reduce((n, k) => n + g.stock[k as 'wood'], 0);
// A full store may be overshot by whatever was already in people's arms — loads
// already carried are always allowed to land. Anything beyond that is a leak.
const inFlight = g.villagers.length * CARRY_CAPACITY;
if (used > storageCapacity(g) + inFlight + 1) {
  problems.push(`storage overflowed: ${Math.round(used)} > ${storageCapacity(g)} (+${inFlight} in flight)`);
}
// The full-store deadlock: the planner will not give a new plan to anybody
// holding goods, so a carrier who has run out of ideas is stuck for good.
// (Founding is exempt: the founder is meant to be holding wood, and holding it
// is the only sensible thing to do while waiting to be told where to camp.)
for (const v of g.villagers) {
  if (v.carrying && v.activity === 'idle' && g.founding.stage === 'done') {
    problems.push(`${v.name} is stuck holding ${Math.round(v.carrying.qty)} ${v.carrying.res}`);
  }
}
const idle = g.villagers.filter((v) => v.activity === 'idle').length;

line(`\nIdle right now: ${idle}/${g.villagers.length}`);
if (process.env.TKM_DUMP) {
  writeFileSync(process.env.TKM_DUMP, JSON.stringify(serialize(g)));
  line(`\nWrote save to ${process.env.TKM_DUMP}`);
}

line(problems.length ? `\nPROBLEMS:\n  ${problems.join('\n  ')}` : '\nNo problems detected.');
line();
