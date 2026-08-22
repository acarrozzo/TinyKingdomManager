/**
 * The global panels: a building, the people, the journal, the wildlife, and the
 * kingdom's own settings. On a desktop these are centred modals over the map;
 * on a phone they are near-full-height sheets. Either way they are the third
 * level of the interface — things you open, read, and close again.
 *
 * A building is the exception on both counts. It is about one place on the map
 * rather than about the kingdom, so on a desktop it goes in the right margin
 * beside the thing it describes and the map stays live around it. And it is a
 * *live* view: it redraws several times a second while it is open, which is why
 * everything here is a plain string builder and why the shell updates the
 * existing nodes rather than replacing the panel.
 */

import type { Building, Recipe, ResourceId, SpeciesId, Villager } from '../types';
import {
  BUILDINGS,
  JOB_META,
  RANK_COLOR,
  RESOURCE_META,
  SPECIES,
  SPECIES_ORDER,
  buildingName,
  extractsOf,
  focusLabel,
  focusOptions,
  inputCapOf,
  rangeOf,
  rankOf,
  recipeOutput,
  recipesOf,
  relocateCost,
  richnessMul,
  storesOf,
  upgradeReqsOf,
} from '../sim/defs';
import { buildingById, homeCapacity, jobSlots, sourceOf, totalOf, villagerById, xpOf } from '../sim/state';
import { buildLimit, commonsGrants, mineGrants } from '../sim/goals';
import { foodGlut, labourNeeded, siteNeeds } from '../sim/villager';
import { protectedBuilding } from '../sim/founding';
import { fmtDuration } from '../core/util';
import type { Game } from '../game';
import { FPS_CHOICES, listSlots } from '../save/save';
import { relocateCostLine } from './build';
import { activityLabel, cap, esc, type UIEnv } from './context';
import { jobOptionsFor } from './inspector';
import { paintBuilding, paintVillager } from './portraits';

// ---------------------------------------------------------------------------
// A building
// ---------------------------------------------------------------------------

export function buildingTabs(b: Building): string[] {
  const def = BUILDINGS[b.def];
  if (b.stage !== 'done') return ['Site', 'About'];
  const works = !!(def.recipe || def.recipes || def.plots || def.harvests || def.extracts || def.fishes);
  const keeps = Object.keys(storesOf(b.def, b.level)).length > 0;
  // Somewhere people are assigned or sleep, which is what makes People the
  // right thing to open on.
  const social = !!(def.slots || def.housing);

  /*
   * A building that keeps things and does no work still has to be able to say
   * what is in it. Every workshop shows that inside Work, which is fine while
   * every building that holds anything is also somewhere something happens —
   * and the storehouse is the building for which that stopped being true. A
   * barn holding a thousand wood whose panel says "nobody is assigned here"
   * is answering a question nobody asked.
   *
   * The commons has quietly had the same gap all along, and its hundred wood
   * is the whole of a young kingdom's storage.
   *
   * It gets a tab named for what it is rather than being filed under Work: no
   * work happens in a storehouse, and a tab promising some would be the panel
   * telling its own small lie. It leads only where there is nothing else to
   * lead with — the commons opens on its people, because that is what the
   * commons is for.
   */
  const tabs: string[] = [];
  if (works || !keeps) tabs.push('People');
  else if (social) tabs.push('People', 'Kept here');
  else tabs.push('Kept here', 'People');
  if (works) tabs.push('Work');
  tabs.push('About');
  return tabs;
}

export function buildingBody(game: Game, b: Building, tab: string): string {
  switch (tab) {
    case 'Site':
      return siteBody(game, b);
    case 'People':
      return buildingPeople(game, b);
    case 'Kept here':
      return storageSection(game, b);
    case 'Work':
      return buildingWork(game, b);
    default:
      return buildingAbout(game, b);
  }
}

/**
 * Who is physically at the building, which is not the same as who belongs to
 * it. The ring of one tile matters: buildings are solid, so somebody asleep in
 * a cabin is really standing at its door.
 */
function peopleAt(game: Game, b: Building): Villager[] {
  const def = BUILDINGS[b.def];
  return game.state.villagers.filter((v) => {
    const x = Math.round(v.x);
    const y = Math.round(v.y);
    return x >= b.x - 1 && x <= b.x + def.w && y >= b.y - 1 && y <= b.y + def.h;
  });
}

function roleAt(b: Building, v: Villager): string {
  const works = v.workplace === b.id;
  const lives = v.home === b.id;
  if (works && lives) return 'works and sleeps here';
  if (works) return 'works here';
  if (lives) return 'sleeps here';
  return 'passing through';
}

/** One line of the roster: who they are, what they are doing, and one control. */
function rosterRow(v: Villager, what: string, note: string, control: string): string {
  return `<div class="brow">
    <button class="who" data-act="select-villager" data-id="${v.id}">
      <canvas class="pic" data-pic="villager" data-id="${v.id}" aria-hidden="true"></canvas>
      <span class="nm">${v.favorite ? '★ ' : ''}${esc(v.name)}</span>
    </button>
    <span class="what">${esc(what)}${note ? ` <span class="muted">· ${esc(note)}</span>` : ''}</span>
    <span class="ctl">${control}</span>
  </div>`;
}

/**
 * Draws every portrait the panel has just asked for. Called after the markup
 * lands, in the same task, so a canvas is never shown before it has anything
 * in it.
 */
export function paintPortraits(game: Game, host: HTMLElement): void {
  const g = game.state;
  for (const node of host.querySelectorAll('canvas[data-pic]')) {
    const canvas = node as HTMLCanvasElement;
    const id = Number(canvas.dataset.id);
    if (canvas.dataset.pic === 'villager') {
      const v = villagerById(g, id);
      if (v) paintVillager(canvas, v);
    } else {
      const b = buildingById(g, id);
      if (b) paintBuilding(canvas, b, g.season);
    }
  }
}

