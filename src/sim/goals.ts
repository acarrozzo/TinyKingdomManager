/**
 * Onboarding goals and milestones.
 *
 * There are two things opening the build menu up and they are meant to be read
 * as one. The **commons** is the structural gate: each level of it is a step the
 * whole settlement takes, and it hands over a tier of buildings when it lands.
 * The **goals** teach the mechanics in between and unlock the food chain, which
 * has to come before the commons can ask for a cooked meal. Nothing unlocks
 * something that is a prerequisite of itself; see `COMMONS_REQS` in `defs.ts`.
 *
 * Food is deliberately two branches from one gate. Giving the kingdom's first
 * resource a home of its own — a staffed lodge or a staffed mine — opens the
 * Wheat Farm *and* the Fishing Hut, and the Kitchen opens on the first thing
 * worth cooking from either of them, so a kingdom that never sows and a kingdom
 * that never casts both arrive at the same building and neither branch is a
 * prerequisite of the other.
 *
 * That first gate used to be a Storehouse, and moving it is the point of the
 * storage redesign rather than a consequence of it: the lesson a player needs
 * in the first ten minutes is no longer "build somewhere to put things" but
 * "things are kept where they are made, so put the building somewhere sensible".
 */

import type { BuildingId, GameState, Goal } from '../types';
import { BUILDINGS, RESOURCE_META, extractsOf } from './defs';
import { journal, toast } from './journal';
import { totalOf } from './state';
import { rankOf } from './defs';
import { foundingDone } from './founding';

function has(g: GameState, def: string, minLevel = 1): boolean {
  return g.buildings.some((b) => b.def === def && b.stage === 'done' && b.level >= minLevel);
}
function staffed(g: GameState, def: string): boolean {
  return g.buildings.some((b) => b.def === def && b.stage === 'done' && b.workers.length > 0);
}

/**
 * The tier of building each level of the commons hands over. This is the
 * kingdom's spine: everything else the menu offers is either a comfort, which
 * needs no permission at all, or part of the food chain, which the goals open.
 *
 * The Base Camp hands over four foundations at once — somewhere to sleep,
 * somewhere to put things, and the two buildings that produce the only two raw
 * materials there are, each of which is also where that material will be kept.
 * That is deliberate: the first hour is about deciding where those four go, and
 * a kingdom that can fell trees but not break stone is one waiting on
 * permission rather than on itself.
 *
 * The storehouse is in that first tier and is a prerequisite of nothing. A
 * kingdom that never builds one is fed, housed and never stuck — the lodge, the
 * mine and the kitchen each hold their own — it simply walks further. That is
 * the shape it has to keep: the moment something requires a storehouse it stops
 * being a convenience and becomes a tax.
 */
const COMMONS_UNLOCKS: Record<number, string[]> = {
  1: ['cabin', 'storehouse', 'lodge', 'quarry'],
  2: ['well'],
  3: ['statue'],
};

/** Called when the commons is finished or improved, with the level it now is. */
export function unlockCommonsTier(g: GameState, level: number): void {
  for (const key of COMMONS_UNLOCKS[level] ?? []) unlock(g, key);
}

/**
 * The mine's own tier, handed over the same way the commons hands over its own.
 * There is only one entry and it is the whole reason the Iron Mine exists: ore
 * with nowhere to take it would be a resource that did nothing.
 */
const MINE_UNLOCKS: Record<number, string[]> = {
  2: ['forge'],
};

/** Called when the mine is finished or sunk deeper, with the level it now is. */
export function unlockMineTier(g: GameState, level: number): void {
  for (const key of MINE_UNLOCKS[level] ?? []) unlock(g, key);
}

/** What the mine's next step hands over, for the checklist in its own panel. */
export function mineGrants(level: number): string[] {
  const out: string[] = [];
  const next = level + 1;
  for (const key of MINE_UNLOCKS[next] ?? []) {
    const def = (BUILDINGS as Record<string, { name: string } | undefined>)[key];
    if (def) out.push(`Opens the ${def.name}`);
  }
  const before = new Set(extractsOf('quarry', level));
  for (const res of extractsOf('quarry', next)) {
    if (!before.has(res)) out.push(`Starts bringing up ${RESOURCE_META[res].name}`);
  }
  return out;
}

/** The commons' level, which is what every building count is measured against. */
export function commonsLevel(g: GameState): number {
  const camp = g.buildings.find((b) => b.def === 'commons');
  return camp ? camp.level : 0;
}

