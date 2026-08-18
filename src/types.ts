/** Shared type vocabulary for the whole simulation. */

/**
 * Everything the kingdom can hold. Processed metals are **Bars**, never ingots,
 * and the mithril pair exists here without anything in the game producing it —
 * the Mithril Mine and the forge's mithril recipe are both written down and
 * openly out of reach, the same way the Kingdom Commons is.
 */
export type ResourceId =
  | 'wood'
  | 'stone'
  | 'wheat'
  | 'flour'
  | 'bread'
  | 'fish'
  | 'cookedFish'
  | 'ironOre'
  | 'coal'
  | 'ironBar'
  | 'steelBar'
  | 'mithrilOre'
  | 'mithrilBar'
  | 'coin';

/** Roughly the order a kingdom meets them in, which is the order the strip shows. */
export const RESOURCE_ORDER: ResourceId[] = [
  'wood',
  'stone',
  'wheat',
  'flour',
  'bread',
  'fish',
  'cookedFish',
  'ironOre',
  'coal',
  'ironBar',
  'steelBar',
  'mithrilOre',
  'mithrilBar',
  'coin',
];

/** Coins live outside the physical storage pool — they are carried, not stacked in a barn. */
export const STORED_RESOURCES: ResourceId[] = RESOURCE_ORDER.filter((r) => r !== 'coin');

/**
 * What a hungry villager will actually eat. Both come out of the same kitchen
 * and both fill the same person up completely; there is no better one. Anything
 * that reads "how much food has the kingdom got" sums these rather than naming
 * bread, which is what stops one of the two branches quietly being the real one.
 */
export const PREPARED_FOODS: ResourceId[] = ['bread', 'cookedFish'];

export type Stock = Record<ResourceId, number>;

export function emptyStock(): Stock {
  return {
    wood: 0,
    stone: 0,
    wheat: 0,
    flour: 0,
    bread: 0,
    fish: 0,
    cookedFish: 0,
    ironOre: 0,
    coal: 0,
    ironBar: 0,
    steelBar: 0,
    mithrilOre: 0,
    mithrilBar: 0,
    coin: 0,
  };
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
  /**
   * How rested a fishing spot is, 0..1, on water tiles — 1 is undisturbed and 0
   * is a spot that has just been worked hard. It recovers on its own and never
   * reaches zero permanently: the water is not a node that runs out, it is one
   * that would rather be left alone for a bit. Meaningless on dry land.
   */
  fish: number;
  /** True when a villager has reserved this tile's node so others don't pile on. */
  claimed: number;
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export type JobId =
  | 'helper'
  | 'woodcutter'
  // One trade works the mine, whatever the mine has reached. A Deep Mine
  // producing three materials does not want three kinds of worker; the building
  // decides what they are getting out today and they get it.
  | 'miner'
  | 'farmer'
  | 'miller'
  // One trade cooks whatever the kitchen is working on, exactly as one trade
  // works the whole mine. Bread and fish are two recipes, not two professions.
  | 'cook'
  | 'fisher'
  | 'smith'
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
  // The mine at every stage of it: Quarry, Iron Mine, Deep Mine, Mithril Mine.
  // One building that grows, so the id stays what it always was.
  | 'quarry'
  | 'farm'
  | 'mill'
  // Where both chains end: flour becomes bread here, and raw fish becomes
  // something worth eating. One warm building rather than two half-used ones.
  | 'kitchen'
  | 'fishhut'
  | 'forge'
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
  /**
   * Written down but not yet possible — the forge's mithril recipe. The panel
   * shows it greyed rather than hiding it, for the same reason the last step of
   * the commons is shown: a horizon reads as a horizon, a gap reads as a bug.
   * Nothing in the planner will ever run one.
   */
  locked?: boolean;
}

/**
 * Something the kingdom must have *done* before an improvement is allowed, as
 * opposed to something it must have in store. `label` is the line the panel
 * shows, so it reads as an accomplishment rather than a condition.
 */
