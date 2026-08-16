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
import { BUILDINGS, BUILD_ORDER, CATEGORY_META, RESOURCE_META } from '../sim/defs';
import { availableToBuild, isUnlocked } from '../sim/goals';
import { foundingDone } from '../sim/founding';
import { buildingById } from '../sim/state';
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
    const html = `<button class="build-item ${on ? 'on' : ''} ${affordable ? '' : 'short'}"
      data-act="build" data-def="${id}" aria-pressed="${on}">
      <span class="row1"><span class="name">${esc(def.name)}</span>
      <span class="cost">${costLine(id)}</span></span>
      <span class="desc">${esc(def.desc)}</span>
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
        ? problem ?? 'This will do. Villagers will carry the materials over and build it.'
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
        : `Click a clear spot on the map. Costs ${plainCost(t.def)}; villagers will carry the materials over and build it.`),
    actions: `<button class="btn small" data-act="cancel-tool">Done ${env.touch ? '' : '<kbd>Esc</kbd>'}</button>`,
  });
}

function plainCost(def: BuildingId): string {
  const entries = Object.entries(BUILDINGS[def].cost);
  if (entries.length === 0) return 'nothing';
  return entries.map(([res, qty]) => `${qty} ${RESOURCE_META[res].name.toLowerCase()}`).join(' and ');
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
