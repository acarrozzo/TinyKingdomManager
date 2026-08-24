/**
 * Who lives here, and what they are all doing.
 *
 * Two tabs, because the roster answers two questions that pull in opposite
 * directions. **Roster** is person-first: here is Mira, here is what she is
 * good at, here is where you might put her. **Jobs** is place-first: here is
 * the quarry with a place standing empty, and here is the best free hand for
 * it. Folding them into one list made every row carry both, and a row that
 * answers two questions answers neither at a glance.
 *
 * What it never does is play for you. It shows what is standing empty and who
 * is spare, and stops there — no name is put forward, nothing is ranked for
 * you, and there is no button that staffs the kingdom. Who works where is the
 * player's judgement, and a terrarium you optimise once and stop looking at is
 * a spreadsheet with weather.
 */

import type { Building, JobId, Rank, Villager } from '../types';
import { icon, iconFor } from './icons';
import { BUILDINGS, JOB_META, RANK_COLOR, TRAIT_META, buildingName, rankOf, traitJobMul } from '../sim/defs';
import { buildingById, jobSlots, paceOf, villagerById, xpOf } from '../sim/state';
import type { Game } from '../game';
import { activityLabel, esc, listWords, type UIEnv } from './context';
import { jobOptionsFor } from './inspector';

/** The two halves of the panel, in the order they are shown. */
export const PEOPLE_TABS = ['Roster', 'Jobs'];

/** The picture box on the jobs board, in art pixels. Cropped, never scaled. */
const THUMB_W = 58;
const THUMB_H = 46;

/** Which of the roster's shortlists is showing. */
export type PeopleFilter = 'all' | 'unposted' | 'new' | 'fav';
/** What the roster is ordered by, under the favourites pinned at the top. */
export type PeopleSort = 'arrived' | 'name' | 'job' | 'rank';

/** The shell keeps this, so a live redraw does not reset what is on screen. */
export interface PeopleView {
  filter: PeopleFilter;
  sort: PeopleSort;
}

const SORT_LABEL: Record<PeopleSort, string> = {
  arrived: 'Order they arrived',
  name: 'Name',
  job: 'Trade',
  rank: 'Best trade',
};

// ---------------------------------------------------------------------------
// What somebody is worth at a trade
// ---------------------------------------------------------------------------

/**
 * Two decimal places, because 1.10 and 1.15 are a different worker.
 *
 * `paceOf` is the simulation's own figure — practice and nature multiplied
 * together, exactly as a stint of work is — so this is a readout rather than an
 * estimate. It is the spine of everything below: the standing column, the
 * ordering, and which name an empty job puts forward.
 */
function pace(v: Villager, job: JobId): string {
  return `${paceOf(v, job).toFixed(2)}×`;
}

/** Their strongest trade, or nothing at all if they have never worked. */
function bestTrade(v: Villager): { job: JobId; rank: Rank } | null {
  const jobs = (Object.keys(v.xp) as JobId[]).filter((j) => (v.xp[j] ?? 0) > 0.4);
  if (jobs.length === 0) return null;
  jobs.sort((a, b) => (v.xp[b] ?? 0) - (v.xp[a] ?? 0));
  return { job: jobs[0], rank: rankOf(xpOf(v, jobs[0])) };
}

/**
 * What their nature is worth where they are standing today, in a few words.
 *
 * Only when it bites at their current trade, because that is the case a player
 * can act on and the only part of the column that ever changes. Everything else
 * a nature does is in the hover, which has the room to say it in a sentence.
 */
function natureNote(v: Villager): string {
  const mul = traitJobMul(v.trait, v.job);
  return mul > 1 ? `+${Math.round((mul - 1) * 100)}%` : '';
}

/**
 * The whole of a nature, for the hover.
 *
 * Flavour first and the number second: what it is like to have them about is
 * the reason they are a person rather than a work rate, and what it is worth is
 * the reason the column is in a roster. Built here and drawn by the shell,
 * which owns the one floating tip node.
 */
