/**
 * Getting about.
 *
 * There used to be two of these: an emoji toolbar tucked under the clock on a
 * desktop and a five-tab bar along the bottom of a phone. They offered the same
 * places by different names, in different orders, at opposite corners of the
 * screen — two interfaces to learn for one game, and the desktop half was six
 * unlabelled pictures in the one corner a cursor rarely visits.
 *
 * Now there is one cluster, in the bottom right of both, and three places to
 * go. **Build** is the only verb the game has, so it is the largest thing on
 * the screen that is not the kingdom, and it sits in the corner. **People** is
 * beside it because who lives here is the other thing worth checking often.
 * **Kingdom** holds everything that is a matter of record rather than a matter
 * of doing — the journal, the wildlife, the objectives, the settings — behind
 * one door with tabs, because four buttons for four things you open once an
 * hour is furniture, not navigation.
 *
 * The view pad is here too, stacked vertically directly above the cluster. On a
 * touchscreen it is the only way to move the map that does not need a second
 * finger, so it is never allowed to sit behind anything.
 */

import type { Game } from '../game';
import { ZOOM_LEVELS } from '../render/camera';
import { icon } from './icons';
import { esc } from './context';

/**
 * What can be open over the map.
 *
 * Journal, wildlife, goals and settings are no longer among them: they are tabs
 * of `kingdom` now, and the entry points that used to name them individually
 * open that panel at the right tab instead.
 */
export type ModalKind = 'people' | 'kingdom' | 'building' | 'stores' | 'population' | null;

/** The tabs inside the Kingdom panel, in the order they are shown. */
export const KINGDOM_TABS = ['Journal', 'Wildlife', 'Next', 'Settings'];

/** So callers can say which tab they mean without counting. */
export const KTAB = { journal: 0, wildlife: 1, goals: 2, settings: 3 } as const;

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

/**
 * The three destinations, in one cluster, identical on every screen.
 *
 * Ordered so that Build is nearest the corner. On a phone that is where the
 * thumb rests; on a desktop it is where the cursor ends up after everything
 * else, and either way the most-used control should need the shortest journey.
 */
export function actionsMarkup(nav: NavState): string {
  const item = (
    act: string,
    ic: string,
    label: string,
    on: boolean,
    title: string,
    expanded: boolean,
    cls = '',
    badge = '',
  ) =>
    `<button class="navbtn ${cls} ${on ? 'on' : ''}" data-act="${act}"
      aria-expanded="${expanded}" aria-label="${esc(title)}" title="${esc(title)}">
      <span class="ic">${icon(ic, '', 'lg')}${badge}</span><span class="lb">${esc(label)}</span></button>`;

  return `<nav class="actions" aria-label="Main">
    ${item(
      'modal-kingdom',
      'kingdom',
      'Kingdom',
      nav.modal === 'kingdom',
      'Kingdom — journal, wildlife, what to do next, and settings',
      nav.modal === 'kingdom',
    )}
    ${item(
      'modal-people',
      'people',
      'People',
      nav.modal === 'people',
      nav.newcomers > 0 ? `People and jobs (P) — ${nav.newcomers} nobody has met yet` : 'People and jobs (P)',
      nav.modal === 'people',
      '',
      pip(nav.newcomers),
    )}
    ${item(
      'toggle-build',
      'build',
      'Build',
      nav.buildActive,
      'Build — place a building (B)',
      nav.buildOpen,
      'primary',
    )}
  </nav>`;
}

/**
 * Recentre and the two zoom steps, as a column above the action cluster.
 *
 * Vertical on every screen, and in the same corner as everything else you press.
 * It used to be a row on a desktop and a column on a phone, which meant the two
 * layouts disagreed about where looking at the map happened.
 *
 * The label lives on the wrapper, not the button: a disabled button takes no
 * pointer events, so a tooltip on it would never appear — and a button that is
 * greyed out with no explanation is the one you most want to ask about.
 */
export function viewPadMarkup(game: Game): string {
  const cam = game.camera;
  const btn = (act: string, ic: string, tip: string, off = false) =>
    `<span class="vwrap">
      <button class="vbtn" data-act="${act}" ${off ? 'disabled' : ''} aria-label="${esc(tip)}">
        ${icon(ic, '', 'lg')}</button>
      <span class="vtip" aria-hidden="true">${esc(tip)}</span>
    </span>`;

  // Zoom in at the top, out beneath it, home at the bottom nearest the thumb —
  // the order the map itself is in, near to far.
  const last = ZOOM_LEVELS.length - 1;
  return [
    btn('zoom-in', 'plus', `Zoom in (now ${cam.zoom}×)`, cam.zoomIndex >= last),
    btn('zoom-out', 'minus', `Zoom out (now ${cam.zoom}×)`, cam.zoomIndex <= 0),
    btn('recentre', 'recentre', 'Back to the middle of the kingdom'),
  ].join('');
}
