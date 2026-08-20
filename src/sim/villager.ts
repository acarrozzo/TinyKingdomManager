/**
 * Villager simulation: needs, schedule, and the small planner that decides what
 * each person does next. Plans are lists of concrete steps (walk here, work for
 * n seconds, pick this up, put it down) so every economic action is something
 * you can actually watch happen on the map.
 *
 * Plans are transient: they are rebuilt from scratch after a load, so nothing
 * here needs to survive serialisation.
 */

import { RNG, clamp, dist, rng } from '../core/util';
import type { Building, GameState, JobId, PropId, Recipe, ResourceId, Step, Villager } from '../types';
import { PREPARED_FOODS } from '../types';
import {
  BALANCE_TARGET,
  BUILDINGS,
  CARRY_CAPACITY,
  FISH_SEASON,
  FISH_SECONDS,
  FISH_TIRE,
  FISH_YIELD,
  FOOD_CHAIN_HEADROOM,
  FOOD_CHAIN_STAGE,
  FOOD_CHAIN_VALUE,
  HAND_FELL_MUL,
  JOB_META,
  MINE_SECONDS,
  MINE_YIELD,
  PERSONAL_DAY_SHIFT,
  RESOURCE_META,
  SCHEDULE,
  SEVERE_HUNGER,
  TERRAIN_SPEED,
  TRAIT_DAY_SHIFT,
  WOOD_RESERVE,
  buildingName,
  extractsOf,
  liveRecipesOf,
  rangeOf,
  recipeOutput,
  relocateCost,
  relocateLabour,
  richnessMul,
  skillMul,
  upgradeCostOf,
  xpGain,
} from './defs';
import {
  abandonPlan,
  addXp,
  assignHome,
  buildingById,
  buildingCentre,
  claim,
  deliver,
  dropFor,
  foodComfort,
  foodPotential,
  homeCapacity,
  homeFor,
  inputRoom,
  isClaimed,
  preparedFood,
  releaseClaim,
  roomIn,
  sourceOf,
  totalOf,
  withdraw,
  xpOf,
} from './state';
import {
  TREE_REGROW,
  findFishingSpot,
  findNode,
  findRockFace,
  isWalkable,
  rockInRange,
  spotYield,
  tileAt,
  workSpot,
} from '../world/terrain';
import { findPath, footprintApproach } from '../world/path';
import { CHATTER } from './names';
import { unlockCommonsTier, unlockMineTier } from './goals';
import { journal, note, toast } from './journal';
import {
  commonsOf,
  foundingActive,
  foundingSite,
  foundingWoodNeeded,
  markArrived,
  markSettled,
  onFoundingBuild,
  suggestCamp,
  woodShortfall,
} from './founding';

const BASE_SPEED = 1.15; // tiles per second on plain grass
const CHOP_SECONDS = 4.5;
const CHOP_YIELD = 3;
// Field work is deliberately unhurried. A farmer bent over one plot for six
// seconds reads as somebody working a field; the same job in three was a flicker
// nobody ever caught sight of.
const PLANT_SECONDS = 6;
const HARVEST_SECONDS = 6;
const TEND_SECONDS = 5;
// A plot is a small, slow thing now rather than a big, fast one. The kingdom's
// appetite for wheat is the fixed quantity here — twenty people eat about a
// third of a sheaf a minute — so how much of the field is green at any moment is
// entirely a matter of how long one plot takes and how little it gives. Three
// wheat every three minutes meant two dozen plots could feed the kingdom on two
// of them, and the other twenty-two stood bare. One every quarter of an hour
// keeps a quarter of the field under crop and farmers walking about in it.
const HARVEST_YIELD = 1;
/** Sheaves a farmer will gather before walking them to the barn. */
const HARVEST_TRIP = 4;
const PLOT_GROW_SECONDS = 1500;
/**
 * The share of the field that stays under seed whatever the larder says.
 *
 * A farm is not a tap. Left purely to the larder it sowed everything at once and
 * then stood wholly bare for two thirds of the day, which is not what a working
 * farm looks like from a second monitor. A quarter of the plots kept going comes
 * to roughly a quarter of a sheaf a minute — under what the kingdom eats, so it
 * cannot out-produce the appetite it is feeding or crowd the fishing out, and it
 * means there is always something green in the ground and a reason to be in it.
 */
const ALWAYS_SOWN = 1 / 4;
/** What one bout of hoeing is worth, as a fraction of a plot's whole growth. */
const TEND_GROWTH = 0.02;

/** Seasons change how fast wheat comes on. Winter is slow, never fatal. */
const SEASON_GROWTH: Record<string, number> = { spring: 1.1, summer: 1.3, autumn: 0.9, winter: 0.35 };

/**
 * True when the kingdom has enough of this already and the people who make it
 * should go and be useful elsewhere. Production slows rather than jamming,
 * which is the whole idea.
 *
 * This is now *only* about food, and that is the point of the redesign. There
 * used to be a second rule — stop once one material is past a third of the
 * shared store — and it existed to keep a woodcutter from crowding the supper
 * out of a pool they were both in. There is no shared pool: wood at its ceiling
 * says nothing whatever about the larder, so the only reason left to stop is
 * that the compartment in front of you is full, which is a question about a
 * particular building and is asked where the trip is planned.
 *
 * Food stays, because food was never measured against the barn: a kingdom of
 * four with two hundred meals put by has achieved nothing a kingdom of four
 * with forty has not. It is a desired reserve rather than a ceiling, and the
 * kitchen's panel is careful to say so.
 */
export function foodGlut(g: GameState, res: ResourceId): boolean {
  if (FOOD_CHAIN_VALUE[res] === undefined) return false;
  const comfort = foodComfort(g);
  if (PREPARED_FOODS.includes(res)) {
    // Cooked food is judged on its own, and *only* on its own. Measuring it
    // against the whole pipeline instead stops the cooks for having too much
    // to cook, which is the one job that would have fixed it: seed 12345 came
    // out of a twenty-three-day run with seventy raw fish, eighty wheat, no
    // supper at all and nineteen people going hungry in front of it.
    return preparedFood(g) >= comfort;
  }
  // Everything else looks along the chain from its own step, counting what each
  // thing will be worth on a plate. For the farmers and the fishers that is the
  // whole chain, so they ease off together and the cooks stopping does not
  // simply move the pile one step upstream. For the miller it is flour and what
  // flour becomes, and *not* the sheaves in the barn: grinding does not add
  // food, it moves food along, and a mill closed by the wheat it would have
  // ground is a mill that can never open again.
  return foodPotential(g, FOOD_CHAIN_STAGE[res] ?? 0) >= comfort * FOOD_CHAIN_HEADROOM;
}

/**
 * Says once, quietly, that there is nowhere left to put a particular thing —
 * and where. Work does not stop dead; the kingdom simply gathers no more of
 * what it cannot put anywhere, and without a word the player just sees their
 * woodcutters wander off for no reason.
 *
 * Per resource and per building on purpose. "Storage is full" was true of a
 * kingdom-wide pool and is meaningless now: the useful sentence names the
 * material and the place, because between them they are the whole of what the
 * player would have to change.
 */
function noticeFull(g: GameState, res: ResourceId, where: Building | null): void {
  if ((g.fullNotice[res] ?? 0) > 0) return;
  g.fullNotice[res] = 900;
  const what = RESOURCE_META[res].name.toLowerCase();
  const at = where ? `The ${buildingName(where.def, where.level).toLowerCase()}’s ${what} storage is full` : `Nowhere to put ${what}`;
  toast(g, `${at} — nobody is gathering more for now`, '📦', 'warn');
}

export function updateVillagers(g: GameState, dt: number): void {
  for (const k in g.fullNotice) {
    const res = k as ResourceId;
    g.fullNotice[res] = Math.max(0, (g.fullNotice[res] ?? 0) - dt);
  }
  for (const v of g.villagers) updateVillager(g, v, dt);
  growCrops(g, dt);
  sweepDepletedNodes(g);
  updateSplashes(g, dt);
}

// ---------------------------------------------------------------------------
// Fish breaking the surface
// ---------------------------------------------------------------------------

/** How long a ring on the water lasts, in game seconds. */
const SPLASH_LIFE = 1.7;
/** Ambient jumps, somewhere on the water, roughly once a game-minute. */
const AMBIENT_JUMP = 1 / 60;
/**
 * How often a fish landed is a fish *seen*. Deliberately not always: a jump
 * every time would make it a progress bar for the catch rather than a thing
 * that happens in a lake, and the ones that come to nothing are what stop the
 * player reading it as an indicator.
 */
const JUMP_ON_CATCH = 0.45;

/**
 * Something happening on the water. Cosmetic from end to end — nothing reads
 * these back, they are never saved, and the headless run lets them expire with
 * nobody watching.
 */
export function splash(g: GameState, x: number, y: number, jump: boolean): void {
  // A hard ceiling rather than a queue: past a dozen at once nobody could tell
  // them apart anyway, and this is the one list the renderer walks every frame.
  if (g.splashes.length >= 16) return;
  g.splashes.push({ x, y, t: 0, jump });
}

function updateSplashes(g: GameState, dt: number): void {
  let expired = false;
  for (const s of g.splashes) {
    s.t += dt;
    if (s.t >= SPLASH_LIFE) expired = true;
  }
  if (expired) g.splashes = g.splashes.filter((s) => s.t < SPLASH_LIFE);

  // …and once in a while, a fish nobody was fishing for. The lake goes on
  // without the kingdom, which is the whole reason to put one in.
  if (!rng.chance(Math.min(0.5, dt * AMBIENT_JUMP))) return;
  for (let i = 0; i < 8; i++) {
    const x = rng.int(0, g.w - 1);
    const y = rng.int(0, g.h - 1);
    const t = tileAt(g, x, y);
    if (!t || (t.terrain !== 'water' && t.terrain !== 'shallow')) continue;
    // Somewhere a fish would plausibly be, rather than the middle of the ocean.
    if (spotYield(g, x, y) < 0.45) continue;
    splash(g, x, y, true);
    return;
  }
}

function updateVillager(g: GameState, v: Villager, dt: number): void {
  // Needs drift slowly. Neither can harm anyone; they only change behaviour.
  const steadily = v.trait === 'steady' ? 0.7 : 1;
  if (v.activity === 'sleeping') {
    v.energy = clamp(v.energy + dt / 900, 0, 1);
    v.hunger = clamp(v.hunger + dt / 6000, 0, 1);
  } else {
    v.energy = clamp(v.energy - (dt / 4200) * steadily, 0, 1);
    v.hunger = clamp(v.hunger + dt / 2600, 0, 1);
  }

  if (v.say) {
    v.say.ttl -= dt;
    if (v.say.ttl <= 0) v.say = null;
  }
  v.phase += dt;
  if (v.thinkCooldown > 0) v.thinkCooldown -= dt;

  if (v.plan.length === 0) {
    if (v.thinkCooldown > 0) {
      v.activity = 'idle';
      return;
    }
    think(g, v);
    if (v.plan.length === 0) {
      v.thinkCooldown = 0.6 + rng.next() * 1.4;
      v.activity = 'idle';
      return;
    }
  }

  // One tick may retire several instantaneous steps.
  let guard = 0;
  let remaining = dt;
  while (v.plan.length > 0 && guard++ < 16) {
    const consumed = runStep(g, v, remaining);
    if (consumed < 0) break; // step still running
    remaining -= consumed;
    if (remaining <= 0.0001) break;
  }
}

