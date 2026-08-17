/** Static game data: buildings, jobs, traits, wildlife, ranks. */

import type {
  BuildingDef,
  BuildingId,
  GameState,
  JobId,
  PropId,
  Rank,
  ResourceId,
  SpeciesDef,
  SpeciesId,
  TerrainId,
  TraitId,
  UpgradeReq,
} from '../types';

export const CARRY_CAPACITY = 12;

/** One in-game day at 1× speed, in real seconds. 20 min day + 10 min night. */
export const DAY_LENGTH = 30 * 60;
/** Days per season — 3 real hours at 1× = 6 days. */
export const DAYS_PER_SEASON = 6;
/** One game-minute in game seconds. Thirty of them make a day. */
export const GAME_MINUTE = 60;

/**
 * How long a newcomer takes to arrive once there is a bed for them, in
 * game-minutes, by how many people are already here.
 *
 * The window is a promise rather than a chance: with a bed free, somebody
 * always turns up by the far end of it. Vibes decide where inside the window,
 * and a little hidden variation keeps two identical kingdoms from filling up in
 * lockstep. There is no roll that can fail, because a kingdom being told "no"
 * with no reason it can see is the one thing this was rebuilt to stop.
 */
export const ARRIVAL_WINDOWS: { upTo: number; min: number; max: number }[] = [
  { upTo: 1, min: 6, max: 9 },
  { upTo: 3, min: 18, max: 26 },
  { upTo: 7, min: 25, max: 35 },
  { upTo: 15, min: 35, max: 50 },
  { upTo: Infinity, min: 50, max: 75 },
];

/** The most each source of Vibes can be worth. The three add up to a hundred. */
export const VIBE_MAX = { decor: 60, food: 30, wellbeing: 10 };

/** What a number out of a hundred is actually called. */
export const VIBE_BANDS: { from: number; name: string }[] = [
  { from: 100, name: 'Immaculate' },
  { from: 80, name: 'The Word Is Spreading' },
  { from: 60, name: 'Lovely, Actually' },
  { from: 40, name: 'Quite Nice' },
  { from: 20, name: 'Getting There' },
  { from: 0, name: 'A Bit Grim' },
];

/**
 * Food security by loaves per villager: none, one each, two each, and so on up
 * to four. Per head rather than per kingdom, so a larder that was reassuring at
 * four people stops being reassuring at twelve without anything being rewritten.
 * Read as a ramp between the points rather than as five steps.
 */
export const FOOD_VIBES = [0, 8, 16, 24, 30];

/**
 * What food is worth before the kingdom has ever baked. Neutral on purpose:
 * there is no bread because there is no bakery, and marking a kingdom down for
 * a system it has not been handed yet is a punishment for playing in order.
 */
export const FOOD_VIBES_NEUTRAL = 15;

/** Hunger past which somebody is visibly struggling — the point their work slows. */
export const SEVERE_HUNGER = 0.85;

export const RESOURCE_META: Record<string, { name: string; icon: string; color: string }> = {
  wood: { name: 'Wood', icon: '🪵', color: '#b0763f' },
  stone: { name: 'Stone', icon: '🪨', color: '#9aa2ab' },
  wheat: { name: 'Wheat', icon: '🌾', color: '#e0b95c' },
  flour: { name: 'Flour', icon: '🥣', color: '#e8dcc4' },
  bread: { name: 'Bread', icon: '🍞', color: '#c98a4b' },
  coin: { name: 'Coins', icon: '🪙', color: '#f0c860' },
};

/** Where each resource comes from and where it goes, for the top-bar hover. */
export const RESOURCE_INFO: Record<string, { from: string; used: string }> = {
  wood: {
    from: 'Woodcutters at the lodge, and helpers felling any tree by hand. The first twelve came off a single tree, swung at by somebody who had only just arrived.',
    used: 'Nearly every building, from a cabin at 20 up to a windmill at 50, and every step the commons takes.',
  },
  stone: {
    from: 'Stoneworkers at the quarry, and nowhere else. Boulders are too much for bare hands; until there is a quarry they simply stand there being scenery.',
    used: 'Improving the commons or a cabin, wells, and the workshops further along the chain.',
  },
  wheat: {
    from: 'Farmers sowing and reaping the plots around a wheat farm.',
    used: 'Ground into flour at the windmill, three wheat at a time.',
  },
  flour: {
    from: 'The windmill, two flour for every three wheat carried in.',
    used: 'Baked into bread, two flour to a batch of three loaves.',
  },
  bread: {
    from: 'The bakery, three loaves a batch.',
    used: 'Eaten. It is the only thing anybody eats, so keep some in store.',
  },
  coin: {
    from: 'Set aside now and then when the kingdom reaches something.',
    used: 'Nothing yet. They sit in a tin and wait for a use.',
  },
};

