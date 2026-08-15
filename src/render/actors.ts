/**
 * Villagers and animals, drawn pixel-by-pixel each frame rather than baked.
 * They are tiny (a villager is 16px tall) so this is cheap, and it means every
 * person can have their own skin, hair, shirt and hat without a sprite cache.
 */

import type { Animal, GameState, Villager } from '../types';
import { BUILDINGS, SPECIES } from '../sim/defs';
import { RESOURCE_META } from '../sim/defs';

type Ctx = CanvasRenderingContext2D;

function px(ctx: Ctx, x: number, y: number, color: string, w = 1, h = 1): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function shadow(ctx: Ctx, x: number, y: number, w: number): void {
  ctx.fillStyle = 'rgba(24,20,14,0.22)';
  ctx.fillRect(Math.round(x - w / 2), Math.round(y - 1), w, 2);
  ctx.fillRect(Math.round(x - w / 2 + 1), Math.round(y - 2), w - 2, 1);
}

const HAT_COLORS = ['#8a5b3a', '#6a7f5a', '#7a6a8a', '#b5893f'];

/**
 * Draws one villager. (sx, sy) is the point where their feet meet the ground.
 * `selected` adds a marker ring so a followed villager stays findable.
 */
export function drawVillager(
  ctx: Ctx,
  v: Villager,
  sx: number,
  sy: number,
  selected: boolean,
  favorite: boolean,
): void {
  const a = v.appearance;
  const back = v.face === 2 || v.face === 3;
  const flip = v.face === 1 || v.face === 2;
  const moving = v.activity === 'walking' || v.activity === 'hauling';
  const working =
    v.activity === 'working' ||
    v.activity === 'gathering' ||
    v.activity === 'building' ||
    v.activity === 'harvesting' ||
    v.activity === 'planting';

  // Gait: a two-frame leg swap plus a one-pixel body bob.
  const stride = moving ? Math.floor(v.phase * 6) % 2 : 0;
  const bob = moving ? (Math.floor(v.phase * 6) % 2 === 0 ? 0 : -1) : 0;
  const workSwing = working ? Math.sin(v.phase * 7) : 0;

  if (v.activity === 'sleeping') {
    drawSleeping(ctx, v, sx, sy);
    if (selected) selectionRing(ctx, sx, sy, '#ffd77a');
    return;
  }

  const sitting = v.activity === 'resting';
  const baseY = sy + (sitting ? 2 : 0);
  const x = Math.round(sx);
  const y = Math.round(baseY) + bob;

  shadow(ctx, sx, sy, 7);
  if (selected) selectionRing(ctx, sx, sy, '#ffd77a');
  else if (favorite) selectionRing(ctx, sx, sy, 'rgba(240,200,96,0.42)');

  // Legs.
  if (!sitting) {
    const l1 = stride === 0 ? 0 : -1;
    const l2 = stride === 0 ? -1 : 0;
    px(ctx, x - 2, y - 4 + l1, a.trousers, 2, 4 - l1);
    px(ctx, x, y - 4 + l2, a.trousers, 2, 4 - l2);
    px(ctx, x - 2, y - 1, '#3a3128', 2, 1);
    px(ctx, x, y - 1, '#3a3128', 2, 1);
  } else {
    px(ctx, x - 2, y - 3, a.trousers, 5, 2);
    px(ctx, x + 1, y - 2, a.trousers, 2, 2);
  }

  // Torso.
  const torsoY = sitting ? y - 9 : y - 10;
  px(ctx, x - 3, torsoY, a.shirt, 6, 6);
  px(ctx, x - 3, torsoY, shade(a.shirt, 1.15), 6, 1);
  px(ctx, flip ? x + 2 : x - 3, torsoY + 1, shade(a.shirt, 0.82), 1, 5);

  // Arms.
  const armY = torsoY + 1;
  const swing = working ? Math.round(workSwing * 2) : moving ? (stride === 0 ? -1 : 1) : 0;
  px(ctx, x - 4, armY + (flip ? swing : -swing), a.shirt, 1, 4);
  px(ctx, x + 3, armY + (flip ? -swing : swing), a.shirt, 1, 4);
  px(ctx, x - 4, armY + 4 + (flip ? swing : -swing), a.skin, 1, 1);
  px(ctx, x + 3, armY + 4 + (flip ? -swing : swing), a.skin, 1, 1);

  // Head.
  const headY = torsoY - 5;
  px(ctx, x - 3, headY, a.skin, 6, 5);
  px(ctx, x - 3, headY, shade(a.skin, 1.08), 6, 1);

  if (!back) {
    // Eyes, offset by facing so people look where they are going.
    const ex = flip ? x - 2 : x;
    px(ctx, ex, headY + 2, '#3a2f26');
    px(ctx, ex + (flip ? -1 : 1) * 2, headY + 2, '#3a2f26');
  }

  // Hair.
  if (a.hat === 0) {
    px(ctx, x - 3, headY - 1, a.hair, 6, 2);
    if (a.hairStyle >= 1) px(ctx, back ? x - 3 : flip ? x + 2 : x - 3, headY + 1, a.hair, 1, 3);
    if (a.hairStyle === 2) px(ctx, x - 3, headY + 1, a.hair, 6, 1);
  } else {
    const hc = HAT_COLORS[a.hat - 1];
    px(ctx, x - 4, headY - 1, hc, 8, 2);
    px(ctx, x - 3, headY - 3, hc, 6, 2);
    px(ctx, x - 3, headY - 3, shade(hc, 1.2), 6, 1);
    px(ctx, x - 3, headY, a.hair, 6, 1);
  }

  // Carried goods, held out in front.
  if (v.carrying) {
    const meta = RESOURCE_META[v.carrying.res];
    const cx = flip ? x - 6 : x + 4;
    px(ctx, cx - 1, torsoY + 1, shade(meta.color, 0.75), 4, 4);
    px(ctx, cx - 1, torsoY + 1, meta.color, 4, 3);
    px(ctx, cx - 1, torsoY + 1, shade(meta.color, 1.25), 4, 1);
  }

  // A tool while working, so the action reads at a glance.
  if (working) {
    const tx = flip ? x - 6 : x + 5;
    const ty = torsoY + 1 + Math.round(workSwing * 2);
    if (v.activity === 'gathering' || v.activity === 'building') {
      px(ctx, tx, ty, '#6b4a2f', 1, 5);
      px(ctx, tx - 1, ty - 1, '#b9bcc2', 3, 2);
    } else if (v.activity === 'harvesting' || v.activity === 'planting') {
      px(ctx, tx, ty, '#6b4a2f', 1, 4);
      px(ctx, tx, ty - 1, '#c8ccd2', 2, 1);
    }
  }
}