/** Returns seconds consumed, or -1 when the step needs more time. */
function runStep(g: GameState, v: Villager, dt: number): number {
  const step = v.plan[0];
  switch (step.t) {
    case 'move':
      return doMove(g, v, step, dt);
    case 'act':
      return doAct(g, v, step, dt);
    case 'labour':
      return doLabour(g, v, step, dt);
    case 'sleep':
      return doSleep(g, v, dt);
    case 'take':
      doTake(g, v, step);
      v.plan.shift();
      return 0;
    case 'give':
      doGive(g, v, step);
      v.plan.shift();
      return 0;
    case 'effect':
      doEffect(g, v, step);
      v.plan.shift();
      return 0;
    case 'say':
      speak(v, step.text);
      v.plan.shift();
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

function doMove(g: GameState, v: Villager, step: Extract<Step, { t: 'move' }>, dt: number): number {
  if (!v.path) {
    const goals = step.goals ?? [{ x: step.x, y: step.y }];
    const path = findPath(g, Math.round(v.x), Math.round(v.y), { goals });
    if (!path) {
      v.stuck++;
      abandonPlan(g, v);
      v.thinkCooldown = 1.5 + rng.next() * 2.5;
      if (v.stuck > 4) unstick(g, v);
      return 0;
    }
    v.stuck = 0;
    v.path = path;
    v.pathIndex = 0;
    if (path.length === 0) {
      v.path = null;
      v.plan.shift();
      return 0;
    }
  }

  v.activity = v.carrying ? 'hauling' : 'walking';
  let budget = dt;
  let hops = 0;
  while (budget > 0 && hops++ < 10) {
    const wp = v.path[v.pathIndex];
    if (!wp) break;
    const dx = wp.x - v.x;
    const dy = wp.y - v.y;
    const d = Math.hypot(dx, dy);
    const speed = moveSpeed(g, v);

    if (d <= speed * budget || d < 0.0005) {
      v.x = wp.x;
      v.y = wp.y;
      budget -= d / speed;
      v.pathIndex++;
      if (v.pathIndex >= v.path.length) {
        v.path = null;
        v.plan.shift();
        return dt - budget;
      }
    } else {
      v.x += (dx / d) * speed * budget;
      v.y += (dy / d) * speed * budget;
      setFacing(v, dx, dy);
      budget = 0;
    }
  }
  return -1;
}

function moveSpeed(g: GameState, v: Villager): number {
  const t = tileAt(g, Math.round(v.x), Math.round(v.y));
  let mul = t ? TERRAIN_SPEED[t.terrain] ?? 1 : 1;
  if (mul <= 0) mul = 0.5;
  if (v.trait === 'outdoorsy' && mul < 1.2) mul = Math.min(1.2, mul * 1.35);
  if (v.carrying) mul *= 0.92;
  if (v.energy < 0.25) mul *= 0.85;
  return BASE_SPEED * mul;
}

function setFacing(v: Villager, dx: number, dy: number): void {
  if (Math.abs(dx) > Math.abs(dy)) v.face = dx > 0 ? 0 : 2;
  else v.face = dy > 0 ? 1 : 3;
}

function doAct(g: GameState, v: Villager, step: Extract<Step, { t: 'act' }>, dt: number): number {
  if (v.actTotal === 0) {
    v.actTotal = step.dur;
    v.actLeft = step.dur;
  }
  v.activity = step.kind;
  if (step.face !== undefined) v.face = step.face;

  const rate = step.xp ? skillMul(xpOf(v, step.xp)) * traitWorkMul(v, step.xp) : 1;
  const used = Math.min(dt, v.actLeft / rate);
  v.actLeft -= used * rate;
  if (step.xp) addXp(v, step.xp, xpGain(xpOf(v, step.xp), used));

  if (v.actLeft <= 0.0001) {
    v.actTotal = 0;
    v.actLeft = 0;
    v.plan.shift();
    checkMastery(g, v, step.xp);
    return used;
  }
  return -1;
}

function traitWorkMul(v: Villager, job: JobId): number {
  let m = 1;
  if (v.trait === 'greenThumb' && job === 'farmer') m *= 1.2;
  if (v.trait === 'crafty' && (job === 'cook' || job === 'miller')) m *= 1.2;
  if (v.trait === 'steady') m *= 1.06;
  // The same threshold the kingdom's wellbeing is judged on, so "going properly
  // hungry" means one thing whether you read it in the panel or watch it in the
  // work rate. It slows people down and does nothing worse than that.
  if (v.hunger >= SEVERE_HUNGER) m *= 0.78;
  if (v.energy < 0.15) m *= 0.85;
  return m;
}

function checkMastery(g: GameState, v: Villager, job?: JobId): void {
  if (!job) return;
  const xp = xpOf(v, job);
  if (xp < 100) return;
  const key = `master:${v.id}:${job}`;
  if (g.unlocked.has(key)) return;
  g.unlocked.add(key);
  // The trade's own name rather than its id, which is the difference between
  // "Master General Worker" and "Master General".
  const label = JOB_META[job].name;
  journal(g, `${v.name} became a Master ${label}.`, '★');
  note(g, v.id, `Mastered the ${label.toLowerCase()}'s trade.`);
  toast(g, `${v.name} — Master ${label}`, '★', 'good');
}

function doTake(g: GameState, v: Villager, step: Extract<Step, { t: 'take' }>): void {
  // Picking up a second thing while already holding a first. Nothing plans it,
  // but an abandoned plan can leave somebody holding something, and the load
  // they have has to have somewhere to go before this one is picked up — a
  // villager's arms are the one place in the kingdom goods could vanish from.
  const swapping = v.carrying && v.carrying.res !== step.res ? v.carrying : null;
  const swapTo = swapping ? homeFor(g, swapping.res, v.x, v.y) : null;
  if (swapping && !swapTo) return;

  let got = 0;
  if (step.from === 'store') {
    // Always a particular building. The walk to it is already in the plan; if it
    // has gone away in the meantime this simply comes up empty and the planner
    // has another think, which is what it does about every other disappointment.
    const b = buildingById(g, step.id ?? 0);
    if (b) got = withdraw(g, b, step.res, step.qty);
  } else {
    const t = tileAt(g, step.x ?? Math.round(v.x), step.y ?? Math.round(v.y));
    if (t) {
      got = Math.min(t.amount, step.qty);
      t.amount -= got;
    }
  }
  if (got <= 0) return;
  if (v.carrying && v.carrying.res === step.res) v.carrying.qty += got;
  else if (!swapping) v.carrying = { res: step.res, qty: got };
  else {
    deliver(g, swapTo!, swapping.res, swapping.qty);
    v.carrying = { res: step.res, qty: got };
  }
}

function doGive(g: GameState, v: Villager, step: Extract<Step, { t: 'give' }>): void {
  if (!v.carrying) return;
  const res = v.carrying.res;
  // A step with no `qty` hands over the whole load, which is what hauling always
  // does. The founding build asks for an exact amount instead, so a founder who
  // felled more than twelve is not quietly relieved of the rest.
  const qty = step.qty === undefined ? v.carrying.qty : Math.min(step.qty, v.carrying.qty);
  if (qty <= 0) return;
  v.carrying.qty -= qty;
  if (v.carrying.qty <= 0) v.carrying = null;

  const b = buildingById(g, step.id ?? 0);
  if (!b) {
    // The building went away mid-walk. Keep hold of the load and re-decide;
    // there is no pool to hand it to, and there never was during founding.
    if (v.carrying && v.carrying.res === res) v.carrying.qty += qty;
    else v.carrying = { res, qty };
    return;
  }
  if (step.to === 'site') b.delivered[res] = (b.delivered[res] ?? 0) + qty;
  else if (step.to === 'input') b.input[res] = (b.input[res] ?? 0) + qty;
  // Storage, and this is the one that must never refuse: the planner will not
  // give a new plan to anybody still holding goods, so a full compartment
  // turning a delivery away leaves somebody walking to it and back for ever.
  else deliver(g, b, res, qty);
}

function doEffect(g: GameState, v: Villager, step: Extract<Step, { t: 'effect' }>): void {
  switch (step.kind) {
    case 'arrived':
      markArrived(g);
      break;
    case 'settled':
      markSettled(g);
      break;
    case 'eat': {
      // Either meal, and they do exactly the same thing. There is no better
      // supper here and nothing anywhere reads which one it was.
      const held = v.carrying;
      if (held && held.qty > 0 && PREPARED_FOODS.includes(held.res)) {
        held.qty -= 1;
        if (held.qty <= 0) v.carrying = null;
        v.hunger = 0;
        v.energy = Math.min(1, v.energy + 0.08);
        // The day is spent here rather than when the walk began, so a plan
        // dropped halfway does not cost somebody their one extra meal.
        if (step.extra) v.extraMealDay = g.day;
      }
      break;
    }
    case 'sow': {
      const b = buildingById(g, step.id ?? 0);
      const p = b?.plots[step.slot ?? -1];
      if (p && p.state === 'empty') {
        p.state = 'growing';
        p.growth = 0;
      }
      if (p) p.claimed = 0;
      break;
    }
    case 'tend': {
      const b = buildingById(g, step.id ?? 0);
      const p = b?.plots[step.slot ?? -1];
      if (p && p.state === 'growing') {
        p.growth = Math.min(1, p.growth + TEND_GROWTH);
        if (p.growth >= 1) p.state = 'ripe';
      }
      if (p) p.claimed = 0;
      break;
    }
    case 'reap': {
      const b = buildingById(g, step.id ?? 0);
      const p = b?.plots[step.slot ?? -1];
      if (p && p.state === 'ripe') {
        p.state = 'empty';
        p.growth = 0;
        p.claimed = 0;
        const yieldQty = HARVEST_YIELD;
        if (v.carrying && v.carrying.res === 'wheat') v.carrying.qty += yieldQty;
        else if (!v.carrying) v.carrying = { res: 'wheat', qty: yieldQty };
        g.stats.harvested += yieldQty;
      } else if (p) {
        p.claimed = 0;
      }
      break;
    }
    case 'catch': {
      const x = step.x ?? Math.round(v.x);
      const y = step.y ?? Math.round(v.y);
      // What the water gives is how good it is times how rested it is, and it
      // is never nothing: a spot fished flat is slow, and a fisher who came
      // back with an empty net every time would be a punishment for siting a
      // hut badly an hour ago.
      const got = Math.max(1, Math.round(FISH_YIELD * spotYield(g, x, y)));
      workSpot(g, x, y, FISH_TIRE);
      if (v.carrying && v.carrying.res === 'fish') v.carrying.qty += got;
      else if (!v.carrying) v.carrying = { res: 'fish', qty: got };
      g.stats.caught += got;
      splash(g, x, y, rng.chance(JUMP_ON_CATCH));
      if (!g.unlocked.has('seen:fish')) {
        g.unlocked.add('seen:fish');
        journal(g, `${v.name} landed the first fish the kingdom had ever seen.`, '🐟');
        note(g, v.id, 'Landed the kingdom’s first fish.');
      }
      break;
    }
    case 'extract': {
      const b = buildingById(g, step.id ?? 0);
      const res = step.res;
      if (!b || !res) break;
      const got = MINE_YIELD[res] ?? 2;
      // Into the miner's arms, at the face, to be carried back to the mine. It
      // used to appear on a shelf inside the building the miner was standing
      // in, which was the same number arriving without anybody moving.
      if (v.carrying && v.carrying.res === res) v.carrying.qty += got;
      else if (!v.carrying) v.carrying = { res, qty: got };
      // Only stone is counted, and only because the mine's own improvements ask
      // for it. It has to be an accomplishment rather than a stock level: what
      // is in storage goes down again the moment anybody builds a cabin.
      if (res === 'stone') g.stats.mined += got;
      if (res === 'ironOre' && !g.unlocked.has('seen:ironOre')) {
        g.unlocked.add('seen:ironOre');
        journal(g, `${v.name} brought up the first iron ore.`, '⛏️');
        note(g, v.id, 'Brought up the kingdom’s first iron ore.');
      }
      if (res === 'coal' && !g.unlocked.has('seen:coal')) {
        g.unlocked.add('seen:coal');
        journal(g, `${v.name} struck coal in the deep workings.`, '⛏️');
        note(g, v.id, 'Struck the first coal.');
      }
      break;
    }
    case 'batch': {
      const b = buildingById(g, step.id ?? 0);
      if (!b) break;
      // Which recipe ran is carried on the step, because the forge has several
      // and the one it started is the one that has to be paid for.
      const recipe = recipeFor(b, step.res);
      if (!recipe) break;
      if (!hasInputs(b, recipe)) return;
      for (const k in recipe.inputs) {
        const res = k as ResourceId;
        spendInput(b, res, recipe.inputs[res] ?? 0);
      }
      for (const k in recipe.outputs) {
        const res = k as ResourceId;
        const made = recipe.outputs[res] ?? 0;
        // Straight into the building's own storage. This is where it lives now:
        // bread is at the kitchen and bars are at the forge, and nobody carries
        // either anywhere unless they are about to use it.
        deliver(g, b, res, made);
        if (res === 'bread') {
          if (g.stats.baked === 0) {
            journal(g, `${v.name} baked the kingdom's first bread.`, '🍞');
            note(g, v.id, 'Baked the first loaf in the kingdom.');
          }
          g.stats.baked += made;
        }
        if (res === 'cookedFish') {
          if (!g.unlocked.has('seen:cookedFish')) {
            g.unlocked.add('seen:cookedFish');
            journal(g, `${v.name} cooked the first of the catch over the kitchen fire.`, '🍽️');
            note(g, v.id, 'Cooked the kingdom’s first fish.');
          }
        }
        // Meals of either kind, together. This is what the commons asks for and
        // what Vibes wait on, so that a kingdom which lives on fish has got
        // exactly as far as one which lives on bread.
        if (PREPARED_FOODS.includes(res)) g.stats.cooked += made;
        if (res === 'ironBar' || res === 'steelBar') {
          if (g.stats.smelted === 0) {
            journal(g, `${v.name} drew the first bar out of the forge.`, '🔥');
            note(g, v.id, 'Made the kingdom’s first bar of iron.');
          }
          if (res === 'steelBar' && !g.unlocked.has('seen:steelBar')) {
            g.unlocked.add('seen:steelBar');
            journal(g, `${v.name} made steel, which nobody here had seen before.`, '🔥');
          }
          g.stats.smelted += made;
        }
      }
      break;
    }
  }
}

function doLabour(g: GameState, v: Villager, step: Extract<Step, { t: 'labour' }>, dt: number): number {
  const b = buildingById(g, step.id);
  if (!b || b.stage !== 'building') {
    v.actTotal = 0;
    v.plan.shift();
    return 0;
  }
  v.activity = 'building';
  const need = labourNeeded(b);
  const rate = (v.trait === 'crafty' ? 1.2 : 1) * (0.85 + xpOf(v, 'general') * 0.004);
  b.labour += dt * rate;
  addXp(v, 'general', xpGain(xpOf(v, 'general'), dt));

  if (b.labour >= need) {
    completeConstruction(g, b);
    v.actTotal = 0;
    v.plan.shift();
    return dt;
  }
  // Break off every few seconds so builders can be pulled to more urgent work.
  if (v.actTotal === 0) v.actTotal = 7;
  v.actTotal -= dt;
  if (v.actTotal <= 0) {
    v.actTotal = 0;
    v.plan.shift();
    return dt;
  }
  return -1;
}

function doSleep(g: GameState, v: Villager, dt: number): number {
  v.activity = 'sleeping';
  const wake = wakeTime(v);
  if (g.dayT >= wake && g.dayT < 0.6 && v.energy > 0.55) {
    v.plan.shift();
    return dt;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Construction completion
// ---------------------------------------------------------------------------

export function completeConstruction(g: GameState, b: Building): void {
  // The new ground is ready, so the building walks across to it. Handled before
  // anything else here because a relocation is not a new building at all — it
  // is the same one, somewhere else.
  if (b.relocOf) {
    finishRelocation(g, b);
    return;
  }

  const def = BUILDINGS[b.def];
  const wasUpgrade = b.upgrading;
  const firstOfKind = !g.buildings.some((o) => o !== b && o.def === b.def && o.stage === 'done');

  b.stage = 'done';
  b.labour = 0;
  b.delivered = {};
  b.upgrading = false;
  b.built = g.day;
  g.stats.built++;

  if (wasUpgrade) {
    b.level = Math.min(def.maxLevel, b.level + 1);
    // Named after the improvement, not before it: a camp that has been seen to
    // is a Settled Camp from the moment the last post goes in.
    const now = buildingName(b.def, b.level);
    toast(g, def.levelNames ? `Now a ${now}` : `${now} improved`, '⬆️', 'good');
    journal(g, def.levelNames ? `A ${now.toLowerCase()} took the place of the old one.` : `The ${now.toLowerCase()} was improved.`, '⬆️');
  } else {
    if (def.plots) layPlots(g, b);
    // The Base Camp deserves better words than "Base Camp finished", and
    // finishing it is what moves the kingdom out of its founding.
    const founded = onFoundingBuild(g, b);
    if (founded) {
      toast(g, founded.toast, founded.icon, 'good');
      journal(g, founded.journal, founded.icon);
    } else {
      toast(g, `${def.name} finished`, '🏗️', 'good');
      journal(g, firstOfKind ? `The first ${def.name.toLowerCase()} was completed.` : `A new ${def.name.toLowerCase()} was completed.`, '🏗️');
    }
  }

  // A lodge is a woodpile, so the camp stops being one. Its hundred wood was
  // always founding scaffolding — somewhere to put timber down before anywhere
  // proper existed — and leaving it open afterwards split the kingdom's wood
  // across two places for good, so the ceiling beside it could never be a plain
  // 250. Nothing is moved from here: the camp simply stops taking wood, and the
  // General Workers walk what is already in it over to the lodge (rung 4 of the
  // helper ladder). It is one-way, which is why it is a field rather than a
  // question asked of the map — see `Building.cacheRetired`.
  if (b.def === 'lodge' && !wasUpgrade) retireWoodCache(g);
  // Each level of the commons hands the kingdom its next tier of buildings.
  // Doing it here rather than from a goal keeps the two in step: the goal that
  // congratulates you on a Settled Camp and the storehouse it lets you build
  // both hang off the same moment.
  if (b.def === 'commons') unlockCommonsTier(g, b.level);
  // And the mine does the same for the buildings that only make sense once it
  // has gone deep enough to feed them: an Iron Mine is what a forge is for.
  if (b.def === 'quarry') unlockMineTier(g, b.level);

  // A finished house takes in anyone still sleeping out at the commons.
  if (def.housing) {
    for (const v of g.villagers) {
      // A bed the player picked is never quietly reassigned, even to a better one.
      if (v.homeFixed) continue;
      const home = buildingById(g, v.home);
      if (home && home.def !== 'commons') continue;
      if (b.residents.length >= homeCapacity(b)) break;
      if (home) home.residents = home.residents.filter((id) => id !== v.id);
      b.residents.push(v.id);
      v.home = b.id;
    }
  }
}

/**
 * Close the Base Camp's founding woodpile, for good.
 *
 * Nothing is destroyed and nothing is moved by this — the wood already in the
 * camp stays exactly where it is, and stays the kingdom's, until somebody walks
 * it to the lodge. All that changes is that the camp will not take any *more*:
 * `capacityIn` reads zero, so `homeFor` stops routing loads here and `roomIn`
 * puts the compartment into the same "over its ceiling" state that sends a
 * General Worker to clear it. The physical carry falls out of a rung the ladder
 * already had.
 *
 * It says so in the journal because a hundred wood appearing to move house is
 * exactly the sort of thing a player notices and mistrusts.
 */
function retireWoodCache(g: GameState): void {
  const camp = g.buildings.find((b) => b.def === 'commons');
  if (!camp || camp.cacheRetired) return;
  camp.cacheRetired = true;
  const left = Math.floor(camp.store.wood ?? 0);
  journal(
    g,
    left > 0
      ? `The lodge took over the woodpile. The ${left} wood banked at the camp is being carried across.`
      : 'The lodge took over the woodpile. The camp keeps no wood of its own now.',
    '🪵',
  );
}

/**
 * The move is paid for and built: the building steps across.
 *
 * The *original* record is the one that survives, moved to the new corner, and
 * the site is thrown away. Keeping the id is the whole trick — every worker's
 * `workplace`, every resident's `home`, every claim and every reference in a
 * villager's history already points at it, and none of them has to be found and
 * rewritten. Level, name, buffers and the day it was built come along for free
 * because they were never anywhere else.
 */
function finishRelocation(g: GameState, site: Building): void {
  const b = buildingById(g, site.relocOf ?? 0);
  g.buildings = g.buildings.filter((o) => o.id !== site.id);
  if (!b) return; // The original was taken down mid-move; the site goes with it.

  const def = BUILDINGS[b.def];
  // Let go of the old ground first, or a footprint that overlaps itself would
  // clear the tiles it has just claimed.
  for (let dy = 0; dy < def.h; dy++)
    for (let dx = 0; dx < def.w; dx++) {
      const t = tileAt(g, b.x + dx, b.y + dy);
      if (!t) continue;
      if (t.building === b.id) {
        t.building = 0;
        t.blocked = false;
      }
      if (t.plot === b.id) t.plot = 0;
    }
  for (const p of b.plots) {
    const t = tileAt(g, p.x, p.y);
    if (t && t.plot === b.id) t.plot = 0;
  }

  b.x = site.x;
  b.y = site.y;
  b.movingTo = undefined;
  for (let dy = 0; dy < def.h; dy++)
    for (let dx = 0; dx < def.w; dx++) {
      const t = tileAt(g, b.x + dx, b.y + dy);
      if (!t) continue;
      t.building = b.id;
      if (def.solid) t.blocked = true;
    }
  // Fresh ground means fresh fields: whatever was growing in the old plots went
  // with them, which is why the farm's own panel says to harvest before moving.
  if (def.plots) layPlots(g, b);

  const name = buildingName(b.def, b.level);
  toast(g, `The ${name.toLowerCase()} is standing at its new spot`, '🧭', 'good');
  journal(g, `The ${name.toLowerCase()} was taken apart and put back up on better ground.`, '🧭');

  // Everybody re-decides: half the kingdom was walking towards the old corner.
  for (const v of g.villagers) abandonPlan(g, v);
}

/**
 * Lays a field out over the ground its building stands on, everything but the
 * barn corner. `keep` carries over whatever is already growing on a tile the
 * farm still holds, which is what a kingdom whose footprint changed under it
 * wants; fresh ground gets a fresh field.
 */
export function layPlots(g: GameState, b: Building, keep = false): void {
  const def = BUILDINGS[b.def];
  const standing = keep ? new Map(b.plots.map((p) => [p.y * g.w + p.x, p])) : null;
  b.plots = [];
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      if (dx === 0 && dy === 0) continue; // barn corner
      const x = b.x + dx;
      const y = b.y + dy;
      const t = tileAt(g, x, y);
      if (!t || t.terrain === 'water' || t.terrain === 'shallow') continue;
      // Ground somebody else is standing on is not the farm's to till. Only a
      // footprint that grew after the fact can find a neighbour inside it, and
      // the field goes round rather than swallowing them.
      if (t.building && t.building !== b.id) continue;
      t.prop = null;
      t.plot = b.id;
      const was = standing?.get(y * g.w + x);
      b.plots.push(was ? { ...was, claimed: 0 } : { x, y, state: 'empty', growth: 0, claimed: 0 });
    }
  }
}

function unstick(g: GameState, v: Villager): void {
  for (let r = 1; r < 10; r++) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(v.x) + dx;
        const y = Math.round(v.y) + dy;
        if (isWalkable(g, x, y)) {
          v.x = x;
          v.y = y;
          v.stuck = 0;
          return;
        }
      }
  }
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

/**
 * How far this person's day sits from everybody else's. Trait plus a little of
 * their own, and it moves the *outer* ends of the day only: waking, going out
 * in the morning, finishing in the evening, turning in. Both ends move
 * together, so an early riser and an owl sleep exactly as long as each other
 * and energy needs no special case.
 *
 * The point of it is the overlap at the edges. An early riser is out cutting
 * stone while the rest of the kingdom is still at breakfast, an owl is still at
 * the forge after they have gone in, and a player who notices can staff around
 * it. What it must never do is take somebody out of a break the rest of the
 * kingdom is having, which is why the midday hour is exempt below.
 */
function dayShift(v: Villager): number {
  const trait = v.trait === 'earlyRiser' ? -TRAIT_DAY_SHIFT : v.trait === 'nightOwl' ? TRAIT_DAY_SHIFT : 0;
  return trait + clamp(v.wakeOffset, -PERSONAL_DAY_SHIFT, PERSONAL_DAY_SHIFT);
}

/**
 * Never earlier than the first minutes of `dayT`, because the day's own zero is
 * five in the morning and a wake time that fell off the front of it would wrap
 * round to the small hours and leave somebody asleep for a day and a half.
 */
function wakeTime(v: Villager): number {
  return clamp(SCHEDULE.wake + dayShift(v), 0.002, 0.2);
}

/** Bedtime carries a little extra wobble of its own, so a household does not turn in as one. */
function bedTime(v: Villager): number {
  return clamp(SCHEDULE.bed + dayShift(v) + clamp(v.sleepOffset, -0.01, 0.01), 0.7, 0.86);
}

/**
 * Two stretches of work with an hour between them. The morning's start and the
 * evening's end move with the person; the midday break does not move for
 * anybody, because it is only an hour long and a shifted one would leave the
 * early risers and the owls sharing none of it.
 */
function isWorkTime(g: GameState, v: Villager): boolean {
  const s = dayShift(v);
  const t = g.dayT;
  if (t >= SCHEDULE.workStart + s && t < SCHEDULE.middayBreak) return true;
  return t >= SCHEDULE.workResume && t < SCHEDULE.workEnd + s;
}

/** Awake, and not at work: one of the three times a day the kingdom collects itself. */
function isBreak(g: GameState, v: Villager): boolean {
  return !shouldSleep(g, v) && !isWorkTime(g, v);
}

function shouldSleep(g: GameState, v: Villager): boolean {
  return g.dayT >= bedTime(v) || g.dayT < wakeTime(v);
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

function think(g: GameState, v: Villager): void {
  releaseClaim(g, v);
  v.actTotal = 0;
  v.actLeft = 0;

  // Never carry goods across a decision — put them somewhere first. The founder
  // during founding is the one exception in the whole game: there is nowhere to
  // put anything down yet, so the wood stays in their arms and pays for the
  // Base Camp directly. The exception ends with the camp.
  if (v.carrying && !isFounder(g, v)) {
    const home = homeFor(g, v.carrying.res, v.x, v.y);
    if (home) {
      planWalkTo(g, v, home, [{ t: 'give', to: 'store', id: home.id }]);
      if (v.plan.length) return;
    }
    // Nowhere in the kingdom with room, or nowhere they can reach. They keep
    // hold of it rather than setting it down in a field: goods do not leave the
    // map, and a compartment somewhere will have space again shortly.
  }

  if (!buildingById(g, v.home)) assignHome(g, v);

  if (shouldSleep(g, v) && v.energy < 0.92) {
    if (planSleep(g, v)) return;
  }

  const working = isWorkTime(g, v);
  const onBreak = isBreak(g, v);
  if (preparedFood(g) >= 1) {
    // Ordinary hunger waits for the next break — there is one along shortly
    // whatever the hour — and going properly hungry does not wait for anything.
    if (v.hunger >= SEVERE_HUNGER || (onBreak && v.hunger > 0.7)) {
      if (planEat(g, v, false)) return;
    }
    // …and the one extra meal that having had nothing to do earns, taken on a
    // break and once a day. A kingdom with everything built still eats. There
    // is no surplus to protect — if there is a supper in the store they have
    // it — but somebody who ate ten minutes ago is not owed a second one.
    if (onBreak && v.underworkedDay === g.day && v.extraMealDay !== g.day && v.hunger > 0.3) {
      if (planEat(g, v, true)) return;
    }
  }

  // Founding comes ahead of ordinary work and is not held to work hours: the
  // walk up the beach is the first thing that happens, whatever the clock says.
  if (foundingActive(g) && planFounding(g, v)) return;
  if (working) {
    if (planWork(g, v)) return;
    // Nothing anywhere for them: no post to work, no site to supply, no
    // workshop to restock, nothing to fetch. Remembered for the day, so that
    // instead of only wandering they get a meal out of it at the next break.
    v.underworkedDay = g.day;
  }

  planLeisure(g, v, onBreak);
}

/** The one person the founding rules apply to, and only while they apply. */
function isFounder(g: GameState, v: Villager): boolean {
  return foundingActive(g) && v.id === g.founderId;
}

/** Wood in the founder's arms, which during founding is the whole treasury. */
function carriedWood(v: Villager): number {
  return v.carrying?.res === 'wood' ? v.carrying.qty : 0;
}

/**
 * The founder's opening. Each stage is a plan ending in an `effect` step, so the
 * kingdom only moves on at the exact moment the action that earns it finishes —
 * the same reason batches and harvests work that way.
 */
function planFounding(g: GameState, v: Villager): boolean {
  if (v.id !== g.founderId) return false;

  switch (g.founding.stage) {
    case 'arriving': {
      const inland = suggestCamp(g);
      v.plan = [
        { t: 'move', x: inland.x, y: inland.y },
        // The one pause in the opening, and it earns the line that follows it.
        // `arriving` rather than `watching`: they have just got here, they are
        // not passing the time.
        { t: 'act', dur: 5, kind: 'arriving' },
        { t: 'say', text: 'This seems like a good place to begin.' },
        { t: 'effect', kind: 'arrived' },
      ];
      return true;
    }
    case 'choosing':
      // Waiting on the player, but not idling: the wood will be wanted wherever
      // the camp ends up, so they get on with collecting it. A quick decision
      // therefore costs nothing and a slow one is spent usefully.
      return planCamp(g, v);
    case 'settling': {
      // The rough camp is already laid out around this tile; they are walking
      // into the middle of it, which is the last thing that happens before any
      // work does. The camp is not solid, so they stand in it rather than
      // beside it.
      const { x, y } = g.founding;
      v.plan = [
        { t: 'move', x, y },
        { t: 'act', dur: 4, kind: 'building' },
        { t: 'say', text: 'Flat enough, and out of the wind.' },
        { t: 'effect', kind: 'settled' },
      ];
      return true;
    }
    case 'camp':
      return planCamp(g, v);
  }
  return false;
}

/**
 * One tree in, one Base Camp out, all of it paid for from the founder's arms.
 * Runs from the moment they stop walking, before the ground is even chosen: they
 * fill up first and build second, and one full load of twelve is exactly what
 * the camp costs, so nothing is left over and nobody walks the same ground
 * twice.
 */
function planCamp(g: GameState, v: Villager): boolean {
  const held = carriedWood(v);
  const site = foundingSite(g);
  const short = site ? woodShortfall(site) : 0;

  // Top the load up while there is still something to pay for. Felled at the
  // ordinary pace rather than the untrained one: this is the first minute of
  // the game and it should feel deliberate, not like a punishment for not
  // owning an axe yet.
  const want = Math.min(CARRY_CAPACITY, foundingWoodNeeded(g));
  if (held < want && planGatherNode(g, v, 'tree', 24, 'general', false, false)) return true;

  if (site) {
    // Materials, then hands: the same two jobs any other site needs, minus the
    // walk to a store that does not exist.
    if (short > 0 && held > 0) {
      v.plan = [
        approachSteps(g, site),
        { t: 'give', to: 'site', id: site.id, qty: Math.min(short, held) },
        { t: 'labour', id: site.id },
      ];
      return true;
    }
    if (short === 0) {
      claim(g, v, 'labour', site.id);
      planWalkTo(g, v, site, [{ t: 'labour', id: site.id }]);
      return true;
    }
  }

  // Nothing to fetch and nothing to build, which means they are waiting on the
  // player: they walk the ground looking the place over. Nobody sits down
  // during the founding — idling is the product once a kingdom exists, and
  // before that it reads as a broken game.
  planSurvey(g, v);
  return true;
}

/**
 * Pacing the clearing while the player decides. Deliberately not leisure: no
 * benches, no pond-watching, no standing still — the opening should read as
 * somebody with something on their mind, not somebody on their break.
 */
function planSurvey(g: GameState, v: Villager): void {
  const r = rng;
  for (let i = 0; i < 10; i++) {
    const a = r.range(0, Math.PI * 2);
    const d = r.range(2, 5);
    const x = Math.round(v.x + Math.cos(a) * d);
    const y = Math.round(v.y + Math.sin(a) * d);
    if (!isWalkable(g, x, y)) continue;
    // Dry land only. The shallows are wadeable, but somebody standing in a pond
    // deciding where to found a kingdom is not the picture this moment wants.
    const t = tileAt(g, x, y);
    if (!t || t.terrain === 'shallow' || t.terrain === 'water') continue;
    v.plan = [{ t: 'move', x, y }];
    return;
  }
  v.plan = [{ t: 'act', dur: 3, kind: 'arriving' }];
}

function approachSteps(g: GameState, b: Building): Extract<Step, { t: 'move' }> {
  const def = BUILDINGS[b.def];
  const goals = footprintApproach(g, b.x, b.y, def.w, def.h);
  if (goals.length === 0) goals.push({ x: b.x, y: b.y });
  return { t: 'move', x: b.x, y: b.y, goals };
}

function planWalkTo(g: GameState, v: Villager, b: Building, then: Step[]): void {
  v.plan = [approachSteps(g, b), ...then];
}

function planSleep(g: GameState, v: Villager): boolean {
  const home = buildingById(g, v.home);
  if (!home) {
    v.plan = [{ t: 'act', dur: 40, kind: 'resting' }];
    return true;
  }
  planWalkTo(g, v, home, [{ t: 'sleep' }]);
  return true;
}

/**
 * Supper, and where it is. Meals live at the kitchen, so this is a walk to the
 * kitchen — which is most of what makes where the kitchen goes a decision.
 *
 * They take the one they like if it is there and the other one perfectly
 * happily if it is not: a preference is a thing to notice about somebody, not a
 * demand the kitchen has to meet. Both branches ask the same question of the
 * same building, so a kingdom living on fish eats exactly as easily as one
 * living on bread.
 */
function mealFor(g: GameState, v: Villager): { res: ResourceId; at: Building } | null {
  const own = sourceOf(g, v.favoriteFood, v.x, v.y);
  if (own) return { res: v.favoriteFood, at: own };
  for (const res of PREPARED_FOODS) {
    const at = sourceOf(g, res, v.x, v.y);
    if (at) return { res, at };
  }
  return null;
}

function planEat(g: GameState, v: Villager, extra: boolean): boolean {
  const meal = mealFor(g, v);
  if (!meal) return false;
  planWalkTo(g, v, meal.at, [
    { t: 'take', res: meal.res, qty: 1, from: 'store', id: meal.at.id },
    { t: 'act', dur: 7, kind: 'eating' },
    { t: 'effect', kind: 'eat', extra },
  ]);
  return true;
}

// ---------------------------------------------------------------------------
// Work
// ---------------------------------------------------------------------------

function planWork(g: GameState, v: Villager): boolean {
  const workplace = buildingById(g, v.workplace);
  if (workplace && workplace.stage === 'done') {
    switch (v.job) {
      case 'woodcutter':
        return planHarvestTrees(g, v, workplace);
      case 'miner':
        return planExtract(g, v, workplace);
      case 'farmer':
        return planFarm(g, v, workplace);
      case 'fisher':
        return planFish(g, v, workplace);
      case 'miller':
      case 'cook':
      case 'smith':
        return planProduce(g, v, workplace);
      default:
        break;
    }
  }
  return planGeneralWork(g, v);
}

/** The walk home with a load, to the building that keeps this sort of thing. */
function homeLeg(g: GameState, home: Building): Step[] {
  const def = BUILDINGS[home.def];
  return [
    { t: 'move', x: home.x, y: home.y, goals: footprintApproach(g, home.x, home.y, def.w, def.h) },
    { t: 'give', to: 'store', id: home.id },
  ];
}

/**
 * Woodcutters: walk out to a tree, fell it, haul the load back.
 *
 * Trees are the only nodes anybody works this way now. The mine does not send
 * people out to boulders — it takes its material from the ground it stands on
 * (`planExtract`), which is why surface rock can be finite without the kingdom
 * ever running out of stone.
 */
function planHarvestTrees(g: GameState, v: Villager, workplace: Building): boolean {
  // Where the load would go, which is the lodge's own woodpile while it has
  // room and the nearest thing with room once it has not. Never about the
  // kingdom's larder: a full woodpile and an empty larder are the same kingdom.
  const home = dropFor(g, 'wood', workplace.x, workplace.y, CHOP_YIELD);
  if (!home) {
    noticeFull(g, 'wood', workplace);
    return planGeneralWork(g, v);
  }

  // The reach drawn on the map when this was placed is the reach used here.
  const reach = rangeOf(workplace.def, workplace.level);
  const c = buildingCentre(workplace);
  const node = findNode(g, c.x, c.y, 'tree', reach) ?? findNode(g, v.x, v.y, 'tree', reach + 7);
  if (!node) return planGeneralWork(g, v);

  const goals = neighbours(g, node.x, node.y);
  if (goals.length === 0) return planGeneralWork(g, v);
  claim(g, v, 'node', node.y * g.w + node.x, node.x, node.y);

  const trips = clamp(Math.floor(CARRY_CAPACITY / CHOP_YIELD), 1, 4);
  const steps: Step[] = [{ t: 'move', x: node.x, y: node.y, goals }];
  for (let i = 0; i < trips; i++) {
    steps.push({ t: 'act', dur: CHOP_SECONDS, kind: 'gathering', xp: 'woodcutter' });
    steps.push({ t: 'take', res: 'wood', qty: CHOP_YIELD, from: 'tile', x: node.x, y: node.y });
  }
  steps.push(...homeLeg(g, home));
  v.plan = steps;
  return true;
}

// ---------------------------------------------------------------------------
// Fishing
// ---------------------------------------------------------------------------

/**
 * Fishers: out to a spot, cast, wait, and carry the catch back.
 *
 * The same shape as felling a tree, and deliberately so — walk out, work a
 * thing that is somewhere on the map, haul the result to a store — but the
 * thing being worked is water rather than a node. Nothing is consumed and
 * nothing runs out: the spot is simply quieter for a while afterwards and
 * recovers on its own, which is why a hut can never fish its lake empty and why
 * two fishers on a small pond are slower rather than idle.
 *
 * The spot is claimed for the whole trip, so the other fisher goes somewhere
 * else instead of standing in the same reeds.
 */
function planFish(g: GameState, v: Villager, hut: Building): boolean {
  // Enough meals in the kingdom already, counting everything upstream: go and
  // be useful elsewhere. This is a judgement about mouths, not about shelf room.
  if (foodGlut(g, 'fish')) return planGeneralWork(g, v);
  // …and somewhere to put the catch, which is the hut while the hut has room
  // and a storehouse once it has not. Measured from the hut, so nothing changes
  // until the hut is genuinely full.
  const drop = dropFor(g, 'fish', hut.x, hut.y, FISH_YIELD);
  if (!drop) {
    noticeFull(g, 'fish', hut);
    return planGeneralWork(g, v);
  }

  const reach = rangeOf(hut.def, hut.level);
  const c = buildingCentre(hut);
  const spot = findFishingSpot(g, c.x, c.y, reach);
  // No water in reach that anybody can stand beside. The hut is in the wrong
  // place, which is a slow disappointment rather than a broken kingdom.
  if (!spot) return planGeneralWork(g, v);

  const bank = bankBeside(g, spot.x, spot.y);
  if (!bank) return planGeneralWork(g, v);
  claim(g, v, 'node', spot.y * g.w + spot.x, spot.x, spot.y);

  // Three casts is about an armful at a good spot, and a short enough stint
  // that somebody can be pulled off to more urgent work between trips.
  const casts = 3;
  const steps: Step[] = [{ t: 'move', x: bank.x, y: bank.y, goals: [bank] }];
  for (let i = 0; i < casts; i++) {
    steps.push({
      t: 'act',
      dur: FISH_SECONDS / (FISH_SEASON[g.season] ?? 1),
      kind: 'fishing',
      xp: 'fisher',
      face: faceToward(bank, spot),
    });
    steps.push({ t: 'effect', kind: 'catch', x: spot.x, y: spot.y });
  }
  // Back to the hut, which is where the kingdom's fish is kept and where the
  // cooks come for it — or to whatever has room for it when the hut has none.
  steps.push(...homeLeg(g, drop));
  v.plan = steps;
  return true;
}

/** Dry land next to a stretch of water, nearest to whoever is going there. */
function bankBeside(g: GameState, x: number, y: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const t = tileAt(g, x + dx, y + dy);
      if (!t || t.terrain === 'water' || t.terrain === 'shallow') continue;
      if (!isWalkable(g, x + dx, y + dy)) continue;
      // Straight on beats a corner, so people stand square to the water.
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bestD) {
        bestD = d;
        best = { x: x + dx, y: y + dy };
      }
    }
  return best;
}

