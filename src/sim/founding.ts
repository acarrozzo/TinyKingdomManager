/**
 * The founding sequence. The opening asks the player exactly one question —
 * *where should this kingdom begin?* — and the Base Camp is the answer made
 * physical, so choosing the ground and siting the camp are the same act.
 *
 *   arriving  → walks up the beach and looks the place over
 *   choosing  → the player picks the ground; a rough camp appears on it at once
 *   settling  → walks out to it and stands there a moment
 *   camp      → fells one tree for one full load of twelve, and raises the camp
 *               out of it
 *   done      → the Base Camp is finished and the ordinary economy starts
 *
 * There is no store until that camp exists. The founder simply carries what
 * they have gathered and the whole of it goes into the build — twelve wood
 * felled, twelve wood spent, nothing left over. That is a founding-only rule,
 * not a personal inventory system: see `think()`, which hands the carried load
 * straight back to the ordinary hauling logic the moment the camp stands.
 *
 * There is only ever one placement. The camp *is* the fire, the store and the
 * first two beds, so asking a second time where to put any of them would be
 * asking the same question twice.
 */

import type { Building, GameState } from '../types';
import { BUILDINGS } from './defs';
import { journal, toast } from './journal';
import { makeBuilding } from './state';
import { rng } from '../core/util';
import { CAMP_HALF, CAMP_RADIUS, tileAt } from '../world/terrain';

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
 * Why this ground will not do, or null when it will. `x, y` is the *centre* of
 * the camp's three-by-three, which is also where the fire ends up. The wording
 * is the message the player actually reads, so it says what is wrong rather
 * than what the rule is.
 *
 * `campSuitable` in `world/terrain.ts` is the same rule without the sentences —
 * map generation needs it to guarantee a legal campsite exists. Change one and
 * change the other.
 */
export function campProblem(g: GameState, x: number, y: number): string | null {
  const d = Math.hypot(x - g.w / 2, y - g.h / 2);
  if (d > CAMP_RADIUS) return 'Too far out. Somewhere nearer the middle of the island.';

  let water = false;
  let rough = false;
  for (let dy = -CAMP_HALF; dy <= CAMP_HALF; dy++)
    for (let dx = -CAMP_HALF; dx <= CAMP_HALF; dx++) {
      const t = tileAt(g, x + dx, y + dy);
      if (!t) return 'Part of the camp would hang off the edge of the world.';
      if (t.building) return 'Something is already standing there.';
      if (t.terrain === 'water' || t.terrain === 'shallow') water = true;
      else if (t.terrain !== 'grass' && t.terrain !== 'meadow') rough = true;
    }
  // A camp is nine tiles, and the reason it will not fit is usually one corner
  // of it rather than the tile under the cursor — hence the whole-camp wording.
  if (water) return 'Part of the camp would be standing in the water.';
  if (rough) return 'The camp needs open grass under all of it, not sand, rock or deep woodland.';
  return null;
}

export function canChooseCamp(g: GameState, x: number, y: number): boolean {
  return g.founding.stage === 'choosing' && campProblem(g, x, y) === null;
}

/** The camp's top-left tile, given the centre the player chose. */
export function campCorner(x: number, y: number): { x: number; y: number } {
  return { x: x - CAMP_HALF, y: y - CAMP_HALF };
}

/**
 * The player has picked the ground. The camp goes down at once as a rough
 * layout waiting to be finished — which is both the acknowledgement that the
 * choice landed and the thing the founder will spend their first twelve wood
 * on.
 */
export function chooseCamp(g: GameState, x: number, y: number): boolean {
  if (!canChooseCamp(g, x, y)) return false;
  g.founding.x = x;
  g.founding.y = y;
  g.founding.stage = 'settling';

  const corner = campCorner(x, y);
  const camp = makeBuilding(g, 'commons', corner.x, corner.y, rng);
  camp.stage = 'building';
  g.buildings.push(camp);
  for (let dy = 0; dy < BUILDINGS.commons.h; dy++)
    for (let dx = 0; dx < BUILDINGS.commons.w; dx++) {
      const t = tileAt(g, corner.x + dx, corner.y + dy);
      if (!t) continue;
      t.building = camp.id;
      // Whatever was standing here is cleared to make the camp. Nothing comes
      // back from it: there is no store yet to put it in.
      t.prop = null;
      t.amount = 0;
      t.regrow = 0;
      t.claimed = 0;
    }

  journal(g, 'A patch of ground was chosen. Nothing marked it out; it was simply the one.', '✦');
  toast(g, 'The camp will be here', '📍', 'good');
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

/** The commons, at whatever stage it has reached. There is only ever one. */
export function commonsOf(g: GameState): Building | null {
  return g.buildings.find((b) => b.def === 'commons') ?? null;
}

/** The founding site waiting on the founder, or null once the camp stands. */
export function foundingSite(g: GameState): Building | null {
  const camp = commonsOf(g);
  return camp && camp.stage !== 'done' ? camp : null;
}

/**
 * Wood the founding still owes. This is what the founder gathers up to — one
 * full load of twelve covers the camp exactly, which is why they fill their
 * arms before starting rather than walking back and forth with an armful.
 */
export function foundingWoodNeeded(g: GameState): number {
  const camp = commonsOf(g);
  // Before the ground is chosen there is no camp yet, but the camp is coming
  // regardless — which is what lets the founder start felling while the player
  // is still deciding.
  if (!camp) return BUILDINGS.commons.cost.wood ?? 0;
  return camp.stage === 'done' ? 0 : woodShortfall(camp);
}

/** Wood a site still wants before anybody can start swinging a hammer. */
export function woodShortfall(b: Building): number {
  return Math.max(0, (BUILDINGS[b.def].cost.wood ?? 0) - (b.delivered.wood ?? 0));
}

/**
 * A founding building has just been finished, and it deserves better words than
 * "Base Camp finished". Returns the copy to use in place of the usual line, or
 * null when this is an ordinary building on an ordinary day.
 */
export function onFoundingBuild(
  g: GameState,
  b: Building,
): { toast: string; journal: string; icon: string } | null {
  if (g.founding.stage !== 'camp') return null;
  if (b.def !== 'commons') return null;
  g.founding.stage = 'done';
  return {
    icon: '🔥',
    toast: 'The first fire is lit',
    journal: 'The first fire was lit, and the evening stopped being quite so large.',
  };
}

/** Why this building cannot be taken down, or null when it can. */
export function protectedBuilding(b: Building): string | null {
  if (b.def === 'commons') return 'The first fire stays lit.';
  return null;
}
