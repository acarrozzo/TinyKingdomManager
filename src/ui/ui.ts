/**
 * The interface. Plain DOM over the canvas — easier to make legible and
 * pleasant than drawing widgets by hand, and it disappears completely in
 * clean viewing mode, which is the point of the whole thing.
 */

import type { GameState, JobId, ResourceId, SpeciesId, Villager } from '../types';
import { RESOURCE_ORDER, STORED_RESOURCES } from '../types';
import {
  BUILDINGS,
  BUILD_ORDER,
  CATEGORY_META,
  JOB_META,
  PROP_META,
  RANK_COLOR,
  RESOURCE_INFO,
  RESOURCE_META,
  SPECIES,
  SPECIES_ORDER,
  TERRAIN_META,
  TERRAIN_SPEED,
  TRAIT_META,
  rankOf,
} from '../sim/defs';
import { buildingById, homeCapacity, jobSlots, villagerById, xpOf } from '../sim/state';
import { labourNeeded, siteNeeds } from '../sim/villager';
import { isUnlocked } from '../sim/goals';
import { fmt, fmtDuration } from '../core/util';
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
import { ZOOM_LEVELS } from '../render/camera';

type ModalKind = 'journal' | 'wildlife' | 'people' | 'kingdom' | 'settings' | null;

