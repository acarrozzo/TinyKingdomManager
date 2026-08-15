/**
 * Population growth. New villagers are rare on purpose — an arrival should be
 * an event you notice, not a number ticking up. Nobody ever leaves or dies.
 */

import { RNG, clamp, rng } from '../core/util';
import type { GameState } from '../types';
import { DAY_LENGTH } from './defs';
import { assignHome, housingCapacity, makeVillager } from './state';
import { isWalkable } from '../world/terrain';
import { journal, toast } from './journal';
import { speak } from './villager';

const POP_LIMIT = 100;
/** Shortest gap between arrivals, in game seconds. An arrival should be an event. */
const MIN_GAP = DAY_LENGTH * 0.85;

export function updatePopulation(g: GameState, dt: number): void {
  g.arrivalTimer -= dt;
  if (g.arrivalTimer > 0) return;
  g.arrivalTimer = MIN_GAP * rng.range(0.8, 1.4);

  if (g.villagers.length >= POP_LIMIT) return;

  // Somewhere to sleep is the hard requirement.
  const beds = housingCapacity(g) - g.villagers.length;
  if (beds < 1) return;

  // Then: is this somewhere anyone would want to move to?
  let appeal = 0;
  appeal += clamp(beds / 4, 0, 1) * 0.4;
  appeal += clamp(g.stock.bread / 12, 0, 1) * 0.3;
  appeal += clamp(g.stock.wheat / 40, 0, 1) * 0.1;
  const comforts = g.buildings.filter(
    (b) => b.stage === 'done' && (b.def === 'bench' || b.def === 'well' || b.def === 'flowerbed' || b.def === 'statue'),
  ).length;
  appeal += clamp(comforts / 6, 0, 1) * 0.2;

  // The first few pairs of hands come easily; after that word has to spread.
  if (g.villagers.length < 4) appeal += 0.4;
  else if (g.villagers.length > 25) appeal *= 0.6;

  if (!rng.chance(clamp(appeal, 0, 0.85))) return;
  arrive(g);
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

  v.history.push({ day: g.day, text: 'Walked in from the road and decided to stay.' });
  journal(g, `${v.name} settled in the kingdom.`, '🚶');
  toast(g, `${v.name} has decided to settle here.`, '🚶', 'good');
  speak(v, 'Room for one more?');
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

