/**
 * The Base Camp's founding woodpile, and what happens to it when a lodge opens.
 *
 *   npx tsx scripts/woodcheck.ts        (or: npm run woodcheck)
 *
 * The camp's hundred wood is scaffolding: somewhere to put timber down before
 * the kingdom has anywhere proper. Once a lodge stands it closes, and the wood
 * already banked there has to reach the lodge the same way everything else in
 * this game reaches anywhere — in somebody's arms, one load at a time.
 *
 * The ordinary simulation harness cannot check this. It plays a kingdom that
 * spends wood as fast as it gets it, so by the time its lodge finishes the camp
 * is usually down to single figures and the transfer is over before it starts.
 * A player who has been saving up is the interesting case, so this sets one up
 * deliberately: a full camp, a lodge, and nothing else to spend it on.
 *
 * Four things have to hold, and all four are ways the change could have been
 * done wrongly instead:
 *
 *   - the wood is still *there* the instant the lodge opens (nothing teleports,
 *     nothing is deleted, the kingdom owns exactly what it owned a tick ago);
 *   - the camp stops taking any more;
 *   - somebody physically walks it to the lodge, and it all arrives;
 *   - the closure is permanent and survives a save, so a kingdom that later
 *     loses its lodge is not handed the founding cache back.
 */

import {
  assignJob,
  buildingById,
  capacityIn,
  deliver,
  makeBuilding,
  newGame,
  roomIn,
  storedOf,
  totalOf,
} from '../src/sim/state';
import { completeConstruction, updateVillagers } from '../src/sim/villager';
import { updatePopulation } from '../src/sim/population';
import { updateGoals } from '../src/sim/goals';
import { chooseCamp, suggestCamp } from '../src/sim/founding';
import { tileAt, updateTerrain } from '../src/world/terrain';
import { BUILDINGS, DAY_LENGTH } from '../src/sim/defs';
import { rng } from '../src/core/util';
import type { BuildingId } from '../src/types';
import { seasonForDay } from '../src/sim/state';
import { deserialize, serialize } from '../src/save/save';

