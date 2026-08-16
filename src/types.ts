/** Shared type vocabulary for the whole simulation. */

export type ResourceId = 'wood' | 'stone' | 'wheat' | 'flour' | 'bread' | 'coin';

export const RESOURCE_ORDER: ResourceId[] = ['wood', 'stone', 'wheat', 'flour', 'bread', 'coin'];

/** Coins live outside the physical storage pool — they are carried, not stacked in a barn. */
export const STORED_RESOURCES: ResourceId[] = ['wood', 'stone', 'wheat', 'flour', 'bread'];

export type Stock = Record<ResourceId, number>;

export function emptyStock(): Stock {
  return { wood: 0, stone: 0, wheat: 0, flour: 0, bread: 0, coin: 0 };
}

export type TerrainId = 'water' | 'shallow' | 'sand' | 'grass' | 'meadow' | 'forest' | 'rocky';

export type PropId =
  | 'tree'
  | 'stump'
  | 'boulder'
  | 'pebbles'
  | 'bush'
  | 'flowers'
  | 'reeds'
  | 'lilypad';

export interface Tile {
  terrain: TerrainId;
  /** Static scenery / harvestable node sitting on this tile, if any. */
  prop: PropId | null;
  /** Prop variant for visual variety. */
  variant: number;
  /** Remaining harvestable units (wood in a tree, stone in a boulder). */
  amount: number;
  /** Regrowth timer in game seconds; when a node is depleted it counts back up. */
  regrow: number;
  /** Id of the building occupying this tile, or 0. */
  building: number;
  /** True when that building actually obstructs movement (benches do not). */
  blocked: boolean;
  /** Id of the farm plot occupying this tile, or 0 (plots are walkable). */
  plot: number;
  /** True when a villager has reserved this tile's node so others don't pile on. */
  claimed: number;
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export type JobId =
  | 'helper'
  | 'woodcutter'
  | 'stoneworker'
  | 'farmer'
  | 'miller'
  | 'baker'
  | 'keeper';

export type TraitId =
  | 'greenThumb'
  | 'animalFriend'
  | 'crafty'
  | 'curious'
  | 'earlyRiser'
  | 'nightOwl'
  | 'outdoorsy'
  | 'steady';

export type BuildingId =
  | 'commons'
  | 'cabin'
  | 'storehouse'
  | 'lodge'
  | 'quarry'
  | 'farm'
  | 'mill'
  | 'bakery'
  | 'well'
  | 'bench'
  | 'lantern'
  | 'flowerbed'
  | 'sapling'
  | 'statue';

export type BuildingCategory = 'housing' | 'storage' | 'production' | 'comfort';

export interface Recipe {
  inputs: Partial<Record<ResourceId, number>>;
  outputs: Partial<Record<ResourceId, number>>;
  /** Base seconds of work for one batch at skill 1.0. */
  seconds: number;
}

/**
 * Something the kingdom must have *done* before an improvement is allowed, as
 * opposed to something it must have in store. `label` is the line the panel
 * shows, so it reads as an accomplishment rather than a condition.
 */
export interface UpgradeReq {
  label: string;
  met: (g: GameState) => boolean;
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  category: BuildingCategory;
  w: number;
  h: number;
  cost: Partial<Record<ResourceId, number>>;
  /** Villager-seconds of labour needed to raise it. */
  labour: number;
  /** Levels beyond 1 that this building can be upgraded to. */
  maxLevel: number;
  /** Cost multiplier applied per upgrade step, compounding with level. */
  upgradeCostMul?: number;
  /**
   * Exact cost of each upgrade step, when a multiplier on the base cost cannot
   * say it — a cabin starts as twenty wood and later wants stone as well.
   * Index 0 is level 1 → 2. Takes precedence over `upgradeCostMul`.
   */
  upgradeCosts?: Partial<Record<ResourceId, number>>[];
  /**
   * What the kingdom must have done before each improvement, beyond paying for
   * it. Index 0 is level 1 → 2, matching `upgradeCosts`. A step with a
   * requirement nothing can currently satisfy is a level the kingdom cannot
   * reach yet, which is deliberate: the panel says so rather than hiding it.
   */
  upgradeReqs?: UpgradeReq[][];
  /** Name per level, when improving one changes what it is called. */
  levelNames?: string[];
  desc: string;
  /** Longer explanation of how the building actually behaves, for its own panel. */
  how: string;
  /** Sleeping capacity per level. */
  housing?: number[];
  /** Shared storage capacity contributed per level. */
  storage?: number[];
  /** Job slots per level. */
  slots?: number[];
  job?: JobId;
  recipe?: Recipe;
  /** Node prop harvested by this building's workers. */
  harvests?: PropId;
  /**
   * How far this building's workers range for their nodes, per level. Shown to
   * the player while placing or moving it, because a lodge with no trees in
   * reach is the one placement mistake that looks fine and produces nothing.
   */
  range?: number[];
  /** Farm plots are generated inside the footprint. */
  plots?: boolean;
  /** Lights up at night. */
  light?: { x: number; y: number; radius: number; color: string }[];
  /** Blocks pathing. Decorations mostly do not. */
  solid?: boolean;
  /** Requires research/milestone unlock before appearing in the build menu. */
  unlock?: string;
  /** The kingdom only ever has one; it leaves the menu once it stands. */
  once?: boolean;
  /**
   * A principal building: the kingdom has one at a time, and rather than
   * building a second the player *moves* the one they have. Capacity, range and
   * job slots grow through improvement instead of through duplication — a
   * second lodge would be a production strategy, and would stop the first from
   * being a place.
   */
  unique?: boolean;
  /**
   * How many may stand at once, indexed by the commons' level. Cabins and
   * storehouses are not unique, but neither are they unlimited: the count is
   * one of the things the commons hands over as it grows.
   */
  maxCount?: number[];
  /** Sort weight in the build menu. */
  order: number;
}

export type BuildStage = 'planned' | 'building' | 'done';

export interface Building {
  id: number;
  def: BuildingId;
  x: number;
  y: number;
  level: number;
  stage: BuildStage;
  /** Materials delivered so far to the construction site. */
  delivered: Partial<Record<ResourceId, number>>;
  /** Villager-seconds of labour applied. */
  labour: number;
  /** Local input/output buffers for production chains. */
  input: Partial<Record<ResourceId, number>>;
  output: Partial<Record<ResourceId, number>>;
  /** Progress through the current recipe batch, 0..1. */
  progress: number;
  /** Villager ids currently employed here. */
  workers: number[];
  /** Villager ids sleeping here. */
  residents: number[];
  /** Farm plot tiles owned by this building. */
  plots: { x: number; y: number; state: 'empty' | 'growing' | 'ripe'; growth: number; claimed: number }[];
  /** True while an upgrade is under construction. */
  upgrading: boolean;
  /**
   * A move under way. The building being moved carries `movingTo`, the id of a
   * plain construction site standing on the new ground; that site carries
   * `relocOf` pointing back. The original keeps working the whole time and only
   * steps across when the site is finished, so moving the only quarry never
   * costs the kingdom its stone halfway through.
   */
  movingTo?: number;
  relocOf?: number;
  /** Game-day the building was completed. */
  built: number;
  /** Cosmetic seed for per-instance variation. */
  seed: number;
  name?: string;
}

export type Rank = 'Novice' | 'Adept' | 'Journeyman' | 'Expert' | 'Master';

export interface VillagerAppearance {
  skin: string;
  hair: string;
  shirt: string;
  trousers: string;
  hat: 0 | 1 | 2 | 3;
  hairStyle: 0 | 1 | 2;
}

export type ActivityKind =
  | 'sleeping'
  | 'walking'
  | 'working'
  | 'hauling'
  | 'building'
  | 'gathering'
  | 'planting'
  | 'harvesting'
  | 'eating'
  | 'resting'
  | 'chatting'
  | 'watching'
  | 'idle'
  | 'arriving'
  | 'fishing';

/** One executable step in a villager's plan. Plans are transient and never serialised. */
export type Step =
  | { t: 'move'; x: number; y: number; adjacent?: boolean; goals?: { x: number; y: number }[] }
  | { t: 'act'; dur: number; kind: ActivityKind; xp?: JobId; face?: number }
  | { t: 'take'; res: ResourceId; qty: number; from: 'store' | 'building' | 'tile'; id?: number; x?: number; y?: number }
  /** Without `qty` the whole load goes; with it, the rest stays in their arms. */
  | { t: 'give'; to: 'store' | 'building' | 'site'; id?: number; qty?: number }
  | { t: 'labour'; id: number }
  | { t: 'sleep' }
  | { t: 'say'; text: string }
  /** Deferred consequence, applied the instant the preceding action finishes. */
  | {
      t: 'effect';
      kind: 'eat' | 'sow' | 'reap' | 'batch' | 'arrived' | 'settled';
      id?: number;
      slot?: number;
    };

export interface Villager {
  id: number;
  name: string;
  x: number;
  y: number;
  /** Facing, 0=SE 1=SW 2=NW 3=NE in grid terms. */
  face: number;
  job: JobId;
  workplace: number;
  home: number;
  /** The player chose this bed, so nothing in the sim quietly moves them out of it. */
  homeFixed: boolean;
  trait: TraitId;
  /** Profession experience, 0..100 each. */
  xp: Partial<Record<JobId, number>>;
  carrying: { res: ResourceId; qty: number } | null;
  appearance: VillagerAppearance;
  favorite: boolean;
  /** Game-day the villager joined the kingdom. */
  arrived: number;
  history: { day: number; text: string }[];
  /** Personal schedule jitter in day fractions. */
  wakeOffset: number;
  sleepOffset: number;
  energy: number;
  hunger: number;
  activity: ActivityKind;
  /** Transient: current plan and path. */
  plan: Step[];
  path: { x: number; y: number }[] | null;
  pathIndex: number;
  /** Countdown for the current 'act' step. */
  actLeft: number;
  actTotal: number;
  say: { text: string; ttl: number } | null;
  /** Reserved node/plot/task so villagers don't collide on the same work. */
  claim: { kind: string; id: number; x?: number; y?: number } | null;
  /** Cosmetic bob phase. */
  phase: number;
  /** Cooldown before the brain re-plans, prevents spin when nothing to do. */
  thinkCooldown: number;
  stuck: number;
}

export type SpeciesId =
  | 'rabbit'
  | 'squirrel'
  | 'bird'
  | 'duck'
  | 'frog'
  | 'butterfly'
  | 'bee'
  | 'deer'
  | 'fox'
  | 'owl';

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  plural: string;
  /** Preferred terrain weights; unlisted terrain scores 0. */
  habitat: Partial<Record<TerrainId, number>>;
  /** Bonus for being near these props. */
  likesProps?: Partial<Record<PropId, number>>;
  /** Active window as day-fractions [start, end]; wraps if start > end. */
  active: [number, number];
  /** How many can exist per unit of suitable habitat. */
  density: number;
  hardCap: number;
  speed: number;
  /** Distance at which the animal flees villagers; 0 = fearless. */
  skittish: number;
  /** Rarity affects spawn cadence; higher = rarer. */
  rarity: number;
  colors: { body: string; belly: string; accent: string };
  /** Journal hint revealed once discovered. */
  hint: string;
  size: number;
  seasons?: Season[];
}

