/**
 * The top strip: how much of everything there is, and the time.
 *
 * It is the first of the three levels of the interface — the things you glance
 * at constantly — so it stays one line tall on every screen and never moves.
 *
 * There is no store meter here, and the per-chip "180 / 250" that replaced it
 * has gone the same way. A ceiling is not glanceable: it doubles the width of
 * every chip and asks the player to do a division at a glance, to learn
 * something that matters on about two of them. What is actually worth knowing
 * at this level is "am I about to run out of room", and that is a state, not an
 * arithmetic problem — so the chip carries a mark for it and the exact figures
 * live one hover away, where there is room to be precise about them.
 *
 * ## Why the chips are grouped
 *
 * There are thirteen resources. Thirteen chips is not a strip, it is a ledger:
 * on a desktop it ran off the right-hand edge and shoved the clock onto a
 * second row, and on a phone five of them fitted and the other eight were a
 * silent scroll nobody found. The honest fix is not smaller type. It is
 * admitting that thirteen numbers are not thirteen questions.
 *
 * They are four. Wood and stone are what everything costs, so they keep their
 * own chips and their own numbers for the whole game. Food is one question —
 * is there enough to eat — and its five resources are five answers to it, four
 * of which are somebody's work in progress. Metal is one question too, and one
 * nobody asks in a hurry. So those two collapse into a chip apiece carrying the
 * figure that actually answers the question, and open on hover or a tap into
 * the resources behind it.
 *
 * The strip never overflows now, at any width, at any point in the game.
 */

import type { GameState, ResourceId } from '../types';
import { PREPARED_FOODS } from '../types';
import { GAME_MINUTE, RESOURCE_INFO, RESOURCE_META, VIBE_MAX, buildingName } from '../sim/defs';
import { bedSources, bedsFree, housingCapacity, preparedFood, totalOf } from '../sim/state';
import { arrivalEta } from '../sim/population';
import { vibesOf } from '../sim/vibes';
import { foundingDone } from '../sim/founding';
import { fmt } from '../core/util';
import type { Game } from '../game';
import { cap, el, esc, type UIEnv } from './context';
import { icon } from './icons';

/**
 * What the strip shows, left to right.
 *
 * A `single` is one resource with its own number. A `group` is a question with
 * several resources behind it: the chip carries the figure that answers the
 * question — meals you could eat right now, metal the kingdom is sitting on —
 * and everything in `members` is one hover or one tap away.
 *
 * `members` is also the order they are listed in when the group opens, so it
 * runs along the chain rather than alphabetically: what is grown, what it
 * becomes, what you eat.
 */
export interface StripEntry {
  id: string;
  kind: 'single' | 'group';
  /** What the chip is called when it has room to say so. */
  label: string;
  /** The icon name from `ui/icons`. */
  art: string;
  members: ResourceId[];
  /** A group's headline: which of its members the number on the chip counts. */
  headline?: ResourceId[];
  /** The line under a group's name when it opens. */
  note?: string;
}

export const STRIP: StripEntry[] = [
  { id: 'wood', kind: 'single', label: 'Wood', art: 'wood', members: ['wood'] },
  { id: 'stone', kind: 'single', label: 'Stone', art: 'stone', members: ['stone'] },
  {
    id: 'food',
    kind: 'group',
    label: 'Food',
    art: 'meals',
    members: ['wheat', 'flour', 'bread', 'fish', 'cookedFish'],
    // Prepared food, and only prepared food: wheat in a barn is not supper, and
    // a chip that counted it would say the kingdom was fed when it was not.
    headline: PREPARED_FOODS,
    note: 'Meals ready to eat. The rest is on its way to becoming one.',
  },
  {
    id: 'goods',
    kind: 'group',
    label: 'Goods',
    art: 'goods',
    members: ['ironOre', 'coal', 'ironBar', 'steelBar', 'mithrilOre', 'mithrilBar'],
    note: 'What comes out of the mine, and what the forge makes of it.',
  },
];

/**
 * How full a compartment has to be before the chip says so quietly. Nine tenths
 * is far enough along that the answer — improve the building that keeps this —
 * is worth starting, and not so early that a chip sits marked for half the game.
 */