export function natureTip(v: Villager): string {
  const t = TRAIT_META[v.trait];
  const mul = traitJobMul(v.trait, v.job);
  const trade = JOB_META[v.job].name.toLowerCase();
  // Where else it would pay, for a nature in the wrong job. Derived rather than
  // listed, so a trait whose effect is retuned in `defs` says the truth here
  // without anybody remembering to come and edit a sentence.
  const elsewhere = (Object.keys(JOB_META) as JobId[])
    .filter((j) => traitJobMul(v.trait, j) > 1)
    .map((j) => JOB_META[j].name.toLowerCase());
  const last =
    mul > 1
      ? `<span class="tip-line lift">Worth +${Math.round((mul - 1) * 100)}% to ${esc(v.name)} as a ${esc(trade)}.</span>`
      : elsewhere.length > 0
        ? `<span class="tip-line muted">Nothing to a ${esc(trade)}. It pays as a ${esc(listWords(elsewhere))}.</span>`
        : `<span class="tip-line muted">Nothing that shows in a work rate — it changes their day rather than what they make.</span>`;
  return `<span class="tip-head">${iconFor(t.icon)}${esc(t.name)}</span>
    <span class="tip-line">${esc(t.desc)}</span>
    <span class="tip-line"><b>${esc(t.perk)}</b></span>
    ${last}`;
}

/**
 * The chip itself, which is the whole of the column now.
 *
 * The hover is a convenience and not the only way to the sentence: it is
 * carried here for a reader who is not using a mouse, the same way the tip
 * carries it for one who is. A tooltip that is the sole home of a fact is a
 * fact half the room cannot get at.
 */
function natureCell(v: Villager): string {
  const t = TRAIT_META[v.trait];
  const note = natureNote(v);
  return `<span class="tchip" data-tip="nature" data-id="${v.id}">${iconFor(t.icon)}<span class="n">${esc(t.name)}</span>${
    note ? `<span class="pct">${esc(note)}</span>` : ''
  }<span class="sr-only"> — ${esc(t.perk)}</span></span>`;
}

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

/**
 * Somebody whose card has never been opened. The same fact as the mark on the
 * map and the count on the People button — opening the card clears all three.
 */
function newTag(v: Villager): string {
  return v.met ? '' : ' <span class="newtag">new</span>';
}

/**
 * A name and whatever is worth saying beside it.
 *
 * The name is the part allowed to run out of room, which is why it carries the
 * ellipsis and the tags do not shrink. The other way round, a long name pushed
 * "new" off the end of its own row — and the mark is the reason the row is
 * worth looking at.
 */
function nameCell(g: { founderId: number }, v: Villager): string {
  return `<span class="n">${esc(v.name)}</span>${v.id === g.founderId ? '<span class="muted tiny tag-n">founder</span>' : ''}${newTag(v)}`;
}

/**
 * The name, as a link to their card — or as a field, if it is being changed.
 *
 * One row at a time rather than twenty inputs stacked up: a roster of text
 * boxes is a form, and the name is also the way into somebody's card, which an
 * always-editable field would take away. The pencil beside it swaps the one
 * row, and the shell's live redraw stands down while the field has focus.
 */
function nameLine(g: { founderId: number }, v: Villager, renaming: number): string {
  if (v.id === renaming) {
    return `<span class="nm editing">
      <label class="sr-only" for="rn-${v.id}">Name</label>
      <input class="namefield" id="rn-${v.id}" data-act="rename-villager" data-id="${v.id}"
        value="${esc(v.name)}" maxlength="28" autocomplete="off">
    </span>`;
  }
  return `<span class="nm">
    <button class="link plain n" data-act="select-villager" data-id="${v.id}">${esc(v.name)}</button>
    ${v.id === g.founderId ? '<span class="muted tiny tag-n">founder</span>' : ''}${newTag(v)}
    ${renameButton(v)}
  </span>`;
}

/** Swaps this row's name for a field. Drawn beside the name it changes. */
function renameButton(v: Villager): string {
  const label = `Rename ${v.name}`;
  return `<button class="iconbtn rename" data-act="rename-start" data-id="${v.id}"
    aria-label="${esc(label)}" title="${esc(label)}">${icon('pencil')}</button>`;
}

