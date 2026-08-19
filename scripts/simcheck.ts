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
  benchOf,
  buildingById,
  carriedOf,
  foodComfort,
  housingCapacity,
  makeBuilding,
  capacityOf,
  contentsOf,
  preparedFood,
  storedOf,
  totalOf,
} from '../src/sim/state';
import { severelyHungry, vibesOf } from '../src/sim/vibes';
import { arrivalEta, arrivalWindow } from '../src/sim/population';
import { completeConstruction, updateVillagers } from '../src/sim/villager';
import { updateWildlife } from '../src/sim/wildlife';
import { updatePopulation } from '../src/sim/population';
import { atBuildLimit, availableToBuild, buildLimit, updateGoals } from '../src/sim/goals';
import { chooseCamp, suggestCamp } from '../src/sim/founding';
import { updateTerrain, fishQuality, nearWater, tileAt, touchesRock } from '../src/world/terrain';
import {
  BUILDINGS,
  CARRY_CAPACITY,
  DAY_LENGTH,
  GOOD_SPOT,
  SCHEDULE,
  SPECIES,
  STORAGE_OVERFLOW,
  buildingName,
  rangeOf,
  relocateCost,
  storesOf,
  upgradeCostOf,
  upgradeReqsOf,
} from '../src/sim/defs';
import { rng } from '../src/core/util';
import type { Building, BuildingId, GameState, ResourceId } from '../src/types';
import { RESOURCE_ORDER } from '../src/types';
import { seasonForDay } from '../src/sim/state';
import { serialize } from '../src/save/save';
import { writeFileSync } from 'node:fs';

const minutes = Number(process.argv[2] ?? 90);
const g = newGame(Number(process.argv[3] ?? 12345));

function place(def: BuildingId, x: number, y: number): boolean {
  const d = BUILDINGS[def];
  // The mine works the ground it stands on, so the harness may no more drop one
  // on a meadow than the player can.
  if (d.needsRock && !touchesRock(g, x, y, d.w, d.h)) return false;
  // …and the hut wants a bank, for the same reason.
  if (d.fishes && !nearWater(g, x, y, d.w, d.h)) return false;
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
      if (ok && d.needsRock && !touchesRock(g, x, y, d.w, d.h)) ok = false;
      // The hut plays by its own placement rule too: dry land, beside water.
      if (ok && d.fishes && !nearWater(g, x, y, d.w, d.h)) ok = false;
      if (ok) return { x, y };
    }
  }
  return null;
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
    for (const k in cost) if (totalOf(state, k as 'wood') < (cost[k as 'wood'] ?? 0)) afford = false;
    if (!afford) continue;
    b.upgrading = true;
    b.stage = 'building';
    b.labour = 0;
    b.delivered = {};
    return true;
  }
  return false;
}

