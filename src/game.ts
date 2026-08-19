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
  Focus,
  GameState,
  ResourceId,
  Season,
  Tile,
  Villager,
} from './types';
import {
  BUILDINGS,
  DAY_LENGTH,
  DAYS_PER_SEASON,
  GOOD_SPOT,
  JOB_META,
  buildingName,
  dayDoing,
  focusOptions,
  holdsOf,
  rangeOf,
  relocateCost,
  RESOURCE_META,
  storesOf,
  upgradeCostOf,
  upgradeReqsOf,
} from './sim/defs';
import {
  abandonPlan,
  assignJob,
  benchOf,
  buildingById,
  capacityIn,
  capacityOf,
  carriedOf,
  contentsOf,
  deposit,
  homeFor,
  jobSlots,
  makeBuilding,
  newGame,
  removeBuilding as removeBuildingFromMap,
  seasonForDay,
  setHome as setVillagerHome,
  storedOf,
  totalOf,
  villagerById,
} from './sim/state';
import { completeConstruction, siteNeeds, updateVillagers } from './sim/villager';
import {
  campProblem,
  canChooseCamp,
  chooseCamp,
  commonsOf,
  protectedBuilding,
} from './sim/founding';
import { updateWildlife, rebuildHabitat } from './sim/wildlife';
import { updatePopulation } from './sim/population';
import { updateGoals, availableToBuild, atBuildLimit, buildLimit } from './sim/goals';
import { journal, toast, updateToasts } from './sim/journal';
import {
  fishQuality,
  fishSpotsInRange,
  nearWater,
  rockInRange,
  tileAt,
  touchesRock,
  updateTerrain,
} from './world/terrain';
import { toScreenX, toScreenY } from './world/iso';
import { Camera } from './render/camera';
import { Renderer, type RenderOptions } from './render/renderer';
import { BAND_META, MOONSET, SUNSET, bandOf, celestial, clockFor } from './render/sky';
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
  | { kind: 'demolish' }
  /**
   * Moving a building that already stands. Carries the building's id rather
   * than its kind, because what is being placed is a *particular* quarry with a
   * level, a name and two people working at it — not another quarry.
   */
  | { kind: 'relocate'; id: number }
  /** Only ever armed during founding: the player choosing where it all starts. */
  | { kind: 'camp' };

export interface Selection {
  kind: 'villager' | 'animal' | 'building' | 'tile' | null;
  id: number;
  /** Tile coordinates, only meaningful when kind is 'tile'. */
  x?: number;
  y?: number;
}

const AUTOSAVE_INTERVAL = 30;

export class Game {
  state: GameState;
  camera = new Camera();
  renderer: Renderer;
  settings: Settings = { ...DEFAULT_SETTINGS };

  tool: Tool = { kind: 'none' };
  selection: Selection = { kind: null, id: 0 };
  hover: { x: number; y: number } | null = null;
  /**
   * The same cursor, in world pixels rather than tiles. The tile answers what
   * ground is under the pointer; this answers what *art* is, which is a
   * different question the moment a roof is drawn over the tiles behind it —
   * and it is the one the hover fade asks.
   */
  hoverPx: { x: number; y: number } | null = null;
  /**
   * Set while the cursor is on the sun or the moon, so the interface can put a
   * word to what it is. Read every frame rather than pushed through `notify()`:
   * a full refresh on every pointer move to reposition one tooltip is a great
   * deal of work for a label.
   */
  skyHover: { x: number; y: number; body: 'sun' | 'moon' } | null = null;
  cleanMode = false;
  slotId: string;
  slotName: string;

  /**
   * Whether placing something takes two steps: choose the tile, look at it,
   * then confirm. Set by the interface from the pointer type. A mouse commits
   * on click because the cursor has already shown you the ghost for as long as
   * you cared to look; a finger has shown you nothing until it lands, and it
   * lands on top of the very thing it is aiming at.
   */
  requireConfirm = false;
  /** The tile being considered, while a placement is waiting to be confirmed. */
  candidate: { x: number; y: number } | null = null;
  /** The building the player has asked to remove, pending confirmation. */
  demolishTarget = 0;
  /**
   * Why the last attempt did not work, in words. Kept until the player does
   * something else: a thud says only that something was refused.
   */
  blockReason: string | null = null;

  /** Notifies the interface that something worth redrawing has changed. */
  onChange: (() => void) | null = null;
  /**
   * Fired only when the player clicks a building on the map, so the interface
   * can open its panel. Deliberately not fired by `place()` — popping a panel
   * over the map after every placement would fight laying out a row of houses.
   */
  onBuildingClicked: ((id: number) => void) | null = null;

  private dragging = false;
  private dragMoved = false;
  private lastPointer = { x: 0, y: 0 };
  /** Live touch/mouse points, so two fingers can be told from one. */
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  /** What kind of device the current wheel gesture came from, locked while it runs. */
  private wheelMode: 'wheel' | 'trackpad' | 'pinch' = 'wheel';
  private wheelAt = 0;
  private zoomAcc = 0;
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

    this.centerOnHeart();
    this.camera.zoomIndex = 1;
    this.rebuildTileFlags();
    rebuildHabitat(this.state);
    this.attachInput(canvas);

    // Before there is anything to look at, the person is the view — and the
    // opening is a walk, so the camera goes with them.
    if (this.state.founding.stage === 'arriving' && this.state.founderId) {
      this.camera.follow('villager', this.state.founderId);
    }

