/**
 * Little pixel likenesses for the interface, drawn with the same code that
 * draws the map — so the face beside a name in a list is recognisably the same
 * person walking about outside, hat, shirt and all.
 *
 * These paint into <canvas> nodes the panel has already put in the document,
 * rather than baking data URLs. The building panel rewrites its own markup a
 * few times a second, and a fresh <img src="data:…"> on every one of those is a
 * chance to catch the image mid-decode; drawing into the canvas happens in the
 * same task as the insertion, so nothing is ever painted blank.
 */

import type { ActivityKind, Building, BuildingId, Season, Villager } from '../types';
import { BUILD_ORDER } from '../sim/defs';
import { BUILDINGS } from '../sim/defs';
import { drawVillager } from '../render/actors';
import { bakeProps, drawMillSails, getBuildingSprite, getCropSprite } from '../render/sprites';

/**
 * The whole figure rather than a face: at sixteen pixels tall the shirt and
 * trousers carry as much of a person's identity as the head does, and drawing
 * them the way they appear on the map is the entire point of doing this.
 *
 * The numbers come straight from the pose in `drawVillager` — feet at y, torso
 * from y-10, head from y-15, a tall hat reaching y-18, arms out to x±4.
 */
const FACE_W = 11;
const FACE_H = 19;
const FACE_FEET = 18;
/** CSS pixels per art pixel. Whole numbers only, or the art goes soft. */
const FACE_ZOOM = 2;

/** Backing pixels per art pixel, kept whole so the art stays hard-edged. */
function pixelScale(zoom: number): number {
  return Math.max(1, Math.round(zoom * (window.devicePixelRatio || 1)));
}