function drawSleeping(ctx: Ctx, v: Villager, sx: number, sy: number): void {
  const a = v.appearance;
  const x = Math.round(sx);
  const y = Math.round(sy);
  shadow(ctx, sx, sy, 9);
  px(ctx, x - 5, y - 4, '#6a5f7a', 10, 4);
  px(ctx, x - 5, y - 5, '#7b6f8c', 10, 1);
  px(ctx, x + 3, y - 7, a.skin, 4, 3);
  px(ctx, x + 3, y - 8, a.hair, 4, 1);
  // Drifting Z, in time with a slow breath.
  const t = Math.floor(v.phase * 0.9) % 3;
  ctx.fillStyle = 'rgba(240,235,225,0.75)';
  ctx.fillRect(x + 7 + t, y - 12 - t * 2, 2, 1);
  ctx.fillRect(x + 8 + t, y - 11 - t * 2, 1, 1);
  ctx.fillRect(x + 7 + t, y - 10 - t * 2, 2, 1);
}

function selectionRing(ctx: Ctx, sx: number, sy: number, color: string): void {
  ctx.fillStyle = color;
  const x = Math.round(sx);
  const y = Math.round(sy);
  ctx.fillRect(x - 5, y - 1, 3, 1);
  ctx.fillRect(x + 2, y - 1, 3, 1);
  ctx.fillRect(x - 6, y - 2, 1, 1);
  ctx.fillRect(x + 5, y - 2, 1, 1);
  ctx.fillRect(x - 6, y, 1, 1);
  ctx.fillRect(x + 5, y, 1, 1);
  ctx.fillRect(x - 5, y + 1, 3, 1);
  ctx.fillRect(x + 2, y + 1, 3, 1);
}