/** Which way somebody standing on the bank is looking. 0=SE 1=SW 2=NW 3=NE. */
function faceToward(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 0 : 2;
  return dy > 0 ? 1 : 3;
}

// ---------------------------------------------------------------------------
// The mine
// ---------------------------------------------------------------------------

/**
 * What this mine's people are getting out today.
 *
 * A focus is a preference, not an instruction that can fail. If the favoured
 * material has nowhere left to go the mine quietly works on something else
 * rather than stopping — the same nothing-is-ever-punishing rule the rest of
 * the game runs on. Balanced means "whatever we are shortest of", measured
 * against `BALANCE_TARGET` rather than against each other, because a kingdom
 * wants far more stone than it does ore.
 *
 * What closes a material off is having nowhere in the kingdom to put it, and
 * nothing else. Each material is asked about separately, so a Deep Mine with
 * nowhere to put stone carries on cutting ore — which used to be impossible,
 * because the one shared pool being full stopped everything at once.
 *
 * It asks `dropFor` rather than about its own shelf, and the difference is the
 * whole reason a storehouse is worth building: a mine sitting at its own
 * ceiling with a barn down the hill is a mine that should still be cutting
 * stone. Asking about itself left it stopped beside a thousand empty shelves.
 *
 * Mithril is filtered out unconditionally. The level that would list it cannot
 * be reached, and this is the second lock on that.
 */
