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

/**
 * Where one section of the day gives way to the next. Exported because the day
 * strip marks them: those four places never move, and where dusk begins is the
 * thing the strip is actually read for.
 */
export const BAND_EDGES = [SUNRISE, 0.14, 0.62, 0.8];

/**
 * The moment the sun is highest. Not noon by the clock — the kingdom's day runs
 * from about half five to a quarter to eleven, so its solar noon is closer to
 * two — and the difference matters, because it is what the day strip centres
 * itself on.
 */
export const DAY_MIDPOINT = (SUNRISE + SUNSET) / 2;

/**
 * Day-fraction to position along the day strip, 0 at the left edge and 1 at the
 * right. Rotated so the sun is at its highest exactly halfway across, which
 * puts daylight in the middle with dawn and dusk flanking it and night at both
 * ends — a shape you can read without counting. Centring on twelve by the clock
 * instead would push the whole arc to the right, because this kingdom's
 * afternoons are longer than its mornings.
 *
 * Everything the strip draws goes through here, so the marks and the body can
 * never end up telling different stories about where in the day it is.
 */
export function stripT(dayT: number): number {
  return (dayT + 1.5 - DAY_MIDPOINT) % 1;
}

/** The inverse, for painting the strip's colours across its width. */
export function stripDayT(t: number): number {
  return (t + DAY_MIDPOINT + 0.5) % 1;
}

export function bandOf(dayT: number): Band {
  if (dayT < BAND_EDGES[0]) return 'night';
  if (dayT < BAND_EDGES[1]) return 'dawn';
  if (dayT < BAND_EDGES[2]) return 'day';
  if (dayT < BAND_EDGES[3]) return 'dusk';
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
  /**
   * The same two again as numbers. The haze over the sea needs the horizon at
   * an alpha, and the day strip shades between the pair across its own height.
   */
  zenithRgb: [number, number, number];
  horizonRgb: [number, number, number];
  /** How much of the starfield shows through, 0 to 1. */
  stars: number;
}

/**
 * Winter skies run colder, summer's a shade warmer — the same nudge
 * `ambientTint` gives the light, so the two never disagree.
 */
function seasonMul(season: Season): [number, number] {
  if (season === 'winter') return [0.92, 1.06];
  if (season === 'summer') return [1.04, 0.98];
  return [1, 1];
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
  const [rMul, bMul] = seasonMul(season);
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
    zenithRgb: bytes(z),
    horizonRgb: bytes(h),
    stars: clamp(1 - (bright - 40) / 70, 0, 1),
  };
}

function bytes(c: [number, number, number]): [number, number, number] {
  return [Math.round(clamp(c[0], 0, 255)), Math.round(clamp(c[1], 0, 255)), Math.round(clamp(c[2], 0, 255))];
}

function rgb(c: [number, number, number]): string {
  return `rgb(${Math.round(clamp(c[0], 0, 255))},${Math.round(clamp(c[1], 0, 255))},${Math.round(clamp(c[2], 0, 255))})`;
}

// ---------------------------------------------------------------------------
// The bodies themselves
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

/**
 * Drawn here rather than in the renderer, because two places put a sun on a
 * canvas — the sky over the island, and the day strip along the top of the
 * screen — and a sun that is a different sun in each of them is two suns.
 *
 * `halo` scales the bloom for somewhere with less room than the sky. The bloom
 * is already a proportion of the disc, so this is a further trim rather than
 * the thing that keeps a small sun's glow small; the disc itself is unchanged,
 * so it stays the same object at either size.
 */
export function drawSun(ctx: Ctx, cx: number, cy: number, r: number, alt: number, halo = 1): void {
  const low = clamp(1 - alt, 0, 1);
  bloom(ctx, cx, cy, r, '#ffcf8a', 0.055, halo);
  // Low sun is deep and orange; high sun is almost white. The same shift the
  // ambient tint makes, said by the thing making it.
  fillDisc(ctx, cx, cy, r, mixHex('#fff6d8', '#ff9a4a', low * 0.85));
}

export function drawMoon(ctx: Ctx, cx: number, cy: number, r: number, phase: number, halo = 1): void {
  bloom(ctx, cx, cy, r, '#a8bcff', 0.02, halo);
  fillMoon(ctx, cx, cy, r, phase);
}

/**
 * The glow goes down `lighter` rather than over the top. A warm ring laid on at
 * an alpha is darker than a pale evening sky however it is coloured, which drew
 * a grey washer round the setting sun.
 *
 * Each ring is a *proportion* of the disc rather than so many pixels out from
 * it, so the same sun drawn at any size is the same sun. As a fixed step it was
 * a halo on a small body and a hairline round a large one.
 */
const BLOOM_STEP = 0.21;

/**
 * How far apart the rings may be before the glow stops being a glow. Three of
 * them is a fall-off round a body the size of a bead and a bullseye round one
 * the size of a setting sun, which is what it looked like at the first attempt:
 * the same proportions, three concentric hoops, painted on the sky.
 */
const BLOOM_GAP = 2.5;

function bloom(ctx: Ctx, cx: number, cy: number, r: number, color: string, step: number, scale: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const rings = clamp(Math.round(r / BLOOM_GAP), 3, 12);
  for (let i = rings; i >= 1; i--) {
    // The alphas are normalised to the same total however many rings there are,
    // so a large sun's glow is smoother than a small one's and no brighter.
    const a = (12 * step * (rings + 1 - i)) / (rings * (rings + 1));
    fillDisc(ctx, cx, cy, r * (1 + (i / rings) * 3 * BLOOM_STEP * scale), withAlpha(color, a));
  }
  ctx.restore();
}

/**
 * Discs and moons are filled row by row rather than with an arc path, for the
 * same reason the sprites are: the world buffer is one canvas pixel per art
 * pixel, and an antialiased edge there upscales into a smear.
 */
function fillDisc(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  const n = Math.ceil(r);
  for (let dy = -n; dy <= n; dy++) {
    const w = Math.sqrt(Math.max(0, r * r - dy * dy));
    if (w < 0.5) continue;
    ctx.fillRect(Math.round(cx - w), Math.round(cy + dy), Math.max(1, Math.round(w * 2)), 1);
  }
}

/**
 * The moon, lit from one side. The terminator follows each row's own width
 * rather than cutting straight down, which is the difference between a crescent
 * and a disc somebody has taken a bite out of. The unlit limb is still faintly
 * there — earthshine, and the reason the moon never disappears entirely.
 */
function fillMoon(ctx: Ctx, cx: number, cy: number, r: number, phase: number): void {
  const n = Math.ceil(r);
  for (let dy = -n; dy <= n; dy++) {
    const w = Math.sqrt(Math.max(0, r * r - dy * dy));
    if (w < 0.5) continue;
    const y = Math.round(cy + dy);
    ctx.fillStyle = 'rgba(150,164,200,0.55)';
    ctx.fillRect(Math.round(cx - w), y, Math.max(1, Math.round(w * 2)), 1);
    const x0 = cx + w * (1 - 2 * phase);
    const lit = cx + w - x0;
    if (lit >= 1) {
      ctx.fillStyle = '#eef1ff';
      ctx.fillRect(Math.round(x0), y, Math.round(lit), 1);
    }
  }
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(alpha, 0, 1)})`;
}

function mixHex(a: string, b: string, k: number): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const t = clamp(k, 0, 1);
  const ch = (sh: number): number => Math.round(((x >> sh) & 255) + (((y >> sh) & 255) - ((x >> sh) & 255)) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
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