function favButton(v: Villager): string {
  const label = v.favorite ? `Stop favouring ${v.name}` : `Favourite ${v.name}`;
  return `<button class="iconbtn favbtn ${v.favorite ? 'on' : ''}" data-act="fav-villager" data-id="${v.id}"
    aria-pressed="${v.favorite}" aria-label="${esc(label)}" title="${esc(label)}">${icon(v.favorite ? 'star' : 'starOff')}</button>`;
}

function watchButton(game: Game, v: Villager): string {
  const on = game.camera.followId === v.id;
  return `<button class="btn small ${on ? 'on' : ''}" data-act="${on ? 'unfollow' : 'follow-villager'}" data-id="${v.id}"
    aria-pressed="${on}">${on ? 'Watching' : 'Watch'}</button>`;
}

/**
 * Rank and pace at whatever they do today, which is not always their best.
 *
 * The trade is not named again: the column to its left is a dropdown with the
 * trade in it, and saying "Master" beside "Miner — Quarry" is enough.
 */
function standing(v: Villager): string {
  const rank = rankOf(xpOf(v, v.job));
  const trade = JOB_META[v.job].name.toLowerCase();
  const why = `How fast ${v.name} works as a ${trade}, practice and nature together. 1.00× is an even day's work.`;
  return `<span class="rk" style="color:${RANK_COLOR[rank]}">${rank}</span>
    <span class="sub" title="${esc(why)}">${pace(v, v.job)} pace</span>`;
}

/**
 * The shortlists across the top.
 *
 * A chip appears once it has anybody in it and stays while it is the one
 * selected, so switching to Favourites and then un-starring the last favourite
 * leaves you looking at an empty list with the way out still on screen rather
 * than at a filter that has vanished with the list still filtered.
 *
 * And nothing at all while the kingdom is small. Three chips and a sort
 * control above a list of two people is furniture: there is no shortlist worth
 * taking of a roster you can read in one glance, and the opening hours of a
 * kingdom are exactly when the panel should be at its plainest.
 */
const BAR_FROM = 4;

function filterBar(g: { villagers: Villager[] }, view: PeopleView): string {
  if (g.villagers.length < BAR_FROM && view.filter === 'all') return '';
  const counts: Record<PeopleFilter, number> = {
    all: g.villagers.length,
    unposted: g.villagers.filter((v) => v.workplace === 0).length,
    new: g.villagers.filter((v) => !v.met).length,
    fav: g.villagers.filter((v) => v.favorite).length,
  };
  const chip = (key: PeopleFilter, label: string) => {
    if (key !== 'all' && counts[key] === 0 && view.filter !== key) return '';
    const on = view.filter === key;
    return `<button class="chip ${on ? 'on' : ''}" data-act="people-filter" data-key="${key}"
      aria-pressed="${on}">${label} <span class="n">${counts[key]}</span></button>`;
  };
  const sorts = (Object.keys(SORT_LABEL) as PeopleSort[])
    .map((s) => `<option value="${s}"${s === view.sort ? ' selected' : ''}>${esc(SORT_LABEL[s])}</option>`)
    .join('');
  return `<div class="pbar">
    <div class="chips">${chip('all', 'Everyone')}${chip('unposted', 'No post')}${chip('new', 'Not met')}${chip('fav', 'Favourites')}</div>
    <label class="psort"><span class="tiny muted">Sort</span>
      <select data-act="people-sort" aria-label="Order the roster by">${sorts}</select></label>
  </div>`;
}

function matchesFilter(v: Villager, filter: PeopleFilter): boolean {
  switch (filter) {
    case 'unposted':
      return v.workplace === 0;
    case 'new':
      return !v.met;
    case 'fav':
      return v.favorite;
    default:
      return true;
  }
}

/**
 * Favourites first, then whatever was asked for.
 *
 * Starring somebody is a request to keep an eye on them, and a list that then
 * buries them eleven rows down has not honoured it. Every ordering falls back
 * to arrival, which is the only one that never ties.
 */
function ordered(people: Villager[], sort: PeopleSort): Villager[] {
  const rankOfBest = (v: Villager) => {
    const b = bestTrade(v);
    return b ? xpOf(v, b.job) : -1;
  };
  return people.slice().sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    switch (sort) {
      case 'name':
        return a.name.localeCompare(b.name) || a.arrived - b.arrived;
      case 'job':
        return JOB_META[a.job].name.localeCompare(JOB_META[b.job].name) || a.name.localeCompare(b.name);
      case 'rank':
        return rankOfBest(b) - rankOfBest(a) || a.name.localeCompare(b.name);
      default:
        return a.arrived - b.arrived || a.id - b.id;
    }
  });
}