const NEARLY_FULL = 0.9;

/** Whether a compartment is at its ceiling, or close enough to be worth saying. */
function roomState(store: ReturnType<Game['storageInfo']>): 'full' | 'near' | '' {
  if (store.cap <= 0) return '';
  if (store.room <= 0) return 'full';
  return store.stored >= store.cap * NEARLY_FULL ? 'near' : '';
}

/** What a screen reader gets out of a chip, since the mark on it is a colour. */
function chipLabel(res: ResourceId, store: ReturnType<Game['storageInfo']>): string {
  const name = RESOURCE_META[res].name;
  const held = fmt(Math.floor(store.stored));
  if (store.cap <= 0) return `${name}: ${held} stored, with nowhere to keep any`;
  const state = roomState(store);
  return `${name}: ${held} stored of ${fmt(store.cap)}${state ? `, ${state === 'full' ? 'full' : 'nearly full'}` : ''}`;
}

/**
 * The same for a group, which has to say two things: the figure on the chip and
 * whether anything behind it has run out of room. A group is not "full" in any
 * meaningful sense — one of its compartments is — so it names them.
 */
function groupLabel(game: Game, entry: StripEntry, shown: ResourceId[], amount: number): string {
  const full = shown.filter((r) => roomState(game.storageInfo(r)) === 'full').map((r) => RESOURCE_META[r].name);
  const head =
    entry.id === 'food'
      ? `Food: ${fmt(amount)} meal${amount === 1 ? '' : 's'} ready`
      : `${entry.label}: ${fmt(amount)} in storage`;
  const kinds = `${shown.length} kind${shown.length === 1 ? '' : 's'}`;
  return full.length ? `${head}, ${kinds}. Full: ${full.join(', ')}.` : `${head}, across ${kinds}.`;
}

/**
 * How often the strip is actually worked out, in milliseconds.
 *
 * Every figure up here is a walk of every building in the kingdom, and there
 * are thirteen of them; at the frame rate that was several hundred sweeps a
 * second to move numbers that change perhaps twice a minute. Worse, each sweep
 * wrote to the DOM and then measured it, which makes the browser stop and lay
 * the page out again before the next frame can start.
 *
 * Six times a second is faster than anybody can read and slow enough that none
 * of that happens. The clock is on the same clock, which is ample: a game-minute
 * is a second and a quarter of real time.
 */
const STRIP_INTERVAL = 160;

export class Hud {
  private entryNodes = new Map<string, { wrap: HTMLElement; val: HTMLElement }>();
  private strip: HTMLElement;
  private stripWrap: HTMLElement;
  private popTxt: HTMLElement;
  private vibeTxt: HTMLElement;
  private clockT: HTMLElement;
  private clockS: HTMLElement;
  private lastSweep = 0;
  private clock = '';

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
      `<span class="pop">${icon('people')}<span class="val">1/1</span></span>` +
      `<span class="vibe">${icon('vibes')}<span class="lb">Vibes</span>` +
      `<span class="val">0</span></span><span class="tip"></span>`;
    this.popTxt = popPill.querySelector('.pop .val') as HTMLElement;
    this.vibeTxt = popPill.querySelector('.vibe .val') as HTMLElement;
    const popTip = popPill.querySelector('.tip') as HTMLElement;
    popPill.addEventListener('pointerenter', () => {
      popTip.innerHTML = populationTip(game);
    });
    left.appendChild(popPill);

