/**
 * Putting things up and taking them down.
 *
 * The list itself is deliberately plain — what it is, what it costs, whether
 * you can afford it, one line on what it does — because the interesting part is
 * the map. What is new here is the placement bar: on a touchscreen a tap is not
 * a commitment, so choosing a tile shows a ghost and says whether it will work,
 * and nothing is built until Confirm.
 */

import type { BuildingId, GameState } from '../types';
import { BUILDINGS, BUILD_ORDER, CATEGORY_META, RESOURCE_META, rangeOf, relocateCost } from '../sim/defs';
import { availableToBuild, buildLimit, isUnlocked } from '../sim/goals';
import { foundingDone } from '../sim/founding';
import { buildingById } from '../sim/state';
import { buildingName } from '../sim/defs';
import type { Game } from '../game';
import { esc, type UIEnv } from './context';

/** "🪵 20 wood · 🪨 10 stone", or a dash for the free ones. */
export function costLine(def: BuildingId): string {
  const entries = Object.entries(BUILDINGS[def].cost);
  if (entries.length === 0) return '—';
  return entries
    .map(([res, qty]) => `<span class="cq">${RESOURCE_META[res].icon} ${qty} ${esc(RESOURCE_META[res].name.toLowerCase())}</span>`)
    .join('<span class="cdot"> · </span>');
}

/** The goal that opens a given building up, so a locked row can say what to do. */
function unlockedBy(g: GameState, key: string | undefined): string | null {
  if (!key) return null;
  for (const goal of g.goals) {
    if (!goal.unlocks) continue;
    if ([goal.unlocks].flat().includes(key)) return goal.title;
  }
  return null;
}

export function buildListMarkup(game: Game, env: UIEnv): string {
  const g = game.state;
  const tool = game.tool;

  const groups = new Map<string, string[]>();
  for (const id of BUILD_ORDER) {
    const def = BUILDINGS[id];
    if (!availableToBuild(g, id)) continue;
    const affordable = game.canAffordNew(id);
    const on = tool.kind === 'build' && tool.def === id;
    /*
     * How many stand, out of how many are allowed. Shown on every limited kind
     * whether or not the kingdom is at the ceiling — knowing there is room for
     * one more storehouse is as much a part of planning as being told there is
     * not, and a count that appears only when you are blocked teaches nothing.
     */
    const limit = buildLimit(g, id);
    const counted = Number.isFinite(limit.max);
    const full = limit.built >= limit.max;
    const tally = counted
      ? `<span class="tally ${full ? 'at-limit' : ''}">${limit.built}/${limit.max} built</span>`
      : '';
    // What a comfort is worth. The economy is shown plainly, and Vibes are part
    // of it: a bench that quietly did something would be the wrong game.
    const vibes = def.vibes ? `<span class="tally vibe">✦ ${def.vibes} Vibes</span>` : '';
    const html = full
      ? `<div class="build-item locked" aria-disabled="true">
          <span class="row1"><span class="name">${esc(def.name)}</span>${tally}${vibes}</span>
          <span class="desc">${esc(def.desc)}</span>
          <span class="warnline">${esc(
            def.unique
              ? 'The kingdom keeps one. Open it on the map to move it somewhere better.'
              : def.maxTotal !== undefined
                ? 'That is as many as the kingdom keeps. Remove one to put it elsewhere.'
                : 'Improving the commons allows another.',
          )}</span></div>`
      : `<button class="build-item ${on ? 'on' : ''} ${affordable ? '' : 'short'}"
          data-act="build" data-def="${id}" aria-pressed="${on}">
          <span class="row1"><span class="name">${esc(def.name)}</span>
          <span class="cost">${costLine(id)}</span></span>
          <span class="desc">${esc(def.desc)}</span>
          ${tally}${vibes}
          ${affordable ? '' : `<span class="warnline">Not enough in store yet</span>`}</button>`;
    const list = groups.get(def.category) ?? [];
    list.push(html);
    groups.set(def.category, list);
  }

  let body = '';
  for (const [cat, items] of groups) {
    const meta = CATEGORY_META[cat];
    body += `<div class="build-group"><div class="label">${meta.icon} ${esc(meta.name)}</div>${items.join('')}</div>`;
  }

  if (!foundingDone(g)) {
    // Nothing is on offer yet, and saying why is kinder than an empty panel —
    // the answer is always "there is nowhere to put anything, and nobody to
    // carry it there".
    return `<div class="build-group"><div class="tiny muted" style="line-height:1.55">Nothing to build yet.
      Your founder is felling a tree, and the camp goes up on the ground you chose without being placed.</div></div>`;
  }

  /*
   * Locked buildings are shown two at a time, with the thing that opens them.
   * A full list of everything the kingdom will ever build is a spoiler and a
   * wall; "one more after this" is an invitation.
   */
  const locked = BUILD_ORDER.filter((id) => !isUnlocked(g, BUILDINGS[id].unlock));
  if (locked.length > 0) {
    const shown = locked.slice(0, 2).map((id) => {
      const def = BUILDINGS[id];
      const how = unlockedBy(g, def.unlock);
      return `<div class="build-item locked" aria-disabled="true">
        <span class="row1"><span class="name">🔒 ${esc(def.name)}</span>
        <span class="cost">${costLine(id)}</span></span>
        <span class="desc">${how ? `Unlocks when you ${lowerFirst(how)}.` : 'Unlocks as the kingdom grows.'}</span>
      </div>`;
    });
    body += `<div class="build-group"><div class="label">Not yet</div>${shown.join('')}
      ${
        locked.length > 2
          ? `<div class="tiny muted" style="padding:4px 5px 0">${locked.length - 2} more after those.</div>`
          : ''
      }</div>`;
  }

  // Taking things down belongs with putting them up, and it is the rarer of the
  // two — a building's own panel has a Remove button as well.
  const removing = tool.kind === 'demolish';
  body += `<div class="build-group build-remove">
    <button class="btn small ${removing ? 'on danger' : ''}" data-act="tool-demolish" aria-pressed="${removing}">
      ⛏ ${removing ? `Removing — ${env.touch ? 'tap' : 'click'} a building` : 'Remove a building'}</button>
    <div class="tiny muted" style="margin-top:7px;line-height:1.5">Half the materials come back, and you are asked to confirm first. You can also remove one from its own panel.</div>
  </div>`;
  return body;
}

