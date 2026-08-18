/** Verifies a save file survives a serialise → deserialise → serialise round trip. */
import { readFileSync } from 'node:fs';
import { deserialize, serialize } from '../src/save/save';

const raw = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const g = deserialize(raw);
console.log('loaded:', g.villagers.length, 'villagers,', g.buildings.length, 'buildings,', g.tiles.length, 'tiles, day', g.day, g.season);
console.log('blocked tiles:', g.tiles.filter((t) => t.blocked).length);
console.log('props preserved:', g.tiles.filter((t) => t.prop).length);
console.log('plots:', g.buildings.reduce((n, b) => n + b.plots.length, 0));
console.log('discovered:', [...g.discovered].join(', ') || '(none)');
console.log('goals done:', g.goals.filter((x) => x.done).length);
// Water that has been fished over, and what everybody would rather eat. Both
// are the sort of field that is invisible until somebody reopens a kingdom and
// finds the lake freshened and everyone's tastes redrawn.
const worked = g.tiles.filter((t) => t.fish < 0.999).length;
console.log('water still settling down:', worked, 'tiles');
// …and prove it rather than trusting the dump to have been taken at a moment
// when somebody happened to be fishing. A field that is never written looks
// exactly like a field that is written and always full.
{
  const wet = g.tiles.findIndex((t) => t.terrain === 'water' || t.terrain === 'shallow');
  if (wet >= 0) {
    g.tiles[wet].fish = 0.37;
    const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    if (Math.abs(back.tiles[wet].fish - 0.37) > 0.011) {
      console.error(`✗ how rested the water is did not survive the trip (${back.tiles[wet].fish})`);
      process.exit(1);
    }
    g.tiles[wet].fish = 1;
  }
}
const likes = g.villagers.filter((v) => v.favoriteFood === 'cookedFish').length;
console.log('food preferences:', likes, 'for fish,', g.villagers.length - likes, 'for bread');

const again = serialize(g);
// A second trip has to land in exactly the same place. Anything that survives
// one pass and not two is a field being rebuilt from defaults somewhere.
const twice = JSON.stringify(serialize(deserialize(JSON.parse(JSON.stringify(again)))));
if (twice !== JSON.stringify(again)) {
  console.error('✗ the second round trip differs from the first');
  process.exit(1);
}
console.log('re-serialised ok,', twice.length, 'bytes, and stable across a second trip');
