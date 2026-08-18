/**
 * The day, laid flat along the top edge of the screen.
 *
 * There is a sky over the island with the sun actually in it, but you only see
 * it zoomed out or panned north — and the whole reason for wanting a sun is to
 * know the hour while you are down among the buildings. So the same reading is
 * hung along the top, where it cannot be panned away from.
 *
 * The strip is the whole day, left edge to right edge, and **the bands never
 * move**. That is the entire design: the body's position along it is the time,
 * and because dusk always begins in the same place you can see how much
 * daylight is left without anything saying so in words. A strip that showed
 * only the current crossing would answer "how far through this one" and not
 * "how much is left", which is the question somebody with a half-built cabin
 * has. Where in the day the left edge falls is `stripT`'s business, not this
 * file's: the sun is highest at the halfway mark, so daylight sits in the
 * middle with dawn and dusk flanking it and night at both ends.
 *
 * It is a **track, not a street**. The colour is a thin translucent ribbon that
 * the map still shows through, and the body is larger than the ribbon is deep
 * and overhangs it top and bottom. A band as tall as the thing riding it reads
 * as another bar of interface; a wire with a bead on it reads as a sky.
 *
 * It is a picture, not a control. Nothing on it can be clicked, because time is
 * the one thing in this game nobody can hurry.
 *
 * The whole bar **stands down at the widest zoom**, where the real sky is on
 * show with the real sun in it. The strip exists for the hours spent down among
 * the buildings; up at the widest view it would be the same fact told twice, in
 * the smaller of the two skies. `--sky-h` goes to zero with it and the top bar
 * comes up to the edge, and the clock in that bar goes on saying the hour
 * throughout.
 */

import { clamp } from '../core/util';
import type { GameState } from '../types';
import { BAND_EDGES, celestial, drawMoon, drawSun, skyColors, stripDayT, stripT } from '../render/sky';
import { BREAKS } from '../sim/defs';
import { el } from './context';

/**
 * The room the strip takes at the top of the screen — enough for the body, not
 * for the ribbon. Kept in step with `--sky-h` in the stylesheet, and folded
 * into the measured `--top-h` so everything below clears it.
 */
export const DAY_STRIP_H = 26;

/** How deep the coloured ribbon is, centred in that room. */
const TRACK_H = 7;

/**
 * How much of the map shows through the ribbon. Full strength read as a bar
 * bolted across the top of the game; this is a tint on the day.
 */
const TRACK_ALPHA = 0.5;

/**
 * Horizontal gradients, one per row of the ribbon, rather than a colour per
 * pixel. Even seven pixels deep it wants to shade from overhead down to the
 * horizon or it reads as a progress bar.
 */
const ROWS = 7;

/**
 * Colour samples across the width. The day's ramp wraps round the ends of the
 * strip, so its stops are sampled at even spacings rather than mapped from the
 * table directly — mapped, they come out of order at the wrap and the gradient
 * has to be sorted back into something canvas will accept.
 */
const SAMPLES = 48;

export class DayStrip {
  readonly el: HTMLElement;
  /** Where the cursor is on the strip, for the tooltip; null when it is not. */
  hover: { x: number; y: number } | null = null;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sig = '';
  /** Refreshed whenever the strip repaints, which includes every resize. */
  private box = { top: 0, bottom: 0, left: 0, right: 0 };

  constructor() {
    this.el = el('div', 'daystrip hide-in-clean');
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    /*
     * Listened for on the window rather than on the strip, because the strip
     * takes no pointer events at all. Most of its height is see-through map,
     * and a full-width transparent box that quietly eats drags is the exact
     * bug `#ui > * { pointer-events: auto }` has caused twice already.
     */
    window.addEventListener('pointermove', (e) => {
      // There is no hover on a touchscreen, only a drag that has not finished.
      if (e.pointerType === 'touch') {
        this.hover = null;
        return;
      }
      const b = this.box;
      const on = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
      this.hover = on ? { x: e.clientX, y: e.clientY } : null;
    });
  }