export const JOB_META: Record<JobId, { name: string; icon: string; desc: string }> = {
  helper: {
    name: 'Helper',
    icon: '🧺',
    desc: 'Fells trees by hand, hauls goods between buildings, and helps raise new construction. Stone is beyond bare hands; that wants a quarry.',
  },
  woodcutter: { name: 'Woodcutter', icon: '🪓', desc: 'Fells trees near the lodge and carries wood to storage.' },
  stoneworker: { name: 'Stoneworker', icon: '⛏️', desc: 'Works the boulders near the quarry for stone.' },
  farmer: { name: 'Farmer', icon: '🌱', desc: 'Sows and harvests the wheat plots around the farm.' },
  miller: { name: 'Miller', icon: '🌬️', desc: 'Grinds wheat into flour at the windmill.' },
  baker: { name: 'Baker', icon: '👩‍🍳', desc: 'Turns flour into bread the whole kingdom eats.' },
  keeper: { name: 'Keeper', icon: '🐾', desc: 'Looks after the kingdom’s animals.' },
};

export const TRAIT_META: Record<TraitId, { name: string; icon: string; desc: string }> = {
  greenThumb: { name: 'Green Thumb', icon: '🌿', desc: 'Crops seem to grow a little faster under their care.' },
  animalFriend: { name: 'Animal Friend', icon: '🐇', desc: 'Wildlife does not startle when they walk past.' },
  crafty: { name: 'Crafty', icon: '🔨', desc: 'Quick and tidy at a workbench or an oven.' },
  curious: { name: 'Curious', icon: '🔍', desc: 'Wanders further than most, and notices things.' },
  earlyRiser: { name: 'Early Riser', icon: '🌅', desc: 'Up before the rest of the kingdom.' },
  nightOwl: { name: 'Night Owl', icon: '🌙', desc: 'Often still out well after dark.' },
  outdoorsy: { name: 'Outdoorsy', icon: '🥾', desc: 'Crosses rough ground without slowing down much.' },
  steady: { name: 'Steady', icon: '🧭', desc: 'Never hurries, never stops. Tires more slowly.' },
};

export const TRAIT_IDS = Object.keys(TRAIT_META) as TraitId[];

export function rankOf(xp: number): Rank {
  if (xp >= 100) return 'Master';
  if (xp >= 75) return 'Expert';
  if (xp >= 50) return 'Journeyman';
  if (xp >= 25) return 'Adept';
  return 'Novice';
}

export const RANK_COLOR: Record<Rank, string> = {
  Novice: '#9aa4b2',
  Adept: '#7ec98f',
  Journeyman: '#6cb6e8',
  Expert: '#c08ce8',
  Master: '#f0c860',
};

/** Skill multiplier applied to work speed. Gentle: 0.8× at novice to 1.4× at master. */
export function skillMul(xp: number): number {
  return 0.8 + (Math.min(100, xp) / 100) * 0.6;
}

/** Experience gained per second of real work. Fast early, slow near mastery. */
export function xpGain(current: number, seconds: number): number {
  const falloff = 1.5 - (Math.min(100, current) / 100) * 1.0;
  return seconds * 0.05 * falloff;
}

/** A finished building of a kind, for the requirement predicates below. */
function standing(g: GameState, def: BuildingId): boolean {
  return g.buildings.some((b) => b.def === def && b.stage === 'done');
}

/**
 * What the kingdom must have done before the commons will grow, step by step.
 * These are accomplishments rather than conditions, and they are written so
 * that they cannot un-happen where that is possible at all: a kingdom is never
 * told it has gone backwards.
 *
 * Nothing here may ask for something the same step unlocks, or the ladder eats
 * its own tail. The last step deliberately asks for something nothing can do
 * yet — the Kingdom Commons is the far end of the arc, written down and openly
 * out of reach rather than quietly missing.
 */
