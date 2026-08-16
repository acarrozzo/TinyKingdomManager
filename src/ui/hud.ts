/**
 * The top strip: what the kingdom owns, how much room is left, and the time.
 *
 * It is the first of the three levels of the interface — the things you glance
 * at constantly — so it stays one line tall on every screen and never moves.
 */

import type { ResourceId } from '../types';
import { RESOURCE_ORDER, STORED_RESOURCES } from '../types';
import { RESOURCE_INFO, RESOURCE_META } from '../sim/defs';
import { fmt } from '../core/util';
import type { Game } from '../game';
import { cap, el, esc, type UIEnv } from './context';

export class Hud {
  private resNodes = new Map<ResourceId, { wrap: HTMLElement; val: HTMLElement }>();
  private strip: HTMLElement;
  private stripWrap: HTMLElement;
  private storageBar: HTMLElement;
  private storageTxt: HTMLElement;
  private storageState: HTMLElement;
  private clockT: HTMLElement;
  private clockS: HTMLElement;

  constructor(host: HTMLElement, game: Game) {
    const left = el('div', 'cluster');

    /*
     * On a phone the whole strip is one control: the chips are too small to
     * carry names, and hover copy does not exist, so tapping it opens a sheet
     * that says in words what each of these numbers is.
     */
    this.stripWrap = el('div', 'stripwrap');
    this.strip = el('div', 'pill res-strip');
    this.strip.dataset.act = 'open-stores';
    this.strip.setAttribute('role', 'group');
    this.strip.setAttribute('aria-label', 'Stores');
    for (const res of RESOURCE_ORDER) {
      const meta = RESOURCE_META[res];
      const wrap = el('span', 'res');
      wrap.innerHTML =
        `<span class="icon" aria-hidden="true">${meta.icon}</span>` +
        `<span class="nm">${esc(meta.name)}</span>` +
        `<span class="val">0</span><span class="tip"></span>`;
      wrap.setAttribute('aria-label', meta.name);
      // Filled on hover rather than every frame — six of these, sixty a second.
      const tip = wrap.querySelector('.tip') as HTMLElement;
      wrap.addEventListener('pointerenter', () => {
        tip.innerHTML = resourceTip(game, res);
      });
      this.strip.appendChild(wrap);
      this.resNodes.set(res, { wrap, val: wrap.querySelector('.val') as HTMLElement });
    }
    this.stripWrap.appendChild(this.strip);
    // Sits over the right-hand edge when there is more strip than screen.
    this.stripWrap.appendChild(el('span', 'moreres', '›'));
    left.appendChild(this.stripWrap);

    // A button rather than a div: the stores sheet is the only place the
    // resource copy exists without a hover, so it has to be reachable by
    // keyboard as well as by thumb.
    const storePill = el('button', 'pill store-pill');
    storePill.dataset.act = 'open-stores';
    storePill.setAttribute('aria-label', 'Stores — what the kingdom has and how much room is left');
    storePill.innerHTML =
      `<span class="storage"><span class="lb">Store</span>` +
      `<span class="bar"><i style="width:0%"></i></span>` +
      `<span class="txt">0/0</span><span class="state"></span><span class="tip"></span></span>`;
    this.storageBar = storePill.querySelector('.bar') as HTMLElement;
    this.storageTxt = storePill.querySelector('.txt') as HTMLElement;
    this.storageState = storePill.querySelector('.state') as HTMLElement;
    const storeTip = storePill.querySelector('.tip') as HTMLElement;
    storePill.addEventListener('pointerenter', () => {
      storeTip.innerHTML = storageTip(game);
    });
    left.appendChild(storePill);
    host.appendChild(left);

    const right = el('div', 'cluster');
    const clockPill = el('div', 'pill clock-pill');
    clockPill.innerHTML = `<span class="clock"><span class="t">00:00</span><span class="s">Spring · Year 1</span></span>`;
    this.clockT = clockPill.querySelector('.t') as HTMLElement;
    this.clockS = clockPill.querySelector('.s') as HTMLElement;
    right.appendChild(clockPill);
    host.appendChild(right);
  }

