/** The kingdom's quiet written record, plus transient on-screen notices. */

import type { GameState, Toast } from '../types';

export function journal(g: GameState, text: string, icon = '•'): void {
  const last = g.journal[g.journal.length - 1];
  if (last && last.text === text && last.day === g.day) return;
  g.journal.push({ day: g.day, year: g.year, season: g.season, text, icon });
  if (g.journal.length > 400) g.journal.splice(0, g.journal.length - 400);
}

export function toast(g: GameState, text: string, icon = '•', tone: Toast['tone'] = 'info'): void {
  g.toasts.push({ text, icon, ttl: 7, tone });
  if (g.toasts.length > 5) g.toasts.shift();
}

/** Records something into a specific villager's personal history. */
export function note(g: GameState, villagerId: number, text: string): void {
  const v = g.villagers.find((x) => x.id === villagerId);
  if (!v) return;
  if (v.history.some((h) => h.text === text)) return;
  v.history.push({ day: g.day, text });
  if (v.history.length > 30) v.history.shift();
}

export function updateToasts(g: GameState, realDt: number): void {
  for (let i = g.toasts.length - 1; i >= 0; i--) {
    g.toasts[i].ttl -= realDt;
    if (g.toasts[i].ttl <= 0) g.toasts.splice(i, 1);
  }
}
