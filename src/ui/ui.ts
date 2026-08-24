/**
 * The interface shell.
 *
 * This file owns three things and delegates everything else: what is currently
 * open, where it goes on this size of screen, and what a click means. The
 * markup for each surface lives beside it — `hud`, `nav`, `goals`, `build`,
 * `inspector`, `modals` — so that adding a panel does not mean editing a
 * two-thousand-line file.
 *
 * The layout comes in two shapes. On a desktop the map keeps the middle, with
 * a build rail on the left, a contextual card on the right, and centred modals
 * for the things that are about the whole kingdom. On a phone there is one
 * bottom navigation bar, one sheet open at a time above it, and a single line
 * of objective under the top strip. Everything reachable on one is reachable on
 * the other.
 *
 * A building is the one panel that changes shape between the two. On a desktop
 * it is a card in the right margin like everybody else you can point at — the
 * map stays live beside it, so the next building is one click away — and on a
 * phone it is a sheet like every other panel. The markup is the same either
 * way; only the host and the chrome differ.
 */

import type { Building, GameState } from '../types';
import { BUILDINGS, buildingName } from '../sim/defs';
import { foundingDone } from '../sim/founding';
import type { Game, Selection } from '../game';
import { audio } from '../audio/audio';
import {
  deleteSlot,
  exportToFile,
  importFromFile,
  listSlots,
  loadFromSlot,
  newSlotId,
  renameSlot,
} from '../save/save';
import { buildingById, newGame, villagerById } from '../sim/state';
import { Focus, keepFocus } from './a11y';
import { cap, el, esc, setHtml, type UIEnv } from './context';
import { iconFor } from './icons';
import { DayStrip } from './daystrip';
import { Hud, populationBody, storesBody } from './hud';
import { KINGDOM_TABS, KTAB, actionsMarkup, viewPadMarkup, type ModalKind, type NavState } from './nav';
import { goalChipMarkup, goalPanelMarkup, goalsBody } from './goals';
import { buildListMarkup, placementBarMarkup, toolHintMarkup } from './build';
import { animalCard, inspectorTitle, tileCard, villagerCard } from './inspector';
import {
  buildingBody,
  buildingFoot,
  buildingTabs,
  journalBody,
  paintPortraits,
  slotsBody,
  soundBody,
  viewBody,
  wildlifeBody,
} from './modals';
import {
  PEOPLE_TABS,
  natureTip,
  peopleBody,
  peopleSub,
  type PeopleFilter,
  type PeopleSort,
  type PeopleView,
} from './people';

/** The pieces a panel is assembled from, wherever it is about to be drawn. */
interface PanelParts {
  title: string;
  sub: string;
  body: string;
  foot: string;
  pic: string;
  tabNames: string[];
}

/** A panel's name and the line under it, which are swapped together. */
function panelHead(parts: PanelParts): string {
  return `${esc(parts.title)}${parts.sub ? `<span class="msub">${parts.sub}</span>` : ''}`;
}

/**
 * The line under the Kingdom panel's title, per tab. Each one says what the tab
 * is for rather than repeating its name, which the tab strip below has already
 * said in bigger type.
 */
const KINGDOM_SUBS = [
  'Everything that has happened here',
  'What has been seen, and what has not',
  'What the kingdom is working towards',
  'Saved kingdoms, viewing and sound',
];

/** Panels that cover the map and take the keyboard with them while they are up. */
const TRUE_MODALS: ModalKind[] = ['people', 'kingdom', 'building', 'stores', 'population'];

export class UI {
  private root: HTMLElement;
  private game: Game;
  private focus: Focus;
  private hud: Hud;
  private dayStrip: DayStrip;

  private env: UIEnv = { compact: false, short: false, touch: false };
  private modal: ModalKind = null;
  /**
   * What was open when the view went out to Overview, waiting to be given back.
   * Null whenever the map is where the player is, which is also how the two
   * halves of the swap tell each other apart.
   */
  private beforeOverview: { modal: ModalKind; buildOpen: boolean; selection: Selection } | null = null;
  private modalTab = 0;
  /** What is currently mounted in the modal host, so a redraw can update in place. */
  private modalMount = '';
  /** The same, for the building panel when it is drawn in the right margin. */
  private railMount = '';
  private buildOpen = false;
  private goalsCollapsed = false;
  private introDismissed = false;
  private lastRender = 0;
  /** The selection the inspector last drew, so a new one can close what covers it. */
  private lastSelection = '';
  /** Which section of the storage sheet the chip that opened it was about. */
  private storesAt = '';
  /**
   * What the roster is showing. Kept here rather than read back off the chips,
   * because the panel is a live view and rebuilds its own markup several times
   * a second — a filter that lived in the DOM would be forgotten every redraw.
   */
  private people: PeopleView = { filter: 'all', sort: 'arrived' };
  /**
   * Whose name is being changed in the roster, if anybody's. One at a time:
   * the row swaps its link for a field, and the live redraw already stands
   * down while a field in the panel has focus, so nothing is yanked mid-word.
   */
  private renamingId = 0;

  // Long-lived hosts.
  private topbar!: HTMLElement;
  private sideLeft!: HTMLElement;
  private sideRight!: HTMLElement;
  private goalsHost!: HTMLElement;
  private dock!: HTMLElement;
  private toolHost!: HTMLElement;
  private navHost!: HTMLElement;
  private toastHost!: HTMLElement;
  private viewHost!: HTMLElement;
  private modalHost!: HTMLElement;
  private introHost!: HTMLElement;
  private skyTip!: HTMLElement;
  private hoverTip!: HTMLElement;
  /** What the floating tip is currently about, so hovering along a row is free. */
  private tipKey = '';
  private cleanT!: HTMLElement;

  constructor(root: HTMLElement, game: Game) {
    this.root = root;
    this.game = game;
    this.root.innerHTML = '';

    // Above the pills rather than behind them: the sun crosses the whole width
    // twice a day, and half of those crossings would be spent behind the clock.
    this.dayStrip = new DayStrip();
    this.root.appendChild(this.dayStrip.el);

    this.topbar = el('div', 'topbar hide-in-clean');
    this.root.appendChild(this.topbar);
    this.hud = new Hud(this.topbar, game);

    this.focus = new Focus(this.root);
    this.buildScaffolding();
    this.watchScreen();

    game.onChange = () => this.refresh();
    game.onBuildingClicked = () => this.setModal('building');
    this.bindKeys();
    this.refresh();
  }

  private get g(): GameState {
    return this.game.state;
  }

  // -------------------------------------------------------------------------
  // Static scaffolding
  // -------------------------------------------------------------------------

