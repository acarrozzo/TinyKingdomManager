/**
 * The arrival rules, driven one at a time on a real kingdom.
 *
 *   npx tsx scripts/popcheck.ts [seed]
 *
 * `simcheck` shows that people turn up and roughly how fast; it cannot show the
 * rules that only matter at the edges, and every one of those is invisible both
 * in the source and on screen. A kingdom whose beds are full quietly losing the
 * wait it had already served, a reload handing the next traveller a fresh roll,
 * a window whose variation reaches past its own far end — all of them look like
 * nothing at all until somebody notices the numbers years later.
 *
 * So each rule is exercised on its own: the clock that must not run during the
 * founding, the first companion landing inside 6–9 game-minutes, progress
 * freezing rather than emptying when there is no bed, both halves of a walk
 * surviving serialisation, and Vibes moving the pace without ever moving it
 * outside the window.
 */

import { newGame, bedsFree, housingCapacity } from '../src/sim/state';
import { arrivalEta, arrivalNeed, arrivalWindow, updatePopulation } from '../src/sim/population';
import { vibesOf } from '../src/sim/vibes';
import { deserialize, serialize } from '../src/save/save';
import { updateVillagers } from '../src/sim/villager';
import { chooseCamp, suggestCamp } from '../src/sim/founding';
import { updateTerrain } from '../src/world/terrain';
import { DAY_LENGTH, FOOD_VIBES_NEUTRAL, GAME_MINUTE, VIBE_MAX } from '../src/sim/defs';

const seed = Number(process.argv[2] || 7);
let failures = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? `   ${extra}` : ''}`);
};

const g = newGame(seed);
const DT = 0.5;
const step = () => {
  g.clock += DT;
  g.dayT = (g.dayT + DT / DAY_LENGTH) % 1;
  updateVillagers(g, DT);
  updateTerrain(g, DT);
  updatePopulation(g, DT);
};

console.log(`\n=== arrivals on seed ${seed} ===\n`);

// The founding: nobody is on the road, and the clock does not run either.
for (let i = 0; i < 200; i++) step();
ok('no arrival progress while founding', g.arrival.progress === 0);

const spot = suggestCamp(g);
chooseCamp(g, spot.x, spot.y);
let t = 0;
while (g.founding.stage !== 'done' && t < DAY_LENGTH * 2) {
  step();
  t += DT;
}
ok('the camp goes up', g.founding.stage === 'done');
ok('and brings two beds with it', housingCapacity(g) === 2);
// The whole point of holding the clock: the second bed is what starts the walk.
ok('the first companion sets off from nothing', g.arrival.progress <= DT * 2);

const window1 = arrivalWindow(1);
const started = g.clock;
while (g.villagers.length < 2 && g.clock - started < window1.max * 2) step();
const took = g.clock - started;
ok(
  'and arrives inside the window',
  took >= window1.min && took <= window1.max,
  `${(took / GAME_MINUTE).toFixed(1)} game-min, window ${window1.min / GAME_MINUTE}–${window1.max / GAME_MINUTE}`,
);

// Two people in two beds. Nobody else may come, nobody leaves to make room, and
// the wait already served is held rather than thrown away.
ok('every bed is taken', bedsFree(g) === 0);
const held = g.arrival.progress;
for (let i = 0; i < 600; i++) step();
ok('progress freezes rather than emptying', g.arrival.progress === held);
ok('nothing is on the way', arrivalEta(g) === null);
ok('and nobody is asked to leave', g.villagers.length === 2);

// Both halves of the walk survive a save. Rerolling either would make closing
// the tab a way of asking the kingdom again.
g.arrival.progress = 123.5;
const jitter = g.arrival.jitter;
const reloaded = deserialize(JSON.parse(JSON.stringify(serialize(g))));
ok('progress survives a save', reloaded.arrival.progress === 123.5);
ok('the hidden variation survives a save', reloaded.arrival.jitter === jitter);
ok('so the wait is the same length after a reload', Math.abs(arrivalNeed(reloaded) - arrivalNeed(g)) < 1e-9);

// The variation may move an arrival about inside its window and never past it.
const window2 = arrivalWindow(g.villagers.length);
for (const j of [-1, -0.5, 0, 0.5, 1]) {
  g.arrival.jitter = j;
  const need = arrivalNeed(g);
  ok(
    `variation ${j} stays inside the window`,
    need >= window2.min && need <= window2.max,
    `${(need / GAME_MINUTE).toFixed(1)} in ${window2.min / GAME_MINUTE}–${window2.max / GAME_MINUTE}`,
  );
}

/*
 * Vibes against pace. Food is the cheapest lever from here — the food and
 * wellbeing halves are both unlocked by having cooked anything — so the meter
 * is driven with meals and the wait is watched shortening. Two things are being
 * checked: that it is a ramp rather than a switch, and that a hundred Vibes is
 * not a promise of the exact minimum.
 */
g.arrival.jitter = 0;
g.stats.cooked = 1;
const paces: { vibes: number; mins: number }[] = [];
for (const meals of [0, 1, 2, 4, 8]) {
  g.stock.bread = meals * g.villagers.length;
  paces.push({ vibes: vibesOf(g).total, mins: arrivalNeed(g) / GAME_MINUTE });
}
console.log(
  `\n  vibes → wait: ${paces.map((p) => `${p.vibes}→${p.mins.toFixed(1)}m`).join('  ')}` +
    `   (window ${window2.min / GAME_MINUTE}–${window2.max / GAME_MINUTE})\n`,
);
ok(
  'more Vibes never means a longer wait',
  paces.every((p, i) => i === 0 || p.mins <= paces[i - 1].mins + 1e-9),
);
ok('and it is a ramp, not a switch', new Set(paces.map((p) => p.mins.toFixed(2))).size > 2);
ok('the fastest wait is still not the minimum', paces[paces.length - 1].mins > window2.min / GAME_MINUTE);

// The two foods are worth exactly the same, and neither is worth more for
// being kept alongside the other. Three larders of the same size, one Vibe.
{
  const per = g.villagers.length * 3;
  const scores: number[] = [];
  for (const [bread, fish] of [
    [per, 0],
    [0, per],
    [per / 2, per / 2],
  ]) {
    g.stock.bread = bread;
    g.stock.cookedFish = fish;
    scores.push(vibesOf(g).food);
  }
  ok('bread and cooked fish are worth the same', new Set(scores.map((s) => s.toFixed(4))).size === 1);
  g.stock.cookedFish = 0;
}

// Before the first meal the food chain must cost the player nothing — and
// "first meal" means either one, or a kingdom living on fish would be marked
// down for never having baked.
const fresh = newGame(seed);
const v = vibesOf(fresh);
ok('food is neutral before the first cooked meal', v.preFood && v.food === FOOD_VIBES_NEUTRAL);
ok('and so is how everyone is keeping', v.wellbeing === VIBE_MAX.wellbeing);
{
  const fishy = newGame(seed);
  fishy.stats.cooked = 1;
  fishy.stock.cookedFish = fishy.villagers.length * 4;
  ok('a kingdom that only ever cooks fish still reaches full food Vibes', vibesOf(fishy).food === 30);
}

console.log(failures ? `\n${failures} PROBLEM(S)\n` : '\nArrivals are sound.\n');
process.exit(failures ? 1 : 0);
