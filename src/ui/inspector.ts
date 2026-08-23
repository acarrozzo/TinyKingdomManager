/**
 * The contextual card: whoever, or whatever, is currently selected on the map.
 *
 * It sits in the right margin on a desktop so the thing it describes stays
 * visible beside it, and rises as a sheet from the bottom of a phone. A
 * building shares that margin but is built elsewhere: its panel has tabs, a
 * roster and a footer of actions, so `ui.ts` assembles it out of the same
 * pieces the phone's sheet uses rather than as a card here.
 */

import type { GameState, JobId, Tile, Villager } from '../types';
import { icon, iconFor } from './icons';
import {
  BUILDINGS,
  JOB_META,
  PROP_META,
  GOOD_SPOT,
  RANK_COLOR,
  RESOURCE_META,
  SPECIES,
  SPECIES_ORDER,
  TERRAIN_META,
  TERRAIN_SPEED,
  TRAIT_META,
  buildingName,
  rankOf,
} from '../sim/defs';
import { buildingById, jobSlots, xpOf } from '../sim/state';
import { fishQuality } from '../world/terrain';
import { fmtDuration } from '../core/util';
import type { Game } from '../game';
import { activityLabel, animalStateLabel, esc, listWords } from './context';

export function villagerCard(game: Game): string {
  const g = game.state;
  const v = game.selectedVillager();
  if (!v) return '';
  const home = buildingById(g, v.home);
  const work = buildingById(g, v.workplace);
  const trait = TRAIT_META[v.trait];
  const following = game.camera.followId === v.id;
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

  const history = v.history
    .slice()
    .reverse()
    .slice(0, 6)
    .map((h) => `<div class="hist"><b>Day ${h.day}</b><br>${esc(h.text)}</div>`)
    .join('');

  return `<div class="insp">
    <div class="title">
      <span class="ipic"><canvas data-pic="villager" data-id="${v.id}" aria-hidden="true"></canvas></span>
      <span class="itx">
        <label class="sr-only" for="v-name">Name</label>
        <input class="namefield" id="v-name" data-act="rename-villager" data-id="${v.id}" value="${esc(v.name)}" maxlength="28">
        <span class="sub">${esc(activityLabel(v))}${v.id === g.founderId ? ' · <span style="color:var(--accent)">Founder</span>' : ''}</span>
      </span>
    </div>

    <div class="section">
      <div class="row" style="gap:5px">
        <span class="tag accent">${iconFor(trait.icon)}${trait.name}</span>
        <span class="tag">Arrived day ${v.arrived}</span>
        ${daysHere > 0 ? `<span class="tag">${daysHere} day${daysHere === 1 ? '' : 's'} here</span>` : ''}
      </div>
      <div class="tiny muted" style="margin-top:7px;line-height:1.5">${esc(trait.desc)}</div>
      ${
        // Personality and nothing else. Said as an observation rather than as a
        // requirement, because it is not one: they will eat the other quite
        // happily, and no part of the kingdom is measured on humouring them.
        g.stats.cooked > 0
          ? `<div class="tiny muted" style="margin-top:5px;line-height:1.5">Would rather have
              ${v.favoriteFood === 'bread' ? 'bread than fish' : 'fish than bread'}, and will eat
              whichever the kitchen has.</div>`
          : ''
      }
    </div>

    <div class="section">
      <div class="h" id="v-work">Work</div>
      <select data-act="assign" data-id="${v.id}" aria-labelledby="v-work" style="width:100%">${jobOptionsFor(game, v)}</select>
      ${
        work
          ? `<div class="tiny muted" style="margin-top:5px">Working at the
        <button class="link" data-act="select-building" data-id="${work.id}">${esc(buildingName(work.def, work.level).toLowerCase())}</button></div>`
          : // Nobody else's panel needs its trade explained, because a trade is
            // the building they stand in. This one has no building, so what a
            // General Worker actually does all day is said here or nowhere.
            `<div class="tiny muted" style="margin-top:5px;line-height:1.5">${esc(JOB_META.general.desc)}</div>`
      }
    </div>

    <div class="section">
      <div class="h">Experience</div>${xpRows}
    </div>

    <div class="section">
      <div class="kv"><span class="k">Home</span><span class="v">${
        home
          ? `<button class="link" data-act="select-building" data-id="${home.id}">${esc(buildingName(home.def, home.level))}</button>${v.homeFixed ? ' <span class="muted tiny">· your choice</span>' : ''}`
          : 'None yet'
      }</span></div>
      <div class="kv"><span class="k">Rested</span><span class="v">${Math.round(v.energy * 100)}%</span></div>
      <div class="kv"><span class="k">Appetite</span><span class="v">${v.hunger > 0.7 ? 'Hungry' : v.hunger > 0.4 ? 'Peckish' : 'Fine'}</span></div>
      ${v.carrying ? `<div class="kv"><span class="k">Carrying</span><span class="v">${icon(v.carrying.res)}${Math.round(v.carrying.qty)}</span></div>` : ''}
    </div>

    ${history ? `<div class="section"><div class="h">History</div>${history}</div>` : ''}

    <div class="actions">
      <button class="btn small ${following ? 'on' : ''}" data-act="${following ? 'unfollow' : 'follow-villager'}" data-id="${v.id}"
        aria-pressed="${following}">${following ? '⦿ Following' : '⦿ Follow'}</button>
      <button class="btn small ${v.favorite ? 'on' : ''}" data-act="fav-villager" data-id="${v.id}"
        aria-pressed="${v.favorite}">${icon(v.favorite ? 'star' : 'starOff')}Favourite</button>
      <button class="btn small" data-act="goto" data-x="${Math.round(v.x)}" data-y="${Math.round(v.y)}">Centre</button>
    </div>
  </div>`;
}