  private buildScaffolding(): void {
    this.sideLeft = el('div', 'side left hide-in-clean');
    this.sideRight = el('div', 'side right hide-in-clean');
    this.root.appendChild(this.sideLeft);
    this.root.appendChild(this.sideRight);

    this.goalsHost = el('div', 'goals hide-in-clean');
    this.root.appendChild(this.goalsHost);

    this.toastHost = el('div', 'toasts');
    this.root.appendChild(this.toastHost);

    /*
     * Everything pinned to the bottom edge lives in one column: the active-tool
     * bar, then the navigation. Stacking them by hand meant measuring each one
     * and telling the next how far up to sit, and a hint that ran to four lines
     * on a phone was written straight over by the thing above it.
     */
    this.dock = el('div', 'dock hide-in-clean');
    this.toolHost = el('div', 'tool-hint-host');
    this.navHost = el('div', 'nav-host');
    this.dock.appendChild(this.toolHost);
    this.dock.appendChild(this.navHost);
    this.root.appendChild(this.dock);

    // The one thing that must never be covered: on a touchscreen it is the only
    // way to move the map that does not need a second finger.
    this.viewHost = el('div', 'viewpad hide-in-clean');
    this.root.appendChild(this.viewHost);

    const chip = el('div', 'clean-chip');
    chip.innerHTML = `<span class="t">00:00</span><span class="sea muted">Spring</span>
      <button data-act="clean-off">show interface</button>`;
    this.cleanT = chip.querySelector('.t') as HTMLElement;
    this.root.appendChild(chip);

    // Anchored to a point on the map rather than to a control, so unlike every
    // other tip in here it is positioned rather than hung off a `:hover`.
    this.skyTip = el('div', 'tip skytip hide-in-clean');
    this.root.appendChild(this.skyTip);
    // The same bubble the resource chips wear, but placed rather than hung: a
    // roster row lives inside a scrolling panel, and a tip parented to one
    // would be cut off by the panel's own edge the moment you neared it.
    this.hoverTip = el('div', 'tip hovertip hide-in-clean');
    this.root.appendChild(this.hoverTip);

    this.modalHost = el('div', 'modal-host');
    this.root.appendChild(this.modalHost);

    this.introHost = el('div');
    this.root.appendChild(this.introHost);

    const ro = new ResizeObserver(() => this.measure());
    ro.observe(this.dock);
    ro.observe(this.topbar);
    this.measure();

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('change', (e) => this.onChangeEvent(e));
    this.root.addEventListener('keydown', (e) => this.onRootKey(e));
    /*
     * The floating tip. Delegated rather than bound per row, because the panel
     * it appears over rewrites its own markup a few times a second and any
     * listener attached to a row would be thrown away with it.
     *
     * The `scroll` listener captures, because a tip placed against the viewport
     * does not follow the list it came from — and the roster is a list you
     * scroll with the cursor still resting on a row.
     */
    this.root.addEventListener('pointerover', (e) => this.onHover(e));
    this.root.addEventListener('pointerout', (e) => this.onHover(e));
    this.root.addEventListener('focusout', (e) => this.onBlur(e));
    this.root.addEventListener('scroll', () => this.hideTip(), true);
  }

  // -------------------------------------------------------------------------
  // The floating tip
  // -------------------------------------------------------------------------

  /**
   * Shows whatever the pointer has landed on, if it has asked for a tip.
   *
   * Keyed on what it is about rather than on the node, so moving across a chip
   * — over its icon, its label and the chip itself — does not rebuild and
   * re-place the same bubble three times.
   */
  private onHover(e: Event): void {
    // Touch has no hover, and the stylesheet hides every `.tip` on a compact
    // screen anyway; placing one there would only be arithmetic nobody sees.
    if (this.env.touch || this.env.compact) return;
    const host = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
    if (!host || e.type === 'pointerout') {
      this.hideTip();
      return;
    }
    const kind = host.dataset.tip!;
    const id = Number(host.dataset.id ?? 0);
    const key = `${kind}:${id}`;
    if (key === this.tipKey) return;

    let html = '';
    if (kind === 'nature') {
      const v = villagerById(this.game.state, id);
      if (v) html = natureTip(v);
    }
    if (!html) {
      this.hideTip();
      return;
    }
    this.tipKey = key;
    setHtml(this.hoverTip, html);
    this.hoverTip.classList.add('on');
    this.placeTip(host.getBoundingClientRect());
  }

