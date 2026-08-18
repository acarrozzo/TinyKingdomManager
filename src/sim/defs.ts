/** Static game data: buildings, jobs, traits, wildlife, ranks. */

import type {
  BuildingDef,
  BuildingId,
  Focus,
  GameState,
  JobId,
  PropId,
  Rank,
  Recipe,
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
 * Food security by *meals* per villager: none, one each, two each, and so on up
 * to four. Per head rather than per kingdom, so a larder that was reassuring at
 * four people stops being reassuring at twelve without anything being rewritten.
 * Read as a ramp between the points rather than as five steps.
 *
 * A meal is a loaf or a cooked fish, counted together and worth exactly the
 * same. A kingdom that lives on fish is as well fed as one that lives on bread,
 * and there is no bonus for keeping both — variety is a thing the villagers
 * have opinions about, not a thing the kingdom is scored on.
 */
export const FOOD_VIBES = [0, 8, 16, 24, 30];

/**
 * What food is worth before the kingdom has ever cooked anything. Neutral on
 * purpose: there is no food because there is no kitchen, and marking a kingdom
 * down for a system it has not been handed yet is a punishment for playing in
 * order.
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
  fish: { name: 'Fish', icon: '🐟', color: '#7fb0c8' },
  cookedFish: { name: 'Cooked Fish', icon: '🍽️', color: '#d8a86a' },
  // Processed metal is a Bar. Not an ingot, anywhere, ever.
  ironOre: { name: 'Iron Ore', icon: '🟤', color: '#8d6a52' },
  coal: { name: 'Coal', icon: '⚫', color: '#4a4a4e' },
  ironBar: { name: 'Iron Bar', icon: '🔩', color: '#9fa6ad' },
  steelBar: { name: 'Steel Bar', icon: '🔗', color: '#c2cbd6' },
  mithrilOre: { name: 'Mithril Ore', icon: '🔷', color: '#7fb6cf' },
  mithrilBar: { name: 'Mithril Bar', icon: '💠', color: '#a8e0f0' },
  coin: { name: 'Coins', icon: '🪙', color: '#f0c860' },
};

/** Where each resource comes from and where it goes, for the top-bar hover. */
export const RESOURCE_INFO: Record<string, { from: string; used: string }> = {
  wood: {
    from: 'Woodcutters at the lodge, and helpers felling any tree by hand. The first twelve came off a single tree, swung at by somebody who had only just arrived.',
    used: 'Nearly every building, from a cabin at 20 up to a windmill at 50, and every step the commons takes.',
  },
  stone: {
    from: 'Miners cutting it out of the rocky ground the quarry stands on, and nowhere else. The loose boulders lying about are scenery — too much for bare hands, and gone for good once anything is built over one.',
    used: 'Improving the commons or a cabin, wells, and the workshops further along the chain.',
  },
  wheat: {
    from: 'Farmers sowing and reaping the plots around a wheat farm.',
    used: 'Ground into flour at the windmill, three wheat at a time.',
  },
  flour: {
    from: 'The windmill, two flour for every three wheat carried in.',
    used: 'Baked into bread at the kitchen, two flour to a batch of three loaves.',
  },
  bread: {
    from: 'The kitchen, three loaves a batch. Slower to set up than fish and far easier to keep going once it is.',
    used: 'Eaten. One loaf is a whole meal, and some people would rather have it than fish.',
  },
  fish: {
    from: 'Fishers working the water within reach of their hut, a few at a time. A spot worked hard goes quiet for a while and then comes back.',
    used: 'Nothing eats it raw. Two fish cook down to two meals at the kitchen.',
  },
  cookedFish: {
    from: 'The kitchen, out of raw fish. The same cooks make the bread.',
    used: 'Eaten, and it fills somebody up exactly as well as a loaf does.',
  },
  ironOre: {
    from: 'The mine, once it has been sunk deep enough to be an Iron Mine. The same miners bring it up as bring up the stone.',
    used: 'Smelted into iron bars at the forge, one for one, with no coal wanted.',
  },
  coal: {
    from: 'A Deep Mine, which is the third thing the mine becomes. Nothing else in the kingdom turns any up.',
    used: 'Only the forge burns it, and only for steel: two coal to every iron bar going into one.',
  },
  ironBar: {
    from: 'The forge, one bar from one iron ore. No coal is needed for this part, which surprises people.',
    used: 'The heavier building work, and the first half of every steel bar.',
  },
  steelBar: {
    from: 'The forge again: one iron bar and two coal make one steel bar.',
    used: 'Nothing yet. It piles up handsomely and waits for the kingdom to think of something.',
  },
  mithrilOre: {
    from: 'Nowhere. There is talk of a seam under the deep workings, and talk is as far as it has got.',
    used: 'Nothing, since there is none of it.',
  },
  mithrilBar: {
    from: 'Nowhere yet. The forge would want one mithril ore and four coal, if there were any ore.',
    used: 'Nothing, since there is none of it.',
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
    desc: 'Fells trees by hand, hauls goods between buildings, and helps raise new construction. Anything out of the ground is beyond bare hands; that wants a mine.',
  },
  woodcutter: { name: 'Woodcutter', icon: '🪓', desc: 'Fells trees near the lodge and carries wood to storage.' },
  miner: {
    name: 'Miner',
    icon: '⛏️',
    desc: 'Cuts stone out of the rock at the mine — and iron ore, and coal, as the mine goes deeper. One trade for the lot of it.',
  },
  farmer: { name: 'Farmer', icon: '🌱', desc: 'Sows and harvests the wheat plots around the farm.' },
  miller: { name: 'Miller', icon: '🌬️', desc: 'Grinds wheat into flour at the windmill.' },
  cook: {
    name: 'Cook',
    icon: '👩‍🍳',
    desc: 'Bakes bread and cooks fish at the kitchen. One trade for both, and practice at one is practice at the other.',
  },
  fisher: {
    name: 'Fisher',
    icon: '🎣',
    desc: 'Works the water within reach of the hut, and carries the catch back. Nothing eats it until a cook has had it.',
  },
  smith: { name: 'Smith', icon: '🔥', desc: 'Smelts ore into iron bars at the forge, and iron bars into steel.' },
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

/**
 * A finished building of a kind, for the requirement predicates below. One that
 * is mid-improvement still counts: it is standing, it is working, and a
 * requirement that blinked off while somebody put a chimney on a cabin would be
 * telling the kingdom it had gone backwards.
 */
function standing(g: GameState, def: BuildingId): boolean {
  return g.buildings.some((b) => b.def === def && (b.stage === 'done' || b.upgrading));
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
    // Cooked food of any kind, deliberately: a kingdom that lives on fish has
    // fed itself just as thoroughly as one that lives on bread, and asking for
    // loaves specifically would make one of the two branches the real one.
    { label: 'Food cooked in a kitchen of your own', met: (g) => g.stats.cooked >= 6 },
    { label: 'Six people about the place', met: (g) => g.villagers.length >= 6 },
    {
      label: 'Somebody settled into a trade',
      met: (g) => g.buildings.some((b) => b.stage === 'done' && !!BUILDINGS[b.def].job && b.workers.length > 0),
    },
  ],
  [{ label: 'A way of building that nobody here knows', met: () => false, impossible: true }],
];

/**
 * What the mine must have done before it goes deeper. It is the kingdom's other
 * ladder — Quarry, Iron Mine, Deep Mine — and it obeys the same two rules the
 * commons does.
 *
 * No step may ask for something the same step unlocks: the Iron Mine is what
 * hands over the forge, so it is the step *after* that may ask for iron off it.
 * And every requirement is an accomplishment rather than a stock level, because
 * what is in the store goes down again the moment anybody builds a cabin.
 *
 * The last step is deliberately out of reach, exactly like the Kingdom Commons.
 * Turning mithril on later is a one-line change to that predicate.
 */
const MINE_REQS: UpgradeReq[][] = [
  [
    { label: 'A settled camp to work out of', met: (g) => commonsAt(g, 2) },
    { label: 'Two hundred stone out of this rock', met: (g) => g.stats.mined >= 200 },
  ],
  [
    { label: 'A forge, standing and lit', met: (g) => standing(g, 'forge') },
    { label: 'Twenty bars off it', met: (g) => g.stats.smelted >= 20 },
  ],
  [{ label: 'A seam nobody here has found yet', met: () => false, impossible: true }],
];

/** The commons at a given level, for the requirements above. */
function commonsAt(g: GameState, level: number): boolean {
  return g.buildings.some(
    (b) => b.def === 'commons' && (b.stage === 'done' || b.upgrading) && b.level >= level,
  );
}

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
    how: 'Woodcutters work whatever trees stand within thirteen tiles of the lodge — seventeen once it is improved — and range further only when the near ones are gone. The reach is drawn on the map while you are placing or moving it, along with every tree inside it. Each felled tree becomes a stump and grows back in time. They chop three trips\' worth, haul it to the nearest store, and set off again. When wood climbs past about a third of the whole store they stop and go help elsewhere, so the barn never fills with timber while the supper runs out. There is only ever one lodge; if the wood around it thins out, move it rather than building a second.',
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
    // One building, sunk deeper. A Quarry cuts stone; an Iron Mine finds ore in
    // the same rock; a Deep Mine reaches the coal. The fourth name is written
    // down and openly out of reach, like the Kingdom Commons.
    levelNames: ['Quarry', 'Iron Mine', 'Deep Mine', 'Mithril Mine'],
    category: 'production',
    w: 2,
    h: 2,
    // Wood only, and it has to stay that way: this is the kingdom's only source
    // of stone, so a quarry that cost stone could never be built at all.
    cost: { wood: 30 },
    labour: 60,
    maxLevel: 4,
    // Explicit rather than a multiplier, because each step wants a material the
    // step before it could not produce — which is the whole shape of the ladder.
    // Every one of these has to fit inside the storage the kingdom has by then:
    // a Settled Camp holds 200, a Village Commons 450.
    upgradeCosts: [
      { wood: 70, stone: 45 },
      { wood: 120, stone: 90, ironBar: 12 },
      { wood: 200, stone: 160, steelBar: 20 },
    ],
    upgradeReqs: MINE_REQS,
    order: 21,
    desc: 'Everything that comes out of the ground comes out of here. It has to stand on or against rocky ground.',
    how: 'Miners work the rock the building itself stands on, so it wants rocky ground under it or beside it — the ring drawn while you place it is how far the seam spreads, and the more rock inside that ring the faster the work goes. It does not depend on the loose boulders lying about; those are scenery, they are finite, and building over one is the end of it. The rock underneath is not: a quarry goes on producing indefinitely. Sunk deeper it becomes an Iron Mine, then a Deep Mine, and each step adds a material without taking one away — the same people work it, and nobody needs reassigning. What they bring up is set by the Getting out box on this panel: leave it Balanced and they follow whatever the kingdom is shortest of, or name one material and they will favour it. Changing your mind costs nothing. As with wood, they down tools and go help elsewhere once one material is past about a third of the store. There is only ever one mine; if you have sunk it in the wrong place, move it.',
    slots: [2, 3, 3, 4],
    job: 'miner',
    // Never shrinks. An improvement adds to this list, so a Deep Mine still
    // brings up stone and the kingdom is never asked to give something up.
    extracts: [
      ['stone'],
      ['stone', 'ironOre'],
      ['stone', 'ironOre', 'coal'],
      ['stone', 'ironOre', 'coal', 'mithrilOre'],
    ],
    focusNote:
      'Balanced follows whatever the kingdom is shortest of rather than keeping equal piles. Name one material and they will favour it — and if there is nowhere left to put that one, they quietly work on something else instead of stopping.',
    needsRock: true,
    range: [13, 15, 17, 19],
    unique: true,
    unlock: 'quarry',
    solid: true,
  },
  forge: {
    id: 'forge',
    name: 'Forge',
    category: 'production',
    w: 2,
    h: 2,
    cost: { wood: 45, stone: 60 },
    labour: 130,
    maxLevel: 2,
    upgradeCostMul: 2.0,
    order: 26,
    desc: 'Ore becomes iron, and iron becomes steel. Wants an Iron Mine behind it.',
    how: 'One iron ore makes one iron bar, and that part wants no coal at all — the coal is for the next step, where one iron bar and two coal make one steel bar. There is a third recipe written on the wall, for mithril, and nobody here has ever seen any. The smith fetches their own materials from the store and carries the bars back. Which of the two it is working on is set by the Making box on this panel; left Balanced it smelts ore into iron and only reaches for the coal once there are bars to spare. Short of something, it simply waits — nothing here is spoiled or lost by a shelf running empty. There is one forge, and it can be moved.',
    slots: [1, 2],
    job: 'smith',
    // Iron wants no coal. That is the one thing about this building people get
    // wrong, so it is the first recipe and the copy says it twice.
    recipes: [
      { inputs: { ironOre: 1 }, outputs: { ironBar: 1 }, seconds: 14 },
      { inputs: { ironBar: 1, coal: 2 }, outputs: { steelBar: 1 }, seconds: 26 },
      { inputs: { mithrilOre: 1, coal: 4 }, outputs: { mithrilBar: 1 }, seconds: 40, locked: true },
    ],
    focusNote:
      'Balanced smelts ore into iron and only reaches for the coal once there are bars to spare. Name one and it will favour that instead. Changing your mind costs nothing, and nothing in progress is lost.',
    unique: true,
    unlock: 'forge',
    light: [{ x: 1.0, y: 1.3, radius: 46, color: '#ff8a3c' }],
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
    order: 23,
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
    order: 24,
    desc: 'Grinds wheat into flour. The sails turn whenever the miller is working.',
    how: 'Three wheat in, two flour out, about eighteen seconds a batch and quicker as the miller learns the work. The miller fetches wheat from the store personally rather than waiting to be supplied, and carries the flour back once the shelf is worth a trip. Nothing here is automatic: if nobody is walking, nothing is moving. There is one windmill, and it can be moved — a shorter walk between the farm, the mill and the ovens is most of what makes bread arrive.',
    slots: [1, 2],
    job: 'miller',
    recipe: { inputs: { wheat: 3 }, outputs: { flour: 2 }, seconds: 18 },
    unique: true,
    unlock: 'mill',
    solid: true,
  },
  kitchen: {
    id: 'kitchen',
    name: 'Kitchen',
    category: 'production',
    w: 2,
    h: 2,
    cost: { wood: 40, stone: 40 },
    labour: 120,
    maxLevel: 2,
    upgradeCostMul: 2.0,
    order: 25,
    desc: 'Where both chains end: flour becomes bread, and the morning’s fish becomes supper.',
    how: 'Two flour make three loaves in about twenty-two seconds; two fish come off the fire as two meals in about sixteen. A loaf and a cooked fish fill somebody up exactly as well as each other, so which of the two the kingdom lives on is a question about the land rather than about the food. The cooks decide between the recipes themselves — whichever the kingdom is shorter of, with whatever is actually in store — so there is no queue to keep and nothing to switch by hand, though you can name a preference if you want one. They fetch their own flour and fish and carry the meals back. Once there is comfortably enough food for everybody they ease off and go and help elsewhere, rather than cooking a hundred suppers nobody has room for. The oven draws people over even when they have no business here, which is a reason in itself to put it somewhere people pass. There is one kitchen, and it can be moved.',
    slots: [2, 3],
    job: 'cook',
    // Bread first: it is the recipe most kingdoms meet first, and the panel
    // reads top-down. Neither is better than the other and the copy says so.
    recipes: [
      { inputs: { flour: 2 }, outputs: { bread: 3 }, seconds: 22 },
      { inputs: { fish: 2 }, outputs: { cookedFish: 2 }, seconds: 16 },
    ],
    focusNote:
      'Balanced cooks whichever meal the kingdom is shorter of, out of whatever is actually in store — which is usually the right answer. Name one and the cooks will favour it, and quietly make the other anyway rather than standing idle if the ingredients run out.',
    unique: true,
    unlock: 'kitchen',
    light: [{ x: 1.0, y: 1.3, radius: 42, color: '#ffa14a' }],
    solid: true,
  },
  fishhut: {
    id: 'fishhut',
    name: 'Fishing Hut',
    category: 'production',
    w: 2,
    h: 2,
    // Wood alone, and cheap: this is the food chain a young kingdom can afford
    // before it has broken any stone at all, which is the whole of its place in
    // the game. Anything dearer than a lodge would take that away.
    cost: { wood: 25 },
    labour: 45,
    maxLevel: 2,
    upgradeCostMul: 2.2,
    order: 22,
    desc: 'Stands on dry land beside fishable water. Fishers work the spots nearby, lake or coast.',
    how: 'It has to stand on dry land with water inside its reach — the lake or the sea, both work, though a lake shore is usually the richer of the two. The ring drawn while you are placing it marks every promising spot in reach: reed beds, lily pads, the lip where the shallows drop away, and the crooks of an inlet. Fishers walk out to one, cast, wait, and bring back what they get. A spot worked over and over goes quiet for a while and then comes back on its own, so nothing here can ever be fished out — a hut on thin water is slower, never idle. One fisher to begin with and two once it is improved, which is as far as it goes: this is the food chain that feeds a small settlement quickly, not the one that feeds a large one forever. There is one hut, and it can be moved when the good water is somewhere else.',
    slots: [1, 2],
    job: 'fisher',
    fishes: true,
    range: [10, 13],
    unique: true,
    unlock: 'fishhut',
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

// ---------------------------------------------------------------------------
// Making things: recipes, extraction, and what a building may be told to favour
// ---------------------------------------------------------------------------

/**
 * Everything this building knows how to make. A workshop with a single recipe
 * keeps saying `recipe`; the forge lists several. One function so that nothing
 * downstream has to care which kind it is holding.
 */
export function recipesOf(def: BuildingId): Recipe[] {
  const d = BUILDINGS[def];
  if (d.recipes) return d.recipes;
  return d.recipe ? [d.recipe] : [];
}

/** Recipes a smith could actually run today — the mithril one never is. */
export function liveRecipesOf(def: BuildingId): Recipe[] {
  return recipesOf(def).filter((r) => !r.locked);
}

/** What one batch of a recipe is called by, which is its first output. */
export function recipeOutput(r: Recipe): ResourceId {
  return Object.keys(r.outputs)[0] as ResourceId;
}

/** What a mine at this level brings up. Empty for everything that is not a mine. */
export function extractsOf(def: BuildingId, level: number): ResourceId[] {
  const d = BUILDINGS[def];
  if (!d.extracts) return [];
  return d.extracts[Math.min(level, d.extracts.length) - 1];
}

/**
 * Everything a building of this kind and level produces, however it produces it
 * — recipe outputs and mined materials alike. The helper ladder uses this to
 * decide whether there is a shelf worth clearing.
 */
export function outputsOf(def: BuildingId, level: number): ResourceId[] {
  return [...extractsOf(def, level), ...liveRecipesOf(def).map(recipeOutput)];
}

/**
 * The focus settings this building may be given right now — Balanced, then one
 * per thing it can currently produce.
 *
 * Only what this *level* reaches is offered. A Quarry does not list Iron Ore it
 * cannot get at, and the forge does not list mithril; offering a choice that
 * cannot be acted on is worse than not offering it, because the player spends
 * the next ten minutes wondering why nothing happened.
 */
export function focusOptions(def: BuildingId, level: number): Focus[] {
  const made = outputsOf(def, level);
  if (made.length < 2) return [];
  return ['balanced', ...made];
}

/** What a focus setting is called in the panel. */
export function focusLabel(f: Focus): string {
  return f === 'balanced' ? 'Balanced' : RESOURCE_META[f].name;
}

/**
 * How much of a material the kingdom wants to be sitting on before a Balanced
 * mine stops favouring it. Not equal quantities — stone is what half the
 * kingdom is built out of and ore is not, so "shortest of" is measured against
 * these rather than against each other.
 */
export const BALANCE_TARGET: Partial<Record<ResourceId, number>> = {
  stone: 160,
  ironOre: 40,
  coal: 40,
  mithrilOre: 20,
  ironBar: 30,
  steelBar: 20,
  mithrilBar: 10,
};

/** Default reach for a building whose workers go out to nodes. */
export const DEFAULT_WORK_RANGE = 13;

// ---------------------------------------------------------------------------
// The mine
// ---------------------------------------------------------------------------

/** Seconds of work for one load at the rock face, before skill and richness. */
export const MINE_SECONDS = 7;
/** What one stint brings up. Ore and coal come slower than plain stone. */
export const MINE_YIELD: Partial<Record<ResourceId, number>> = {
  stone: 3,
  ironOre: 2,
  coal: 2,
  mithrilOre: 1,
};
/**
 * Rocky tiles inside the mine's reach at which the seam is as good as it gets.
 * Below it the work is slower — never stopped, since the placement rule already
 * guarantees rock under the building, and a mine that produced nothing at all
 * would be a punishment for a decision made an hour earlier.
 */
export const RICH_ROCK = 70;
export const RICH_MIN = 0.55;

/** How fast a mine on this much rock works, as a multiplier. */
export function richnessMul(rockTiles: number): number {
  const t = Math.min(1, rockTiles / RICH_ROCK);
  return RICH_MIN + (1 - RICH_MIN) * t;
}

// ---------------------------------------------------------------------------
// Fishing
// ---------------------------------------------------------------------------

/**
 * Seconds of casting and waiting for one go at a spot, before skill and season.
 * Longer than a swing at a tree on purpose: fishing is watching somebody stand
 * still, and hurrying it would lose the only thing it is really for.
 */
export const FISH_SECONDS = 11;
/** Fish landed by one go at an undisturbed spot of the best sort. */
export const FISH_YIELD = 3;
/**
 * How much of a spot's rest one go uses up, and how long a spent one takes to
 * come back — about four game-minutes from nothing to full. A spot is never
 * *emptied*: `FISH_FLOOR` is what the tiredest water still gives, so a hut with
 * one pool in reach is slow and never idle, exactly like a mine on thin rock.
 */
export const FISH_TIRE = 0.34;
export const FISH_REST = 1 / (60 * 4);
export const FISH_FLOOR = 0.3;
/**
 * What a spot has to be worth before the hut's ring marks it and the placement
 * bar counts it. Ordinary open water below this is still perfectly fishable.
 */
export const GOOD_SPOT = 0.62;
/**
 * How close a hut has to be to the water to count as beside it. The mine's
 * `touchesRock` is the same rule one tile tighter; a hut wants a little more
 * slack, because the last dry tile on a reedy shore is often a tile nobody can
 * build a two-by-two on.
 */
export const WATER_NEAR = 3;
/**
 * The seasons, gently. Never a stop and barely a swing: cold water is slower,
 * and that is the whole of the weather in this game.
 */
export const FISH_SEASON: Record<string, number> = {
  spring: 1.05,
  summer: 1.1,
  autumn: 1.0,
  winter: 0.8,
};

// ---------------------------------------------------------------------------
// Food
// ---------------------------------------------------------------------------

/**
 * Meals per head the kingdom is comfortable holding, and a small pantry on top
 * so that a settlement of two is not held to five suppers. Past this the cooks
 * bank the fire and go and help elsewhere — the same rule the woodcutters
 * follow with a full barn, and the reason a kitchen cannot bury the kingdom
 * under four hundred loaves while the stone it wants has nowhere to go.
 *
 * Comfortably above the four a head that Vibes stop counting at, so easing off
 * never costs the kingdom a point of food security.
 */
export const FOOD_COMFORT_PER_HEAD = 5;
export const FOOD_COMFORT_FLOOR = 10;

/**
 * What each thing in the food chain is worth in meals, once everything
 * downstream of it has had a turn: three wheat make two flour make three
 * loaves, so a wheat is a meal and a flour is one and a half; two fish come off
 * the fire as two suppers, so a fish is one.
 *
 * This is how far the *whole* chain looks ahead before easing off. Without it
 * the kingdom stops cooking at a comfortable larder and then goes on farming,
 * milling and fishing into a barn full of ingredients for meals nobody wants —
 * which is the same complaint one step upstream.
 */
export const FOOD_CHAIN_VALUE: Partial<Record<ResourceId, number>> = {
  bread: 1,
  cookedFish: 1,
  fish: 1,
  flour: 1.5,
  wheat: 1,
};

/**
 * How far past comfortable the *ingredients* may run. Some slack on purpose:
 * a kitchen with nothing on its shelves the moment the cooks come back would
 * make easing off look like a stall.
 */
export const FOOD_CHAIN_HEADROOM = 1.5;

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
    desc: 'Too deep to cross and too deep to build on. It stays as it is — but a fisher can work it from the bank, and the lip where it meets the shallows is where they would rather stand.',
    like: 'open water like this',
    feel: 'Whatever lives out here comes and goes on its own terms.',
  },
  shallow: {
    name: 'Shallows',
    desc: 'Wadeable, slowly. Nothing can be built standing in it, though a fishing hut on the bank beside it does very well — especially where the reeds are.',
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
    desc: 'Awkward footing, so slower going. This is the ground a quarry has to stand on or against — everything the kingdom digs up comes out of rock like this.',
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
  { name: string; desc: string; yields?: ResourceId; worked?: boolean; regrowsFrom?: PropId }
> = {
  tree: {
    name: 'Tree',
    desc: 'Anyone can fell it for wood, axe or no axe. A woodcutter is simply quicker about it.',
    yields: 'wood',
    worked: true,
  },
  stump: { name: 'Stump', desc: 'Felled. Left alone, it will come back as a tree.', regrowsFrom: 'tree' },
  boulder: {
    name: 'Boulder',
    desc: 'Loose rock, and there is only so much of it: nothing puts a boulder back. Far too much for bare hands, though a kingdom with a quarry can make use of one rolled aside to build. A good sign of the sort of ground a quarry wants.',
    yields: 'stone',
  },
  pebbles: {
    name: 'Pebbles',
    desc: 'Loose chippings, going nowhere. Nothing grows back out of them.',
  },
  bush: { name: 'Bush', desc: 'Scrub. Slows a walk slightly and gives small animals somewhere to hide.' },
  flowers: { name: 'Wildflowers', desc: 'No use whatsoever. Some things are fonder of a tile for having them.' },
  reeds: {
    name: 'Reeds',
    desc: 'Waterside growth, and the surest sign of water worth fishing. They want it still, so there are far more of them round the lake than along the coast.',
  },
  lilypad: {
    name: 'Lily pads',
    desc: 'Floating on the water, going nowhere. Fish sit under them, which fishers know and frogs knew first.',
  },
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
