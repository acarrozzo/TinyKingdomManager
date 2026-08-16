/**
 * What to do next.
 *
 * The tone matters more here than anywhere else in the interface. These are
 * suggestions about a place that cannot fail, not a quest log: no timers, no
 * counters ticking down, nothing lost by ignoring them. So they say what the
 * kingdom is working towards and what it opens up, and then get out of the way
 * — one line on a phone until you ask for the rest.
 */

import { RESOURCE_META } from '../sim/defs';
import { carriedByFounder } from '../sim/goals';
import { foundingDone } from '../sim/founding';
import { fmtDuration } from '../core/util';
import type { Game } from '../game';
import { esc } from './context';

/** The desktop panel: the next thing or two, and how far along the list is. */
export function goalPanelMarkup(game: Game): string {
  const g = game.state;
  const pending = g.goals.filter((x) => !x.done);

  if (pending.length === 0) {
    return `<div class="panel"><div class="goal done"><span class="mark" aria-hidden="true">✓</span>
      <span><span class="t">Everything on the list is done</span>
      <span class="d">The kingdom is yours to keep tending.</span></span></div>
      <div class="goal-more"><span>${g.villagers.length} villagers · ${fmtDuration(g.played)} played</span>
      <button class="btn small" data-act="modal-goals">All goals</button></div></div>`;
  }

  // Founding shows one instruction at a time. There is only ever one thing to
  // be doing, and a second line would read as a second thing to do.
  const founding = !foundingDone(g);
  const items = pending
    .slice(0, founding ? 1 : 2)
    .map(
      (goal, i) => `<div class="goal${i === 0 ? ' now' : ''}"><span class="mark" aria-hidden="true"></span>
        <span><span class="t">${esc(goal.title)}</span><span class="d">${esc(goal.desc)}</span></span></div>`,
    )
    .join('');

  return `<div class="panel">${items}
    <div class="goal-more"><span>${footLine(game)}</span>
    ${founding ? '' : `<button class="btn small" data-act="modal-goals">All goals</button>`}</div></div>`;
}

/**
 * The phone's version: one line, always there, never in the way. It is the only
 * progression guidance a narrow screen has room for, so it stays up after
 * founding rather than disappearing the moment the kingdom is on its feet.
 */
export function goalChipMarkup(game: Game, collapsed: boolean): string {
  const g = game.state;
  const next = g.goals.find((x) => !x.done);
  if (collapsed) {
    return `<button class="goalchip mini" data-act="expand-goalchip" aria-label="Show what to do next">
      <span aria-hidden="true">✦</span></button>`;
  }
  const title = next ? next.title : 'Everything on the list is done';
  // During founding the founder's arms are the whole treasury, and how much is
  // in them is the only progress there is to show.
  const carried = foundingDone(g) ? 0 : carriedByFounder(g);
  const aside = carried > 0 ? `${RESOURCE_META.wood.icon} ${carried}` : '';

  return `<div class="goalchip">
      <button class="gc-main" data-act="modal-goals" aria-label="What to do next: ${esc(title)}">
        <span class="lb">Next</span><span class="t">${esc(title)}</span>
        ${aside ? `<span class="aside">${aside}</span>` : ''}
      </button>
      <button class="gc-x" data-act="collapse-goalchip" aria-label="Hide the objective">×</button>
    </div>`;
}

/** The full list, as a sheet. Pending in order, then what has been ticked off. */
export function goalsBody(game: Game): string {
  const g = game.state;
  const pending = g.goals.filter((x) => !x.done);
  const done = g.goals.filter((x) => x.done);

  const now = pending[0];
  const rest = pending.slice(1);

  const line = (title: string, desc: string, state: 'now' | 'next' | 'done') =>
    `<div class="goal ${state}"><span class="mark" aria-hidden="true">${state === 'done' ? '✓' : ''}</span>
      <span><span class="t">${esc(title)}</span>${desc ? `<span class="d">${esc(desc)}</span>` : ''}</span></div>`;

  return `${
    now
      ? `<div class="bsec"><div class="bh">Now</div><div class="goallist">${line(now.title, now.desc, 'now')}</div></div>`
      : `<div class="bsec"><div class="goallist">${line('Everything on the list is done', 'The kingdom is yours to keep tending. Nothing here was ever compulsory.', 'done')}</div></div>`
  }
    ${
      rest.length
        ? `<div class="bsec"><div class="bh">After that</div>
            <div class="goallist">${rest.map((x) => line(x.title, x.desc, 'next')).join('')}</div></div>`
        : ''
    }
    ${
      done.length
        ? `<div class="bsec"><div class="bh">Done · ${done.length}</div>
            <div class="goallist">${done.map((x) => line(x.title, '', 'done')).join('')}</div>
            <div class="tiny muted" style="margin-top:8px;line-height:1.55">Each one is written up in the journal as it happens.</div></div>`
        : ''
    }
    <div class="hint">${footLine(game)}</div>`;
}

function footLine(game: Game): string {
  const g = game.state;
  if (!foundingDone(g)) {
    const carried = carriedByFounder(g);
    // The founder's arms are the treasury until the camp is built, so the one
    // number worth showing during founding is what is in them.
    return carried > 0 ? `Carrying ${RESOURCE_META.wood.icon} ${carried} wood` : 'Nothing gathered yet';
  }
  const done = g.goals.filter((x) => x.done).length;
  return `${done} of ${g.goals.length} done · ${g.villagers.length} villager${g.villagers.length === 1 ? '' : 's'} · ${fmtDuration(g.played)} played`;
}