function buildingPeople(game: Game, b: Building): string {
  const g = game.state;
  const def = BUILDINGS[b.def];
  let out = '';

  /*
   * People wander in and out of this list constantly, so the box holds a
   * couple of rows' worth of height whether or not anybody is in it. Without
   * that the whole panel jumps every time somebody walks past a bench.
   */
  const here = peopleAt(game, b).sort((p, q) => p.name.localeCompare(q.name));
  out += `<div class="bsec"><div class="bh">Here now${here.length ? ` · ${here.length}` : ''}</div>
    <div class="bhere">${
      here.length
        ? here
            .map((v) =>
              rosterRow(
                v,
                activityLabel(v),
                roleAt(b, v),
                `<button class="btn small" data-act="follow-villager" data-id="${v.id}">Watch</button>`,
              ),
            )
            .join('')
        : `<div class="bempty tiny muted">Nobody is standing here just now.</div>`
    }</div></div>`;

  if (def.slots) {
    const slots = jobSlots(b);
    const rows = b.workers
      .map((id) => villagerById(g, id))
      .filter((v): v is Villager => !!v)
      .map((v) => {
        const xp = def.job ? xpOf(v, def.job) : 0;
        const rank = rankOf(xp);
        return rosterRow(
          v,
          activityLabel(v),
          '',
          `<span class="tiny rankpip" style="color:${RANK_COLOR[rank]}">${rank}</span>
           <button class="btn small" data-act="unassign" data-id="${v.id}">Remove</button>`,
        );
      })
      .join('');
    const free = slots - b.workers.length;
    // Not every improvement buys another pair of hands — the farm's second level
    // buys barn room instead — so only promise more places when there are more.
    const moreLater = b.level < def.maxLevel && def.slots[Math.min(b.level + 1, def.slots.length) - 1] > slots;
    out += `<div class="bsec"><div class="bh" id="b-work">Working here · ${b.workers.length}/${slots}</div>
      ${rows || '<div class="tiny muted">Nobody works here yet, so nothing is being made.</div>'}
      ${
        free > 0
          ? `<div class="badd">
              <select data-act="assign-to" data-id="${b.id}" aria-labelledby="b-work">${workerOptions(game, b)}</select>
              <button class="btn small" data-act="autostaff" data-id="${b.id}">Nearest free hand</button>
            </div>
            <div class="tiny muted" style="margin-top:6px">${free} place${free === 1 ? '' : 's'} still open. Taking somebody off another job is allowed — they keep everything they have learned.</div>`
          : `<div class="tiny muted" style="margin-top:8px">Every place is taken.${moreLater ? ' Improving the building adds more.' : ''}</div>`
      }</div>`;
  }

  if (def.housing) {
    const capacity = homeCapacity(b);
    const rows = b.residents
      .map((id) => villagerById(g, id))
      .filter((v): v is Villager => !!v)
      .map((v) =>
        rosterRow(
          v,
          // Not "asleep here": a house hemmed in by others cannot always be
          // reached, and its residents bed down as close as they got.
          activityLabel(v),
          v.homeFixed ? 'your choice' : 'settled here',
          `<select data-act="move-home" data-id="${v.id}" aria-label="Where ${esc(v.name)} sleeps">${homeOptions(game, b)}</select>`,
        ),
      )
      .join('');
    const free = capacity - b.residents.length;
    const roofless = g.villagers.filter((v) => !buildingById(g, v.home)).length;
    out += `<div class="bsec"><div class="bh" id="b-beds">Beds · ${b.residents.length}/${capacity}</div>
      ${rows || '<div class="tiny muted">Nobody sleeps here yet.</div>'}
      ${
        free > 0
          ? `<div class="badd"><select data-act="house-in" data-id="${b.id}" aria-labelledby="b-beds">${moveInOptions(game, b)}</select></div>
             <div class="tiny muted" style="margin-top:6px">${free} bed${free === 1 ? '' : 's'} spare.${
               roofless > 0
                 ? ` ${roofless} ${roofless === 1 ? 'person has' : 'people have'} nowhere to sleep.`
                 : ' Anyone you move in stays put; anyone who settled here on their own may be tempted away by a better house.'
             }</div>`
          : `<div class="tiny muted" style="margin-top:8px">Full. Improving it adds beds, or build another house.</div>`
      }</div>`;
  }

  if (!def.slots && !def.housing) {
    out += `<div class="bsec"><div class="tiny muted" style="line-height:1.55">Nobody is assigned here — it is not that sort of building. People come and go of their own accord.</div></div>`;
  }
  return out;
}

/** Every villager who could take a place here, labelled with what it would cost. */
function workerOptions(game: Game, b: Building): string {
  const g = game.state;
  let out = `<option value="0" selected>Put someone to work here…</option>`;
  const people = g.villagers.filter((v) => v.workplace !== b.id).sort((p, q) => p.name.localeCompare(q.name));
  for (const v of people) {
    const post = buildingById(g, v.workplace);
    const rank = post ? rankOf(xpOf(v, v.job)) : null;
    const where = post
      ? `${JOB_META[v.job].name.toLowerCase()} at the ${BUILDINGS[post.def].name.toLowerCase()}`
      : 'general worker, unattached';
    const warn = rank === 'Expert' || rank === 'Master' ? ` ⚠ ${rank}` : '';
    out += `<option value="${v.id}">${esc(v.name)} — ${esc(where)}${warn}</option>`;
  }
  return out;
}

/** Houses a resident could be moved to, plus the option to stop choosing for them. */
function homeOptions(game: Game, b: Building): string {
  const g = game.state;
  let out = `<option value="${b.id}" selected>Stays here</option>`;
  for (const o of g.buildings) {
    if (o.id === b.id || o.stage !== 'done' || homeCapacity(o) === 0) continue;
    if (o.residents.length >= homeCapacity(o)) continue;
    out += `<option value="${o.id}">Move to the ${esc(buildingName(o.def, o.level).toLowerCase())}</option>`;
  }
  out += `<option value="0">Let them settle wherever</option>`;
  return out;
}

function moveInOptions(game: Game, b: Building): string {
  const g = game.state;
  let out = `<option value="0" selected>Move someone in…</option>`;
  const people = g.villagers.filter((v) => v.home !== b.id).sort((p, q) => p.name.localeCompare(q.name));
  for (const v of people) {
    const home = buildingById(g, v.home);
    const where = home ? `sleeps at the ${buildingName(home.def, home.level).toLowerCase()}` : 'no bed at all';
    out += `<option value="${v.id}">${esc(v.name)} — ${esc(where)}</option>`;
  }
  return out;
}

/**
 * The box that says what a building has been told to concentrate on.
 *
 * Only appears where there is genuinely a choice — two or more things this
 * building could be making at this level. It is a plain `<select>` because
 * changing it is meant to be as cheap as it sounds: nothing is thrown away,
 * nobody is reassigned, and setting it back costs the same nothing.
 */
function focusPicker(b: Building, heading: string, note: string): string {
  const options = focusOptions(b.def, b.level);
  if (options.length === 0) return '';
  const current = b.focus ?? 'balanced';
  const rows = options
    .map(
      (f) =>
        `<option value="${f}"${f === current ? ' selected' : ''}>${esc(focusLabel(f))}</option>`,
    )
    .join('');
  return `<div class="bsec"><div class="bh">${esc(heading)}</div>
    <label class="kv"><span class="k">Working on</span>
      <span class="v"><select class="sel" data-act="set-focus" data-id="${b.id}"
        aria-label="What this building concentrates on">${rows}</select></span></label>
    <div class="tiny muted" style="margin-top:7px;line-height:1.55">${esc(note)}</div></div>`;
}

