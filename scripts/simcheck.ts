/**
 * Headless simulation harness. Runs the kingdom without any rendering and
 * reports what actually happened, so the economy can be checked and balanced
 * without staring at the screen for an hour.
 *
 *   npx tsx scripts/simcheck.ts [gameMinutes]
 */

import { newGame, assignJob, buildingById, makeBuilding, storageCapacity } from '../src/sim/state';
import { completeConstruction, updateVillagers } from '../src/sim/villager';
import { updateWildlife } from '../src/sim/wildlife';
import { updatePopulation } from '../src/sim/population';
import { updateGoals } from '../src/sim/goals';
import { chooseCamp, suggestCamp } from '../src/sim/founding';
import { updateTerrain, tileAt } from '../src/world/terrain';
import { BUILDINGS, CARRY_CAPACITY, DAY_LENGTH } from '../src/sim/defs';
import { rng } from '../src/core/util';
import type { BuildingId, GameState } from '../src/types';
import { seasonForDay } from '../src/sim/state';
import { serialize } from '../src/save/save';
import { writeFileSync } from 'node:fs';

const minutes = Number(process.argv[2] ?? 90);
const g = newGame(12345);

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

/** Finds somewhere the given footprint fits, spiralling out from the campfire. */
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

function autoplay(state: GameState): void {
  // The founding sequence: the player's only job is to say where, and then to
  // place the fire and the chest once there is wood for them.
  if (state.founding.stage === 'arriving' || state.founding.stage === 'settling') return;
  if (state.founding.stage === 'choosing') {
    const spot = suggestCamp(state);
    chooseCamp(state, spot.x, spot.y);
    return;
  }

  const fire = state.buildings.find((b) => b.def === 'campfire') ?? { x: state.founding.x, y: state.founding.y };
  const has = (def: BuildingId) => state.buildings.some((b) => b.def === def);
  const done = (def: BuildingId) => state.buildings.some((b) => b.def === def && b.stage === 'done');
  const building = state.buildings.some((b) => b.stage === 'building');
  if (building) return;

  const wants: BuildingId[] = [];
  if (!has('campfire')) wants.push('campfire');
  else if (!has('chest')) wants.push('chest');
  else if (!has('shelter')) wants.push('shelter');
  else if (!has('storehouse')) wants.push('storehouse');
  else if (!has('lodge')) wants.push('lodge');
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
      .reduce((n, b) => n + (BUILDINGS[b.def].housing![Math.min(b.level, 2) - 1] ?? 0), 0);
    if (beds - state.villagers.length < 2) wants.push(state.unlocked.has('cottage') ? 'cottage' : 'shelter');
  }

  for (const def of wants) {
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
    // The fire and the chest go right beside the woodpile; everything else
    // needs elbow room.
    const minR = def === 'campfire' || def === 'chest' ? 1 : def === 'lodge' || def === 'quarry' ? 2 : 3;
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
        if (helpers.length <= Math.max(1, Math.floor(state.villagers.length / 3))) return;
        if (!assignJob(state, helpers[0], b.id)) return;
      }
    }
  }
  void done;
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
const byDef = new Map<string, { done: number; site: number }>();
for (const b of g.buildings) {
  const e = byDef.get(b.def) ?? { done: 0, site: 0 };
  if (b.stage === 'done') e.done++;
  else e.site++;
  byDef.set(b.def, e);
}
for (const [def, e] of byDef) line(`  ${def.padEnd(12)} ${e.done} built${e.site ? `, ${e.site} under construction` : ''}`);

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
for (const v of g.villagers) {
  if (v.carrying && v.activity === 'idle') {
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
