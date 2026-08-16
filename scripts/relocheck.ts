/**
 * Relocation harness.
 *
 *   npx tsx scripts/relocheck.ts        (or: npm run reloccheck)
 *
 * Moving a building is the only thing in the game that changes a finished
 * building's coordinates, and almost everything it can get wrong is invisible
 * in the source and invisible on screen: a footprint left claimed by a building
 * that has walked away, a worker pointing at a corner with nothing on it, a
 * level or a name quietly reset to what a new one would have had.
 *
 * So this drives one all the way through on a real kingdom — start the move,
 * check the original is still working, save and reload it half-finished, let
 * the villagers actually carry the materials and build it — and then asserts
 * the two things that matter: the building that arrives is the same building
 * that left, and the map agrees with the building list afterwards.
 */

import { newGame, assignJob, buildingById, makeBuilding, removeBuilding, storageCapacity } from '../src/sim/state';
import { completeConstruction, updateVillagers } from '../src/sim/villager';
import { updatePopulation } from '../src/sim/population';
import { updateGoals } from '../src/sim/goals';
import { chooseCamp, suggestCamp } from '../src/sim/founding';
import { tileAt, updateTerrain } from '../src/world/terrain';
import { BUILDINGS, DAY_LENGTH, relocateCost } from '../src/sim/defs';
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

// --- get a kingdom going ---------------------------------------------------
// The founder walks up the beach before the map is handed over, so the one
// click the opening asks for cannot be made until they have stopped walking.
while (g.founding.stage === 'arriving') step(1);
const spot = suggestCamp(g);
chooseCamp(g, spot.x, spot.y);
step(400);
const camp = g.buildings.find((b) => b.def === 'commons')!;
if (!camp || camp.stage !== 'done') throw new Error('camp never finished');

g.stock.wood = 400;
g.stock.stone = 400;
const lodgeSpot = freeSpot('lodge', camp);
const lodge = put('lodge', lodgeSpot.x, lodgeSpot.y);
completeConstruction(g, lodge);
lodge.level = 2;
lodge.name = 'The Old Lodge';
const built = lodge.built;
const worker = g.villagers[0];
assignJob(g, worker, lodge.id);
step(20);

const oldX = lodge.x;
const oldY = lodge.y;
const target = freeSpot('lodge', { x: camp.x + 8, y: camp.y + 8 }, 3);

// --- start the move --------------------------------------------------------
const stockBefore = g.stock.wood;
const site = makeBuilding(g, 'lodge', target.x, target.y, rng);
site.stage = 'building';
site.relocOf = lodge.id;
lodge.movingTo = site.id;
g.buildings.push(site);
for (let dy = 0; dy < 2; dy++)
  for (let dx = 0; dx < 2; dx++) {
    const t = tileAt(g, target.x + dx, target.y + dy)!;
    t.building = site.id;
    t.blocked = true;
    t.prop = null;
    t.amount = 0;
  }

ok(lodge.stage === 'done', 'the old lodge keeps working while the move is under way');
ok(lodge.workers.includes(worker.id), 'its worker stays put during the move');
ok(worker.workplace === lodge.id, 'and still points at the original');

// A save mid-move has to survive the round trip, or closing the tab halfway
// through moving the quarry quietly puts it back where it started.
const reloaded = deserialize(JSON.parse(JSON.stringify(serialize(g))));
const rl = reloaded.buildings.find((b) => b.id === lodge.id)!;
const rs = reloaded.buildings.find((b) => b.id === site.id)!;
ok(rl.movingTo === site.id && rs.relocOf === lodge.id, 'a half-finished move survives a save');

// --- let the kingdom finish it --------------------------------------------
// Generously long. A two-person kingdom has one pair of spare hands and half of
// every day is night, so the move takes a while in wall-clock terms — the point
// here is that it finishes correctly, not that it finishes quickly.
step(3000);
if (g.buildings.some((b) => b.relocOf)) {
  console.log(`  note  the move was still under way after 3000s (store cap ${storageCapacity(g)})`);
}

ok(!g.buildings.some((b) => b.relocOf), 'the site is gone once the move is done');
const after = buildingById(g, lodge.id)!;
ok(!!after, 'the lodge still exists under the same id');
ok(after.x === target.x && after.y === target.y, `it stands at the new spot (${after.x},${after.y})`);
ok(after.level === 2, 'it kept its level');
ok(after.name === 'The Old Lodge', 'it kept its name');
ok(after.built === built, 'it kept the day it was built');
ok(after.workers.includes(worker.id), 'it kept its worker');
ok(worker.workplace === after.id, 'the worker still points at it');
ok(after.stage === 'done' && !after.movingTo, 'it is finished and no longer moving');
ok(g.buildings.filter((b) => b.def === 'lodge').length === 1, 'there is still exactly one lodge');

const paid = relocateCost('lodge').wood ?? 0;
ok(g.stock.wood <= stockBefore - paid + 60, `the move was paid for (${paid} wood)`);

// The old ground has to be genuinely free, or it is a hole in the map forever.
let oldClear = true;
for (let dy = 0; dy < 2; dy++)
  for (let dx = 0; dx < 2; dx++) {
    const t = tileAt(g, oldX + dx, oldY + dy)!;
    if (t.building !== 0 || t.blocked) oldClear = false;
  }
ok(oldClear, 'the ground it left is clear and buildable again');

let newOwned = true;
for (let dy = 0; dy < 2; dy++)
  for (let dx = 0; dx < 2; dx++) {
    if (tileAt(g, target.x + dx, target.y + dy)!.building !== after.id) newOwned = false;
  }
ok(newOwned, 'the new ground belongs to it');

let orphan = 0;
for (const t of g.tiles) if (t.building && !buildingById(g, t.building)) orphan++;
ok(orphan === 0, 'no tile belongs to a building that is not there');

// --- cancelling a move -----------------------------------------------------
const camp2 = freeSpot('lodge', { x: 6, y: 6 }, 2);
const site2 = makeBuilding(g, 'lodge', camp2.x, camp2.y, rng);
site2.stage = 'building';
site2.relocOf = after.id;
after.movingTo = site2.id;
g.buildings.push(site2);
for (let dy = 0; dy < 2; dy++)
  for (let dx = 0; dx < 2; dx++) tileAt(g, camp2.x + dx, camp2.y + dy)!.building = site2.id;

removeBuilding(g, site2);
ok(after.movingTo === undefined, 'abandoning the new ground leaves the lodge where it was');
ok(after.x === target.x, 'and it has not moved');

console.log(fails.length ? `\n${fails.length} FAILED` : '\nRelocation is sound.');
process.exit(fails.length ? 1 : 0);