const COMMONS_REQS: UpgradeReq[][] = [
  [
    { label: 'A cabin with a roof on it', met: (g) => standing(g, 'cabin') },
    // The Base Camp itself hands the quarry over, so asking for one here is a
    // step forward rather than a knot: the stone this improvement costs has to
    // come from somewhere, and there is exactly one somewhere.
    { label: 'A quarry, since nothing else gives stone', met: (g) => standing(g, 'quarry') },
    { label: 'Three people about the place', met: (g) => g.villagers.length >= 3 },
  ],
  [
    { label: 'Bread out of an oven of your own', met: (g) => g.stats.baked >= 6 },
    { label: 'Six people about the place', met: (g) => g.villagers.length >= 6 },
    {
      label: 'Somebody settled into a trade',
      met: (g) => g.buildings.some((b) => b.stage === 'done' && !!BUILDINGS[b.def].job && b.workers.length > 0),
    },
  ],
  [{ label: 'A way of building that nobody here knows', met: () => false }],
];

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  commons: {
    id: 'commons',
    name: 'Base Camp',
    levelNames: ['Base Camp', 'Settled Camp', 'Village Commons', 'Kingdom Commons'],
    category: 'housing',
    w: 3,
    h: 3,
    cost: { wood: 12 },
    labour: 16,
    maxLevel: 4,
    // Every step has to be payable out of the storage the step before it left
    // behind — and out of what hand-gathering will actually fetch, since
    // `gatherTarget` holds helpers to half the store in wood and a third in
    // stone. A cost above that line is a cost nobody can ever meet.
    upgradeCosts: [
      { wood: 25, stone: 10 },
      { wood: 90, stone: 55 },
      { wood: 150, stone: 110 },
    ],
    upgradeReqs: COMMONS_REQS,
    // Never in the build menu: it stands where the kingdom was founded, and
    // there is only ever the one.
    order: -1,
    once: true,
    desc: 'A fire, somewhere to put things down, and room to sleep rough beside it. Where the kingdom begins, and afterwards the middle of it.',
    how: 'The first fire, the kingdom\'s first store and two places to sleep out of doors, all on the same nine tiles. It grows with the kingdom rather than being replaced — a Settled Camp, then a Village Commons, and there is talk of something after that — and it never closes for the work: the store stays open at its current size the whole time, so nothing is ever stranded. Every step opens up more of the kingdom: new kinds of building, and one more cabin and one more storehouse than before. Improving it wants materials and a settlement that has got somewhere; both are listed in full before you commit. People walk through it, sit at it and stand about in it whether or not they have any business there, which is rather the point. It cannot be taken down, and it cannot be moved: it stands where the kingdom began.',
    housing: [2, 2, 2, 2],
    storage: [60, 200, 450, 800],
    light: [{ x: 1.5, y: 1.5, radius: 50, color: '#ffb35c' }],
    solid: false,
  },
  cabin: {
    id: 'cabin',
    name: 'Cabin',
    category: 'housing',
    w: 2,
    h: 2,
    cost: { wood: 20 },
    labour: 45,
    maxLevel: 3,
    // A cabin grows into a cottage rather than being replaced by one: planks
    // and thatch, then a chimney, then stone footings and a tiled roof.
    upgradeCosts: [
      { wood: 45, stone: 25 },
      { wood: 90, stone: 55 },
    ],
    order: 0,
    unlock: 'cabin',
    desc: 'A roof, a door, and somewhere dry to sleep. Sleeps two, and grows.',
    how: 'Somewhere dry to sleep, and at first that is the whole of it. People walk home at their own bedtime and rise at their own hour, a little earlier or later than each other. Improving it adds two more beds and a good deal more building: a chimney first, then stone footings and a proper roof. Six sleep in a finished one. How many cabins the kingdom may have at once is set by the commons — one more with every step it takes — so a growing settlement is usually better served by improving the cabins it has. On the day one is finished it takes in anyone still sleeping out at the commons, and you can move people between cabins yourself from this panel.',
    // One more cabin per step the commons takes. Housing is the tightest of the
    // two counts by design: a cabin that grows to six beds is worth more than a
    // second cabin of two, and this is what makes that the obvious move.
    maxCount: [1, 2, 3, 4],
    housing: [2, 4, 6],
    light: [{ x: 1.0, y: 1.35, radius: 36, color: '#ffc06a' }],
    solid: true,
  },
  storehouse: {
    id: 'storehouse',
    name: 'Storehouse',
    category: 'storage',
    w: 2,
    h: 2,
    cost: { wood: 25 },
    labour: 40,
    maxLevel: 2,
    upgradeCostMul: 2.4,
    order: 10,
    desc: 'Everything the kingdom keeps ends up here. Build them near where goods are made.',
    how: 'Adds 250 to the shared store, or 550 once improved. Goods are one pool for the whole kingdom, so this raises the ceiling rather than holding anything of its own. Villagers carry loads to whichever store is nearest, which is the only reason where you put it matters — and it is reason enough, since a storehouse out by the woods is half the walking. The commons decides how many may stand at once, one more with each step it takes.',
    maxCount: [1, 2, 3, 4],
    storage: [250, 550],
    unlock: 'storehouse',
    solid: true,
  },
  lodge: {
    id: 'lodge',
    name: "Woodcutter's Lodge",
    category: 'production',
    w: 2,
    h: 2,
    cost: { wood: 30 },
    labour: 55,
    maxLevel: 2,
    upgradeCostMul: 2.2,
    order: 20,
    desc: 'The kingdom’s one lodge. Woodcutters work the trees nearby, so place it in or beside a wood.',
    how: 'Woodcutters work whatever trees stand within thirteen tiles of the lodge — seventeen once it is improved — and range further only when the near ones are gone. The reach is drawn on the map while you are placing or moving it, along with every tree inside it. Each felled tree becomes a stump and grows back in time. They chop three trips\' worth, haul it to the nearest store, and set off again. When wood climbs past about a third of the whole store they stop and go help elsewhere, so the barn never fills with timber while the bread runs out. There is only ever one lodge; if the wood around it thins out, move it rather than building a second.',
    slots: [2, 3],
    job: 'woodcutter',
    harvests: 'tree',
    range: [13, 17],
    unique: true,
    unlock: 'lodge',
    solid: true,
  },
  quarry: {
    id: 'quarry',
    name: 'Quarry',
    category: 'production',
    w: 2,
    h: 2,
    // Wood only, and it has to stay that way: this is the kingdom's only source
    // of stone, so a quarry that cost stone could never be built at all.
    cost: { wood: 30 },
    labour: 60,
    maxLevel: 2,
    upgradeCostMul: 2.2,
    order: 21,
    desc: 'The only stone in the kingdom comes from here. Place it against rocky ground.',
    how: 'Stoneworkers break the loose boulders within thirteen tiles of the quarry — seventeen once it is improved — and range further when the near ones are worked out. The reach is drawn on the map while you are placing or moving it, along with every boulder inside it. Worked-out boulders leave rubble, and rubble gathers back into a boulder in time, so a quarry does not exhaust its ground for good. Nothing else in the kingdom produces stone: bare hands will not break a boulder, and clearing one to build on wastes it until this stands. As with wood, stoneworkers down tools and help elsewhere once stone is past about a third of the store. There is only ever one quarry; if the rock around it runs thin, move it.',
    slots: [2, 3],
    job: 'stoneworker',
    harvests: 'boulder',
    range: [13, 17],
    unique: true,
    unlock: 'quarry',
    solid: true,
  },
  farm: {
    id: 'farm',
    name: 'Wheat Farm',
    category: 'production',
    w: 3,
    h: 3,
    cost: { wood: 40, stone: 10 },
    labour: 80,
    maxLevel: 2,
    upgradeCostMul: 2.0,
    order: 22,
    desc: 'A small barn and eight plots. Farmers sow, wait, and harvest wheat.',
    how: 'Eight plots around a small barn. A farmer sows a bare plot, leaves it, and comes back when it is ripe — a little over three minutes of growing at normal speed, quickest in summer and about a third of that pace in winter. A farm with nobody assigned still creeps along at about a third the pace. Harvested wheat goes to the nearest store, not into the barn. There is one farm in the kingdom; moving it lays out fresh plots on the new ground, so whatever was in the old ones is lost with them — worth waiting for a harvest first.',
    slots: [2, 3],
    job: 'farmer',
    plots: true,
    unique: true,
    unlock: 'farm',
    solid: false,
  },
  mill: {
    id: 'mill',
    name: 'Windmill',
    category: 'production',
    w: 2,
    h: 2,
    cost: { wood: 50, stone: 30 },
    labour: 110,
    maxLevel: 2,
    upgradeCostMul: 2.0,
    order: 23,
    desc: 'Grinds wheat into flour. The sails turn whenever the miller is working.',
    how: 'Three wheat in, two flour out, about eighteen seconds a batch and quicker as the miller learns the work. The miller fetches wheat from the store personally rather than waiting to be supplied, and carries the flour back once the shelf is worth a trip. Nothing here is automatic: if nobody is walking, nothing is moving. There is one windmill, and it can be moved — a shorter walk between the farm, the mill and the ovens is most of what makes bread arrive.',
    slots: [1, 2],
    job: 'miller',
    recipe: { inputs: { wheat: 3 }, outputs: { flour: 2 }, seconds: 18 },
    unique: true,
    unlock: 'mill',
    solid: true,
  },
  bakery: {
    id: 'bakery',
    name: 'Bakery',
    category: 'production',
    w: 2,
    h: 2,
    cost: { wood: 40, stone: 40 },
    labour: 120,
    maxLevel: 2,
    upgradeCostMul: 2.0,
    order: 24,
    desc: 'Flour becomes bread. The smell reaches most of the kingdom.',
    how: 'Two flour in, three loaves out, about twenty-two seconds a batch and quicker with practice. Bread is the only thing anyone eats, so this is the one chain worth keeping staffed. Bakers fetch their own flour and haul the loaves to the store. The smell draws people over even when they have no business here, which is a reason in itself to have the one bakery somewhere people pass. It can be moved if you decide wrong.',
    slots: [2, 3],
    job: 'baker',
    recipe: { inputs: { flour: 2 }, outputs: { bread: 3 }, seconds: 22 },
    unique: true,
    unlock: 'bakery',
    light: [{ x: 1.0, y: 1.3, radius: 42, color: '#ffa14a' }],
    solid: true,
  },
  well: {
    id: 'well',
    name: 'Well',
    category: 'comfort',
    w: 1,
    h: 1,
    cost: { stone: 15 },
    labour: 20,
    maxLevel: 1,
    order: 30,
    desc: 'People gather at wells. Nobody has ever been able to explain why.',
    how: 'It does nothing for the economy. People simply come and stand at it, which is what it is for — and a place worth standing about in is a place worth walking to, which is the whole of how Vibes work. Twelve Vibes, the most of anything, and the kingdom keeps one.',
    unlock: 'well',
    vibes: 12,
    maxTotal: 1,
    solid: true,
  },
  bench: {
    id: 'bench',
    name: 'Bench',
    category: 'comfort',
    w: 1,
    h: 1,
    cost: { wood: 6 },
    labour: 6,
    maxLevel: 1,
    order: 31,
    desc: 'Somewhere to sit and not do very much.',
    how: 'Villagers pass by, sit down for a while, and get up again no better off in any way that can be counted. It is the only building where they are recorded as resting rather than watching. Five Vibes each, and the kingdom keeps two.',
    vibes: 5,
    maxTotal: 2,
    solid: false,
  },
  lantern: {
    id: 'lantern',
    name: 'Lantern',
    category: 'comfort',
    w: 1,
    h: 1,
    cost: { wood: 4, stone: 3 },
    labour: 8,
    maxLevel: 1,
    order: 32,
    desc: 'Lights a small circle of the kingdom after dark.',
    how: 'Lights a small circle after dark and nothing else. It does not make anyone work later or walk faster; the kingdom just looks better with a few of them, which is worth two Vibes apiece. Eight is as many as anybody has ever wanted at once.',
    vibes: 2,
    maxTotal: 8,
    light: [{ x: 0.5, y: 0.4, radius: 52, color: '#ffbe63' }],
    solid: false,
  },
  flowerbed: {
    id: 'flowerbed',
    name: 'Flower Bed',
    category: 'comfort',
    w: 1,
    h: 1,
    cost: { wood: 3 },
    labour: 6,
    maxLevel: 1,
    order: 33,
    desc: 'Pretty. Certain small creatures have opinions about flowers.',
    how: 'Somewhere to stop and look. Certain small creatures have opinions about flowers, though nobody has written down what those opinions are. Three Vibes each, up to four beds of them.',
    vibes: 3,
    maxTotal: 4,
    solid: false,
  },
  sapling: {
    id: 'sapling',
    name: 'Sapling',
    category: 'comfort',
    w: 1,
    h: 1,
    cost: { wood: 2 },
    labour: 5,
    maxLevel: 1,
    // Off the menu. It was the one comfort that did nothing at all — it is not a
    // tree anybody can fell and it is worth no Vibes — so with the comforts now
    // counted it had become a row that only ever wasted the wood. The def stays
    // so that kingdoms with saplings already planted still open; those stand
    // where they were put and go on being small.
    order: -1,
    desc: 'Plant a tree. It will take a while, but it will get there.',
    how: 'A tree in the sense that it is trying. Nothing harvests it and nothing depends on it — it stands where you put it and gets on with being small. The kingdom no longer plants new ones.',
    solid: false,
  },
  statue: {
    id: 'statue',
    name: 'Standing Stone',
    category: 'comfort',
    w: 1,
    h: 1,
    cost: { stone: 40 },
    labour: 40,
    maxLevel: 1,
    order: 35,
    desc: 'Nobody remembers putting it there, which is impressive, because you did.',
    how: 'It produces nothing and improves nothing. People walk over to look at it, which over a long enough evening is a kind of production — and ten Vibes, which is the second most of anything. There is only ever one.',
    unlock: 'statue',
    vibes: 10,
    maxTotal: 1,
    solid: true,
  },
};