/**
 * How many of a kind may stand at once, and how many do. Three different rules
 * answer it: one for the institutions, one for the kinds the commons hands out
 * an allowance of, and a flat `maxTotal` for the comforts — which are counted
 * now that they are what the kingdom's Vibes are made of.
 *
 * A building being *moved* does not count twice. Its destination is a site like
 * any other, but the kingdom still has the one lodge — counting the site as a
 * second would make the display read "2/1" for the whole of a move, which is
 * both wrong and alarming.
 */
export function buildLimit(g: GameState, id: BuildingId): { built: number; max: number } {
  const def = BUILDINGS[id];
  const built = g.buildings.filter((b) => b.def === id && !b.relocOf).length;
  if (def.once) return { built, max: 1 };
  if (def.unique) return { built, max: 1 };
  // A flat ceiling the commons has no say in — the comforts, whose limits are
  // what keep decorating a set of choices rather than a slider.
  if (def.maxTotal !== undefined) return { built, max: def.maxTotal };
  if (!def.maxCount) return { built, max: Infinity };
  const level = commonsLevel(g);
  // Before the camp stands there is no allowance at all, which is moot — the
  // build menu offers nothing during founding anyway.
  if (level < 1) return { built, max: 0 };
  return { built, max: def.maxCount[Math.min(level, def.maxCount.length) - 1] };
}

/** True when the kingdom already has as many of these as it is allowed. */
export function atBuildLimit(g: GameState, id: BuildingId): boolean {
  const { built, max } = buildLimit(g, id);
  return built >= max;
}

/**
 * What the next step of the commons hands over, in words, for the checklist in
 * its own panel. A structural gate the player cannot see the far side of is
 * just a locked door; this is the part that says what is behind it.
 */
export function commonsGrants(g: GameState, level: number): string[] {
  const out: string[] = [];
  const next = level + 1;
  for (const key of COMMONS_UNLOCKS[next] ?? []) {
    const def = (BUILDINGS as Record<string, { name: string } | undefined>)[key];
    if (def) out.push(`Opens the ${def.name}`);
  }
  for (const id of ['cabin', 'storehouse'] as BuildingId[]) {
    const counts = BUILDINGS[id].maxCount;
    if (!counts) continue;
    const now = counts[Math.min(level, counts.length) - 1] ?? 0;
    const then = counts[Math.min(next, counts.length) - 1] ?? now;
    if (then > now) out.push(`${BUILDINGS[id].name}s allowed: ${now} → ${then}`);
  }
  void g;
  return out;
}

/**
 * Wood in the founder's arms. During founding this is the whole of the kingdom's
 * wealth — there is nowhere to put anything down until the camp is finished,
 * and the camp's own woodpile is the first storage the kingdom ever has.
 */
export function carriedByFounder(g: GameState): number {
  const founder = g.villagers.find((v) => v.id === g.founderId);
  return founder?.carrying?.res === 'wood' ? Math.floor(founder.carrying.qty) : 0;
}

