/** GameState construction plus the shared queries every other system leans on. */

import { RNG, clamp, nextId, rng, seedGameplayRng, setIdFloor } from '../core/util';
import type {
  Building,
  BuildingId,
  GameState,
  JobId,
  ResourceId,
  Season,
  TraitId,
  Villager,
  VillagerAppearance,
} from '../types';
import { PREPARED_FOODS, RESOURCE_ORDER, emptyStock } from '../types';
import {
  BUILDINGS,
  DAYS_PER_SEASON,
  FOOD_CHAIN_VALUE,
  FOOD_COMFORT_FLOOR,
  FOOD_COMFORT_PER_HEAD,
  TRAIT_IDS,
  buildingName,
} from './defs';
import { generateMap, tileAt } from '../world/terrain';
import { makeName } from './names';
import { buildGoals } from './goals';
import { newWildlifeTimers } from './wildlife';

const SKIN = ['#f0c9a0', '#e0ad84', '#c98e63', '#a9714a', '#8a5836', '#6b4228', '#f6dcc0'];
const HAIR = ['#3a2a1e', '#59402a', '#8a6134', '#b98b4a', '#d9c08a', '#6e6e72', '#c4c0b8', '#8a3f2a'];
const SHIRT = ['#7a9c62', '#5d84a8', '#a8695d', '#8c7ba8', '#c49a4e', '#6e8f8a', '#a05c78', '#7d7f8c', '#b3733c'];
const TROUSER = ['#4a4038', '#5a5148', '#3d4652', '#63513f', '#4c5442'];

export function makeAppearance(r: RNG): VillagerAppearance {
  return {
    skin: r.pick(SKIN),
    hair: r.pick(HAIR),
    shirt: r.pick(SHIRT),
    trousers: r.pick(TROUSER),
    hat: r.weighted([0, 1, 2, 3] as const, [55, 20, 15, 10]),
    hairStyle: r.weighted([0, 1, 2] as const, [50, 30, 20]),
  };
}

export function makeVillager(g: GameState, r: RNG, x: number, y: number, name?: string): Villager {
  const used = new Set(g.villagers.map((v) => v.name));
  return {
    id: nextId(),
    name: name ?? makeName(r, used),
    x,
    y,
    face: 0,
    job: 'general',
    workplace: 0,
    home: 0,
    homeFixed: false,
    trait: r.pick(TRAIT_IDS) as TraitId,
    xp: {},
    carrying: null,
    appearance: makeAppearance(r),
    favorite: false,
    // Everybody turns up with an opinion about supper and no say in the matter
    // when their own is not in store. It is worth nothing to anyone.
    favoriteFood: r.pick(PREPARED_FOODS),
    arrived: g.day,
    // Nobody has been looked at yet. The founder is the exception and says so
    // for itself in `newGame`: the opening is entirely about watching them.
    met: false,
    history: [],
    // Their own small shift on the day's outer ends, and a little extra wobble
    // on bedtime. Both are clamped where they are read, so an old kingdom whose
    // people were rolled against a looser schedule still keeps its breaks.
    wakeOffset: r.range(-0.015, 0.015),
    sleepOffset: r.range(-0.01, 0.01),
    energy: 1,
    hunger: r.range(0.2, 0.5),
    underworkedDay: 0,
    extraMealDay: 0,
    activity: 'idle',
    plan: [],
    path: null,
    pathIndex: 0,
    actLeft: 0,
    actTotal: 0,
    say: null,
    claim: null,
    phase: r.range(0, Math.PI * 2),
    thinkCooldown: 0,
    stuck: 0,
  };
}

export function makeBuilding(g: GameState, def: BuildingId, x: number, y: number, r: RNG): Building {
  return {
    id: nextId(),
    def,
    x,
    y,
    level: 1,
    stage: 'planned',
    delivered: {},
    labour: 0,
    input: {},
    output: {},
    progress: 0,
    workers: [],
    residents: [],
    plots: [],
    upgrading: false,
    built: g.day,
    seed: r.int(0, 9999),
  };
}