export interface UpgradeReq {
  label: string;
  met: (g: GameState) => boolean;
  /**
   * Nothing in the game can satisfy this yet — the Kingdom Commons and the
   * Mithril Mine both end on one. Shown rather than hidden, but the interface
   * has to know not to describe the step beyond it as something to work towards.
   */
  impossible?: boolean;
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
  /**
   * Everything this building can make, in the order it should be offered. A
   * workshop with one recipe uses `recipe`; the forge has several and picks
   * between them from its focus. `recipesOf` in `defs.ts` answers both.
   */
  recipes?: Recipe[];
  /** Node prop harvested by this building's workers. */
  harvests?: PropId;
  /**
   * What this building takes out of the ground it stands on, per level — the
   * mine, and nothing else. Level 1 is stone alone; each improvement adds a
   * material without taking one away, and the same workers get all of them.
   * There are no nodes involved: the rock underneath does not run out.
   */
  extracts?: ResourceId[][];
  /**
   * Has to stand on or against rocky ground. Only the mine, and it is the whole
   * of what makes where you sink it a decision.
   */
  needsRock?: boolean;
  /**
   * Has to stand on dry land with fishable water inside its reach — the Fishing
   * Hut, and only that. The counterpart of `needsRock`, and the reason a hut is
   * a decision about a shoreline rather than a box you drop anywhere.
   */
  fishes?: boolean;
  /**
   * What the focus picker says about leaving this building on Balanced. Per
   * building, because the forge's answer ("iron first, coal only when there are
   * bars to spare") is nonsense about a kitchen.
   */
  focusNote?: string;
  /**
   * How far this building's workers range for their nodes, per level — or, for
   * the mine, how far the seam it is working spreads. Shown to the player while
   * placing or moving it, because a lodge with no trees in reach is the one
   * placement mistake that looks fine and produces nothing.
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
  /**
   * How many may stand at once, full stop — a flat ceiling the commons has no
   * say in. The comforts use this: their limit is what keeps decoration a set
   * of choices about *which* rather than a slider you drag to a hundred Vibes.
   */
  maxTotal?: number;
  /**
   * What one of these contributes to the kingdom's Vibes while it stands. Only
   * the comforts have it, and their limits are set so that all of them together
   * come to exactly `VIBE_MAX.decor`.
   */
  vibes?: number;
  /** Sort weight in the build menu. */
  order: number;
}

export type BuildStage = 'planned' | 'building' | 'done';

/**
 * What a building has been asked to concentrate on. `'balanced'` is not "equal
 * amounts of everything" — it is "whatever the kingdom is shortest of", worked
 * out afresh each time somebody starts a stint.
 */
export type Focus = ResourceId | 'balanced';

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
   * What this building has been told to concentrate on: a resource id, or
   * `'balanced'`, which is the default and means the building decides for itself
   * from what the kingdom is short of. Only the mine and the forge have one, it
   * costs nothing to change, and changing it back costs nothing either.
   */
  focus?: Focus;
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
  | 'cooking'
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
      kind: 'eat' | 'sow' | 'reap' | 'batch' | 'extract' | 'catch' | 'arrived' | 'settled';
      id?: number;
      slot?: number;
      /** Which material this stint at the rock face was for, or which recipe ran. */
      res?: ResourceId;
      /** The water a `catch` was pulled out of, so the spot knows it was worked. */
      x?: number;
      y?: number;
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
  /**
   * Which of the two prepared foods they reach for first. Personality and
   * nothing else: both fill them up entirely, they will happily eat the other
   * when their own is not in store, and no system anywhere reads this except
   * the walk to the larder and the line in their card.
   */
  favoriteFood: ResourceId;
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
  /**
   * The newcomer currently on their way. `progress` is game seconds of walking
   * accumulated so far, and `jitter` is the hidden variation that decides where
   * inside the window this particular arrival lands — held from one arrival to
   * the next, and saved, so that reloading is not a way of re-rolling it.
   *
   * A duration is deliberately *not* stored: the length of the wait is worked
   * out from the current Vibes every tick, so improving the kingdom while
   * somebody is on the road hurries them along rather than starting them again.
   */
  arrival: { progress: number; jitter: number };
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
  /**
   * Fish breaking the surface: purely something to look at, never saved, and
   * drained by the renderer as it draws them. It lives on the state rather than
   * in the renderer because the sim is what knows a fish was just landed, and
   * the headless run has to be able to let them expire with nobody watching.
   */
  splashes: { x: number; y: number; t: number; jump: boolean; heard?: boolean }[];
  stats: {
    built: number;
    harvested: number;
    /** Loaves out of the kitchen. Bread alone — `cooked` is the pair of them. */
    baked: number;
    /**
     * Meals of any kind out of the kitchen, bread and cooked fish together.
     * This is what the commons asks for and what Vibes wait on, so that neither
     * branch of the food chain is quietly the real one.
     */
    cooked: number;
    /** Fish landed, ever. An accomplishment, so it cannot un-happen. */
    caught: number;
    arrivals: number;
    /**
     * Stone taken out of the rock by the mine. Counted because the mine's own
     * improvements ask for it, and an accomplishment has to be something that
     * cannot un-happen — what is *in* the store goes down again the moment
     * anybody builds anything.
     */
    mined: number;
    /** Bars off the forge, iron and steel alike. Same reasoning. */
    smelted: number;
  };
  nameSeq: number;
}