// Negative order keeps a building out of the menu — either a landmark the
// player never places (the commons) or one the kingdom has stopped building
// (the sapling) whose def has to stay for the saves that contain them.
export const BUILD_ORDER: BuildingId[] = (Object.keys(BUILDINGS) as BuildingId[])
  .filter((k) => BUILDINGS[k].order >= 0)
  .sort((a, b) => BUILDINGS[a].order - BUILDINGS[b].order);

/**
 * What to call a particular building, which is not always what to call the kind
 * of building: the commons is a Base Camp, a Settled Camp or a Village Commons
 * depending on how far it has come. The build menu wants the level-1 name;
 * anything naming a building that actually stands wants this.
 */
export function buildingName(def: BuildingId, level = 1): string {
  const d = BUILDINGS[def];
  return d.levelNames?.[Math.min(level, d.levelNames.length) - 1] ?? d.name;
}

/**
 * What the next improvement costs. An explicit table wins where there is one,
 * because a multiplier on the base cost cannot introduce a material the
 * building did not need at first. Otherwise the multiplier compounds with
 * level, so the second improvement is dearer than the first.
 */
export function upgradeCostOf(def: BuildingId, level: number): Partial<Record<ResourceId, number>> {
  const d = BUILDINGS[def];
  const explicit = d.upgradeCosts?.[level - 1];
  if (explicit) return explicit;
  const mul = (d.upgradeCostMul ?? 2) ** level;
  const out: Partial<Record<ResourceId, number>> = {};
  for (const k in d.cost) {
    const res = k as ResourceId;
    out[res] = Math.ceil((d.cost[res] ?? 0) * mul);
  }
  return out;
}

