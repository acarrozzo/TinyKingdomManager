/**
 * Villagers and animals, drawn pixel-by-pixel each frame rather than baked.
 * They are tiny (a villager is 16px tall) so this is cheap, and it means every
 * person can have their own skin, hair, shirt and hat without a sprite cache.
 */

import type { Animal, GameState, JobId, Villager } from '../types';
import { BUILDINGS, SPECIES } from '../sim/defs';
import { RESOURCE_META } from '../sim/defs';
import { preparedFood } from '../sim/state';
import { shade } from './palette';

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
 * What somebody has in their hands, by trade and by what they are doing.
 *
 * The activity wins where it names a specific job of work — anybody at all can
 * be handed a hammer and sent to a building site — and their trade decides it
 * the rest of the time. A miner at the rock face and a cook at the range are
 * both "working", and the point of drawing a tool at all is that you should not
 * have to click on them to find out which.
 */
type Tool = 'axe' | 'pick' | 'hoe' | 'rod' | 'ladle' | 'hammer' | 'sack' | 'tongs' | null;

function toolFor(v: Villager): Tool {
  switch (v.activity) {
    case 'building':
      return 'hammer';
    case 'planting':
    case 'tending':
    case 'harvesting':
      return 'hoe';
    case 'fishing':
      return 'rod';
    case 'cooking':
      return 'ladle';
    case 'gathering':
      return v.job === 'miner' ? 'pick' : 'axe';
    case 'working':
      break;
    default:
      return null;
  }
  const byJob: Record<JobId, Tool> = {
    general: 'hammer',
    woodcutter: 'axe',
    miner: 'pick',
    farmer: 'hoe',
    miller: 'sack',
    cook: 'ladle',
    fisher: 'rod',
    smith: 'tongs',
  };
  return byJob[v.job] ?? null;
}

/**
 * Draws a tool held in a hand at `(gx, gy)`. `dir` is +1 facing right, -1
 * facing left, so every shape below is drawn once and mirrored rather than
 * written out twice.
 *
 * The grip is the origin and everything is measured from it, which sounds
 * obvious and was not how the first version worked: each shape had its own
 * idea of where it started, so an axe hung two pixels off the end of the arm
 * holding it and a hoe floated beside the farmer entirely. A tool nobody is
 * holding is worse than no tool, because it reads as a bug rather than as work.
 */
function drawTool(ctx: Ctx, tool: Tool, gx: number, gy: number, dir: number): void {
  const haft = '#6b4a2f';
  const steel = '#c8ccd2';
  const dull = '#8f949b';
  switch (tool) {
    case 'axe':
      px(ctx, gx, gy - 5, haft, 1, 7);
      px(ctx, gx + dir, gy - 6, steel, 1, 3);
      px(ctx, gx + dir * 2, gy - 5, steel, 1, 1);
      break;
    case 'pick':
      px(ctx, gx, gy - 5, haft, 1, 7);
      px(ctx, gx - 1, gy - 6, dull, 3, 1);
      px(ctx, gx + dir * 2, gy - 5, dull, 1, 1);
      px(ctx, gx - dir * 2, gy - 5, dull, 1, 1);
      break;
    case 'hoe':
      // The blade is at the bottom, because a hoe is used by dragging it.
      px(ctx, gx, gy - 5, haft, 1, 7);
      px(ctx, gx + dir, gy + 2, steel, 2, 1);
      px(ctx, gx + dir, gy + 1, dull, 1, 1);
      break;
    case 'rod':
      // The rod goes up and out; the line drops from its tip. A fisher with the
      // rod alone reads as somebody holding a stick.
      for (let i = 0; i < 7; i++) px(ctx, gx + dir * i, gy - 1 - i, haft);
      px(ctx, gx + dir * 6, gy - 7, 'rgba(230,240,245,0.6)', 1, 8);
      break;
    case 'ladle':
      px(ctx, gx, gy - 4, haft, 1, 6);
      px(ctx, gx + dir, gy + 2, dull, 2, 2);
      break;
    case 'hammer':
      px(ctx, gx, gy - 4, haft, 1, 6);
      px(ctx, gx - 1, gy - 6, dull, 3, 2);
      break;
    case 'sack':
      px(ctx, gx - (dir < 0 ? 3 : 0), gy - 3, '#cbb98e', 4, 5);
      px(ctx, gx - (dir < 0 ? 3 : 0), gy - 3, '#e0d0a6', 4, 1);
      break;
    case 'tongs':
      px(ctx, gx, gy - 4, dull, 1, 5);
      px(ctx, gx + dir, gy - 5, dull, 1, 2);
      px(ctx, gx + dir * 2, gy - 6, '#ff8a3c', 2, 2);
      break;
    default:
      break;
  }
}

