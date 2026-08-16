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

/**
 * Wood in the founder's arms. During founding this is the whole of the kingdom's
 * wealth — there is no store to count instead until the chest is finished.
 */
export function carriedByFounder(g: GameState): number {
  const founder = g.villagers.find((v) => v.id === g.founderId);
  return founder?.carrying?.res === 'wood' ? Math.floor(founder.carrying.qty) : 0;
}

export function buildGoals(): Goal[] {
  return [
    {
      id: 'begin',
      title: 'Choose a place to begin',
      desc: 'Your founder is looking for somewhere to stop. Click a clear patch of grass near the middle of the island — the first fire will be laid there.',
      done: false,
      check: (g) => g.founding.stage !== 'arriving' && g.founding.stage !== 'choosing',
    },
    {
      id: 'branches',
      title: 'Gather fallen branches',
      desc: 'There is deadfall lying about. Your founder is already picking it up — two armfuls is all it takes.',
      done: false,
      // They start gathering before the ground is chosen, so this waits for the
      // campsite regardless: ticking it off first would read as out of order.
      check: (g) =>
        g.founding.stage !== 'arriving' &&
        g.founding.stage !== 'choosing' &&
        (has(g, 'campfire') || carriedByFounder(g) >= 12),
    },
    {
      id: 'fire',
      title: 'Light the first fire',
      desc: 'No placing needed. Once the wood is gathered your founder lays the fire on the ground you chose and lights it.',
      done: false,
      check: (g) => has(g, 'campfire'),
      unlocks: 'chest',
    },
    {
      id: 'chest',
      title: 'Build the Small Chest',
      desc: 'Click a tile beside the fire. Your founder still has eight wood in their arms, which is exactly what it takes.',
      done: false,
      check: (g) => has(g, 'chest'),
      unlocks: 'cabin',
    },
    {
      id: 'cabin',
      title: 'Raise a Cabin',
      desc: 'Somewhere to sleep. Pick a spot from the Build menu and place it; you can improve it later rather than replacing it.',
      done: false,
      check: (g) => has(g, 'cabin'),
      unlocks: ['storehouse', 'quarry'],
      reward: { wood: 10 },
    },
    {
      id: 'store',
      title: 'Build a Storehouse',
      desc: 'A chest can only hold so much. A storehouse gives the kingdom real capacity.',
      done: false,
      check: (g) => has(g, 'storehouse'),
      unlocks: ['lodge', 'farm'],
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

/**
 * Unlocks that announce themselves some other way. The chest is put straight
 * onto the cursor with its own hint the moment the fire is lit, so a padlock
 * toast saying the same thing is one notification too many.
 */
const QUIET_UNLOCKS = new Set(['chest']);

export function unlock(g: GameState, key: string): void {
  if (g.unlocked.has(key)) return;
  g.unlocked.add(key);
  const def = (BUILDINGS as Record<string, { name: string } | undefined>)[key];
  if (def && !QUIET_UNLOCKS.has(key)) {
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
 * two rules: a `once` building leaves the menu the moment it stands, and during
 * founding the chest is the only thing on offer at all. Everything the founder
 * could otherwise be shown is unaffordable anyway — there is no store, only the
 * wood in their arms — so listing it would be a way of saying no four times.
 */
export function availableToBuild(g: GameState, id: BuildingId): boolean {
  const def = BUILDINGS[id];
  if (!isUnlocked(g, def.unlock)) return false;
  if (def.once && g.buildings.some((b) => b.def === id)) return false;
  return foundingDone(g) || FOUNDING_BUILDS.has(id);
}

/** Highest rank anyone in the kingdom currently holds — shown on the goals panel. */
export function topRank(g: GameState): string {
  let best = 0;
  for (const v of g.villagers) for (const x of Object.values(v.xp)) best = Math.max(best, x ?? 0);
  return rankOf(best);
}