  /**
   * Under the thing it describes, or above it when there is no room below.
   *
   * Clamped to the window on both axes: the roster reaches the bottom of a tall
   * panel, and a bubble that hung off the screen there would be describing the
   * one row nobody could read.
   */
  private placeTip(at: DOMRect): void {
    const w = this.hoverTip.offsetWidth;
    const h = this.hoverTip.offsetHeight;
    const below = at.bottom + 8;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, at.top - h - 8) : below;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, at.left - 8));
    this.hoverTip.style.left = `${Math.round(x)}px`;
    this.hoverTip.style.top = `${Math.round(top)}px`;
  }

  private hideTip(): void {
    if (!this.tipKey) return;
    this.tipKey = '';
    this.hoverTip.classList.remove('on');
  }

  /**
   * Leaving a name field puts the row back to a name.
   *
   * Every way out of a rename arrives here — return, clicking away, or the
   * panel redrawing the field out from under the cursor — so this is the single
   * place the edit ends. The `change` event beside it only commits the name.
   *
   * The redraw is deferred a task because of that last case: replacing the
   * panel's markup is what blurred the field, and rendering again from inside
   * that assignment writes markup the outer one is about to overwrite. Waiting
   * until the current task is done lets the swap finish and then corrects it.
   */
  private onBlur(e: Event): void {
    const from = e.target as HTMLElement | null;
    if (!from?.classList?.contains('namefield')) return;
    this.hideTip();
    if (!this.renamingId) return;
    this.renamingId = 0;
    queueMicrotask(() => this.renderModal());
  }

  /**
   * How tall the furniture at each edge came out. Both vary with content — the
   * top strip wraps to two rows on a narrow window, the dock grows a placement
   * bar — and everything else in the layout is positioned off them, so they are
   * measured rather than guessed at.
   *
   * The day strip is part of the furniture at the top, so it goes into the same
   * measurement — and it is *measured* rather than added on as a constant,
   * because zoomed all the way out there is no strip and the rest of the
   * interface has to take the room back rather than leave a gap where it was.
   */
  private measure(): void {
    this.root.style.setProperty('--dock-h', `${Math.round(this.dock.getBoundingClientRect().height)}px`);
    const strip = this.dayStrip.el.getBoundingClientRect().height;
    const top = this.topbar.getBoundingClientRect().height + strip;
    this.root.style.setProperty('--top-h', `${Math.round(top)}px`);
  }

  /**
   * Which shape of interface this is. Deliberately not width alone: a large
   * phone held sideways is 844 across and still wants the phone layout, and a
   * laptop with a touchscreen wants confirm-before-you-build while keeping its
   * side rails.
   */
  private watchScreen(): void {
    /*
     * 820 rather than a phone's 600: below it there is not room for a build
     * rail, an inspector and the map between them, so a portrait tablet is
     * better served by the bottom navigation than by two columns squeezing the
     * kingdom into a strip down the middle.
     */
    const compact = matchMedia('(max-width: 820px), (max-height: 460px) and (pointer: coarse)');
    const short = matchMedia('(max-height: 520px)');
    const touch = matchMedia('(pointer: coarse)');

    const sync = () => {
      this.env = { compact: compact.matches, short: short.matches, touch: touch.matches };
      this.root.classList.toggle('compact', this.env.compact);
      this.root.classList.toggle('short', this.env.short);
      this.root.classList.toggle('touch', this.env.touch);
      this.game.requireConfirm = this.env.touch;
      this.refresh();
    };
    for (const mq of [compact, short, touch]) mq.addEventListener('change', sync);
    sync();
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      switch (e.key.toLowerCase()) {
        /*
         * One step out per press, innermost first: whatever is covering the map,
         * then the placement being considered, then the tool holding it, then
         * the list the tool came out of, then clean view, then the selection.
         * The build list was missing from that ladder entirely while its own
         * header said "Esc to close", so the one panel that says how to shut it
         * was the one panel that would not.
         */
        case 'escape':
          if (this.game.camera.overview) this.game.exitOverview();
          else if (this.modal) this.setModal(null);
          else if (this.game.candidate || this.game.demolishTarget) this.game.clearPending();
          else if (this.game.tool.kind !== 'none') this.game.cancelTool();
          else if (this.buildOpen) this.toggleBuild();
          else if (this.game.cleanMode) this.game.setCleanMode(false);
          else this.game.select(null, 0);
          break;
        case 'h':
          this.game.setCleanMode(!this.game.cleanMode);
          break;
        /*
         * Asking for a panel from out in Overview is also asking to come back
         * down — and to *open* the thing, rather than to toggle whatever was
         * left open behind the fade. A key that means "show me the people"
         * on the map must not quietly mean "hide them" from out there.
         */
        case 'b': {
          const back = this.fromOverview();
          if (!(back && this.buildOpen)) this.toggleBuild();
          break;
        }
        case 'j': {
          const back = this.fromOverview();
          this.setModal(!back && this.modal === 'kingdom' ? null : 'kingdom', KTAB.journal);
          break;
        }
        case 'p': {
          const back = this.fromOverview();
          this.setModal(!back && this.modal === 'people' ? null : 'people');
          break;
        }
        case ' ':
          e.preventDefault();
          this.game.togglePause();
          break;
        case '1':
          this.game.setSpeed(1);
          break;
        case '2':
          this.game.setSpeed(2);
          break;
        case '3':
          this.game.setSpeed(4);
          break;
        case 'f': {
          const sel = this.game.selection;
          if (sel.kind === 'villager' || sel.kind === 'animal') this.game.follow(sel.kind, sel.id);
          break;
        }
        default:
          break;
      }
    });
    window.addEventListener('beforeunload', () => this.game.save());
  }

  /** Left and right move between tabs, which is what a tab strip promises. */
  private onRootKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    /*
     * Escape out of a rename without keeping it. It is stopped here rather than
     * left to bubble because the global Escape closes the panel, and losing the
     * whole roster because you changed your mind about a name is not the trade
     * anybody meant to make.
     */
    if (this.renamingId && target.classList.contains('namefield')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.renamingId = 0;
        this.renderModal();
      }
      // Return has no default worth keeping in a lone field, and blurring is
      // what makes `change` fire.
      if (e.key === 'Enter') {
        e.preventDefault();
        target.blur();
      }
      return;
    }
    const tab = target.closest('[role="tab"]') as HTMLElement | null;
    if (!tab || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const tabs = [...(tab.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    e.preventDefault();
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    this.modalTab = Number(next.dataset.i);
    this.renderOpenPanel();
    // Searched from the root rather than the modal host: the same tab strip
    // appears in the right margin when a building is open on a desktop.
    (this.root.querySelector(`[role="tab"][data-i="${this.modalTab}"]`) as HTMLElement | null)?.focus();
  }

  /**
   * Puts the cursor in the name field the last redraw created, with the name
   * selected so typing replaces it — which is what somebody pressing a pencil
   * beside a name almost always means.
   */
  private focusRenameField(): void {
    const field = this.modalHost.querySelector(`#rn-${this.renamingId}`) as HTMLInputElement | null;
    field?.focus();
    field?.select();
  }

  /** Redraws whichever host the open panel is mounted in. */
  private renderOpenPanel(): void {
    this.renderModal();
    this.renderInspector();
  }

  // -------------------------------------------------------------------------
  // Per-frame refresh
  // -------------------------------------------------------------------------

  /** Cheap values, safe to run every frame. */
  tick(now: number): void {
    const g = this.g;
    // Every frame, not only on `notify`. The camera is moved by gestures that
    // report themselves and by screenshot harnesses that do not, and an
    // interface still standing over an Overview is the more obvious wrong of
    // the two.
    this.syncOverview();
    // Until the camp is finished there is no kingdom stock to speak of — the
    // wood is in the founder's arms — so the whole meter goes rather than
    // sitting there reading 0/0 and quietly lying about what "0" means.
    this.root.classList.toggle('founding', !foundingDone(g));

    /*
     * Zoomed all the way out the real sun or moon is up there in the sky over
     * the island, and the strip is the sky you get when you cannot see it — so
     * the whole bar stands down rather than telling the same hour twice, and
     * the top bar comes up to the edge behind it. The clock in the top bar
     * carries on saying what time it is throughout.
     */
    const noStrip = this.game.camera.zoom <= 1;
    if (this.root.classList.contains('no-daystrip') !== noStrip) {
      this.root.classList.toggle('no-daystrip', noStrip);
      this.measure();
    }
    this.dayStrip.tick(g, noStrip);
    const clock = this.hud.tick(this.game, this.env);
    this.cleanT.textContent = clock;
    const chipSea = this.root.querySelector('.clean-chip .sea');
    if (chipSea) chipSea.textContent = cap(g.season);

    this.renderToasts();
    this.renderSkyTip();

    // Panels are re-rendered a few times a second, not every frame.
    if (now - this.lastRender > 380) {
      this.lastRender = now;
      this.refreshPanels();
    }
  }

  /** Full rebuild of everything structural. */
  refresh(): void {
    this.syncOverview();
    this.root.classList.toggle('clean', this.game.cleanMode);
    this.closeWhatIsCovered();
    /*
     * A sheet takes the lower half of a phone, which is where the zoom buttons
     * live. They are a way of looking at the map, and while a sheet is up the
     * map is not what the player is doing — so they stand down rather than
     * float on top of the panel.
     */
    const inspecting = ['villager', 'animal', 'tile'].includes(this.game.selection.kind ?? '');
    this.root.classList.toggle(
      'sheet-open',
      this.env.compact && (this.buildOpen || !!this.modal || inspecting),
    );
    this.renderViewPad();
    this.renderDock();
    this.refreshPanels();
    this.renderModal();
    this.renderIntro();
  }

  /**
   * Overview takes the interface away and gives it back.
   *
   * Not by hiding it and hoping: what is open is state, so it is genuinely put
   * down on the way out and picked up again on the way in. A panel left open
   * behind an invisible scrim is a keyboard trap in a room nobody can see, and
   * a kingdom that comes back with everything shut is not the kingdom the
   * player left.
   *
   * The selection travels with the building panel, because closing that panel
   * is what drops the highlight from the map — restoring the one without the
   * other would reopen a card about nothing.
   */
  /**
   * Comes back down from Overview if that is where the view is, and says
   * whether it had to. Nothing is opened out there: a panel behind the fade is
   * a panel nobody can see, and `syncOverview` would shut it again on the way
   * in anyway.
   */
  private fromOverview(): boolean {
    if (!this.game.camera.overview) return false;
    this.game.exitOverview();
    return true;
  }

  private syncOverview(): void {
    const on = this.game.camera.overview;
    this.root.classList.toggle('overview', on);
    const was = this.beforeOverview;
    if (on === !!was) return;
    if (on) {
      this.beforeOverview = { modal: this.modal, buildOpen: this.buildOpen, selection: this.game.selection };
      if (this.modal) this.setModal(null);
      this.buildOpen = false;
    } else if (was) {
      this.beforeOverview = null;
      this.buildOpen = was.buildOpen;
      if (was.modal === 'building' && was.selection.kind === 'building') {
        this.game.select('building', was.selection.id);
      }
      if (was.modal) this.setModal(was.modal);
    }
  }

  private refreshPanels(): void {
    // Never yank a text field out from under someone mid-rename.
    const active = document.activeElement as HTMLElement | null;
    const editing = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT');
    this.renderBuildPanel();
    if (!editing || !this.sideRight.contains(active)) this.renderInspector();
    this.renderGoals();
    // A building panel is a live view of the place — who is standing in it, what
    // is on the shelf — so it keeps up, unless a dropdown in it is open. The
    // population sheet is the same: its arrival range shortens while it is open,
    // and a range that only moves when you close and reopen it reads as broken.
    // So is the roster: every row says what that person is doing this minute,
    // and the jobs board is mostly a list of what is standing empty right now.
    const live = this.modal === 'building' || this.modal === 'population' || this.modal === 'people';
    if (live && !(editing && this.modalHost.contains(active))) this.renderModal();
    this.measureSheet();
  }

  /**
   * How tall the open sheet came out, so a toast can sit above it rather than
   * across it. Sideways on a phone there is no spare band to put them in, so
   * "above whatever is open" is the only offset that always works.
   */
  private measureSheet(): void {
    const panel = this.env.compact
      ? (this.root.querySelector('.side .panel') as HTMLElement | null)
      : null;
    this.root.style.setProperty('--sheet-h', panel ? `${Math.round(panel.getBoundingClientRect().height)}px` : '0px');
  }

  /**
   * On a phone there is room for one thing at a time. Selecting somebody on the
   * map is a request to look at them, so whatever was covering the map goes.
   */
  private closeWhatIsCovered(): void {
    const sel = this.game.selection;
    const key = `${sel.kind}:${sel.id}:${sel.x ?? ''}:${sel.y ?? ''}`;
    const changed = key !== this.lastSelection;
    this.lastSelection = key;
    if (!changed || !this.env.compact) return;
    if (sel.kind === 'villager' || sel.kind === 'animal' || sel.kind === 'tile') {
      this.buildOpen = false;
      if (this.modal && this.modal !== 'building') this.closeModal();
    }
  }

  // -------------------------------------------------------------------------
  // The bottom dock, the toolbar and the view pad
  // -------------------------------------------------------------------------

  private navState(): NavState {
    // Placing something counts as being in Build even though the list has
    // stepped aside — the section you are in should not go dark mid-task.
    const kind = this.game.tool.kind;
    return {
      buildOpen: this.buildOpen,
      buildActive: this.buildOpen || kind === 'build' || kind === 'demolish',
      modal: this.modal,
      clean: this.game.cleanMode,
      newcomers: this.game.newcomers(),
    };
  }

  private renderViewPad(): void {
    setHtml(this.viewHost, viewPadMarkup(this.game));
  }

  /**
   * The active-tool bar and the navigation, in one column at the bottom edge.
   * On a touchscreen the bar is where a placement is confirmed or abandoned, so
   * it replaces the hint rather than sitting next to it — two boxes saying
   * nearly the same thing is how a phone screen runs out.
   */
  private renderDock(): void {
    const kind = this.game.tool.kind;
    /*
     * A removal being considered is asked about wherever the player is looking:
     * in the building's own footer if that panel is open, down here if they
     * used the tool on the map. Placement asks here either way.
     */
    const asking = this.game.demolishTarget > 0 && this.modal !== 'building';
    const confirming = this.game.requireConfirm && (kind === 'build' || kind === 'camp' || kind === 'relocate');
    const bar =
      asking || confirming ? placementBarMarkup(this.game, this.env) : toolHintMarkup(this.game, this.env);

    setHtml(this.toolHost, bar);
    this.root.classList.toggle('has-hint', !!bar);

    // One cluster, both layouts. It is drawn through `keepFocus` because a
    // player tabbing between Build and People should not be dropped every time
    // the tool hint above it changes shape.
    keepFocus(this.navHost, () => setHtml(this.navHost, actionsMarkup(this.navState())));
  }

  private renderToasts(): void {
    const g = this.g;
    const want = g.toasts.map((t) => `${t.icon}${t.text}${t.tone}`).join('|');
    if (this.toastHost.dataset.sig === want) return;
    this.toastHost.dataset.sig = want;
    this.toastHost.innerHTML = g.toasts
      .map(
        (t) => `<div class="toast ${t.tone}">${iconFor(t.icon)}<span>${esc(t.text)}</span></div>`,
      )
      .join('');
    // Toasts are confirmations, so they are worth saying out loud once.
    const last = g.toasts[g.toasts.length - 1];
    if (last) this.focus.announce(last.text);
  }

  /**
   * The hover detail for the sun and the moon, from either place they appear —
   * the body itself out over the island, or anywhere along the day strip, which
   * is a far more forgiving target than a body near the rim. Nudged back
   * on screen when it would run off the edge: the body spends a good part of
   * the day near the rim, which is exactly where a tip anchored to it goes
   * missing.
   */
  private renderSkyTip(): void {
    const at = this.game.skyHover ?? this.dayStrip.hover;
    if (!at) {
      if (this.skyTip.classList.contains('on')) this.skyTip.classList.remove('on');
      return;
    }
    const s = this.game.skyLabel();
    setHtml(
      this.skyTip,
      `<div class="tip-head">${esc(s.title)}<b>${esc(s.time)}</b></div>` +
        `<div class="tip-line"><b>${esc(s.band)}</b> — ${esc(s.note)}</div>` +
        // What the rule along the bottom of the strip is drawing, in words. The
        // sky line above it answers a different question and neither replaces
        // the other: it can be broad daylight and nobody working.
        `<div class="tip-line"><b>${esc(s.doing)}</b> — ${esc(s.doingNote)}</div>` +
        `<div class="tip-line">${esc(s.until)}</div>`,
    );
    this.skyTip.classList.add('on');
    const w = this.skyTip.offsetWidth;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, at.x - w / 2));
    this.skyTip.style.left = `${Math.round(x)}px`;
    this.skyTip.style.top = `${Math.round(at.y + 18)}px`;
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  private renderBuildPanel(): void {
    // The stylesheet needs to know which sheet is up to keep the rest clear.
    this.root.classList.toggle('build-open', this.buildOpen);
    if (!this.buildOpen) {
      setHtml(this.sideLeft, '');
      this.goalsHost.classList.remove('shifted');
      return;
    }
    this.goalsHost.classList.toggle('shifted', !this.env.compact);
    const body = buildListMarkup(this.game, this.env);
    const html = `<div class="panel sheet">
      <h3 id="build-title">Build<span class="tiny muted esc-hint">Esc to close</span>
        <button class="btn small sheet-close" data-act="toggle-build">Close</button></h3>
      <div class="sheet-body scroll">${body}</div></div>`;
    /*
     * The list still changes for real — a cost becomes affordable, a tally ticks
     * over — and it is longer than any screen it is drawn on, so where the
     * player had read down to is carried across the redraw. Losing it is not a
     * cosmetic annoyance: the comforts are at the bottom of the list, and a list
     * that jumps back to Housing every third of a second cannot be used at all.
     */
    const keep = (this.sideLeft.querySelector('.sheet-body') as HTMLElement | null)?.scrollTop ?? 0;
    keepFocus(this.sideLeft, () => {
      if (!setHtml(this.sideLeft, html)) return;
      const scroller = this.sideLeft.querySelector('.sheet-body') as HTMLElement | null;
      if (scroller) scroller.scrollTop = keep;
      // Each entry carries a picture of the building, painted into the canvas
      // the markup just put there — in the same task, so nothing is ever seen
      // blank between the row appearing and its roof arriving.
      paintPortraits(this.game, this.sideLeft);
    });
  }

  // -------------------------------------------------------------------------
  // Inspector
  // -------------------------------------------------------------------------

  private renderInspector(): void {
    const sel = this.game.selection;
    /*
     * A building goes in the margin with everything else you can point at, so
     * the map beside it stays live and the next building is one click away.
     * The rail is wider while one is up: a roster wants three columns — who,
     * what they are doing, and the one control that applies to them — and the
     * cards that share the margin do not.
     */
    const rail = this.modal === 'building' && this.buildingInRail;
    const b = rail ? this.game.selectedBuilding() : null;
    this.root.classList.toggle('wide-rail', !!b);
    if (b) {
      this.renderBuildingRail(b);
      return;
    }
    if (rail) {
      // Demolished while its panel was open. Cleared directly rather than
      // through setModal: this runs inside a render, and nothing else needs
      // to change.
      this.modal = null;
      this.focus.release();
    }
    this.railMount = '';

    let html = '';
    if (sel.kind === 'villager') html = villagerCard(this.game);
    else if (sel.kind === 'animal') html = animalCard(this.game);
    // A building is handled above: it is a card here on a desktop and a sheet
    // on a phone, rather than one of these.
    else if (sel.kind === 'tile') html = tileCard(this.game);

    if (!html) {
      setHtml(this.sideRight, '');
      return;
    }
    // A sheet you cannot see the edge of needs its own way out; on a desktop
    // the card is in the margin and clicking the map is enough.
    const head = this.env.compact
      ? `<h3>${esc(inspectorTitle(this.game))}<button class="btn small sheet-close" data-act="clear-selection">Close</button></h3>`
      : '';
    const next = `<div class="panel sheet">${head}<div class="sheet-body scroll">${html}</div></div>`;
    const keep = (this.sideRight.querySelector('.sheet-body') as HTMLElement | null)?.scrollTop ?? 0;
    keepFocus(this.sideRight, () => {
      if (!setHtml(this.sideRight, next)) return;
      const scroller = this.sideRight.querySelector('.sheet-body') as HTMLElement | null;
      if (scroller) scroller.scrollTop = keep;
      // A villager's card carries their likeness, painted in the same task the
      // markup arrives in so it is never seen empty.
      paintPortraits(this.game, this.sideRight);
    });
  }

  /**
   * Where a building's panel goes on this screen. A phone has one surface at a
   * time and no margin to put a card in, so there it stays a sheet.
   */
  private get buildingInRail(): boolean {
    return !this.env.compact;
  }

  /**
   * The building panel, in the right margin. Same pieces as the modal — a
   * header with the building's own sprite in it, the tabs, the body, the
   * footer — with no scrim behind it, because the map is what the panel is
   * about and dimming it would put the kingdom behind glass to read about a
   * lodge.
   */
  private renderBuildingRail(b: Building): void {
    const parts = this.buildingParts(b);
    const active = Math.min(this.modalTab, Math.max(0, parts.tabNames.length - 1));
    const tabs = this.tabStrip(parts.tabNames, active);
    const head = panelHead(parts);
    const sig = `building:${b.id}`;
    const mounted = this.sideRight.querySelector('.rail') as HTMLElement | null;

    if (mounted && this.railMount === sig) {
      this.updatePanel(this.sideRight, mounted, parts, tabs);
      paintPortraits(this.game, this.sideRight);
      return;
    }

    this.railMount = sig;
    setHtml(
      this.sideRight,
      `<div class="modal rail" role="region" aria-labelledby="modal-title">
        <header>${parts.pic}<h2 id="modal-title">${head}</h2>
          <button class="btn small" data-act="close-modal" aria-label="Close">Close</button></header>
        ${tabs ? `<div class="tabs" role="tablist">${tabs}</div>` : ''}
        <div class="body" id="modal-body" ${tabs ? `role="tabpanel" aria-labelledby="mtab-${active}"` : ''}>${parts.body}</div>
        ${parts.foot ? `<div class="foot">${parts.foot}</div>` : ''}
      </div>`,
    );
    paintPortraits(this.game, this.sideRight);
  }

  // -------------------------------------------------------------------------
  // Goals
  // -------------------------------------------------------------------------

  private renderGoals(): void {
    const html = this.env.compact
      ? goalChipMarkup(this.game, this.goalsCollapsed)
      : goalPanelMarkup(this.game);
    if (!setHtml(this.goalsHost, html)) return;
    // On a narrow desktop the toasts have nowhere to be but above this panel,
    // so they have to be told how tall it came out.
    const panel = this.goalsHost.firstElementChild as HTMLElement | null;
    const stacked = panel && !this.env.compact;
    this.root.style.setProperty('--goals-h', stacked ? `${Math.round(panel.getBoundingClientRect().height)}px` : '0px');
  }

  // -------------------------------------------------------------------------
  // Modals
  // -------------------------------------------------------------------------

  private setModal(kind: ModalKind, tab = 0): void {
    // Closing a building's panel drops its highlight with it, so nothing is left
    // outlined on the map with no panel to explain why.
    if (this.modal === 'building' && kind !== 'building' && this.game.selection.kind === 'building') {
      this.game.select(null, 0);
    }
    if (kind && this.game.demolishTarget) this.game.clearPending();
    this.hideTip();
    this.renamingId = 0;
    const opening = kind && kind !== this.modal;
    this.modal = kind;
    this.modalTab = tab;
    /*
     * Only one major surface at a time, on every screen. A phone has no room
     * for two; a desktop has the room but nothing to gain by it — the modal
     * dims the rail behind its scrim, so the list sits there lit up and
     * unreachable, and its ghost under the dimming is most of what reads as the
     * panels fighting each other.
     *
     * A building on a desktop is the exception, and for the same reason: it is
     * a card in the opposite margin with no scrim at all, so the two do not
     * fight. Clicking a cabin to see who sleeps there should not shut the list
     * you were laying the next one out from.
     */
    if (kind && !(kind === 'building' && this.buildingInRail)) this.buildOpen = false;
    if (opening) this.focus.remember();
    this.refresh();
    // After the redraw, not before: closing a panel repaints the bar it was
    // opened from, and focus handed back to a node that is about to be
    // replaced ends up on nothing at all.
    if (!kind) this.focus.release();
  }

  private closeModal(): void {
    this.setModal(null);
  }

  private toggleBuild(): void {
    this.buildOpen = !this.buildOpen;
    if (this.buildOpen) {
      this.focus.remember();
      // One major sheet at a time on a phone.
      if (this.env.compact && this.modal) this.setModal(null);
    } else {
      this.game.cancelTool();
    }
    this.refresh();
    // Not a trap — the map behind it stays live, because the next thing the
    // player does is point at it.
    const panel = this.sideLeft.querySelector('.panel') as HTMLElement | null;
    if (this.buildOpen && panel) this.focus.enter(panel, false);
    else if (!this.buildOpen) this.focus.release();
  }

  /**
   * Everything a building's panel is made of. It is put together in one place
   * because it is drawn in two: a card in the margin on a desktop, a sheet on a
   * phone. A panel that said different things in the two would be two panels.
   */
  private buildingParts(b: Building): PanelParts {
    const def = BUILDINGS[b.def];
    const tabNames = buildingTabs(b);
    const tab = tabNames[Math.min(this.modalTab, tabNames.length - 1)];
    return {
      title: buildingName(b.def, b.level),
      sub:
        b.stage === 'done'
          ? def.maxLevel > 1
            ? `Level ${b.level} of ${def.maxLevel}`
            : esc(def.desc)
          : b.upgrading
            ? 'Being improved'
            : 'Being built',
      body: buildingBody(this.game, b, tab),
      foot:
        this.game.demolishTarget === b.id
          ? `<span class="confirm-line">Remove the ${esc(def.name.toLowerCase())}? Half of what it cost comes back.</span>
             <span class="spacer"></span>
             <button class="btn small" data-act="cancel-place">Keep it</button>
             <button class="btn small danger primary" data-act="confirm-demolish">Remove it</button>`
          : buildingFoot(this.game, b),
      // Lives outside the h2 that gets swapped, so the picture is mounted once.
      pic: `<span class="mpic"><canvas data-pic="building" data-id="${b.id}" aria-hidden="true"></canvas></span>`,
      tabNames,
    };
  }

  /**
   * What is behind the Kingdom door, tab by tab.
   *
   * Settings is three sections stacked in one scroll rather than three more
   * tabs. Tabs inside tabs is the shape of an interface that has stopped
   * deciding what matters, and the three of them together are shorter than the
   * journal of a kingdom that has been running an hour.
   */
  private kingdomBody(): string {
    switch (Math.min(this.modalTab, KINGDOM_TABS.length - 1)) {
      case KTAB.wildlife:
        return wildlifeBody(this.game);
      case KTAB.goals:
        return goalsBody(this.game);
      case KTAB.settings:
        return `<div class="bsec"><div class="bh">Kingdoms</div>${slotsBody(this.game)}</div>
          <div class="bsec"><div class="bh">Viewing</div>${viewBody(this.game)}</div>
          <div class="bsec"><div class="bh">Sound</div>${soundBody(this.game)}</div>`;
      default:
        return journalBody(this.game);
    }
  }

  /** The tab strip a panel wears, whichever host it is mounted in. */
  private tabStrip(tabNames: string[], active: number): string {
    return tabNames
      .map(
        (t, i) =>
          `<button role="tab" id="mtab-${i}" aria-selected="${i === active}" aria-controls="modal-body"
            tabindex="${i === active ? 0 : -1}" data-act="tab" data-i="${i}" class="${i === active ? 'on' : ''}">${esc(t)}</button>`,
      )
      .join('');
  }

  /**
   * Updates a panel that is already mounted rather than replacing it. A
   * building panel redraws several times a second; replacing the whole thing
   * each time restarts the scrim's fade — which reads as a flicker, and was
   * invisible in the source and obvious in a screenshot — and throws away the
   * body's scroll position.
   */
  private updatePanel(host: HTMLElement, mounted: Element, parts: PanelParts, tabs: string): void {
    keepFocus(host, () => {
      const swap = (sel: string, html: string) => {
        const node = mounted.querySelector(sel) as HTMLElement | null;
        if (!node) return;
        const keep = node.scrollTop;
        // "Here now" is a fixed-height scroller inside the body, so it needs
        // its own place kept as well — it is replaced along with everything else.
        const inner = node.querySelector('.bhere')?.scrollTop ?? 0;
        if (!setHtml(node, html)) return;
        node.scrollTop = keep;
        const here = node.querySelector('.bhere');
        if (here) here.scrollTop = inner;
      };
      swap('h2', panelHead(parts));
      swap('.tabs', tabs);
      swap('.body', parts.body);
      swap('.foot', parts.foot);
    });
  }

  private renderModal(): void {
    /*
     * On a desktop a building is a card in the right margin, drawn by the
     * inspector, so there is nothing for the modal host to mount. On a phone
     * there is no margin to put a card in and it falls through as a sheet like
     * every other panel.
     */
    if (!this.modal || (this.modal === 'building' && this.buildingInRail)) {
      setHtml(this.modalHost, '');
      this.modalMount = '';
      return;
    }

    let title = '';
    let body = '';
    let tabNames: string[] = [];
    let sub = '';
    let foot = '';
    let pic = '';

    switch (this.modal) {
      case 'building': {
        const b = this.game.selectedBuilding();
        // Demolished while the panel was open, or nothing selected at all.
        if (!b) {
          setHtml(this.modalHost, '');
          this.modalMount = '';
          // Set directly rather than through setModal: this runs inside a
          // render, and nothing else needs to change.
          this.modal = null;
          this.focus.release();
          return;
        }
        ({ title, sub, body, foot, pic, tabNames } = this.buildingParts(b));
        break;
      }
      case 'kingdom':
        title = 'Kingdom';
        tabNames = KINGDOM_TABS;
        sub = KINGDOM_SUBS[Math.min(this.modalTab, KINGDOM_TABS.length - 1)];
        body = this.kingdomBody();
        break;
      case 'people': {
        title = 'People';
        tabNames = PEOPLE_TABS;
        const ptab = Math.min(this.modalTab, PEOPLE_TABS.length - 1);
        sub = peopleSub(this.game, ptab);
        body = peopleBody(this.game, this.env, ptab, this.people, this.renamingId);
        break;
      }
      case 'stores':
        title = 'Storage';
        body = storesBody(this.game);
        break;
      case 'population':
        title = 'People & Vibes';
        body = populationBody(this.game);
        break;
      default:
        break;
    }

    const parts: PanelParts = { title, sub, body, foot, pic, tabNames };
    const active = Math.min(this.modalTab, Math.max(0, tabNames.length - 1));
    const tabs = this.tabStrip(tabNames, active);
    const head = panelHead(parts);
    const mounted = this.modalHost.querySelector('.modal');
    const sig = `${this.modal}:${this.modal === 'building' ? this.game.selection.id : ''}`;

    if (mounted && this.modalMount === sig) {
      this.updatePanel(this.modalHost, mounted, parts, tabs);
      paintPortraits(this.game, this.modalHost);
      return;
    }

    this.modalMount = sig;
    setHtml(this.modalHost, `<div class="scrim" data-act="close-scrim">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-stop="1">
        <header>${pic}<h2 id="modal-title">${head}</h2>
          <button class="btn small" data-act="close-modal" aria-label="Close">Close</button></header>
        ${tabs ? `<div class="tabs" role="tablist">${tabs}</div>` : ''}
        <div class="body" id="modal-body" ${tabs ? `role="tabpanel" aria-labelledby="mtab-${active}"` : ''}>${body}</div>
        ${foot ? `<div class="foot">${foot}</div>` : ''}
      </div></div>`);
    paintPortraits(this.game, this.modalHost);
    // Opened from a particular chip: start where that chip was about. Done on
    // the mount rather than every redraw, or the sheet would drag itself back
    // up under a reader who had scrolled away from it.
    if (this.modal === 'stores' && this.storesAt) {
      const section = this.modalHost.querySelector(`[data-entry="${this.storesAt}"]`);
      section?.scrollIntoView({ block: 'start' });
      this.storesAt = '';
    }
    const panel = this.modalHost.querySelector('.modal') as HTMLElement | null;
    if (panel) this.focus.enter(panel, TRUE_MODALS.includes(this.modal));
  }

  private renderIntro(): void {
    const g = this.g;
    const fresh = g.day === 1 && g.buildings.length <= 1 && g.villagers.length === 1 && g.played < 2;
    if (this.introDismissed || !fresh) {
      setHtml(this.introHost, '');
      return;
    }
    const founder = g.villagers[0];
    const keys = this.env.touch
      ? `<kbd>drag</kbd> move the map · <kbd>pinch</kbd> zoom · <kbd>double-tap</kbd> follow someone<br>
         Everything else is along the bottom.`
      : `<kbd>drag</kbd> pan · <kbd>scroll</kbd> or <kbd>pinch</kbd> · <kbd>double-click</kbd> follow someone<br>
         <kbd>B</kbd> build · <kbd>J</kbd> journal · <kbd>H</kbd> hide the interface · <kbd>space</kbd> pause`;
    const html = `<div class="intro"><div class="card2" role="dialog" aria-modal="true" aria-labelledby="intro-title">
      <h1 id="intro-title">Tiny Kingdom Manager</h1>
      <p>There is one person here. Their name is <b>${esc(founder?.name ?? 'someone')}</b>, and they have just walked up the beach with nothing at all.<br><br>
      Nothing is kept in one great pile: every resource lives in the building that produces it, and it gets there
      because somebody carried it. Watch where they stop, tell them this will do, and see what the place becomes.</p>
      <button class="btn primary" data-act="dismiss-intro">Begin</button>
      <div class="keys">${keys}</div>
    </div></div>`;
    // Rebuilt only when it would actually differ: the card is mounted before
    // the screen has told us what shape it is, so the key list can change once.
    if (!setHtml(this.introHost, html)) return;
    const card = this.introHost.querySelector('.card2') as HTMLElement | null;
    if (card) {
      this.focus.remember(null);
      this.focus.enter(card, true);
    }
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private onClick(e: Event): void {
    const target = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!target) return;
    const act = target.dataset.act!;
    const id = Number(target.dataset.id ?? 0);
    const game = this.game;
    audio.ensure();

    switch (act) {
      case 'speed': {
        const s = Number(target.dataset.speed);
        if (s === 0) game.setSpeed(0);
        else {
          game.state.paused = false;
          game.setSpeed(s);
        }
        // The buttons live in the settings panel now, so redraw it in place.
        this.renderModal();
        break;
      }
      case 'set-fps':
        this.game.updateSettings({ fps: Number(target.dataset.fps) });
        // Beside the buttons is a line saying what the choice means, so the
        // panel has something to say back.
        this.renderModal();
        break;
      case 'toggle-build':
        this.toggleBuild();
        break;
      case 'build': {
        const def = target.dataset.def as keyof typeof BUILDINGS;
        game.setTool({ kind: 'build', def });
        // On a phone the list steps aside so the map — the thing you are about
        // to point at — is visible. The bar below keeps the choice on screen.
        if (this.env.compact) this.buildOpen = false;
        this.focus.announce(`${BUILDINGS[def].name} chosen. Choose where it goes.`);
        this.refresh();
        break;
      }
      case 'tool-demolish':
        game.setTool(game.tool.kind === 'demolish' ? { kind: 'none' } : { kind: 'demolish' });
        if (this.env.compact && game.tool.kind === 'demolish') this.buildOpen = false;
        this.refresh();
        break;
      case 'confirm-place':
        if (game.confirmPlacement()) this.focus.announce('Placed.');
        this.refresh();
        break;
      case 'cancel-place':
        game.clearPending();
        break;
      case 'confirm-demolish':
        game.confirmDemolish();
        this.focus.announce('Removed.');
        this.refresh();
        break;
      case 'clear-selection':
        game.select(null, 0);
        break;
      case 'modal-people':
        this.setModal(this.modal === 'people' ? null : 'people');
        break;
      /*
       * Four entry points, one panel. The journal, the wildlife, the objectives
       * and the settings all live behind the Kingdom button now, so anything
       * that used to open one of them opens that panel at the right tab — the
       * goal chip's "all goals", the Vibes tip's advice, the keyboard.
       */
      case 'modal-kingdom':
        this.setModal(this.modal === 'kingdom' ? null : 'kingdom', Number(target.dataset.i ?? KTAB.journal));
        break;
      case 'modal-wildlife':
        this.setModal('kingdom', KTAB.wildlife);
        break;
      case 'modal-goals':
        this.setModal('kingdom', KTAB.goals);
        break;
      /*
       * The chips open the storage sheet on every screen now, not only where
       * there is no hover. The hover answers "how much and is it full"; the
       * sheet answers "where is it, who made it, what is it for", and that is
       * worth a click on a desktop as much as a tap on a phone.
       *
       * Whichever chip was pressed says which section to land on, so opening
       * Goods does not put the reader at the top of Wood.
       */
      case 'open-stores':
        this.storesAt = target.dataset.entry ?? '';
        this.setModal(this.modal === 'stores' ? null : 'stores');
        break;
      case 'open-population':
        this.setModal(this.modal === 'population' ? null : 'population');
        break;
      case 'modal-settings':
        this.setModal('kingdom', KTAB.settings);
        break;
      case 'collapse-goalchip':
        this.goalsCollapsed = true;
        this.renderGoals();
        break;
      case 'expand-goalchip':
        this.goalsCollapsed = false;
        this.renderGoals();
        break;
      case 'cancel-tool':
        game.cancelTool();
        this.refresh();
        break;
      case 'close-modal':
        this.closeModal();
        break;
      case 'close-scrim':
        if (target === e.target) this.closeModal();
        break;
      case 'tab':
        this.modalTab = Number(target.dataset.i);
        this.renderOpenPanel();
        break;
      case 'clean-on':
        game.setCleanMode(!game.cleanMode);
        if (game.cleanMode) this.setModal(null);
        else this.refresh();
        break;
      case 'clean-off':
        game.setCleanMode(false);
        this.refresh();
        break;
      case 'dismiss-intro':
        this.introDismissed = true;
        setHtml(this.introHost, '');
        this.focus.release();
        break;
      case 'follow-villager':
        game.follow('villager', id);
        game.select('villager', id);
        break;
      case 'follow-animal':
        game.follow('animal', id);
        break;
      case 'unfollow':
        game.stopFollowing();
        break;
      case 'zoom-in':
        game.zoomStep(1);
        break;
      case 'zoom-out':
        game.zoomStep(-1);
        break;
      case 'recentre':
        game.recentre();
        break;
      case 'fav-villager':
        game.toggleFavorite('villager', id);
        break;
      /*
       * The roster's own controls. Both only change what is on screen, so they
       * repaint the panel and touch nothing in the kingdom.
       */
      case 'people-filter':
        this.people.filter = (target.dataset.key ?? 'all') as PeopleFilter;
        this.renderModal();
        break;
      /*
       * Swap one row's name for a field, then put the cursor in it. The focus
       * has to wait for the redraw: the node it is going into does not exist
       * until the panel has been rebuilt around it.
       */
      case 'rename-start':
        this.renamingId = id;
        this.hideTip();
        this.renderModal();
        this.focusRenameField();
        break;
      case 'fav-animal':
        game.toggleFavorite('animal', id);
        break;
      case 'select-villager':
        game.select('villager', id);
        this.setModal(null);
        break;
      case 'select-animal': {
        const a = game.state.animals.find((x) => x.id === id);
        game.select('animal', id);
        if (a) game.centerOn(Math.round(a.x), Math.round(a.y));
        this.setModal(null);
        break;
      }
      case 'unassign':
        game.assign(id, 0);
        break;
      case 'autostaff':
        game.autoStaff(id);
        break;
      case 'upgrade':
        game.upgrade(id);
        break;
      case 'relocate': {
        const b = buildingById(game.state, id);
        game.startRelocate(id);
        // The map is the thing being pointed at next, so the panel steps aside.
        this.setModal(null);
        if (b) this.focus.announce(`Moving the ${BUILDINGS[b.def].name.toLowerCase()}. Choose where it should stand.`);
        this.refresh();
        break;
      }
      case 'cancel-move':
        game.cancelRelocation(id);
        this.refresh();
        break;
      case 'demolish':
        // Asks; it does not remove. The panel's footer becomes the question.
        game.askDemolish(id);
        break;
      case 'goto':
        game.centerOn(Number(target.dataset.x), Number(target.dataset.y));
        // No use centring the map on something with a panel over the top of it.
        if (this.modal) this.setModal(null);
        break;
      case 'select-building':
        game.select('building', id);
        this.setModal('building');
        break;
      case 'save-now':
        game.save();
        this.focus.announce('Kingdom saved.');
        this.renderModal();
        break;
      case 'new-kingdom':
        this.newKingdom();
        break;
      case 'load-slot':
        this.loadSlot(id ? String(id) : target.dataset.id!);
        break;
      case 'rename-slot': {
        const slotId = target.dataset.id!;
        const s = listSlots().find((x) => x.id === slotId);
        const name = prompt('Name this kingdom', s?.name ?? 'Tiny Kingdom');
        if (name && name.trim()) {
          renameSlot(slotId, name.trim());
          if (slotId === game.slotId) game.slotName = name.trim();
        }
        this.renderModal();
        break;
      }
      case 'delete-slot': {
        const slotId = target.dataset.id!;
        if (!confirm('Delete this kingdom for good?')) break;
        deleteSlot(slotId);
        if (slotId === game.slotId) this.newKingdom(true);
        else this.renderModal();
        break;
      }
      case 'export':
        game.save();
        exportToFile(game.state, game.slotName);
        break;
      case 'import':
        this.importKingdom();
        break;
      default:
        break;
    }
  }

  private onChangeEvent(e: Event): void {
    const target = e.target as HTMLElement & { value: string; checked: boolean };
    const act = target.dataset.act;
    if (!act) return;
    const id = Number(target.dataset.id ?? 0);

    switch (act) {
      // Commits the name and nothing else. Ending the edit is `onBlur`'s job,
      // and a committed field is always about to lose focus one way or another.
      case 'rename-villager':
        this.game.renameVillager(id, target.value);
        break;
      case 'name-animal':
        this.game.nameAnimal(id, target.value);
        break;
      case 'assign':
        this.game.assign(id, Number(target.value));
        break;
      case 'people-sort':
        this.people.sort = target.value as PeopleSort;
        this.renderModal();
        break;
      // These three read the other way round: the row knows the building or the
      // resident, and the chosen option is the person or the house.
      case 'assign-to':
        if (Number(target.value)) this.game.assign(Number(target.value), id);
        break;
      case 'house-in':
        if (Number(target.value)) this.game.setHome(Number(target.value), id);
        break;
      case 'move-home':
        this.game.setHome(id, Number(target.value));
        break;
      // What a mine or a forge is concentrating on. Nothing is spent and nothing
      // is lost, so there is no confirmation and no way to get it wrong.
      case 'set-focus':
        this.game.setFocus(id, target.value);
        break;
      case 'set-bubbles':
        this.game.updateSettings({ showBubbles: target.checked });
        break;
      case 'set-names':
        this.game.updateSettings({ showNames: target.checked });
        break;
      case 'set-activity':
        this.game.updateSettings({ showActivity: target.checked });
        break;
      case 'set-volume':
        this.game.updateSettings({ volume: Number(target.value) });
        this.renderModal();
        break;
      case 'set-muted':
        this.game.updateSettings({ muted: target.checked });
        break;
      default:
        break;
    }
  }

  private newKingdom(silent = false): void {
    if (!silent && !confirm('Start a new kingdom? The current one stays saved.')) return;
    this.game.save();
    const name = silent ? 'Tiny Kingdom' : prompt('Name your kingdom', 'Tiny Kingdom')?.trim() || 'Tiny Kingdom';
    this.game.adopt(newGame(), newSlotId(), name);
    this.game.save();
    this.introDismissed = false;
    this.setModal(null);
  }

  private loadSlot(slotId: string): void {
    this.game.save();
    const state = loadFromSlot(slotId);
    if (!state) {
      // Almost always a kingdom from an older version. Save files are refused
      // rather than guessed at, and naming one particular update here would go
      // out of date the next time the format moves.
      alert('That kingdom was made by an earlier version of the game, and cannot be opened.');
      return;
    }
    const info = listSlots().find((s) => s.id === slotId);
    this.game.adopt(state, slotId, info?.name ?? 'Tiny Kingdom');
    this.setModal(null);
  }

  private importKingdom(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const state = await importFromFile(file);
        const slotId = newSlotId();
        const name = file.name.replace(/\.tkm\.json$|\.json$/i, '').split('—')[0].trim() || 'Imported Kingdom';
        this.game.adopt(state, slotId, name);
        this.game.save();
        this.setModal(null);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'That file could not be read.');
      }
    };
    input.click();
  }
}
