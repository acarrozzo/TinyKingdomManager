/**
 * The night sky, and what the Observatory is actually for.
 *
 * Its output is not a number. An enlightened villager standing outside after
 * dark occasionally notices something, and what that produces is a line in the
 * kingdom's journal with their name on it. That is the whole mechanic, and it is
 * the reason the endgame has no completion state: the economy plateaus and the
 * record does not.
 *
 * Everything here mirrors `wildlife.ts` on purpose, because wildlife already
 * works. Conditions, a weight, a cooldown, an observational hint, and never a
 * formula shown to the player. Two rules carry across exactly:
 *
 *  - a failed look must not spend the cooldown, or a run of cloudy nights would
 *    quietly eat a comet nobody ever had a chance at;
 *  - the pacing lives on `GameState`, so it survives a save and is left behind
 *    when a different kingdom is opened.
 *
 * What differs is that the conditions are things the game already simulates and
 * previously wasted: the weather, which was purely cosmetic; the moon's phase,
 * which was only ever a way to read the hour; and the season.
 */

import { rng } from '../core/util';
import type { GameState, SkyDef, Villager } from '../types';
import { moonPhase } from './defs';
import { journal, toast } from './journal';

/**
 * Game seconds between one chance at finding something and the next.
 *
 * Paced by the *sky* rather than by the watchers, which is the whole reason
 * this is a timer and not a roll per person. Thirty-three people at the
 * observatory do not make the heavens more productive; they make it likelier
 * that somebody was looking when something happened. Rolling per watcher swept
 * the entire catalogue in nine days.
 *
 * It has to be short against the window it fires into, which is much narrower
 * than "night": people are awake and it is dark only between `isNight` at 0.7
 * and their own bedtime around 0.77 — under two game-hours, and longer only for
 * a Night Owl, who therefore genuinely does see more sky. At 180 the timer kept
 * landing while the whole kingdom was asleep and the catalogue never moved.
 */
export const SKY_INTERVAL = 60;

/** How often one of those chances comes to anything. */
const FIND_CHANCE = 0.22;

/**
 * How long a thing stays out of the running once it has been found, in game
 * seconds. Long enough that a kingdom does not tick the whole catalogue off in
 * a week, short enough that a planet genuinely does come round again.
 */
const FOUND_COOLDOWN = 60 * 60 * 6;

/**
 * The catalogue.
 *
 * `weight` is relative and nothing else — a comet is not "better" than a
 * constellation, it is rarer, and the collection is a record of what this
 * kingdom happened to see rather than a ladder to climb. `maxMoon` is what
 * makes the moon matter: the bright things show through anything and the faint
 * ones want a thin crescent and patience.
 *
 * Constellations are seasonal and reliable, which makes them the first tier a
 * young observatory meets. Planets return. Showers are a night or two a year.
 * A comet is a comet.
 */
export const SKY: SkyDef[] = [
  // --- Constellations: one to a season, always there in it. ---
  {
    id: 'plough',
    name: 'The Plough',
    kind: 'constellation',
    seasons: ['spring'],
    weight: 10,
    maxMoon: 1,
    hint: 'Seven bright ones in a line and a bend. The first thing anybody here learned to find.',
  },
  {
    id: 'net',
    name: "The Fisher's Net",
    kind: 'constellation',
    seasons: ['summer'],
    weight: 10,
    maxMoon: 1,
    hint: 'A loose square of faint stars low over the water on summer nights.',
  },
  {
    id: 'sheaf',
    name: 'The Sheaf',
    kind: 'constellation',
    seasons: ['autumn'],
    weight: 10,
    maxMoon: 0.9,
    hint: 'Comes up at harvest and stands overhead all autumn, which is presumably how it got the name.',
  },
  {
    id: 'hearth',
    name: 'The Hearth',
    kind: 'constellation',
    seasons: ['winter'],
    weight: 10,
    maxMoon: 0.9,
    hint: 'Four stars in a rough square with one orange one at the middle. Only ever seen in winter.',
  },
  {
    id: 'lantern',
    name: "The Lantern Bearer",
    kind: 'constellation',
    seasons: ['autumn', 'winter'],
    weight: 6,
    maxMoon: 0.7,
    hint: 'A long stoop of faint stars with one bright one held out ahead of it.',
  },
  {
    id: 'thread',
    name: 'The Thread',
    kind: 'constellation',
    weight: 4,
    maxMoon: 0.5,
    hint: 'A thin line of very faint stars. Needs a dark night and somebody prepared to wait for it.',
  },

  // --- Planets: no season, and they come round again. ---
  {
    id: 'morningstar',
    name: 'The Morning Star',
    kind: 'planet',
    weight: 8,
    maxMoon: 1,
    hint: 'Brighter than anything else up there and not a star at all. Keeps its own schedule.',
  },
  {
    id: 'redwanderer',
    name: 'The Red Wanderer',
    kind: 'planet',
    weight: 6,
    maxMoon: 0.95,
    hint: 'A steady orange point that moves against the others over a season, then turns and goes back.',
  },
  {
    id: 'slowone',
    name: 'The Slow One',
    kind: 'planet',
    weight: 4,
    maxMoon: 0.8,
    hint: 'Takes years to cross the sky. Somebody watching for a long time notices it has moved.',
  },
  {
    id: 'ringed',
    name: 'The Ringed Planet',
    kind: 'planet',
    weight: 2,
    maxMoon: 0.6,
    hint: 'Looks like an ordinary star to the eye. Through glass it is not one, and whoever first saw that did not sleep afterwards.',
  },

  // --- Showers: a night or two, and everybody can see them. ---
  {
    id: 'springshower',
    name: 'The Spring Shower',
    kind: 'meteor',
    seasons: ['spring'],
    weight: 5,
    maxMoon: 0.8,
    hint: 'A few nights every spring when the sky throws things about.',
  },
  {
    id: 'autumnshower',
    name: 'The Autumn Shower',
    kind: 'meteor',
    seasons: ['autumn'],
    weight: 5,
    maxMoon: 0.8,
    hint: 'The better of the two, if anybody is counting. Nobody is counting.',
  },
  {
    id: 'longnight',
    name: 'The Long Night Lights',
    kind: 'meteor',
    seasons: ['winter'],
    weight: 3,
    maxMoon: 0.6,
    hint: 'Colour along the northern horizon on the coldest, clearest winter nights.',
  },

  // --- Comets: rare, and they take the finder's name. ---
  {
    id: 'comet',
    name: 'A Comet',
    kind: 'comet',
    weight: 1,
    maxMoon: 0.55,
    hint: 'Once in a very long while there is something up there with a tail on it, and whoever sees it first has it named after them.',
  },
];