/**
 * The bar that hangs over the bottom navigation while something is being
 * placed or removed. It is the tool hint, the validity feedback and the two
 * decisions in one box, which is the only way to have all three on a phone
 * without them writing over each other.
 */
export function placementBarMarkup(game: Game, env: UIEnv): string {
  const g = game.state;
  const tool = game.tool;

  if (tool.kind === 'demolish' && game.demolishTarget) {
    const b = buildingById(g, game.demolishTarget);
    if (b) {
      const def = BUILDINGS[b.def];
      return bar({
        icon: '⛏',
        title: `Remove the ${def.name.toLowerCase()}?`,
        state: 'warn',
        body: 'Half of what it cost comes back to the store. Anyone working or sleeping there will find somewhere else.',
        actions: `<button class="btn small danger primary" data-act="confirm-demolish">Remove it</button>
          <button class="btn small" data-act="cancel-place">Cancel</button>`,
      });
    }
  }

  if (tool.kind === 'camp') {
    const spot = game.candidate;
    const problem = spot ? game.campProblem(spot.x, spot.y) : null;
    const chosen = !!spot && !problem;
    return bar({
      icon: '📍',
      title: 'Choose where the kingdom begins',
      state: spot ? (problem ? 'bad' : 'good') : 'plain',
      body: spot
        ? problem ??
          'Open grass, near enough the middle. Your founder will walk over and make camp here; anything standing on those nine tiles gets cleared.'
        : `${env.touch ? 'Tap' : 'Click'} open grass near the middle of the island. The camp takes three tiles by three, with the fire in the middle.`,
      actions: chosen
        ? `<button class="btn small primary" data-act="confirm-place">Make camp here</button>`
        : '',
    });
  }

  if (tool.kind === 'relocate') {
    const b = buildingById(g, tool.id);
    if (b) {
      const spot = game.candidate;
      const problem = spot ? game.relocateProblem(b, spot.x, spot.y) : null;
      const ready = !!spot && !problem;
      const name = buildingName(b.def, b.level);
      return bar({
        icon: '🧭',
        title: `Move the ${name.toLowerCase()} · ${plainCost(b.def)}`,
        state: spot ? (problem ? 'bad' : 'good') : 'plain',
        body: spot
          ? problem ?? `${rangeNote(game, b.def, b.level, spot)}The old one keeps working until this is finished.`
          : `${env.touch ? 'Tap' : 'Click'} where it should stand instead. It keeps its level, its name and everyone working there.`,
        actions: `${ready ? `<button class="btn small primary" data-act="confirm-place">Move it here</button>` : ''}
          <button class="btn small" data-act="cancel-tool">Cancel</button>`,
      });
    }
  }

  if (tool.kind === 'build') {
    const def = BUILDINGS[tool.def];
    const spot = game.candidate;
    const problem = spot ? game.placeProblem(tool.def, spot.x, spot.y) : null;
    const ready = !!spot && !problem;
    return bar({
      icon: '🔨',
      title: `${def.name} · ${costLine(tool.def)}`,
      state: spot ? (problem ? 'bad' : 'good') : 'plain',
      body: spot
        ? problem ??
          `${rangeNote(game, tool.def, 1, spot)}Villagers will carry the materials over and build it.`
        : `${env.touch ? 'Tap' : 'Click'} a spot on the map to see how it would sit.`,
      actions: `${ready ? `<button class="btn small primary" data-act="confirm-place">Build it here</button>` : ''}
        ${env.compact ? `<button class="btn small" data-act="toggle-build">Change</button>` : ''}
        <button class="btn small" data-act="cancel-tool">Cancel</button>`,
      title2: env.compact ? '' : `<kbd>Esc</kbd>`,
    });
  }
  return '';
}

