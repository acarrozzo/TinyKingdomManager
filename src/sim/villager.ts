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
import {
  BALANCE_TARGET,
  BUILDINGS,
  CARRY_CAPACITY,
  MINE_SECONDS,
  MINE_YIELD,
  SEVERE_HUNGER,
  TERRAIN_SPEED,
  buildingName,
  extractsOf,
  liveRecipesOf,
  outputsOf,
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
  homeCapacity,
  isClaimed,
  nearestStore,
  releaseClaim,
  storageCapacity,
  storageFree,
  withdraw,
  xpOf,
} from './state';
import { TREE_REGROW, findNode, isWalkable, rockInRange, tileAt } from '../world/terrain';
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
const INPUT_CAP = 14;
const OUTPUT_CAP = 14;
const CHOP_SECONDS = 4.5;
const CHOP_YIELD = 3;
const PLANT_SECONDS = 3.5;
const HARVEST_SECONDS = 3.5;
const HARVEST_YIELD = 3;
const PLOT_GROW_SECONDS = 200;

/**
 * Hand-gathering stops once the kingdom has comfortably enough of something.
 *
 * Wood is the only entry, and that is the whole of the early economy: stone
 * cannot be gathered by hand at all, so a kingdom's stone is exactly what its
 * quarry has produced. See `planHelper`.
 */
const GATHER_TARGET: Record<string, number> = { wood: 120 };
/**
 * …and no more than this share of whatever the kingdom can actually hold. With
 * a storehouse up this never binds, but a Base Camp holds sixty, and without a
 * ceiling helpers would fill it with timber and leave the kingdom unable to
 * afford the very improvement that would fix it.
 */
const GATHER_SHARE: Record<string, number> = { wood: 0.5 };

function gatherTarget(g: GameState, res: ResourceId): number {
  const cap = storageCapacity(g);
  if (cap <= 0) return GATHER_TARGET[res];
  return Math.min(GATHER_TARGET[res], Math.max(12, cap * GATHER_SHARE[res]));
}

/** Seasons change how fast wheat comes on. Winter is slow, never fatal. */
const SEASON_GROWTH: Record<string, number> = { spring: 1.1, summer: 1.3, autumn: 0.9, winter: 0.35 };

/**
 * True when one good has taken over the stores. Specialists then go and do
 * something else instead of burying the kingdom under the same material —
 * production slows rather than jamming, which is the whole idea.
 */
function glutOf(g: GameState, res: ResourceId): boolean {
  const cap = storageCapacity(g);
  if (cap <= 0) return false;
  return g.stock[res] > cap * 0.35;
}

/**
 * Says once, quietly, that the stores are full. Work does not stop dead — the
 * kingdom simply gathers no more of what it cannot put anywhere — but without
 * a word the player just sees their woodcutters wander off for no reason.
 */
function noticeStoreFull(g: GameState): void {
  if (g.storeFullNotice > 0) return;
  g.storeFullNotice = 900;
  toast(g, 'The stores are full — nobody is gathering more for now', '📦', 'warn');
}

export function updateVillagers(g: GameState, dt: number): void {
  g.storeFullNotice = Math.max(0, g.storeFullNotice - dt);
  for (const v of g.villagers) updateVillager(g, v, dt);
  growCrops(g, dt);
  sweepDepletedNodes(g);
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
  if (v.trait === 'crafty' && (job === 'baker' || job === 'miller')) m *= 1.2;
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
  const label = job.charAt(0).toUpperCase() + job.slice(1);
  journal(g, `${v.name} became a Master ${label}.`, '★');
  note(g, v.id, `Mastered the ${job}'s trade.`);
  toast(g, `${v.name} — Master ${label}`, '★', 'good');
}

