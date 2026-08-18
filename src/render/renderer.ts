/**
 * The renderer draws the world into an offscreen buffer at exactly one canvas
 * pixel per art pixel, then upscales that buffer with nearest-neighbour. That
 * is what keeps the pixel art crisp at every zoom level instead of smearing.
 *
 * Ground is baked once into a single map-sized canvas and blitted as one image;
 * only things that need depth sorting against actors are drawn per frame.
 */

import { clamp, hash2 } from '../core/util';
import type { Building, BuildingDef, GameState, JobId, PropId, Season, TerrainId, Villager } from '../types';
import { BUILDINGS, GOOD_SPOT } from '../sim/defs';
import { sleepingIndoors, wantsWorker } from '../sim/state';
import { HALF_H, HALF_W, TILE_H, TILE_W, toGridX, toGridY, toScreenX, toScreenY } from '../world/iso';
import { CAMP_HALF, CAMP_SPAN, fishQuality } from '../world/terrain';
import { Camera } from './camera';
import { ambientTint } from './palette';
import { celestial, drawMoon, drawSun, skyColors, sunlight, type Sunlight } from './sky';
import type { BuildingSprite } from './sprites';
import {
  bakeProps,
  bakeTerrain,
  clearBuildingCache,
  clearCropCache,
  ctxOf,
  drawMillSails,
  getBuildingSprite,
  getCropSprite,
  mkCanvas,
  spriteHit,
  type PropSheet,
  type TerrainSheet,
} from './sprites';
import {
  drawActivityIcon,
  drawAnimal,
  drawAnimalTag,
  drawHiringIcon,
  drawMood,
  drawNewcomerMark,
  drawVillager,
} from './actors';

export interface RenderOptions {
  showBubbles: boolean;
  showNames: boolean;
  /** Badges over villagers saying what they are doing. */
  showActivity: boolean;
  /**
   * The two marks that ask something of the player rather than describing the
   * world: a workplace with nobody at it, and somebody nobody has met. They
   * stand down in clean view, where the point is to watch and be asked nothing,
   * and they are deliberately not tied to the activity-badge setting — turning
   * off "what everyone is doing" is not the same as turning off "this lodge is
   * standing idle".
   */
  showMarks: boolean;
  showGrid: boolean;
  selection: { kind: 'villager' | 'animal' | 'building' | 'tile' | null; id: number; x?: number; y?: number };
  hover: { x: number; y: number } | null;
  /**
   * The cursor in world pixels. Buildings fade from this rather than from the
   * tile, because in this projection a roof is drawn over the tiles *behind*
   * the building it belongs to — asking the ground what the cursor is on gets
   * the wrong answer for every pixel of art above the footprint.
   */
  hoverPx: { x: number; y: number } | null;
  /** Active build ghost, if the player is placing something. */
  ghost: { def: keyof typeof BUILDINGS; x: number; y: number; valid: boolean } | null;
  /** The campsite marker, during founding only. */
  marker: { x: number; y: number; valid: boolean } | null;
  /**
   * The working area of whatever is being placed or moved: how far its workers
   * will go, and every live node of theirs inside it. Drawn only while a
   * decision is being made, because a permanent ring round the lodge would be a
   * diagram laid over a place people live.
   */
  /**
   * The reach to draw, and what to mark inside it: a lodge marks the trees its
   * people will walk to, a mine marks the rocky ground its seam runs through,
   * and a fishing hut marks the water worth casting into.
   */
  range: {
    cx: number;
    cy: number;
    radius: number;
    prop: PropId | null;
    terrain: TerrainId | null;
    spots?: boolean;
  } | null;
  demolish: boolean;
}

/**
 * The sky, in world pixels measured off the island's north corner. The arc is
 * as wide as the island itself, so the sun crosses the kingdom rather than
 * sliding along the top of the window.
 */
const ARC_HALF_MIN = 150;
const ARC_HALF_MAX = 330;
const ARC_RISE = 155;
/**
 * How large the bodies themselves are, in art pixels. Deliberately enormous:
 * this sun is the picture out of the window rather than a marker saying where
 * the sun is, and at the old eight pixels it was a bead lost in three hundred
 * pixels of sky. Sun and moon are matched, because they are never up together
 * and a difference between them is a comparison nobody is in a position to
 * make.
 */
const SUN_R = 64;
const MOON_R = 64;
/** How deep the sky gradient runs, whatever height of it happens to be on show. */
const SKY_DEPTH = 300;
/**
 * How far the horizon's haze reaches down onto the sea. In this projection
 * screen-y *is* distance, so a fade down from the rim is the whole of
 * atmospheric perspective — there is nothing to fade at the sides or the
 * bottom, because that water is near.
 *
 * It has to run a long way. At forty-odd pixels it did not read as distance at
 * all; it read as a band, and the point it ran out drew a rule straight across
 * the picture that was plainest at dusk, when the sky above it was orange and
 * the sea below it was not.
 */
const HAZE = 170;
/**
 * How far the lighting pass takes to hand the sky's own light back to the
 * ambient tint. Deliberately shorter than the haze and deliberately its own
 * number: the haze is a colour laid on the water, this is how far the night is
 * held off it, and stretching the second to match the first leaves a lit band
 * lying across the sea at midnight.
 */
const LIGHT_FADE = 44;
const STAR_PERIOD = 1600;
const STAR_COUNT = 220;

/**
 * The repeating patch the open sea is tiled from, in world pixels. Both are
 * multiples of a tile, which is what makes the patch seamless: the isometric
 * lattice puts tile centres at (16u, 8v) for integers u and v of the same
 * parity, so it repeats exactly over any multiple of 32 by 16.
 */
const OCEAN_W = 512;
const OCEAN_H = 256;

/**
 * How much of a building is left when the cursor is on it. Enough to see what
 * is inside, behind and above it, and enough that the building is still plainly
 * standing there — a wall you can see through is the point, an outline is not.
 */
const HOVER_FADE = 0.65;
/**
 * How solid somebody asleep indoors is drawn, over the faded wall in front of
 * them. Short of full, so they read as a person glimpsed through a wall rather
 * than as a person lying on top of it.
 */
const INDOOR_ALPHA = 0.82;

interface Drawable {
  depth: number;
  order: number;
  draw: () => void;
}

interface Label {
  sx: number;
  sy: number;
  text: string;
  kind: 'bubble' | 'name';
}

interface Badge {
  sx: number;
  sy: number;
  v: Villager;
}

/** A workplace with nobody at it, waiting on the pass that draws over the dark. */
interface Hiring {
  job: JobId | undefined;
  sx: number;
  sy: number;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private display: CanvasRenderingContext2D;
  private buffer: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private light: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private ground: HTMLCanvasElement;
  private gctx: CanvasRenderingContext2D;
  /**
   * Cast shadows are collected here in solid black and laid over the world in
   * one pass. Drawing each one straight onto the world at its own alpha would
   * make every overlap darker than the shadows in it, so a stand of trees at
   * dawn turned into a black pool rather than a set of long shadows.
   */
  private shade: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;

  private terrain!: TerrainSheet;
  private props!: PropSheet;
  /** The open sea, as one seamless patch of the map's own water tiles. */
  private ocean: CanvasPattern | null = null;
  private bakedSeason: Season | null = null;
  private groundDirty = true;

  dpr = 1;
  scale = 1;
  cssW = 0;
  cssH = 0;
  bufW = 0;
  bufH = 0;
  /** World-pixel coordinate of the buffer's top-left corner. */
  viewX = 0;
  viewY = 0;

  private offX = 0;
  private offY = 0;
  private labels: Label[] = [];
  private badges: Badge[] = [];
  private hiring: Hiring[] = [];
  /** People the player has not looked at yet, marked over the dark like the rest. */
  private newcomers: { sx: number; sy: number }[] = [];
  /** Shadow shapes reused across one frame; see `streak`. */
  private stamps = new Map<string, { c: HTMLCanvasElement; ax: number; ay: number }>();
  private time = 0;
  /** 0 in full daylight, 1 at the darkest point of the night. */
  private darkness = 0;

  constructor(canvas: HTMLCanvasElement, mapW: number, mapH: number) {
    this.canvas = canvas;
    this.display = canvas.getContext('2d')!;
    this.buffer = mkCanvas(64, 64);
    this.bctx = ctxOf(this.buffer);
    this.light = mkCanvas(64, 64);
    this.lctx = this.light.getContext('2d')!;
    this.shade = mkCanvas(64, 64);
    this.sctx = ctxOf(this.shade);
    this.offX = mapH * HALF_W;
    this.offY = HALF_H;
    this.ground = mkCanvas((mapW + mapH) * HALF_W, (mapW + mapH) * HALF_H);
    this.gctx = ctxOf(this.ground);
    this.resize();
  }

  /** Season change or a terrain edit; the ground layer is rebuilt next frame. */
  invalidateGround(): void {
    this.groundDirty = true;
  }