/**
 * Draws one villager. (sx, sy) is the point where their feet meet the ground.
 * `selected` adds a marker ring so a followed villager stays findable.
 *
 * Sixteen pixels tall, redrawn every frame for everybody on screen, so what
 * goes in here is bought at twenty people times sixty frames a second. That
 * budget is spent on *pose* rather than on detail: at the zooms this game is
 * actually played at, a stoop under a load reads across the whole map and a
 * belt buckle does not.
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
  /** +1 facing right, -1 facing left. Every asymmetric part is drawn off this. */
  const dir = flip ? -1 : 1;
  const moving = v.activity === 'walking' || v.activity === 'hauling';
  const working =
    v.activity === 'working' ||
    v.activity === 'gathering' ||
    v.activity === 'building' ||
    v.activity === 'harvesting' ||
    v.activity === 'planting' ||
    v.activity === 'tending' ||
    v.activity === 'cooking' ||
    v.activity === 'fishing';

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
  const eating = v.activity === 'eating';
  const talking = v.activity === 'chatting';
  const watching = v.activity === 'watching';
  const carrying = !!v.carrying;
  const baseY = sy + (sitting ? 2 : 0);
  const x = Math.round(sx);
  const y = Math.round(baseY) + bob;

  /*
   * A load is heavy. The whole upper body tips a pixel the way they are going
   * and the head drops with it — which is the entire difference between
   * somebody carrying eight stone across a field and somebody out for a walk
   * with a box floating beside their hip.
   */
  const tilt = carrying && !sitting ? dir : 0;

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
    // Sat down: shins forward along the ground, knees up, feet at the end of
    // them. Two rectangles read as a heap; the step between them reads as legs.
    px(ctx, x - 1, y - 5, a.trousers, 3, 3);
    px(ctx, x + dir * 2, y - 3, a.trousers, 3, 2);
    px(ctx, x + dir * 4, y - 2, '#3a3128', 2, 1);
  }

  // Torso.
  const torsoY = sitting ? y - 9 : y - 10;
  const tx0 = x - 3 + tilt;
  px(ctx, tx0, torsoY, a.shirt, 6, 6);
  px(ctx, tx0, torsoY, shade(a.shirt, 1.15), 6, 1);
  px(ctx, flip ? tx0 + 5 : tx0, torsoY + 1, shade(a.shirt, 0.82), 1, 5);
  // A belt. One pixel, and it is what stops a torso reading as a painted block.
  px(ctx, tx0, torsoY + 5, shade(a.trousers, 0.8), 6, 1);

  // Arms.
  const armY = torsoY + 1;
  const front = tx0 + (flip ? -1 : 6);
  const rear = tx0 + (flip ? 6 : -1);
  if (carrying) {
    // Both arms out in front and level, under whatever they are holding.
    px(ctx, front, armY + 1, a.shirt, 1, 3);
    px(ctx, front + dir, armY + 2, a.skin, 1, 2);
    px(ctx, rear, armY + 1, shade(a.shirt, 0.88), 1, 3);
  } else if (eating) {
    // One hand up at the mouth, the other down at their side.
    px(ctx, front, armY, a.shirt, 1, 2);
    px(ctx, front, armY - 2, a.skin, 1, 2);
    px(ctx, rear, armY, shade(a.shirt, 0.88), 1, 4);
  } else if (watching) {
    // A hand up shading the eyes, which is the only pose in here that says
    // somebody is looking at something rather than at nothing.
    px(ctx, front, armY - 1, a.shirt, 1, 3);
    px(ctx, front, armY - 3, a.skin, 2, 1);
    px(ctx, rear, armY, shade(a.shirt, 0.88), 1, 4);
  } else if (talking) {
    // One hand moving while they talk. Slow, and only a pixel of it.
    const gesture = Math.round(Math.sin(v.phase * 3) * 1.5);
    px(ctx, front, armY + gesture, a.shirt, 1, 3);
    px(ctx, front, armY + 3 + gesture, a.skin, 1, 1);
    px(ctx, rear, armY, shade(a.shirt, 0.88), 1, 4);
  } else {
    const swing = working ? Math.round(workSwing * 2) : moving ? (stride === 0 ? -1 : 1) : 0;
    px(ctx, rear, armY - swing, shade(a.shirt, 0.88), 1, 4);
    px(ctx, front, armY + swing, a.shirt, 1, 4);
    px(ctx, rear, armY + 4 - swing, a.skin, 1, 1);
    px(ctx, front, armY + 4 + swing, a.skin, 1, 1);
  }

  // Head. It drops a pixel under a load, along with the tip of the torso.
  const headY = torsoY - 5 + (carrying && !sitting ? 1 : 0);
  const hx0 = x - 3 + tilt;
  px(ctx, hx0, headY, a.skin, 6, 5);
  px(ctx, hx0, headY, shade(a.skin, 1.08), 6, 1);
  // A jaw line under the cheek on the side turned away from us.
  if (!back) px(ctx, flip ? hx0 : hx0 + 5, headY + 4, shade(a.skin, 0.85), 1, 1);

  if (!back) {
    // Eyes, offset by facing so people look where they are going.
    const ex = flip ? hx0 + 1 : hx0 + 3;
    px(ctx, ex, headY + 2, '#3a2f26');
    px(ctx, ex + (flip ? -1 : 1) * 2, headY + 2, '#3a2f26');
  }

  // Hair.
  if (a.hat === 0) {
    px(ctx, hx0, headY - 1, a.hair, 6, 2);
    px(ctx, hx0, headY - 1, shade(a.hair, 1.22), 6, 1);
    if (a.hairStyle >= 1) px(ctx, back ? hx0 : flip ? hx0 + 5 : hx0, headY + 1, a.hair, 1, 3);
    if (a.hairStyle === 2) px(ctx, hx0, headY + 1, a.hair, 6, 1);
  } else {
    const hc = HAT_COLORS[a.hat - 1];
    px(ctx, hx0 - 1, headY - 1, hc, 8, 2);
    px(ctx, hx0, headY - 3, hc, 6, 2);
    px(ctx, hx0, headY - 3, shade(hc, 1.2), 6, 1);
    // A band round the crown, and the brim catching the light on the sunny side.
    px(ctx, hx0, headY - 1, shade(hc, 0.72), 6, 1);
    px(ctx, hx0 - 1, headY - 1, shade(hc, 1.15), 1, 1);
    px(ctx, hx0, headY, a.hair, 6, 1);
  }

  /*
   * What they are carrying, held in front of them at chest height rather than
   * out at arm's length beside the hip. It sits just past the hands, one pixel
   * below the arms, so the arms visibly go under it.
   */
  if (v.carrying) {
    const meta = RESOURCE_META[v.carrying.res];
    const cx = flip ? tx0 - 5 : tx0 + 6;
    px(ctx, cx, armY + 1, shade(meta.color, 0.7), 5, 5);
    px(ctx, cx, armY + 1, meta.color, 5, 4);
    px(ctx, cx, armY + 1, shade(meta.color, 1.28), 5, 1);
    // A strap or a seam across it, so a load of wood and a load of stone are
    // not the same box in two colours.
    px(ctx, cx + 2, armY + 1, shade(meta.color, 0.78), 1, 5);
  }

  // Something in the mouth, for anybody actually eating.
  if (eating) px(ctx, flip ? hx0 - 1 : hx0 + 6, headY + 2, '#d8a86a');

  /*
   * And a tool, in the hand that is doing the work — the same pixel the arm
   * ends on, swinging with it, rather than at a fixed offset from the body.
   */
  if (working) {
    const tool = toolFor(v);
    if (tool) {
      const swing = Math.round(workSwing * 2);
      drawTool(ctx, tool, front + dir, armY + 4 + swing, dir);
    }
  }
}