/** How settled the good water inside a hut's reach is, as the panel reports it. */
function averageRest(b: Building): number {
  const d = BUILDINGS[b.def];
  const cx = b.x + (d.w - 1) / 2;
  const cy = b.y + (d.h - 1) / 2;
  const r = rangeOf(b.def, b.level);
  let sum = 0;
  let n = 0;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(g.h - 1, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(g.w - 1, Math.ceil(cx + r)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      if (fishQuality(g, x, y) < GOOD_SPOT) continue;
      sum += g.tiles[y * g.w + x].fish;
      n++;
    }
  return n === 0 ? 1 : sum / n;
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
  for (const k in cost) if (totalOf(state, k as 'wood') < (cost[k as 'wood'] ?? 0)) return false;

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

  /*
   * Staffing first, and never gated on whether something is being built.
   *
   * It used to sit at the foot of this function, after an early return that
   * fires whenever any site is under way — which meant a site the kingdom could
   * not yet pay for froze the whole harness: nobody could be put on the mine,
   * so no stone was cut, so the site stayed unpaid, for the rest of the run.
   * A player looking at a stalled extension does not stand and watch it; they
   * go and put somebody on the thing that makes what it is waiting for.
   */
  staff(state);

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
   * became a standstill — a kingdom saving for a kitchen it had no stone for
   * would not build the mine that would have let anyone cut any, and sat at six
   * people for twenty days. A player looks down the list.
   */
  const wants: BuildingId[] = [];
  const full = beds - state.villagers.length < 1;
  if (full && improve(state, 'cabin')) return; // Started; nothing else this tick.
  if (!has('cabin') || full) wants.push('cabin');
  if (!has('lodge')) wants.push('lodge');
  if (!has('quarry')) wants.push('quarry');
  // Both branches of the food chain, in the order a player meets them: the hut
  // is cheap and quick and comes first, the farm is the one that keeps up later.
  // A run that built only one of them would leave half of this untested.
  if (!has('fishhut')) wants.push('fishhut');
  /*
   * Somewhere to put things, once there is anything worth putting down and
   * anywhere far away to carry it from. A player builds one when a haul starts
   * to feel long, which is exactly the moment both raw-material buildings are
   * standing out at their resources rather than beside the fire.
   *
   * It is deliberately *after* the hut and before the farm: it is a convenience
   * and nothing in the game requires one, so a run that put it ahead of the
   * food chain would be modelling a player this game does not have. What it
   * does buy is coverage — without this line nothing in any harness ever builds
   * one, and a building nothing exercises is a building nobody has checked.
   */
  if (done('lodge') && done('quarry') && !has('storehouse')) wants.push('storehouse');
  if (!has('farm')) wants.push('farm');
  if (!has('mill')) wants.push('mill');
  if (!has('kitchen')) wants.push('kitchen');
  if (!has('forge')) wants.push('forge');
  if (beds - state.villagers.length < 2 && !improve(state, 'cabin')) wants.push('cabin');
  /*
   * Once bread is coming out of an oven a player starts making the place nice,
   * and now that comforts are what the kingdom's Vibes are made of, that is a
   * decision about how fast anybody else arrives. It is also the only thing
   * that exercises the flat build limits and the decoration half of the meter,
   * both of which would otherwise never be touched by a run.
   */
  if (done('kitchen')) {
    for (const def of ['bench', 'flowerbed', 'lantern', 'well', 'statue'] as BuildingId[]) wants.push(def);
  }
  // Grow the commons whenever the kingdom has earned it. This is the spine of
  // the progression now, so the harness leans on it before anything else — a
  // run that never gets past a Base Camp is a run that never sees a Well.
  improve(state, 'commons');
  // And sink the mine deeper whenever the kingdom has earned it. It is the other
  // ladder in the game, and a run that never gets past a Quarry is a run that
  // never sees iron, a forge or a single bar.
  improve(state, 'quarry');
  considerMove(state);

  /*
   * Improving whatever has run out of room. This is the storage half of the
   * game as a player now meets it: there is no barn to extend, so a full
   * woodpile is a reason to improve the *lodge*, and a full larder a reason to
   * improve the *kitchen*. Without it the harness would let a compartment sit
   * at its ceiling for twenty days with the fix one click away.
   */
  for (const b of state.buildings) {
    if (b.stage !== 'done' || b.upgrading) continue;
    const room = storesOf(b.def, b.level, b.cacheRetired);
    const tight = (Object.keys(room) as ResourceId[]).some(
      (res) => (room[res] ?? 0) > 0 && (b.store[res] ?? 0) > (room[res] ?? 0) * 0.85,
    );
    if (tight && improve(state, b.def)) break;
  }

  for (const def of wants) {
    // Play by the same rules the interface enforces: the menu opens a step at a
    // time, and the kingdom keeps only so many of each kind, so the harness can
    // no more reach for a fifth cabin than the player can.
    if (!availableToBuild(state, def) || atBuildLimit(state, def)) continue;
    const cost = BUILDINGS[def].cost;
    let afford = true;
    for (const k in cost) {
      /*
       * Wood is the one cost a kingdom can always work its way up to, and since
       * General Workers stop hand-felling at the reserve it is now routinely
       * short of what a building wants. A site takes its materials a dozen at a
       * time and the store is topped back up between loads, so a player with
       * thirty-two wood in store and a fifty-wood windmill in mind places the
       * windmill — waiting for the whole cost to sit in the barn at once would
       * be waiting for something that never happens without a lodge.
       *
       * Every other material has to be produced before it can be spent, and
       * waiting is exactly right for those: a site the kingdom cannot pay for
       * is the standstill this list was rewritten to avoid.
       */
      if (k === 'wood') continue;
      if (totalOf(state, k as 'wood') < (cost[k as 'wood'] ?? 0)) afford = false;
    }
    if (!afford) continue;
    // Woodcutters want trees; the mine wants rocky ground under it, which is a
    // terrain now rather than a prop — the boulders lying on it are scenery.
    let near = { x: fire.x, y: fire.y };
    if (def === 'lodge' || def === 'quarry' || def === 'fishhut') {
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (let y = 0; y < state.h; y++)
        for (let x = 0; x < state.w; x++) {
          const t = state.tiles[y * state.w + x];
          // A hut goes for the *good* water rather than the nearest puddle,
          // exactly as a player reading the ring would — otherwise the run
          // never exercises a hut on anything but the sea.
          const wanted =
            def === 'lodge'
              ? t.prop === 'tree'
              : def === 'quarry'
                ? t.terrain === 'rocky'
                : fishQuality(state, x, y) >= GOOD_SPOT;
          if (!wanted) continue;
          const d = (x - fire.x) ** 2 + (y - fire.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { x, y };
          }
        }
      if (best) near = best;
    }
    if (def === 'storehouse') {
      /*
       * Halfway out to whichever raw-material building is the longer walk. That
       * is the only reason to build one, and siting it by the fire — where the
       * commons, the kitchen and everything else already have room — would give
       * the run a storehouse that never took a single load nothing else would
       * have taken, which is a test that passes without testing anything.
       */
      let far: { x: number; y: number } | null = null;
      let farD = 0;
      for (const b of state.buildings) {
        if (b.def !== 'lodge' && b.def !== 'quarry') continue;
        const d = (b.x - fire.x) ** 2 + (b.y - fire.y) ** 2;
        if (d > farD) {
          farD = d;
          far = { x: b.x, y: b.y };
        }
      }
      if (far) near = { x: Math.round((fire.x + far.x) / 2), y: Math.round((fire.y + far.y) / 2) };
    }
    // The four that follow a resource sit as close to it as they can; every-
    // thing else wants elbow room round the commons rather than crowding the
    // ground people walk through.
    const minR = def === 'lodge' || def === 'quarry' || def === 'fishhut' || def === 'storehouse' ? 2 : 4;
    const spot = findSpot(def, near, minR);
    if (spot) place(def, spot.x, spot.y);
    break;
  }

  void done;
}

/*
 * Staff buildings the way a player would: the two raw materials first, then the
 * food chain, and never let a single trade swallow every free pair of hands.
 *
 * The mine leads because stone has exactly one source and every cabin, every
 * commons and half the workshops are waiting on it. The lodge is second now
 * rather than sixth: a General Worker will only ever fell enough to keep
 * thirty-two wood in store, and at half a woodcutter's pace, so an unstaffed
 * lodge is no longer a kingdom that builds slightly slower — it is a kingdom
 * building out of an emergency float. The forge comes last, because nothing is
 * yet waiting on a bar.
 */
const PRIORITY: BuildingId[] = ['quarry', 'lodge', 'kitchen', 'fishhut', 'mill', 'farm', 'forge'];
const SOFT_CAP: Partial<Record<BuildingId, number>> = {
  // One woodcutter early rather than two: wood is now the cost every building
  // shares, so a player puts somebody on the lodge the moment it stands — but
  // putting two there before anybody is fishing is how the harness ends up with
  // a fat woodpile and an empty larder.
  lodge: 1,
  quarry: 2,
  farm: 2,
  mill: 1,
  kitchen: 2,
  // One is what the hut starts with, and one is the point of it: a food chain
  // that wants a single pair of hands. Staffing both slots the moment they
  // exist would test the building and not the trade-off.
  fishhut: 1,
  forge: 1,
};

function staff(state: GameState): void {
  for (const def of PRIORITY) {
    for (const b of state.buildings) {
      if (b.def !== def || b.stage !== 'done') continue;
      const d = BUILDINGS[b.def];
      if (!d.slots || !d.job) continue;
      const slots = Math.min(d.slots[Math.min(b.level, d.slots.length) - 1], SOFT_CAP[def] ?? 99);
      while (b.workers.length < slots) {
        // Always keep a third of the kingdom free for hauling and building.
        const spare = state.villagers.filter((v) => v.workplace === 0);
        if (spare.length <= Math.max(1, Math.floor(state.villagers.length / 3))) {
          rebalance(state, PRIORITY);
          return;
        }
        if (!assignJob(state, spare[0], b.id)) return;
      }
    }
  }
  rebalance(state, PRIORITY);
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

/*
 * What the kingdom is actually doing, hour by hour of its own day.
 *
 * The routine is the one part of the simulation that is invisible in every
 * other line of this report and in the source alike: a schedule that reads
 * perfectly well as six constants can still put everybody in bed through the
 * afternoon, or leave the midday break unattended because plans started before
 * it run straight through. Sampling the whole run and printing it by phase is
 * how "work is the majority of waking activity" and "the kingdom collects
 * itself three times a day" become things somebody can check rather than
 * things somebody intended.
 */
const PHASES = [
  { name: 'night (23:30–05:30)', from: SCHEDULE.bed, to: SCHEDULE.wake },
  { name: 'morning break (05:30–07:00)', from: SCHEDULE.wake, to: SCHEDULE.workStart },
  { name: 'morning work (07:00–12:00)', from: SCHEDULE.workStart, to: SCHEDULE.middayBreak },
  { name: 'midday break (12:00–13:00)', from: SCHEDULE.middayBreak, to: SCHEDULE.workResume },
  { name: 'afternoon work (13:00–21:00)', from: SCHEDULE.workResume, to: SCHEDULE.workEnd },
  { name: 'evening break (21:00–23:30)', from: SCHEDULE.workEnd, to: SCHEDULE.bed },
];
/** Doing the kingdom's work, as against being somewhere pleasant. */
const PRODUCTIVE = new Set(['working', 'hauling', 'building', 'gathering', 'planting', 'harvesting', 'cooking', 'fishing']);
const routine = PHASES.map(() => ({ asleep: 0, productive: 0, eating: 0, about: 0, walking: 0 }));
/** Which stretch of the day a moment falls in. Night is the wrap-around, so it is the default. */
const phaseOf = (t: number): number => {
  for (let i = 1; i < PHASES.length; i++) {
    if (t >= PHASES[i].from && t < PHASES[i].to) return i;
  }
  return 0;
};

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

  // Every five game-seconds is plenty: the shortest thing anybody does is a
  // seven-second meal, and sampling every tick would be sixty thousand reads a
  // kingdom-day for a figure quoted to the nearest per cent.
  if (i % 50 === 0) {
    const bucket = routine[phaseOf(g.dayT)];
    for (const v of g.villagers) {
      if (v.activity === 'sleeping') bucket.asleep++;
      else if (PRODUCTIVE.has(v.activity)) bucket.productive++;
      else if (v.activity === 'eating') bucket.eating++;
      else if (v.activity === 'walking') bucket.walking++;
      else bucket.about++;
    }
  }
}

// ---------------------------------------------------------------------------

const line = (s = '') => console.log(s);
line(`\n=== ${minutes} game-minutes simulated (${(minutes / 30).toFixed(1)} kingdom days) ===\n`);
line(`Day ${g.day}, ${g.season} of year ${g.year}   ·   population ${g.villagers.length}`);
/*
 * Storage, resource by resource and against the room the kingdom has for it.
 * There is no total to print any more and printing one would be inventing it:
 * "1,200 of 4,750" across thirteen compartments is a figure nothing in the game
 * ever computes, and it would hide the only thing worth seeing here, which is
 * whether any one of them has hit its ceiling.
 *
 * What is *stored*, against capacity, since capacity is a fact about
 * compartments and bench supplies and armfuls answer to none of it. The
 * difference between this and what the kingdom owns is printed on its own line
 * below, where it is a fact rather than a distortion.
 */
line(
  'Storage ' +
    RESOURCE_ORDER.map((res) => {
      const held = Math.floor(storedOf(g, res));
      const cap = capacityOf(g, res);
      if (held === 0 && cap === 0) return '';
      return `${res} ${held}/${cap || '—'}${cap > 0 && held >= cap ? ' FULL' : ''}`;
    })
      .filter(Boolean)
      .join('  '),
);
/*
 * …and what is not in a compartment: on a bench waiting to be used, or in
 * somebody's arms. Small, and it should stay small — a kingdom with a great deal
 * in circulation is one whose carriers are walking further than they should.
 */
const loose = RESOURCE_ORDER.map((res) => {
  const bench = Math.floor(benchOf(g, res));
  const carried = Math.floor(carriedOf(g, res));
  return bench + carried > 0 ? `${res} ${bench} on benches, ${carried} carried` : '';
})
  .filter(Boolean)
  .join('   ·   ');
if (loose) line(`In circulation  ${loose}`);
line(
  'Kept at  ' +
    g.buildings
      .filter((b) => b.stage === 'done' && contentsOf(b).length > 0)
      .map((b) => `${buildingName(b.def, b.level)}: ${contentsOf(b).map((c) => `${c.qty} ${c.res}`).join(', ')}`)
      .join('   ·   '),
);
line(
  `Stats: built ${g.stats.built}  harvested ${g.stats.harvested}  baked ${g.stats.baked}` +
    `  caught ${g.stats.caught}  cooked ${g.stats.cooked}` +
    `  mined ${Math.floor(g.stats.mined)}  smelted ${Math.floor(g.stats.smelted)}  arrivals ${g.stats.arrivals}`,
);

/*
 * The two branches of the food chain, side by side. This is the quickest read
 * on whether either of them has quietly become the only one worth having: a run
 * where one column is doing all the work is a run where the other is decoration.
 * The larder line is the balance figure — meals per head against what the
 * kingdom is comfortable holding, which is what the cooks are actually reading.
 */
{
  const hut = g.buildings.find((b) => b.def === 'fishhut');
  const rest = hut ? averageRest(hut) : 1;
  line(
    `\nFood: bread ${Math.floor(totalOf(g, 'bread'))}  cooked fish ${Math.floor(totalOf(g, 'cookedFish'))}` +
      `  ·  raw fish ${Math.floor(totalOf(g, 'fish'))}  flour ${Math.floor(totalOf(g, 'flour'))}  wheat ${Math.floor(totalOf(g, 'wheat'))}`,
  );
  line(
    `Larder ${(preparedFood(g) / Math.max(1, g.villagers.length)).toFixed(1)} meals a head` +
      `  (comfortable is ${(foodComfort(g) / Math.max(1, g.villagers.length)).toFixed(1)})` +
      (hut ? `  ·  hut water ${Math.round(rest * 100)}% settled` : '  ·  no fishing hut'),
  );
}

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
      `  wellbeing ${Math.round(v.wellbeing)}/10${v.preFood ? '  (neutral: nothing cooked yet)' : ''}`,
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
for (const res of RESOURCE_ORDER) {
  const val = totalOf(g, res);
  if (val < -0.001) problems.push(`negative ${res}: ${val}`);
  if (!Number.isFinite(val)) problems.push(`non-finite ${res}`);
}
/*
 * Every compartment separately, because there is no longer a single ceiling to
 * check against — and the ceiling to check against is the *overflow* one rather
 * than the stated capacity, because the stated capacity is a soft cap by
 * design: `homeFor` will put a load into the margin above it when the kingdom
 * has nowhere else at all, and `deliver` has never refused one. Both of those
 * are what stop the full-store deadlock.
 *
 * Past the margin, plus whatever was already in people's arms when it filled,
 * is a leak: something is depositing without having asked anybody for room.
 */
const inFlight = g.villagers.length * CARRY_CAPACITY;
for (const b of g.buildings) {
  const room = storesOf(b.def, b.level, b.cacheRetired);
  for (const k in room) {
    const res = k as ResourceId;
    const held = b.store[res] ?? 0;
    const ceiling = Math.floor((room[res] ?? 0) * STORAGE_OVERFLOW);
    if (held > ceiling + inFlight + 1) {
      problems.push(
        `${buildingName(b.def, b.level)} overflowed ${res}: ${Math.round(held)} > ${ceiling} (+${inFlight} in flight)`,
      );
    }
  }
  // Anything in a compartment the building is not the home of is a leak of a
  // different kind: something has put goods somewhere nothing will ever fetch
  // them from, and they are lost to the kingdom without ever being destroyed.
  //
  // The camp between a lodge opening and the last armful of its founding wood
  // being carried across is the one legitimate case, and it is checked properly
  // below — that it *drains* — rather than merely excused here.
  const draining = b.cacheRetired ? BUILDINGS[b.def].cache ?? {} : {};
  for (const k in b.store) {
    const res = k as ResourceId;
    if ((b.store[res] ?? 0) > 0 && !(room[res] ?? 0) && !(draining[res] ?? 0)) {
      problems.push(`${buildingName(b.def, b.level)} is holding ${Math.round(b.store[res] ?? 0)} ${res}, which it does not keep`);
    }
  }
}

/*
 * The camp's founding woodpile closes when a lodge opens, and the wood in it is
 * carried across rather than teleported — so the thing worth checking is that
 * somebody actually does the carrying. A hundred wood is nine armfuls; a lodge
 * that has stood for a whole day with the camp still holding some means the
 * clearing rung never fired, and the kingdom has wood it cannot reach.
 *
 * A lodge finished this same day is still fair game, hence the day's grace.
 */
for (const b of g.buildings) {
  if (!b.cacheRetired) continue;
  const stuck = (Object.keys(BUILDINGS[b.def].cache ?? {}) as ResourceId[]).find((res) => (b.store[res] ?? 0) > 0);
  if (!stuck) continue;
  const lodge = g.buildings.find((o) => o.def === 'lodge' && o.stage === 'done');
  if (lodge && g.day - lodge.built >= 2) {
    problems.push(
      `${buildingName(b.def, b.level)} still holds ${Math.round(b.store[stuck] ?? 0)} ${stuck} ` +
        `${g.day - lodge.built} days after the lodge opened — nobody is clearing the retired cache`,
    );
  }
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

/*
 * Fish come out of the water and nowhere else, and nothing eats them raw. Both
 * of those are the same kind of rule as stone coming only from a quarry: a
 * kingdom with no hut and fish in the barn means something is handing them out,
 * and cooked fish with no kitchen means the chain has a second ending.
 */
if (!g.buildings.some((b) => b.def === 'fishhut') && g.stats.caught > 0) {
  problems.push(`${g.stats.caught} fish caught in a kingdom with no fishing hut`);
}
if (!g.buildings.some((b) => b.def === 'kitchen') && totalOf(g, 'cookedFish') + totalOf(g, 'bread') > 0) {
  problems.push('cooked food in a kingdom with no kitchen');
}
// The larder is measured against the people who eat out of it, not the barn.
// Runaway food is what the whole comfort rule exists to stop, and it is the one
// balance failure that hides — a kingdom with four hundred loaves looks fine.
{
  const meals = totalOf(g, 'bread') + totalOf(g, 'cookedFish');
  const roof = foodComfort(g) + g.villagers.length * CARRY_CAPACITY;
  if (meals > roof) {
    problems.push(`${Math.floor(meals)} meals for ${g.villagers.length} people (comfortable is ${Math.round(foodComfort(g))})`);
  }
}
// Water is never used up. A spot at the floor is a spot being worked hard; a
// spot below it means something is treating the lake as a node with an amount.
for (let i = 0; i < g.tiles.length; i++) {
  const t = g.tiles[i];
  if (t.fish < -0.001 || t.fish > 1.001) {
    problems.push(`tile ${i % g.w},${Math.floor(i / g.w)} has impossible fish rest ${t.fish.toFixed(2)}`);
    break;
  }
}

// Stone has exactly one source. Any at all in a kingdom with no quarry means
// something is handing it out — a goal reward, a cleared boulder, a helper with
// a chisel — and the whole shape of the early game rests on there being none.
if (!g.buildings.some((b) => b.def === 'quarry') && totalOf(g, 'stone') > 0) {
  problems.push(`${Math.floor(totalOf(g, 'stone'))} stone in a kingdom with no quarry`);
}

/*
 * Everything else out of the ground has exactly one source too, and it is the
 * same building at a particular depth. Ore in a kingdom whose mine is still a
 * quarry, or coal before there is a Deep Mine, means a level gate leaked — and
 * the ladder is the whole of the mid-game.
 */
{
  const mine = g.buildings.find((b) => b.def === 'quarry' && b.stage === 'done');
  const depth = mine?.level ?? 0;
  if (depth < 2 && totalOf(g, 'ironOre') > 0) problems.push(`${Math.floor(totalOf(g, 'ironOre'))} iron ore without an Iron Mine`);
  if (depth < 3 && totalOf(g, 'coal') > 0) problems.push(`${Math.floor(totalOf(g, 'coal'))} coal without a Deep Mine`);
  if (!g.buildings.some((b) => b.def === 'forge') && totalOf(g, 'ironBar') + totalOf(g, 'steelBar') > 0) {
    problems.push('bars in a kingdom with no forge');
  }
}

// Mithril is written down and nothing produces it. If any ever turns up, the
// level-4 gate or the extraction filter has come undone.
if (totalOf(g, 'mithrilOre') > 0 || totalOf(g, 'mithrilBar') > 0) {
  problems.push('mithril exists, and it is not supposed to');
}

// Boulders never come back. A tile holding rubble with a regrow timer on it
// means something is still treating surface rock as a renewable node.
for (const t of g.tiles) {
  if (t.prop === 'pebbles' && t.regrow > 0) {
    problems.push('rubble is counting down to becoming a boulder again');
    break;
  }
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
/*
 * The day, as it was actually lived. Read down the work rows for whether people
 * are working, and across the break rows for whether they are anywhere worth
 * being while they are not.
 */
line('\nThe day as lived (share of villager-time, sampled across the run)');
for (let i = 0; i < PHASES.length; i++) {
  const b = routine[i];
  const n = b.asleep + b.productive + b.eating + b.about + b.walking;
  if (n === 0) continue;
  const pc = (x: number) => `${String(Math.round((x / n) * 100)).padStart(3)}%`;
  line(
    `  ${PHASES[i].name.padEnd(28)} asleep ${pc(b.asleep)}  working ${pc(b.productive)}` +
      `  walking ${pc(b.walking)}  eating ${pc(b.eating)}  about ${pc(b.about)}`,
  );
}
{
  // Underemployment is a state of the planner rather than of the kingdom, so it
  // is only visible here. A large number with food in the store is the sink
  // doing its job; a large number with an empty larder is a kingdom that has
  // run out of things to do *and* things to eat.
  const spare = g.villagers.filter((v) => v.underworkedDay === g.day).length;
  const fed = g.villagers.filter((v) => v.extraMealDay === g.day).length;
  line(`  nothing to do today: ${spare}/${g.villagers.length}   ·   extra meals taken today: ${fed}`);
}

const idle = g.villagers.filter((v) => v.activity === 'idle').length;

line(`\nIdle right now: ${idle}/${g.villagers.length}`);
if (process.env.TKM_DUMP) {
  writeFileSync(process.env.TKM_DUMP, JSON.stringify(serialize(g)));
  line(`\nWrote save to ${process.env.TKM_DUMP}`);
}

line(problems.length ? `\nPROBLEMS:\n  ${problems.join('\n  ')}` : '\nNo problems detected.');
line();
