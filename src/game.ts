/**
 * The orchestrator: owns the game state, drives the clock, routes input, and
 * exposes the handful of operations the interface needs. Everything the player
 * can actually *do* to the kingdom goes through here.
 */

import { clamp, rng } from './core/util';
import type {
  Animal,
  Building,
  BuildingId,
  GameState,
  ResourceId,
  Season,
  TerrainId,
  Villager,
} from './types';
import {
  BUILDINGS,
  DAY_LENGTH,
  DAYS_PER_SEASON,
  JOB_META,
} from './sim/defs';
import {
  abandonPlan,
  assignHome,
  assignJob,
  buildingById,
  canAfford,
  deposit,
  jobSlots,
  makeBuilding,
  newGame,
  seasonForDay,
  storageCapacity,
  villagerById,
  withdraw,
} from './sim/state';
import { completeConstruction, siteNeeds, updateVillagers } from './sim/villager';
import { updateWildlife, resetWildlifeCache } from './sim/wildlife';
import { updatePopulation } from './sim/population';
import { updateGoals, isUnlocked } from './sim/goals';
import { journal, toast, updateToasts } from './sim/journal';
import { tileAt, updateTerrain } from './world/terrain';
import { toScreenX, toScreenY } from './world/iso';
import { Camera } from './render/camera';
import { Renderer, type RenderOptions } from './render/renderer';
import { audio } from './audio/audio';
import {
  DEFAULT_SETTINGS,
  type Settings,
  listSlots,
  loadSettings,
  newSlotId,
  saveSettings,
  saveToSlot,
} from './save/save';

export type Tool =
  | { kind: 'none' }
  | { kind: 'build'; def: BuildingId }
  | { kind: 'paint'; terrain: 'path' | 'road' }
  | { kind: 'erase' }
  | { kind: 'demolish' };

export interface Selection {
  kind: 'villager' | 'animal' | 'building' | null;
  id: number;
}

const PAINT_COST: Record<string, { res: ResourceId; qty: number }> = {
  path: { res: 'wood', qty: 1 },
  road: { res: 'stone', qty: 2 },
};

const AUTOSAVE_INTERVAL = 30;

export class Game {
  state: GameState;
  camera = new Camera();
  renderer: Renderer;
  settings: Settings = { ...DEFAULT_SETTINGS };

  tool: Tool = { kind: 'none' };
  selection: Selection = { kind: null, id: 0 };
  hover: { x: number; y: number } | null = null;
  cleanMode = false;
  slotId: string;
  slotName: string;

  /** Notifies the interface that something worth redrawing has changed. */
  onChange: (() => void) | null = null;

  private dragging = false;
  private dragMoved = false;
  private lastPointer = { x: 0, y: 0 };
  private painting: { x: number; y: number }[] | null = null;
  private autosaveTimer = AUTOSAVE_INTERVAL;
  private lastFrame = 0;
  private running = false;
  private accumulatedSay = 0;

