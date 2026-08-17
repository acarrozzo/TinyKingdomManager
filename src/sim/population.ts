/**
 * Population growth. Nobody ever leaves, nobody dies, and nobody is ever turned
 * away by a dice roll.
 *
 * The whole model is two numbers the player can see. **Beds** decide how many
 * people the kingdom can hold — there is no separate cap hiding behind them —
 * and **Vibes** decide how quickly an empty one is filled. With a bed free,
 * somebody always arrives inside the window for the current population: Vibes
 * move them toward the fast end of it, a little hidden variation stops two
 * identical kingdoms from filling up in lockstep, and nothing can push an
 * arrival past the far edge.
 *
 * What this replaced was a chance roll: a kingdom with beds and bread could
 * simply be told no, and told no again, with nothing on screen to explain the
 * silence. A window that always pays out is both kinder and easier to read.
 */

import { RNG, clamp, rng } from '../core/util';
import type { GameState } from '../types';
import { ARRIVAL_WINDOWS, GAME_MINUTE } from './defs';
import { assignHome, bedsFree, makeVillager } from './state';
import { foundingActive } from './founding';
import { isWalkable } from '../world/terrain';
import { journal, toast } from './journal';
import { planArrivalWelcome } from './villager';
import { vibesOf } from './vibes';

/**
 * Where in its window an arrival lands, at full Vibes and at none. Neither is
 * the edge: a hundred Vibes is not a promise of the exact minimum, and nought
 * Vibes still gets somebody here before the window is out. Everything between
 * is a straight line, so the meter is worth watching all the way up.
 */
const FAST_END = 0.08;
const SLOW_END = 0.92;
/** How far the hidden variation may shift that, either way. */
const JITTER = 0.1;

/** The window for a kingdom of this many people, in game seconds. */
export function arrivalWindow(pop: number): { min: number; max: number } {
  const band = ARRIVAL_WINDOWS.find((w) => pop <= w.upTo) ?? ARRIVAL_WINDOWS[ARRIVAL_WINDOWS.length - 1];
  return { min: band.min * GAME_MINUTE, max: band.max * GAME_MINUTE };
}

/** Where through the window this kingdom is heading: 0 the fast end, 1 the slow. */
function pace(g: GameState, jitter: number): number {
  const v = vibesOf(g).total / 100;
  return clamp(SLOW_END - (SLOW_END - FAST_END) * v + JITTER * jitter, 0, 1);
}

/**
 * Game seconds of road this arrival needs, worked out afresh from the Vibes as
 * they stand. Recomputing rather than storing a duration is what lets a kingdom
 * that plants a flowerbed mid-journey hurry somebody up without the walk
 * starting again.
 */
export function arrivalNeed(g: GameState): number {
  const w = arrivalWindow(g.villagers.length);
  return w.min + (w.max - w.min) * pace(g, g.arrival.jitter);
}

/**
 * Roughly how much longer, as a spread. The player is shown a range and never a
 * countdown: the exact moment is the one part of this that stays the kingdom's
 * business, and a number ticking down to nothing turns a village into a bus
 * timetable. Null when nobody is on the way at all.
 */
export function arrivalEta(g: GameState): { lo: number; hi: number } | null {
  if (foundingActive(g) || bedsFree(g) < 1) return null;
  const w = arrivalWindow(g.villagers.length);
  const span = w.max - w.min;
  const lo = w.min + span * pace(g, -1) - g.arrival.progress;
  const hi = w.min + span * pace(g, 1) - g.arrival.progress;
  return { lo: Math.max(0, lo), hi: Math.max(0, hi) };
}

export function updatePopulation(g: GameState, dt: number): void {
  // Nobody walks in on a kingdom that does not exist yet, and the clock does not
  // run either: founding is a minute or so, and letting it tick meant the first
  // companion was already overdue by the time the camp was finished. They set
  // off when the camp's second bed does, and not before.
  if (foundingActive(g)) return;

  /*
   * No bed, no road. Progress is held rather than thrown away — somebody who
   * finishes a cabin ten minutes into a wait has not lost those ten minutes,
   * and a kingdom that has lost beds and is over capacity simply pauses until
   * it is not. Nobody is ever asked to leave to make the numbers work.
   */
  if (bedsFree(g) < 1) return;

  g.arrival.progress += dt;
  if (g.arrival.progress < arrivalNeed(g)) return;

  arrive(g);
  // Straight into the next one, at whatever band the kingdom is now in. It only
  // starts counting again if there is still a bed going, which the check above
  // will decide next tick.
  g.arrival.progress = 0;
  g.arrival.jitter = rng.range(-1, 1);
}

/** Walks a new resident in from the edge of the map. */
export function arrive(g: GameState): void {
  const r = new RNG((rng.next() * 1e9) | 0);
  const edge = findEdgeTile(g, r);
  const v = makeVillager(g, r, edge.x, edge.y);
  v.activity = 'arriving';
  g.villagers.push(v);
  assignHome(g, v);
  g.stats.arrivals++;

  v.history.push({ day: g.day, text: 'Walked in over the hill and decided to stay.' });
  journal(g, `${v.name} settled in the kingdom.`, '🚶');
  toast(g, `${v.name} has decided to settle here.`, '🚶', 'good');
  // Everybody's first walk is in to the fire, whatever else needs doing.
  planArrivalWelcome(g, v);
}

function findEdgeTile(g: GameState, r: RNG): { x: number; y: number } {
  // Start from the map edge nearest the settlement's rough centre and walk inward.
  const cx = g.w / 2;
  const cy = g.h / 2;
  for (let attempt = 0; attempt < 200; attempt++) {
    const side = r.int(0, 3);
    let x = 0;
    let y = 0;
    if (side === 0) {
      x = r.int(1, g.w - 2);
      y = 1;
    } else if (side === 1) {
      x = g.w - 2;
      y = r.int(1, g.h - 2);
    } else if (side === 2) {
      x = r.int(1, g.w - 2);
      y = g.h - 2;
    } else {
      x = 1;
      y = r.int(1, g.h - 2);
    }
    // Step toward the middle until we find dry, walkable ground.
    for (let i = 0; i < 24; i++) {
      if (isWalkable(g, x, y)) return { x, y };
      x += Math.sign(cx - x);
      y += Math.sign(cy - y);
    }
  }
  return { x: Math.round(cx), y: Math.round(cy) };
}