const el = (tag: string, cls?: string, html?: string): HTMLElement => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class UI {
  private root: HTMLElement;
  private game: Game;
  private modal: ModalKind = null;
  private modalTab = 0;
  private buildOpen = false;
  private introDismissed = false;
  private lastRender = 0;

  // Long-lived nodes that are cheap to update in place every frame.
  private resNodes = new Map<ResourceId, { wrap: HTMLElement; val: HTMLElement }>();
  private clockT!: HTMLElement;
  private clockS!: HTMLElement;
  private storageBar!: HTMLElement;
  private storageTxt!: HTMLElement;
  private cleanT!: HTMLElement;
  private toastHost!: HTMLElement;
  private sideLeft!: HTMLElement;
  private sideRight!: HTMLElement;
  private goalsHost!: HTMLElement;
  private modalHost!: HTMLElement;
  private introHost!: HTMLElement;
  private viewHost!: HTMLElement;
  private buttonsHost!: HTMLElement;
  private toolHost!: HTMLElement;

  constructor(root: HTMLElement, game: Game) {
    this.root = root;
    this.game = game;
    this.build();
    game.onChange = () => this.refresh();
    this.bindKeys();
    this.refresh();
  }

  private get g(): GameState {
    return this.game.state;
  }

  // -------------------------------------------------------------------------
  // Static scaffolding
  // -------------------------------------------------------------------------

  private build(): void {
    this.root.innerHTML = '';

    const topbar = el('div', 'topbar hide-in-clean');
    const left = el('div', 'cluster');
    const resPill = el('div', 'pill');
    for (const res of RESOURCE_ORDER) {
      const meta = RESOURCE_META[res];
      const wrap = el('span', 'res');
      wrap.innerHTML = `<span class="icon">${meta.icon}</span><span class="val">0</span><span class="tip"></span>`;
      // Filled on hover rather than every frame — six of these, sixty times a second.
      const tip = wrap.querySelector('.tip') as HTMLElement;
      wrap.addEventListener('pointerenter', () => {
        tip.innerHTML = this.resourceTip(res);
      });
      resPill.appendChild(wrap);
      this.resNodes.set(res, { wrap, val: wrap.querySelector('.val') as HTMLElement });
    }
    left.appendChild(resPill);

    const storePill = el('div', 'pill');
    storePill.innerHTML = `<span class="storage"><span>Store</span><span class="bar"><i style="width:0%"></i></span><span class="txt">0/0</span><span class="tip"></span></span>`;
    this.storageBar = storePill.querySelector('.bar') as HTMLElement;
    this.storageTxt = storePill.querySelector('.txt') as HTMLElement;
    const storeTip = storePill.querySelector('.tip') as HTMLElement;
    storePill.addEventListener('pointerenter', () => {
      storeTip.innerHTML = this.storageTip();
    });
    left.appendChild(storePill);
    topbar.appendChild(left);

    const right = el('div', 'cluster');
    const clockPill = el('div', 'pill');
    clockPill.innerHTML = `<span class="clock"><span class="t">00:00</span><span class="s">Spring · Year 1</span></span>`;
    this.clockT = clockPill.querySelector('.t') as HTMLElement;
    this.clockS = clockPill.querySelector('.s') as HTMLElement;
    right.appendChild(clockPill);

    this.buttonsHost = el('div', 'cluster');
    right.appendChild(this.buttonsHost);
    topbar.appendChild(right);
    this.root.appendChild(topbar);

    this.sideLeft = el('div', 'side left hide-in-clean');
    this.sideRight = el('div', 'side right hide-in-clean');
    this.root.appendChild(this.sideLeft);
    this.root.appendChild(this.sideRight);

    this.goalsHost = el('div', 'goals hide-in-clean');
    this.root.appendChild(this.goalsHost);

    this.toolHost = el('div', 'tool-hint-host');
    this.root.appendChild(this.toolHost);

    // Everything you reach for while just watching, gathered in one corner and
    // sized for a thumb: it is the only way to move the map on a touchscreen.
    this.viewHost = el('div', 'viewpad hide-in-clean');
    this.root.appendChild(this.viewHost);

    this.toastHost = el('div', 'toasts');
    this.root.appendChild(this.toastHost);

    const chip = el('div', 'clean-chip');
    chip.innerHTML = `<span class="t">00:00</span><span class="sea muted">Spring</span><button data-act="clean-off">show interface</button>`;
    this.cleanT = chip.querySelector('.t') as HTMLElement;
    this.root.appendChild(chip);

    this.modalHost = el('div');
    this.root.appendChild(this.modalHost);

    this.introHost = el('div');
    this.root.appendChild(this.introHost);

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('change', (e) => this.onChangeEvent(e));
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
          else if (this.game.tool.kind !== 'none') this.game.cancelTool();
          else if (this.game.cleanMode) this.game.setCleanMode(false);
          else this.game.select(null, 0);
          break;
        case 'h':
          this.game.setCleanMode(!this.game.cleanMode);
          this.root.classList.toggle('clean', this.game.cleanMode);
          break;
        case 'b':
          this.buildOpen = !this.buildOpen;
          this.refresh();
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

  // -------------------------------------------------------------------------
  // Per-frame refresh
  // -------------------------------------------------------------------------

  /** Cheap values, safe to run every frame. */
  tick(now: number): void {
    const g = this.g;
    for (const res of RESOURCE_ORDER) {
      const node = this.resNodes.get(res)!;
      const hidden = res !== 'wood' && res !== 'stone' && g.stock[res] <= 0 && !this.everSeen(res);
      node.wrap.classList.toggle('locked', hidden);
      node.val.textContent = fmt(g.stock[res]);
    }
    const store = this.game.storageInfo();
    const pct = store.cap > 0 ? Math.min(100, (store.used / store.cap) * 100) : 0;
    (this.storageBar.firstElementChild as HTMLElement).style.width = `${pct}%`;
    this.storageBar.classList.toggle('full', pct > 97);
    this.storageTxt.textContent = `${fmt(store.used)}/${fmt(store.cap)}`;

    const clock = this.game.clockLabel();
    this.clockT.textContent = clock;
    this.cleanT.textContent = clock;
    const seasonLabel = `${cap(g.season)} · Year ${g.year}`;
    this.clockS.textContent = seasonLabel;
    const chipSea = this.root.querySelector('.clean-chip .sea');
    if (chipSea) chipSea.textContent = seasonLabel;

    this.renderToasts();

    // Panels are re-rendered a few times a second, not every frame.
    if (now - this.lastRender > 380) {
      this.lastRender = now;
      this.refreshPanels();
    }
  }

  /** Hover copy for a top-bar resource: how much, where from, where to. */
  private resourceTip(res: ResourceId): string {
    const g = this.g;
    const meta = RESOURCE_META[res];
    const info = RESOURCE_INFO[res];
    const store = this.game.storageInfo();
    const amount = Math.floor(g.stock[res]);
    const share =
      res === 'coin' || store.cap <= 0 ? null : Math.round((g.stock[res] / store.cap) * 100);

    return `<span class="tip-head"><span class="tip-ic">${meta.icon}</span>${esc(meta.name)}
        <b>${fmt(amount)}</b></span>
      ${share === null ? '' : `<span class="tip-row"><span>Of the store</span><span>${share}%</span></span>`}
      <span class="tip-line"><b>From</b> ${esc(info.from)}</span>
      <span class="tip-line"><b>For</b> ${esc(info.used)}</span>`;
  }

  /** Hover copy for the store meter: what is actually taking up the room. */
  private storageTip(): string {
    const g = this.g;
    const store = this.game.storageInfo();
    const rows = STORED_RESOURCES.filter((res) => g.stock[res] > 0)
      .sort((a, b) => g.stock[b] - g.stock[a])
      .map(
        (res) =>
          `<span class="tip-row"><span>${RESOURCE_META[res].icon} ${esc(RESOURCE_META[res].name)}</span>
            <span>${fmt(Math.floor(g.stock[res]))}</span></span>`,
      )
      .join('');
    const room = Math.max(0, store.cap - store.used);

    return `<span class="tip-head">The store <b>${fmt(store.used)}/${fmt(store.cap)}</b></span>
      ${rows || '<span class="tip-line">Nothing in it yet.</span>'}
      <span class="tip-line">${
        room <= 0
          ? 'Full, so nobody is gathering more. Anything already being carried still gets put away, which is why this can read over the limit. Build a storehouse to raise it.'
          : `Room for ${fmt(room)} more. Storehouses raise the ceiling.`
      }</span>`;
  }

  private everSeen(res: ResourceId): boolean {
    // Once a resource has ever been produced its chip stays visible.
    const g = this.g;
    if (res === 'wheat') return g.stats.harvested > 0;
    if (res === 'flour') return g.buildings.some((b) => b.def === 'mill');
    if (res === 'bread') return g.stats.baked > 0;
    if (res === 'coin') return g.stock.coin > 0;
    return true;
  }

  /** Full rebuild of everything structural. */
  refresh(): void {
    this.root.classList.toggle('clean', this.game.cleanMode);
    this.renderViewPad();
    this.renderButtons();
    this.renderToolHint();
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
  }

  // -------------------------------------------------------------------------
  // Top bar
  // -------------------------------------------------------------------------

  /**
   * The bottom-right cluster: zoom, recentre, follow and speed. On a phone
   * these buttons are the whole of the interface that matters, so they get
   * proper tap targets rather than the toolbar's compact sizing.
   */
  private renderViewPad(): void {
    const cam = this.game.camera;

    /*
     * The label lives on the wrapper, not the button: a disabled button takes
     * no pointer events, so a tooltip on it would never appear — and a button
     * that is greyed out with no explanation is the one you most want to ask
     * about.
     */
    const btn = (act: string, label: string, tip: string, off = false) =>
      `<span class="vwrap">
        <button class="vbtn" data-act="${act}" ${off ? 'disabled' : ''} aria-label="${esc(tip)}">${label}</button>
        <span class="vtip">${esc(tip)}</span>
      </span>`;

    const last = ZOOM_LEVELS.length - 1;
    this.viewHost.innerHTML = [
      btn('zoom-out', '−', `Zoom out (now ${cam.zoom}×)`, cam.zoomIndex <= 0),
      btn('zoom-in', '+', `Zoom in (now ${cam.zoom}×)`, cam.zoomIndex >= last),
      btn('recentre', '⌂', 'Back to the campfire'),
    ].join('');
  }

  /** Speed lives in the settings panel; the keys are the quick way to it. */
  private speedControl(): string {
    const g = this.g;
    const opts: { label: string; speed: number; tip: string }[] = [
      { label: '❚❚', speed: 0, tip: 'Pause (space)' },
      { label: '1×', speed: 1, tip: 'Normal speed (1)' },
      { label: '2×', speed: 2, tip: 'Double speed (2)' },
      { label: '4×', speed: 4, tip: 'Four times speed (3)' },
    ];
    const buttons = opts
      .map((o) => {
        const on = o.speed === 0 ? g.paused : !g.paused && g.speed === o.speed;
        return `<button data-act="speed" data-speed="${o.speed}" class="${on ? 'on' : ''}"
          title="${esc(o.tip)}">${o.label}</button>`;
      })
      .join('');
    return `<div class="speed">${buttons}</div>`;
  }

  private renderButtons(): void {
    const b = (act: string, label: string, on = false, title = '') =>
      `<button class="btn ${on ? 'on' : ''}" data-act="${act}" title="${esc(title)}">${label}</button>`;
    this.buttonsHost.innerHTML = [
      b('toggle-build', '🔨 Build', this.buildOpen, 'Buildings you can place (B)'),
      `<span class="divider"></span>`,
      b('modal-people', '👥', this.modal === 'people', 'People and jobs (P)'),
      b('modal-journal', '📖', this.modal === 'journal', 'Kingdom journal (J)'),
      b('modal-wildlife', '🔭', this.modal === 'wildlife', 'Wildlife seen'),
      b('modal-settings', '⚙️', this.modal === 'settings', 'Kingdoms and settings'),
      b('clean-on', '👁', this.game.cleanMode, 'Clean viewing mode — hide the interface (H)'),
    ].join('');
  }

  /**
   * A tool with no visible effect until you happen to hover the map is a tool
   * nobody finds. While one is active this says what it does and how to stop.
   */
  private renderToolHint(): void {
    const t = this.game.tool;
    let icon = '';
    let title = '';
    let body = '';

    if (t.kind === 'build') {
      const def = BUILDINGS[t.def];
      const cost = Object.entries(def.cost)
        .map(([res, qty]) => `${qty} ${RESOURCE_META[res].name.toLowerCase()}`)
        .join(' and ');
      const short = !this.game.canAffordNew(t.def);
      icon = '🔨';
      title = `Placing a ${def.name}`;
      body = short
        ? `Not enough in store right now — needs ${cost}.`
        : `Click a clear spot on the map. Costs ${cost || 'nothing'}; villagers will carry the materials over and build it.`;
    } else if (t.kind === 'demolish') {
      icon = '⛏';
      title = 'Removing';
      body = 'Click a building to take it down — half the materials come back.';
    }

    if (!title) {
      this.toolHost.innerHTML = '';
      return;
    }
    this.toolHost.innerHTML = `<div class="toolbar-hint">
      <span class="ic">${icon}</span>
      <span class="txt"><b>${esc(title)}</b><span>${esc(body)}</span></span>
      <button class="btn small" data-act="cancel-tool">Done <kbd>Esc</kbd></button>
    </div>`;
  }

  private renderToasts(): void {
    const g = this.g;
    const want = g.toasts.map((t) => `${t.icon}${t.text}${t.tone}`).join('|');
    if (this.toastHost.dataset.sig === want) return;
    this.toastHost.dataset.sig = want;
    this.toastHost.innerHTML = g.toasts
      .map((t) => `<div class="toast ${t.tone}"><span>${t.icon}</span><span>${esc(t.text)}</span></div>`)
      .join('');
  }

  // -------------------------------------------------------------------------
  // Build panel
  // -------------------------------------------------------------------------

  private renderBuildPanel(): void {
    // On a phone the panels share the bottom of the screen, so the stylesheet
    // needs to know which one is open to keep them off each other.
    this.root.classList.toggle('build-open', this.buildOpen);
    if (!this.buildOpen) {
      this.sideLeft.innerHTML = '';
      this.goalsHost.classList.remove('shifted');
      return;
    }
    this.goalsHost.classList.add('shifted');
    const g = this.g;
    const tool = this.game.tool;

    const groups = new Map<string, string[]>();
    for (const id of BUILD_ORDER) {
      const def = BUILDINGS[id];
      if (!isUnlocked(g, def.unlock)) continue;
      const affordable = this.game.canAffordNew(id);
      const cost = Object.entries(def.cost)
        .map(([res, qty]) => `${RESOURCE_META[res].icon}${qty}`)
        .join(' ');
      const on = tool.kind === 'build' && tool.def === id;
      const html = `<button class="build-item ${on ? 'on' : ''}" data-act="build" data-def="${id}">
        <span class="row1"><span class="name">${esc(def.name)}</span>
        <span class="cost ${affordable ? '' : 'short'}">${cost || '—'}</span></span>
        <span class="desc">${esc(def.desc)}</span></button>`;
      const list = groups.get(def.category) ?? [];
      list.push(html);
      groups.set(def.category, list);
    }

    let body = '';
    for (const [cat, items] of groups) {
      const meta = CATEGORY_META[cat];
      body += `<div class="build-group"><div class="label">${meta.icon} ${meta.name}</div>${items.join('')}</div>`;
    }
    const locked = BUILD_ORDER.filter((id) => !isUnlocked(g, BUILDINGS[id].unlock)).length;
    if (locked > 0) {
      body += `<div class="build-group"><div class="label" style="padding-bottom:0">${locked} more unlock as the kingdom grows</div></div>`;
    }

    // Taking things down belongs with putting them up, and it is the rarer of
    // the two — a building's own panel has a Remove button as well.
    const removing = tool.kind === 'demolish';
    body += `<div class="build-group build-remove">
      <button class="btn small ${removing ? 'on' : ''}" data-act="tool-demolish">
        ⛏ ${removing ? 'Removing — click a building' : 'Remove a building'}</button>
      <div class="tiny muted" style="margin-top:7px;line-height:1.5">Half the materials come back. You can also remove one from its own panel.</div>
    </div>`;

    this.sideLeft.innerHTML = `<div class="panel scroll" style="flex:1">
      <h3>Build<span class="tiny muted esc-hint">Esc to cancel</span>
        <button class="btn small sheet-close" data-act="toggle-build">Close</button></h3>${body}</div>`;
  }

  // -------------------------------------------------------------------------
  // Inspector
  // -------------------------------------------------------------------------

  private renderInspector(): void {
    const sel = this.game.selection;
    if (!sel.kind) {
      this.sideRight.innerHTML = '';
      return;
    }
    let html = '';
    if (sel.kind === 'villager') html = this.villagerCard();
    else if (sel.kind === 'animal') html = this.animalCard();
    else if (sel.kind === 'building') html = this.buildingCard();
    else if (sel.kind === 'tile') html = this.tileCard();
    this.sideRight.innerHTML = html
      ? `<div class="panel scroll" style="flex:0 1 auto;max-height:100%">${html}</div>`
      : '';
  }

  private villagerCard(): string {
    const g = this.g;
    const v = this.game.selectedVillager();
    if (!v) return '';
    const home = buildingById(g, v.home);
    const work = buildingById(g, v.workplace);
    const trait = TRAIT_META[v.trait];
    const following = this.game.camera.followId === v.id;
    const daysHere = Math.max(0, g.day - v.arrived);

    const jobs = (Object.keys(v.xp) as JobId[]).filter((j) => (v.xp[j] ?? 0) > 0.4);
    jobs.sort((a, b) => (v.xp[b] ?? 0) - (v.xp[a] ?? 0));
    const xpRows =
      jobs.length === 0
        ? `<div class="tiny muted">No experience yet. It comes from doing the work.</div>`
        : jobs
            .map((j) => {
              const xp = xpOf(v, j);
              const rank = rankOf(xp);
              return `<div class="xp-row"><span class="job">${JOB_META[j].name}</span>
                <span class="track"><i style="width:${xp}%;background:${RANK_COLOR[rank]}"></i></span>
                <span class="rank" style="color:${RANK_COLOR[rank]}">${rank}</span></div>`;
            })
            .join('');

    const jobOptions = this.jobOptionsFor(v);
    const history = v.history
      .slice()
      .reverse()
      .slice(0, 6)
      .map((h) => `<div class="hist"><b>Day ${h.day}</b><br>${esc(h.text)}</div>`)
      .join('');

    return `<div class="insp">
      <div class="title">
        <input class="namefield" data-act="rename-villager" data-id="${v.id}" value="${esc(v.name)}" maxlength="28">
      </div>
      <div class="sub">${esc(activityLabel(v))}${v.id === g.founderId ? ' · <span style="color:var(--accent)">Founder</span>' : ''}</div>

      <div class="section">
        <div class="row" style="gap:5px">
          <span class="tag accent">${trait.icon} ${trait.name}</span>
          <span class="tag">Arrived day ${v.arrived}</span>
          ${daysHere > 0 ? `<span class="tag">${daysHere} day${daysHere === 1 ? '' : 's'} here</span>` : ''}
        </div>
        <div class="tiny muted" style="margin-top:7px;line-height:1.5">${esc(trait.desc)}</div>
      </div>

      <div class="section">
        <div class="h">Work</div>
        <select data-act="assign" data-id="${v.id}" style="width:100%">${jobOptions}</select>
        ${work ? `<div class="tiny muted" style="margin-top:5px">Working at the ${esc(BUILDINGS[work.def].name.toLowerCase())}</div>` : ''}
      </div>

      <div class="section">
        <div class="h">Experience</div>${xpRows}
      </div>

      <div class="section">
        <div class="kv"><span class="k">Home</span><span class="v">${home ? esc(BUILDINGS[home.def].name) : 'None yet'}</span></div>
        <div class="kv"><span class="k">Rested</span><span class="v">${Math.round(v.energy * 100)}%</span></div>
        <div class="kv"><span class="k">Appetite</span><span class="v">${v.hunger > 0.7 ? 'Hungry' : v.hunger > 0.4 ? 'Peckish' : 'Fine'}</span></div>
        ${v.carrying ? `<div class="kv"><span class="k">Carrying</span><span class="v">${RESOURCE_META[v.carrying.res].icon} ${Math.round(v.carrying.qty)}</span></div>` : ''}
      </div>

      ${history ? `<div class="section"><div class="h">History</div>${history}</div>` : ''}

      <div class="actions">
        <button class="btn small ${following ? 'on' : ''}" data-act="${following ? 'unfollow' : 'follow-villager'}" data-id="${v.id}">
          ${following ? '⦿ Following' : '⦿ Follow'}</button>
        <button class="btn small ${v.favorite ? 'on' : ''}" data-act="fav-villager" data-id="${v.id}">
          ${v.favorite ? '★ Favourite' : '☆ Favourite'}</button>
        <button class="btn small" data-act="goto" data-x="${Math.round(v.x)}" data-y="${Math.round(v.y)}">Centre</button>
      </div>
    </div>`;
  }

  private jobOptionsFor(v: Villager): string {
    const g = this.g;
    let out = `<option value="0" ${v.workplace === 0 ? 'selected' : ''}>🧺 Helper — general work</option>`;
    for (const b of g.buildings) {
      if (b.stage !== 'done') continue;
      const def = BUILDINGS[b.def];
      if (!def.job) continue;
      const slots = jobSlots(b);
      const taken = b.workers.length;
      const mine = v.workplace === b.id;
      if (!mine && taken >= slots) continue;
      const meta = JOB_META[def.job];
      out += `<option value="${b.id}" ${mine ? 'selected' : ''}>${meta.icon} ${meta.name} — ${esc(def.name)} (${taken}/${slots})</option>`;
    }
    return out;
  }

  private animalCard(): string {
    const g = this.g;
    const a = this.game.selectedAnimal();
    if (!a) return '';
    const def = SPECIES[a.species];
    const following = this.game.camera.followId === a.id;
    const days = Math.max(0, g.day - a.seen);
    return `<div class="insp">
      <div class="title">
        <input class="namefield" data-act="name-animal" data-id="${a.id}" value="${esc(a.name ?? '')}" placeholder="${esc(def.name)} — give it a name" maxlength="24">
      </div>
      <div class="sub">${esc(def.name)}${a.name ? '' : ' · unnamed'}</div>

      <div class="section">
        <div class="kv"><span class="k">First seen</span><span class="v">Day ${a.seen}</span></div>
        ${days > 0 ? `<div class="kv"><span class="k">Around for</span><span class="v">${days} day${days === 1 ? '' : 's'}</span></div>` : ''}
        <div class="kv"><span class="k">Doing</span><span class="v">${animalStateLabel(a.state)}</span></div>
      </div>

      <div class="section">
        <div class="h">Noticed</div>
        <div class="tiny muted" style="line-height:1.55">${esc(def.hint)}</div>
      </div>

      ${a.name || a.favorite ? '' : `<div class="hint">Naming an animal keeps it around. Unnamed wildlife wanders off eventually.</div>`}

      <div class="actions">
        <button class="btn small ${following ? 'on' : ''}" data-act="${following ? 'unfollow' : 'follow-animal'}" data-id="${a.id}">
          ${following ? '⦿ Following' : '⦿ Follow'}</button>
        <button class="btn small ${a.favorite ? 'on' : ''}" data-act="fav-animal" data-id="${a.id}">
          ${a.favorite ? '★ Favourite' : '☆ Favourite'}</button>
      </div>
    </div>`;
  }

  /**
   * Bare ground is worth reading too — what it is, what is standing on it and
   * what that is good for. Wildlife stays observational: no spawn numbers, and
   * nothing named that the kingdom has not already met.
   */
  private tileCard(): string {
    const g = this.g;
    const sel = this.game.selectedTile();
    if (!sel) return '';
    const { tile, x, y } = sel;
    const meta = TERRAIN_META[tile.terrain];
    const speed = TERRAIN_SPEED[tile.terrain] ?? 1;
    const buildable = tile.terrain !== 'water' && tile.terrain !== 'shallow';

    let onIt = `<div class="tiny muted" style="line-height:1.55">Nothing standing on it.</div>`;
    if (tile.prop) {
      const prop = PROP_META[tile.prop];
      const yields = prop.yields;
      const rows: string[] = [];
      if (yields && tile.amount > 0) {
        rows.push(
          `<div class="kv"><span class="k">${RESOURCE_META[yields].name} left</span>
            <span class="v">${RESOURCE_META[yields].icon} ${Math.floor(tile.amount)}</span></div>`,
        );
      }
      if (tile.regrow > 0) {
        rows.push(
          `<div class="kv"><span class="k">Coming back in</span><span class="v">${fmtDuration(tile.regrow)}</span></div>`,
        );
      }
      onIt = `<div class="row" style="gap:5px;margin-bottom:7px"><span class="tag accent">${esc(prop.name)}</span></div>
        <div class="tiny muted" style="line-height:1.55;margin-bottom:${rows.length ? '7px' : '0'}">${esc(prop.desc)}</div>
        ${rows.join('')}`;
    }

    const going = speed <= 0 ? 'Impassable' : speed < 0.8 ? 'Slow going' : speed < 1 ? 'A little slow' : 'Easy walking';

    // Only species the kingdom has actually met get named here.
    const known = SPECIES_ORDER.filter((id) => g.discovered.has(id)).filter((id) => {
      const def = SPECIES[id];
      const habitat = def.habitat[tile.terrain] ?? 0;
      const likes = tile.prop ? def.likesProps?.[tile.prop] ?? 0 : 0;
      return habitat >= 0.7 || (habitat > 0 && likes >= 0.5);
    });
    const names = known.slice(0, 3).map((id) => SPECIES[id].plural.toLowerCase());
    const seenLine =
      names.length === 0 ? meta.feel : `You have seen ${listWords(names)} in and around ${meta.like}.`;

    return `<div class="insp">
      <div class="title"><b>${esc(meta.name)}</b></div>
      <div class="sub">Tile ${x}, ${y}</div>

      <div class="section">
        <div class="tiny muted" style="line-height:1.55">${esc(meta.desc)}</div>
      </div>

      <div class="section">
        <div class="h">On this tile</div>${onIt}
      </div>

      <div class="section">
        <div class="kv"><span class="k">Going</span><span class="v">${going}</span></div>
        <div class="kv"><span class="k">Building here</span><span class="v">${buildable ? 'Allowed' : 'Not on water'}</span></div>
      </div>

      <div class="section">
        <div class="h">Noticed</div>
        <div class="tiny muted" style="line-height:1.55">${esc(seenLine)}</div>
      </div>

      <div class="actions">
        <button class="btn small" data-act="goto" data-x="${x}" data-y="${y}">Centre</button>
      </div>
    </div>`;
  }

  private buildingCard(): string {
    const g = this.g;
    const b = this.game.selectedBuilding();
    if (!b) return '';
    const def = BUILDINGS[b.def];
    let body = '';

    if (b.stage === 'building') {
      const needs = siteNeeds(b);
      const need = labourNeeded(b);
      const rows = needs
        .map((n) => {
          const pct = n.need > 0 ? Math.min(100, (n.have / n.need) * 100) : 100;
          return `<div class="need"><span>${RESOURCE_META[n.res].icon}</span>
            <span class="track"><i style="width:${pct}%"></i></span>
            <span class="num">${Math.floor(n.have)}/${n.need}</span></div>`;
        })
        .join('');
      const labourPct = need > 0 ? Math.min(100, (b.labour / need) * 100) : 100;
      const crew = g.villagers.filter((v) => v.claim?.kind === 'labour' && v.claim.id === b.id).length;
      body = `<div class="section"><div class="h">${b.upgrading ? 'Improvement under way' : 'Under construction'}</div>
        <div class="needs">${rows}
        <div class="need"><span>🔨</span><span class="track"><i style="width:${labourPct}%;background:var(--good)"></i></span>
        <span class="num">${Math.round(labourPct)}%</span></div></div>
        <div class="tiny muted" style="margin-top:8px">${
          crew > 0
            ? `${crew} villager${crew === 1 ? '' : 's'} working on it.`
            : needs.some((n) => n.have < n.need)
              ? 'Waiting for materials to be carried over.'
              : 'Waiting for someone free to come and build it.'
        }</div></div>`;
    } else {
      if (def.slots) {
        const slots = jobSlots(b);
        const workers = b.workers
          .map((id) => villagerById(g, id))
          .filter((v): v is Villager => !!v)
          .map((v) => {
            const xp = def.job ? xpOf(v, def.job) : 0;
            const rank = rankOf(xp);
            return `<div class="worker"><span class="who" data-act="select-villager" data-id="${v.id}" style="cursor:pointer">${esc(v.name)}</span>
              <span class="row" style="gap:6px"><span class="tiny" style="color:${RANK_COLOR[rank]}">${rank}</span>
              <button class="btn small" data-act="unassign" data-id="${v.id}">Remove</button></span></div>`;
          })
          .join('');
        body += `<div class="section"><div class="h">Workers · ${b.workers.length}/${slots}</div>
          ${workers || '<div class="tiny muted">Nobody works here yet.</div>'}
          ${b.workers.length < slots ? `<button class="btn small" style="margin-top:8px" data-act="autostaff" data-id="${b.id}">Assign a helper</button>` : ''}
        </div>`;
      }

      if (def.recipe) {
        const inRes = Object.keys(def.recipe.inputs)[0] as ResourceId;
        const outRes = Object.keys(def.recipe.outputs)[0] as ResourceId;
        const inQty = def.recipe.inputs[inRes] ?? 0;
        const outQty = def.recipe.outputs[outRes] ?? 0;
        body += `<div class="section"><div class="h">Makes</div>
          <div class="row tiny" style="gap:6px">
            <span class="tag">${RESOURCE_META[inRes].icon} ${inQty} ${RESOURCE_META[inRes].name}</span>
            <span class="muted">→</span>
            <span class="tag accent">${RESOURCE_META[outRes].icon} ${outQty} ${RESOURCE_META[outRes].name}</span>
          </div>
          <div class="kv" style="margin-top:8px"><span class="k">On hand</span><span class="v">${Math.floor(b.input[inRes] ?? 0)} ${RESOURCE_META[inRes].name.toLowerCase()}</span></div>
          <div class="kv"><span class="k">Ready to collect</span><span class="v">${Math.floor(b.output[outRes] ?? 0)} ${RESOURCE_META[outRes].name.toLowerCase()}</span></div>
        </div>`;
      }

      if (def.plots && b.plots.length) {
        const ripe = b.plots.filter((p) => p.state === 'ripe').length;
        const growing = b.plots.filter((p) => p.state === 'growing').length;
        body += `<div class="section"><div class="h">Fields</div>
          <div class="kv"><span class="k">Ready to harvest</span><span class="v">${ripe}</span></div>
          <div class="kv"><span class="k">Growing</span><span class="v">${growing}</span></div>
          <div class="kv"><span class="k">Bare</span><span class="v">${b.plots.length - ripe - growing}</span></div>
          ${g.season === 'winter' ? '<div class="tiny muted" style="margin-top:6px">Wheat is slow in winter. It will pick up again in spring.</div>' : ''}
        </div>`;
      }

      if (def.housing) {
        const cap = homeCapacity(b);
        const names = b.residents
          .map((id) => villagerById(g, id))
          .filter((v): v is Villager => !!v)
          .map((v) => `<span class="tag" data-act="select-villager" data-id="${v.id}" style="cursor:pointer">${esc(v.name)}</span>`)
          .join(' ');
        body += `<div class="section"><div class="h">Residents · ${b.residents.length}/${cap}</div>
          <div class="row" style="gap:5px">${names || '<span class="tiny muted">Empty.</span>'}</div></div>`;
      }

      if (def.storage) {
        body += `<div class="section"><div class="kv"><span class="k">Holds</span><span class="v">${def.storage[Math.min(b.level, def.storage.length) - 1]} goods</span></div></div>`;
      }
      if (def.harvests) {
        body += `<div class="section"><div class="tiny muted" style="line-height:1.55">Workers here use ${def.harvests === 'tree' ? 'trees' : 'boulders'} within a short walk. They come back on their own.</div></div>`;
      }
    }

    const canUp = this.game.canUpgrade(b);
    const upgradeable = b.stage === 'done' && b.level < def.maxLevel && !b.upgrading;
    const upCost = upgradeable
      ? this.game
          .upgradeCost(b)
          .map((c) => `${RESOURCE_META[c.res].icon}${c.qty}`)
          .join(' ')
      : '';

    return `<div class="insp">
      <div class="title"><span class="name">${esc(def.name)}</span>
      ${def.maxLevel > 1 ? `<span class="tag">Level ${b.level}</span>` : ''}</div>
      <div class="sub">${esc(def.desc)}</div>
      ${body}
      <div class="actions">
        ${upgradeable ? `<button class="btn small ${canUp ? 'primary' : ''}" data-act="upgrade" data-id="${b.id}" ${canUp ? '' : 'disabled'}>⬆️ Improve ${upCost}</button>` : ''}
        <button class="btn small" data-act="goto" data-x="${b.x}" data-y="${b.y}">Centre</button>
        ${BUILDINGS[b.def].order < 0 ? '' : `<button class="btn small danger" data-act="demolish" data-id="${b.id}">Remove</button>`}
      </div>
      ${b.stage === 'done' && b.built ? `<div class="tiny muted" style="margin-top:9px">Built on day ${b.built}.</div>` : ''}
    </div>`;
  }

  // -------------------------------------------------------------------------
  // Goals
  // -------------------------------------------------------------------------

  private renderGoals(): void {
    const g = this.g;
    const pending = g.goals.filter((x) => !x.done);
    const done = g.goals.length - pending.length;
    if (pending.length === 0) {
      this.goalsHost.innerHTML = `<div class="panel"><div class="goal done"><span class="mark">✓</span>
        <span><span class="t">Everything on the list is done</span>
        <span class="d">The kingdom is yours to keep tending.</span></span></div></div>`;
      return;
    }
    const next = pending.slice(0, 2);
    const items = next
      .map(
        (goal) => `<div class="goal"><span class="mark"></span>
          <span><span class="t">${esc(goal.title)}</span><span class="d">${esc(goal.desc)}</span></span></div>`,
      )
      .join('');
    this.goalsHost.innerHTML = `<div class="panel">${items}
      <div class="goal-more">${done} of ${g.goals.length} done · ${g.villagers.length} villager${g.villagers.length === 1 ? '' : 's'} · ${fmtDuration(g.played)} played</div></div>`;
  }

  // -------------------------------------------------------------------------
  // Modals
  // -------------------------------------------------------------------------

  private setModal(kind: ModalKind): void {
    this.modal = kind;
    this.modalTab = 0;
    this.refresh();
  }

  private renderModal(): void {
    if (!this.modal) {
      this.modalHost.innerHTML = '';
      return;
    }
    let title = '';
    let body = '';
    let tabs = '';

    switch (this.modal) {
      case 'journal':
        title = 'Kingdom Journal';
        body = this.journalBody();
        break;
      case 'wildlife':
        title = 'Wildlife';
        body = this.wildlifeBody();
        break;
      case 'people':
        title = 'People';
        body = this.peopleBody();
        break;
      case 'settings':
        title = 'Kingdoms & Settings';
        tabs = ['Kingdoms', 'Viewing', 'Sound']
          .map((t, i) => `<button data-act="tab" data-i="${i}" class="${this.modalTab === i ? 'on' : ''}">${t}</button>`)
          .join('');
        body = this.modalTab === 0 ? this.slotsBody() : this.modalTab === 1 ? this.viewBody() : this.soundBody();
        break;
      default:
        break;
    }

    this.modalHost.innerHTML = `<div class="scrim" data-act="close-scrim">
      <div class="modal" data-stop="1">
        <header><h2>${esc(title)}</h2><button class="btn small" data-act="close-modal">Close</button></header>
        ${tabs ? `<div class="tabs">${tabs}</div>` : ''}
        <div class="body">${body}</div>
      </div></div>`;
  }

  private journalBody(): string {
    const g = this.g;
    if (g.journal.length === 0) return `<div class="muted">Nothing has happened yet. Give it time.</div>`;
    return g.journal
      .slice()
      .reverse()
      .map(
        (e) => `<div class="entry"><span class="when">Year ${e.year}, ${cap(e.season)} · Day ${e.day}</span>
          <span class="ic">${e.icon}</span><span>${esc(e.text)}</span></div>`,
      )
      .join('');
  }

  private wildlifeBody(): string {
    const g = this.g;
    const named = g.animals.filter((a) => a.name || a.favorite);
    const cards = SPECIES_ORDER.map((id: SpeciesId) => {
      const def = SPECIES[id];
      const seen = g.discovered.has(id);
      const here = g.animals.filter((a) => a.species === id).length;
      if (!seen) return `<div class="card unknown"><div class="cn"><span>? ? ?</span></div><div class="ch">Not seen yet.</div></div>`;
      return `<div class="card"><div class="cn"><span>${esc(def.name)}</span>${here > 0 ? `<span class="muted tiny">${here} about</span>` : ''}</div>
        <div class="ch">${esc(def.hint)}</div></div>`;
    }).join('');

    const namedList = named.length
      ? `<div style="margin-top:16px"><div class="muted tiny" style="text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px">Known by name</div>
        <div class="row" style="gap:6px">${named
          .map(
            (a) =>
              `<span class="tag accent" data-act="select-animal" data-id="${a.id}" style="cursor:pointer">${esc(a.name ?? SPECIES[a.species].name)}</span>`,
          )
          .join('')}</div></div>`
      : '';

    return `<div class="muted tiny" style="margin-bottom:11px">${g.discovered.size} of ${SPECIES_ORDER.length} kinds seen. What turns up depends on what the land looks like.</div>
      <div class="grid">${cards}</div>${namedList}`;
  }

  private peopleBody(): string {
    const g = this.g;
    const rows = g.villagers
      .slice()
      .sort((a, b) => a.arrived - b.arrived || a.id - b.id)
      .map((v) => {
        const best = (Object.keys(v.xp) as JobId[]).sort((a, b) => (v.xp[b] ?? 0) - (v.xp[a] ?? 0))[0];
        const xp = best ? xpOf(v, best) : 0;
        const rank = rankOf(xp);
        return `<div class="people-row">
          <span data-act="select-villager" data-id="${v.id}" style="cursor:pointer">${v.favorite ? '★ ' : ''}${esc(v.name)}${v.id === g.founderId ? ' <span class="muted tiny">founder</span>' : ''}</span>
          <select data-act="assign" data-id="${v.id}">${this.jobOptionsFor(v)}</select>
          <span class="tiny" style="color:${best ? RANK_COLOR[rank] : 'var(--faint)'}">${best ? `${rank} ${JOB_META[best].name.toLowerCase()}` : '—'}</span>
          <button class="btn small" data-act="follow-villager" data-id="${v.id}">Watch</button>
        </div>`;
      })
      .join('');

    const unemployed = g.villagers.filter((v) => v.workplace === 0).length;
    const openSlots = g.buildings
      .filter((b) => b.stage === 'done')
      .reduce((n, b) => n + Math.max(0, jobSlots(b) - b.workers.length), 0);

    return `<div class="row tiny muted" style="margin-bottom:11px;gap:14px">
        <span>${g.villagers.length} villagers</span><span>${unemployed} helpers</span><span>${openSlots} open job${openSlots === 1 ? '' : 's'}</span>
      </div>
      <div class="people-row head"><span>Name</span><span>Job</span><span>Best trade</span><span></span></div>
      ${rows}
      <div class="hint">Experience is earned by doing a job, and it is kept for good. Moving a master farmer to the mill does not erase what they learned in the field.</div>`;
  }

  private slotsBody(): string {
    const slots = listSlots();
    const current = this.game.slotId;
    const list = slots
      .map(
        (s) => `<div class="slot ${s.id === current ? 'on' : ''}">
          <div><div>${esc(s.name)}${s.id === current ? ' <span class="tiny muted">· open</span>' : ''}</div>
          <div class="meta">Year ${s.year}, ${cap(s.season)} · day ${s.day} · ${s.population} villager${s.population === 1 ? '' : 's'} · ${fmtDuration(s.played)}</div></div>
          <div class="row" style="gap:5px">
            ${s.id === current ? '' : `<button class="btn small" data-act="load-slot" data-id="${s.id}">Open</button>`}
            <button class="btn small" data-act="rename-slot" data-id="${s.id}">Rename</button>
            <button class="btn small danger" data-act="delete-slot" data-id="${s.id}">Delete</button>
          </div></div>`,
      )
      .join('');

    return `${list || '<div class="muted tiny">No saved kingdoms yet.</div>'}
      <div class="row" style="margin-top:14px">
        <button class="btn small primary" data-act="new-kingdom">✦ Start a new kingdom</button>
        <button class="btn small" data-act="save-now">Save now</button>
        <span class="spacer"></span>
        <button class="btn small" data-act="export">Export file</button>
        <button class="btn small" data-act="import">Import file</button>
      </div>
      <div class="hint">The kingdom saves itself every half minute and whenever you close the tab. Time only passes while the game is open — nothing happens while you are away.</div>`;
  }

  private viewBody(): string {
    const s = this.game.settings;
    return `<div class="row" style="margin-bottom:14px;gap:10px">
        <span style="width:64px">Speed</span>${this.speedControl()}
        <span class="tiny muted"><kbd>space</kbd> pauses · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> set the rate</span>
      </div>
      <label class="check" style="margin-bottom:11px"><input type="checkbox" data-act="set-bubbles" ${s.showBubbles ? 'checked' : ''}> Show what villagers say</label>
      <label class="check" style="margin-bottom:11px"><input type="checkbox" data-act="set-names" ${s.showNames ? 'checked' : ''}> Show names over favourites</label>
      <label class="check" style="margin-bottom:11px"><input type="checkbox" data-act="set-activity" ${s.showActivity ? 'checked' : ''}> Show what everyone is doing</label>
      <div class="hint">Clean viewing mode (<kbd>H</kbd>) hides the whole interface and leaves the kingdom running on its own. Double-click anyone to follow them about.</div>`;
  }

  private soundBody(): string {
    const s = this.game.settings;
    return `<div class="row" style="margin-bottom:12px"><span style="width:64px">Volume</span>
        <input type="range" min="0" max="1" step="0.02" value="${s.volume}" data-act="set-volume">
        <span class="tiny muted">${Math.round(s.volume * 100)}%</span></div>
      <label class="check"><input type="checkbox" data-act="set-muted" ${s.muted ? 'checked' : ''}> Mute everything</label>
      <div class="hint">Ambience is generated as you play rather than looped: wind, birds during the day, crickets after dark, and water when you are near it.</div>`;
  }

  private renderIntro(): void {
    const g = this.g;
    const fresh = g.day === 1 && g.buildings.length <= 1 && g.villagers.length === 1 && g.played < 2;
    if (this.introDismissed || !fresh) {
      this.introHost.innerHTML = '';
      return;
    }
    const founder = g.villagers[0];
    this.introHost.innerHTML = `<div class="intro"><div class="card2">
      <h1>Tiny Kingdom Manager</h1>
      <p>There is one person here. Their name is <b>${esc(founder?.name ?? 'someone')}</b>, and they have already started gathering wood.<br><br>
      Give them somewhere to sleep, somewhere to put things, and see what the place becomes.</p>
      <button class="btn primary" data-act="dismiss-intro">Begin</button>
      <div class="keys"><kbd>drag</kbd> pan · <kbd>scroll</kbd> or <kbd>pinch</kbd> · <kbd>double-click</kbd> follow someone<br>
      <kbd>B</kbd> build · <kbd>J</kbd> journal · <kbd>H</kbd> hide the interface · <kbd>space</kbd> pause</div>
    </div></div>`;
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
        this.buildOpen = !this.buildOpen;
        if (!this.buildOpen) game.cancelTool();
        this.refresh();
        break;
      case 'build':
        game.setTool({ kind: 'build', def: target.dataset.def as keyof typeof BUILDINGS });
        this.refresh();
        break;
      case 'tool-demolish':
        game.setTool(game.tool.kind === 'demolish' ? { kind: 'none' } : { kind: 'demolish' });
        this.refresh();
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
      case 'modal-settings':
        this.setModal(this.modal === 'settings' ? null : 'settings');
        break;
      case 'cancel-tool':
        game.cancelTool();
        this.refresh();
        break;
      case 'close-modal':
        this.setModal(null);
        break;
      case 'close-scrim':
        if (target === e.target) this.setModal(null);
        break;
      case 'tab':
        this.modalTab = Number(target.dataset.i);
        this.renderModal();
        break;
      case 'clean-on':
        game.setCleanMode(!game.cleanMode);
        this.refresh();
        break;
      case 'clean-off':
        game.setCleanMode(false);
        this.refresh();
        break;
      case 'dismiss-intro':
        this.introDismissed = true;
        this.renderIntro();
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
      case 'follow-selected': {
        const sel = game.selection;
        if (sel.kind === 'villager' || sel.kind === 'animal') game.follow(sel.kind, sel.id);
        break;
      }
      case 'zoom-in':
        game.zoomStep(1);
        break;
      case 'zoom-out':
        game.zoomStep(-1);
        break;
      case 'recentre': {
        const fire = game.state.buildings.find((b) => b.def === 'campfire') ?? game.state.buildings[0];
        if (fire) game.centerOn(fire.x, fire.y);
        break;
      }
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
      case 'demolish': {
        const b = buildingById(game.state, id);
        if (b) game.removeBuilding(b, true);
        break;
      }
      case 'goto':
        game.centerOn(Number(target.dataset.x), Number(target.dataset.y));
        break;
      case 'save-now':
        game.save();
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
      alert('That kingdom could not be opened.');
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

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "rabbits", "rabbits and deer", "rabbits, deer and sparrows". */
function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function animalStateLabel(state: string): string {
  switch (state) {
    case 'feed':
      return 'Nosing about';
    case 'rest':
      return 'Sitting still';
    case 'flee':
      return 'Startled';
    default:
      return 'Wandering';
  }
}

function activityLabel(v: Villager): string {
  switch (v.activity) {
    case 'sleeping':
      return 'Asleep';
    case 'walking':
      return 'Walking';
    case 'hauling':
      return `Carrying ${v.carrying ? RESOURCE_META[v.carrying.res].name.toLowerCase() : 'goods'}`;
    case 'working':
      return 'At work';
    case 'gathering':
      return 'Gathering';
    case 'building':
      return 'Building';
    case 'planting':
      return 'Sowing';
    case 'harvesting':
      return 'Harvesting';
    case 'eating':
      return 'Eating';
    case 'resting':
      return 'Sitting down';
    case 'chatting':
      return 'Talking to someone';
    case 'watching':
      return 'Watching the world go by';
    case 'fishing':
      return 'Fishing, more or less';
    case 'arriving':
      return 'Just arrived';
    default:
      return 'Idle';
  }
}