  setSeason(season: Season): void {
    if (this.bakedSeason === season) return;
    this.bakedSeason = season;
    this.terrain = bakeTerrain(season);
    this.props = bakeProps(season);
    this.bakeOcean();
    clearBuildingCache();
    clearCropCache();
    this.groundDirty = true;
  }

  resize(zoom = 1): void {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    // Integer scale keeps every art pixel a perfect square on screen.
    const scale = Math.max(1, Math.round(zoom * dpr));
    const backingW = Math.round(cssW * dpr);
    const backingH = Math.round(cssH * dpr);
    const bufW = Math.ceil(backingW / scale);
    const bufH = Math.ceil(backingH / scale);

    if (this.canvas.width !== backingW || this.canvas.height !== backingH) {
      this.canvas.width = backingW;
      this.canvas.height = backingH;
    }
    if (this.buffer.width !== bufW || this.buffer.height !== bufH) {
      this.buffer.width = bufW;
      this.buffer.height = bufH;
      this.light.width = bufW;
      this.light.height = bufH;
      this.shade.width = bufW;
      this.shade.height = bufH;
      this.bctx = ctxOf(this.buffer);
      this.lctx = this.light.getContext('2d')!;
      this.sctx = ctxOf(this.shade);
    }
    this.dpr = dpr;
    this.scale = scale;
    this.cssW = cssW;
    this.cssH = cssH;
    this.bufW = bufW;
    this.bufH = bufH;
    this.display.imageSmoothingEnabled = false;
  }

  /** CSS pixel position → fractional grid coordinates. */
  screenToGrid(cssX: number, cssY: number): { x: number; y: number } {
    const wx = this.viewX + (cssX * this.dpr) / this.scale;
    const wy = this.viewY + (cssY * this.dpr) / this.scale;
    return { x: toGridX(wx, wy), y: toGridY(wx, wy) };
  }

  /** Fractional grid coordinates → CSS pixel position. */
  gridToScreen(gx: number, gy: number): { x: number; y: number } {
    const wx = toScreenX(gx, gy);
    const wy = toScreenY(gx, gy);
    return {
      x: ((wx - this.viewX) * this.scale) / this.dpr,
      y: ((wy - this.viewY) * this.scale) / this.dpr,
    };
  }

  render(g: GameState, cam: Camera, opts: RenderOptions, realDt: number): void {
    this.time += realDt;
    this.setSeason(g.season);
    this.resize(cam.zoom);
    if (this.groundDirty) this.bakeGround(g);

    const b = this.bctx;
    // How far north the camera may look is a share of the view's own height,
    // and only the renderer knows what that is.
    cam.viewH = this.bufH;
    this.viewX = Math.floor(cam.x - this.bufW / 2);
    this.viewY = Math.floor(cam.y - this.bufH / 2);
    const tint = ambientTint(g.dayT, g.season);
    this.darkness = 1 - Math.min(1, (tint.r + tint.g + tint.b) / 700);

    // Open sea, in every direction and out past whatever the window can show.
    this.drawSea();
    this.drawSky(g);

    b.drawImage(
      this.ground,
      this.viewX + this.offX,
      this.viewY + this.offY,
      this.bufW,
      this.bufH,
      0,
      0,
      this.bufW,
      this.bufH,
    );

    this.drawShadows(g);

    this.labels.length = 0;
    this.badges.length = 0;
    this.hiring.length = 0;
    this.newcomers.length = 0;
    this.drawWorld(g, opts);
    // Over the world and under the tools: what is being placed has to stay
    // readable even at the far rim, where the haze is at its strongest.
    this.drawHaze(g);
    this.drawPlacement(g, opts);
    this.applyLighting(g);
    this.drawBadges(g);
    this.drawAttention();
    this.drawWeather(g);

    // Blit the world buffer, upscaled with hard pixel edges.
    this.display.imageSmoothingEnabled = false;
    this.display.setTransform(1, 0, 0, 1, 0, 0);
    this.display.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.display.drawImage(
      this.buffer,
      0,
      0,
      this.bufW,
      this.bufH,
      0,
      0,
      this.bufW * this.scale,
      this.bufH * this.scale,
    );

    this.drawLabels(opts);
  }

  // -------------------------------------------------------------------------
  // Ground
  // -------------------------------------------------------------------------

  /**
   * The sea beyond the island's edge, baked from the very same water tiles the
   * map is made of.
   *
   * It used to be one flat fill in a colour of its own, and that single line
   * was why the island read as a diamond cut out of a slab rather than as land
   * in a sea: the map's outer ring is textured water that catches the light,
   * and the void past it was neither, so the map's boundary was the most
   * obvious shape on the screen — worst at night, where the two were furthest
   * apart. Tiling the real thing means there is no boundary left to see.
   *
   * Only the fundamental patch is drawn; a diamond that hangs off one edge is
   * drawn again on the opposite side, so the patch wraps rather than seaming.
   * The variant is hashed off the lattice coordinates, so the sea does repeat
   * — every 512 pixels, which is a long way for three specks of light.
   */
  private bakeOcean(): void {
    const variants = this.terrain.water;
    const c = mkCanvas(OCEAN_W, OCEAN_H);
    const ctx = ctxOf(c);
    for (let v = 0; v < OCEAN_H / HALF_H; v++)
      for (let u = 0; u < OCEAN_W / HALF_W; u++) {
        // Tile centres are the lattice points where u and v share a parity.
        if ((u + v) % 2 !== 0) continue;
        const sprite = variants[Math.floor(hash2(u, v, 5) * variants.length) % variants.length];
        const x = u * HALF_W - HALF_W;
        const y = v * HALF_H - HALF_H;
        for (let wy = -1; wy <= 1; wy++)
          for (let wx = -1; wx <= 1; wx++) {
            const px = x + wx * OCEAN_W;
            const py = y + wy * OCEAN_H;
            if (px >= OCEAN_W || px + TILE_W <= 0 || py >= OCEAN_H || py + TILE_H <= 0) continue;
            ctx.drawImage(sprite, px, py);
          }
      }
    this.ocean = ctx.createPattern(c, 'repeat');
  }

  /**
   * Water everywhere, aligned to the world rather than to the window, so the
   * map's own edge tiles carry straight on into it and panning slides the sea
   * along with the island instead of leaving it stuck on glass. The sky paints
   * over its own share of this immediately afterwards.
   */
  private drawSea(): void {
    const b = this.bctx;
    if (!this.ocean) return;
    // `viewX`/`viewY` are whole pixels, so the lattice never lands off-grid.
    const dx = ((this.viewX % OCEAN_W) + OCEAN_W) % OCEAN_W;
    const dy = ((this.viewY % OCEAN_H) + OCEAN_H) % OCEAN_H;
    b.save();
    b.translate(-dx, -dy);
    b.fillStyle = this.ocean;
    b.fillRect(0, 0, this.bufW + dx, this.bufH + dy);
    b.restore();
  }