const g = newGame(12345);
const fails: string[] = [];
const ok = (cond: boolean, what: string) => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${what}`);
  if (!cond) fails.push(what);
};

function step(seconds: number): void {
  const DT = 0.1;
  for (let i = 0; i < seconds / DT; i++) {
    g.clock += DT;
    g.dayT += DT / DAY_LENGTH;
    while (g.dayT >= 1) {
      g.dayT -= 1;
      g.day++;
      const s = seasonForDay(g.day);
      g.season = s.season;
      g.year = s.year;
    }
    updateVillagers(g, DT);
    updatePopulation(g, DT);
    updateTerrain(g, DT);
    if (i % 10 === 0) updateGoals(g);
  }
}

function put(def: BuildingId, x: number, y: number) {
  const d = BUILDINGS[def];
  const b = makeBuilding(g, def, x, y, rng);
  b.stage = 'building';
  g.buildings.push(b);
  for (let dy = 0; dy < d.h; dy++)
    for (let dx = 0; dx < d.w; dx++) {
      const t = tileAt(g, x + dx, y + dy)!;
      t.building = b.id;
      if (d.solid) t.blocked = true;
      t.prop = null;
      t.amount = 0;
    }
  return b;
}

function freeSpot(def: BuildingId, near: { x: number; y: number }, minR = 4): { x: number; y: number } {
  const d = BUILDINGS[def];
  for (let r = minR; r < 18; r++)
    for (let a = 0; a < 48; a++) {
      const x = Math.round(near.x + Math.cos((a / 48) * Math.PI * 2) * r);
      const y = Math.round(near.y + Math.sin((a / 48) * Math.PI * 2) * r);
      let good = true;
      for (let dy = 0; dy < d.h && good; dy++)
        for (let dx = 0; dx < d.w; dx++) {
          const t = tileAt(g, x + dx, y + dy);
          if (!t || t.building || t.plot || t.terrain === 'water' || t.terrain === 'shallow') good = false;
        }
      if (good) return { x, y };
    }
  throw new Error('nowhere to put it');
}

// --- a camp with a full woodpile and no lodge ------------------------------

while (g.founding.stage === 'arriving') step(1);
const spot = suggestCamp(g);
chooseCamp(g, spot.x, spot.y);
step(400);
const camp = g.buildings.find((b) => b.def === 'commons')!;
if (!camp || camp.stage !== 'done') throw new Error('camp never finished');

deliver(g, camp, 'wood', roomIn(camp, 'wood'));
const banked = camp.store.wood ?? 0;
ok(banked > 50, `the camp is holding its founding wood before the lodge (${Math.round(banked)})`);
ok(capacityIn(camp, 'wood') > 0, 'the camp takes wood while it is the only woodpile');

// --- the lodge opens -------------------------------------------------------

const ownedBefore = totalOf(g, 'wood');
const lodgeSpot = freeSpot('lodge', camp);
const lodge = put('lodge', lodgeSpot.x, lodgeSpot.y);
completeConstruction(g, lodge);

ok(camp.cacheRetired === true, 'the camp cache retires the moment the lodge is finished');
ok(capacityIn(camp, 'wood') === 0, 'the camp stops accepting wood');
// The whole point of the arrangement: closing the compartment moves nothing.
ok(
  Math.round(camp.store.wood ?? 0) === Math.round(banked),
  'the wood banked at the camp is still physically at the camp',
);
ok(
  Math.round(totalOf(g, 'wood')) === Math.round(ownedBefore),
  'the kingdom owns exactly what it owned a tick earlier — nothing teleported, nothing vanished',
);
ok(roomIn(camp, 'wood') === 0 && (camp.store.wood ?? 0) > 0, 'the closed compartment reads as having no room');

// --- somebody carries it across --------------------------------------------

// One pair of hands and nothing else to do with them, so the only thing that
// can empty the camp is the clearing rung of the helper ladder doing it.
//
// Sampled every game-second rather than in longer jumps: the camp and the lodge
// are neighbours here and a round trip is over quickly, so a coarser look can
// land between legs and miss the very thing being checked.
for (const v of g.villagers) assignJob(g, v, 0);
let seenCarrying = false;
for (let i = 0; i < 1200 && (camp.store.wood ?? 0) > 0; i++) {
  step(1);
  if (g.villagers.some((v) => v.carrying?.res === 'wood')) seenCarrying = true;
}

ok(seenCarrying, 'somebody is actually seen carrying the wood, an armful at a time');
ok(Math.round(camp.store.wood ?? 0) === 0, `the camp ends up empty (${Math.round(camp.store.wood ?? 0)} left)`);
ok(
  Math.round(lodge.store.wood ?? 0) >= Math.round(banked),
  `all of it arrives at the lodge (${Math.round(lodge.store.wood ?? 0)} of ${Math.round(banked)})`,
);
ok(
  Math.round(storedOf(g, 'wood')) === Math.round(ownedBefore),
  'the kingdom still owns every stick of it afterwards',
);

// --- and it stays retired ---------------------------------------------------

const reloaded = deserialize(JSON.parse(JSON.stringify(serialize(g, 1))))!;
const campAgain = reloaded.buildings.find((b) => b.def === 'commons')!;
ok(campAgain.cacheRetired === true, 'the closure survives a save and reload');
ok(capacityIn(campAgain, 'wood') === 0, 'the reloaded camp still refuses wood');

// Losing the lodge afterwards is not a reason to hand the scaffolding back: the
// camp cache is a thing the kingdom has *finished with*, not a fallback that
// reappears. The interface refuses to demolish the last woodpile for exactly
// this reason, and this asserts the rule the refusal is protecting.
const lodgeAgain = reloaded.buildings.find((b) => b.def === 'lodge')!;
reloaded.buildings = reloaded.buildings.filter((b) => b.id !== lodgeAgain.id);
ok(
  capacityIn(buildingById(reloaded, campAgain.id)!, 'wood') === 0,
  'a kingdom that later loses its lodge does not get the founding cache back',
);

console.log(fails.length === 0 ? '\nAll good.' : `\n${fails.length} problem(s).`);
process.exit(fails.length === 0 ? 0 : 1);