/**
 * What this ground would actually give a lodge or a quarry, in words. The ring
 * on the map shows the shape of the reach and marks what is in it; this counts
 * it, because "seven trees" and "forty trees" look much the same from far
 * enough out and the difference is the whole decision.
 */
function rangeNote(game: Game, def: BuildingId, level: number, spot: { x: number; y: number }): string {
  const d = BUILDINGS[def];
  const n = game.nodesInRange(def, level, spot.x, spot.y);
  const reach = rangeOf(def, level);
  // A mine is not counting nodes: it is measuring the seam it would be cutting
  // into, and it never runs out — thin rock means slow, not idle. Saying "it
  // would stand idle" about a mine would be a lie about the one building whose
  // whole point is that it does not stop.
  if (d.extracts) {
    if (n === 0) return `No rock within ${reach} tiles at all. `;
    if (n < 20) return `A thin seam — ${n} tiles of rock within ${reach}. Slow going, but it never runs out. `;
    if (n < 50) return `${n} tiles of rock within ${reach}. A fair seam. `;
    return `${n} tiles of rock within ${reach}. As good as it gets. `;
  }
  if (!d.harvests) return '';
  const what = d.harvests === 'tree' ? 'trees' : 'boulders';
  if (n === 0) return `Nothing to work: no ${what} at all within ${reach} tiles. It would stand idle. `;
  if (n < 8) return `Thin ground — only ${n} ${what} within ${reach} tiles. `;
  return `${n} ${what} within ${reach} tiles. `;
}

/**
 * The desktop hint. Placement there is direct — click and it is built — so this
 * says what the tool does and, after a refused click, why that spot would not
 * work. A thud on its own tells you something went wrong but not what.
 */