function chooseExtraction(g: GameState, b: Building): ResourceId | null {
  const all: ResourceId[] = extractsOf(b.def, b.level).filter((r) => r !== 'mithrilOre');
  const open = all.filter((r) => dropFor(g, r, b.x, b.y, MINE_YIELD[r] ?? 2));
  if (open.length === 0) return null;
  const focus = b.focus;
  if (focus && focus !== 'balanced' && open.includes(focus as ResourceId)) return focus as ResourceId;
  let best = open[0];
  let bestShare = Infinity;
  for (const res of open) {
    const share = totalOf(g, res) / (BALANCE_TARGET[res] ?? 100);
    if (share < bestShare) {
      bestShare = share;
      best = res;
    }
  }
  return best;
}

/**
 * Miners: out to a face in the rock, a stint at it, and the load carried back
 * to the mine — which is where everything the mine brings up is kept.
 *
 * There is still no node and nothing is consumed: the face is a *place to
 * stand*, not a resource, and the seam under it does not run out. What the site
 * decides is only how fast, through how much rock is inside its reach. The walk
 * exists because the material has to arrive in the kingdom by somebody carrying
 * it — a miner who never left the footprint was a building that produced stone
 * out of the air, which is the one thing this economy does not do.
 *
 * The face is claimed for the trip so two miners do not stand in the same spot.
 * A mine hemmed in so completely that no rocky tile in reach can be walked on
 * falls back to working at the building, which is what every mine used to do.
 */