export function buildGoals(): Goal[] {
  return [
    {
      id: 'begin',
      title: 'Choose where the kingdom begins',
      desc: 'Your founder is looking for somewhere to stop. Click open grass near the middle of the island — the camp needs three tiles by three, and the fire ends up in the middle of them.',
      done: false,
      check: (g) => g.founding.stage !== 'arriving' && g.founding.stage !== 'choosing',
    },
    {
      id: 'wood',
      title: 'Fell the first tree',
      desc: 'Your founder is already at it, with no axe and no help. One tree is one full load, and one full load is the whole camp.',
      done: false,
      // They start felling before the ground is chosen, so this waits for the
      // campsite regardless: ticking it off first would read as out of order.
      check: (g) =>
        g.founding.stage !== 'arriving' &&
        g.founding.stage !== 'choosing' &&
        (has(g, 'commons') || carriedByFounder(g) >= 12),
    },
    {
      id: 'camp',
      title: 'Raise the Base Camp',
      desc: 'No placing needed. Your founder carries the wood to the ground you chose and builds it: a fire, somewhere to put things, and two places to sleep.',
      done: false,
      check: (g) => has(g, 'commons'),
    },
    {
      id: 'cabin',
      title: 'Raise a Cabin',
      desc: 'Somewhere dry to sleep. Pick a spot from the Build menu and place it; you can improve it later rather than replacing it.',
      done: false,
      check: (g) => has(g, 'cabin'),
    },
    {
      id: 'store',
      title: 'Give resources a home',
      desc: 'Nothing is kept in one great pile: wood lives at the lodge and stone lives at the mine, and whoever needs some walks there for it. Build either one and put somebody on it. The camp keeps a hundred wood to get you started, and that is the whole of what it keeps.',
      done: false,
      check: (g) => staffed(g, 'lodge') || staffed(g, 'quarry'),
      // Both ways of feeding the place, handed over together. A hut is cheap
      // and quick and wants water; a farm is dearer and slower and wants room.
      // Either will do, both is fine, and neither is the right answer.
      unlocks: ['farm', 'fishhut'],
    },
    {
      id: 'lodge',
      title: "Put someone to work at a Woodcutter's Lodge",
      desc: 'Build the lodge in or beside a wood — the ring on the map is how far its woodcutters will go — then assign a villager to it. The wood they fell is kept there, so it is also where every builder in the kingdom will come for timber.',
      done: false,
      check: (g) => staffed(g, 'lodge'),
    },
    {
      id: 'stone',
      title: 'Open a Quarry and stock 40 stone',
      desc: 'Nothing comes out of the ground by hand. The quarry has to stand on or against rocky ground — the more rock inside the ring, the faster it works — and then somebody has to be put on it. Every scrap of stone the kingdom will ever have comes from there, and stays there until somebody carries it off to build with.',
      done: false,
      check: (g) => totalOf(g, 'stone') >= 40,
      unlocks: 'mill',
    },
    {
      id: 'settled',
      title: 'Make it a Settled Camp',
      desc: 'A camp that means to stay: awnings, crates and proper seating. Open the camp on the map and improve it — its panel lists everything it wants, materials and all, and ticks them off as you get there.',
      done: false,
      check: (g) => has(g, 'commons', 2),
    },
    {
      id: 'farm',
      title: 'Sow a Wheat Farm',
      desc: 'A farm needs open ground and a farmer. Wheat takes time to ripen. The long way to feed the kingdom, and the one that keeps up once there are a lot of you.',
      done: false,
      check: (g) => totalOf(g, 'wheat') >= 10,
    },
    {
      id: 'fishhut',
      title: 'Raise a Fishing Hut',
      desc: 'The short way to feed the kingdom. It wants dry land beside water — the lake or the coast, both work — and one person on it. The ring drawn while you place it marks the spots worth casting into.',
      done: false,
      check: (g) => has(g, 'fishhut'),
    },
    {
      id: 'catch',
      title: 'Land the first fish',
      desc: 'Put somebody on the hut and watch them work. A spot fished over goes quiet for a while and comes back on its own, so there is no wrong number of trips.',
      done: false,
      check: (g) => g.stats.caught >= 1,
    },
    {
      id: 'cookable',
      title: 'Bring home something worth cooking',
      desc: 'Flour or raw fish, whichever the kingdom finds first. Either one opens the Kitchen, where both of them turn into supper.',
      done: false,
      check: (g) => totalOf(g, 'flour') >= 1 || g.stats.caught >= 1,
      unlocks: 'kitchen',
    },
    {
      id: 'flour',
      title: 'Grind wheat into flour',
      desc: 'Build a Windmill and assign a miller. Someone has to bring the wheat over.',
      done: false,
      check: (g) => totalOf(g, 'flour') >= 6,
    },
    {
      id: 'bread',
      title: 'Bake the first bread',
      desc: 'The Kitchen turns two flour into three loaves. Villagers eat it when they are hungry, and some of them prefer it to fish.',
      done: false,
      check: (g) => g.stats.baked >= 1,
    },
    {
      id: 'cookfish',
      title: 'Cook the first of the catch',
      desc: 'The same Kitchen, the same cooks, the other recipe. A cooked fish fills somebody up exactly as well as a loaf does.',
      done: false,
      check: (g) => totalOf(g, 'cookedFish') >= 1 || g.unlocked.has('seen:cookedFish'),
    },
    {
      id: 'pop6',
      title: 'Grow to six villagers',
      desc: 'Beds decide how many may live here; Vibes decide how quickly an empty one is filled. A cabin does the first, and a bench or two does the second.',
      done: false,
      check: (g) => g.villagers.length >= 6,
    },
    {
      id: 'village',
      title: 'Make it a Village Commons',
      desc: 'A permanent hearth, tables people eat at, a notice board nobody reads. The camp asks for food out of a kitchen of your own — bread or fish, it does not mind which — six people about, and somebody settled into a trade.',
      done: false,
      check: (g) => has(g, 'commons', 3),
    },
    {
      id: 'iron',
      title: 'Sink the quarry into an Iron Mine',
      desc: 'The same rock has ore in it further down. Open the mine on the map and improve it — the same miners bring up both, and nobody needs moving.',
      done: false,
      check: (g) => has(g, 'quarry', 2),
    },
    {
      id: 'forge',
      title: 'Put a smith to work at the Forge',
      desc: 'One iron ore makes one iron bar, and that part wants no coal whatever. Coal comes later, and only for steel.',
      done: false,
      check: (g) => g.stats.smelted >= 5,
    },
    {
      id: 'steel',
      title: 'Make a Steel Bar',
      desc: 'One iron bar and two coal. The coal wants a Deep Mine, which is what the mine becomes after the Iron Mine.',
      done: false,
      check: (g) => totalOf(g, 'steelBar') >= 1,
    },
    {
      id: 'adept',
      title: 'See someone reach Adept',
      desc: 'Experience comes only from doing the work. Leave a villager in one trade.',
      done: false,
      check: (g) =>
        g.villagers.some((v) => Object.values(v.xp).some((x) => (x ?? 0) >= 25)),
    },
    {
      id: 'master',
      title: 'See someone reach Master',
      desc: 'A whole career in one trade. This takes real time.',
      done: false,
      check: (g) => g.villagers.some((v) => Object.values(v.xp).some((x) => (x ?? 0) >= 100)),
    },
    {
      id: 'pop12',
      title: 'Grow to twelve villagers',
      desc: 'A proper little place, at this point. Food in store — bread, fish, either — and somewhere pleasant to arrive at are what shorten the walk.',
      done: false,
      check: (g) => g.villagers.length >= 12,
    },
    {
      id: 'wildlife',
      title: 'Notice five kinds of wildlife',
      desc: 'Change the land and different creatures turn up. Trees, water and flowers all matter.',
      done: false,
      check: (g) => g.discovered.size >= 5,
    },
  ];
}