export function jobOptionsFor(game: Game, v: Villager): string {
  const g = game.state;
  // The other rows read "trade — where"; a General Worker's where is nowhere in
  // particular, and saying so is shorter than the select is wide.
  let out = `<option value="0" ${v.workplace === 0 ? 'selected' : ''}>${JOB_META.general.name} — no post</option>`;
  for (const b of g.buildings) {
    if (b.stage !== 'done') continue;
    const def = BUILDINGS[b.def];
    if (!def.job) continue;
    const slots = jobSlots(b);
    const taken = b.workers.length;
    const mine = v.workplace === b.id;
    if (!mine && taken >= slots) continue;
    const meta = JOB_META[def.job];
    out += `<option value="${b.id}" ${mine ? 'selected' : ''}>${meta.name} — ${esc(def.name)} (${taken}/${slots})</option>`;
  }
  return out;
}

export function animalCard(game: Game): string {
  const g = game.state;
  const a = game.selectedAnimal();
  if (!a) return '';
  const def = SPECIES[a.species];
  const following = game.camera.followId === a.id;
  const days = Math.max(0, g.day - a.seen);
  return `<div class="insp">
    <div class="title">
      <label class="sr-only" for="a-name">Name this animal</label>
      <input class="namefield" id="a-name" data-act="name-animal" data-id="${a.id}" value="${esc(a.name ?? '')}"
        placeholder="${esc(def.name)} — give it a name" maxlength="24">
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
      <button class="btn small ${following ? 'on' : ''}" data-act="${following ? 'unfollow' : 'follow-animal'}" data-id="${a.id}"
        aria-pressed="${following}">${following ? '⦿ Following' : '⦿ Follow'}</button>
      <button class="btn small ${a.favorite ? 'on' : ''}" data-act="fav-animal" data-id="${a.id}"
        aria-pressed="${a.favorite}">${icon(a.favorite ? 'star' : 'starOff')}Favourite</button>
    </div>
  </div>`;
}

/**
 * Bare ground is worth reading too — what it is, what is standing on it and
 * what that is good for. Wildlife stays observational: no spawn numbers, and
 * nothing named that the kingdom has not already met.
 */
export function tileCard(game: Game): string {
  const g = game.state;
  const sel = game.selectedTile();
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
      // "left" only where somebody actually comes and takes it. A boulder is
      // nobody's job: the stone in it is only ever recovered by building over
      // it, so saying "stone left" would promise a delivery that never comes.
      rows.push(
        `<div class="kv"><span class="k">${RESOURCE_META[yields].name} ${prop.worked ? 'left' : 'in it'}</span>
          <span class="v">${icon(yields)}${Math.floor(tile.amount)}</span></div>`,
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
  const seenLine = names.length === 0 ? meta.feel : `You have seen ${listWords(names)} in and around ${meta.like}.`;

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
      ${fishingRows(g, tile, x, y)}
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

/**
 * What a stretch of water is worth to a fisher, on the tile's own card.
 *
 * Shown only once the kingdom has a hut, because before that it is a number
 * about a job nobody does. This is economy rather than ecology, so it is said
 * plainly and in the same words the placement bar uses — unlike the wildlife
 * line below it, which stays an observation and never a figure.
 */
function fishingRows(g: GameState, tile: Tile, x: number, y: number): string {
  if (tile.terrain !== 'water' && tile.terrain !== 'shallow') return '';
  if (!g.buildings.some((b) => b.def === 'fishhut')) return '';
  const q = fishQuality(g, x, y);
  const how = q >= GOOD_SPOT ? 'Worth casting into' : q >= 0.45 ? 'Fishable, quietly' : 'Thin water';
  const settled = Math.round(tile.fish * 100);
  return `<div class="kv"><span class="k">Fishing</span><span class="v">${how}</span></div>
    ${
      settled < 96
        ? `<div class="kv"><span class="k">Settled again</span><span class="v">${settled}%</span></div>`
        : ''
    }`;
}

/**
 * What to call the sheet this card is in. The *kind*, not the name: every card
 * opens with the thing's name — as an editable field, for the two that can be
 * renamed — and a header saying it again is a line of a phone screen spent
 * repeating itself.
 */
export function inspectorTitle(game: Game): string {
  switch (game.selection.kind) {
    case 'villager':
      return 'Villager';
    case 'animal':
      return 'Animal';
    case 'tile':
      return 'This tile';
    default:
      return '';
  }
}