function planExtract(g: GameState, v: Villager, mine: Building): boolean {
  const res = chooseExtraction(g, mine);
  // Every compartment this mine has is full. Go and be useful; the rock keeps.
  if (!res) {
    noticeFull(g, extractsOf(mine.def, mine.level)[0] ?? 'stone', mine);
    return planGeneralWork(g, v);
  }

  /*
   * Where the load ends up, measured **from the mine** rather than from the
   * face. That is deliberate and it is what keeps this change invisible until
   * it is wanted: the mine is at no distance from itself, so it wins outright
   * whenever it has room, and a storehouse only ever gets the stone once the
   * mine has none. Measuring from the face would start handing loads to a barn
   * that happened to sit nearer the rock, which is a different feature.
   */
  const drop = dropFor(g, res, mine.x, mine.y, MINE_YIELD[res] ?? 2) ?? mine;

  const c = buildingCentre(mine);
  const reach = rangeOf(mine.def, mine.level);
  const rock = rockInRange(g, c.x, c.y, reach);
  const dur = MINE_SECONDS / richnessMul(rock);
  const face = findRockFace(g, c.x, c.y, reach);

  if (!face) {
    planWalkTo(g, v, mine, [
      { t: 'act', dur, kind: 'gathering', xp: 'miner' },
      { t: 'effect', kind: 'extract', id: mine.id, res },
      ...(drop.id === mine.id ? ([{ t: 'give', to: 'store', id: mine.id }] as Step[]) : homeLeg(g, drop)),
    ]);
    return true;
  }

  claim(g, v, 'node', face.y * g.w + face.x, face.x, face.y);
  // Two or three goes at the face before walking back, the same shape a
  // woodcutter's trip has: enough that the walk is worth making, short enough
  // that somebody can be pulled off to more urgent work between trips.
  const goes = clamp(Math.floor(CARRY_CAPACITY / (MINE_YIELD[res] ?? 2)), 1, 3);
  const steps: Step[] = [{ t: 'move', x: face.x, y: face.y, goals: [face] }];
  for (let i = 0; i < goes; i++) {
    steps.push({ t: 'act', dur, kind: 'gathering', xp: 'miner' });
    steps.push({ t: 'effect', kind: 'extract', id: mine.id, res });
  }
  steps.push(...homeLeg(g, drop));
  v.plan = steps;
  return true;
}