/**
 * Asleep: a mat, a blanket with somebody under it, a pillow and a head on it.
 *
 * The old version was a flat lilac bar with a skin-coloured square stuck on the
 * end, which at any zoom read as a crate with a lid. What makes a sleeping
 * figure legible is the *bump* — a shoulder and a hip under the blanket — and
 * that is two rectangles.
 */
function drawSleeping(ctx: Ctx, v: Villager, sx: number, sy: number): void {
  const a = v.appearance;
  const x = Math.round(sx);
  const y = Math.round(sy);
  shadow(ctx, sx, sy, 11);
  // The mat, then the blanket over it.
  px(ctx, x - 6, y - 3, '#584e69', 12, 3);
  px(ctx, x - 6, y - 4, '#6a5f7a', 12, 1);
  // Shoulder and hip under the blanket, which is the whole of the read.
  px(ctx, x - 4, y - 6, '#6a5f7a', 7, 3);
  px(ctx, x - 3, y - 7, '#7b6f8c', 5, 1);
  px(ctx, x - 1, y - 5, '#5c5270', 3, 1);
  // A pillow, and a head resting on it rather than floating beside it.
  px(ctx, x + 3, y - 6, '#cdc4d8', 5, 2);
  px(ctx, x + 4, y - 9, a.skin, 4, 3);
  px(ctx, x + 4, y - 10, a.hair, 4, 1);
  px(ctx, x + 4, y - 7, shade(a.skin, 0.85), 4, 1);
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
  pot: ['.......', '.X...X.', '.XXXXX.', 'XXXXXXX', 'X#####X', 'X#####X', '.XXXXX.'],
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
  pot: ['#8c8f96', '#d8a86a'],
  star: ['#ffd77a', '#ffd77a'],
};