/** One recipe as a row of tags: everything in, everything out, and how long. */
function recipeRow(r: Recipe, active: boolean): string {
  const ins = (Object.keys(r.inputs) as ResourceId[])
    .map((res) => `<span class="tag">${RESOURCE_META[res].icon} ${r.inputs[res]} ${esc(RESOURCE_META[res].name)}</span>`)
    .join('<span class="muted" aria-hidden="true">+</span>');
  const outs = (Object.keys(r.outputs) as ResourceId[])
    .map(
      (res) =>
        `<span class="tag accent">${RESOURCE_META[res].icon} ${r.outputs[res]} ${esc(RESOURCE_META[res].name)}</span>`,
    )
    .join('');
  return `<div class="row tiny" style="gap:6px;margin-bottom:6px;opacity:${r.locked ? 0.45 : active ? 1 : 0.7}">
    ${ins}<span class="muted" aria-hidden="true">→</span>${outs}
    <span class="muted">${r.locked ? 'nobody here has seen any' : `${Math.round(r.seconds)}s`}</span></div>`;
}

/**
 * What this building is holding, one row per resource, with the room it has.
 *
 * Two lists rather than one, and keeping them apart is the whole of the
 * distinction the redesign rests on: what the building is the *home* of, which
 * is where the kingdom's stock of that thing actually is, and what is on the
 * bench waiting to be used, which is a working supply and deliberately small.
 * Showing 24 flour at the kitchen next to 180 bread without saying which is
 * which is how somebody concludes the kitchen is where flour lives.
 */
function storageSection(game: Game, b: Building): string {
  const held = storesOf(b.def, b.level, b.cacheRetired);
  const keeps = (Object.keys(held) as ResourceId[]).filter((res) => (held[res] ?? 0) > 0);
  const bench = (Object.keys(b.input) as ResourceId[]).filter((res) => (b.input[res] ?? 0) > 0);
  // A closed compartment with goods still in it: the camp's founding woodpile,
  // between the lodge opening and the last armful being carried over. It has no
  // room and is not in `keeps`, but there is plainly wood in there and the panel
  // that pretended otherwise would be the one place the player looked.
  const leaving = (Object.keys(b.store) as ResourceId[]).filter(
    (res) => (b.store[res] ?? 0) > 0 && !(held[res] ?? 0),
  );
  if (keeps.length === 0 && bench.length === 0 && leaving.length === 0) return '';

  const benchCap = inputCapOf(b.def, b.level);
  const row = (res: ResourceId, qty: number, cap: number, gain: number | null) => {
    const full = cap > 0 && qty >= cap;
    return `<div class="kv"><span class="k">${RESOURCE_META[res].icon} ${esc(RESOURCE_META[res].name)}</span>
      <span class="v" style="color:${full ? 'var(--warn)' : 'inherit'}">${Math.floor(qty)} / ${cap}${
        gain ? `<span class="muted tiny"> · +${gain} if improved</span>` : ''
      }</span></div>`;
  };

  /*
   * A building that keeps two or three things lists them all, empty rows and
   * all, because the empty compartment is the useful half of the answer: it is
   * the room you are being told you have.
   *
   * A storehouse keeps every resource in the game, and thirteen rows of mostly
   * nought is a wall rather than an answer. Two of those rows would be mithril,
   * which nothing in the kingdom can reach — the same reason `focusOptions`
   * will not offer the forge its mithril recipe. Past a handful, then, only
   * what is actually in there is named, and the rest is one line about room.
   */
  const many = keeps.length > 4;
  const shown = many ? keeps.filter((res) => (b.store[res] ?? 0) > 0) : keeps;
  const spare = keeps.length - shown.length;
  const cap = held[keeps[0]] ?? 0;

  /*
   * The trailing paragraph that used to close this section — "this is where the
   * kingdom keeps wood, anyone who needs some walks here for it" — has gone. The
   * rows above it are that sentence, with numbers, and the walk is a thing the
   * player can watch happening on the map. It is said once during the opening
   * and then demonstrated, rather than reprinted under every building.
   */
  return `<div class="bsec"><div class="bh">Kept here</div>
    ${shown.map((res) => row(res, b.store[res] ?? 0, held[res] ?? 0, game.capacityGain(b, res))).join('') ||
      (leaving.length ? '' : `<div class="tiny muted">${many ? 'Empty, and ready for anything.' : 'Nothing is kept here.'}</div>`)}
    ${
      spare > 0
        ? `<div class="tiny muted" style="margin-top:8px">Empty shelves for everything else besides — ${cap} of each.</div>`
        : ''
    }
    ${
      leaving.length
        ? `<div class="tiny muted" style="margin:10px 0 5px">Closed, and being carried out</div>
           ${leaving
             .map(
               (res) => `<div class="kv"><span class="k">${RESOURCE_META[res].icon} ${esc(RESOURCE_META[res].name)}</span>
                 <span class="v">${Math.floor(b.store[res] ?? 0)}</span></div>`,
             )
             .join('')}
           <div class="tiny muted" style="margin-top:6px;line-height:1.55">The lodge keeps the kingdom's wood now.
             General Workers are walking what is left here across, an armful at a time.</div>`
        : ''
    }
    ${
      bench.length
        ? `<div class="tiny muted" style="margin:10px 0 5px">On the bench — working supplies, fetched as they are used</div>
           ${bench.map((res) => row(res, b.input[res] ?? 0, benchCap, null)).join('')}`
        : ''
    }</div>`;
}