export function newGame(seed = Math.floor(Math.random() * 1e9)): GameState {
  const r = new RNG(seed);
  const map = generateMap(seed);
  // The gameplay RNG starts from the world's own seed rather than the clock, so
  // a kingdom's weather, wildlife and arrivals are a property of the world and
  // not of the minute it happened to be created in.
  seedGameplayRng(seed);

  const g: GameState = {
    seed,
    clock: 0,
    played: 0,
    day: 1,
    year: 1,
    season: 'spring',
    // Mid-morning: past every villager's latest possible waking time, so the
    // founder is at work the moment the game opens rather than idling first.
    dayT: 0.17,
    speed: 1,
    paused: false,
    tiles: map.tiles,
    w: map.w,
    h: map.h,
    buildings: [],
    villagers: [],
    animals: [],
    stock: emptyStock(),
    journal: [],
    goals: [],
    unlocked: new Set<string>(),
    discovered: new Set(),
    toasts: [],
    storeFullNotice: 0,
    // Nobody is on the road yet — the first companion starts walking when the
    // camp's second bed exists, not on a clock that was running beforehand.
    arrival: { progress: 0, jitter: rng.range(-1, 1) },
    weather: 0,
    weatherTimer: 400,
    weatherKind: 'clear',
    claims: new Map(),
    wildlife: newWildlifeTimers(),
    founderId: 0,
    founding: { stage: 'arriving', x: map.start.x, y: map.start.y },
    splashes: [],
    stats: { built: 0, harvested: 0, baked: 0, cooked: 0, caught: 0, arrivals: 1, mined: 0, smelted: 0 },
    nameSeq: 0,
  };
  g.goals = buildGoals();

  // Nothing is here yet — no fire, no store, no bed. The founder walks up the
  // beach with empty hands and the player decides where they stop; see
  // `sim/founding.ts` for what that one decision turns into.
  const founder = makeVillager(g, r, map.arrival.x, map.arrival.y);
  founder.favorite = true;
  founder.activity = 'arriving';
  // The opening is three minutes of watching this one person, so they need no
  // mark saying somebody new has turned up. Everybody after them does.
  founder.met = true;
  founder.history.push({ day: 1, text: 'Walked up the beach with nothing at all.' });
  g.villagers.push(founder);
  g.founderId = founder.id;

  return g;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Whether a building is doing its job. A finished one is, and so is one being
 * improved: making a camp into a commons does not empty its stores, and a cabin
 * under scaffolding still has beds in it. Without this, improving the kingdom's
 * only store takes its capacity to nothing, which leaves nobody able to fetch
 * materials for the very work under way — a deadlock, and one the headless run
 * found at once.
 */
export function isOperational(b: Building): boolean {
  return b.stage === 'done' || b.upgrading;
}

/** Total shared storage from every building that provides it and is in service. */
export function storageCapacity(g: GameState): number {
  let cap = 0;
  for (const b of g.buildings) {
    if (!isOperational(b)) continue;
    const def = BUILDINGS[b.def];
    if (def.storage) cap += def.storage[Math.min(b.level, def.storage.length) - 1];
  }
  return cap;
}

/** Everything physically stacked in the kingdom's stores — which is everything. */
export function storageUsed(g: GameState): number {
  let n = 0;
  for (const res of RESOURCE_ORDER) n += g.stock[res];
  return n;
}

export function storageFree(g: GameState): number {
  return Math.max(0, storageCapacity(g) - storageUsed(g));
}

/**
 * Everything in store that somebody could sit down and eat — loaves and cooked
 * fish together, never one of the two. Every question about whether the kingdom
 * is fed goes through here, which is what keeps the two branches of the food
 * chain genuinely interchangeable rather than one of them being the real one
 * and the other a garnish.
 */
export function preparedFood(g: GameState): number {
  let n = 0;
  for (const res of PREPARED_FOODS) n += g.stock[res];
  return n;
}

/**
 * How much cooked food the kingdom is comfortable holding. Past this the cooks
 * ease off — the same idea as a woodcutter downing tools in front of a full
 * barn, measured against the mouths there are to feed rather than against the
 * size of the barn, because those are different questions.
 */
export function foodComfort(g: GameState): number {
  return g.villagers.length * FOOD_COMFORT_PER_HEAD + FOOD_COMFORT_FLOOR;
}

/**
 * Every meal the kingdom has or is one or two steps away from having — cooked
 * food, raw fish, flour and standing wheat, each counted for what it will end
 * up being worth on a plate.
 *
 * The whole chain looks at this rather than at its own shelf, so easing off
 * happens all the way up it at once. A kingdom that stops cooking and carries
 * on milling has only moved the pile.
 */
export function foodPotential(g: GameState): number {
  let n = 0;
  for (const k in FOOD_CHAIN_VALUE) {
    const res = k as ResourceId;
    n += g.stock[res] * (FOOD_CHAIN_VALUE[res] ?? 0);
  }
  return n;
}

/** Adds to the shared store, clipped by capacity. Returns the amount actually accepted. */
export function deposit(g: GameState, res: ResourceId, qty: number): number {
  if (qty <= 0) return 0;
  const room = storageFree(g);
  const take = Math.min(qty, room);
  g.stock[res] += take;
  return take;
}

/**
 * A villager setting down a load they are already carrying. Unlike `deposit`
 * this never refuses, and that is the whole point: capacity decides when people
 * stop fetching *more*, never whether something already in someone's arms can
 * be put away. Refusing it deadlocks the kingdom — the planner will not make a
 * new plan for anybody still holding goods, so a full store used to leave a
 * villager walking to the barn and back forever, unable to build anything.
 *
 * The store therefore reads slightly over capacity while deliveries land. That
 * is honest: the barn is full and there is still a load on its way in.
 */
export function deliver(g: GameState, res: ResourceId, qty: number): void {
  if (qty <= 0) return;
  g.stock[res] += qty;
}

/** Removes from the shared store. Returns the amount actually withdrawn. */
export function withdraw(g: GameState, res: ResourceId, qty: number): number {
  const take = Math.min(qty, g.stock[res]);
  g.stock[res] -= take;
  return take;
}

export function canAfford(g: GameState, cost: Partial<Record<ResourceId, number>>): boolean {
  for (const k in cost) {
    const res = k as ResourceId;
    if (g.stock[res] < (cost[res] ?? 0)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export function buildingById(g: GameState, id: number): Building | null {
  if (!id) return null;
  for (const b of g.buildings) if (b.id === id) return b;
  return null;
}

/**
 * The building somebody is asleep inside, or null. Sleeping is not on its own
 * enough to be indoors: the commons' beds are bedrolls by the fire and stay in
 * view, and anybody with no bed at all rests where they stand. Only a
 * `sheltered` home takes its residents in — which is what lets the renderer
 * leave them out of the world and show them through the walls on hover instead.
 */
export function sleepingIndoors(g: GameState, v: Villager): Building | null {
  if (v.activity !== 'sleeping') return null;
  const home = buildingById(g, v.home);
  if (!home || !BUILDINGS[home.def].sheltered || home.stage !== 'done') return null;
  return home;
}

export function villagerById(g: GameState, id: number): Villager | null {
  if (!id) return null;
  for (const v of g.villagers) if (v.id === id) return v;
  return null;
}

/**
 * Takes a building off the map: tiles freed, staff and sleepers turned loose,
 * everybody made to think again. Refunds are the player's business and stay in
 * `Game.removeBuilding`, which calls this for the rest of it.
 */
export function removeBuilding(g: GameState, b: Building): void {
  const def = BUILDINGS[b.def];
  // A half-finished move is one arrangement across two records, so taking down
  // either end tidies the other: removing the building being moved abandons the
  // ground it was moving to, and abandoning the ground leaves the building
  // exactly where it was, still working.
  if (b.movingTo) {
    const site = buildingById(g, b.movingTo);
    b.movingTo = undefined;
    if (site) removeBuilding(g, site);
  }
  if (b.relocOf) {
    const origin = buildingById(g, b.relocOf);
    if (origin) origin.movingTo = undefined;
  }

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

  for (const v of g.villagers) {
    if (v.workplace === b.id) assignJob(g, v, 0);
    if (v.home === b.id) {
      v.home = 0;
      // The bed you chose for them no longer exists, so the choice goes with it.
      v.homeFixed = false;
      assignHome(g, v);
    }
    abandonPlan(g, v);
  }
  g.buildings = g.buildings.filter((x) => x.id !== b.id);
}

export function buildingCentre(b: Building): { x: number; y: number } {
  const def = BUILDINGS[b.def];
  return { x: b.x + def.w / 2, y: b.y + def.h / 2 };
}

/** Nearest usable storage building to a point, or null if the kingdom has none. */
export function nearestStore(g: GameState, x: number, y: number): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of g.buildings) {
    if (!isOperational(b)) continue;
    const def = BUILDINGS[b.def];
    if (!def.storage) continue;
    const c = buildingCentre(b);
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/**
 * Every bed in the kingdom, which is also the most people it can hold — there
 * is no separate population cap behind this number. A building being improved
 * keeps the beds it already had; the new ones turn up when the work is done.
 */
export function housingCapacity(g: GameState): number {
  let cap = 0;
  for (const b of g.buildings) {
    if (!isOperational(b)) continue;
    const def = BUILDINGS[b.def];
    if (def.housing) cap += def.housing[Math.min(b.level, def.housing.length) - 1];
  }
  return cap;
}

/**
 * Beds standing empty. Goes negative when housing has been taken down out from
 * under people, which is allowed and costs nobody their place: arrivals simply
 * wait until the kingdom has room again.
 */
export function bedsFree(g: GameState): number {
  return housingCapacity(g) - g.villagers.length;
}

/**
 * Where the beds actually are, for the population panel. Named the way the
 * player knows them: a commons by whatever it is called at this level, anything
 * there are several of in the plural.
 */
export function bedSources(g: GameState): { label: string; beds: number }[] {
  const rows = new Map<BuildingId, { beds: number; count: number; label: string }>();
  for (const b of g.buildings) {
    if (!isOperational(b)) continue;
    const beds = homeCapacity(b);
    if (beds <= 0) continue;
    const row = rows.get(b.def) ?? { beds: 0, count: 0, label: '' };
    row.beds += beds;
    row.count++;
    row.label =
      b.def === 'commons'
        ? buildingName(b.def, b.level)
        : row.count > 1
          ? `${BUILDINGS[b.def].name}s`
          : BUILDINGS[b.def].name;
    rows.set(b.def, row);
  }
  return [...rows.values()].map((r) => ({ label: r.label, beds: r.beds }));
}

export function homeCapacity(b: Building): number {
  const def = BUILDINGS[b.def];
  if (!def.housing) return 0;
  return def.housing[Math.min(b.level, def.housing.length) - 1];
}

export function jobSlots(b: Building): number {
  const def = BUILDINGS[b.def];
  if (!def.slots) return 0;
  return def.slots[Math.min(b.level, def.slots.length) - 1];
}

/**
 * A finished workplace with a trade and nobody whatever at it. Deliberately not
 * "short-handed": a quarry with one miner of three is a quarry that works, and
 * marking every unfilled slot would put a mark on nearly every building nearly
 * all the time, which is a mark nobody reads. Nobody at all is the one case
 * where the building is standing there doing nothing and the player is the only
 * one who can change it.
 */
export function wantsWorker(b: Building): boolean {
  if (b.stage !== 'done' || !BUILDINGS[b.def].job) return false;
  return jobSlots(b) > 0 && b.workers.length === 0;
}

/** Assigns a villager to a workplace, clearing any previous post. Pass 0 to make them a General Worker. */
export function assignJob(g: GameState, v: Villager, buildingId: number): boolean {
  const prev = buildingById(g, v.workplace);
  if (prev) prev.workers = prev.workers.filter((id) => id !== v.id);

  if (!buildingId) {
    v.workplace = 0;
    v.job = 'general';
    abandonPlan(g, v);
    return true;
  }
  const b = buildingById(g, buildingId);
  if (!b || b.stage !== 'done') return false;
  const def = BUILDINGS[b.def];
  if (!def.job || b.workers.length >= jobSlots(b)) return false;
  b.workers.push(v.id);
  v.workplace = b.id;
  v.job = def.job;
  abandonPlan(g, v);
  return true;
}

/** Places a villager in a home with a free bed, preferring the nearest. */
export function assignHome(g: GameState, v: Villager): void {
  const prev = buildingById(g, v.home);
  if (prev && prev.residents.includes(v.id)) {
    if (isOperational(prev) && prev.residents.length <= homeCapacity(prev)) return;
    prev.residents = prev.residents.filter((id) => id !== v.id);
  }
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of g.buildings) {
    if (!isOperational(b) || homeCapacity(b) === 0) continue;
    if (b.residents.length >= homeCapacity(b)) continue;
    const c = buildingCentre(b);
    // Nobody chooses a bedroll by the fire over a roof, so the commons is only
    // ever a fallback once there is a house with a spare bed anywhere at all.
    const penalty = b.def === 'commons' ? 400 : 0;
    const d = (c.x - v.x) ** 2 + (c.y - v.y) ** 2 + penalty;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  v.home = best ? best.id : 0;
  if (best) best.residents.push(v.id);
}

/**
 * Puts a villager in a particular bed because the player said so. Pass 0 to
 * hand them back to `assignHome` and let them settle wherever suits.
 *
 * A hand-placed bed sets `homeFixed`, which is the whole point of it: without
 * that flag a finished cabin would quietly collect anyone sleeping rough and
 * undo the arrangement the player just made.
 */
export function setHome(g: GameState, v: Villager, buildingId: number): boolean {
  const prev = buildingById(g, v.home);
  if (buildingId === 0) {
    if (prev) prev.residents = prev.residents.filter((id) => id !== v.id);
    v.home = 0;
    v.homeFixed = false;
    assignHome(g, v);
    abandonPlan(g, v);
    return true;
  }
  const b = buildingById(g, buildingId);
  if (!b || !isOperational(b) || homeCapacity(b) === 0) return false;
  if (b.id === v.home) {
    // Already living here — the player is only pinning them in place.
    v.homeFixed = true;
    return true;
  }
  if (b.residents.length >= homeCapacity(b)) return false;
  if (prev) prev.residents = prev.residents.filter((id) => id !== v.id);
  b.residents.push(v.id);
  v.home = b.id;
  v.homeFixed = true;
  // Rethink at once: someone already asleep gets up and walks to the new bed.
  abandonPlan(g, v);
  return true;
}

// ---------------------------------------------------------------------------
// Claims — stop two villagers walking to the same tree
// ---------------------------------------------------------------------------

export function claimKey(kind: string, id: number): string {
  return `${kind}:${id}`;
}

export function isClaimed(g: GameState, kind: string, id: number, by?: number): boolean {
  const holder = g.claims.get(claimKey(kind, id));
  if (holder === undefined) return false;
  return by === undefined ? true : holder !== by;
}

export function claim(g: GameState, v: Villager, kind: string, id: number, x?: number, y?: number): void {
  releaseClaim(g, v);
  g.claims.set(claimKey(kind, id), v.id);
  v.claim = { kind, id, x, y };
  if (kind === 'node' && x !== undefined && y !== undefined) {
    const t = tileAt(g, x, y);
    if (t) t.claimed = v.id;
  }
}

export function releaseClaim(g: GameState, v: Villager): void {
  if (!v.claim) return;
  const { kind, id, x, y } = v.claim;
  const key = claimKey(kind, id);
  if (g.claims.get(key) === v.id) g.claims.delete(key);

  if (kind === 'node' && x !== undefined && y !== undefined) {
    const t = tileAt(g, x, y);
    if (t && t.claimed === v.id) t.claimed = 0;
  } else if (kind === 'plot') {
    // Plot claims are keyed farmId*100+slot; a farmer may hold more than one.
    const farm = buildingById(g, Math.floor(id / 100));
    if (farm) for (const p of farm.plots) if (p.claimed === v.id) p.claimed = 0;
  }
  v.claim = null;
}

/** Drops the current plan; anything carried goes back where it came from next tick. */
export function abandonPlan(g: GameState, v: Villager): void {
  releaseClaim(g, v);
  v.plan = [];
  v.path = null;
  v.pathIndex = 0;
  v.actLeft = 0;
  v.thinkCooldown = 0;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export function seasonForDay(day: number): { season: Season; year: number } {
  const seasonIndex = Math.floor((day - 1) / DAYS_PER_SEASON) % 4;
  const year = Math.floor((day - 1) / (DAYS_PER_SEASON * 4)) + 1;
  const seasons: Season[] = ['spring', 'summer', 'autumn', 'winter'];
  return { season: seasons[seasonIndex], year };
}

/** 0 at deep night, 1 at midday. Drives lighting and most schedules. */
export function daylight(dayT: number): number {
  if (dayT < 0.04) return clamp(dayT / 0.04, 0, 1) * 0.85;
  if (dayT < 0.6) return 1;
  if (dayT < 0.72) return 1 - (dayT - 0.6) / 0.12;
  return 0;
}

export function isNight(dayT: number): boolean {
  return dayT >= 0.7 || dayT < 0.015;
}

export function xpOf(v: Villager, job: JobId): number {
  return v.xp[job] ?? 0;
}

export function addXp(v: Villager, job: JobId, amount: number): void {
  const before = v.xp[job] ?? 0;
  v.xp[job] = clamp(before + amount, 0, 100);
}

export function restoreIdCounter(g: GameState): void {
  let max = 0;
  for (const b of g.buildings) max = Math.max(max, b.id);
  for (const v of g.villagers) max = Math.max(max, v.id);
  for (const a of g.animals) max = Math.max(max, a.id);
  setIdFloor(max);
}