/** Called once a second. Completing a goal opens the next building tier. */
export function updateGoals(g: GameState): void {
  for (const goal of g.goals) {
    if (goal.done) continue;
    if (!goal.check(g)) continue;
    goal.done = true;
    if (goal.unlocks) for (const key of [goal.unlocks].flat()) unlock(g, key);
    toast(g, goal.title, '✓', 'good');
    journal(g, goal.title, '✓');
  }
}

export function unlock(g: GameState, key: string): void {
  if (g.unlocked.has(key)) return;
  g.unlocked.add(key);
  const def = (BUILDINGS as Record<string, { name: string } | undefined>)[key];
  if (def) {
    toast(g, `${def.name} unlocked`, '🔓', 'good');
    journal(g, `The kingdom learned to build a ${def.name}.`, '🔓');
  }
}

export function isUnlocked(g: GameState, key?: string): boolean {
  if (!key) return true;
  return g.unlocked.has(key);
}

/**
 * What the build menu may offer right now. Beyond the usual unlock key there
 * are two rules: a `once` building leaves the menu the moment it stands, and
 * during founding nothing at all is on offer. The founding asks for one
 * decision and it is not a building — everything else would be unaffordable
 * anyway, since there is no store yet, only the wood in the founder's arms.
 *
 * Being at the count limit is deliberately *not* one of the rules. A kind of
 * building the kingdom has all of it is allowed still belongs in the list,
 * greyed and reading "1/1 built": a row that quietly vanishes teaches nothing,
 * and the limit is exactly the thing the player has to be able to plan around.
 * `Game.placeProblem` is what refuses the placement.
 */
export function availableToBuild(g: GameState, id: BuildingId): boolean {
  if (!foundingDone(g)) return false;
  const def = BUILDINGS[id];
  if (!isUnlocked(g, def.unlock)) return false;
  if (def.once && g.buildings.some((b) => b.def === id)) return false;
  return true;
}

/** Highest rank anyone in the kingdom currently holds — shown on the goals panel. */
export function topRank(g: GameState): string {
  let best = 0;
  for (const v of g.villagers) for (const x of Object.values(v.xp)) best = Math.max(best, x ?? 0);
  return rankOf(best);
}
