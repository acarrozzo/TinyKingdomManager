/** Isometric projection. Fixed 2:1 diamond tiles, no height. */

export const TILE_W = 32;
export const TILE_H = 16;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

/** Grid (fractional tile coords) → world pixel space. */
export function toScreenX(tx: number, ty: number): number {
  return (tx - ty) * HALF_W;
}
export function toScreenY(tx: number, ty: number): number {
  return (tx + ty) * HALF_H;
}

/** World pixel space → fractional grid coords. */
export function toGridX(sx: number, sy: number): number {
  return (sx / HALF_W + sy / HALF_H) / 2;
}
export function toGridY(sx: number, sy: number): number {
  return (sy / HALF_H - sx / HALF_W) / 2;
}

/** Painter's-algorithm depth for a point. Larger draws later (in front). */
export function depthOf(tx: number, ty: number): number {
  return tx + ty;
}