/** What the place is actually doing: the recipe, the fields, the seam. */
function buildingWork(game: Game, b: Building): string {
  const g = game.state;
  const def = BUILDINGS[b.def];
  const recipes = recipesOf(b.def);
  let out = storageSection(game, b);

  if (recipes.length) {
    const live = recipes.filter((r) => !r.locked);
    const current = live.find((r) => recipeOutput(r) === b.focus) ?? live[0];
    // Everything the current recipe wants, against what is actually on the
    // shelf — a two-input recipe that shows only one of them is how somebody
    // ends up convinced their forge is broken.
    // Against everything the building can lay hands on without walking: the
    // bench *and* its own stack. That second half is what makes steel look
    // sensible — the iron bar it wants is one it made and kept.
    const onHand = (res: ResourceId) => Math.floor((b.input[res] ?? 0) + (b.store[res] ?? 0));
    const wantRows = (Object.keys(current.inputs) as ResourceId[])
      .map((res) => {
        const need = current.inputs[res] ?? 0;
        const held = onHand(res);
        return `<div class="kv"><span class="k">${RESOURCE_META[res].name} on hand</span>
          <span class="v" style="color:${held >= need ? 'var(--good)' : 'var(--faint)'}">${held} of ${need}</span></div>`;
      })
      .join('');
    const short = (Object.keys(current.inputs) as ResourceId[]).find(
      (res) => onHand(res) < (current.inputs[res] ?? 0),
    );
    const from = short ? sourceOf(g, short, b.x, b.y) : null;

    out += `<div class="bsec"><div class="bh">Makes</div>
      ${recipes.map((r) => recipeRow(r, r === current)).join('')}
      <div class="need" style="margin-top:4px"><span aria-hidden="true">🔨</span>
        <span class="track"><i style="width:${Math.round(Math.min(1, b.progress) * 100)}%;background:var(--good)"></i></span>
        <span class="num">${Math.round(Math.min(1, b.progress) * 100)}%</span></div>
      <div style="margin-top:8px">${wantRows}</div>
      <div class="tiny muted" style="margin-top:7px;line-height:1.55">${
        b.workers.length === 0
          ? 'Nobody is here to run it, so it sits idle.'
          : short
            ? `Short of ${RESOURCE_META[short].name.toLowerCase()}. Whoever works here will walk ${
                from ? `to the ${buildingName(from.def, from.level).toLowerCase()}` : 'off'
              } and fetch some${from ? '' : ', once the kingdom has any'}.`
            : 'Everything it needs is to hand.'
      }</div></div>`;

    // The note is the building's own: what Balanced does at a forge is nonsense
    // about a kitchen, and a picker that explains the wrong building is worse
    // than one that explains nothing.
    out += focusPicker(b, 'What it is making', def.focusNote ?? '');
  }

  if (def.plots && b.plots.length) {
    const ripe = b.plots.filter((p) => p.state === 'ripe').length;
    const growing = b.plots.filter((p) => p.state === 'growing').length;
    const bare = b.plots.length - ripe - growing;
    const nearest = b.plots.filter((p) => p.state === 'growing').reduce((best, p) => Math.max(best, p.growth), 0);
    out += `<div class="bsec"><div class="bh">Fields · ${b.plots.length} plots</div>
      <div class="kv"><span class="k">Ready to harvest</span><span class="v">${ripe}</span></div>
      <div class="kv"><span class="k">Growing</span><span class="v">${growing}${growing ? ` · furthest along ${Math.round(nearest * 100)}%` : ''}</span></div>
      <div class="kv"><span class="k">Bare</span><span class="v">${bare}</span></div>
      <div class="tiny muted" style="margin-top:7px;line-height:1.55">${
        b.workers.length === 0
          ? 'With no farmer the plots still creep along, at about a third the pace, but nothing gets sown or gathered in.'
          : // Bare ground while the kingdom is comfortable is a decision rather
            // than a stall, and the panel is the only place that can say so —
            // otherwise a fallow field reads as a farm that has stopped working.
            bare > 0 && foodGlut(g, 'wheat')
            ? 'There is plenty to eat, so only part of the field is being kept under seed. What is standing will still be brought in, and the rest goes back under the plough when the larder wants it.'
            : g.season === 'winter'
              ? 'Wheat is slow in winter. It will pick up again in spring.'
              : 'Farmers reap what is ripe, sow what is bare, and hoe whatever is coming on.'
      }</div></div>`;
  }

  // The mine: what this level reaches, how good the seam under it is, and what
  // the next level would add. Deliberately not a count of anything that can run
  // out — the whole point of the building is that its ground does not.
  if (def.extracts) {
    const reach = rangeOf(b.def, b.level);
    const rock = game.nodesInRange(b.def, b.level, b.x, b.y);
    const pace = Math.round(richnessMul(rock) * 100);
    const gets = extractsOf(b.def, b.level);
    // Only describe the next step as a next step when it is one. The last is
    // deliberately out of reach, and dangling mithril in front of somebody who
    // can never have it would be the panel telling them to go and get it.
    const reachable = b.level < def.maxLevel && !upgradeReqsOf(b.def, b.level).some((r) => r.impossible);
    const next = reachable ? extractsOf(b.def, b.level + 1).filter((r) => !gets.includes(r)) : [];
    const horizon = !reachable && b.level < def.maxLevel;
    out += `<div class="bsec"><div class="bh">Getting out</div>
      <div class="row tiny" style="gap:6px;margin-bottom:8px">${gets
        .map((res) => `<span class="tag accent">${RESOURCE_META[res].icon} ${esc(RESOURCE_META[res].name)}</span>`)
        .join('')}</div>
      <div class="kv"><span class="k">Rock within ${reach} tiles</span><span class="v">${rock}</span></div>
      <div class="kv"><span class="k">Which makes the work</span><span class="v">${pace}% of full pace</span></div>
      <div class="tiny muted" style="margin-top:7px;line-height:1.55">${
        b.workers.length === 0
          ? 'Nobody is here to work it. The rock is not going anywhere.'
          : 'Miners walk out to a face in the rock, cut there, and carry the load back here. The ground does not run out — thin rock only means slower. The loose boulders lying about are scenery, and finite: nothing puts one back.'
      }${
        next.length
          ? ` Sinking it deeper would add ${next.map((r) => RESOURCE_META[r].name.toLowerCase()).join(' and ')}, without giving up any of this.`
          : horizon
            ? ' There is said to be mithril somewhere below the deep workings. Nobody here has found any, and nobody here knows how they would.'
            : ''
      }</div></div>`;

    out += focusPicker(b, 'What they are cutting for', def.focusNote ?? '');
  }

  // The hut: how much water it can reach, how much of that is worth the walk,
  // and how rested it is at the moment. Like the mine and unlike the lodge,
  // none of these are counts of something that can run out.
  if (def.fishes) {
    const reach = rangeOf(b.def, b.level);
    const { total, good } = game.spotsInRange(b.def, b.level, b.x, b.y);
    const rested = Math.round(game.spotRest(b) * 100);
    out += `<div class="bsec"><div class="bh">Works the water nearby</div>
      <div class="kv"><span class="k">Water within ${reach} tiles</span><span class="v">${total} tiles</span></div>
      <div class="kv"><span class="k">Spots worth casting into</span><span class="v">${good}</span></div>
      <div class="kv"><span class="k">How settled that water is</span><span class="v">${rested}%</span></div>
      <div class="tiny muted" style="margin-top:7px;line-height:1.55">${
        total === 0
          ? `There is no water in reach of this at all, which is a thing that can happen when the shoreline moves under a hut. ${
              game.canRelocate(b) ? 'Move it to a bank.' : 'It can be moved once it is finished.'
            }`
          : b.workers.length === 0
            ? 'Nobody is here to fish it. The water is not going anywhere.'
            : 'Fishers take the best spot free, cast a few times and carry the catch back here, which is where it stays until a cook comes down for it. Water worked hard goes quiet for a while and settles again on its own, so this can never be fished out — the worst it gets is slow.'
      }</div></div>`;
  }

  if (def.harvests) {
    const what = def.harvests === 'tree' ? 'trees' : 'boulders';
    const reach = rangeOf(b.def, b.level);
    const nearby = game.nodesInRange(b.def, b.level, b.x, b.y);
    out += `<div class="bsec"><div class="bh">Works the ground nearby</div>
      <div class="kv"><span class="k">${cap(what)} within ${reach} tiles</span><span class="v">${nearby}</span></div>
      <div class="tiny muted" style="margin-top:7px;line-height:1.55">${
        nearby === 0
          ? `Nothing left within reach. They will range further, and be slower for it, until these grow back — and if this ground is worked out for good, ${
              game.canRelocate(b) ? 'move it somewhere with more in it.' : 'it can be moved once it is finished.'
            }`
          : `Workers here take the nearest ${what}, carry the load back here, and set off again. Felled trees leave stumps, and stumps grow back.`
      }</div></div>`;
  }
  return out || `<div class="tiny muted">Nothing is made here.</div>`;
}