/** Sizes a canvas for `w`×`h` art pixels shown at `zoom`, and returns its context. */
function prepare(canvas: HTMLCanvasElement, w: number, h: number, zoom: number): CanvasRenderingContext2D {
  const scale = pixelScale(zoom);
  canvas.width = w * scale;
  canvas.height = h * scale;
  canvas.style.width = `${w * zoom}px`;
  canvas.style.height = `${h * zoom}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return ctx;
}

export function paintVillager(canvas: HTMLCanvasElement, v: Villager): void {
  const ctx = prepare(canvas, FACE_W, FACE_H, FACE_ZOOM);
  /*
   * A still, empty-handed, south-east facing pose. Not the villager's live
   * state: the walk cycle would make a list of faces twitch on every redraw,
   * and someone asleep is drawn as a bedroll, which is no use as a portrait.
   */
  const still: Villager = { ...v, activity: 'idle', carrying: null, phase: 0, face: 0 };
  drawVillager(ctx, still, FACE_W / 2, FACE_FEET, false, false);
}

/** The building itself, at one canvas pixel per art pixel. */
export function paintBuilding(canvas: HTMLCanvasElement, b: Building, season: Season): void {
  const def = BUILDINGS[b.def];
  const sprite = getBuildingSprite(
    b.def,
    def.w,
    def.h,
    b.level,
    season,
    b.seed,
    b.stage === 'done' ? 'done' : 'site',
  );
  const ctx = prepare(canvas, sprite.canvas.width, sprite.canvas.height, 1);
  ctx.drawImage(sprite.canvas, 0, 0);
  // Sails are not baked into the sprite because they turn. Held at a fixed
  // angle here: this panel redraws a few times a second, and a windmill
  // stepping round at that rate looks broken rather than alive.
  if (b.def === 'mill' && b.stage === 'done' && sprite.anchor) {
    drawMillSails(ctx, sprite.anchor.x, sprite.anchor.y, 0.6);
  }
}

/**
 * A building the kingdom has not built yet, for the build list.
 *
 * Drawn from the definition rather than from an instance, because there is no
 * instance — this is the picture beside a thing you are deciding whether to
 * put up. It is the real sprite at one canvas pixel per art pixel, cropped to
 * a fixed box around the bottom of the footprint rather than scaled to fit:
 * a windmill is four times the width of a bench, and shrinking each one to the
 * same square would mean resampling pixel art at a different fraction per row
 * of the list. Cropping keeps every one of them hard-edged and keeps the sizes
 * honestly different, which is itself worth knowing before you place one.
 */
export function paintBuildingDef(canvas: HTMLCanvasElement, def: BuildingId, season: Season, w: number, h: number): void {
  const d = BUILDINGS[def];
  const sprite = getBuildingSprite(def, d.w, d.h, 1, season, 1, 'done');
  const ctx = prepare(canvas, w, h, 1);
  // Centred across, and sitting on the floor of the box: the roof is the part
  // that varies in height, and a row of buildings hung from their tops floats.
  const x = Math.round((w - sprite.canvas.width) / 2);
  const y = h - sprite.canvas.height;
  ctx.drawImage(sprite.canvas, x, y);
  if (def === 'mill' && sprite.anchor) drawMillSails(ctx, x + sprite.anchor.x, y + sprite.anchor.y, 0.6);
}

/**
 * Every building, at every level, on one page.
 *
 * Not reachable from the interface. It exists because reviewing procedural art
 * by finding an example of it somewhere on the map is hopeless — half the
 * buildings are behind another building, the lighting is on top of all of it,
 * and the one you want to look at is at the level you have not reached. This
 * draws each sprite on a flat ground colour at whatever zoom you ask for, which
 * is the only honest way to see what the code actually produced.
 *
 * Called from the console or a screenshot script: `window.tkm.spriteSheet()`.
 */
export function spriteSheet(season: Season = 'summer', zoom = 3): HTMLElement {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;inset:0;z-index:9999;overflow:auto;background:#6f9450;padding:16px;' +
    'display:flex;flex-wrap:wrap;gap:12px;align-content:flex-start;font:11px/1.3 system-ui;color:#20180f';

  for (const def of BUILD_ORDER) {
    const d = BUILDINGS[def];
    for (let level = 1; level <= d.maxLevel; level++) {
      const sprite = getBuildingSprite(def, d.w, d.h, level, season, 1, 'done');
      const cell = document.createElement('div');
      cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px';
      const canvas = document.createElement('canvas');
      const ctx = prepare(canvas, sprite.canvas.width, sprite.canvas.height, zoom);
      ctx.drawImage(sprite.canvas, 0, 0);
      if (def === 'mill' && sprite.anchor) drawMillSails(ctx, sprite.anchor.x, sprite.anchor.y, 0.6);
      canvas.style.imageRendering = 'pixelated';
      const label = document.createElement('span');
      label.textContent = d.maxLevel > 1 ? `${def} ${level}` : def;
      cell.append(canvas, label);
      host.appendChild(cell);
    }
  }
  // The props and a wheat plot through its stages, on the same page: they share
  // a palette and a pixel grid with the buildings, and the only way to tell
  // whether they still do is to see them side by side.
  const strip = document.createElement('div');
  strip.style.cssText = 'flex-basis:100%;display:flex;flex-wrap:wrap;gap:12px;margin-top:12px';
  const props = bakeProps(season);
  for (const [id, variants] of Object.entries(props)) {
    variants.forEach((p, i) => {
      const cell = document.createElement('div');
      cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px';
      const canvas = document.createElement('canvas');
      const ctx = prepare(canvas, p.canvas.width, p.canvas.height, zoom);
      ctx.drawImage(p.canvas, 0, 0);
      canvas.style.imageRendering = 'pixelated';
      const label = document.createElement('span');
      label.textContent = `${id} ${i}`;
      cell.append(canvas, label);
      strip.appendChild(cell);
    });
  }
  for (let stage = 0; stage <= 5; stage++) {
    const crop = getCropSprite(stage, season);
    const cell = document.createElement('div');
    cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px';
    const canvas = document.createElement('canvas');
    const ctx = prepare(canvas, crop.width, crop.height, zoom);
    ctx.drawImage(crop, 0, 0);
    canvas.style.imageRendering = 'pixelated';
    const label = document.createElement('span');
    label.textContent = `wheat ${stage}`;
    cell.append(canvas, label);
    strip.appendChild(cell);
  }
  host.appendChild(strip);

  return host;
}

/**
 * One villager in every pose the game can put them in, and every trade's tool.
 *
 * The same idea as the building sheet and for the same reason: a pose that only
 * happens when somebody is hungry, at night, facing north-east is not something
 * you can review by watching the map and hoping. Drawn on a flat ground colour
 * with no lighting over it, which is the only way to see what was actually
 * painted.
 *
 * `window.tkm.poseSheet(window.tkm.game.state.villagers[0])`.
 */
export function poseSheet(v: Villager, zoom = 4): HTMLElement {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;inset:0;z-index:9999;overflow:auto;background:#6f9450;padding:16px;' +
    'display:flex;flex-wrap:wrap;gap:10px;align-content:flex-start;font:10px/1.3 system-ui;color:#20180f';

  const cell = (label: string, paint: (ctx: CanvasRenderingContext2D) => void) => {
    const wrap = document.createElement('div');
    // Sized off the canvas, not off a guess: at five times zoom a cell is a
    // hundred and ten pixels wide, and a fixed seventy let every figure paint
    // over its neighbour — which made the load in somebody's arms look like it
    // belonged to the person beside them.
    wrap.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:3px;width:${22 * zoom}px`;
    const canvas = document.createElement('canvas');
    paint(prepare(canvas, 22, 26, zoom));
    canvas.style.imageRendering = 'pixelated';
    const tag = document.createElement('span');
    tag.textContent = label;
    wrap.append(canvas, tag);
    host.appendChild(wrap);
  };

  const poses: ActivityKind[] = [
    'idle',
    'walking',
    'working',
    'gathering',
    'building',
    'planting',
    'harvesting',
    'cooking',
    'fishing',
    'eating',
    'resting',
    'chatting',
    'watching',
    'arriving',
    'sleeping',
  ];
  for (const activity of poses) {
    for (const face of [0, 1] as const) {
      cell(`${activity}${face ? ' ←' : ' →'}`, (ctx) => {
        drawVillager(ctx, { ...v, activity, face, carrying: null, phase: 0.3 }, 11, 24, false, false);
      });
    }
  }
  // Carrying, which is a pose in its own right rather than an activity.
  for (const res of ['wood', 'stone', 'bread'] as const) {
    for (const face of [0, 1] as const) {
      cell(`carry ${res}${face ? ' ←' : ' →'}`, (ctx) => {
        drawVillager(
          ctx,
          { ...v, activity: 'hauling', face, carrying: { res, qty: 8 }, phase: 0.3 },
          11,
          24,
          false,
          false,
        );
      });
    }
  }
  // And every trade at work, which is where the tools come from.
  for (const job of ['general', 'woodcutter', 'miner', 'farmer', 'miller', 'cook', 'fisher', 'smith'] as const) {
    cell(job, (ctx) => {
      drawVillager(ctx, { ...v, activity: 'working', job, face: 0, carrying: null, phase: 0.3 }, 11, 24, false, false);
    });
  }
  return host;
}