export function toolHintMarkup(game: Game, env: UIEnv): string {
  const t = game.tool;
  if (t.kind === 'none') return '';

  if (t.kind === 'demolish') {
    return bar({
      icon: '⛏',
      title: 'Removing',
      state: game.blockReason ? 'bad' : 'plain',
      body: game.blockReason ?? 'Click a building to take it down. You will be asked to confirm.',
      actions: `<button class="btn small" data-act="cancel-tool">Done <kbd>Esc</kbd></button>`,
    });
  }

  if (t.kind === 'camp') {
    // No Done button: there is nothing else to be doing yet, so offering to put
    // the marker away would only be a way of getting stuck.
    return bar({
      icon: '📍',
      title: 'Choose where the kingdom begins',
      state: game.blockReason ? 'bad' : 'plain',
      body:
        game.blockReason ??
        'Click open grass near the middle of the island. The camp takes three tiles by three with the fire in the middle, and your founder will walk over and make it there.',
      actions: '',
    });
  }

  if (t.kind === 'relocate') {
    const b = buildingById(game.state, t.id);
    if (!b) return '';
    const name = buildingName(b.def, b.level);
    return bar({
      icon: '🧭',
      title: `Moving the ${name.toLowerCase()}`,
      state: game.blockReason ? 'bad' : 'plain',
      body:
        game.blockReason ??
        `${liveRange(game, b.def, b.level)}Click where it should stand instead. Costs ${plainCost(b.def)} and the usual building work; it keeps its level, its name and everyone working there, and goes on working where it is until the new one is ready.`,
      actions: `<button class="btn small" data-act="cancel-tool">Cancel ${env.touch ? '' : '<kbd>Esc</kbd>'}</button>`,
    });
  }

  const def = BUILDINGS[t.def];
  const short = !game.canAffordNew(t.def);
  return bar({
    icon: '🔨',
    title: `Placing a ${def.name}`,
    state: game.blockReason || short ? 'bad' : 'plain',
    body:
      game.blockReason ??
      (short
        ? `Not enough in store right now — it needs ${plainCost(t.def)}.`
        : `${liveRange(game, t.def, 1)}Click a clear spot on the map. Costs ${plainCost(t.def)}; villagers will carry the materials over and build it.`),
    actions: `<button class="btn small" data-act="cancel-tool">Done ${env.touch ? '' : '<kbd>Esc</kbd>'}</button>`,
  });
}

/**
 * The count under the cursor, updated as the mouse moves.
 *
 * On a desktop nothing is confirmed, so there is no candidate tile to describe
 * — and the ring is frequently no help on its own, because thirteen tiles is
 * wider than the window at the usual zoom and its edge is somewhere off the
 * side of the screen. The number is the part that always fits.
 */
function liveRange(game: Game, def: BuildingId, level: number): string {
  const d = BUILDINGS[def];
  if (!d.harvests && !d.extracts) return '';
  const spot = game.hover;
  if (!spot) {
    return d.extracts
      ? 'The shaded ground is the seam it would cut into; the marked tiles are rock. '
      : 'The shaded ground is how far its workers will go. ';
  }
  return rangeNote(game, def, level, spot);
}

function plainCost(def: BuildingId): string {
  const entries = Object.entries(BUILDINGS[def].cost);
  if (entries.length === 0) return 'nothing';
  return entries.map(([res, qty]) => `${qty} ${RESOURCE_META[res].name.toLowerCase()}`).join(' and ');
}

/** "🪵 30 wood", for the footer button and the move bar. Moving costs a full set. */
export function relocateCostLine(def: BuildingId): string {
  const entries = Object.entries(relocateCost(def));
  if (entries.length === 0) return '—';
  return entries
    .map(([res, qty]) => `${RESOURCE_META[res].icon} ${qty} ${esc(RESOURCE_META[res].name.toLowerCase())}`)
    .join(' · ');
}

interface BarParts {
  icon: string;
  title: string;
  title2?: string;
  state: 'plain' | 'good' | 'bad' | 'warn';
  body: string;
  actions: string;
}

/*
 * One shape for every "you are in the middle of something" message. The state
 * word rides along with a mark and a colour rather than a colour alone, since
 * a red border is not a reason.
 */
function bar(p: BarParts): string {
  const mark = p.state === 'good' ? '✓' : p.state === 'bad' ? '✕' : p.state === 'warn' ? '!' : '';
  return `<div class="toolbar-hint ${p.state}" role="group" aria-label="${esc(p.title)}">
    <span class="ic" aria-hidden="true">${p.icon}</span>
    <span class="txt">
      <b>${p.title}${p.title2 ? ` <span class="muted">${p.title2}</span>` : ''}</b>
      <span class="say">${mark ? `<span class="mk" aria-hidden="true">${mark}</span>` : ''}${esc(p.body)}</span>
    </span>
    ${p.actions ? `<span class="acts">${p.actions}</span>` : ''}
  </div>`;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