function siteBody(game: Game, b: Building): string {
  const g = game.state;
  const needs = siteNeeds(b);
  const need = labourNeeded(b);
  const rows = needs
    .map((n) => {
      const pct = n.need > 0 ? Math.min(100, (n.have / n.need) * 100) : 100;
      return `<div class="need"><span aria-hidden="true">${RESOURCE_META[n.res].icon}</span>
        <span class="track"><i style="width:${pct}%"></i></span>
        <span class="num">${Math.floor(n.have)}/${n.need} ${esc(RESOURCE_META[n.res].name.toLowerCase())}</span></div>`;
    })
    .join('');
  const labourPct = need > 0 ? Math.min(100, (b.labour / need) * 100) : 100;
  const crew = g.villagers.filter((v) => v.claim?.kind === 'labour' && v.claim.id === b.id);
  const haulers = g.villagers.filter((v) => v.claim?.kind === 'supply' && v.claim.id === b.id);

  const origin = b.relocOf ? buildingById(g, b.relocOf) : null;
  const heading = b.relocOf
    ? `Ground being made ready${origin ? ` for the ${buildingName(origin.def, origin.level).toLowerCase()}` : ''}`
    : b.upgrading
      ? 'Improvement under way'
      : 'Under construction';

  return `<div class="bsec"><div class="bh">${heading}</div>
    ${
      origin
        ? `<div class="tiny muted" style="margin:-2px 0 9px;line-height:1.55">The ${buildingName(origin.def, origin.level).toLowerCase()} at ${origin.x}, ${origin.y} carries on working until this is finished, and then simply steps across — same level, same people, same name.</div>`
        : ''
    }
    <div class="needs">${rows}
      <div class="need"><span aria-hidden="true">🔨</span><span class="track"><i style="width:${labourPct}%;background:var(--good)"></i></span>
      <span class="num">${Math.round(labourPct)}% built</span></div></div>
    <div class="tiny muted" style="margin-top:9px;line-height:1.55">${
      crew.length > 0
        ? `${crew.length} building it${haulers.length ? `, ${haulers.length} carrying materials over` : ''}.`
        : needs.some((n) => n.have < n.need)
          ? haulers.length
            ? `${haulers.length} on the way with materials.`
            : 'Waiting for materials to be carried over. General Workers pick this up before anything else.'
          : 'Everything it needs is here. Waiting for somebody free to come and build it.'
    }</div></div>
    ${
      crew.length + haulers.length > 0
        ? `<div class="bsec"><div class="bh">On it</div>${[...crew, ...haulers]
            .map((v) =>
              rosterRow(
                v,
                activityLabel(v),
                '',
                `<button class="btn small" data-act="follow-villager" data-id="${v.id}">Watch</button>`,
              ),
            )
            .join('')}</div>`
        : ''
    }`;
}

function buildingAbout(game: Game, b: Building): string {
  const g = game.state;
  const def = BUILDINGS[b.def];
  const facts: string[] = [];
  const kv = (k: string, v: string) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;

  if (def.maxLevel > 1) facts.push(kv('Level', `${b.level} of ${def.maxLevel}`));
  if (def.housing) facts.push(kv('Beds', `${homeCapacity(b)}`));
  if (def.slots) facts.push(kv('Places to work', `${jobSlots(b)}`));
  const keeps = Object.entries(storesOf(b.def, b.level));
  if (keeps.length) {
    // A storehouse keeps every resource at the same figure, and naming all
    // thirteen — two of them mithril, which nothing can reach — says less than
    // "of every kind" does in four words.
    const uniform = keeps.length > 4 && new Set(keeps.map(([, cap]) => cap)).size === 1;
    facts.push(
      kv(
        'Keeps',
        uniform
          ? `${keeps[0][1]} of every kind`
          : keeps.map(([res, cap]) => `${cap} ${RESOURCE_META[res as ResourceId].name.toLowerCase()}`).join(', '),
      ),
    );
  }
  if (def.job) facts.push(kv('Trade', JOB_META[def.job].name));
  if (def.harvests) facts.push(kv('Workers range', `${rangeOf(b.def, b.level)} tiles`));
  if (def.extracts) {
    facts.push(kv('Seam reaches', `${rangeOf(b.def, b.level)} tiles`));
    facts.push(
      kv(
        'Brings up',
        extractsOf(b.def, b.level).map((r) => RESOURCE_META[r].name).join(', '),
      ),
    );
  }
  const limit = buildLimit(g, b.def);
  if (Number.isFinite(limit.max)) {
    facts.push(kv('The kingdom keeps', def.unique ? 'One, and it can be moved' : `${limit.built} of ${limit.max}`));
  }
  facts.push(kv('Stands on', `${def.w}×${def.h} tiles at ${b.x}, ${b.y}`));
  if (b.stage === 'done' && b.built) facts.push(kv('Built', `Day ${b.built}`));
  if (def.light) facts.push(kv('After dark', 'Lit'));

  return `<div class="bsec">
      <div class="tiny" style="line-height:1.6;color:var(--dim)">${esc(def.desc)}</div>
    </div>
    ${movingNote(game, b)}
    <div class="bsec"><div class="bh">How it works</div>
      <div class="tiny muted" style="line-height:1.65">${esc(def.how)}</div>
    </div>
    <div class="bsec"><div class="bh">The particulars</div>${facts.join('')}</div>
    ${improveSection(game, b)}`;
}