/** Slightly lighten or darken a hex colour. */
function shade(hex: string, mul: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * mul));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * mul));
  const b = Math.min(255, Math.round((n & 255) * mul));
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// Animals
// ---------------------------------------------------------------------------

export function drawAnimal(ctx: Ctx, a: Animal, sx: number, sy: number, selected: boolean): void {
  const def = SPECIES[a.species];
  const { body, belly, accent } = def.colors;
  const x = Math.round(sx);
  const y = Math.round(sy - a.hop);
  const flip = a.face === 1 || a.face === 2;
  const dir = flip ? -1 : 1;

  if (def.size > 0) shadow(ctx, sx, sy, def.size === 2 ? 9 : 6);
  if (selected) selectionRing(ctx, sx, sy, '#9fe0ff');

  switch (a.species) {
    case 'rabbit': {
      px(ctx, x - 3, y - 5, body, 6, 4);
      px(ctx, x - 2, y - 3, belly, 4, 2);
      px(ctx, x + 2 * dir, y - 8, body, 3 * dir, 4);
      px(ctx, x + 2 * dir, y - 11, body, 1, 4); // ears
      px(ctx, x + 3 * dir, y - 11, accent, 1, 3);
      px(ctx, x + 3 * dir, y - 6, '#2a2320'); // eye
      px(ctx, x - 4, y - 4, belly, 2, 2); // tail
      px(ctx, x - 2, y - 1, accent, 2, 1);
      px(ctx, x + 1, y - 1, accent, 2, 1);
      break;
    }
    case 'squirrel': {
      px(ctx, x - 2, y - 5, body, 5, 4);
      px(ctx, x + 2 * dir, y - 8, body, 3 * dir, 3);
      px(ctx, x + 3 * dir, y - 7, '#2a2320');
      px(ctx, x - 4 * dir, y - 10, body, 2, 7); // upright tail
      px(ctx, x - 4 * dir, y - 11, belly, 2, 2);
      px(ctx, x - 1, y - 2, accent, 2, 2);
      break;
    }
    case 'bird': {
      px(ctx, x - 2, y - 5, body, 5, 3);
      px(ctx, x - 1, y - 4, belly, 3, 2);
      px(ctx, x + 2 * dir, y - 7, body, 2, 2);
      px(ctx, x + 3 * dir, y - 6, accent);
      px(ctx, x + 4 * dir, y - 6, '#d8a043');
      px(ctx, x - 4 * dir, y - 5, accent, 2, 2);
      px(ctx, x, y - 2, accent, 1, 2);
      break;
    }
    case 'duck': {
      px(ctx, x - 4, y - 5, body, 8, 4);
      px(ctx, x - 3, y - 3, belly, 6, 2);
      px(ctx, x + 3 * dir, y - 9, body, 3, 4);
      px(ctx, x + 5 * dir, y - 7, accent, 2, 2); // bill
      px(ctx, x + 4 * dir, y - 8, '#241f1a');
      px(ctx, x - 5, y - 6, belly, 2, 2);
      break;
    }
    case 'frog': {
      px(ctx, x - 3, y - 4, body, 6, 3);
      px(ctx, x - 2, y - 2, belly, 4, 1);
      px(ctx, x - 3, y - 6, body, 2, 2);
      px(ctx, x + 2, y - 6, body, 2, 2);
      px(ctx, x - 3, y - 6, '#f0f0e0');
      px(ctx, x + 3, y - 6, '#f0f0e0');
      px(ctx, x - 4, y - 2, accent, 2, 1);
      px(ctx, x + 3, y - 2, accent, 2, 1);
      break;
    }
    case 'butterfly': {
      const flap = Math.sin(a.phase * 12) > 0 ? 1 : 0;
      px(ctx, x, y - 8, accent, 1, 3);
      px(ctx, x - 3, y - 9 - flap, body, 3, 3);
      px(ctx, x + 1, y - 9 - flap, body, 3, 3);
      px(ctx, x - 3, y - 9 - flap, belly, 1, 1);
      px(ctx, x + 3, y - 9 - flap, belly, 1, 1);
      break;
    }
    case 'bee': {
      px(ctx, x - 2, y - 8, body, 4, 3);
      px(ctx, x - 1, y - 8, accent, 1, 3);
      px(ctx, x + 1, y - 8, accent, 1, 3);
      const flap = Math.sin(a.phase * 20) > 0 ? 0 : 1;
      px(ctx, x - 2, y - 10 - flap, 'rgba(240,248,255,0.75)', 2, 1);
      px(ctx, x + 1, y - 10 - flap, 'rgba(240,248,255,0.75)', 2, 1);
      break;
    }
    case 'deer': {
      px(ctx, x - 5, y - 10, body, 10, 5);
      px(ctx, x - 4, y - 6, belly, 8, 1);
      px(ctx, x + 4 * dir, y - 15, body, 3, 5); // neck + head
      px(ctx, x + 4 * dir, y - 16, body, 4, 2);
      px(ctx, x + 6 * dir, y - 15, '#241f1a');
      px(ctx, x + 4 * dir, y - 19, accent, 1, 3); // antlers
      px(ctx, x + 6 * dir, y - 19, accent, 1, 3);
      px(ctx, x + 3 * dir, y - 20, accent, 1, 1);
      for (const lx of [-4, -1, 2, 4]) px(ctx, x + lx, y - 5, accent, 1, 5);
      px(ctx, x - 6, y - 9, belly, 2, 2);
      break;
    }
    case 'fox': {
      px(ctx, x - 5, y - 7, body, 9, 4);
      px(ctx, x - 3, y - 4, belly, 6, 1);
      px(ctx, x + 4 * dir, y - 10, body, 3, 4);
      px(ctx, x + 4 * dir, y - 12, accent, 1, 2);
      px(ctx, x + 6 * dir, y - 12, accent, 1, 2);
      px(ctx, x + 5 * dir, y - 9, '#241f1a');
      px(ctx, x - 8, y - 8, body, 4, 3); // brush
      px(ctx, x - 9, y - 8, belly, 2, 2);
      for (const lx of [-4, -1, 1, 3]) px(ctx, x + lx, y - 3, accent, 1, 3);
      break;
    }
    case 'owl': {
      px(ctx, x - 4, y - 11, body, 8, 8);
      px(ctx, x - 3, y - 7, belly, 6, 3);
      px(ctx, x - 4, y - 13, body, 8, 3);
      px(ctx, x - 4, y - 14, accent, 2, 2);
      px(ctx, x + 2, y - 14, accent, 2, 2);
      px(ctx, x - 3, y - 12, '#f0c840', 2, 2);
      px(ctx, x + 1, y - 12, '#f0c840', 2, 2);
      px(ctx, x - 2, y - 12, '#241f1a');
      px(ctx, x + 2, y - 12, '#241f1a');
      px(ctx, x - 1, y - 11, accent, 2, 2);
      px(ctx, x - 3, y - 3, '#d8b048', 2, 2);
      px(ctx, x + 1, y - 3, '#d8b048', 2, 2);
      break;
    }
  }
}

