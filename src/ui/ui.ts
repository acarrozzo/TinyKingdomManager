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
 */

import type { GameState } from '../types';
import { BUILDINGS, buildingName } from '../sim/defs';
import { foundingDone } from '../sim/founding';
import type { Game } from '../game';
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
import { newGame } from '../sim/state';
import { Focus, keepFocus } from './a11y';
import { cap, el, esc, type UIEnv } from './context';
import { Hud, storesBody } from './hud';
import { bottomNavMarkup, moreBody, toolbarMarkup, viewPadMarkup, type ModalKind, type NavState } from './nav';
import { goalChipMarkup, goalPanelMarkup, goalsBody } from './goals';
import { buildListMarkup, placementBarMarkup, toolHintMarkup } from './build';
import { animalCard, inspectorTitle, tileCard, villagerCard } from './inspector';
import {
  buildingBody,
  buildingFoot,
  buildingTabs,
  journalBody,
  paintPortraits,
  peopleBody,
  slotsBody,
  soundBody,
  viewBody,
  wildlifeBody,
} from './modals';

/** Panels that cover the map and take the keyboard with them while they are up. */
const TRUE_MODALS: ModalKind[] = ['journal', 'wildlife', 'people', 'settings', 'building', 'stores', 'goals', 'more'];

export class UI {
  private root: HTMLElement;
  private game: Game;
  private focus: Focus;
  private hud: Hud;

  private env: UIEnv = { compact: false, short: false, touch: false };
  private modal: ModalKind = null;
  private modalTab = 0;
  /** What is currently mounted in the modal host, so a redraw can update in place. */
  private modalMount = '';
  private buildOpen = false;
  private goalsCollapsed = false;
  private introDismissed = false;
  private lastRender = 0;
  /** The selection the inspector last drew, so a new one can close what covers it. */
  private lastSelection = '';

  // Long-lived hosts.
  private topbar!: HTMLElement;
  private toolbarHost!: HTMLElement;
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
  private cleanT!: HTMLElement;