/**
 * What one kind of node gives up by hand, and how long a go at it takes.
 *
 * Trees, and only trees. A boulder is not on this list on purpose: breaking one
 * is quarry work, so there is no path through `planGatherNode` that produces
 * stone and no way for a General Worker to find one. Stoneworkers go through
 * `planHarvestNode` instead, which is reached only from a staffed quarry.
 */
const NODE_WORK: Partial<Record<PropId, { res: ResourceId; per: number; seconds: number }>> = {
  tree: { res: 'wood', per: CHOP_YIELD, seconds: CHOP_SECONDS },
};

/**
 * Hand-gathering: walk to the nearest node of a kind, work it until an armful
 * is up, and haul that to the nearest store. `slow` is the untrained penalty —
 * twice as long as a woodcutter takes over the same tree — which the founding
 * deliberately does not apply: the opening is one tree and one load, and it
 * wants to read as deliberate rather than laborious. `haul` is off only during
 * founding, where there is no store to walk to and the load stays in the
 * founder's arms.
 */
function planGatherNode(
  g: GameState,
  v: Villager,
  prop: PropId,
  radius: number,
  xp: JobId,
  slow: boolean,
  haul = true,
): boolean {
  const work = NODE_WORK[prop];
  if (!work) return false;
  const node = findNode(g, v.x, v.y, prop, radius);
  if (!node) return false;
  const goals = neighbours(g, node.x, node.y);
  if (goals.length === 0) return false;
  const home = haul ? homeFor(g, work.res, node.x, node.y) : null;
  if (haul && !home) return false;

  claim(g, v, 'node', node.y * g.w + node.x, node.x, node.y);
  // Never swing at a node for longer than it has left in it, nor for more than
  // there is room in your arms for.
  const left = tileAt(g, node.x, node.y)?.amount ?? 0;
  const room = CARRY_CAPACITY - (v.carrying?.res === work.res ? v.carrying.qty : 0);
  const trips = clamp(Math.min(Math.floor(room / work.per), Math.ceil(left / work.per)), 1, 4);
  const steps: Step[] = [{ t: 'move', x: node.x, y: node.y, goals }];
  for (let i = 0; i < trips; i++) {
    steps.push({ t: 'act', dur: work.seconds * (slow ? HAND_FELL_MUL : 1), kind: 'gathering', xp });
    steps.push({ t: 'take', res: work.res, qty: work.per, from: 'tile', x: node.x, y: node.y });
  }
  if (home) steps.push(...homeLeg(g, home));
  v.plan = steps;
  return true;
}

/** Wood by hand means a tree, felled slowly by somebody who is not a woodcutter. */
function planGatherWood(g: GameState, v: Villager, xp: JobId): boolean {
  return planGatherNode(g, v, 'tree', 22, xp, true);
}

function neighbours(g: GameState, x: number, y: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (isWalkable(g, x + dx, y + dy)) out.push({ x: x + dx, y: y + dy });
    }
  return out;
}

/** Farmers reap ripe plots first, then sow empty ones, then hoe what is growing. */
function planFarm(g: GameState, v: Villager, farm: Building): boolean {
  let ripe = -1;
  let empty = -1;
  let green = -1;
  let fallow = -1;
  let ripeD = Infinity;
  let emptyD = Infinity;
  let fallowD = Infinity;
  let greenGrowth = Infinity;
  for (let i = 0; i < farm.plots.length; i++) {
    const p = farm.plots[i];
    if (p.claimed && p.claimed !== v.id) continue;
    const d = dist(p.x, p.y, v.x, v.y);
    if (p.state === 'ripe' && d < ripeD) {
      ripe = i;
      ripeD = d;
    } else if (p.state === 'empty' && d < emptyD) {
      empty = i;
      emptyD = d;
    } else if (p.state === 'growing' && p.growth < greenGrowth) {
      // The furthest behind rather than the nearest, so the field gets worked
      // round evenly instead of one corner being hoed all afternoon. Hoeing
      // moves a plot up the order, so this rotates by itself and wants no
      // remembered "last tended" on the plot.
      green = i;
      greenGrowth = p.growth;
    }
    // Ground that has been reaped and not sown again is still ground somebody
    // walks over with a hoe, and while the larder is full it is most of the
    // field. Nearest wins here: there is nothing to be even-handed about.
    if (p.state === 'empty' && d < fallowD) {
      fallow = i;
      fallowD = d;
    }
  }

  // Reaping wants one thing: somewhere for the sheaves to go — the farm's own
  // barn, or a storehouse once that is full.
  //
  // It deliberately does *not* ask whether the kingdom has enough to eat. A
  // comfortable larder used to stop the harvest, and what that looked like on
  // the map was two dozen plots standing gold for a day and a half with an empty
  // barn behind them and farmers walking past. Wheat is not supper; it is two
  // buildings away from supper, and the mill and the kitchen already stop
  // themselves. Standing grain that nobody will cut is the one shortage-shaped
  // thing in the game that reads as a fault rather than as waiting.
  const drop = dropFor(g, 'wheat', farm.x, farm.y, HARVEST_YIELD);
  if (ripe >= 0 && drop) {
    const p = farm.plots[ripe];
    p.claimed = v.id;
    claim(g, v, 'plot', farm.id * 100 + ripe);
    const steps: Step[] = [
      { t: 'move', x: p.x, y: p.y },
      { t: 'act', dur: HARVEST_SECONDS, kind: 'harvesting', xp: 'farmer' },
      { t: 'effect', kind: 'reap', id: farm.id, slot: ripe },
    ];
    // Chain the other ripe plots into the same trip so farmers are not forever
    // walking to store, and so a load is worth carrying: a plot gives one sheaf,
    // and a walk to the barn for one sheaf is a farmer running errands.
    let load = HARVEST_YIELD;
    for (let i = 0; i < farm.plots.length && load + HARVEST_YIELD <= HARVEST_TRIP; i++) {
      const q = farm.plots[i];
      if (i === ripe || q.state !== 'ripe' || q.claimed) continue;
      if (roomIn(drop, 'wheat') < load + HARVEST_YIELD) break;
      q.claimed = v.id;
      load += HARVEST_YIELD;
      steps.push(
        { t: 'move', x: q.x, y: q.y },
        { t: 'act', dur: HARVEST_SECONDS, kind: 'harvesting', xp: 'farmer' },
        { t: 'effect', kind: 'reap', id: farm.id, slot: i },
      );
    }
    // Into the barn, which is where the kingdom's wheat lives and where the
    // miller comes for it — or wherever has room when the barn has none.
    steps.push(...homeLeg(g, drop));
    v.plan = steps;
    return true;
  }

  // Sowing is where the throttle belongs instead, and it is the farm's whole
  // output: past the quarter that is always kept going, a comfortable kingdom
  // puts no more ground under seed. That winds the farm down over a harvest
  // rather than freezing it mid-harvest — what is standing still comes in, the
  // rest lies fallow, and it goes back under seed when the larder wants it.
  //
  // The gate has to stay, because the field is far larger than the kingdom's
  // appetite and a farm running flat out leaves the fishers with nothing worth
  // catching. What fills a farmer's day instead is below.
  const underCrop = farm.plots.reduce((n, p) => n + (p.state === 'empty' ? 0 : 1), 0);
  const keptGoing = Math.round(farm.plots.length * ALWAYS_SOWN);
  if (empty >= 0 && (underCrop < keptGoing || !foodGlut(g, 'wheat'))) {
    const p = farm.plots[empty];
    p.claimed = v.id;
    claim(g, v, 'plot', farm.id * 100 + empty);
    v.plan = [
      { t: 'move', x: p.x, y: p.y },
      { t: 'act', dur: PLANT_SECONDS, kind: 'planting', xp: 'farmer' },
      { t: 'effect', kind: 'sow', id: farm.id, slot: empty },
    ];
    return true;
  }

  // Nothing to cut and nothing to sow, and a field is still a field. Hoeing is
  // the rest of a farmer's day and the reason they stay in it rather than
  // walking off to carry planks every time the larder is comfortable, and
  // standing wheat comes on a little faster for it.
  if (green >= 0) return planTend(g, v, farm, green);

  // A field with nothing whatever growing in it is another matter: that is a
  // farm between crops, and somebody standing in it has no more of a job than
  // anyone else. Real work elsewhere comes first, exactly as it does for every
  // other trade with an empty day.
  if (planGeneralWork(g, v)) return true;

  // And if there is none of that either, the fallow ground gets turned over.
  // This yields nothing at all — the tend effect only moves a growing plot
  // along — which is the point: it is what a farmer does with a quiet afternoon,
  // not a way round the throttle above.
  if (fallow >= 0) return planTend(g, v, farm, fallow);
  return false;
}

/** One bout of hoeing at a particular plot, growing or bare. */
function planTend(g: GameState, v: Villager, farm: Building, slot: number): boolean {
  const p = farm.plots[slot];
  p.claimed = v.id;
  claim(g, v, 'plot', farm.id * 100 + slot);
  v.plan = [
    { t: 'move', x: p.x, y: p.y },
    { t: 'act', dur: TEND_SECONDS, kind: 'tending', xp: 'farmer' },
    { t: 'effect', kind: 'tend', id: farm.id, slot },
  ];
  return true;
}

