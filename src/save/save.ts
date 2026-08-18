/**
 * Save slots in localStorage, plus JSON export/import so a kingdom can be
 * backed up or moved between machines.
 *
 * Transient state (plans, paths, claims) is deliberately not saved: villagers
 * simply re-decide what to do the moment the kingdom loads.
 */

import type { GameState, SpeciesId, Villager } from '../types';
import { emptyStock } from '../types';
import { buildGoals } from '../sim/goals';
import { restoreIdCounter } from '../sim/state';
import { SURVEY_INTERVAL, newWildlifeTimers } from '../sim/wildlife';
import { clamp, rng, seedGameplayRng } from '../core/util';

const SLOT_INDEX = 'tkm.slots';
const SLOT_PREFIX = 'tkm.save.';
const SETTINGS_KEY = 'tkm.settings';
/**
 * 2: the kingdom is founded rather than handed over — nothing at all standing
 * until somebody builds it, and a `founding` block that version 1 has no
 * equivalent for.
 * 3: one Cabin replaces the Shelter and the Cottage, so any save holding either
 * refers to a building that no longer exists.
 * 4: the world's luck is part of the world. The gameplay RNG's position and the
 * wildlife's pacing are written down, so reopening a kingdom continues it rather
 * than re-rolling its future — and a version 3 file has neither, so its animals
 * would arrive on a different schedule than the one it was saved on.
 * 5: one commons replaces the campfire and the chest, and deadfall is gone from
 * the world, so a version 4 file names three things that no longer exist and
 * has no heart to its kingdom at all.
 * 6: stone comes only from a quarry, and the kingdom keeps a limited number of
 * each building. A version 5 kingdom can hold four storehouses where two are
 * now allowed, and its quarry was bought partly with stone that nothing in this
 * version could have produced — so its economy is not one this version could
 * ever have arrived at.
 * 7: the quarry became a mine that grows — Quarry, Iron Mine, Deep Mine — and
 * six materials exist that did not: iron ore, coal, iron bars, steel bars and
 * the two mithril entries nothing yet produces. A version 6 quarry harvested
 * boulders that regrew; this one cuts into the ground it stands on and boulders
 * never come back. Neither the stores nor the buildings mean the same thing.
 * 8: fishing, and the Bakery became the Kitchen. A version 7 file names a
 * building and a trade that no longer exist, has no fish or cooked fish in a
 * stock that now has both, and has no record of how rested any of its water is.
 * Older files are refused rather than guessed at.
 */
export const SAVE_VERSION = 8;

export interface SlotInfo {
  id: string;
  name: string;
  day: number;
  year: number;
  season: string;
  population: number;
  played: number;
  savedAt: number;
}

export interface Settings {
  volume: number;
  muted: boolean;
  showBubbles: boolean;
  showNames: boolean;
  showActivity: boolean;
  lastSlot: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.6,
  muted: false,
  showBubbles: true,
  showNames: true,
  showActivity: true,
  lastSlot: null,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable; settings simply won't persist */
  }
}

export function listSlots(): SlotInfo[] {
  try {
    const raw = localStorage.getItem(SLOT_INDEX);
    if (!raw) return [];
    const list = JSON.parse(raw) as SlotInfo[];
    return Array.isArray(list) ? list.sort((a, b) => b.savedAt - a.savedAt) : [];
  } catch {
    return [];
  }
}