  constructor(canvas: HTMLCanvasElement, state?: GameState, slotId?: string, slotName?: string) {
    this.state = state ?? newGame();
    this.renderer = new Renderer(canvas, this.state.w, this.state.h);
    this.slotId = slotId ?? newSlotId();
    this.slotName = slotName ?? 'Tiny Kingdom';
    this.settings = loadSettings();

    const fire = this.state.buildings[0];
    this.camera.centerOnTile(fire ? fire.x : this.state.w / 2, fire ? fire.y : this.state.h / 2);
    this.camera.zoomIndex = 1;
    this.rebuildTileFlags();
    this.attachInput(canvas);

    if (this.state.journal.length === 0) {
      journal(this.state, 'A traveller stopped walking, looked around, and stayed.', '✦');
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  /** Replaces the world wholesale — used by load and new-game. */
  adopt(state: GameState, slotId: string, slotName: string): void {
    this.state = state;
    this.slotId = slotId;
    this.slotName = slotName;
    this.selection = { kind: null, id: 0 };
    this.tool = { kind: 'none' };
    this.camera.stopFollowing();
    resetWildlifeCache();
    this.rebuildTileFlags();
    this.renderer.invalidateGround();
    const fire = state.buildings.find((b) => b.def === 'campfire') ?? state.buildings[0];
    this.camera.centerOnTile(fire ? fire.x : state.w / 2, fire ? fire.y : state.h / 2);
    this.notify();
  }

  /** Recomputes tile occupancy from the building list. Cheap and idempotent. */
  private rebuildTileFlags(): void {
    const g = this.state;
    for (const t of g.tiles) {
      t.building = 0;
      t.blocked = false;
      t.plot = 0;
      t.claimed = 0;
    }
    for (const b of g.buildings) {
      const def = BUILDINGS[b.def];
      for (let dy = 0; dy < def.h; dy++)
        for (let dx = 0; dx < def.w; dx++) {
          const t = tileAt(g, b.x + dx, b.y + dy);
          if (!t) continue;
          t.building = b.id;
          if (def.solid) t.blocked = true;
        }
      for (const p of b.plots) {
        const t = tileAt(g, p.x, p.y);
        if (t) t.plot = b.id;
      }
    }
  }

  private notify(): void {
    this.onChange?.();
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------

  private frame = (now: number): void => {
    if (!this.running) return;
    // Clamped: the kingdom does not simulate while the tab is in the background.
    const realDt = clamp((now - this.lastFrame) / 1000, 0, 0.05);
    this.lastFrame = now;

    this.update(realDt);
    this.render(realDt);
    requestAnimationFrame(this.frame);
  };

  private update(realDt: number): void {
    const g = this.state;
    updateToasts(g, realDt);

    if (!g.paused) {
      g.played += realDt;
      const gameDt = realDt * g.speed;
      // Sub-step so fast-forward never lets anyone walk through a wall.
      let left = gameDt;
      while (left > 0) {
        const step = Math.min(left, 0.1);
        this.simulate(step);
        left -= step;
      }
      this.autosaveTimer -= realDt;
      if (this.autosaveTimer <= 0) {
        this.autosaveTimer = AUTOSAVE_INTERVAL;
        this.save();
      }
    }

    this.camera.update(realDt, this.followTarget(), g.w, g.h);
    this.updateAudio(realDt);
  }

  private simulate(dt: number): void {
    const g = this.state;
    g.clock += dt;
    const before = g.day;
    g.dayT += dt / DAY_LENGTH;
    while (g.dayT >= 1) {
      g.dayT -= 1;
      g.day++;
    }
    if (g.day !== before) this.onNewDay();

    updateVillagers(g, dt);
    updateWildlife(g, dt);
    updatePopulation(g, dt);
    updateTerrain(g, dt);
    this.updateWeather(dt);

    // Goals and journal checks are cheap but not per-tick cheap.
    this.accumulatedSay += dt;
    if (this.accumulatedSay >= 1) {
      this.accumulatedSay = 0;
      updateGoals(g);
    }
  }

  private onNewDay(): void {
    const g = this.state;
    const { season, year } = seasonForDay(g.day);
    if (season !== g.season) {
      g.season = season;
      this.renderer.invalidateGround();
      journal(g, `${capitalize(season)} arrived.`, seasonIcon(season));
      toast(g, `${capitalize(season)} has arrived`, seasonIcon(season), 'info');
      audio.chime(season === 'spring' ? 4 : season === 'summer' ? 7 : season === 'autumn' ? 2 : -1, 0.035);
    }
    if (year !== g.year) {
      g.year = year;
      journal(g, `Year ${year} began.`, '✦');
    }
  }

  private updateWeather(dt: number): void {
    const g = this.state;
    g.weatherTimer -= dt;
    if (g.weatherTimer <= 0) {
      const wet = g.season === 'spring' ? 0.4 : g.season === 'winter' ? 0.5 : g.season === 'autumn' ? 0.35 : 0.2;
      if (g.weatherKind === 'clear' && rng.chance(wet)) {
        g.weatherKind = g.season === 'winter' ? 'snow' : 'rain';
        g.weatherTimer = rng.range(120, 420);
        journal(g, g.weatherKind === 'snow' ? 'Snow began to fall.' : 'It started raining.', g.weatherKind === 'snow' ? '❄️' : '🌧️');
      } else {
        g.weatherKind = 'clear';
        g.weatherTimer = rng.range(300, 900);
      }
    }
    const target = g.weatherKind === 'clear' ? 0 : 1;
    g.weather += clamp(target - g.weather, -dt / 30, dt / 30);
  }

  private updateAudio(realDt: number): void {
    const g = this.state;
    const night = g.dayT >= 0.68 || g.dayT < 0.04 ? 1 : g.dayT > 0.6 ? (g.dayT - 0.6) / 0.08 : 0;
    // How much water is in view, roughly, so the pond is audible when you're near it.
    let water = 0;
    const cx = Math.round(this.camera.x / 16);
    void cx;
    const centre = this.renderer.screenToGrid(this.renderer.cssW / 2, this.renderer.cssH / 2);
    const radius = 9;
    let samples = 0;
    for (let dy = -radius; dy <= radius; dy += 2)
      for (let dx = -radius; dx <= radius; dx += 2) {
        const t = tileAt(g, Math.round(centre.x + dx), Math.round(centre.y + dy));
        samples++;
        if (t && (t.terrain === 'water' || t.terrain === 'shallow')) water++;
      }
    audio.update(realDt, {
      night: clamp(night, 0, 1),
      water: samples ? clamp((water / samples) * 2.4, 0, 1) : 0,
      wind: g.season === 'winter' ? 0.8 : 0.4,
      rain: g.weather,
      population: g.villagers.length,
    });
  }

  private followTarget(): { x: number; y: number } | null {
    if (!this.camera.followKind) return null;
    if (this.camera.followKind === 'villager') {
      const v = villagerById(this.state, this.camera.followId);
      return v ? { x: v.x, y: v.y } : null;
    }
    const a = this.state.animals.find((x) => x.id === this.camera.followId);
    return a ? { x: a.x, y: a.y } : null;
  }

  private render(realDt: number): void {
    const opts: RenderOptions = {
      showBubbles: this.settings.showBubbles,
      showNames: this.settings.showNames && !this.cleanMode,
      showGrid: this.tool.kind === 'build' || this.tool.kind === 'paint',
      selection: this.selection,
      hover: this.hover,
      ghost: null,
      paint: null,
      demolish: this.tool.kind === 'demolish' || this.tool.kind === 'erase',
    };

    if (this.tool.kind === 'build' && this.hover) {
      const def = BUILDINGS[this.tool.def];
      const x = this.hover.x;
      const y = this.hover.y;
      opts.ghost = { def: this.tool.def, x, y, valid: this.canPlace(this.tool.def, x, y) };
      void def;
    } else if ((this.tool.kind === 'paint' || this.tool.kind === 'erase') && this.hover) {
      const tiles = this.painting ?? [this.hover];
      opts.paint = tiles.map((t) => ({
        x: t.x,
        y: t.y,
        valid: this.tool.kind === 'erase' ? this.canErase(t.x, t.y) : this.canPaint(t.x, t.y),
      }));
    }

    this.renderer.render(this.state, this.camera, opts, realDt);
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private attachInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      audio.ensure();
      canvas.setPointerCapture(e.pointerId);
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.dragMoved = false;

      if (e.button === 2 || e.button === 1) {
        this.cancelTool();
        return;
      }
      if (this.tool.kind === 'paint' || this.tool.kind === 'erase') {
        const t = this.tileUnder(e.clientX, e.clientY);
        this.painting = t ? [t] : [];
        return;
      }
      this.dragging = true;
    });

    canvas.addEventListener('pointermove', (e) => {
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.hover = this.tileUnder(e.clientX, e.clientY);

      if (this.painting) {
        const t = this.hover;
        if (t && !this.painting.some((p) => p.x === t.x && p.y === t.y)) this.painting.push(t);
        this.lastPointer = { x: e.clientX, y: e.clientY };
        return;
      }
      if (this.dragging && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
        this.dragMoved = true;
        const k = this.renderer.dpr / this.renderer.scale;
        this.camera.pan(-dx * k, -dy * k);
      }
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('pointerup', (e) => {
      if (this.painting) {
        this.commitPaint();
        this.painting = null;
        this.notify();
        return;
      }
      const wasDragging = this.dragging;
      this.dragging = false;
      if (!wasDragging || this.dragMoved || e.button !== 0) return;
      this.handleClick(e.clientX, e.clientY);
    });

    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const anchor = this.worldUnder(e.clientX, e.clientY);
        this.camera.zoomBy(e.deltaY < 0 ? 1 : -1, anchor);
        this.notify();
      },
      { passive: false },
    );

    canvas.addEventListener('dblclick', (e) => {
      const hit = this.pickEntity(e.clientX, e.clientY);
      if (hit.kind === 'villager') this.camera.follow('villager', hit.id);
      else if (hit.kind === 'animal') this.camera.follow('animal', hit.id);
      this.notify();
    });
  }

  private handleClick(cssX: number, cssY: number): void {
    if (this.tool.kind === 'build') {
      const t = this.tileUnder(cssX, cssY);
      if (t) this.place(this.tool.def, t.x, t.y);
      return;
    }
    if (this.tool.kind === 'demolish') {
      const t = this.tileUnder(cssX, cssY);
      if (t) this.demolishAt(t.x, t.y);
      return;
    }
    const hit = this.pickEntity(cssX, cssY);
    this.selection = hit;
    if (hit.kind === null) this.camera.stopFollowing();
    audio.tick();
    this.notify();
  }

  private tileUnder(cssX: number, cssY: number): { x: number; y: number } | null {
    const rect = this.renderer.canvas.getBoundingClientRect();
    const g = this.renderer.screenToGrid(cssX - rect.left, cssY - rect.top);
    const x = Math.round(g.x);
    const y = Math.round(g.y);
    if (x < 0 || y < 0 || x >= this.state.w || y >= this.state.h) return null;
    return { x, y };
  }

  private worldUnder(cssX: number, cssY: number): { x: number; y: number } {
    const rect = this.renderer.canvas.getBoundingClientRect();
    return {
      x: this.renderer.viewX + ((cssX - rect.left) * this.renderer.dpr) / this.renderer.scale,
      y: this.renderer.viewY + ((cssY - rect.top) * this.renderer.dpr) / this.renderer.scale,
    };
  }

  /** Picks whatever is under the cursor, preferring people to scenery. */
  private pickEntity(cssX: number, cssY: number): Selection {
    const w = this.worldUnder(cssX, cssY);
    let best: Selection = { kind: null, id: 0 };
    let bestDepth = -Infinity;

    for (const v of this.state.villagers) {
      const sx = toScreenX(v.x, v.y);
      const sy = toScreenY(v.x, v.y);
      if (Math.abs(w.x - sx) > 6) continue;
      if (w.y > sy + 3 || w.y < sy - 22) continue;
      const depth = v.x + v.y;
      if (depth > bestDepth) {
        bestDepth = depth;
        best = { kind: 'villager', id: v.id };
      }
    }
    if (best.kind) return best;

    for (const a of this.state.animals) {
      const sx = toScreenX(a.x, a.y);
      const sy = toScreenY(a.x, a.y);
      if (Math.abs(w.x - sx) > 7) continue;
      if (w.y > sy + 3 || w.y < sy - 20) continue;
      const depth = a.x + a.y;
      if (depth > bestDepth) {
        bestDepth = depth;
        best = { kind: 'animal', id: a.id };
      }
    }
    if (best.kind) return best;

    const t = this.tileUnder(cssX, cssY);
    if (t) {
      const tile = tileAt(this.state, t.x, t.y);
      if (tile?.building) return { kind: 'building', id: tile.building };
      if (tile?.plot) return { kind: 'building', id: tile.plot };
    }
    return { kind: null, id: 0 };
  }

  // -------------------------------------------------------------------------
  // Building placement
  // -------------------------------------------------------------------------

  /** Materials already promised to sites that have not received them yet. */
  reservedMaterials(): Partial<Record<ResourceId, number>> {
    const out: Partial<Record<ResourceId, number>> = {};
    for (const b of this.state.buildings) {
      if (b.stage !== 'building') continue;
      for (const need of siteNeeds(b)) {
        const short = Math.max(0, need.need - need.have);
        if (short > 0) out[need.res] = (out[need.res] ?? 0) + short;
      }
    }
    return out;
  }

  /** True when the kingdom could actually supply this building right now. */
  canAffordNew(def: BuildingId): boolean {
    const cost = BUILDINGS[def].cost;
    const reserved = this.reservedMaterials();
    for (const k in cost) {
      const res = k as ResourceId;
      if (this.state.stock[res] - (reserved[res] ?? 0) < (cost[res] ?? 0)) return false;
    }
    return true;
  }

  canPlace(def: BuildingId, x: number, y: number): boolean {
    const g = this.state;
    const d = BUILDINGS[def];
    if (!isUnlocked(g, d.unlock)) return false;
    for (let dy = 0; dy < d.h; dy++)
      for (let dx = 0; dx < d.w; dx++) {
        const t = tileAt(g, x + dx, y + dy);
        if (!t) return false;
        if (t.terrain === 'water' || t.terrain === 'shallow') return false;
        if (t.building || t.plot) return false;
      }
    return this.canAffordNew(def);
  }

  place(def: BuildingId, x: number, y: number): boolean {
    if (!this.canPlace(def, x, y)) {
      audio.thud(0.6, 0.03);
      return false;
    }
    const g = this.state;
    const d = BUILDINGS[def];
    const b = makeBuilding(g, def, x, y, rng);
    b.stage = 'building';
    g.buildings.push(b);

    for (let dy = 0; dy < d.h; dy++)
      for (let dx = 0; dx < d.w; dx++) {
        const t = tileAt(g, x + dx, y + dy);
        if (!t) continue;
        t.building = b.id;
        if (d.solid) t.blocked = true;
        // Clearing ground for a building returns a little of what was there.
        if (t.prop === 'tree' && t.amount > 0) deposit(g, 'wood', Math.floor(t.amount * 0.4));
        if (t.prop === 'boulder' && t.amount > 0) deposit(g, 'stone', Math.floor(t.amount * 0.4));
        t.prop = null;
        t.amount = 0;
        t.regrow = 0;
      }
    this.renderer.invalidateGround();

    // Anyone standing in the footprint gets moved along.
    for (const v of g.villagers) {
      const vx = Math.round(v.x);
      const vy = Math.round(v.y);
      if (vx >= x && vx < x + d.w && vy >= y && vy < y + d.h) abandonPlan(g, v);
    }

    // Free-standing decorations need no crew.
    if (d.labour <= 0 && Object.keys(d.cost).length === 0) completeConstruction(g, b);

    audio.thud(1.2, 0.05);
    this.selection = { kind: 'building', id: b.id };
    this.notify();
    return true;
  }

  demolishAt(x: number, y: number): void {
    const g = this.state;
    const t = tileAt(g, x, y);
    if (!t) return;

    if (!t.building) {
      // Roads and paths are removed by the same tool.
      if (t.terrain === 'path' || t.terrain === 'road') {
        t.terrain = 'grass';
        this.renderer.invalidateGround();
        audio.thud(0.9, 0.03);
        this.notify();
      }
      return;
    }
    const b = buildingById(g, t.building);
    if (!b) return;
    if (b.def === 'campfire') {
      toast(g, 'The first fire stays lit.', '🔥', 'warn');
      return;
    }
    this.removeBuilding(b, true);
  }

  removeBuilding(b: Building, refund: boolean): void {
    const g = this.state;
    const def = BUILDINGS[b.def];

    if (refund) {
      for (const k in def.cost) {
        const res = k as ResourceId;
        const paid = b.stage === 'done' ? def.cost[res] ?? 0 : b.delivered[res] ?? 0;
        deposit(g, res, Math.floor(paid * 0.5));
      }
    }
    // Give back anything sitting in its buffers.
    for (const bag of [b.input, b.output]) {
      for (const k in bag) {
        const res = k as ResourceId;
        deposit(g, res, bag[res] ?? 0);
      }
    }

    for (let dy = 0; dy < def.h; dy++)
      for (let dx = 0; dx < def.w; dx++) {
        const t = tileAt(g, b.x + dx, b.y + dy);
        if (!t) continue;
        if (t.building === b.id) {
          t.building = 0;
          t.blocked = false;
        }
        if (t.plot === b.id) t.plot = 0;
      }

    for (const v of g.villagers) {
      if (v.workplace === b.id) assignJob(g, v, 0);
      if (v.home === b.id) {
        v.home = 0;
        assignHome(g, v);
      }
      abandonPlan(g, v);
    }
    g.buildings = g.buildings.filter((x) => x.id !== b.id);
    if (this.selection.kind === 'building' && this.selection.id === b.id) this.selection = { kind: null, id: 0 };
    this.renderer.invalidateGround();
    audio.thud(0.7, 0.05);
    this.notify();
  }

  // -------------------------------------------------------------------------
  // Roads
  // -------------------------------------------------------------------------

  canPaint(x: number, y: number): boolean {
    if (this.tool.kind !== 'paint') return false;
    const t = tileAt(this.state, x, y);
    if (!t) return false;
    if (t.building || t.plot) return false;
    if (t.terrain === 'water' || t.terrain === 'shallow') return false;
    if (t.terrain === this.tool.terrain) return false;
    return true;
  }

  canErase(x: number, y: number): boolean {
    const t = tileAt(this.state, x, y);
    return !!t && (t.terrain === 'path' || t.terrain === 'road');
  }

  private commitPaint(): void {
    if (!this.painting || this.painting.length === 0) return;
    const g = this.state;

    if (this.tool.kind === 'erase') {
      let n = 0;
      for (const p of this.painting) {
        if (!this.canErase(p.x, p.y)) continue;
        const t = tileAt(g, p.x, p.y)!;
        t.terrain = 'grass';
        n++;
      }
      if (n) {
        this.renderer.invalidateGround();
        audio.thud(0.8, 0.04);
      }
      return;
    }
    if (this.tool.kind !== 'paint') return;

    const terrain = this.tool.terrain as TerrainId;
    const cost = PAINT_COST[this.tool.terrain];
    let laid = 0;
    for (const p of this.painting) {
      if (!this.canPaint(p.x, p.y)) continue;
      if (!canAfford(g, { [cost.res]: cost.qty })) {
        toast(g, `Not enough ${cost.res}`, '⚠️', 'warn');
        break;
      }
      withdraw(g, cost.res, cost.qty);
      const t = tileAt(g, p.x, p.y)!;
      // Clearing the way returns part of whatever was standing there.
      if (t.prop === 'tree' && t.amount > 0) deposit(g, 'wood', Math.floor(t.amount * 0.4));
      if (t.prop === 'boulder' && t.amount > 0) deposit(g, 'stone', Math.floor(t.amount * 0.4));
      t.terrain = terrain;
      t.prop = null;
      t.amount = 0;
      t.regrow = 0;
      laid++;
    }
    if (laid) {
      this.renderer.invalidateGround();
      audio.thud(1.1, 0.04);
    }
  }

  // -------------------------------------------------------------------------
  // Operations the interface calls
  // -------------------------------------------------------------------------

  setTool(tool: Tool): void {
    this.tool = tool;
    if (tool.kind !== 'none') this.selection = { kind: null, id: 0 };
    this.syncCursor();
    this.notify();
  }

  cancelTool(): void {
    this.tool = { kind: 'none' };
    this.painting = null;
    this.syncCursor();
    this.notify();
  }

  private syncCursor(): void {
    this.renderer.canvas.classList.toggle('tool-active', this.tool.kind !== 'none');
  }

  select(kind: Selection['kind'], id: number): void {
    this.selection = { kind, id };
    this.notify();
  }

  follow(kind: 'villager' | 'animal', id: number): void {
    this.camera.follow(kind, id);
    this.notify();
  }

  stopFollowing(): void {
    this.camera.stopFollowing();
    this.notify();
  }

  centerOn(x: number, y: number): void {
    this.camera.stopFollowing();
    this.camera.glideToTile(x, y);
  }

  setSpeed(speed: number): void {
    this.state.speed = speed;
    this.state.paused = speed === 0;
    if (speed > 0) this.state.speed = speed;
    this.notify();
  }

  togglePause(): void {
    this.state.paused = !this.state.paused;
    this.notify();
  }

  setCleanMode(on: boolean): void {
    this.cleanMode = on;
    this.notify();
  }

  renameVillager(id: number, name: string): void {
    const v = villagerById(this.state, id);
    if (!v) return;
    const trimmed = name.trim().slice(0, 28);
    if (!trimmed) return;
    v.name = trimmed;
    this.notify();
  }

  toggleFavorite(kind: 'villager' | 'animal', id: number): void {
    if (kind === 'villager') {
      const v = villagerById(this.state, id);
      if (v) v.favorite = !v.favorite;
    } else {
      const a = this.state.animals.find((x) => x.id === id);
      if (a) {
        a.favorite = !a.favorite;
        if (a.favorite && !a.name) journal(this.state, `A ${a.species} became a familiar face.`, '❤');
      }
    }
    this.notify();
  }

  nameAnimal(id: number, name: string): void {
    const a = this.state.animals.find((x) => x.id === id);
    if (!a) return;
    const trimmed = name.trim().slice(0, 24);
    if (!trimmed) return;
    const first = !a.name;
    a.name = trimmed;
    a.favorite = true;
    if (first) journal(this.state, `A ${a.species} was given a name: ${trimmed}.`, '🐾');
    this.notify();
  }

  /** Puts a villager into a job slot, or back to Helper when buildingId is 0. */
  assign(villagerId: number, buildingId: number): boolean {
    const v = villagerById(this.state, villagerId);
    if (!v) return false;
    const previousJob = v.job;
    const ok = assignJob(this.state, v, buildingId);
    if (ok) {
      const b = buildingById(this.state, buildingId);
      if (b && previousJob !== v.job) {
        v.history.push({ day: this.state.day, text: `Took up work as a ${JOB_META[v.job].name.toLowerCase()}.` });
        if (v.history.length > 30) v.history.shift();
      }
      audio.tick();
      this.notify();
    }
    return ok;
  }

  /** Fills a building's free slots with the nearest available helpers. */
  autoStaff(buildingId: number): void {
    const b = buildingById(this.state, buildingId);
    if (!b) return;
    const free = jobSlots(b) - b.workers.length;
    if (free <= 0) return;
    const helpers = this.state.villagers
      .filter((v) => v.workplace === 0)
      .sort((p, q) => (p.x - b.x) ** 2 + (p.y - b.y) ** 2 - ((q.x - b.x) ** 2 + (q.y - b.y) ** 2));
    for (let i = 0; i < Math.min(free, helpers.length); i++) this.assign(helpers[i].id, b.id);
  }

  canUpgrade(b: Building): boolean {
    const def = BUILDINGS[b.def];
    if (b.stage !== 'done' || b.upgrading) return false;
    if (b.level >= def.maxLevel) return false;
    const mul = def.upgradeCostMul ?? 2;
    const reserved = this.reservedMaterials();
    for (const k in def.cost) {
      const res = k as ResourceId;
      const need = Math.ceil((def.cost[res] ?? 0) * mul);
      if (this.state.stock[res] - (reserved[res] ?? 0) < need) return false;
    }
    return true;
  }

  upgrade(buildingId: number): void {
    const b = buildingById(this.state, buildingId);
    if (!b || !this.canUpgrade(b)) return;
    b.upgrading = true;
    b.stage = 'building';
    b.labour = 0;
    b.delivered = {};
    toast(this.state, `${BUILDINGS[b.def].name} improvements started`, '⬆️', 'info');
    this.notify();
  }

  upgradeCost(b: Building): { res: ResourceId; qty: number }[] {
    const def = BUILDINGS[b.def];
    const mul = def.upgradeCostMul ?? 2;
    const out: { res: ResourceId; qty: number }[] = [];
    for (const k in def.cost) {
      const res = k as ResourceId;
      out.push({ res, qty: Math.ceil((def.cost[res] ?? 0) * mul) });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  save(): boolean {
    const ok = saveToSlot(this.state, this.slotId, this.slotName);
    this.settings.lastSlot = this.slotId;
    saveSettings(this.settings);
    return ok;
  }

  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    audio.setVolume(this.settings.volume);
    audio.setMuted(this.settings.muted);
    this.notify();
  }

  slots() {
    return listSlots();
  }

  // -------------------------------------------------------------------------
  // Queries used by the interface
  // -------------------------------------------------------------------------

  storageInfo(): { used: number; cap: number } {
    let used = 0;
    for (const res of ['wood', 'stone', 'wheat', 'flour', 'bread'] as ResourceId[]) used += this.state.stock[res];
    return { used, cap: storageCapacity(this.state) };
  }

  selectedVillager(): Villager | null {
    return this.selection.kind === 'villager' ? villagerById(this.state, this.selection.id) : null;
  }

  selectedBuilding(): Building | null {
    return this.selection.kind === 'building' ? buildingById(this.state, this.selection.id) : null;
  }

  selectedAnimal(): Animal | null {
    return this.selection.kind === 'animal'
      ? this.state.animals.find((a) => a.id === this.selection.id) ?? null
      : null;
  }

  /** Time of day as a friendly 24-hour clock. Day-fraction 0 is first light. */
  clockLabel(): string {
    const hours = (this.state.dayT * 24 + 5) % 24;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  dayProgressLabel(): string {
    const g = this.state;
    const dayInSeason = ((g.day - 1) % DAYS_PER_SEASON) + 1;
    return `Day ${dayInSeason} of ${DAYS_PER_SEASON}`;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function seasonIcon(s: Season): string {
  return s === 'spring' ? '🌸' : s === 'summer' ? '☀️' : s === 'autumn' ? '🍂' : '❄️';
}

