/**
 * Wildlife. Animals are not decoration: what appears, and how much of it, is a
 * function of what the land actually looks like. Plant trees and squirrels turn
 * up. Dig a pond and you get ducks. None of the numbers behind this are shown
 * to the player — the wildlife journal only ever offers a hint.
 */

import { clamp, dist, rng } from '../core/util';
import type { Animal, GameState, SpeciesDef, SpeciesId, Villager } from '../types';
import { SPECIES, SPECIES_ORDER } from './defs';
import { isWalkable, tileAt } from '../world/terrain';
import { nextId } from '../core/util';
import { journal, toast } from './journal';

const SURVEY_INTERVAL = 20; // game seconds between habitat surveys
let surveyTimer = 0;
let habitatCache: Partial<Record<SpeciesId, { score: number; spots: { x: number; y: number }[] }>> = {};
/** Per-species cooldown so rare creatures stay rare rather than trickling in. */
const spawnCooldown: Partial<Record<SpeciesId, number>> = {};

export function resetWildlifeCache(): void {
  surveyTimer = 0;
  habitatCache = {};
  for (const k of SPECIES_ORDER) spawnCooldown[k] = 0;
}

export function updateWildlife(g: GameState, dt: number): void {
  for (const k of SPECIES_ORDER) {
    const left = spawnCooldown[k];
    if (left && left > 0) spawnCooldown[k] = left - dt;
  }
  surveyTimer -= dt;
  if (surveyTimer <= 0) {
    surveyTimer = SURVEY_INTERVAL;
    survey(g);
    considerSpawns(g);
  }

  for (let i = g.animals.length - 1; i >= 0; i--) {
    const a = g.animals[i];
    updateAnimal(g, a, dt);
    if (a.ttl <= 0 && !a.name && !a.favorite) {
      g.animals.splice(i, 1);
    }
  }
}

/** True when this species' active window contains the current time of day. */
function isActive(def: SpeciesDef, dayT: number): boolean {
  const [a, b] = def.active;
  return a <= b ? dayT >= a && dayT < b : dayT >= a || dayT < b;
}

/**
 * Scores each species' habitat across the map and remembers the best spots.
 * Sampled on a coarse lattice — precision is not the point here.
 */
function survey(g: GameState): void {
  const next: typeof habitatCache = {};
  const step = 2;

  for (const id of SPECIES_ORDER) {
    const def = SPECIES[id];
    if (def.seasons && !def.seasons.includes(g.season)) {
      next[id] = { score: 0, spots: [] };
      continue;
    }
    let score = 0;
    const spots: { x: number; y: number }[] = [];

    for (let y = 1; y < g.h - 1; y += step) {
      for (let x = 1; x < g.w - 1; x += step) {
        const t = g.tiles[y * g.w + x];
        let s = def.habitat[t.terrain] ?? 0;
        if (s <= 0) continue;

        // Nearby props sweeten or sour a spot.
        if (def.likesProps) {
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              const n = tileAt(g, x + dx, y + dy);
              if (!n || !n.prop) continue;
              const bonus = def.likesProps[n.prop];
              if (bonus) s += bonus * 0.2;
            }
        }
        // Farms are quietly good for birds and bees.
        if ((id === 'bird' || id === 'bee') && t.plot) s += 0.6;

        score += s;
        if (s > 0.5 && spots.length < 80) spots.push({ x, y });
      }
    }
    next[id] = { score: score * step * step * 0.01, spots };
  }
  habitatCache = next;
}

function populationOf(g: GameState, id: SpeciesId): number {
  let n = 0;
  for (const a of g.animals) if (a.species === id) n++;
  return n;
}

function considerSpawns(g: GameState): void {
  for (const id of SPECIES_ORDER) {
    const def = SPECIES[id];
    const hab = habitatCache[id];
    if (!hab || hab.score <= 0 || hab.spots.length === 0) continue;
    if (!isActive(def, g.dayT)) continue;
    if ((spawnCooldown[id] ?? 0) > 0) continue;

    // Uncommon creatures also want a decent amount of the right country before
    // they will show up at all, so a bare kingdom never sees a deer.
    if (def.rarity > 1.5 && hab.score < def.rarity * 1.6) continue;

    const target = clamp(Math.round(hab.score * def.density * 100), 0, def.hardCap);
    if (populationOf(g, id) >= target) continue;

    // Rarity dominates the pacing: a fox is a hundred times less likely than a
    // rabbit to wander in on any given check. The very first one of a kind is
    // rarer still, so that meeting it is an occasion.
    let chance = clamp(0.45 / (def.rarity * def.rarity * def.rarity), 0.002, 0.5);
    if (!g.discovered.has(id) && def.rarity > 1.2) chance *= 0.3;
    if (!rng.chance(chance)) continue;

    const spot = rng.pick(hab.spots);
    const jx = clamp(spot.x + rng.int(-1, 1), 1, g.w - 2);
    const jy = clamp(spot.y + rng.int(-1, 1), 1, g.h - 2);
    spawn(g, id, jx, jy);
    spawnCooldown[id] = 70 * def.rarity * def.rarity;
  }
}