  /**
   * Safe to call every frame, and it mostly does nothing. The body crosses
   * about a pixel a second at ordinary speed, so the signature changes a couple
   * of times a second and the strip is repainted then — repainting a gradient
   * sixty times a second to move something one pixel a minute is work nobody
   * asked for.
   */
  tick(g: GameState, hidden = false): void {
    /*
     * Off altogether while the real sky is on show. The hover goes with it —
     * the box it is tested against is only refreshed on a repaint, and a stale
     * rect left lying at the top of the screen would raise the day's tip over a
     * bar that is not there. The signature is cleared so the strip repaints
     * when it comes back rather than holding whatever hour it went away at.
     */
    if (hidden) {
      this.hover = null;
      this.box = { top: 0, bottom: 0, left: 0, right: 0 };
      this.sig = '';
      return;
    }
    const w = Math.round(this.el.clientWidth);
    if (w <= 0) return;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    const sig = `${w}|${dpr}|${g.season}|${Math.round(g.dayT * 2000)}|${(g.day - 1) % 8}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.paint(g, w, dpr);
    const r = this.el.getBoundingClientRect();
    this.box = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  }

  private paint(g: GameState, w: number, dpr: number): void {
    const h = DAY_STRIP_H;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);

    const mid = Math.round(h / 2);
    const top = mid - Math.floor(TRACK_H / 2);

    /*
     * The whole day in its own colours: dawn is pink because dawn is pink, not
     * because a legend underneath says so. The colours come from the same
     * function the sky over the island uses, so the ribbon is that sky
     * flattened rather than a second opinion about what time it is.
     */
    const cols: { z: [number, number, number]; hz: [number, number, number] }[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const s = skyColors(stripDayT(i / SAMPLES), g.season);
      cols.push({ z: s.zenithRgb, hz: s.horizonRgb });
    }

    c.save();
    c.globalAlpha = TRACK_ALPHA;
    for (let r = 0; r < ROWS; r++) {
      const depth = r / (ROWS - 1);
      const grad = c.createLinearGradient(0, 0, w, 0);
      for (let i = 0; i <= SAMPLES; i++) grad.addColorStop(i / SAMPLES, blend(cols[i].z, cols[i].hz, depth));
      c.fillStyle = grad;
      const y0 = top + Math.round((r * TRACK_H) / ROWS);
      c.fillRect(0, y0, w, Math.max(1, top + Math.round(((r + 1) * TRACK_H) / ROWS) - y0));
    }

    c.restore();

    /*
     * The landmarks, ticked across the ribbon and a little beyond it either
     * side. Where dusk begins does not move, and that fixed place is what makes
     * the strip readable at a glance — so the marks are drawn at full strength
     * rather than through the ribbon's alpha, where they came out invisible.
     *
     * A dark line with a light one beside it, because the strip lies over the
     * map: a dark tick disappears against a night kingdom and a light one
     * disappears against a meadow, and the pair survives both.
     */
    for (const t of BAND_EDGES) {
      const tx = Math.round(stripT(t) * w);
      c.fillStyle = 'rgba(10,8,6,0.34)';
      c.fillRect(tx, top - 2, 1, TRACK_H + 4);
      c.fillStyle = 'rgba(255,250,240,0.26)';
      c.fillRect(tx + 1, top - 2, 1, TRACK_H + 4);
    }

    /*
     * Whichever body is up, and only ever one — they hand over at the rim in
     * the sky and they hand over here at the same moment. Drawn at full
     * strength over a half-strength ribbon and wider than it is deep, so it
     * sits on the track rather than in it. Held a whisker in from either end so
     * it is never sliced in half by the edge of the screen.
     */
    const sky = celestial(g.dayT, g.day);
    const r = 7;
    const x = clamp(stripT(g.dayT) * w, r + 2, w - r - 2);
    // The halos are trimmed to about four fifths and a shade over one: the
    // bloom is a proportion of the disc, and at this size the full share spills
    // off a seven-pixel ribbon and reads as a smudge.
    if (sky.body === 'sun') drawSun(c, x, mid, r, sky.alt, 0.8);
    else drawMoon(c, x, mid, r - 0.5, sky.phase, 1.1);

    /*
     * The three breaks, ruled *underneath* the day rather than on it.
     *
     * Everything above is the sky — the ribbon's colours, the four landmarks,
     * the body riding along it — and a break is not a fact about the sky at
     * all. It is what the kingdom is doing, so it gets a quiet layer of its
     * own below, clear of the ribbon, and the two never argue: the strip says
     * the hour, the rule underneath says whether anybody is working through it.
     *
     * A stretch rather than a tick, because the useful part is the *length*.
     * The midday hour being a third of the evening's is the whole reason
     * somebody looking for everybody knows to look at nine rather than at
     * noon, and a pair of ticks would say when it starts while hiding that.
     *
     * **Drawn after the body, and below the disc**, which is not tidiness. The
     * strip is the day and the body is the hour, so the stretch in progress is
     * always the one directly beneath the sun — the mark that most wants
     * reading is by construction the one the bloom would wash out. Sitting it
     * under `mid + r` costs nothing and keeps it legible at every hour.
     */
    for (const b of BREAKS) {
      const live = g.dayT >= b.from && g.dayT < b.to;
      for (const [x0, x1] of spans(b.from, b.to, w)) {
        // The same trick as the landmarks, on its side: a dark line with a
        // light one against it survives both a night kingdom and a meadow, and
        // either alone disappears against one of them. The one in progress is
        // thicker as well as brighter, because at two pixels a difference in
        // brightness alone is a difference nobody can see.
        const y = mid + r + 1;
        c.fillStyle = `rgba(10,8,6,${live ? 0.45 : 0.24})`;
        c.fillRect(x0, live ? y - 1 : y, x1 - x0, 1);
        c.fillStyle = `rgba(255,198,132,${live ? 1 : 0.38})`;
        c.fillRect(x0, y + 1, x1 - x0, 1);
        if (live) c.fillRect(x0, y, x1 - x0, 1);
      }
    }
  }
}

/**
 * A stretch of the day as pixel ranges along the strip — two of them when it
 * runs off one end and back on at the other.
 *
 * None of the three breaks wraps as the day is currently tuned, and that is
 * exactly why the wrap is handled here rather than assumed away: `stripT`
 * rotates the day so that night sits at both ends, and a schedule tweak that
 * pushed the evening an hour later would silently draw a stretch the whole
 * width of the screen the wrong way round.
 */
function spans(from: number, to: number, w: number): [number, number][] {
  const a = stripT(from) * w;
  const b = stripT(to) * w;
  if (b > a) return [[Math.round(a), Math.round(b)]];
  return [
    [Math.round(a), w],
    [0, Math.round(b)],
  ];
}

function blend(a: [number, number, number], b: [number, number, number], k: number): string {
  const ch = (i: 0 | 1 | 2): number => Math.round(a[i] + (b[i] - a[i]) * k);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}