  /** Cheap enough to run every frame. */
  tick(game: Game, env: UIEnv): string {
    const g = game.state;
    for (const res of RESOURCE_ORDER) {
      const node = this.resNodes.get(res)!;
      const hidden = res !== 'wood' && res !== 'stone' && g.stock[res] <= 0 && !everSeen(game, res);
      node.wrap.classList.toggle('locked', hidden);
      const amount = fmt(g.stock[res]);
      if (node.val.textContent !== amount) node.val.textContent = amount;
      node.wrap.setAttribute('aria-label', `${RESOURCE_META[res].name}: ${amount}`);
    }

    const store = game.storageInfo();
    const pct = store.cap > 0 ? Math.min(100, (store.used / store.cap) * 100) : 0;
    (this.storageBar.firstElementChild as HTMLElement).style.width = `${pct}%`;
    this.storageBar.classList.toggle('full', pct > 97);
    this.storageTxt.textContent = `${fmt(store.used)}/${fmt(store.cap)}`;
    /*
     * The bar alone says "quite full" to somebody who can see colour and knows
     * what the bar is. The word says it to everybody, and it is the one number
     * on the strip that changes what the player should do next.
     */
    const state = pct > 97 ? 'Full' : pct > 88 ? 'Nearly full' : '';
    if (this.storageState.textContent !== state) this.storageState.textContent = state;
    this.storageState.className = `state${state ? ' on' : ''}`;

    // A strip you can scroll must look scrollable, or the tail is simply lost.
    const over = this.strip.scrollWidth - this.strip.clientWidth > 4;
    this.stripWrap.classList.toggle('overflowing', over && this.strip.scrollLeft < this.strip.scrollWidth - this.strip.clientWidth - 4);

    const clock = game.clockLabel();
    if (this.clockT.textContent !== clock) this.clockT.textContent = clock;
    const seasonLabel = env.compact ? cap(g.season) : `${cap(g.season)} · Year ${g.year}`;
    if (this.clockS.textContent !== seasonLabel) this.clockS.textContent = seasonLabel;
    return clock;
  }
}

/** Hover copy for a top-bar resource: how much, where from, where to. */
function resourceTip(game: Game, res: ResourceId): string {
  const g = game.state;
  const meta = RESOURCE_META[res];
  const info = RESOURCE_INFO[res];
  const store = game.storageInfo();
  const amount = Math.floor(g.stock[res]);
  const share = res === 'coin' || store.cap <= 0 ? null : Math.round((g.stock[res] / store.cap) * 100);

  return `<span class="tip-head"><span class="tip-ic">${meta.icon}</span>${esc(meta.name)}
      <b>${fmt(amount)}</b></span>
    ${share === null ? '' : `<span class="tip-row"><span>Of the store</span><span>${share}%</span></span>`}
    <span class="tip-line"><b>From</b> ${esc(info.from)}</span>
    <span class="tip-line"><b>For</b> ${esc(info.used)}</span>`;
}

/** Hover copy for the store meter: what is actually taking up the room. */
function storageTip(game: Game): string {
  const g = game.state;
  const store = game.storageInfo();
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
    <span class="tip-line">${roomLine(room)}</span>`;
}

function roomLine(room: number): string {
  return room <= 0
    ? 'Full, so nobody is gathering more. Anything already being carried still gets put away, which is why this can read over the limit. Build a storehouse to raise it.'
    : `Room for ${fmt(room)} more. Storehouses raise the ceiling.`;
}

/**
 * The same information as the hover tips, as a sheet — because a phone has no
 * hover, and "🌫 3" on its own is not a sentence anybody can read.
 */
export function storesBody(game: Game): string {
  const g = game.state;
  const store = game.storageInfo();
  const room = Math.max(0, store.cap - store.used);
  const pct = store.cap > 0 ? Math.min(100, (store.used / store.cap) * 100) : 0;

  const rows = RESOURCE_ORDER.filter((res) => everSeen(game, res) || g.stock[res] > 0 || res === 'wood' || res === 'stone')
    .map((res) => {
      const info = RESOURCE_INFO[res];
      const share = res === 'coin' || store.cap <= 0 ? null : Math.round((g.stock[res] / store.cap) * 100);
      return `<div class="storerow">
        <div class="sr-top"><span class="nm">${RESOURCE_META[res].icon} ${esc(RESOURCE_META[res].name)}</span>
          <span class="amt">${fmt(Math.floor(g.stock[res]))}${share === null ? '' : `<span class="muted tiny"> · ${share}% of the store</span>`}</span></div>
        <div class="tiny muted"><b>From</b> ${esc(info.from)}</div>
        <div class="tiny muted"><b>For</b> ${esc(info.used)}</div>
      </div>`;
    })
    .join('');

  return `<div class="bsec">
      <div class="bh">Room in the store</div>
      <div class="need"><span aria-hidden="true">📦</span>
        <span class="track"><i style="width:${pct}%"></i></span>
        <span class="num">${fmt(store.used)}/${fmt(store.cap)}</span></div>
      <div class="tiny muted" style="margin-top:8px;line-height:1.55">${roomLine(room)}</div>
    </div>
    <div class="bsec"><div class="bh">What there is</div>${rows}</div>`;
}

function everSeen(game: Game, res: ResourceId): boolean {
  // Once a resource has ever been produced its chip stays visible.
  const g = game.state;
  if (res === 'wheat') return g.stats.harvested > 0;
  if (res === 'flour') return g.buildings.some((b) => b.def === 'mill');
  if (res === 'bread') return g.stats.baked > 0;
  if (res === 'coin') return g.stock.coin > 0;
  return true;
}