    if (this.state.journal.length === 0) {
      journal(this.state, 'A traveller came ashore with nothing, and did not leave.', '✦');
    }
  }

  /**
   * Wherever the kingdom's middle is today, which is the commons at whatever it
   * has grown into. Before the camp is sited there is no landmark at all, so it
   * falls back to the founder — who is, at that point, the only thing worth
   * looking at.
   */
  private centerOnHeart(glide = false): void {
    const g = this.state;
    const camp = commonsOf(g) ?? g.buildings[0];
    const founder = villagerById(g, g.founderId) ?? g.villagers[0];
    const spot = camp
      ? { x: camp.x + Math.floor(BUILDINGS[camp.def].w / 2), y: camp.y + Math.floor(BUILDINGS[camp.def].h / 2) }
      : founder
        ? { x: Math.round(founder.x), y: Math.round(founder.y) }
        : { x: g.w / 2, y: g.h / 2 };
    if (glide) this.centerOn(spot.x, spot.y);
    else this.camera.centerOnTile(spot.x, spot.y);
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
    this.candidate = null;
    this.demolishTarget = 0;
    this.blockReason = null;
    this.camera.stopFollowing();
    // Survey this kingdom's land at once so the habitat scores are never the
    // previous kingdom's. The pacing came in with the state and is left alone.
    rebuildHabitat(state);
    this.rebuildTileFlags();
    this.renderer.invalidateGround();
    this.centerOnHeart();
    if (state.founding.stage === 'arriving' && state.founderId) {
      this.camera.follow('villager', state.founderId);
    }
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

    this.syncFoundingTool();
    this.camera.update(realDt, this.followTarget(), g.w, g.h);
    this.updateAudio(realDt);
  }

  /**
   * The founding's one placement puts itself on the cursor rather than in a
   * menu: the campsite marker arms while the founder waits to be told where to
   * stop, and at that moment it is the only thing the player can do at all. It
   * cannot be dismissed, and it comes off the moment the ground is picked.
   */
  private syncFoundingTool(): void {
    const choosing = this.state.founding.stage === 'choosing';
    if (choosing && this.tool.kind !== 'camp') this.setTool({ kind: 'camp' });
    else if (!choosing && this.tool.kind === 'camp') this.cancelTool();
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
    this.hearSplashes(g);
  }

  /**
   * A fish landing, once each and quieter the further off it is.
   *
   * Fired from here rather than from the sim, because whether a splash is worth
   * hearing depends on where the camera is looking and the sim has no opinion
   * about that. `heard` is set on the record itself: the list is transient and
   * never saved, so a flag on it costs nothing and is the only way to be sure
   * one splash makes one sound however many frames it lives for.
   */
  private hearSplashes(g: GameState): void {
    for (const s of g.splashes) {
      if (s.heard) continue;
      s.heard = true;
      const dx = toScreenX(s.x, s.y) - this.camera.x;
      const dy = toScreenY(s.x, s.y) - this.camera.y;
      const d = Math.hypot(dx, dy);
      if (d > 520) continue;
      audio.splash((s.jump ? 0.055 : 0.03) * (1 - d / 520));
    }
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
      showActivity: this.settings.showActivity && !this.cleanMode,
      showMarks: !this.cleanMode,
      showGrid: this.tool.kind === 'build' || this.tool.kind === 'camp' || this.tool.kind === 'relocate',
      selection: this.selection,
      hover: this.hover,
      hoverPx: this.hoverPx,
      ghost: null,
      marker: null,
      range: null,
      demolish: this.tool.kind === 'demolish',
    };

    // With confirmation on, the chosen tile is the preview and stays put; a
    // stale hover left behind by a finger would otherwise draw a second ghost.
    const spot = this.requireConfirm ? this.candidate : this.hover;
    if (this.tool.kind === 'build' && spot) {
      const { x, y } = spot;
      opts.ghost = { def: this.tool.def, x, y, valid: this.canPlace(this.tool.def, x, y) };
    }
    if (this.tool.kind === 'relocate' && spot) {
      const b = buildingById(this.state, this.tool.id);
      if (b) {
        const { x, y } = spot;
        opts.ghost = { def: b.def, x, y, valid: this.relocateProblem(b, x, y) === null };
      }
    }
    if (this.tool.kind === 'camp' && spot) {
      const { x, y } = spot;
      opts.marker = { x, y, valid: canChooseCamp(this.state, x, y) };
    }
    // A building whose worth depends on what is around it shows what would be
    // around it, before the decision rather than after: a lodge with no trees
    // inside its ring is the one placement mistake that looks perfectly fine.
    const ranged = this.rangePreview(spot);
    if (ranged) opts.range = ranged;
    if (this.demolishTarget) opts.selection = { kind: 'building', id: this.demolishTarget };

    this.renderer.render(this.state, this.camera, opts, realDt);
  }

  /**
   * The working area to draw, if the thing being placed or moved has one. The
   * ring is centred on the footprint's middle — the same point the planner
   * measures from — so what is shown and what the workers will actually reach
   * are the same circle rather than two near-misses.
   */
  private rangePreview(spot: { x: number; y: number } | null): RenderOptions['range'] {
    if (!spot) return null;
    let def: BuildingId | null = null;
    let level = 1;
    if (this.tool.kind === 'build') def = this.tool.def;
    else if (this.tool.kind === 'relocate') {
      const b = buildingById(this.state, this.tool.id);
      if (!b) return null;
      def = b.def;
      level = b.level;
    }
    if (!def) return null;
    const d = BUILDINGS[def];
    // Three things draw a ring, and they mark different ground inside it: a
    // lodge marks the trees its people will walk to, a mine marks the rock its
    // seam runs through, and a hut marks the water worth casting into.
    // Everything else has no reach worth showing.
    if (!d.harvests && !d.extracts && !d.fishes) return null;
    return {
      cx: spot.x + (d.w - 1) / 2,
      cy: spot.y + (d.h - 1) / 2,
      radius: rangeOf(def, level),
      prop: d.harvests ?? null,
      terrain: d.extracts ? 'rocky' : null,
      spots: !!d.fishes,
    };
  }

  /**
   * What a building of this kind would have inside its reach if it stood here —
   * live nodes for a lodge, rocky tiles for a mine. The placement bar says the
   * number out loud, because a ring with four trees in it and a ring with forty
   * look much the same at a glance.
   */
  nodesInRange(def: BuildingId, level: number, x: number, y: number): number {
    const d = BUILDINGS[def];
    const g = this.state;
    const cx = x + (d.w - 1) / 2;
    const cy = y + (d.h - 1) / 2;
    const r = rangeOf(def, level);
    if (d.extracts) return rockInRange(g, cx, cy, r);
    if (d.fishes) return this.spotsInRange(def, level, x, y).good;
    if (!d.harvests) return 0;
    let n = 0;
    for (let ty = Math.max(0, Math.floor(cy - r)); ty <= Math.min(g.h - 1, Math.ceil(cy + r)); ty++)
      for (let tx = Math.max(0, Math.floor(cx - r)); tx <= Math.min(g.w - 1, Math.ceil(cx + r)); tx++) {
        const t = g.tiles[ty * g.w + tx];
        if (t.prop !== d.harvests || t.amount <= 0) continue;
        if ((tx - cx) ** 2 + (ty - cy) ** 2 > r * r) continue;
        n++;
      }
    return n;
  }

  /**
   * The water a hut standing here would be working: how much of it there is at
   * all, and how much of it is worth the walk. Two numbers rather than one,
   * because they answer different questions — "will this work" and "how well" —
   * and a hut on a mile of empty coast is a perfectly valid slow hut.
   */
  spotsInRange(def: BuildingId, level: number, x: number, y: number): { total: number; good: number } {
    const d = BUILDINGS[def];
    return fishSpotsInRange(
      this.state,
      x + (d.w - 1) / 2,
      y + (d.h - 1) / 2,
      rangeOf(def, level),
    );
  }

  /**
   * How settled the water inside a hut's reach is, averaged over the spots
   * worth casting into. This is the one number that moves while you watch: a
   * hut being worked hard sits in the seventies and comes back up overnight,
   * which is the visible form of "spots recover" and the only place the player
   * is ever shown it as a figure.
   */
  spotRest(b: Building): number {
    const g = this.state;
    const d = BUILDINGS[b.def];
    const cx = b.x + (d.w - 1) / 2;
    const cy = b.y + (d.h - 1) / 2;
    const r = rangeOf(b.def, b.level);
    let sum = 0;
    let n = 0;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(g.h - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(g.w - 1, Math.ceil(cx + r)); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        if (fishQuality(g, x, y) < GOOD_SPOT) continue;
        sum += g.tiles[y * g.w + x].fish;
        n++;
      }
    return n === 0 ? 1 : sum / n;
  }

  /**
   * Tells a building what to concentrate on. Free, instant and reversible: no
   * work is thrown away, nobody is reassigned, and setting it back to Balanced
   * costs exactly as little as setting it in the first place.
   */
  setFocus(id: number, focus: string): void {
    const b = buildingById(this.state, id);
    if (!b) return;
    const allowed = focusOptions(b.def, b.level);
    if (!allowed.includes(focus as Focus)) return;
    b.focus = focus as Focus;
    // Everybody there re-decides at once, or the change does not visibly happen
    // until whoever is mid-stint finishes it.
    for (const wid of b.workers) {
      const v = villagerById(this.state, wid);
      if (v) abandonPlan(this.state, v);
    }
    this.notify();
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private attachInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      audio.ensure();
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Capture can refuse the pointer; losing it must not abort the gesture.
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable — dragging still works, it just ends at the edge */
      }
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.dragMoved = false;

      if (e.button === 2 || e.button === 1) {
        this.cancelTool();
        return;
      }
      if (this.pointers.size >= 2) {
        // Second finger down: this is a pinch, not a drag and not a tap.
        this.dragging = false;
        this.dragMoved = true;
        this.pinchDist = this.spanOfPointers();
        return;
      }
      this.dragging = true;
    });

    canvas.addEventListener('pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size >= 2) {
        this.handlePinch();
        return;
      }

      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      const was = this.hover;
      this.hover = this.tileUnder(e.clientX, e.clientY);
      this.hoverPx = this.worldUnder(e.clientX, e.clientY);
      // There is no hover on a touchscreen, only a drag that has not finished.
      // A finger passing over the sun would otherwise leave the tip up.
      this.skyHover = e.pointerType === 'touch' ? null : this.skyUnder(e.clientX, e.clientY);
      // Hovering does not normally concern the interface — the ghost is drawn
      // by the renderer, which reads `hover` every frame anyway. It concerns it
      // for exactly one thing: the placement hint counts the trees under the
      // cursor, and a count that only changes when you click is not a count.
      if (this.hover && (!was || was.x !== this.hover.x || was.y !== this.hover.y) && this.hintFollowsCursor()) {
        this.notify();
      }

      if (this.dragging && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
        this.dragMoved = true;
        const k = this.renderer.dpr / this.renderer.scale;
        this.camera.pan(-dx * k, -dy * k);
      }
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });

    const endPointer = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      // Lifting one finger of a pinch must not make the other one jump.
      const rest = this.pointers.values().next().value;
      if (rest) this.lastPointer = { x: rest.x, y: rest.y };
    };

    canvas.addEventListener('pointerup', (e) => {
      const wasDragging = this.dragging;
      const moved = this.dragMoved;
      endPointer(e);
      this.dragging = false;
      if (!wasDragging || moved || e.button !== 0) return;
      this.handleClick(e.clientX, e.clientY);
    });

    canvas.addEventListener('pointercancel', (e) => {
      endPointer(e);
      this.dragging = false;
    });

    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.hoverPx = null;
      this.skyHover = null;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

    canvas.addEventListener('dblclick', (e) => {
      const hit = this.pickEntity(e.clientX, e.clientY);
      if (hit.kind === 'villager') this.camera.follow('villager', hit.id);
      else if (hit.kind === 'animal') this.camera.follow('animal', hit.id);
      this.notify();
    });
  }

  // -------------------------------------------------------------------------
  // Zoom and pan gestures
  // -------------------------------------------------------------------------

  private spanOfPointers(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private midpointOfPointers(): { x: number; y: number } {
    const pts = [...this.pointers.values()];
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }

  /** Two fingers: drag the midpoint to pan, spread or squeeze to change zoom. */
  private handlePinch(): void {
    const mid = this.midpointOfPointers();
    const span = this.spanOfPointers();

    const dx = mid.x - this.lastPointer.x;
    const dy = mid.y - this.lastPointer.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      const k = this.renderer.dpr / this.renderer.scale;
      this.camera.pan(-dx * k, -dy * k);
    }
    this.lastPointer = mid;

    // Zoom is stepped, so a pinch has to travel a good way before it clicks
    // over — otherwise the world jumps about while you are still settling.
    if (this.pinchDist > 0 && span > 0) {
      const ratio = span / this.pinchDist;
      if (ratio > 1.3 || ratio < 0.77) {
        this.camera.zoomBy(ratio > 1 ? 1 : -1, this.worldUnder(mid.x, mid.y));
        this.pinchDist = span;
        this.notify();
      }
    }
  }

  /**
   * Scrolling zooms, on every device. What changes per device is how far the
   * gesture has to travel for one step: a mouse wheel emits rare, large,
   * quantised notches and should move a level each time, while a trackpad emits
   * a stream of small deltas and would otherwise blow through every level in
   * one flick. So the delta is accumulated against a threshold picked from what
   * the gesture looks like, and the threshold is locked in for its duration —
   * deciding per event let a single swipe change its mind halfway through.
   */
  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const now = performance.now();
    if (now - this.wheelAt > 180) {
      this.zoomAcc = 0;
      // Pinch arrives as ctrl+wheel with very small deltas; a real wheel comes
      // in line mode or as a lone vertical jump of 50 pixels or more.
      this.wheelMode = e.ctrlKey ? 'pinch' : e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50 ? 'wheel' : 'trackpad';
    }
    this.wheelAt = now;

    const anchor = this.worldUnder(e.clientX, e.clientY);

    if (this.wheelMode === 'wheel') {
      // One notch is one level, whatever size delta this particular mouse
      // reports — 120 on a Mac, 53 on some Windows mice. Spinning fast still
      // moves fast, because a fast spin is simply more notches.
      if (e.deltaY !== 0) {
        this.camera.zoomBy(e.deltaY < 0 ? 1 : -1, anchor);
        this.notify();
      }
      this.hover = this.tileUnder(e.clientX, e.clientY);
      this.hoverPx = this.worldUnder(e.clientX, e.clientY);
      return;
    }

    // Line and page modes report in rows and screens rather than pixels.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const step = this.wheelMode === 'pinch' ? 24 : 90;

    this.zoomAcc += e.deltaY * unit;
    while (Math.abs(this.zoomAcc) >= step) {
      const dir = this.zoomAcc < 0 ? 1 : -1;
      this.zoomAcc -= this.zoomAcc < 0 ? -step : step;
      this.camera.zoomBy(dir, anchor);
      this.notify();
    }
    this.hover = this.tileUnder(e.clientX, e.clientY);
    this.hoverPx = this.worldUnder(e.clientX, e.clientY);
  }

  /** True when the tile under the cursor changes what the placement hint says. */
  private hintFollowsCursor(): boolean {
    if (this.requireConfirm) return false; // A tap sets a candidate; hover means nothing.
    // Anything whose worth depends on the ground under it. All three of these
    // say a number out loud while you move the cursor, and a number that only
    // changes when you click is not a number anybody can shop with — which the
    // mine has quietly been doing since its ring was added.
    const counts = (def: BuildingId) => {
      const d = BUILDINGS[def];
      return !!d.harvests || !!d.extracts || !!d.fishes;
    };
    if (this.tool.kind === 'build') return counts(this.tool.def);
    if (this.tool.kind === 'relocate') {
      const b = buildingById(this.state, this.tool.id);
      return !!b && counts(b.def);
    }
    return false;
  }

  /** Zoom a step from the interface, anchored on the middle of the view. */
  zoomStep(delta: number): void {
    this.camera.zoomBy(delta);
    this.notify();
  }

  private handleClick(cssX: number, cssY: number): void {
    if (this.tool.kind === 'camp') {
      const t = this.tileUnder(cssX, cssY);
      if (!t) return;
      if (this.requireConfirm) {
        // Even a hopeless tile is worth taking: the marker lands, and the bar
        // explains what is wrong with it. Nothing to hear, everything to read.
        this.candidate = t;
        this.blockReason = campProblem(this.state, t.x, t.y);
        if (this.blockReason) audio.thud(0.6, 0.03);
        else audio.tick();
        this.notify();
        return;
      }
      this.commitCamp(t.x, t.y);
      return;
    }
    if (this.tool.kind === 'build') {
      const t = this.tileUnder(cssX, cssY);
      if (!t) return;
      if (this.requireConfirm) {
        this.candidate = t;
        this.blockReason = this.placeProblem(this.tool.def, t.x, t.y);
        if (this.blockReason) audio.thud(0.6, 0.03);
        else audio.tick();
        this.notify();
        return;
      }
      this.place(this.tool.def, t.x, t.y);
      return;
    }
    if (this.tool.kind === 'relocate') {
      const t = this.tileUnder(cssX, cssY);
      if (!t) return;
      const b = buildingById(this.state, this.tool.id);
      if (!b) {
        this.cancelTool();
        return;
      }
      if (this.requireConfirm) {
        this.candidate = t;
        this.blockReason = this.relocateProblem(b, t.x, t.y);
        if (this.blockReason) audio.thud(0.6, 0.03);
        else audio.tick();
        this.notify();
        return;
      }
      this.relocate(b.id, t.x, t.y);
      return;
    }
    if (this.tool.kind === 'demolish') {
      const t = this.tileUnder(cssX, cssY);
      if (t) this.demolishAt(t.x, t.y);
      return;
    }
    const hit = this.pickEntity(cssX, cssY);
    this.selection = hit;
    this.meet(hit);
    // Clicking anything that is not a person or an animal breaks the follow.
    if (hit.kind !== 'villager' && hit.kind !== 'animal') this.camera.stopFollowing();
    audio.tick();
    this.notify();
    if (hit.kind === 'building') this.onBuildingClicked?.(hit.id);
  }

  private tileUnder(cssX: number, cssY: number): { x: number; y: number } | null {
    const rect = this.renderer.canvas.getBoundingClientRect();
    const g = this.renderer.screenToGrid(cssX - rect.left, cssY - rect.top);
    const x = Math.round(g.x);
    const y = Math.round(g.y);
    if (x < 0 || y < 0 || x >= this.state.w || y >= this.state.h) return null;
    return { x, y };
  }

  /**
   * The sun or moon, if the cursor is on it. Generous by a few pixels, and by a
   * floor of sixteen besides: the moon is a small target near the rim, and
   * pointing at it exactly is not a skill this game asks anybody for.
   */
  private skyUnder(cssX: number, cssY: number): { x: number; y: number; body: 'sun' | 'moon' } | null {
    const pos = this.renderer.skyBodyOnScreen(this.state);
    if (!pos) return null;
    const rect = this.renderer.canvas.getBoundingClientRect();
    const dx = cssX - rect.left - pos.x;
    const dy = cssY - rect.top - pos.y;
    const r = Math.max(16, pos.r);
    if (dx * dx + dy * dy > r * r) return null;
    return { x: pos.x + rect.left, y: pos.y + rect.top, body: pos.body };
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
      // Bare ground is still worth reading, so it selects rather than clearing.
      if (tile) return { kind: 'tile', id: 0, x: t.x, y: t.y };
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
      if (totalOf(this.state, res) - (reserved[res] ?? 0) < (cost[res] ?? 0)) return false;
    }
    return true;
  }

  canPlace(def: BuildingId, x: number, y: number): boolean {
    return this.placeProblem(def, x, y) === null;
  }

  /**
   * Why this building will not go here, in the words the player reads, or null
   * when it will. Written the same way as `campProblem`: it says what is wrong
   * rather than restating the rule, because "not on water" is an answer and
   * "buildings require buildable ground" is not.
   */
  placeProblem(def: BuildingId, x: number, y: number): string | null {
    const g = this.state;
    const d = BUILDINGS[def];
    if (!availableToBuild(g, def)) return 'The kingdom cannot build that just yet.';
    const limit = this.buildLimitOf(def);
    if (limit.built >= limit.max) return this.limitReason(def);

    const ground = this.footprintProblem(def, x, y, 0);
    if (ground) return ground;

    // Materials promised to sites that have not been supplied yet are already
    // spoken for, so this is what is genuinely free rather than what is stacked.
    return this.affordProblem(d.cost);
  }

  /**
   * Why this ground will not take a footprint of this size, or null when it
   * will. Shared by building and by moving, since the ground does not care
   * which of the two is happening; `ignoreId` lets a move overlook the building
   * that is doing the moving, though in practice it never overlaps its own
   * corner because moving onto yourself is refused outright.
   */
  private footprintProblem(def: BuildingId, x: number, y: number, ignoreId: number): string | null {
    const g = this.state;
    const d = BUILDINGS[def];
    for (let dy = 0; dy < d.h; dy++)
      for (let dx = 0; dx < d.w; dx++) {
        const t = tileAt(g, x + dx, y + dy);
        if (!t) return 'Part of it would hang off the edge of the world.';
        if (t.terrain === 'water' || t.terrain === 'shallow') return 'Nothing gets built standing in the water.';
        if (t.building && t.building !== ignoreId) {
          const other = buildingById(g, t.building);
          const name = other ? buildingName(other.def, other.level).toLowerCase() : 'something';
          return `The ${name} is already there. Somewhere clear.`;
        }
        if (t.plot && t.plot !== ignoreId) return 'A farm plot is in the way.';
      }
    // The mine works the ground it stands on, so it has to be standing on some.
    // Said as a fact about this spot rather than as a rule, like every other
    // refusal here — and with the thing to look for, since rocky ground is not
    // always obvious at a glance from three zoom levels out.
    if (d.needsRock && !touchesRock(g, x, y, d.w, d.h)) {
      return 'No rock here to work. It has to sit on rocky ground, or right against it.';
    }
    // The same shape of rule for the hut, and said the same way: what is wrong
    // with this spot, not what the rule is. The lake and the sea both count, so
    // the answer is never "you cannot build one of these here" — it is "not
    // here", and there is always a shoreline somewhere.
    if (d.fishes && !nearWater(g, x, y, d.w, d.h)) {
      return 'No water within reach of this. It wants to stand on the bank — the lake or the coast, either one.';
    }
    return null;
  }

  /** Whether the kingdom can actually cover a cost, in the words the player reads. */
  private affordProblem(cost: Partial<Record<ResourceId, number>>): string | null {
    const g = this.state;
    const reserved = this.reservedMaterials();
    const short: string[] = [];
    for (const k in cost) {
      const res = k as ResourceId;
      const free = totalOf(g, res) - (reserved[res] ?? 0);
      const want = cost[res] ?? 0;
      if (free < want) short.push(`${Math.ceil(want - free)} more ${res}`);
    }
    if (!short.length) return null;
    return `Not enough in storage — it needs ${short.length === 2 ? `${short[0]} and ${short[1]}` : short.join(', ')}.`;
  }

  /** How many of a kind stand, and how many may. For the menu and the refusals. */
  buildLimitOf(def: BuildingId): { built: number; max: number } {
    return buildLimit(this.state, def);
  }

  /**
   * Why there cannot be another of these, said as a fact about the kingdom
   * rather than as a rule — and always with the way out attached, because the
   * answer for a unique building is not "no" but "move the one you have".
   */
  private limitReason(def: BuildingId): string {
    const d = BUILDINGS[def];
    const { max } = this.buildLimitOf(def);
    if (d.unique) {
      return `There is only ever one ${d.name.toLowerCase()}. Open the one you have and move it instead.`;
    }
    const kind = max === 1 ? d.name.toLowerCase() : `${d.name.toLowerCase()}s`;
    // A comfort's ceiling is its own and nothing raises it — the way out is to
    // take one down and put it somewhere better, which is the whole game those
    // limits are there to make.
    if (d.maxTotal !== undefined) {
      return `The kingdom keeps ${max} ${kind}. Take one down if you would rather have it elsewhere.`;
    }
    return `The kingdom keeps ${max} ${kind} at a time. Improving the commons allows another.`;
  }

  /** The founding campsite rule, so the interface has one place to ask. */
  campProblem(x: number, y: number): string | null {
    return campProblem(this.state, x, y);
  }

  place(def: BuildingId, x: number, y: number): boolean {
    const problem = this.placeProblem(def, x, y);
    if (problem) {
      this.blockReason = problem;
      audio.thud(0.6, 0.03);
      this.notify();
      return false;
    }
    this.blockReason = null;
    this.candidate = null;
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
        // Clearing ground for a building returns a little of what was there —
        // except that a boulder shifted by people with no quarry is a boulder
        // rolled aside and left, not stone. Stone has exactly one source, and
        // building on top of the rock is not a way round it.
        if (t.prop === 'tree' && t.amount > 0) this.putBack('wood', Math.floor(t.amount * 0.4), x, y);
        if (t.prop === 'boulder' && t.amount > 0 && this.hasQuarry()) {
          this.putBack('stone', Math.floor(t.amount * 0.4), x, y);
        }
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
    // The tool stays armed for anything there is room to build again — laying
    // out a row of lanterns should not mean going back to the menu eight times.
    // It lets go the moment there can be no more of that kind, which is most of
    // them: a cursor still holding a quarry the kingdom is not allowed a second
    // of can do nothing but refuse, and the row it came from is greyed out
    // behind it. The campsite lets go too, and is not built through here.
    if (atBuildLimit(g, def)) this.cancelTool();
    this.notify();
    return true;
  }

  // -------------------------------------------------------------------------
  // Moving a building that already stands
  // -------------------------------------------------------------------------

  /** Whether this building is the sort that can be moved at all. */
  canRelocate(b: Building): boolean {
    return this.relocateBlock(b) === null;
  }

  /** Why this building is staying where it is, or null when it need not. */
  relocateBlock(b: Building): string | null {
    const def = BUILDINGS[b.def];
    if (b.def === 'commons') return 'The commons stands where the kingdom began. It does not move.';
    /*
     * "Build another and take this one down" is only an answer when taking it
     * down is actually allowed, and `holdingProblem` refuses that outright while
     * a building holds anything. So a building that is the home of something can
     * be moved whether or not it is unique — otherwise a storehouse in the wrong
     * place fills with a thousand wood and can then be neither moved nor
     * removed, which is a corner the player cannot get out of.
     *
     * It reads as one rule rather than a list because it is one: a building you
     * cannot rebuild elsewhere is a building you can carry.
     */
    if (!def.unique && holdsOf(b.def, b.level).length === 0)
      return `There can be more than one ${def.name.toLowerCase()}, so build one where you want it and take this down.`;
    if (b.stage !== 'done') return 'It is not finished yet.';
    if (b.upgrading) return 'It is being improved. One thing at a time.';
    if (b.movingTo) return 'It is already on its way somewhere.';
    return null;
  }

  /** Arms the tool that asks where a building should stand instead. */
  startRelocate(id: number): void {
    const b = buildingById(this.state, id);
    if (!b) return;
    const why = this.relocateBlock(b);
    if (why) {
      this.blockReason = why;
      audio.thud(0.6, 0.03);
      this.notify();
      return;
    }
    this.setTool({ kind: 'relocate', id });
  }

  /** Why this building will not stand there, or null when it will. */
  relocateProblem(b: Building, x: number, y: number): string | null {
    const why = this.relocateBlock(b);
    if (why) return why;
    if (x === b.x && y === b.y) return 'That is where it already is.';
    const ground = this.footprintProblem(b.def, x, y, 0);
    if (ground) return ground;
    return this.affordProblem(relocateCost(b.def));
  }

  /**
   * Lays out the new ground and leaves the old building alone.
   *
   * Nothing is torn down and nothing stops: the destination is an ordinary
   * construction site, so General Workers carry materials to it and build it exactly as
   * they would anything else, while the quarry goes on producing stone the
   * whole time. The building only steps across when the site is finished, in
   * `completeConstruction`. That ordering is the point of the feature — the
   * alternative loses you the only quarry halfway through moving it.
   */
  relocate(id: number, x: number, y: number): boolean {
    const g = this.state;
    const b = buildingById(g, id);
    if (!b) return false;
    const problem = this.relocateProblem(b, x, y);
    if (problem) {
      this.blockReason = problem;
      audio.thud(0.6, 0.03);
      this.notify();
      return false;
    }

    const d = BUILDINGS[b.def];
    const site = makeBuilding(g, b.def, x, y, rng);
    site.stage = 'building';
    site.relocOf = b.id;
    b.movingTo = site.id;
    g.buildings.push(site);

    for (let dy = 0; dy < d.h; dy++)
      for (let dx = 0; dx < d.w; dx++) {
        const t = tileAt(g, x + dx, y + dy);
        if (!t) continue;
        t.building = site.id;
        if (d.solid) t.blocked = true;
        // Clearing ground gives back what clearing ground always gives back.
        if (t.prop === 'tree' && t.amount > 0) this.putBack('wood', Math.floor(t.amount * 0.4), x, y);
        if (t.prop === 'boulder' && t.amount > 0 && this.hasQuarry()) {
          this.putBack('stone', Math.floor(t.amount * 0.4), x, y);
        }
        t.prop = null;
        t.amount = 0;
        t.regrow = 0;
      }
    this.renderer.invalidateGround();

    for (const v of g.villagers) {
      const vx = Math.round(v.x);
      const vy = Math.round(v.y);
      if (vx >= x && vx < x + d.w && vy >= y && vy < y + d.h) abandonPlan(g, v);
    }

    this.blockReason = null;
    this.candidate = null;
    const name = buildingName(b.def, b.level);
    toast(g, `The ${name.toLowerCase()} is moving — it keeps working until the new one is ready`, '🧭', 'info');
    audio.thud(1.2, 0.05);
    // Unlike laying out a row of houses, there is exactly one of these to place,
    // so the tool lets go the moment the ground is chosen.
    this.cancelTool();
    this.notify();
    return true;
  }

  /** Abandons a move under way, leaving the building where it has been all along. */
  cancelRelocation(id: number): void {
    const b = buildingById(this.state, id);
    const site = b?.movingTo ? buildingById(this.state, b.movingTo) : null;
    if (!b || !site) return;
    // Whatever was carried over goes back where that sort of thing is kept
    // rather than into the ground: nothing in this game is ever taken away for
    // changing your mind.
    for (const k in site.delivered) {
      const res = k as ResourceId;
      this.putBack(res, site.delivered[res] ?? 0, site.x, site.y);
    }
    removeBuildingFromMap(this.state, site);
    b.movingTo = undefined;
    this.renderer.invalidateGround();
    toast(this.state, `The ${buildingName(b.def, b.level).toLowerCase()} is staying put`, '🧭', 'info');
    this.notify();
  }

  /**
   * Puts something into whichever building keeps that sort of thing, nearest to
   * a point. For the odds and ends nobody is carrying: what clearing ground
   * turns up, and half of what a demolished building cost.
   *
   * Clipped by the compartment, and that is honest rather than lossy — a
   * kingdom with a full woodpile and a tree in the way of its new cabin leaves
   * the timber where it falls. Nothing that was already *in* storage can be
   * lost this way; `askDemolish` refuses to take down a building holding goods.
   */
  private putBack(res: ResourceId, qty: number, x: number, y: number): void {
    if (qty <= 0) return;
    const home = homeFor(this.state, res, x, y);
    if (home) deposit(this.state, home, res, qty);
  }

  /** True once there is a quarry standing — the kingdom's only source of stone. */
  private hasQuarry(): boolean {
    return this.state.buildings.some((b) => b.def === 'quarry' && b.stage === 'done');
  }

  /**
   * Picking a building to remove never removes it. Taking something down is the
   * one action here that cannot be undone by waiting, and a mis-tap on a phone
   * is a certainty rather than a risk, so this only ever proposes.
   */
  demolishAt(x: number, y: number): void {
    const g = this.state;
    const t = tileAt(g, x, y);
    if (!t) return;
    if (!t.building) {
      this.blockReason = 'Nothing to take down there.';
      this.demolishTarget = 0;
      audio.thud(0.6, 0.03);
      this.notify();
      return;
    }
    const b = buildingById(g, t.building);
    if (b) this.askDemolish(b.id);
  }

  /**
   * Why this building is not coming down while it still has things in it, or
   * null when it has not.
   *
   * Storage lives in buildings now, so demolition is the one action that could
   * destroy goods, and it is not allowed to. Refusing is the only answer that
   * does not either lose the stock or make it reappear somewhere nobody carried
   * it to — and it costs the player nothing but time, since spending what is
   * inside is exactly what they were going to do with it anyway.
   */
  holdingProblem(b: Building): string | null {
    const held = contentsOf(b);
    if (held.length === 0) return null;
    const list = held.map(({ res, qty }) => `${qty} ${RESOURCE_META[res].name.toLowerCase()}`);
    const what = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
    return `The ${buildingName(b.def, b.level).toLowerCase()} still holds ${what}. Nothing here will throw that away — spend it or move it, and this can come down after.`;
  }

  /**
   * Why taking this down would leave the kingdom with nowhere at all to put
   * wood, or null when it would not.
   *
   * Wood is the one material General Workers can still fetch by hand, so it is
   * the one whose home going missing is a trap rather than a pause: a kingdom
   * with no woodpile has people who can fell a tree and nowhere to set the
   * armful down, and no way to build the lodge that would fix it, because that
   * costs wood it cannot hold. Every other resource comes out of a building, so
   * losing the building stops the supply and the shortage stays a shortage.
   *
   * Before the camp's cache retires this can never fire — the camp is a woodpile
   * — which is exactly the pairing it is here to keep honest.
   */
  private lastWoodStoreProblem(b: Building): string | null {
    if (capacityIn(b, 'wood') <= 0) return null;
    const others = this.state.buildings.some((o) => o.id !== b.id && capacityIn(o, 'wood') > 0);
    if (others) return null;
    return `The ${buildingName(b.def, b.level).toLowerCase()} is the only place the kingdom keeps wood, and there would be nowhere to put another armful. Build somewhere else to keep it first — a storehouse will do — and this can come down after.`;
  }

  /** Proposes a removal. The interface asks; `confirmDemolish` carries it out. */
  askDemolish(id: number): void {
    const b = buildingById(this.state, id);
    if (!b) return;
    const kept = protectedBuilding(b) ?? this.holdingProblem(b) ?? this.lastWoodStoreProblem(b);
    if (kept) {
      this.blockReason = kept;
      this.demolishTarget = 0;
      audio.thud(0.6, 0.03);
      this.notify();
      return;
    }
    this.blockReason = null;
    this.demolishTarget = id;
    this.notify();
  }

  confirmDemolish(): void {
    const b = buildingById(this.state, this.demolishTarget);
    this.demolishTarget = 0;
    if (b) this.removeBuilding(b, true);
    else this.notify();
  }

  /** Builds, moves, or makes camp, on the tile the player has been looking at. */
  confirmPlacement(): boolean {
    const spot = this.candidate;
    if (!spot) return false;
    if (this.tool.kind === 'camp') return this.commitCamp(spot.x, spot.y);
    if (this.tool.kind === 'build') return this.place(this.tool.def, spot.x, spot.y);
    if (this.tool.kind === 'relocate') return this.relocate(this.tool.id, spot.x, spot.y);
    return false;
  }

  /** Drops the proposed tile or building without doing anything to the map. */
  clearPending(): void {
    this.candidate = null;
    this.demolishTarget = 0;
    this.blockReason = null;
    this.notify();
  }

  private commitCamp(x: number, y: number): boolean {
    if (!chooseCamp(this.state, x, y)) {
      this.blockReason = campProblem(this.state, x, y);
      audio.thud(0.6, 0.03);
      this.notify();
      return false;
    }
    this.candidate = null;
    this.blockReason = null;
    this.camera.stopFollowing();
    this.camera.glideToTile(x, y);
    audio.chime(4, 0.03);
    this.cancelTool();
    this.notify();
    return true;
  }

  removeBuilding(b: Building, refund: boolean): void {
    const g = this.state;
    const def = BUILDINGS[b.def];
    // Every way of taking a building down comes through here — the demolish
    // tool, and the Remove button on a building's own panel — so the things
    // that stay put are refused in one place.
    const kept = protectedBuilding(b) ?? this.holdingProblem(b);
    if (kept) {
      toast(g, kept, '🔥', 'warn');
      return;
    }

    if (refund) {
      for (const k in def.cost) {
        const res = k as ResourceId;
        const paid = b.stage === 'done' ? def.cost[res] ?? 0 : b.delivered[res] ?? 0;
        this.putBack(res, Math.floor(paid * 0.5), b.x, b.y);
      }
    }
    // Nothing to empty out: `holdingProblem` has already refused anything with
    // stock in it, so a building that gets this far is one somebody has cleared.

    removeBuildingFromMap(g, b);
    if (this.selection.kind === 'building' && this.selection.id === b.id) this.selection = { kind: null, id: 0 };
    this.renderer.invalidateGround();
    audio.thud(0.7, 0.05);
    this.notify();
  }

  // -------------------------------------------------------------------------
  // Operations the interface calls
  // -------------------------------------------------------------------------

  setTool(tool: Tool): void {
    this.tool = tool;
    if (tool.kind !== 'none') this.selection = { kind: null, id: 0 };
    // A tile chosen for one building means nothing to the next one.
    this.candidate = null;
    this.demolishTarget = 0;
    this.blockReason = null;
    this.syncCursor();
    this.notify();
  }

  cancelTool(): void {
    // While the founder is standing about waiting to be told where to stop,
    // there is nothing else to do, so the marker cannot be put away.
    this.tool = this.state.founding.stage === 'choosing' ? { kind: 'camp' } : { kind: 'none' };
    this.candidate = null;
    this.demolishTarget = 0;
    this.blockReason = null;
    this.syncCursor();
    this.notify();
  }

  private syncCursor(): void {
    this.renderer.canvas.classList.toggle('tool-active', this.tool.kind !== 'none');
  }

  select(kind: Selection['kind'], id: number): void {
    this.selection = { kind, id };
    this.meet(this.selection);
    this.notify();
  }

  /**
   * Opening somebody's card is the whole of the acknowledgement a newcomer's
   * mark is waiting for — from the map, from the roster, from anywhere. It is
   * deliberately not cleared by time passing or by the toast going away: the
   * point is that somebody has actually been looked at.
   */
  private meet(sel: Selection): void {
    if (sel.kind !== 'villager') return;
    const v = villagerById(this.state, sel.id);
    if (v) v.met = true;
  }

  /** How many people nobody has looked at yet, for the roster's own tally. */
  newcomers(): number {
    return this.state.villagers.filter((v) => !v.met).length;
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

  /** The view pad's recentre button. */
  recentre(): void {
    this.centerOnHeart(true);
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

  /** Puts a villager into a job slot, or back to General Worker when buildingId is 0. */
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

  /** Moves a villager into a particular bed. Pass 0 to let them settle on their own. */
  setHome(villagerId: number, buildingId: number): boolean {
    const v = villagerById(this.state, villagerId);
    if (!v) return false;
    const before = v.home;
    if (!setVillagerHome(this.state, v, buildingId)) return false;
    const b = buildingById(this.state, v.home);
    if (b && v.home !== before) {
      v.history.push({ day: this.state.day, text: `Moved into the ${buildingName(b.def, b.level).toLowerCase()}.` });
      if (v.history.length > 30) v.history.shift();
    }
    audio.tick();
    this.notify();
    return true;
  }

  /** Fills a building's free slots with the nearest available General Workers. */
  autoStaff(buildingId: number): void {
    const b = buildingById(this.state, buildingId);
    if (!b) return;
    const free = jobSlots(b) - b.workers.length;
    if (free <= 0) return;
    const spare = this.state.villagers
      .filter((v) => v.workplace === 0)
      .sort((p, q) => (p.x - b.x) ** 2 + (p.y - b.y) ** 2 - ((q.x - b.x) ** 2 + (q.y - b.y) ** 2));
    for (let i = 0; i < Math.min(free, spare.length); i++) this.assign(spare[i].id, b.id);
  }

  canUpgrade(b: Building): boolean {
    const def = BUILDINGS[b.def];
    if (b.stage !== 'done' || b.upgrading) return false;
    // Improving a building that is halfway to somewhere else would leave the
    // half-built copy a level behind the thing it is about to become.
    if (b.movingTo) return false;
    if (b.level >= def.maxLevel) return false;
    if (this.upgradeRequirements(b).some((r) => !r.met)) return false;
    const reserved = this.reservedMaterials();
    for (const { res, qty } of this.upgradeCost(b)) {
      if (totalOf(this.state, res) - (reserved[res] ?? 0) < qty) return false;
    }
    return true;
  }

  /**
   * What the kingdom must have *done* before the next improvement, each with
   * whether it has. Shown as a checklist rather than folded into one refusal:
   * "not yet" is only useful with the rest of the sentence attached.
   */
  upgradeRequirements(b: Building): { label: string; met: boolean }[] {
    return upgradeReqsOf(b.def, b.level).map((r) => ({ label: r.label, met: r.met(this.state) }));
  }

  upgrade(buildingId: number): void {
    const b = buildingById(this.state, buildingId);
    if (!b || !this.canUpgrade(b)) return;
    b.upgrading = true;
    b.stage = 'building';
    b.labour = 0;
    b.delivered = {};
    toast(this.state, `${buildingName(b.def, b.level)} improvements started`, '⬆️', 'info');
    this.notify();
  }

  upgradeCost(b: Building): { res: ResourceId; qty: number }[] {
    const cost = upgradeCostOf(b.def, b.level);
    const out: { res: ResourceId; qty: number }[] = [];
    for (const k in cost) out.push({ res: k as ResourceId, qty: cost[k as ResourceId] ?? 0 });
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

  /**
   * How much of one resource the kingdom has and how much room it has for it,
   * with the buildings it is spread across.
   *
   * There is no single figure to replace the old store meter with, and that is
   * the point rather than an omission: "the kingdom is 80% full" was a
   * meaningful sentence about one shared pool and is meaningless about thirteen
   * separate compartments. Every question about room is now a question about a
   * particular resource, so this is what the top bar and the stores sheet ask.
   *
   * Four figures rather than one, because "how much wood is there" has four
   * honest answers and running them together made the capacity beside them a
   * lie. `stored` is in the compartments and is the only one `cap` applies to;
   * `bench` and `carried` are real, owned and countable but answer to no ceiling
   * anywhere; `owned` is the lot, and is what the simulation spends.
   */
  storageInfo(res: ResourceId): {
    stored: number;
    bench: number;
    carried: number;
    owned: number;
    cap: number;
    room: number;
    where: { b: Building; stored: number; bench: number; cap: number }[];
  } {
    const g = this.state;
    const where: { b: Building; stored: number; bench: number; cap: number }[] = [];
    for (const b of g.buildings) {
      const cap = capacityIn(b, res);
      const stored = b.store[res] ?? 0;
      const bench = b.input[res] ?? 0;
      if (cap > 0 || stored > 0 || bench > 0) where.push({ b, stored, bench, cap });
    }
    where.sort((p, q) => q.cap - p.cap || q.stored - p.stored);
    const stored = storedOf(g, res);
    const bench = benchOf(g, res);
    const carried = carriedOf(g, res);
    const cap = capacityOf(g, res);
    return { stored, bench, carried, owned: stored + bench + carried, cap, room: Math.max(0, cap - stored), where };
  }

  /**
   * What the next improvement of a building would add to one of its
   * compartments, or null when it would add nothing. The panel shows this
   * beside the current figure, because "improve it" is the whole answer to
   * "this is full" and the player should not have to work out by how much.
   */
  capacityGain(b: Building, res: ResourceId): number | null {
    const def = BUILDINGS[b.def];
    if (b.level >= def.maxLevel) return null;
    // A step nothing can satisfy is not room the player can go and get. The
    // Deep Mine's next level is the Mithril Mine, and offering "+2,500 if
    // improved" against it would be the panel telling somebody to go and do
    // something the game has no way of letting them do.
    if (upgradeReqsOf(b.def, b.level).some((r) => r.impossible)) return null;
    const now = storesOf(b.def, b.level, b.cacheRetired)[res] ?? 0;
    const then = storesOf(b.def, b.level + 1, b.cacheRetired)[res] ?? 0;
    return then > now ? then - now : null;
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

  selectedTile(): { tile: Tile; x: number; y: number } | null {
    const s = this.selection;
    if (s.kind !== 'tile' || s.x === undefined || s.y === undefined) return null;
    const tile = tileAt(this.state, s.x, s.y);
    return tile ? { tile, x: s.x, y: s.y } : null;
  }

  /** Time of day as a friendly 24-hour clock. Day-fraction 0 is first light. */
  clockLabel(): string {
    return clockFor(this.state.dayT);
  }

  /**
   * What the sun or moon has to say for itself: the hour, which part of the day
   * it is, and when whatever is up there will go. Time of day is the one thing
   * in this game that cannot be hurried, so the panel says what is happening
   * rather than offering anything to do about it.
   */
  skyLabel(): { title: string; time: string; band: string; note: string; doing: string; doingNote: string; until: string } {
    const g = this.state;
    const c = celestial(g.dayT, g.day);
    const band = bandOf(g.dayT);
    const sun = c.body === 'sun';
    // Two different questions, and the tip answers both: what the sky is doing,
    // and what the kingdom is doing under it. The second is what the rule along
    // the bottom of the strip is drawing, named.
    const doing = dayDoing(g.dayT);
    return {
      title: sun ? 'The sun' : 'The moon',
      time: clockFor(g.dayT),
      band: BAND_META[band].name,
      note: BAND_META[band].note,
      doing: doing.name,
      doingNote: doing.note,
      until: sun ? `Sets at ${clockFor(SUNSET)}.` : `Sets at ${clockFor(MOONSET % 1)}.`,
    };
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