export interface Animal {
  id: number;
  species: SpeciesId;
  x: number;
  y: number;
  tx: number;
  ty: number;
  state: 'wander' | 'feed' | 'rest' | 'flee' | 'hop';
  timer: number;
  face: number;
  phase: number;
  name?: string;
  favorite: boolean;
  /** Game-day first seen; used in the profile card. */
  seen: number;
  /** Vertical hop offset for rendering. */
  hop: number;
  ttl: number;
}

export interface JournalEntry {
  day: number;
  year: number;
  season: Season;
  text: string;
  icon: string;
}

export interface Goal {
  id: string;
  title: string;
  desc: string;
  done: boolean;
  hidden?: boolean;
  /** Evaluated each second. */
  check: (g: GameState) => boolean;
  reward?: Partial<Record<ResourceId, number>>;
  /** Build-menu keys this goal opens up. The menu reveals itself a step at a time. */
  unlocks?: string | string[];
}

export interface Toast {
  text: string;
  icon: string;
  ttl: number;
  tone: 'info' | 'good' | 'warn';
}

/**
 * How far through founding the kingdom is. `arriving` is the founder walking up
 * the beach, `choosing` is the player picking the ground — the one spatial
 * decision the opening asks for — `settling` is the walk out to it, and `camp`
 * covers felling the first tree and raising the Base Camp out of that load.
 */
