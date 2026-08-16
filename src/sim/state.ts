/** GameState construction plus the shared queries every other system leans on. */

import { RNG, clamp, nextId, setIdFloor } from '../core/util';
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
import { STORED_RESOURCES, emptyStock } from '../types';
import { BUILDINGS, DAY_LENGTH, DAYS_PER_SEASON, TRAIT_IDS } from './defs';
import { generateMap, tileAt } from '../world/terrain';
import { makeName } from './names';
import { buildGoals } from './goals';

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
    job: 'helper',
    workplace: 0,
    home: 0,
    homeFixed: false,
    trait: r.pick(TRAIT_IDS) as TraitId,
    xp: {},
    carrying: null,
    appearance: makeAppearance(r),
    favorite: false,
    arrived: g.day,
    history: [],
    wakeOffset: r.range(-0.02, 0.035),
    sleepOffset: r.range(-0.025, 0.04),
    energy: 1,
    hunger: r.range(0.2, 0.5),
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

/**
 * Drops a chest on a free tile beside the fire and hands back the building.
 * Only the save loader calls this now, fitting one to kingdoms that predate the
 * chest — without it they would have no storage at all. A new kingdom's chest is
 * built by hand, like everything else.
 */
export function placeChest(g: GameState, fire: Building, r: RNG): Building | null {
  // Grid neighbours first: on an isometric map those sit diagonally beside the
  // fire on screen, where a diagonal neighbour lands directly behind it and the
  // two sprites merge into one confusing object.
  const offsets: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
    [-1, -1],
  ];
  for (let ring = 2; ring <= 4; ring++) {
    for (let d = -ring; d <= ring; d++) {
      offsets.push([d, -ring], [d, ring], [-ring, d], [ring, d]);
    }
  }

  for (const [dx, dy] of offsets) {
    const x = fire.x + dx;
    const y = fire.y + dy;
    const t = tileAt(g, x, y);
    if (!t || t.building || t.plot) continue;
    if (t.terrain === 'water' || t.terrain === 'shallow') continue;

    const chest = makeBuilding(g, 'chest', x, y, r);
    chest.stage = 'done';
    g.buildings.push(chest);
    t.building = chest.id;
    t.prop = null;
    return chest;
  }
  return null;
}

export function newGame(seed = Math.floor(Math.random() * 1e9)): GameState {
  const r = new RNG(seed);
  const map = generateMap(seed);

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
    arrivalTimer: DAY_LENGTH * 0.6,
    weather: 0,
    weatherTimer: 400,
    weatherKind: 'clear',
    claims: new Map(),
    founderId: 0,
    founding: { stage: 'arriving', x: map.start.x, y: map.start.y },
    stats: { built: 0, harvested: 0, baked: 0, arrivals: 1 },
    nameSeq: 0,
  };
  g.goals = buildGoals();

  // Nothing is here yet — no fire, no store, no bed. The founder walks up the
  // beach with empty hands and the player decides where they stop; see
  // `sim/founding.ts` for what that turns into.
  const founder = makeVillager(g, r, map.arrival.x, map.arrival.y);
  founder.favorite = true;
  founder.activity = 'arriving';
  founder.history.push({ day: 1, text: 'Walked up the beach with nothing at all.' });
  g.villagers.push(founder);
  g.founderId = founder.id;

  return g;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Total shared storage from every completed building that provides it. */
export function storageCapacity(g: GameState): number {
  let cap = 0;
  for (const b of g.buildings) {
    if (b.stage !== 'done') continue;
    const def = BUILDINGS[b.def];
    if (def.storage) cap += def.storage[Math.min(b.level, def.storage.length) - 1];
  }
  return cap;
}

/** Everything physically stacked in the kingdom's stores (coins excluded). */
export function storageUsed(g: GameState): number {
  let n = 0;
  for (const res of STORED_RESOURCES) n += g.stock[res];
  return n;
}

export function storageFree(g: GameState): number {
  return Math.max(0, storageCapacity(g) - storageUsed(g));
}

/** Adds to the shared store, clipped by capacity. Returns the amount actually accepted. */
export function deposit(g: GameState, res: ResourceId, qty: number): number {
  if (qty <= 0) return 0;
  if (res === 'coin') {
    g.stock.coin += qty;
    return qty;
  }
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

export function villagerById(g: GameState, id: number): Villager | null {
  if (!id) return null;
  for (const v of g.villagers) if (v.id === id) return v;
  return null;
}

/**
 * Takes a building off the map: tiles freed, staff and sleepers turned loose,
 * everybody made to think again. Refunds are the player's business and stay in
 * `Game.removeBuilding`; this is the part the simulation needs too, for the
 * chest quietly replacing the woodpile it grew out of.
 */
export function removeBuilding(g: GameState, b: Building): void {
  const def = BUILDINGS[b.def];
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

/** Nearest completed storage building to a point, or null if the kingdom has none. */
export function nearestStore(g: GameState, x: number, y: number): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of g.buildings) {
    if (b.stage !== 'done') continue;
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

export function housingCapacity(g: GameState): number {
  let cap = 0;
  for (const b of g.buildings) {
    if (b.stage !== 'done') continue;
    const def = BUILDINGS[b.def];
    if (def.housing) cap += def.housing[Math.min(b.level, def.housing.length) - 1];
  }
  return cap;
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

/** Assigns a villager to a workplace, clearing any previous post. Pass 0 to make them a Helper. */
export function assignJob(g: GameState, v: Villager, buildingId: number): boolean {
  const prev = buildingById(g, v.workplace);
  if (prev) prev.workers = prev.workers.filter((id) => id !== v.id);

  if (!buildingId) {
    v.workplace = 0;
    v.job = 'helper';
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
    if (prev.stage === 'done' && prev.residents.length <= homeCapacity(prev)) return;
    prev.residents = prev.residents.filter((id) => id !== v.id);
  }
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of g.buildings) {
    if (b.stage !== 'done' || homeCapacity(b) === 0) continue;
    if (b.residents.length >= homeCapacity(b)) continue;
    const c = buildingCentre(b);
    // Slightly prefer real houses over the campfire once they exist.
    const penalty = b.def === 'campfire' ? 400 : 0;
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
 * that flag a finished cottage would quietly collect anyone sleeping rough and
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
  if (!b || b.stage !== 'done' || homeCapacity(b) === 0) return false;
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
