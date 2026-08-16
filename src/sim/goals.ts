/**
 * Onboarding goals and milestones. Completing one unlocks the next slice of the
 * build menu, so the player is never shown a wall of buildings on day one.
 */

import type { BuildingId, GameState, Goal } from '../types';
import { BUILDINGS, FOUNDING_BUILDS } from './defs';
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

export function buildGoals(): Goal[] {
  return [
    {
      id: 'begin',
      title: 'Choose a place to begin',
      desc: 'Your founder is looking for somewhere to stop. Click a clear patch of grass near the middle of the island.',
      done: false,
      check: (g) => g.founding.stage !== 'arriving' && g.founding.stage !== 'choosing',
    },
    {
      id: 'branches',
      title: 'Gather a few fallen branches',
      desc: 'There is deadfall lying about. Your founder will pick it up by hand and stack it. Give them a moment.',
      done: false,
      check: (g) => g.stock.wood >= 5,
      unlocks: 'campfire',
    },
    {
      id: 'fire',
      title: 'Light the first fire',
      desc: 'Open the Build menu and put a campfire near the woodpile. Warmth, light, and somewhere to sleep until there is a roof.',
      done: false,
      check: (g) => has(g, 'campfire'),
      unlocks: 'chest',
    },
    {
      id: 'chest',
      title: 'Build a rough chest',
      desc: 'The woodpile holds twelve. A chest from the Build menu takes its place and holds fifty.',
      done: false,
      check: (g) => has(g, 'chest'),
    },
    {
      id: 'shelter',
      title: 'Raise a Shelter',
      desc: 'Somewhere to sleep. Pick a spot from the Build menu and place it.',
      done: false,
      check: (g) => has(g, 'shelter'),
      unlocks: 'quarry',
      reward: { wood: 10 },
    },
    {
      id: 'store',
      title: 'Build a Storehouse',
      desc: 'A chest can only hold so much. A storehouse gives the kingdom real capacity.',
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
      unlocks: 'cottage',
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
      unlocks: 'statue',
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
    if (goal.unlocks) unlock(g, goal.unlocks);
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
 * What the build menu may offer right now. Beyond the usual unlock key there are
 * two rules: the fire and the chest leave the menu once they stand, and nothing
 * else appears until the kingdom has somewhere to keep what it gathers. A
 * shelter costs twenty wood against a woodpile that holds twelve, so offering it
 * during founding would only be a way of saying no four times.
 */
export function availableToBuild(g: GameState, id: BuildingId): boolean {
  const def = BUILDINGS[id];
  if (!isUnlocked(g, def.unlock)) return false;
  if (def.once && g.buildings.some((b) => b.def === id)) return false;
  return foundingDone(g) || FOUNDING_BUILDS.has(id);
}

/** Goals the founding sequence completes; already-founded saves start them done. */
export const FOUNDING_GOALS = ['begin', 'branches', 'fire', 'chest'];

/** Highest rank anyone in the kingdom currently holds — shown on the goals panel. */
export function topRank(g: GameState): string {
  let best = 0;
  for (const v of g.villagers) for (const x of Object.values(v.xp)) best = Math.max(best, x ?? 0);
  return rankOf(best);
}
