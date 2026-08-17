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

import {
  newGame,
  assignJob,
  bedSources,
  bedsFree,
  buildingById,
  housingCapacity,
  makeBuilding,
  storageCapacity,
} from '../src/sim/state';
import { severelyHungry, vibesOf } from '../src/sim/vibes';
import { arrivalEta, arrivalWindow } from '../src/sim/population';
import { completeConstruction, updateVillagers } from '../src/sim/villager';
import { updateWildlife } from '../src/sim/wildlife';
import { updatePopulation } from '../src/sim/population';
import { atBuildLimit, availableToBuild, buildLimit, updateGoals } from '../src/sim/goals';
import { chooseCamp, suggestCamp } from '../src/sim/founding';
import { updateTerrain, tileAt } from '../src/world/terrain';
import {
  BUILDINGS,
  CARRY_CAPACITY,
  DAY_LENGTH,
  SPECIES,
  rangeOf,
  relocateCost,
  upgradeCostOf,
  upgradeReqsOf,
} from '../src/sim/defs';
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

/** Live nodes of a building's kind within the reach it actually works to. */
function nodesInRange(state: GameState, def: BuildingId, level: number, x: number, y: number): number {
  const d = BUILDINGS[def];
  if (!d.harvests) return 0;
  const cx = x + (d.w - 1) / 2;
  const cy = y + (d.h - 1) / 2;
  const r = rangeOf(def, level);
  let n = 0;
  for (let ty = Math.max(0, Math.floor(cy - r)); ty <= Math.min(state.h - 1, Math.ceil(cy + r)); ty++)
    for (let tx = Math.max(0, Math.floor(cx - r)); tx <= Math.min(state.w - 1, Math.ceil(cx + r)); tx++) {
      const t = state.tiles[ty * state.w + tx];
      if (t.prop !== d.harvests || t.amount <= 0) continue;
      if ((tx - cx) ** 2 + (ty - cy) ** 2 > r * r) continue;
      n++;
    }
  return n;
}

/**
 * Moves a unique building the way the interface does: a plain construction site
 * on the new ground, the original left running until it is finished. Exercising
 * this here matters because a relocation is the only thing in the game that
 * changes a finished building's coordinates, and the ways it can go wrong —
 * tiles left claimed by a building that is no longer there, two buildings on
 * one tile, workers pointing at nothing — are all things a static read will not
 * catch and the consistency checks below will.
 */
function moveTo(state: GameState, b: Building, x: number, y: number): boolean {
  const d = BUILDINGS[b.def];
  for (let dy = 0; dy < d.h; dy++)
    for (let dx = 0; dx < d.w; dx++) {
      const t = tileAt(state, x + dx, y + dy);
      if (!t || t.building || t.plot) return false;
      if (t.terrain === 'water' || t.terrain === 'shallow') return false;
    }
  const cost = relocateCost(b.def);
  for (const k in cost) if (state.stock[k as 'wood'] < (cost[k as 'wood'] ?? 0)) return false;

  const site = makeBuilding(state, b.def, x, y, rng);
  site.stage = 'building';
  site.relocOf = b.id;
  b.movingTo = site.id;
  state.buildings.push(site);
  for (let dy = 0; dy < d.h; dy++)
    for (let dx = 0; dx < d.w; dx++) {
      const t = tileAt(state, x + dx, y + dy)!;
      t.building = site.id;
      if (d.solid) t.blocked = true;
      t.prop = null;
      t.amount = 0;
    }
  return true;
}

/**
 * A lodge or quarry that has worked its ground out gets moved rather than
 * duplicated — the whole point of there being one of each. Only when the reach
 * is genuinely empty, which is what a player would wait for too.
 */
