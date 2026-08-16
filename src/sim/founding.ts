/**
 * The founding sequence. The opening asks the player exactly one question —
 * *where should this kingdom begin?* — and the campfire is the answer made
 * physical, so choosing the ground and placing the fire are the same act.
 *
 *   arriving  → walks up the beach and looks the place over
 *   choosing  → the player picks the ground; an unlit fire ring appears on it
 *   settling  → walks out to it and stands there a moment
 *   camp      → gathers two piles of deadfall, lays and lights the fire,
 *               then builds the chest the player sites beside it
 *   done      → the chest is finished and the ordinary economy starts
 *
 * There is no store until that chest exists. The founder simply carries what
 * they have gathered and both founding buildings are paid for out of their arms
 * — twelve wood, four for the fire and eight for the chest, nothing left over.
 * That is a founding-only rule, not a personal inventory system: see `think()`,
 * which hands the carried load straight back to the ordinary hauling logic the
 * moment the chest stands.
 */

import type { Building, GameState } from '../types';
import { BUILDINGS } from './defs';
import { journal, toast } from './journal';
import { makeBuilding } from './state';
import { rng } from '../core/util';
import { CAMP_RADIUS, tileAt } from '../world/terrain';

export function foundingActive(g: GameState): boolean {
  return g.founding.stage !== 'done';
}

export function foundingDone(g: GameState): boolean {
  return g.founding.stage === 'done';
}

// ---------------------------------------------------------------------------
// Choosing the ground
// ---------------------------------------------------------------------------

/**
 * Why this tile will not do, or null when it will. The wording is the message
 * the player actually reads, so it says what is wrong rather than what is right.
 *
 * `campSuitable` in `world/terrain.ts` is the same rule without the sentences —
 * map generation needs it to guarantee a legal campsite exists. Change one and
 * change the other.
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

/**
 * The player has picked the ground. The fire ring goes down at once — an unlit
 * campfire site, which is both the acknowledgement that the choice landed and
 * the thing the founder will spend their first four wood on.
 */
export function chooseCamp(g: GameState, x: number, y: number): boolean {
  if (!canChooseCamp(g, x, y)) return false;
  g.founding.x = x;
  g.founding.y = y;
  g.founding.stage = 'settling';

  const fire = makeBuilding(g, 'campfire', x, y, rng);
  fire.stage = 'building';
  g.buildings.push(fire);
  const t = tileAt(g, x, y);
  if (t) {
    t.building = fire.id;
    t.prop = null;
  }

  journal(g, 'A patch of ground was chosen. Nothing marked it out; it was simply the one.', '✦');
  toast(g, 'The fire will be here', '📍', 'good');
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

/** The founder has stopped walking and looked around. Hand the map to the player. */
export function markArrived(g: GameState): void {
  if (g.founding.stage !== 'arriving') return;
  g.founding.stage = 'choosing';
}

/** They have stood on their chosen ground long enough to mean it. */
export function markSettled(g: GameState): void {
  if (g.founding.stage !== 'settling') return;
  g.founding.stage = 'camp';
}

/** The founding site waiting on the founder: the fire first, then the chest. */
export function foundingSite(g: GameState): Building | null {
  let chest: Building | null = null;
  for (const b of g.buildings) {
    if (b.stage === 'done') continue;
    if (b.def === 'campfire') return b;
    if (b.def === 'chest') chest = b;
  }
  return chest;
}

export function campfireOf(g: GameState): Building | null {
  return g.buildings.find((b) => b.def === 'campfire') ?? null;
}

/** True once the fire is lit and the player has yet to site the chest. */
export function awaitingChest(g: GameState): boolean {
  if (g.founding.stage !== 'camp') return false;
  const fire = campfireOf(g);
  return !!fire && fire.stage === 'done' && !g.buildings.some((b) => b.def === 'chest');
}

/**
 * Wood the founding still owes, fire first and then the chest. This is what the
 * founder gathers up to — one full load of twelve covers both, which is why
 * they fill their arms before laying the fire rather than lighting it the
 * moment they have four.
 */
export function foundingWoodNeeded(g: GameState): number {
  let need = 0;
  const fire = campfireOf(g);
  // Before the ground is chosen there is no fire ring yet, but the fire is
  // coming regardless — which is what lets the founder start gathering while
  // the player is still deciding.
  if (!fire) need += BUILDINGS.campfire.cost.wood ?? 0;
  else if (fire.stage !== 'done') need += woodShortfall(fire);
  const chest = g.buildings.find((b) => b.def === 'chest');
  if (!chest) need += BUILDINGS.chest.cost.wood ?? 0;
  else if (chest.stage !== 'done') need += woodShortfall(chest);
  return need;
}

/** Wood a site still wants before anybody can start swinging a hammer. */
export function woodShortfall(b: Building): number {
  return Math.max(0, (BUILDINGS[b.def].cost.wood ?? 0) - (b.delivered.wood ?? 0));
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
  if (g.founding.stage !== 'camp') return null;
  if (b.def === 'campfire') {
    return {
      icon: '🔥',
      toast: 'The first fire is lit',
      journal: 'The first fire was lit, and the evening stopped being quite so large.',
    };
  }
  if (b.def === 'chest') {
    g.founding.stage = 'done';
    return {
      icon: '🧰',
      toast: 'A chest, and somewhere to put things',
      journal: 'A rough chest was knocked together, and the kingdom had somewhere to keep things.',
    };
  }
  return null;
}

/** Why this building cannot be taken down, or null when it can. */
export function protectedBuilding(b: Building): string | null {
  if (b.def === 'campfire') return 'The first fire stays lit.';
  if (b.def === 'chest') return 'The first chest stays where it is.';
  return null;
}