/** Small marker over favourited or named animals so you can find them again. */
export function drawAnimalTag(ctx: Ctx, a: Animal, sx: number, sy: number): void {
  if (!a.favorite && !a.name) return;
  const def = SPECIES[a.species];
  const y = Math.round(sy - a.hop) - (def.size === 2 ? 22 : 13);
  ctx.fillStyle = 'rgba(240,200,96,0.9)';
  ctx.fillRect(Math.round(sx) - 1, y, 3, 1);
  ctx.fillRect(Math.round(sx), y - 1, 1, 3);
}

/** Speech bubble. Text is drawn in screen space by the renderer, not here. */
export function bubbleMetrics(text: string): { w: number; h: number } {
  return { w: text.length * 4 + 8, h: 11 };
}

export function drawBubble(ctx: Ctx, sx: number, sy: number, text: string): void {
  const { w, h } = bubbleMetrics(text);
  const x = Math.round(sx - w / 2);
  const y = Math.round(sy - h);
  ctx.fillStyle = 'rgba(250,246,238,0.94)';
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  ctx.fillStyle = 'rgba(60,50,40,0.25)';
  ctx.fillRect(x + 1, y + h, w - 2, 1);
  ctx.fillStyle = 'rgba(250,246,238,0.94)';
  ctx.fillRect(Math.round(sx) - 1, y + h, 3, 2);

  ctx.fillStyle = '#3c3228';
  ctx.font = '7px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, Math.round(sx), y + h / 2 + 0.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ---------------------------------------------------------------------------
// Activity badges
// ---------------------------------------------------------------------------

/**
 * 7×7 glyphs saying what somebody is up to. `X` is the glyph's own colour and
 * `#` its shading; drawn as pixels rather than emoji so they sit in the art
 * rather than on top of it.
 */
const GLYPHS: Record<string, string[]> = {
  axe: ['.#####.', '.####..', '.###...', '..X....', '..X....', '..X....', '..X....'],
  pick: ['##...##', '.#####.', '...X...', '...X...', '...X...', '...X...', '...X...'],
  hammer: ['.#####.', '.#####.', '...X...', '...X...', '...X...', '...X...', '...X...'],
  wheat: ['...X...', '..XXX..', '...X...', '..XXX..', '...X...', '..X#X..', '...#...'],
  sprout: ['.......', '.X...X.', '.XX.XX.', '..X#X..', '...#...', '...#...', '...#...'],
  sails: ['X.....X', '.X...X.', '..X.X..', '...X...', '..X.X..', '.X...X.', 'X.....X'],
  bread: ['.......', '..XXX..', '.XXXXX.', 'XX#X#XX', 'XXXXXXX', '.XXXXX.', '.......'],
  crate: ['.......', 'XXXXXXX', 'X#####X', 'XXXXXXX', 'X#####X', 'XXXXXXX', '.......'],
  basket: ['..XXX..', '.X...X.', 'XXXXXXX', 'X#####X', 'X#####X', '.XXXXX.', '.......'],
  zzz: ['XXXXXXX', '.....X.', '....X..', '...X...', '..X....', '.X.....', 'XXXXXXX'],
  steps: ['.XX....', '.XXX...', '.XX....', '.......', '...XX..', '...XXX.', '...XX..'],
  eye: ['.......', '..XXX..', '.XXXXX.', 'XX###XX', '.XXXXX.', '..XXX..', '.......'],
  chat: ['.XXXXX.', 'XXXXXXX', 'X#X#X#X', 'XXXXXXX', '.XXXXX.', '..X....', '.......'],
  bench: ['.......', '.......', 'XXXXXXX', 'XXXXXXX', '.#...#.', '.#...#.', '.......'],
  fish: ['.......', '..XXX.X', '.XXXXXX', 'X#XXXXX', '.XXXXXX', '..XXX.X', '.......'],
  star: ['...X...', '...X...', '..XXX..', 'XXXXXXX', '..XXX..', '...X...', '...X...'],
};

const GLYPH_COLORS: Record<string, [string, string]> = {
  axe: ['#8a5b3a', '#c3cad2'],
  pick: ['#8a5b3a', '#c3cad2'],
  hammer: ['#8a5b3a', '#c3cad2'],
  wheat: ['#e6c368', '#c9a95a'],
  sprout: ['#8ecf6b', '#7ec463'],
  sails: ['#e8dcc4', '#e8dcc4'],
  bread: ['#d79a58', '#8a5a2c'],
  crate: ['#c79a5c', '#8a6a3c'],
  basket: ['#c79a5c', '#7d5c33'],
  zzz: ['#dfe6ef', '#dfe6ef'],
  steps: ['#e7dcc6', '#e7dcc6'],
  eye: ['#f0ead8', '#3a3128'],
  chat: ['#f5efe2', '#4a4038'],
  bench: ['#c9a273', '#8a6a45'],
  fish: ['#8fc0d2', '#2e3a42'],
  star: ['#ffd77a', '#ffd77a'],
};

/** Villagers work at a building, so the tool they are holding comes from it. */
function jobGlyph(g: GameState, v: Villager, fallback: string): string {
  if (!v.workplace) return fallback;
  for (const b of g.buildings) {
    if (b.id !== v.workplace) continue;
    switch (BUILDINGS[b.def].job) {
      case 'woodcutter':
        return 'axe';
      case 'stoneworker':
        return 'pick';
      case 'farmer':
        return 'wheat';
      case 'miller':
        return 'sails';
      case 'baker':
        return 'bread';
      default:
        return fallback;
    }
  }
  return fallback;
}

/** Which badge, if any, belongs over this villager right now. */
function activityGlyph(g: GameState, v: Villager): string | null {
  switch (v.activity) {
    case 'sleeping':
      return 'zzz';
    case 'walking':
      return 'steps';
    case 'hauling':
      return 'crate';
    case 'working':
      return jobGlyph(g, v, 'hammer');
    case 'gathering':
      return jobGlyph(g, v, 'basket');
    case 'building':
      return 'hammer';
    case 'planting':
      return 'sprout';
    case 'harvesting':
      return 'wheat';
    case 'eating':
      return 'bread';
    case 'resting':
      return 'bench';
    case 'chatting':
      return 'chat';
    case 'watching':
      return 'eye';
    case 'fishing':
      return 'fish';
    case 'arriving':
      return 'star';
    default:
      return null;
  }
}

/**
 * Drawn after the lighting pass, so a badge stays readable once it is dark —
 * the villager underneath still falls into shadow like everything else.
 */
export function drawActivityIcon(ctx: Ctx, g: GameState, v: Villager, sx: number, sy: number): void {
  const key = activityGlyph(g, v);
  if (!key) return;
  const rows = GLYPHS[key];
  const [main, shade] = GLYPH_COLORS[key];
  // A carried load takes the colour of whatever is in the crate.
  const primary = key === 'crate' && v.carrying ? RESOURCE_META[v.carrying.res].color : main;
  const secondary = key === 'crate' && v.carrying ? 'rgba(40,32,24,0.5)' : shade;

  const left = Math.round(sx) - 4;
  const top = Math.round(sy) - 29;

  // Backing plate, corners clipped so it reads as a rounded badge.
  ctx.fillStyle = 'rgba(24,20,16,0.42)';
  ctx.fillRect(left, top + 1, 9, 7);
  ctx.fillRect(left + 1, top, 7, 9);

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      px(ctx, left + 1 + c, top + 1 + r, ch === 'X' ? primary : secondary);
    }
  }
}

/** Tiny per-villager status pip: hungry, tired, or nothing at all. */
export function drawMood(ctx: Ctx, g: GameState, v: Villager, sx: number, sy: number): void {
  if (v.activity === 'sleeping') return;
  // Sits beside the activity badge rather than under it, so the two never stack.
  const y = Math.round(sy) - 27;
  if (v.hunger > 0.85 && g.stock.bread <= 0) {
    px(ctx, Math.round(sx) + 6, y, '#e8b45c', 3, 3);
    px(ctx, Math.round(sx) + 7, y + 1, '#8a5a28', 1, 1);
  }
}