// ---------------------------------------------------------------------------
// Workshops
// ---------------------------------------------------------------------------

/** What a recipe asks for, as pairs rather than a sparse record. */
function inputsOf(r: Recipe): { res: ResourceId; qty: number }[] {
  return (Object.keys(r.inputs) as ResourceId[]).map((res) => ({ res, qty: r.inputs[res] ?? 0 }));
}

/** The recipe a `batch` step is paying for, found by what it makes. */
function recipeFor(b: Building, res?: ResourceId): Recipe | null {
  const list = liveRecipesOf(b.def);
  if (!res) return list[0] ?? null;
  return list.find((r) => recipeOutput(r) === res) ?? null;
}

/** What a workshop can lay hands on without going anywhere: bench plus its own storage. */
function onHand(b: Building, res: ResourceId): number {
  return (b.input[res] ?? 0) + (b.store[res] ?? 0);
}

/**
 * Everything for one batch is already here.
 *
 * The storage half is what makes steel easy: iron bars are kept at the forge,
 * so a smith making steel reaches for one off the stack rather than fetching it
 * from a building that would have been the forge anyway.
 */
function hasInputs(b: Building, r: Recipe): boolean {
  return inputsOf(r).every((i) => onHand(b, i.res) >= i.qty);
}

/** Bench first, then the building's own stack. */
function spendInput(b: Building, res: ResourceId, qty: number): void {
  const fromBench = Math.min(qty, b.input[res] ?? 0);
  if (fromBench > 0) b.input[res] = (b.input[res] ?? 0) - fromBench;
  const rest = qty - fromBench;
  if (rest > 0) b.store[res] = Math.max(0, (b.store[res] ?? 0) - rest);
}

/** The kingdom has enough of every ingredient somewhere for one batch. */
function couldSupply(g: GameState, b: Building, r: Recipe): boolean {
  void b;
  return inputsOf(r).every((i) => totalOf(g, i.res) >= i.qty);
}

/**
 * Which of a workshop's recipes to work on next.
 *
 * Most buildings have exactly one and this is a formality. The forge has two —
 * iron, and steel out of iron — and the choice follows the same rules the mine's
 * does: a focus is a preference rather than an order, a glutted output steps
 * aside, and Balanced means whatever the kingdom is furthest below wanting.
 * Nothing here can fail in a way the player has to fix; the worst case is that
 * the forge waits, which is what a forge with no ore should do.
 */
function chooseRecipe(g: GameState, b: Building): Recipe | null {
  const runnable = liveRecipesOf(b.def).filter((r) => {
    const out = recipeOutput(r);
    // Two separate reasons to stand down, and they answer different questions:
    // there is nowhere in the kingdom to put another one, or there are already
    // more meals than anybody wants.
    //
    // The first is deliberately *not* about this building any more. A batch
    // lands on the shelf where it was made — that much has to stay true, or
    // bread would appear somewhere nobody carried it — but a full shelf with a
    // storehouse down the road is a reason to keep baking and let somebody
    // carry the surplus off, which is rung 4 of the General Worker's ladder.
    if (!dropFor(g, out, b.x, b.y, r.outputs[out] ?? 1)) return false;
    if (foodGlut(g, out)) return false;
    return couldSupply(g, b, r);
  });
  if (runnable.length === 0) return null;
  const focus = b.focus;
  if (focus && focus !== 'balanced') {
    const wanted = runnable.find((r) => recipeOutput(r) === focus);
    if (wanted) return wanted;
  }
  // Something already half-set-up wins over starting a different job.
  const ready = runnable.filter((r) => hasInputs(b, r));
  const pool = ready.length ? ready : runnable;
  let best = pool[0];
  let bestShare = Infinity;
  for (const r of pool) {
    const out = recipeOutput(r);
    const share = totalOf(g, out) / (BALANCE_TARGET[out] ?? 100);
    if (share < bestShare) {
      bestShare = share;
      best = r;
    }
  }
  return best;
}

/**
 * What this workshop is short of for a given recipe, how much of it to fetch,
 * and — the new part — which building to fetch it from.
 *
 * There is no pool to draw on, so an errand is always a walk to a named place:
 * the mill goes to the farm for wheat, the kitchen to the mill and the hut, the
 * forge to the mine. That walk is the fetching half of the economy and is why
 * where these buildings stand relative to one another now matters.
 */
function missingInput(
  g: GameState,
  b: Building,
  r: Recipe,
): { res: ResourceId; qty: number; from: Building } | null {
  for (const i of inputsOf(r)) {
    if (onHand(b, i.res) >= i.qty) continue;
    const from = sourceOf(g, i.res, b.x, b.y);
    // Never fetch from yourself: `hasInputs` already counts what is here.
    if (!from || from.id === b.id) continue;
    const want = Math.min(
      CARRY_CAPACITY,
      from.store[i.res] ?? 0,
      // Top the bench up rather than fetching exactly one batch, so the walk is
      // worth making — but never past what the bench holds.
      Math.max(i.qty - (b.input[i.res] ?? 0), inputRoom(b, i.res)),
    );
    if (want <= 0) continue;
    return { res: i.res, qty: want, from };
  }
  return null;
}

/** The errand `missingInput` describes, as steps. */
function fetchLeg(g: GameState, b: Building, want: { res: ResourceId; qty: number; from: Building }): Step[] {
  const fdef = BUILDINGS[want.from.def];
  return [
    { t: 'move', x: want.from.x, y: want.from.y, goals: footprintApproach(g, want.from.x, want.from.y, fdef.w, fdef.h) },
    { t: 'take', res: want.res, qty: want.qty, from: 'store', id: want.from.id },
    approachSteps(g, b),
    { t: 'give', to: 'input', id: b.id },
  ];
}

/**
 * Millers, bakers and smiths: run a batch, or go and fetch what they lack.
 *
 * There is no third case any more. A workshop used to spend a good deal of its
 * time carrying its own output away to a barn; now what it makes is already
 * where it lives, so the only journeys left are the ones that fetch — which is
 * the half of the walking that was ever telling you anything.
 *
 * A workshop is still as capable of burying the kingdom as a woodcutter is, and
 * `chooseRecipe` is where that is stopped: nowhere to put another loaf, or more
 * meals in the kingdom than anybody wants, and the cooks go and be useful.
 */
function planProduce(g: GameState, v: Villager, b: Building): boolean {
  const def = BUILDINGS[b.def];
  if (liveRecipesOf(b.def).length === 0) return planGeneralWork(g, v);

  const recipe = chooseRecipe(g, b);
  if (!recipe) {
    const out = liveRecipesOf(b.def).map(recipeOutput).find((r) => roomIn(b, r) <= 0);
    if (out) noticeFull(g, out, b);
    return planGeneralWork(g, v);
  }

  if (hasInputs(b, recipe)) {
    planWalkTo(g, v, b, [
      { t: 'act', dur: recipe.seconds, kind: def.job === 'cook' ? 'cooking' : 'working', xp: def.job },
      { t: 'effect', kind: 'batch', id: b.id, res: recipeOutput(recipe) },
    ]);
    return true;
  }

  // Fetch raw materials personally rather than waiting for somebody else to
  // notice — and from the building that keeps them, which is a real walk.
  const want = missingInput(g, b, recipe);
  if (want) {
    v.plan = fetchLeg(g, b, want);
    return true;
  }

  return planGeneralWork(g, v);
}

/**
 * Everything nobody else is doing, in rough order of urgency: supply the sites,
 * build them, restock the workshops, clear a shelf that has run out of room,
 * and only then — and only below the reserve — go and fell a tree.
 *
 * The clearing rung is deliberately last but one and deliberately narrow. What
 * a building makes is kept where it was made; nothing is shuttled about for
 * tidiness, and in a kingdom with room to spare this rung never fires. It
 * exists only so that "full" is somewhere goods can leave rather than a wall
 * the whole trade stops at.
 *
 * This is the General Worker's whole trade, and every specialist falls through
 * to it the moment their own work has nothing in it.
 */
function planGeneralWork(g: GameState, v: Villager): boolean {
  // 1. Construction sites short of materials, fetched from wherever the kingdom
  //    keeps that material — the lodge for wood, the mine for stone.
  for (const b of g.buildings) {
    if (b.stage !== 'building') continue;
    const missing = missingMaterials(b);
    if (!missing) continue;
    if (isClaimed(g, 'supply', b.id, v.id)) continue;
    const from = sourceOf(g, missing.res, b.x, b.y);
    if (!from) continue;
    const qty = Math.min(CARRY_CAPACITY, missing.qty, from.store[missing.res] ?? 0);
    if (qty <= 0) continue;
    claim(g, v, 'supply', b.id);
    const sdef = BUILDINGS[from.def];
    v.plan = [
      { t: 'move', x: from.x, y: from.y, goals: footprintApproach(g, from.x, from.y, sdef.w, sdef.h) },
      { t: 'take', res: missing.res, qty, from: 'store', id: from.id },
      approachSteps(g, b),
      { t: 'give', to: 'site', id: b.id },
    ];
    return true;
  }

  // 2. Sites with all their materials, waiting on hands.
  for (const b of g.buildings) {
    if (b.stage !== 'building' || missingMaterials(b)) continue;
    const def = BUILDINGS[b.def];
    const crewCap = def.w * def.h >= 6 ? 3 : 2;
    let crew = 0;
    for (const o of g.villagers) if (o.id !== v.id && o.claim?.kind === 'labour' && o.claim.id === b.id) crew++;
    if (crew >= crewCap) continue;
    claim(g, v, 'labour', b.id);
    planWalkTo(g, v, b, [{ t: 'labour', id: b.id }]);
    return true;
  }

  // 3. Workshops running dry that nobody is currently supplying. The glut check
  //    is inside `chooseRecipe`: there is no sense carrying wheat to a mill that
  //    has stopped grinding it, or coal to a forge that has stopped burning it.
  for (const b of g.buildings) {
    if (b.stage !== 'done' || b.workers.length === 0) continue;
    if (liveRecipesOf(b.def).length === 0) continue;
    const recipe = chooseRecipe(g, b);
    if (!recipe || hasInputs(b, recipe)) continue;
    const want = missingInput(g, b, recipe);
    if (!want || want.qty < 2) continue;
    if (isClaimed(g, 'restock', b.id, v.id)) continue;
    claim(g, v, 'restock', b.id);
    v.plan = fetchLeg(g, b, want);
    return true;
  }

  /*
   * 4. Carry the surplus off a shelf that has run out of room, to somewhere
   *    that has not.
   *
   *    This rung was deleted when the shared store went, and the reasoning was
   *    sound at the time: the shelf *was* the barn, so there was nothing to move
   *    and nowhere to move it to. A storehouse is somewhere to move it to, and
   *    this is the whole of how bread, bars and a full mine's stone ever reach
   *    one — a cook cannot carry the loaf and go on baking at the same time.
   *
   *    It fires only on a compartment that is genuinely at its ceiling, so in an
   *    ordinary kingdom it never runs at all and goods stay where they were
   *    made. That is the point: it is a pressure valve, not a logistics layer,
   *    and a kingdom with room everywhere should look exactly as it did before.
   *
   *    A compartment whose ceiling has gone to *nothing* counts, and that is not
   *    a special case bolted on: a shelf with no room left is a shelf with no
   *    room left, whether it filled up or was closed. It is the whole of how the
   *    Base Camp's founding wood walks to the lodge once one opens — physically,
   *    an armful at a time, by somebody the player can watch doing it.
   */
  for (const b of g.buildings) {
    if (b.stage !== 'done') continue;
    const full = (Object.keys(b.store) as ResourceId[]).find(
      (res) => roomIn(b, res) <= 0 && (b.store[res] ?? 0) > 0,
    );
    if (!full) continue;
    if (isClaimed(g, 'clear', b.id, v.id)) continue;
    // Somewhere with *ordinary* room, and never back into the building it came
    // from — which cannot happen anyway, since that one has none.
    const to = homeFor(g, full, b.x, b.y);
    if (!to || to.id === b.id || roomIn(to, full) < 1) continue;
    const qty = Math.min(CARRY_CAPACITY, b.store[full] ?? 0, roomIn(to, full));
    if (qty < 1) continue;
    claim(g, v, 'clear', b.id);
    const def = BUILDINGS[b.def];
    v.plan = [
      { t: 'move', x: b.x, y: b.y, goals: footprintApproach(g, b.x, b.y, def.w, def.h) },
      { t: 'take', res: full, qty, from: 'store', id: b.id },
      ...homeLeg(g, to),
    ];
    return true;
  }

  // 5. Fell a tree, and only to keep the reserve up. Wood is the only thing
  //    hands alone can fetch — stone comes out of a quarry or it does not come
  //    at all — and this is emergency stock rather than a supply: enough that a
  //    kingdom with no lodge, or a lodge nobody is standing in, can always dig
  //    itself out, and never enough to build an economy on. That is the
  //    woodcutter's job, and it is the reason to have one.
  if (totalOf(g, 'wood') < WOOD_RESERVE && planGatherWood(g, v, 'general')) return true;

  return false;
}

