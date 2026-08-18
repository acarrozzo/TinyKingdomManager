/**
 * Getting about. Two shapes of the same set of destinations: a compact toolbar
 * in the top-right corner on a desktop, and a fixed bar along the bottom edge
 * of a phone, where the only part of the screen a thumb reaches comfortably is
 * the part furthest from the top bar.
 *
 * The view pad — zoom and recentre — is here too. On a touchscreen it is the
 * only way to move the map that does not require a second finger, so it is
 * never allowed to sit behind anything.
 */

import type { Game } from '../game';
import { ZOOM_LEVELS } from '../render/camera';
import { esc, type UIEnv } from './context';

export type ModalKind =
  | 'journal'
  | 'wildlife'
  | 'people'
  | 'settings'
  | 'building'
  | 'stores'
  | 'population'
  | 'goals'
  | 'more'
  | null;

export interface NavState {
  /** Whether the list itself is up — what `aria-expanded` is actually about. */
  buildOpen: boolean;
  /** Whether the player is in the middle of building, list up or not. */
  buildActive: boolean;
  modal: ModalKind;
  clean: boolean;
  /** People nobody has looked at yet; a count beside the roster's own button. */
  newcomers: number;
}

/**
 * The tally on the People button. A count rather than a dot, because "three
 * people you have not met" is a different afternoon from "one", and it is left
 * off entirely at nought rather than shown as a zero.
 */
function pip(n: number): string {
  return n > 0 ? `<span class="navpip">${n}</span>` : '';
}

/** The desktop toolbar: everything at once, because there is room for it. */
export function toolbarMarkup(nav: NavState): string {
  const b = (act: string, label: string, on: boolean, title: string, expands = true, cls = '') =>
    `<button class="btn ${cls} ${on ? 'on' : ''}" data-act="${act}" title="${esc(title)}" aria-label="${esc(title)}"
      ${expands ? `aria-expanded="${on}"` : `aria-pressed="${on}"`}>${label}</button>`;

  /*
   * Build is the only verb up here — the rest are places to go and look at
   * something — so it carries the weight of one and keeps it whether or not the
   * list is open. Being the open panel is then a further step up rather than
   * the only time it is coloured at all.
   */
  return [
    b('toggle-build', '🔨 Build', nav.buildOpen, 'Buildings you can place (B)', true, 'primary'),
    `<span class="divider" aria-hidden="true"></span>`,
    b(
      'modal-people',
      `👥${pip(nav.newcomers)}`,
      nav.modal === 'people',
      nav.newcomers > 0
        ? `People and jobs (P) — ${nav.newcomers} nobody has met yet`
        : 'People and jobs (P)',
    ),
    b('modal-journal', '📖', nav.modal === 'journal', 'Kingdom journal (J)'),
    b('modal-wildlife', '🔭', nav.modal === 'wildlife', 'Wildlife seen'),
    b('modal-settings', '⚙️', nav.modal === 'settings', 'Kingdoms and settings'),
    b('clean-on', '👁', nav.clean, 'Clean viewing mode — hide the interface (H)', false),
  ].join('');
}

/**
 * The phone's whole navigation. Labels are not decoration: an emoji alone is a
 * guess, and the guess is different for everybody.
 */
export function bottomNavMarkup(nav: NavState): string {
  const item = (act: string, icon: string, label: string, on: boolean, title: string, open = on, cls = '') =>
    `<button class="navbtn ${cls} ${on ? 'on' : ''}" data-act="${act}" aria-expanded="${open}" aria-label="${esc(title)}">
      <span class="ic" aria-hidden="true">${icon}</span><span class="lb">${esc(label)}</span></button>`;

  // Four of these five are somewhere to look; Build is the one that does
  // something to the kingdom, and reads that way even when it is not the open one.
  return `<nav class="bottomnav" aria-label="Main">
    ${item('toggle-build', '🔨', 'Build', nav.buildActive, 'Build — place a building', nav.buildOpen, 'primary')}
    ${item(
      'modal-people',
      `👥${pip(nav.newcomers)}`,
      'People',
      nav.modal === 'people',
      nav.newcomers > 0 ? `People and jobs — ${nav.newcomers} nobody has met yet` : 'People and jobs',
    )}
    ${item('modal-journal', '📖', 'Journal', nav.modal === 'journal', 'Kingdom journal')}
    ${item('modal-wildlife', '🔭', 'Wildlife', nav.modal === 'wildlife', 'Wildlife seen')}
    ${item('modal-more', '⋯', 'More', nav.modal === 'more' || nav.modal === 'settings', 'More — settings and clean view')}
  </nav>`;
}

/**
 * Recentre and the two zoom steps.
 *
 * The label lives on the wrapper, not the button: a disabled button takes no
 * pointer events, so a tooltip on it would never appear — and a button that is
 * greyed out with no explanation is the one you most want to ask about.
 */
export function viewPadMarkup(game: Game): string {
  const cam = game.camera;
  const btn = (act: string, label: string, tip: string, off = false) =>
    `<span class="vwrap">
      <button class="vbtn" data-act="${act}" ${off ? 'disabled' : ''} aria-label="${esc(tip)}">
        <span aria-hidden="true">${label}</span></button>
      <span class="vtip" aria-hidden="true">${esc(tip)}</span>
    </span>`;

  // Ordered for the desktop row; the phone's column reverses it, which puts
  // zoom-in nearest the top and recentre nearest the thumb.
  const last = ZOOM_LEVELS.length - 1;
  return [
    btn('recentre', '⌂', 'Back to the middle of the kingdom'),
    btn('zoom-out', '−', `Zoom out (now ${cam.zoom}×)`, cam.zoomIndex <= 0),
    btn('zoom-in', '+', `Zoom in (now ${cam.zoom}×)`, cam.zoomIndex >= last),
  ].join('');
}

/** Everything that is neither the immediate loop nor day-to-day management. */
export function moreBody(game: Game, env: UIEnv): string {
  const row = (act: string, icon: string, title: string, desc: string, extra = '') =>
    `<button class="morerow" data-act="${act}" ${extra}>
      <span class="ic" aria-hidden="true">${icon}</span>
      <span class="tx"><span class="t">${esc(title)}</span><span class="d">${esc(desc)}</span></span>
      <span class="go" aria-hidden="true">›</span></button>`;

  return `<div class="morelist">
      ${row('modal-settings', '💾', 'Kingdoms', 'Save, rename, start again, import or export.', 'data-i="0"')}
      ${row('modal-settings', '👁', 'Viewing', 'Speed, names, speech and what is drawn over the map.', 'data-i="1"')}
      ${row('modal-settings', '🔊', 'Sound', `Volume and mute. ${game.settings.muted ? 'Muted just now.' : `${Math.round(game.settings.volume * 100)}% just now.`}`, 'data-i="2"')}
      ${row('clean-on', '🍃', 'Clean view', 'Hide the whole interface and just watch the kingdom.')}
      ${env.compact ? row('modal-goals', '✦', 'What to do next', 'The full list of things the kingdom is working towards.') : ''}
    </div>
    <div class="hint">Nothing here changes the kingdom. Speed and pausing live under Viewing.</div>`;
}
