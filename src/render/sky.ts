/**
 * Where the sun and the moon are, and what colour that makes the sky.
 *
 * This is the one place that turns `dayT` into something you can look at. Two
 * things read from it and they must agree, because they are the same fact told
 * twice: the sky drawn above the island's horizon, and the direction every
 * shadow on the ground falls. If the sun is low and to the left, shadows are
 * long and lean right — a player who never pans far enough north to see the sky
 * still knows roughly what hour it is from the ground alone, which is the whole
 * reason the shadows exist.
 *
 * Nothing here is a mechanic. Time of day already drives sleep, work hours and
 * which animals are about; this only draws it.
 */

import { clamp } from '../core/util';
import type { Season } from '../types';

/** Day-fraction 0 is first light; the clock reads it as 05:00. */
export const CLOCK_OFFSET_HOURS = 5;

/**
 * The sun is up for a shade under three quarters of the day, which is the split
 * `daylight()` and `isNight()` in the simulation already work to. The moon has
 * what is left, rising as the sun goes down and setting as it comes back up, so
 * there is never a stretch with nothing in the sky at all.
 */
export const SUNRISE = 0.02;
export const SUNSET = 0.74;
export const MOONRISE = SUNSET;
export const MOONSET = SUNRISE + 1;

export type Band = 'night' | 'dawn' | 'day' | 'dusk';

/**
 * The four sections of the day, named the way the game would say them. The
 * boundaries are the ones the simulation already behaves to — people are at
 * work through `day`, and asleep for most of `night` — rather than a fresh set
 * invented for the picture.
 */
export const BAND_META: Record<Band, { name: string; note: string }> = {
  dawn: { name: 'Dawn', note: 'First light. The early risers are already up.' },
  day: { name: 'Day', note: 'Work hours. Everyone who has a job is at it.' },
  dusk: { name: 'Dusk', note: 'The light is going. Work winds down.' },
  night: { name: 'Night', note: 'Most of the kingdom is asleep.' },
};

const DAWN_END = 0.14;
const DAY_END = 0.62;
const DUSK_END = 0.8;

export function bandOf(dayT: number): Band {
  if (dayT < SUNRISE) return 'night';
  if (dayT < DAWN_END) return 'dawn';
  if (dayT < DAY_END) return 'day';
  if (dayT < DUSK_END) return 'dusk';
  return 'night';
}

