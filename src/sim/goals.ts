/**
 * Onboarding goals and milestones.
 *
 * There are two things opening the build menu up and they are meant to be read
 * as one. The **commons** is the structural gate: each level of it is a step the
 * whole settlement takes, and it hands over a tier of buildings when it lands.
 * The **goals** teach the mechanics in between and unlock the food chain, which
 * has to come before the commons can ask for bread. Nothing unlocks something
 * that is a prerequisite of itself; see `COMMONS_REQS` in `defs.ts`.
 */

import type { BuildingId, GameState, Goal } from '../types';
import { BUILDINGS } from './defs';
import { journal, toast } from './journal';
import { deposit } from './state';
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
 * The Base Camp hands over all four foundations at once — somewhere to sleep,
 * somewhere to put things, and the two buildings that produce the only two raw
 * materials there are. That is deliberate: the first hour is about deciding
 * where those four go, and a kingdom that can fell trees but not break stone is
 * one waiting on permission rather than on itself.
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

/** The commons' level, which is what every building count is measured against. */
export function commonsLevel(g: GameState): number {
  const camp = g.buildings.find((b) => b.def === 'commons');
  return camp ? camp.level : 0;
}

/**
 * How many of a kind may stand at once, and how many do. `max` is `Infinity`
 * for the small comforts, which are freely repeatable and always were.
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
 * wealth — there is no store to count instead until the camp is finished.
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
      reward: { wood: 10 },
    },
    {
      id: 'store',
      title: 'Build a Storehouse',
      desc: 'The camp only holds sixty, and it is at the middle of everything. A storehouse raises the ceiling and shortens the walk — put it near where the work is.',
      done: false,
      check: (g) => has(g, 'storehouse'),
      unlocks: 'farm',
    },
    {
      id: 'lodge',
      title: "Put someone to work at a Woodcutter's Lodge",
      desc: 'Build the lodge in or beside a wood — the ring on the map is how far its woodcutters will go — then assign a villager to it.',
      done: false,
      check: (g) => staffed(g, 'lodge'),
      reward: { wood: 20 },
    },
    {
      id: 'stone',
      title: 'Open a Quarry and stock 40 stone',
      desc: 'Nothing breaks a boulder by hand. Place the quarry against rocky ground, with boulders inside the ring, and put somebody on it — every scrap of stone the kingdom will ever have comes from there.',
      done: false,
      check: (g) => g.stock.stone >= 40,
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
      desc: 'A farm needs open ground and a farmer. Wheat takes time to ripen.',
      done: false,
      check: (g) => g.stock.wheat >= 10,
      unlocks: 'bakery',
    },
    {
      id: 'flour',
      title: 'Grind wheat into flour',
      desc: 'Build a Windmill and assign a miller. Someone has to bring the wheat over.',
      done: false,
      check: (g) => g.stock.flour >= 6,
    },
    {
      id: 'bread',
      title: 'Bake the first bread',
      desc: 'A Bakery turns flour into bread. Villagers will eat it when they are hungry.',
      done: false,
      check: (g) => g.stats.baked >= 1,
      reward: { coin: 25 },
    },
    {
      id: 'pop6',
      title: 'Grow to six villagers',
      desc: 'Spare beds and a full larder tend to attract travellers.',
      done: false,
      check: (g) => g.villagers.length >= 6,
    },
    {
      id: 'village',
      title: 'Make it a Village Commons',
      desc: 'A permanent hearth, tables people eat at, a notice board nobody reads. The camp asks for bread of your own baking, six people about, and somebody settled into a trade.',
      done: false,
      check: (g) => has(g, 'commons', 3),
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
      desc: 'A proper little place, at this point.',
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
    if (goal.reward) {
      for (const k in goal.reward) {
        const res = k as keyof typeof goal.reward;
        deposit(g, res, goal.reward[res] ?? 0);
      }
    }
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