    /*
     * Four chips, and every one of them is a way in: tapping opens the storage
     * sheet, which is where the exact figures and the building-by-building
     * breakdown live. On a desktop the hover gets there first.
     */
    this.stripWrap = el('div', 'stripwrap');
    this.strip = el('div', 'pill res-strip');
    this.strip.setAttribute('role', 'group');
    this.strip.setAttribute('aria-label', 'Storage');
    for (const entry of STRIP) {
      const wrap = el('button', `res ${entry.kind === 'group' ? 'grp' : ''}`);
      wrap.dataset.act = 'open-stores';
      wrap.dataset.entry = entry.id;
      wrap.innerHTML =
        icon(entry.art) +
        `<span class="nm">${esc(entry.label)}</span>` +
        `<span class="val">0</span>` +
        (entry.kind === 'group' ? icon('caret', 'cv') : '') +
        `<span class="tip"></span>`;
      // Filled on hover rather than every frame: working one of these out walks
      // every building in the kingdom, and nobody reads a tooltip they are not
      // pointing at.
      const tip = wrap.querySelector('.tip') as HTMLElement;
      wrap.addEventListener('pointerenter', () => {
        tip.innerHTML = entry.kind === 'group' ? groupTip(game, entry) : resourceTip(game, entry.members[0]);
      });
      this.strip.appendChild(wrap);
      this.entryNodes.set(entry.id, { wrap, val: wrap.querySelector('.val') as HTMLElement });
    }
    this.stripWrap.appendChild(this.strip);
    left.appendChild(this.stripWrap);
    host.appendChild(left);