/**
 * What the kingdom must have *done* before the next improvement, as opposed to
 * what it must have in store. Most buildings ask for nothing beyond materials.
 */
export function upgradeReqsOf(def: BuildingId, level: number): UpgradeReq[] {
  return BUILDINGS[def].upgradeReqs?.[level - 1] ?? [];
}

/** Default reach for a building whose workers go out to nodes. */
export const DEFAULT_WORK_RANGE = 13;

/**
 * How far this building's workers will go for their nodes. One number, used by
 * the planner, by the panel's count of what is left, and by the ring drawn on
 * the map while it is being placed — a range the player is shown and a range
 * the workers actually keep to have to be the same range.
 */
export function rangeOf(def: BuildingId, level: number): number {
  const d = BUILDINGS[def];
  if (!d.range) return DEFAULT_WORK_RANGE;
  return d.range[Math.min(level, d.range.length) - 1];
}

/**
 * What moving a building costs. The full materials of a new one, and the full
 * labour: taking a building apart and putting it up again somewhere else is the
 * same work either way, and charging less would make relocation the cheap way
 * to hold a building rather than a decision. What it is *not* is a rebuild —
 * the level, the name, the workers and the history all step across intact, so
 * moving an improved quarry never costs you the improvement.
 */
export function relocateCost(def: BuildingId): Partial<Record<ResourceId, number>> {
  return { ...BUILDINGS[def].cost };
}