export const SKY_BY_ID: Record<string, SkyDef> = Object.fromEntries(SKY.map((d) => [d.id, d]));

/** A fresh, empty pacing block for a new kingdom. */
export function newSkyTimers(): GameState['sky'] {
  return { finds: [], check: SKY_INTERVAL, cooldown: {} };
}

/** True when the sky is worth looking at: after dark, and not raining or snowing. */
export function skyIsClear(g: GameState): boolean {
  return g.weatherKind === 'clear' || g.weather < 0.15;
}

/**
 * Whether anything can be found right now, regardless of who is looking.
 *
 * Used by the Observatory panel to say why nothing is happening — "the dome is
 * shut, it is raining" is an answer, and a silent building is not.
 */
export function skyClosedReason(g: GameState, night: boolean): string | null {
  if (!night) return 'The dome is shut. There is nothing to see until it is properly dark.';
  if (!skyIsClear(g)) {
    return g.weatherKind === 'snow'
      ? 'The dome is shut against the snow. It will open again when this passes.'
      : 'The dome is shut against the rain. It will open again when this passes.';
  }
  return null;
}

/**
 * One chance at the sky, credited to one person.
 *
 * Nothing here spends a cooldown on a *failure*. A run of cloudy nights, a full
 * moon, or simple bad luck must leave the sky exactly as it found it — the same
 * rule the wildlife follows, and for the same reason: a species whose cooldown
 * burned on a spawn that never happened is a species the player never meets.
 */
function look(g: GameState, v: Villager): SkyDef | null {
  if (!skyIsClear(g)) return null;

  const moon = moonPhase(g.day);
  const found = new Set(g.sky.finds.map((f) => f.id));

  const candidates = SKY.filter((d) => {
    // A comet can be found again; it is a different comet, and it takes a
    // different name. Everything else in the catalogue is a particular thing
    // and is found once.
    if (d.kind !== 'comet' && found.has(d.id)) return false;
    if ((g.sky.cooldown[d.id] ?? 0) > 0) return false;
    if (d.seasons && !d.seasons.includes(g.season)) return false;
    if (moon > d.maxMoon) return false;
    return true;
  });
  if (candidates.length === 0) return null;

  // Most of the time nothing happens, and that is the point of standing there.
  if (!rng.chance(FIND_CHANCE)) return null;

  let total = 0;
  for (const d of candidates) total += d.weight;
  let roll = rng.range(0, total);
  for (const d of candidates) {
    roll -= d.weight;
    if (roll <= 0) return record(g, v, d);
  }
  return record(g, v, candidates[candidates.length - 1]);
}

/**
 * Writes a find into the kingdom's record.
 *
 * A comet takes the finder's name, which is the one piece of the sky that
 * belongs to a particular person rather than to everybody. The rest keep their
 * own names and simply remember who saw them first.
 */
function record(g: GameState, v: Villager, def: SkyDef): SkyDef {
  const name = def.kind === 'comet' ? `${lastName(v.name)}'s Comet` : def.name;
  g.sky.finds.push({
    id: def.id,
    day: g.day,
    year: g.year,
    season: g.season,
    by: v.id,
    byName: v.name,
    name: def.kind === 'comet' ? name : undefined,
  });
  g.sky.cooldown[def.id] = FOUND_COOLDOWN;
  v.enlightened = v.enlightened
    ? { day: v.enlightened.day, found: v.enlightened.found + 1 }
    : { day: g.day, found: 1 };

  journal(g, `${v.name} was the first to see ${name}.`, '★');
  toast(g, `${v.name} saw ${name}`, '★', 'good');
  v.history.push({ day: g.day, text: `Was the first to see ${name}.` });
  return def;
}

/** The part of a name a comet would be called after. */
function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1] || full;
}

/**
 * Runs the cooldowns down and, every `SKY_INTERVAL`, gives the sky one chance
 * to show somebody something.
 *
 * The chance is taken only if somebody is actually out there looking. Time
 * passing is not enough — a kingdom that has built no observatory, or whose
 * enlightened are all in bed, finds nothing, and the record stays honest about
 * having been *seen* by a particular person on a particular night.
 */
export function updateSky(g: GameState, dt: number): void {
  const cd = g.sky.cooldown;
  for (const k in cd) {
    const left = cd[k];
    if (left > 0) cd[k] = Math.max(0, left - dt);
  }

  g.sky.check -= dt;
  if (g.sky.check > 0) return;
  g.sky.check = SKY_INTERVAL;

  // Whoever is standing outside with their head back. If several are, one of
  // them gets to be the one who noticed, which is how it works anyway.
  const watching = g.villagers.filter((v) => v.activity === 'stargazing');
  if (watching.length === 0) return;
  look(g, rng.pick(watching));
}