/**
 * Everything the next step of this building asks for, always, whether or not it
 * can be taken yet — materials with what the kingdom has beside what is wanted,
 * accomplishments ticked off one at a time, and what the step hands back.
 *
 * The rule this section exists to obey: a disabled button is not an
 * explanation. Anything the player could be waiting on has to be readable
 * *before* they are waiting on it, so a requirement nobody has met yet is shown
 * exactly like one they have — same row, different mark. The last step of the
 * commons is deliberately impossible, and it appears here as a line saying so
 * rather than as a gap where a level ought to be.
 */
function improveSection(game: Game, b: Building): string {
  const g = game.state;
  const def = BUILDINGS[b.def];
  const kv = (k: string, v: string) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;

  if (b.upgrading) {
    return `<div class="bsec"><div class="tiny muted">Improvements are under way. See the Site tab for what is still wanted.</div></div>`;
  }
  if (b.stage !== 'done') return '';
  if (b.level >= def.maxLevel) {
    return def.maxLevel > 1 ? `<div class="bsec"><div class="tiny muted">It is as good as it gets.</div></div>` : '';
  }

  const nextName = def.levelNames?.[Math.min(b.level, def.levelNames.length - 1)] ?? '';
  const reserved = game.reservedMaterials();
  // What is genuinely free, not what is stacked: materials already promised to
  // a site are spoken for, and counting them here would promise them twice.
  const costRows = game
    .upgradeCost(b)
    .map(({ res, qty }) => {
      const have = Math.floor(totalOf(g, res) - (reserved[res] ?? 0));
      const met = have >= qty;
      return `<div class="kv"><span class="k">${met ? '✓' : '○'} ${RESOURCE_META[res].icon} ${esc(
        RESOURCE_META[res].name,
      )}</span>
        <span class="v" style="color:${met ? 'var(--good)' : 'var(--faint)'}">${Math.max(0, have)} of ${qty}</span></div>`;
    })
    .join('');

  const reqRows = game
    .upgradeRequirements(b)
    .map(
      (r) =>
        `<div class="kv"><span class="k">${r.met ? '✓' : '○'} ${esc(r.label)}</span>
          <span class="v" style="color:${r.met ? 'var(--good)' : 'var(--faint)'}">${r.met ? 'done' : 'not yet'}</span></div>`,
    )
    .join('');

  // What the step is for. Read off the def where it can be — beds, slots, room
  // room to keep things — and off the unlock tier where the commons is concerned, so
  // the answer to "why bother" is on the same screen as the price.
  const gains = improveGains(b);
  if ((def.harvests || def.extracts) && def.range && b.level < def.range.length) {
    gains.push(
      def.extracts
        ? `Seam reaches: ${rangeOf(b.def, b.level)} → ${rangeOf(b.def, b.level + 1)} tiles`
        : `Workers range: ${rangeOf(b.def, b.level)} → ${rangeOf(b.def, b.level + 1)} tiles`,
    );
  }
  if (b.def === 'commons') gains.push(...commonsGrants(g, b.level));
  // The mine's own tier, said the same way: what it starts bringing up, and
  // what that opens. This is the answer to "why sink it deeper", and it has to
  // be on the same screen as the price.
  if (b.def === 'quarry') gains.push(...mineGrants(b.level));

  const waiting = [
    ...game.upgradeRequirements(b).filter((r) => !r.met).map((r) => r.label.toLowerCase()),
  ];
  const shortOf = game
    .upgradeCost(b)
    .filter(({ res, qty }) => totalOf(g, res) - (reserved[res] ?? 0) < qty)
    .map(({ res }) => RESOURCE_META[res].name.toLowerCase());

  const why = b.movingTo
    ? 'It is on its way somewhere else. One thing at a time.'
    : waiting.length || shortOf.length
      ? `Not yet: ${[...shortOf.map((s) => `short of ${s}`), ...waiting].join('; ')}.`
      : 'Everything it asks for is here. The Improve button will start the work.';

  return `<div class="bsec"><div class="bh">Improving it${nextName ? ` · ${esc(nextName)}` : ''}</div>
      <div class="tiny muted" style="margin:0 0 5px">What it costs</div>
      ${costRows || kv('Costs', 'Nothing at all')}
      ${
        reqRows
          ? `<div class="tiny muted" style="margin:10px 0 5px">And what the kingdom has to have got to</div>${reqRows}`
          : ''
      }
      ${
        gains.length
          ? `<div class="tiny muted" style="margin:10px 0 5px">What it gives back</div>${gains
              .map((line) => `<div class="kv"><span class="k">${esc(line)}</span><span class="v"></span></div>`)
              .join('')}`
          : ''
      }
      <div class="tiny muted" style="margin-top:9px;line-height:1.55">${esc(why)}</div>
      <div class="tiny muted" style="margin-top:6px;line-height:1.55">The work is done the same way as building it: materials carried over, then somebody swinging a hammer. It stays in service throughout.</div>
    </div>`;
}

/** A move under way, said plainly wherever the building's panel is open. */
function movingNote(game: Game, b: Building): string {
  if (!b.movingTo) return '';
  const site = buildingById(game.state, b.movingTo);
  if (!site) return '';
  const need = labourNeeded(site);
  const pct = need > 0 ? Math.round(Math.min(100, (site.labour / need) * 100)) : 0;
  const short = siteNeeds(site).filter((n) => n.have < n.need);
  return `<div class="bsec"><div class="bh">On its way to ${site.x}, ${site.y}</div>
    <div class="tiny muted" style="line-height:1.55">${
      short.length
        ? `Waiting on materials at the new spot — ${short
            .map((n) => `${Math.floor(n.have)}/${n.need} ${esc(RESOURCE_META[n.res].name.toLowerCase())}`)
            .join(', ')}.`
        : `The new one is ${pct}% built.`
    } Nothing changes here until it is finished.</div>
    <div class="row" style="margin-top:8px">
      <button class="btn small" data-act="goto" data-x="${site.x}" data-y="${site.y}">Show me the new spot</button>
      <button class="btn small" data-act="cancel-move" data-id="${b.id}">Stay here after all</button>
    </div></div>`;
}