function doTake(g: GameState, v: Villager, step: Extract<Step, { t: 'take' }>): void {
  let got = 0;
  if (step.from === 'store') {
    got = withdraw(g, step.res, step.qty);
  } else if (step.from === 'building') {
    const b = buildingById(g, step.id ?? 0);
    if (b) {
      const have = b.output[step.res] ?? 0;
      got = Math.min(have, step.qty);
      b.output[step.res] = have - got;
    }
  } else {
    const t = tileAt(g, step.x ?? Math.round(v.x), step.y ?? Math.round(v.y));
    if (t) {
      got = Math.min(t.amount, step.qty);
      t.amount -= got;
    }
  }
  if (got <= 0) return;
  if (v.carrying && v.carrying.res === step.res) v.carrying.qty += got;
  else if (!v.carrying) v.carrying = { res: step.res, qty: got };
  else {
    deliver(g, v.carrying.res, v.carrying.qty);
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

  if (step.to === 'store') {
    deliver(g, res, qty);
    return;
  }
  const b = buildingById(g, step.id ?? 0);
  if (!b) {
    // The building went away mid-walk. Keep hold of the load and re-decide;
    // handing it to a store is not always possible, and never during founding.
    if (v.carrying && v.carrying.res === res) v.carrying.qty += qty;
    else v.carrying = { res, qty };
    return;
  }
  if (step.to === 'site') b.delivered[res] = (b.delivered[res] ?? 0) + qty;
  else b.input[res] = (b.input[res] ?? 0) + qty;
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
      if (v.carrying?.res === 'bread' && v.carrying.qty > 0) {
        v.carrying.qty -= 1;
        if (v.carrying.qty <= 0) v.carrying = null;
        v.hunger = 0;
        v.energy = Math.min(1, v.energy + 0.08);
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
    case 'extract': {
      const b = buildingById(g, step.id ?? 0);
      const res = step.res;
      if (!b || !res) break;
      const got = MINE_YIELD[res] ?? 2;
      b.output[res] = (b.output[res] ?? 0) + got;
      // Only stone is counted, and only because the mine's own improvements ask
      // for it. It has to be an accomplishment rather than a stock level: what
      // is in the store goes down again the moment anybody builds a cabin.
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
      for (const k in recipe.inputs) {
        const res = k as ResourceId;
        if ((b.input[res] ?? 0) < (recipe.inputs[res] ?? 0)) return;
      }
      for (const k in recipe.inputs) {
        const res = k as ResourceId;
        b.input[res] = (b.input[res] ?? 0) - (recipe.inputs[res] ?? 0);
      }
      for (const k in recipe.outputs) {
        const res = k as ResourceId;
        const made = recipe.outputs[res] ?? 0;
        b.output[res] = (b.output[res] ?? 0) + made;
        if (res === 'bread') {
          if (g.stats.baked === 0) {
            journal(g, `${v.name} baked the kingdom's first bread.`, '🍞');
            note(g, v.id, 'Baked the first loaf in the kingdom.');
          }
          g.stats.baked += made;
        }
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
  const rate = (v.trait === 'crafty' ? 1.2 : 1) * (0.85 + xpOf(v, 'helper') * 0.004);
  b.labour += dt * rate;
  addXp(v, 'helper', xpGain(xpOf(v, 'helper'), dt));

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
    if (def.plots) makePlots(g, b);
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
  if (def.plots) makePlots(g, b);

  const name = buildingName(b.def, b.level);
  toast(g, `The ${name.toLowerCase()} is standing at its new spot`, '🧭', 'good');
  journal(g, `The ${name.toLowerCase()} was taken apart and put back up on better ground.`, '🧭');

  // Everybody re-decides: half the kingdom was walking towards the old corner.
  for (const v of g.villagers) abandonPlan(g, v);
}

function makePlots(g: GameState, b: Building): void {
  const def = BUILDINGS[b.def];
  b.plots = [];
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      if (dx === 0 && dy === 0) continue; // barn corner
      const x = b.x + dx;
      const y = b.y + dy;
      const t = tileAt(g, x, y);
      if (!t || t.terrain === 'water' || t.terrain === 'shallow') continue;
      t.prop = null;
      t.plot = b.id;
      b.plots.push({ x, y, state: 'empty', growth: 0, claimed: 0 });
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

function wakeTime(v: Villager): number {
  let t = 0.035 + v.wakeOffset;
  if (v.trait === 'earlyRiser') t -= 0.03;
  if (v.trait === 'nightOwl') t += 0.05;
  return clamp(t, 0, 0.2);
}

function bedTime(v: Villager): number {
  let t = 0.72 + v.sleepOffset;
  if (v.trait === 'nightOwl') t += 0.14;
  if (v.trait === 'earlyRiser') t -= 0.04;
  return clamp(t, 0.62, 0.95);
}

function isWorkTime(g: GameState, v: Villager): boolean {
  const start = wakeTime(v) + 0.02;
  const end = v.trait === 'nightOwl' ? 0.68 : 0.62;
  return g.dayT >= start && g.dayT < end;
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
    const store = nearestStore(g, v.x, v.y);
    if (store) {
      planWalkTo(g, v, store, [{ t: 'give', to: 'store' }]);
      if (v.plan.length) return;
    }
    deliver(g, v.carrying.res, v.carrying.qty);
    v.carrying = null;
  }

  if (!buildingById(g, v.home)) assignHome(g, v);

  if (shouldSleep(g, v) && v.energy < 0.92) {
    if (planSleep(g, v)) return;
  }
  if (v.hunger > 0.7 && g.stock.bread >= 1) {
    if (planEat(g, v)) return;
  }
  // Founding comes ahead of ordinary work and is not held to work hours: the
  // walk up the beach is the first thing that happens, whatever the clock says.
  if (foundingActive(g) && planFounding(g, v)) return;
  if (isWorkTime(g, v) && planWork(g, v)) return;

  planLeisure(g, v);
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
  if (held < want && planGatherNode(g, v, 'tree', 24, 'helper', false, false)) return true;

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

function planEat(g: GameState, v: Villager): boolean {
  const store = nearestStore(g, v.x, v.y);
  if (!store) return false;
  planWalkTo(g, v, store, [
    { t: 'take', res: 'bread', qty: 1, from: 'store' },
    { t: 'act', dur: 7, kind: 'eating' },
    { t: 'effect', kind: 'eat' },
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
      case 'miller':
      case 'baker':
      case 'smith':
        return planProduce(g, v, workplace);
      default:
        break;
    }
  }
  return planHelper(g, v);
}

function storeLeg(g: GameState, store: Building): Step[] {
  const def = BUILDINGS[store.def];
  return [
    { t: 'move', x: store.x, y: store.y, goals: footprintApproach(g, store.x, store.y, def.w, def.h) },
    { t: 'give', to: 'store' },
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
  if (storageFree(g) < 4) {
    noticeStoreFull(g);
    return planLeisureFallback(g, v, 'Nowhere to put it.');
  }
  // Plenty of this already: lend a hand elsewhere rather than filling the barn.
  if (glutOf(g, 'wood')) return planHelper(g, v);

  // The reach drawn on the map when this was placed is the reach used here.
  const reach = rangeOf(workplace.def, workplace.level);
  const c = buildingCentre(workplace);
  const node = findNode(g, c.x, c.y, 'tree', reach) ?? findNode(g, v.x, v.y, 'tree', reach + 7);
  if (!node) return planHelper(g, v);

  const goals = neighbours(g, node.x, node.y);
  if (goals.length === 0) return planHelper(g, v);
  claim(g, v, 'node', node.y * g.w + node.x, node.x, node.y);

  const trips = clamp(Math.floor(CARRY_CAPACITY / CHOP_YIELD), 1, 4);
  const steps: Step[] = [{ t: 'move', x: node.x, y: node.y, goals }];
  for (let i = 0; i < trips; i++) {
    steps.push({ t: 'act', dur: CHOP_SECONDS, kind: 'gathering', xp: 'woodcutter' });
    steps.push({ t: 'take', res: 'wood', qty: CHOP_YIELD, from: 'tile', x: node.x, y: node.y });
  }
  const store = nearestStore(g, node.x, node.y);
  if (store) steps.push(...storeLeg(g, store));
  v.plan = steps;
  return true;
}

// ---------------------------------------------------------------------------
// The mine
// ---------------------------------------------------------------------------

/** Everything sitting on a building's output shelf, whatever it is. */
function shelfTotal(b: Building): number {
  let n = 0;
  for (const k in b.output) n += b.output[k as ResourceId] ?? 0;
  return n;
}

/** The largest single thing on the shelf, which is what a trip to the store takes. */
function biggestOnShelf(b: Building): { res: ResourceId; qty: number } | null {
  let best: { res: ResourceId; qty: number } | null = null;
  for (const k in b.output) {
    const res = k as ResourceId;
    const qty = b.output[res] ?? 0;
    if (qty > 0 && (!best || qty > best.qty)) best = { res, qty };
  }
  return best;
}

/**
 * What this mine's people are getting out today.
 *
 * A focus is a preference, not an instruction that can fail. If the kingdom
 * already has more of the favoured material than it can sensibly store, the mine
 * quietly works on something else rather than stopping — the same
 * nothing-is-ever-punishing rule the rest of the game runs on. Balanced means
 * "whatever we are shortest of", measured against `BALANCE_TARGET` rather than
 * against each other, because a kingdom wants far more stone than it does ore.
 *
 * Mithril is filtered out unconditionally. The level that would list it cannot
 * be reached, and this is the second lock on that.
 */
function chooseExtraction(g: GameState, b: Building): ResourceId | null {
  const all: ResourceId[] = extractsOf(b.def, b.level).filter((r) => r !== 'mithrilOre');
  const open = all.filter((r) => !glutOf(g, r));
  if (open.length === 0) return null;
  const focus = b.focus;
  if (focus && focus !== 'balanced' && open.includes(focus as ResourceId)) return focus as ResourceId;
  let best = open[0];
  let bestShare = Infinity;
  for (const res of open) {
    const share = g.stock[res] / (BALANCE_TARGET[res] ?? 100);
    if (share < bestShare) {
      bestShare = share;
      best = res;
    }
  }
  return best;
}

/**
 * Miners: a stint at the rock face, then the load down to the store.
 *
 * There is no node to walk to and nothing to claim, because the seam is the
 * ground the building stands on — the work happens at the mine and the only
 * thing the site decides is how fast, through how much rock is inside its reach.
 * The trip to the store is still a walk somebody makes, so the material still
 * arrives in the kingdom by being carried there.
 */
function planExtract(g: GameState, v: Villager, mine: Building): boolean {
  const store = nearestStore(g, mine.x, mine.y);
  const shelf = shelfTotal(mine);
  const res = chooseExtraction(g, mine);

  // Clear the shelf when it is worth a trip, or when there is nothing worth
  // cutting — a full shelf must never be the reason a mine stands still.
  const load = biggestOnShelf(mine);
  if (store && load && storageFree(g) > 0 && (shelf >= CARRY_CAPACITY || !res || shelf >= OUTPUT_CAP)) {
    planWalkTo(g, v, mine, [
      { t: 'take', res: load.res, qty: Math.min(load.qty, CARRY_CAPACITY), from: 'building', id: mine.id },
      ...storeLeg(g, store),
    ]);
    return true;
  }

  if (storageFree(g) < 4) {
    noticeStoreFull(g);
    return planLeisureFallback(g, v, 'Nowhere to put it.');
  }
  // Everything this mine can reach is already piled high. Go and be useful.
  if (!res) return planHelper(g, v);

  const c = buildingCentre(mine);
  const rock = rockInRange(g, c.x, c.y, rangeOf(mine.def, mine.level));
  planWalkTo(g, v, mine, [
    { t: 'act', dur: MINE_SECONDS / richnessMul(rock), kind: 'gathering', xp: 'miner' },
    { t: 'effect', kind: 'extract', id: mine.id, res },
  ]);
  return true;
}

/**
 * What one kind of node gives up by hand, and how long a go at it takes.
 *
 * Trees, and only trees. A boulder is not on this list on purpose: breaking one
 * is quarry work, so there is no path through `planGatherNode` that produces
 * stone and no way for a helper to find one. Stoneworkers go through
 * `planHarvestNode` instead, which is reached only from a staffed quarry.
 */
const NODE_WORK: Partial<Record<PropId, { res: ResourceId; per: number; seconds: number }>> = {
  tree: { res: 'wood', per: CHOP_YIELD, seconds: CHOP_SECONDS },
};

/**
 * Hand-gathering: walk to the nearest node of a kind, work it until an armful
 * is up, and haul that to the nearest store. `slow` is the untrained penalty,
 * which the founding deliberately does not apply: the opening is one tree and
 * one load, and it wants to read as deliberate rather than laborious. `haul` is
 * off only during founding, where there is no store to walk to and the load
 * stays in the founder's arms.
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
  const store = haul ? nearestStore(g, node.x, node.y) : null;
  if (haul && !store) return false;

  claim(g, v, 'node', node.y * g.w + node.x, node.x, node.y);
  // Never swing at a node for longer than it has left in it, nor for more than
  // there is room in your arms for.
  const left = tileAt(g, node.x, node.y)?.amount ?? 0;
  const room = CARRY_CAPACITY - (v.carrying?.res === work.res ? v.carrying.qty : 0);
  const trips = clamp(Math.min(Math.floor(room / work.per), Math.ceil(left / work.per)), 1, 4);
  const steps: Step[] = [{ t: 'move', x: node.x, y: node.y, goals }];
  for (let i = 0; i < trips; i++) {
    steps.push({ t: 'act', dur: work.seconds * (slow ? 1.25 : 1), kind: 'gathering', xp });
    steps.push({ t: 'take', res: work.res, qty: work.per, from: 'tile', x: node.x, y: node.y });
  }
  if (store) steps.push(...storeLeg(g, store));
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

/** Farmers reap ripe plots first, then sow empty ones. */
function planFarm(g: GameState, v: Villager, farm: Building): boolean {
  let ripe = -1;
  let empty = -1;
  let ripeD = Infinity;
  let emptyD = Infinity;
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
    }
  }

  if (ripe >= 0 && storageFree(g) >= 4 && !glutOf(g, 'wheat')) {
    const p = farm.plots[ripe];
    p.claimed = v.id;
    claim(g, v, 'plot', farm.id * 100 + ripe);
    const steps: Step[] = [
      { t: 'move', x: p.x, y: p.y },
      { t: 'act', dur: HARVEST_SECONDS, kind: 'harvesting', xp: 'farmer' },
      { t: 'effect', kind: 'reap', id: farm.id, slot: ripe },
    ];
    // Chain a neighbouring harvest so farmers are not forever walking to store.
    const second = farm.plots.findIndex((q, i) => i !== ripe && q.state === 'ripe' && !q.claimed);
    if (second >= 0) {
      const q = farm.plots[second];
      q.claimed = v.id;
      steps.push(
        { t: 'move', x: q.x, y: q.y },
        { t: 'act', dur: HARVEST_SECONDS, kind: 'harvesting', xp: 'farmer' },
        { t: 'effect', kind: 'reap', id: farm.id, slot: second },
      );
    }
    const store = nearestStore(g, p.x, p.y);
    if (store) steps.push(...storeLeg(g, store));
    v.plan = steps;
    return true;
  }

  if (empty >= 0) {
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

  return planHelper(g, v);
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

/** Everything for one batch is already on the workshop's own shelves. */
function hasInputs(b: Building, r: Recipe): boolean {
  return inputsOf(r).every((i) => (b.input[i.res] ?? 0) >= i.qty);
}

/** The shelves plus the store between them could cover one batch. */
function couldSupply(g: GameState, b: Building, r: Recipe): boolean {
  return inputsOf(r).every((i) => (b.input[i.res] ?? 0) + g.stock[i.res] >= i.qty);
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
  const runnable = liveRecipesOf(b.def).filter(
    (r) => !glutOf(g, recipeOutput(r)) && couldSupply(g, b, r),
  );
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
    const share = g.stock[out] / (BALANCE_TARGET[out] ?? 100);
    if (share < bestShare) {
      bestShare = share;
      best = r;
    }
  }
  return best;
}

/** What this workshop is short of for a given recipe, and could fetch today. */
function missingInput(g: GameState, b: Building, r: Recipe): { res: ResourceId; qty: number } | null {
  for (const i of inputsOf(r)) {
    const held = b.input[i.res] ?? 0;
    if (held >= i.qty) continue;
    if (g.stock[i.res] <= 0) continue;
    return { res: i.res, qty: Math.min(CARRY_CAPACITY, g.stock[i.res], Math.max(i.qty, INPUT_CAP) - held) };
  }
  return null;
}

/** Millers, bakers and smiths: run a batch, clear the shelf, or fetch what they lack. */
function planProduce(g: GameState, v: Villager, b: Building): boolean {
  const def = BUILDINGS[b.def];
  if (liveRecipesOf(b.def).length === 0) return planHelper(g, v);

  const store = nearestStore(g, b.x, b.y);
  // A workshop is as capable of burying the kingdom as a woodcutter is, and for
  // a while nothing stopped one: a mill with wheat coming in and no bakery yet
  // built ground every last sheaf into flour, filled the store with it, and
  // left everybody else — the miners who would have cut the stone the bakery
  // was waiting on — with nowhere to put anything down. The rule is the same one
  // the gatherers follow: past a third of the whole store, go and be useful
  // elsewhere. `chooseRecipe` is where that happens; clearing the shelf below is
  // deliberately left running, so a workshop that has already made the stuff
  // still gets it carried off.
  const recipe = chooseRecipe(g, b);
  const shelf = shelfTotal(b);
  const load = biggestOnShelf(b);

  // Clear the output shelf before it jams the workshop.
  if (
    store &&
    load &&
    storageFree(g) > 0 &&
    (shelf >= CARRY_CAPACITY || shelf >= OUTPUT_CAP || !recipe || !hasInputs(b, recipe))
  ) {
    planWalkTo(g, v, b, [
      { t: 'take', res: load.res, qty: Math.min(load.qty, CARRY_CAPACITY), from: 'building', id: b.id },
      ...storeLeg(g, store),
    ]);
    return true;
  }

  if (!recipe) return planHelper(g, v);

  if (hasInputs(b, recipe) && shelf < OUTPUT_CAP) {
    planWalkTo(g, v, b, [
      { t: 'act', dur: recipe.seconds, kind: 'working', xp: def.job },
      { t: 'effect', kind: 'batch', id: b.id, res: recipeOutput(recipe) },
    ]);
    return true;
  }

  // Fetch raw materials personally rather than waiting for a helper to notice.
  const want = store ? missingInput(g, b, recipe) : null;
  if (store && want) {
    const sdef = BUILDINGS[store.def];
    v.plan = [
      { t: 'move', x: store.x, y: store.y, goals: footprintApproach(g, store.x, store.y, sdef.w, sdef.h) },
      { t: 'take', res: want.res, qty: want.qty, from: 'store' },
      approachSteps(g, b),
      { t: 'give', to: 'building', id: b.id },
    ];
    return true;
  }

  return planHelper(g, v);
}

/** Everything nobody else is doing, in rough order of urgency. */
function planHelper(g: GameState, v: Villager): boolean {
  // 1. Construction sites short of materials.
  for (const b of g.buildings) {
    if (b.stage !== 'building') continue;
    const missing = missingMaterials(b);
    if (!missing) continue;
    if (isClaimed(g, 'supply', b.id, v.id)) continue;
    const store = nearestStore(g, b.x, b.y);
    if (!store) continue;
    const qty = Math.min(CARRY_CAPACITY, missing.qty, g.stock[missing.res]);
    if (qty <= 0) continue;
    claim(g, v, 'supply', b.id);
    const sdef = BUILDINGS[store.def];
    v.plan = [
      { t: 'move', x: store.x, y: store.y, goals: footprintApproach(g, store.x, store.y, sdef.w, sdef.h) },
      { t: 'take', res: missing.res, qty, from: 'store' },
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
    const store = nearestStore(g, b.x, b.y);
    if (!store) continue;
    claim(g, v, 'restock', b.id);
    const sdef = BUILDINGS[store.def];
    v.plan = [
      { t: 'move', x: store.x, y: store.y, goals: footprintApproach(g, store.x, store.y, sdef.w, sdef.h) },
      { t: 'take', res: want.res, qty: want.qty, from: 'store' },
      approachSteps(g, b),
      { t: 'give', to: 'building', id: b.id },
    ];
    return true;
  }

  // 4. Anywhere with finished goods piling up — a workshop's shelf or a mine's.
  for (const b of g.buildings) {
    if (b.stage !== 'done') continue;
    if (outputsOf(b.def, b.level).length === 0) continue;
    const load = biggestOnShelf(b);
    if (!load || load.qty < 4 || storageFree(g) < 2) continue;
    if (isClaimed(g, 'collect', b.id, v.id)) continue;
    const store = nearestStore(g, b.x, b.y);
    if (!store) continue;
    claim(g, v, 'collect', b.id);
    v.plan = [
      approachSteps(g, b),
      { t: 'take', res: load.res, qty: Math.min(load.qty, CARRY_CAPACITY), from: 'building', id: b.id },
      ...storeLeg(g, store),
    ];
    return true;
  }

  // 5. Fell a tree. Wood is the only thing hands alone can fetch: stone comes
  //    out of a quarry or it does not come at all, which is what makes the
  //    quarry the kingdom's second real decision rather than a convenience.
  if (storageFree(g) < 6) noticeStoreFull(g);
  else if (g.stock.wood < gatherTarget(g, 'wood') && planGatherWood(g, v, 'helper')) return true;

  return false;
}

/**
 * What a site is being paid: its own cost, the cost of the improvement under
 * way, or — for the empty ground a building is moving onto — the cost of the
 * move. Three cases, one function, so helpers supplying a relocation are simply
 * helpers supplying a site and no planner needed a word changing.
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

const LEISURE_BUILDINGS = new Set(['bench', 'well', 'statue', 'flowerbed', 'commons', 'bakery']);
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

function planLeisureFallback(g: GameState, v: Villager, line: string): boolean {
  speak(v, line);
  planLeisure(g, v);
  return true;
}

function planLeisure(g: GameState, v: Villager): void {
  const r = rng;
  const roll = r.next();

  if (roll < 0.34) {
    const spots = g.buildings.filter((b) => b.stage === 'done' && LEISURE_BUILDINGS.has(b.def));
    if (spots.length > 0) {
      const b = pickNear(r, spots, v.x, v.y);
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
