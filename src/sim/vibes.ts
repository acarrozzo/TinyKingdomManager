/**
 * Vibes — how nice this place is to walk into, out of a hundred.
 *
 * It is the one number in the game that is openly a fudge, and it says so:
 * *Vibes are not an exact science. We assigned them a number anyway.* Three
 * things feed it and they are all things the player did on purpose — what they
 * built for no reason, whether there is bread put by, and whether anybody is
 * going hungry.
 *
 * What is deliberately **not** in it: jobs. Filling a post, leaving one open or
 * closing a workplace down has no effect on Vibes and none on how fast people
 * arrive. A kingdom that hires nobody is a valid kingdom, and being quietly
 * marked down for it is the sort of hidden pressure this game does not do.
 *
 * Vibes never punish. The worst they do is make the next newcomer take the long
 * way round; somebody still turns up.
 */

import { clamp } from '../core/util';
import type { GameState } from '../types';
import {
  BUILDINGS,
  FOOD_VIBES,
  FOOD_VIBES_NEUTRAL,
  SEVERE_HUNGER,
  VIBE_BANDS,
  VIBE_MAX,
} from './defs';
import { isOperational } from './state';

export interface Vibes {
  /** Comforts standing about the place, up to `VIBE_MAX.decor`. */
  decor: number;
  /** Bread per villager, or a neutral figure before the first loaf. */
  food: number;
  /** Whether anybody is going properly hungry. */
  wellbeing: number;
  total: number;
  band: string;
  /**
   * True until the kingdom has baked. Food and wellbeing are both held at a
   * neutral figure while it is, and the panel says so rather than showing two
   * numbers the player cannot yet move.
   */
  preBread: boolean;
}

/** The whole reckoning, and the only thing that should ever be asked for it. */
export function vibesOf(g: GameState): Vibes {
  const preBread = g.stats.baked <= 0;
  const decor = decorVibes(g);
  const food = preBread ? FOOD_VIBES_NEUTRAL : foodVibes(g);
  const wellbeing = preBread ? VIBE_MAX.wellbeing : wellbeingVibes(g);
  const total = Math.round(clamp(decor + food + wellbeing, 0, 100));
  return { decor, food, wellbeing, total, band: vibeBand(total), preBread };
}

/**
 * What the comforts are worth. Each kind has a flat ceiling on how many may
 * stand (`maxTotal`), and those ceilings are chosen so that one of everything
 * comes to exactly sixty — a kingdom cannot decorate its way past the cap, and
 * the last few points always cost the rarest thing.
 *
 * The clamp is not decoration: a kingdom saved before those limits existed may
 * have a dozen wells on it, and they are all still standing.
 */
export function decorVibes(g: GameState): number {
  let n = 0;
  for (const b of g.buildings) {
    if (!isOperational(b)) continue;
    n += BUILDINGS[b.def].vibes ?? 0;
  }
  return Math.min(n, VIBE_MAX.decor);
}

/**
 * Loaves per head, read as a ramp through `FOOD_VIBES` rather than as steps —
 * baking one more loaf should move the number, not wait for a threshold.
 */
export function foodVibes(g: GameState): number {
  const per = g.stock.bread / Math.max(1, g.villagers.length);
  const at = clamp(per, 0, FOOD_VIBES.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(lo + 1, FOOD_VIBES.length - 1);
  return FOOD_VIBES[lo] + (FOOD_VIBES[hi] - FOOD_VIBES[lo]) * (at - lo);
}

/** How many people are going properly hungry, and what that costs. */
export function wellbeingVibes(g: GameState): number {
  const hungry = severelyHungry(g);
  if (hungry === 0) return VIBE_MAX.wellbeing;
  return hungry <= g.villagers.length / 3 ? VIBE_MAX.wellbeing / 2 : 0;
}

export function severelyHungry(g: GameState): number {
  return g.villagers.filter((v) => v.hunger >= SEVERE_HUNGER).length;
}

export function vibeBand(total: number): string {
  for (const band of VIBE_BANDS) if (total >= band.from) return band.name;
  return VIBE_BANDS[VIBE_BANDS.length - 1].name;
}