/** Time of day as a friendly 24-hour clock. */
export function clockFor(dayT: number): string {
  const hours = (dayT * 24 + CLOCK_OFFSET_HOURS) % 24;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface Celestial {
  body: 'sun' | 'moon';
  /**
   * Where along its arc, -1 at the point it rises to +1 at the point it sets.
   * Left to right across the screen: the map has no compass and never claims
   * one, so this is a reading direction rather than a bearing.
   */
  az: number;
  /** Height above the horizon, 0 at the rim and 1 at the top of the arc. */
  alt: number;
  /** How much of the moon is lit, 0.25 (a thin crescent) to 1 (full). */
  phase: number;
  /** How far through this body's own crossing, 0 to 1. */
  through: number;
}

/**
 * Whichever body is up, and where. Only one ever is: they hand over at the rim
 * rather than sharing the sky, which keeps "what is up there" a single glance
 * instead of a comparison.
 */
export function celestial(dayT: number, day: number): Celestial {
  const sunUp = dayT >= SUNRISE && dayT < SUNSET;
  const body = sunUp ? 'sun' : 'moon';
  const rise = sunUp ? SUNRISE : MOONRISE;
  const set = sunUp ? SUNSET : MOONSET;
  // The moon's crossing runs past midnight, so its early hours belong to the
  // arc that began yesterday evening.
  const t = sunUp || dayT >= MOONRISE ? dayT : dayT + 1;
  const through = clamp((t - rise) / (set - rise), 0, 1);
  return {
    body,
    az: -Math.cos(Math.PI * through),
    alt: Math.sin(Math.PI * through),
    phase: moonPhase(day),
    through,
  };
}

/**
 * An eight-day cycle, and deliberately never a new moon: an invisible moon is
 * one night in eight with nothing in the sky to read the hour from, which is a
 * worse trade than a crescent that is a little fuller than it ought to be.
 */
function moonPhase(day: number): number {
  const p = (((day - 1) % 8) + 8) % 8 / 8;
  return 0.25 + 0.75 * (1 - Math.abs(0.5 - p) * 2);
}

// ---------------------------------------------------------------------------
// Sky colour
// ---------------------------------------------------------------------------

interface SkyStop {
  t: number;
  zenith: [number, number, number];
  horizon: [number, number, number];
}

/**
 * The bands of the day are these colours and nothing else — there is no gauge
 * drawn over the sky saying "dusk", because the sky going orange at the rim and
 * violet overhead *is* the kingdom saying so. The stops line up with the ones
 * `ambientTint` uses, so the light on the ground and the light in the sky are
 * never telling different stories.
 */
const SKY_STOPS: SkyStop[] = [
  { t: 0.0, zenith: [38, 48, 88], horizon: [110, 92, 118] },
  { t: 0.05, zenith: [74, 106, 154], horizon: [232, 166, 121] },
  { t: 0.14, zenith: [104, 160, 206], horizon: [188, 217, 232] },
  { t: 0.42, zenith: [92, 158, 214], horizon: [168, 207, 232] },
  { t: 0.6, zenith: [107, 163, 207], horizon: [226, 198, 154] },
  { t: 0.68, zenith: [99, 115, 158], horizon: [240, 160, 94] },
  { t: 0.76, zenith: [58, 74, 120], horizon: [160, 106, 132] },
  { t: 0.85, zenith: [26, 34, 68], horizon: [42, 51, 88] },
  { t: 1.0, zenith: [32, 42, 78], horizon: [58, 67, 104] },
];

export interface SkyColors {
  zenith: string;
  horizon: string;
  /** The horizon colour again, for the haze laid over the sea beneath it. */
  horizonRgb: [number, number, number];
  /** How much of the starfield shows through, 0 to 1. */
  stars: number;
}

export function skyColors(dayT: number, season: Season): SkyColors {
  let a = SKY_STOPS[0];
  let b = SKY_STOPS[SKY_STOPS.length - 1];
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    if (dayT >= SKY_STOPS[i].t && dayT <= SKY_STOPS[i + 1].t) {
      a = SKY_STOPS[i];
      b = SKY_STOPS[i + 1];
      break;
    }
  }
  const k = (dayT - a.t) / (b.t - a.t || 1);
  // Winter skies run colder, summer's a shade warmer — the same nudge
  // `ambientTint` gives the light, so the two never disagree.
  const rMul = season === 'winter' ? 0.92 : season === 'summer' ? 1.04 : 1;
  const bMul = season === 'winter' ? 1.06 : season === 'summer' ? 0.98 : 1;
  const at = (from: [number, number, number], to: [number, number, number]): [number, number, number] => [
    (from[0] + (to[0] - from[0]) * k) * rMul,
    from[1] + (to[1] - from[1]) * k,
    (from[2] + (to[2] - from[2]) * k) * bMul,
  ];
  const z = at(a.zenith, b.zenith);
  const h = at(a.horizon, b.horizon);

  // Stars come out with the dark rather than at a stroke of the clock.
  const bright = (z[0] + z[1] + z[2]) / 3;
  return {
    zenith: rgb(z),
    horizon: rgb(h),
    horizonRgb: [Math.round(clamp(h[0], 0, 255)), Math.round(clamp(h[1], 0, 255)), Math.round(clamp(h[2], 0, 255))],
    stars: clamp(1 - (bright - 40) / 70, 0, 1),
  };
}

function rgb(c: [number, number, number]): string {
  return `rgb(${Math.round(clamp(c[0], 0, 255))},${Math.round(clamp(c[1], 0, 255))},${Math.round(clamp(c[2], 0, 255))})`;
}

// ---------------------------------------------------------------------------
// Shadows
// ---------------------------------------------------------------------------

export interface Sunlight {
  /**
   * How far a shadow reaches along the ground, as a multiple of how tall the
   * thing casting it is. Capped: the true figure runs away to infinity as the
   * body touches the rim, and a tree whose shadow crosses half the island reads
   * as a bug rather than as a sunrise.
   */
  reach: number;
  /** Screen-x lean per unit of reach: +1 leans right, -1 leans left. */
  lean: number;
  /** How dark the shadow lies on the ground, 0 to 1. */
  alpha: number;
}

const MAX_REACH = 3.2;

/**
 * Shadows fall away from whatever is up. The sun is worth a firm shadow; the
 * moon is worth a suggestion of one, which is what makes a moonlit night read
 * as a different time of day rather than as the same picture turned down.
 */
export function sunlight(dayT: number, day: number, weather: number): Sunlight {
  const c = celestial(dayT, day);
  // Never quite flat at the horizon: a body sitting exactly on the rim would
  // otherwise cast a shadow of no length at all as it crossed over.
  const elev = ((4 + c.alt * 54) * Math.PI) / 180;
  const reach = Math.min(MAX_REACH, 1 / Math.tan(elev));
  // A low sun still casts a firm shadow — it is only softer, and the shadow it
  // casts is the longest of the day. Scaling darkness off altitude alone made
  // the most dramatic hour the one you could barely see.
  const strength = c.body === 'sun' ? 0.12 + c.alt * 0.14 : 0.03 + c.alt * 0.05;
  return {
    reach,
    lean: -c.az,
    // Cloud takes the edges off without ever removing them entirely.
    alpha: strength * (1 - weather * 0.65),
  };
}