  constructor(root: HTMLElement, game: Game) {
    this.root = root;
    this.game = game;
    this.root.innerHTML = '';

    this.topbar = el('div', 'topbar hide-in-clean');
    this.root.appendChild(this.topbar);
    this.hud = new Hud(this.topbar, game);
    this.toolbarHost = el('div', 'cluster toolbar');
    (this.topbar.lastElementChild as HTMLElement).appendChild(this.toolbarHost);

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

    this.modalHost = el('div', 'modal-host');
    this.root.appendChild(this.modalHost);

    this.introHost = el('div');
    this.root.appendChild(this.introHost);

    /*
     * How tall the furniture at each edge came out. Both vary with content —
     * the top strip wraps to two rows on a narrow window, the dock grows a
     * placement bar — and everything else in the layout is positioned off
     * them, so they are measured rather than guessed at.
     */
    const measure = () => {
      this.root.style.setProperty('--dock-h', `${Math.round(this.dock.getBoundingClientRect().height)}px`);
      this.root.style.setProperty('--top-h', `${Math.round(this.topbar.getBoundingClientRect().height)}px`);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(this.dock);
    ro.observe(this.topbar);
    measure();

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('change', (e) => this.onChangeEvent(e));
    this.root.addEventListener('keydown', (e) => this.onRootKey(e));
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
        case 'escape':
          if (this.modal) this.setModal(null);
          else if (this.game.candidate || this.game.demolishTarget) this.game.clearPending();
          else if (this.game.tool.kind !== 'none') this.game.cancelTool();
          else if (this.game.cleanMode) this.game.setCleanMode(false);
          else this.game.select(null, 0);
          break;
        case 'h':
          this.game.setCleanMode(!this.game.cleanMode);
          break;
        case 'b':
          this.toggleBuild();
          break;
        case 'j':
          this.setModal(this.modal === 'journal' ? null : 'journal');
          break;
        case 'p':
          this.setModal(this.modal === 'people' ? null : 'people');
          break;
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
    const tab = (e.target as HTMLElement).closest('[role="tab"]') as HTMLElement | null;
    if (!tab || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const tabs = [...(tab.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    e.preventDefault();
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    this.modalTab = Number(next.dataset.i);
    this.renderModal();
    (this.modalHost.querySelector(`[role="tab"][data-i="${this.modalTab}"]`) as HTMLElement | null)?.focus();
  }

  // -------------------------------------------------------------------------
  // Per-frame refresh
  // -------------------------------------------------------------------------

  /** Cheap values, safe to run every frame. */
  tick(now: number): void {
    const g = this.g;
    // Until the chest exists there is no kingdom stock to speak of — the wood
    // is in the founder's arms — so the whole meter goes rather than sitting
    // there reading 0/0 and quietly lying about what "0" means.
    this.root.classList.toggle('founding', !foundingDone(g));

    const clock = this.hud.tick(this.game, this.env);
    this.cleanT.textContent = clock;
    const chipSea = this.root.querySelector('.clean-chip .sea');
    if (chipSea) chipSea.textContent = cap(g.season);

    this.renderToasts();

    // Panels are re-rendered a few times a second, not every frame.
    if (now - this.lastRender > 380) {
      this.lastRender = now;
      this.refreshPanels();
    }
  }

  /** Full rebuild of everything structural. */
  refresh(): void {
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
    this.renderToolbar();
    this.renderDock();
    this.refreshPanels();
    this.renderModal();
    this.renderIntro();
  }

  private refreshPanels(): void {
    // Never yank a text field out from under someone mid-rename.
    const active = document.activeElement as HTMLElement | null;
    const editing = active && (active.tagName === 'INPUT' || active.tagName === 'SELECT');
    this.renderBuildPanel();
    if (!editing || !this.sideRight.contains(active)) this.renderInspector();
    this.renderGoals();
    // A building panel is a live view of the place — who is standing in it, what
    // is on the shelf — so it keeps up, unless a dropdown in it is open.
    if (this.modal === 'building' && !(editing && this.modalHost.contains(active))) this.renderModal();
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
    };
  }

  private renderToolbar(): void {
    const html = this.env.compact ? '' : toolbarMarkup(this.navState());
    keepFocus(this.toolbarHost, () => {
      if (this.toolbarHost.innerHTML !== html) this.toolbarHost.innerHTML = html;
    });
  }

  private renderViewPad(): void {
    const html = viewPadMarkup(this.game);
    if (this.viewHost.innerHTML !== html) this.viewHost.innerHTML = html;
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
    const confirming = this.game.requireConfirm && (kind === 'build' || kind === 'camp');
    const bar =
      asking || confirming ? placementBarMarkup(this.game, this.env) : toolHintMarkup(this.game, this.env);

    if (this.toolHost.innerHTML !== bar) this.toolHost.innerHTML = bar;
    this.root.classList.toggle('has-hint', !!bar);

    const nav = this.env.compact ? bottomNavMarkup(this.navState()) : '';
    if (this.navHost.innerHTML !== nav) this.navHost.innerHTML = nav;
  }

  private renderToasts(): void {
    const g = this.g;
    const want = g.toasts.map((t) => `${t.icon}${t.text}${t.tone}`).join('|');
    if (this.toastHost.dataset.sig === want) return;
    this.toastHost.dataset.sig = want;
    this.toastHost.innerHTML = g.toasts
      .map(
        (t) => `<div class="toast ${t.tone}"><span aria-hidden="true">${t.icon}</span><span>${esc(t.text)}</span></div>`,
      )
      .join('');
    // Toasts are confirmations, so they are worth saying out loud once.
    const last = g.toasts[g.toasts.length - 1];
    if (last) this.focus.announce(last.text);
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  private renderBuildPanel(): void {
    // The stylesheet needs to know which sheet is up to keep the rest clear.
    this.root.classList.toggle('build-open', this.buildOpen);
    if (!this.buildOpen) {
      if (this.sideLeft.innerHTML) this.sideLeft.innerHTML = '';
      this.goalsHost.classList.remove('shifted');
      return;
    }
    this.goalsHost.classList.toggle('shifted', !this.env.compact);
    const body = buildListMarkup(this.game, this.env);
    const html = `<div class="panel scroll sheet" style="flex:1">
      <h3 id="build-title">Build<span class="tiny muted esc-hint">Esc to cancel</span>
        <button class="btn small sheet-close" data-act="toggle-build">Close</button></h3>
      <div class="sheet-body">${body}</div></div>`;
    keepFocus(this.sideLeft, () => {
      if (this.sideLeft.innerHTML !== html) this.sideLeft.innerHTML = html;
    });
  }

  // -------------------------------------------------------------------------
  // Inspector
  // -------------------------------------------------------------------------

  private renderInspector(): void {
    const sel = this.game.selection;
    let html = '';
    if (sel.kind === 'villager') html = villagerCard(this.game);
    else if (sel.kind === 'animal') html = animalCard(this.game);
    // Buildings get the whole modal instead of a card in the margin.
    else if (sel.kind === 'tile') html = tileCard(this.game);

    if (!html) {
      if (this.sideRight.innerHTML) this.sideRight.innerHTML = '';
      return;
    }
    // A sheet you cannot see the edge of needs its own way out; on a desktop
    // the card is in the margin and clicking the map is enough.
    const head = this.env.compact
      ? `<h3>${esc(inspectorTitle(this.game))}<button class="btn small sheet-close" data-act="clear-selection">Close</button></h3>`
      : '';
    const next = `<div class="panel scroll sheet" style="flex:0 1 auto;max-height:100%">${head}<div class="sheet-body">${html}</div></div>`;
    keepFocus(this.sideRight, () => {
      if (this.sideRight.innerHTML !== next) this.sideRight.innerHTML = next;
    });
  }

  // -------------------------------------------------------------------------
  // Goals
  // -------------------------------------------------------------------------

  private renderGoals(): void {
    const html = this.env.compact
      ? goalChipMarkup(this.game, this.goalsCollapsed)
      : goalPanelMarkup(this.game);
    if (this.goalsHost.innerHTML === html) return;
    this.goalsHost.innerHTML = html;
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
    const opening = kind && kind !== this.modal;
    this.modal = kind;
    this.modalTab = tab;
    // Only one major sheet at a time: a modal takes the screen from the build
    // list rather than sliding out from under it.
    if (kind && this.env.compact) this.buildOpen = false;
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

  private renderModal(): void {
    if (!this.modal) {
      if (this.modalHost.innerHTML) this.modalHost.innerHTML = '';
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
          this.modalHost.innerHTML = '';
          this.modalMount = '';
          // Set directly rather than through setModal: this runs inside a
          // render, and nothing else needs to change.
          this.modal = null;
          this.focus.release();
          return;
        }
        const def = BUILDINGS[b.def];
        tabNames = buildingTabs(b);
        const tab = tabNames[Math.min(this.modalTab, tabNames.length - 1)];
        title = buildingName(b.def, b.level);
        sub =
          b.stage === 'done'
            ? def.maxLevel > 1
              ? `Level ${b.level} of ${def.maxLevel}`
              : esc(def.desc)
            : b.upgrading
              ? 'Being improved'
              : 'Being built';
        body = buildingBody(this.game, b, tab);
        foot =
          this.game.demolishTarget === b.id
            ? `<span class="confirm-line">Remove the ${esc(def.name.toLowerCase())}? Half of what it cost comes back.</span>
               <span class="spacer"></span>
               <button class="btn small" data-act="cancel-place">Keep it</button>
               <button class="btn small danger primary" data-act="confirm-demolish">Remove it</button>`
            : buildingFoot(this.game, b);
        // Lives outside the h2 that gets swapped, so the picture is mounted once.
        pic = `<span class="mpic"><canvas data-pic="building" data-id="${b.id}" aria-hidden="true"></canvas></span>`;
        break;
      }
      case 'journal':
        title = 'Kingdom Journal';
        body = journalBody(this.game);
        break;
      case 'wildlife':
        title = 'Wildlife';
        body = wildlifeBody(this.game);
        break;
      case 'people':
        title = 'People';
        body = peopleBody(this.game, this.env);
        break;
      case 'stores':
        title = 'Stores';
        body = storesBody(this.game);
        break;
      case 'goals':
        title = 'What to do next';
        body = goalsBody(this.game);
        break;
      case 'more':
        title = 'More';
        body = moreBody(this.game, this.env);
        break;
      case 'settings':
        title = 'Kingdoms & Settings';
        tabNames = ['Kingdoms', 'Viewing', 'Sound'];
        body = this.modalTab === 0 ? slotsBody(this.game) : this.modalTab === 1 ? viewBody(this.game) : soundBody(this.game);
        break;
      default:
        break;
    }

    const active = Math.min(this.modalTab, Math.max(0, tabNames.length - 1));
    const tabs = tabNames
      .map(
        (t, i) =>
          `<button role="tab" id="mtab-${i}" aria-selected="${i === active}" aria-controls="modal-body"
            tabindex="${i === active ? 0 : -1}" data-act="tab" data-i="${i}" class="${i === active ? 'on' : ''}">${esc(t)}</button>`,
      )
      .join('');
    const head = `${esc(title)}${sub ? `<span class="msub">${sub}</span>` : ''}`;
    const mounted = this.modalHost.querySelector('.modal');
    const sig = `${this.modal}:${this.modal === 'building' ? this.game.selection.id : ''}`;

    /*
     * A building panel redraws several times a second. Replacing the whole
     * modal each time restarts the scrim's fade — which reads as a flicker, and
     * was invisible in the source and obvious in a screenshot — and throws away
     * the body's scroll position. So the same panel is updated in place.
     */
    if (mounted && this.modalMount === sig) {
      keepFocus(this.modalHost, () => {
        const swap = (sel: string, html: string) => {
          const node = mounted.querySelector(sel);
          if (!node || node.innerHTML === html) return;
          const keep = node.scrollTop;
          // "Here now" is a fixed-height scroller inside the body, so it needs
          // its own place kept as well — it is replaced along with everything else.
          const inner = node.querySelector('.bhere')?.scrollTop ?? 0;
          node.innerHTML = html;
          node.scrollTop = keep;
          const here = node.querySelector('.bhere');
          if (here) here.scrollTop = inner;
        };
        swap('h2', head);
        swap('.tabs', tabs);
        swap('.body', body);
        swap('.foot', foot);
      });
      paintPortraits(this.game, this.modalHost);
      return;
    }

    this.modalMount = sig;
    this.modalHost.innerHTML = `<div class="scrim" data-act="close-scrim">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-stop="1">
        <header>${pic}<h2 id="modal-title">${head}</h2>
          <button class="btn small" data-act="close-modal" aria-label="Close">Close</button></header>
        ${tabs ? `<div class="tabs" role="tablist">${tabs}</div>` : ''}
        <div class="body" id="modal-body" ${tabs ? `role="tabpanel" aria-labelledby="mtab-${active}"` : ''}>${body}</div>
        ${foot ? `<div class="foot">${foot}</div>` : ''}
      </div></div>`;
    paintPortraits(this.game, this.modalHost);
    const panel = this.modalHost.querySelector('.modal') as HTMLElement | null;
    if (panel) this.focus.enter(panel, TRUE_MODALS.includes(this.modal));
  }

  private renderIntro(): void {
    const g = this.g;
    const fresh = g.day === 1 && g.buildings.length <= 1 && g.villagers.length === 1 && g.played < 2;
    if (this.introDismissed || !fresh) {
      if (this.introHost.innerHTML) this.introHost.innerHTML = '';
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
      Watch where they stop, tell them this will do, and see what the place becomes.</p>
      <button class="btn primary" data-act="dismiss-intro">Begin</button>
      <div class="keys">${keys}</div>
    </div></div>`;
    // Rebuilt only when it would actually differ: the card is mounted before
    // the screen has told us what shape it is, so the key list can change once.
    if (this.introHost.innerHTML === html) return;
    this.introHost.innerHTML = html;
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
      case 'modal-journal':
        this.setModal(this.modal === 'journal' ? null : 'journal');
        break;
      case 'modal-wildlife':
        this.setModal(this.modal === 'wildlife' ? null : 'wildlife');
        break;
      case 'modal-more':
        this.setModal(this.modal === 'more' ? null : 'more');
        break;
      case 'modal-goals':
        this.setModal(this.modal === 'goals' ? null : 'goals');
        break;
      case 'open-stores':
        // A control wherever there is no hover to explain the chips — which is
        // any touchscreen, not only a phone.
        if (this.env.compact || this.env.touch) this.setModal(this.modal === 'stores' ? null : 'stores');
        break;
      case 'modal-settings':
        this.setModal(this.modal === 'settings' ? null : 'settings', Number(target.dataset.i ?? 0));
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
        this.renderModal();
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
        this.introHost.innerHTML = '';
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
      case 'rename-villager':
        this.game.renameVillager(id, target.value);
        break;
      case 'name-animal':
        this.game.nameAnimal(id, target.value);
        break;
      case 'assign':
        this.game.assign(id, Number(target.value));
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