function writeIndex(list: SlotInfo[]): void {
  try {
    localStorage.setItem(SLOT_INDEX, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function newSlotId(): string {
  return `k${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function saveToSlot(g: GameState, slotId: string, name: string): boolean {
  const payload = serialize(g);
  try {
    localStorage.setItem(SLOT_PREFIX + slotId, JSON.stringify(payload));
  } catch {
    return false;
  }
  const list = listSlots().filter((s) => s.id !== slotId);
  list.push({
    id: slotId,
    name,
    day: g.day,
    year: g.year,
    season: g.season,
    population: g.villagers.length,
    played: g.played,
    savedAt: Date.now(),
  });
  writeIndex(list);
  return true;
}

export function loadFromSlot(slotId: string): GameState | null {
  try {
    const raw = localStorage.getItem(SLOT_PREFIX + slotId);
    if (!raw) return null;
    return deserialize(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function deleteSlot(slotId: string): void {
  try {
    localStorage.removeItem(SLOT_PREFIX + slotId);
  } catch {
    /* ignore */
  }
  writeIndex(listSlots().filter((s) => s.id !== slotId));
}

export function renameSlot(slotId: string, name: string): void {
  const list = listSlots();
  const s = list.find((x) => x.id === slotId);
  if (!s) return;
  s.name = name;
  writeIndex(list);
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

interface SavePayload {
  version: number;
  [key: string]: unknown;
}

export function serialize(g: GameState): SavePayload {
  return {
    version: SAVE_VERSION,
    seed: g.seed,
    // Where the gameplay RNG had got to. Without this a kingdom's future is
    // re-rolled every time it is opened, which quietly makes reloading a way of
    // shopping for weather and wildlife.
    rngState: rng.state,
    clock: g.clock,
    played: g.played,
    day: g.day,
    year: g.year,
    season: g.season,
    dayT: g.dayT,
    speed: g.speed,
    w: g.w,
    h: g.h,
    // Tiles are packed into parallel arrays: far smaller than an array of objects.
    tiles: packTiles(g),
    buildings: g.buildings.map((b) => ({
      id: b.id,
      def: b.def,
      x: b.x,
      y: b.y,
      level: b.level,
      stage: b.stage,
      delivered: b.delivered,
      labour: b.labour,
      input: b.input,
      output: b.output,
      progress: b.progress,
      workers: b.workers,
      residents: b.residents,
      plots: b.plots.map((p) => ({ x: p.x, y: p.y, state: p.state, growth: p.growth })),
      upgrading: b.upgrading,
      // What the mine or the forge has been told to concentrate on. Saved
      // because it is a decision the player made about a particular building,
      // and finding it back at Balanced after a reload would read as the game
      // having quietly overruled them.
      focus: b.focus,
      // A move under way is two records pointing at each other, and both ends
      // are saved: closing the tab in the middle of moving the quarry should
      // find it still on its way, not silently back where it started.
      movingTo: b.movingTo,
      relocOf: b.relocOf,
      built: b.built,
      seed: b.seed,
      name: b.name,
    })),
    villagers: g.villagers.map((v) => ({
      id: v.id,
      name: v.name,
      x: v.x,
      y: v.y,
      face: v.face,
      job: v.job,
      workplace: v.workplace,
      home: v.home,
      homeFixed: v.homeFixed,
      trait: v.trait,
      xp: v.xp,
      carrying: v.carrying,
      appearance: v.appearance,
      favorite: v.favorite,
      favoriteFood: v.favoriteFood,
      arrived: v.arrived,
      history: v.history,
      wakeOffset: v.wakeOffset,
      sleepOffset: v.sleepOffset,
      energy: v.energy,
      hunger: v.hunger,
    })),
    animals: g.animals.map((a) => ({
      id: a.id,
      species: a.species,
      x: a.x,
      y: a.y,
      name: a.name,
      favorite: a.favorite,
      seen: a.seen,
      ttl: a.ttl,
    })),
    stock: g.stock,
    journal: g.journal,
    goalsDone: g.goals.filter((x) => x.done).map((x) => x.id),
    unlocked: [...g.unlocked],
    discovered: [...g.discovered],
    arrival: g.arrival,
    weather: g.weather,
    weatherTimer: g.weatherTimer,
    weatherKind: g.weatherKind,
    founderId: g.founderId,
    founding: g.founding,
    wildlife: g.wildlife,
    stats: g.stats,
  };
}

function packTiles(g: GameState) {
  const n = g.tiles.length;
  const terrain: string[] = new Array(n);
  const prop: string[] = new Array(n);
  const variant = new Uint8Array(n);
  const amount = new Uint16Array(n);
  const regrow = new Float32Array(n);
  const building = new Int32Array(n);
  const plot = new Int32Array(n);
  const blocked = new Uint8Array(n);
  // How rested each stretch of water is, as hundredths. A kingdom reopened with
  // every spot back at full would make closing the tab the fastest way to
  // freshen the lake, which is the same bug the wildlife cooldowns had.
  const fish = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = g.tiles[i];
    terrain[i] = t.terrain;
    prop[i] = t.prop ?? '';
    variant[i] = t.variant;
    amount[i] = t.amount;
    regrow[i] = t.regrow;
    building[i] = t.building;
    plot[i] = t.plot;
    blocked[i] = t.blocked ? 1 : 0;
    fish[i] = Math.round(clamp(t.fish, 0, 1) * 100);
  }
  return {
    terrain: rle(terrain),
    prop: rle(prop),
    variant: [...variant],
    amount: [...amount],
    regrow: [...regrow].map((x) => Math.round(x)),
    building: [...building],
    plot: [...plot],
    blocked: [...blocked],
    // Water is overwhelmingly either untouched or dry land, so this packs down
    // to almost nothing — the same reason terrain and props are run-length
    // encoded rather than written out per tile.
    fish: rle([...fish].map(String)),
  };
}

/** Run-length encoding — terrain and props are extremely repetitive. */
function rle(arr: string[]): (string | number)[] {
  const out: (string | number)[] = [];
  let i = 0;
  while (i < arr.length) {
    let j = i;
    while (j < arr.length && arr[j] === arr[i]) j++;
    out.push(arr[i], j - i);
    i = j;
  }
  return out;
}

function unrle(data: (string | number)[], length: number): string[] {
  const out: string[] = new Array(length);
  let k = 0;
  for (let i = 0; i < data.length; i += 2) {
    const value = data[i] as string;
    const count = data[i + 1] as number;
    for (let j = 0; j < count && k < length; j++) out[k++] = value;
  }
  return out;
}

export function deserialize(raw: unknown): GameState {
  const p = raw as Record<string, any>;
  if (!p || typeof p !== 'object') throw new Error('Not a kingdom file.');
  if (typeof p.w !== 'number' || !Array.isArray(p.villagers)) throw new Error('Kingdom file is missing its world.');
  if ((p.version ?? 1) < SAVE_VERSION) {
    throw new Error('That kingdom was made by an older version of the game, and cannot be opened. Start a new one.');
  }

  const n = p.w * p.h;
  const packed = p.tiles;
  const terrain = unrle(packed.terrain, n);
  const prop = unrle(packed.prop, n);
  const fish = packed.fish ? unrle(packed.fish, n) : null;

  const tiles = new Array(n);
  for (let i = 0; i < n; i++) {
    // Kingdoms saved before roads were removed still carry paved tiles; they
    // grass over rather than falling through to an unknown terrain sprite.
    const ter = terrain[i] === 'road' || terrain[i] === 'path' ? 'grass' : terrain[i];
    tiles[i] = {
      terrain: ter as GameState['tiles'][number]['terrain'],
      prop: prop[i] ? (prop[i] as GameState['tiles'][number]['prop']) : null,
      variant: packed.variant[i] ?? 0,
      amount: packed.amount[i] ?? 0,
      regrow: packed.regrow[i] ?? 0,
      building: packed.building[i] ?? 0,
      blocked: !!(packed.blocked ? packed.blocked[i] : packed.building[i]),
      plot: packed.plot[i] ?? 0,
      claimed: 0,
      fish: fish ? clamp(Number(fish[i]) / 100, 0, 1) : 1,
    };
  }

  const goals = buildGoals();
  const doneIds: string[] = p.goalsDone ?? [];
  for (const goal of goals) if (doneIds.includes(goal.id)) goal.done = true;

  const g: GameState = {
    seed: p.seed ?? 1,
    clock: p.clock ?? 0,
    played: p.played ?? 0,
    day: p.day ?? 1,
    year: p.year ?? 1,
    season: p.season ?? 'spring',
    dayT: p.dayT ?? 0.1,
    speed: p.speed ?? 1,
    paused: false,
    tiles,
    w: p.w,
    h: p.h,
    buildings: (p.buildings ?? []).map((b: any) => ({
      ...b,
      plots: (b.plots ?? []).map((q: any) => ({ ...q, claimed: 0 })),
      delivered: b.delivered ?? {},
      input: b.input ?? {},
      output: b.output ?? {},
      workers: b.workers ?? [],
      residents: b.residents ?? [],
    })),
    villagers: (p.villagers ?? []).map(reviveVillager),
    animals: (p.animals ?? []).map((a: any) => ({
      id: a.id,
      species: a.species as SpeciesId,
      x: a.x,
      y: a.y,
      tx: a.x,
      ty: a.y,
      state: 'wander' as const,
      timer: 1,
      face: 0,
      phase: Math.random() * 6.28,
      name: a.name,
      favorite: !!a.favorite,
      seen: a.seen ?? 1,
      hop: 0,
      ttl: a.ttl ?? 600,
    })),
    stock: { ...emptyStock(), ...(p.stock ?? {}) },
    journal: p.journal ?? [],
    goals,
    unlocked: new Set<string>(p.unlocked ?? []),
    discovered: new Set<SpeciesId>(p.discovered ?? []),
    toasts: [],
    storeFullNotice: 0,
    // Both halves of the walk survive the save: the progress so far and the
    // hidden variation this particular arrival was given. Rerolling the
    // variation on load would make closing the tab a way of asking again.
    arrival: {
      progress: Math.max(0, p.arrival?.progress ?? 0),
      jitter: clampJitter(p.arrival?.jitter),
    },
    weather: p.weather ?? 0,
    weatherTimer: p.weatherTimer ?? 300,
    weatherKind: p.weatherKind ?? 'clear',
    claims: new Map(),
    wildlife: reviveWildlife(p.wildlife),
    founderId: p.founderId ?? 0,
    founding: p.founding,
    // Never saved: whatever was on the water when the tab closed has landed.
    splashes: [],
    stats: {
      built: 0,
      harvested: 0,
      baked: 0,
      cooked: 0,
      caught: 0,
      arrivals: 1,
      mined: 0,
      smelted: 0,
      ...(p.stats ?? {}),
    },
    nameSeq: 0,
  };

  restoreIdCounter(g);
  // Pick the gameplay RNG up where the kingdom left it. A file with no recorded
  // position gets one derived from its own seed rather than the clock, so even
  // then the same kingdom opens the same way twice.
  if (typeof p.rngState === 'number' && p.rngState >>> 0) rng.state = p.rngState;
  else seedGameplayRng(g.seed);
  return g;
}

/**
 * Wildlife pacing as saved. Cooldowns and the survey timer are carried across
 * untouched — the habitat cache is the only thing a load rebuilds, and the
 * caller does that. A missing block means a kingdom that has yet to run at all.
 */
/**
 * The hidden half of an arrival. A file written before arrivals worked this way
 * has none, and a fresh draw is the honest answer there — but it is drawn from
 * the gameplay stream rather than the clock, so the kingdom still opens the same
 * way twice.
 */
function clampJitter(saved: unknown): number {
  const j = Number(saved);
  return Number.isFinite(j) ? clamp(j, -1, 1) : rng.range(-1, 1);
}

function reviveWildlife(saved: any): GameState['wildlife'] {
  const fresh = newWildlifeTimers();
  if (!saved || typeof saved !== 'object') return fresh;
  const survey = Number(saved.survey);
  return {
    survey: Number.isFinite(survey) ? clamp(survey, 0, SURVEY_INTERVAL) : 0,
    cooldown: { ...fresh.cooldown, ...(saved.cooldown ?? {}) },
  };
}

function reviveVillager(v: any): Villager {
  return {
    id: v.id,
    name: v.name,
    x: v.x,
    y: v.y,
    face: v.face ?? 0,
    job: v.job ?? 'helper',
    workplace: v.workplace ?? 0,
    home: v.home ?? 0,
    // Older saves predate hand-picked beds; everyone in them settled on their own.
    homeFixed: !!v.homeFixed,
    trait: v.trait ?? 'steady',
    xp: v.xp ?? {},
    carrying: v.carrying ?? null,
    appearance: v.appearance,
    favorite: !!v.favorite,
    favoriteFood: v.favoriteFood === 'cookedFish' ? 'cookedFish' : 'bread',
    arrived: v.arrived ?? 1,
    history: v.history ?? [],
    wakeOffset: v.wakeOffset ?? 0,
    sleepOffset: v.sleepOffset ?? 0,
    energy: v.energy ?? 1,
    hunger: v.hunger ?? 0.3,
    activity: 'idle',
    plan: [],
    path: null,
    pathIndex: 0,
    actLeft: 0,
    actTotal: 0,
    say: null,
    claim: null,
    phase: Math.random() * 6.28,
    thinkCooldown: Math.random(),
    stuck: 0,
  };
}

// ---------------------------------------------------------------------------
// File export / import
// ---------------------------------------------------------------------------

export function exportToFile(g: GameState, name: string): void {
  const blob = new Blob([JSON.stringify(serialize(g))], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = name.replace(/[^a-z0-9\- ]/gi, '').trim() || 'kingdom';
  a.href = url;
  a.download = `${safe} — year ${g.year}, day ${g.day}.tkm.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function importFromFile(file: File): Promise<GameState> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      try {
        resolve(deserialize(JSON.parse(String(reader.result))));
      } catch (e) {
        reject(e instanceof Error ? e : new Error('That file is not a kingdom.'));
      }
    };
    reader.readAsText(file);
  });
}