export function relocateLabour(def: BuildingId): number {
  return BUILDINGS[def].labour;
}

export const CATEGORY_META: Record<string, { name: string; icon: string }> = {
  housing: { name: 'Housing', icon: '🏠' },
  storage: { name: 'Storage', icon: '📦' },
  production: { name: 'Production', icon: '⚙️' },
  comfort: { name: 'Comfort', icon: '🌷' },
};

/** How fast a villager crosses each terrain, as a multiplier on base speed. */
export const TERRAIN_SPEED: Record<string, number> = {
  grass: 1.0,
  meadow: 1.0,
  sand: 0.95,
  forest: 0.7,
  rocky: 0.72,
  shallow: 0.45,
  water: 0,
};

/**
 * Ground as the player sees it. `feel` is the fallback line for the tile panel
 * when nothing has been discovered here yet — a mood, never a spawn rule.
 */
export const TERRAIN_META: Record<TerrainId, { name: string; desc: string; like: string; feel: string }> = {
  water: {
    name: 'Open water',
    desc: 'Too deep to cross and too deep to build on. It stays as it is.',
    like: 'open water like this',
    feel: 'Whatever lives out here comes and goes on its own terms.',
  },
  shallow: {
    name: 'Shallows',
    desc: 'Wadeable, slowly. Nothing can be built standing in it.',
    like: 'shallows like this',
    feel: 'The edge of the water is where most things stop to drink.',
  },
  sand: {
    name: 'Sand',
    desc: 'Loose underfoot, so a little slower to walk, but perfectly buildable.',
    like: 'sandy ground like this',
    feel: 'Quiet ground. Things pass through more than they settle.',
  },
  grass: {
    name: 'Grass',
    desc: 'Plain open ground. Easy to walk and the simplest place to build.',
    like: 'open ground like this',
    feel: 'Ordinary ground, which is to say almost anything might wander across it.',
  },
  meadow: {
    name: 'Meadow',
    desc: 'Long grass and wildflowers. Walks the same as plain grass.',
    like: 'meadows like this',
    feel: 'Meadows tend to be busier than they look if you sit still a while.',
  },
  forest: {
    name: 'Woodland',
    desc: 'Dense enough to slow a walk. Trees here can be felled for wood.',
    like: 'woodland like this',
    feel: 'Plenty of cover. Things watch from woodland before they cross it.',
  },
  rocky: {
    name: 'Rocky ground',
    desc: 'Awkward footing, so slower going. The boulders here are the kingdom’s only stone, and it takes a quarry to work them.',
    like: 'rocky ground like this',
    feel: 'Bare and exposed. What comes up here usually has a reason.',
  },
};