export type FoundingStage = 'arriving' | 'choosing' | 'settling' | 'camp' | 'done';

export interface Founding {
  stage: FoundingStage;
  /**
   * The chosen ground: the *centre* tile of the Base Camp's 3×3 footprint,
   * which is also where the fire burns. Meaningless before `settling`.
   */
  x: number;
  y: number;
}

export interface GameState {
  seed: number;
  /** Total elapsed game seconds since founding. */
  clock: number;
  /** Real seconds of active play. */
  played: number;
  day: number;
  year: number;
  season: Season;
  /** Position within the current day, 0..1. */
  dayT: number;
  speed: number;
  paused: boolean;
  tiles: Tile[];
  w: number;
  h: number;
  buildings: Building[];
  villagers: Villager[];
  animals: Animal[];
  stock: Stock;
  journal: JournalEntry[];
  goals: Goal[];
  unlocked: Set<string>;
  discovered: Set<SpeciesId>;
  toasts: Toast[];
  /** Transient: cooldown before saying again that the store has no room. */
  storeFullNotice: number;
  /** Villager arrival pacing. */
  arrivalTimer: number;
  /** Weather: 0 = clear, rises toward 1 during rain/snow. */
  weather: number;
  weatherTimer: number;
  weatherKind: 'clear' | 'rain' | 'snow';
  /** Task reservations keyed by "kind:id" → villager id. */
  claims: Map<string, number>;
  /**
   * Wildlife pacing. Lives on the state rather than in the wildlife module
   * because it has to survive a save and be left behind when the player opens a
   * different kingdom — module-level timers did neither, and a reload used to
   * hand every species a fresh spawn roll.
   */
  wildlife: {
    /** Game seconds until the next habitat survey. */
    survey: number;
    /** Per-species spawn cooldown, in game seconds. */
    cooldown: Partial<Record<SpeciesId, number>>;
  };
  founderId: number;
  founding: Founding;
  stats: {
    built: number;
    harvested: number;
    baked: number;
    arrivals: number;
  };
  nameSeq: number;
}
