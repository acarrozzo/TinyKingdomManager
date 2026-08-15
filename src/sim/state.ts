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
    arrivalTimer: DAY_LENGTH * 0.6,
    weather: 0,
    weatherTimer: 400,
    weatherKind: 'clear',
    claims: new Map(),
    founderId: 0,
    stats: { built: 0, harvested: 0, baked: 0, arrivals: 1 },
    nameSeq: 0,
  };
  g.goals = buildGoals();

  // The campfire is the kingdom's first landmark: a scrap of storage and a bed.
  const fire = makeBuilding(g, 'campfire', map.start.x, map.start.y, r);
  fire.stage = 'done';
  g.buildings.push(fire);
  const ft = tileAt(g, fire.x, fire.y);
  if (ft) {
    ft.building = fire.id;
    ft.prop = null;
  }

  const founder = makeVillager(g, r, map.start.x + 1, map.start.y + 1);
  founder.home = fire.id;
  founder.favorite = true;
  founder.history.push({ day: 1, text: 'Arrived, alone, and decided this would do.' });
  fire.residents.push(founder.id);
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