/**
 * What sits on a tile. `yields` is the resource a villager can take from it;
 * props without one are scenery, and scenery is half the point.
 */
export const PROP_META: Record<
  PropId,
  { name: string; desc: string; yields?: ResourceId; regrowsFrom?: PropId }
> = {
  tree: {
    name: 'Tree',
    desc: 'Anyone can fell it for wood, axe or no axe. A woodcutter is simply quicker about it.',
    yields: 'wood',
  },
  stump: { name: 'Stump', desc: 'Felled. Left alone, it will come back as a tree.', regrowsFrom: 'tree' },
  boulder: {
    name: 'Boulder',
    desc: 'Far too much for bare hands. A stoneworker sent out from a quarry can break it for stone; until then it is part of the landscape.',
    yields: 'stone',
  },
  pebbles: {
    name: 'Pebbles',
    desc: 'Loose chippings. Where a boulder was worked, another gathers in time.',
  },
  bush: { name: 'Bush', desc: 'Scrub. Slows a walk slightly and gives small animals somewhere to hide.' },
  flowers: { name: 'Wildflowers', desc: 'No use whatsoever. Some things are fonder of a tile for having them.' },
  reeds: { name: 'Reeds', desc: 'Waterside growth. Good cover at the edge of the shallows.' },
  lilypad: { name: 'Lily pads', desc: 'Floating on the water, going nowhere.' },
};

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  rabbit: {
    id: 'rabbit',
    name: 'Rabbit',
    plural: 'Rabbits',
    habitat: { meadow: 1.0, grass: 0.7, forest: 0.2 },
    likesProps: { flowers: 0.8, bush: 0.4 },
    active: [0.02, 0.78],
    density: 0.011,
    hardCap: 7,
    speed: 1.7,
    skittish: 3.2,
    rarity: 1,
    colors: { body: '#b39a80', belly: '#f0e6d8', accent: '#8a7460' },
    hint: 'Rabbits seem to prefer open meadows, especially where flowers grow.',
    size: 1,
  },
  squirrel: {
    id: 'squirrel',
    name: 'Squirrel',
    plural: 'Squirrels',
    habitat: { forest: 1.0, grass: 0.25 },
    likesProps: { tree: 1.2 },
    active: [0.03, 0.72],
    density: 0.013,
    hardCap: 7,
    speed: 2.1,
    skittish: 2.4,
    rarity: 1,
    colors: { body: '#a8622f', belly: '#e8cfae', accent: '#7c451f' },
    hint: 'Squirrels never stray far from standing trees.',
    size: 1,
  },
  bird: {
    id: 'bird',
    name: 'Sparrow',
    plural: 'Sparrows',
    habitat: { grass: 0.7, meadow: 0.8, forest: 0.8 },
    likesProps: { tree: 0.5 },
    active: [0.0, 0.7],
    density: 0.014,
    hardCap: 9,
    speed: 2.6,
    skittish: 2.0,
    rarity: 1,
    colors: { body: '#8c7a63', belly: '#e8ddc8', accent: '#4a3f34' },
    hint: 'Sparrows turn up almost anywhere, but they love a farm.',
    size: 0,
  },
  duck: {
    id: 'duck',
    name: 'Duck',
    plural: 'Ducks',
    habitat: { shallow: 1.2, water: 0.9, sand: 0.5 },
    likesProps: { reeds: 0.8, lilypad: 0.6 },
    active: [0.02, 0.8],
    density: 0.05,
    hardCap: 5,
    speed: 1.1,
    skittish: 1.6,
    rarity: 1.4,
    colors: { body: '#5c6b4a', belly: '#e6dcc0', accent: '#e0a83c' },
    hint: 'Ducks arrive wherever there is standing water to sit on.',
    size: 1,
  },
  frog: {
    id: 'frog',
    name: 'Frog',
    plural: 'Frogs',
    habitat: { shallow: 1.4, sand: 0.4 },
    likesProps: { reeds: 1.0, lilypad: 1.4 },
    active: [0.55, 0.98],
    density: 0.045,
    hardCap: 5,
    speed: 0.9,
    skittish: 1.4,
    rarity: 1.6,
    colors: { body: '#6f9c4a', belly: '#d6e2a8', accent: '#3f6030' },
    hint: 'Frogs start up around the water in the evening.',
    size: 0,
    seasons: ['spring', 'summer', 'autumn'],
  },
  butterfly: {
    id: 'butterfly',
    name: 'Butterfly',
    plural: 'Butterflies',
    habitat: { meadow: 1.0, grass: 0.4 },
    likesProps: { flowers: 2.0 },
    active: [0.1, 0.6],
    density: 0.03,
    hardCap: 8,
    speed: 1.5,
    skittish: 0,
    rarity: 1.2,
    colors: { body: '#e8a0c8', belly: '#fff0f6', accent: '#c05c92' },
    hint: 'Butterflies gather wherever flowers are planted.',
    size: 0,
    seasons: ['spring', 'summer'],
  },
  bee: {
    id: 'bee',
    name: 'Bee',
    plural: 'Bees',
    habitat: { meadow: 0.9, grass: 0.3 },
    likesProps: { flowers: 2.2 },
    active: [0.08, 0.62],
    density: 0.03,
    hardCap: 8,
    speed: 2.2,
    skittish: 0,
    rarity: 1.3,
    colors: { body: '#e8c040', belly: '#fff4c0', accent: '#332a18' },
    hint: 'Bees follow the flowers, and seem busier near farmland.',
    size: 0,
    seasons: ['spring', 'summer', 'autumn'],
  },
  deer: {
    id: 'deer',
    name: 'Deer',
    plural: 'Deer',
    habitat: { forest: 1.2, meadow: 0.4 },
    likesProps: { tree: 0.7, bush: 0.5 },
    active: [0.0, 0.14],
    density: 0.008,
    hardCap: 3,
    speed: 1.5,
    skittish: 6.5,
    rarity: 2.6,
    colors: { body: '#a87a4c', belly: '#e8d2ac', accent: '#6b4a2a' },
    hint: 'Deer come out of deep woodland at first light, and only if nobody is about.',
    size: 2,
  },
  fox: {
    id: 'fox',
    name: 'Fox',
    plural: 'Foxes',
    habitat: { forest: 1.0, meadow: 0.5, grass: 0.3 },
    likesProps: { bush: 0.6, tree: 0.4 },
    active: [0.72, 0.99],
    density: 0.005,
    hardCap: 2,
    speed: 2.0,
    skittish: 5.0,
    rarity: 3,
    colors: { body: '#d2703a', belly: '#f2e8dc', accent: '#8c3f1c' },
    hint: 'A fox will cross the kingdom at night, and never twice by the same route.',
    size: 1,
  },
  owl: {
    id: 'owl',
    name: 'Snowy Owl',
    plural: 'Snowy Owls',
    habitat: { forest: 1.0, meadow: 0.6, rocky: 0.5 },
    likesProps: { tree: 1.0 },
    active: [0.74, 0.99],
    density: 0.004,
    hardCap: 1,
    speed: 1.6,
    skittish: 4.0,
    rarity: 3.5,
    colors: { body: '#efeae2', belly: '#ffffff', accent: '#b8ae9e' },
    hint: 'Snowy owls are winter visitors, and they do not visit often.',
    size: 2,
    seasons: ['winter'],
  },
};

export const SPECIES_ORDER = Object.keys(SPECIES) as SpeciesId[];
