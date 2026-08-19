/**
 * The vocabulary every interface module shares: what shape of screen we are on,
 * the escaping and formatting helpers, and the plain-English labels for things
 * the simulation stores as ids.
 *
 * Renderers here are string builders. They take the game and the environment,
 * return markup, and never touch layout state — `ui.ts` owns that, decides what
 * is open, and routes the clicks back.
 */

import type { Villager } from '../types';
import { RESOURCE_META } from '../sim/defs';

/**
 * What kind of screen and pointer we are dealing with. Deliberately not a set
 * of width breakpoints: a large phone held sideways is 844 wide and still wants
 * the phone layout, and a touchscreen laptop wants confirm-before-you-build
 * without giving up its side rails.
 */
export interface UIEnv {
  /** Phone-shaped: bottom navigation and sheets rather than side rails. */
  compact: boolean;
  /** Short enough that a stacked sheet would leave no map — phone landscape. */
  short: boolean;
  /** The primary pointer is a finger, so placement is preview-and-confirm. */
  touch: boolean;
}

export const el = (tag: string, cls?: string, html?: string): HTMLElement => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** What was last written into each host, so a redraw can be skipped honestly. */
const written = new WeakMap<HTMLElement, string>();

/**
 * Put markup into a host, and say whether anything actually changed.
 *
 * The obvious way to write this — `if (host.innerHTML !== html)` — is wrong,
 * and was wrong here for a long time without showing. Reading `innerHTML` back
 * gives the *serialised DOM*, in which `&#39;` has become `'` again, so any
 * panel mentioning a Woodcutter's Lodge compared unequal to itself and was torn
 * down and rebuilt every time it was drawn — several times a second. What that
 * looks like is a build list that will not stay scrolled, a hover highlight
 * that flickers off under the cursor, and focus jumping about. Comparing
 * against what was assigned is the whole fix.
 */
export function setHtml(host: HTMLElement, html: string): boolean {
  if (written.get(host) === html) return false;
  written.set(host, html);
  host.innerHTML = html;
  return true;
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "rabbits", "rabbits and deer", "rabbits, deer and sparrows". */
export function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export function animalStateLabel(state: string): string {
  switch (state) {
    case 'feed':
      return 'Nosing about';
    case 'rest':
      return 'Sitting still';
    case 'flee':
      return 'Startled';
    default:
      return 'Wandering';
  }
}

export function activityLabel(v: Villager): string {
  switch (v.activity) {
    case 'sleeping':
      return 'Asleep';
    case 'walking':
      return 'Walking';
    case 'hauling':
      return `Carrying ${v.carrying ? RESOURCE_META[v.carrying.res].name.toLowerCase() : 'goods'}`;
    case 'working':
      return 'At work';
    case 'gathering':
      return 'Gathering';
    case 'building':
      return 'Building';
    case 'planting':
      return 'Sowing';
    case 'tending':
      return 'Tending the fields';
    case 'harvesting':
      return 'Harvesting';
    case 'eating':
      return 'Eating';
    case 'cooking':
      return 'Cooking';
    case 'resting':
      return 'Sitting down';
    case 'chatting':
      return 'Talking to someone';
    case 'watching':
      return 'Watching the world go by';
    // Somebody whose trade it is, and somebody sitting on the bank of an
    // afternoon, are doing visibly the same thing and meaning quite different
    // things by it.
    case 'fishing':
      return v.job === 'fisher' ? 'Fishing' : 'Fishing, more or less';
    case 'arriving':
      return 'Just arrived';
    default:
      return 'Idle';
  }
}