/** What one more level actually buys, read straight off the def. */
function improveGains(b: Building): string[] {
  const def = BUILDINGS[b.def];
  const i = b.level - 1;
  const out: string[] = [];
  const step = (arr: number[] | undefined, noun: string) => {
    if (!arr || i + 1 >= arr.length) return;
    // A line saying 2 → 2 is worse than no line: the commons keeps its two beds
    // on purpose, and reading it as a gain makes the whole list untrustworthy.
    if (arr[i + 1] === arr[i]) return;
    out.push(`${noun}: ${arr[i]} → ${arr[i + 1]}`);
  };
  step(def.housing, 'Beds');
  step(def.slots, 'Places to work');
  // Room, per resource. Not one figure: each compartment is its own, and a
  // line reading "Storage: 250 → 1,000" about a mine that keeps three separate
  // materials would be understating it threefold.
  const now = storesOf(b.def, b.level);
  const then = storesOf(b.def, b.level + 1);
  const rooms: { res: ResourceId; was: number; will: number }[] = [];
  for (const k in then) {
    const res = k as ResourceId;
    const was = now[res] ?? 0;
    const will = then[res] ?? 0;
    if (will > was) rooms.push({ res, was, will });
  }
  /*
   * …except when it is one figure after all. A storehouse steps every one of
   * its thirteen compartments together, and thirteen identical lines in a
   * checklist somebody is reading to decide whether to spend sixty wood is
   * noise standing exactly where the answer should be.
   */
  if (rooms.length > 4 && rooms.every((r) => r.was === rooms[0].was && r.will === rooms[0].will)) {
    out.push(`Kept, of every kind: ${rooms[0].was} → ${rooms[0].will}`);
  } else {
    for (const r of rooms) out.push(`${RESOURCE_META[r.res].name} kept: ${r.was} → ${r.will}`);
  }
  return out;
}

/** The three things you might do to a building, on every tab of its panel. */
export function buildingFoot(game: Game, b: Building): string {
  const def = BUILDINGS[b.def];
  const upgradeable = b.stage === 'done' && b.level < def.maxLevel && !b.upgrading;
  const canUp = game.canUpgrade(b);
  const cost = upgradeable
    ? game
        .upgradeCost(b)
        .map((c) => `${RESOURCE_META[c.res].icon}${c.qty}`)
        .join(' ')
    : '';
  // A greyed-out button with no reason on it is the one thing here people would
  // have to guess at, and the reason is usually not the materials.
  const waiting = upgradeable ? game.upgradeRequirements(b).filter((r) => !r.met) : [];
  const why = canUp
    ? ''
    : b.movingTo
      ? ' — it is on its way somewhere else'
      : waiting.length
        ? ` — waiting on: ${waiting[0].label.toLowerCase()}`
        : ' — not enough in storage';
  // Moving is offered on the building's own panel and nowhere else, because it
  // is a thing you do to a *particular* building rather than a mode you enter.
  const movable = game.canRelocate(b);
  return `${
    upgradeable
      ? `<button class="btn small ${canUp ? 'primary' : ''}" data-act="upgrade" data-id="${b.id}" ${canUp ? '' : 'disabled'}
          title="${esc(`Improve this building${why}`)}"
          aria-label="${esc(`Improve this building${why}`)}">⬆️ Improve ${cost}</button>`
      : ''
  }
    ${
      movable
        ? `<button class="btn small" data-act="relocate" data-id="${b.id}"
            title="${esc(`Move it somewhere else — costs ${plainRelocateCost(b)}, and it keeps working until the new one is ready`)}"
            aria-label="${esc(`Move this ${def.name.toLowerCase()} somewhere else`)}">🧭 Move ${relocateCostLine(b.def)}</button>`
        : ''
    }
    <button class="btn small" data-act="goto" data-x="${b.x}" data-y="${b.y}">Show me</button>
    ${protectedBuilding(b) ? '' : `<button class="btn small danger" data-act="demolish" data-id="${b.id}">Remove</button>`}`;
}

function plainRelocateCost(b: Building): string {
  const entries = Object.entries(relocateCost(b.def));
  if (!entries.length) return 'nothing';
  return entries.map(([res, qty]) => `${qty} ${RESOURCE_META[res as ResourceId].name.toLowerCase()}`).join(' and ');
}

// ---------------------------------------------------------------------------
// The rest
// ---------------------------------------------------------------------------

export function journalBody(game: Game): string {
  const g = game.state;
  if (g.journal.length === 0) return `<div class="muted">Nothing has happened yet. Give it time.</div>`;
  return g.journal
    .slice()
    .reverse()
    .map(
      (e) => `<div class="entry"><span class="when">Year ${e.year}, ${cap(e.season)} · Day ${e.day}</span>
        <span class="ic" aria-hidden="true">${e.icon}</span><span>${esc(e.text)}</span></div>`,
    )
    .join('');
}

export function wildlifeBody(game: Game): string {
  const g = game.state;
  const named = g.animals.filter((a) => a.name || a.favorite);
  const cards = SPECIES_ORDER.map((id: SpeciesId) => {
    const def = SPECIES[id];
    const seen = g.discovered.has(id);
    const here = g.animals.filter((a) => a.species === id).length;
    if (!seen)
      return `<div class="card unknown"><div class="cn"><span>? ? ?</span></div><div class="ch">Not seen yet.</div></div>`;
    return `<div class="card"><div class="cn"><span>${esc(def.name)}</span>${here > 0 ? `<span class="muted tiny">${here} about</span>` : ''}</div>
      <div class="ch">${esc(def.hint)}</div></div>`;
  }).join('');

  const namedList = named.length
    ? `<div style="margin-top:16px"><div class="muted tiny" style="text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px">Known by name</div>
      <div class="row" style="gap:6px">${named
        .map(
          (a) =>
            `<button class="tag accent" data-act="select-animal" data-id="${a.id}">${esc(a.name ?? SPECIES[a.species].name)}</button>`,
        )
        .join('')}</div></div>`
    : '';

  return `<div class="muted tiny" style="margin-bottom:11px">${g.discovered.size} of ${SPECIES_ORDER.length} kinds seen. What turns up depends on what the land looks like.</div>
    <div class="grid">${cards}</div>${namedList}`;
}

/**
 * The roster. Four columns on a desktop, where they fit; stacked cards on a
 * phone, where they do not — squeezing a name, a job dropdown, a rank and a
 * button into 340 pixels makes all four illegible rather than one of them.
 */
