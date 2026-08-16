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

import type { Building, Season, Villager } from '../types';
import { BUILDINGS } from '../sim/defs';
import { drawVillager } from '../render/actors';
import { drawMillSails, getBuildingSprite } from '../render/sprites';

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