/** The tool that stands for a trade, wherever a trade wants a picture. */
function toolGlyph(job: JobId | undefined): string | null {
  switch (job) {
    case 'woodcutter':
      return 'axe';
    case 'miner':
      return 'pick';
    case 'smith':
      return 'hammer';
    case 'farmer':
      return 'wheat';
    case 'miller':
      return 'sails';
    case 'cook':
      return 'bread';
    case 'fisher':
      return 'fish';
    default:
      return null;
  }
}

/** Villagers work at a building, so the tool they are holding comes from it. */
function jobGlyph(g: GameState, v: Villager, fallback: string): string {
  if (!v.workplace) return fallback;
  for (const b of g.buildings) {
    if (b.id !== v.workplace) continue;
    return toolGlyph(BUILDINGS[b.def].job) ?? fallback;
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
    case 'tending':
      return 'sprout';
    case 'harvesting':
      return 'wheat';
    case 'eating':
      return 'bread';
    case 'cooking':
      return 'pot';
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

/**
 * Somebody nobody has looked at yet. A star to their left, clear of the
 * activity badge above them and the hunger pip to their right, so a newcomer
 * hauling their first crate carries all three without them piling up.
 */
export function drawNewcomerMark(ctx: Ctx, sx: number, sy: number, pulse: number): void {
  const left = Math.round(sx) - 13;
  const top = Math.round(sy) - 29;

  ctx.save();
  ctx.globalAlpha = 0.65 + pulse * 0.35;
  ctx.fillStyle = 'rgba(24,20,16,0.42)';
  ctx.fillRect(left, top + 1, 7, 5);
  ctx.fillRect(left + 1, top, 5, 7);
  for (let r = 0; r < 5; r++) {
    const row = NEW_STAR[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '.') continue;
      px(ctx, left + 1 + c, top + 1 + r, row[c] === 'X' ? '#ffe6a8' : '#e8b661');
    }
  }
  ctx.restore();
}

const NEW_STAR = ['..#..', '.#X#.', '#XXX#', '.#X#.', '..#..'];

/**
 * A workplace asking for somebody. The trade's own tool on a lit plate, with a
 * ring round it that breathes slowly — slowly on purpose: a lodge with nobody
 * cutting at it is not an emergency, and this game has none. It is drawn after
 * the lighting pass like the villagers' badges, because a building standing
 * idle is exactly the thing worth noticing at dusk.
 */
export function drawHiringIcon(ctx: Ctx, job: JobId | undefined, sx: number, sy: number, pulse: number): void {
  const rows = GLYPHS[toolGlyph(job) ?? 'hammer'];
  const left = Math.round(sx) - 4;
  const top = Math.round(sy) - 5;

  ctx.save();
  ctx.globalAlpha = 0.7 + pulse * 0.3;
  // The ring is what carries the asking; the plate underneath is the same dark
  // one every other badge uses, so the two kinds sit together on screen.
  ctx.fillStyle = '#ffd77a';
  ctx.fillRect(left - 1, top, 11, 9);
  ctx.fillRect(left, top - 1, 9, 11);
  ctx.fillStyle = 'rgba(24,20,16,0.72)';
  ctx.fillRect(left, top + 1, 9, 7);
  ctx.fillRect(left + 1, top, 7, 9);

  const [main, shadeColor] = GLYPH_COLORS[toolGlyph(job) ?? 'hammer'];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      px(ctx, left + 1 + c, top + 1 + r, ch === 'X' ? main : shadeColor);
    }
  }
  ctx.restore();
}

/** Tiny per-villager status pip: hungry, tired, or nothing at all. */
export function drawMood(ctx: Ctx, g: GameState, v: Villager, sx: number, sy: number): void {
  if (v.activity === 'sleeping') return;
  // Sits beside the activity badge rather than under it, so the two never stack.
  const y = Math.round(sy) - 27;
  if (v.hunger > 0.85 && preparedFood(g) <= 0) {
    px(ctx, Math.round(sx) + 6, y, '#e8b45c', 3, 3);
    px(ctx, Math.round(sx) + 7, y + 1, '#8a5a28', 1, 1);
  }
}
