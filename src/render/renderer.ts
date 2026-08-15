/**
 * The renderer draws the world into an offscreen buffer at exactly one canvas
 * pixel per art pixel, then upscales that buffer with nearest-neighbour. That
 * is what keeps the pixel art crisp at every zoom level instead of smearing.
 *
 * Ground is baked once into a single map-sized canvas and blitted as one image;
 * only things that need depth sorting against actors are drawn per frame.
 */

import { clamp, hash2 } from '../core/util';
import type { Building, GameState, Season, Villager } from '../types';
import { BUILDINGS } from '../sim/defs';
import { HALF_H, HALF_W, toGridX, toGridY, toScreenX, toScreenY } from '../world/iso';
import { Camera } from './camera';
import { ambientTint } from './palette';
import type { BuildingSprite } from './sprites';
import {
  bakeProps,
  bakeTerrain,
  clearBuildingCache,
  clearCropCache,
  ctxOf,
  getBuildingSprite,
  getCropSprite,
  mkCanvas,
  type PropSheet,
  type TerrainSheet,
} from './sprites';
import { drawActivityIcon, drawAnimal, drawAnimalTag, drawMood, drawVillager } from './actors';

export interface RenderOptions {
  showBubbles: boolean;
  showNames: boolean;
  /** Badges over villagers saying what they are doing. */
  showActivity: boolean;
  showGrid: boolean;
  selection: { kind: 'villager' | 'animal' | 'building' | 'tile' | null; id: number; x?: number; y?: number };
  hover: { x: number; y: number } | null;
  /** Active build ghost, if the player is placing something. */
  ghost: { def: keyof typeof BUILDINGS; x: number; y: number; valid: boolean } | null;
  demolish: boolean;
}

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

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private display: CanvasRenderingContext2D;
  private buffer: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private light: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private ground: HTMLCanvasElement;
  private gctx: CanvasRenderingContext2D;

  private terrain!: TerrainSheet;
  private props!: PropSheet;
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
      this.bctx = ctxOf(this.buffer);
      this.lctx = this.light.getContext('2d')!;
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
    this.viewX = Math.floor(cam.x - this.bufW / 2);
    this.viewY = Math.floor(cam.y - this.bufH / 2);
    const tint = ambientTint(g.dayT, g.season);
    this.darkness = 1 - Math.min(1, (tint.r + tint.g + tint.b) / 700);

    // Deep water beyond the island edge.
    b.fillStyle = g.season === 'winter' ? '#3f5f78' : '#3a6285';
    b.fillRect(0, 0, this.bufW, this.bufH);

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

    this.labels.length = 0;
    this.badges.length = 0;
    this.drawWorld(g, opts);
    this.drawPlacement(g, opts);
    this.applyLighting(g);
    this.drawBadges(g);
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
  // World pass
  // -------------------------------------------------------------------------

  private drawWorld(g: GameState, opts: RenderOptions): void {
    const b = this.bctx;
    const list: Drawable[] = [];

    // Visible tile window, with generous margins for tall sprites.
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
    minX = clamp(Math.floor(minX) - 4, 0, g.w - 1);
    maxX = clamp(Math.ceil(maxX) + 4, 0, g.w - 1);
    minY = clamp(Math.floor(minY) - 4, 0, g.h - 1);
    maxY = clamp(Math.ceil(maxY) + 6, 0, g.h - 1);

    const sel = opts.selection;

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
      // Farms show their barn in the back corner, so they sort from there.
      const depth = def.plots ? bd.x + bd.y : bd.x + def.w - 1 + (bd.y + def.h - 1);
      const isSelected = sel.kind === 'building' && sel.id === bd.id;

      list.push({
        depth: depth - 0.01,
        order: 0,
        draw: () => {
          b.drawImage(sprite.canvas, dx, dy);
          this.drawLitWindows(bd, sprite, dx, dy);
          if (bd.def === 'mill' && bd.stage === 'done' && sprite.anchor) this.drawMillSails(bd, dx + sprite.anchor.x, dy + sprite.anchor.y);
          if (bd.stage === 'building') this.drawSiteProgress(bd, dx, dy, sprite.canvas.width, sprite.canvas.height);
          if (isSelected) this.outlineFootprint(bd.x, bd.y, def.w, def.h, '#ffd77a');
        },
      });
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
    if (opts.hover && !opts.ghost) {
      this.outlineFootprint(opts.hover.x, opts.hover.y, 1, 1, opts.demolish ? '#ff9a7a' : 'rgba(255,255,255,0.5)');
    }
  }

  private gridAt(bufX: number, bufY: number): { x: number; y: number } {
    const wx = this.viewX + bufX;
    const wy = this.viewY + bufY;
    return { x: toGridX(wx, wy), y: toGridY(wx, wy) };
  }

  /** Warm light behind the windows of a building someone is using. */
  private drawLitWindows(bd: Building, sprite: BuildingSprite, dx: number, dy: number): void {
    if (this.darkness < 0.08 || bd.stage !== 'done' || sprite.windows.length === 0) return;
    const def = BUILDINGS[bd.def];
    const occupied = bd.residents.length > 0 || bd.workers.length > 0 || !!def.storage;
    if (!occupied) return;
    const b = this.bctx;
    b.save();
    b.globalAlpha = Math.min(1, this.darkness * 1.5);
    b.fillStyle = '#ffce7a';
    for (const wdw of sprite.windows) b.fillRect(dx + wdw.x, dy + wdw.y, wdw.w, wdw.h);
    b.restore();
  }

  /** Sails turn while the mill has a miller working it. */
  private drawMillSails(bd: Building, cx: number, cy: number): void {
    const b = this.bctx;
    const spin = bd.workers.length > 0 ? this.time * 1.1 : this.time * 0.18;
    b.fillStyle = '#e8dcc0';
    for (let i = 0; i < 4; i++) {
      const a = spin + (i * Math.PI) / 2;
      for (let r = 3; r < 13; r++) {
        const px = Math.round(cx + Math.cos(a) * r);
        const py = Math.round(cy + Math.sin(a) * r * 0.62);
        b.fillRect(px, py, 2, 2);
      }
    }
    b.fillStyle = '#6b5334';
    b.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 3, 3);
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

  // -------------------------------------------------------------------------
  // Lighting
  // -------------------------------------------------------------------------

  private applyLighting(g: GameState): void {
    const l = this.lctx;
    const tint = ambientTint(g.dayT, g.season);
    // Weather takes the edge off the light without ever going gloomy.
    const damp = 1 - g.weather * 0.18;
    l.globalCompositeOperation = 'source-over';
    l.fillStyle = `rgb(${Math.round(tint.r * damp)},${Math.round(tint.g * damp)},${Math.round(tint.b * damp)})`;
    l.fillRect(0, 0, this.bufW, this.bufH);

    const darkness = this.darkness;
    if (darkness > 0.06) {
      l.globalCompositeOperation = 'lighter';

      // Every lit window throws a small pool of its own. Drawn as a soft radial
      // rather than a hard rectangle so any spill onto a building in front
      // reads as lamplight leaking, not as a misplaced sprite.
      for (const bd of g.buildings) {
        if (bd.stage !== 'done') continue;
        const def = BUILDINGS[bd.def];
        const sprite = getBuildingSprite(bd.def, def.w, def.h, bd.level, g.season, bd.seed, 'done');
        if (sprite.windows.length === 0) continue;
        if (bd.residents.length === 0 && bd.workers.length === 0 && !def.storage) continue;
        const leftX = toScreenX(bd.x, bd.y + def.h - 1) - HALF_W - sprite.padX - this.viewX;
        const topY = toScreenY(bd.x, bd.y) - HALF_H - sprite.rise - this.viewY;
        for (const wdw of sprite.windows) {
          const sx = leftX + wdw.x + wdw.w / 2;
          const sy = topY + wdw.y + wdw.h / 2;
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
          const r = src.radius;
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