export function peopleBody(game: Game, env: UIEnv): string {
  const g = game.state;
  const people = g.villagers.slice().sort((a, b) => a.arrived - b.arrived || a.id - b.id);

  /**
   * Somebody who has never had their card opened. It sits beside the name in
   * both shapes of the roster, and it is the same fact the mark on the map and
   * the count on the People button are showing — opening the card clears all
   * three at once.
   */
  const isNew = (v: Villager) => (v.met ? '' : ' <span class="newtag">new</span>');

  const summary = () => {
    const unposted = g.villagers.filter((v) => v.workplace === 0).length;
    const openSlots = g.buildings
      .filter((b) => b.stage === 'done')
      .reduce((n, b) => n + Math.max(0, jobSlots(b) - b.workers.length), 0);
    return `<div class="row tiny muted" style="margin-bottom:11px;gap:14px">
        <span>${g.villagers.length} villagers</span><span>${unposted} general worker${unposted === 1 ? '' : 's'}</span><span>${openSlots} open job${openSlots === 1 ? '' : 's'}</span>
      </div>`;
  };

  const best = (v: Villager) => {
    const top = (Object.keys(v.xp) as (keyof typeof v.xp)[]).sort((a, b) => (v.xp[b] ?? 0) - (v.xp[a] ?? 0))[0];
    if (!top) return null;
    const xp = xpOf(v, top);
    return { rank: rankOf(xp), job: JOB_META[top].name.toLowerCase() };
  };

  if (env.compact) {
    const cards = people
      .map((v) => {
        const b = best(v);
        return `<div class="pcard">
          <button class="who" data-act="select-villager" data-id="${v.id}">
            <canvas class="pic" data-pic="villager" data-id="${v.id}" aria-hidden="true"></canvas>
            <span class="tx"><span class="nm">${v.favorite ? '★ ' : ''}${esc(v.name)}${v.id === g.founderId ? ' <span class="muted tiny">founder</span>' : ''}${isNew(v)}</span>
              <span class="ac">${esc(activityLabel(v))}${b ? ` · <span style="color:${RANK_COLOR[b.rank]}">${b.rank} ${esc(b.job)}</span>` : ''}</span></span>
            <span class="go" aria-hidden="true">›</span>
          </button>
          <div class="pjob">
            <select data-act="assign" data-id="${v.id}" aria-label="Job for ${esc(v.name)}">${jobOptionsFor(game, v)}</select>
            <button class="btn small" data-act="follow-villager" data-id="${v.id}">Watch</button>
          </div>
        </div>`;
      })
      .join('');
    return `${summary()}<div class="pcards">${cards}</div>
      <div class="hint">Tap anyone to see their history, home and traits. Experience is kept for good — moving a master farmer to the mill does not erase what they learned in the field.</div>`;
  }

  const rows = people
    .map((v) => {
      const b = best(v);
      return `<div class="people-row">
        <button class="link plain" data-act="select-villager" data-id="${v.id}">${v.favorite ? '★ ' : ''}${esc(v.name)}${v.id === g.founderId ? ' <span class="muted tiny">founder</span>' : ''}${isNew(v)}</button>
        <select data-act="assign" data-id="${v.id}" aria-label="Job for ${esc(v.name)}">${jobOptionsFor(game, v)}</select>
        <span class="tiny" style="color:${b ? RANK_COLOR[b.rank] : 'var(--faint)'}">${b ? `${b.rank} ${esc(b.job)}` : '—'}</span>
        <button class="btn small" data-act="follow-villager" data-id="${v.id}">Watch</button>
      </div>`;
    })
    .join('');

  return `${summary()}
    <div class="people-row head"><span>Name</span><span>Job</span><span>Best trade</span><span></span></div>
    ${rows}
    <div class="hint">Experience is earned by doing a job, and it is kept for good. Moving a master farmer to the mill does not erase what they learned in the field.</div>`;
}

export function slotsBody(game: Game): string {
  const slots = listSlots();
  const current = game.slotId;
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

/** Speed lives here, in the settings panel, and not on the map. */
function speedControl(game: Game): string {
  const g = game.state;
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
        title="${esc(o.tip)}" aria-label="${esc(o.tip)}" aria-pressed="${on}">${o.label}</button>`;
    })
    .join('');
  return `<div class="speed" role="group" aria-label="Speed">${buttons}</div>`;
}

/**
 * How often the kingdom is repainted. Not a speed and not a quality: the world
 * runs at the same rate whatever this says, and every frame it does paint is
 * the same picture. What changes is how much of the machine is spent on
 * showing it, which for a game meant to be left open all day is worth a row.
 */
function smoothnessControl(game: Game): string {
  const chosen = game.settings.fps;
  const buttons = FPS_CHOICES.map((o) => {
    const on = o.fps === chosen;
    const tip = `${o.label} — ${o.note}`;
    return `<button data-act="set-fps" data-fps="${o.fps}" class="${on ? 'on' : ''}"
      title="${esc(tip)}" aria-label="${esc(tip)}" aria-pressed="${on}">${esc(o.label)}</button>`;
  }).join('');
  return `<div class="speed" role="group" aria-label="Smoothness">${buttons}</div>`;
}

export function viewBody(game: Game): string {
  const s = game.settings;
  const chosen = FPS_CHOICES.find((o) => o.fps === s.fps) ?? FPS_CHOICES[1];
  return `<div class="row" style="margin-bottom:14px;gap:10px">
      <span style="width:64px">Speed</span>${speedControl(game)}
      <span class="tiny muted"><kbd>space</kbd> pauses · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> set the rate</span>
    </div>
    <div class="row" style="margin-bottom:14px;gap:10px">
      <span style="width:64px">Drawing</span>${smoothnessControl(game)}
      <span class="tiny muted">${esc(chosen.note)}</span>
    </div>
    <label class="check" style="margin-bottom:11px"><input type="checkbox" data-act="set-bubbles" ${s.showBubbles ? 'checked' : ''}> Show what villagers say</label>
    <label class="check" style="margin-bottom:11px"><input type="checkbox" data-act="set-names" ${s.showNames ? 'checked' : ''}> Show names over favourites</label>
    <label class="check" style="margin-bottom:11px"><input type="checkbox" data-act="set-activity" ${s.showActivity ? 'checked' : ''}> Show what everyone is doing</label>
    <div class="hint">Drawing the island is nearly all of the work this game asks of a computer, so a lower setting is much kinder to a laptop — and it changes nothing about the kingdom, which goes on at the same rate either way. Whatever you pick, the map stays at full speed while you are dragging it or placing something.</div>
    <div class="hint">Clean viewing mode (<kbd>H</kbd>) hides the whole interface and leaves the kingdom running on its own. Double-click anyone to follow them about.</div>`;
}

export function soundBody(game: Game): string {
  const s = game.settings;
  return `<div class="row" style="margin-bottom:12px"><label for="vol" style="width:64px">Volume</label>
      <input type="range" id="vol" min="0" max="1" step="0.02" value="${s.volume}" data-act="set-volume">
      <span class="tiny muted">${Math.round(s.volume * 100)}%</span></div>
    <label class="check"><input type="checkbox" data-act="set-muted" ${s.muted ? 'checked' : ''}> Mute everything</label>
    <div class="hint">Ambience is generated as you play rather than looped: wind, birds during the day, crickets after dark, and water when you are near it.</div>`;
}
