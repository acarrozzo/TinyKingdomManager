/**
 * The top strip: what the kingdom owns, how much room is left, and the time.
 *
 * It is the first of the three levels of the interface — the things you glance
 * at constantly — so it stays one line tall on every screen and never moves.
 */

import type { GameState, ResourceId } from '../types';
import { RESOURCE_ORDER, STORED_RESOURCES } from '../types';
import { GAME_MINUTE, RESOURCE_INFO, RESOURCE_META, VIBE_MAX } from '../sim/defs';
import { bedSources, bedsFree, housingCapacity } from '../sim/state';
import { arrivalEta } from '../sim/population';
import { vibesOf } from '../sim/vibes';
import { foundingDone } from '../sim/founding';
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
  private popTxt: HTMLElement;
  private vibeTxt: HTMLElement;
  private clockT: HTMLElement;
  private clockS: HTMLElement;

  constructor(host: HTMLElement, game: Game) {
    const left = el('div', 'cluster');

    /*
     * How many people are here and how many beds there are — the one pair of
     * numbers that answers "why is nobody arriving", so it stays up through the
     * founding as well, when the founder is the whole population and the answer
     * is that the camp is not built yet.
     */
    const popPill = el('button', 'pill pop-pill');
    popPill.dataset.act = 'open-population';
    popPill.setAttribute('aria-label', 'People and Vibes — who lives here and how quickly anyone new arrives');
    popPill.innerHTML =
      `<span class="pop"><span class="icon" aria-hidden="true">👥</span><span class="val">1/1</span></span>` +
      `<span class="vibe"><span class="icon" aria-hidden="true">✦</span><span class="lb">Vibes</span>` +
      `<span class="val">0</span></span><span class="tip"></span>`;
    this.popTxt = popPill.querySelector('.pop .val') as HTMLElement;
    this.vibeTxt = popPill.querySelector('.vibe .val') as HTMLElement;
    const popTip = popPill.querySelector('.tip') as HTMLElement;
    popPill.addEventListener('pointerenter', () => {
      popTip.innerHTML = populationTip(game);
    });
    left.appendChild(popPill);

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

    const pop = popLabel(g);
    if (this.popTxt.textContent !== pop) this.popTxt.textContent = pop;
    this.popTxt.parentElement!.classList.toggle('full', bedsFree(g) < 1 && foundingDone(g));
    const vibes = vibesOf(g);
    const score = String(vibes.total);
    if (this.vibeTxt.textContent !== score) this.vibeTxt.textContent = score;
    (this.popTxt.closest('.pop-pill') as HTMLElement).setAttribute(
      'aria-label',
      `${g.villagers.length} people, ${housingCapacity(g)} beds. Vibes ${vibes.total} of 100, ${vibes.band}.`,
    );

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

// ---------------------------------------------------------------------------
// People and Vibes
// ---------------------------------------------------------------------------

/**
 * "5/6" — who lives here, out of how many beds there are.
 *
 * During the founding there are no beds at all, because there is no camp; the
 * founder reads as 1/1 rather than 1/0, which would look like a kingdom that
 * had already gone wrong. The moment the Base Camp stands it becomes 1/2, and
 * that second bed is what sets the first companion walking.
 */
function popLabel(g: GameState): string {
  const pop = g.villagers.length;
  const beds = housingCapacity(g);
  return `${pop}/${foundingDone(g) ? beds : Math.max(pop, beds)}`;
}

/** Where the beds are, as rows. */
function bedRows(g: GameState): string {
  return bedSources(g)
    .map(
      (r) =>
        `<span class="tip-row"><span>${esc(r.label)}</span><span>${r.beds} bed${r.beds === 1 ? '' : 's'}</span></span>`,
    )
    .join('');
}

/** What the three parts of the Vibes are worth just now. */
function vibeRows(g: GameState): string {
  const v = vibesOf(g);
  const row = (label: string, val: number, max: number) =>
    `<span class="tip-row"><span>${esc(label)}</span><span>${Math.round(val)}/${max}</span></span>`;
  return (
    row('Decorations', v.decor, VIBE_MAX.decor) +
    row('Food security', v.food, VIBE_MAX.food) +
    row('Resident wellbeing', v.wellbeing, VIBE_MAX.wellbeing)
  );
}

/**
 * How long until somebody turns up, as a spread and never a countdown — and
 * when nobody is on the way, what to do about it. The exact moment stays the
 * kingdom's own business.
 */
function arrivalLine(g: GameState): string {
  if (!foundingDone(g)) return 'Nobody else arrives until the camp is standing.';
  const free = bedsFree(g);
  if (free < 0) return 'More people than beds just now. Nobody is leaving, but nobody new comes until there is room.';
  if (free < 1) return 'No room for newcomers. Build or improve housing to add beds.';
  const eta = arrivalEta(g);
  if (!eta) return 'No room for newcomers. Build or improve housing to add beds.';
  const lo = Math.floor(eta.lo / GAME_MINUTE);
  const hi = Math.ceil(eta.hi / GAME_MINUTE);
  if (hi <= 1) return 'Somebody is nearly here.';
  return `A traveller may arrive in roughly ${Math.max(1, lo)}–${hi} game-minutes.`;
}

/** What is holding the next arrival up, or what is hurrying it along. */
function vibeAdvice(g: GameState): string {
  const v = vibesOf(g);
  const bits: string[] = [];
  if (v.decor < VIBE_MAX.decor) {
    bits.push(
      `${VIBE_MAX.decor - v.decor} of the decorating is still to do — benches, lanterns, flowerbeds, a well, a standing stone.`,
    );
  }
  if (v.preBread) {
    bits.push('Food and how people are keeping are both held at a neutral figure until the first bread comes out of an oven of your own.');
  } else {
    if (v.food < VIBE_MAX.food) {
      const per = (g.stock.bread / Math.max(1, g.villagers.length)).toFixed(1);
      bits.push(`${per} loaves a head in store. Four each is as reassuring as it gets.`);
    }
    if (v.wellbeing < VIBE_MAX.wellbeing) bits.push('Somebody here is going properly hungry, and it shows.');
  }
  if (bits.length === 0) bits.push('Nothing is holding the place back. Word travels quickly from a kingdom like this.');
  return bits.join(' ');
}

/** Hover copy for the population pill. */
function populationTip(game: Game): string {
  const g = game.state;
  const v = vibesOf(g);
  const free = bedsFree(g);
  return `<span class="tip-head">People <b>${popLabel(g)}</b></span>
    ${bedRows(g) || '<span class="tip-line">No beds yet. The Base Camp brings the first two.</span>'}
    ${
      free > 0
        ? `<span class="tip-line">Room for ${free} more.</span>`
        : ''
    }
    <span class="tip-head" style="margin-top:8px">Vibes <b>${v.total}/100</b> · ${esc(v.band)}</span>
    ${vibeRows(g)}
    <span class="tip-line">${esc(arrivalLine(g))}</span>`;
}

/**
 * The same, as a sheet, for the screens with no hover — and with the sentence
 * that explains the whole idea, which there is no room for in a tip.
 */
export function populationBody(game: Game): string {
  const g = game.state;
  const v = vibesOf(g);
  const free = bedsFree(g);
  const pct = Math.min(100, v.total);

  return `<div class="bsec">
      <div class="bh">Population · ${popLabel(g)}</div>
      ${bedRows(g) || '<span class="tip-line">No beds yet. The Base Camp brings the first two.</span>'}
      <div class="tiny muted" style="margin-top:8px;line-height:1.55">${
        free > 0
          ? `Room for ${free} more. Beds are the whole of it — there is no other limit on how many people may live here.`
          : 'Every bed is taken. Beds are the whole of it: build or improve housing and the kingdom can hold more.'
      }</div>
    </div>
    <div class="bsec">
      <div class="bh">Vibes · ${v.total}/100 — ${esc(v.band)}</div>
      <div class="need"><span aria-hidden="true">✦</span>
        <span class="track"><i style="width:${pct}%"></i></span>
        <span class="num">${v.total}/100</span></div>
      ${vibeRows(g)}
      <div class="tiny muted" style="margin-top:8px;line-height:1.55">${esc(vibeAdvice(g))}</div>
      <div class="tiny muted" style="margin-top:8px;line-height:1.55">Vibes are not an exact science. We assigned them a number anyway.
        They decide how quickly an empty bed is filled, and nothing else. Who is in work and who is not has no bearing on them.</div>
    </div>
    <div class="bsec">
      <div class="bh">Anyone on the way</div>
      <div class="tiny muted" style="line-height:1.55">${esc(arrivalLine(g))}
        Somebody always turns up in the end; better Vibes only means sooner.</div>
    </div>`;
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
