/** Camera: pan, integer zoom, and a follow mode for watching one individual. */

import { clamp, lerp } from '../core/util';
import { HALF_H, HALF_W, toScreenX, toScreenY } from '../world/iso';

export const ZOOM_LEVELS = [1, 2, 3, 4];

export class Camera {
  /** Centre of view, in world pixels. */
  x = 0;
  y = 0;
  zoomIndex = 1;
  /** Entity the camera is tracking, or null. */
  followId = 0;
  followKind: 'villager' | 'animal' | null = null;
  /** Set while the camera is easing toward a point. */
  private targetX: number | null = null;
  private targetY: number | null = null;

  get zoom(): number {
    return ZOOM_LEVELS[this.zoomIndex];
  }

  centerOnTile(tx: number, ty: number): void {
    this.x = toScreenX(tx, ty);
    this.y = toScreenY(tx, ty);
    this.targetX = null;
    this.targetY = null;
  }

  glideToTile(tx: number, ty: number): void {
    this.targetX = toScreenX(tx, ty);
    this.targetY = toScreenY(tx, ty);
  }

  pan(dxPixels: number, dyPixels: number): void {
    this.x += dxPixels;
    this.y += dyPixels;
    this.targetX = null;
    this.targetY = null;
    this.stopFollowing();
  }

  zoomBy(delta: number, anchorWorld?: { x: number; y: number }): void {
    const before = this.zoom;
    this.zoomIndex = clamp(this.zoomIndex + delta, 0, ZOOM_LEVELS.length - 1);
    const after = this.zoom;
    if (anchorWorld && before !== after) {
      // Keep the point under the cursor roughly put while zooming.
      const k = 1 - before / after;
      this.x += (anchorWorld.x - this.x) * k;
      this.y += (anchorWorld.y - this.y) * k;
    }
  }

  follow(kind: 'villager' | 'animal', id: number): void {
    this.followKind = kind;
    this.followId = id;
  }

  stopFollowing(): void {
    this.followKind = null;
    this.followId = 0;
  }

  update(dt: number, target: { x: number; y: number } | null, mapW: number, mapH: number): void {
    if (target) {
      const wx = toScreenX(target.x, target.y);
      const wy = toScreenY(target.x, target.y);
      const k = 1 - Math.pow(0.0016, dt);
      this.x = lerp(this.x, wx, k);
      this.y = lerp(this.y, wy, k);
    } else if (this.targetX !== null && this.targetY !== null) {
      const k = 1 - Math.pow(0.002, dt);
      this.x = lerp(this.x, this.targetX, k);
      this.y = lerp(this.y, this.targetY, k);
      if (Math.abs(this.x - this.targetX) < 0.5 && Math.abs(this.y - this.targetY) < 0.5) {
        this.targetX = null;
        this.targetY = null;
      }
    }
    this.clampToMap(mapW, mapH);
  }

  /** Keeps the view over the island rather than out in the void. */
  private clampToMap(mapW: number, mapH: number): void {
    const marginX = 8 * HALF_W;
    const marginY = 8 * HALF_H;
    const minX = -mapH * HALF_W - marginX;
    const maxX = mapW * HALF_W + marginX;
    const minY = -marginY;
    const maxY = (mapW + mapH) * HALF_H + marginY;
    this.x = clamp(this.x, minX, maxX);
    this.y = clamp(this.y, minY, maxY);
  }
}
