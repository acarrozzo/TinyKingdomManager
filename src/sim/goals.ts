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
 */
const COMMONS_UNLOCKS: Record<number, string[]> = {
  1: ['cabin'],
  2: ['storehouse', 'quarry', 'lodge'],
  3: ['statue'],
};

/** Called when the commons is finished or improved, with the level it now is. */
export function unlockCommonsTier(g: GameState, level: number): void {
  for (const key of COMMONS_UNLOCKS[level] ?? []) unlock(g, key);
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
      id: 'settled',
      title: 'Make it a Settled Camp',
      desc: 'A camp that means to stay: awnings, crates and proper seating. Open the camp on the map and improve it — it wants a cabin standing, three people about, and the materials.',
      done: false,
      check: (g) => has(g, 'commons', 2),
    },
    {
      id: 'store',
      title: 'Build a Storehouse',
      desc: 'The camp only holds so much, and it is at the middle of everything. A storehouse raises the ceiling and shortens the walk.',
      done: false,
      check: (g) => has(g, 'storehouse'),
      unlocks: 'farm',
    },
    {
      id: 'lodge',
      title: "Put someone to work at a Woodcutter's Lodge",
      desc: 'Build a lodge near trees, then assign a villager to it from the Jobs panel.',
      done: false,
      check: (g) => staffed(g, 'lodge'),
      reward: { stone: 15 },
    },
    {
      id: 'stone',
      title: 'Stock 40 stone',
      desc: 'Boulders can be broken by hand, but a Quarry does it far better.',
      done: false,
      check: (g) => g.stock.stone >= 40,
      unlocks: 'mill',
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