function considerMove(state: GameState): void {
  for (const b of state.buildings) {
    const d = BUILDINGS[b.def];
    if (!d.unique || !d.harvests || b.stage !== 'done' || b.upgrading || b.movingTo) continue;
    if (nodesInRange(state, b.def, b.level, b.x, b.y) > 0) continue;

    let best: { x: number; y: number; n: number } | null = null;
    for (let y = 1; y < state.h - d.h; y += 2)
      for (let x = 1; x < state.w - d.w; x += 2) {
        const n = nodesInRange(state, b.def, b.level, x, y);
        if (n < 10 || (best && n <= best.n)) continue;
        best = { x, y, n };
      }
    if (best && moveTo(state, b, best.x, best.y)) return;
  }
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

  const beds = state.buildings
    .filter((b) => b.stage === 'done' && BUILDINGS[b.def].housing)
    .reduce((n, b) => n + (BUILDINGS[b.def].housing![Math.min(b.level, BUILDINGS[b.def].housing!.length) - 1] ?? 0), 0);

  /*
   * Housing comes off the top rather than off the end of the chain. It used to
   * be the last thing considered, which was fine while the chain was cheap:
   * now that stone is quarry-only, a kingdom saving up for a bakery it cannot
   * yet afford would sit there for twenty days with nowhere for anybody to
   * sleep and never reach the line that would have fixed it. A player looking
   * at a full kingdom builds a bed, whatever else is on the list.
   *
   * Improving a cabin comes before laying out another, which is both what a
   * player does with a building that grows and the only thing that exercises
   * the upgrade path at all — and, with the count limited, usually the only
   * thing allowed.
   */
  /*
   * A list in order of preference rather than a single choice, and that is not
   * a tidying-up: the chain used to pick one thing and, if the kingdom could
   * not afford it, do nothing whatever. With stone gated behind a quarry that
   * became a standstill — a kingdom saving for a bakery it had no stone for
   * would not build the storehouse that would have let anyone gather any, and
   * sat at six people for twenty days. A player looks down the list.
   */
  const wants: BuildingId[] = [];
  const full = beds - state.villagers.length < 1;
  const cramped = storageCapacity(state) > 0 && usedStorage(state) > storageCapacity(state) * 0.8;
  if (full && improve(state, 'cabin')) return; // Started; nothing else this tick.
  if (!has('cabin') || full) wants.push('cabin');
  if (cramped) wants.push('storehouse');
  if (!has('storehouse')) wants.push('storehouse');
  if (!has('lodge')) wants.push('lodge');
  if (!has('quarry')) wants.push('quarry');
  if (!has('farm')) wants.push('farm');
  if (!has('mill')) wants.push('mill');
  if (!has('bakery')) wants.push('bakery');
  if (beds - state.villagers.length < 2 && !improve(state, 'cabin')) wants.push('cabin');
  /*
   * Once bread is coming out of an oven a player starts making the place nice,
   * and now that comforts are what the kingdom's Vibes are made of, that is a
   * decision about how fast anybody else arrives. It is also the only thing
   * that exercises the flat build limits and the decoration half of the meter,
   * both of which would otherwise never be touched by a run.
   */
  if (done('bakery')) {
    for (const def of ['bench', 'flowerbed', 'lantern', 'well', 'statue'] as BuildingId[]) wants.push(def);
  }
  // Grow the commons whenever the kingdom has earned it. This is the spine of
  // the progression now, so the harness leans on it before anything else — a
  // run that never gets past a Base Camp is a run that never sees a storehouse.
  improve(state, 'commons');
  considerMove(state);

  // Improving a storehouse is what a player does when they are allowed only so
  // many of them. Without this the harness asks for a fifth storehouse it can
  // never have and the kingdom quietly runs out of room instead.
  if (atBuildLimit(state, 'storehouse') && usedStorage(state) > storageCapacity(state) * 0.75) {
    improve(state, 'storehouse');
  }

  for (const def of wants) {
    // Play by the same rules the interface enforces: the menu opens a step at a
    // time, and the kingdom keeps only so many of each kind, so the harness can
    // no more reach for a fifth storehouse than the player can.
    if (!availableToBuild(state, def) || atBuildLimit(state, def)) continue;
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
  //
  // The quarry outranks the lodge, and that is not a preference but the shape
  // of the economy: any helper with nothing better to do will fell a tree, and
  // no helper can break a boulder, so an unstaffed lodge costs the kingdom some
  // speed while an unstaffed quarry costs it stone altogether — and stone is
  // what every cabin, every commons and half the workshops are waiting on.
  const priority: BuildingId[] = ['bakery', 'mill', 'farm', 'quarry', 'lodge'];
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

/*
 * People and Vibes. Beds are the only cap there is, and Vibes are the only
 * thing deciding how fast an empty one fills, so a run that ends short of the
 * population it should have reached is answered by exactly these two blocks —
 * either the kingdom never built the beds or it never made itself worth
 * walking to.
 */
{
  const v = vibesOf(g);
  const window = arrivalWindow(g.villagers.length);
  const eta = arrivalEta(g);
  line(
    `\nPeople ${g.villagers.length}/${housingCapacity(g)} beds` +
      ` (${bedSources(g).map((r) => `${r.label} ${r.beds}`).join(', ') || 'none'})`,
  );
  line(
    `Vibes ${v.total}/100 — ${v.band}   decor ${Math.round(v.decor)}/60  food ${Math.round(v.food)}/30` +
      `  wellbeing ${Math.round(v.wellbeing)}/10${v.preBread ? '  (neutral: nothing baked yet)' : ''}`,
  );
  line(
    `Arrival window at this population ${window.min / 60}–${window.max / 60} game-min` +
      (eta
        ? `, next in roughly ${Math.floor(eta.lo / 60)}–${Math.ceil(eta.hi / 60)}`
        : ', nobody on the way — every bed is taken'),
  );
  line(`Severely hungry: ${severelyHungry(g)}`);
}

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

// Stone has exactly one source. Any at all in a kingdom with no quarry means
// something is handing it out — a goal reward, a cleared boulder, a helper with
// a chisel — and the whole shape of the early game rests on there being none.
if (!g.buildings.some((b) => b.def === 'quarry') && g.stock.stone > 0) {
  problems.push(`${Math.floor(g.stock.stone)} stone in a kingdom with no quarry`);
}

/*
 * Beds are the population cap and the only one. Nothing in the harness takes
 * housing down, so more people than beds here means somebody arrived through a
 * door that should have been shut — and since nobody is ever asked to leave,
 * an over-full kingdom is a state it could never get out of.
 */
if (bedsFree(g) < 0) {
  problems.push(`${g.villagers.length} people in ${housingCapacity(g)} beds`);
}
{
  const v = vibesOf(g);
  if (v.total < 0 || v.total > 100) problems.push(`Vibes out of range: ${v.total}`);
  if (v.decor > 60) problems.push(`decorations worth ${v.decor} Vibes, over the 60 they cap at`);
}

// Never more of a kind than the commons allows. The build menu refuses it and
// so does placement, so a count over the line means something bypassed both.
for (const id of Object.keys(BUILDINGS) as BuildingId[]) {
  const { built, max } = buildLimit(g, id);
  if (built > max) problems.push(`${built} ${id}, but only ${max} allowed`);
}

/*
 * Relocation leaves two records pointing at each other, and every way it can go
 * wrong is a way the map and the building list stop agreeing: a footprint whose
 * tiles belong to somebody else, a site whose original was taken down, or a
 * building that thinks it is moving to nowhere.
 */
for (const b of g.buildings) {
  const d = BUILDINGS[b.def];
  for (let dy = 0; dy < d.h; dy++)
    for (let dx = 0; dx < d.w; dx++) {
      const t = tileAt(g, b.x + dx, b.y + dy);
      if (!t) {
        problems.push(`${b.def} #${b.id} hangs off the map at ${b.x},${b.y}`);
        continue;
      }
      if (t.building !== b.id) {
        problems.push(`tile ${b.x + dx},${b.y + dy} under ${b.def} #${b.id} is owned by #${t.building}`);
      }
    }
  if (b.movingTo && !buildingById(g, b.movingTo)) problems.push(`${b.def} #${b.id} is moving to nothing`);
  if (b.relocOf && !buildingById(g, b.relocOf)) problems.push(`a ${b.def} site is standing in for nothing`);
  if (b.movingTo && b.relocOf) problems.push(`${b.def} #${b.id} is both moving and being moved to`);
}
// Tiles must not claim a building that has gone: a footprint left behind is
// ground nothing can ever be built on again.
for (let i = 0; i < g.tiles.length; i++) {
  const id = g.tiles[i].building;
  if (id && !buildingById(g, id)) {
    problems.push(`tile ${i % g.w},${Math.floor(i / g.w)} still belongs to removed building #${id}`);
    break;
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
