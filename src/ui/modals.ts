/**
 * The global panels: a building, the people, the journal, the wildlife, and the
 * kingdom's own settings. On a desktop these are centred modals over the map;
 * on a phone they are near-full-height sheets. Either way they are the third
 * level of the interface — things you open, read, and close again.
 *
 * A building panel is a *live* view. It redraws several times a second while it
 * is open, which is why everything here is a plain string builder and why the
 * shell updates the existing nodes rather than replacing the panel.
 */

import type { Building, PropId, ResourceId, SpeciesId, Villager } from '../types';
import {
  BUILDINGS,
  JOB_META,
  RANK_COLOR,
  RESOURCE_META,
  SPECIES,
  SPECIES_ORDER,
  buildingName,
  rankOf,
} from '../sim/defs';
import { buildingById, homeCapacity, jobSlots, villagerById, xpOf } from '../sim/state';
import { labourNeeded, siteNeeds } from '../sim/villager';
import { protectedBuilding } from '../sim/founding';
import { fmtDuration } from '../core/util';
import type { Game } from '../game';
import { listSlots } from '../save/save';
import { activityLabel, cap, esc, type UIEnv } from './context';
import { jobOptionsFor } from './inspector';
import { paintBuilding, paintVillager } from './portraits';

// ---------------------------------------------------------------------------
// A building
// ---------------------------------------------------------------------------

export function buildingTabs(b: Building): string[] {
  const def = BUILDINGS[b.def];
  if (b.stage !== 'done') return ['Site', 'About'];
  const tabs = ['People'];
  if (def.recipe || def.plots || def.harvests) tabs.push('Work');
  tabs.push('About');
  return tabs;
}

export function buildingBody(game: Game, b: Building, tab: string): string {
  switch (tab) {
    case 'Site':
      return siteBody(game, b);
    case 'People':
      return buildingPeople(game, b);
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
    out += `<div class="bsec"><div class="bh" id="b-work">Working here · ${b.workers.length}/${slots}</div>
      ${rows || '<div class="tiny muted">Nobody works here yet, so nothing is being made.</div>'}
      ${
        free > 0
          ? `<div class="badd">
              <select data-act="assign-to" data-id="${b.id}" aria-labelledby="b-work">${workerOptions(game, b)}</select>
              <button class="btn small" data-act="autostaff" data-id="${b.id}">Nearest free hand</button>
            </div>
            <div class="tiny muted" style="margin-top:6px">${free} place${free === 1 ? '' : 's'} still open. Taking somebody off another job is allowed — they keep everything they have learned.</div>`
          : `<div class="tiny muted" style="margin-top:8px">Every place is taken. Improving the building adds more.</div>`
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
      : 'helper, unattached';
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

/** What the place is actually doing: the recipe, the fields, the shelf. */
function buildingWork(game: Game, b: Building): string {
  const g = game.state;
  const def = BUILDINGS[b.def];
  let out = '';

  if (def.recipe) {
    const inRes = Object.keys(def.recipe.inputs)[0] as ResourceId;
    const outRes = Object.keys(def.recipe.outputs)[0] as ResourceId;
    const inQty = def.recipe.inputs[inRes] ?? 0;
    const outQty = def.recipe.outputs[outRes] ?? 0;
    const held = Math.floor(b.input[inRes] ?? 0);
    const made = Math.floor(b.output[outRes] ?? 0);
    out += `<div class="bsec"><div class="bh">Makes</div>
      <div class="row tiny" style="gap:6px">
        <span class="tag">${RESOURCE_META[inRes].icon} ${inQty} ${RESOURCE_META[inRes].name}</span>
        <span class="muted" aria-hidden="true">→</span>
        <span class="tag accent">${RESOURCE_META[outRes].icon} ${outQty} ${RESOURCE_META[outRes].name}</span>
        <span class="muted">every ${Math.round(def.recipe.seconds)}s</span>
      </div>
      <div class="need" style="margin-top:10px"><span aria-hidden="true">🔨</span>
        <span class="track"><i style="width:${Math.round(Math.min(1, b.progress) * 100)}%;background:var(--good)"></i></span>
        <span class="num">${Math.round(Math.min(1, b.progress) * 100)}%</span></div>
      <div class="kv" style="margin-top:8px"><span class="k">${RESOURCE_META[inRes].name} on hand</span><span class="v">${held}</span></div>
      <div class="kv"><span class="k">${RESOURCE_META[outRes].name} waiting to be carried off</span><span class="v">${made}</span></div>
      <div class="tiny muted" style="margin-top:7px;line-height:1.55">${
        b.workers.length === 0
          ? 'Nobody is here to run it, so it sits idle.'
          : held < inQty
            ? `Short of ${RESOURCE_META[inRes].name.toLowerCase()}. Whoever works here will go and fetch some${g.stock[inRes] > 0 ? '' : ', once the kingdom has any'}.`
            : 'Everything it needs is to hand.'
      }</div></div>`;
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
          : g.season === 'winter'
            ? 'Wheat is slow in winter. It will pick up again in spring.'
            : 'Farmers reap what is ripe before sowing anything bare.'
      }</div></div>`;
  }

  if (def.harvests) {
    const what = def.harvests === 'tree' ? 'trees' : 'boulders';
    const res = def.harvests === 'tree' ? 'wood' : 'stone';
    const nearby = nodesNear(game, b, def.harvests);
    out += `<div class="bsec"><div class="bh">Works the ground nearby</div>
      <div class="kv"><span class="k">${cap(what)} within reach</span><span class="v">${nearby}</span></div>
      <div class="kv"><span class="k">${RESOURCE_META[res].name} in the store</span><span class="v">${Math.floor(g.stock[res as ResourceId])}</span></div>
      <div class="tiny muted" style="margin-top:7px;line-height:1.55">${
        nearby === 0
          ? `Nothing left within a short walk. They will range further, and be slower for it, until these grow back.`
          : `Workers here take the nearest ${what}, haul the load to the closest store, and come back for more.`
      }</div></div>`;
  }
  return out || `<div class="tiny muted">Nothing is made here.</div>`;
}