/**
 * What a site is being paid: its own cost, the cost of the improvement under
 * way, or — for the empty ground a building is moving onto — the cost of the
 * move. Three cases, one function, so somebody supplying a relocation is simply
 * somebody supplying a site and no planner needed a word changing.
 */
export function siteCost(b: Building): Partial<Record<ResourceId, number>> {
  if (b.relocOf) return relocateCost(b.def);
  return b.upgrading ? upgradeCostOf(b.def, b.level) : BUILDINGS[b.def].cost;
}

function missingMaterials(b: Building): { res: ResourceId; qty: number } | null {
  const cost = siteCost(b);
  for (const k in cost) {
    const res = k as ResourceId;
    const have = b.delivered[res] ?? 0;
    if (have < (cost[res] ?? 0)) return { res, qty: (cost[res] ?? 0) - have };
  }
  return null;
}

/** Material checklist for a site, for the selection panel. */
export function siteNeeds(b: Building): { res: ResourceId; need: number; have: number }[] {
  const cost = siteCost(b);
  const out: { res: ResourceId; need: number; have: number }[] = [];
  for (const k in cost) {
    const res = k as ResourceId;
    out.push({ res, need: cost[res] ?? 0, have: b.delivered[res] ?? 0 });
  }
  return out;
}

export function labourNeeded(b: Building): number {
  if (b.relocOf) return relocateLabour(b.def);
  return BUILDINGS[b.def].labour * (b.upgrading ? 1.4 : 1);
}

// ---------------------------------------------------------------------------
// Leisure — the half of the simulation with no numbers attached
// ---------------------------------------------------------------------------

const LEISURE_BUILDINGS = new Set(['bench', 'well', 'statue', 'flowerbed', 'commons', 'kitchen']);
/** Places people sit down at rather than stand and look at. */
const SITTING_PLACES = new Set(['bench', 'commons']);

/**
 * A newcomer's first walk: in to the fire, rather than to wherever the planner
 * would otherwise have sent them. It earns nothing and costs a minute, which is
 * rather the point — somebody arrives, and the middle of the kingdom is where
 * they go.
 */
export function planArrivalWelcome(g: GameState, v: Villager): void {
  const camp = commonsOf(g);
  if (!camp || camp.stage !== 'done') {
    speak(v, 'Room for one more?');
    return;
  }
  planWalkTo(g, v, camp, [
    { t: 'say', text: 'Room for one more?' },
    { t: 'act', dur: rng.range(10, 18), kind: 'watching' },
  ]);
}

/**
 * `gathering` is a scheduled break rather than an odd half hour with nothing to
 * do, and it bends the roll toward the commons and the comforts. That is the
 * whole of what makes the three breaks readable: at seven, at noon and at nine
 * the kingdom visibly collects itself instead of sixteen people each wandering
 * off in their own direction. Everything else is still on the table — the pond,
 * the animals, somebody to talk to — just less often.
 */
function planLeisure(g: GameState, v: Villager, gathering = false): void {
  const r = rng;
  const roll = r.next();

  if (roll < (gathering ? 0.62 : 0.34)) {
    const spots = g.buildings.filter((b) => b.stage === 'done' && LEISURE_BUILDINGS.has(b.def));
    if (spots.length > 0) {
      // On a break the fire wins most of the time even when it is not the
      // nearest spot, which is what turns a break into a gathering.
      const camp = commonsOf(g);
      const b = gathering && camp && camp.stage === 'done' && r.chance(0.55) ? camp : pickNear(r, spots, v.x, v.y);
      const def = BUILDINGS[b.def];
      const goals = footprintApproach(g, b.x, b.y, def.w, def.h);
      if (goals.length) {
        // People stay at the commons longer than anywhere else and are twice as
        // likely to say something there, which is the whole of what makes it the
        // middle of the kingdom rather than a large box of wood.
        const social = b.def === 'commons';
        v.plan = [
          { t: 'move', x: b.x, y: b.y, goals },
          { t: 'act', dur: social ? r.range(16, 38) : r.range(10, 26), kind: SITTING_PLACES.has(b.def) ? 'resting' : 'watching' },
        ];
        maybeSay(g, v, r, social ? 0.34 : 0.15);
        return;
      }
    }
  }

  if (roll < 0.5) {
    const spot = findWaterEdge(g, v.x, v.y, 14, r);
    if (spot) {
      v.plan = [
        { t: 'move', x: spot.x, y: spot.y },
        { t: 'act', dur: r.range(14, 30), kind: r.chance(0.4) ? 'fishing' : 'watching' },
      ];
      maybeSay(g, v, r);
      return;
    }
  }

  if (roll < 0.62 && g.animals.length > 0) {
    const a = r.pick(g.animals);
    if (dist(a.x, a.y, v.x, v.y) < 18 && isWalkable(g, Math.round(a.x), Math.round(a.y))) {
      v.plan = [
        { t: 'move', x: Math.round(a.x), y: Math.round(a.y) },
        { t: 'act', dur: r.range(6, 14), kind: 'watching' },
        { t: 'say', text: r.pick(CHATTER.animal) },
      ];
      return;
    }
  }

  if (roll < 0.76 && g.villagers.length > 1) {
    const others = g.villagers.filter((o) => o.id !== v.id && dist(o.x, o.y, v.x, v.y) < 16);
    if (others.length) {
      const o = r.pick(others);
      const goals = neighbours(g, Math.round(o.x), Math.round(o.y));
      if (goals.length) {
        v.plan = [
          { t: 'move', x: Math.round(o.x), y: Math.round(o.y), goals },
          { t: 'say', text: r.pick(CHATTER.day) },
          { t: 'act', dur: r.range(8, 18), kind: 'chatting' },
        ];
        return;
      }
    }
  }

  const range = v.trait === 'curious' ? 16 : 9;
  for (let i = 0; i < 12; i++) {
    const a = r.range(0, Math.PI * 2);
    const d = r.range(3, range);
    const x = Math.round(v.x + Math.cos(a) * d);
    const y = Math.round(v.y + Math.sin(a) * d);
    if (!isWalkable(g, x, y)) continue;
    v.plan = [
      { t: 'move', x, y },
      { t: 'act', dur: r.range(5, 16), kind: 'idle' },
    ];
    maybeSay(g, v, r);
    return;
  }

  v.plan = [{ t: 'act', dur: r.range(4, 9), kind: 'idle' }];
}

function pickNear(r: RNG, list: Building[], x: number, y: number): Building {
  let best = list[0];
  let bestD = Infinity;
  for (const b of list) {
    const d = dist(b.x, b.y, x, y) + r.range(0, 7);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function findWaterEdge(g: GameState, x: number, y: number, radius: number, r: RNG): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  const x0 = Math.max(0, Math.floor(x - radius));
  const x1 = Math.min(g.w - 1, Math.ceil(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius));
  const y1 = Math.min(g.h - 1, Math.ceil(y + radius));
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      const t = g.tiles[ty * g.w + tx];
      if (t.terrain !== 'sand' && t.terrain !== 'grass') continue;
      if (!isWalkable(g, tx, ty)) continue;
      let nearWater = false;
      for (let dy = -1; dy <= 1 && !nearWater; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const n = tileAt(g, tx + dx, ty + dy);
          if (n && (n.terrain === 'water' || n.terrain === 'shallow')) {
            nearWater = true;
            break;
          }
        }
      if (!nearWater) continue;
      const d = (tx - x) ** 2 + (ty - y) ** 2 + r.range(0, 40);
      if (d < bestD) {
        bestD = d;
        best = { x: tx, y: ty };
      }
    }
  return best;
}

function maybeSay(g: GameState, v: Villager, r: RNG, chance = 0.15): void {
  if (!r.chance(chance)) return;
  const pool = v.hunger > 0.8 ? CHATTER.hungry : g.dayT > 0.62 ? CHATTER.night : CHATTER.day;
  speak(v, r.pick(pool));
}

export function speak(v: Villager, text: string): void {
  if (!text) return;
  v.say = { text, ttl: 3.8 };
}

// ---------------------------------------------------------------------------
// Background world upkeep
// ---------------------------------------------------------------------------

function growCrops(g: GameState, dt: number): void {
  const growMul = SEASON_GROWTH[g.season] ?? 1;
  for (const b of g.buildings) {
    if (b.stage !== 'done' || b.plots.length === 0) continue;
    // Unstaffed farms still creep along, just slowly.
    const tended = b.workers.length > 0 ? 1 : 0.3;
    for (const p of b.plots) {
      if (p.state !== 'growing') continue;
      p.growth += (dt / PLOT_GROW_SECONDS) * growMul * tended;
      if (p.growth >= 1) {
        p.growth = 1;
        p.state = 'ripe';
      }
    }
  }
}

/**
 * Worked-out trees become stumps, and stumps come back.
 *
 * Boulders are not swept, because nothing works one out any more: the only thing
 * that ever removes a boulder is building over it, and that is meant to be
 * permanent. Surface rock is the finite half of the kingdom's stone and the mine
 * is the endless half.
 */
let sweepCursor = 0;
function sweepDepletedNodes(g: GameState): void {
  for (let i = 0; i < 300; i++) {
    sweepCursor = (sweepCursor + 1) % g.tiles.length;
    const t = g.tiles[sweepCursor];
    if (t.amount > 0 || t.regrow > 0) continue;
    if (t.prop === 'tree') {
      t.prop = 'stump';
      t.regrow = TREE_REGROW;
      t.claimed = 0;
    }
  }
}