export function spawn(g: GameState, species: SpeciesId, x: number, y: number): Animal {
  const a: Animal = {
    id: nextId(),
    species,
    x,
    y,
    tx: x,
    ty: y,
    state: 'wander',
    timer: rng.range(1, 4),
    face: rng.int(0, 3),
    phase: rng.range(0, 6.28),
    favorite: false,
    seen: g.day,
    hop: 0,
    ttl: rng.range(240, 900),
  };
  g.animals.push(a);
  return a;
}

/**
 * A creature only counts as discovered once it has come close enough to the
 * settlement for somebody to have actually noticed it. Ducks on the far side of
 * the pond stay unrecorded until a villager wanders down there.
 */
const NOTICE_RANGE = 7;

function checkNoticed(g: GameState, a: Animal): void {
  if (g.discovered.has(a.species)) return;
  let near = false;
  for (const v of g.villagers) {
    if (v.activity === 'sleeping') continue;
    if (dist(v.x, v.y, a.x, a.y) < NOTICE_RANGE) {
      near = true;
      break;
    }
  }
  if (!near) {
    for (const b of g.buildings) {
      if (b.stage !== 'done') continue;
      if (dist(b.x, b.y, a.x, a.y) < NOTICE_RANGE) {
        near = true;
        break;
      }
    }
  }
  if (!near) return;

  const def = SPECIES[a.species];
  g.discovered.add(a.species);
  const article = /^[aeiou]/i.test(def.name) ? 'An' : 'A';
  journal(g, `${article} ${def.name.toLowerCase()} was seen in the kingdom for the first time.`, '🔭');
  toast(g, `New wildlife: ${def.name}`, '🔭', 'good');
}

function updateAnimal(g: GameState, a: Animal, dt: number): void {
  const def = SPECIES[a.species];
  a.phase += dt;
  a.timer -= dt;
  if (!a.name && !a.favorite) a.ttl -= dt;
  if (!g.discovered.has(a.species)) checkNoticed(g, a);

  const active = isActive(def, g.dayT);

  // Skittish creatures keep an eye out for people.
  if (def.skittish > 0 && a.state !== 'flee') {
    const threat = nearestVillager(g, a.x, a.y, def.skittish);
    if (threat) {
      a.state = 'flee';
      a.timer = rng.range(1.5, 3.5);
      const dx = a.x - threat.x;
      const dy = a.y - threat.y;
      const d = Math.hypot(dx, dy) || 1;
      a.tx = clamp(a.x + (dx / d) * 6, 1, g.w - 2);
      a.ty = clamp(a.y + (dy / d) * 6, 1, g.h - 2);
    }
  }

  if (a.timer <= 0) {
    if (!active) {
      a.state = 'rest';
      a.timer = rng.range(6, 16);
    } else {
      const roll = rng.next();
      if (roll < 0.45) {
        a.state = 'wander';
        a.timer = rng.range(2, 6);
        pickDestination(g, a, def);
      } else if (roll < 0.75) {
        a.state = 'feed';
        a.timer = rng.range(3, 9);
      } else {
        a.state = 'rest';
        a.timer = rng.range(3, 10);
      }
    }
  }

  if (a.state === 'wander' || a.state === 'flee') {
    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.12) {
      a.state = 'feed';
      a.timer = rng.range(2, 6);
    } else {
      const sp = def.speed * (a.state === 'flee' ? 1.7 : 1) * dt;
      const nx = a.x + (dx / d) * sp;
      const ny = a.y + (dy / d) * sp;
      if (canStand(g, a, nx, ny)) {
        a.x = nx;
        a.y = ny;
      } else {
        pickDestination(g, a, def);
      }
      a.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
      // Small creatures hop rather than glide.
      a.hop = def.size === 0 ? Math.abs(Math.sin(a.phase * 9)) * 1.6 : Math.abs(Math.sin(a.phase * 6)) * 0.9;
    }
  } else {
    a.hop = 0;
  }
}

function canStand(g: GameState, a: Animal, x: number, y: number): boolean {
  const def = SPECIES[a.species];
  const t = tileAt(g, Math.round(x), Math.round(y));
  if (!t) return false;
  if (t.building) return false;
  const swimmer = (def.habitat.water ?? 0) > 0 || (def.habitat.shallow ?? 0) > 0;
  if (t.terrain === 'water' || t.terrain === 'shallow') return swimmer;
  return isWalkable(g, Math.round(x), Math.round(y)) || (def.habitat[t.terrain] ?? 0) > 0;
}

function pickDestination(g: GameState, a: Animal, def: SpeciesDef): void {
  for (let i = 0; i < 8; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const d = rng.range(1.5, def.size === 0 ? 5 : 8);
    const x = clamp(a.x + Math.cos(ang) * d, 1, g.w - 2);
    const y = clamp(a.y + Math.sin(ang) * d, 1, g.h - 2);
    if (canStand(g, a, x, y)) {
      a.tx = x;
      a.ty = y;
      return;
    }
  }
  a.tx = a.x;
  a.ty = a.y;
}

function nearestVillager(g: GameState, x: number, y: number, radius: number): Villager | null {
  let best: Villager | null = null;
  let bestD = radius;
  for (const v of g.villagers) {
    if (v.activity === 'sleeping') continue;
    if (v.trait === 'animalFriend') continue; // wildlife simply does not mind them
    const d = dist(v.x, v.y, x, y);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

