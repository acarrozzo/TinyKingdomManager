/**
 * The founding sequence: one traveller, no fire, no store, and four things that
 * have to happen in order before the kingdom is a kingdom.
 *
 *   arriving  → walks up the beach and looks the place over
 *   choosing  → the player picks the ground; this is the only thing on offer
 *   settling  → walks out to it, stands a moment, starts a woodpile
 *   camp      → gathers deadfall, then the fire, then the chest
 *   done      → the chest replaces the woodpile and the build menu opens
 *
 * The point of all of it is authorship: the fire and the chest are not scenery
 * the game handed over, they are two things somebody put there because you said
 * so. Transitions live here; the plans that carry them out live in the planner,
 * with every other thing a villager can decide to do.
 */

import type { Building, GameState } from '../types';
import { journal, toast } from './journal';
import { makeBuilding, removeBuilding } from './state';
import { rng } from '../core/util';
import { tileAt } from '../world/terrain';

/** How far from the middle of the island a campsite may be, in tiles. */
export const CAMP_RADIUS = 9;

/**
 * What the founder gathers up to while the camp is still a woodpile. Enough for
 * the fire and the chest with a little slack, and low enough that the pile still
 * reads as an armful of branches rather than a barn.
 */
export const FOUNDING_WOOD = 12;

export function foundingActive(g: GameState): boolean {
  return g.founding.stage !== 'done';
}

export function foundingDone(g: GameState): boolean {
  return g.founding.stage === 'done';
}

/** True once there is somewhere to put things — the point the game proper starts. */
export function campStarted(g: GameState): boolean {
  return g.founding.stage === 'camp' || g.founding.stage === 'done';
}

// ---------------------------------------------------------------------------
// Choosing the ground
// ---------------------------------------------------------------------------

/**
 * Why this tile will not do, or null when it will. The wording is the message
 * the player actually reads, so it says what is wrong rather than what is right.
 */
export function campProblem(g: GameState, x: number, y: number): string | null {
  const t = tileAt(g, x, y);
  if (!t) return 'That is off the edge of the world.';
  if (t.terrain === 'water' || t.terrain === 'shallow') return 'Nobody is camping in the water.';
  if (t.terrain !== 'grass' && t.terrain !== 'meadow') return 'Open grass, rather than sand, rock or deep woodland.';
  if (t.prop || t.building) return 'Somewhere clear — nothing standing on it.';
  const d = Math.hypot(x - g.w / 2, y - g.h / 2);
  if (d > CAMP_RADIUS) return 'Too far out. Somewhere nearer the middle of the island.';
  return null;
}

export function canChooseCamp(g: GameState, x: number, y: number): boolean {
  return g.founding.stage === 'choosing' && campProblem(g, x, y) === null;
}

/** The player has picked the ground. Everything else follows from here. */
export function chooseCamp(g: GameState, x: number, y: number): boolean {
  if (!canChooseCamp(g, x, y)) return false;
  g.founding.x = x;
  g.founding.y = y;
  g.founding.stage = 'settling';
  journal(g, 'A patch of ground was chosen. Nothing marked it out; it was simply the one.', '✦');
  return true;
}

/** Somewhere the camp could reasonably go — the fallback and the headless harness. */
export function suggestCamp(g: GameState): { x: number; y: number } {
  const cx = Math.round(g.w / 2);
  const cy = Math.round(g.h / 2);
  for (let radius = 0; radius <= CAMP_RADIUS; radius++) {
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (campProblem(g, x, y) === null) return { x, y };
      }
  }
  return { x: cx, y: cy };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * The founder has stopped walking and looked around. Hand the map to the player.
 * No toast: the campsite hint arms itself in the same instant and says the same
 * thing, and on a phone the two land on top of each other.
 */
export function markArrived(g: GameState): void {
  if (g.founding.stage !== 'arriving') return;
  g.founding.stage = 'choosing';
}

/**
 * The founder has stood on their chosen ground long enough to mean it. The
 * woodpile appears now rather than on the first delivery, because wood has to
 * have somewhere to land before anybody sets off to fetch it.
 */
export function markSettled(g: GameState): void {
  if (g.founding.stage !== 'settling') return;
  // Almost always the chosen tile. The neighbours are insurance: a camp with no
  // woodpile has nowhere to put wood, and the founder would gather forever.
  const spots: [number, number][] = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]];
  for (const [dx, dy] of spots) {
    const x = g.founding.x + dx;
    const y = g.founding.y + dy;
    const t = tileAt(g, x, y);
    if (!t || t.building) continue;
    if (t.terrain === 'water' || t.terrain === 'shallow') continue;
    const pile = makeBuilding(g, 'woodpile', x, y, rng);
    pile.stage = 'done';
    g.buildings.push(pile);
    t.building = pile.id;
    t.prop = null;
    g.founding.x = x;
    g.founding.y = y;
    break;
  }
  g.founding.stage = 'camp';
  journal(g, 'The first wood was stacked on the bare ground.', '🪵');
  toast(g, 'A woodpile — it holds twelve, and no more', '🪵', 'info');
}

export function woodpileOf(g: GameState): Building | null {
  return g.buildings.find((b) => b.def === 'woodpile') ?? null;
}

/**
 * A founding building has just been finished, and it deserves better words than
 * "Campfire finished". Returns the copy to use in place of the usual line, or
 * null when this is an ordinary building on an ordinary day.
 */
export function onFoundingBuild(
  g: GameState,
  b: Building,
): { toast: string; journal: string; icon: string } | null {
  if (b.def === 'campfire' && g.founding.stage === 'camp') {
    return {
      icon: '🔥',
      toast: 'The first fire is lit',
      journal: 'The first fire was lit, and the evening stopped being quite so large.',
    };
  }
  if (b.def === 'chest' && g.founding.stage === 'camp') {
    // The chest takes the woodpile's place; the goods were never in the pile as
    // such, they are the kingdom's, so nothing moves except the ceiling on them.
    const pile = woodpileOf(g);
    if (pile) removeBuilding(g, pile);
    g.founding.stage = 'done';
    toast(g, 'The kingdom can build properly now', '🔨', 'good');
    return {
      icon: '🧰',
      toast: 'A chest, and somewhere to put things',
      journal: 'A rough chest was knocked together, and the woodpile went into it.',
    };
  }
  return null;
}

/** Why this building cannot be taken down, or null when it can. */
export function protectedBuilding(b: Building): string | null {
  if (b.def === 'campfire') return 'The first fire stays lit.';
  if (b.def === 'chest') return 'The first chest stays where it is.';
  if (b.def === 'woodpile') return 'The woodpile stays until there is a chest.';
  return null;
}