  private bakeGround(g: GameState): void {
    const ctx = this.gctx;
    ctx.clearRect(0, 0, this.ground.width, this.ground.height);
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const t = g.tiles[y * g.w + x];
        const variants = this.terrain[t.terrain];
        const v = variants[Math.floor(hash2(x, y, 5) * variants.length) % variants.length];
        ctx.drawImage(
          v,
          Math.round(toScreenX(x, y) + this.offX - HALF_W),
          Math.round(toScreenY(x, y) + this.offY - HALF_H),
        );
      }
    }
    this.groundDirty = false;
  }

  // -------------------------------------------------------------------------
  // Sky
  // -------------------------------------------------------------------------

  /**
   * The buffer row the horizon sits on. World y 0 is the island's north corner,
   * so everything above it is off the map entirely and can honestly be called
   * sky; everything below it is sea or ground and draws over the sky in the
   * ordinary way. Pan south and the island fills the screen and the sky goes,
   * which is what looking down at your feet does. That is why the shadows
   * exist: they are the same reading, and they are on every tile.
   */
  private horizonY(): number {
    return -this.viewY;
  }

  /**
   * Where the sun or moon is, in buffer pixels, or null when there is no sky on
   * screen to put it in. The arc spans the island's own width and rises well
   * above its far corner, so the body genuinely hangs over the kingdom rather
   * than being pinned to the edge of the view.
   */
  skyBody(g: GameState): { x: number; y: number; r: number; body: 'sun' | 'moon'; alt: number } | null {
    const hy = this.horizonY();
    if (hy <= 0) return null;
    const c = celestial(g.dayT, g.day);
    /*
     * The arc is as wide as the view can take, within limits. A fixed span in
     * world pixels reads well on a desktop and puts the sun off the side of the
     * screen for most of the day on a phone, where the same zoom covers a
     * quarter of the ground.
     */
    const half = clamp(this.bufW * 0.42, ARC_HALF_MIN, ARC_HALF_MAX);
    return {
      x: c.az * half - this.viewX,
      y: hy - c.alt * ARC_RISE,
      r: c.body === 'sun' ? SUN_R : MOON_R,
      body: c.body,
      alt: c.alt,
    };
  }

  /** The same, in CSS pixels, for anything that has to hit-test a pointer. */
  skyBodyOnScreen(g: GameState): { x: number; y: number; r: number; body: 'sun' | 'moon' } | null {
    const pos = this.skyBody(g);
    if (!pos) return null;
    const k = this.scale / this.dpr;
    return { x: pos.x * k, y: pos.y * k, r: (pos.r + 4) * k, body: pos.body };
  }

  private drawSky(g: GameState): void {
    const hy = this.horizonY();
    if (hy <= 0) return;
    const bottom = Math.min(hy, this.bufH);
    const b = this.bctx;
    const sky = skyColors(g.dayT, g.season);

    // Nailed to the horizon rather than to the top of the screen: how much sky
    // is on show depends on where the camera is, but the gradient through it
    // must not stretch and squash as that changes.
    const grad = b.createLinearGradient(0, hy - SKY_DEPTH, 0, hy);
    grad.addColorStop(0, sky.zenith);
    grad.addColorStop(1, sky.horizon);
    b.fillStyle = grad;
    b.fillRect(0, 0, this.bufW, bottom);

    if (sky.stars > 0.02) this.drawStars(bottom, hy, sky.stars);
    this.drawCelestial(g, hy, bottom);
  }

  /**
   * Distance, laid over everything at the far end of it.
   *
   * Without this the sea ends in a hard rule under a bright sky and reads as a
   * wall rather than as an horizon. The falloff is curved rather than straight:
   * a linear one puts most of its change in the middle of the run, which is
   * where a band shows, instead of at the rim, which is where distance is.
   *
   * It has to go on *after* the ground and everything standing on it, not
   * before. The island's northern tiles are water like the sea around them, so
   * hazing the open sea and not them drew the map's own boundary back in as a
   * dark wedge above the beach — the exact seam the tiled sea was there to
   * remove. In this projection screen-y is distance and the island's far corner
   * is as distant as the water beside it, so it gets the same wash.
   */
  private drawHaze(g: GameState): void {
    const hy = this.horizonY();
    if (hy <= 0 || hy >= this.bufH) return;
    const b = this.bctx;
    const [r, gr, bl] = skyColors(g.dayT, g.season).horizonRgb;
    /*
     * Starting a little above the rim rather than exactly on it. The island's
     * northernmost tile straddles world y 0, so its top half is drawn against
     * the sky and stood out as a hard dark wedge above an otherwise hazy
     * horizon — a far-off islet that is really this island's own corner. Those
     * few rows of sky cost nothing to cover, since the haze is the sky's own
     * horizon colour and laying it over itself changes nothing.
     */
    const top = hy - 10;
    const haze = b.createLinearGradient(0, top, 0, top + HAZE);
    // Very nearly opaque at the rim, so the first row of sea is the sky's own
    // colour and there is no step to see at all where the two meet.
    for (const [at, a] of [
      [0, 0.94],
      [0.1, 0.62],
      [0.22, 0.42],
      [0.42, 0.21],
      [0.7, 0.06],
      [1, 0],
    ] as const)
      haze.addColorStop(at, `rgba(${r},${gr},${bl},${a})`);
    b.fillStyle = haze;
    b.fillRect(0, top, this.bufW, Math.min(HAZE, this.bufH - top));
  }

  private drawStars(bottom: number, hy: number, amount: number): void {
    const b = this.bctx;
    // The field is anchored to the world and repeats, so panning slides the
    // stars along with everything else instead of leaving them stuck on glass.
    const drift = ((this.viewX % STAR_PERIOD) + STAR_PERIOD) % STAR_PERIOD;
    for (let i = 0; i < STAR_COUNT; i++) {
      const y = Math.round(-8 - hash2(i, 7, 812) * 430 - this.viewY);
      if (y < 0 || y >= bottom) continue;
      // Haze eats the ones near the rim, which is what stops the starfield
      // ending in a hard line along the top of the sea.
      const fade = clamp((hy - y) / 46, 0, 1);
      if (fade <= 0.02) continue;
      const twinkle = 0.6 + 0.4 * Math.sin(this.time * 1.4 + i * 2.3);
      b.fillStyle = `rgba(238,243,255,${(0.2 + 0.55 * hash2(i, 11, 813)) * amount * fade * twinkle})`;
      for (let x = hash2(i, 3, 811) * STAR_PERIOD - drift; x < this.bufW; x += STAR_PERIOD) {
        if (x >= -1) b.fillRect(Math.round(x), y, 1, 1);
      }
    }
  }

  private drawCelestial(g: GameState, hy: number, bottom: number): void {
    const pos = this.skyBody(g);
    if (!pos) return;
    const { x, y, r } = pos;
    if (x < -r - 4 || x > this.bufW + r + 4 || y - r > bottom) return;
    const b = this.bctx;

    if (pos.body === 'sun') {
      drawSun(b, x, y, r, pos.alt);
      // A glimmer laid down the water under a low sun. Only the sea gets it:
      // the ground is blitted after this and covers its own share.
      const low = 1 - pos.alt;
      if (low > 0.45) this.drawGlimmer(x, hy, (low - 0.45) / 0.55);
    } else {
      drawMoon(b, x, y, r, celestial(g.dayT, g.day).phase);
    }
  }

  /**
   * The sun's road down the water, broadening and breaking up as it comes in.
   * It runs the length of the haze rather than a fixed sixty-odd pixels, and is
   * laid on rather more strongly than it used to be, because the haze now goes
   * over the top of it: at the old weight the whole road was washed out at
   * exactly the hour there is a road to see.
   */
  private drawGlimmer(x: number, hy: number, amount: number): void {
    const b = this.bctx;
    const top = Math.max(0, hy);
    const run = HAZE * 0.7;
    for (let i = 0; i < run; i++) {
      const y = top + i;
      if (y >= this.bufH) break;
      const k = i / run;
      const w = 2 + k * 46;
      const wob = Math.sin(this.time * 1.1 + i * 0.9) * (1 + k * 3);
      const shimmer = 0.62 + 0.38 * Math.sin(this.time * 2 + i * 1.7);
      b.fillStyle = `rgba(255,214,150,${0.4 * amount * (1 - k) * shimmer})`;
      b.fillRect(Math.round(x - w / 2 + wob), y, Math.round(w), 1);
    }
  }

  // -------------------------------------------------------------------------
  // Cast shadows
  //
  // The always-on half of the clock. The sky is only on screen when the camera
  // is looking somewhere it can be seen, but every tree, roof and villager
  // leans a shadow the same way at the same moment, so the hour is legible from
  // the ground at any zoom without a single number being drawn over the map.
  // -------------------------------------------------------------------------

  private drawShadows(g: GameState): void {
    const sun = sunlight(g.dayT, g.day, g.weather);
    if (sun.alpha < 0.012) return;

    const s = this.sctx;
    s.clearRect(0, 0, this.bufW, this.bufH);
    // The shape depends on where the body is, so the stamps last one frame.
    this.stamps.clear();

    const { minX, maxX, minY, maxY } = this.visibleTiles(g);

    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const t = g.tiles[y * g.w + x];
        if (!t.prop) continue;
        const sprites = this.props[t.prop];
        const sp = sprites[t.variant % sprites.length];
        // How far the sprite stands above the tile it is on. Flowers, pebbles
        // and lilypads barely do, and a shadow off them is a smudge.
        const h = Math.max(0, -sp.oy);
        if (h < 7) continue;
        this.stamp(sun, sp.canvas.width * 0.34, h, toScreenX(x, y), toScreenY(x, y));
      }

    for (const bd of g.buildings) {
      const def = BUILDINGS[bd.def];
      if (bd.x + def.w < minX - 4 || bd.x > maxX + 4 || bd.y + def.h < minY - 4 || bd.y > maxY + 4) continue;
      const sprite = getBuildingSprite(bd.def, def.w, def.h, bd.level, g.season, bd.seed, bd.stage === 'done' ? 'done' : 'site');
      // A site is a frame and a stack of materials, not a building yet.
      const h = Math.max(4, bd.stage === 'done' ? sprite.rise : sprite.rise * 0.4);
      this.buildingShadow(sun, bd, def.w, def.h, h);
    }

    for (const v of g.villagers) {
      if (v.x < minX - 3 || v.x > maxX + 3 || v.y < minY - 3 || v.y > maxY + 3) continue;
      // Somebody asleep in a cabin casts nothing: they are indoors, and a
      // shadow lying on the grass beside the door is the giveaway.
      if (sleepingIndoors(g, v)) continue;
      this.stamp(sun, 4, 13, toScreenX(v.x, v.y), toScreenY(v.x, v.y));
    }
    for (const a of g.animals) {
      if (a.x < minX - 3 || a.x > maxX + 3 || a.y < minY - 3 || a.y > maxY + 3) continue;
      this.stamp(sun, 4, 7, toScreenX(a.x, a.y), toScreenY(a.x, a.y));
    }

    const b = this.bctx;
    b.save();
    b.globalAlpha = sun.alpha;
    b.drawImage(this.shade, 0, 0);
    b.restore();
  }

  /**
   * How far along the ground a shadow reaches, in buffer pixels, for something
   * `h` pixels tall. The ground is a plane in the projection, so the reach is
   * measured in tiles first and then projected — which is what makes a shadow
   * lie flat on the grid instead of sliding about over it.
   */
  private reachOf(sun: Sunlight, h: number): { dx: number; dy: number } {
    const tiles = (h / TILE_H) * sun.reach;
    return { dx: sun.lean * HALF_W * tiles, dy: HALF_H * tiles };
  }

  private stamp(sun: Sunlight, w: number, h: number, wx: number, wy: number): void {
    const bx = wx - this.viewX;
    const by = wy - this.viewY;
    const { dx, dy } = this.reachOf(sun, h);
    if (bx + Math.min(0, dx) > this.bufW + 8 || bx + Math.max(0, dx) < -8) return;
    if (by > this.bufH + 8 || by + dy < -8) return;
    const st = this.streak(Math.max(3, Math.round(w)), Math.round(h), dx, dy);
    this.sctx.drawImage(st.c, Math.round(bx) - st.ax, Math.round(by) - st.ay);
  }

  /**
   * One shadow shape, drawn once and stamped wherever it is wanted. Every tree
   * on the island casts the same shape at the same moment and only the position
   * differs, so building it per tree was several thousand scanline fills a
   * frame to draw the same picture four hundred times.
   */
  private streak(w: number, h: number, dx: number, dy: number): { c: HTMLCanvasElement; ax: number; ay: number } {
    const key = `${w}|${h}`;
    const had = this.stamps.get(key);
    if (had) return had;
    const pad = 3;
    const cw = Math.ceil(Math.abs(dx) + w + pad * 2);
    const ch = Math.ceil(dy + w * 0.6 + pad * 2);
    const ax = Math.round(dx < 0 ? cw - pad - w / 2 : pad + w / 2);
    const ay = pad + Math.round(w * 0.3);
    const c = mkCanvas(Math.max(1, cw), Math.max(1, ch));
    const ctx = ctxOf(c);
    ctx.fillStyle = '#000';
    // Wide where it leaves the object and narrow at the tip: a shadow is a
    // silhouette flattened onto the ground, not a stripe of paint.
    fillPoly(ctx, [
      { x: ax - w / 2, y: ay },
      { x: ax + w / 2, y: ay },
      { x: ax + dx + w * 0.24, y: ay + dy },
      { x: ax + dx - w * 0.24, y: ay + dy },
    ]);
    // A foot under the object itself, squashed the way the ground plane is, so
    // the streak does not begin out of nothing.
    fillEllipse(ctx, ax, ay, w / 2, w / 4);
    const st = { c, ax, ay };
    this.stamps.set(key, st);
    return st;
  }

  /**
   * A building's shadow is its footprint swept along the reach — the outline of
   * a box lying over the grid rather than a streak, because at this size a
   * roofline is a shape the eye recognises.
   */
  private buildingShadow(sun: Sunlight, bd: Building, w: number, h: number, rise: number): void {
    const { dx, dy } = this.reachOf(sun, rise);
    const base = [
      { x: toScreenX(bd.x, bd.y) - this.viewX, y: toScreenY(bd.x, bd.y) - HALF_H - this.viewY },
      { x: toScreenX(bd.x + w - 1, bd.y) + HALF_W - this.viewX, y: toScreenY(bd.x + w - 1, bd.y) - this.viewY },
      { x: toScreenX(bd.x + w - 1, bd.y + h - 1) - this.viewX, y: toScreenY(bd.x + w - 1, bd.y + h - 1) + HALF_H - this.viewY },
      { x: toScreenX(bd.x, bd.y + h - 1) - HALF_W - this.viewX, y: toScreenY(bd.x, bd.y + h - 1) - this.viewY },
    ];
    const pts = base.concat(base.map((p) => ({ x: p.x + dx, y: p.y + dy })));
    this.sctx.fillStyle = '#000';
    fillPoly(this.sctx, convexHull(pts));
  }

  // -------------------------------------------------------------------------
  // World pass
  // -------------------------------------------------------------------------

  /** Visible tile window, with generous margins for tall sprites. */
  private visibleTiles(g: GameState): { minX: number; maxX: number; minY: number; maxY: number } {
    const corners = [
      this.gridAt(0, 0),
      this.gridAt(this.bufW, 0),
      this.gridAt(0, this.bufH),
      this.gridAt(this.bufW, this.bufH),
    ];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
    return {
      minX: clamp(Math.floor(minX) - 4, 0, g.w - 1),
      maxX: clamp(Math.ceil(maxX) + 4, 0, g.w - 1),
      minY: clamp(Math.floor(minY) - 4, 0, g.h - 1),
      maxY: clamp(Math.ceil(maxY) + 6, 0, g.h - 1),
    };
  }

  private drawWorld(g: GameState, opts: RenderOptions): void {
    const b = this.bctx;
    const list: Drawable[] = [];

    const { minX, maxX, minY, maxY } = this.visibleTiles(g);

    const sel = opts.selection;

    /**
     * Anybody asleep in a cabin is inside it, so they are left out of the world
     * altogether and put back only through the walls of whatever the cursor is
     * on. Collected up front because the building's own draw is what shows
     * them, and that happens before the villager pass would have reached them.
     */
    const indoors = new Map<number, Villager[]>();
    for (const v of g.villagers) {
      const home = sleepingIndoors(g, v);
      if (!home) continue;
      const beds = indoors.get(home.id);
      if (beds) beds.push(v);
      else indoors.set(home.id, [v]);
    }

    /*
     * What the cursor is on, for the fade. Two rules, and a building matching
     * either one fades — so several may fade at once, which is the honest
     * answer when a roof overlaps the one behind it and the cursor is on both.
     *
     *   the art  — any painted pixel of a building's sprite (`spriteHit`)
     *   the ground — the footprint tile under the cursor, as clicking uses
     *
     * The second is kept because clicking still goes by the tile: point at a
     * roof and the click lands on whatever is behind it, so the building that
     * click would select has to be one of the ones that go translucent.
     */
    const hoverTile =
      opts.hover && opts.hover.x >= 0 && opts.hover.x < g.w && opts.hover.y >= 0 && opts.hover.y < g.h
        ? g.tiles[opts.hover.y * g.w + opts.hover.x]
        : null;
    const groundId = hoverTile?.building ?? 0;
    const hx = opts.hoverPx ? opts.hoverPx.x - this.viewX : null;
    const hy = opts.hoverPx ? opts.hoverPx.y - this.viewY : 0;

    // Props.
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = g.tiles[y * g.w + x];
        if (!t.prop) continue;
        const sprites = this.props[t.prop];
        const s = sprites[t.variant % sprites.length];
        const wx = toScreenX(x, y) + s.ox;
        const wy = toScreenY(x, y) + s.oy;
        // Depleted trees fade toward a stump rather than popping.
        list.push({
          depth: x + y,
          order: 0,
          draw: () => b.drawImage(s.canvas, Math.round(wx - this.viewX), Math.round(wy - this.viewY)),
        });
      }
    }

    // Farm plots.
    for (const bd of g.buildings) {
      if (bd.stage !== 'done' || bd.plots.length === 0) continue;
      for (const p of bd.plots) {
        if (p.x < minX - 2 || p.x > maxX + 2 || p.y < minY - 2 || p.y > maxY + 2) continue;
        const stage = p.state === 'empty' ? 0 : p.state === 'ripe' ? 4 : 1 + Math.floor(p.growth * 2.99);
        const sprite = getCropSprite(stage, g.season);
        const wx = toScreenX(p.x, p.y) - HALF_W;
        const wy = toScreenY(p.x, p.y) + HALF_H - sprite.height;
        list.push({
          depth: p.x + p.y,
          order: -1,
          draw: () => b.drawImage(sprite, Math.round(wx - this.viewX), Math.round(wy - this.viewY)),
        });
      }
    }

    // Buildings and construction sites.
    for (const bd of g.buildings) {
      const def = BUILDINGS[bd.def];
      if (bd.x + def.w < minX - 3 || bd.x > maxX + 3 || bd.y + def.h < minY - 3 || bd.y > maxY + 3) continue;
      const stage = bd.stage === 'done' ? 'done' : 'site';
      const sprite = getBuildingSprite(bd.def, def.w, def.h, bd.level, g.season, bd.seed, stage);
      const leftX = toScreenX(bd.x, bd.y + def.h - 1) - HALF_W - sprite.padX;
      const topY = toScreenY(bd.x, bd.y) - HALF_H;
      const dx = Math.round(leftX - this.viewX);
      const dy = Math.round(topY - sprite.rise - this.viewY);
      // Farms show their barn in the back corner, so they sort from there — and
      // so does the commons, which is a yard people stand about *inside*. Both
      // would otherwise draw over anybody in the middle of them.
      const openPlan = def.plots || bd.def === 'commons';
      const depth = openPlan ? bd.x + bd.y : bd.x + def.w - 1 + (bd.y + def.h - 1);
      const isSelected = sel.kind === 'building' && sel.id === bd.id;
      const faded =
        bd.id === groundId || (hx !== null && spriteHit(sprite, Math.floor(hx) - dx, Math.floor(hy) - dy));
      const asleep = indoors.get(bd.id) ?? [];

      list.push({
        depth: depth - 0.01,
        order: 0,
        draw: () => {
          if (faded) {
            b.save();
            b.globalAlpha = HOVER_FADE;
          }
          b.drawImage(sprite.canvas, dx, dy);
          this.drawLitWindows(bd, sprite, dx, dy, faded ? HOVER_FADE : 1);
          if (bd.def === 'mill' && bd.stage === 'done' && sprite.anchor) this.drawMillSails(bd, dx + sprite.anchor.x, dy + sprite.anchor.y);
          if (bd.stage === 'building') this.drawSiteProgress(bd, dx, dy, sprite.canvas.width, sprite.canvas.height);
          if (faded) b.restore();
          // Whoever is asleep in there, over the faded wall rather than under
          // it. Under it was the first attempt and it was the prettier idea —
          // people showing *through* the wall — but a wall at two thirds leaves
          // a third of a villager, which at this size is nothing at all. Ghosted
          // on top reads as seeing into the house; drawn solid it would read as
          // somebody asleep on the roof.
          if (faded && asleep.length > 0) this.drawIndoors(bd, def, asleep);
          // The outline is the answer to "which one is selected" and is no use
          // faded, so it goes on at full strength whatever the cursor is doing.
          if (isSelected) this.outlineFootprint(bd.x, bd.y, def.w, def.h, '#ffd77a');
          // Collected rather than drawn: it goes on after the lighting, so a
          // lodge nobody is working stays legible through the evening.
          if (opts.showMarks && wantsWorker(bd)) {
            this.hiring.push({ job: def.job, sx: dx + sprite.canvas.width / 2, sy: dy - 3 });
          }
        },
      });
    }

    // Fish breaking the surface. In the sorted pass like everything else, so a
    // ring on the far side of the lake goes behind the reeds in front of it —
    // anything drawn outside this pass lands on top of the whole world.
    for (const s of g.splashes) {
      if (s.x < minX - 2 || s.x > maxX + 2 || s.y < minY - 2 || s.y > maxY + 2) continue;
      const sx = Math.round(toScreenX(s.x, s.y) - this.viewX);
      const sy = Math.round(toScreenY(s.x, s.y) - this.viewY);
      list.push({ depth: s.x + s.y, order: 0, draw: () => this.drawSplash(s, sx, sy) });
    }

    // Animals.
    for (const a of g.animals) {
      if (a.x < minX - 3 || a.x > maxX + 3 || a.y < minY - 3 || a.y > maxY + 3) continue;
      const wx = toScreenX(a.x, a.y);
      const wy = toScreenY(a.x, a.y);
      const selected = sel.kind === 'animal' && sel.id === a.id;
      list.push({
        depth: a.x + a.y,
        order: 1,
        draw: () => {
          drawAnimal(b, a, wx - this.viewX, wy - this.viewY, selected);
          drawAnimalTag(b, a, wx - this.viewX, wy - this.viewY);
        },
      });
    }

    // Villagers.
    for (const v of g.villagers) {
      if (v.x < minX - 3 || v.x > maxX + 3 || v.y < minY - 3 || v.y > maxY + 3) continue;
      // Indoors: no figure, no name, no badge over the doorstep. The lit
      // windows are what say the cabin has somebody in it.
      if (sleepingIndoors(g, v)) continue;
      const wx = toScreenX(v.x, v.y);
      const wy = toScreenY(v.x, v.y);
      const selected = sel.kind === 'villager' && sel.id === v.id;
      const sx = wx - this.viewX;
      const sy = wy - this.viewY;
      list.push({
        depth: v.x + v.y,
        order: 2,
        draw: () => {
          drawVillager(b, v, sx, sy, selected, v.favorite);
          drawMood(b, g, v, sx, sy);
        },
      });
      if (opts.showBubbles && v.say) this.labels.push({ sx, sy: sy - 26, text: v.say.text, kind: 'bubble' });
      // A badge under a speech bubble is just clutter, so the bubble wins.
      else if (opts.showActivity) this.badges.push({ sx, sy, v });
      // Not part of that choice: somebody new is worth pointing out whether or
      // not they happen to be saying something, and it is drawn after the
      // lighting for the same reason the badges are.
      if (opts.showMarks && !v.met) this.newcomers.push({ sx, sy });
      if (opts.showNames && (selected || v.favorite)) {
        this.labels.push({ sx, sy: sy + 6, text: v.name, kind: 'name' });
      }
    }

    list.sort((p, q) => p.depth - q.depth || p.order - q.order);
    for (const d of list) d.draw();

    // A selected tile stays outlined so you can see what the panel is describing.
    if (sel.kind === 'tile' && sel.x !== undefined && sel.y !== undefined) {
      this.outlineFootprint(sel.x, sel.y, 1, 1, '#ffd77a');
    }

    if (opts.showGrid) this.drawGrid(g, minX, maxX, minY, maxY);
    if (opts.hover && !opts.ghost && !opts.marker) {
      this.outlineFootprint(opts.hover.x, opts.hover.y, 1, 1, opts.demolish ? '#ff9a7a' : 'rgba(255,255,255,0.5)');
    }
  }

  private gridAt(bufX: number, bufY: number): { x: number; y: number } {
    const wx = this.viewX + bufX;
    const wy = this.viewY + bufY;
    return { x: toGridX(wx, wy), y: toGridY(wx, wy) };
  }

  /**
   * The people asleep inside a building the cursor is on, laid out over its
   * floor rather than where they are actually standing — which is the doorstep,
   * and putting them there would show somebody asleep on the porch, the very
   * thing going indoors was meant to stop.
   *
   * The lattice is in *tile* space and then projected, which matters more than
   * it sounds: a room seen from this angle is a diamond, so beds spread over it
   * stagger down and across the way the floor does. The first attempt spaced
   * them along the screen's x-axis instead and six people in a cottage came out
   * as one long purple slab.
   */
  private drawIndoors(bd: Building, def: BuildingDef, asleep: Villager[]): void {
    const cols = Math.max(1, Math.round(Math.sqrt(asleep.length)));
    const rows = Math.ceil(asleep.length / cols);
    const spots = asleep.map((v, i) => ({
      v,
      fx: bd.x - 0.5 + (((i % cols) + 0.5) / cols) * def.w,
      fy: bd.y - 0.5 + ((Math.floor(i / cols) + 0.5) / rows) * def.h,
    }));
    // Nearer beds over farther ones, the same sort the world pass runs on
    // everything else standing on the ground.
    spots.sort((p, q) => p.fx + p.fy - (q.fx + q.fy));

    const b = this.bctx;
    b.save();
    b.globalAlpha = INDOOR_ALPHA;
    for (const s of spots) {
      const sx = Math.round(toScreenX(s.fx, s.fy) - this.viewX);
      const sy = Math.round(toScreenY(s.fx, s.fy) - this.viewY);
      drawVillager(b, s.v, sx, sy, false, s.v.favorite);
    }
    b.restore();
  }

  /** Warm light behind the windows of a building someone is using. */
  private drawLitWindows(bd: Building, sprite: BuildingSprite, dx: number, dy: number, alpha = 1): void {
    if (this.darkness < 0.08 || bd.stage !== 'done' || sprite.windows.length === 0) return;
    // Somebody is in there. It used to include "or it is a store", for the
    // storehouse, which had neither residents nor workers and still wanted lit
    // windows; there is no such building any more.
    const occupied = bd.residents.length > 0 || bd.workers.length > 0;
    if (!occupied) return;
    const b = this.bctx;
    b.save();
    b.globalAlpha = Math.min(1, this.darkness * 1.5) * alpha;
    b.fillStyle = '#ffce7a';
    // Column by column: the panes are parallelograms in the wall, so a single
    // rectangle would light a shape the frame around it does not have.
    for (const wdw of sprite.windows)
      for (let i = 0; i < wdw.w; i++) b.fillRect(dx + wdw.x + i, dy + wdw.y + wdw.dy[i], 1, wdw.h);
    b.restore();
  }

  /**
   * A fish, or at least the evidence of one.
   *
   * Two beats. A jump is a body out of the water on a short arc, landing with a
   * plop; a plain rise is the plop on its own. Both end in rings spreading and
   * fading, which is the part that actually reads at this size — the fish
   * itself is five pixels and gone in half a second, and that is on purpose,
   * because a fish you can study is a fish you start expecting.
   */
  private drawSplash(s: { x: number; y: number; t: number; jump: boolean }, sx: number, sy: number): void {
    const b = this.bctx;
    const air = s.jump ? 0.5 : 0;
    b.save();

    if (s.jump && s.t < air) {
      // Up and down on a parabola, leaning the way it is travelling.
      const k = s.t / air;
      const lift = Math.round(Math.sin(k * Math.PI) * 9);
      const drift = Math.round((k - 0.5) * 5);
      const fx = sx + drift;
      const fy = sy - lift - 2;
      const rising = k < 0.5;
      b.fillStyle = '#5c7f92';
      b.fillRect(fx - 2, fy + (rising ? 0 : 1), 4, 2);
      b.fillStyle = '#a8cfdd';
      b.fillRect(fx - 2, fy + (rising ? 0 : 1), 3, 1);
      // A tail, on the side it has come from.
      b.fillStyle = '#5c7f92';
      b.fillRect(fx + (rising ? -3 : 2), fy + (rising ? 1 : 0), 1, 2);
    }

    // The water itself, from the moment it is hit.
    const wet = s.t - air;
    if (wet >= 0) {
      const life = 1.7 - air;
      const k = Math.min(1, wet / life);
      b.globalAlpha = (1 - k) * (s.jump ? 0.85 : 0.6);
      b.fillStyle = '#d8f0fa';
      this.ripple(sx, sy, 2 + k * (s.jump ? 9 : 6));
      if (k < 0.55) {
        b.globalAlpha = (1 - k / 0.55) * 0.7;
        this.ripple(sx, sy, 1 + k * 3);
      }
      // The first instant of a landing throws a little water up with it.
      if (s.jump && wet < 0.16) {
        b.globalAlpha = 1 - wet / 0.16;
        b.fillRect(sx - 3, sy - 3, 1, 1);
        b.fillRect(sx + 2, sy - 4, 1, 1);
        b.fillRect(sx, sy - 5, 1, 1);
      }
    }
    b.restore();
  }

  /**
   * One ring on the water. A circle on the ground is an ellipse twice as wide
   * as it is tall in this projection, and it is plotted pixel by pixel rather
   * than stroked so the edge stays as hard as everything else in the buffer.
   *
   * Walked along both axes rather than by angle. Even steps of angle bunch up
   * at the ends of an ellipse and spread out along its sides, which at the two
   * or three pixels a new ring starts at came out as a handful of dots rather
   * than a ring at all. The pixels go through a set first because these are
   * drawn at part alpha, and a pixel covered twice is visibly darker than its
   * neighbours — which would put a bright spot at each end of every ripple.
   */
  private ripple(cx: number, cy: number, r: number): void {
    const b = this.bctx;
    const ry = r * 0.5;
    const seen = new Set<number>();
    const plot = (x: number, y: number) => {
      const px = Math.round(x);
      const py = Math.round(y);
      const key = ((px & 0xffff) << 16) | (py & 0xffff);
      if (seen.has(key)) return;
      seen.add(key);
      b.fillRect(px, py, 1, 1);
    };
    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const k = 1 - (dx * dx) / (r * r);
      if (k < 0) continue;
      const dy = ry * Math.sqrt(k);
      plot(cx + dx, cy - dy);
      plot(cx + dx, cy + dy);
    }
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
      const k = 1 - (dy * dy) / (ry * ry);
      if (k < 0) continue;
      const dx = r * Math.sqrt(k);
      plot(cx - dx, cy + dy);
      plot(cx + dx, cy + dy);
    }
  }

  /** Sails turn briskly with a miller at work and barely at all without one. */
  private drawMillSails(bd: Building, cx: number, cy: number): void {
    drawMillSails(this.bctx, cx, cy, this.time * (bd.workers.length > 0 ? 1.1 : 0.18));
  }

  /** A thin bar over a site showing how far the build has got. */
  private drawSiteProgress(bd: Building, dx: number, dy: number, w: number, h: number): void {
    const b = this.bctx;
    const def = BUILDINGS[bd.def];
    const need = def.labour * (bd.upgrading ? 1.4 : 1);
    const frac = need > 0 ? clamp(bd.labour / need, 0, 1) : 0;
    const barW = Math.max(14, Math.min(w - 8, 28));
    const x = Math.round(dx + w / 2 - barW / 2);
    const y = Math.round(dy + h * 0.15);
    b.fillStyle = 'rgba(20,16,12,0.6)';
    b.fillRect(x - 1, y - 1, barW + 2, 5);
    b.fillStyle = '#4a4038';
    b.fillRect(x, y, barW, 3);
    b.fillStyle = frac >= 1 ? '#8fce85' : '#e6b35c';
    b.fillRect(x, y, Math.round(barW * frac), 3);
  }

  private outlineFootprint(x: number, y: number, w: number, h: number, color: string): void {
    const b = this.bctx;
    b.fillStyle = color;
    const pts = [
      { x: toScreenX(x, y) - this.viewX, y: toScreenY(x, y) - HALF_H - this.viewY },
      { x: toScreenX(x + w - 1, y) + HALF_W - this.viewX, y: toScreenY(x + w - 1, y) - this.viewY },
      { x: toScreenX(x + w - 1, y + h - 1) - this.viewX, y: toScreenY(x + w - 1, y + h - 1) + HALF_H - this.viewY },
      { x: toScreenX(x, y + h - 1) - HALF_W - this.viewX, y: toScreenY(x, y + h - 1) - this.viewY },
    ];
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % 4];
      const steps = Math.max(Math.abs(c.x - a.x), Math.abs(c.y - a.y));
      for (let s = 0; s <= steps; s++) {
        const k = steps === 0 ? 0 : s / steps;
        b.fillRect(Math.round(a.x + (c.x - a.x) * k), Math.round(a.y + (c.y - a.y) * k), 1, 1);
      }
    }
  }

  private fillFootprint(x: number, y: number, w: number, h: number, color: string): void {
    const b = this.bctx;
    b.fillStyle = color;
    const dw = (w + h) * HALF_W;
    const dh = (w + h) * HALF_H;
    const leftX = toScreenX(x, y + h - 1) - HALF_W - this.viewX;
    const topY = toScreenY(x, y) - HALF_H - this.viewY;
    for (let row = 0; row <= dh; row++) {
      const k = row <= dh / 2 ? row / (dh / 2) : (dh - row) / (dh / 2);
      const half = (dw / 2) * k;
      b.fillRect(Math.round(leftX + dw / 2 - half), Math.round(topY + row), Math.max(1, Math.round(half * 2)), 1);
    }
  }

  private drawGrid(g: GameState, minX: number, maxX: number, minY: number, maxY: number): void {
    const b = this.bctx;
    b.fillStyle = 'rgba(255,255,255,0.08)';
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        void g;
        const sx = toScreenX(x, y) - this.viewX;
        const sy = toScreenY(x, y) - this.viewY;
        for (let i = 0; i < HALF_W; i += 2) {
          b.fillRect(Math.round(sx - HALF_W + i), Math.round(sy - i / 2), 1, 1);
          b.fillRect(Math.round(sx + i), Math.round(sy - HALF_H + i / 2), 1, 1);
        }
      }
  }

  // -------------------------------------------------------------------------
  // Placement overlays
  // -------------------------------------------------------------------------

  private drawPlacement(g: GameState, opts: RenderOptions): void {
    // Under the ghost, so the building being sited still reads as the thing in
    // the player's hand rather than as one more mark on a busy diagram.
    if (opts.range) this.drawWorkRange(g, opts.range);
    if (opts.marker) this.drawCampMarker(opts.marker);
    if (!opts.ghost) return;
    const def = BUILDINGS[opts.ghost.def];
    const { x, y, valid } = opts.ghost;
    this.fillFootprint(x, y, def.w, def.h, valid ? 'rgba(180,240,170,0.35)' : 'rgba(255,110,90,0.4)');

    const sprite = getBuildingSprite(opts.ghost.def, def.w, def.h, 1, g.season, 0, 'done');
    const leftX = toScreenX(x, y + def.h - 1) - HALF_W - sprite.padX;
    const topY = toScreenY(x, y) - HALF_H;
    const b = this.bctx;
    b.save();
    b.globalAlpha = valid ? 0.55 : 0.3;
    b.drawImage(sprite.canvas, Math.round(leftX - this.viewX), Math.round(topY - sprite.rise - this.viewY));
    b.restore();
    this.outlineFootprint(x, y, def.w, def.h, valid ? '#b6f0a8' : '#ff8a72');
  }

  /**
   * How far a lodge or a quarry would reach from here, and what is inside it.
   *
   * The boundary is drawn rather than the area filled, and for a reason that is
   * not only speed: a thirteen-tile circle is five hundred tiles, and washing
   * five hundred tiles with colour hides the very trees the ring exists to let
   * you count. So the edge is a band of tiles, and each live node inside gets a
   * small mark of its own — the answer to "will this lodge have anything to do"
   * is a thing you can see at a glance rather than a shaded blob.
   */
  private drawWorkRange(g: GameState, range: NonNullable<RenderOptions['range']>): void {
    const { cx, cy, radius, prop, terrain, spots } = range;
    const b = this.bctx;

    /*
     * A circle in tile space is an axis-aligned ellipse on screen, exactly.
     * Writing the projection out: screen x is (tx - ty)·HALF_W and screen y is
     * (tx + ty)·HALF_H, and substituting those into the circle turns it into
     * (sx/HALF_W)² + (sy/HALF_H)² ≤ 2r². So the reach can be drawn as one
     * ellipse, column by column, instead of as five hundred separate diamonds —
     * which matters because this is redrawn every frame while the player moves
     * the cursor around deciding.
     */
    const a = radius * Math.SQRT2 * HALF_W;
    const bb = radius * Math.SQRT2 * HALF_H;
    const ox = toScreenX(cx, cy) - this.viewX;
    const oy = toScreenY(cx, cy) - this.viewY;
    const lo = Math.max(Math.ceil(-a), Math.floor(-ox));
    const hi = Math.min(Math.floor(a), Math.ceil(this.bufW - ox));

    // A wash over everything inside, then a hard band at the edge. The wash is
    // what makes the reach legible when the boundary is off the side of the
    // screen, which at the usual zoom it very often is.
    for (let dx = lo; dx <= hi; dx++) {
      const k = 1 - (dx * dx) / (a * a);
      if (k <= 0) continue;
      const half = bb * Math.sqrt(k);
      b.fillStyle = 'rgba(255,232,160,0.10)';
      b.fillRect(Math.round(ox + dx), Math.round(oy - half), 1, Math.round(half * 2));
      // The band is drawn from the same maths, so it sits exactly on the line
      // the wash ends at rather than a pixel out from it.
      const innerHalf = bb * Math.sqrt(Math.max(0, 1 - (dx * dx) / ((a - HALF_W * 1.2) ** 2)));
      const thick = Math.max(1, Math.round(half - innerHalf));
      b.fillStyle = 'rgba(255,226,140,0.5)';
      b.fillRect(Math.round(ox + dx), Math.round(oy - half), 1, thick);
      b.fillRect(Math.round(ox + dx), Math.round(oy + half - thick), 1, thick);
    }

    // And a mark on every live node inside it — the ring says how far, this
    // says whether there is anything out there worth walking to.
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(g.w - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(g.h - 1, Math.ceil(cy + radius));
    const r2 = radius * radius;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
        const t = g.tiles[y * g.w + x];
        // One kind of mark, never two — a live node, ground of the kind this
        // building works, or water worth casting into.
        const good = spots ? fishQuality(g, x, y) >= GOOD_SPOT : false;
        const marked = prop ? t.prop === prop && t.amount > 0 : terrain ? t.terrain === terrain : good;
        if (!marked) continue;
        // On the tile itself rather than on the sprite standing on it: the tree
        // is drawn later and would cover a mark placed at its crown.
        const sx = Math.round(toScreenX(x, y) - this.viewX);
        const sy = Math.round(toScreenY(x, y) - this.viewY);
        if (prop) {
          // A node is a thing you count, so it gets a mark you can pick out.
          b.fillStyle = 'rgba(30,24,16,0.55)';
          b.fillRect(sx - 2, sy - 1, 5, 3);
          b.fillStyle = '#ffe9a6';
          b.fillRect(sx - 1, sy, 3, 1);
          b.fillRect(sx, sy - 1, 1, 3);
        } else if (spots) {
          // A ring on the water rather than a pin in it. A good spot is a place
          // rather than an object, and a hard mark in the lake reads as
          // something floating there that a fisher will go and collect.
          b.fillStyle = 'rgba(20,32,40,0.45)';
          b.fillRect(sx - 2, sy, 5, 1);
          b.fillRect(sx - 1, sy - 1, 3, 1);
          b.fillRect(sx - 1, sy + 1, 3, 1);
          b.fillStyle = 'rgba(198,240,255,0.85)';
          b.fillRect(sx - 2, sy, 2, 1);
          b.fillRect(sx + 1, sy, 2, 1);
        } else {
          // Rock is measured by the acre rather than counted, and there can be
          // a hundred tiles of it inside the ring: a plus sign on every one is
          // a rash. A single quiet pip reads as texture, which is the honest
          // picture — the number in the placement bar is the precise part.
          b.fillStyle = 'rgba(20,18,16,0.4)';
          b.fillRect(sx - 1, sy, 3, 2);
          b.fillStyle = 'rgba(255,233,166,0.75)';
          b.fillRect(sx, sy, 2, 1);
        }
      }
  }

  /**
   * A stake in the ground under the cursor while the player chooses where the
   * kingdom starts, with the whole camp's ground marked out around it.
   * Deliberately not a building ghost: nothing is being placed here, a person is
   * being told where to stop walking. The cursor is the camp's *centre* — where
   * the fire ends up — so the shaded nine tiles are the only way to see how much
   * room it actually wants.
   */
  private drawCampMarker(marker: { x: number; y: number; valid: boolean }): void {
    const { x, y, valid } = marker;
    const x0 = x - CAMP_HALF;
    const y0 = y - CAMP_HALF;
    this.fillFootprint(x0, y0, CAMP_SPAN, CAMP_SPAN, valid ? 'rgba(255,225,150,0.3)' : 'rgba(255,110,90,0.35)');
    this.outlineFootprint(x0, y0, CAMP_SPAN, CAMP_SPAN, valid ? '#ffd77a' : '#ff8a72');

    const b = this.bctx;
    const sx = Math.round(toScreenX(x, y) - this.viewX);
    const sy = Math.round(toScreenY(x, y) - this.viewY);
    const post = valid ? '#a37f4e' : '#8a5f52';
    const flag = valid ? '#ffd77a' : '#ff8a72';
    b.fillStyle = post;
    b.fillRect(sx - 1, sy - 15, 2, 15);
    b.fillStyle = flag;
    b.fillRect(sx + 1, sy - 15, 6, 4);
    b.fillRect(sx + 1, sy - 11, 3, 1);
  }

  // -------------------------------------------------------------------------
  // Lighting
  // -------------------------------------------------------------------------

  private applyLighting(g: GameState): void {
    const l = this.lctx;
    const tint = ambientTint(g.dayT, g.season);
    // Weather takes the edge off the light without ever going gloomy.
    const damp = 1 - g.weather * 0.18;
    l.globalCompositeOperation = 'source-over';
    const ambient = `rgb(${Math.round(tint.r * damp)},${Math.round(tint.g * damp)},${Math.round(tint.b * damp)})`;
    l.fillStyle = ambient;
    l.fillRect(0, 0, this.bufW, this.bufH);

    /*
     * The sky is where the light comes from, so it is not something the light
     * falls on: multiplying the night tint over an already-dark sky drove it to
     * black and took the stars with it. It hands back to the ambient colour
     * over the last stretch above the horizon, which doubles as haze and keeps
     * anything tall on the map's back edge from having a seam drawn across it.
     */
    const hy = this.horizonY();
    if (hy > 0) {
      const bottom = Math.min(hy, this.bufH);
      // Reaching a little past the rim as well: the haze on the water is the
      // sky's colour, and handing it straight back to the ambient tint put the
      // hard line back in a different place.
      const mid = `rgb(${Math.round(tint.r * damp + (255 - tint.r * damp) * 0.5)},${Math.round(tint.g * damp + (255 - tint.g * damp) * 0.5)},${Math.round(tint.b * damp + (255 - tint.b * damp) * 0.5)})`;
      const fade = l.createLinearGradient(0, bottom - 24, 0, bottom + LIGHT_FADE);
      fade.addColorStop(0, '#ffffff');
      fade.addColorStop(0.36, mid);
      fade.addColorStop(1, ambient);
      l.fillStyle = fade;
      l.fillRect(0, 0, this.bufW, Math.min(this.bufH, bottom + HAZE));
    }

    const darkness = this.darkness;
    if (darkness > 0.06) {
      l.globalCompositeOperation = 'lighter';

      // A low sun burns a hole in the haze around itself, and the moon does a
      // paler version of the same. Only worth drawing after dark, which is the
      // only time the light pass is adding anything at all.
      const body = this.skyBody(g);
      if (body) {
        const r = body.body === 'sun' ? 46 : 26;
        const glow = l.createRadialGradient(body.x, body.y, 0, body.x, body.y, r);
        const c = body.body === 'sun' ? '#ffb867' : '#b9c8ff';
        glow.addColorStop(0, applyAlpha(c, (body.body === 'sun' ? 0.7 : 0.3) * darkness));
        glow.addColorStop(0.4, applyAlpha(c, (body.body === 'sun' ? 0.3 : 0.12) * darkness));
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        l.fillStyle = glow;
        l.fillRect(body.x - r, body.y - r, r * 2, r * 2);
      }

      // Every lit window throws a small pool of its own. Drawn as a soft radial
      // rather than a hard rectangle so any spill onto a building in front
      // reads as lamplight leaking, not as a misplaced sprite.
      for (const bd of g.buildings) {
        if (bd.stage !== 'done') continue;
        const def = BUILDINGS[bd.def];
        const sprite = getBuildingSprite(bd.def, def.w, def.h, bd.level, g.season, bd.seed, 'done');
        if (sprite.windows.length === 0) continue;
        if (bd.residents.length === 0 && bd.workers.length === 0) continue;
        const leftX = toScreenX(bd.x, bd.y + def.h - 1) - HALF_W - sprite.padX - this.viewX;
        const topY = toScreenY(bd.x, bd.y) - HALF_H - sprite.rise - this.viewY;
        for (const wdw of sprite.windows) {
          const sx = leftX + wdw.x + wdw.w / 2;
          const sy = topY + wdw.y + wdw.dy[wdw.w >> 1] + wdw.h / 2;
          if (sx < -16 || sy < -16 || sx > this.bufW + 16 || sy > this.bufH + 16) continue;
          const grad = l.createRadialGradient(sx, sy, 0, sx, sy, 13);
          grad.addColorStop(0, applyAlpha('#ffce7a', 1.0 * darkness));
          grad.addColorStop(0.35, applyAlpha('#ffce7a', 0.55 * darkness));
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          l.fillStyle = grad;
          l.fillRect(sx - 13, sy - 13, 26, 26);
        }
      }

      for (const bd of g.buildings) {
        if (bd.stage !== 'done') continue;
        const def = BUILDINGS[bd.def];
        if (!def.light) continue;
        for (const src of def.light) {
          const wx = toScreenX(bd.x + src.x - 0.5, bd.y + src.y - 0.5);
          const wy = toScreenY(bd.x + src.x - 0.5, bd.y + src.y - 0.5);
          const sx = wx - this.viewX;
          const sy = wy - this.viewY;
          // A building that has been improved throws a little further: a stone
          // hearth under a pavilion is not the same light as a fire in the grass.
          const r = src.radius * (1 + (bd.level - 1) * 0.1);
          if (sx < -r || sy < -r || sx > this.bufW + r || sy > this.bufH + r) continue;
          // A gentle flicker so lamplight is never perfectly still.
          const flick = 0.92 + Math.sin(this.time * 3.1 + bd.id) * 0.05 + Math.sin(this.time * 7.7 + bd.id * 2) * 0.03;
          const grad = l.createRadialGradient(sx, sy, 0, sx, sy, r * flick);
          const a = darkness * 1.15;
          grad.addColorStop(0, applyAlpha(src.color, 0.95 * a));
          grad.addColorStop(0.45, applyAlpha(src.color, 0.42 * a));
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          l.fillStyle = grad;
          l.fillRect(sx - r, sy - r, r * 2, r * 2);
        }
      }
    }

    const b = this.bctx;
    b.save();
    b.globalCompositeOperation = 'multiply';
    b.drawImage(this.light, 0, 0);
    b.restore();
  }

  // -------------------------------------------------------------------------
  // Weather
  // -------------------------------------------------------------------------

  private drawWeather(g: GameState): void {
    if (g.weather <= 0.01 || g.weatherKind === 'clear') return;
    const b = this.bctx;
    const count = Math.round(this.bufW * this.bufH * 0.0009 * g.weather);
    if (g.weatherKind === 'rain') {
      b.fillStyle = `rgba(180,205,225,${0.35 * g.weather})`;
      for (let i = 0; i < count; i++) {
        const seedX = hash2(i, 3, 91);
        const seedY = hash2(i, 7, 93);
        const x = (seedX * this.bufW + this.time * 22 + seedY * 40) % this.bufW;
        const y = (seedY * this.bufH + this.time * 150) % this.bufH;
        b.fillRect(Math.round(x), Math.round(y), 1, 4);
      }
    } else {
      b.fillStyle = `rgba(248,250,255,${0.75 * g.weather})`;
      for (let i = 0; i < count; i++) {
        const seedX = hash2(i, 3, 91);
        const seedY = hash2(i, 7, 93);
        const drift = Math.sin(this.time * 0.7 + seedX * 9) * 10;
        const x = (seedX * this.bufW + drift + this.time * 6) % this.bufW;
        const y = (seedY * this.bufH + this.time * 22) % this.bufH;
        b.fillRect(Math.round((x + this.bufW) % this.bufW), Math.round(y), 1, 1);
      }
    }
  }

  /**
   * Activity badges go in after the lighting pass. Drawn with the world they
   * would be multiplied down to nothing at night, which is exactly when you
   * most want to know who is still up and what they are doing.
   */
  private drawBadges(g: GameState): void {
    if (this.badges.length === 0) return;
    // Held back a little after dark so they stay readable without becoming the
    // brightest thing in a sleeping kingdom.
    this.bctx.globalAlpha = 1 - this.darkness * 0.3;
    for (const badge of this.badges) drawActivityIcon(this.bctx, g, badge.v, badge.sx, badge.sy);
    this.bctx.globalAlpha = 1;
  }

  /**
   * The two marks that are asking for the player rather than describing the
   * world: a workplace with nobody at it, and somebody who has just arrived and
   * not been looked at. Both go on after the lighting for the same reason the
   * activity badges do, and both breathe on one shared phase — two of them
   * pulsing out of step read as an animation, where one slow rise and fall
   * across the whole kingdom reads as the place waiting.
   */
  private drawAttention(): void {
    if (this.hiring.length === 0 && this.newcomers.length === 0) return;
    const pulse = 0.5 + Math.sin(this.time * 1.6) * 0.5;
    this.bctx.globalAlpha = 1 - this.darkness * 0.25;
    for (const h of this.hiring) drawHiringIcon(this.bctx, h.job, h.sx, h.sy, pulse);
    for (const n of this.newcomers) drawNewcomerMark(this.bctx, n.sx, n.sy, pulse);
    this.bctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------
  // Labels, drawn crisply in screen space after upscaling
  // -------------------------------------------------------------------------

  private drawLabels(opts: RenderOptions): void {
    if (this.labels.length === 0) return;
    const d = this.display;
    d.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    d.textBaseline = 'middle';
    const k = this.scale / this.dpr;

    for (const label of this.labels) {
      const x = label.sx * k;
      const y = label.sy * k;
      if (x < -80 || y < -40 || x > this.cssW + 80 || y > this.cssH + 40) continue;
      if (label.kind === 'bubble') {
        d.font = '500 11px ui-rounded, "Segoe UI", system-ui, sans-serif';
        const w = d.measureText(label.text).width + 12;
        const h = 18;
        roundRect(d, x - w / 2, y - h, w, h, 5);
        d.fillStyle = 'rgba(250,246,238,0.95)';
        d.fill();
        d.beginPath();
        d.moveTo(x - 3, y - 1);
        d.lineTo(x + 3, y - 1);
        d.lineTo(x, y + 4);
        d.closePath();
        d.fill();
        d.fillStyle = '#3c3228';
        d.textAlign = 'center';
        d.fillText(label.text, x, y - h / 2);
      } else {
        d.font = '600 10px ui-rounded, "Segoe UI", system-ui, sans-serif';
        d.textAlign = 'center';
        d.fillStyle = 'rgba(18,15,12,0.6)';
        const w = d.measureText(label.text).width + 8;
        roundRect(d, x - w / 2, y, w, 13, 4);
        d.fill();
        d.fillStyle = '#f3e7d2';
        d.fillText(label.text, x, y + 7);
      }
    }
    d.textAlign = 'left';
    d.setTransform(1, 0, 0, 1, 0, 0);
    void opts;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function applyAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(alpha, 0, 1)})`;
}

/**
 * Shadows are filled row by row rather than with an arc path, for the same
 * reason the sprites are: the buffer is one canvas pixel per art pixel, and an
 * antialiased edge there upscales into a smear.
 */
function fillEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  const n = Math.ceil(ry);
  for (let dy = -n; dy <= n; dy++) {
    const w = rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry)));
    if (w < 0.5) continue;
    ctx.fillRect(Math.round(cx - w), Math.round(cy + dy), Math.max(1, Math.round(w * 2)), 1);
  }
}

/** Scanline fill of a convex polygon, in the current fill colour. */
function fillPoly(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const cy = y + 0.5;
    let xa = Infinity;
    let xb = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a.y <= cy === b.y <= cy) continue;
      const x = a.x + ((b.x - a.x) * (cy - a.y)) / (b.y - a.y);
      xa = Math.min(xa, x);
      xb = Math.max(xb, x);
    }
    if (xb > xa) ctx.fillRect(Math.round(xa), y, Math.max(1, Math.round(xb - xa)), 1);
  }
}

/** Monotone chain. The points come in as two overlapping quads, not an outline. */
function convexHull(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (src: { x: number; y: number }[]): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return half(p).concat(half(p.slice().reverse()));
}