/** Rough count of what a lodge or quarry has left to work within its usual range. */
function nodesNear(game: Game, b: Building, prop: PropId): number {
  const g = game.state;
  const def = BUILDINGS[b.def];
  const cx = b.x + def.w / 2;
  const cy = b.y + def.h / 2;
  let n = 0;
  for (let y = Math.max(0, Math.floor(cy - 13)); y < Math.min(g.h, Math.ceil(cy + 13)); y++)
    for (let x = Math.max(0, Math.floor(cx - 13)); x < Math.min(g.w, Math.ceil(cx + 13)); x++) {
      const t = g.tiles[y * g.w + x];
      if (t.prop === prop && t.amount > 0) n++;
    }
  return n;
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

  return `<div class="bsec"><div class="bh">${b.upgrading ? 'Improvement under way' : 'Under construction'}</div>
    <div class="needs">${rows}
      <div class="need"><span aria-hidden="true">🔨</span><span class="track"><i style="width:${labourPct}%;background:var(--good)"></i></span>
      <span class="num">${Math.round(labourPct)}% built</span></div></div>
    <div class="tiny muted" style="margin-top:9px;line-height:1.55">${
      crew.length > 0
        ? `${crew.length} building it${haulers.length ? `, ${haulers.length} carrying materials over` : ''}.`
        : needs.some((n) => n.have < n.need)
          ? haulers.length
            ? `${haulers.length} on the way with materials.`
            : 'Waiting for materials to be carried over. Helpers pick this up before anything else.'
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
  const def = BUILDINGS[b.def];
  const facts: string[] = [];
  const kv = (k: string, v: string) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`;

  if (def.maxLevel > 1) facts.push(kv('Level', `${b.level} of ${def.maxLevel}`));
  if (def.housing) facts.push(kv('Beds', `${homeCapacity(b)}`));
  if (def.slots) facts.push(kv('Places to work', `${jobSlots(b)}`));
  if (def.storage) facts.push(kv('Adds to the store', `${def.storage[Math.min(b.level, def.storage.length) - 1]}`));
  if (def.job) facts.push(kv('Trade', JOB_META[def.job].name));
  facts.push(kv('Stands on', `${def.w}×${def.h} tiles at ${b.x}, ${b.y}`));
  if (b.stage === 'done' && b.built) facts.push(kv('Built', `Day ${b.built}`));
  if (def.light) facts.push(kv('After dark', 'Lit'));

  const gains = improveGains(b);
  const upgradeable = b.stage === 'done' && b.level < def.maxLevel && !b.upgrading;
  const cost = upgradeable
    ? game
        .upgradeCost(b)
        .map((c) => `${RESOURCE_META[c.res].icon} ${c.qty} ${RESOURCE_META[c.res].name.toLowerCase()}`)
        .join(' · ')
    : '';
  /*
   * What the kingdom has to have *done*, ticked off one line at a time. A
   * single "not yet" would be true and useless; the whole point of a structural
   * gate is that you can see what it is waiting for. A step nothing can satisfy
   * is shown the same way, which is how the last one reads as a horizon rather
   * than as something broken.
   */
  const reqs = upgradeable ? game.upgradeRequirements(b) : [];
  const nextName = def.levelNames?.[Math.min(b.level, def.levelNames.length - 1)] ?? '';
  const reqRows = reqs
    .map(
      (r) =>
        `<div class="kv"><span class="k">${r.met ? '✓' : '○'} ${esc(r.label)}</span>
          <span class="v" style="color:${r.met ? 'var(--good)' : 'var(--faint)'}">${r.met ? 'done' : 'not yet'}</span></div>`,
    )
    .join('');

  return `<div class="bsec">
      <div class="tiny" style="line-height:1.6;color:var(--dim)">${esc(def.desc)}</div>
    </div>
    <div class="bsec"><div class="bh">How it works</div>
      <div class="tiny muted" style="line-height:1.65">${esc(def.how)}</div>
    </div>
    <div class="bsec"><div class="bh">The particulars</div>${facts.join('')}</div>
    ${
      upgradeable
        ? `<div class="bsec"><div class="bh">Improving it${nextName ? ` · ${esc(nextName)}` : ''}</div>
            ${kv('Costs', cost)}
            ${gains.map((line) => `<div class="tiny muted" style="line-height:1.55">${esc(line)}</div>`).join('')}
            ${
              reqRows
                ? `<div class="tiny muted" style="margin:9px 0 4px">And what the kingdom has to have got to:</div>${reqRows}`
                : ''
            }
            <div class="tiny muted" style="margin-top:6px;line-height:1.55">The work is done the same way as building it: materials carried over, then somebody swinging a hammer. It stays in service throughout.</div>
          </div>`
        : b.upgrading
          ? `<div class="bsec"><div class="tiny muted">Improvements are under way. See the Site tab.</div></div>`
          : def.maxLevel > 1
            ? `<div class="bsec"><div class="tiny muted">It is as good as it gets.</div></div>`
            : ''
    }`;
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
  step(def.storage, 'Room in the store');
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
  const why = canUp ? '' : waiting.length ? ` — waiting on: ${waiting[0].label.toLowerCase()}` : ' — not enough in store';
  return `${
    upgradeable
      ? `<button class="btn small ${canUp ? 'primary' : ''}" data-act="upgrade" data-id="${b.id}" ${canUp ? '' : 'disabled'}
          title="${esc(`Improve this building${why}`)}"
          aria-label="${esc(`Improve this building${why}`)}">⬆️ Improve ${cost}</button>`
      : ''
  }
    <button class="btn small" data-act="goto" data-x="${b.x}" data-y="${b.y}">Show me</button>
    ${protectedBuilding(b) ? '' : `<button class="btn small danger" data-act="demolish" data-id="${b.id}">Remove</button>`}`;
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

  const summary = () => {
    const unemployed = g.villagers.filter((v) => v.workplace === 0).length;
    const openSlots = g.buildings
      .filter((b) => b.stage === 'done')
      .reduce((n, b) => n + Math.max(0, jobSlots(b) - b.workers.length), 0);
    return `<div class="row tiny muted" style="margin-bottom:11px;gap:14px">
        <span>${g.villagers.length} villagers</span><span>${unemployed} helpers</span><span>${openSlots} open job${openSlots === 1 ? '' : 's'}</span>
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
            <span class="tx"><span class="nm">${v.favorite ? '★ ' : ''}${esc(v.name)}${v.id === g.founderId ? ' <span class="muted tiny">founder</span>' : ''}</span>
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
        <button class="link plain" data-act="select-villager" data-id="${v.id}">${v.favorite ? '★ ' : ''}${esc(v.name)}${v.id === g.founderId ? ' <span class="muted tiny">founder</span>' : ''}</button>
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

export function viewBody(game: Game): string {
  const s = game.settings;
  return `<div class="row" style="margin-bottom:14px;gap:10px">
      <span style="width:64px">Speed</span>${speedControl(game)}
      <span class="tiny muted"><kbd>space</kbd> pauses · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> set the rate</span>
    </div>
    <label class="check" style="margin-bottom:11px"><input type="checkbox" data-act="set-bubbles" ${s.showBubbles ? 'checked' : ''}> Show what villagers say</label>
    <label class="check" style="margin-bottom:11px"><input type="checkbox" data-act="set-names" ${s.showNames ? 'checked' : ''}> Show names over favourites</label>
    <label class="check" style="margin-bottom:11px"><input type="checkbox" data-act="set-activity" ${s.showActivity ? 'checked' : ''}> Show what everyone is doing</label>
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