    const right = el('div', 'cluster');
    const clockPill = el('div', 'pill clock-pill');
    clockPill.innerHTML = `<span class="clock"><span class="t">00:00</span><span class="s">Spring · Year 1</span></span>`;
    this.clockT = clockPill.querySelector('.t') as HTMLElement;
    this.clockS = clockPill.querySelector('.s') as HTMLElement;
    right.appendChild(clockPill);
    host.appendChild(right);
  }

  /** Called every frame; does its actual work six times a second. */
  tick(game: Game, env: UIEnv): string {
    const g = game.state;
    const now = performance.now();
    if (now - this.lastSweep < STRIP_INTERVAL) return this.clock;
    this.lastSweep = now;

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

    /*
     * One figure per chip: what is in storage. Not what the kingdom *owns* —
     * that counts bench supplies and armfuls, neither of which answers to any
     * ceiling, so showing it here would put a number above a capacity it was
     * never measured against. Stored against capacity compares like with like,
     * which is the whole reason the hover can now be exact about the rest.
     *
     * Two marks, and they are the only thing the strip says about room. Nearly
     * full is a nudge — there is time, and improving the building that keeps
     * this is the answer. Full is a fact about the kingdom: production of this
     * has stopped. They are worth telling apart because one of them is not yet
     * urgent, and folding them together would make every warning read as an
     * emergency until the player stopped reading them.
     */
    for (const entry of STRIP) {
      const node = this.entryNodes.get(entry.id)!;
      // Only the resources this kingdom has any business knowing about. A chip
      // for something it has never had and no way of getting is noise, and a
      // group with nothing behind it yet is a whole chip of it.
      const shown = entry.members.filter((r) => visible(game, r));
      node.wrap.classList.toggle('locked', shown.length === 0);
      if (shown.length === 0) continue;

      if (entry.kind === 'single') {
        const store = game.storageInfo(entry.members[0]);
        const amount = fmt(Math.floor(store.stored));
        if (node.val.textContent !== amount) node.val.textContent = amount;
        const state = roomState(store);
        node.wrap.classList.toggle('full', state === 'full');
        node.wrap.classList.toggle('near', state === 'near');
        node.wrap.setAttribute('aria-label', chipLabel(entry.members[0], store));
        continue;
      }

      /*
       * A group's number counts its headline members if it has any and all of
       * them otherwise — meals ready to eat for food, everything for goods.
       * Its mark is the worst state of anything behind it: one full compartment
       * back there means something has stopped, and a chip that only reported
       * on its headline would go on reading fine while the mine stood idle.
       */
      const counted = (entry.headline ?? entry.members).filter((r) => visible(game, r));
      const total = counted.reduce((n, r) => n + game.storageInfo(r).stored, 0);
      const amount = fmt(Math.floor(total));
      if (node.val.textContent !== amount) node.val.textContent = amount;
      const states = shown.map((r) => roomState(game.storageInfo(r)));
      node.wrap.classList.toggle('full', states.includes('full'));
      node.wrap.classList.toggle('near', !states.includes('full') && states.includes('near'));
      node.wrap.setAttribute('aria-label', groupLabel(game, entry, shown, Math.floor(total)));
    }

    const clock = game.clockLabel();
    if (this.clockT.textContent !== clock) this.clockT.textContent = clock;
    const seasonLabel = env.compact ? cap(g.season) : `${cap(g.season)} · Year ${g.year}`;
    if (this.clockS.textContent !== seasonLabel) this.clockS.textContent = seasonLabel;
    this.clock = clock;
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
  if (v.preFood) {
    bits.push('Food and how people are keeping are both held at a neutral figure until something comes out of a kitchen of your own — bread or fish, it makes no difference which.');
  } else {
    if (v.food < VIBE_MAX.food) {
      const per = (preparedFood(g) / Math.max(1, g.villagers.length)).toFixed(1);
      bits.push(`${per} meals a head at the kitchen, counting bread and cooked fish alike. Four each is as reassuring as it gets.`);
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

/**
 * Where a resource is kept, building by building, with the room each one has.
 * The strip no longer carries a capacity at all, so this is where the exact
 * figures live — and building by building is the useful shape for them, because
 * "the kingdom has room for 1,250 wood" is not something anybody can act on and
 * "the lodge is full, the storehouse is not" is.
 */
function whereRows(game: Game, res: ResourceId): string {
  const store = game.storageInfo(res);
  if (store.where.length === 0) return '';
  return store.where
    .map(({ b, stored, bench, cap }) => {
      const gain = game.capacityGain(b, res);
      const name = esc(buildingName(b.def, b.level));
      const rows: string[] = [];
      if (cap > 0 || stored > 0) {
        // A compartment holding goods it no longer has room for is the camp's
        // retired woodpile mid-move, and saying so beats an unexplained 0.
        const note = cap <= 0 ? ' · closed, being moved' : stored >= cap ? ' · full' : gain ? ` · +${fmt(gain)} if improved` : '';
        rows.push(`<span class="tip-row"><span>${name}${note}</span>
          <span>${fmt(Math.floor(stored))}${cap > 0 ? `/${fmt(cap)}` : ''}</span></span>`);
      }
      // The bench is listed separately even when the same building stores the
      // resource properly, because the two are not the same thing and adding
      // them together is what made the old figure drift over its ceiling.
      if (bench > 0) {
        rows.push(`<span class="tip-row sub"><span>${name} · on the bench</span>
          <span>${fmt(Math.floor(bench))}</span></span>`);
      }
      return rows.join('');
    })
    .join('');
}

/**
 * What the kingdom owns, split by whether it is standing still or moving.
 *
 * Only the parts that are actually non-zero, and only when there is something
 * to split — a resource sitting entirely in its compartments is fully described
 * by the headline already, and four rows saying so would be noise on twelve
 * chips out of thirteen. When it does appear it always ends on the total, so
 * the arithmetic is visible rather than implied.
 */
function ownedRows(store: ReturnType<Game['storageInfo']>): string {
  if (store.bench < 1 && store.carried < 1) return '';
  /*
   * Exact figures here, and `fmt`'s abbreviation nowhere near them. This is the
   * one block in the interface whose parts are meant to be seen adding up, and
   * "2.5k stored, 36 on benches, 14 carried, 2.5k in total" is arithmetic that
   * visibly does not work — which is worse than the imprecision it was hiding,
   * because the reader concludes the game cannot count rather than that the
   * display rounded. Four digits with a thousands separator is no wider than
   * the rows above it anyway.
   */
  const exact = (n: number) => Math.floor(n).toLocaleString('en-GB');
  const row = (label: string, n: number) =>
    n < 1 ? '' : `<span class="tip-row"><span>${label}</span><span>${exact(n)}</span></span>`;
  return (
    `<span class="tip-sub">In circulation</span>` +
    row('Stored', store.stored) +
    row('On workshop benches', store.bench) +
    row('Being carried', store.carried) +
    `<span class="tip-row total"><span>Owned in total</span><span>${exact(store.owned)}</span></span>`
  );
}

/**
 * What the people who make this are doing about it, in one line. Three states
 * worth telling apart, because they want three different things from the
 * player: nowhere to put it (improve the building), enough already (nothing —
 * this is the food chain easing off, and it is not a problem), or working.
 */
function flowLine(game: Game, res: ResourceId): string {
  const store = game.storageInfo(res);
  if (store.cap <= 0) return 'Nothing in the kingdom keeps this yet.';
  if (store.room <= 0) {
    const full = store.where.filter((w) => w.cap > 0 && w.stored >= w.cap);
    const names = full.map((w) => buildingName(w.b.def, w.b.level));
    // Only offer the fix when there is one. Every keeper of this at its top
    // level is a perfectly ordinary end state, and telling somebody to improve
    // a building that cannot be improved is worse than saying nothing.
    const gain = full.reduce((n, w) => n + (game.capacityGain(w.b, res) ?? 0), 0);
    return (
      `Full${names.length ? ` at the ${names.join(' and the ').toLowerCase()}` : ''}, so nobody is making more for now. ` +
      'Anything already being carried still gets put away, which is why this can read a little over. ' +
      (gain > 0 ? `Improving would make room for ${fmt(gain)} more.` : 'Nothing here can hold any more of it than this.')
    );
  }
  return `Room for ${fmt(store.room)} more.`;
}

/**
 * Whether this resource has any business being on the strip at all yet.
 *
 * Wood and stone always, because a kingdom with none of either is a kingdom in
 * trouble and hiding the chip would hide the trouble. Everything else once it
 * exists or once the kingdom can make it — and once shown, it stays.
 */
function visible(game: Game, res: ResourceId): boolean {
  if (res === 'wood' || res === 'stone') return true;
  return game.storageInfo(res).owned > 0 || everSeen(game, res);
}

/**
 * What is behind a group chip, as a hover.
 *
 * One row per resource with its own figure and its own state, because the
 * chip's job was to answer a question in one number and this is where the
 * number gets taken apart again. The point of the grouping is that opening it
 * is cheap, not that the parts stop existing.
 */
function groupTip(game: Game, entry: StripEntry): string {
  const shown = entry.members.filter((r) => visible(game, r));
  const counted = (entry.headline ?? entry.members).filter((r) => visible(game, r));
  const total = counted.reduce((n, r) => n + game.storageInfo(r).stored, 0);

  const rows = shown
    .map((res) => {
      const meta = RESOURCE_META[res];
      const store = game.storageInfo(res);
      const state = roomState(store);
      const pct = store.cap > 0 ? Math.min(100, (store.stored / store.cap) * 100) : 0;
      return `<span class="tip-row res-row ${state}">
        <span class="rn">${icon(res)}${esc(meta.name)}</span>
        <span class="rb"><i style="width:${pct}%"></i></span>
        <span class="rv">${fmt(Math.floor(store.stored))}${store.cap > 0 ? `<span class="muted">/${fmt(store.cap)}</span>` : ''}</span>
      </span>`;
    })
    .join('');

  const headline =
    entry.id === 'food'
      ? `${fmt(Math.floor(total))} ready`
      : `${fmt(Math.floor(total))}`;
  const stopped = shown.filter((r) => roomState(game.storageInfo(r)) === 'full').map((r) => RESOURCE_META[r].name);

  return `<span class="tip-head"><span class="tip-ic">${icon(entry.art)}</span>${esc(entry.label)}<b>${headline}</b></span>
    ${rows}
    ${entry.note ? `<span class="tip-line">${esc(entry.note)}</span>` : ''}
    ${
      stopped.length
        ? `<span class="tip-line warnline">Full, so nobody is making more for now: ${esc(stopped.join(', ').toLowerCase())}.</span>`
        : ''
    }
    <span class="tip-line muted">Open storage for where every bit of it is kept.</span>`;
}

/** Hover copy for a top-bar resource: how much, where it is, where from, where to. */
function resourceTip(game: Game, res: ResourceId): string {
  const meta = RESOURCE_META[res];
  const info = RESOURCE_INFO[res];
  const store = game.storageInfo(res);

  return `<span class="tip-head"><span class="tip-ic">${icon(res)}</span>${esc(meta.name)}
      <b>${fmt(Math.floor(store.stored))}${store.cap > 0 ? `/${fmt(store.cap)}` : ''}</b></span>
    ${whereRows(game, res)}
    ${ownedRows(store)}
    <span class="tip-line">${esc(flowLine(game, res))}</span>
    <span class="tip-line"><b>From</b> ${esc(info.from)}</span>
    <span class="tip-line"><b>For</b> ${esc(info.used)}</span>`;
}

/**
 * The same information as the hover tips, as a sheet — because a phone has no
 * hover, and an icon with a 3 beside it is not a sentence anybody can read.
 *
 * It opens straight into the resources. The paragraph that used to sit above
 * them explaining that goods live where they are made has gone: the intro says
 * it once, and after that the rows below are the demonstration — every one of
 * them names the buildings and the walk. A sheet that explains its own contents
 * before showing them is a sheet nobody scrolls twice.
 */
export function storesBody(game: Game): string {
  const row = (res: ResourceId) => {
    const info = RESOURCE_INFO[res];
    const store = game.storageInfo(res);
    const pct = store.cap > 0 ? Math.min(100, (store.stored / store.cap) * 100) : 0;
    const state = roomState(store);
    return `<div class="storerow${state ? ` ${state}` : ''}">
      <div class="sr-top"><span class="nm">${icon(res)}${esc(RESOURCE_META[res].name)}</span>
        <span class="amt">${fmt(Math.floor(store.stored))}${store.cap > 0 ? `<span class="muted"> / ${fmt(store.cap)}</span>` : ''}</span></div>
      ${store.cap > 0 ? `<div class="need"><span class="track"><i style="width:${pct}%"></i></span></div>` : ''}
      ${whereRows(game, res)}
      ${ownedRows(store)}
      <div class="tiny muted">${esc(flowLine(game, res))}</div>
      <div class="tiny muted"><b>From</b> ${esc(info.from)}</div>
      <div class="tiny muted"><b>For</b> ${esc(info.used)}</div>
    </div>`;
  };

  /*
   * Sectioned the same way the strip is, and in the same order, so that opening
   * a group chip lands somewhere that looks like the chip it came from. A
   * section with nothing in it yet is left out entirely rather than shown empty.
   */
  return STRIP.map((entry) => {
    const shown = entry.members.filter((res) => visible(game, res));
    if (shown.length === 0) return '';
    return `<div class="bsec" data-entry="${entry.id}">
      <div class="bh">${icon(entry.art)}${esc(entry.label)}</div>
      ${entry.note ? `<div class="tiny muted" style="margin-bottom:10px">${esc(entry.note)}</div>` : ''}
      ${shown.map(row).join('')}
    </div>`;
  }).join('');
}

/**
 * Whether this resource has any business being on the strip yet.
 *
 * A chip for something the kingdom has never had and has no way of getting is
 * noise, and there are eleven of them now. The rule is the same one everywhere:
 * a resource appears once the kingdom can actually produce it, and once it has
 * appeared it stays. Mithril appears for nobody, because nothing produces it.
 */
function everSeen(game: Game, res: ResourceId): boolean {
  const g = game.state;
  const mineAt = (level: number) =>
    g.buildings.some((b) => b.def === 'quarry' && (b.stage === 'done' || b.upgrading) && b.level >= level);
  switch (res) {
    case 'wheat':
      return g.stats.harvested > 0;
    case 'flour':
      return g.buildings.some((b) => b.def === 'mill');
    case 'bread':
      return g.stats.baked > 0;
    // A chip for fish the moment there is somewhere to catch them, and one for
    // supper the moment there is somewhere to cook it. Both stay once shown.
    case 'fish':
      return g.buildings.some((b) => b.def === 'fishhut') || g.stats.caught > 0;
    case 'cookedFish':
      return totalOf(g, 'cookedFish') > 0 || g.unlocked.has('seen:cookedFish');
    case 'ironOre':
      return mineAt(2);
    case 'coal':
      return mineAt(3);
    case 'ironBar':
    case 'steelBar':
      return g.buildings.some((b) => b.def === 'forge');
    case 'mithrilOre':
    case 'mithrilBar':
      return false;
    default:
      return true;
  }
}
