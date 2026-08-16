/** Season-aware colour ramps. Everything visual pulls from here. */

import type { Season, TerrainId } from '../types';

export interface Ramp {
  /** base, light, dark, speckle */
  c: [string, string, string, string];
}

type TerrainPalette = Record<TerrainId, Ramp>;

const SPRING: TerrainPalette = {
  water: { c: ['#4a7fa8', '#5f95bd', '#3a688c', '#6ba3c9'] },
  shallow: { c: ['#6fa3c0', '#87b8d2', '#5a8aa6', '#93c2d9'] },
  sand: { c: ['#d9c69a', '#e6d6b0', '#c2ac82', '#e8dcbc'] },
  grass: { c: ['#7aa653', '#8cbb61', '#628c42', '#96c46a'] },
  meadow: { c: ['#8bb85d', '#9dcb6c', '#739c4b', '#b5d97f'] },
  forest: { c: ['#5d8a45', '#6c9c51', '#4a7137', '#78a85c'] },
  rocky: { c: ['#9a9a94', '#adada6', '#7f7f7a', '#b8b8b0'] },
};

const SUMMER: TerrainPalette = {
  water: { c: ['#4d88b4', '#639fca', '#3c7096', '#72abd4'] },
  shallow: { c: ['#74acca', '#8cc1dc', '#5e93af', '#9acbe2'] },
  sand: { c: ['#e0cd9f', '#eddcb6', '#c8b287', '#f0e2c2'] },
  grass: { c: ['#6f9c46', '#82b154', '#588137', '#8dbc5c'] },
  meadow: { c: ['#84b352', '#97c661', '#6c9542', '#b2d874'] },
  forest: { c: ['#4f7d38', '#5d8f43', '#3e652c', '#6a9b4e'] },
  rocky: { c: ['#a09f96', '#b3b2a8', '#85847c', '#bdbcb2'] },
};

const AUTUMN: TerrainPalette = {
  water: { c: ['#487a9e', '#5c8fb3', '#396484', '#68a0c0'] },
  shallow: { c: ['#6b9cb6', '#82b0c8', '#57849c', '#8fbccf'] },
  sand: { c: ['#d3bd90', '#e0cca6', '#b8a279', '#e5d5b2'] },
  grass: { c: ['#8a9c4a', '#9db057', '#71823c', '#a9bc63'] },
  meadow: { c: ['#a5a04e', '#b7b25c', '#8a8541', '#c5bf6c'] },
  forest: { c: ['#8a6b30', '#9e7c39', '#6f5526', '#b08a44'] },
  rocky: { c: ['#96958f', '#a9a8a1', '#7b7a76', '#b3b2ab'] },
};

const WINTER: TerrainPalette = {
  water: { c: ['#5a7d97', '#6e91aa', '#48657c', '#7c9fb6'] },
  shallow: { c: ['#8aa8b8', '#9fbcca', '#728e9e', '#adc7d2'] },
  sand: { c: ['#d8d2c6', '#e6e0d5', '#bdb7ab', '#eee9df'] },
  grass: { c: ['#c8cdc8', '#d9ded8', '#adb2ad', '#e4e8e2'] },
  meadow: { c: ['#cfd3cb', '#dfe3db', '#b3b7b0', '#eaede5'] },
  forest: { c: ['#8a9a90', '#9caca1', '#71807a', '#aebcb0'] },
  rocky: { c: ['#a8aaa8', '#babcb9', '#8c8e8c', '#c6c8c4'] },
};

const TERRAIN: Record<Season, TerrainPalette> = {
  spring: SPRING,
  summer: SUMMER,
  autumn: AUTUMN,
  winter: WINTER,
};

export function terrainRamp(season: Season, id: TerrainId): Ramp {
  return TERRAIN[season][id];
}

/** Foliage colours for trees and bushes. */
export const FOLIAGE: Record<Season, [string, string, string]> = {
  spring: ['#5f9440', '#74ad50', '#436d2c'],
  summer: ['#4f8434', '#639b44', '#376026'],
  autumn: ['#c0762c', '#d68f3c', '#94571d'],
  winter: ['#7d8f84', '#93a398', '#5e6b63'],
};

/** Blossom / berry accents dotted through foliage. */
export const BLOSSOM: Record<Season, string | null> = {
  spring: '#f2c0d8',
  summer: null,
  autumn: '#d64f36',
  winter: '#ffffff',
};

export const TRUNK = ['#6b4a2f', '#7d583a', '#523822'];

export const FLOWER_COLORS: Record<Season, string[]> = {
  spring: ['#f0e26a', '#f2a0c0', '#c79ae8', '#ffffff'],
  summer: ['#f5d44a', '#ef8fb8', '#8fb7ef', '#f27a5a'],
  autumn: ['#e0a13c', '#c96a4a', '#d8c05a'],
  winter: ['#dfe6ea'],
};

/** Slightly lighten or darken a hex colour. */
export function shade(hex: string, mul: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * mul));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * mul));
  const b = Math.min(255, Math.round((n & 255) * mul));
  return `rgb(${r},${g},${b})`;
}

/** Ambient light tint by time of day, multiplied over the finished frame. */
export function ambientTint(dayT: number, season: Season): { r: number; g: number; b: number } {
  // Key colours through the day.
  const stops: { t: number; c: [number, number, number] }[] = [
    { t: 0.0, c: [96, 108, 150] }, // pre-dawn
    { t: 0.05, c: [214, 176, 152] }, // dawn
    { t: 0.14, c: [255, 250, 240] }, // morning
    { t: 0.42, c: [255, 255, 252] }, // midday
    { t: 0.6, c: [252, 226, 190] }, // late afternoon
    { t: 0.68, c: [226, 158, 130] }, // sunset
    { t: 0.76, c: [110, 116, 168] }, // dusk
    { t: 0.85, c: [66, 78, 128] }, // night
    { t: 1.0, c: [78, 90, 138] }, // toward dawn again
  ];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (dayT >= stops[i].t && dayT <= stops[i + 1].t) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const span = b.t - a.t || 1;
  const k = (dayT - a.t) / span;
  let r = a.c[0] + (b.c[0] - a.c[0]) * k;
  let gg = a.c[1] + (b.c[1] - a.c[1]) * k;
  let bb = a.c[2] + (b.c[2] - a.c[2]) * k;

  // Winter days read colder and shorter; summer a shade warmer.
  if (season === 'winter') {
    r *= 0.94;
    gg *= 0.97;
    bb *= 1.06;
  } else if (season === 'summer') {
    r *= 1.03;
    bb *= 0.97;
  } else if (season === 'autumn') {
    r *= 1.02;
    gg *= 0.99;
    bb *= 0.95;
  }
  return { r: Math.min(255, r), g: Math.min(255, gg), b: Math.min(255, bb) };
}

export const UI = {
  ink: '#f3e7d2',
  dim: '#b3a68f',
  panel: 'rgba(28, 24, 20, 0.93)',
  accent: '#e6b35c',
  good: '#8fce85',
  warn: '#e8a05c',
};