function summaryLine(game: Game): string {
  const g = game.state;
  const unposted = g.villagers.filter((v) => v.workplace === 0).length;
  const open = openSlots(game).reduce((n, s) => n + s.free, 0);
  return `<div class="row tiny muted" style="margin-bottom:10px;gap:14px">
    <span>${g.villagers.length} ${g.villagers.length === 1 ? 'villager' : 'villagers'}</span>
    <span>${unposted} general worker${unposted === 1 ? '' : 's'}</span>
    <span>${open} open job${open === 1 ? '' : 's'}</span></div>`;
}

function rosterTab(game: Game, env: UIEnv, view: PeopleView, renaming: number): string {
  const g = game.state;
  const shown = ordered(g.villagers.filter((v) => matchesFilter(v, view.filter)), view.sort);

  if (shown.length === 0) {
    return `${summaryLine(game)}${filterBar(g, view)}
      <div class="tiny muted" style="padding:16px 0">Nobody here matches that.
        <button class="link" data-act="people-filter" data-key="all">Show everyone</button></div>`;
  }

  if (env.compact) {
    const cards = shown
      .map((v) => {
        const trait = TRAIT_META[v.trait];
        const b = bestTrade(v);
        const editing = v.id === renaming;
        // No hover on a phone, so the perk is said in the card rather than
        // hidden behind one. The tip is a desktop affordance and nothing else.
        return `<div class="pcard">
          ${
            editing
              ? `<div class="pname">${nameLine(g, v, renaming)}</div>`
              : `<button class="who" data-act="select-villager" data-id="${v.id}">
                  <canvas class="pic" data-pic="villager" data-id="${v.id}" aria-hidden="true"></canvas>
                  <span class="tx"><span class="nm">${v.favorite ? icon('star') : ''}${nameCell(g, v)}</span>
                    <span class="ac">${esc(activityLabel(v))}${b ? ` · <span style="color:${RANK_COLOR[b.rank]}">${b.rank} ${esc(JOB_META[b.job].name.toLowerCase())}</span>` : ''}</span></span>
                  <span class="go" aria-hidden="true">›</span>
                </button>`
          }
          <div class="pmeta">
            <span class="tchip">${iconFor(trait.icon)}<span class="n">${esc(trait.name)}</span></span>
            <span class="spacer"></span>
            ${favButton(v)}
            ${renameButton(v)}
          </div>
          <div class="pperk tiny muted">${esc(trait.perk)}</div>
          <div class="pjob">
            <select data-act="assign" data-id="${v.id}" aria-label="Job for ${esc(v.name)}">${jobOptionsFor(game, v)}</select>
            ${watchButton(game, v)}
          </div>
        </div>`;
      })
      .join('');
    return `${summaryLine(game)}${filterBar(g, view)}<div class="pcards">${cards}</div>
      ${rosterHint()}`;
  }

  const rows = shown
    .map(
      (v) => `<div class="prow">
        ${favButton(v)}
        <span class="who">
          <button class="link plain figure" data-act="select-villager" data-id="${v.id}"
            aria-label="${esc(`Open ${v.name}'s card`)}">
            <canvas class="pic" data-pic="villager" data-id="${v.id}" aria-hidden="true"></canvas>
          </button>
          <span class="tx">${nameLine(g, v, renaming)}
            <span class="sub">${esc(activityLabel(v))}</span></span>
        </span>
        <span class="nature">${natureCell(v)}</span>
        <span class="job">
          <select data-act="assign" data-id="${v.id}" aria-label="Job for ${esc(v.name)}">${jobOptionsFor(game, v)}</select>
        </span>
        <span class="rate">${standing(v)}</span>
        ${watchButton(game, v)}
      </div>`,
    )
    .join('');

  return `${summaryLine(game)}${filterBar(g, view)}
    <div class="prow head"><span></span><span>Who</span><span>Nature</span><span>Job</span><span>Standing</span><span></span></div>
    ${rows}
    ${rosterHint()}`;
}

function rosterHint(): string {
  return `<div class="hint">Experience is earned by doing a job and kept for good — moving a master farmer to the mill does not erase
    what they learned in the field. The figure beside a rank is how fast they work that trade, practice and nature together,
    and it is the same one the kingdom uses.</div>`;
}

// ---------------------------------------------------------------------------
// The jobs board
// ---------------------------------------------------------------------------

interface Post {
  b: Building;
  job: JobId;
  slots: number;
  free: number;
}

/** Every finished workplace, whether or not it has room, with its trade. */
function posts(game: Game): Post[] {
  const out: Post[] = [];
  for (const b of game.state.buildings) {
    if (b.stage !== 'done') continue;
    const def = BUILDINGS[b.def];
    if (!def.slots || !def.job) continue;
    const slots = jobSlots(b);
    out.push({ b, job: def.job, slots, free: Math.max(0, slots - b.workers.length) });
  }
  // Somewhere standing empty is the thing this tab exists to show, so it goes
  // first; after that, alphabetical, because a board that reorders itself as
  // people are hired is a board you lose your place in.
  return out.sort(
    (p, q) =>
      q.free - p.free ||
      buildingName(p.b.def, p.b.level).localeCompare(buildingName(q.b.def, q.b.level)),
  );
}

function openSlots(game: Game): Post[] {
  return posts(game).filter((p) => p.free > 0);
}

function workerRow(game: Game, v: Villager, job: JobId): string {
  return `<div class="jrow">
    <button class="who" data-act="select-villager" data-id="${v.id}">
      <canvas class="pic" data-pic="villager" data-id="${v.id}" aria-hidden="true"></canvas>
      <span class="nm">${v.favorite ? icon('star') : ''}${esc(v.name)}</span>
    </button>
    <span class="what tiny muted">${esc(activityLabel(v))}</span>
    <span class="rk tiny" style="color:${RANK_COLOR[rankOf(xpOf(v, job))]}">${rankOf(xpOf(v, job))} · ${pace(v, job)}</span>
    <span class="ctl">
      ${watchButton(game, v)}
      <button class="btn small" data-act="unassign" data-id="${v.id}">Remove</button>
    </span>
  </div>`;
}

/**
 * Everyone who could take a place here, and what taking them would cost.
 *
 * Shared with the building's own panel, which is the other place a job is
 * filled from — the two lists are the same list, so they are built once.
 */
export function workerOptions(game: Game, b: Building): string {
  const g = game.state;
  let out = `<option value="0" selected>Put someone to work here…</option>`;
  const people = g.villagers.filter((v) => v.workplace !== b.id).sort((p, q) => p.name.localeCompare(q.name));
  for (const v of people) {
    const post = buildingById(g, v.workplace);
    const rank = post ? rankOf(xpOf(v, v.job)) : null;
    const where = post
      ? `${JOB_META[v.job].name.toLowerCase()} at the ${BUILDINGS[post.def].name.toLowerCase()}`
      : 'general worker, unattached';
    const warn = rank === 'Expert' || rank === 'Master' ? ` — ${rank}` : '';
    out += `<option value="${v.id}">${esc(v.name)} — ${esc(where)}${warn}</option>`;
  }
  return out;
}

function postCard(game: Game, p: Post): string {
  const g = game.state;
  const def = BUILDINGS[p.b.def];
  const meta = JOB_META[p.job];
  const rows = p.b.workers
    .map((id) => villagerById(g, id))
    .filter((v): v is Villager => !!v)
    .map((v) => workerRow(game, v, p.job))
    .join('');

  const moreLater =
    p.b.level < def.maxLevel && (def.slots?.[Math.min(p.b.level + 1, def.slots.length) - 1] ?? 0) > p.slots;

  const spare = g.villagers.filter((v) => v.workplace === 0).length;
  let fill = '';
  if (p.free > 0) {
    fill = `<div class="jfill">
      <select data-act="assign-to" data-id="${p.b.id}" aria-label="Put somebody to work at the ${esc(buildingName(p.b.def, p.b.level).toLowerCase())}">${workerOptions(game, p.b)}</select>
      <div class="tiny muted">${
        spare > 0
          ? `${p.free} place${p.free === 1 ? '' : 's'} open, and ${spare} ${spare === 1 ? 'person has' : 'people have'} no post.`
          : `${p.free} place${p.free === 1 ? '' : 's'} open. Everybody already has a trade — taking somebody off another job is allowed, and they keep everything they have learned.`
      }</div>
    </div>`;
  } else {
    fill = `<div class="tiny muted">Every place is taken.${moreLater ? ' Improving the building adds more.' : ''}</div>`;
  }

  return `<div class="jcard ${p.free > 0 ? 'open' : ''}">
    <div class="jhead">
      <span class="bpic"><canvas data-pic="building" data-id="${p.b.id}" data-w="${THUMB_W}" data-h="${THUMB_H}" aria-hidden="true"></canvas></span>
      <span class="tx">
        <button class="link plain nm" data-act="select-building" data-id="${p.b.id}">${esc(buildingName(p.b.def, p.b.level))}</button>
        <span class="sub">${iconFor(meta.icon)}${esc(meta.name)}</span>
      </span>
      <span class="cnt ${p.free > 0 ? 'warn' : ''}">${p.b.workers.length}/${p.slots}</span>
    </div>
    ${rows || '<div class="tiny muted" style="padding:4px 0">Nobody works here, so nothing is being made.</div>'}
    ${fill}
  </div>`;
}

/**
 * The unattached, as a card of their own at the foot of the board.
 *
 * They are not a building and they are not idle: a General Worker supplies
 * sites, builds, restocks benches and clears finished goods, and a board that
 * showed only the buildings would read as though the rest of the kingdom were
 * standing about.
 */
function generalCard(game: Game): string {
  const g = game.state;
  const spare = g.villagers.filter((v) => v.workplace === 0);
  const rows = spare.map((v) => workerRow(game, v, 'general')).join('');
  return `<div class="jcard">
    <div class="jhead">
      <span class="bpic ghand" aria-hidden="true">${iconFor(JOB_META.general.icon, '', 'lg')}</span>
      <span class="tx"><span class="nm">General Workers</span>
        <span class="sub">No post — the kingdom's spare hands</span></span>
      <span class="cnt">${spare.length}</span>
    </div>
    ${rows || '<div class="tiny muted" style="padding:4px 0">Everybody has a trade. Construction and restocking now wait on whoever has a quiet moment.</div>'}
    <div class="tiny muted" style="margin-top:6px;line-height:1.55">${esc(JOB_META.general.desc)}</div>
  </div>`;
}

function jobsTab(game: Game): string {
  const all = posts(game);
  const open = all.reduce((n, p) => n + p.free, 0);
  if (all.length === 0) {
    return `<div class="bempty tiny muted" style="padding:18px 0;text-align:center">No workplaces yet.
      The first building with a trade in it will appear here.</div>${generalCard(game)}`;
  }
  const head = `<div class="row tiny muted" style="margin-bottom:11px;gap:14px">
    <span>${all.length} workplace${all.length === 1 ? '' : 's'}</span>
    <span>${open} open job${open === 1 ? '' : 's'}</span></div>`;
  return `${head}<div class="jcards">${all.map((p) => postCard(game, p)).join('')}${generalCard(game)}</div>
    <div class="hint">A job standing empty is a building making nothing, which is why they sort to the top.
      Anyone may take any post: experience is kept for good, so moving a master farmer to the mill costs nothing but the walk.</div>`;
}

// ---------------------------------------------------------------------------

export function peopleBody(game: Game, env: UIEnv, tab: number, view: PeopleView, renaming: number): string {
  return tab === 1 ? jobsTab(game) : rosterTab(game, env, view, renaming);
}

/** What the panel's subtitle says, which differs by tab. */
export function peopleSub(game: Game, tab: number): string {
  const g = game.state;
  if (tab === 1) {
    const open = openSlots(game).reduce((n, p) => n + p.free, 0);
    return open > 0 ? `${open} job${open === 1 ? '' : 's'} standing empty` : 'Every place is taken';
  }
  const unmet = g.villagers.filter((v) => !v.met).length;
  return unmet > 0 ? `${unmet} ${unmet === 1 ? 'person' : 'people'} you have not met` : 'Who lives here';
}
